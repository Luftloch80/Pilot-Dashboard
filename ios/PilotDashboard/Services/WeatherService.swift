import Foundation

/// Per-city weather for the route chain (tap "Route: …" in the duty status
/// card). Uses Open-Meteo (open-meteo.com) - free, no API key, CORS-
/// enabled for direct client use (matches this app's backend-less
/// architecture). Two calls per city: geocode the city name to
/// coordinates, then a one-day forecast for that date. Forecasts are only
/// available a limited number of days out (Open-Meteo's free tier: ~16
/// days); a stop further out than that just comes back as unavailable
/// rather than guessing.

struct WeatherResult: Sendable { let code: Int; let tMax: Double; let tMin: Double }
struct WeatherCodeInfo: Sendable { let label: String; let icon: String }

/// Mirrors CurrencyRateClient's shape (an actor owning its own in-memory
/// cache) for the same reason: async network fetch + cache, safe to call
/// concurrently for several cities at once (see DashboardViewModel.
/// loadRouteWeather(), which fetches every route stop in parallel).
actor WeatherService {

    /// WMO weather codes, as returned in Open-Meteo's `daily.weathercode`
    /// - https://open-meteo.com/en/docs - a short, stable public standard,
    /// not airline-internal data, so hardcoding it here is safe (unlike
    /// e.g. Lookups.threeLetterCode elsewhere in this project).
    private static let codeInfo: [Int: WeatherCodeInfo] = [
        0: WeatherCodeInfo(label: "Klar", icon: "☀️"),
        1: WeatherCodeInfo(label: "Meist klar", icon: "🌤️"),
        2: WeatherCodeInfo(label: "Teils bewölkt", icon: "⛅"),
        3: WeatherCodeInfo(label: "Bewölkt", icon: "☁️"),
        45: WeatherCodeInfo(label: "Nebel", icon: "🌫️"),
        48: WeatherCodeInfo(label: "Nebel (Reif)", icon: "🌫️"),
        51: WeatherCodeInfo(label: "Niesel leicht", icon: "🌦️"),
        53: WeatherCodeInfo(label: "Niesel", icon: "🌦️"),
        55: WeatherCodeInfo(label: "Niesel stark", icon: "🌦️"),
        56: WeatherCodeInfo(label: "Gefr. Niesel", icon: "🌧️"),
        57: WeatherCodeInfo(label: "Gefr. Niesel stark", icon: "🌧️"),
        61: WeatherCodeInfo(label: "Regen leicht", icon: "🌧️"),
        63: WeatherCodeInfo(label: "Regen", icon: "🌧️"),
        65: WeatherCodeInfo(label: "Regen stark", icon: "🌧️"),
        66: WeatherCodeInfo(label: "Gefr. Regen", icon: "🌧️"),
        67: WeatherCodeInfo(label: "Gefr. Regen stark", icon: "🌧️"),
        71: WeatherCodeInfo(label: "Schnee leicht", icon: "🌨️"),
        73: WeatherCodeInfo(label: "Schnee", icon: "🌨️"),
        75: WeatherCodeInfo(label: "Schnee stark", icon: "❄️"),
        77: WeatherCodeInfo(label: "Schneegriesel", icon: "❄️"),
        80: WeatherCodeInfo(label: "Schauer leicht", icon: "🌦️"),
        81: WeatherCodeInfo(label: "Schauer", icon: "🌦️"),
        82: WeatherCodeInfo(label: "Schauer stark", icon: "⛈️"),
        85: WeatherCodeInfo(label: "Schneeschauer", icon: "🌨️"),
        86: WeatherCodeInfo(label: "Schneeschauer stark", icon: "🌨️"),
        95: WeatherCodeInfo(label: "Gewitter", icon: "⛈️"),
        96: WeatherCodeInfo(label: "Gewitter mit Hagel", icon: "⛈️"),
        99: WeatherCodeInfo(label: "Gewitter mit Hagel", icon: "⛈️"),
    ]

    static func infoForCode(_ code: Int) -> WeatherCodeInfo {
        codeInfo[code] ?? WeatherCodeInfo(label: "Unbekannt", icon: "🌡️")
    }

    /// City labels from Lookups.icaoCity sometimes carry a disambiguating
    /// airport name in parentheses (e.g. "Rom (Fiumicino)") - strip that
    /// for the geocoding query, the plain city name resolves better.
    private static func geocodeQuery(for cityLabel: String) -> String {
        if let range = cityLabel.range(of: #"\s*\([^)]*\)\s*$"#, options: .regularExpression) {
            return String(cityLabel[cityLabel.startIndex..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
        }
        return cityLabel.trimmingCharacters(in: .whitespaces)
    }

    private struct GeocodeResponse: Codable { let results: [GeocodeResult]? }
    private struct GeocodeResult: Codable { let latitude: Double; let longitude: Double }

    /// query -> coordinates, or an explicit .some(nil) for "looked up,
    /// not found/failed" so a repeat tap doesn't refetch a known miss.
    private var geocodeCache: [String: (lat: Double, lon: Double)?] = [:]

    func geocodeCity(_ cityLabel: String) async -> (lat: Double, lon: Double)? {
        let query = geocodeQuery(for: cityLabel)
        if let cached = geocodeCache[query] { return cached }

        guard let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://geocoding-api.open-meteo.com/v1/search?name=\(encoded)&count=1&language=de&format=json")
        else { return nil }

        var coords: (lat: Double, lon: Double)?
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                let decoded = try JSONDecoder().decode(GeocodeResponse.self, from: data)
                if let hit = decoded.results?.first {
                    coords = (hit.latitude, hit.longitude)
                }
            }
        } catch {
            // leave coords nil - shown as "not found" to the pilot, not guessed
        }
        geocodeCache[query] = coords
        return coords
    }

    private struct ForecastResponse: Codable { let daily: DailyWeather? }
    private struct DailyWeather: Codable {
        let time: [String]
        let weathercode: [Int]
        let temperatureMax: [Double]
        let temperatureMin: [Double]

        enum CodingKeys: String, CodingKey {
            case time, weathercode
            case temperatureMax = "temperature_2m_max"
            case temperatureMin = "temperature_2m_min"
        }
    }

    func fetchDailyWeather(lat: Double, lon: Double, dateKey: String) async -> WeatherResult? {
        guard let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)"
            + "&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto"
            + "&start_date=\(dateKey)&end_date=\(dateKey)")
        else { return nil }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let decoded = try JSONDecoder().decode(ForecastResponse.self, from: data)
            guard let daily = decoded.daily, !daily.time.isEmpty,
                  let code = daily.weathercode.first,
                  let tMax = daily.temperatureMax.first,
                  let tMin = daily.temperatureMin.first
            else { return nil }
            return WeatherResult(code: code, tMax: tMax, tMin: tMin)
        } catch {
            return nil
        }
    }
}

/// Display state for one route stop's weather row - see
/// DashboardViewModel.loadRouteWeather().
enum RouteWeatherState: Equatable, Sendable {
    case loading
    case noDate
    case notFound
    case unavailable
    case ok(icon: String, tMin: Double, tMax: Double)
}
