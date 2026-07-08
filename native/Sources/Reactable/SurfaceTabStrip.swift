import AppKit

// The surface-tab machinery shared by every tabbed host (stage, preview):
// an ordered list of StageSurfaces + the TabBarView that renders them as
// pills. Hosts own the content view; the strip owns which surface is active.
@MainActor
final class SurfaceTabStrip {
    let tabBar = TabBarView()

    private(set) var surfaces: [StageSurface] = []
    private(set) var activeIndex = 0

    /// Tab pills appear at this count. Stage uses 2 (a single deck is the
    /// plain stage, no chrome); the preview panel uses 1 (tabs always shown).
    var minTabsForBar = 2

    /// Load this surface into the host's content view.
    var onActivate: ((StageSurface) -> Void)?
    /// A tab was closed (fires before the next activation) — hosts drop
    /// per-surface caches here.
    var onCloseSurface: ((StageSurface) -> Void)?
    /// Last tab closed — host decides (stage hides, preview hides).
    var onEmpty: (() -> Void)?

    var active: StageSurface? { surfaces[safe: activeIndex] }

    init() {
        tabBar.onSelect = { [weak self] key in self?.activate(key: key) }
        tabBar.onClose = { [weak self] key in self?.close(key: key) }
    }

    /// Open (or focus) a surface as a tab and make it active.
    func open(_ s: StageSurface) {
        if let idx = surfaces.firstIndex(where: { $0.key == s.key }) {
            activeIndex = idx
        } else {
            surfaces.append(s)
            activeIndex = surfaces.count - 1
        }
        rebuild()
        if let active { onActivate?(active) }
    }

    func activate(key: String) {
        guard let idx = surfaces.firstIndex(where: { $0.key == key }) else { return }
        activeIndex = idx
        rebuild()
        if let active { onActivate?(active) }
    }

    func close(key: String) {
        guard let idx = surfaces.firstIndex(where: { $0.key == key }) else { return }
        let closed = surfaces[idx]
        surfaces.remove(at: idx)
        onCloseSurface?(closed)
        if surfaces.isEmpty {
            rebuild()
            onEmpty?()
            return
        }
        activeIndex = min(activeIndex, surfaces.count - 1)
        rebuild()
        if let active { onActivate?(active) }
    }

    func rebuild() {
        let showTabs = surfaces.count >= minTabsForBar
        let tabs = surfaces.map { TabBarView.Tab(key: $0.key, title: $0.title) }
        tabBar.setTabs(showTabs ? tabs : [], active: active?.key)
    }
}
