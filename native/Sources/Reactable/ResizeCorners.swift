import AppKit

// Subtle L-shaped corner marks on resizable chrome — a visual grab target so
// it's obvious where to drag. Non-interactive (resize itself comes from the
// window's .resizable edges); draws above WKWebView content.
final class ResizeCornersView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

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
        let inset: CGFloat = 8
        let leg: CGFloat = 12
        let r: CGFloat = 4  // rounded bend
        NSColor(white: 1, alpha: 0.20).setStroke()
        let b = bounds.insetBy(dx: inset, dy: inset)
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
