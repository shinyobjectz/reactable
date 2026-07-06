import AppKit
import Aperture
import CoreGraphics
import Foundation

struct CaptureTarget {
    let kind: String
    let apertureTarget: Aperture.Target
    let targetID: String
    let label: String
    let cropRect: CGRect?

    @MainActor
    static func resolve(
        sourceKind: String,
        captureTargetId: String?,
        areaRect: CGRect?,
        stageWindow: NSWindow?
    ) async throws -> CaptureTarget {
        switch sourceKind {
        case "stage":
            guard let stageWindow, stageWindow.isVisible else {
                throw TakeError.noCaptureTarget("Stage window is not visible")
            }
            let id = String(stageWindow.windowNumber)
            return CaptureTarget(kind: "stage", apertureTarget: .window, targetID: id, label: "Reactable Stage", cropRect: nil)

        case "window":
            guard let id = captureTargetId, !id.isEmpty else {
                throw TakeError.noCaptureTarget("Pick a window to record")
            }
            let windows = try await Aperture.Devices.window(excludeDesktopWindows: true, onScreenWindowsOnly: true)
            guard let match = windows.first(where: { $0.id == id }) else {
                throw TakeError.targetNotFound(id)
            }
            let label = match.title ?? match.appName ?? id
            return CaptureTarget(kind: "window", apertureTarget: .window, targetID: id, label: label, cropRect: nil)

        case "display":
            let screens = try await Aperture.Devices.screen()
            let id = captureTargetId ?? screens.first?.id
            guard let id, !id.isEmpty else {
                throw TakeError.noCaptureTarget("No display available")
            }
            guard let match = screens.first(where: { $0.id == id }) else {
                throw TakeError.targetNotFound(id)
            }
            return CaptureTarget(kind: "display", apertureTarget: .screen, targetID: id, label: match.name, cropRect: nil)

        case "area":
            let screens = try await Aperture.Devices.screen()
            let id = captureTargetId ?? screens.first?.id
            guard let id, let rect = areaRect else {
                throw TakeError.noCaptureTarget("Select an area to record")
            }
            let label = screens.first(where: { $0.id == id })?.name ?? "Area"
            return CaptureTarget(kind: "area", apertureTarget: .screen, targetID: id, label: "\(label) (area)", cropRect: rect)

        case "device":
            guard let id = captureTargetId, !id.isEmpty else {
                throw TakeError.noCaptureTarget("Pick an external device")
            }
            let devices = Aperture.Devices.iOS()
            guard let match = devices.first(where: { $0.id == id }) else {
                throw TakeError.targetNotFound(id)
            }
            return CaptureTarget(kind: "device", apertureTarget: .externalDevice, targetID: id, label: match.name, cropRect: nil)

        default:
            throw TakeError.unsupportedSource(sourceKind)
        }
    }
}
