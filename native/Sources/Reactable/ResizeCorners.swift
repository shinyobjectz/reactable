import AppKit

// Corner resize affordance on resizable chrome: L-shaped marks that fade in
// on hover, drawn ON the actual grab zones — press a corner and drag to
// resize (WindowResize). The rest of the view stays click-through.
final class ResizeCornersView: NSView {
    /// Side of the square corner grab zone.
    private static let zone: CGFloat = 22

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        return corner(at: local) == nil ? nil : self
    }

    private func corner(at p: NSPoint) -> WindowResize.Corner? {
        let z = Self.zone
        guard bounds.contains(p) else { return nil }
        let left = p.x <= z, right = p.x >= bounds.maxX - z
        let bottom = p.y <= z, top = p.y >= bounds.maxY - z
        switch (left, right, bottom, top) {
        case (true, _, true, _): return isFlipped ? .topLeft : .bottomLeft
        case (true, _, _, true): return isFlipped ? .bottomLeft : .topLeft
        case (_, true, true, _): return isFlipped ? .topRight : .bottomRight
        case (_, true, _, true): return isFlipped ? .bottomRight : .topRight
        default: return nil
        }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        guard let corner = corner(at: p), let win = window else {
            super.mouseDown(with: event)
            return
        }
        WindowResize.begin(window: win, corner: corner)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        alphaValue = 0
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        ))
    }

    override func mouseEntered(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.15
            animator().alphaValue = 1
        }
    }

    override func mouseExited(with event: NSEvent) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.25
            animator().alphaValue = 0
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        // Marks sit just inside the window edge — right where the grab zone is.
        let inset: CGFloat = 4
        let leg: CGFloat = 12
        let r: CGFloat = 4  // rounded bend
        let b = bounds.insetBy(dx: inset, dy: inset)
        // Bail while the view is still degenerate (first display pass, mid-animation):
        // an inverted/tiny rect makes the corner arc collapse, clearing the path's
        // current point so the next lineTo throws. Need room for both legs per side.
        guard b.width > leg * 2, b.height > leg * 2,
              b.width.isFinite, b.height.isFinite else { return }
        NSColor(white: 1, alpha: 0.20).setStroke()
        let p = NSBezierPath()
        p.lineWidth = 2
        p.lineCapStyle = .round

        func corner(_ cx: CGFloat, _ cy: CGFloat, _ sx: CGFloat, _ sy: CGFloat) {
            // L with an arc at the bend; (sx, sy) point inward.
            p.move(to: NSPoint(x: cx, y: cy + sy * leg))
            p.line(to: NSPoint(x: cx, y: cy + sy * r))
            p.appendArc(
                from: NSPoint(x: cx, y: cy),
                to: NSPoint(x: cx + sx * r, y: cy),
                radius: r
            )
            p.line(to: NSPoint(x: cx + sx * leg, y: cy))
        }
        corner(b.minX, b.minY, 1, 1)
        corner(b.maxX, b.minY, -1, 1)
        corner(b.minX, b.maxY, 1, -1)
        corner(b.maxX, b.maxY, -1, -1)
        p.stroke()
    }

    static func attach(to view: NSView) {
        let v = ResizeCornersView()
        v.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(v)
        NSLayoutConstraint.activate([
            v.topAnchor.constraint(equalTo: view.topAnchor),
            v.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            v.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            v.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }
}
