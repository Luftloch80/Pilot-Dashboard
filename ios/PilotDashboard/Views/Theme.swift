import SwiftUI

/// Mirrors the web app's CSS custom-property palette (assets/style.css),
/// so the native app reads as the same dashboard rather than a redesign.
enum Theme {
    static let bg = Color(light: "#f4f6fa", dark: "#0b1220")
    static let bgElev = Color(light: "#ffffff", dark: "#131c2b")
    static let text = Color(light: "#101418", dark: "#eef2f7")
    static let textMuted = Color(light: "#5b6572", dark: "#8b97a8")
    static let border = Color(light: "#e1e5ea", dark: "#223047")
    static let accent = Color(light: "#1f6feb", dark: "#4d8dff")
    static let ok = Color(light: "#1a7f4e", dark: "#5fd399")
    static let okBg = Color(light: "#e6f6ee", dark: "#10281d")
    static let warn = Color(light: "#9a5b00", dark: "#f0b84c")
    static let warnBg = Color(light: "#fff2df", dark: "#2b2107")
    static let danger = Color(light: "#b3261e", dark: "#ff8a80")
    static let dangerBg = Color(light: "#fbe9e7", dark: "#2a1210")
    static let radius: CGFloat = 16
}

extension Color {
    init(light: String, dark: String) {
        self.init(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }
}

extension UIColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)
        let r = CGFloat((value & 0xFF0000) >> 16) / 255
        let g = CGFloat((value & 0x00FF00) >> 8) / 255
        let b = CGFloat(value & 0x0000FF) / 255
        self.init(red: r, green: g, blue: b, alpha: 1)
    }
}

/// Shared card container matching the web app's `.card` styling.
struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(Theme.bgElev)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }
}

extension View {
    func cardStyle() -> some View { modifier(CardBackground()) }
}
