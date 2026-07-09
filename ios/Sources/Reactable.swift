import SwiftUI
import UIKit

// =====================================================================
// Reactable — the pocket studio.
// Two vertically-stacked full pages, hinged by a six-dot handle:
//   VIEWER  — top rung (swipe projects · tap = assets/record),
//             center carousel of deliverables, bottom handle = agent status.
//   CHAT    — swipe up: full-page project chat; swipe down to return.
// No hold-to-react, no bottom toolbar. Direction happens in chat.
// =====================================================================

extension Color {
    init(hex: UInt, _ a: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xff)/255,
                  green: Double((hex >> 8) & 0xff)/255,
                  blue: Double(hex & 0xff)/255, opacity: a)
    }
}

enum P {
    static let bg    = Color(hex: 0x0A0A0B)
    static let surface = Color(hex: 0x161619)
    static let surface2 = Color(hex: 0x1F1F23)
    static let ink   = Color(hex: 0xF3F2EF)
    static let ink2  = Color.white.opacity(0.60)
    static let ink3  = Color.white.opacity(0.36)
    static let line  = Color.white.opacity(0.12)
    static let line2 = Color.white.opacity(0.18)
    static let indigo = Color(hex: 0x6366F1)
    static let userTop = Color(hex: 0x4338CA)
    static let userBot = Color(hex: 0x3730A3)
    static let ok    = Color(hex: 0x6EE7B7)
    static let warn  = Color(hex: 0xFBBF24)
    static let vViolet = Color(hex: 0x8B5CF6)
    static let vBlue   = Color(hex: 0x3B82F6)
    static var voice: [Color] { [vViolet, vBlue, vViolet] }

    static func mono(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w, design: .monospaced) }
    static func sans(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font { .system(size: s, weight: w) }
}

enum Tex {
    static let noise: UIImage = {
        let n = 90
        let r = UIGraphicsImageRenderer(size: CGSize(width: n, height: n))
        return r.image { c in
            for x in 0..<n { for y in 0..<n {
                let v = CGFloat.random(in: 0...1)
                c.cgContext.setFillColor(UIColor(white: v, alpha: 1).cgColor)
                c.cgContext.fill(CGRect(x: x, y: y, width: 1, height: 1))
            } }
        }
    }()
}
struct Grain: View {
    var opacity: Double = 0.05
    var body: some View {
        Image(uiImage: Tex.noise).resizable(resizingMode: .tile)
            .opacity(opacity).blendMode(.overlay).allowsHitTesting(false)
    }
}

// six-dot grip handle (no arrows)
struct SixDots: View {
    var body: some View {
        VStack(spacing: 3.5) {
            ForEach(0..<2, id: \.self) { _ in
                HStack(spacing: 3.5) { ForEach(0..<3, id: \.self) { _ in Circle().fill(P.ink3).frame(width: 3.5, height: 3.5) } }
            }
        }
    }
}

// raised 3D-bump grip
struct BumpDots: View {
    var body: some View {
        VStack(spacing: 4) {
            ForEach(0..<2, id: \.self) { _ in
                HStack(spacing: 5) { ForEach(0..<3, id: \.self) { _ in bump } }
            }
        }
    }
    var bump: some View {
        Circle()
            .fill(LinearGradient(colors: [Color(hex: 0x3E3E46), Color(hex: 0x161619)], startPoint: .top, endPoint: .bottom))
            .frame(width: 7, height: 7)
            .overlay(Circle().stroke(.white.opacity(0.16), lineWidth: 0.5).offset(y: -0.3))
            .shadow(color: .black.opacity(0.6), radius: 0.7, y: 0.8)
    }
}

// animated voice-gradient waveform
struct WaveBars: View {
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<22, id: \.self) { i in bar(t, i) }
            }
        }
        .frame(height: 30)
    }
    func bar(_ t: Double, _ i: Int) -> some View {
        let p = (sin(t * 5 + Double(i) * 0.5) + 1) / 2
        return Capsule()
            .fill(LinearGradient(colors: P.voice, startPoint: .top, endPoint: .bottom))
            .frame(width: 3, height: 5 + CGFloat(p) * 22)
    }
}

// small live spinner for the current agent event
struct Spinner: View {
    var color: Color
    @State private var on = false
    var body: some View {
        Circle().trim(from: 0, to: 0.3)
            .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            .frame(width: 15, height: 15)
            .rotationEffect(.degrees(on ? 360 : 0))
            .animation(.linear(duration: 0.9).repeatForever(autoreverses: false), value: on)
            .onAppear { on = true }
    }
}

// MARK: - Model

struct Deliverable: Identifiable, Hashable {
    let id: Int; let name: String; let variant: Int; let version: Int; let clips: Int; let dur: String; let status: String; let aspect: String
    var statusColor: Color { status == "ready" ? P.ok : (status == "editing" ? P.warn : P.vBlue) }
    var ratio: CGFloat { aspect == "9:16" ? 9.0/16.0 : (aspect == "1:1" ? 1 : 16.0/9.0) }
}
let PROJECTS = ["Summer campaign", "Product launch", "Weekly vlog"]
let PROJECT_DELIVERABLES: [[Deliverable]] = [
    [ .init(id: 0, name: "Golden hour reel", variant: 0, version: 2, clips: 8,  dur: "0:24", status: "ready",   aspect: "9:16"),
      .init(id: 1, name: "City at night",    variant: 1, version: 2, clips: 5,  dur: "0:18", status: "editing", aspect: "9:16"),
      .init(id: 2, name: "Studio session",   variant: 2, version: 3, clips: 12, dur: "0:36", status: "ready",   aspect: "16:9") ],
    [ .init(id: 0, name: "Hero spot",        variant: 1, version: 1, clips: 6,  dur: "0:30", status: "ready",   aspect: "16:9"),
      .init(id: 1, name: "Feature tour",     variant: 2, version: 4, clips: 9,  dur: "0:52", status: "editing", aspect: "16:9") ],
    [ .init(id: 0, name: "Ep. 14 cut",       variant: 2, version: 3, clips: 20, dur: "8:12", status: "ready",   aspect: "16:9"),
      .init(id: 1, name: "Cold open",        variant: 0, version: 1, clips: 3,  dur: "0:12", status: "generating", aspect: "9:16"),
      .init(id: 2, name: "Shorts pull",      variant: 1, version: 2, clips: 4,  dur: "0:15", status: "ready",   aspect: "1:1") ],
]

// MARK: - Faux footage

struct Shot: View {
    var variant: Int = 0
    var grainAmt: Double = 0.06
    private var stops: [Color] {
        switch variant % 3 {
        case 1:  return [Color(hex: 0x1B4A57), Color(hex: 0x0E5A66), Color(hex: 0x0A2A3A), Color(hex: 0x05121A)]
        case 2:  return [Color(hex: 0x4A362A), Color(hex: 0x2A1D18), Color(hex: 0x140E0C), Color(hex: 0x0A0707)]
        default: return [Color(hex: 0xF3C489), Color(hex: 0xE0865C), Color(hex: 0x8A3F5E), Color(hex: 0x241A33)]
        }
    }
    private var sun: Color { switch variant % 3 { case 1: return Color(hex: 0x9FF0FF); case 2: return Color(hex: 0xFFD9A8); default: return Color(hex: 0xFFF1CE) } }
    private var bokeh: Color { switch variant % 3 { case 1: return Color(hex: 0x8FE9FF); case 2: return Color(hex: 0xFFC98A); default: return Color(hex: 0xFFE0B0) } }
    var body: some View {
        GeometryReader { g in
            ZStack {
                LinearGradient(colors: stops, startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(colors: [sun.opacity(0.8), .clear], center: UnitPoint(x: 0.78, y: 0.2), startRadius: 2, endRadius: g.size.width * 0.7).blendMode(.screen)
                Circle().fill(bokeh.opacity(0.45)).frame(width: 90).blur(radius: 26).position(x: g.size.width*0.7, y: g.size.height*0.3)
                Circle().fill(bokeh.opacity(0.32)).frame(width: 54).blur(radius: 18).position(x: g.size.width*0.26, y: g.size.height*0.5)
                RadialGradient(colors: [.clear, .black.opacity(0.5)], center: .center, startRadius: g.size.width*0.3, endRadius: g.size.width*0.85)
                Grain(opacity: grainAmt)
            }
        }
    }
}

// centered snap carousel — horizontal OR vertical; hero centered, neighbors peek + fade, springs to nearest
struct SnapCarousel<Element, Content: View>: View {
    let items: [Element]
    @Binding var index: Int
    var axis: Axis = .horizontal
    var peek: CGFloat = 30
    var spacing: CGFloat = 10
    @ViewBuilder var content: (Element) -> Content
    @State private var drag: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            let horiz = axis == .horizontal
            let len = horiz ? geo.size.width : geo.size.height
            let cross = horiz ? geo.size.height : geo.size.width
            let cardLen = max(1, len - peek * 2)
            let step = cardLen + spacing
            let frac = CGFloat(index) - drag / step
            let base = (len - cardLen) / 2 - frac * step        // centers the current card
            ZStack {
                Color.clear.contentShape(Rectangle())
                if horiz {
                    HStack(spacing: spacing) { cards(cardLen, cross, frac, true) }
                        .frame(height: cross, alignment: .leading).offset(x: base)
                        .frame(width: geo.size.width, alignment: .leading)
                } else {
                    VStack(spacing: spacing) { cards(cardLen, cross, frac, false) }
                        .frame(width: cross, alignment: .top).offset(y: base)
                        .frame(height: geo.size.height, alignment: .top)
                }
            }
            .gesture(
                DragGesture(minimumDistance: 8)
                    .onChanged { v in drag = horiz ? v.translation.width : v.translation.height }
                    .onEnded { v in
                        let d = horiz ? v.predictedEndTranslation.width : v.predictedEndTranslation.height
                        let t = step * 0.2
                        var ni = index
                        if d < -t { ni = min(index + 1, items.count - 1) }
                        else if d > t { ni = max(index - 1, 0) }
                        withAnimation(.spring(response: 0.36, dampingFraction: 0.85)) { drag = 0; index = ni }
                    }
            )
        }
    }

    @ViewBuilder func cards(_ cardLen: CGFloat, _ cross: CGFloat, _ frac: CGFloat, _ horiz: Bool) -> some View {
        ForEach(items.indices, id: \.self) { i in
            let dist: CGFloat = min(abs(CGFloat(i) - frac), 1)
            content(items[i])
                .frame(width: horiz ? cardLen : cross, height: horiz ? cross : cardLen)
                .opacity(Double(1 - dist * 0.5))
                .scaleEffect(1 - dist * 0.05)
        }
    }
}

// MARK: - Root

enum Phase { case home, capture, editing }

struct RootView: View {
    @State private var phase: Phase
    @State private var project = 0
    @State private var deliverable = 0
    @State private var showChat: Bool
    @State private var extraVersion = 0

    init() {
        let s = ProcessInfo.processInfo.environment["SCREEN"]
        switch s { case "capture": _phase = State(initialValue: .capture); case "editing": _phase = State(initialValue: .editing); default: _phase = State(initialValue: .home) }
        _showChat = State(initialValue: s == "chat")
        _deliverable = State(initialValue: Int(ProcessInfo.processInfo.environment["DELI"] ?? "0") ?? 0)
    }
    var body: some View {
        ZStack {
            P.bg.ignoresSafeArea()
            switch phase {
            case .home:    Viewer(project: $project, deliverable: $deliverable, showChat: $showChat, onRecord: { phase = .capture })
            case .capture: CaptureView(onCancel: { phase = .home }, onDone: { withAnimation { phase = .editing } })
            case .editing: EditingView(version: 3 + extraVersion, onDone: { extraVersion += 1; phase = .home })
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - VIEWER

struct Viewer: View {
    @Binding var project: Int
    @Binding var deliverable: Int
    @Binding var showChat: Bool
    var onRecord: () -> Void

    @State private var showNewMenu = false
    @State private var showAssets: Bool
    @State private var chatDrag: CGFloat = 0
    @State private var fullVideo: Deliverable?
    // vertical (TikTok) by default; horizontal kept as an option (env AXIS=h, or flip this)
    @State private var feedAxis: Axis

    var dels: [Deliverable] { PROJECT_DELIVERABLES[min(project, PROJECT_DELIVERABLES.count - 1)] }
    var agentBusy: Deliverable? { dels.first { $0.status == "editing" || $0.status == "generating" } }

    init(project: Binding<Int>, deliverable: Binding<Int>, showChat: Binding<Bool>, onRecord: @escaping () -> Void) {
        _project = project; _deliverable = deliverable; _showChat = showChat; self.onRecord = onRecord
        let e = ProcessInfo.processInfo.environment
        let s = e["SCREEN"]
        _showAssets = State(initialValue: s == "assets")
        _fullVideo = State(initialValue: s == "full" ? PROJECT_DELIVERABLES[0][0] : nil)
        _feedAxis = State(initialValue: e["AXIS"] == "h" ? .horizontal : .vertical)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                P.bg.ignoresSafeArea()

                VStack(spacing: 10) {
                    projectCarousel
                    deliverableCarousel
                    bottomBar
                }
                .padding(.top, 6).padding(.bottom, 12)
                .onChange(of: project) { _, _ in withAnimation(.spring(response: 0.36, dampingFraction: 0.85)) { deliverable = 0 } }

                if showNewMenu { newMenu }
                if showAssets { AssetsSheet(onClose: { withAnimation { showAssets = false } }) }

                // full-page chat, hinged from the bottom handle
                ChatPage(onDrag: { dy in if dy > 0 { chatDrag = dy } },
                         onDragEnd: { dy in if dy > 110 { close() } else { withAnimation(.easeOut(duration: 0.2)) { chatDrag = 0 } } },
                         onClose: close)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .offset(y: showChat ? chatDrag : geo.size.height + 140)
                    .animation(.easeOut(duration: 0.3), value: showChat)

                if let fv = fullVideo {
                    FullVideoView(d: fv, onClose: { withAnimation(.easeOut(duration: 0.25)) { fullVideo = nil } }).transition(.opacity)
                }
            }
        }
        .ignoresSafeArea(.keyboard)
    }

    func open()  { withAnimation(.easeOut(duration: 0.3)) { showChat = true };  chatDrag = 0 }
    func close() { withAnimation(.easeOut(duration: 0.3)) { showChat = false }; chatDrag = 0 }

    // projects — centered snap carousel (hero centered, neighbors peek + fade)
    var projectCarousel: some View {
        SnapCarousel(items: PROJECTS, index: $project, peek: 46, spacing: 6) { name in
            rungButton(name)
        }
        .frame(height: 56)
    }

    // deliverables — near-full-bleed feed; vertical (TikTok) or horizontal
    var deliverableCarousel: some View {
        SnapCarousel(items: dels, index: $deliverable, axis: feedAxis,
                     peek: feedAxis == .vertical ? 22 : 46,
                     spacing: feedAxis == .vertical ? 10 : 6) { item in
            DeliverableCard(d: item, onOpen: { withAnimation(.easeOut(duration: 0.25)) { fullVideo = item } })
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func rungButton(_ name: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "rectangle.stack.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(P.ink2)
            Text(name).font(P.sans(15, .semibold)).foregroundStyle(P.ink)
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold)).foregroundStyle(P.ink3)
        }
        .padding(.horizontal, 15).frame(height: 54)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(P.surface).overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.line, lineWidth: 1)))
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.easeOut(duration: 0.2)) { showAssets = true } }
    }

// bottom hinge: six dots + what the agent is doing → swipe up to chat
    // bottom row: Agent (press → chat) + New (press → context menu)
    var bottomBar: some View {
        HStack(spacing: 10) {
            agentButton
            newButton
        }
        .padding(.horizontal, 16)
    }

    var agentButton: some View {
        HStack(spacing: 11) {
            agentSymbol.frame(width: 15, height: 15)
            Text("Agent").font(P.sans(14, .semibold)).foregroundStyle(P.ink)
            Spacer()
        }
        .padding(.horizontal, 16).frame(height: 52).frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(P.surface)
            .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(P.line, lineWidth: 1)))
        .contentShape(Rectangle())
        .onTapGesture { open() }
    }

    var newButton: some View {
        Button { withAnimation(.easeOut(duration: 0.2)) { showNewMenu = true } } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus").font(.system(size: 14, weight: .bold))
                Text("New").font(P.sans(14, .semibold))
            }
            .foregroundStyle(P.ink)
            .padding(.horizontal, 16).frame(height: 52)
            .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(P.surface2)
                .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(P.line2, lineWidth: 1)))
        }
    }

    // context menu from New
    var newMenu: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.45).ignoresSafeArea().onTapGesture { withAnimation { showNewMenu = false } }
            VStack(spacing: 0) {
                menuRow("film.stack", "New video", "Shoot or import footage") { showNewMenu = false; onRecord() }
                Divider().overlay(P.line).padding(.leading, 56)
                menuRow("rectangle.stack.badge.plus", "New project", "Start a fresh campaign") { withAnimation { showNewMenu = false } }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(P.surface).overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(P.line2, lineWidth: 1)))
            .padding(.horizontal, 16).padding(.bottom, 78)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    // idle · processing · active
    @ViewBuilder var agentSymbol: some View {
        if agentBusy != nil {
            Spinner(color: P.warn)                                   // processing
        } else {
            Circle().stroke(P.ink3, lineWidth: 1.5)                  // idle
        }
    }

    func menuRow(_ icon: String, _ title: String, _ sub: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 13) {
                Image(systemName: icon).font(.system(size: 18)).foregroundStyle(P.ink).frame(width: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(P.sans(15, .semibold)).foregroundStyle(P.ink)
                    Text(sub).font(P.mono(10)).foregroundStyle(P.ink3)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(P.ink3)
            }.padding(.horizontal, 15).padding(.vertical, 14)
        }
    }
}

// deliverable — real footage at its FIXED aspect ratio, letterboxed; tap for full view
struct DeliverableCard: View {
    let d: Deliverable
    var onOpen: () -> Void = {}
    var body: some View {
        ZStack {
            Shot(variant: d.variant)
            LinearGradient(colors: [.black.opacity(0.3), .clear, .black.opacity(0.32)], startPoint: .top, endPoint: .bottom)
            VStack {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "film.stack").font(.system(size: 11, weight: .semibold))
                        Text(d.aspect).font(P.mono(9, .semibold))
                    }.foregroundStyle(.white).padding(.horizontal, 9).padding(.vertical, 5).background(Capsule().fill(.black.opacity(0.5)))
                    Spacer()
                    HStack(spacing: 5) {
                        Circle().fill(d.statusColor).frame(width: 6, height: 6)
                        Text(d.status).font(P.mono(9, .medium)).foregroundStyle(.white)
                    }.padding(.horizontal, 9).padding(.vertical, 5).background(Capsule().fill(.black.opacity(0.5)))
                }
                Spacer()
                Image(systemName: "play.circle.fill").font(.system(size: 44)).foregroundStyle(.white.opacity(0.92)).shadow(color: .black.opacity(0.4), radius: 8)
                Spacer()
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.name).font(P.sans(17, .semibold)).foregroundStyle(.white)
                        Text("v\(d.version) · \(d.dur)").font(P.mono(9)).foregroundStyle(.white.opacity(0.75))
                    }
                    .shadow(color: .black.opacity(0.6), radius: 6)
                    Spacer()
                    Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 30, height: 30).background(Circle().fill(.black.opacity(0.5)))
                }
            }.padding(12)
        }
        .aspectRatio(d.ratio, contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.12), lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture { onOpen() }
    }
}

// full-size view mode — the video fills the screen at its aspect; swipe down to close
struct FullVideoView: View {
    let d: Deliverable
    var onClose: () -> Void
    @State private var drag: CGFloat = 0
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Shot(variant: d.variant)
                .aspectRatio(d.ratio, contentMode: .fit)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            VStack {
                HStack {
                    Button(action: onClose) { Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.black.opacity(0.5))) }
                    Spacer()
                    VStack(spacing: 2) {
                        Text(d.name).font(P.sans(14, .semibold)).foregroundStyle(.white)
                        Text("\(d.aspect) · v\(d.version)").font(P.mono(9)).foregroundStyle(.white.opacity(0.7))
                    }
                    Spacer()
                    Image(systemName: "square.and.arrow.up").font(.system(size: 16)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.black.opacity(0.5)))
                }.padding(.horizontal, 16).padding(.top, 6)
                Spacer()
                HStack(spacing: 10) {
                    Image(systemName: "play.fill").font(.system(size: 15)).foregroundStyle(.white)
                    GeometryReader { g in ZStack(alignment: .leading) { Capsule().fill(.white.opacity(0.25)); Capsule().fill(.white).frame(width: g.size.width * 0.35) } }.frame(height: 4)
                    Text(d.dur).font(P.mono(10)).foregroundStyle(.white.opacity(0.85))
                }.padding(.horizontal, 20).padding(.bottom, 26)
            }
        }
        .offset(y: drag)
        .gesture(DragGesture()
            .onChanged { v in if v.translation.height > 0 { drag = v.translation.height } }
            .onEnded { v in if v.translation.height > 110 { onClose() } else { withAnimation { drag = 0 } } })
    }
}

// MARK: - CHAT (full page, hinged by the six-dot handle at top)

struct ChatPage: View {
    var onDrag: (CGFloat) -> Void
    var onDragEnd: (CGFloat) -> Void
    var onClose: () -> Void
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                BumpDots()
                Text("Summer campaign · chat").font(P.mono(10, .medium)).foregroundStyle(P.ink3)
            }
            .frame(maxWidth: .infinity).padding(.top, 16).padding(.bottom, 12)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in onDrag(v.translation.height) }
                .onEnded { v in onDragEnd(v.translation.height) })

            Rectangle().fill(P.line).frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    agent("Three deliverables here. **City at night** is on v2 and still cutting — I tightened the open like you asked. Want to see it, or move to something else?")
                    you("make the whole campaign feel more energetic, faster cuts")
                    agent("On it — dropping average shot length ~30% across all three and pushing the music. Re-cutting **Golden hour reel** first.")
                    you("and add captions to City at night")
                    agent("Added — big centered captions, auto-timed. **City at night v3** in ~40s.")
                }.padding(16)
            }

            HStack(spacing: 8) {
                Image(systemName: "mic.fill").font(.system(size: 15)).foregroundStyle(P.ink)
                    .frame(width: 40, height: 40).background(Circle().stroke(P.line2, lineWidth: 1))
                TextField("Message about this project…", text: $draft, axis: .vertical)
                    .font(P.sans(14)).foregroundStyle(P.ink).lineLimit(1...4).tint(P.indigo).padding(.leading, 4)
                Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.black)
                    .frame(width: 36, height: 36).background(Circle().fill(draft.isEmpty ? P.ink3 : P.ink))
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(P.surface.overlay(Rectangle().fill(P.line).frame(height: 1), alignment: .top))
        }
        .background(P.bg.ignoresSafeArea())
    }

    func you(_ t: String) -> some View {
        HStack { Spacer(minLength: 44)
            Text(t).font(P.sans(13)).foregroundStyle(.white).padding(.horizontal, 12).padding(.vertical, 9)
                .background(RoundedCorner(radius: 15, corners: [.topLeft, .topRight, .bottomLeft]).fill(LinearGradient(colors: [P.userTop, P.userBot], startPoint: .topLeading, endPoint: .bottomTrailing)))
        }
    }
    func agent(_ t: String) -> some View {
        HStack {
            Text(.init(t)).font(P.sans(13)).foregroundStyle(P.ink).padding(.horizontal, 12).padding(.vertical, 9)
                .background(RoundedCorner(radius: 15, corners: [.topLeft, .topRight, .bottomRight]).fill(P.surface))
                .frame(maxWidth: 290, alignment: .leading)
            Spacer(minLength: 44)
        }
    }
}

// MARK: - Assets (view from the rung)

struct AssetsSheet: View {
    var onClose: () -> Void
    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 0) {
                SixDots().padding(.top, 12).padding(.bottom, 4)
                    .contentShape(Rectangle()).onTapGesture(perform: onClose)
                HStack { Text("Assets").font(P.sans(17, .semibold)).foregroundStyle(P.ink); Spacer()
                    Text("15 items").font(P.mono(10)).foregroundStyle(P.ink3) }.padding(.horizontal, 16).padding(.vertical, 12)
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                        ForEach(0..<12, id: \.self) { i in
                            Shot(variant: i % 3, grainAmt: 0.05)
                                .frame(height: 128).clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(P.line, lineWidth: 1))
                                .overlay(alignment: .bottomLeading) {
                                    Text(i % 4 == 0 ? "0:0\(i)" : "still").font(P.mono(8)).foregroundStyle(.white)
                                        .padding(4).padding(.horizontal, 2).background(Capsule().fill(.black.opacity(0.5))).padding(6)
                                }
                        }
                    }.padding(16)
                }
            }
            .frame(height: 560)
            .background(RoundedCorner(radius: 22, corners: [.topLeft, .topRight]).fill(P.bg).overlay(RoundedCorner(radius: 22, corners: [.topLeft, .topRight]).stroke(P.line2, lineWidth: 1)))
        }.ignoresSafeArea(edges: .bottom)
    }
}

// MARK: - CAPTURE (record)

struct Clip: Identifiable, Hashable { let id: Int; let variant: Int }

struct CaptureView: View {
    var onCancel: () -> Void
    var onDone: () -> Void
    @State private var clips: [Clip] = [Clip(id: 0, variant: 0), Clip(id: 1, variant: 1), Clip(id: 2, variant: 2)]
    var body: some View {
        ZStack {
            Shot(variant: 0, grainAmt: 0.1).ignoresSafeArea()
            Color.black.opacity(0.14).ignoresSafeArea()
            VStack {
                HStack {
                    Button(action: onCancel) { Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.black.opacity(0.4))) }
                    Spacer()
                    Text("Record · Summer campaign").font(P.mono(11, .medium)).foregroundStyle(.white).padding(.horizontal, 10).padding(.vertical, 6).background(Capsule().fill(.black.opacity(0.4)))
                    Spacer()
                    Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 16)).foregroundStyle(.white).frame(width: 40, height: 40).background(Circle().fill(.black.opacity(0.4)))
                }.padding(.horizontal, 16).padding(.top, 6)
                Spacer()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(clips) { c in Shot(variant: c.variant, grainAmt: 0.05).frame(width: 52, height: 90).clipShape(RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(.white.opacity(0.25), lineWidth: 1)) }
                        Text("\(clips.count) clips").font(P.mono(10)).foregroundStyle(.white.opacity(0.8)).padding(.leading, 4)
                    }.padding(.horizontal, 16)
                }.padding(.bottom, 14)
                HStack {
                    Image(systemName: "photo.on.rectangle.angled").font(.system(size: 20)).foregroundStyle(.white).frame(width: 52, height: 52).background(Circle().fill(.black.opacity(0.4)))
                    Spacer()
                    Button { clips.append(Clip(id: clips.count, variant: clips.count % 3)) } label: {
                        ZStack { Circle().stroke(.white.opacity(0.6), lineWidth: 4).frame(width: 78, height: 78); Circle().fill(Color(hex: 0xE5162B)).frame(width: 62, height: 62).shadow(color: Color(hex: 0xE5162B).opacity(0.6), radius: 14) }
                    }
                    Spacer()
                    Button(action: onDone) { VStack(spacing: 3) { Image(systemName: "wand.and.stars").font(.system(size: 18)).foregroundStyle(.white); Text("EDIT").font(P.mono(8, .semibold)).foregroundStyle(.white) }.frame(width: 52, height: 52).background(Circle().fill(.black.opacity(0.4))) }
                }.padding(.horizontal, 20).padding(.bottom, 20)
            }
        }
    }
}

// MARK: - EDITING (agent assembling)

struct EditingView: View {
    let version: Int
    var onDone: () -> Void
    @State private var progress: CGFloat = 0.08
    @State private var step = 0
    let steps = ["reading clips", "finding the beats", "cutting to the hook", "auto-captioning", "grade + music"]
    var body: some View {
        ZStack {
            Shot(variant: 0, grainAmt: 0.05).ignoresSafeArea().opacity(0.5)
            Color.black.opacity(0.45).ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer()
                ZStack {
                    ForEach(0..<8, id: \.self) { i in
                        Shot(variant: i % 3, grainAmt: 0.05).frame(width: 58, height: 100).clipShape(RoundedRectangle(cornerRadius: 9))
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(.white.opacity(0.2), lineWidth: 1))
                            .rotationEffect(.degrees(Double(i - 4) * 7)).offset(x: CGFloat(i - 4) * 26)
                    }
                }.frame(height: 120)
                VStack(spacing: 10) {
                    Text("Assembling your edit").font(P.sans(18, .semibold)).foregroundStyle(.white)
                    Text("v\(version) · \(steps[step])").font(P.mono(11)).foregroundStyle(.white.opacity(0.7))
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.14)).frame(height: 5)
                        Capsule().fill(LinearGradient(colors: [P.vViolet, P.vBlue], startPoint: .leading, endPoint: .trailing)).frame(width: 220 * progress, height: 5)
                    }.frame(width: 220)
                }
                Spacer()
            }
        }
        .task {
            for s in 0..<steps.count { step = s; try? await Task.sleep(nanoseconds: 700_000_000); withAnimation(.easeInOut(duration: 0.6)) { progress = CGFloat(s + 1) / CGFloat(steps.count) } }
            try? await Task.sleep(nanoseconds: 500_000_000); onDone()
        }
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = 12
    var corners: UIRectCorner = .allCorners
    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(roundedRect: rect, byRoundingCorners: corners, cornerRadii: CGSize(width: radius, height: radius)).cgPath)
    }
}

@main
struct ReactableApp: App {
    var body: some Scene { WindowGroup { RootView() } }
}
