import AppKit

@MainActor
final class SpeakerNotesPanel: NSPanel {
    private let textView = NSTextView()
    private let emptyLabel = NSTextField(labelWithString: "No notes for this slide")

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 260),
            styleMask: [.nonactivatingPanel, .titled, .closable, .resizable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        title = "Speaker notes"
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .fullScreenNone]
        isFloatingPanel = true
        isReleasedWhenClosed = false
        backgroundColor = NSColor(calibratedRed: 0.04, green: 0.02, blue: 0.08, alpha: 0.96)
        isOpaque = false
        hasShadow = true

        let root = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 260))
        root.autoresizingMask = [.width, .height]

        emptyLabel.font = .systemFont(ofSize: 13)
        emptyLabel.textColor = NSColor(white: 0.45, alpha: 1)
        emptyLabel.alignment = .center
        emptyLabel.translatesAutoresizingMaskIntoConstraints = false

        let scroll = NSScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasVerticalScroller = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false

        textView.isEditable = false
        textView.isSelectable = true
        textView.font = .systemFont(ofSize: 15, weight: .regular)
        textView.textColor = NSColor(white: 0.92, alpha: 1)
        textView.backgroundColor = .clear
        textView.textContainerInset = NSSize(width: 12, height: 12)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        scroll.documentView = textView

        root.addSubview(scroll)
        root.addSubview(emptyLabel)
        contentView = root

        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: root.topAnchor, constant: 4),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            emptyLabel.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: root.centerYAnchor),
        ])

        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            setFrameOrigin(NSPoint(x: f.minX + 20, y: f.minY + 20))
        }
    }

    func setText(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        textView.string = trimmed
        let empty = trimmed.isEmpty
        emptyLabel.isHidden = !empty
        textView.isHidden = empty
    }

    func showPanel() {
        orderFrontRegardless()
    }

    func hidePanel() {
        orderOut(nil)
    }
}
