import Foundation

enum OpenAirLogError: Error, LocalizedError {
    case unauthorized
    case invalidResponse
    case server(Int)
    case decoding
    case timeout
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "API-Schlüssel ungültig oder abgelaufen. Bitte neu eingeben."
        case .invalidResponse:
            return "Antwort von OpenAirLog konnte nicht gelesen werden (kein gültiges JSON)."
        case .server(let code):
            return "OpenAirLog antwortete mit Fehler \(code)."
        case .decoding:
            return "Antwort von OpenAirLog hatte ein unerwartetes Format."
        case .timeout:
            return "Zeitüberschreitung bei der Verbindung zu OpenAirLog. Bitte auf „Aktualisieren“ tippen."
        case .network:
            return "Verbindung zu OpenAirLog fehlgeschlagen. Prüfe deine Internetverbindung."
        }
    }
}

/// Talks to the confirmed OpenAirLog REST API. Every request explicitly
/// bypasses the URL cache (reloadIgnoringLocalCacheData) so a manual
/// refresh - and the background staleness check - are guaranteed to hit
/// the network, never a stale cached response.
final class OpenAirLogClient {
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = Constants.requestTimeout
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    /// GET /flights?from=&to=&per_page=100
    func fetchFlights(apiKey: String, from: String, to: String) async throws -> [RawFlightEntry] {
        var comps = URLComponents(string: "\(Constants.apiBase)/flights")!
        comps.queryItems = [
            URLQueryItem(name: "from", value: from),
            URLQueryItem(name: "to", value: to),
            URLQueryItem(name: "per_page", value: "100"),
        ]
        let data = try await perform(url: comps.url!, apiKey: apiKey)
        return FlightsResponseParser.parseFlights(data)
    }

    /// GET /flights/{id}/crew - only called when a flight has no embedded
    /// crew array of its own.
    func fetchCrew(apiKey: String, flightId: Int) async throws -> [RawCrewMember] {
        let url = URL(string: "\(Constants.apiBase)/flights/\(flightId)/crew")!
        let data = try await perform(url: url, apiKey: apiKey)
        return FlightsResponseParser.parseCrew(data)
    }

    private func perform(url: URL, apiKey: String) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let err as URLError where err.code == .timedOut {
            throw OpenAirLogError.timeout
        } catch {
            throw OpenAirLogError.network(error)
        }

        guard let http = response as? HTTPURLResponse else { throw OpenAirLogError.invalidResponse }
        if http.statusCode == 401 || http.statusCode == 403 { throw OpenAirLogError.unauthorized }
        guard (200...299).contains(http.statusCode) else { throw OpenAirLogError.server(http.statusCode) }
        return data
    }
}
