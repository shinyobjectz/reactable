import AppKit
import WebKit

// The ONE chrome wrapper every floating panel uses: native drag strip with
// the six-dot grip on top, content below, hover-only resize corners. Stage
// and agent build the same pieces; web panels install this instead of
// rolling their own headers.
@MainActor
enum PanelChrome {
    static func install(in win: NSWindow, content: NSView) {
        let root = NSView()
        win.contentView = root

        let strip = DragStripView()
        strip.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(strip)

        content.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(content)

        NSLayoutConstraint.activate([
            strip.topAnchor.constraint(equalTo: root.topAnchor),
            strip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            strip.heightAnchor.constraint(equalToConstant: Chrome.dragStripHeight),
            content.topAnchor.constraint(equalTo: strip.bottomAnchor, constant: Chrome.gapBelowDrag),
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Chrome.frameMargin),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Chrome.frameMargin),
            content.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Chrome.frameMargin),
        ])
        ResizeCornersView.attach(to: root)
    }
}
