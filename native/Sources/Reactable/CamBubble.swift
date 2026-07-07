import AVFoundation
import AppKit

private final class CamMovieDelegate: NSObject, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
    nonisolated(unsafe) var onFinish: ((URL) -> Void)?
    nonisolated(unsafe) var onError: ((Error) -> Void)?

    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        DispatchQueue.main.async {
            if let error {
                self.onError?(error)
            } else {
                self.onFinish?(outputFileURL)
            }
        }
    }
}

@MainActor
final class CamBubblePanel: NSWindow {
    private let previewView = CamPreviewView()
    private var session: AVCaptureSession?
    private var movieOutput: AVCaptureMovieFileOutput?
    private let movieDelegate = CamMovieDelegate()
    private var recordingURL: URL?
    private var stopContinuation: CheckedContinuation<Void, Error>?
    private var mirrored = true
    // Full 16:9 webcam view with rounded corners (not a circular bubble).
    private var camWidth: CGFloat = 320
    private var camHeight: CGFloat { (camWidth * 9 / 16).rounded() }
    private let cornerRadius: CGFloat = 16

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 180),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        FloatingWindow.configure(self)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = false
        contentView = previewView
        previewView.onDrag = { [weak self] dx, dy in self?.moveBy(dx: dx, dy: dy) }
        previewView.onResize = { [weak self] delta in self?.resizeBy(delta: delta) }
        movieDelegate.onFinish = { [weak self] _ in
            guard let self else { return }
            self.finishRecordingCleanup()
            self.stopContinuation?.resume()
            self.stopContinuation = nil
        }
        movieDelegate.onError = { [weak self] error in
            guard let self else { return }
            self.finishRecordingCleanup()
            self.stopContinuation?.resume(throwing: error)
            self.stopContinuation = nil
        }
        positionDefault()
        updateMask()
    }

    func positionDefault() {
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            setFrameOrigin(NSPoint(x: f.maxX - camWidth - 24, y: f.minY + 24))
        }
    }

    func setVisible(_ on: Bool) {
        if on {
            startCamera()
            orderFrontRegardless()
        } else {
            if movieOutput?.isRecording == true {
                movieOutput?.stopRecording()
            }
            stopCamera()
            orderOut(nil)
        }
    }

    func setMirror(_ on: Bool) {
        mirrored = on
        previewView.setMirror(on)
    }

    func setSize(_ size: CGFloat) {
        // `size` is the width; height follows the 16:9 aspect.
        camWidth = max(200, min(640, size))
        let origin = frame.origin
        setFrame(NSRect(x: origin.x, y: origin.y, width: camWidth, height: camHeight), display: true)
        updateMask()
    }

    func startRecording(to url: URL) throws {
        startCamera()
        guard let session else { throw CamRecordError.noSession }

        if movieOutput == nil {
            let output = AVCaptureMovieFileOutput()
            session.beginConfiguration()
            if session.canAddOutput(output) {
                session.addOutput(output)
                movieOutput = output
            }
            session.commitConfiguration()
        }

        guard let movieOutput, !movieOutput.isRecording else { return }
        recordingURL = url
        if FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.removeItem(at: url)
        }
        movieOutput.startRecording(to: url, recordingDelegate: movieDelegate)
    }

    func stopRecording() async throws {
        guard let movieOutput, movieOutput.isRecording else { return }
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            stopContinuation = cont
            movieOutput.stopRecording()
        }
    }

    private func finishRecordingCleanup() {
        guard let session, let movieOutput else { return }
        session.beginConfiguration()
        session.removeOutput(movieOutput)
        session.commitConfiguration()
        self.movieOutput = nil
        recordingURL = nil
    }

    private func updateMask() {
        previewView.layer?.cornerRadius = cornerRadius
        previewView.layer?.masksToBounds = true
    }

    private func moveBy(dx: CGFloat, dy: CGFloat) {
        var f = frame
        f.origin.x += dx
        f.origin.y += dy
        setFrame(f, display: true)
    }

    private func resizeBy(delta: CGFloat) {
        setSize(camWidth + delta)
    }

    private func startCamera() {
        guard session == nil else { return }
        AVCaptureDevice.requestAccess(for: .video) { _ in }
        let s = AVCaptureSession()
        s.sessionPreset = .high
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              s.canAddInput(input) else { return }
        s.addInput(input)
        previewView.attach(session: s, mirror: mirrored)
        DispatchQueue.global(qos: .userInitiated).async { [s] in s.startRunning() }
        session = s
    }

    private func stopCamera() {
        session?.stopRunning()
        session = nil
        movieOutput = nil
        previewView.detach()
    }

    func frameJSON() -> [String: Any] {
        let f = frame
        return ["x": f.origin.x, "y": f.origin.y, "size": camWidth, "width": camWidth, "height": camHeight]
    }
}

enum CamRecordError: Error {
    case noSession
}

@MainActor
final class CamPreviewView: NSView {
    var onDrag: ((CGFloat, CGFloat) -> Void)?
    var onResize: ((CGFloat) -> Void)?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var dragOrigin: NSPoint?
    private let resizeGrip = NSView()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        resizeGrip.frame = NSRect(x: 0, y: 0, width: 18, height: 18)
        addSubview(resizeGrip)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        previewLayer?.frame = bounds
        resizeGrip.frame = NSRect(x: bounds.width - 20, y: 2, width: 18, height: 18)
    }

    func attach(session: AVCaptureSession, mirror: Bool) {
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        self.layer?.addSublayer(layer)
        previewLayer = layer
        setMirror(mirror)
        needsLayout = true
    }

    func detach() {
        previewLayer?.removeFromSuperlayer()
        previewLayer = nil
    }

    func setMirror(_ on: Bool) {
        guard let pl = previewLayer else { return }
        if let conn = pl.connection, conn.isVideoMirroringSupported {
            conn.automaticallyAdjustsVideoMirroring = false
            conn.isVideoMirrored = on
        }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        dragOrigin = resizeGrip.frame.contains(p) ? p : event.locationInWindow
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = dragOrigin else { return }
        if resizeGrip.frame.contains(start) {
            onResize?(event.deltaY - event.deltaX)
        } else {
            // deltaY is positive when the mouse moves DOWN, but screen-y increases
            // UPWARD — negate so the window follows the cursor instead of inverting.
            onDrag?(event.deltaX, -event.deltaY)
        }
    }

    override func mouseUp(with event: NSEvent) { dragOrigin = nil }
}
