import Foundation
import CoreGraphics

@MainActor
protocol ReactableBridgeDelegate: AnyObject {
    func bridgeRecordStart(countdown: Int)
    func bridgeRecordPause()
    func bridgeRecordStop()
    func bridgeSlideNext()
    func bridgeSlidePrev()
    func bridgeCaptureSetTarget(kind: String, id: String?)
    func bridgeToggleStage()
    func bridgeSelectStage()
    func bridgeSelectArea()
    func bridgeOpenAgent()
    func bridgeCreateProject(title: String)
    func bridgeSelectProject(id: String)
    func bridgeSelectDeck(slug: String)
    func bridgeRevealProjectsFolder()
    func bridgeCamToggle(on: Bool)
    func bridgeCamMirror(_ on: Bool)
    func bridgeCamMove(x: Double, y: Double)
    func bridgeCamResize(size: Double)
    func bridgeMicToggle(on: Bool)
    func bridgeSystemAudioToggle(on: Bool)
    func bridgeSettingSet(key: String, value: Bool)
    func bridgeRequestDevices(includeIOS: Bool)
    func bridgeCopyAgentPrompt()
    func bridgeBarClose()
}

@MainActor
final class AppState {
    var recording = false
    var paused = false
    var elapsed: Int = 0

    var sourceKind = "stage"
    var captureTargetId: String?
    var areaRect: CGRect?
    var stageVisible = false
    var agentVisible = false
    var captureLabel = "Stage"
    var projectId = "reactable"
    var projectName = "reactable"
    var deckSlug = "showcase"
    var deckTitle = "showcase"
    var projects: [[String: Any]] = []
    var decks: [[String: Any]] = []
    var camOn = false
    var micOn = false
    var systemAudioOn = true
    var camMirror = true
    var camSize: Double = 160

    var hideDockWhileRecording = true
    var hideDesktopIcons = false
    var highlightArea = false
    var countdownSeconds = 3
    var speakerNotes = false
    var quickShareAfter = false

    func toJSON() -> [String: Any] {
        [
            "recording": recording,
            "paused": paused,
            "elapsed": elapsed,
            "sourceKind": sourceKind,
            "captureTargetId": captureTargetId as Any,
            "stageVisible": stageVisible,
            "agentVisible": agentVisible,
            "captureLabel": captureLabel,
            "projectId": projectId,
            "projectName": projectName,
            "deckSlug": deckSlug,
            "deckTitle": deckTitle,
            "projects": projects,
            "decks": decks,
            "camOn": camOn,
            "micOn": micOn,
            "systemAudioOn": systemAudioOn,
            "camMirror": camMirror,
            "camSize": camSize,
            "settings": [
                "hideDockWhileRecording": hideDockWhileRecording,
                "hideDesktopIcons": hideDesktopIcons,
                "highlightArea": highlightArea,
                "countdownSeconds": countdownSeconds,
                "speakerNotes": speakerNotes,
                "quickShareAfter": quickShareAfter,
            ],
        ]
    }
}

enum BridgeMessage {
    static func parse(_ body: Any) -> (action: String, payload: [String: Any])? {
        guard let dict = body as? [String: Any],
              let action = dict["action"] as? String else { return nil }
        let payload = dict["payload"] as? [String: Any] ?? [:]
        return (action, payload)
    }
}
