import Foundation

enum AppPaths {
    /// Reactable project root (`index.work`, decks/, present/, bar/).
    static func projectRoot() -> URL {
        if let bundled = bundledResourceProject(), FileManager.default.fileExists(atPath: bundled.appending(path: "index.work").path()) {
            return bundled
        }

        let dev = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        if FileManager.default.fileExists(atPath: dev.appending(path: "index.work").path()) {
            return dev
        }

        let user = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Reactable/projects/reactable", directoryHint: .isDirectory)
        if FileManager.default.fileExists(atPath: user.appending(path: "index.work").path()) {
            return user.resolvingSymlinksInPath()
        }

        return dev
    }

    /// Elixir nexus runtime (`mix.exs`).
    static func nexusRoot(near projectRoot: URL) -> URL {
        if let env = ProcessInfo.processInfo.environment["REACTABLE_NEXUS"], !env.isEmpty {
            return URL(fileURLWithPath: env, isDirectory: true)
        }

        if let found = searchUp(from: projectRoot, for: "workbooks/nexus/mix.exs") {
            return found.deletingLastPathComponent().deletingLastPathComponent()
        }

        let homeApps = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Apps/workbooks/nexus", directoryHint: .isDirectory)
        if FileManager.default.fileExists(atPath: homeApps.appending(path: "mix.exs").path()) {
            return homeApps
        }

        // Legacy layout from dev tree (Apps/shinyobjectz/workbooks/nexus).
        return projectRoot
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(path: "workbooks/nexus", directoryHint: .isDirectory)
    }

    static func monorepoRoot(from nexusRoot: URL) -> URL {
        nexusRoot
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static func bundledResourceProject() -> URL? {
        Bundle.main.resourceURL?.appending(path: "reactable", directoryHint: .isDirectory)
    }

    private static func searchUp(from start: URL, for relative: String) -> URL? {
        var url = start.standardizedFileURL
        for _ in 0..<8 {
            let candidate = url.appending(path: relative)
            if FileManager.default.fileExists(atPath: candidate.path()) {
                return candidate
            }
            let parent = url.deletingLastPathComponent()
            if parent.path == url.path { break }
            url = parent
        }
        return nil
    }
}
