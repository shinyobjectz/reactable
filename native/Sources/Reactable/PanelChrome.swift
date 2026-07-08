import AppKit
import WebKit

// The ONE chrome wrapper every floating panel uses: native drag strip with
// the six-dot grip on top, content below, hover-only resize corners. Stage
// and agent build the same pieces; web panels install this instead of
// rolling their own headers.
@MainActor
enum PanelChrome {
    /// Title (left) + close (right) inside a drag strip — the window's real
    /// header lives in the chrome, not the page.
    @discardableResult
    static func decorate(strip: DragStripView, title: String, onClose: @escaping () -> Void) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 11, weight: .semibold)
        label.textColor = NSColor(white: 1, alpha: 0.55)
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(label)

        let close = CloseButton(onClose)
        close.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(close)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: strip.leadingAnchor, constant: 18),
            label.centerYAnchor.constraint(equalTo: strip.centerYAnchor, constant: 3),
            label.widthAnchor.constraint(lessThanOrEqualTo: strip.widthAnchor, multiplier: 0.42),
            close.trailingAnchor.constraint(equalTo: strip.trailingAnchor, constant: -16),
            close.centerYAnchor.constraint(equalTo: strip.centerYAnchor, constant: 3),
        ])
        return label
    }

    private final class CloseButton: NSButton {
        private let onClose: () -> Void
        init(_ f: @escaping () -> Void) {
            self.onClose = f
            super.init(frame: .zero)
            title = "✕"
            isBordered = false
            font = .systemFont(ofSize: 11, weight: .semibold)
            contentTintColor = NSColor(white: 1, alpha: 0.45)
            target = self
            action = #selector(fire)
        }
        required init?(coder: NSCoder) { nil }
        @objc private func fire() { onClose() }
    }

    @discardableResult
    static func install(in win: NSWindow, content: NSView, title: String, onClose: @escaping () -> Void) -> PanelShell {
        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(white: 0.08, alpha: 1).cgColor
        root.layer?.cornerRadius = 14
        root.layer?.masksToBounds = true
        win.contentView = root

        let strip = DragStripView()
        strip.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(strip)
        decorate(strip: strip, title: title, onClose: onClose)

        NSLayoutConstraint.activate([
            strip.topAnchor.constraint(equalTo: root.topAnchor),
            strip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            strip.heightAnchor.constraint(equalToConstant: Chrome.dragStripHeight),
        ])

        let shell = PanelShell(window: win, root: root, strip: strip, content: content)
        shell.attachContent()
        ResizeCornersView.attach(to: root)
        return shell
    }
}

/// Handle onto a PanelChrome-built window: keeps the root/strip/content refs so
/// the content can be detached into a dock group and reattached when torn out.
@MainActor
final class PanelShell {
    let window: NSWindow
    let root: NSView
    let strip: DragStripView
    let content: NSView
    private var contentConstraints: [NSLayoutConstraint] = []

    init(window: NSWindow, root: NSView, strip: DragStripView, content: NSView) {
        self.window = window
        self.root = root
        self.strip = strip
        self.content = content
    }

    func attachContent() {
        guard content.superview !== root else { return }
        content.removeFromSuperview()
        content.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(content)
        contentConstraints = [
            content.topAnchor.constraint(equalTo: strip.bottomAnchor, constant: Chrome.gapBelowDrag),
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            content.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ]
        NSLayoutConstraint.activate(contentConstraints)
    }

    func detachContent() -> NSView {
        NSLayoutConstraint.deactivate(contentConstraints)
        contentConstraints = []
        content.removeFromSuperview()
        return content
    }
}
