import AppKit

// Recording outline — when a lineup scene is an external window or a full
// display, the stage hides and this non-interactive stroke marks what the
// recorder is grabbing (Screen-Studio-style framing cue).
@MainActor
final class CaptureOutline {
    private var window: NSWindow?
    private var tracker: Timer?
    private var trackedWindowID: Int?

    func show(windowID: Int) {
        trackedWindowID = windowID
        guard let frame = Self.windowFrame(id: windowID) else { return }
        show(frame: frame)
        // Windows move — follow at 2Hz while the outline is up.
        tracker?.invalidate()
        tracker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let id = self.trackedWindowID else { return }
                if let f = Self.windowFrame(id: id) {
                    self.window?.setFrame(f.insetBy(dx: -4, dy: -4), display: true)
                } else {
                    self.hide()  // window closed
                }
            }
        }
    }

    func show(frame: NSRect) {
        let win = window ?? Self.makeWindow()
        window = win
        win.setFrame(frame.insetBy(dx: -4, dy: -4), display: true)
        win.orderFrontRegardless()
    }

    func hide() {
        tracker?.invalidate()
        tracker = nil
        trackedWindowID = nil
        window?.orderOut(nil)
    }

    private static func makeWindow() -> NSWindow {
        let win = NSWindow(
            contentRect: .zero,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        win.isOpaque = false
        win.backgroundColor = .clear
        win.hasShadow = false
        win.ignoresMouseEvents = true
        win.level = .screenSaver
        win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        let view = NSView()
        view.wantsLayer = true
        view.layer?.borderColor = NSColor(red: 0.93, green: 0.26, blue: 0.21, alpha: 0.95).cgColor
        view.layer?.borderWidth = 3
        view.layer?.cornerRadius = 10
        win.contentView = view
        return win
    }

    /// AppKit frame (bottom-left origin) for a CGWindow id.
    static func windowFrame(id: Int) -> NSRect? {
        guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(id)) as? [[String: Any]],
              let info = list.first,
              let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
        else { return nil }
        let primaryH = NSScreen.screens.first?.frame.height ?? 0
        let x = bounds["X"] ?? 0
        let y = bounds["Y"] ?? 0
        let w = bounds["Width"] ?? 0
        let h = bounds["Height"] ?? 0
        return NSRect(x: x, y: primaryH - y - h, width: w, height: h)
    }

    /// Owning pid for a CGWindow id (to raise the app).
    static func windowPID(id: Int) -> pid_t? {
        guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(id)) as? [[String: Any]],
              let info = list.first,
              let pid = info[kCGWindowOwnerPID as String] as? Int
        else { return nil }
        return pid_t(pid)
    }
}
