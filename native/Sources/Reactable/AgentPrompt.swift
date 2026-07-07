import AppKit
import Foundation

enum AgentPrompt {
    static func text(projectRoot: URL, deck: String) -> String {
        let compiled = projectRoot
            .appending(path: "skill/dist/agent-prompt.txt")
        if let raw = try? String(contentsOf: compiled, encoding: .utf8), !raw.isEmpty {
            return raw.replacingOccurrences(of: "deck: demo", with: "deck: \(deck)")
        }
        return fallback(deck: deck)
    }

    static func copyToPasteboard(projectRoot: URL, deck: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text(projectRoot: projectRoot, deck: deck), forType: NSPasteboard.PasteboardType.string)
    }

    private static func fallback(deck: String) -> String {
        """
        You are working with **Reactable** — native macOS stage recorder + agent CLI.

        Install:
          npm i -g reactable-cli
          reactable skills install --user
          reactable install app

        Quick start (deck: \(deck)):
          reactable stage open --deck \(deck)
          reactable plan \(deck)
          reactable doctor

        Hard rule: preview with `reactable stage open` — never a browser tab.
        Docs: https://reactable.app
        """
    }
}
