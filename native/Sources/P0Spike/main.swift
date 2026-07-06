import AppKit
import Aperture
import WebKit

// P0 spike (PLAN.work): Aperture .window capture of a WKWebView showing a
// cross-origin iframe — confirm recording pixels are clean, not tainted/black.

private let stageTitle = "Reactable Stage — P0"
private let recordSeconds: UInt64 = 5

@MainActor
final class StageWindow: NSWindow {
    let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())

    init() {
        super.init(
            contentRect: NSRect(x: 120, y: 120, width: 960, height: 540),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        title = stageTitle
        isReleasedWhenClosed = false
        webView.autoresizingMask = [.width, .height]
        contentView = webView
    }

    func loadCrossOriginFixture() {
        // Parent is data: HTML; iframe is a real cross-origin app (tldraw.com).
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { box-sizing: border-box; margin: 0; }
            html, body { height: 100%; background: #0e0e12; }
            iframe { display: block; width: 100%; height: 100%; border: 0; }
          </style>
        </head>
        <body>
          <iframe src="https://tldraw.com" title="tldraw"></iframe>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}

@MainActor
func waitForWindowID(title: String, timeout: TimeInterval = 10) async throws -> String {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        let windows = try await Aperture.Devices.window(
            excludeDesktopWindows: true,
            onScreenWindowsOnly: true
        )
        if let match = windows.first(where: { $0.title?.contains(title) == true }) {
            return match.id
        }
        try await Task.sleep(for: .milliseconds(200))
    }
    throw SpikeError.windowNotFound(title)
}

@MainActor
func runSpike() async {
    let outDir = URL(filePath: FileManager.default.currentDirectoryPath, directoryHint: .isDirectory)
        .appending(path: "spike-out", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    let destination = outDir.appending(path: "stage-window.mp4")

    let stage = StageWindow()
    stage.makeKeyAndOrderFront(nil)
    stage.loadCrossOriginFixture()
    NSApp.activate(ignoringOtherApps: true)

    fputs("P0: waiting for WKWebView + cross-origin iframe…\n", stderr)
    try? await Task.sleep(for: .seconds(3))

    do {
        let windowID = try await waitForWindowID(title: stageTitle)
        fputs("P0: found window id \(windowID)\n", stderr)

        let recorder = Aperture.Recorder()
        try await recorder.start(
            target: .window,
            options: Aperture.RecordingOptions(
                destination: destination,
                targetID: windowID,
                framesPerSecond: 30,
                showCursor: true,
                videoCodec: .h264
            )
        )

        fputs("P0: recording \(recordSeconds)s → \(destination.path())\n", stderr)
        try await Task.sleep(for: .seconds(recordSeconds))
        try await recorder.stop()

        let attrs = try FileManager.default.attributesOfItem(atPath: destination.path())
        let bytes = (attrs[.size] as? NSNumber)?.intValue ?? 0
        fputs("P0: done — \(bytes) bytes written to \(destination.path())\n", stderr)
        fputs("P0: verify with: ffprobe -show_streams \(destination.path())\n", stderr)
        fputs("P0: frame grab: ffmpeg -ss 2 -i \(destination.path()) -frames:v 1 spike-out/frame.png\n", stderr)

        NSApp.terminate(nil)
    } catch {
        fputs("P0 FAILED: \(error)\n", stderr)
        NSApp.terminate(nil)
    }
}

enum SpikeError: Error, CustomStringConvertible {
    case windowNotFound(String)

    var description: String {
        switch self {
        case .windowNotFound(let title): "Could not find Aperture window titled “\(title)”"
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await runSpike() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
