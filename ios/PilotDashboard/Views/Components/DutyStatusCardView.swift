import SwiftUI

/// The Urlaub / Ortstag (incl. post-landing) card: countdown to the next
/// duty, briefing time, and the upcoming rotation's route chain. Tapping
/// the route reveals a short per-city weather overview (see
/// DashboardViewModel.loadRouteWeather() and RouteWeatherRowView).
struct DutyStatusCardView: View {
    @ObservedObject var viewModel: DashboardViewModel
    let info: DutyStatusInfo
    @State private var showWeather = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // "Ortstag" itself isn't shown - the countdown/briefing/route
            // text already makes clear there's no flight today without
            // needing the label spelled out. "Urlaub" still gets a title,
            // since nothing else on the card says so otherwise.
            if info.type == .vacation {
                HStack {
                    Image(systemName: "sun.max")
                        .foregroundStyle(Theme.accent)
                    Text(info.type.title).font(.title3.bold())
                }
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

            if let endText = info.endText {
                Label(endText, systemImage: "flag.checkered")
                    .font(.title3.bold())
                    .foregroundStyle(Theme.text)
            }

            if let routeText = info.routeText, let stops = info.routeStops, !stops.isEmpty {
                Button {
                    showWeather.toggle()
                    if showWeather {
                        Task { await viewModel.loadRouteWeather() }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Label(routeText, systemImage: "arrow.triangle.swap")
                        Image(systemName: showWeather ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
                }
                .buttonStyle(.plain)

                if showWeather {
                    // Home base is skipped here too - see
                    // DashboardViewModel.loadRouteWeather().
                    VStack(spacing: 6) {
                        ForEach(stops.filter { $0.icao != Constants.homeBase }, id: \.self) { stop in
                            RouteWeatherRowView(stop: stop, state: viewModel.routeWeather[DashboardViewModel.weatherKey(for: stop)])
                        }
                    }
                    .padding(.top, 4)
                }
            }
        }
        .cardStyle()
    }
}
