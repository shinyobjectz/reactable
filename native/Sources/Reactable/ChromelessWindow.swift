import AppKit

// Shared chrome for Reactable's floating panels (Stage, Agent, and future
// windows): a borderless window with a draggable header strip + a rounded
// content frame — no titlebar / traffic lights. One look, one drag behavior.

enum Chrome {
    static let dragStripHeight: CGFloat = 28
    static let gapBelowDrag: CGFloat = 8
    static let frameMargin: CGFloat = 12
    static let cornerRadius: CGFloat = 12
    static let showAnimDuration: TimeInterval = 0.18

    /// Shell size that wraps `content` with the header strip + rounded frame margins.
    static func shellSize(for content: NSSize) -> NSSize {
        NSSize(
            width: content.width + frameMargin * 2,
            height: dragStripHeight + gapBelowDrag + content.height + frameMargin
        )
    }
}

/// Draggable header strip with a centered grip. Optionally hosts tab views on
/// its leading edge (Phase 3). mouseDown starts a window drag.
@MainActor
final class DragStripView: NSView {
    var onDoubleClick: (() -> Void)?

    override var isFlipped: Bool { true }

    override func mouseDown(with event: NSEvent) {
        WindowDrag.begin(in: self, onDoubleClick: onDoubleClick)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 0.12, alpha: 0.92).setFill()
        dirtyRect.fill()
        let grip = NSBezierPath(
            roundedRect: NSRect(x: bounds.midX - 18, y: bounds.midY - 2, width: 36, height: 4),
            xRadius: 2, yRadius: 2
        )
        NSColor(white: 1, alpha: 0.22).setFill()
        grip.fill()
    }
}

/// A rounded, bordered content frame that clips its subviews (the stage/agent web view).
@MainActor
final class ContentFrameView: NSView {
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = Chrome.cornerRadius
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor(white: 0.035, alpha: 1).cgColor
        layer?.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
        layer?.borderWidth = 1
    }

    required init?(coder: NSCoder) { fatalError() }
}
