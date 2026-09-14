import Foundation

/// Local (device) calendar day, not UTC - "heute" means the pilot's local
/// day, even though flight times themselves are shown in UTC.
enum DateKey {
    static func key(for date: Date) -> String {
        let comps = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
    }

    static func date(from key: String) -> Date? {
        var cal = Calendar.current
        cal.timeZone = Calendar.current.timeZone
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: key)
    }

    /// today +/- offsetDays, as an ISO "yyyy-MM-dd" string - used to build
    /// the /flights fetch window.
    static func todayISO(offsetDays: Int) -> String {
        let cal = Calendar(identifier: .gregorian)
        var comps = DateComponents()
        comps.day = offsetDays
        let date = cal.date(byAdding: comps, to: Date()) ?? Date()
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let dc = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", dc.year ?? 0, dc.month ?? 0, dc.day ?? 0)
    }
}

enum FlightParsing {
    private static let combinedFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return f
    }()

    /// Confirmed OpenAirLog schema: scheduled/actual times are standalone
    /// "HH:MM:SS" strings (UTC), no date of their own - combine with the
    /// flight's separate "date" field. If `anchor` is given and the
    /// combined time would fall before it, roll forward one day (handles
    /// an arrival past midnight on an overnight flight).
    static func combineDateAndTime(date: String?, time: String?, anchor: Date?) -> Date? {
        guard let date = date, let time = time, !time.isEmpty else { return nil }
        let timeOnly = String(time.prefix(8))
        guard let combined = combinedFormatter.date(from: "\(date) \(timeOnly)") else { return nil }
        if let anchor = anchor, combined < anchor {
            return Calendar(identifier: .gregorian).date(byAdding: .day, value: 1, to: combined)
        }
        return combined
    }

    private static let isoFormatterFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parseISODate(_ s: String?) -> Date? {
        guard let s = s else { return nil }
        return isoFormatter.date(from: s) ?? isoFormatterFractional.date(from: s)
    }

    static func normalizeFlight(_ raw: RawFlightEntry) -> Flight? {
        guard raw.isRealFlightEntry,
              let id = raw.id,
              let flightNumber = raw.flightNumber,
              let dep = raw.departure,
              let arr = raw.arrival else { return nil }

        let depSched = combineDateAndTime(date: raw.date, time: raw.scheduledOffBlock, anchor: nil)
        let depActual = combineDateAndTime(date: raw.date, time: raw.offBlock ?? raw.takeoff, anchor: nil)
        let arrSched = combineDateAndTime(date: raw.date, time: raw.scheduledOnBlock, anchor: depSched)
        let arrActual = combineDateAndTime(date: raw.date, time: raw.onBlock ?? raw.landing, anchor: depActual)

        // Deadhead: this pilot is a passenger, not operating - checked
        // across all three fields since a real example showed "DH" in
        // more than one of them for the same flight.
        let isDeadhead = [raw.crewPosition, raw.dutyCode, raw.remarks]
            .compactMap { $0 }
            .contains { $0.uppercased() == "DH" }

        let embeddedCrew = (raw.crew ?? []).map {
            CrewMember(name: displayName($0.name ?? "Unbekannt"), role: $0.role ?? "")
        }

        return Flight(
            id: id,
            flightNumber: flightNumber,
            depCode: dep,
            arrCode: arr,
            depSchedDate: depSched,
            depActualDate: depActual,
            arrSchedDate: arrSched,
            arrActualDate: arrActual,
            aircraft: raw.aircraftType ?? "–",
            registration: raw.aircraftRegistration ?? "–",
            isDeadhead: isDeadhead,
            embeddedCrew: embeddedCrew,
            updatedAt: parseISODate(raw.updatedAt)
        )
    }

    /// Duty-only entries (vacation/Ortstag/etc.) - kept separately rather
    /// than discarded, so DutyStatusService can recognize them.
    static func extractDutyEntries(_ raw: [RawFlightEntry]) -> [DutyEntry] {
        raw.compactMap { entry in
            guard !entry.isRealFlightEntry, let code = entry.dutyCode, !code.isEmpty,
                  let date = entry.date else { return nil }
            return DutyEntry(date: date, dutyCode: code)
        }
    }

    /// Scheduled time only, shown as "HH:MMZ" (Zulu) - the dashboard's
    /// default time format everywhere except the briefing-time hint.
    static func fmtTime(_ d: Date?) -> String {
        guard let d = d else { return "–" }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02dZ", c.hour ?? 0, c.minute ?? 0)
    }

    /// Local (device) time, deliberately not UTC - used only for the
    /// briefing-time hint, where what matters is the wall-clock time to be
    /// at the airport by.
    static func fmtLocalTime(_ d: Date?) -> String {
        guard let d = d else { return "–" }
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
