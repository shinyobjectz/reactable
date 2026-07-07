import AppKit
import WebKit

// Stage Manager — the stage button's chevron. A palette-style panel that
// searches everything recordable (windows, displays, decks, stage tabs, URLs)
// and holds an ordered, drag-reorderable lineup of scenes to walk through
// while recording. Lineup persists per project (stage-lineup.json).
@MainActor
final class StageManagerPanel: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var window: NSWindow?
    private var webView: WKWebView?

    /// Called with the full entry payload when a lineup entry is activated.
    var onActivate: (([String: Any]) -> Void)?
    /// Supplies the searchable catalog + saved lineup as a JSON object.
    var dataProvider: (() -> [String: Any])?
    /// Persists the lineup array.
    var onSaveLineup: (([[String: Any]]) -> Void)?
    /// Rewrites deck.work slide order to match these slide ids.
    var onApplyDeckOrder: (([String]) -> Void)?

    init(port: Int) {
        self.port = port
        super.init()
    }

    var isVisible: Bool { window?.isVisible ?? false }

    func toggle() {
        if isVisible { hide() } else { open() }
    }

    func open() {
        if window == nil { createWindow() }
        guard let win = window else { return }
        NSApp.activate(ignoringOtherApps: true)
        center(win)
        win.makeKeyAndOrderFront(nil)
        pushData()
        webView?.evaluateJavaScript("window.ReactableManager?.reset()")
    }

    func hide() { window?.orderOut(nil) }

    func pushData() {
        guard let data = dataProvider?(),
              let json = try? JSONSerialization.data(withJSONObject: data),
              let str = String(data: json, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.ReactableManager?.setData(\(str))")
    }

    private func createWindow() {
        let size = NSSize(width: 720, height: 480)
        let win = KeyableWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
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
        let web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        web.autoresizingMask = [.width, .height]
        web.setValue(false, forKey: "drawsBackground")
        webView = web
        win.contentView = web
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/manager")!))
        window = win
    }

    private func center(_ win: NSWindow) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        let s = win.frame.size
        win.setFrameOrigin(NSPoint(x: f.midX - s.width / 2, y: f.midY - s.height / 2 + f.height * 0.08))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        switch parsed.action {
        case "manager.ready":
            pushData()
        case "manager.activate":
            onActivate?(parsed.payload)
        case "manager.save":
            if let lineup = parsed.payload["lineup"] as? [[String: Any]] {
                onSaveLineup?(lineup)
            }
        case "manager.applyDeckOrder":
            if let ids = parsed.payload["ids"] as? [String] {
                onApplyDeckOrder?(ids)
            }
        case "manager.close":
            hide()
        default:
            break
        }
    }
}
