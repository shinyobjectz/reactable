import AppKit
import Aperture
import AVFoundation
import Foundation

@MainActor
final class TakeRecorder {
    private let projectRoot: URL
    // Fresh instance per take: a Recorder whose SCStream wedged (replayd hang)
    // can never be stopped or reused, so the old one is abandoned on timeout
    // and the next take starts clean.
    private nonisolated(unsafe) var stageRecorder = Aperture.Recorder()
    private var takeDir: URL?
    private var eventLog: EventLog?
    private var startEpoch: TimeInterval?
    private var captureTarget: CaptureTarget?
    private(set) var takeId: String?

    init(projectRoot: URL) {
        self.projectRoot = projectRoot
    }

    var isActive: Bool { takeDir != nil }
    var isPaused: Bool { stageRecorder.isPaused }
    var currentTakeDir: URL? { takeDir }

    func start(
        sourceKind: String,
        captureTargetId: String?,
        areaRect: CGRect?,
        stageWindow: NSWindow?,
        deck: String,
        cam: CamBubblePanel?,
        camOn: Bool,
        micOn: Bool,
        systemAudioOn: Bool
    ) async throws -> URL {
        guard takeDir == nil else { throw TakeError.alreadyRecording }

        let target = try await CaptureTarget.resolve(
            sourceKind: sourceKind,
            captureTargetId: captureTargetId,
            areaRect: areaRect,
            stageWindow: stageWindow
        )

        stageRecorder = Aperture.Recorder()
        let id = Self.makeTakeId()
        let dir = projectRoot.appending(path: "takes/\(id)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let eventsURL = dir.appending(path: "events.jsonl")
        let log = try EventLog(url: eventsURL)
        eventLog = log
        takeDir = dir
        takeId = id
        startEpoch = Date().timeIntervalSince1970
        captureTarget = target

        log.stamp("record.start", payload: [
            "deck": deck,
            "sourceKind": sourceKind,
            "targetId": target.targetID,
            "targetLabel": target.label,
        ])

        let stageURL = dir.appending(path: "stage.mov")
        // Mic goes to mic.wav via MicMeter (AppController arms it after start) —
        // SCStream.captureMicrophone silently delivers nothing on this setup,
        // so passing a device here produced takes with no voice track.
        let micID: String? = nil
        do {
            nonisolated(unsafe) let recorder = stageRecorder
            let kind = target.kind
            let targetID = target.targetID
            let cropRect = target.cropRect
            try await Self.race(seconds: 15, label: "capture start") {
                try await Self.startStageCapture(
                    recorder: recorder,
                    kind: kind,
                    destination: stageURL,
                    targetID: targetID,
                    cropRect: cropRect,
                    systemAudioOn: systemAudioOn,
                    micID: micID
                )
            }
            log.stamp("capture.stage", payload: [
                "sourceKind": target.kind,
                "targetId": target.targetID,
                "label": target.label,
            ])

            if camOn, let cam {
                let camURL = dir.appending(path: "cam.mov")
                try cam.startRecording(to: camURL)
                log.stamp("capture.cam", payload: cam.frameJSON())
            }

            try writeManifest(deck: deck, dir: dir, hasCam: camOn, hasMic: micOn, sourceKind: sourceKind, target: target)
            try writeTakeWork(id: id, deck: deck, dir: dir, sourceKind: sourceKind, target: target)
            try writeDefaultEdit(dir: dir)
        } catch {
            // A failed or hung start must never leave the recorder "active" —
            // that made every later record press throw alreadyRecording.
            fputs("reactable: capture start failed (\(error)) — resetting take state\n", stderr)
            resetState()
            throw error
        }

        fputs("reactable: recording → \(dir.path())\n", stderr)
        return dir
    }

    func pause() throws {
        guard isActive else { return }
        try stageRecorder.pause()
        eventLog?.stamp("record.pause")
    }

    func resume() async throws {
        guard isActive else { return }
        try await stageRecorder.resume()
        eventLog?.stamp("record.resume")
    }

    func stop(cam: CamBubblePanel?) async throws -> URL? {
        guard let dir = takeDir else { return nil }

        eventLog?.stamp("record.stop")

        // SCStream.stopCapture can hang forever when replayd wedges; an
        // unbounded await here froze the recorder mid-stop, left stage.mov
        // without its moov atom, and stuck isActive on (alreadyRecording).
        nonisolated(unsafe) let recorder = stageRecorder
        do {
            try await Self.race(seconds: 10, label: "stage stop") {
                if recorder.isPaused { try? await recorder.resume() }
                try await recorder.stop()
            }
        } catch {
            fputs("reactable: stage stop failed (\(error)) — take may be unfinalized: \(dir.path())\n", stderr)
        }
        try? await cam?.stopRecording()

        resetState()

        fputs("reactable: take saved → \(dir.path())\n", stderr)
        return dir
    }

    private func resetState() {
        eventLog?.close()
        eventLog = nil
        takeDir = nil
        takeId = nil
        startEpoch = nil
        captureTarget = nil
    }

    func stamp(_ type: String, payload: [String: Any] = [:]) {
        guard isActive else { return }
        eventLog?.stamp(type, payload: payload)
    }

    nonisolated private static func startStageCapture(
        recorder: Aperture.Recorder,
        kind: String,
        destination: URL,
        targetID: String,
        cropRect: CGRect?,
        systemAudioOn: Bool,
        micID: String?
    ) async throws {
        let apertureTarget: Aperture.Target = switch kind {
        case "device": .externalDevice
        case "display", "area": .screen
        default: .window
        }
        let options = Aperture.RecordingOptions(
            destination: destination,
            targetID: targetID,
            framesPerSecond: 30,
            cropRect: cropRect,
            showCursor: true,
            highlightClicks: true,
            videoCodec: .h264,
            recordSystemAudio: systemAudioOn,
            microphoneDeviceID: micID
        )
        try await recorder.start(target: apertureTarget, options: options)
    }

    /// Run `op` but give up after `seconds`. Unlike a task group this never
    /// awaits the loser: an op stuck in an uncancellable syscall (SCStream
    /// against a wedged replayd) is abandoned so the app stays responsive.
    nonisolated private static func race<T: Sendable>(
        seconds: Double,
        label: String,
        _ op: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
            let state = RaceState(continuation)
            let work = Task {
                do { state.finish(.success(try await op())) }
                catch { state.finish(.failure(error)) }
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                work.cancel()
                state.finish(.failure(TakeError.timedOut(label, seconds)))
            }
        }
    }

    private func writeManifest(
        deck: String,
        dir: URL,
        hasCam: Bool,
        hasMic: Bool,
        sourceKind: String,
        target: CaptureTarget
    ) throws {
        var tracks: [String: String] = [
            "stage": "stage.mov",
            "events": "events.jsonl",
        ]
        if hasCam { tracks["cam"] = "cam.mov" }
        if hasMic { tracks["mic"] = "mic.wav" }

        var manifest: [String: Any] = [
            "id": takeId as Any,
            "deck": deck,
            "source_kind": sourceKind,
            "recorded_at": ISO8601DateFormatter().string(from: Date()),
            "start_epoch": startEpoch as Any,
            "resolution": [1920, 1080],
            "tracks": tracks,
            "capture_target_id": target.targetID,
            "capture_target_label": target.label,
        ]
        if let crop = target.cropRect {
            manifest["area_rect"] = [crop.origin.x, crop.origin.y, crop.width, crop.height]
        }

        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appending(path: "manifest.json"))
    }

    private func writeTakeWork(
        id: String,
        deck: String,
        dir: URL,
        sourceKind: String,
        target: CaptureTarget
    ) throws {
        let when = ISO8601DateFormatter().string(from: Date())
        let body = """
        # Take \(id)

        take do
          id: "\(id)"
          deck: "\(deck)"
          source: "\(sourceKind) · \(target.label)"
          recorded_at: "\(when)"
        end

        ## Tracks

        - `cam.mov` — full raw webcam (when enabled)
        - `stage.mov` — stage/source capture (Aperture / ScreenCaptureKit)
        - `events.jsonl` — cursor · click · slide · zoom on one clock
        - `manifest.json` — machine-readable manifest
        - `edit.json` — editor project (trim · zoom · cam PIP · export)
        """
        try body.write(to: dir.appending(path: "take.work"), atomically: true, encoding: .utf8)
    }

    private func writeDefaultEdit(dir: URL) throws {
        let edit: [String: Any] = [
            "trim": ["in": 0, "out": NSNull()],
            "speed": 1,
            "zoom": ["enabled": true, "scale": 1.5, "duration": 1.0],
            "cam": ["pip": true, "x": 0.88, "y": 0.08, "size": 0.14, "mirror": true],
            "style": ["padding": 28, "radius": 16, "background": "#111111", "shadow": true],
            "aspect": "16:9",
            "captions": ["enabled": false],
        ]
        let data = try JSONSerialization.data(withJSONObject: edit, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appending(path: "edit.json"))
    }

    private static func makeTakeId() -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        return "take-\(f.string(from: Date()))"
    }
}

/// First-result-wins gate for TakeRecorder.race — resumes the continuation
/// exactly once no matter which side (work or timeout) finishes first.
private final class RaceState<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    private let continuation: CheckedContinuation<T, Error>

    init(_ continuation: CheckedContinuation<T, Error>) {
        self.continuation = continuation
    }

    func finish(_ result: Result<T, Error>) {
        lock.lock()
        let first = !done
        done = true
        lock.unlock()
        if first { continuation.resume(with: result) }
    }
}

enum TakeError: Error, CustomStringConvertible {
    case alreadyRecording
    case noCaptureTarget(String)
    case targetNotFound(String)
    case unsupportedSource(String)
    case timedOut(String, Double)

    var description: String {
        switch self {
        case .alreadyRecording: "Already recording a take"
        case .noCaptureTarget(let msg): msg
        case .targetNotFound(let id): "Capture target not found: \(id)"
        case .unsupportedSource(let kind): "Unsupported capture source: \(kind)"
        case .timedOut(let label, let seconds): "\(label) timed out after \(Int(seconds))s — screen capture may need an app restart"
        }
    }
}
