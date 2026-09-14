import SwiftUI

/// The refresh button's own color is the freshness signal - green while
/// the whole loaded window matches what checkForUpdate() last saw on
/// OpenAirLog, red once something newer exists there (never auto-applied,
/// see DashboardViewModel.checkForUpdate). Not tied to a specific flight,
/// so it's shown the same way on every screen, including the Ortstag/
/// Urlaub duty-status view where there's no flight selected at all.
struct DataStampView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        HStack(spacing: 6) {
            Spacer()
            Button {
                Task { await viewModel.loadFlights() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .foregroundStyle(viewModel.dataStampFresh ? Theme.ok : Theme.danger)
                    .rotationEffect(.degrees(viewModel.isLoading ? 360 : 0))
                    .animation(viewModel.isLoading ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: viewModel.isLoading)
            }
            .disabled(viewModel.isLoading)
            .accessibilityLabel(viewModel.dataStampFresh ? "Aktualisieren - aktuell" : "Aktualisieren - neue Daten verfügbar")
        }
    }
}
