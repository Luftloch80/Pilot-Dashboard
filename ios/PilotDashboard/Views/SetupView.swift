import SwiftUI

/// Shown until an OpenAirLog API key is stored in the Keychain.
struct SetupView: View {
    @ObservedObject var viewModel: DashboardViewModel
    @State private var apiKey = ""

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "airplane.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(Theme.accent)
            Text("Pilot Dashboard")
                .font(.title2.bold())
            Text("Gib deinen OpenAirLog API-Schlüssel ein. Er wird sicher in der Keychain gespeichert.")
                .font(.footnote)
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)

            SecureField("API-Schlüssel", text: $apiKey)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)

            if let error = viewModel.setupError {
                Text(error).font(.caption).foregroundStyle(Theme.danger)
            }

            Button {
                viewModel.saveApiKey(apiKey)
            } label: {
                Text("Speichern").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(24)
        .frame(maxWidth: 420)
    }
}
