import AppKit
import WebKit

// Stage preview shell — chromeless window using the shared Chrome (drag strip +
// rounded frame). Visibility toggled from the bar Stage button; closing the bar
// hides the stage.

// A thing the Stage can show. kind ∈ deck | web | doc | youtube (mirrors the
// nexus Surface model; extend as more viewers land).
struct StageSurface: Equatable {
    var kind: String
    var ref: String
    var title: String
    var project: String
    var key: String { "\(kind):\(ref)" }
}

@MainActor
final class StageWindowController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var deckSlug: String
    private weak var bridge: ReactableBridgeDelegate?
    private var window: NSWindow?

    /// Default-layout placement — set the window frame if it exists.
    func place(frame: NSRect) {
        window?.setFrame(frame, display: true)
    }
    private var webView: WKWebView?
    private var previewFrame: NSView?
    private var tabBar: TabBarView?
    private var savedFrame: NSRect?
    private let defaultContent = NSSize(width: 1280, height: 720)
    var onEvent: ((String, [String: Any]) -> Void)?

    // Open surfaces (tabs) + the active one.
    private var surfaces: [StageSurface] = []
    var openSurfaces: [StageSurface] { surfaces }
    private var activeIndex = 0

    var captureWindow: NSWindow? { window?.isVisible == true ? window : nil }

    /// The deck content region (webview) in window points, TOP-LEFT origin —
    /// the capture crop so recordings exclude the drag strip and frame chrome.
    var deckContentRect: CGRect? {
        guard let webView, let window else { return nil }
        let f = webView.convert(webView.bounds, to: nil)
        let winH = window.frame.height
        return CGRect(
            x: f.origin.x,
            y: winH - (f.origin.y + f.height),
            width: f.width,
            height: f.height
        )
    }

    init(port: Int, deck: String = "showcase", bridge: ReactableBridgeDelegate? = nil) {
        self.port = port
        self.deckSlug = deck
        self.bridge = bridge
    }

    /// Open (or focus) a surface as a tab and make it active.
    func openSurface(_ s: StageSurface) {
        if s.kind == "deck" { deckSlug = s.ref }
        if let idx = surfaces.firstIndex(where: { $0.key == s.key }) {
            activeIndex = idx
        } else {
            surfaces.append(s)
            activeIndex = surfaces.count - 1
        }
        rebuildTabs()
        loadActive()
    }

    func activateSurface(key: String) {
        guard let idx = surfaces.firstIndex(where: { $0.key == key }) else { return }
        activeIndex = idx
        if surfaces[idx].kind == "deck" { deckSlug = surfaces[idx].ref }
        rebuildTabs()
        loadActive()
    }

    func closeSurface(key: String) {
        guard let idx = surfaces.firstIndex(where: { $0.key == key }) else { return }
        surfaces.remove(at: idx)
        if surfaces.isEmpty { hide(); return }
        activeIndex = min(activeIndex, surfaces.count - 1)
        if let deck = surfaces[safe: activeIndex], deck.kind == "deck" { deckSlug = deck.ref }
        rebuildTabs()
        loadActive()
    }

    func loadDeck(_ slug: String) {
        openSurface(StageSurface(kind: "deck", ref: slug, title: slug, project: ""))
    }

    private func loadActive() {
        guard let webView, let s = surfaces[safe: activeIndex] else { return }
        webView.load(URLRequest(url: url(for: s)))
    }

    private func url(for s: StageSurface) -> URL {
        func enc(_ v: String) -> String { v.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? v }
        let base = "http://127.0.0.1:\(port)"
        switch s.kind {
        case "deck":
            return URL(string: "\(base)/present?deck=\(enc(s.ref))")!
        default:
            return URL(string: "\(base)/reactable/surface?kind=\(enc(s.kind))&ref=\(enc(s.ref))&project=\(enc(s.project))")!
        }
    }

    private func rebuildTabs() {
        // A single deck tab is the plain stage — no tab chrome needed.
        let showTabs = surfaces.count > 1
        let tabs = surfaces.map { TabBarView.Tab(key: $0.key, title: $0.title) }
        tabBar?.setTabs(showTabs ? tabs : [], active: surfaces[safe: activeIndex]?.key)
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
    func gotoSlide(_ index: Int) { webView?.evaluateJavaScript("window.RevealDeck?.goto(\(index))") }
    func prevSlide() { webView?.evaluateJavaScript("window.RevealDeck?.prev()") }

    func fetchCurrentNotes(completion: ((String) -> Void)? = nil) {
        webView?.evaluateJavaScript("window.RevealDeck?.currentNotes?.() || ''") { result, _ in
            let text = result as? String ?? ""
            completion?(text)
        }
    }

    // MARK: - Window lifecycle

    private func createWindow() {
        let shell = Chrome.shellSize(for: defaultContent)

        let win = KeyableWindow(
            contentRect: NSRect(x: 0, y: 0, width: shell.width, height: shell.height),
            styleMask: [.borderless, .fullSizeContentView, .resizable],
            backing: .buffered,
            defer: false
        )
        win.delegate = self
        win.isReleasedWhenClosed = false
        win.minSize = Chrome.shellSize(for: NSSize(width: 640, height: 400))
        win.title = "Reactable Stage"
        win.backgroundColor = .clear
        win.isOpaque = false
        win.hasShadow = true
        win.isMovableByWindowBackground = false
        FloatingWindow.configure(win)

        let root = NSView()
        root.translatesAutoresizingMaskIntoConstraints = false
        win.contentView = root

        let dragStrip = DragStripView()
        dragStrip.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.toolTip = "Drag to move stage"

        let tabs = TabBarView()
        tabs.translatesAutoresizingMaskIntoConstraints = false
        tabs.onSelect = { [weak self] key in self?.activateSurface(key: key) }
        tabs.onClose = { [weak self] key in self?.closeSurface(key: key) }
        tabBar = tabs
        dragStrip.addSubview(tabs)

        let preview = ContentFrameView()
        preview.translatesAutoresizingMaskIntoConstraints = false
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
            dragStrip.heightAnchor.constraint(equalToConstant: Chrome.dragStripHeight),

            tabs.leadingAnchor.constraint(equalTo: dragStrip.leadingAnchor),
            tabs.topAnchor.constraint(equalTo: dragStrip.topAnchor),
            tabs.bottomAnchor.constraint(equalTo: dragStrip.bottomAnchor),
            tabs.trailingAnchor.constraint(lessThanOrEqualTo: dragStrip.trailingAnchor, constant: -80),

            preview.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: Chrome.gapBelowDrag),
            preview.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            preview.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            preview.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),

            web.topAnchor.constraint(equalTo: preview.topAnchor),
            web.leadingAnchor.constraint(equalTo: preview.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: preview.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: preview.bottomAnchor),
        ])

        window = win
        centerOnScreen(win, size: shell)
        savedFrame = win.frame

        // Seed with the active deck surface if none open yet.
        if surfaces.isEmpty {
            surfaces = [StageSurface(kind: "deck", ref: deckSlug, title: deckSlug, project: "")]
            activeIndex = 0
        }
        rebuildTabs()
        loadActive()
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
