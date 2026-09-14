import SwiftUI

/// One city's row in the route weather panel - see DutyStatusCardView and
/// DashboardViewModel.loadRouteWeather().
struct RouteWeatherRowView: View {
    let stop: RouteStop
    let state: RouteWeatherState?

    var body: some View {
        HStack {
            Text(cityLabel).font(.footnote.bold())
            Spacer()
            Text(infoText).font(.footnote).foregroundStyle(Theme.textMuted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Theme.bg)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var cityLabel: String {
        let city = Lookups.cityForIcao(stop.icao) ?? Lookups.threeLetterCode(stop.icao)
        let dateLabel = stop.dateKey.flatMap(DateKey.date(from:)).map { d -> String in
            let f = DateFormatter()
            f.dateFormat = "dd.MM."
            return f.string(from: d)
        } ?? "–"
        return "\(city) (\(dateLabel))"
    }

    private var infoText: String {
        switch state {
        case .none, .loading: return "…"
        case .noDate: return "Kein Datum"
        case .notFound: return "Ort nicht gefunden"
        case .unavailable: return "Kein Forecast (zu weit voraus)"
        case .ok(let icon, let tMin, let tMax):
            return "\(icon) \(Int(tMin.rounded()))–\(Int(tMax.rounded()))°C"
        }
    }
}
