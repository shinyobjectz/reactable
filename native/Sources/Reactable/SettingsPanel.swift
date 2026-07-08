import AppKit
import WebKit

// Settings — replaces the native gear menu. Tabbed web panel (Account, Tools)
// sharing localStorage with the agent page (tool prefs ride chat frontmatter).
@MainActor
final class SettingsPanel: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let port: Int
    private var window: NSWindow?
    private var webView: WKWebView?

    init(port: Int) {
        self.port = port
        super.init()
    }

    var isVisible: Bool { window?.isVisible ?? false }

    func toggle() {
        if isVisible { window?.orderOut(nil) } else { open() }
    }

    func open() {
        if window == nil {
            let size = NSSize(width: 530, height: 560)
            let win = KeyableWindow(
                contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .fullSizeContentView, .resizable],
                backing: .buffered, defer: false
            )
            win.delegate = self
            win.isReleasedWhenClosed = false
            win.backgroundColor = .clear
            win.isOpaque = false
            win.hasShadow = true
            win.level = .modalPanel
            FloatingWindow.configure(win)
            let config = WKWebViewConfiguration()
            config.userContentController.add(self, name: "reactable")
            let web = WKWebView(frame: .zero, configuration: config)
            web.setValue(false, forKey: "drawsBackground")
            webView = web
            PanelChrome.install(in: win, content: web, title: "Settings") { [weak self] in
                self?.window?.orderOut(nil)
            }
            web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/settings")!))
            window = win
        }
        guard let win = window, let screen = NSScreen.main else { return }
        let f = screen.visibleFrame
        win.setFrameOrigin(NSPoint(x: f.midX - 265, y: f.midY - 240))
        NSApp.activate(ignoringOtherApps: true)
        win.makeKeyAndOrderFront(nil)
    }

    private let apiBase = ProcessInfo.processInfo.environment["REACTABLE_API"] ?? "https://reactable.app"
    private var signingIn = false

    // Device flow against reactable.app: start → open browser → poll → save
    // ~/.reactable/auth.json (the same file the CLI reads) → push to the page.
    private func startDeviceFlow() {
        guard !signingIn else { return }
        signingIn = true
        pushSigninState("waiting")
        Task { [weak self] in
            guard let self else { return }
            defer { Task { @MainActor in self.signingIn = false } }
            do {
                var req = URLRequest(url: URL(string: "\(apiBase)/api/auth/cli/start")!)
                req.httpMethod = "POST"
                let (data, _) = try await URLSession.shared.data(for: req)
                guard let start = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let device = start["device_code"] as? String,
                      let verify = start["verification_url"] as? String
                else { throw URLError(.badServerResponse) }

                await MainActor.run { NSWorkspace.shared.open(URL(string: verify)!) }

                let interval = max(2.0, (start["interval"] as? Double) ?? 3.0)
                let deadline = Date().addingTimeInterval((start["expires_in"] as? Double) ?? 600)
                while Date() < deadline {
                    try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                    var poll = URLRequest(url: URL(string: "\(apiBase)/api/auth/cli/poll")!)
                    poll.httpMethod = "POST"
                    poll.setValue("application/json", forHTTPHeaderField: "content-type")
                    poll.httpBody = try JSONSerialization.data(withJSONObject: ["device_code": device])
                    let (pd, _) = try await URLSession.shared.data(for: poll)
                    guard let res = try JSONSerialization.jsonObject(with: pd) as? [String: Any] else { continue }
                    if res["pending"] as? Bool == true { continue }
                    guard res["ok"] as? Bool == true,
                          let token = res["access_token"] as? String,
                          let email = res["email"] as? String
                    else { throw URLError(.userAuthenticationRequired) }

                    var plan = ""
                    var me = URLRequest(url: URL(string: "\(apiBase)/api/auth/me")!)
                    me.setValue("reactable_session=\(token)", forHTTPHeaderField: "cookie")
                    if let (md, _) = try? await URLSession.shared.data(for: me),
                       let body = try? JSONSerialization.jsonObject(with: md) as? [String: Any],
                       let user = body["user"] as? [String: Any] {
                        plan = user["plan"] as? String ?? ""
                    }

                    let creds: [String: Any] = [
                        "access_token": token,
                        "email": email,
                        "session_id": res["session_id"] as? String ?? "",
                        "api_base": apiBase,
                        "saved_at": ISO8601DateFormatter().string(from: Date()),
                        "plan": plan,
                    ]
                    let file = FileManager.default.homeDirectoryForCurrentUser
                        .appending(path: ".reactable/auth.json")
                    let data = try JSONSerialization.data(withJSONObject: creds, options: [.prettyPrinted])
                    try data.write(to: file, options: [.completeFileProtection])
                    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
                    await MainActor.run { self.pushAccount() }
                    return
                }
                await MainActor.run { self.pushSigninState("timeout") }
            } catch {
                await MainActor.run { self.pushSigninState("error") }
            }
        }
    }

    private func pushSigninState(_ state: String) {
        webView?.evaluateJavaScript("window.ReactableSettings?.setSignin('\(state)')")
    }

    private func pushAccount() {
        let file = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: ".reactable/auth.json")
        let auth = (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) as? [String: Any] ?? [:]
        let token = auth["access_token"] as? String ?? ""
        let account: [String: Any] = [
            "signedIn": !token.isEmpty,
            "plan": auth["plan"] as? String ?? "",
            "email": auth["email"] as? String ?? "",
        ]
        if let d = try? JSONSerialization.data(withJSONObject: account),
           let str = String(data: d, encoding: .utf8) {
            webView?.evaluateJavaScript("window.ReactableSettings?.setAccount(\(str))")
        }
    }

    private func pushKeys() {
        let file = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: ".reactable/connectors.json")
        let keys = (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) as? [String: String] ?? [:]
        if let d = try? JSONSerialization.data(withJSONObject: keys),
           let str = String(data: d, encoding: .utf8) {
            webView?.evaluateJavaScript("window.ReactableSettings?.setKeys(\(str))")
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let parsed = BridgeMessage.parse(message.body) else { return }
        switch parsed.action {
        case "settings.ready":
            pushKeys()
            pushAccount()
        case "settings.signin":
            startDeviceFlow()
        case "settings.signout":
            let file = FileManager.default.homeDirectoryForCurrentUser
                .appending(path: ".reactable/auth.json")
            try? "{}".data(using: .utf8)?.write(to: file)
            pushAccount()
        case "settings.link":
            if let u = parsed.payload["url"] as? String, let url = URL(string: u) {
                NSWorkspace.shared.open(url)
            }
        case "settings.connector":
            if let id = parsed.payload["id"] as? String, let key = parsed.payload["key"] as? String {
                let dir = FileManager.default.homeDirectoryForCurrentUser.appending(path: ".reactable")
                let file = dir.appending(path: "connectors.json")
                var all = (try? JSONSerialization.jsonObject(with: Data(contentsOf: file))) as? [String: String] ?? [:]
                all[id] = key
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                if let d = try? JSONSerialization.data(withJSONObject: all, options: [.prettyPrinted]) {
                    try? d.write(to: file)
                }
                pushKeys()
            }
        case "settings.youtube":
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            for cli in ["\(home)/.bun/bin/reactable", "/opt/homebrew/bin/reactable"]
            where FileManager.default.isExecutableFile(atPath: cli) {
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: cli)
                proc.arguments = ["youtube", "connect"]
                try? proc.run()
                break
            }
        case "settings.close":
            window?.orderOut(nil)
        default:
            break
        }
    }
}
