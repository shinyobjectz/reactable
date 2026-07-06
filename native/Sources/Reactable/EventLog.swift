import Foundation

/// Append-only JSONL event log on a single record-start clock.
@MainActor
final class EventLog {
    private let handle: FileHandle
    private let start: CFAbsoluteTime

    init(url: URL) throws {
        start = CFAbsoluteTimeGetCurrent()
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try FileHandle(forWritingTo: url)
    }

    func elapsed() -> Double {
        CFAbsoluteTimeGetCurrent() - start
    }

    func stamp(_ type: String, payload: [String: Any] = [:]) {
        var line: [String: Any] = ["t": elapsed(), "type": type]
        for (k, v) in payload { line[k] = v }
        guard let data = try? JSONSerialization.data(withJSONObject: line),
              var bytes = String(data: data, encoding: .utf8)?.data(using: .utf8) else { return }
        bytes.append(Data([0x0A]))
        try? handle.write(contentsOf: bytes)
    }

    func close() {
        try? handle.close()
    }
}
