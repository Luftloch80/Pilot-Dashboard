import Foundation

/// A normalized flight, built from OpenAirLog's raw /flights entry.
/// Deliberately keeps both the scheduled and actual times (where present)
/// for every leg, since most of the app's logic (countdown, layover
/// detection, post-landing switch) intentionally prefers the *scheduled*
/// time, only falling back to actual where that's more appropriate.
struct Flight: Identifiable, Equatable, Hashable {
    let id: Int
    let flightNumber: String
    let depCode: String
    let arrCode: String
    let depSchedDate: Date?
    let depActualDate: Date?
    let arrSchedDate: Date?
    let arrActualDate: Date?
    let aircraft: String
    let registration: String
    let isDeadhead: Bool
    let embeddedCrew: [CrewMember]
    let updatedAt: Date?

    static func == (lhs: Flight, rhs: Flight) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// A non-flight duty entry (flight_number == nil) that still carries a
/// duty_code - e.g. "U1" (vacation) or "ORTSTAG" (day at home). Real
/// flights never appear here; see RawFlightEntry.isRealFlightEntry.
struct DutyEntry {
    let date: String // "yyyy-MM-dd", as OpenAirLog gives it
    let dutyCode: String
}

enum DutyType: Equatable {
    case vacation
    case homeday

    var title: String {
        switch self {
        case .vacation: return "Urlaub"
        case .homeday: return "Zuhause (Ortstag)"
        }
    }
}

/// Confirmed duty_code patterns: "U" followed by a number is vacation,
/// "ORTSTAG" a scheduled day at home with no duty. Any other/unknown code
/// (e.g. the observed "--") is intentionally ignored rather than guessed.
func classifyDutyCode(_ code: String?) -> DutyType? {
    guard let raw = code?.trimmingCharacters(in: .whitespaces).uppercased(), !raw.isEmpty else { return nil }
    if raw.range(of: #"^U\d+$"#, options: .regularExpression) != nil { return .vacation }
    if raw == "ORTSTAG" { return .homeday }
    return nil
}
