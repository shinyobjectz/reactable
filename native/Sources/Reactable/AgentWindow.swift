import AppKit
import WebKit

// Local agent shell — chromeless window using the shared Chrome (drag strip +
// rounded frame, no titlebar / traffic lights). Toggled on/off from the bar AI button.

@MainActor
final class AgentWindowController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var deck: String
    private weak var bridge: ReactableBridgeDelegate?
    private var window: NSWindow?

    /// Default-layout placement — animate to the frame if the window's onscreen.
    func place(frame: NSRect) {
        window?.setFrame(frame, display: true, animate: window?.isVisible ?? false)
    }
    private var webView: WKWebView?
    private var savedFrame: NSRect?
    private var rootView: NSView?
    private var dragStrip: DragStripView?
    private var frameView: ContentFrameView?
    var dockHost: DockGroupController?

    init(port: Int, deck: String = "showcase", bridge: ReactableBridgeDelegate?) {
        self.port = port
        self.deck = deck
        self.bridge = bridge
        super.init()
    }

    var isOpen: Bool { window != nil }
    var isVisible: Bool {
        if let dockHost { return dockHost.window.isVisible }
        return window?.isVisible ?? false
    }

    func toggle() {
        if isVisible { hide() } else { open() }
    }

    func open() {
        if let dockHost {
            dockHost.reveal()
            return
        }
        if window == nil { createWindow() }
        guard let win = window else { return }
        showWindow(win)
    }

    func hide() {
        if dockHost != nil {
            DockController.shared.undock(self, show: false)
            return
        }
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

    private func createWindow() {
        let shell = Chrome.shellSize(for: NSSize(width: 460, height: 780))

        let win = KeyableWindow(
            contentRect: NSRect(x: 0, y: 0, width: shell.width, height: shell.height),
            styleMask: [.borderless, .fullSizeContentView, .resizable],
            backing: .buffered,
            defer: false
        )
        win.delegate = self
        win.isReleasedWhenClosed = false
        win.minSize = Chrome.shellSize(for: NSSize(width: 380, height: 480))
        win.title = "Reactable Agent"
        win.backgroundColor = .clear
        win.isOpaque = false
        win.hasShadow = true
        win.isMovableByWindowBackground = false
        FloatingWindow.configure(win)

        let root = NSView()
        Chrome.styleRoot(root)
        win.contentView = root
        rootView = root

        let dragStrip = DragStripView()
        dragStrip.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.toolTip = "Drag to move agent"
        self.dragStrip = dragStrip

        let frame = ContentFrameView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frameView = frame

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "reactable")
        Chrome.injectTokens(into: config)
        let web = WKWebView(frame: .zero, configuration: config)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.setValue(false, forKey: "drawsBackground")
        web.wantsLayer = true
        web.layer?.backgroundColor = Chrome.bgContent.cgColor
        webView = web

        root.addSubview(dragStrip)
        root.addSubview(frame)
        frame.install(web)

        NSLayoutConstraint.activate([
            dragStrip.topAnchor.constraint(equalTo: root.topAnchor),
            dragStrip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            dragStrip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragStrip.heightAnchor.constraint(equalToConstant: Chrome.dragStripHeight),

            frame.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: Chrome.gapBelowDrag),
            frame.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            frame.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            frame.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ])

        if let strip = root.subviews.compactMap({ $0 as? DragStripView }).first {
            PanelChrome.decorate(strip: strip, title: "Reactable Agent") { [weak self] in self?.hide() }
        }
        ResizeCornersView.attach(to: root)
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
            ctx.duration = Chrome.showAnimDuration
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
        case "agent.openPreview":
            // A footage card wants to preview a render or the source at a timecode.
            if let path = parsed.payload["path"] as? String {
                bridge?.bridgeOpenPreview(path: path, ms: parsed.payload["ms"] as? Double)
            } else if let ref = parsed.payload["ref"] as? String {
                bridge?.bridgeOpenPreview(path: ref, ms: parsed.payload["ms"] as? Double)
            }
        case "agent.openSurface":
            if let kind = parsed.payload["kind"] as? String,
               let ref = parsed.payload["ref"] as? String {
                bridge?.bridgeOpenSurface(kind: kind, ref: ref)
            }
        case "agent.addAsset":
            if let path = parsed.payload["path"] as? String {
                bridge?.bridgeAddAsset(path: path)
            }
        default:
            break
        }
    }

    /// Inject a prefilled prompt into the chat and send it (panel → agent).
    func sendPrompt(_ text: String) { injectPrompt(text, method: "send") }

    /// Fill the composer without sending — the user completes and hits enter.
    func fillPrompt(_ text: String) { injectPrompt(text, method: "fill") }

    private func injectPrompt(_ text: String, method: String) {
        ensureLoaded()
        open()
        let escaped = text.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")
        let js = "window.ReactableAgent && window.ReactableAgent.\(method)(`\(escaped)`)"
        webView?.evaluateJavaScript(js) { _, err in
            if err != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                    self?.webView?.evaluateJavaScript(js)
                }
            }
        }
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        webView = nil
        savedFrame = nil
        rootView = nil
        dragStrip = nil
        frameView = nil
    }
}

extension AgentWindowController: DockablePanel {
    var dockKey: String { "agent" }
    var dockTitle: String { "Agent" }
    var dockMinSize: NSSize { NSSize(width: 320, height: 300) }
    var panelWindow: NSWindow? { window }

    func ensureLoaded() {
        if window == nil { createWindow() }
    }

    func detachDockBody() -> NSView? {
        guard let frameView else { return nil }
        frameView.removeFromSuperview()
        return frameView
    }

    func reattachDockBody(_ body: NSView, accessory: NSView?) {
        guard let root = rootView, let dragStrip else { return }
        body.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(body)
        NSLayoutConstraint.activate([
            body.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: Chrome.gapBelowDrag),
            body.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            body.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            body.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ])
    }
}
