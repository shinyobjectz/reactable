import AVFoundation

// A take as ONE playable thing: stage video + voice (offset by the recorded
// anchors) with the cam PIP'd top-right. Built as an AVMutableComposition so
// sync is deterministic, not two racing players. Shared by every take preview.
@MainActor
enum TakeComposition {
    /// Compose stage.mov + cam.mov PIP + mic(-clean).wav from `events.jsonl`
    /// anchors. Returns nil only if the take has no readable stage track.
    static func build(takeDir: URL) -> (item: AVPlayerItem, renderSize: CGSize)? {
        // Anchors from events.jsonl (take clock; stage = zero of stage.mov).
        var tStage = 0.0, tCam: Double?, tMic: Double?
        if let text = try? String(contentsOf: takeDir.appending(path: "events.jsonl"), encoding: .utf8) {
            for line in text.split(separator: "\n") {
                guard let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                      let type = obj["type"] as? String, let t = obj["t"] as? Double else { continue }
                switch type {
                case "capture.stage": if tStage == 0 { tStage = t }
                case "capture.cam.start": tCam = tCam ?? t
                case "capture.mic.start", "capture.mic": tMic = tMic ?? t
                default: break
                }
            }
        }

        let comp = AVMutableComposition()
        let videoComp = AVMutableVideoComposition()
        var layerInstructions: [AVMutableVideoCompositionLayerInstruction] = []
        var renderSize = CGSize(width: 1280, height: 720)
        var duration = CMTime.zero
        var hasStage = false

        func addVideo(_ url: URL, offset: Double, isPIP: Bool) {
            let asset = AVURLAsset(url: url)
            guard let src = asset.tracks(withMediaType: .video).first,
                  let dst = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { return }
            let at = CMTime(seconds: max(0, offset), preferredTimescale: 600)
            try? dst.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: src, at: at)
            let li = AVMutableVideoCompositionLayerInstruction(assetTrack: dst)
            let natural = src.naturalSize.applying(src.preferredTransform)
            let size = CGSize(width: abs(natural.width), height: abs(natural.height))
            if isPIP {
                let scale = (renderSize.width * 0.24) / size.width
                let w = size.width * scale, h = size.height * scale
                var tf = CGAffineTransform(scaleX: scale, y: scale)
                tf = tf.concatenating(CGAffineTransform(
                    translationX: renderSize.width - w - 24,
                    y: renderSize.height - h - 24))
                li.setTransform(tf, at: .zero)
            } else {
                hasStage = true
                renderSize = size
                let end = CMTimeAdd(at, asset.duration)
                if end > duration { duration = end }
            }
            layerInstructions.append(li)
        }

        // Stage first (defines render size), cam second (drawn on top).
        addVideo(takeDir.appending(path: "stage.mov"), offset: 0, isPIP: false)
        guard hasStage else { return nil }
        if let tCam {
            addVideo(takeDir.appending(path: "cam.mov"), offset: tCam - tStage, isPIP: true)
        }

        func addAudio(_ url: URL, offset: Double) {
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            let asset = AVURLAsset(url: url)
            guard let src = asset.tracks(withMediaType: .audio).first,
                  let dst = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { return }
            let at = CMTime(seconds: max(0, offset), preferredTimescale: 600)
            try? dst.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: src, at: at)
        }
        addAudio(takeDir.appending(path: "stage.mov"), offset: 0)  // system audio
        let mic = takeDir.appending(path: "mic-clean.wav")
        let micRaw = takeDir.appending(path: "mic.wav")
        addAudio(FileManager.default.fileExists(atPath: mic.path) ? mic : micRaw,
                 offset: (tMic ?? tStage) - tStage)

        // Layer instructions are composited in ORDER, first = frontmost.
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
        instruction.layerInstructions = layerInstructions.reversed()
        videoComp.instructions = [instruction]
        videoComp.renderSize = renderSize
        videoComp.frameDuration = CMTime(value: 1, timescale: 30)

        let item = AVPlayerItem(asset: comp)
        item.videoComposition = videoComp
        return (item, renderSize)
    }
}
