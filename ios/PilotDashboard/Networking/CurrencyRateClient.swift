import Foundation

/// Live EUR exchange rates from the free, keyless open.er-api.com, cached
/// in memory for 6 hours; falls back to Lookups.approxEurRates if the live
/// lookup fails for any reason. Mirrors the web app's getEurRates().
actor CurrencyRateClient {
    private var cachedRates: [String: Double]?
    private var cachedAt: Date?
    private let cacheDuration: TimeInterval = 6 * 3600

    /// Returns (rates, live) - `live` is false whenever the static
    /// fallback table was used instead of a real network response.
    func rates() async -> (rates: [String: Double], live: Bool) {
        if let cached = cachedRates, let cachedAt = cachedAt,
           Date().timeIntervalSince(cachedAt) < cacheDuration {
            return (cached, true)
        }

        guard let url = URL(string: "https://open.er-api.com/v6/latest/EUR") else {
            return (Lookups.approxEurRates, false)
        }

        do {
            var request = URLRequest(url: url)
            request.timeoutInterval = Constants.requestTimeout
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return (Lookups.approxEurRates, false)
            }
            struct RatesResponse: Codable { let rates: [String: Double] }
            let decoded = try JSONDecoder().decode(RatesResponse.self, from: data)
            cachedRates = decoded.rates
            cachedAt = Date()
            return (decoded.rates, true)
        } catch {
            return (Lookups.approxEurRates, false)
        }
    }
}
