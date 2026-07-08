// Minimal CLIP byte-level BPE tokenizer (openai/CLIP SimpleTokenizer), ported
// to Swift so text embeddings run fully offline with no tokenizer dependency.
// Loads vocab.json + merges.txt from the bundled clip-tokenizer folder.
import Foundation

struct CLIPTokenizer {
    private let encoder: [String: Int]
    private let bpeRanks: [String: Int] // "a b" → rank
    private let byteEncoder: [UInt8: Character]
    private let bos: Int
    private let eos: Int
    private let pattern: NSRegularExpression

    init(folder: URL) throws {
        // vocab.json: token → id
        let vocabData = try Data(contentsOf: folder.appendingPathComponent("vocab.json"))
        guard let vocab = try JSONSerialization.jsonObject(with: vocabData) as? [String: Int] else {
            throw NSError(domain: "clip", code: 1, userInfo: [NSLocalizedDescriptionKey: "bad vocab.json"])
        }
        encoder = vocab
        bos = vocab["<|startoftext|>"] ?? 49406
        eos = vocab["<|endoftext|>"] ?? 49407

        // merges.txt: skip header, "a b" per line → rank
        let mergesText = try String(contentsOf: folder.appendingPathComponent("merges.txt"), encoding: .utf8)
        var ranks: [String: Int] = [:]
        var rank = 0
        for (i, line) in mergesText.split(separator: "\n", omittingEmptySubsequences: true).enumerated() {
            if i == 0, line.hasPrefix("#") { continue }
            ranks[String(line)] = rank
            rank += 1
        }
        bpeRanks = ranks

        // GPT2/CLIP bytes→unicode map
        byteEncoder = Self.bytesToUnicode()

        pattern = try NSRegularExpression(
            pattern: "<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+",
            options: [.caseInsensitive])
    }

    static func bytesToUnicode() -> [UInt8: Character] {
        var bs: [Int] = Array(33 ... 126) + Array(161 ... 172) + Array(174 ... 255)
        var cs = bs
        var n = 0
        for b in 0 ... 255 where !bs.contains(b) {
            bs.append(b)
            cs.append(256 + n)
            n += 1
        }
        var map: [UInt8: Character] = [:]
        for (b, c) in zip(bs, cs) {
            map[UInt8(b)] = Character(UnicodeScalar(c)!)
        }
        return map
    }

    private func bpe(_ token: String) -> [String] {
        var word = token.map { String($0) }
        if word.isEmpty { return [] }
        word[word.count - 1] += "</w>"
        if word.count == 1 { return word }

        func pairs(_ w: [String]) -> Set<String> {
            var p = Set<String>()
            for i in 0 ..< w.count - 1 { p.insert(w[i] + " " + w[i + 1]) }
            return p
        }

        while true {
            let ps = pairs(word)
            guard let best = ps.min(by: { (bpeRanks[$0] ?? Int.max) < (bpeRanks[$1] ?? Int.max) }),
                  bpeRanks[best] != nil else { break }
            let parts = best.split(separator: " ").map(String.init)
            let first = parts[0], second = parts[1]
            var newWord: [String] = []
            var i = 0
            while i < word.count {
                if i < word.count - 1, word[i] == first, word[i + 1] == second {
                    newWord.append(first + second)
                    i += 2
                } else {
                    newWord.append(word[i])
                    i += 1
                }
            }
            word = newWord
            if word.count == 1 { break }
        }
        return word
    }

    /// Encode → token ids wrapped with BOS/EOS (no padding; caller pads).
    func encode(_ text: String) -> [Int] {
        let clean = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        var ids: [Int] = [bos]
        let ns = clean as NSString
        for m in pattern.matches(in: clean, range: NSRange(location: 0, length: ns.length)) {
            let tok = ns.substring(with: m.range)
            // token → bytes → byte-unicode string
            let mapped = String(Array(tok.utf8).compactMap { byteEncoder[$0] })
            for piece in bpe(mapped) {
                if let id = encoder[piece] { ids.append(id) }
            }
        }
        ids.append(eos)
        return ids
    }
}
