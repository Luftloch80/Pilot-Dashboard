import Foundation

/// Mirrors OpenAirLog's confirmed /flights schema exactly (verified
/// against a real API response). All fields optional/defensive since a
/// duty-only entry (no flight_number) omits most of them.
struct RawFlightEntry: Codable {
    let id: Int?
    let date: String?
    let flightNumber: String?
    let dutyCode: String?
    let departure: String?
    let arrival: String?
    let scheduledOffBlock: String?
    let scheduledOnBlock: String?
    let offBlock: String?
    let onBlock: String?
    let takeoff: String?
    let landing: String?
    let aircraftType: String?
    let aircraftRegistration: String?
    let crewPosition: String?
    let remarks: String?
    let updatedAt: String?
    let crew: [RawCrewMember]?

    enum CodingKeys: String, CodingKey {
        case id, date
        case flightNumber = "flight_number"
        case dutyCode = "duty_code"
        case departure, arrival
        case scheduledOffBlock = "scheduled_off_block"
        case scheduledOnBlock = "scheduled_on_block"
        case offBlock = "off_block"
        case onBlock = "on_block"
        case takeoff, landing
        case aircraftType = "aircraft_type"
        case aircraftRegistration = "aircraft_registration"
        case crewPosition = "crew_position"
        case remarks
        case updatedAt = "updated_at"
        case crew
    }

    /// Only entries with a non-empty flight_number are real flights - the
    /// rest are duty-only entries (vacation, Ortstag, etc.), see
    /// DutyStatusService.
    var isRealFlightEntry: Bool {
        guard let fn = flightNumber else { return false }
        return !fn.isEmpty
    }
}

struct RawCrewMember: Codable {
    let name: String?
    let role: String?
}

/// The API may return either a bare array or {"data": [...]}; try both.
enum FlightsResponseParser {
    private struct Wrapper: Codable { let data: [RawFlightEntry]? }
    private struct CrewWrapper: Codable { let data: [RawCrewMember]? }

    static func parseFlights(_ data: Data) -> [RawFlightEntry] {
        if let arr = try? JSONDecoder().decode([RawFlightEntry].self, from: data) { return arr }
        if let wrapper = try? JSONDecoder().decode(Wrapper.self, from: data) { return wrapper.data ?? [] }
        return []
    }

    static func parseCrew(_ data: Data) -> [RawCrewMember] {
        if let arr = try? JSONDecoder().decode([RawCrewMember].self, from: data) { return arr }
        if let wrapper = try? JSONDecoder().decode(CrewWrapper.self, from: data) { return wrapper.data ?? [] }
        return []
    }
}
