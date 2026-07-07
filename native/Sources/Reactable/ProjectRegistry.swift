import Foundation

struct ReactableProject: Identifiable, Equatable {
    let id: String
    let name: String
    let url: URL
}

struct DeckInfo: Identifiable, Equatable {
    var id: String { slug }
    let slug: String
    let title: String
}

enum ProjectRegistry {
    static let defaultsProjectKey = "reactable.lastProjectId"
    static let defaultsDeckKey = "reactable.lastDeckSlug"

    static var userRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Reactable", directoryHint: .isDirectory)
    }

    static var userProjectsDir: URL {
        userRoot.appending(path: "projects", directoryHint: .isDirectory)
    }

    static func ensureUserLayout(bundledProject: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: userProjectsDir, withIntermediateDirectories: true)

        let manifest = userRoot.appending(path: "projects.json")
        if !fm.fileExists(atPath: manifest.path()) {
            let seed = ProjectsManifest(
                version: 1,
                paths: [bundledProject.path()],
                notes: "Add absolute paths to Reactable project roots (each must contain index.work)."
            )
            let data = try JSONEncoder().encode(seed)
            try data.write(to: manifest)
        }

        let link = userProjectsDir.appending(path: "reactable", directoryHint: .isDirectory)
        if !fm.fileExists(atPath: link.path()) {
            try? fm.createSymbolicLink(at: link, withDestinationURL: bundledProject)
        }
    }

    static func discover(extraBundled: URL? = nil) -> [ReactableProject] {
        var urls: [URL] = []
        var seen = Set<String>()

        func add(_ url: URL) {
            let p = url.standardizedFileURL.path()
            guard seen.insert(p).inserted else { return }
            guard FileManager.default.fileExists(atPath: url.appending(path: "index.work").path()) else { return }
            urls.append(url.standardizedFileURL)
        }

        if let extraBundled { add(extraBundled) }

        if let manifest = loadManifest() {
            for path in manifest.paths { add(URL(fileURLWithPath: path, isDirectory: true)) }
        }

        if let entries = try? FileManager.default.contentsOfDirectory(
            at: userProjectsDir,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        ) {
            for entry in entries {
                var isDir: ObjCBool = false
                let resolved = (try? entry.resourceValues(forKeys: [.isSymbolicLinkKey]))?.isSymbolicLink == true
                    ? entry.resolvingSymlinksInPath()
                    : entry
                guard FileManager.default.fileExists(atPath: resolved.path(), isDirectory: &isDir), isDir.boolValue else { continue }
                add(resolved)
            }
        }

        return urls.map { url in
            ReactableProject(
                id: projectId(for: url),
                name: projectTitle(at: url) ?? url.lastPathComponent,
                url: url
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func decks(in project: URL) -> [DeckInfo] {
        let root = project.appending(path: "decks", directoryHint: .isDirectory)
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }

        return entries.compactMap { url -> DeckInfo? in
            var isDir: ObjCBool = false
            guard url.hasDirectoryPath,
                  FileManager.default.fileExists(atPath: url.path(), isDirectory: &isDir),
                  isDir.boolValue else { return nil }
            let slug = url.lastPathComponent
            let deckWork = url.appending(path: "deck.work")
            guard FileManager.default.fileExists(atPath: deckWork.path()) else { return nil }
            let title = deckTitle(at: deckWork) ?? slug
            return DeckInfo(slug: slug, title: title)
        }
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    static func projectId(for url: URL) -> String {
        url.lastPathComponent.lowercased()
    }

    static func saveLastSelection(projectId: String, deckSlug: String) {
        UserDefaults.standard.set(projectId, forKey: defaultsProjectKey)
        UserDefaults.standard.set(deckSlug, forKey: defaultsDeckKey)
    }

    /// Scaffold a new project under ~/Reactable/projects/<slug>
    static func createProject(title: String, slug: String? = nil) throws -> ReactableProject {
        let fm = FileManager.default
        try fm.createDirectory(at: userRoot, withIntermediateDirectories: true)
        try fm.createDirectory(at: userProjectsDir, withIntermediateDirectories: true)
        let id = slug ?? slugify(title)
        guard !id.isEmpty else { throw ProjectError.invalidSlug }

        let root = userProjectsDir.appending(path: id, directoryHint: .isDirectory)
        if fm.fileExists(atPath: root.path()) { throw ProjectError.exists(id) }

        try fm.createDirectory(at: root.appending(path: "decks", directoryHint: .isDirectory), withIntermediateDirectories: true)
        try fm.createDirectory(at: root.appending(path: "takes", directoryHint: .isDirectory), withIntermediateDirectories: true)

        let index = "# \(title)\n\nReactable project — created locally.\n"
        try index.write(to: root.appending(path: "index.work"), atomically: true, encoding: .utf8)

        let deckDir = root.appending(path: "decks/\(id)", directoryHint: .isDirectory)
        try fm.createDirectory(at: deckDir, withIntermediateDirectories: true)
        let deck = """
        id: \(id)
        title: \(title)

        slide do
          id: welcome
          type: prose
          body: |
            # \(title)

            Built with Reactable.
        end
        """
        try deck.write(to: deckDir.appending(path: "deck.work"), atomically: true, encoding: .utf8)

        registerPath(root)
        return ReactableProject(id: id, name: title, url: root.standardizedFileURL)
    }

    static func registerPath(_ url: URL) {
        let manifestURL = userRoot.appending(path: "projects.json")
        var paths: [String] = []
        if let data = try? Data(contentsOf: manifestURL),
           let manifest = try? JSONDecoder().decode(ProjectsManifest.self, from: data) {
            paths = manifest.paths
        }
        let p = url.standardizedFileURL.path()
        guard !paths.contains(p) else { return }
        paths.append(p)
        let seed = ProjectsManifest(version: 1, paths: paths, notes: nil)
        if let data = try? JSONEncoder().encode(seed) {
            try? data.write(to: manifestURL)
        }
    }

    private static func slugify(_ title: String) -> String {
        let lowered = title.lowercased()
        let allowed = lowered.unicodeScalars.map { c -> Character in
            if ("a"..."z").contains(c) || ("0"..."9").contains(c) { return Character(c) }
            return "-"
        }
        return String(allowed)
            .replacingOccurrences(of: "--", with: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    enum ProjectError: Error, CustomStringConvertible {
        case invalidSlug
        case exists(String)

        var description: String {
            switch self {
            case .invalidSlug: "Invalid project slug"
            case .exists(let id): "Project already exists: \(id)"
            }
        }
    }

    static func lastSelection(defaultProject: String, defaultDeck: String) -> (projectId: String, deckSlug: String) {
        (
            UserDefaults.standard.string(forKey: defaultsProjectKey) ?? defaultProject,
            UserDefaults.standard.string(forKey: defaultsDeckKey) ?? defaultDeck
        )
    }

    private static func projectTitle(at root: URL) -> String? {
        let path = root.appending(path: "index.work")
        guard let text = try? String(contentsOf: path, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n", maxSplits: 20) {
            let s = String(line)
            if s.hasPrefix("# ") { return String(s.dropFirst(2)).trimmingCharacters(in: .whitespaces) }
        }
        return nil
    }

    private static func deckTitle(at deckWork: URL) -> String? {
        guard let text = try? String(contentsOf: deckWork, encoding: .utf8) else { return nil }
        for line in text.split(separator: "\n") {
            let s = String(line).trimmingCharacters(in: .whitespaces)
            if s.hasPrefix("title:") { return String(s.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
            if s.hasPrefix("id:") { return String(s.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
        }
        return nil
    }

    private static func loadManifest() -> ProjectsManifest? {
        let url = userRoot.appending(path: "projects.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ProjectsManifest.self, from: data)
    }
}

private struct ProjectsManifest: Codable {
    let version: Int
    let paths: [String]
    let notes: String?
}
