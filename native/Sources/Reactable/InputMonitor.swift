import AppKit
import CoreGraphics

/// Listens for global cursor + click events during recording (requires Accessibility).
final class InputMonitor {
    private final class CallbackBox: @unchecked Sendable {
        var handler: ((String, [String: Any]) -> Void)?
    }

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private let callbackBox = CallbackBox()
    private nonisolated(unsafe) var lastCursorAt: CFAbsoluteTime = 0
    private let cursorInterval: CFAbsoluteTime = 0.05

    func start(onStamp: @escaping (String, [String: Any]) -> Void) {
        stop()
        callbackBox.handler = onStamp

        let mask: CGEventMask =
            (1 << CGEventType.mouseMoved.rawValue)
            | (1 << CGEventType.leftMouseDragged.rawValue)
            | (1 << CGEventType.rightMouseDragged.rawValue)
            | (1 << CGEventType.leftMouseDown.rawValue)
            | (1 << CGEventType.rightMouseDown.rawValue)

        let ref = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: InputMonitor.callback,
            userInfo: ref
        ) else {
            fputs("reactable: cursor/click capture unavailable — grant Accessibility in System Settings\n", stderr)
            return
        }

        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        fputs("reactable: input monitor started\n", stderr)
    }

    func stop() {
        if let eventTap {
            CGEvent.tapEnable(tap: eventTap, enable: false)
        }
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        eventTap = nil
        runLoopSource = nil
        callbackBox.handler = nil
    }

    private static let callback: CGEventTapCallBack = { _, type, event, userInfo in
        guard let userInfo else { return Unmanaged.passUnretained(event) }
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            let monitor = Unmanaged<InputMonitor>.fromOpaque(userInfo).takeUnretainedValue()
            if let tap = monitor.eventTap {
                CGEvent.tapEnable(tap: tap, enable: true)
            }
            return Unmanaged.passUnretained(event)
        }

        let monitor = Unmanaged<InputMonitor>.fromOpaque(userInfo).takeUnretainedValue()
        monitor.handle(type: type, event: event)
        return Unmanaged.passUnretained(event)
    }

    private nonisolated func handle(type: CGEventType, event: CGEvent) {
        let loc = event.location
        let box = callbackBox
        switch type {
        case .mouseMoved, .leftMouseDragged, .rightMouseDragged:
            let now = CFAbsoluteTimeGetCurrent()
            guard now - lastCursorAt >= cursorInterval else { return }
            lastCursorAt = now
            let payload: [String: Any] = ["x": loc.x, "y": loc.y]
            Task { @MainActor in
                box.handler?("cursor", payload)
            }
        case .leftMouseDown:
            Task { @MainActor in
                box.handler?("click", ["x": loc.x, "y": loc.y, "button": "left"])
            }
        case .rightMouseDown:
            Task { @MainActor in
                box.handler?("click", ["x": loc.x, "y": loc.y, "button": "right"])
            }
        default:
            break
        }
    }
}
