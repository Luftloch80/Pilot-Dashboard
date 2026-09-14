import SwiftUI

/// The "Stand: HH:MMZ" freshness indicator - green while the currently
/// viewed flight's data matches what checkForUpdate() last saw on
/// OpenAirLog, red once a newer update exists there (never auto-applied,
/// see DashboardViewModel.checkForUpdate).
struct DataStampView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        HStack(spacing: 6) {
            if let flight = viewModel.currentFlight, let updatedAt = flight.updatedAt {
                Circle()
                    .fill(viewModel.dataStampFresh ? Theme.ok : Theme.danger)
                    .frame(width: 7, height: 7)
                Text("Stand: \(FlightParsing.fmtTime(updatedAt))")
                    .font(.caption)
                    .foregroundStyle(viewModel.dataStampFresh ? Theme.ok : Theme.danger)
                    .fontWeight(viewModel.dataStampFresh ? .regular : .semibold)
            }
            Spacer()
            Button {
                Task { await viewModel.loadFlights() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .rotationEffect(.degrees(viewModel.isLoading ? 360 : 0))
                    .animation(viewModel.isLoading ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: viewModel.isLoading)
            }
            .disabled(viewModel.isLoading)
            .accessibilityLabel("Aktualisieren")
        }
    }
}
