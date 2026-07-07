import AppKit
import WebKit

// Local agent shell — chromeless window with the same drag strip + rounded frame
// as the stage (no titlebar / traffic lights). Toggled on/off from the bar AI button.

private let agentDragStripHeight: CGFloat = 28
private let agentGapBelowDrag: CGFloat = 8
private let agentFrameMargin: CGFloat = 12
private let agentCornerRadius: CGFloat = 12
private let agentShowAnimDuration: TimeInterval = 0.18

@MainActor
private final class AgentDragStripView: NSView {
    override func mouseDown(with event: NSEvent) {
        WindowDrag.begin(in: self)
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

@MainActor
final class AgentWindowController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var deck: String
    private weak var bridge: ReactableBridgeDelegate?
    private var window: NSWindow?
    private var webView: WKWebView?
    private var savedFrame: NSRect?

    init(port: Int, deck: String = "showcase", bridge: ReactableBridgeDelegate?) {
        self.port = port
        self.deck = deck
        self.bridge = bridge
        super.init()
    }

    var isOpen: Bool { window != nil }
    var isVisible: Bool { window?.isVisible ?? false }

    func toggle() {
        if isVisible { hide() } else { open() }
    }

    func open() {
        if window == nil { createWindow() }
        guard let win = window else { return }
        showWindow(win)
    }

    func hide() {
        guard let win = window, win.isVisible else { return }
        savedFrame = win.frame
        win.orderOut(nil)
    }

    func close() {
        window?.close()
        window = nil
        webView = nil
        savedFrame = nil
    }

    func setDeck(_ slug: String) {
        deck = slug
        if isVisible { reload() }
    }

    func reload() {
        let q = deck.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? deck
        let url = URL(string: "http://127.0.0.1:\(port)/agent?deck=\(q)")!
        webView?.load(URLRequest(url: url))
    }

    // MARK: - Window lifecycle

    private func shellSize(for content: NSSize) -> NSSize {
        NSSize(
            width: content.width + agentFrameMargin * 2,
            height: agentDragStripHeight + agentGapBelowDrag + content.height + agentFrameMargin
        )
    }

    private func createWindow() {
        let shell = shellSize(for: NSSize(width: 460, height: 640))

        let win = KeyableWindow(
            contentRect: NSRect(x: 0, y: 0, width: shell.width, height: shell.height),
            styleMask: [.borderless, .fullSizeContentView, .resizable],
            backing: .buffered,
            defer: false
        )
        win.delegate = self
        win.isReleasedWhenClosed = false
        win.minSize = shellSize(for: NSSize(width: 380, height: 480))
        win.title = "Reactable Agent"
        win.backgroundColor = .clear
        win.isOpaque = false
        win.hasShadow = true
        win.isMovableByWindowBackground = false
        FloatingWindow.configure(win)

        let root = NSView()
        win.contentView = root

        let dragStrip = AgentDragStripView()
        dragStrip.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.toolTip = "Drag to move agent"

        let frame = NSView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frame.wantsLayer = true
        frame.layer?.cornerRadius = agentCornerRadius
        frame.layer?.masksToBounds = true
        frame.layer?.backgroundColor = NSColor(white: 0.035, alpha: 1).cgColor
        frame.layer?.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
        frame.layer?.borderWidth = 1

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "reactable")
        let web = WKWebView(frame: .zero, configuration: config)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.setValue(false, forKey: "drawsBackground")
        web.wantsLayer = true
        web.layer?.backgroundColor = NSColor(white: 0.035, alpha: 1).cgColor
        webView = web

        root.addSubview(dragStrip)
        root.addSubview(frame)
        frame.addSubview(web)

        NSLayoutConstraint.activate([
            dragStrip.topAnchor.constraint(equalTo: root.topAnchor),
            dragStrip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            dragStrip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragStrip.heightAnchor.constraint(equalToConstant: agentDragStripHeight),

            frame.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: agentGapBelowDrag),
            frame.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: agentFrameMargin),
            frame.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -agentFrameMargin),
            frame.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -agentFrameMargin),

            web.topAnchor.constraint(equalTo: frame.topAnchor),
            web.leadingAnchor.constraint(equalTo: frame.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: frame.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: frame.bottomAnchor),
        ])

        window = win
        centerOnScreen(win, size: shell)
        savedFrame = win.frame
        reload()
    }

    private func showWindow(_ win: NSWindow) {
        NSApp.activate(ignoringOtherApps: true)
        if win.isVisible {
            win.makeKeyAndOrderFront(nil)
            return
        }
        if let saved = savedFrame { win.setFrame(saved, display: false) }
        win.alphaValue = 0
        win.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = agentShowAnimDuration
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
        switch parsed.action {
        case "agent.openStage":
            let slug = parsed.payload["deck"] as? String ?? deck
            bridge?.bridgeSelectDeck(slug: slug)
            bridge?.bridgeSelectStage()
        default:
            break
        }
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        webView = nil
        savedFrame = nil
    }
}
