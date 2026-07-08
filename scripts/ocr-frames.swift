// Apple Vision OCR over image files → JSON on stdout.
// Usage: swift scripts/ocr-frames.swift <img> [<img>…]
// Output: [{ "file": path, "items": [{ "text", "bbox": [x,y,w,h] px top-left origin, "conf" }] }]
import Foundation
import Vision
import AppKit

struct Item: Codable {
    let text: String
    let bbox: [Int]
    let conf: Double
}
struct FrameResult: Codable {
    let file: String
    let items: [Item]
}

var results: [FrameResult] = []
for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else {
        results.append(FrameResult(file: path, items: []))
        continue
    }
    let w = CGFloat(cg.width)
    let h = CGFloat(cg.height)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([request])
    var items: [Item] = []
    for obs in request.results ?? [] {
        guard let cand = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox // normalized, bottom-left origin
        items.append(Item(
            text: cand.string,
            bbox: [Int(b.minX * w), Int((1 - b.maxY) * h), Int(b.width * w), Int(b.height * h)],
            conf: Double(cand.confidence)
        ))
    }
    results.append(FrameResult(file: path, items: items))
}

let enc = JSONEncoder()
let data = try! enc.encode(results)
print(String(data: data, encoding: .utf8)!)
