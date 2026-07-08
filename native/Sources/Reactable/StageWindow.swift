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

    /// Default-layout placement — animate to the frame if the window's onscreen.
    func place(frame: NSRect) {
        window?.setFrame(frame, display: true, animate: window?.isVisible ?? false)
    }
    private var webView: WKWebView?
    private var previewFrame: NSView?
    private var stripTitle: NSTextField?
    private var savedFrame: NSRect?
    private var rootView: NSView?
    private var dragStrip: DragStripView?
    var dockHost: DockGroupController?
    private let defaultContent = NSSize(width: 1280, height: 720)
    var onEvent: ((String, [String: Any]) -> Void)?

    // Open surfaces (tabs) + the active one — shared strip machinery.
    private let tabs = SurfaceTabStrip()
    var openSurfaces: [StageSurface] { tabs.surfaces }

    /// The window that hosts the stage content right now — the panel's own
    /// float OR the dock group it's docked into. Capture binds to this.
    var captureWindow: NSWindow? {
        guard let host = webView?.window, host.isVisible else { return nil }
        return host
    }

    /// The deck content region (webview) in window points, TOP-LEFT origin —
    /// the capture crop so recordings exclude the drag strip and frame chrome.
    var deckContentRect: CGRect? {
        guard let webView, let host = webView.window else { return nil }
        let f = webView.convert(webView.bounds, to: nil)
        let winH = host.frame.height
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
        super.init()
        tabs.onActivate = { [weak self] s in
            guard let self else { return }
            if s.kind == "deck" { deckSlug = s.ref }
            loadActive()
        }
        tabs.onEmpty = { [weak self] in self?.hide() }
    }

    /// Open (or focus) a surface as a tab and make it active.
    func openSurface(_ s: StageSurface) {
        tabs.open(s)
    }

    func activateSurface(key: String) {
        tabs.activate(key: key)
    }

    func closeSurface(key: String) {
        tabs.close(key: key)
    }

    func loadDeck(_ slug: String) {
        openSurface(StageSurface(kind: "deck", ref: slug, title: slug, project: ""))
    }

    private func loadActive() {
        guard let webView, let s = tabs.active else { return }
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
            // Scenes need the stage out of the shot — leave the group, stay hidden.
            fputs("reactable: undocking stage to hide\n", stderr)
            DockController.shared.undock(self, show: false)
            return
        }
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
    var isVisible: Bool {
        if let dockHost { return dockHost.window.isVisible }
        return window?.isVisible ?? false
    }

    func keepVisible() {
        guard dockHost == nil else { return }  // the group keeps itself visible
        guard window?.isVisible == true else { return }
        window?.orderFrontRegardless()
    }

    func captureCropRect() -> CGRect? {
        guard let previewFrame else { return nil }
        return previewFrame.convert(previewFrame.bounds, to: nil)
    }

    /// Ground-truth layout snapshot for footage intel: visible element rects
    /// in stage coordinates, stamped into events.jsonl beside slide events
    /// (docs/PLAN.footage-intel.work). Engine-agnostic — plain DOM query.
    private static let layoutJS = """
    (() => {
      const els = document.querySelectorAll('h1,h2,h3,p,li,img,video,pre,table,button,canvas,svg,blockquote');
      const vw = innerWidth, vh = innerHeight, out = [];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
        const s = getComputedStyle(el);
        if (s.visibility === 'hidden' || s.opacity === '0') continue;
        out.push({ tag: el.tagName.toLowerCase(),
                   text: (el.innerText || el.alt || '').trim().slice(0, 60),
                   x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
        if (out.length >= 40) break;
      }
      return JSON.stringify({ vw, vh, elements: out });
    })()
    """

    func captureLayout(_ done: @escaping ([String: Any]) -> Void) {
        webView?.evaluateJavaScript(Self.layoutJS) { result, _ in
            guard let s = result as? String,
                  let data = s.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return }
            done(obj)
        }
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
        Chrome.styleRoot(root)
        win.contentView = root
        rootView = root

        let dragStrip = DragStripView()
        dragStrip.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.toolTip = "Drag to move stage"
        self.dragStrip = dragStrip

        let tabBar = tabs.tabBar
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.addSubview(tabBar)

        let preview = ContentFrameView()
        preview.translatesAutoresizingMaskIntoConstraints = false
        previewFrame = preview

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "reactable")
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true
        Chrome.injectTokens(into: config)
        let web = WKWebView(frame: .zero, configuration: config)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.setValue(false, forKey: "drawsBackground")
        web.wantsLayer = true
        web.layer?.backgroundColor = NSColor.black.cgColor
        webView = web

        root.addSubview(dragStrip)
        root.addSubview(preview)
        preview.install(web)

        NSLayoutConstraint.activate([
            dragStrip.topAnchor.constraint(equalTo: root.topAnchor),
            dragStrip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            dragStrip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragStrip.heightAnchor.constraint(equalToConstant: Chrome.dragStripHeight),

            tabBar.leadingAnchor.constraint(equalTo: dragStrip.leadingAnchor),
            tabBar.topAnchor.constraint(equalTo: dragStrip.topAnchor),
            tabBar.bottomAnchor.constraint(equalTo: dragStrip.bottomAnchor),
            tabBar.trailingAnchor.constraint(lessThanOrEqualTo: dragStrip.trailingAnchor, constant: -80),

            preview.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: Chrome.gapBelowDrag),
            preview.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            preview.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            preview.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ])

        stripTitle = PanelChrome.decorate(strip: dragStrip, title: deckSlug) { [weak self] in self?.hide() }
        ResizeCornersView.attach(to: root)
        window = win
        centerOnScreen(win, size: shell)
        savedFrame = win.frame

        // Seed with the active deck surface if none open yet.
        if tabs.surfaces.isEmpty {
            tabs.open(StageSurface(kind: "deck", ref: deckSlug, title: deckSlug, project: ""))
        } else {
            tabs.rebuild()
            loadActive()
        }
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
            if type == "slide" {
                let idx = (parsed.payload["idx"] as? Int).map { $0 + 1 } ?? 0
                let id = parsed.payload["id"] as? String ?? ""
                let kind = parsed.payload["type"] as? String ?? ""
                stripTitle?.stringValue = [String(idx), kind, id].filter { !$0.isEmpty && $0 != "0" }.joined(separator: " · ")
            }
            onEvent?(type, parsed.payload)
            fputs("reactable event: \(parsed.action) \(parsed.payload)\n", stderr)
        }
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        webView = nil
        previewFrame = nil
        savedFrame = nil
        rootView = nil
        dragStrip = nil
    }
}

extension StageWindowController: DockablePanel {
    var dockKey: String { "stage" }
    var dockTitle: String { "Stage" }
    var dockMinSize: NSSize { NSSize(width: 480, height: 320) }
    var panelWindow: NSWindow? { window }

    func ensureLoaded() {
        if window == nil { createWindow() }
    }

    func detachDockBody() -> NSView? {
        guard let previewFrame else { return nil }
        previewFrame.removeFromSuperview()
        return previewFrame
    }

    /// The tab bar rides into the docked header so surfaces stay switchable.
    func detachDockAccessory() -> NSView? {
        tabs.tabBar.removeFromSuperview()
        return tabs.tabBar
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
        if let accessory {
            accessory.translatesAutoresizingMaskIntoConstraints = false
            dragStrip.addSubview(accessory)
            NSLayoutConstraint.activate([
                accessory.leadingAnchor.constraint(equalTo: dragStrip.leadingAnchor),
                accessory.topAnchor.constraint(equalTo: dragStrip.topAnchor),
                accessory.bottomAnchor.constraint(equalTo: dragStrip.bottomAnchor),
                accessory.trailingAnchor.constraint(lessThanOrEqualTo: dragStrip.trailingAnchor, constant: -80),
            ])
        }
    }
}
