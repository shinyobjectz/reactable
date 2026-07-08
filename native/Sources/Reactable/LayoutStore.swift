import CoreGraphics
import Foundation

// Named workspace layouts: layout mode + app mode + every group's spatial
// composition (columns of panel keys + split fractions) + floating panel
// frames. Saved from the hamburger / tray, applied from the same menus.
// Persisted next to pipeline.json at ~/Reactable/layouts.json.

struct PanelFrameSnapshot: Codable {
    var key: String
    var frame: CGRect
    var visible: Bool
}

struct DockGroupSnapshot: Codable {
    var frame: CGRect
    /// Spatial order — outer array = columns left→right, inner = cells
    /// top→bottom. Derived from the split-view hierarchy, never from
    /// insertion order.
    var columns: [[String]]
    /// Column widths as fractions of the split's content width.
    var columnFractions: [CGFloat]
    /// Per column, cell heights as fractions of the column height.
    var rowFractions: [[CGFloat]]
}

struct LayoutSnapshot: Codable {
    var name: String
    var layoutMode: String
    var appMode: String
    var groups: [DockGroupSnapshot]
    var floats: [PanelFrameSnapshot]
    var savedAt: Date
}

enum LayoutStore {
    private static var url: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Reactable/layouts.json")
    }
    private static func currentURL(mode: String) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Reactable/layout-\(mode).json")
    }

    /// Each view (record / edit) keeps its OWN live layout, continuously
    /// overwritten as the user arranges it — no manual naming. Switching modes
    /// or relaunching restores that view's remembered arrangement.
    static func saveCurrent(_ snapshot: LayoutSnapshot, mode: String) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        guard let data = try? enc.encode(snapshot) else { return }
        let url = currentURL(mode: mode)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url)
    }

    static func loadCurrent(mode: String) -> LayoutSnapshot? {
        guard let data = try? Data(contentsOf: currentURL(mode: mode)) else { return nil }
        return try? JSONDecoder().decode(LayoutSnapshot.self, from: data)
    }

    /// Forget a view's remembered layout so it falls back to the default.
    static func clearCurrent(mode: String) {
        try? FileManager.default.removeItem(at: currentURL(mode: mode))
    }

    static func load() -> [LayoutSnapshot] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([LayoutSnapshot].self, from: data)) ?? []
    }

    static func upsert(_ snapshot: LayoutSnapshot) {
        var all = load().filter { $0.name != snapshot.name }
        all.append(snapshot)
        all.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        save(all)
    }

    static func delete(name: String) {
        save(load().filter { $0.name != name })
    }

    private static func save(_ all: [LayoutSnapshot]) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(all) else { return }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url)
    }
}
