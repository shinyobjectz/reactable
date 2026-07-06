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
        .package(url: "https://github.com/wulkano/Aperture", from: "3.0.0"),
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
