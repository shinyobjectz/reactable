import AppKit
import WebKit

@MainActor
final class AgentWindowController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var deck: String
    private weak var bridge: ReactableBridgeDelegate?
    private var window: NSWindow?
    private var webView: WKWebView?

    init(port: Int, deck: String = "demo", bridge: ReactableBridgeDelegate?) {
        self.port = port
        self.deck = deck
        self.bridge = bridge
        super.init()
    }

    func open() {
        if window == nil {
            let config = WKWebViewConfiguration()
            config.userContentController.add(self, name: "reactable")

            let web = WKWebView(frame: .zero, configuration: config)
            webView = web

            let w = KeyableWindow(
                contentRect: NSRect(x: 0, y: 0, width: 480, height: 680),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            w.title = "Reactable Agent"
            w.titlebarAppearsTransparent = true
            w.titleVisibility = .visible
            w.minSize = NSSize(width: 400, height: 520)
            w.delegate = self
            w.contentView = web
            web.autoresizingMask = [.width, .height]
            FloatingWindow.configure(w)
            window = w
            centerOnScreen(w)
        }

        reload()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() {
        window?.close()
    }

    var isOpen: Bool { window?.isVisible == true }

    func setDeck(_ slug: String) {
        deck = slug
        if isOpen { reload() }
    }

    func reload() {
        let url = URL(string: "http://127.0.0.1:\(port)/agent?deck=\(deck.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? deck)")!
        webView?.load(URLRequest(url: url))
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
    }

    private func centerOnScreen(_ window: NSWindow) {
        if let screen = NSScreen.main {
            let frame = window.frame
            let visible = screen.visibleFrame
            let x = visible.midX - frame.width / 2
            let y = visible.midY - frame.height / 2
            window.setFrameOrigin(NSPoint(x: x, y: y))
        }
    }
}
