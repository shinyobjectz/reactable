import AppKit

/// Corner resize for borderless panels — same event-monitor pattern as
/// WindowDrag. ResizeCornersView hands us the pressed corner; we track the
/// pointer and resize the window, clamped to its minSize.
@MainActor
enum WindowResize {
    enum Corner { case topLeft, topRight, bottomLeft, bottomRight }

    private static var monitor: Any?

    static func begin(window win: NSWindow, corner: Corner) {
        end()
        let startFrame = win.frame
        let start = NSEvent.mouseLocation
        let minSize = win.minSize

        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { event in
            switch event.type {
            case .leftMouseDragged:
                let now = NSEvent.mouseLocation
                let dx = now.x - start.x
                let dy = now.y - start.y
                var f = startFrame
                switch corner {
                case .topRight:
                    f.size.width += dx
                    f.size.height += dy
                case .topLeft:
                    f.origin.x += dx
                    f.size.width -= dx
                    f.size.height += dy
                case .bottomRight:
                    f.size.width += dx
                    f.origin.y += dy
                    f.size.height -= dy
                case .bottomLeft:
                    f.origin.x += dx
                    f.size.width -= dx
                    f.origin.y += dy
                    f.size.height -= dy
                }
                // Clamp to minSize, keeping the anchored corner fixed.
                if f.width < minSize.width {
                    if corner == .topLeft || corner == .bottomLeft {
                        f.origin.x = startFrame.maxX - minSize.width
                    }
                    f.size.width = minSize.width
                }
                if f.height < minSize.height {
                    if corner == .bottomLeft || corner == .bottomRight {
                        f.origin.y = startFrame.maxY - minSize.height
                    }
                    f.size.height = minSize.height
                }
                win.setFrame(f, display: true)
                return nil
            case .leftMouseUp:
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
