import SwiftUI

/// Small styled two-letter badge (never a real logo - see AirlineBadge.swift
/// for why) shown next to the flight number.
struct AirlineBadgeView: View {
    let flightNumber: String

    var body: some View {
        if let badge = AirlineBadge.badge(for: flightNumber) {
            let info = badge.info
            Text(badge.code)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(info.map { Color(uiColor: UIColor(hex: $0.bgHex)) } ?? Theme.accent)
                .foregroundStyle(info.map { Color(uiColor: UIColor(hex: $0.fgHex)) } ?? .white)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .accessibilityLabel(info?.name ?? badge.code)
        }
    }
}
