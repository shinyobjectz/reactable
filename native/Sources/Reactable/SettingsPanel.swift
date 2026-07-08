import AppKit
import WebKit

// Settings — replaces the native gear menu. Tabbed web panel (Account, Tools)
// sharing localStorage with the agent page (tool prefs ride chat frontmatter).
@MainActor
final class SettingsPanel: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var window: NSWindow?
    private var webView: WKWebView?

    init(port: Int) {
        self.port = port
        super.init()
    }

    var isVisible: Bool { window?.isVisible ?? false }

    func toggle() {
        if isVisible { window?.orderOut(nil) } else { open() }
    }

    func open() {
        if window == nil {
            let size = NSSize(width: 460, height: 520)
            let win = KeyableWindow(
                contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .fullSizeContentView, .resizable],
                backing: .buffered, defer: false
            )
            win.delegate = self
            win.isReleasedWhenClosed = false
            win.backgroundColor = .clear
            win.isOpaque = false
            win.hasShadow = true
            win.level = .modalPanel
            FloatingWindow.configure(win)
            let config = WKWebViewConfiguration()
            config.userContentController.add(self, name: "reactable")
            let web = WKWebView(frame: .zero, configuration: config)
            web.setValue(false, forKey: "drawsBackground")
            webView = web
            PanelChrome.install(in: win, content: web, title: "Settings") { [weak self] in
                self?.window?.orderOut(nil)
            }
            web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/settings")!))
            window = win
        }
        guard let win = window, let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        win.setFrameOrigin(NSPoint(x: f.midX - 230, y: f.midY - 220))
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        switch parsed.action {
        case "settings.link":
            if let u = parsed.payload["url"] as? String, let url = URL(string: u) {
                NSWorkspace.shared.open(url)
            }
        case "settings.close":
            window?.orderOut(nil)
        default:
            break
        }
    }
}
