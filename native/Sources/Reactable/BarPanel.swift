import AppKit
import AVFoundation
import WebKit

// 48px control row + 8px bottom zone for the mic meter strip (bar/index.work)
private let barHeight: CGFloat = 56

@MainActor
private final class BarMenuTarget: NSObject {
    weak var panel: BarPanel?

    @objc func windowPicked(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        panel?.pickWindow(id)
    }

    @objc func displayPicked(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        panel?.pickSource(kind: "display", id: id)
    }

    @objc func devicePicked(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        panel?.pickSource(kind: "device", id: id)
    }

    @objc func areaPick(_ sender: NSMenuItem) {
        panel?.pickArea()
    }

    // Capture-source picker entries (the single "capture" button's menu).
    @objc func captureStage(_ sender: NSMenuItem) { panel?.pickCaptureStage() }
    @objc func captureArea(_ sender: NSMenuItem) { panel?.pickArea() }
    @objc func captureDisplayMenu(_ sender: NSMenuItem) {
        panel?.requestDevicesThen { $0.showDisplayMenu(anchor: ["x": 120, "y": 0, "h": 32]) }
    }
    @objc func captureWindowMenu(_ sender: NSMenuItem) {
        panel?.requestDevicesThen { $0.showWindowMenu(anchor: ["x": 120, "y": 0, "h": 32]) }
    }
    @objc func captureDeviceMenu(_ sender: NSMenuItem) {
        panel?.requestDevicesThen(includeIOS: true) { $0.showDeviceMenu(anchor: ["x": 120, "y": 0, "h": 32]) }
    }

    @objc func micSourcePicked(_ sender: NSMenuItem) {
        panel?.pickMicSource(sender.representedObject as? String)
    }

    @objc func camSourcePicked(_ sender: NSMenuItem) {
        panel?.pickCamSource(sender.representedObject as? String)
    }

    @objc func projectPicked(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        panel?.pickProject(id)
    }

    @objc func deckPicked(_ sender: NSMenuItem) {
        guard let slug = sender.representedObject as? String else { return }
        panel?.pickDeck(slug)
    }

    @objc func revealProjects(_ sender: NSMenuItem) {
        panel?.revealProjectsFolder()
    }

    @objc func displayPickedMenu(_ sender: NSMenuItem) {
        panel?.showDisplayMenu(anchor: ["x": 80, "y": 0, "h": 32])
    }

    @objc func devicePickedMenu(_ sender: NSMenuItem) {
        panel?.showDeviceMenu(anchor: ["x": 80, "y": 0, "h": 32])
    }

    @objc func projectPickedMenu(_ sender: NSMenuItem) {
        panel?.showProjectsMenu(anchor: ["x": 80, "y": 0, "h": 32])
    }

    @objc func deckPickedMenu(_ sender: NSMenuItem) {
        panel?.showDecksMenu(anchor: ["x": 80, "y": 0, "h": 32])
    }

    @objc func toggleSetting(_ sender: NSMenuItem) {
        panel?.toggleSetting(sender)
    }

    @objc func copyAgentPrompt(_ sender: NSMenuItem) {
        panel?.copyAgentPrompt()
    }

    @objc func openAgent(_ sender: NSMenuItem) {
        panel?.openAgent()
    }

    @objc func createProject(_ sender: NSMenuItem) {
        panel?.createProject()
    }

    // Overflow (⋯) menu — the docked bar's progressive disclosure.
    @objc func camToggled(_ sender: NSMenuItem) { panel?.overflowCamToggle() }
    @objc func micToggled(_ sender: NSMenuItem) { panel?.overflowMicToggle() }
    @objc func sysToggled(_ sender: NSMenuItem) { panel?.overflowSysToggle() }
    @objc func camSourceFromOverflow(_ sender: NSMenuItem) { panel?.overflowCamSource() }
    @objc func micSourceFromOverflow(_ sender: NSMenuItem) { panel?.overflowMicSource() }
    @objc func stageManagerFromOverflow(_ sender: NSMenuItem) { panel?.overflowStageManager() }
    @objc func projectsBoardFromOverflow(_ sender: NSMenuItem) { panel?.overflowProjectsBoard() }
    @objc func settingsFromOverflow(_ sender: NSMenuItem) { panel?.overflowSettings() }
}

@MainActor
final class BarPanel: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private weak var bridge: ReactableBridgeDelegate?
    private var panel: NSPanel?
    private var webView: WKWebView?
    private var devicesPayload: [String: Any] = [:]
    private var appState = AppState()
    private let menuTarget = BarMenuTarget()
    private var overflowAnchor: [String: Any] = [:]
    var dockHost: DockGroupController?

    init(port: Int, bridge: ReactableBridgeDelegate) {
        self.port = port
        self.bridge = bridge
        super.init()
        menuTarget.panel = self
    }

    func ensureLoaded() {
        guard panel == nil else { return }

        let config = WKWebViewConfiguration()
        Chrome.injectTokens(into: config)
        config.userContentController.add(self, name: "reactable")
        config.mediaTypesRequiringUserActionForPlayback = []

        let web = WKWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        webView = web

        let p = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: barHeight),
            styleMask: [.nonactivatingPanel, .fullSizeContentView, .hudWindow],
            backing: .buffered,
            defer: false
        )
        p.isFloatingPanel = true
        p.level = .floating
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        FloatingWindow.configurePanel(p)
        p.titlebarAppearsTransparent = true
        p.titleVisibility = .hidden
        p.isMovableByWindowBackground = false
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true
        p.delegate = self
        p.contentView = web
        web.autoresizingMask = [.width, .height]
        panel = p

        centerOnScreen(p)
        web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/bar")!))
    }

    func open() {
        if let dockHost {
            dockHost.reveal()
            return
        }
        ensureLoaded()
        panel?.orderFrontRegardless()
    }

    func close() {
        if dockHost != nil {
            DockController.shared.undock(self, show: false)
        }
        panel?.close()
        panel = nil
        webView = nil
    }

    func moveBy(dx: CGFloat, dy: CGFloat) {
        guard dockHost == nil, let panel else { return }
        var origin = panel.frame.origin
        origin.x += dx
        origin.y -= dy
        panel.setFrameOrigin(origin)
        // The bar drags itself (web grip), not through WindowDrag — feed the
        // dock controller so drop zones light up while it moves.
        DockController.shared.dragMoved(window: panel, mouse: NSEvent.mouseLocation)
    }

    /// Web grip released after a drag — dock if it ended over a drop zone.
    func dragEnded() {
        guard dockHost == nil, let panel else { return }
        _ = DockController.shared.dragEnded(window: panel, mouse: NSEvent.mouseLocation)
    }

    func resizeToContentWidth(_ width: CGFloat) {
        guard dockHost == nil, let panel else { return }
        let minW: CGFloat = 640
        let maxW: CGFloat = 1200
        let pad: CGFloat = 24
        let nextW = min(maxW, max(minW, width + pad))
        guard abs(panel.frame.width - nextW) > 1 else { return }
        let midX = panel.frame.midX
        var f = panel.frame
        f.size.width = nextW
        f.origin.x = midX - nextW / 2
        panel.setFrame(f, display: true)
    }

    var isOpen: Bool { panel != nil }

    func keepVisible() {
        guard dockHost == nil else { return }
        panel?.orderFrontRegardless()
    }

    func reload() {
        webView?.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/bar")!))
    }

    func pushState(_ state: AppState) {
        appState = state
        guard let data = try? JSONSerialization.data(withJSONObject: state.toJSON()),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.ReactableBar?.setState(\(json))")
    }

    func pushMicLevel(_ level: Float) {
        webView?.evaluateJavaScript("window.ReactableBar?.setMicLevel(\(level))")
    }

    func pushDevices(_ devices: [String: Any]) {
        devicesPayload = devices
        guard let data = try? JSONSerialization.data(withJSONObject: devices),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.ReactableBar?.setDevices(\(json))")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        route(parsed.action, payload: parsed.payload)
    }

    private func route(_ action: String, payload: [String: Any]) {
        guard let bridge else { return }
        switch action {
        case "bar.ready":
            pushState(appState)
            // A reload while docked must re-learn its docked chrome.
            if dockHost != nil { dockStateChanged(docked: true) }
        case "record.start":
            bridge.bridgeRecordStart(countdown: payload["countdown"] as? Int ?? 3)
        case "record.pause": bridge.bridgeRecordPause()
        case "record.stop": bridge.bridgeRecordStop()
        case "slide.next": bridge.bridgeSlideNext()
        case "slide.prev": bridge.bridgeSlidePrev()
        case "stage.toggle":
            bridge.bridgeToggleStage()
        case "mode.edit":
            bridge.bridgeSetMode(edit: true)
        case "capture.menu":
            showCaptureMenu(anchor: payload)
        case "capture.selectStage":
            bridge.bridgeSelectStage()
        case "capture.selectWindow":
            bridge.bridgeRequestDevices(includeIOS: false)
            showWindowMenu(anchor: payload)
        case "capture.selectArea":
            bridge.bridgeSelectArea()
        case "capture.selectDisplay":
            bridge.bridgeRequestDevices(includeIOS: false)
            showDisplayMenu(anchor: payload)
        case "capture.selectDevice":
            bridge.bridgeRequestDevices(includeIOS: true)
            showDeviceMenu(anchor: payload)
        case "capture.setTarget":
            bridge.bridgeCaptureSetTarget(kind: payload["kind"] as? String ?? "stage", id: payload["id"] as? String)
        case "cam.toggle":
            bridge.bridgeCamToggle(on: payload["on"] as? Bool ?? false)
        case "cam.mirror":
            bridge.bridgeCamMirror(payload["on"] as? Bool ?? true)
        case "cam.move":
            bridge.bridgeCamMove(x: payload["x"] as? Double ?? 0, y: payload["y"] as? Double ?? 0)
        case "cam.resize":
            bridge.bridgeCamResize(size: payload["size"] as? Double ?? 160)
        case "stage.manager":
            bridge.bridgeOpenStageManager()
        case "projects.board":
            bridge.bridgeOpenProjectsBoard()
        case "mic.sourceMenu":
            showMicSourceMenu(anchor: payload)
        case "cam.sourceMenu":
            showCamSourceMenu(anchor: payload)
        case "mic.toggle":
            bridge.bridgeMicToggle(on: payload["on"] as? Bool ?? false)
        case "systemAudio.toggle":
            bridge.bridgeSystemAudioToggle(on: payload["on"] as? Bool ?? true)
        case "setting.set":
            if let key = payload["key"] as? String, let val = payload["value"] as? Bool {
                bridge.bridgeSettingSet(key: key, value: val)
            }
        case "devices.list":
            break
        case "bar.close":
            bridge.bridgeBarClose()
        case "bar.moveBy":
            let dx = payload["dx"] as? Double ?? 0
            let dy = payload["dy"] as? Double ?? 0
            moveBy(dx: CGFloat(dx), dy: CGFloat(dy))
        case "bar.moveEnd":
            dragEnded()
        case "bar.tearOut":
            // Docked grip dragged — pop back out to a float; WindowDrag owns
            // the rest of the gesture (the web pointer stream dies on reparent).
            if let host = dockHost {
                DockController.shared.tearOut(key: dockKey, from: host)
            }
        case "bar.resize":
            if let w = payload["width"] as? Double {
                resizeToContentWidth(CGFloat(w))
            }
        case "bar.menu.overflow":
            overflowAnchor = payload
            showOverflowMenu(anchor: payload)
        case "bar.menu.settings":
            bridge.bridgeOpenSettings()
            return
        case "bar.menu.settings.legacy":
            showSettingsMenu(anchor: payload)
        case "bar.menu.projects":
            showProjectsMenu(anchor: payload)
        case "bar.menu.decks":
            showDecksMenu(anchor: payload)
        case "agent.open":
            bridge.bridgeOpenAgent()
        default:
            fputs("reactable bar: unknown action \(action)\n", stderr)
        }
    }

    fileprivate func pickWindow(_ id: String) { pickSource(kind: "window", id: id) }

    fileprivate func pickSource(kind: String, id: String) {
        bridge?.bridgeCaptureSetTarget(kind: kind, id: id)
    }

    fileprivate func pickArea() {
        bridge?.bridgeSelectArea()
    }

    fileprivate func pickProject(_ id: String) {
        bridge?.bridgeSelectProject(id: id)
    }

    fileprivate func pickDeck(_ slug: String) {
        bridge?.bridgeSelectDeck(slug: slug)
    }

    fileprivate func revealProjectsFolder() {
        bridge?.bridgeRevealProjectsFolder()
    }

    fileprivate func showProjectsMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let list = appState.projects
        let menu = NSMenu()
        for entry in list {
            guard let id = entry["id"] as? String, let name = entry["name"] as? String else { continue }
            let item = NSMenuItem(title: name, action: #selector(BarMenuTarget.projectPicked(_:)), keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = id
            item.state = id == appState.projectId ? .on : .off
            menu.addItem(item)
        }
        if list.isEmpty {
            menu.addItem(withTitle: "No projects found", action: nil, keyEquivalent: "").isEnabled = false
        }
        menu.addItem(.separator())
        let newProj = menu.addItem(withTitle: "New project…", action: #selector(BarMenuTarget.createProject(_:)), keyEquivalent: "")
        newProj.target = menuTarget
        let open = menu.addItem(withTitle: "Open Projects folder…", action: #selector(BarMenuTarget.revealProjects(_:)), keyEquivalent: "")
        open.target = menuTarget
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func showDecksMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let menu = NSMenu()
        for entry in appState.decks {
            guard let slug = entry["slug"] as? String else { continue }
            let title = entry["title"] as? String ?? slug
            let item = NSMenuItem(title: title, action: #selector(BarMenuTarget.deckPicked(_:)), keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = slug
            item.state = slug == appState.deckSlug ? .on : .off
            menu.addItem(item)
        }
        if appState.decks.isEmpty {
            menu.addItem(withTitle: "No decks in this project", action: nil, keyEquivalent: "").isEnabled = false
        }
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func toggleSetting(_ item: NSMenuItem) {
        guard let key = item.representedObject as? String else { return }
        let next = item.state != .on
        item.state = next ? .on : .off
        if key == "countdown" {
            appState.countdownSeconds = next ? 3 : 0
            bridge?.bridgeSettingSet(key: "countdown", value: next)
        } else if key == "camMirror" {
            bridge?.bridgeSettingSet(key: "camMirror", value: next)
        } else {
            bridge?.bridgeSettingSet(key: key, value: next)
        }
    }

    fileprivate func copyAgentPrompt() {
        bridge?.bridgeCopyAgentPrompt()
    }

    fileprivate func openAgent() {
        bridge?.bridgeOpenAgent()
    }

    fileprivate func createProject() {
        let alert = NSAlert()
        alert.messageText = "New Reactable Project"
        alert.informativeText = "Creates ~/Reactable/projects/<slug>"
        alert.addButton(withTitle: "Create")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.placeholderString = "My Talk"
        alert.accessoryView = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let title = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        bridge?.bridgeCreateProject(title: title)
    }

    /// Docked progressive disclosure: everything the narrow bar hides, in one
    /// native menu anchored to the ⋯ button.
    fileprivate func showOverflowMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let menu = NSMenu()
        func item(_ title: String, _ sel: Selector, on: Bool = false) {
            let it = menu.addItem(withTitle: title, action: sel, keyEquivalent: "")
            it.target = menuTarget
            it.state = on ? .on : .off
        }
        item("Camera", #selector(BarMenuTarget.camToggled(_:)), on: appState.camOn)
        item("Camera source…", #selector(BarMenuTarget.camSourceFromOverflow(_:)))
        item("Microphone", #selector(BarMenuTarget.micToggled(_:)), on: appState.micOn)
        item("Microphone source…", #selector(BarMenuTarget.micSourceFromOverflow(_:)))
        item("System audio", #selector(BarMenuTarget.sysToggled(_:)), on: appState.systemAudioOn)
        menu.addItem(.separator())
        item("Projects board…", #selector(BarMenuTarget.projectsBoardFromOverflow(_:)))
        item("Stage Manager…", #selector(BarMenuTarget.stageManagerFromOverflow(_:)))
        item("Local agent…", #selector(BarMenuTarget.openAgent(_:)))
        menu.addItem(.separator())
        item("Settings…", #selector(BarMenuTarget.settingsFromOverflow(_:)))
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func overflowCamToggle() { bridge?.bridgeCamToggle(on: !appState.camOn) }
    fileprivate func overflowMicToggle() { bridge?.bridgeMicToggle(on: !appState.micOn) }
    fileprivate func overflowSysToggle() { bridge?.bridgeSystemAudioToggle(on: !appState.systemAudioOn) }
    fileprivate func overflowCamSource() { showCamSourceMenu(anchor: overflowAnchor) }
    fileprivate func overflowMicSource() { showMicSourceMenu(anchor: overflowAnchor) }
    fileprivate func overflowStageManager() { bridge?.bridgeOpenStageManager() }
    fileprivate func overflowProjectsBoard() { bridge?.bridgeOpenProjectsBoard() }
    fileprivate func overflowSettings() { bridge?.bridgeOpenSettings() }

    // Capture-source picker — one menu for the whole capture-target choice,
    // decoupled from stage visibility. Stage / Display / Window / Area / Device.
    fileprivate func showCaptureMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let kind = appState.sourceKind
        let menu = NSMenu()
        func item(_ title: String, _ sel: Selector, on: Bool) {
            let it = menu.addItem(withTitle: title, action: sel, keyEquivalent: "")
            it.target = menuTarget
            it.state = on ? .on : .off
        }
        item("Stage window", #selector(BarMenuTarget.captureStage(_:)), on: kind == "stage")
        item("Entire display…", #selector(BarMenuTarget.captureDisplayMenu(_:)), on: kind == "display")
        item("A window…", #selector(BarMenuTarget.captureWindowMenu(_:)), on: kind == "window")
        item("Screen area…", #selector(BarMenuTarget.captureArea(_:)), on: kind == "area")
        item("Capture device…", #selector(BarMenuTarget.captureDeviceMenu(_:)), on: kind == "device")
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func pickCaptureStage() {
        bridge?.bridgeSelectStage()
    }

    fileprivate func requestDevicesThen(includeIOS: Bool = false, _ show: @escaping (BarPanel) -> Void) {
        bridge?.bridgeRequestDevices(includeIOS: includeIOS)
        // devicesPayload updates async via pushDevices; the menus read the cached
        // list, so a short delay lets a fresh enumeration land before we show it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            guard let self else { return }
            show(self)
        }
    }

    fileprivate func showWindowMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let list = devicesPayload["windows"] as? [[String: Any]] ?? []

        let menu = NSMenu()
        if list.isEmpty {
            let item = NSMenuItem(title: "No windows found", action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        } else {
            for entry in list {
                guard let id = entry["id"] as? String, let label = entry["label"] as? String else { continue }
                let item = NSMenuItem(title: label, action: #selector(BarMenuTarget.windowPicked(_:)), keyEquivalent: "")
                item.target = menuTarget
                item.representedObject = id
                item.state = appState.sourceKind == "window" && appState.captureTargetId == id ? .on : .off
                menu.addItem(item)
            }
        }
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    private func showSettingsMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let s = appState
        let menu = NSMenu()

        addToggle(menu, title: "Countdown (3s)", key: "countdown", on: s.countdownSeconds > 0)
        addToggle(menu, title: "Hide dock while recording", key: "hideDockWhileRecording", on: s.hideDockWhileRecording)
        addToggle(menu, title: "Hide desktop icons", key: "hideDesktopIcons", on: s.hideDesktopIcons)
        addToggle(menu, title: "Highlight recorded area", key: "highlightArea", on: s.highlightArea)

        menu.addItem(.separator())

        addToggle(menu, title: "Speaker notes", key: "speakerNotes", on: s.speakerNotes)
        addToggle(menu, title: "Mirror camera", key: "camMirror", on: s.camMirror)
        addToggle(menu, title: "Quick-share after export", key: "quickShareAfter", on: s.quickShareAfter)

        menu.addItem(.separator())

        let agentItem = menu.addItem(withTitle: "Local agent…", action: #selector(BarMenuTarget.openAgent(_:)), keyEquivalent: "")
        agentItem.target = menuTarget

        let copyPrompt = menu.addItem(withTitle: "Copy agent prompt…", action: #selector(BarMenuTarget.copyAgentPrompt(_:)), keyEquivalent: "")
        copyPrompt.target = menuTarget

        menu.addItem(.separator())

        let projectItem = NSMenuItem(title: "Project", action: nil, keyEquivalent: "")
        let projectSub = NSMenu()
        for entry in appState.projects {
            guard let id = entry["id"] as? String, let name = entry["name"] as? String else { continue }
            let item = NSMenuItem(title: name, action: #selector(BarMenuTarget.projectPicked(_:)), keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = id
            item.state = id == appState.projectId ? .on : .off
            projectSub.addItem(item)
        }
        if appState.projects.isEmpty {
            projectSub.addItem(withTitle: "No projects", action: nil, keyEquivalent: "").isEnabled = false
        }
        projectSub.addItem(.separator())
        let newProject = projectSub.addItem(withTitle: "New project…", action: #selector(BarMenuTarget.createProject(_:)), keyEquivalent: "")
        newProject.target = menuTarget
        let openFolder = projectSub.addItem(withTitle: "Open Projects folder…", action: #selector(BarMenuTarget.revealProjects(_:)), keyEquivalent: "")
        openFolder.target = menuTarget
        projectItem.submenu = projectSub
        menu.addItem(projectItem)

        let deckItem = NSMenuItem(title: "Deck", action: nil, keyEquivalent: "")
        let deckSub = NSMenu()
        for entry in appState.decks {
            guard let slug = entry["slug"] as? String else { continue }
            let title = entry["title"] as? String ?? slug
            let item = NSMenuItem(title: title, action: #selector(BarMenuTarget.deckPicked(_:)), keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = slug
            item.state = slug == appState.deckSlug ? .on : .off
            deckSub.addItem(item)
        }
        if appState.decks.isEmpty {
            deckSub.addItem(withTitle: "No decks", action: nil, keyEquivalent: "").isEnabled = false
        }
        deckItem.submenu = deckSub
        menu.addItem(deckItem)

        menu.addItem(.separator())
        for (title, sel) in [
            ("Capture: Display…", #selector(BarMenuTarget.displayPickedMenu(_:))),
            ("Capture: Area…", #selector(BarMenuTarget.areaPick(_:))),
            ("Capture: Device…", #selector(BarMenuTarget.devicePickedMenu(_:))),
        ] {
            let item = menu.addItem(withTitle: title, action: sel, keyEquivalent: "")
            item.target = menuTarget
        }

        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func showDisplayMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let list = devicesPayload["screens"] as? [[String: Any]] ?? []
        let menu = NSMenu()
        for entry in list {
            guard let id = entry["id"] as? String, let label = entry["label"] as? String else { continue }
            let item = NSMenuItem(title: label, action: #selector(BarMenuTarget.displayPicked(_:)), keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = id
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func pickMicSource(_ uid: String?) {
        bridge?.bridgeMicSourceSet(uid: uid)
    }

    fileprivate func pickCamSource(_ uid: String?) {
        bridge?.bridgeCamSourceSet(uid: uid)
    }

    /// Shared source-picker menu: "System default" + every device of the
    /// given media type, checkmarking the persisted selection.
    private func showSourceMenu(
        anchor: [String: Any],
        mediaType: AVMediaType,
        deviceTypes: [AVCaptureDevice.DeviceType],
        defaultsKey: String,
        action: Selector
    ) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let current = UserDefaults.standard.string(forKey: defaultsKey)
        let menu = NSMenu()
        let def = NSMenuItem(title: "System default", action: action, keyEquivalent: "")
        def.target = menuTarget
        def.representedObject = nil
        def.state = current == nil ? .on : .off
        menu.addItem(def)
        menu.addItem(.separator())
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: deviceTypes, mediaType: mediaType, position: .unspecified
        ).devices
        if devices.isEmpty {
            menu.addItem(withTitle: "No devices found", action: nil, keyEquivalent: "").isEnabled = false
        }
        for device in devices {
            let item = NSMenuItem(title: device.localizedName, action: action, keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = device.uniqueID
            item.state = current == device.uniqueID ? .on : .off
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    fileprivate func showMicSourceMenu(anchor: [String: Any]) {
        showSourceMenu(
            anchor: anchor,
            mediaType: .audio,
            deviceTypes: [.microphone, .external],
            defaultsKey: "reactable.micDeviceUID",
            action: #selector(BarMenuTarget.micSourcePicked(_:))
        )
    }

    fileprivate func showCamSourceMenu(anchor: [String: Any]) {
        showSourceMenu(
            anchor: anchor,
            mediaType: .video,
            deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
            defaultsKey: "reactable.camDeviceUID",
            action: #selector(BarMenuTarget.camSourcePicked(_:))
        )
    }

    fileprivate func showDeviceMenu(anchor: [String: Any]) {
        guard let webView, let point = menuPoint(from: anchor, in: webView) else { return }
        let list = devicesPayload["ios"] as? [[String: Any]] ?? []
        let menu = NSMenu()
        if list.isEmpty {
            menu.addItem(withTitle: "No devices connected", action: nil, keyEquivalent: "").isEnabled = false
        }
        for entry in list {
            guard let id = entry["id"] as? String, let label = entry["label"] as? String else { continue }
            let item = NSMenuItem(title: label, action: #selector(BarMenuTarget.devicePicked(_:)), keyEquivalent: "")
            item.target = menuTarget
            item.representedObject = id
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: point, in: webView)
    }

    private func addToggle(_ menu: NSMenu, title: String, key: String, on: Bool) {
        let item = NSMenuItem(title: title, action: #selector(BarMenuTarget.toggleSetting(_:)), keyEquivalent: "")
        item.target = menuTarget
        item.representedObject = key
        item.state = on ? .on : .off
        menu.addItem(item)
    }

    private func menuPoint(from anchor: [String: Any], in webView: WKWebView) -> NSPoint? {
        let x = CGFloat(anchor["x"] as? Double ?? 0)
        let y = CGFloat(anchor["y"] as? Double ?? 0)
        let h = CGFloat(anchor["h"] as? Double ?? 0)
        return NSPoint(x: x, y: webView.bounds.height - y - h)
    }

    private func centerOnScreen(_ p: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        let x = f.midX - p.frame.width / 2
        let y = f.maxY - barHeight - 16
        p.setFrameOrigin(NSPoint(x: x, y: y))
    }
}

extension BarPanel: DockablePanel {
    var dockKey: String { "bar" }
    var dockTitle: String { "Controls" }
    var dockMinSize: NSSize { NSSize(width: 260, height: barHeight) }
    var dockFixedHeight: CGFloat? { barHeight }
    /// The bar keeps its own grip as the tear-out handle — no cell header.
    var dockShowsHeader: Bool { false }
    /// A horizontal strip — docks above or below panels, never as a column.
    var dockAllowedEdges: [DockEdge] { [.top, .bottom] }
    var panelWindow: NSWindow? { panel }

    func detachDockBody() -> NSView? {
        guard let webView else { return nil }
        panel?.contentView = NSView()
        return webView
    }

    func reattachDockBody(_ body: NSView, accessory: NSView?) {
        body.translatesAutoresizingMaskIntoConstraints = true
        body.autoresizingMask = [.width, .height]
        panel?.contentView = body
    }

    /// Docked bar drops its own window chrome (grip, close) and turns on
    /// width-responsive tiers; floating restores the full strip.
    func dockStateChanged(docked: Bool) {
        webView?.evaluateJavaScript("window.ReactableBar?.setDocked(\(docked))")
    }
}
