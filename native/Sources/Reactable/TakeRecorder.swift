import AppKit
import Aperture
import AVFoundation
import Foundation

@MainActor
final class TakeRecorder {
    private let projectRoot: URL
    private nonisolated(unsafe) let stageRecorder = Aperture.Recorder()
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
        let micID = micOn ? AVCaptureDevice.default(for: .audio)?.uniqueID : nil
        try await startStageCapture(
            kind: target.kind,
            destination: stageURL,
            targetID: target.targetID,
            cropRect: target.cropRect,
            systemAudioOn: systemAudioOn,
            micID: micID
        )
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

        try writeManifest(deck: deck, dir: dir, hasCam: camOn, sourceKind: sourceKind, target: target)
        try writeTakeWork(id: id, deck: deck, dir: dir, sourceKind: sourceKind, target: target)
        try writeDefaultEdit(dir: dir)

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

        if stageRecorder.isPaused {
            try? await stageRecorder.resume()
        }
        try? await stageRecorder.stop()
        try? await cam?.stopRecording()

        eventLog?.close()
        eventLog = nil
        takeDir = nil
        takeId = nil
        startEpoch = nil
        captureTarget = nil

        fputs("reactable: take saved → \(dir.path())\n", stderr)
        return dir
    }

    func stamp(_ type: String, payload: [String: Any] = [:]) {
        guard isActive else { return }
        eventLog?.stamp(type, payload: payload)
    }

    nonisolated private func startStageCapture(
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
        try await stageRecorder.start(target: apertureTarget, options: options)
    }

    private func writeManifest(
        deck: String,
        dir: URL,
        hasCam: Bool,
        sourceKind: String,
        target: CaptureTarget
    ) throws {
        var tracks: [String: String] = [
            "stage": "stage.mov",
            "events": "events.jsonl",
        ]
        if hasCam { tracks["cam"] = "cam.mov" }

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

enum TakeError: Error, CustomStringConvertible {
    case alreadyRecording
    case noCaptureTarget(String)
    case targetNotFound(String)
    case unsupportedSource(String)

    var description: String {
        switch self {
        case .alreadyRecording: "Already recording a take"
        case .noCaptureTarget(let msg): msg
        case .targetNotFound(let id): "Capture target not found: \(id)"
        case .unsupportedSource(let kind): "Unsupported capture source: \(kind)"
        }
    }
}
