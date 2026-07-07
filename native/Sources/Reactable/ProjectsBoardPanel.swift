import AppKit
import WebKit

// Projects board — the bar's picker button. A large kanban of every
// registered project staged through the pipeline (idea → recording →
// editing → done). Click a card to switch projects; drag to restage.
// State lives in ~/Reactable/pipeline.json so the CLI can manage it too.
@MainActor
final class ProjectsBoardPanel: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var window: NSWindow?

    /// Default-layout placement — set the window frame if it exists.
    func place(frame: NSRect) {
        window?.setFrame(frame, display: true)
    }
    private var webView: WKWebView?

    var dataProvider: (() -> [String: Any])?
    var onSelect: ((String, String) -> Void)?
    var onStage: ((String, String) -> Void)?
    var onNew: (() -> Void)?

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
    }

    func hide() { window?.orderOut(nil) }

    func pushData() {
        guard let data = dataProvider?(),
              let json = try? JSONSerialization.data(withJSONObject: data),
              let str = String(data: json, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.ReactableProjects?.setData(\(str))")
    }

    private func createWindow() {
        let size = NSSize(width: 300, height: 640)
        let win = KeyableWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .fullSizeContentView, .resizable],
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
        PanelChrome.install(in: win, content: web)
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/projects")!))
        window = win
    }

    private func center(_ win: NSWindow) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        let s = win.frame.size
        win.setFrameOrigin(NSPoint(x: f.midX - s.width / 2, y: f.midY - s.height / 2 + f.height * 0.04))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        switch parsed.action {
        case "projects.ready":
            pushData()
        case "projects.select":
            if let root = parsed.payload["root"] as? String,
               let slug = parsed.payload["slug"] as? String {
                onSelect?(root, slug)
            }
        case "projects.new":
            onNew?()
        case "projects.stage":
            if let id = parsed.payload["id"] as? String,
               let stage = parsed.payload["stage"] as? String {
                onStage?(id, stage)
            }
        case "projects.moveBy":
            if let win = window {
                let dx = parsed.payload["dx"] as? Double ?? 0
                let dy = parsed.payload["dy"] as? Double ?? 0
                var origin = win.frame.origin
                origin.x += dx
                origin.y -= dy
                win.setFrameOrigin(origin)
            }
        case "projects.close":
            hide()
        default:
            break
        }
    }
}
