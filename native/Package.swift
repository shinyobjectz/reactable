// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ReactableNative",
    platforms: [.macOS(.v15)],
    products: [
        .executable(name: "reactable", targets: ["Reactable"]),
        .executable(name: "p0-spike", targets: ["P0Spike"]),
    ],
    dependencies: [
        // Vendored (upstream wulkano/Aperture 3.x, MIT) — carries local fixes:
        // retina window capture (upstream captures windows at 1x point size).
        .package(path: "Vendor/Aperture"),
    ],
    targets: [
        .executableTarget(
            name: "Reactable",
            dependencies: [
                .product(name: "Aperture", package: "Aperture"),
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("AVFoundation"),
            ]
        ),
        .executableTarget(
            name: "P0Spike",
            dependencies: [
                .product(name: "Aperture", package: "Aperture"),
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
            ]
        ),
    ]
)
