import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = DashboardViewModel()
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if !viewModel.isApiKeyConfigured {
                    SetupView(viewModel: viewModel)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.bg)
                } else {
                    dashboard
                }
            }
            .navigationTitle(viewModel.isApiKeyConfigured ? viewModel.brandName : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if viewModel.isApiKeyConfigured {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showSettings = true } label: {
                            Image(systemName: "gearshape")
                        }
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(viewModel: viewModel)
            }
        }
        .task {
            if viewModel.isApiKeyConfigured {
                await viewModel.loadFlights()
            }
        }
    }

    private var dashboard: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                DataStampView(viewModel: viewModel)

                if viewModel.statusIsError, !viewModel.statusMessage.isEmpty {
                    Text(viewModel.statusMessage)
                        .font(.footnote)
                        .foregroundStyle(Theme.danger)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.dangerBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                if let dutyStatus = viewModel.dutyStatus {
                    // Vacation/Ortstag (incl. post-landing) always takes
                    // priority - there's no flight or layover to show
                    // alongside it (see DutyStatusService.effectiveDutyType).
                    DutyStatusCardView(info: dutyStatus)
                } else {
                    if viewModel.showFlightCard, let flight = viewModel.currentFlight {
                        FlightCardView(viewModel: viewModel, flight: flight)
                        CrewCardView(viewModel: viewModel)
                    }
                    // Shown on its own on a pure rest day at an outstation
                    // (no flight today, still away from home base), and
                    // alongside a flight card when relevant (rare, since a
                    // flight usually means the previous layover just ended).
                    if let layover = viewModel.layover {
                        LayoverCardView(viewModel: viewModel, layover: layover)
                    }
                    if viewModel.currentFlight == nil, viewModel.layover == nil,
                       !viewModel.statusIsError, !viewModel.isLoading {
                        Text(viewModel.statusMessage.isEmpty ? "Heute nichts geplant." : viewModel.statusMessage)
                            .font(.subheadline)
                            .foregroundStyle(Theme.textMuted)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.bg)
        .refreshable { await viewModel.loadFlights() }
    }
}

#Preview {
    ContentView()
}
