import AppKit

@MainActor
final class AreaPickerController: NSObject {
    private var panel: NSPanel?
    private var origin: NSPoint = .zero
    private var start: NSPoint?
    var onPick: ((CGRect) -> Void)?

    func begin() {
        guard let screen = NSScreen.main else { return }
        let f = screen.frame
        let p = NSPanel(
            contentRect: f,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        p.level = .screenSaver
        p.backgroundColor = NSColor.black.withAlphaComponent(0.25)
        p.isOpaque = false
        p.ignoresMouseEvents = false
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let view = AreaPickView(frame: f)
        view.onComplete = { [weak self] rect in
            self?.onPick?(rect)
            self?.end()
        }
        view.onCancel = { [weak self] in self?.end() }
        p.contentView = view
        panel = p
        p.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
    }

    func end() {
        panel?.orderOut(nil)
        panel = nil
    }
}

@MainActor
private final class AreaPickView: NSView {
    var onComplete: ((CGRect) -> Void)?
    var onCancel: (() -> Void)?
    private var start: NSPoint?
    private var current: NSPoint?

    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil)
        current = start
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard let s = start, let c = current else { return }
        let rect = CGRect(
            x: min(s.x, c.x),
            y: min(s.y, c.y),
            width: abs(c.x - s.x),
            height: abs(c.y - s.y)
        )
        if rect.width > 40, rect.height > 40 {
            onComplete?(rect)
        } else {
            onCancel?()
        }
        start = nil
        current = nil
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onCancel?() }
    }

    override var acceptsFirstResponder: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let s = start, let c = current else { return }
        let rect = NSRect(
            x: min(s.x, c.x), y: min(s.y, c.y),
            width: abs(c.x - s.x), height: abs(c.y - s.y)
        )
        NSColor.systemBlue.withAlphaComponent(0.2).setFill()
        rect.fill()
        NSColor.systemBlue.setStroke()
        let path = NSBezierPath(rect: rect)
        path.lineWidth = 2
        path.stroke()
    }
}
