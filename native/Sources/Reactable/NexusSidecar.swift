import Foundation

final class NexusSidecar: @unchecked Sendable {
    private let process = Process()
    private let port: Int
    private let nexusRoot: URL
    private let monorepoRoot: URL
    private var projectRoot: URL

    init(nexusRoot: URL, projectRoot: URL, port: Int = 4020) {
        self.nexusRoot = nexusRoot
        self.projectRoot = projectRoot
        self.port = port
        self.monorepoRoot = AppPaths.monorepoRoot(from: nexusRoot)
    }

    var currentProjectRoot: URL { projectRoot }

    func setProjectRoot(_ url: URL) {
        projectRoot = url
    }

    private func bundledNexusBinary() -> URL? {
        if let url = Bundle.main.url(forResource: "reactable-nexus", withExtension: nil) {
            return url
        }
        let macOS = Bundle.main.bundleURL
            .appending(path: "Contents/MacOS/reactable-nexus")
        if FileManager.default.isExecutableFile(atPath: macOS.path(percentEncoded: false)) {
            return macOS
        }
        return nil
    }

    private func sidecarLogURL() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Reactable", isDirectory: true)
            .appendingPathComponent("nexus.log", isDirectory: false)
    }

    private func prepareSidecarLog() throws -> FileHandle {
        let url = sidecarLogURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if (try? url.checkResourceIsReachable()) == true {
            try FileManager.default.removeItem(at: url)
        }
        // URL APIs only — never .path() (percent-encodes "Application Support" → boot failure).
        try Data().write(to: url, options: .atomic)
        return try FileHandle(forWritingTo: url)
    }

    private func openSidecarLog() -> FileHandle {
        do {
            return try prepareSidecarLog()
        } catch {
            fputs("reactable: nexus log unavailable (\(error)); continuing without log file\n", stderr)
            return FileHandle.nullDevice
        }
    }

    func start() throws {
        Self.releasePort(port)

        var env = ProcessInfo.processInfo.environment
        env["HOME"] = env["HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.path()
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        env["PORT"] = String(port)
        env["WB_DATA"] = projectRoot.path()
        env["WB_SERVE"] = "1"
        env["RELEASE_NAME"] = env["RELEASE_NAME"] ?? "reactable_sidecar"
        env["SHINYOBJECTZ_ROOT"] = monorepoRoot.path()
        if let skill = Bundle.main.resourceURL?.appending(path: "skill"),
           FileManager.default.fileExists(atPath: skill.path) {
            env["REACTABLE_SKILL_DIST"] = skill.path
        }
        if env["WB_SESSION_SECRET"] == nil || (env["WB_SESSION_SECRET"]?.count ?? 0) < 16 {
            env["WB_SESSION_SECRET"] = try DesktopSecrets.sessionSecret()
        }

        let log = openSidecarLog()

        if let binary = bundledNexusBinary() {
            process.executableURL = binary
            process.arguments = []
            process.environment = env
            process.standardOutput = log
            process.standardError = log
            try process.run()
            fputs("reactable: burrito nexus pid \(process.processIdentifier) on :\(port)\n", stderr)
            return
        }

        // Dev fallback — system elixir + nexus checkout (no login shell; GUI apps have minimal env)
        let nexus = nexusRoot
        guard FileManager.default.fileExists(atPath: nexus.path()) else {
            throw SidecarError.nexusNotFound(nexus.path())
        }

        let script = """
        set -euo pipefail
        export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
        command -v elixir >/dev/null || { echo "reactable: elixir not found in PATH=$PATH" >&2; exit 127; }
        cd '\(nexus.path())'
        export WB_SERVE=1 PORT=\(port) WB_DATA='\(projectRoot.path())'
        export SHINYOBJECTZ_ROOT='\(monorepoRoot.path())'
        exec elixir --no-halt -S mix run
        """

        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-c", script]
        process.environment = env
        process.standardOutput = log
        process.standardError = log
        try process.run()
        fputs("reactable: dev nexus sidecar pid \(process.processIdentifier) on :\(port)\n", stderr)
    }

    /// Orphan beam listeners block relaunch when the menu-bar app quit without stopping nexus.
    private static func releasePort(_ port: Int) {
        let lsof = Process()
        lsof.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        lsof.arguments = ["-tiTCP:\(port)", "-sTCP:LISTEN"]
        let pipe = Pipe()
        lsof.standardOutput = pipe
        lsof.standardError = FileHandle.nullDevice
        guard (try? lsof.run()) != nil else { return }
        lsof.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let text = String(data: data, encoding: .utf8) else { return }
        for token in text.split(whereSeparator: \.isWhitespace) {
            guard let pid = Int32(token) else { continue }
            if pid == ProcessInfo.processInfo.processIdentifier { continue }
            kill(pid, SIGTERM)
        }
    }

    func waitUntilReady(timeout: TimeInterval = 120) async throws {
        let url = URL(string: "http://127.0.0.1:\(port)/reactable/health")!
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if process.isRunning == false {
                throw SidecarError.exitedEarly
            }
            do {
                let (data, resp) = try await URLSession.shared.data(from: url)
                if let http = resp as? HTTPURLResponse, http.statusCode == 200,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   json["ok"] as? Bool == true {
                    return
                }
            } catch {}
            try await Task.sleep(for: .milliseconds(250))
        }
        throw SidecarError.timeout(port)
    }

    func stop() {
        guard process.isRunning else { return }
        process.terminate()
        process.waitUntilExit()
    }

    func restart() async throws {
        stop()
        try start()
        try await waitUntilReady()
    }

    deinit { stop() }
}

enum SidecarError: Error, CustomStringConvertible {
    case nexusNotFound(String)
    case exitedEarly
    case timeout(Int)

    var description: String {
        let log = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Reactable/nexus.log")
            .path(percentEncoded: false)
        switch self {
        case .nexusNotFound(let p):
            return "Nexus runtime not found at \(p)"
        case .exitedEarly:
            return "Nexus sidecar exited before ready. Log: \(log)"
        case .timeout(let port):
            return "Nexus sidecar not ready on :\(port). Log: \(log)"
        }
    }
}
