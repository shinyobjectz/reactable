import AppKit

/// Reliable window drag for borderless panels (mouseDragged often never reaches the view).
@MainActor
enum WindowDrag {
    private static var monitor: Any?

    static func begin(in view: NSView, onDoubleClick: (() -> Void)? = nil) {
        guard let win = view.window else { return }
        end()
        let origin = win.frame.origin
        let start = NSEvent.mouseLocation
        var seenDrag = false

        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { event in
            guard let win = view.window else { return event }
            switch event.type {
            case .leftMouseDragged:
                seenDrag = true
                let now = NSEvent.mouseLocation
                win.setFrameOrigin(NSPoint(x: origin.x + (now.x - start.x), y: origin.y + (now.y - start.y)))
                return nil
            case .leftMouseUp:
                if !seenDrag, event.clickCount == 2 { onDoubleClick?() }
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
