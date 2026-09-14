import SwiftUI

struct LayoverCardView: View {
    @ObservedObject var viewModel: DashboardViewModel
    let layover: LayoverInfo

    @State private var currency: (code: String, rate: Double, live: Bool)?
    @State private var showCurrency = false
    @State private var showRooms = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "building.2").foregroundStyle(Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Layover").font(.caption2).foregroundStyle(Theme.textMuted)
                    Text(Lookups.cityForIcao(layover.arrCode) ?? layover.arrCode)
                        .font(.headline)
                }
                Spacer()
                Text("seit \(FlightParsing.fmtTime(layover.arrTime))")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
            }

            if let currency {
                DisclosureGroup(isExpanded: $showCurrency) {
                    CurrencyCalculatorView(currencyCode: currency.code, rate: currency.rate, isLive: currency.live)
                        .padding(.top, 8)
                } label: {
                    Text("Umrechnung (\(currency.code))").font(.subheadline)
                }
            }

            DisclosureGroup(isExpanded: $showRooms) {
                RoomNumbersView(viewModel: viewModel, arrCode: layover.arrCode)
                    .padding(.top, 8)
            } label: {
                Text("Zimmernummern").font(.subheadline)
            }
        }
        .cardStyle()
        .task(id: layover.arrCode) {
            currency = await viewModel.currencyInfo(for: layover.arrCode)
        }
    }
}
