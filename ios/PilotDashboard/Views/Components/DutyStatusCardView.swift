import SwiftUI

/// The Urlaub / Ortstag (incl. post-landing) card: countdown to the next
/// duty, briefing time, and the upcoming rotation's route chain.
struct DutyStatusCardView: View {
    let info: DutyStatusInfo

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: info.type == .vacation ? "sun.max" : "house")
                    .foregroundStyle(Theme.accent)
                Text(info.type.title).font(.title3.bold())
            }

            Text(info.countdownText)
                .font(.subheadline)
                .foregroundStyle(Theme.text)

            if let briefingText = info.briefingText {
                Label(briefingText, systemImage: "clock")
                    .font(.title3.bold())
                    .foregroundStyle(Theme.text)
                    .padding(.top, 2)
            }

            if let routeText = info.routeText {
                Label(routeText, systemImage: "arrow.triangle.swap")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            }
        }
        .cardStyle()
    }
}
