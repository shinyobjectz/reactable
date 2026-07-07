import Foundation
import Security

enum DesktopSecrets {
    /// Persistent nexus session key — required when Burrito sets RELEASE_NAME (wb-nz88).
    static func sessionSecret() throws -> String {
        let dir = supportDir()
        let file = dir.appendingPathComponent("session-secret")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        if FileManager.default.fileExists(atPath: file.path),
           let data = FileManager.default.contents(atPath: file.path),
           let existing = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           existing.count >= 16 {
            return existing
        }

        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw SecretError.randomFailed
        }
        let secret = bytes.map { String(format: "%02x", $0) }.joined()
        let ok = FileManager.default.createFile(
            atPath: file.path,
            contents: Data(secret.utf8),
            attributes: [.posixPermissions: 0o600]
        )
        guard ok else { throw SecretError.randomFailed }
        return secret
    }

    private static func supportDir() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("Reactable", isDirectory: true)
    }
}

enum SecretError: Error {
    case randomFailed
}
