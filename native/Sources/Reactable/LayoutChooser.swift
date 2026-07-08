import AppKit

// First-launch layout chooser: one panel, two cards — combined window or
// floating panels. Shown once (until a preference is saved); dismissing it
// without picking keeps the default and asks again next launch.
@MainActor
final class LayoutChooserPanel {
    private var window: NSWindow?
    private let onPick: (LayoutMode) -> Void

    init(onPick: @escaping (LayoutMode) -> Void) {
        self.onPick = onPick
    }

    func present() {
        if window == nil { build() }
        guard let win = window, let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        win.setFrameOrigin(NSPoint(
            x: f.midX - win.frame.width / 2,
            y: f.midY - win.frame.height / 2 + f.height * 0.1
        ))
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
    }

    func dismiss() {
        window?.orderOut(nil)
    }

    private func pick(_ mode: LayoutMode) {
        dismiss()
        onPick(mode)
    }

    private func build() {
        let size = NSSize(width: 520, height: 300)
        let win = KeyableWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        win.isReleasedWhenClosed = false
        win.backgroundColor = .clear
        win.isOpaque = false
        win.hasShadow = true
        win.level = .modalPanel
        FloatingWindow.configure(win)

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(white: 0.08, alpha: 1).cgColor
        root.layer?.cornerRadius = 14
        root.layer?.masksToBounds = true
        win.contentView = root

        let title = NSTextField(labelWithString: "How should Reactable feel?")
        title.font = .systemFont(ofSize: 17, weight: .semibold)
        title.textColor = .white
        title.alignment = .center

        let combined = ChoiceCard(
            title: "One combined window",
            caption: "Panels dock together in a single window. Drag any panel out to float it.",
            glyph: "rectangle.split.3x1"
        ) { [weak self] in self?.pick(.combined) }

        let floating = ChoiceCard(
            title: "Floating panels",
            caption: "Every panel is its own window. Drag one onto another's edge to combine.",
            glyph: "macwindow.on.rectangle"
        ) { [weak self] in self?.pick(.floating) }

        let cards = NSStackView(views: [combined, floating])
        cards.orientation = .horizontal
        cards.distribution = .fillEqually
        cards.spacing = 14

        let footnote = NSTextField(labelWithString: "You can change this anytime from the menu bar ◉ → Layout.")
        footnote.font = .systemFont(ofSize: 11)
        footnote.textColor = NSColor(white: 1, alpha: 0.45)
        footnote.alignment = .center

        let stack = NSStackView(views: [title, cards, footnote])
        stack.orientation = .vertical
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -24),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -22),
            cards.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        window = win
    }
}

/// A clickable option card: icon, bold title, dim caption.
@MainActor
private final class ChoiceCard: NSView {
    private let action: () -> Void

    init(title: String, caption: String, glyph: String, action: @escaping () -> Void) {
        self.action = action
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 1, alpha: 0.06).cgColor
        layer?.cornerRadius = 12
        layer?.borderWidth = 1
        layer?.borderColor = NSColor(white: 1, alpha: 0.12).cgColor

        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: glyph, accessibilityDescription: title)?
            .withSymbolConfiguration(.init(pointSize: 26, weight: .regular))
        icon.contentTintColor = NSColor(white: 1, alpha: 0.8)

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.alignment = .center

        let captionLabel = NSTextField(wrappingLabelWithString: caption)
        captionLabel.font = .systemFont(ofSize: 11)
        captionLabel.textColor = NSColor(white: 1, alpha: 0.55)
        captionLabel.alignment = .center

        let stack = NSStackView(views: [icon, titleLabel, captionLabel])
        stack.orientation = .vertical
        stack.spacing = 8
        stack.alignment = .centerX
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            heightAnchor.constraint(greaterThanOrEqualToConstant: 150),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
        ])
    }

    required init?(coder: NSCoder) { nil }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self, userInfo: nil
        ))
    }

    override func mouseEntered(with event: NSEvent) {
        layer?.backgroundColor = NSColor(white: 1, alpha: 0.11).cgColor
        layer?.borderColor = NSColor.controlAccentColor.withAlphaComponent(0.6).cgColor
    }

    override func mouseExited(with event: NSEvent) {
        layer?.backgroundColor = NSColor(white: 1, alpha: 0.06).cgColor
        layer?.borderColor = NSColor(white: 1, alpha: 0.12).cgColor
    }

    override func mouseUp(with event: NSEvent) {
        if bounds.contains(convert(event.locationInWindow, from: nil)) { action() }
    }
}
