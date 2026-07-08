// swift-tools-version: 6.0
import PackageDescription

// reactable-vision — native CoreML/ANE footage passes + Vision OCR + MobileCLIP
// embeddings. The laptop-kind lane: Neural Engine, no Python. swift-transformers
// supplies the CLIP tokenizer for text embeddings.
let package = Package(
    name: "reactable-vision",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "reactable-vision",
            path: "Sources/reactable-vision"
        )
    ]
)
