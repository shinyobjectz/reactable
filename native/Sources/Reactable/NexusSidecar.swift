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
        self.monorepoRoot = nexusRoot
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    var currentProjectRoot: URL { projectRoot }

    func setProjectRoot(_ url: URL) {
        projectRoot = url
    }

    func start() throws {
        let nexus = nexusRoot

        guard FileManager.default.fileExists(atPath: nexus.path()) else {
            throw SidecarError.nexusNotFound(nexus.path())
        }

        let script = """
        set -euo pipefail
        cd '\(nexus.path())'
        export WB_SERVE=1 PORT=\(port) WB_DATA='\(projectRoot.path())'
        export SHINYOBJECTZ_ROOT='\(monorepoRoot.path())'
        [ -f '\(projectRoot.path())/.env' ] && set -a && . '\(projectRoot.path())/.env' && set +a
        exec elixir --no-halt -S mix run
        """

        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-lc", script]
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(port)
        env["WB_DATA"] = projectRoot.path()
        env["SHINYOBJECTZ_ROOT"] = monorepoRoot.path()
        process.environment = env
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        fputs("reactable: nexus sidecar pid \(process.processIdentifier) on :\(port)\n", stderr)
    }

    func waitUntilReady(timeout: TimeInterval = 30) async throws {
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
        switch self {
        case .nexusNotFound(let p): "Nexus runtime not found at \(p)"
        case .exitedEarly: "Nexus sidecar exited before ready"
        case .timeout(let port): "Nexus sidecar not ready on :\(port)"
        }
    }
}
