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
    private var preview: PreviewPanel?
    private var bar: BarPanel?
    /// Record (stage + recorder) or Edit (projects | preview | chat).
    private var appMode: AppMode = .record
    /// True once boot's initial layout is applied — gates layout persistence so
    /// the transient boot arrangement doesn't overwrite the saved one.
    private var didFinishBoot = false
    /// The layout captured just before stepping aside for an external-window
    /// scene, restored when navigation returns to an in-app scene.
    private var layoutBeforeScene: LayoutSnapshot?
    private var cam: CamBubblePanel?
    private var hotkeyMonitor: Any?
    private var localMonitor: Any?
    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenu?
    private var projectsMenuItem: NSMenuItem?
    private var decksMenuItem: NSMenuItem?
    private var layoutCombinedItem: NSMenuItem?
    private var layoutFloatingItem: NSMenuItem?
    private var modeRecordItem: NSMenuItem?
    private var modeEditItem: NSMenuItem?
    private var savedLayoutsItem: NSMenuItem?
    private var layoutChooser: LayoutChooserPanel?
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
        DockController.shared.keepVisible()
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
        let modeItem = menu.addItem(withTitle: "Mode", action: nil, keyEquivalent: "")
        let modeMenu = NSMenu()
        modeRecordItem = modeMenu.addItem(
            withTitle: "Record", action: #selector(pickRecordMode), keyEquivalent: "")
        modeRecordItem?.target = self
        modeEditItem = modeMenu.addItem(
            withTitle: "Edit", action: #selector(pickEditMode), keyEquivalent: "")
        modeEditItem?.target = self
        modeItem.submenu = modeMenu
        let layoutItem = menu.addItem(withTitle: "Layout", action: nil, keyEquivalent: "")
        let layoutMenu = NSMenu()
        layoutCombinedItem = layoutMenu.addItem(
            withTitle: "Combined Window", action: #selector(pickCombinedLayout), keyEquivalent: "")
        layoutCombinedItem?.target = self
        layoutFloatingItem = layoutMenu.addItem(
            withTitle: "Floating Panels", action: #selector(pickFloatingLayout), keyEquivalent: "")
        layoutFloatingItem?.target = self
        layoutItem.submenu = layoutMenu
        let layoutsItem = menu.addItem(withTitle: "Layouts", action: nil, keyEquivalent: "")
        layoutsItem.submenu = NSMenu()
        savedLayoutsItem = layoutsItem
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
            appMode = ModePreference.saved ?? .record
            if appMode == .record { showBar() }  // no recorder in Edit mode
            stagePoller = StageCommandPoller(port: port, delegate: self)
            stagePoller?.start()
            agent = AgentWindowController(port: port, deck: state.deckSlug, bridge: self)
            let pal = PaletteWindowController(port: port)
            pal.onOpenSurface = { [weak self] surface in
                guard let self else { return }
                if self.appMode == .edit {
                    self.preview?.openSurface(surface)
                    return
                }
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
            board.onAddLink = { [weak self] url in self?.addProjectLink(url) }
            board.onDropData = { [weak self] name, data in
                guard let self else { return }
                let dest = self.activeProjectURL.appending(path: "assets")
                try? FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
                try? data.write(to: dest.appending(path: name))
                fputs("reactable: dropped \(name) (\(data.count) bytes) into assets\n", stderr)
                self.projectsBoard?.pushData()
            }
            board.onDelete = { [weak self] p in self?.deleteProjectItem(p) }
            // Content intel: snapshot once per app-day (verb self no-ops if
            // today's points exist; budget-bounded; logs to nexus.log).
            Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { _ in
                Self.runIntelSnapshot()
            }
            Self.runIntelSnapshot()
            Self.runFootageSweep(root: activeProjectURL)

            board.onPreview = { [weak self] p, icon in
                self?.openPreview(path: p, icon: icon)
            }
            board.onVideoAction = { [weak self] path, action in
                self?.bridgeFootagePrompt(path: path, action: action)
            }
            board.onReveal = { [weak self] p in
                guard let self else { return }
                NSWorkspace.shared.activateFileViewerSelecting([self.activeProjectURL.appending(path: p)])
            }
            board.onDrop = { [weak self] urls in self?.importAssets(urls) }
            projectsBoard = board
            syncBar()

            // The one preview window — every projects-board double-click
            // lands here as a tab (docked center in Edit mode, floats in Record).
            let prev = PreviewPanel(
                port: port,
                projectRoot: { [weak self] in self?.activeProjectURL ?? URL(fileURLWithPath: "/") },
                projectId: { [weak self] in self?.activeProjectURL.lastPathComponent ?? "" }
            )
            preview = prev

            // Composable panels: register the dockables; block re-docking while
            // recording (the capture stream is bound to a specific window).
            DockController.shared.interactionLocked = { [weak self] in self?.state.recording ?? false }
            // Record|Edit switch + layouts hamburger in every group header.
            DockController.shared.modeProvider = { [weak self] in self?.appMode ?? .record }
            DockController.shared.onModeSwitch = { [weak self] mode in self?.applyMode(mode) }
            DockController.shared.hamburgerMenu = { [weak self] in self?.layoutsMenu() ?? NSMenu() }
            DockController.shared.onOpenSettings = { [weak self] in self?.bridgeOpenSettings() }
            DockController.shared.onGroupChanged = { [weak self] in
                self?.syncBar()
                self?.persistCurrentLayout()
            }
            if let agent { DockController.shared.register(agent) }
            if let bar { DockController.shared.register(bar) }
            DockController.shared.register(mgr)
            DockController.shared.register(board)
            DockController.shared.register(prev)

            // Reopen exactly as the current view was last left, if remembered;
            // otherwise land on the shipped default (combined, center-widest).
            if let current = LayoutStore.loadCurrent(mode: appMode.rawValue),
               !current.groups.isEmpty || !current.floats.isEmpty {
                applyLayoutSnapshot(current)
            } else if LayoutPreference.saved == .floating {
                arrangeDefaultLayout()
            } else {
                LayoutPreference.save(.combined)
                applyLayoutSnapshot(defaultLayoutSnapshot(for: appMode))
            }
            didFinishBoot = true
            refreshLayoutMenu()
            refreshModeMenu()
            refreshSavedLayoutsMenu()
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
        // Panels sharing the bar's window — the bar hides their toggles.
        state.barPeers = bar?.dockHost?.panelKeys ?? []
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
            if let savedDir {
                // T0 footage index for the fresh take, detached
                Self.runFootageSweep(root: savedDir.deletingLastPathComponent().deletingLastPathComponent())
            }
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

    func bridgeSetMode(edit: Bool) {
        applyMode(edit ? .edit : .record)
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
        if settingsPanel == nil {
            settingsPanel = SettingsPanel(port: port)
            // NOT registered with DockController: Settings is a floating modal,
            // not a dockable panel — it can be moved but never docked.
        }
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
        let files = projectFiles()
        fputs("projects: data root=\(activeProjectURL.path) files=\(files.count)\n", stderr)
        return [
            "columns": columns,
            "projects": projects,
            "stages": stages,
            "active": "\(state.projectId)/\(state.deckSlug)",
            "files": files,
            "notes": loadAssetNotes(),
        ]
    }

    /// Classify a projects-board item into a preview surface and open it as a
    /// tab in THE preview window (docked center in Edit mode; floats in Record).
    private func openPreview(path: String, icon: String) {
        let name = (path as NSString).lastPathComponent
        let ext = (name as NSString).pathExtension.lowercased()
        let project = activeProjectURL.lastPathComponent

        let surface: StageSurface
        if icon == "intel" {
            // The footage-intel timeline surface for this media file.
            surface = StageSurface(kind: "intel", ref: path, title: "\(name) · intel", project: project)
        } else if path.hasPrefix("http") {
            surface = StageSurface(kind: "web", ref: path, title: name.isEmpty ? path : name, project: project)
        } else if path.hasPrefix("takes/") || icon == "take" {
            surface = StageSurface(kind: "take", ref: path, title: name, project: project)
        } else {
            switch ext {
            case "mov", "mp4", "webm", "m4v", "avi":
                surface = StageSurface(kind: "video", ref: path, title: name, project: project)
            case "wav", "mp3", "m4a", "aiff", "aac", "flac", "ogg":
                surface = StageSurface(kind: "audio", ref: path, title: name, project: project)
            case "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic", "bmp", "tiff":
                surface = StageSurface(kind: "image", ref: path, title: name, project: project)
            default:
                surface = StageSurface(kind: "doc", ref: path, title: name, project: project)
            }
        }
        preview?.openSurface(surface)
    }

    // MARK: - Footage intel bridge (agent cards + panel actions)

    func bridgeOpenPreview(path: String, ms: Double?) {
        let ext = (path as NSString).pathExtension.lowercased()
        let icon = ["mov", "mp4", "webm", "m4v"].contains(ext) ? "video"
            : (path.hasPrefix("takes/") ? "take" : "")
        openPreview(path: path, icon: icon)
    }

    func bridgeOpenSurface(kind: String, ref: String) {
        let project = activeProjectURL.lastPathComponent
        let title = (ref as NSString).lastPathComponent
        preview?.openSurface(StageSurface(kind: kind, ref: ref, title: title, project: project))
    }

    /// Promote a derived render (e.g. a compose output under <asset>.intel/assets)
    /// into the project's assets/ so it's a first-class, retained asset.
    func bridgeAddAsset(path: String) {
        let src = activeProjectURL.appending(path: path)
        guard FileManager.default.fileExists(atPath: src.path) else { return }
        let assetsDir = activeProjectURL.appending(path: "assets")
        try? FileManager.default.createDirectory(at: assetsDir, withIntermediateDirectories: true)
        var dest = assetsDir.appending(path: src.lastPathComponent)
        var i = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            let stem = src.deletingPathExtension().lastPathComponent
            dest = assetsDir.appending(path: "\(stem)-\(i).\(src.pathExtension)")
            i += 1
        }
        try? FileManager.default.copyItem(at: src, to: dest)
        fputs("reactable: added \(dest.lastPathComponent) to assets\n", stderr)
        projectsBoard?.pushData()
    }

    /// Drop a prefilled footage prompt into the agent chat. index/autoedit send
    /// immediately; find/track fill the box for the user to complete.
    func bridgeFootagePrompt(path: String, action: String) {
        let name = (path as NSString).lastPathComponent
        let takeId = path.hasPrefix("takes/")
            ? path.replacingOccurrences(of: "takes/", with: "").components(separatedBy: "/").first ?? path
            : path
        bridgeOpenAgent()
        switch action {
        case "index":
            agent?.sendPrompt("Index the footage at `\(path)` and tell me what's in it — shots, transcript, any text on screen.")
        case "autoedit":
            agent?.sendPrompt("Auto-edit the take `\(takeId)`: punch in on cursor activity and trim the silences, then render a proof. Run `reactable video autoedit \(takeId) --render` and show me the result.")
        case "find":
            agent?.fillPrompt("In `\(name)` (`\(path)`), find the moment where ")
        case "track":
            agent?.fillPrompt("Track every ")
        default:
            agent?.fillPrompt("Work with the footage at `\(path)`: ")
        }
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

    // MARK: - Layout modes (combined window vs floating panels)

    private func applyLayout(_ mode: LayoutMode) {
        applyWorkspace(layout: mode)
    }

    /// Switch Record ⇄ Edit. Same recording guard as layout switches: the
    /// capture stream is bound to a specific window topology.
    func applyMode(_ mode: AppMode) {
        guard !state.recording else {
            fputs("reactable: mode switch ignored while recording\n", stderr)
            DockController.shared.refreshModeUI()  // snap the segment back
            return
        }
        guard mode != appMode else { return }
        // Remember the layout of the view we're leaving, then switch and restore
        // the target view's OWN remembered layout (record and edit each keep one).
        persistCurrentLayout()
        appMode = mode
        ModePreference.save(mode)
        restoreLayout(for: mode)
        refreshModeMenu()
        DockController.shared.refreshModeUI()
    }

    /// Restore a view's remembered layout, or land on the shipped default.
    private func restoreLayout(for mode: AppMode) {
        if let saved = LayoutStore.loadCurrent(mode: mode.rawValue),
           !saved.groups.isEmpty || !saved.floats.isEmpty {
            applyLayoutSnapshot(saved)
        } else {
            applyLayoutSnapshot(defaultLayoutSnapshot(for: mode))
        }
    }

    /// THE workspace builder — one function reads (layout × mode) and arranges
    /// every panel. Record = projects | stage | agent + bar. Edit = projects |
    /// preview | agent, no recorder.
    private func applyWorkspace(layout: LayoutMode) {
        guard !state.recording else {
            fputs("reactable: layout switch ignored while recording\n", stderr)
            return
        }
        switch layout {
        case .floating:
            DockController.shared.explodeAll()
            arrangeDefaultLayout()
        case .combined:
            if appMode == .record, stage == nil {
                let ctrl = StageWindowController(port: port, deck: state.deckSlug, bridge: self)
                wireStageEvents(ctrl)
                DockController.shared.register(ctrl)
                stage = ctrl
            }
            // The other mode's center panel leaves the group before gathering.
            if appMode == .edit { stage?.hide(); bar?.close() } else { preview?.hide() }

            var panels: [DockablePanel] = []
            var fractions: [CGFloat] = []
            // Center column (stage / preview) gets the lion's share of the width.
            if let projectsBoard { panels.append(projectsBoard); fractions.append(0.17) }
            if appMode == .record, let stage { panels.append(stage); fractions.append(0.62) }
            if appMode == .edit, let preview { panels.append(preview); fractions.append(0.62) }
            if let agent { panels.append(agent); fractions.append(0.21) }
            // Panels already open ride along instead of getting stranded.
            // Settings is intentionally excluded — it's a modal, not dockable.
            if let stageManager, stageManager.isVisible { panels.append(stageManager) }
            let group = DockController.shared.gather(panels, frame: combinedFrame(), fractions: fractions)
            // The control bar rides under the stage by default — tear it out anytime.
            if appMode == .record, let group, let bar, let stage {
                bar.ensureLoaded()
                DockController.shared.dock(bar, into: group, edge: .bottom, relativeTo: stage)
            }
            // Reassert the column proportions once the whole tree (incl. the
            // docked bar) has settled — the intermediate layouts otherwise leave
            // the trailing/leading pane oversized.
            if let group {
                DispatchQueue.main.async { group.setColumnFractions(fractions) }
            }
            projectsBoard?.pushData()
            stageManager?.pushData()
            if appMode == .record {
                prewarmCapture()  // stage capture now binds to the group window
            }
        }
        syncBar()
    }

    private func combinedFrame() -> NSRect {
        guard let screen = NSScreen.main else {
            return NSRect(x: 120, y: 120, width: 1280, height: 800)
        }
        // Fill the screen (below the menu bar) by default — the combined window
        // is the workspace, so it opens maximized rather than a floating card.
        return screen.visibleFrame
    }

    private func refreshLayoutMenu() {
        let mode = LayoutPreference.saved ?? .floating
        layoutCombinedItem?.state = mode == .combined ? .on : .off
        layoutFloatingItem?.state = mode == .floating ? .on : .off
    }

    @objc private func pickCombinedLayout() {
        LayoutPreference.save(.combined)
        applyLayout(.combined)
        refreshLayoutMenu()
    }

    @objc private func pickFloatingLayout() {
        LayoutPreference.save(.floating)
        applyLayout(.floating)
        refreshLayoutMenu()
    }

    @objc private func pickRecordMode() { applyMode(.record) }
    @objc private func pickEditMode() { applyMode(.edit) }

    private func refreshModeMenu() {
        modeRecordItem?.state = appMode == .record ? .on : .off
        modeEditItem?.state = appMode == .edit ? .on : .off
    }

    // MARK: - Named layouts (hamburger + tray "Layouts")

    /// All dockable panels that can appear in a snapshot, by key.
    private var snapshotPanels: [(key: String, window: NSWindow?, docked: Bool, visible: Bool)] {
        let entries: [(String, NSWindow?, Bool, Bool)?] = [
            projectsBoard.map { ("projects", $0.panelWindow, $0.dockHost != nil, $0.isVisible) },
            stage.map { ("stage", $0.panelWindow, $0.dockHost != nil, $0.isVisible) },
            preview.map { ("preview", $0.panelWindow, $0.dockHost != nil, $0.isVisible) },
            agent.map { ("agent", $0.panelWindow, $0.dockHost != nil, $0.isVisible) },
            bar.map { ("bar", $0.panelWindow, $0.dockHost != nil, $0.panelWindow?.isVisible ?? false) },
            stageManager.map { ("manager", $0.panelWindow, $0.dockHost != nil, $0.isVisible) },
            settingsPanel.map { ("settings", $0.panelWindow, $0.dockHost != nil, $0.isVisible) },
        ]
        return entries.compactMap { $0 }
    }

    /// Snapshot the workspace EXACTLY as it is on screen right now — every
    /// group's real column order + widths, every floating window's frame, and
    /// the live record/edit + combined/floating modes.
    private func currentLayoutSnapshot(named name: String) -> LayoutSnapshot {
        let groups = DockController.shared.groups.map { $0.layoutSnapshot() }
        let floats = snapshotPanels.compactMap { p -> PanelFrameSnapshot? in
            guard !p.docked, let win = p.window else { return nil }
            return PanelFrameSnapshot(key: p.key, frame: win.frame, visible: p.visible)
        }
        // Derive the layout mode from what's actually on screen, not a pref.
        let layout: LayoutMode = groups.isEmpty ? .floating : .combined
        return LayoutSnapshot(
            name: name,
            layoutMode: layout.rawValue,
            appMode: appMode.rawValue,
            groups: groups,
            floats: floats,
            savedAt: Date()
        )
    }

    private func captureLayoutSnapshot(named name: String) {
        LayoutStore.upsert(currentLayoutSnapshot(named: name))
        refreshSavedLayoutsMenu()
        fputs("reactable: saved layout \"\(name)\"\n", stderr)
    }

    /// Continuously persist the live layout so the app reopens exactly as left.
    /// Skipped mid-recording (scene collapses shouldn't overwrite the real one)
    /// and when nothing is arranged yet.
    private func persistCurrentLayout() {
        guard didFinishBoot, !state.recording else { return }
        let snap = currentLayoutSnapshot(named: appMode.rawValue)
        guard !snap.groups.isEmpty || !snap.floats.isEmpty else { return }
        // Don't overwrite a good layout with a transient zero-width capture
        // (can happen if a group is mid-layout when this fires).
        let degenerate = snap.groups.contains {
            !$0.columnFractions.isEmpty && $0.columnFractions.allSatisfy { $0 < 0.001 }
        }
        guard !degenerate else { return }
        LayoutStore.saveCurrent(snap, mode: appMode.rawValue)
    }

    /// The built-in default arrangement for a view — the shipped "dist default":
    /// projects | center | agent, center widest, combined and full-screen. This
    /// is what a fresh install (or a Reset) lands on.
    private func defaultLayoutSnapshot(for mode: AppMode) -> LayoutSnapshot {
        let columns: [[String]] = mode == .record
            ? [["projects"], ["stage", "bar"], ["agent"]]
            : [["projects"], ["preview"], ["agent"]]
        // Stage column stacks the bar underneath (bar row is pinned by height).
        let rows: [[CGFloat]] = mode == .record ? [[1], [0.85, 0.15], [1]] : [[1], [1], [1]]
        let group = DockGroupSnapshot(
            frame: combinedFrame(),
            columns: columns,
            columnFractions: [0.17, 0.62, 0.21],
            rowFractions: rows
        )
        return LayoutSnapshot(
            name: mode.rawValue, layoutMode: "combined", appMode: mode.rawValue,
            groups: [group], floats: [], savedAt: Date()
        )
    }

    /// Bring back the pre-scene arrangement after an external scene. A combined
    /// group that only got hidden is re-revealed (cheap, safe mid-record); if
    /// the layout was torn down and we're not recording, rebuild it fully.
    private func restoreSceneLayout(_ snap: LayoutSnapshot) {
        captureOutline.hide()
        if let group = DockController.shared.groups.first {
            group.reveal()
            if appMode == .record { openStage() }
        } else if !state.recording {
            applyLayoutSnapshot(snap)
        } else {
            // Recording with no group to revive — at least bring the stage back.
            openStage()
        }
    }

    private func applyLayoutSnapshot(_ snap: LayoutSnapshot) {
        guard !state.recording else {
            fputs("reactable: layout apply ignored while recording\n", stderr)
            return
        }
        if let layout = LayoutMode(rawValue: snap.layoutMode) { LayoutPreference.save(layout) }
        if let mode = AppMode(rawValue: snap.appMode) {
            appMode = mode
            ModePreference.save(mode)
        }

        // Panels referenced by the snapshot must exist before restore; stale
        // keys in layouts.json are skipped by restoreGroups.
        let referenced = Set(snap.groups.flatMap { $0.columns.flatMap { $0 } }
            + snap.floats.map(\.key))
        if referenced.contains("stage"), stage == nil {
            let ctrl = StageWindowController(port: port, deck: state.deckSlug, bridge: self)
            wireStageEvents(ctrl)
            DockController.shared.register(ctrl)
            stage = ctrl
        }
        for key in referenced { DockController.shared.panel(forKey: key)?.ensureLoaded() }

        DockController.shared.restoreGroups(snap.groups)

        let dockedNow = Set(DockController.shared.groups.flatMap(\.panelKeys))
        for float in snap.floats where !dockedNow.contains(float.key) {
            guard let panel = DockController.shared.panel(forKey: float.key) else { continue }
            if float.visible {
                panel.ensureLoaded()
                panel.panelWindow?.setFrame(float.frame, display: true)
                panel.panelWindow?.makeKeyAndOrderFront(nil)
            } else {
                panel.panelWindow?.orderOut(nil)
            }
        }
        // Anything alive but in neither list stays as-is except the center
        // panels, which follow the mode.
        if appMode == .edit { stage?.hide(); bar?.close() } else { preview?.hide() }

        projectsBoard?.pushData()
        stageManager?.pushData()
        if appMode == .record { prewarmCapture() }
        refreshLayoutMenu()
        refreshModeMenu()
        DockController.shared.refreshModeUI()
        syncBar()
        fputs("reactable: applied layout \"\(snap.name)\"\n", stderr)
    }

    /// Shared menu for the group-header hamburger and the tray's "Layouts".
    /// Layouts auto-save per view (Record / Edit); Save is an explicit nudge,
    /// Reset forgets this view's layout and rebuilds its default.
    func layoutsMenu() -> NSMenu {
        let menu = NSMenu()
        let viewName = appMode == .record ? "Record" : "Edit"
        let save = menu.addItem(withTitle: "Save \(viewName) Layout", action: #selector(saveLayout), keyEquivalent: "")
        save.target = self
        let reset = menu.addItem(withTitle: "Reset \(viewName) Layout", action: #selector(resetLayout), keyEquivalent: "")
        reset.target = self
        return menu
    }

    /// Explicitly stamp the current arrangement as this view's layout. Redundant
    /// with the continuous auto-save, but a clear, reassuring affordance.
    @objc private func saveLayout() {
        guard !state.recording else { return }
        let snap = currentLayoutSnapshot(named: appMode.rawValue)
        guard !snap.groups.isEmpty || !snap.floats.isEmpty else { return }
        LayoutStore.saveCurrent(snap, mode: appMode.rawValue)
    }

    /// Forget this view's remembered arrangement and rebuild the shipped default.
    @objc private func resetLayout() {
        LayoutStore.clearCurrent(mode: appMode.rawValue)
        applyLayoutSnapshot(defaultLayoutSnapshot(for: appMode))
        persistCurrentLayout()
    }

    private func refreshSavedLayoutsMenu() {
        savedLayoutsItem?.submenu = layoutsMenu()
    }

    @objc private func saveLayoutPrompt() {
        let alert = NSAlert()
        alert.messageText = "Save Current Layout"
        alert.informativeText = "Snapshots exactly what's on screen now — every window, dock, split size, and mode — under a name you can restore later."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 230, height: 24))
        field.placeholderString = "Layout name"
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        captureLayoutSnapshot(named: name)
    }

    @objc private func applySavedLayout(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String,
              let snap = LayoutStore.load().first(where: { $0.name == name }) else { return }
        applyLayoutSnapshot(snap)
    }

    @objc private func deleteSavedLayout(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        LayoutStore.delete(name: name)
        refreshSavedLayoutsMenu()
    }

    /// Default floating layout: bar top-center (Record only), then one row
    /// that always fits the screen — projects | center | agent. The center is
    /// the stage in Record mode, the tabbed preview in Edit mode.
    private func arrangeDefaultLayout() {
        guard let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        if appMode == .record {
            preview?.hide()
            openStage()
            showBar()
        } else {
            stage?.hide()
            bar?.close()
            preview?.open()
        }
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

        let center = NSRect(x: startX + projW + gap, y: y, width: stageW, height: stageH)
        projectsBoard?.place(frame: NSRect(x: startX, y: y, width: projW, height: stageH))
        if appMode == .record { stage?.place(frame: center) } else { preview?.place(frame: center) }
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
        Self.runFootageSweep(root: activeProjectURL)
        projectsBoard?.pushData()
    }

    /// Trash (not hard-delete) a take dir or asset; links leave links.json.

    static func runIntelSnapshot() {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = ["reactable", "intel", "snapshot", "--budget", "40"]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(NSHomeDirectory())/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        task.environment = env
        try? task.run()
    }

    /// Footage intel T0: index anything un-indexed in the active project
    /// (takes + imported assets). Detached; verb self no-ops when everything
    /// already has a fresh sidecar. docs/PLAN.footage-intel.work.
    static func runFootageSweep(root: URL) {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        task.arguments = ["reactable", "video", "sweep", "--json"]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "\(NSHomeDirectory())/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        env["WB_DATA"] = root.path()
        task.environment = env
        task.qualityOfService = .background
        try? task.run()
    }

    private func deleteProjectItem(_ path: String) {
        if path.hasPrefix("http") {
            var links = (try? JSONSerialization.jsonObject(with: Data(contentsOf: linksURL))) as? [String] ?? []
            links.removeAll { $0 == path }
            if let d = try? JSONSerialization.data(withJSONObject: links) { try? d.write(to: linksURL) }
        } else {
            let url = activeProjectURL.appending(path: path)
            try? FileManager.default.trashItem(at: url, resultingItemURL: nil)
        }
        fputs("reactable: deleted \(path)\n", stderr)
        projectsBoard?.pushData()
    }

    private var linksURL: URL { activeProjectURL.appending(path: ".reactable/links.json") }

    private func addProjectLink(_ url: String) {
        var links = (try? JSONSerialization.jsonObject(with: Data(contentsOf: linksURL))) as? [String] ?? []
        if !links.contains(url) { links.append(url) }
        try? FileManager.default.createDirectory(at: linksURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: links) { try? d.write(to: linksURL) }
        projectsBoard?.pushData()
    }

    /// Small cached JPEG thumbnail as a data URI (video: first frames via
    /// AVAssetImageGenerator; image: downscaled NSImage).
    private func thumbnail(for file: URL, kind: String) -> String? {
        let thumbsDir = activeProjectURL.appending(path: ".reactable/thumbs")
        let key = file.path.replacingOccurrences(of: "/", with: "_") + ".jpg"
        let cache = thumbsDir.appending(path: key)
        if let data = try? Data(contentsOf: cache) {
            return "data:image/jpeg;base64," + data.base64EncodedString()
        }
        var cg: CGImage?
        if kind == "video" || kind == "take" {
            let gen = AVAssetImageGenerator(asset: AVURLAsset(url: file))
            gen.appliesPreferredTrackTransform = true
            gen.maximumSize = CGSize(width: 480, height: 480)
            cg = try? gen.copyCGImage(at: CMTime(seconds: 0.4, preferredTimescale: 600), actualTime: nil)
        } else if kind == "image", let img = NSImage(contentsOf: file) {
            var rect = NSRect(origin: .zero, size: img.size)
            cg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil)
        }
        guard let cg else { return nil }
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6]) else { return nil }
        try? FileManager.default.createDirectory(at: thumbsDir, withIntermediateDirectories: true)
        try? jpeg.write(to: cache)
        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    /// The project's media, code abstracted away: takes + assets (+ root media).
    /// Footage-intel state (indexed/tracks/edits) rides on each source row;
    /// finished derived assets (compose/cutout/autoedit) surface separately.
    private func projectFiles() -> [[String: Any]] {
        var out: [[String: Any]] = []
        var derived: [[String: Any]] = []
        let fm = FileManager.default
        let takes = activeProjectURL.appending(path: "takes")
        if let items = try? fm.contentsOfDirectory(atPath: takes.path) {
            for t in items.sorted(by: >) where t.hasPrefix("take") {
                var row: [String: Any] = ["name": t, "path": "takes/\(t)", "group": "Takes", "icon": "take", "sub": ""]
                let stageMov = takes.appending(path: "\(t)/stage.mov")
                if FileManager.default.fileExists(atPath: stageMov.path) {
                    if let thumb = thumbnail(for: stageMov, kind: "take") { row["thumb"] = thumb }
                    if let intel = intelInfo(forMedia: stageMov) {
                        row["intel"] = intel
                        derived += derivedRows(forMedia: stageMov, sourceName: t, sourcePath: "takes/\(t)")
                    }
                }
                out.append(row)
            }
        }
        let assets = activeProjectURL.appending(path: "assets")
        if let en = fm.enumerator(at: assets, includingPropertiesForKeys: nil) {
            for case let f as URL in en where !f.hasDirectoryPath {
                let rel = f.path.replacingOccurrences(of: assets.path + "/", with: "")
                // Skip .intel internals — they surface as intel state / derived rows, not loose files.
                if rel.contains(".intel/") { continue }
                let ext = f.pathExtension.lowercased()
                let icon = ["mov", "mp4", "webm"].contains(ext) ? "video"
                    : ["wav", "mp3", "m4a", "aiff"].contains(ext) ? "audio"
                    : ["png", "jpg", "jpeg", "gif", "webp"].contains(ext) ? "image" : "file"
                let group = rel.contains("/") ? "assets/" + rel.components(separatedBy: "/")[0] : "Assets"
                var row: [String: Any] = ["name": f.lastPathComponent, "path": "assets/\(rel)", "group": group, "icon": icon, "sub": ext]
                if icon == "image" || icon == "video", let thumb = thumbnail(for: f, kind: icon) {
                    row["thumb"] = thumb
                }
                if ["video"].contains(icon), let intel = intelInfo(forMedia: f) {
                    row["intel"] = intel
                    derived += derivedRows(forMedia: f, sourceName: f.lastPathComponent, sourcePath: "assets/\(rel)")
                }
                out.append(row)
                if out.count > 240 { break }
            }
        }
        out += derived
        let links = (try? JSONSerialization.jsonObject(with: Data(contentsOf: linksURL))) as? [String] ?? []
        for l in links {
            out.append(["name": l, "path": l, "group": "Links", "icon": "link", "sub": "url"])
        }
        return out
    }

    /// Footage-intel state for a media file: indexed flag, shot count, pass
    /// list, tracked-concept counts, derived-edit-asset count. nil = not indexed.
    private func intelInfo(forMedia media: URL) -> [String: Any]? {
        let base = media.deletingPathExtension().lastPathComponent
        let intelDir = media.deletingLastPathComponent().appending(path: "\(base).intel")
        let indexJSON = intelDir.appending(path: "index.json")
        guard FileManager.default.fileExists(atPath: indexJSON.path) else { return nil }
        var info: [String: Any] = ["indexed": true]
        if let data = try? Data(contentsOf: indexJSON),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let shots = obj["shots"] as? [[String: Any]] { info["shots"] = shots.count }
            if let passes = obj["passes"] as? [String: Any] {
                info["passes"] = passes.compactMap { (k, v) -> String? in (v is NSNull) ? nil : k }.sorted()
            }
        }
        let tracksFile = intelDir.appending(path: "tracks.jsonl")
        if let s = try? String(contentsOf: tracksFile, encoding: .utf8) {
            var concepts: [String: Int] = [:]
            for line in s.split(separator: "\n") {
                if let d = line.data(using: .utf8),
                   let m = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                   let c = m["concept"] as? String {
                    concepts[c, default: 0] += 1
                }
            }
            if !concepts.isEmpty { info["tracks"] = concepts }
        }
        let editDir = intelDir.appending(path: "assets")
        if let names = try? FileManager.default.contentsOfDirectory(atPath: editDir.path) {
            let edits = names.filter { n in
                ["cutout", "matte", "compose", "motion"].contains { n.hasPrefix($0) }
            }
            if !edits.isEmpty { info["editAssets"] = edits.count }
        }
        return info
    }

    /// Finished, previewable derived assets (compose/cutout renders) as their
    /// own cards, grouped under the source clip. Skips intermediate mattes/motion.
    private func derivedRows(forMedia media: URL, sourceName: String, sourcePath: String) -> [[String: Any]] {
        let base = media.deletingPathExtension().lastPathComponent
        let editDir = media.deletingLastPathComponent().appending(path: "\(base).intel/assets")
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: editDir.path) else { return [] }
        var rows: [[String: Any]] = []
        for n in names.sorted() {
            let ext = (n as NSString).pathExtension.lowercased()
            let isRender = (n.hasPrefix("compose") || n.hasPrefix("cutout")) && ["mp4", "mov"].contains(ext)
            guard isRender else { continue }
            let f = editDir.appending(path: n)
            let relFromProject = f.path.replacingOccurrences(of: activeProjectURL.path + "/", with: "")
            var row: [String: Any] = [
                "name": n, "path": relFromProject, "group": "Edits · \(sourceName)",
                "icon": "video", "sub": ext, "derivedFrom": sourcePath,
            ]
            if let thumb = thumbnail(for: f, kind: "video") { row["thumb"] = thumb }
            rows.append(row)
        }
        return rows
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

        // Layout memory across scenes: when we step aside for an external
        // window/display, remember the arrangement; when the next scene is back
        // in-app (stage/deck/slide), restore it instead of leaving the app bare.
        let externalScene = ["window", "display"].contains(kind)
        if externalScene {
            if layoutBeforeScene == nil { layoutBeforeScene = currentLayoutSnapshot(named: "__scene__") }
        } else if let saved = layoutBeforeScene {
            layoutBeforeScene = nil
            restoreSceneLayout(saved)
        }

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

                // opening slide's ground-truth layout (footage intel)
                stage?.captureLayout { [weak self] layout in
                    self?.takeRecorder?.stamp("layout", payload: layout)
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
            if type == "slide", takeRecorder?.isActive == true {
                // settle, then stamp the slide's ground-truth element rects
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
                    self?.stage?.captureLayout { layout in
                        var p = layout
                        p["slide"] = payload["id"] ?? payload["idx"]
                        self?.takeRecorder?.stamp("layout", payload: p)
                    }
                }
            }
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
            DockController.shared.register(ctrl)
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
        // ⌘R in Edit mode = "get me back to recording", not "start a take".
        if appMode == .edit {
            applyMode(.record)
            return
        }
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
