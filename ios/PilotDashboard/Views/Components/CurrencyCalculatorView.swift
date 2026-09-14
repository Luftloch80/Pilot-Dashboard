import SwiftUI

/// Two-way amount <-> EUR converter for the layover's local currency.
/// `rate` is units of the local currency per 1 EUR (matches both the live
/// open.er-api.com response and the approxEurRates fallback table).
struct CurrencyCalculatorView: View {
    let currencyCode: String
    let rate: Double
    let isLive: Bool

    @State private var eurText = ""
    @State private var localText = ""
    private enum Field { case eur, local }
    @FocusState private var focusedField: Field?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(isLive ? "Live-Kurs" : "Näherungswert")
                    .font(.caption2)
                    .foregroundStyle(isLive ? Theme.ok : Theme.warn)
                Spacer()
            }

            HStack(spacing: 12) {
                labeledField(title: "EUR", text: $eurText, field: .eur)
                Image(systemName: "arrow.left.arrow.right").foregroundStyle(Theme.textMuted)
                labeledField(title: currencyCode, text: $localText, field: .local)
            }

            Text("1 EUR ≈ \(formatted(rate)) \(currencyCode)")
                .font(.caption2)
                .foregroundStyle(Theme.textMuted)
        }
        .onChange(of: eurText) { _, newValue in
            guard focusedField == .eur else { return }
            guard let eur = parse(newValue) else { localText = ""; return }
            localText = formatted(eur * rate)
        }
        .onChange(of: localText) { _, newValue in
            guard focusedField == .local else { return }
            guard let local = parse(newValue), rate != 0 else { eurText = ""; return }
            eurText = formatted(local / rate)
        }
    }

    private func labeledField(title: String, text: Binding<String>, field: Field) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(Theme.textMuted)
            TextField("0", text: text)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .focused($focusedField, equals: field)
        }
    }

    private func parse(_ s: String) -> Double? {
        Double(s.replacingOccurrences(of: ",", with: "."))
    }
    private func formatted(_ v: Double) -> String {
        String(format: v >= 100 ? "%.1f" : "%.2f", v)
    }
}
