import AppKit
import WebKit

// Single source of truth for window-chrome geometry, strokes, and surfaces.
// Every panel root, dock cell, and content frame reads these — and the same
// values are injected into every WKWebView as --rt-* CSS custom properties so
// the .work surfaces can never drift from the native chrome.
enum Chrome {
    // MARK: Silhouette
    /// Corner radius of every window root (floats and dock groups).
    static let radiusOuter: CGFloat = 14
    /// Corner radius of the inner content frame (webview / player surround).
    static let radiusInner: CGFloat = 10
    /// Corner radius for controls: pills, buttons, drop hints.
    static let radiusControl: CGFloat = 8

    // MARK: Strokes
    static let strokeWidth: CGFloat = 1
    /// Hairline on window roots — sits over chrome, never over content.
    static let strokeOuter = NSColor(white: 1, alpha: 0.10)
    /// Stroke around the content frame — lives in a 1pt padding ring.
    static let strokeInner = NSColor(white: 1, alpha: 0.14)

    // MARK: Surfaces
    static let bgRoot = NSColor(white: 0.08, alpha: 1)
    static let bgContent = NSColor(white: 0.035, alpha: 1)

    // MARK: Metrics
    static let dragStripHeight: CGFloat = 28
    /// Dock-group header — taller than a panel strip to host the centered
    /// Record|Edit page switch (DaVinci-style top bar).
    static let groupHeaderHeight: CGFloat = 42
    static let cellHeaderHeight: CGFloat = 22
    static let gapBelowDrag: CGFloat = 8
    static let frameMargin: CGFloat = 12
    static let showAnimDuration: TimeInterval = 0.18
    static let reflowAnimDuration: TimeInterval = 0.18

    /// Shell size that wraps `content` with the header strip + rounded frame margins.
    static func shellSize(for content: NSSize) -> NSSize {
        NSSize(
            width: content.width + frameMargin * 2,
            height: dragStripHeight + gapBelowDrag + content.height + frameMargin
        )
    }

    /// The one way to style a window root: rounded, masked, filled, hairlined.
    /// Every silhouette in the app goes through here so they can't diverge.
    @MainActor
    static func styleRoot(_ view: NSView) {
        view.wantsLayer = true
        view.layer?.cornerRadius = radiusOuter
        view.layer?.masksToBounds = true
        view.layer?.backgroundColor = bgRoot.cgColor
        view.layer?.borderColor = strokeOuter.cgColor
        view.layer?.borderWidth = strokeWidth
    }

    // MARK: Web token bridge

    /// CSS custom properties mirroring the native tokens, injected at document
    /// start into every panel webview. .work surfaces consume them with
    /// fallbacks: `border-radius: var(--rt-radius-outer, 14px)`.
    private static var cssTokens: [(String, String)] {
        [
            ("--rt-radius-outer", "\(Int(radiusOuter))px"),
            ("--rt-radius-inner", "\(Int(radiusInner))px"),
            ("--rt-radius-control", "\(Int(radiusControl))px"),
            ("--rt-stroke-w", "\(Int(strokeWidth))px"),
            ("--rt-stroke-outer", "rgba(255,255,255,.10)"),
            ("--rt-stroke-inner", "rgba(255,255,255,.14)"),
            ("--rt-bg-root", "rgba(20,20,20,1)"),
            ("--rt-bg-content", "rgba(9,9,9,1)"),
            ("--rt-strip-h", "\(Int(dragStripHeight))px"),
            ("--rt-margin", "\(Int(frameMargin))px"),
            ("--rt-gap", "\(Int(gapBelowDrag))px"),
        ]
    }

    /// Install the --rt-* tokens on `document.documentElement` before any
    /// surface script runs. Call at every WKWebViewConfiguration site.
    @MainActor
    static func injectTokens(into config: WKWebViewConfiguration) {
        let sets = cssTokens
            .map { "d.style.setProperty('\($0.0)','\($0.1)');" }
            .joined()
        let js = "(function(){const d=document.documentElement;\(sets)})();"
        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        config.userContentController.addUserScript(script)
    }
}
