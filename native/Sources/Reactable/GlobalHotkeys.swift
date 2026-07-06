import AppKit

/// Global hotkeys when Accessibility is granted (⌘R record, ⌘O stage, ⌘] next).
final class GlobalHotkeys {
    private var monitor: Any?

    func start(handler: @escaping (String) -> Void) {
        stop()
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { ev in
            let flags = ev.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if flags == .command {
                switch ev.charactersIgnoringModifiers?.lowercased() {
                case "r": handler("record.toggle"); return
                case "o": handler("stage.open"); return
                case "b": handler("bar.show"); return
                default: break
                }
            }
            if flags.isEmpty {
                switch ev.keyCode {
                case 124: handler("slide.next")
                case 123: handler("slide.prev")
                default: break
                }
            }
        }
        if monitor != nil {
            fputs("reactable: global hotkeys active\n", stderr)
        } else {
            fputs("reactable: global hotkeys need Accessibility — using local shortcuts when focused\n", stderr)
        }
    }

    func stop() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
        monitor = nil
    }
}
