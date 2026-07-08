import AppKit
import AVKit
import WebKit

// The ONE preview window: every "open this thing" from the projects board
// lands here as a tab (takes, videos, audio, images, docs, links, decks).
// The editor's center panel in Edit mode; floats on its own in Record mode.
// Unlike the stage (content fills the window for capture), preview content
// keeps a fixed aspect ratio letterboxed inside a freely resizable panel.

/// Aspect-fits its `contentHost` centered in the bounds — the letterbox.
@MainActor
final class AspectBoxView: NSView {
    /// Width / height. A future floating ratio switcher writes this.
    var aspect: CGFloat = 16.0 / 9.0 { didSet { needsLayout = true } }

    let contentHost = NSView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = Chrome.bgContent.cgColor
        contentHost.wantsLayer = true
        contentHost.layer?.backgroundColor = NSColor.black.cgColor
        addSubview(contentHost)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        guard bounds.width > 1, bounds.height > 1 else { return }
        var w = bounds.width
        var h = w / aspect
        if h > bounds.height {
            h = bounds.height
            w = h * aspect
        }
        contentHost.frame = NSRect(
            x: (bounds.width - w) / 2,
            y: (bounds.height - h) / 2,
            width: w.rounded(.down),
            height: h.rounded(.down)
        )
    }
}

@MainActor
final class PreviewPanel: NSObject, NSWindowDelegate {
    private let port: Int
    private let projectRoot: () -> URL
    private let projectId: () -> String

    private var window: NSWindow?
    private var webView: WKWebView?
    private var playerView: AVPlayerView?
    private var aspectBox: AspectBoxView?
    private var frameView: ContentFrameView?
    private var stripTitle: NSTextField?
    private var savedFrame: NSRect?
    private var rootView: NSView?
    private var dragStrip: DragStripView?
    var dockHost: DockGroupController?
    private let defaultContent = NSSize(width: 960, height: 560)

    private let tabs = SurfaceTabStrip()
    private var takeItems: [String: AVPlayerItem] = [:]

    /// Fixed content ratio (default 16:9). Scoped for the future floating
    /// ratio switcher — no UI writes it yet.
    var previewAspect: CGFloat = 16.0 / 9.0 {
        didSet { aspectBox?.aspect = previewAspect }
    }

    var openSurfaces: [StageSurface] { tabs.surfaces }

    init(port: Int, projectRoot: @escaping () -> URL, projectId: @escaping () -> String) {
        self.port = port
        self.projectRoot = projectRoot
        self.projectId = projectId
        super.init()
        tabs.minTabsForBar = 1  // the preview window always shows its tabs
        tabs.onActivate = { [weak self] s in self?.show(surface: s) }
        tabs.onCloseSurface = { [weak self] s in self?.takeItems.removeValue(forKey: s.key) }
        tabs.onEmpty = { [weak self] in self?.hide() }
    }

    /// Open (or focus) a surface as a preview tab and reveal the panel.
    func openSurface(_ s: StageSurface) {
        if window == nil { createWindow() }
        tabs.open(s)
        open()
    }

    // MARK: - Content switching

    private static let playerKinds: Set<String> = ["take", "video", "audio"]

    private func show(surface s: StageSurface) {
        stripTitle?.stringValue = s.title
        if Self.playerKinds.contains(s.kind) {
            pauseWeb()
            webView?.isHidden = true
            playerView?.isHidden = false
            playerView?.player = AVPlayer(playerItem: playerItem(for: s))
            playerView?.player?.play()
        } else {
            playerView?.player?.pause()
            playerView?.isHidden = true
            webView?.isHidden = false
            webView?.load(URLRequest(url: url(for: s)))
        }
    }

    private func playerItem(for s: StageSurface) -> AVPlayerItem? {
        if let cached = takeItems[s.key] { return cached }
        let item: AVPlayerItem?
        switch s.kind {
        case "take":
            item = TakeComposition.build(takeDir: projectRoot().appending(path: s.ref))?.item
        default:
            item = AVPlayerItem(url: projectRoot().appending(path: s.ref))
        }
        if let item { takeItems[s.key] = item }
        return item
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

    private func pauseWeb() {
        webView?.evaluateJavaScript(
            "document.querySelectorAll('video,audio').forEach(v=>v.pause())")
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
        win.minSize = Chrome.shellSize(for: NSSize(width: 480, height: 280))
        win.title = "Reactable Preview"
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
        dragStrip.toolTip = "Drag to move preview"
        self.dragStrip = dragStrip

        let tabBar = tabs.tabBar
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        dragStrip.addSubview(tabBar)

        let frame = ContentFrameView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frameView = frame

        let box = AspectBoxView()
        box.aspect = previewAspect
        aspectBox = box
        frame.install(box)

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        Chrome.injectTokens(into: config)
        let web = WKWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.wantsLayer = true
        web.layer?.backgroundColor = NSColor.black.cgColor
        web.autoresizingMask = [.width, .height]
        web.frame = box.contentHost.bounds
        webView = web
        box.contentHost.addSubview(web)

        let player = AVPlayerView()
        player.controlsStyle = .floating
        player.autoresizingMask = [.width, .height]
        player.frame = box.contentHost.bounds
        player.isHidden = true
        playerView = player
        box.contentHost.addSubview(player)

        root.addSubview(dragStrip)
        root.addSubview(frame)

        NSLayoutConstraint.activate([
            dragStrip.topAnchor.constraint(equalTo: root.topAnchor),
            dragStrip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            dragStrip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            dragStrip.heightAnchor.constraint(equalToConstant: Chrome.dragStripHeight),

            tabBar.leadingAnchor.constraint(equalTo: dragStrip.leadingAnchor),
            tabBar.topAnchor.constraint(equalTo: dragStrip.topAnchor),
            tabBar.bottomAnchor.constraint(equalTo: dragStrip.bottomAnchor),
            tabBar.trailingAnchor.constraint(lessThanOrEqualTo: dragStrip.trailingAnchor, constant: -80),

            frame.topAnchor.constraint(equalTo: dragStrip.bottomAnchor, constant: Chrome.gapBelowDrag),
            frame.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            frame.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            frame.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ])

        stripTitle = PanelChrome.decorate(strip: dragStrip, title: "Preview") { [weak self] in self?.hide() }
        ResizeCornersView.attach(to: root)
        window = win
        centerOnScreen(win, size: shell)
        savedFrame = win.frame
        tabs.rebuild()
    }

    func open() {
        if let dockHost {
            dockHost.reveal()
            return
        }
        if window == nil { createWindow() }
        guard let win = window else { return }
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

    func hide() {
        playerView?.player?.pause()
        pauseWeb()
        if dockHost != nil {
            DockController.shared.undock(self, show: false)
            return
        }
        guard let win = window, win.isVisible else { return }
        savedFrame = win.frame
        win.orderOut(nil)
    }

    func toggle() {
        if isVisible { hide() } else { open() }
    }

    /// Default-layout placement — animate to the frame if the window's onscreen.
    func place(frame: NSRect) {
        window?.setFrame(frame, display: true, animate: window?.isVisible ?? false)
    }

    var isVisible: Bool {
        if let dockHost { return dockHost.window.isVisible }
        return window?.isVisible ?? false
    }

    private func centerOnScreen(_ win: NSWindow, size: NSSize) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        win.setFrameOrigin(NSPoint(x: f.midX - size.width / 2, y: f.midY - size.height / 2))
    }

    func windowWillClose(_ notification: Notification) {
        playerView?.player?.pause()
        window = nil
        webView = nil
        playerView = nil
        aspectBox = nil
        frameView = nil
        savedFrame = nil
        rootView = nil
        dragStrip = nil
    }
}

extension PreviewPanel: DockablePanel {
    var dockKey: String { "preview" }
    var dockTitle: String { "Preview" }
    var dockMinSize: NSSize { NSSize(width: 480, height: 320) }
    var panelWindow: NSWindow? { window }

    func ensureLoaded() {
        if window == nil { createWindow() }
    }

    func detachDockBody() -> NSView? {
        guard let frameView else { return nil }
        frameView.removeFromSuperview()
        return frameView
    }

    /// The tab bar rides into the docked header so previews stay switchable.
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
