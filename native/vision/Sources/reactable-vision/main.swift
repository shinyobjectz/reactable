// reactable-vision — native footage passes on the Neural Engine (CoreML).
// Depth today; SAM2 next. Output matches gpu/modal_footage.py + footage-mlx.py
// so cli/lib/video.ts foldPass is unchanged.
//
//   reactable-vision depth <video> --out result.json [--model <.mlpackage>]
//        [--sample-fps 2] [--max-frames 120] [--grid 96]
//
// Runs on the ANE (computeUnits = .all lets CoreML pick it) — far cooler and
// lower-power than the GPU for sustained per-frame inference.
import AVFoundation
import CoreImage
import CoreML
import Foundation
import ImageIO
import Vision
#if canImport(AppKit)
import AppKit
#endif

func log(_ msg: String) { FileHandle.standardError.write(Data((msg + "\n").utf8)) }
func die(_ msg: String) -> Never { log(msg); exit(1) }

struct FrameOut: Codable { let t_ms: Int; let w: Int; let h: Int; let f32: String }
struct DepthResult: Codable { let pass: String; let model: String; let sample_fps: Double; let frames: [FrameOut] }

// ── args ─────────────────────────────────────────────────────────────
func parseArgs() -> (cmd: String, positional: [String], flags: [String: String]) {
    var a = Array(CommandLine.arguments.dropFirst())
    guard let cmd = a.first else { die("usage: reactable-vision depth <video> --out <json>") }
    a.removeFirst()
    var pos: [String] = []
    var fl: [String: String] = [:]
    var i = 0
    while i < a.count {
        if a[i].hasPrefix("--") {
            fl[a[i]] = (i + 1 < a.count) ? a[i + 1] : ""
            i += 2
        } else {
            pos.append(a[i]); i += 1
        }
    }
    return (cmd, pos, fl)
}

func findModel(_ explicit: String?) -> URL {
    if let m = explicit { return URL(fileURLWithPath: m) }
    let binDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
    for cand in [
        binDir.appendingPathComponent("Models/DepthAnythingV2SmallF16.mlpackage"),
        binDir.appendingPathComponent("../Resources/Models/DepthAnythingV2SmallF16.mlpackage"),
        URL(fileURLWithPath: "native/vision/Models/DepthAnythingV2SmallF16.mlpackage"),
    ] where FileManager.default.fileExists(atPath: cand.path) {
        return cand
    }
    die("depth model not found — pass --model <.mlpackage>")
}

// Normalize a raw depth field (row-major dh×dw) → grid (gw × gh), 0..1.
func fieldToGrid(_ vals: [Float], dw: Int, dh: Int, grid: Int) -> (w: Int, h: Int, data: [Float]) {
    var lo = Float.greatestFiniteMagnitude, hi = -Float.greatestFiniteMagnitude
    for v in vals { if v < lo { lo = v }; if v > hi { hi = v } }
    let span = max(hi - lo, 1e-6)
    let gw = grid
    let gh = max(1, Int((Double(grid) * Double(dh) / Double(dw)).rounded()))
    var out = [Float](repeating: 0, count: gw * gh)
    for gy in 0 ..< gh {
        let sy = min(dh - 1, gy * dh / gh)
        for gx in 0 ..< gw {
            let sx = min(dw - 1, gx * dw / gw)
            out[gy * gw + gx] = (vals[sy * dw + sx] - lo) / span
        }
    }
    return (gw, gh, out)
}

// MLMultiArray depth map → grid.
func arrayToGrid(_ arr: MLMultiArray, grid: Int) -> (w: Int, h: Int, data: [Float]) {
    let shape = arr.shape.map { $0.intValue }
    let dh = shape[shape.count - 2], dw = shape[shape.count - 1]
    let n = dh * dw
    var vals = [Float](repeating: 0, count: n)
    switch arr.dataType {
    case .float16:
        let p = arr.dataPointer.bindMemory(to: Float16.self, capacity: n)
        for i in 0 ..< n { vals[i] = Float(p[i]) }
    case .float32:
        let p = arr.dataPointer.bindMemory(to: Float32.self, capacity: n)
        for i in 0 ..< n { vals[i] = p[i] }
    default:
        for i in 0 ..< n { vals[i] = arr[i].floatValue }
    }
    return fieldToGrid(vals, dw: dw, dh: dh, grid: grid)
}

// Depth-image output (grayscale CVPixelBuffer) → grid. Reads the luma/first
// channel; Apple's depth models emit a one-channel depth image.
func imageToGrid(_ px: CVPixelBuffer, grid: Int) -> (w: Int, h: Int, data: [Float])? {
    CVPixelBufferLockBaseAddress(px, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
    let dw = CVPixelBufferGetWidth(px), dh = CVPixelBufferGetHeight(px)
    guard let base = CVPixelBufferGetBaseAddress(px) else { return nil }
    let rowBytes = CVPixelBufferGetBytesPerRow(px)
    let fmt = CVPixelBufferGetPixelFormatType(px)
    var vals = [Float](repeating: 0, count: dw * dh)
    let isFloat = fmt == kCVPixelFormatType_OneComponent16Half || fmt == kCVPixelFormatType_DepthFloat16
    let isFloat32 = fmt == kCVPixelFormatType_OneComponent32Float || fmt == kCVPixelFormatType_DepthFloat32
    for y in 0 ..< dh {
        let row = base.advanced(by: y * rowBytes)
        for x in 0 ..< dw {
            if isFloat32 {
                vals[y * dw + x] = row.load(fromByteOffset: x * 4, as: Float32.self)
            } else if isFloat {
                vals[y * dw + x] = Float(row.load(fromByteOffset: x * 2, as: Float16.self))
            } else {
                vals[y * dw + x] = Float(row.load(fromByteOffset: x, as: UInt8.self))
            }
        }
    }
    return fieldToGrid(vals, dw: dw, dh: dh, grid: grid)
}

func runDepth() async throws {
    let (_, pos, flags) = parseArgs()
    guard let video = pos.first else { die("depth needs a <video>") }
    guard let out = flags["--out"] else { die("depth needs --out <json>") }
    let sampleFps = Double(flags["--sample-fps"] ?? "2") ?? 2
    let maxFrames = Int(flags["--max-frames"] ?? "120") ?? 120
    let grid = Int(flags["--grid"] ?? "96") ?? 96

    let cfg = MLModelConfiguration()
    cfg.computeUnits = .all
    let compiled = try await MLModel.compileModel(at: findModel(flags["--model"]))
    let model = try MLModel(contentsOf: compiled, configuration: cfg)

    guard let inName = model.modelDescription.inputDescriptionsByName.first(where: { $0.value.type == .image })?.key,
          let inC = model.modelDescription.inputDescriptionsByName[inName]?.imageConstraint
    else { die("model has no image input") }
    let inW = inC.pixelsWide, inH = inC.pixelsHigh
    // depth output may be a multiArray OR a grayscale image, depending on the
    // conversion — accept either.
    let outs = model.modelDescription.outputDescriptionsByName
    guard let outEntry = outs.first(where: { $0.value.type == .multiArray || $0.value.type == .image })
    else { die("model has no image/multiArray output — has: \(outs.keys.joined(separator: ","))") }
    let outName = outEntry.key
    let outIsImage = outEntry.value.type == .image
    log("depth model: in \(inName) \(inW)x\(inH) → out \(outName) (\(outIsImage ? "image" : "array"), ANE)")

    let asset = AVURLAsset(url: URL(fileURLWithPath: video))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { die("no video track") }
    let rate = try await track.load(.nominalFrameRate)
    let fps = rate > 0 ? Double(rate) : 30
    let dur = try await asset.load(.duration)
    let totalFrames = Int(CMTimeGetSeconds(dur) * fps)
    var stride = max(1, Int((fps / sampleFps).rounded()))
    if totalFrames > 0, totalFrames / stride > maxFrames {
        stride = max(stride, (totalFrames + maxFrames - 1) / maxFrames)
    }

    let reader = try AVAssetReader(asset: asset)
    let trackOut = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(trackOut)
    reader.startReading()

    let ci = CIContext(options: [.useSoftwareRenderer: false])
    func scaled(_ src: CVPixelBuffer) -> CVPixelBuffer? {
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, inW, inH, kCVPixelFormatType_32BGRA, nil, &pb)
        guard let dst = pb else { return nil }
        let img = CIImage(cvPixelBuffer: src)
        let t = CGAffineTransform(scaleX: CGFloat(inW) / img.extent.width, y: CGFloat(inH) / img.extent.height)
        ci.render(img.transformed(by: t), to: dst)
        return dst
    }

    var frames: [FrameOut] = []
    var idx = 0, processed = 0
    while processed < maxFrames, let sample = trackOut.copyNextSampleBuffer() {
        defer { idx += 1 }
        guard let px = CMSampleBufferGetImageBuffer(sample) else { continue }
        if idx % stride != 0 { continue }
        guard let inBuf = scaled(px) else { continue }
        let fv = try MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(pixelBuffer: inBuf)])
        let r = try await model.prediction(from: fv)
        let fval = r.featureValue(for: outName)
        let g: (w: Int, h: Int, data: [Float])?
        if outIsImage, let img = fval?.imageBufferValue {
            g = imageToGrid(img, grid: grid)
        } else if let arr = fval?.multiArrayValue {
            g = arrayToGrid(arr, grid: grid)
        } else {
            g = nil
        }
        guard let g else { continue }
        let tMs = Int((Double(idx) / fps) * 1000.0)
        let bytes = g.data.withUnsafeBytes { Data($0) }
        frames.append(FrameOut(t_ms: tMs, w: g.w, h: g.h, f32: bytes.base64EncodedString()))
        processed += 1
        if processed % 20 == 0 { log("  \(processed) frames") }
    }

    let res = DepthResult(pass: "depth", model: "apple/coreml-depth-anything-v2-small (ANE)",
                          sample_fps: sampleFps, frames: frames)
    try JSONEncoder().encode(res).write(to: URL(fileURLWithPath: out))
    print("{\"pass\":\"depth\",\"samples\":\(frames.count),\"model\":\"ane-local\"}")
}

// ── MobileCLIP embeddings (image + text) on the ANE ──────────────────
// Native replacement for the uv/torch SigLIP path. Same on-disk layout as
// footage-embed.py so cli/lib/video.ts embedQuery is compatible.

func aneModel(_ path: URL, units: MLComputeUnits = .all) async throws -> MLModel {
    let cfg = MLModelConfiguration()
    cfg.computeUnits = units
    let compiled = try await MLModel.compileModel(at: path)
    return try MLModel(contentsOf: compiled, configuration: cfg)
}

func firstImageInput(_ m: MLModel) -> (name: String, w: Int, h: Int)? {
    guard let e = m.modelDescription.inputDescriptionsByName.first(where: { $0.value.type == .image }),
          let c = e.value.imageConstraint else { return nil }
    return (e.key, c.pixelsWide, c.pixelsHigh)
}

func firstArrayOutput(_ m: MLModel) -> String? {
    m.modelDescription.outputDescriptionsByName.first(where: { $0.value.type == .multiArray })?.key
}

func arrayToVec(_ arr: MLMultiArray) -> [Float] {
    let n = arr.count
    var v = [Float](repeating: 0, count: n)
    switch arr.dataType {
    case .float16:
        let p = arr.dataPointer.bindMemory(to: Float16.self, capacity: n)
        for i in 0 ..< n { v[i] = Float(p[i]) }
    case .float32:
        let p = arr.dataPointer.bindMemory(to: Float32.self, capacity: n)
        for i in 0 ..< n { v[i] = p[i] }
    default:
        for i in 0 ..< n { v[i] = arr[i].floatValue }
    }
    // L2-normalize for cosine
    let norm = max(sqrt(v.reduce(0) { $0 + $1 * $1 }), 1e-8)
    return v.map { $0 / norm }
}

func pixelBuffer(_ cg: CGImage, _ w: Int, _ h: Int) -> CVPixelBuffer? {
    var pb: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, nil, &pb)
    guard let dst = pb else { return nil }
    let ci = CIImage(cgImage: cg)
    let ctx = CIContext(options: [.useSoftwareRenderer: false])
    let t = CGAffineTransform(scaleX: CGFloat(w) / ci.extent.width, y: CGFloat(h) / ci.extent.height)
    ctx.render(ci.transformed(by: t), to: dst)
    return dst
}

func modelsDir() -> URL {
    let binDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
    for cand in [
        binDir.appendingPathComponent("Models"),
        binDir.appendingPathComponent("../Resources/Models"),
        URL(fileURLWithPath: "native/vision/Models"),
    ] where FileManager.default.fileExists(atPath: cand.path) {
        return cand
    }
    return URL(fileURLWithPath: "native/vision/Models")
}

struct EmbMeta: Codable { let model: String; let dim: Int; let rows: [EmbRow] }
struct EmbRow: Codable { let shot: String; let t_ms: Int }

func runEmbed() async throws {
    let (_, pos, _) = parseArgs()
    guard let dir = pos.first else { die("embed needs <sidecar-dir>") }
    let idxURL = URL(fileURLWithPath: dir).appendingPathComponent("index.json")
    guard let raw = try? Data(contentsOf: idxURL),
          var index = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
          let shots = index["shots"] as? [[String: Any]] else { die("no index.json in \(dir)") }

    let model = try await aneModel(modelsDir().appendingPathComponent("mobileclip_s0_image.mlpackage"))
    guard let inp = firstImageInput(model), let outName = firstArrayOutput(model) else { die("bad image model") }
    log("mobileclip image: in \(inp.name) \(inp.w)x\(inp.h) → \(outName) (ANE)")

    var vecs: [[Float]] = []
    var rows: [EmbRow] = []
    for s in shots {
        guard let kf = s["keyframe"] as? String else { continue }
        let kfPath = URL(fileURLWithPath: dir).appendingPathComponent(kf).path
        guard let cg = cgImage(kfPath), let pb = pixelBuffer(cg, inp.w, inp.h) else { continue }
        let fv = try MLDictionaryFeatureProvider(dictionary: [inp.name: MLFeatureValue(pixelBuffer: pb)])
        let r = try await model.prediction(from: fv)
        guard let arr = r.featureValue(for: outName)?.multiArrayValue else { continue }
        vecs.append(arrayToVec(arr))
        let inMs = (s["in_ms"] as? Int) ?? 0
        let outMs = (s["out_ms"] as? Int) ?? inMs
        rows.append(EmbRow(shot: (s["id"] as? String) ?? "s\(rows.count)", t_ms: (inMs + outMs) / 2))
    }
    guard let dim = vecs.first?.count else { die("no keyframes embedded") }

    let embDir = URL(fileURLWithPath: dir).appendingPathComponent("embeddings")
    try? FileManager.default.createDirectory(at: embDir, withIntermediateDirectories: true)
    var flat = [Float](); flat.reserveCapacity(vecs.count * dim)
    for v in vecs { flat.append(contentsOf: v) }
    try flat.withUnsafeBytes { Data($0) }.write(to: embDir.appendingPathComponent("mobileclip.f32"))
    let meta = EmbMeta(model: "apple/coreml-mobileclip s0 (ANE)", dim: dim, rows: rows)
    try JSONEncoder().encode(meta).write(to: embDir.appendingPathComponent("mobileclip.meta.json"))

    // mark the t1 pass in index.json
    var passes = (index["passes"] as? [String: Any]) ?? [:]
    passes["t1"] = ["embed_model": "mobileclip-s0-ane", "at": ISO8601DateFormatter().string(from: Date())]
    index["passes"] = passes
    try JSONSerialization.data(withJSONObject: index, options: [.prettyPrinted]).write(to: idxURL)
    print("{\"embedded\":\(vecs.count),\"dim\":\(dim),\"model\":\"mobileclip-ane\"}")
}

// CLIP text embedding: BPE-tokenize (swift-transformers, offline from bundled
// files) → int32 [1,77] → MobileCLIP text model on the ANE → L2-normed vec.
func clipTextEmbed(_ text: String) async throws -> [Float] {
    let tokFolder = modelsDir().appendingPathComponent("clip-tokenizer")
    let tokenizer = try CLIPTokenizer(folder: tokFolder)
    var ids = tokenizer.encode(text)
    let ctx = 77
    if ids.count > ctx { ids = Array(ids.prefix(ctx)) }
    while ids.count < ctx { ids.append(0) }

    let model = try await aneModel(modelsDir().appendingPathComponent("mobileclip_s0_text.mlpackage"))
    guard let inName = model.modelDescription.inputDescriptionsByName.first(where: { $0.value.type == .multiArray })?.key,
          let outName = firstArrayOutput(model) else { die("bad text model") }
    let dtype = model.modelDescription.inputDescriptionsByName[inName]?.multiArrayConstraint?.dataType ?? .int32
    let arr = try MLMultiArray(shape: [1, NSNumber(value: ctx)], dataType: dtype)
    for i in 0 ..< ctx { arr[i] = NSNumber(value: ids[i]) }
    let fv = try MLDictionaryFeatureProvider(dictionary: [inName: MLFeatureValue(multiArray: arr)])
    let r = try await model.prediction(from: fv)
    guard let out = r.featureValue(for: outName)?.multiArrayValue else { die("no text embedding") }
    return arrayToVec(out)
}

func runEmbedText() async throws {
    let (_, pos, flags) = parseArgs()
    guard let dir = pos.first, pos.count >= 2 else { die("embed-text needs <sidecar-dir> <query>") }
    let query = pos[1...].joined(separator: " ")
    let topk = Int(flags["--topk"] ?? "5") ?? 5

    // stored image embeddings
    let embDir = URL(fileURLWithPath: dir).appendingPathComponent("embeddings")
    guard let metaRaw = try? Data(contentsOf: embDir.appendingPathComponent("mobileclip.meta.json")),
          let meta = try? JSONDecoder().decode(EmbMeta.self, from: metaRaw),
          let bin = try? Data(contentsOf: embDir.appendingPathComponent("mobileclip.f32"))
    else { print("{\"error\":\"no mobileclip embeddings — run embed first\"}"); return }
    let dim = meta.dim
    let mat: [Float] = bin.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }

    // tokenize + text-embed
    let qvec = try await clipTextEmbed(query)

    // cosine (both L2-normalized) = dot
    var scored: [(Int, Float)] = []
    for i in 0 ..< meta.rows.count {
        var dot: Float = 0
        for d in 0 ..< dim { dot += mat[i * dim + d] * qvec[d] }
        scored.append((i, dot))
    }
    scored.sort { $0.1 > $1.1 }
    var hits: [[String: Any]] = []
    for (i, sc) in scored.prefix(topk) {
        hits.append(["shot": meta.rows[i].shot, "t_ms": meta.rows[i].t_ms, "score": Double((sc * 10000).rounded()) / 10000])
    }
    let out: [String: Any] = ["query": query, "model": meta.model, "hits": hits]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: out))
}

// ── OCR (Vision, on the ANE) — replaces `swift scripts/ocr-frames.swift` ──
// reactable-vision ocr <img> [<img>…] → [{file, items:[{text,bbox,conf}]}]
struct OcrItem: Codable { let text: String; let bbox: [Int]; let conf: Double }
struct OcrFrame: Codable { let file: String; let items: [OcrItem] }

func cgImage(_ path: String) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func runOcr(_ paths: [String]) throws {
    var out: [OcrFrame] = []
    for p in paths {
        guard let cg = cgImage(p) else { out.append(OcrFrame(file: p, items: [])); continue }
        let w = CGFloat(cg.width), h = CGFloat(cg.height)
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
        var items: [OcrItem] = []
        for obs in (req.results ?? []) {
            guard let c = obs.topCandidates(1).first else { continue }
            let b = obs.boundingBox // normalized, bottom-left origin
            items.append(OcrItem(
                text: c.string,
                bbox: [Int(b.minX * w), Int((1 - b.maxY) * h), Int(b.width * w), Int(b.height * h)],
                conf: Double(c.confidence)))
        }
        out.append(OcrFrame(file: p, items: items))
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(out))
}

// Introspect a .mlpackage's inputs/outputs — for wiring multi-model pipelines.
func runInspect(_ path: String) async throws {
    let m = try await aneModel(URL(fileURLWithPath: path))
    let d = m.modelDescription
    print("INPUTS:")
    for (name, desc) in d.inputDescriptionsByName {
        var s = "  \(name): \(desc.type.rawValue)"
        if let ic = desc.imageConstraint { s += " image \(ic.pixelsWide)x\(ic.pixelsHigh)" }
        if let ac = desc.multiArrayConstraint { s += " array \(ac.shape.map{$0.intValue}) \(ac.dataType.rawValue)" }
        print(s)
    }
    print("OUTPUTS:")
    for (name, desc) in d.outputDescriptionsByName {
        var s = "  \(name): \(desc.type.rawValue)"
        if let ic = desc.imageConstraint { s += " image \(ic.pixelsWide)x\(ic.pixelsHigh)" }
        if let ac = desc.multiArrayConstraint { s += " array \(ac.shape.map{$0.intValue}) \(ac.dataType.rawValue)" }
        print(s)
    }
}

let (cmd0, pos0, _) = parseArgs()
switch cmd0 {
case "depth":
    try await runDepth()
case "ocr":
    try runOcr(pos0)
case "embed":
    try await runEmbed()
case "embed-text":
    try await runEmbedText()
case "inspect":
    try await runInspect(pos0[0])
case "edgetam-test":
    try await runEdgeTest(image: pos0[0], boxStr: parseArgs().flags["--box"] ?? "")
case "edgetam":
    let f = parseArgs().flags
    try await runEdgeTam(video: pos0[0], boxStr: f["--box"] ?? "", out: f["--out"] ?? "/tmp/edgetam.json",
                         label: f["--label"] ?? "tracked",
                         maxFrames: Int(f["--max-frames"] ?? "120") ?? 120, sampleFps: Double(f["--sample-fps"] ?? "3") ?? 3)
case "motion":
    let f = parseArgs().flags
    try await runMotion(video: pos0[0], out: f["--out"] ?? "/tmp/motion.json",
                        maxFrames: Int(f["--max-frames"] ?? "300") ?? 300, sampleFps: Double(f["--sample-fps"] ?? "6") ?? 6,
                        accuracy: f["--accuracy"] ?? "low")
case "vjepa-test":
    try await runVjepaTest(video: pos0[0], windowStr: parseArgs().flags["--window"] ?? "0:5")
case "vjepa":
    let f = parseArgs().flags
    try await runVjepa(video: pos0[0], out: f["--out"] ?? "/tmp/vjepa.json")
default:
    die("commands: depth · ocr · embed · embed-text · inspect · edgetam-test · edgetam · motion · vjepa-test · vjepa (got '\(cmd0)')")
}

// COCO RLE encode (column-major, runs start with 0, LEB128 delta) — matches
// cli/lib/matte.ts decodeCocoRle so masks round-trip.
func cocoRleEncode(_ mask: [UInt8], w: Int, h: Int) -> String {
    var counts: [Int] = []
    var prev: UInt8 = 0
    var run = 0
    for col in 0 ..< w {
        for row in 0 ..< h {
            let v: UInt8 = mask[row * w + col] != 0 ? 1 : 0
            if v == prev { run += 1 } else { counts.append(run); run = 1; prev = v }
        }
    }
    counts.append(run)
    var bytes = [UInt8]()
    for i in 0 ..< counts.count {
        var x = counts[i]
        if i > 2 { x -= counts[i - 2] }
        var more = true
        while more {
            var c = x & 0x1f
            x >>= 5 // arithmetic (signed)
            more = (c & 0x10) != 0 ? (x != -1) : (x != 0)
            if more { c |= 0x20 }
            bytes.append(UInt8(c + 48))
        }
    }
    return Data(bytes).base64EncodedString()
}

// resize 288² logit mask → source-res binary (threshold logit>0 ⇢ prob>0.5)
func maskToSource(_ logits: [Float], mw: Int, mh: Int, sw: Int, sh: Int) -> [UInt8] {
    var out = [UInt8](repeating: 0, count: sw * sh)
    for y in 0 ..< sh {
        let my = min(mh - 1, y * mh / sh)
        for x in 0 ..< sw {
            let mx = min(mw - 1, x * mw / sw)
            out[y * sw + x] = logits[my * mw + mx] > 0 ? 1 : 0
        }
    }
    return out
}

func iou(_ a: [Int], _ b: [Int]) -> Double {
    let x0 = max(a[0], b[0]), y0 = max(a[1], b[1])
    let x1 = min(a[0] + a[2], b[0] + b[2]), y1 = min(a[1] + a[3], b[1] + b[3])
    let inter = max(0, x1 - x0) * max(0, y1 - y0)
    if inter == 0 { return 0 }
    return Double(inter) / Double(a[2] * a[3] + b[2] * b[3] - inter)
}

final class Track {
    let id: String; let concept: String
    var frames: [[String: Any]] = []
    var lastBox: [Int]; var lastIdx: Int
    init(id: String, concept: String, box: [Int], idx: Int) { self.id = id; self.concept = concept; lastBox = box; lastIdx = idx }
}

// ── EdgeTAM (efficient SAM2) box→mask on the ANE ─────────────────────
// image_encoder → prompt_encoder(box) → mask_decoder. Model inputs are f32,
// outputs f16 → convert on the chain. image_pe is the bundled constant.
struct EdgeTam { let image: MLModel; let prompt: MLModel; let decoder: MLModel; let imagePe: MLMultiArray }

func arr(_ p: MLFeatureProvider, _ name: String) -> MLMultiArray? { p.featureValue(for: name)?.multiArrayValue }

func toF32(_ a: MLMultiArray) throws -> MLMultiArray {
    let out = try MLMultiArray(shape: a.shape, dataType: .float32)
    let n = a.count
    let d = out.dataPointer.bindMemory(to: Float32.self, capacity: n)
    switch a.dataType {
    case .float16: let s = a.dataPointer.bindMemory(to: Float16.self, capacity: n); for i in 0 ..< n { d[i] = Float32(s[i]) }
    case .float32: let s = a.dataPointer.bindMemory(to: Float32.self, capacity: n); for i in 0 ..< n { d[i] = s[i] }
    default: for i in 0 ..< n { d[i] = a[i].floatValue }
    }
    return out
}

func fval(_ a: MLMultiArray, _ i: Int) -> Float {
    a.dataType == .float16 ? Float(a.dataPointer.bindMemory(to: Float16.self, capacity: a.count)[i]) : (a.dataType == .float32 ? a.dataPointer.bindMemory(to: Float32.self, capacity: a.count)[i] : a[i].floatValue)
}

func loadEdgeTam(_ dir: URL) async throws -> EdgeTam {
    let image = try await aneModel(dir.appendingPathComponent("edgetam_image_encoder.mlpackage"))
    let prompt = try await aneModel(dir.appendingPathComponent("edgetam_prompt_encoder.mlpackage"))
    let decoder = try await aneModel(dir.appendingPathComponent("edgetam_mask_decoder.mlpackage"))
    let peData = try Data(contentsOf: dir.appendingPathComponent("image_pe_f32.bin"))
    let pe = try MLMultiArray(shape: [1, 256, 64, 64], dataType: .float32)
    peData.withUnsafeBytes { raw in
        let src = raw.bindMemory(to: Float32.self)
        let dst = pe.dataPointer.bindMemory(to: Float32.self, capacity: src.count)
        for i in 0 ..< min(src.count, pe.count) { dst[i] = src[i] }
    }
    return EdgeTam(image: image, prompt: prompt, decoder: decoder, imagePe: pe)
}

// image → [1,3,1024,1024] f32, /255 then ImageNet norm, CHW
func edgeImageInput(_ cg: CGImage) throws -> MLMultiArray {
    let R = 1024
    var buf = [UInt8](repeating: 0, count: R * R * 4)
    let ctx = CGContext(data: &buf, width: R, height: R, bitsPerComponent: 8, bytesPerRow: R * 4,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: R, height: R))
    let mean: [Float] = [0.485, 0.456, 0.406], std: [Float] = [0.229, 0.224, 0.225]
    let a = try MLMultiArray(shape: [1, 3, NSNumber(value: R), NSNumber(value: R)], dataType: .float32)
    let p = a.dataPointer.bindMemory(to: Float32.self, capacity: 3 * R * R)
    for y in 0 ..< R {
        for x in 0 ..< R {
            let o = (y * R + x) * 4
            for c in 0 ..< 3 { p[c * R * R + y * R + x] = (Float(buf[o + c]) / 255.0 - mean[c]) / std[c] }
        }
    }
    return a
}

// prompt in 1024-space → best mask logits (256×256) + iou.
// points = [(x,y,label)] (label 1=fg,0=bg,2=box-tl,3=box-br); box = [x1,y1,x2,y2] or empty.
func edgeSegment(_ m: EdgeTam, _ features: MLFeatureProvider, box: [Float], points: [(Float, Float, Float)] = []) async throws -> (logits: [Float], iou: Float) {
    let boxA = try MLMultiArray(shape: [1, 4], dataType: .float32)
    for i in 0 ..< 4 { boxA[i] = NSNumber(value: box.count == 4 ? box[i] : 0) }
    // point_coords [1,4,2], point_labels [1,4]: fill given points, pad rest with (0,0)/-1
    let pc = try MLMultiArray(shape: [1, 4, 2], dataType: .float32); for i in 0 ..< 8 { pc[i] = 0 }
    let pl = try MLMultiArray(shape: [1, 4], dataType: .float32); for i in 0 ..< 4 { pl[i] = -1 }
    for (j, p) in points.prefix(4).enumerated() {
        pc[j * 2] = NSNumber(value: p.0); pc[j * 2 + 1] = NSNumber(value: p.1); pl[j] = NSNumber(value: p.2)
    }
    let mi = try MLMultiArray(shape: [1, 1, 256, 256], dataType: .float32); for i in 0 ..< 256 * 256 { mi[i] = 0 }
    let pin: [String: Any] = [
        "point_coords": MLFeatureValue(multiArray: pc), "point_labels": MLFeatureValue(multiArray: pl),
        "boxes": MLFeatureValue(multiArray: boxA), "mask_input": MLFeatureValue(multiArray: mi)]
    let pout = try await m.prompt.prediction(from: MLDictionaryFeatureProvider(dictionary: pin))
    guard let sparse = arr(pout, "sparse_embeddings"), let dense = arr(pout, "dense_embeddings") else { die("prompt output") }
    guard let vf = arr(features, "vision_features"), let h0 = arr(features, "high_res_feat_0"), let h1 = arr(features, "high_res_feat_1") else { die("encoder output") }
    let mm = try MLMultiArray(shape: [1], dataType: .float32); mm[0] = 1
    let din: [String: Any] = [
        "image_embeddings": MLFeatureValue(multiArray: try toF32(vf)),
        "image_pe": MLFeatureValue(multiArray: m.imagePe),
        "sparse_prompt_embeddings": MLFeatureValue(multiArray: try toF32(sparse)),
        "dense_prompt_embeddings": MLFeatureValue(multiArray: try toF32(dense)),
        "high_res_feat_0": MLFeatureValue(multiArray: try toF32(h0)),
        "high_res_feat_1": MLFeatureValue(multiArray: try toF32(h1)),
        "multimask_output": MLFeatureValue(multiArray: mm)]
    let dout = try await m.decoder.prediction(from: MLDictionaryFeatureProvider(dictionary: din))
    guard let masks = arr(dout, "masks"), let iou = arr(dout, "iou_pred") else { die("decoder output") }
    var best = 0; var bestIou = fval(iou, 0)
    for i in 1 ..< 3 { let v = fval(iou, i); if v > bestIou { best = i; bestIou = v } }
    var logits = [Float](repeating: 0, count: 256 * 256)
    let base = best * 256 * 256
    for j in 0 ..< 256 * 256 { logits[j] = fval(masks, base + j) }
    return (logits, bestIou)
}

func edgeModelsDir() -> URL { modelsDir().appendingPathComponent("edgetam") }

// Single-image validation: box or point (source px) → mask; report coverage.
// --box x1,y1,x2,y2 | --point x,y | --mode box|boxpts|point | --norm (0..1 coords)
func runEdgeTest(image: String, boxStr: String) async throws {
    guard let cg = cgImage(image) else { die("cannot load \(image)") }
    let flags = parseArgs().flags
    let mode = flags["--mode"] ?? "box"
    let norm = flags["--norm"] != nil
    let sw = cg.width, sh = cg.height
    let m = try await loadEdgeTam(edgeModelsDir())
    let t0 = Date()
    let feats = try await m.image.prediction(from: MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(multiArray: try edgeImageInput(cg))]))
    // scale source px → 1024 px, or → [0,1] if --norm
    let sx: Float = norm ? 1.0 / Float(sw) : 1024.0 / Float(sw)
    let sy: Float = norm ? 1.0 / Float(sh) : 1024.0 / Float(sh)
    var box: [Float] = []
    var points: [(Float, Float, Float)] = []
    if let ps = flags["--point"] {
        let p = ps.split(separator: ",").map { Float($0.trimmingCharacters(in: .whitespaces)) ?? 0 }
        points = [(p[0] * sx, p[1] * sy, 1)]  // positive point
    } else {
        let b = boxStr.split(separator: ",").map { Float($0.trimmingCharacters(in: .whitespaces)) ?? 0 }
        guard b.count == 4 else { die("box = x1,y1,x2,y2 (source px)") }
        let sb: [Float] = [b[0] * sx, b[1] * sy, b[2] * sx, b[3] * sy]
        if mode == "boxpts" {
            points = [(sb[0], sb[1], 2), (sb[2], sb[3], 3)]  // box as corner points
        } else {
            box = sb  // box input
        }
    }
    let (logits, iou) = try await edgeSegment(m, feats, box: box, points: points)
    let on = logits.filter { $0 > 0 }.count
    log(String(format: "EdgeTAM/ANE [mode=%@ norm=%@]: iou=%.3f, mask %d/%d px (%.1f%%), %.2fs",
               mode, norm ? "y" : "n", iou, on, 256 * 256, 100.0 * Double(on) / Double(256 * 256), Date().timeIntervalSince(t0)))
    // optional: write mask@source over the frame as a red overlay for eyeballing
    if let dump = flags["--dump"] {
        let bin = maskToSource(logits, mw: 256, mh: 256, sw: sw, sh: sh)
        if let bb = maskBBox(bin, w: sw, h: sh) { log("  mask bbox (src px): \(bb)") }
        var buf = [UInt8](repeating: 0, count: sw * sh * 4)
        let ctx = CGContext(data: &buf, width: sw, height: sh, bitsPerComponent: 8, bytesPerRow: sw * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: sw, height: sh))
        for y in 0 ..< sh { for x in 0 ..< sw where bin[y * sw + x] != 0 {
            let o = (y * sw + x) * 4
            buf[o] = UInt8(min(255, Int(buf[o]) / 2 + 128)); buf[o + 1] = buf[o + 1] / 2; buf[o + 2] = buf[o + 2] / 2
        } }
        if let img = ctx.makeImage() {
            let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: dump) as CFURL, "public.png" as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, img, nil); CGImageDestinationFinalize(dest)
            log("  overlay → \(dump)")
        }
    }
}

// bbox [x,y,w,h] of a binary mask (source px), or nil if empty
func maskBBox(_ mask: [UInt8], w: Int, h: Int) -> [Int]? {
    var x0 = w, y0 = h, x1 = -1, y1 = -1
    for y in 0 ..< h { for x in 0 ..< w where mask[y * w + x] != 0 {
        if x < x0 { x0 = x }; if x > x1 { x1 = x }; if y < y0 { y0 = y }; if y > y1 { y1 = y }
    } }
    if x1 < 0 { return nil }
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1]
}

// Video box-propagation tracker: segment frame 0 with the given box, then
// follow the object forward by re-prompting each frame with the previous
// mask's bbox (padded). One tracklet. Reuses maskToSource/cocoRleEncode.
func runEdgeTam(video: String, boxStr: String, out: String, label: String, maxFrames: Int, sampleFps: Double) async throws {
    let b0 = boxStr.split(separator: ",").map { Float($0.trimmingCharacters(in: .whitespaces)) ?? 0 }
    guard b0.count == 4 else { die("--box x,y,w,h (source px, frame 0)") }
    let m = try await loadEdgeTam(edgeModelsDir())

    let asset = AVURLAsset(url: URL(fileURLWithPath: video))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { die("no video track") }
    let rate = try await track.load(.nominalFrameRate)
    let fps = rate > 0 ? Double(rate) : 30
    let dur = try await asset.load(.duration)
    let total = Int(CMTimeGetSeconds(dur) * fps)
    var stride = max(1, Int((fps / sampleFps).rounded()))
    if total > 0, total / stride > maxFrames { stride = max(stride, (total + maxFrames - 1) / maxFrames) }
    let reader = try AVAssetReader(asset: asset)
    let tOut = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(tOut); reader.startReading()
    let ci = CIContext(options: [.useSoftwareRenderer: false])

    // Track a fixed-ish-size box that follows the mask centroid. Prompting with
    // a box centered on where the object was (not the growing mask bbox) keeps
    // the prompt tight so it doesn't balloon into the background. Size adapts
    // slowly (EMA) toward the mask; center jumps to the mask centroid.
    var cx = Double(b0[0]) + Double(b0[2]) / 2, cy = Double(b0[1]) + Double(b0[3]) / 2
    var bw = Double(b0[2]), bh = Double(b0[3])
    var frames: [[String: Any]] = []
    var idx = 0, processed = 0
    let t0 = Date()
    while processed < maxFrames, let sample = tOut.copyNextSampleBuffer() {
        defer { idx += 1 }
        guard let px = CMSampleBufferGetImageBuffer(sample) else { continue }
        if idx % stride != 0 { continue }
        let sw = CVPixelBufferGetWidth(px), sh = CVPixelBufferGetHeight(px)
        guard let cg = ci.createCGImage(CIImage(cvPixelBuffer: px), from: CGRect(x: 0, y: 0, width: sw, height: sh)) else { continue }
        let feats = try await m.image.prediction(from: MLDictionaryFeatureProvider(dictionary: ["image": MLFeatureValue(multiArray: try edgeImageInput(cg))]))
        let sx = 1024.0 / Float(sw), sy = 1024.0 / Float(sh)
        // prompt box centered at (cx,cy) with the tracked size, as corner-points
        // (+ a positive point at the center) in 1024-px space
        let hx = bw / 2, hy = bh / 2
        let bx0 = Float(max(0, cx - hx)), by0 = Float(max(0, cy - hy))
        let bx1 = Float(min(Double(sw), cx + hx)), by1 = Float(min(Double(sh), cy + hy))
        let pts: [(Float, Float, Float)] = [
            (Float(cx) * sx, Float(cy) * sy, 1),   // positive center point
            (bx0 * sx, by0 * sy, 2), (bx1 * sx, by1 * sy, 3)]  // box corners
        let (logits, iou) = try await edgeSegment(m, feats, box: [], points: pts)
        let bin = maskToSource(logits, mw: 256, mh: 256, sw: sw, sh: sh)
        // drift guards: reject low-confidence or wildly-resized masks — keep the
        // prior center/size for the next prompt. (A memory bank would do better.)
        guard let bb = maskBBox(bin, w: sw, h: sh) else { processed += 1; continue }
        let lastArea = bw * bh, area = Double(bb[2] * bb[3])
        let areaOk = area >= 0.35 * lastArea && area <= 2.8 * lastArea
        guard iou >= 0.30, areaOk else { processed += 1; continue }
        // accept: jump center to mask centroid, ease size toward mask bbox
        cx = Double(bb[0]) + Double(bb[2]) / 2; cy = Double(bb[1]) + Double(bb[3]) / 2
        bw = 0.6 * bw + 0.4 * Double(bb[2]); bh = 0.6 * bh + 0.4 * Double(bb[3])
        let tMs = Int(Double(idx) / fps * 1000)
        let rle: [String: Any] = ["size": [sh, sw], "counts": cocoRleEncode(bin, w: sw, h: sh)]
        let frame: [String: Any] = ["t_ms": tMs, "bbox": bb, "conf": Double(iou), "rle": rle]
        frames.append(frame)
        processed += 1
        if processed % 10 == 0 { log("  \(processed) frames") }
    }
    let dt = Date().timeIntervalSince(t0)
    log(String(format: "EdgeTAM/ANE: %d frames tracked in %.1fs (%.2fs/frame)", frames.count, dt, dt / Double(max(1, frames.count))))
    let inMs = (frames.first?["t_ms"] as? Int) ?? 0
    let outMs = (frames.last?["t_ms"] as? Int) ?? 0
    let trk: [String: Any] = ["id": "trk-0", "concept": label, "pass": "sam31",
                              "in_ms": inMs, "out_ms": outMs, "frames": frames]
    let tracklets: [[String: Any]] = frames.isEmpty ? [] : [trk]
    let result: [String: Any] = ["pass": "sam31", "model": "EdgeTAM-CoreML (ANE)",
                                 "concepts": [label], "timing": "cfr-approx", "tracklets": tracklets]
    try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: out))
    print("{\"pass\":\"edgetam\",\"tracklets\":\(frames.isEmpty ? 0 : 1),\"frames\":\(frames.count),\"model\":\"edgetam-ane\"}")
}

// ── Motion / temporal signals via Apple Vision optical flow (on-device) ──
// VNGenerateOpticalFlowRequest gives a dense per-pixel (dx,dy) field between
// consecutive frames — native, GPU/ANE, no model download. We aggregate it
// into per-frame signals: motion energy (mag), global vector (gx,gy = camera
// pan/tilt), and radial divergence (div = zoom). video.ts turns these into
// camera-move labels, a cut-on-action curve, and match-cut signatures.
struct MotionSignal { let tMs: Int; let mag: Double; let gx: Double; let gy: Double; let div: Double }

func opticalFlow(_ prev: CVPixelBuffer, _ cur: CVPixelBuffer, accuracy: VNGenerateOpticalFlowRequest.ComputationAccuracy) throws -> CVPixelBuffer? {
    let req = VNGenerateOpticalFlowRequest(targetedCVPixelBuffer: cur, options: [:])
    req.computationAccuracy = accuracy
    req.outputPixelFormat = kCVPixelFormatType_TwoComponent32Float
    let handler = VNImageRequestHandler(cvPixelBuffer: prev, options: [:])
    try handler.perform([req])
    return (req.results?.first as? VNPixelBufferObservation)?.pixelBuffer
}

// aggregate a 2-ch f32 flow field on a coarse grid → mean vector, mean
// magnitude, and divergence (flow·radial-from-center; +out = zoom-in)
func aggregateFlow(_ flow: CVPixelBuffer) -> (mag: Double, gx: Double, gy: Double, div: Double) {
    CVPixelBufferLockBaseAddress(flow, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(flow, .readOnly) }
    let w = CVPixelBufferGetWidth(flow), h = CVPixelBufferGetHeight(flow)
    guard let base = CVPixelBufferGetBaseAddress(flow) else { return (0, 0, 0, 0) }
    let rowBytes = CVPixelBufferGetBytesPerRow(flow)
    let cx = Double(w) / 2, cy = Double(h) / 2
    let step = max(1, min(w, h) / 48)  // ~48-sample grid per axis
    var sumMag = 0.0, sumDx = 0.0, sumDy = 0.0, sumDiv = 0.0
    var n = 0
    var y = 0
    while y < h {
        let row = base.advanced(by: y * rowBytes)
        var x = 0
        while x < w {
            let dx = Double(row.load(fromByteOffset: x * 8, as: Float32.self))
            let dy = Double(row.load(fromByteOffset: x * 8 + 4, as: Float32.self))
            sumDx += dx; sumDy += dy
            sumMag += (dx * dx + dy * dy).squareRoot()
            // radial unit from center · flow → expansion (zoom-in) is positive
            let rx = Double(x) - cx, ry = Double(y) - cy
            let rl = (rx * rx + ry * ry).squareRoot()
            if rl > 1 { sumDiv += (dx * rx + dy * ry) / rl }
            n += 1; x += step
        }
        y += step
    }
    if n == 0 { return (0, 0, 0, 0) }
    return (sumMag / Double(n), sumDx / Double(n), sumDy / Double(n), sumDiv / Double(n))
}

func runMotion(video: String, out: String, maxFrames: Int, sampleFps: Double, accuracy: String) async throws {
    let acc: VNGenerateOpticalFlowRequest.ComputationAccuracy = accuracy == "high" ? .high : (accuracy == "medium" ? .medium : .low)
    let asset = AVURLAsset(url: URL(fileURLWithPath: video))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { die("no video track") }
    let rate = try await track.load(.nominalFrameRate)
    let fps = rate > 0 ? Double(rate) : 30
    let dur = try await asset.load(.duration)
    let total = Int(CMTimeGetSeconds(dur) * fps)
    var stride = max(1, Int((fps / sampleFps).rounded()))
    if total > 0, total / stride > maxFrames { stride = max(stride, (total + maxFrames - 1) / maxFrames) }
    let reader = try AVAssetReader(asset: asset)
    let tOut = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(tOut); reader.startReading()

    var prev: CVPixelBuffer?
    var signals: [MotionSignal] = []
    var idx = 0, processed = 0
    let t0 = Date()
    while processed < maxFrames, let sample = tOut.copyNextSampleBuffer() {
        defer { idx += 1 }
        guard let px = CMSampleBufferGetImageBuffer(sample) else { continue }
        if idx % stride != 0 { continue }
        // deep-copy the frame (the reader recycles the buffer)
        var copy: CVPixelBuffer?
        let w = CVPixelBufferGetWidth(px), h = CVPixelBufferGetHeight(px)
        CVPixelBufferCreate(nil, w, h, CVPixelBufferGetPixelFormatType(px), nil, &copy)
        if let dst = copy {
            CVPixelBufferLockBaseAddress(px, .readOnly); CVPixelBufferLockBaseAddress(dst, [])
            if let s = CVPixelBufferGetBaseAddress(px), let d = CVPixelBufferGetBaseAddress(dst) {
                memcpy(d, s, CVPixelBufferGetBytesPerRow(px) * h)
            }
            CVPixelBufferUnlockBaseAddress(px, .readOnly); CVPixelBufferUnlockBaseAddress(dst, [])
        }
        if let p = prev, let c = copy, let flow = try opticalFlow(p, c, accuracy: acc) {
            let a = aggregateFlow(flow)
            signals.append(MotionSignal(tMs: Int(Double(idx) / fps * 1000), mag: a.mag, gx: a.gx, gy: a.gy, div: a.div))
        }
        prev = copy
        processed += 1
        if processed % 20 == 0 { log("  \(processed) frames") }
    }
    let dt = Date().timeIntervalSince(t0)
    log(String(format: "motion/Vision optical flow: %d signals in %.1fs (%.3fs/frame), accuracy=%@", signals.count, dt, dt / Double(max(1, signals.count)), accuracy))
    let frames = signals.map { s -> [String: Any] in
        ["t_ms": s.tMs, "mag": s.mag, "gx": s.gx, "gy": s.gy, "div": s.div]
    }
    let result: [String: Any] = ["pass": "motion", "model": "Apple Vision VNGenerateOpticalFlow (\(accuracy))", "sample_fps": sampleFps, "frames": frames]
    try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: out))
    print("{\"pass\":\"motion\",\"signals\":\(signals.count),\"model\":\"vision-optical-flow\"}")
}

// ── V-JEPA 2 clip embeddings (video ViT) — temporal/motion similarity ────
// 16-frame clip → 1024-d L2-normed embedding (mean-pool + norm baked into the
// CoreML graph). Compute = CPU+GPU (NOT ANE: the model is 581MB — the ANE
// compiler chokes on models this big, cf. SAM3). An on-demand indexing pass.
func vjepaModelPath() -> URL { modelsDir().appendingPathComponent("vjepa/vjepa_clip_f16.mlpackage") }

// sample 16 frames evenly across [t0,t1] → [1,16,3,256,256] f32, /255 + ImageNet
func vjepaClipInput(_ frames: [CGImage]) throws -> MLMultiArray {
    let R = 256, N = 16
    let mean: [Float] = [0.485, 0.456, 0.406], std: [Float] = [0.229, 0.224, 0.225]
    let a = try MLMultiArray(shape: [1, NSNumber(value: N), 3, NSNumber(value: R), NSNumber(value: R)], dataType: .float32)
    let p = a.dataPointer.bindMemory(to: Float32.self, capacity: N * 3 * R * R)
    var buf = [UInt8](repeating: 0, count: R * R * 4)
    for f in 0 ..< N {
        let cg = frames[min(f, frames.count - 1)]
        for i in buf.indices { buf[i] = 0 }
        let ctx = CGContext(data: &buf, width: R, height: R, bitsPerComponent: 8, bytesPerRow: R * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: R, height: R))
        let fb = f * 3 * R * R
        for y in 0 ..< R {
            for x in 0 ..< R {
                let o = (y * R + x) * 4
                for c in 0 ..< 3 { p[fb + c * R * R + y * R + x] = (Float(buf[o + c]) / 255.0 - mean[c]) / std[c] }
            }
        }
    }
    return a
}

// decode a window of a video → 16 evenly-sampled CGImages
func sampleClip(_ video: String, inMs: Int, outMs: Int, n: Int = 16) async throws -> [CGImage] {
    let asset = AVURLAsset(url: URL(fileURLWithPath: video))
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { return [] }
    let reader = try AVAssetReader(asset: asset)
    reader.timeRange = CMTimeRange(start: CMTime(value: CMTimeValue(inMs), timescale: 1000),
                                   duration: CMTime(value: CMTimeValue(max(1, outMs - inMs)), timescale: 1000))
    let tOut = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(tOut); reader.startReading()
    let ci = CIContext(options: [.useSoftwareRenderer: false])
    var all: [CGImage] = []
    while let s = tOut.copyNextSampleBuffer(), let px = CMSampleBufferGetImageBuffer(s) {
        let w = CVPixelBufferGetWidth(px), h = CVPixelBufferGetHeight(px)
        if let cg = ci.createCGImage(CIImage(cvPixelBuffer: px), from: CGRect(x: 0, y: 0, width: w, height: h)) { all.append(cg) }
        if all.count > 400 { break }
    }
    if all.isEmpty { return [] }
    return (0 ..< n).map { all[min(all.count - 1, Int(Double($0) * Double(all.count - 1) / Double(n - 1)))] }
}

func vjepaEmbed(_ model: MLModel, _ frames: [CGImage]) async throws -> [Float] {
    let inp = try vjepaClipInput(frames)
    let out = try await model.prediction(from: MLDictionaryFeatureProvider(dictionary: ["pixel_values": MLFeatureValue(multiArray: inp)]))
    guard let e = arr(out, "embedding") else { die("no embedding output") }
    return (0 ..< e.count).map { fval(e, $0) }
}

func cosine(_ a: [Float], _ b: [Float]) -> Float {
    var d: Float = 0; for i in 0 ..< min(a.count, b.count) { d += a[i] * b[i] }; return d
}

// single-clip test: encode one window, report timing (measure native cost)
func runVjepaTest(video: String, windowStr: String) async throws {
    let parts = windowStr.split(separator: ":").map { Int(Double($0) ?? 0) * 1000 }
    let (inMs, outMs) = parts.count == 2 ? (parts[0], parts[1]) : (0, 5000)
    let load0 = Date()
    let model = try await aneModel(vjepaModelPath(), units: .cpuAndGPU)
    let loadDt = Date().timeIntervalSince(load0)
    let frames = try await sampleClip(video, inMs: inMs, outMs: outMs)
    guard frames.count >= 1 else { die("no frames in window") }
    let t0 = Date()
    let emb = try await vjepaEmbed(model, frames)
    log(String(format: "V-JEPA/CoreML(cpu+gpu): load+compile %.1fs, encode %.2fs, dim %d, |emb|=%.3f",
               loadDt, Date().timeIntervalSince(t0), emb.count, cosine(emb, emb).squareRoot()))
}

// Full pass: encode each window (--windows "in:out,..." ms, else auto ~5s) →
// clip embedding. video.ts passes shot boundaries + stores embeddings.
func runVjepa(video: String, out: String) async throws {
    let f = parseArgs().flags
    let model = try await aneModel(vjepaModelPath(), units: .cpuAndGPU)
    var windows: [(Int, Int)] = []
    if let ws = f["--windows"], !ws.isEmpty {
        windows = ws.split(separator: ",").compactMap { seg in
            let p = seg.split(separator: ":").compactMap { Int($0) }
            return p.count == 2 ? (p[0], p[1]) : nil
        }
    } else {
        let asset = AVURLAsset(url: URL(fileURLWithPath: video))
        let dur = Int(CMTimeGetSeconds(try await asset.load(.duration)) * 1000)
        var t = 0; while t < dur { windows.append((t, min(dur, t + 5000))); t += 5000 }
    }
    var clips: [[String: Any]] = []
    let t0 = Date()
    for (i, (inMs, outMs)) in windows.enumerated() {
        let frames = try await sampleClip(video, inMs: inMs, outMs: outMs)
        if frames.isEmpty { continue }
        let emb = try await vjepaEmbed(model, frames)
        clips.append(["in_ms": inMs, "out_ms": outMs, "emb": emb.map { Double($0) }])
        if (i + 1) % 4 == 0 { log("  \(i + 1)/\(windows.count) clips") }
    }
    let dt = Date().timeIntervalSince(t0)
    log(String(format: "V-JEPA/CoreML(cpu+gpu): %d clip embeddings in %.1fs (%.2fs/clip)", clips.count, dt, dt / Double(max(1, clips.count))))
    let result: [String: Any] = ["pass": "vjepa", "model": "V-JEPA 2 ViT-L CoreML (cpu+gpu, 16f)", "dim": 1024, "clips": clips]
    try JSONSerialization.data(withJSONObject: result).write(to: URL(fileURLWithPath: out))
    print("{\"pass\":\"vjepa\",\"clips\":\(clips.count),\"dim\":1024,\"model\":\"vjepa-coreml\"}")
}
