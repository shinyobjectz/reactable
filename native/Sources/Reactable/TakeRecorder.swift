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
    // Prewarmed for the NEXT lineup scene so a mid-take switch is instant.
    private nonisolated(unsafe) var nextRecorder: Aperture.Recorder?
    private var segmentIndex = 0
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
        stageContentRect: CGRect? = nil,
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

        // Keep a prewarmed recorder (its SCK stream is already flowing —
        // start() just attaches the writer); replace anything else.
        if !stageRecorder.isPrewarmed {
            stageRecorder = Aperture.Recorder()
        }
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

        // Window geometry for mapping global input coords (CGEvent points,
        // top-left origin) onto stage.mov pixels in post: window-relative
        // point × backing scale. yTop converts from AppKit's bottom-left.
        // With a content crop, the capture origin shifts to the crop's corner.
        var windowInfo: [String: Any]?
        if let stageWindow {
            let f = stageWindow.frame
            let primaryH = NSScreen.screens.first?.frame.height ?? f.height
            let crop = stageContentRect ?? CGRect(x: 0, y: 0, width: f.width, height: f.height)
            windowInfo = [
                "x": f.origin.x + crop.origin.x,
                "yTop": primaryH - (f.origin.y + f.height) + crop.origin.y,
                "w": crop.width,
                "h": crop.height,
                "scale": stageWindow.backingScaleFactor,
            ]
        }

        log.stamp("record.start", payload: [
            "deck": deck,
            "sourceKind": sourceKind,
            "targetId": target.targetID,
            "targetLabel": target.label,
        ])

        segmentIndex = 0
        let stageURL = dir.appending(path: "stage.mov")
        // Mic goes to mic.wav via MicMeter (AppController arms it after start) —
        // SCStream.captureMicrophone silently delivers nothing on this setup,
        // so passing a device here produced takes with no voice track.
        let micID: String? = nil
        do {
            nonisolated(unsafe) let recorder = stageRecorder
            let kind = target.kind
            let targetID = target.targetID
            // For stage captures the crop is the deck content region — the
            // drag strip and frame chrome stay out of stage.mov.
            let cropRect = target.kind == "stage" ? stageContentRect : target.cropRect
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
            var stagePayload: [String: Any] = [
                "sourceKind": target.kind,
                "targetId": target.targetID,
                "label": target.label,
            ]
            if let windowInfo { stagePayload["window"] = windowInfo }
            log.stamp("capture.stage", payload: stagePayload)

            if camOn, let cam {
                let camURL = dir.appending(path: "cam.mov")
                try cam.startRecording(to: camURL) { [weak self] absolute in
                    Task { @MainActor in
                        self?.stampAbsolute("capture.cam.start", at: absolute)
                    }
                }
                log.stamp("capture.cam", payload: cam.frameJSON())
            }

            try writeManifest(deck: deck, dir: dir, hasCam: camOn, hasMic: micOn, sourceKind: sourceKind, target: target, windowInfo: windowInfo)
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
        if let pending = nextRecorder {
            nonisolated(unsafe) let p = pending
            nextRecorder = nil
            await p.cancelPrewarm()
        }

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

    /// Stamp an event at an externally captured absolute time (first-frame /
    /// first-buffer callbacks) so track-sync offsets in events.jsonl are the
    /// real media start times, not API-return times.
    func stampAbsolute(_ type: String, at absolute: CFAbsoluteTime, payload: [String: Any] = [:]) {
        guard isActive, let eventLog else { return }
        var p = payload
        p["t"] = max(0, absolute - eventLog.startTime)
        eventLog.stamp(type, payload: p)
    }

    private func segmentFile(_ index: Int) -> String {
        index == 0 ? "stage.mov" : "stage-\(index + 1).mov"
    }

    /// Mid-take scene handoff: finalize the current stage segment and start
    /// capturing the new target into stage-<n>.mov. The lineup prewarms the
    /// next scene (prewarmNext), so the visual gap is one stream attach.
    func switchScene(
        sourceKind: String,
        captureTargetId: String?,
        areaRect: CGRect?,
        stageWindow: NSWindow?,
        stageContentRect: CGRect? = nil,
        systemAudioOn: Bool
    ) async {
        guard let dir = takeDir else { return }
        guard let target = try? await CaptureTarget.resolve(
            sourceKind: sourceKind,
            captureTargetId: captureTargetId,
            areaRect: areaRect,
            stageWindow: stageWindow
        ) else {
            fputs("reactable: scene switch — target resolve failed\n", stderr)
            return
        }

        // Finalize the running segment (bounded — a wedged stop can't stall the take).
        nonisolated(unsafe) let old = stageRecorder
        do {
            try await Self.race(seconds: 10, label: "segment stop") { try await old.stop() }
        } catch {
            fputs("reactable: segment stop failed (\(error))\n", stderr)
        }

        segmentIndex += 1
        let file = segmentFile(segmentIndex)
        // Use the recorder prewarmed for this scene when available.
        if let warmed = nextRecorder, warmed.isPrewarmed {
            stageRecorder = warmed
            nextRecorder = nil
        } else {
            stageRecorder = Aperture.Recorder()
        }
        nonisolated(unsafe) let recorder = stageRecorder
        let kind = target.kind
        let targetID = target.targetID
        let cropRect = target.kind == "stage" ? stageContentRect : target.cropRect
        let dest = dir.appending(path: file)
        do {
            try await Self.race(seconds: 15, label: "segment start") {
                try await Self.startStageCapture(
                    recorder: recorder,
                    kind: kind,
                    destination: dest,
                    targetID: targetID,
                    cropRect: cropRect,
                    systemAudioOn: systemAudioOn,
                    micID: nil
                )
            }
            var payload: [String: Any] = [
                "sourceKind": target.kind,
                "targetId": target.targetID,
                "label": target.label,
                "file": file,
            ]
            if let stageWindow, target.kind == "stage" {
                let f = stageWindow.frame
                let primaryH = NSScreen.screens.first?.frame.height ?? f.height
                let crop = stageContentRect ?? CGRect(x: 0, y: 0, width: f.width, height: f.height)
                payload["window"] = [
                    "x": f.origin.x + crop.origin.x,
                    "yTop": primaryH - (f.origin.y + f.height) + crop.origin.y,
                    "w": crop.width, "h": crop.height,
                    "scale": stageWindow.backingScaleFactor,
                ]
            }
            eventLog?.stamp("capture.stage", payload: payload)
            fputs("reactable: segment \(segmentIndex + 1) → \(file) (\(target.kind) \(target.label))\n", stderr)
        } catch {
            fputs("reactable: segment start failed (\(error))\n", stderr)
        }
    }

    /// Prewarm the SCK stream for the UPCOMING lineup scene while the current
    /// one records — the switch then only attaches a writer.
    func prewarmNext(
        sourceKind: String,
        captureTargetId: String?,
        areaRect: CGRect?,
        stageWindow: NSWindow?,
        stageContentRect: CGRect? = nil,
        systemAudioOn: Bool
    ) async {
        guard let target = try? await CaptureTarget.resolve(
            sourceKind: sourceKind,
            captureTargetId: captureTargetId,
            areaRect: areaRect,
            stageWindow: stageWindow
        ) else { return }
        let apertureTarget: Aperture.Target = switch target.kind {
        case "device": .externalDevice
        case "display", "area": .screen
        default: .window
        }
        let options = Aperture.RecordingOptions(
            destination: FileManager.default.temporaryDirectory
                .appending(path: "reactable-prewarm-next.mov"),
            targetID: target.targetID,
            framesPerSecond: 30,
            cropRect: target.kind == "stage" ? stageContentRect : target.cropRect,
            showCursor: false,
            highlightClicks: false,
            videoCodec: .h264,
            recordSystemAudio: systemAudioOn,
            microphoneDeviceID: nil
        )
        if let old = nextRecorder { nonisolated(unsafe) let o = old; await o.cancelPrewarm() }
        let recorder = Aperture.Recorder()
        nextRecorder = recorder
        nonisolated(unsafe) let r = recorder
        do {
            try await Self.race(seconds: 15, label: "next-scene prewarm") {
                try await r.prewarm(target: apertureTarget, options: options)
            }
            fputs("reactable: next scene prewarmed (\(target.kind) \(target.label))\n", stderr)
        } catch {
            fputs("reactable: next-scene prewarm failed (\(error))\n", stderr)
            nextRecorder = nil
        }
    }

    /// Spin up the SCK stream for the expected capture target ahead of the
    /// record press — frames flow and drop until start() attaches the writer,
    /// cutting press-to-first-frame from ~1s to near-instant.
    func prewarm(
        sourceKind: String,
        captureTargetId: String?,
        areaRect: CGRect?,
        stageWindow: NSWindow?,
        stageContentRect: CGRect? = nil,
        systemAudioOn: Bool
    ) async {
        guard takeDir == nil else { return }
        guard let target = try? await CaptureTarget.resolve(
            sourceKind: sourceKind,
            captureTargetId: captureTargetId,
            areaRect: areaRect,
            stageWindow: stageWindow
        ) else { return }
        let apertureTarget: Aperture.Target = switch target.kind {
        case "device": .externalDevice
        case "display", "area": .screen
        default: .window
        }
        let options = Aperture.RecordingOptions(
            destination: FileManager.default.temporaryDirectory
                .appending(path: "reactable-prewarm.mov"),
            targetID: target.targetID,
            framesPerSecond: 30,
            cropRect: target.kind == "stage" ? stageContentRect : target.cropRect,
            showCursor: false,
            highlightClicks: false,
            videoCodec: .h264,
            recordSystemAudio: systemAudioOn,
            microphoneDeviceID: nil
        )
        nonisolated(unsafe) let recorder = stageRecorder
        do {
            try await Self.race(seconds: 15, label: "capture prewarm") {
                try await recorder.prewarm(target: apertureTarget, options: options)
            }
            fputs("reactable: capture prewarmed (\(target.kind) \(target.targetID))\n", stderr)
        } catch {
            fputs("reactable: capture prewarm failed (\(error)) — will cold-start\n", stderr)
        }
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
            // Synthetic cursor is drawn in post from the events track
            // (Screen-Studio style) — the OS cursor stays out of the pixels.
            showCursor: false,
            // SCK's showMouseClicks draws its ring at misplaced coordinates on
            // window captures (global-vs-window space); click feedback comes
            // from events.jsonl in post instead.
            highlightClicks: false,
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
        target: CaptureTarget,
        windowInfo: [String: Any]? = nil
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
        if let windowInfo { manifest["capture_window"] = windowInfo }

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
            "cam": ["pip": true, "x": 0.90, "y": 0.86, "size": 0.22, "shape": "squircle", "mirror": true],
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
