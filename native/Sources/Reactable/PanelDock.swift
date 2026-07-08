import AppKit

// The composable panel system: any chrome panel (stage, agent, projects,
// manager, settings) can live as its own floating window OR dock into a
// shared group window. Drag a floating panel to another panel's edge to
// combine them; drag a docked panel's compact header to tear it back out.
// The tray's Layout menu (and the first-run chooser) switches between
// "combined window" and "floating panels" wholesale.

enum LayoutMode: String {
    case combined, floating
}

enum LayoutPreference {
    private static let key = "reactable.layoutMode"
    static var saved: LayoutMode? {
        UserDefaults.standard.string(forKey: key).flatMap(LayoutMode.init)
    }
    static func save(_ mode: LayoutMode) {
        UserDefaults.standard.set(mode.rawValue, forKey: key)
    }
}

/// The app's WORK mode — orthogonal to LayoutMode. Record = stage + recorder
/// (today's app). Edit = projects | tabbed preview | chat, no recorder.
enum AppMode: String {
    case record, edit
}

enum ModePreference {
    private static let key = "reactable.appMode"
    static var saved: AppMode? {
        UserDefaults.standard.string(forKey: key).flatMap(AppMode.init)
    }
    static func save(_ mode: AppMode) {
        UserDefaults.standard.set(mode.rawValue, forKey: key)
    }
}

enum DockEdge {
    case left, right, top, bottom
}

/// NSMenuItem that fires a closure — lets the plain DockController build menus
/// without an @objc target for every action.
@MainActor
final class PanelMenuItem: NSMenuItem {
    private let handler: () -> Void
    init(title: String, key: String, _ handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
    }
    required init(coder: NSCoder) { fatalError() }
    @objc private func fire() { handler() }
}

/// A panel that can leave its own window and dock into a group.
@MainActor
protocol DockablePanel: AnyObject {
    var dockKey: String { get }
    var dockTitle: String { get }
    var dockMinSize: NSSize { get }
    /// Edges this panel may dock on (the bar is a strip: top/bottom only).
    var dockAllowedEdges: [DockEdge] { get }
    /// Non-nil pins the docked cell to this content height (strip panels).
    var dockFixedHeight: CGFloat? { get }
    /// False = no compact header in the cell; the panel brings its own
    /// tear-out handle (the bar's grip).
    var dockShowsHeader: Bool { get }
    /// The panel's own floating window (nil until first created).
    var panelWindow: NSWindow? { get }
    /// Group hosting this panel while docked — set by DockController only.
    var dockHost: DockGroupController? { get set }
    /// Create the window + content if needed, WITHOUT ordering it front.
    func ensureLoaded()
    /// Detach the content body (frame + webview) for embedding in a group.
    func detachDockBody() -> NSView?
    /// Optional strip accessory that rides into the docked header (stage tabs).
    func detachDockAccessory() -> NSView?
    /// Put body (+ accessory) back into the panel's own window.
    func reattachDockBody(_ body: NSView, accessory: NSView?)
    /// Docked state changed — panels adapt their own chrome (bar hides its grip).
    func dockStateChanged(docked: Bool)
}

extension DockablePanel {
    var dockAllowedEdges: [DockEdge] { [.left, .right, .top, .bottom] }
    var dockFixedHeight: CGFloat? { nil }
    var dockShowsHeader: Bool { true }
    func detachDockAccessory() -> NSView? { nil }
    func dockStateChanged(docked: Bool) {}
}

// MARK: - Controller

@MainActor
final class DockController {
    static let shared = DockController()

    /// True while docking must not change window topology (recording: the
    /// capture stream is bound to a specific window).
    var interactionLocked: (() -> Bool)?

    // Mode switch in every group header — wired by AppController at boot.
    var modeProvider: (() -> AppMode)?
    var onModeSwitch: ((AppMode) -> Void)?
    var hamburgerMenu: (() -> NSMenu)?
    var onOpenSettings: (() -> Void)?
    /// Fired after any dock/undock so co-dock-dependent UI (the bar) refreshes.
    var onGroupChanged: (() -> Void)?

    /// Re-seed the Record|Edit segment in every group header.
    func refreshModeUI() {
        let mode = modeProvider?() ?? .record
        for g in groups { g.setMode(mode) }
    }

    private var panels: [String: DockablePanel] = [:]
    private(set) var groups: [DockGroupController] = []
    private let overlay = DropHintOverlay()

    private var locked: Bool { interactionLocked?() ?? false }

    func register(_ panel: DockablePanel) {
        panels[panel.dockKey] = panel
    }

    /// Belt-and-suspenders on app deactivate — groups stay put like the panels do.
    func keepVisible() {
        for g in groups where g.window.isVisible { g.window.orderFrontRegardless() }
    }

    // MARK: Drag session (fed by WindowDrag)

    func dragMoved(window: NSWindow, mouse: NSPoint) {
        guard !locked, let key = floatKey(for: window), let panel = panels[key] else { return }
        if let spot = findSpot(mouse: mouse, dragged: window, allowed: panel.dockAllowedEdges) {
            overlay.show(spot.hint)
        } else {
            overlay.hide()
        }
    }

    /// Returns true when the release docked the window somewhere.
    func dragEnded(window: NSWindow, mouse: NSPoint) -> Bool {
        overlay.hide()
        guard !locked,
              let key = floatKey(for: window), let panel = panels[key],
              let spot = findSpot(mouse: mouse, dragged: window, allowed: panel.dockAllowedEdges)
        else { return false }
        switch spot.target {
        case .group(let group, let relativeKey):
            dock(panel, into: group, edge: spot.edge, relativeTo: relativeKey.flatMap { panels[$0] })
            group.reveal()
        case .float(let targetKey):
            guard let target = panels[targetKey] else { return false }
            merge(dragged: panel, target: target, edge: spot.edge)
        }
        return true
    }

    // MARK: Dock / undock

    func dock(_ panel: DockablePanel, into group: DockGroupController,
              edge: DockEdge, relativeTo target: DockablePanel?) {
        if let host = panel.dockHost {
            guard host !== group else { return }
            undock(panel, show: false)
        }
        panel.ensureLoaded()
        guard let body = panel.detachDockBody() else { return }
        let accessory = panel.detachDockAccessory()
        panel.panelWindow?.orderOut(nil)
        group.insert(
            panel: panel, body: body, accessory: accessory,
            edge: edge, relativeToKey: target?.dockKey
        )
        panel.dockHost = group
        panel.dockStateChanged(docked: true)
        onGroupChanged?()
        fputs("reactable: docked \(panel.dockKey) (\(group.panelKeys.joined(separator: "+")))\n", stderr)
    }

    func undock(_ panel: DockablePanel, show: Bool, at frame: NSRect? = nil) {
        guard let group = panel.dockHost else { return }
        detach(panel, from: group, show: show, at: frame)
        dissolveIfNeeded(group)
    }

    /// Tear a docked panel out mid-gesture: back to a float under the pointer,
    /// with the window drag continuing seamlessly.
    func tearOut(key: String, from group: DockGroupController) {
        guard !locked else { return }
        guard let panel = panels[key] else { return }
        let rect = group.screenRect(forKey: key)
        undock(panel, show: true, at: rect)
        if let win = panel.panelWindow { WindowDrag.begin(window: win) }
    }

    /// Per-panel menu action: pop the panel out to a standalone float in place.
    func undockByKey(_ key: String) {
        guard !locked, let panel = panels[key], panel.dockHost != nil else { return }
        undock(panel, show: true)
    }

    /// Per-panel menu action: remove from its group (if docked) and hide it.
    func closeByKey(_ key: String) {
        guard let panel = panels[key] else { return }
        if panel.dockHost != nil {
            guard !locked else { return }
            undock(panel, show: false)
        }
        panel.panelWindow?.orderOut(nil)
    }

    /// Build the shared per-panel menu (Undock only when docked, then Close).
    func panelMenu(forKey key: String) -> NSMenu {
        let menu = NSMenu()
        let docked = panels[key]?.dockHost != nil
        if docked {
            menu.addItem(PanelMenuItem(title: "Undock", key: key) { [weak self] in self?.undockByKey(key) })
        }
        menu.addItem(PanelMenuItem(title: "Close Panel", key: key) { [weak self] in self?.closeByKey(key) })
        return menu
    }

    func hideGroup(_ group: DockGroupController) {
        group.window.orderOut(nil)
    }

    /// Gather panels (in order, left→right columns) into one combined window.
    @discardableResult
    func gather(_ list: [DockablePanel], frame: NSRect, fractions: [CGFloat] = []) -> DockGroupController? {
        guard !list.isEmpty else { return nil }
        explodeAll(show: false)
        let group = makeGroup(frame: frame)
        var previous: DockablePanel?
        for panel in list {
            dock(panel, into: group, edge: .right, relativeTo: previous)
            previous = panel
        }
        group.reveal()  // show at full size FIRST, else the split dumps the
        if !fractions.isEmpty { group.setColumnFractions(fractions) }  // extra width into the last pane
        return group
    }

    /// Panel lookup for layout restore (keys come from layouts.json).
    func panel(forKey key: String) -> DockablePanel? { panels[key] }

    /// Rebuild groups from snapshots: explode everything, then dock column by
    /// column (first cell of each column docks right of the previous column's
    /// anchor; the rest stack below) and re-apply the split fractions.
    func restoreGroups(_ snaps: [DockGroupSnapshot]) {
        explodeAll(show: false)
        for snap in snaps {
            let known = snap.columns.map { $0.compactMap { panels[$0] } }.filter { !$0.isEmpty }
            guard !known.isEmpty else { continue }
            let group = makeGroup(frame: snap.frame)
            var columnAnchor: DockablePanel?
            for column in known {
                var rowAnchor: DockablePanel?
                for (row, panel) in column.enumerated() {
                    if row == 0 {
                        dock(panel, into: group, edge: .right, relativeTo: columnAnchor)
                        columnAnchor = panel
                    } else {
                        dock(panel, into: group, edge: .bottom, relativeTo: rowAnchor)
                    }
                    rowAnchor = panel
                }
            }
            group.reveal()  // full size first, then proportions
            if !snap.columnFractions.isEmpty { group.setColumnFractions(snap.columnFractions) }
            for (idx, fractions) in snap.rowFractions.enumerated() where fractions.count > 1 {
                group.setRowFractions(fractions, inColumn: idx)
            }
        }
    }

    /// Dissolve every group back to floating windows.
    func explodeAll(show: Bool = true) {
        while let group = groups.first {
            let visible = group.window.isVisible
            while let key = group.panelKeys.first, let panel = panels[key] {
                detach(panel, from: group, show: show && visible, at: group.screenRect(forKey: key))
            }
            closeGroup(group)
        }
    }

    // MARK: Internals

    private func floatKey(for window: NSWindow) -> String? {
        panels.first { $0.value.dockHost == nil && $0.value.panelWindow === window }?.key
    }

    private func makeGroup(frame: NSRect) -> DockGroupController {
        let group = DockGroupController(frame: frame)
        groups.append(group)
        return group
    }

    private func closeGroup(_ group: DockGroupController) {
        groups.removeAll { $0 === group }
        group.window.orderOut(nil)
        group.window.close()
    }

    private func detach(_ panel: DockablePanel, from group: DockGroupController,
                        show: Bool, at frame: NSRect?) {
        let cellRect = group.screenRect(forKey: panel.dockKey)
        guard let parts = group.remove(key: panel.dockKey) else { return }
        panel.dockHost = nil
        panel.reattachDockBody(parts.body, accessory: parts.accessory)
        panel.dockStateChanged(docked: false)
        onGroupChanged?()
        if let win = panel.panelWindow {
            var f = frame ?? cellRect ?? win.frame
            f.size.width = max(f.width, win.minSize.width)
            f.size.height = max(f.height, win.minSize.height)
            if let fixed = panel.dockFixedHeight {
                // Strip panels float at their natural height, not the cell's.
                f.size.height = fixed
            }
            win.setFrame(f, display: true)
            if show { win.makeKeyAndOrderFront(nil) }
        }
    }

    private func dissolveIfNeeded(_ group: DockGroupController) {
        // A group of one is just a window with extra chrome — dissolve it.
        if group.cellCount == 1, let lastKey = group.panelKeys.first, let last = panels[lastKey] {
            let frame = group.window.frame
            let visible = group.window.isVisible
            detach(last, from: group, show: visible, at: frame)
        }
        if group.cellCount == 0 { closeGroup(group) }
    }

    private func merge(dragged: DockablePanel, target: DockablePanel, edge: DockEdge) {
        guard let targetWin = target.panelWindow, let draggedWin = dragged.panelWindow else { return }
        let merged = mergedFrame(target: targetWin.frame, dragged: draggedWin.frame, edge: edge)
        // Start the group where the target already sits, then grow into the
        // merged frame — the two windows visibly become one instead of snapping.
        let group = makeGroup(frame: targetWin.frame)
        dock(target, into: group, edge: .right, relativeTo: nil)
        dock(dragged, into: group, edge: edge, relativeTo: target)
        group.reveal()
        group.window.setFrame(merged, display: true, animate: true)
    }

    /// Group frame = target frame grown along the dock axis to make room,
    /// clamped to the target's screen.
    private func mergedFrame(target: NSRect, dragged: NSRect, edge: DockEdge) -> NSRect {
        var f = target
        switch edge {
        case .left:
            f.origin.x -= dragged.width
            f.size.width += dragged.width
            f.size.height = max(target.height, dragged.height)
        case .right:
            f.size.width += dragged.width
            f.size.height = max(target.height, dragged.height)
        case .top:
            f.size.height += dragged.height
            f.size.width = max(target.width, dragged.width)
        case .bottom:
            f.origin.y -= dragged.height
            f.size.height += dragged.height
            f.size.width = max(target.width, dragged.width)
        }
        if let screen = NSScreen.screens.first(where: { $0.frame.intersects(target) }) ?? NSScreen.main {
            let v = screen.visibleFrame
            f.size.width = min(f.width, v.width)
            f.size.height = min(f.height, v.height)
            f.origin.x = min(max(f.minX, v.minX), v.maxX - f.width)
            f.origin.y = min(max(f.minY, v.minY), v.maxY - f.height)
        }
        return f
    }

    // MARK: Drop-spot resolution

    private enum SpotTarget {
        case group(DockGroupController, relativeKey: String?)
        case float(String)
    }

    private struct DropSpot {
        let target: SpotTarget
        let edge: DockEdge
        let hint: NSRect
    }

    private func findSpot(mouse: NSPoint, dragged: NSWindow, allowed: [DockEdge]) -> DropSpot? {
        // Groups first (they're the bigger targets and usually frontmost).
        for group in groups where group.window.isVisible {
            let wf = group.window.frame
            guard wf.contains(mouse) else { continue }
            // Outer left/right bands add a new outermost column.
            let band: CGFloat = 34
            if allowed.contains(.left), mouse.x < wf.minX + band {
                return DropSpot(target: .group(group, relativeKey: nil), edge: .left,
                                hint: hintRect(wf, .left))
            }
            if allowed.contains(.right), mouse.x > wf.maxX - band {
                return DropSpot(target: .group(group, relativeKey: nil), edge: .right,
                                hint: hintRect(wf, .right))
            }
            if let (key, rect) = group.cellHit(at: mouse),
               let edge = edgeZone(rect, mouse, band: 0.28, allowed: allowed) {
                return DropSpot(target: .group(group, relativeKey: key), edge: edge,
                                hint: hintRect(rect, edge))
            }
            return nil  // over the group but in a cell's center — no dock
        }
        for (key, panel) in panels {
            guard panel.dockHost == nil,
                  let win = panel.panelWindow, win !== dragged, win.isVisible
            else { continue }
            let wf = win.frame
            guard wf.contains(mouse) else { continue }
            if let edge = edgeZone(wf, mouse, band: 0.32, allowed: allowed) {
                return DropSpot(target: .float(key), edge: edge, hint: hintRect(wf, edge))
            }
            return nil
        }
        return nil
    }

    /// Nearest allowed edge if the point sits within `band` (fraction) of it.
    private func edgeZone(_ rect: NSRect, _ point: NSPoint, band: CGFloat,
                          allowed: [DockEdge]) -> DockEdge? {
        guard rect.width > 0, rect.height > 0 else { return nil }
        let rx = (point.x - rect.minX) / rect.width
        let ry = (point.y - rect.minY) / rect.height
        var best: (DockEdge, CGFloat)?
        func consider(_ edge: DockEdge, _ distance: CGFloat) {
            guard allowed.contains(edge), distance < band else { return }
            if best == nil || distance < best!.1 { best = (edge, distance) }
        }
        consider(.left, rx)
        consider(.right, 1 - rx)
        consider(.bottom, ry)
        consider(.top, 1 - ry)
        return best?.0
    }

    private func hintRect(_ rect: NSRect, _ edge: DockEdge) -> NSRect {
        switch edge {
        case .left: NSRect(x: rect.minX, y: rect.minY, width: rect.width / 2, height: rect.height)
        case .right: NSRect(x: rect.midX, y: rect.minY, width: rect.width / 2, height: rect.height)
        case .bottom: NSRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height / 2)
        case .top: NSRect(x: rect.minX, y: rect.midY, width: rect.width, height: rect.height / 2)
        }
    }
}

// MARK: - Group window

/// One combined window: the usual chrome (full drag strip on top) around a
/// column split; each column stacks docked panels, each with a compact header.
@MainActor
final class DockGroupController: NSObject, NSWindowDelegate, NSSplitViewDelegate {
    let window: NSWindow
    private let rootSplit = DockSplitView()
    private var cells: [DockCellView] = []
    private var modeSwitch: NSSegmentedControl?
    /// Desired column-width proportions, reasserted on window resize.
    private var columnFractions: [CGFloat] = []
    /// True while we're programmatically setting divider positions — so the
    /// resulting resize notifications don't get mistaken for a user drag and
    /// overwrite the stored proportions with mid-adjustment garbage.
    private var applyingFractions = false
    /// Set when fractions are requested but the split had no width yet; the
    /// split's onLayout applies them on the first real layout pass.
    private var pendingFractionApply = false
    /// True only while the user is actively dragging a column divider.
    private var userDraggingDivider = false

    var cellCount: Int { cells.count }
    var panelKeys: [String] { cells.map(\.key) }

    /// Floor size below which cells clip content. Recomputed on every dock/undock.
    private static let minGroupSize = NSSize(width: 480, height: 320)

    init(frame: NSRect) {
        window = KeyableWindow(
            contentRect: frame,
            styleMask: [.borderless, .fullSizeContentView, .resizable, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        super.init()
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.minSize = Self.minGroupSize
        window.title = "Reactable"
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = true
        window.isMovableByWindowBackground = false
        FloatingWindow.configure(window)

        let root = NSView()
        Chrome.styleRoot(root)
        window.contentView = root

        let strip = DragStripView()
        strip.showsGrip = false
        strip.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(strip)

        // Stoplights leading (real AppKit buttons — close hides the group),
        // name centered.
        let buttonTypes: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]
        for (i, type) in buttonTypes.enumerated() {
            guard let button = NSWindow.standardWindowButton(
                type, for: [.titled, .closable, .miniaturizable, .resizable]
            ) else { continue }
            button.translatesAutoresizingMaskIntoConstraints = false
            strip.addSubview(button)
            NSLayoutConstraint.activate([
                button.leadingAnchor.constraint(equalTo: strip.leadingAnchor, constant: 12 + CGFloat(i) * 20),
                button.centerYAnchor.constraint(equalTo: strip.centerYAnchor, constant: 3),
            ])
        }

        // Centered Record|Edit page switch — DaVinci Resolve's mode tabs. Icon +
        // label per segment, sized to sit as the visual anchor of the header.
        let seg = NSSegmentedControl(frame: .zero)
        seg.segmentCount = 2
        seg.trackingMode = .selectOne
        seg.target = self
        seg.action = #selector(modeSwitched(_:))
        seg.segmentStyle = .rounded
        seg.controlSize = .large
        seg.font = .systemFont(ofSize: 12, weight: .semibold)
        seg.setLabel("Record", forSegment: 0)
        seg.setLabel("Edit", forSegment: 1)
        seg.setImage(Self.symbol("record.circle", "Record"), forSegment: 0)
        seg.setImage(Self.symbol("slider.horizontal.3", "Edit"), forSegment: 1)
        seg.setImageScaling(.scaleProportionallyDown, forSegment: 0)
        seg.setImageScaling(.scaleProportionallyDown, forSegment: 1)
        seg.setWidth(104, forSegment: 0)
        seg.setWidth(92, forSegment: 1)
        seg.selectedSegment = (DockController.shared.modeProvider?() ?? .record) == .record ? 0 : 1
        seg.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(seg)
        modeSwitch = seg

        let burger = NSButton(title: "☰", target: self, action: #selector(showHamburger(_:)))
        burger.isBordered = false
        burger.font = .systemFont(ofSize: 14, weight: .semibold)
        burger.contentTintColor = NSColor(white: 1, alpha: 0.55)
        burger.toolTip = "Layouts"
        burger.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(burger)

        let gear = NSButton(image: Self.symbol("gearshape", "Settings") ?? NSImage(),
                            target: self, action: #selector(openSettings))
        gear.isBordered = false
        gear.imageScaling = .scaleProportionallyDown
        gear.contentTintColor = NSColor(white: 1, alpha: 0.55)
        gear.toolTip = "Settings"
        gear.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(gear)

        NSLayoutConstraint.activate([
            seg.centerXAnchor.constraint(equalTo: strip.centerXAnchor),
            seg.centerYAnchor.constraint(equalTo: strip.centerYAnchor, constant: 2),
            burger.trailingAnchor.constraint(equalTo: strip.trailingAnchor, constant: -14),
            burger.centerYAnchor.constraint(equalTo: strip.centerYAnchor, constant: 2),
            gear.trailingAnchor.constraint(equalTo: burger.leadingAnchor, constant: -12),
            gear.centerYAnchor.constraint(equalTo: strip.centerYAnchor, constant: 2),
        ])

        rootSplit.isVertical = true
        rootSplit.dividerStyle = .thin
        rootSplit.delegate = self
        rootSplit.onLayout = { [weak self] in
            guard let self, self.pendingFractionApply, !self.applyingFractions else { return }
            self.applyColumnFractions()
        }
        rootSplit.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(rootSplit)

        NSLayoutConstraint.activate([
            strip.topAnchor.constraint(equalTo: root.topAnchor),
            strip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            strip.heightAnchor.constraint(equalToConstant: Chrome.groupHeaderHeight),
            rootSplit.topAnchor.constraint(equalTo: strip.bottomAnchor, constant: 2),
            rootSplit.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            rootSplit.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            rootSplit.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ])
        // Corner grab marks like every other panel — the group is borderless,
        // so its edges alone were an invisible resize target.
        ResizeCornersView.attach(to: root)
    }

    // MARK: NSSplitViewDelegate — keep cells from being crushed below their
    // content minimum during a divider drag.

    func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposedMin: CGFloat, dividerIndex: Int) -> CGFloat {
        guard let split = splitView as? DockSplitView else { return proposedMin }
        let before = split.arrangedSubviews.prefix(dividerIndex + 1)
        let floor = before.reduce(0) { $0 + minExtent(of: $1, vertical: split.isVertical) }
            + CGFloat(dividerIndex) * split.dividerThickness
        return max(proposedMin, floor)
    }

    func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposedMax: CGFloat, dividerIndex: Int) -> CGFloat {
        guard let split = splitView as? DockSplitView else { return proposedMax }
        let total = split.isVertical ? split.bounds.width : split.bounds.height
        let after = split.arrangedSubviews.suffix(split.arrangedSubviews.count - dividerIndex - 1)
        let reserve = after.reduce(0) { $0 + minExtent(of: $1, vertical: split.isVertical) }
            + CGFloat(split.arrangedSubviews.count - dividerIndex - 1) * split.dividerThickness
        return min(proposedMax, total - reserve)
    }

    private func minExtent(of view: NSView, vertical: Bool) -> CGFloat {
        // A column of cells: min extent is the sum (stacked) or max (side by side).
        if let col = view as? DockSplitView {
            let extents = col.arrangedSubviews.map { minExtent(of: $0, vertical: col.isVertical) }
            let stacked = vertical == col.isVertical
            return stacked ? extents.reduce(0, +) : (extents.max() ?? 0)
        }
        if let cell = view as? DockCellView {
            let m = DockController.shared.panel(forKey: cell.key)?.dockMinSize ?? NSSize(width: 240, height: 160)
            return vertical ? m.width : m.height + DockCellView.headerHeight + 2
        }
        return vertical ? 240 : 160
    }

    /// window.minSize = the group's own chrome + the tightest arrangement of
    /// cells. Called after every dock/undock so cells can never be clipped.
    func recalcMinSize() {
        window.layoutIfNeeded()
        let columns = rootSplit.arrangedSubviews.compactMap { $0 as? DockSplitView }
        guard !columns.isEmpty else { window.minSize = Self.minGroupSize; return }
        let contentW = columns.reduce(0) { $0 + minExtent(of: $1, vertical: true) }
            + CGFloat(columns.count - 1) * rootSplit.dividerThickness
        let contentH = columns.map { minExtent(of: $0, vertical: false) }.max() ?? 0
        let chromeW = Chrome.frameMargin * 2
        let chromeH = Chrome.groupHeaderHeight + 2 + Chrome.frameMargin
        window.minSize = NSSize(
            width: max(Self.minGroupSize.width, contentW + chromeW),
            height: max(Self.minGroupSize.height, contentH + chromeH)
        )
    }

    func reveal() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    /// SF Symbol tuned for the header segment (template so it tints with the control).
    private static func symbol(_ name: String, _ desc: String) -> NSImage? {
        let img = NSImage(systemSymbolName: name, accessibilityDescription: desc)?
            .withSymbolConfiguration(.init(pointSize: 12, weight: .semibold))
        img?.isTemplate = true
        return img
    }

    /// Seed / sync the header's Record|Edit segment.
    func setMode(_ mode: AppMode) {
        modeSwitch?.selectedSegment = mode == .record ? 0 : 1
    }

    @objc private func modeSwitched(_ sender: NSSegmentedControl) {
        DockController.shared.onModeSwitch?(sender.selectedSegment == 0 ? .record : .edit)
    }

    @objc private func showHamburger(_ sender: NSButton) {
        guard let menu = DockController.shared.hamburgerMenu?() else { return }
        menu.popUp(positioning: nil,
                   at: NSPoint(x: sender.bounds.minX, y: sender.bounds.maxY + 4),
                   in: sender)
    }

    @objc private func openSettings() {
        DockController.shared.onOpenSettings?()
    }

    // MARK: Layout mutations

    func insert(panel: DockablePanel, body: NSView, accessory: NSView?,
                edge: DockEdge, relativeToKey: String?) {
        let cell = DockCellView(
            key: panel.dockKey, title: panel.dockTitle,
            body: body, accessory: accessory, minSize: panel.dockMinSize,
            fixedHeight: panel.dockFixedHeight, showsHeader: panel.dockShowsHeader
        )
        cell.onTearOut = { [weak self] in
            guard let self else { return }
            DockController.shared.tearOut(key: cell.key, from: self)
        }

        if let relativeToKey,
           let targetCell = cells.first(where: { $0.key == relativeToKey }),
           let column = targetCell.superview as? DockSplitView,
           let rowIdx = column.arrangedSubviews.firstIndex(of: targetCell),
           let colIdx = rootSplit.arrangedSubviews.firstIndex(of: column) {
            fputs("dock insert \(panel.dockKey) edge=\(edge) rel=\(relativeToKey) row=\(rowIdx) col=\(colIdx)\n", stderr)
            switch edge {
            case .top:
                column.insertArrangedSubview(cell, at: rowIdx)
            case .bottom:
                column.insertArrangedSubview(cell, at: rowIdx + 1)
            case .left:
                rootSplit.insertArrangedSubview(newColumn(with: cell), at: colIdx)
            case .right:
                rootSplit.insertArrangedSubview(newColumn(with: cell), at: colIdx + 1)
            }
        } else {
            fputs("dock insert \(panel.dockKey) edge=\(edge) rel=\(relativeToKey ?? "-") FALLBACK outer column\n", stderr)
            // No anchor: outermost column on the chosen side.
            let at = edge == .left ? 0 : rootSplit.arrangedSubviews.count
            rootSplit.insertArrangedSubview(newColumn(with: cell), at: at)
        }
        cells.append(cell)
        reflow()
    }

    func remove(key: String) -> (body: NSView, accessory: NSView?)? {
        guard let cell = cells.first(where: { $0.key == key }) else { return nil }
        let column = cell.superview as? DockSplitView
        let body = cell.releaseBody()
        let accessory = cell.releaseAccessory()
        cell.removeFromSuperview()
        if let column, column.arrangedSubviews.isEmpty { column.removeFromSuperview() }
        cells.removeAll { $0 === cell }
        reflow()
        guard let body else { return nil }
        return (body, accessory)
    }

    /// Animate the split reflow after a cell is added or removed, then keep
    /// window.minSize in step with what the cells actually need. Docking a new
    /// cell (e.g. the bar under the stage) re-lays-out the split and would
    /// otherwise reset the column widths, so reassert the stored proportions.
    private func reflow() {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = Chrome.reflowAnimDuration
            ctx.allowsImplicitAnimation = true
            window.layoutIfNeeded()
        }
        applyColumnFractions()
        recalcMinSize()
    }

    /// Column widths as fractions of the split (combined-mode default layout).
    /// Stored so a window resize keeps the proportions instead of dumping all
    /// the new width into the trailing pane (NSSplitView's default).
    func setColumnFractions(_ fractions: [CGFloat]) {
        columnFractions = fractions
        // The borderless group window doesn't size its split synchronously on
        // reveal, so bounds.width can still be 0 here. Mark it pending; the
        // split's onLayout applies it the instant it first gets a real width.
        pendingFractionApply = true
        applyColumnFractions()
    }

    private func applyColumnFractions() {
        let columns = rootSplit.arrangedSubviews
        guard columns.count > 1, columnFractions.count >= columns.count - 1 else { return }
        let total = rootSplit.bounds.width
            - CGFloat(columns.count - 1) * rootSplit.dividerThickness
        guard total > 0 else { return }  // not sized yet — onLayout will retry
        applyingFractions = true
        var x: CGFloat = 0
        for i in 0..<(columns.count - 1) {
            x += total * columnFractions[i]
            rootSplit.setPosition(x + CGFloat(i) * rootSplit.dividerThickness, ofDividerAt: i)
        }
        applyingFractions = false
        pendingFractionApply = false
    }

    /// Snapshot the current column widths as fractions — called after the user
    /// drags a divider so a later window resize preserves their choice.
    private func captureColumnFractions() {
        let columns = rootSplit.arrangedSubviews
        guard columns.count > 1 else { return }
        let total = columns.reduce(0) { $0 + $1.frame.width }
        guard total > 0 else { return }
        columnFractions = columns.map { $0.frame.width / total }
    }

    // MARK: NSSplitViewDelegate — keep the ROOT columns proportional.

    /// Called ONLY during an interactive divider drag (not programmatic
    /// setPosition, not automatic resize) — the reliable "user is dragging" signal.
    func splitView(_ splitView: NSSplitView, constrainSplitPosition proposedPosition: CGFloat,
                   ofSubviewAt dividerIndex: Int) -> CGFloat {
        if (splitView as AnyObject) === rootSplit {
            userDraggingDivider = true
            DispatchQueue.main.async { [weak self] in self?.userDraggingDivider = false }
        }
        return proposedPosition
    }

    func splitViewDidResizeSubviews(_ notification: Notification) {
        // Only the root split tracks column fractions; ignore nested row splits.
        guard (notification.object as AnyObject) === rootSplit else { return }
        // ONLY adopt new proportions from a genuine user drag. NSSplitView fires
        // this (with a divider index) during its own automatic layout too, which
        // would otherwise capture intermediate garbage and clobber the defaults.
        guard !applyingFractions, userDraggingDivider else { return }
        captureColumnFractions()
    }

    func windowDidResize(_ notification: Notification) {
        // Reassert the stored proportions so the middle column keeps its share.
        applyColumnFractions()
        recalcMinSize()
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        // Persist the new sizes once the drag settles (onGroupChanged also saves).
        DockController.shared.onGroupChanged?()
    }

    /// Row heights within one column, as fractions of the column height.
    /// Dividers touching fixed-height cells (the bar's pinned row) are left
    /// alone — the 950-priority pin wins that fight anyway.
    func setRowFractions(_ fractions: [CGFloat], inColumn index: Int) {
        window.layoutIfNeeded()
        guard let column = rootSplit.arrangedSubviews[safe: index] as? DockSplitView else { return }
        let rows = column.arrangedSubviews
        guard rows.count > 1, fractions.count >= rows.count - 1 else { return }
        let fixed = Set(rows.enumerated().compactMap { i, v -> Int? in
            guard let cell = v as? DockCellView,
                  DockController.shared.panel(forKey: cell.key)?.dockFixedHeight != nil else { return nil }
            return i
        })
        let total = column.bounds.height - CGFloat(rows.count - 1) * column.dividerThickness
        var y: CGFloat = 0
        for i in 0..<(rows.count - 1) {
            y += total * fractions[i]
            guard !fixed.contains(i), !fixed.contains(i + 1) else { continue }
            column.setPosition(y + CGFloat(i) * column.dividerThickness, ofDividerAt: i)
        }
    }

    /// Spatial snapshot for named layouts — walks the split hierarchy (the
    /// `cells` array is insertion-ordered and would scramble the restore).
    func layoutSnapshot() -> DockGroupSnapshot {
        window.layoutIfNeeded()
        var columns: [[String]] = []
        var columnFractions: [CGFloat] = []
        var rowFractions: [[CGFloat]] = []
        let columnViews = rootSplit.arrangedSubviews.compactMap { $0 as? DockSplitView }
        let totalW = max(1, columnViews.reduce(0) { $0 + $1.frame.width })
        for column in columnViews {
            let cellViews = column.arrangedSubviews.compactMap { $0 as? DockCellView }
            columns.append(cellViews.map(\.key))
            columnFractions.append(column.frame.width / totalW)
            let totalH = max(1, cellViews.reduce(0) { $0 + $1.frame.height })
            rowFractions.append(cellViews.map { $0.frame.height / totalH })
        }
        return DockGroupSnapshot(
            frame: window.frame,
            columns: columns,
            columnFractions: columnFractions,
            rowFractions: rowFractions
        )
    }

    // MARK: Hit testing

    func screenRect(forKey key: String) -> NSRect? {
        guard let cell = cells.first(where: { $0.key == key }), cell.window === window else { return nil }
        return window.convertToScreen(cell.convert(cell.bounds, to: nil))
    }

    func cellHit(at screenPoint: NSPoint) -> (key: String, rect: NSRect)? {
        for cell in cells {
            guard let rect = screenRect(forKey: cell.key) else { continue }
            if rect.contains(screenPoint) { return (cell.key, rect) }
        }
        return nil
    }

    private func newColumn(with cell: DockCellView) -> DockSplitView {
        let column = DockSplitView()
        column.isVertical = false
        column.dividerStyle = .thin
        column.addArrangedSubview(cell)
        return column
    }
}

/// Split view with a subtle dark divider matching the chrome.
final class DockSplitView: NSSplitView {
    override var dividerThickness: CGFloat { 7 }

    /// Fires after every layout pass — the group uses it to apply its stored
    /// column proportions the moment the split first gets a real width.
    var onLayout: (() -> Void)?

    override func layout() {
        super.layout()
        onLayout?()
    }

    override func drawDivider(in rect: NSRect) {
        Chrome.strokeOuter.setFill()
        let line = isVertical
            ? NSRect(x: rect.midX - 0.5, y: rect.minY + 6, width: 1, height: rect.height - 12)
            : NSRect(x: rect.minX + 6, y: rect.midY - 0.5, width: rect.width - 12, height: 1)
        line.fill()
    }
}

// MARK: - Cell (compact header + body)

/// A docked panel: compact 22px header (grip, title, optional accessory, ✕)
/// over the panel's content frame. Dragging the header tears the panel out.
@MainActor
final class DockCellView: NSView {
    let key: String
    var onTearOut: (() -> Void)?

    private let header: DockCellHeaderView
    private var body: NSView?
    private var accessory: NSView?

    static let headerHeight: CGFloat = Chrome.cellHeaderHeight

    init(key: String, title: String, body: NSView, accessory: NSView?,
         minSize: NSSize, fixedHeight: CGFloat? = nil, showsHeader: Bool = true) {
        self.key = key
        self.header = DockCellHeaderView(title: title)
        self.body = body
        self.accessory = accessory
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false

        // The body arrives already framed — panels dock their ContentFrameView,
        // the bar docks its self-chromed webview. Wrapping it in a second frame
        // here is what used to stack strokes inside AND outside every cell.
        body.translatesAutoresizingMaskIntoConstraints = false
        addSubview(body)

        var constraints = [
            body.leadingAnchor.constraint(equalTo: leadingAnchor),
            body.trailingAnchor.constraint(equalTo: trailingAnchor),
            body.bottomAnchor.constraint(equalTo: bottomAnchor),
        ]
        let headerSpace: CGFloat
        if showsHeader {
            header.translatesAutoresizingMaskIntoConstraints = false
            header.onDragStart = { [weak self] in self?.onTearOut?() }
            header.onMenu = { DockController.shared.panelMenu(forKey: key) }
            addSubview(header)
            constraints.append(contentsOf: [
                header.topAnchor.constraint(equalTo: topAnchor),
                header.leadingAnchor.constraint(equalTo: leadingAnchor),
                header.trailingAnchor.constraint(equalTo: trailingAnchor),
                header.heightAnchor.constraint(equalToConstant: Self.headerHeight),
                body.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 2),
            ])
            headerSpace = Self.headerHeight + 2
        } else {
            // Headerless strip (the bar): body IS the cell, exactly content-sized.
            constraints.append(body.topAnchor.constraint(equalTo: topAnchor))
            headerSpace = 0
        }
        // Keep the split from crushing a panel to nothing; soft so a small
        // group window degrades instead of hard-conflicting.
        let minW = widthAnchor.constraint(greaterThanOrEqualToConstant: minSize.width)
        minW.priority = NSLayoutConstraint.Priority(900)
        constraints.append(minW)
        if let fixedHeight {
            // Strip panels (the bar) pin their row height; the split can't stretch them.
            let pin = heightAnchor.constraint(equalToConstant: fixedHeight + headerSpace)
            pin.priority = NSLayoutConstraint.Priority(950)
            constraints.append(pin)
        } else {
            let minH = heightAnchor.constraint(
                greaterThanOrEqualToConstant: minSize.height + headerSpace)
            minH.priority = NSLayoutConstraint.Priority(900)
            constraints.append(minH)
        }
        NSLayoutConstraint.activate(constraints)

        if showsHeader, let accessory { header.setAccessory(accessory) }
    }

    required init?(coder: NSCoder) { nil }

    func releaseBody() -> NSView? {
        let view = body
        view?.removeFromSuperview()
        body = nil
        return view
    }

    func releaseAccessory() -> NSView? {
        let view = accessory
        view?.removeFromSuperview()
        accessory = nil
        return view
    }
}

/// A ⋯ button that fades in on hover and pops a menu built on demand. Used in
/// docked cell headers (Undock / Close) and floating panel strips (Close).
@MainActor
final class HoverMenuButton: NSButton {
    var menuProvider: (() -> NSMenu)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        title = "⋯"
        isBordered = false
        font = .systemFont(ofSize: 15, weight: .bold)
        contentTintColor = NSColor(white: 1, alpha: 0.6)
        alphaValue = 0
        target = self
        action = #selector(pop)
    }
    required init?(coder: NSCoder) { nil }

    @objc private func pop() {
        guard let menu = menuProvider?() else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.maxY + 4), in: self)
    }

    func reveal(_ on: Bool) {
        NSAnimationContext.runAnimationGroup { c in
            c.duration = on ? 0.12 : 0.2
            animator().alphaValue = on ? 1 : 0
        }
    }
}

/// The compact chrome of a docked panel — the tear-out drag handle.
@MainActor
final class DockCellHeaderView: NSView {
    var onDragStart: (() -> Void)?
    /// Builds the ⋯ menu (Undock / Close). Set by the owning cell.
    var onMenu: (() -> NSMenu)? {
        didSet { menuButton.menuProvider = onMenu }
    }

    private let label: NSTextField
    private let menuButton = HoverMenuButton()
    private var monitor: Any?

    init(title: String) {
        label = NSTextField(labelWithString: title)
        super.init(frame: .zero)
        label.font = .systemFont(ofSize: 10.5, weight: .semibold)
        label.textColor = NSColor(white: 1, alpha: 0.5)
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)

        menuButton.translatesAutoresizingMaskIntoConstraints = false
        menuButton.toolTip = "Panel options"
        addSubview(menuButton)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 22),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, multiplier: 0.5),
            menuButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            menuButton.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        toolTip = "Drag to tear out"
    }

    required init?(coder: NSCoder) { nil }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self, userInfo: nil))
    }

    override func mouseEntered(with event: NSEvent) { menuButton.reveal(true) }
    override func mouseExited(with event: NSEvent) { menuButton.reveal(false) }

    func setAccessory(_ view: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(view)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 10),
            view.topAnchor.constraint(equalTo: topAnchor),
            view.bottomAnchor.constraint(equalTo: bottomAnchor),
            view.trailingAnchor.constraint(lessThanOrEqualTo: menuButton.leadingAnchor, constant: -8),
        ])
    }

    override func draw(_ dirtyRect: NSRect) {
        // Compact grip: four dots on the leading edge.
        NSColor(white: 1, alpha: 0.24).setFill()
        let r: CGFloat = 1.3
        let dx: CGFloat = 5, dy: CGFloat = 5
        for col in 0...1 {
            for row in 0...1 {
                let x = 8 + CGFloat(col) * dx - r
                let y = bounds.midY + (CGFloat(row) - 0.5) * dy - r
                NSBezierPath(ovalIn: NSRect(x: x, y: y, width: r * 2, height: r * 2)).fill()
            }
        }
    }

    override func mouseDown(with event: NSEvent) {
        endMonitor()
        let start = NSEvent.mouseLocation
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] ev in
            guard let self else { return ev }
            switch ev.type {
            case .leftMouseDragged:
                let now = NSEvent.mouseLocation
                if hypot(now.x - start.x, now.y - start.y) > 10 {
                    self.endMonitor()
                    self.onDragStart?()  // tear-out; WindowDrag takes over the gesture
                }
                return nil
            case .leftMouseUp:
                self.endMonitor()
                return ev
            default:
                return ev
            }
        }
    }

    private func endMonitor() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}

// MARK: - Drop hint

/// Translucent accent rect over the half of the target the drop will occupy.
@MainActor
final class DropHintOverlay {
    private var window: NSWindow?

    func show(_ frame: NSRect) {
        if window == nil {
            let w = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
            w.isReleasedWhenClosed = false
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.ignoresMouseEvents = true
            w.level = .statusBar
            w.collectionBehavior.insert(.canJoinAllSpaces)
            w.contentView = HintView()
            window = w
        }
        window?.setFrame(frame, display: true)
        window?.orderFrontRegardless()
    }

    func hide() {
        window?.orderOut(nil)
    }

    private final class HintView: NSView {
        override func draw(_ dirtyRect: NSRect) {
            let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 3, dy: 3),
                                    xRadius: Chrome.radiusInner, yRadius: Chrome.radiusInner)
            NSColor.controlAccentColor.withAlphaComponent(0.22).setFill()
            path.fill()
            NSColor.controlAccentColor.withAlphaComponent(0.8).setStroke()
            path.lineWidth = 2
            path.stroke()
        }
    }
}
