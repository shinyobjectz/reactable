import Foundation

enum DeckScripts {
    static func fire(port: Int, deck: String, trigger: String, slide: String? = nil) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/reactable/exec") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        var body: [String: Any] = ["deck": deck, "on": trigger]
        if let slide { body["slide"] = slide }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}
