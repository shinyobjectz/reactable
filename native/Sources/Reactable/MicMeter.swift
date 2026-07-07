import AVFoundation
import Foundation

// Live mic level meter for the bar's "mic is on" waveform. Taps the default
// input, computes RMS per buffer, and reports a normalized 0…1 level (throttled)
// so the bar can react without us pushing to the webview every buffer.
@MainActor
final class MicMeter {
    private let engine = AVAudioEngine()
    private var running = false
    private var lastPush = Date.distantPast
    var onLevel: ((Float) -> Void)?

    func start() {
        guard !running else { return }
        AVCaptureDevice.requestAccess(for: .audio) { _ in }
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.channelCount > 0 else { return }

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let ch = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            if n == 0 { return }
            var sum: Float = 0
            for i in 0..<n { let s = ch[i]; sum += s * s }
            let rms = (sum / Float(n)).squareRoot()
            // Speech RMS is roughly 0…0.3; scale to a lively 0…1.
            let level = min(1, rms * 6)
            Task { @MainActor [weak self] in self?.emit(level) }
        }

        do {
            try engine.start()
            running = true
        } catch {
            fputs("reactable: mic meter start failed: \(error)\n", stderr)
        }
    }

    private func emit(_ level: Float) {
        // ~15 fps to the webview is plenty and cheap.
        let now = Date()
        if now.timeIntervalSince(lastPush) < 0.066 { return }
        lastPush = now
        onLevel?(level)
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
        onLevel?(0)
    }
}
