import AppKit
import Aperture
import AVFoundation

@MainActor
final class AppController: NSObject, NSApplicationDelegate, ReactableBridgeDelegate, StageCommandDelegate {
    private var agent: AgentWindowController?
    private var sidecar: NexusSidecar?
    private var stage: StageWindowController?
    private var bar: BarPanel?
    private var cam: CamBubblePanel?
    private var hotkeyMonitor: Any?
    private var localMonitor: Any?
    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenu?
    private var projectsMenuItem: NSMenuItem?
    private var decksMenuItem: NSMenuItem?
    private var takeRecorder: TakeRecorder?
    private var inputMonitor: InputMonitor?
    private var globalHotkeys: GlobalHotkeys?
    private var speakerNotes: SpeakerNotesPanel?
    private var areaPicker: AreaPickerController?
    private var stagePoller: StageCommandPoller?
    private let port = 4020
    private let bundledProjectRoot: URL
    private let nexusRoot: URL
    private var activeProjectURL: URL
    private let state = AppState()
    private var recordTimer: Timer?

    override init() {
        bundledProjectRoot = AppPaths.projectRoot()
        nexusRoot = AppPaths.nexusRoot(near: bundledProjectRoot)
        activeProjectURL = bundledProjectRoot
        super.init()
    }

    func applicationDidResignActive(_ notification: Notification) {
        // Belt-and-suspenders: panels stay put even when stage/browser takes focus.
        bar?.keepVisible()
        stage?.keepVisible()
        if state.camOn { cam?.orderFrontRegardless() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = Self.appIcon()
        setupMenuBar()
        Task { await boot() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showBar()
        if state.sourceKind == "stage" { openStage() }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        WindowDrag.end()
        if let hotkeyMonitor { NSEvent.removeMonitor(hotkeyMonitor) }
        hotkeyMonitor = nil
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        recordTimer?.invalidate()
        globalHotkeys?.stop()
        if takeRecorder?.isActive == true {
            inputMonitor?.stop()
            inputMonitor = nil
            Task { _ = try? await takeRecorder?.stop(cam: cam) }
        }
        stage?.close()
        stagePoller?.stop()
        bar?.close()
        cam?.setVisible(false)
        sidecar?.stop()
    }

    private static func appIcon() -> NSImage? {
        if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "png"),
           let img = NSImage(contentsOf: url) {
            return img
        }
        if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let img = NSImage(contentsOf: url) {
            return img
        }
        // Dev fallback when running outside a bundled .app
        if let resources = Bundle.main.resourceURL {
            let png = resources.appendingPathComponent("AppIcon.png")
            if let img = NSImage(contentsOf: png) { return img }
        }
        return nil
    }

    private static func menuBarIcon() -> NSImage? {
        guard let img = NSImage(systemSymbolName: "record.circle", accessibilityDescription: "Reactable") else { return nil }
        let sized = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            img.isTemplate = true
            img.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            return true
        }
        sized.isTemplate = true
        return sized
    }

    private func setupMenuBar() {
        setupApplicationMenu()

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = item

        if let icon = Self.menuBarIcon() {
            item.button?.image = icon
            item.button?.imagePosition = .imageOnly
        } else {
            item.button?.title = "◉"
        }
        item.button?.toolTip = "Reactable — click for menu (Show Stage ⌘O)"

        let menu = NSMenu()
        addMenuItem(menu, title: "Toggle Stage", action: #selector(toggleStage), key: "o")
        addMenuItem(menu, title: "Show Bar", action: #selector(showBar), key: "b")
        addMenuItem(menu, title: "Local Agent…", action: #selector(openAgent), key: "l")
        menu.addItem(.separator())
        projectsMenuItem = menu.addItem(withTitle: "Project", action: nil, keyEquivalent: "")
        projectsMenuItem?.submenu = NSMenu()
        decksMenuItem = menu.addItem(withTitle: "Deck", action: nil, keyEquivalent: "")
        decksMenuItem?.submenu = NSMenu()
        addMenuItem(menu, title: "Open Projects Folder…", action: #selector(revealProjectsFolder), key: "")
        addMenuItem(menu, title: "New Project…", action: #selector(createProject), key: "n")
        menu.addItem(.separator())
        addMenuItem(menu, title: "Record", action: #selector(toggleRecord), key: "r")
        addMenuItem(menu, title: "Next slide →", action: #selector(nextSlide), key: "]")
        addMenuItem(menu, title: "Prev slide ←", action: #selector(prevSlide), key: "[")
        menu.addItem(.separator())
        addMenuItem(menu, title: "Quit Reactable", action: #selector(quit), key: "q")
        statusMenu = menu
        item.menu = menu
    }

    /// App menu so ⌘O / ⌘H work when Reactable is the active app (NSMenu key equivalents).
    private func setupApplicationMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)

        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "Toggle Stage", action: #selector(toggleStage), keyEquivalent: "o").target = self
        appMenu.addItem(withTitle: "Show Bar", action: #selector(showBar), keyEquivalent: "b").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Reactable", action: #selector(quit), keyEquivalent: "q").target = self

        NSApp.mainMenu = main
    }

    private func addMenuItem(_ menu: NSMenu, title: String, action: Selector, key: String) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = self
    }

    private func boot() async {
        do {
            try ProjectRegistry.ensureUserLayout(bundledProject: bundledProjectRoot)
            let last = ProjectRegistry.lastSelection(
                defaultProject: ProjectRegistry.projectId(for: bundledProjectRoot),
                defaultDeck: "demo"
            )
            let discovered = ProjectRegistry.discover(extraBundled: bundledProjectRoot)
            if let pick = discovered.first(where: { $0.id == last.projectId }) ?? discovered.first {
                activeProjectURL = pick.url
            }
            let decks = ProjectRegistry.decks(in: activeProjectURL)
            state.deckSlug = decks.first(where: { $0.slug == last.deckSlug })?.slug ?? decks.first?.slug ?? "demo"

            let sc = NexusSidecar(nexusRoot: nexusRoot, projectRoot: activeProjectURL, port: port)
            try sc.start()
            try await sc.waitUntilReady()
            sidecar = sc
            bar = BarPanel(port: port, bridge: self)
            cam = CamBubblePanel()
            takeRecorder = TakeRecorder(projectRoot: activeProjectURL)
            refreshCatalog()
            globalHotkeys = GlobalHotkeys()
            globalHotkeys?.start { [weak self] action in
                Task { @MainActor in self?.handleGlobalAction(action) }
            }
            speakerNotes = SpeakerNotesPanel()
            areaPicker = AreaPickerController()
            areaPicker?.onPick = { [weak self] rect in
                Task { @MainActor in
                    self?.state.sourceKind = "area"
                    self?.state.areaRect = rect
                    self?.syncBar()
                }
            }
            installHotkeys()
            showBar()
            stagePoller = StageCommandPoller(port: port, delegate: self)
            stagePoller?.start()
            agent = AgentWindowController(port: port, deck: state.deckSlug, bridge: self)
            syncBar()
        } catch {
            fputs("reactable boot failed: \(error)\n", stderr)
            let alert = NSAlert()
            alert.messageText = "Reactable could not start"
            alert.informativeText = String(describing: error)
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    private func installHotkeys() {
        // Local monitor only — works when Reactable is active (no Accessibility permission needed).
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] ev in
            guard let self else { return ev }
            if self.handleHotkey(ev) { return nil }
            return ev
        }
    }

    @discardableResult
    private func handleHotkey(_ ev: NSEvent) -> Bool {
        let flags = ev.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags == .command {
            switch ev.charactersIgnoringModifiers?.lowercased() {
            case "r": toggleRecord(); return true
            case "b": showBar(); return true
            case "o": toggleStage(); return true
            default: break
            }
            return false
        }
        if flags.isEmpty {
            switch ev.keyCode {
            case 124: bridgeSlideNext(); return true
            case 123: bridgeSlidePrev(); return true
            case 49 where state.recording: bridgeRecordPause(); return true
            default: break
            }
        }
        return false
    }

    private func syncBar() {
        state.stageVisible = stage?.isVisible ?? false
        bar?.pushState(state)
    }

    // MARK: - ReactableBridgeDelegate

    func bridgeRecordStart(countdown: Int) {
        guard !state.recording else { return }
        if countdown > 0 {
            syncBar()
            Task {
                try? await Task.sleep(for: .seconds(UInt64(countdown)))
                await MainActor.run { self.beginRecording() }
            }
        } else {
            beginRecording()
        }
    }

    func bridgeRecordPause() {
        guard state.recording, let takeRecorder else { return }
        Task {
            do {
                if state.paused {
                    try await takeRecorder.resume()
                    state.paused = false
                } else {
                    try takeRecorder.pause()
                    state.paused = true
                }
                syncBar()
            } catch {
                fputs("reactable: pause/resume failed: \(error)\n", stderr)
            }
        }
    }

    private func handleGlobalAction(_ action: String) {
        switch action {
        case "record.toggle": toggleRecord()
        case "stage.open": toggleStage()
        case "bar.show": showBar()
        case "slide.next": bridgeSlideNext()
        case "slide.prev": bridgeSlidePrev()
        default: break
        }
    }

    private func setDesktopIconsVisible(_ visible: Bool) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
        task.arguments = ["write", "com.apple.finder", "CreateDesktop", visible ? "-bool true" : "-bool false"]
        try? task.run()
        task.waitUntilExit()
        let kill = Process()
        kill.executableURL = URL(fileURLWithPath: "/usr/bin/killall")
        kill.arguments = ["Finder"]
        try? kill.run()
    }

    private func quickShare(takeDir: URL) {
        let script = activeProjectURL.appending(path: "scripts/composite.py")
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        proc.arguments = [script.path(), takeDir.path()]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()
        proc.waitUntilExit()
        let final = takeDir.appending(path: "out/final.mp4")
        guard FileManager.default.fileExists(atPath: final.path) else { return }
        NSWorkspace.shared.activateFileViewerSelecting([final])
    }

    func bridgeRecordStop() {
        Task {
            inputMonitor?.stop()
            inputMonitor = nil
            var savedDir: URL?
            if let takeRecorder, takeRecorder.isActive {
                do {
                    savedDir = try await takeRecorder.stop(cam: cam)
                } catch {
                    fputs("reactable: stop failed: \(error)\n", stderr)
                }
            }
            state.recording = false
            state.paused = false
            state.elapsed = 0
            recordTimer?.invalidate()
            recordTimer = nil
            if state.hideDesktopIcons { setDesktopIconsVisible(true) }
            if state.hideDockWhileRecording { NSApp.setActivationPolicy(.regular) }
            syncBar()
            if state.quickShareAfter, let savedDir {
                quickShare(takeDir: savedDir)
            }
        }
    }

    func bridgeSlideNext() {
        stage?.nextSlide()
        bar?.pushState(state)
    }

    func bridgeSlidePrev() {
        stage?.prevSlide()
        bar?.pushState(state)
    }

    func bridgeSelectStage() {
        if state.sourceKind == "stage" {
            if stage?.isVisible == true {
                hideStage()
            } else {
                openStage()
            }
            syncBar()
            return
        }
        state.sourceKind = "stage"
        state.captureTargetId = nil
        state.areaRect = nil
        openStage()
        syncBar()
    }

    func bridgeBarClose() {
        hideStage()
        bar?.close()
        syncBar()
    }

    func bridgeSelectArea() {
        areaPicker?.begin()
    }

    func bridgeOpenEditor() {
        if let url = URL(string: "http://127.0.0.1:\(port)/editor") {
            NSWorkspace.shared.open(url)
        }
    }

    func bridgeOpenAgent() {
        agent?.setDeck(state.deckSlug)
        agent?.open()
    }

    func bridgeCreateProject(title: String) {
        Task { await createProject(title: title) }
    }

    @objc private func openAgent() {
        bridgeOpenAgent()
    }

    @objc private func createProjectPrompt() {
        let alert = NSAlert()
        alert.messageText = "New Reactable Project"
        alert.informativeText = "Creates a project under ~/Reactable/projects/"
        alert.addButton(withTitle: "Create")
        alert.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.placeholderString = "My Talk"
        alert.accessoryView = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let title = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        Task { await createProject(title: title) }
    }

    @objc private func createProject() {
        createProjectPrompt()
    }

    private func createProject(title: String) async {
        do {
            let project = try ProjectRegistry.createProject(title: title)
            await switchProject(id: project.id)
            state.deckSlug = project.id
            bridgeSelectDeck(slug: project.id)
            fputs("reactable: created project → \(project.url.path())\n", stderr)
        } catch {
            fputs("reactable: create project failed: \(error)\n", stderr)
        }
    }

    func bridgeSelectProject(id: String) {
        Task { await switchProject(id: id) }
    }

    func bridgeSelectDeck(slug: String) {
        guard state.recording == false else { return }
        state.deckSlug = slug
        if let deck = state.decks.first(where: { ($0["slug"] as? String) == slug }) {
            state.deckTitle = deck["title"] as? String ?? slug
        } else {
            state.deckTitle = slug
        }
        stage?.loadDeck(slug)
        agent?.setDeck(slug)
        ProjectRegistry.saveLastSelection(projectId: state.projectId, deckSlug: slug)
        syncBar()
        if state.sourceKind == "stage" { openStage() }
    }

    func bridgeRevealProjectsFolder() {
        revealProjectsFolder()
    }

    private func refreshCatalog() {
        let projects = ProjectRegistry.discover(extraBundled: bundledProjectRoot)
        state.projects = projects.map { ["id": $0.id, "name": $0.name] }
        state.projectId = ProjectRegistry.projectId(for: activeProjectURL)
        state.projectName = projects.first(where: { $0.url == activeProjectURL })?.name ?? activeProjectURL.lastPathComponent
        let decks = ProjectRegistry.decks(in: activeProjectURL)
        state.decks = decks.map { ["slug": $0.slug, "title": $0.title] }
        if !decks.contains(where: { $0.slug == state.deckSlug }) {
            state.deckSlug = decks.first?.slug ?? "demo"
        }
        if let deck = decks.first(where: { $0.slug == state.deckSlug }) {
            state.deckTitle = deck.title
        }
        rebuildStatusMenus(projects: projects, decks: decks)
        ProjectRegistry.saveLastSelection(projectId: state.projectId, deckSlug: state.deckSlug)
    }

    private func rebuildStatusMenus(projects: [ReactableProject], decks: [DeckInfo]) {
        guard let pMenu = projectsMenuItem?.submenu, let dMenu = decksMenuItem?.submenu else { return }
        pMenu.removeAllItems()
        dMenu.removeAllItems()
        for project in projects {
            let item = pMenu.addItem(
                withTitle: project.name,
                action: #selector(statusProjectPicked(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = project.id
            item.state = project.url == activeProjectURL ? .on : .off
        }
        if projects.isEmpty {
            pMenu.addItem(withTitle: "No projects — open Projects folder", action: #selector(revealProjectsFolder), keyEquivalent: "").target = self
        }
        for deck in decks {
            let item = dMenu.addItem(
                withTitle: deck.title,
                action: #selector(statusDeckPicked(_:)),
                keyEquivalent: ""
            )
            item.target = self
            item.representedObject = deck.slug
            item.state = deck.slug == state.deckSlug ? .on : .off
        }
        if decks.isEmpty {
            dMenu.addItem(withTitle: "No decks in project", action: nil, keyEquivalent: "").isEnabled = false
        }
    }

    private func switchProject(id: String) async {
        guard state.recording == false else {
            fputs("reactable: stop recording before switching projects\n", stderr)
            return
        }
        let projects = ProjectRegistry.discover(extraBundled: bundledProjectRoot)
        guard let project = projects.first(where: { $0.id == id }) else { return }
        guard project.url != activeProjectURL else { return }

        activeProjectURL = project.url
        sidecar?.setProjectRoot(project.url)
        do {
            try await sidecar?.restart()
        } catch {
            fputs("reactable: project switch failed: \(error)\n", stderr)
            return
        }
        takeRecorder = TakeRecorder(projectRoot: activeProjectURL)
        refreshCatalog()
        stage?.loadDeck(state.deckSlug)
        bar?.reload()
        syncBar()
        fputs("reactable: project → \(project.name)\n", stderr)
    }

    @objc private func statusProjectPicked(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        bridgeSelectProject(id: id)
    }

    @objc private func statusDeckPicked(_ sender: NSMenuItem) {
        guard let slug = sender.representedObject as? String else { return }
        bridgeSelectDeck(slug: slug)
    }

    @objc private func revealProjectsFolder() {
        let url = ProjectRegistry.userProjectsDir
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }

    func bridgeCaptureSetTarget(kind: String, id: String?) {
        state.sourceKind = kind
        state.captureTargetId = id
        if kind != "area" { state.areaRect = nil }
        fputs("reactable: capture target \(kind) \(id ?? "—")\n", stderr)
        syncBar()
    }

    func bridgeCamToggle(on: Bool) {
        state.camOn = on
        cam?.setVisible(on)
        if on { cam?.setMirror(state.camMirror); cam?.setSize(CGFloat(state.camSize)) }
        syncBar()
    }

    func bridgeCamMirror(_ on: Bool) {
        state.camMirror = on
        cam?.setMirror(on)
        syncBar()
    }

    func bridgeCamMove(x: Double, y: Double) {
        fputs("reactable: cam position \(x),\(y)\n", stderr)
    }

    func bridgeCamResize(size: Double) {
        state.camSize = size
        cam?.setSize(CGFloat(size))
        syncBar()
    }

    func bridgeMicToggle(on: Bool) {
        state.micOn = on
        syncBar()
    }

    func bridgeSystemAudioToggle(on: Bool) {
        state.systemAudioOn = on
        syncBar()
    }

    func bridgeSettingSet(key: String, value: Bool) {
        switch key {
        case "hideDockWhileRecording": state.hideDockWhileRecording = value
        case "hideDesktopIcons": state.hideDesktopIcons = value
        case "highlightArea": state.highlightArea = value
        case "speakerNotes": state.speakerNotes = value
        case "quickShareAfter": state.quickShareAfter = value
        case "countdown": state.countdownSeconds = value ? 3 : 0
        case "camMirror":
            state.camMirror = value
            cam?.setMirror(value)
        default: break
        }
        fputs("reactable: setting \(key)=\(value)\n", stderr)
        if key == "speakerNotes" {
            if value {
                speakerNotes?.showPanel()
                syncSpeakerNotes()
            } else {
                speakerNotes?.hidePanel()
            }
        }
        syncBar()
    }

    func bridgeCopyAgentPrompt() {
        AgentPrompt.copyToPasteboard(projectRoot: activeProjectURL, deck: state.deckSlug)
        fputs("reactable: agent prompt copied to pasteboard\n", stderr)
    }

    func bridgeRequestDevices(includeIOS: Bool = false) {
        Task { await refreshDevices(requestAccess: true, includeIOS: includeIOS) }
    }

    private func refreshDevices(requestAccess: Bool = false, includeIOS: Bool = false) async {
        var payload: [String: Any] = [
            "sources": [
                ["kind": "stage", "label": "Stage window"],
                ["kind": "display", "label": "Display"],
                ["kind": "window", "label": "Window"],
                ["kind": "area", "label": "Area"],
                ["kind": "device", "label": "iPhone / external"],
            ],
            "screens": [] as [[String: String]],
            "windows": [] as [[String: String]],
            "ios": [] as [[String: String]],
            "screenCaptureGranted": ScreenCaptureAccess.isGranted,
        ]

        let mayEnumerate = ScreenCaptureAccess.isGranted
            || (requestAccess && ScreenCaptureAccess.requestIfNeeded())

        guard mayEnumerate else {
            bar?.pushDevices(payload)
            return
        }

        payload["screenCaptureGranted"] = true

        do {
            let screens = try await Aperture.Devices.screen()
            payload["screens"] = screens.map { ["id": $0.id, "label": $0.name] }
            let windows = try await Aperture.Devices.window(excludeDesktopWindows: true, onScreenWindowsOnly: true)
            payload["windows"] = windows.prefix(20).map { ["id": $0.id, "label": $0.title ?? $0.appName ?? $0.id] }
            if includeIOS {
                let ios = Aperture.Devices.iOS()
                payload["ios"] = ios.map { ["id": $0.id, "label": $0.name] }
            }
        } catch {
            fputs("reactable devices: \(error)\n", stderr)
        }
        bar?.pushDevices(payload)
    }

    private func beginRecording() {
        guard let takeRecorder else {
            presentRecordError("Recorder not ready", "No active project. Open or create a project, then try again.")
            return
        }
        Task {
            do {
                // Preflight source selection — tell the user instead of failing silently.
                if state.sourceKind == "stage" {
                    if stage == nil || stage?.isVisible != true { openStage() }
                    try await Task.sleep(for: .milliseconds(400))
                } else if state.sourceKind == "window", state.captureTargetId == nil {
                    presentRecordError("Pick a window first", "Choose the window to record from the bar, then press record.")
                    return
                } else if state.sourceKind == "area", state.areaRect == nil {
                    presentRecordError("Select an area first", "Drag to select the screen area to record, then press record.")
                    return
                } else if state.sourceKind == "device", state.captureTargetId == nil {
                    presentRecordError("Pick a device first", "Choose the capture device from the bar, then press record.")
                    return
                }

                // Preflight TCC permissions — prompt (or send to Settings) BEFORE
                // starting capture, so a missing grant is actionable, not a dead button.
                if !ScreenCaptureAccess.requestIfNeeded() {
                    presentPermissionError(
                        "Screen Recording permission needed",
                        "Enable Reactable under Screen & System Audio Recording, then press record again.",
                        pane: "Privacy_ScreenCapture"
                    )
                    return
                }
                if state.camOn, !(await requestCaptureAccess(.video)) {
                    presentPermissionError(
                        "Camera permission needed",
                        "Enable Reactable under Camera, or turn the camera off in the bar.",
                        pane: "Privacy_Camera"
                    )
                    return
                }
                if state.micOn, !(await requestCaptureAccess(.audio)) {
                    presentPermissionError(
                        "Microphone permission needed",
                        "Enable Reactable under Microphone, or turn the mic off in the bar.",
                        pane: "Privacy_Microphone"
                    )
                    return
                }

                if state.hideDesktopIcons { setDesktopIconsVisible(false) }
                DeckScripts.fire(port: port, deck: state.deckSlug, trigger: "record.start")
                state.recording = true
                state.paused = false
                state.elapsed = 0
                if state.hideDockWhileRecording { NSApp.setActivationPolicy(.accessory) }

                _ = try await takeRecorder.start(
                    sourceKind: state.sourceKind,
                    captureTargetId: state.captureTargetId,
                    areaRect: state.areaRect,
                    stageWindow: stage?.captureWindow,
                    deck: state.deckSlug,
                    cam: cam,
                    camOn: state.camOn,
                    micOn: state.micOn,
                    systemAudioOn: state.systemAudioOn
                )

                inputMonitor = InputMonitor()
                inputMonitor?.start { [weak self] type, payload in
                    self?.takeRecorder?.stamp(type, payload: payload)
                }

                recordTimer?.invalidate()
                recordTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                    Task { @MainActor in
                        guard let self, self.state.recording, !self.state.paused else { return }
                        self.state.elapsed += 1
                        self.syncBar()
                    }
                }
                syncBar()
            } catch {
                inputMonitor?.stop()
                inputMonitor = nil
                state.recording = false
                state.paused = false
                if state.hideDockWhileRecording { NSApp.setActivationPolicy(.regular) }
                syncBar()
                fputs("reactable: record start failed: \(error)\n", stderr)
                presentRecordError("Recording failed to start", "\(error)")
            }
        }
    }

    private func requestCaptureAccess(_ mediaType: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized: return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: mediaType)
        default:
            return false
        }
    }

    private func presentRecordError(_ title: String, _ info: String) {
        state.recording = false
        state.paused = false
        syncBar()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = info
        alert.addButton(withTitle: "OK")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func presentPermissionError(_ title: String, _ info: String, pane: String) {
        state.recording = false
        state.paused = false
        syncBar()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = info
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn {
            let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)")!
            NSWorkspace.shared.open(url)
        }
    }

    private func wireStageEvents(_ controller: StageWindowController) {
        controller.onEvent = { [weak self] type, payload in
            guard let self else { return }
            takeRecorder?.stamp(type, payload: payload)
            if self.state.speakerNotes {
                if type == "notes" {
                    self.speakerNotes?.setText(payload["text"] as? String ?? "")
                    self.speakerNotes?.showPanel()
                } else if type == "slide", let notes = payload["notes"] as? String, !notes.isEmpty {
                    self.speakerNotes?.setText(notes)
                    self.speakerNotes?.showPanel()
                } else if type == "deck" {
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(350))
                        self.syncSpeakerNotes()
                    }
                }
            }
        }
    }

    private func syncSpeakerNotes() {
        guard state.speakerNotes else { return }
        stage?.fetchCurrentNotes { [weak self] text in
            Task { @MainActor in
                self?.speakerNotes?.setText(text)
                self?.speakerNotes?.showPanel()
            }
        }
    }

    // MARK: - StageCommandDelegate (agent/CLI → native stage)

    func stageCommandOpen(deck: String?) {
        if let deck, deck != state.deckSlug {
            bridgeSelectDeck(slug: deck)
        } else {
            openStage()
        }
    }

    func stageCommandHide() {
        hideStage()
    }

    func stageCommandLoad(deck: String) {
        bridgeSelectDeck(slug: deck)
    }

    func stageLiveState() -> (deck: String, visible: Bool, projectId: String) {
        (deck: state.deckSlug, visible: stage?.isVisible ?? false, projectId: state.projectId)
    }

    // MARK: - Menu actions

    @objc private func showBar() { bar?.open(); syncBar() }

    @objc private func openStage() {
        fputs("reactable: openStage\n", stderr)
        if stage == nil {
            let ctrl = StageWindowController(port: port, deck: state.deckSlug, bridge: self)
            wireStageEvents(ctrl)
            stage = ctrl
        }
        stage?.open()
        syncBar()
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func hideStage() {
        fputs("reactable: hideStage\n", stderr)
        stage?.hide()
        syncBar()
    }

    @objc private func toggleStage() {
        if stage?.isVisible == true {
            hideStage()
        } else {
            state.sourceKind = "stage"
            openStage()
        }
    }
    @objc private func toggleRecord() {
        if state.recording { bridgeRecordStop() }
        else { bridgeRecordStart(countdown: state.countdownSeconds) }
    }
    @objc private func nextSlide() { bridgeSlideNext() }
    @objc private func prevSlide() { bridgeSlidePrev() }
    @objc private func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let controller = AppController()
app.delegate = controller
app.setActivationPolicy(.regular)
app.run()
