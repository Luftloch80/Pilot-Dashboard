import SwiftUI

struct CrewCardView: View {
    @ObservedObject var viewModel: DashboardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Crew").font(.headline)
                Spacer()
                if viewModel.hasPdfCrew {
                    Button {
                        viewModel.switchCrewSource()
                    } label: {
                        Text(viewModel.crewSource == .pdf ? "Quelle: PDF" : "Quelle: OpenAirLog")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                }
            }

            switch viewModel.crewDisplayState {
            case .loading:
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            case .forbidden:
                Text("Keine Berechtigung, die Crew-Liste abzurufen.")
                    .font(.footnote).foregroundStyle(Theme.warn)
            case .error(let message):
                Text(message).font(.footnote).foregroundStyle(Theme.danger)
            case .empty:
                Text("Keine Crew-Daten für diesen Flug.")
                    .font(.footnote).foregroundStyle(Theme.textMuted)
            case .ok:
                VStack(spacing: 0) {
                    ForEach(Array(viewModel.currentCrew.enumerated()), id: \.element.id) { idx, member in
                        if idx > 0 { Divider().overlay(Theme.border) }
                        HStack {
                            Text(member.role)
                                .font(.caption.bold())
                                .foregroundStyle(Theme.accent)
                                .frame(width: 36, alignment: .leading)
                            Text(member.name).font(.subheadline)
                            Spacer()
                        }
                        .padding(.vertical, 6)
                    }
                }
            }

            if !viewModel.pdfCrewAccepted {
                Text("Die zuletzt importierte PDF-Crewliste passt nicht zur aktuellen OpenAirLog-Crew und wird ignoriert.")
                    .font(.caption2)
                    .foregroundStyle(Theme.warn)
            }
        }
        .cardStyle()
    }
}
