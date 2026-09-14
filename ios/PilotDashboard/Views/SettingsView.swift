import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var showPdfImporter = false
    @State private var showResetConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Eigener Name") {
                    TextField("Nachname, Vorname", text: $viewModel.ownName)
                        .textInputAutocapitalization(.words)
                    Text("Wird für die Crew-Zuordnung aus dem PDF und die Begrüßung verwendet.")
                        .font(.caption2)
                        .foregroundStyle(Theme.textMuted)
                }

                Section("Umlaufcrewliste (PDF)") {
                    if let fileName = viewModel.pdfCrewFileName {
                        HStack {
                            Image(systemName: "doc.fill").foregroundStyle(Theme.accent)
                            Text(fileName).lineLimit(1)
                        }
                        if !viewModel.pdfCrewAccepted {
                            Text("Passt nicht zur aktuellen OpenAirLog-Crew - wird ignoriert.")
                                .font(.caption2).foregroundStyle(Theme.warn)
                        }
                        if let pickup = viewModel.pickupText {
                            Text("Pickup: \(pickup)").font(.caption2).foregroundStyle(Theme.textMuted)
                        }
                    }
                    Button("PDF importieren") { showPdfImporter = true }
                }

                Section("API-Schlüssel") {
                    Button("Zurücksetzen", role: .destructive) { showResetConfirm = true }
                }
            }
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
            .fileImporter(isPresented: $showPdfImporter, allowedContentTypes: [.pdf]) { result in
                if case .success(let url) = result {
                    Task { await viewModel.importPDF(from: url) }
                }
            }
            .confirmationDialog("API-Schlüssel zurücksetzen?", isPresented: $showResetConfirm, titleVisibility: .visible) {
                Button("Zurücksetzen", role: .destructive) {
                    viewModel.resetApiKey()
                    dismiss()
                }
                Button("Abbrechen", role: .cancel) {}
            }
        }
    }
}
