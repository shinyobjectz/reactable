import AppKit

/// Borderless windows must opt in or they cannot become key / receive drags.
@MainActor
final class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// Keeps utility panels visible when another app takes focus (Screen Studio behavior).
@MainActor
enum FloatingWindow {
    static func configure(_ window: NSWindow) {
        window.hidesOnDeactivate = false
        window.collectionBehavior.insert(.canJoinAllSpaces)
        window.collectionBehavior.insert(.fullScreenAuxiliary)
    }

    static func configurePanel(_ panel: NSPanel) {
        configure(panel)
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = .floating
    }
}
