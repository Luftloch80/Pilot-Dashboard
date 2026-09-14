import Foundation

struct AirlineBadgeData {
    let code: String
    let info: AirlineInfo?
}

enum AirlineBadge {
    /// IATA airline designator = the leading 2 chars of the flight number
    /// (can include a digit, e.g. "4Y").
    static func badge(for flightNumber: String) -> AirlineBadgeData? {
        guard flightNumber.count >= 2 else { return nil }
        let prefix = String(flightNumber.prefix(2)).uppercased()
        guard !prefix.isEmpty else { return nil }
        return AirlineBadgeData(code: prefix, info: Lookups.airlineByPrefix[prefix])
    }
}
