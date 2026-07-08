import AppKit
import Aperture
import AVFoundation

@MainActor
final class AppController: NSObject, NSApplicationDelegate, ReactableBridgeDelegate, StageCommandDelegate {
    private var agent: AgentWindowController?
    private var palette: PaletteWindowController?
    private var stageManager: StageManagerPanel?
    private var projectsBoard: ProjectsBoardPanel?
    private var settingsPanel: SettingsPanel?
    private var cachedSlides: [[String: Any]] = []
    // The rundown: the deck of the video. Defaults to the current deck's
    // slides; the manager edits it; the DOCK ARROWS are the only navigation.
    private var lineup: [[String: Any]] = []
    private var lineupIndex = 0
    private let captureOutline = CaptureOutline()
    private let micMeter = MicMeter()
    private var micTimer: Timer?
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
        micTimer?.invalidate()
        micMeter.stop()
        globalHotkeys?.stop()
        if takeRecorder?.isActive == true {
            micMeter.endWriting()
            inputMonitor?.stop()
            inputMonitor = nil
            Task { _ = try? await takeRecorder?.stop(cam: cam) }
        }
        terminateDevProcesses()
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
        addMenuItem(menu, title: "Find Surface…", action: #selector(togglePalette), key: "i")
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
                defaultDeck: "showcase"
            )
            let discovered = ProjectRegistry.discover(extraBundled: bundledProjectRoot)
            if let pick = discovered.first(where: { $0.id == last.projectId }) ?? discovered.first {
                activeProjectURL = pick.url
            }
            let decks = ProjectRegistry.decks(in: activeProjectURL)
            state.deckSlug = decks.first(where: { $0.slug == last.deckSlug })?.slug ?? decks.first?.slug ?? "showcase"

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
            restoreCaptureToggles()
            Task {
                await self.refreshDeckSlides()
                self.loadStageLineup()
            }
            installHotkeys()
            // Stage resizes invalidate the (fixed-dimension) warm capture
            // stream; while recording the size is locked, so this only fires
            // when idle — re-prewarm with the new geometry.
            NotificationCenter.default.addObserver(
                forName: NSWindow.didEndLiveResizeNotification, object: nil, queue: .main
            ) { [weak self] note in
                let resized = (note.object as? NSWindow).map(ObjectIdentifier.init)
                Task { @MainActor in
                    guard let self, let resized,
                          let stageWindow = self.stage?.captureWindow,
                          resized == ObjectIdentifier(stageWindow),
                          !self.state.recording else { return }
                    self.prewarmCapture()
                }
            }
            showBar()
            stagePoller = StageCommandPoller(port: port, delegate: self)
            stagePoller?.start()
            agent = AgentWindowController(port: port, deck: state.deckSlug, bridge: self)
            let pal = PaletteWindowController(port: port)
            pal.onOpenSurface = { [weak self] surface in
                guard let self else { return }
                if self.stage == nil || self.stage?.isVisible != true { self.openStage() }
                self.stage?.openSurface(surface)
            }
            palette = pal
            let mgr = StageManagerPanel(port: port)
            mgr.dataProvider = { [weak self] in self?.stageManagerCatalog() ?? [:] }
            mgr.onSaveLineup = { [weak self] lineup in self?.saveStageLineup(lineup) }
            mgr.onActivate = { [weak self] entry in
                self?.activateScene(entry)
            }
            mgr.onApplyDeckOrder = { [weak self] ids in
                self?.applyDeckOrder(ids)
            }
            stageManager = mgr
            let board = ProjectsBoardPanel(port: port)
            board.dataProvider = { [weak self] in self?.projectsBoardData() ?? [:] }
            board.onSelect = { [weak self] root, slug in self?.selectProjectDeck(root: root, slug: slug) }
            board.onStage = { [weak self] id, stage in self?.setProjectStage(id: id, stage: stage) }
            board.onNew = { [weak self] in self?.createProject() }
            board.onNote = { [weak self] p, note in self?.saveAssetNote(path: p, note: note) }
            board.onDrop = { [weak self] urls in self?.importAssets(urls) }
            projectsBoard = board
            syncBar()
            arrangeDefaultLayout()
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
            case "i": togglePalette(); return true
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
        state.agentVisible = agent?.isVisible ?? false
        state.captureLabel = captureTargetLabel()
        bar?.pushState(state)
    }

    private func captureTargetLabel() -> String {
        switch state.sourceKind {
        case "display": return "Display"
        case "window": return "Window"
        case "area": return "Area"
        case "device": return "Device"
        default: return "Stage"
        }
    }

    // MARK: - ReactableBridgeDelegate

    func bridgeRecordStart(countdown: Int) {
        guard !state.recording, !state.arming else { return }
        state.arming = true
        syncBar()
        // Prep (stage open, permission preflights) runs DURING the countdown,
        // not after it — capture starts at the countdown's end, not 1-2s later.
        beginRecording(countdown: countdown)
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
        case "palette.toggle": togglePalette()
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
            micMeter.endWriting()
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
            state.arming = false
            state.elapsed = 0
            recordTimer?.invalidate()
            recordTimer = nil
            stage?.captureWindow?.styleMask.insert(.resizable)
            if state.hideDesktopIcons { setDesktopIconsVisible(true) }
            if state.hideDockWhileRecording { NSApp.setActivationPolicy(.regular) }
            syncBar()
            projectsBoard?.pushData()  // the new take shows up in assets
            prewarmCapture()  // warm the stream for the next take
            if state.quickShareAfter, let savedDir {
                quickShare(takeDir: savedDir)
            }
        }
    }

    func bridgeSlideNext() { advanceLineup(1) }

    private func advanceLineup(_ delta: Int) {
        guard !lineup.isEmpty else {
            if delta > 0 { stage?.nextSlide() } else { stage?.prevSlide() }
            bar?.pushState(state)
            return
        }
        let next = max(0, min(lineup.count - 1, lineupIndex + delta))
        guard next != lineupIndex || lineup.count == 1 else { bar?.pushState(state); return }
        lineupIndex = next
        activateScene(lineup[lineupIndex])
        bar?.pushState(state)
    }

    func bridgeSlidePrev() { advanceLineup(-1) }

    // Stage visibility — independent of the capture target (you can show the
    // stage while recording a window, or record the stage while it's hidden).
    func bridgeToggleStage() {
        if stage?.isVisible == true { hideStage() } else { openStage() }
    }

    // Capture-target selectors set what recording grabs; they no longer touch
    // stage visibility.
    func bridgeSelectStage() {
        state.sourceKind = "stage"
        state.captureTargetId = nil
        state.areaRect = nil
        if stage?.isVisible != true { openStage() }
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

    func bridgeOpenAgent() {
        agent?.setDeck(state.deckSlug)
        agent?.toggle()
        state.agentVisible = agent?.isVisible ?? false
        syncBar()
    }

    func bridgeCreateProject(title: String) {
        Task { await createProject(title: title) }
    }

    @objc private func openAgent() {
        bridgeOpenAgent()
    }

    @objc private func togglePalette() {
        palette?.toggle()
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
            state.deckSlug = decks.first?.slug ?? "showcase"
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
        // A registered-but-missing project (stale registry entry) used to
        // crash in NexusSidecar.start (ObjC exception in Process setup).
        guard FileManager.default.fileExists(atPath: project.url.appending(path: "index.work").path) else {
            fputs("reactable: project \(id) missing on disk — not switching\n", stderr)
            return
        }

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
        prewarmCapture()
    }

    func bridgeCamToggle(on: Bool) {
        state.camOn = on
        UserDefaults.standard.set(on, forKey: "reactable.camOn")
        cam?.setVisible(on)
        if on { cam?.setMirror(state.camMirror); cam?.setSize(CGFloat(state.camSize)) }
        syncBar()
    }

    // Mic/cam/system-audio survive relaunch. A silent reset to mic-off cost a
    // spoken take: the user re-recorded on a fresh launch and got no voice track.
    private func restoreCaptureToggles() {
        let d = UserDefaults.standard
        if let micUID = d.string(forKey: "reactable.micDeviceUID") {
            micMeter.setInputDevice(uid: micUID)
        }
        if let camUID = d.string(forKey: "reactable.camDeviceUID") {
            cam?.setDevice(uid: camUID)
        }
        if d.object(forKey: "reactable.micOn") != nil, d.bool(forKey: "reactable.micOn") {
            bridgeMicToggle(on: true)
        }
        if d.object(forKey: "reactable.camOn") != nil, d.bool(forKey: "reactable.camOn") {
            bridgeCamToggle(on: true)
        }
        if d.object(forKey: "reactable.systemAudioOn") != nil {
            state.systemAudioOn = d.bool(forKey: "reactable.systemAudioOn")
        }
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
        UserDefaults.standard.set(on, forKey: "reactable.micOn")
        if on {
            micMeter.start()
            micTimer?.invalidate()
            // Poll the meter on the main thread (~20fps) and push to the bar —
            // the audio thread never touches the webview / main actor.
            micTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.bar?.pushMicLevel(self?.micMeter.level() ?? 0) }
            }
        } else {
            micTimer?.invalidate()
            micTimer = nil
            micMeter.stop()
            bar?.pushMicLevel(0)
        }
        syncBar()
    }

    func bridgeSystemAudioToggle(on: Bool) {
        state.systemAudioOn = on
        UserDefaults.standard.set(on, forKey: "reactable.systemAudioOn")
        syncBar()
        prewarmCapture()  // stream audio flag changed — warm stream is stale
    }

    func bridgeOpenSettings() {
        if settingsPanel == nil { settingsPanel = SettingsPanel(port: port) }
        settingsPanel?.toggle()
    }

    func bridgeOpenProjectsBoard() {
        projectsBoard?.toggle()
    }

    private var pipelineURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Reactable/pipeline.json")
    }

    /// A project is what the stage shows — every deck across registered
    /// roots. Pipeline stages keyed root/slug, shared with the CLI.
    private func projectsBoardData() -> [String: Any] {
        var projects: [[String: Any]] = []
        for root in ProjectRegistry.discover(extraBundled: bundledProjectRoot)
        where FileManager.default.fileExists(atPath: root.url.appending(path: "index.work").path) {
            for deck in ProjectRegistry.decks(in: root.url) {
                projects.append(["root": root.id, "slug": deck.slug, "title": deck.title])
            }
        }
        var columns = ["idea", "recording", "editing", "done"]
        var stages: [String: String] = [:]
        if let data = try? Data(contentsOf: pipelineURL),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            columns = obj["columns"] as? [String] ?? columns
            stages = obj["stages"] as? [String: String] ?? [:]
        }
        return [
            "columns": columns,
            "projects": projects,
            "stages": stages,
            "active": "\(state.projectId)/\(state.deckSlug)",
        ]
    }

    /// Switch the whole app to a project (root + deck the stage shows).
    private func selectProjectDeck(root: String, slug: String) {
        Task {
            if root != state.projectId {
                await switchProject(id: root)
            }
            bridgeSelectDeck(slug: slug)
            Task {
                await self.refreshDeckSlides()
                self.loadStageLineup()
                self.projectsBoard?.pushData()
            }
        }
    }

    /// Default layout: bar top-center, then one row that always fits the
    /// screen — projects | stage | agent, centered below the bar.
    private func arrangeDefaultLayout() {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        openStage()
        projectsBoard?.open()
        if agent?.isVisible != true { bridgeOpenAgent() }

        let gap: CGFloat = 14
        let margin: CGFloat = 12
        let projW: CGFloat = 270
        let agentW: CGFloat = 420
        let stageH = min(f.height - 120, 720)
        let stageW = min(920, f.width - projW - agentW - gap * 2 - margin * 2)
        let total = projW + gap + stageW + gap + agentW
        let startX = f.midX - total / 2
        let y = f.maxY - 66 - gap - stageH

        projectsBoard?.place(frame: NSRect(x: startX, y: y, width: projW, height: stageH))
        stage?.place(frame: NSRect(x: startX + projW + gap, y: y, width: stageW, height: stageH))
        agent?.place(frame: NSRect(x: startX + projW + gap + stageW + gap, y: y, width: agentW, height: stageH))
    }

    private func setProjectStage(id: String, stage: String) {
        var obj: [String: Any] = ["columns": ["idea", "recording", "editing", "done"], "stages": [:]]
        if let data = try? Data(contentsOf: pipelineURL),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            obj = parsed
        }
        var stages = obj["stages"] as? [String: String] ?? [:]
        stages[id] = stage
        obj["stages"] = stages
        if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted]) {
            try? data.write(to: pipelineURL)
        }
        fputs("reactable: project \(id) → \(stage)\n", stderr)
    }

    func bridgeOpenStageManager() {
        if stageManager?.isVisible == true {
            stageManager?.hide()
            return
        }
        Task {
            await refreshDeckSlides()
            stageManager?.open()
        }
    }

    /// Current deck's slides for the manager — each is a lineup-able scene.
    private func refreshDeckSlides() async {
        cachedSlides = []
        guard let url = URL(string: "http://127.0.0.1:\(port)/reactable/deck?deck=\(state.deckSlug)"),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let slides = obj["slides"] as? [[String: Any]] else { return }
        cachedSlides = slides.enumerated().map { i, slide in
            ["idx": i,
             "id": slide["id"] as? String ?? "slide-\(i + 1)",
             "type": slide["type"] as? String ?? "html"]
        }
    }

    /// Everything recordable, for the Stage Manager's search: on-screen
    /// windows, displays, project decks, open stage tabs + saved lineup.
    private func stageManagerCatalog() -> [String: Any] {
        var windows: [[String: Any]] = []
        let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        if let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] {
            for w in list {
                guard (w[kCGWindowLayer as String] as? Int) == 0,
                      let id = w[kCGWindowNumber as String] as? Int,
                      let app = w[kCGWindowOwnerName as String] as? String,
                      app != "Reactable"
                else { continue }
                let title = w[kCGWindowName as String] as? String ?? ""
                windows.append(["id": id, "app": app, "title": title])
            }
        }
        let displays: [[String: Any]] = NSScreen.screens.compactMap { screen in
            guard let num = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
            else { return nil }
            return ["id": num.intValue, "name": screen.localizedName]
        }
        let tabs: [[String: Any]] = (stage?.openSurfaces ?? []).map {
            ["kind": $0.kind, "ref": $0.ref, "title": $0.title]
        }
        return [
            "windows": windows,
            "displays": displays,
            "decks": state.decks,
            "slides": cachedSlides,
            "deckSlug": state.deckSlug,
            "tabs": tabs,
            "lineup": lineup,
            "files": projectFiles(),
            "notes": loadAssetNotes(),
        ] as [String: Any]
    }

    private var assetNotesURL: URL { activeProjectURL.appending(path: ".reactable/asset-notes.json") }

    private func loadAssetNotes() -> [String: String] {
        (try? JSONSerialization.jsonObject(with: Data(contentsOf: assetNotesURL))) as? [String: String] ?? [:]
    }

    private func saveAssetNote(path: String, note: String) {
        var notes = loadAssetNotes()
        if note.isEmpty { notes.removeValue(forKey: path) } else { notes[path] = note }
        try? FileManager.default.createDirectory(
            at: assetNotesURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: notes, options: [.prettyPrinted]) {
            try? d.write(to: assetNotesURL)
        }
    }

    private func importAssets(_ urls: [URL]) {
        let dest = activeProjectURL.appending(path: "assets")
        try? FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
        for url in urls {
            let to = dest.appending(path: url.lastPathComponent)
            try? FileManager.default.copyItem(at: url, to: to)
        }
        fputs("reactable: imported \(urls.count) asset(s)\n", stderr)
        projectsBoard?.pushData()
    }

    /// The project's media, code abstracted away: takes + assets (+ root media).
    private func projectFiles() -> [[String: Any]] {
        var out: [[String: Any]] = []
        let fm = FileManager.default
        let takes = activeProjectURL.appending(path: "takes")
        if let items = try? fm.contentsOfDirectory(atPath: takes.path) {
            for t in items.sorted(by: >) where t.hasPrefix("take") {
                out.append(["name": t, "path": "takes/\(t)", "group": "Takes", "icon": "take", "sub": ""])
            }
        }
        let assets = activeProjectURL.appending(path: "assets")
        if let en = fm.enumerator(at: assets, includingPropertiesForKeys: nil) {
            for case let f as URL in en where !f.hasDirectoryPath {
                let rel = f.path.replacingOccurrences(of: assets.path + "/", with: "")
                let ext = f.pathExtension.lowercased()
                let icon = ["mov", "mp4", "webm"].contains(ext) ? "video"
                    : ["wav", "mp3", "m4a", "aiff"].contains(ext) ? "audio"
                    : ["png", "jpg", "jpeg", "gif", "webp"].contains(ext) ? "image" : "file"
                let group = rel.contains("/") ? "assets/" + rel.components(separatedBy: "/")[0] : "Assets"
                out.append(["name": f.lastPathComponent, "path": "assets/\(rel)", "group": group, "icon": icon, "sub": ext])
                if out.count > 240 { break }
            }
        }
        return out
    }

    private func saveStageLineup(_ newLineup: [[String: Any]]) {
        let url = activeProjectURL.appending(path: "stage-lineup.json")
        if let data = try? JSONSerialization.data(withJSONObject: newLineup, options: [.prettyPrinted]) {
            try? data.write(to: url)
        }
        lineup = newLineup
        // Slide order in the lineup IS the deck order — keep deck.work true.
        let ids = newLineup.compactMap { ($0["kind"] as? String) == "slide" ? $0["slideId"] as? String : nil }
        let deckIds = cachedSlides.compactMap { $0["id"] as? String }.filter { ids.contains($0) }
        if !ids.isEmpty, ids != deckIds { applyDeckOrder(ids) }
        // The first entry IS the opening shot — reflect it immediately.
        lineupIndex = 0
        if let first = lineup.first { activateScene(first) }
    }

    /// Load the saved rundown, or default it to the current deck's slides —
    /// the deck IS the lineup until edited.
    private func loadStageLineup() {
        let url = activeProjectURL.appending(path: "stage-lineup.json")
        if let data = try? Data(contentsOf: url),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
           !arr.isEmpty {
            lineup = arr
        } else {
            lineup = cachedSlides.map { slide in
                let idx = slide["idx"] as? Int ?? 0
                let id = slide["id"] as? String ?? "slide-\(idx + 1)"
                return ["kind": "slide", "ref": String(idx), "slideId": id, "title": id]
            }
        }
        lineupIndex = 0
    }

    /// Activate a lineup scene: decks/web tabs land on the stage; windows and
    /// displays switch the capture target (and re-prewarm for it).
    private func activateScene(_ entry: [String: Any]) {
        let kind = entry["kind"] as? String ?? "web"
        let ref = entry["ref"] as? String ?? ""
        let title = entry["title"] as? String ?? ref
        takeRecorder?.stamp("scene", payload: ["kind": kind, "ref": ref, "title": title])

        // Mid-take: hand the recording off to the new target as a segment.
        if state.recording, let takeRecorder, takeRecorder.isActive {
            let stageBound = !["window", "display"].contains(kind)
            let sourceKind = stageBound ? "stage" : kind
            let targetId = stageBound ? nil : ref
            Task {
                await takeRecorder.switchScene(
                    sourceKind: sourceKind,
                    captureTargetId: targetId,
                    areaRect: nil,
                    stageWindow: self.stage?.captureWindow,
                    stageContentRect: stageBound ? self.stage?.deckContentRect : nil,
                    systemAudioOn: self.state.systemAudioOn
                )
            }
        }
        prewarmUpcomingScene(after: entry)

        switch kind {
        case "slide":
            // A deck slide IS a lineup scene: jump the stage to it.
            captureOutline.hide()
            if stage == nil || stage?.isVisible != true { openStage() }
            stage?.gotoSlide(Int(ref) ?? 0)
            bridgeSelectStage()
        case "deck":
            captureOutline.hide()
            bridgeSelectDeck(slug: ref)
            bridgeSelectStage()
            openStage()
        case "window":
            // External scene: stage steps aside, target comes forward with a
            // recording outline so it's obvious what's being captured.
            stage?.hide()
            if let id = Int(ref) {
                if let pid = CaptureOutline.windowPID(id: id) {
                    NSRunningApplication(processIdentifier: pid)?.activate()
                }
                captureOutline.show(windowID: id)
            }
            bridgeCaptureSetTarget(kind: "window", id: ref)
            syncBar()
        case "display":
            stage?.hide()
            if let id = Int(ref), let screen = NSScreen.screens.first(where: {
                ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue == id
            }) {
                captureOutline.show(frame: screen.visibleFrame)
            }
            bridgeCaptureSetTarget(kind: "display", id: ref)
            syncBar()
        case "dev":
            // Dev-server scene: launch the command once, wait for the URL to
            // come up, then land it on the stage like any web scene.
            captureOutline.hide()
            let cmd = entry["cmd"] as? String ?? ""
            let cwd = entry["cwd"] as? String
            launchDevScene(cmd: cmd, cwd: cwd, url: ref, title: title)
        default:
            captureOutline.hide()
            if stage == nil || stage?.isVisible != true { openStage() }
            stage?.openSurface(StageSurface(kind: kind, ref: ref, title: title, project: ""))
            bridgeSelectStage()
        }
        fputs("reactable: scene → \(kind) \(title)\n", stderr)
    }

    private var devProcesses: [String: Process] = [:]

    func terminateDevProcesses() {
        for (_, proc) in devProcesses where proc.isRunning { proc.terminate() }
        devProcesses.removeAll()
    }

    private func launchDevScene(cmd: String, cwd: String?, url: String, title: String) {
        let alive = devProcesses[cmd]?.isRunning == true
        if !cmd.isEmpty, !alive {
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
            proc.arguments = ["-lc", cmd]
            if let cwd { proc.currentDirectoryURL = URL(fileURLWithPath: (cwd as NSString).expandingTildeInPath) }
            proc.standardOutput = FileHandle.nullDevice
            proc.standardError = FileHandle.nullDevice
            try? proc.run()
            devProcesses[cmd] = proc
            fputs("reactable: dev scene launched: \(cmd)\n", stderr)
        }
        guard let target = URL(string: url) else { return }
        Task { [weak self] in
            // Wait for the server to answer (20s budget).
            for _ in 0..<40 {
                if let (_, resp) = try? await URLSession.shared.data(from: target),
                   (resp as? HTTPURLResponse)?.statusCode ?? 500 < 500 { break }
                try? await Task.sleep(for: .milliseconds(500))
            }
            await MainActor.run {
                guard let self else { return }
                if self.stage == nil || self.stage?.isVisible != true { self.openStage() }
                self.stage?.openSurface(StageSurface(kind: "web", ref: url, title: title, project: ""))
                self.bridgeSelectStage()
            }
        }
    }

    /// While a scene is live, prewarm the stream for the one after it so the
    /// mid-take switch is instant — the lineup is the schedule.
    private func prewarmUpcomingScene(after entry: [String: Any]) {
        guard let takeRecorder else { return }
        guard let idx = lineup.firstIndex(where: {
                  ($0["kind"] as? String) == (entry["kind"] as? String)
                      && ($0["ref"] as? String) == (entry["ref"] as? String)
              }),
              idx + 1 < lineup.count
        else { return }
        let next = lineup[idx + 1]
        let kind = next["kind"] as? String ?? "web"
        let stageBound = !["window", "display"].contains(kind)
        let sourceKind = stageBound ? "stage" : kind
        let targetId = stageBound ? nil : next["ref"] as? String
        Task {
            await takeRecorder.prewarmNext(
                sourceKind: sourceKind,
                captureTargetId: targetId,
                areaRect: nil,
                stageWindow: self.stage?.captureWindow,
                stageContentRect: stageBound ? self.stage?.deckContentRect : nil,
                systemAudioOn: self.state.systemAudioOn
            )
        }
    }

    /// Rewrite deck.work slide order to the given ids via the reactable CLI
    /// (the CLI owns .work serialization), then reload the deck everywhere.
    private func applyDeckOrder(_ ids: [String]) {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.bun/bin/reactable",
            "/opt/homebrew/bin/reactable",
            "/usr/local/bin/reactable",
        ]
        guard let cli = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
            fputs("reactable: deck reorder needs the reactable CLI installed\n", stderr)
            return
        }
        let slug = state.deckSlug
        let project = activeProjectURL.path
        Task.detached {
            for (i, id) in ids.enumerated() {
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: cli)
                proc.arguments = ["decks", "slide", "move", slug, id, "--to", String(i)]
                proc.environment = ProcessInfo.processInfo.environment.merging(["WB_DATA": project]) { _, new in new }
                proc.standardOutput = FileHandle.nullDevice
                try? proc.run()
                proc.waitUntilExit()
            }
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.stage?.loadDeck(slug)
                Task {
                    await self.refreshDeckSlides()
                    self.stageManager?.pushData()
                }
                fputs("reactable: deck.work slide order rewritten (\(ids.count) slides)\n", stderr)
            }
        }
    }

    func bridgeMicSourceSet(uid: String?) {
        if let uid { UserDefaults.standard.set(uid, forKey: "reactable.micDeviceUID") }
        else { UserDefaults.standard.removeObject(forKey: "reactable.micDeviceUID") }
        micMeter.setInputDevice(uid: uid)
        fputs("reactable: mic source → \(uid ?? "system default")\n", stderr)
    }

    func bridgeCamSourceSet(uid: String?) {
        if let uid { UserDefaults.standard.set(uid, forKey: "reactable.camDeviceUID") }
        else { UserDefaults.standard.removeObject(forKey: "reactable.camDeviceUID") }
        cam?.setDevice(uid: uid)
        fputs("reactable: cam source → \(uid ?? "system default")\n", stderr)
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

    private func beginRecording(countdown: Int = 0) {
        guard let takeRecorder else {
            presentRecordError("Recorder not ready", "No active project. Open or create a project, then try again.")
            return
        }
        Task {
            do {
                let countdownDeadline = Date().addingTimeInterval(Double(countdown))
                // Preflight source selection — tell the user instead of failing silently.
                if state.sourceKind == "stage" {
                    if stage == nil || stage?.isVisible != true {
                        openStage()
                        // settle only when the window was JUST opened
                        try await Task.sleep(for: .milliseconds(400))
                    }
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
                // Screen Recording is special: CGPreflightScreenCaptureAccess caches
                // its result for the process lifetime, so a grant made while the app
                // is running is invisible until relaunch — hence the restart flow.
                if !ScreenCaptureAccess.requestIfNeeded() {
                    presentScreenPermissionNeeded()
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

                // Prep is done — wait out whatever remains of the countdown so
                // capture begins right at its end.
                let remaining = countdownDeadline.timeIntervalSinceNow
                if remaining > 0 {
                    try await Task.sleep(for: .milliseconds(Int(remaining * 1000)))
                }

                // Re-check under the actual recorder: a double-press spawns two of
                // these tasks and both pass the sync guard before either sets
                // state.recording. The loser must bail here, not start-and-throw.
                guard !state.recording, takeRecorder.isActive == false else {
                    state.arming = false
                    syncBar()
                    return
                }

                if state.hideDesktopIcons { setDesktopIconsVisible(false) }
                DeckScripts.fire(port: port, deck: state.deckSlug, trigger: "record.start")
                state.recording = true
                state.arming = false
                state.paused = false
                state.elapsed = 0
                // Lock the stage size while recording — a mid-take resize
                // stretches the fixed-dimension SCK stream (broken aspect).
                stage?.captureWindow?.styleMask.remove(.resizable)
                if state.hideDockWhileRecording { NSApp.setActivationPolicy(.accessory) }

                let takeDir = try await takeRecorder.start(
                    sourceKind: state.sourceKind,
                    captureTargetId: state.captureTargetId,
                    areaRect: state.areaRect,
                    stageWindow: stage?.captureWindow,
                    stageContentRect: state.sourceKind == "stage" ? stage?.deckContentRect : nil,
                    deck: state.deckSlug,
                    cam: cam,
                    camOn: state.camOn,
                    micOn: state.micOn,
                    systemAudioOn: state.systemAudioOn
                )

                // Voice track: mic.wav sidecar through the meter's engine —
                // the only mic path that actually captures on this setup.
                if state.micOn {
                    if !micMeter.isRunning { micMeter.start() }
                    micMeter.onFirstWrite = { [weak takeRecorder] absolute in
                        takeRecorder?.stampAbsolute("capture.mic.start", at: absolute, payload: ["file": "mic.wav"])
                    }
                    if !micMeter.beginWriting(to: takeDir.appending(path: "mic.wav")) {
                        fputs("reactable: mic sidecar failed to arm — take has no voice track\n", stderr)
                    }
                }

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
                // If a take is live (this task lost a start race), leave the
                // recording state alone — resetting it here made the bar show
                // idle while a take rolled, so the button could never stop it.
                if takeRecorder.isActive {
                    fputs("reactable: record start skipped — take already live (\(error))\n", stderr)
                    return
                }
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
        state.arming = false
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
        state.arming = false
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

    /// Screen Recording needs a relaunch to take effect (the TCC decision is
    /// cached per process). Guide the user to enable it, then restart the app.
    private func presentScreenPermissionNeeded() {
        state.recording = false
        state.paused = false
        state.arming = false
        syncBar()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Screen Recording permission needed"
        alert.informativeText = """
        1. Open Settings and turn on Reactable under Screen & System Audio Recording.
        2. Click Restart Reactable so the new permission takes effect.
        """
        alert.addButton(withTitle: "Open Settings")
        alert.addButton(withTitle: "Restart Reactable")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!
            NSWorkspace.shared.open(url)
        case .alertSecondButtonReturn:
            relaunchApp()
        default:
            break
        }
    }

    /// Relaunch a fresh instance and quit this one — required for a just-granted
    /// Screen Recording permission to be visible to the capture APIs.
    private func relaunchApp() {
        let path = Bundle.main.bundlePath
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 1; open \"\(path)\""]
        try? task.run()
        NSApp.terminate(nil)
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

    func stageCommandSurface(kind: String, ref: String, project: String, title: String) {
        if stage == nil || stage?.isVisible != true { openStage() }
        stage?.openSurface(StageSurface(kind: kind, ref: ref, title: title, project: project))
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
        prewarmCapture()
    }

    /// Spin up the capture stream for the current source so the record press
    /// only attaches a writer. Safe to call repeatedly; failures cold-start.
    private func prewarmCapture() {
        guard let takeRecorder, !state.recording else { return }
        let sourceKind = state.sourceKind
        let targetId = state.captureTargetId
        let areaRect = state.areaRect
        let stageWindow = stage?.captureWindow
        let systemAudioOn = state.systemAudioOn
        Task {
            // Let a freshly opened stage settle before resolving its window.
            try? await Task.sleep(for: .milliseconds(500))
            await takeRecorder.prewarm(
                sourceKind: sourceKind,
                captureTargetId: targetId,
                areaRect: areaRect,
                stageWindow: stageWindow,
                stageContentRect: sourceKind == "stage" ? self.stage?.deckContentRect : nil,
                systemAudioOn: systemAudioOn
            )
        }
    }

    @objc private func hideStage() {
        fputs("reactable: hideStage\n", stderr)
        stage?.hide()
        syncBar()
    }

    @objc private func toggleStage() {
        bridgeToggleStage()
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
