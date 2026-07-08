import AppKit

/// Reliable window drag for borderless panels (mouseDragged often never reaches the view).
/// Dockable panel windows report their drag to the DockController so drop zones
/// light up and a release over another panel's edge docks instead of just moving.
@MainActor
enum WindowDrag {
    private static var monitor: Any?

    static func begin(in view: NSView, onDoubleClick: (() -> Void)? = nil) {
        guard let win = view.window else { return }
        begin(window: win, onDoubleClick: onDoubleClick)
    }

    static func begin(window win: NSWindow, onDoubleClick: (() -> Void)? = nil) {
        end()
        let origin = win.frame.origin
        let start = NSEvent.mouseLocation
        var seenDrag = false

        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { event in
            switch event.type {
            case .leftMouseDragged:
                seenDrag = true
                let now = NSEvent.mouseLocation
                win.setFrameOrigin(NSPoint(x: origin.x + (now.x - start.x), y: origin.y + (now.y - start.y)))
                DockController.shared.dragMoved(window: win, mouse: now)
                return nil
            case .leftMouseUp:
                if !seenDrag, event.clickCount == 2 { onDoubleClick?() }
                if seenDrag {
                    _ = DockController.shared.dragEnded(window: win, mouse: NSEvent.mouseLocation)
                }
                end()
                return event
            default:
                return event
            }
        }
    }

    static func end() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}
