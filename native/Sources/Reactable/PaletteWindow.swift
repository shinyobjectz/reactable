import AppKit
import WebKit

// ⌘I command palette — a centered, chromeless modal that lists every Surface
// across all projects (via /reactable/surfaces) and opens the pick on the Stage.
// Ephemeral: dismisses on Escape or when it loses focus.

@MainActor
final class PaletteWindowController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var window: NSWindow?
    private var webView: WKWebView?
    var onOpenSurface: ((StageSurface) -> Void)?

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
        centerOnScreen(win)
        win.makeKeyAndOrderFront(nil)
        // Refresh the surface list + focus the search field each time it opens.
        webView?.evaluateJavaScript("window.ReactablePalette?.reset()")
    }

    func hide() {
        window?.orderOut(nil)
    }

    private func createWindow() {
        let size = NSSize(width: 560, height: 420)
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

        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/palette")!))
        window = win
    }

    private func centerOnScreen(_ win: NSWindow) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        let s = win.frame.size
        // Sit a little above dead-center — command-palette convention.
        win.setFrameOrigin(NSPoint(x: f.midX - s.width / 2, y: f.midY - s.height / 2 + f.height * 0.12))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        switch parsed.action {
        case "palette.open":
            let p = parsed.payload
            let surface = StageSurface(
                kind: p["kind"] as? String ?? "web",
                ref: p["ref"] as? String ?? "",
                title: p["title"] as? String ?? "",
                project: p["project"] as? String ?? ""
            )
            hide()
            if !surface.ref.isEmpty { onOpenSurface?(surface) }
        case "palette.close":
            hide()
        default:
            break
        }
    }

    // Dismiss when focus leaves the palette (click-outside).
    func windowDidResignKey(_ notification: Notification) {
        hide()
    }
}
