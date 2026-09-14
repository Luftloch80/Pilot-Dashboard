import SwiftUI

struct FlightCardView: View {
    @ObservedObject var viewModel: DashboardViewModel
    let flight: Flight

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                AirlineBadgeView(flightNumber: flight.flightNumber)
                Text(flight.flightNumber)
                    .font(.title3.bold())
                if flight.isDeadhead {
                    Text("Deadhead")
                        .font(.caption2.bold())
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.warnBg)
                        .foregroundStyle(Theme.warn)
                        .clipShape(Capsule())
                }
                Spacer()
                if viewModel.flights.count > 1 {
                    flightNav
                }
            }

            HStack(alignment: .top) {
                routeColumn(code: flight.depCode, sched: flight.depSchedDate, actual: flight.depActualDate, label: "Abflug")
                Image(systemName: "airplane")
                    .foregroundStyle(Theme.textMuted)
                    .padding(.top, 4)
                Spacer()
                routeColumn(code: flight.arrCode, sched: flight.arrSchedDate, actual: flight.arrActualDate, label: "Ankunft", trailing: true)
            }

            Divider().overlay(Theme.border)

            HStack {
                Label(flight.aircraft, systemImage: "airplane.circle")
                Spacer()
                Text(flight.registration)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Theme.textMuted)
            }
            .font(.footnote)
            .foregroundStyle(Theme.textMuted)
        }
        .cardStyle()
    }

    private var flightNav: some View {
        HStack(spacing: 4) {
            Button { viewModel.selectPrevious() } label: {
                Image(systemName: "chevron.left")
            }.disabled(viewModel.selectedIndex == 0)
            Text("\(viewModel.selectedIndex + 1)/\(viewModel.flights.count)")
                .font(.caption)
                .foregroundStyle(Theme.textMuted)
            Button { viewModel.selectNext() } label: {
                Image(systemName: "chevron.right")
            }.disabled(viewModel.selectedIndex == viewModel.flights.count - 1)
        }
    }

    private func routeColumn(code: String, sched: Date?, actual: Date?, label: String, trailing: Bool = false) -> some View {
        VStack(alignment: trailing ? .trailing : .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(Theme.textMuted)
            Text(code).font(.system(.title2, design: .rounded).bold())
            if let city = Lookups.cityForIcao(code) {
                Text(city).font(.caption).foregroundStyle(Theme.textMuted)
            }
            Text(FlightParsing.fmtTime(sched))
                .font(.system(.subheadline, design: .monospaced))
            if let actual, actual != sched {
                Text(FlightParsing.fmtTime(actual))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Theme.accent)
            }
        }
    }
}
