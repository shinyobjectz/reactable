import Foundation

@MainActor
protocol StageCommandDelegate: AnyObject {
    func stageCommandOpen(deck: String?)
    func stageCommandHide()
    func stageCommandLoad(deck: String)
    func stageCommandSurface(kind: String, ref: String, project: String, title: String)
    func stageLiveState() -> (deck: String, visible: Bool, projectId: String)
}

/// Polls nexus for agent/CLI stage commands — preview and record share one WKWebView shell.
@MainActor
final class StageCommandPoller {
    private let port: Int
    private weak var delegate: StageCommandDelegate?
    private var pollTimer: Timer?
    private var heartbeatTimer: Timer?

    init(port: Int, delegate: StageCommandDelegate) {
        self.port = port
        self.delegate = delegate
    }

    func start() {
        pollTimer?.invalidate()
        heartbeatTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.pollOnce() }
        }
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sendHeartbeat() }
        }
        sendHeartbeat()
    }

    func stop() {
        pollTimer?.invalidate()
        heartbeatTimer?.invalidate()
        pollTimer = nil
        heartbeatTimer = nil
    }

    private func pollOnce() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/reactable/stage/poll") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["ok"] as? Bool == true,
                  let cmd = json["command"] as? [String: Any],
                  let id = cmd["id"] as? String,
                  let action = cmd["action"] as? String else { return }
            Task { @MainActor in
                self?.handle(action: action, cmd: cmd, id: id)
            }
        }.resume()
    }

    private func handle(action: String, cmd: [String: Any], id: String) {
        let deck = cmd["deck"] as? String
        switch action {
        case "open":
            delegate?.stageCommandOpen(deck: deck)
        case "hide":
            delegate?.stageCommandHide()
        case "load":
            if let deck { delegate?.stageCommandLoad(deck: deck) }
        case "surface":
            let kind = cmd["kind"] as? String ?? "web"
            let ref = cmd["ref"] as? String ?? ""
            if !ref.isEmpty {
                delegate?.stageCommandSurface(
                    kind: kind,
                    ref: ref,
                    project: cmd["project"] as? String ?? "",
                    title: cmd["title"] as? String ?? ref
                )
            }
        default:
            break
        }
        ack(id: id)
    }

    private func ack(id: String) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/reactable/stage/ack") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["id": id])
        URLSession.shared.dataTask(with: req).resume()
    }

    private func sendHeartbeat() {
        guard let delegate else { return }
        let live = delegate.stageLiveState()
        guard let url = URL(string: "http://127.0.0.1:\(port)/reactable/stage/heartbeat") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        let body: [String: Any] = [
            "deck": live.deck,
            "visible": live.visible,
            "projectId": live.projectId,
            "ts": Date().timeIntervalSince1970,
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}
