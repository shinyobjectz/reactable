import AVFoundation
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

    func start() {
        guard !running else { return }
        AVCaptureDevice.requestAccess(for: .audio) { _ in }

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
            self.lock.unlock()
        }

        do {
            try engine.start()
            running = true
        } catch {
            fputs("reactable: mic meter start failed: \(error)\n", stderr)
            engine.inputNode.removeTap(onBus: 0)
        }
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
        lock.unlock()
    }
}
