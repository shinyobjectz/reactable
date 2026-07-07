import AppKit

// Shared chrome for Reactable's floating panels (Stage, Agent, and future
// windows): a borderless window with a draggable header strip + a rounded
// content frame — no titlebar / traffic lights. One look, one drag behavior.

extension Array {
    /// Bounds-checked access — nil instead of a crash for out-of-range indices.
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

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
        NSColor(white: 0.08, alpha: 1).setFill()
        dirtyRect.fill()
        // Horizontal six-dot grip — same handle language as the bar's drag grip.
        NSColor(white: 1, alpha: 0.26).setFill()
        let r: CGFloat = 1.4
        let dx: CGFloat = 6, dy: CGFloat = 5
        for col in -1...1 {
            for row in 0...1 {
                let x = bounds.midX + CGFloat(col) * dx - r
                let y = bounds.midY + (CGFloat(row) - 0.5) * dy - r
                NSBezierPath(ovalIn: NSRect(x: x, y: y, width: r * 2, height: r * 2)).fill()
            }
        }
    }
}

/// Tab bar that lives on the leading edge of a DragStripView. Pills intercept
/// clicks (select / close); the bare strip to their right stays draggable.
@MainActor
final class TabBarView: NSView {
    struct Tab { let key: String; let title: String }
    var onSelect: ((String) -> Void)?
    var onClose: ((String) -> Void)?

    private let stack = NSStackView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        stack.orientation = .horizontal
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor),
        ])
    }

    required init?(coder: NSCoder) { fatalError() }

    func setTabs(_ tabs: [Tab], active: String?) {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for t in tabs { stack.addArrangedSubview(pill(t, active: t.key == active)) }
    }

    private func pill(_ tab: Tab, active: Bool) -> NSView {
        let pill = NSView()
        pill.wantsLayer = true
        pill.layer?.cornerRadius = 7
        pill.layer?.backgroundColor = (active
            ? NSColor(white: 1, alpha: 0.16)
            : NSColor(white: 1, alpha: 0.06)).cgColor

        let title = NSButton(title: shorten(tab.title), target: self, action: #selector(selectTab(_:)))
        title.isBordered = false
        title.bezelStyle = .inline
        title.contentTintColor = active ? .white : NSColor(white: 0.75, alpha: 1)
        title.font = .systemFont(ofSize: 11, weight: active ? .semibold : .regular)
        title.identifier = NSUserInterfaceItemIdentifier(tab.key)
        title.translatesAutoresizingMaskIntoConstraints = false

        let close = NSButton(title: "✕", target: self, action: #selector(closeTab(_:)))
        close.isBordered = false
        close.bezelStyle = .inline
        close.contentTintColor = NSColor(white: 0.6, alpha: 1)
        close.font = .systemFont(ofSize: 9)
        close.identifier = NSUserInterfaceItemIdentifier(tab.key)
        close.translatesAutoresizingMaskIntoConstraints = false

        pill.addSubview(title)
        pill.addSubview(close)
        NSLayoutConstraint.activate([
            pill.heightAnchor.constraint(equalToConstant: 20),
            title.leadingAnchor.constraint(equalTo: pill.leadingAnchor, constant: 9),
            title.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
            close.leadingAnchor.constraint(equalTo: title.trailingAnchor, constant: 3),
            close.trailingAnchor.constraint(equalTo: pill.trailingAnchor, constant: -7),
            close.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
        ])
        return pill
    }

    private func shorten(_ s: String) -> String {
        s.count > 22 ? String(s.prefix(21)) + "…" : s
    }

    @objc private func selectTab(_ sender: NSButton) {
        if let key = sender.identifier?.rawValue { onSelect?(key) }
    }

    @objc private func closeTab(_ sender: NSButton) {
        if let key = sender.identifier?.rawValue { onClose?(key) }
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
