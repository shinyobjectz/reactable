import AVFoundation
import CoreAudio
import Foundation

// Live mic level for the bar's "mic is on" waveform.
//
// The AVAudioEngine tap fires on a real-time audio thread, so it must NOT touch
// the main actor or spawn a Task (that trips a Swift executor assertion and
// SIGTRAPs the app). It only writes the latest level under a lock; the main
// thread polls `level()` on a timer and pushes to the bar.
final class MicMeter: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var latest: Float = 0
    private var running = false
    // When set, the tap also appends each buffer to this file (mic sidecar
    // for takes). SCStream's captureMicrophone never delivers on this setup,
    // so the take's voice track is recorded here through the same engine
    // that demonstrably works for the meter.
    private var file: AVAudioFile?
    private var preferredUID: String?

    /// Select the input device by AVCaptureDevice uniqueID / Core Audio UID
    /// (nil = system default). Restarts the engine if it is live.
    func setInputDevice(uid: String?) {
        preferredUID = uid
        if running {
            stop()
            start()
        }
    }

    private func applyPreferredDevice() {
        guard let uid = preferredUID, let au = engine.inputNode.audioUnit else { return }
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var uidCF = uid as CFString
        let status = withUnsafePointer(to: &uidCF) { uidPtr in
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject), &addr,
                UInt32(MemoryLayout<CFString>.size), uidPtr,
                &size, &deviceID
            )
        }
        guard status == noErr, deviceID != 0 else {
            fputs("reactable: mic device UID not found (\(uid)) — using default\n", stderr)
            return
        }
        AudioUnitSetProperty(
            au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0,
            &deviceID, UInt32(MemoryLayout<AudioDeviceID>.size)
        )
    }

    func start() {
        guard !running else { return }
        AVCaptureDevice.requestAccess(for: .audio) { _ in }

        applyPreferredDevice()
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        // Invalid format = no input / permission not granted yet. Bail instead
        // of crashing in installTap.
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fputs("reactable: mic meter — no valid input format yet\n", stderr)
            return
        }

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self, let ch = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            if n == 0 { return }
            var sum: Float = 0
            for i in 0..<n { let s = ch[i]; sum += s * s }
            let level = min(1, (sum / Float(n)).squareRoot() * 6)
            self.lock.lock()
            self.latest = level
            let file = self.file
            self.lock.unlock()
            if let file { try? file.write(from: buffer) }
        }

        do {
            try engine.start()
            running = true
        } catch {
            fputs("reactable: mic meter start failed: \(error)\n", stderr)
            engine.inputNode.removeTap(onBus: 0)
        }
    }

    /// Start appending tap buffers to a WAV sidecar. Requires the meter to be
    /// running (mic toggle on). Returns false if the file can't be created.
    func beginWriting(to url: URL) -> Bool {
        guard running else { return false }
        let format = engine.inputNode.inputFormat(forBus: 0)
        guard let f = try? AVAudioFile(forWriting: url, settings: format.settings) else {
            return false
        }
        lock.lock()
        file = f
        lock.unlock()
        return true
    }

    /// Stop the sidecar; the file finalizes when the last reference drops.
    func endWriting() {
        lock.lock()
        file = nil
        lock.unlock()
    }

    var isWriting: Bool {
        lock.lock()
        defer { lock.unlock() }
        return file != nil
    }

    /// Thread-safe latest level, 0…1.
    func level() -> Float {
        lock.lock()
        defer { lock.unlock() }
        return latest
    }

    var isRunning: Bool { running }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
        lock.lock()
        latest = 0
        file = nil
        lock.unlock()
    }
}
