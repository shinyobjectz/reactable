import CoreGraphics
import Foundation

/// Screen Recording TCC — only touch ScreenCaptureKit after permission is granted (or user picks a capture source).
enum ScreenCaptureAccess {
    static var isGranted: Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Prompts once if needed. Returns whether capture APIs may be used.
    @discardableResult
    static func requestIfNeeded() -> Bool {
        if isGranted { return true }
        return CGRequestScreenCaptureAccess()
    }
}
