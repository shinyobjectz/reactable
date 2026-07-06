import AppKit
import WebKit

// Stage preview shell — chromeless window, drag strip on top, rounded preview frame.
// Visibility toggled from the bar Stage button; closing the bar hides the stage.

private let dragStripHeight: CGFloat = 28
private let gapBelowDrag: CGFloat = 8
private let frameMargin: CGFloat = 12
private let previewCornerRadius: CGFloat = 12
private let showAnimDuration: TimeInterval = 0.18

@MainActor
private final class StageDragStripView: NSView {
    override func mouseDown(with event: NSEvent) {
        WindowDrag.begin(in: self)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(white: 0.12, alpha: 0.92).setFill()
        dirtyRect.fill()
        let grip = NSBezierPath(roundedRect: NSRect(x: bounds.midX - 18, y: bounds.midY - 2, width: 36, height: 4), xRadius: 2, yRadius: 2)
        NSColor(white: 1, alpha: 0.22).setFill()
        grip.fill()
    }
}

@MainActor
final class StageWindowController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var deckSlug: String
    private weak var bridge: ReactableBridgeDelegate?
    private var window: NSWindow?
    private var webView: WKWebView?
    private var previewFrame: NSView?
    private var savedFrame: NSRect?
    private let defaultContent = NSSize(width: 1280, height: 720)
    var onEvent: ((String, [String: Any]) -> Void)?

    var captureWindow: NSWindow? { window?.isVisible == true ? window : nil }

    init(port: Int, deck: String = "demo", bridge: ReactableBridgeDelegate? = nil) {
        self.port = port
        self.deckSlug = deck
        self.bridge = bridge
    }

    func loadDeck(_ slug: String) {
        deckSlug = slug
        guard let webView else { return }
        let url = URL(string: "http://127.0.0.1:\(port)/present?deck=\(slug.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? slug)")!
        webView.load(URLRequest(url: url))
    }

    func open() {
        if window == nil { createWindow() }
        guard let win = window else { return }
        showWindow(win)
    }

    func hide() {
        guard let win = window, win.isVisible else { return }
        fputs("reactable: hiding stage\n", stderr)
        savedFrame = win.frame
        win.orderOut(nil)
    }

    func toggle() {
        if isVisible { hide() } else { open() }
    }

    func close() {
        window?.close()
        window = nil
        webView = nil
        previewFrame = nil
        savedFrame = nil
    }

    var isOpen: Bool { window != nil }
    var isVisible: Bool { window?.isVisible ?? false }

    func keepVisible() {
        guard window?.isVisible == true else { return }
        window?.orderFrontRegardless()
    }

    func captureCropRect() -> CGRect? {
        guard let previewFrame else { return nil }
        return previewFrame.convert(previewFrame.bounds, to: nil)
    }

    func nextSlide() { webView?.evaluateJavaScript("window.RevealDeck?.next()") }
    func prevSlide() { webView?.evaluateJavaScript("window.RevealDeck?.prev()") }

    func fetchCurrentNotes(completion: ((String) -> Void)? = nil) {
        webView?.evaluateJavaScript("window.RevealDeck?.currentNotes?.() || ''") { result, _ in
            let text = result as? String ?? ""
            completion?(text)
        }
    }

    // MARK: - Window lifecycle

    private func shellSize(for content: NSSize) -> NSSize {
        NSSize(
            width: content.width + frameMargin * 2,
            height: dragStripHeight + gapBelowDrag + content.height + frameMargin
        )
    }

    private func createWindow() {
        let shell = shellSize(for: defaultContent)

        let win = KeyableWindow(
            contentRect: NSRect(x: 0, y: 0, width: shell.width, height: shell.height),
            styleMask: [.borderless, .fullSizeContentView, .resizable],
            backing: .buffered,
            defer: false
        )
        win.delegate = self
        win.isReleasedWhenClosed = false
        win.minSize = shellSize(for: NSSize(width: 640, height: 400))
        win.title = "Reactable Stage"
        win.backgroundColor = .clear
        win.isOpaque = false
        win.hasShadow = true
        win.isMovableByWindowBackground = false
        FloatingWindow.configure(win)

        let root = NSView()
        root.translatesAutoresizingMaskIntoConstraints = false
        win.contentView = root

        let dragStrip = StageDragStripView()
        dragStrip.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.toolTip = "Drag to move stage"

        let preview = NSView()
        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.wantsLayer = true
        preview.layer?.cornerRadius = previewCornerRadius
        preview.layer?.masksToBounds = true
        preview.layer?.backgroundColor = NSColor.black.cgColor
        preview.layer?.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
        preview.layer?.borderWidth = 1
        previewFrame = preview

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "reactable")
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        let web = WKWebView(frame: .zero, configuration: config)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.setValue(false, forKey: "drawsBackground")
        web.wantsLayer = true
        web.layer?.backgroundColor = NSColor.black.cgColor
        webView = web

        root.addSubview(dragStrip)
        root.addSubview(preview)
        preview.addSubview(web)

        NSLayoutConstraint.activate([
            dragStrip.topAnchor.constraint(equalTo: root.topAnchor),
            dragStrip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            dragStrip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragStrip.heightAnchor.constraint(equalToConstant: dragStripHeight),

            preview.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: gapBelowDrag),
            preview.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: frameMargin),
            preview.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -frameMargin),
            preview.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -frameMargin),

            web.topAnchor.constraint(equalTo: preview.topAnchor),
            web.leadingAnchor.constraint(equalTo: preview.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: preview.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: preview.bottomAnchor),
        ])

        window = win
        centerOnScreen(win, size: shell)
        savedFrame = win.frame

        let url = URL(string: "http://127.0.0.1:\(port)/present?deck=\(deckSlug.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? deckSlug)")!
        web.load(URLRequest(url: url))
        showWindow(win)
    }

    private func showWindow(_ win: NSWindow) {
        NSApp.activate(ignoringOtherApps: true)
        if win.isVisible {
            win.makeKeyAndOrderFront(nil)
            return
        }
        if let saved = savedFrame {
            win.setFrame(saved, display: false)
        }
        win.alphaValue = 0
        win.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = showAnimDuration
            win.animator().alphaValue = 1
        }
    }

    private func centerOnScreen(_ win: NSWindow, size: NSSize) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        win.setFrameOrigin(NSPoint(x: f.midX - size.width / 2, y: f.midY - size.height / 2))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        if parsed.action.hasPrefix("event.") {
            let type = String(parsed.action.dropFirst("event.".count))
            onEvent?(type, parsed.payload)
            fputs("reactable event: \(parsed.action) \(parsed.payload)\n", stderr)
        }
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        webView = nil
        previewFrame = nil
        savedFrame = nil
    }
}
