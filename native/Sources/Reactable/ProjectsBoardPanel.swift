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
    private var shell: PanelShell?
    var dockHost: DockGroupController?

    /// Default-layout placement — set the window frame if it exists.
    func place(frame: NSRect) {
        window?.setFrame(frame, display: true)
    }
    private var webView: WKWebView?

    var dataProvider: (() -> [String: Any])?
    var onSelect: ((String, String) -> Void)?
    var onStage: ((String, String) -> Void)?
    var onNew: (() -> Void)?
    var onNote: ((String, String) -> Void)?
    var onDrop: (([URL]) -> Void)?
    var onAddLink: ((String) -> Void)?
    var onDropData: ((String, Data) -> Void)?
    var onReveal: ((String) -> Void)?
    var onDelete: ((String) -> Void)?
    var onPreview: ((String) -> Void)?

    init(port: Int) {
        self.port = port
        super.init()
    }

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
            pushData()
            return
        }
        if window == nil { createWindow() }
        guard let win = window else { return }
        NSApp.activate(ignoringOtherApps: true)
        center(win)
        win.makeKeyAndOrderFront(nil)
        pushData()
    }

    func hide() {
        if dockHost != nil {
            DockController.shared.undock(self, show: false)
            return
        }
        window?.orderOut(nil)
    }

    func pushData() {
        guard let data = dataProvider?() else {
            FileHandle.standardError.write(Data("projects: pushData — no dataProvider\n".utf8))
            return
        }
        guard JSONSerialization.isValidJSONObject(data),
              let json = try? JSONSerialization.data(withJSONObject: data),
              let str = String(data: json, encoding: .utf8) else {
            FileHandle.standardError.write(Data("projects: pushData — data not JSON-serializable\n".utf8))
            return
        }
        webView?.evaluateJavaScript("window.ReactableProjects?.setData(\(str))") { _, err in
            if let err {
                FileHandle.standardError.write(Data("projects: setData failed: \(err)\n".utf8))
            }
        }
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
        shell = PanelChrome.install(in: win, content: web, title: "Projects") { [weak self] in self?.hide() }
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/projects")!))
        window = win
    }

    private func center(_ win: NSWindow) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        let s = win.frame.size
        win.setFrameOrigin(NSPoint(x: f.midX - s.width / 2, y: f.midY - s.height / 2 + f.height * 0.04))
    }

    func windowDidBecomeKey(_ notification: Notification) {
        pushData()
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
        case "projects.addmedia":
            let mode = parsed.payload["mode"] as? String ?? "file"
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = true
            panel.canChooseDirectories = mode == "folder"
            panel.canChooseFiles = mode != "folder"
            NSApp.activate(ignoringOtherApps: true)
            if panel.runModal() == .OK, !panel.urls.isEmpty {
                onDrop?(panel.urls)
            }
        case "projects.dropdata":
            if let name = parsed.payload["name"] as? String,
               let b64 = parsed.payload["data"] as? String,
               let bytes = Data(base64Encoded: b64) {
                onDropData?(name, bytes)
            }
        case "projects.addlink":
            if let u = parsed.payload["url"] as? String { onAddLink?(u) }
        case "projects.preview":
            if let p = parsed.payload["path"] as? String { onPreview?(p) }
        case "projects.delete":
            if let p = parsed.payload["path"] as? String { onDelete?(p) }
        case "projects.reveal":
            if let p = parsed.payload["path"] as? String { onReveal?(p) }
        case "projects.note":
            if let p = parsed.payload["path"] as? String {
                onNote?(p, parsed.payload["note"] as? String ?? "")
            }
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


extension ProjectsBoardPanel: DockablePanel {
    var dockKey: String { "projects" }
    var dockTitle: String { "Projects" }
    var dockMinSize: NSSize { NSSize(width: 220, height: 260) }
    var panelWindow: NSWindow? { window }

    func ensureLoaded() {
        if window == nil { createWindow() }
    }

    func detachDockBody() -> NSView? { shell?.detachContent() }

    func reattachDockBody(_ body: NSView, accessory: NSView?) {
        shell?.attachContent()
    }
}

// WKWebView that accepts file drags natively (a hitTest-nil overlay never
// receives them — AppKit routes drag destinations through hitTest).
@MainActor
final class DropWebView: WKWebView {
    var onDropFiles: (([URL]) -> Void)?

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }
    required init?(coder: NSCoder) { nil }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self]) as? [URL] ?? []
        guard !urls.isEmpty else { return super.performDragOperation(sender) }
        onDropFiles?(urls)
        return true
    }
}
