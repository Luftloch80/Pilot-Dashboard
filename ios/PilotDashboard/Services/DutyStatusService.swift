import Foundation

struct DutyStatusInfo {
    let type: DutyType
    let countdownText: String
    let briefingText: String?
    let routeText: String?
}

enum DutyStatusService {

    static func todayDutyType(duties: [DutyEntry], todayKey: String) -> DutyType? {
        for d in duties where d.date == todayKey {
            if let t = classifyDutyCode(d.dutyCode) { return t }
        }
        return nil
    }

    /// First real flight strictly after today - "next duty" for both
    /// vacation and Ortstag alike, since a home day right after a
    /// vacation isn't duty either and should just extend the count (any
    /// non-flight day in between is simply skipped over here).
    static func nextDutyFlight(allFlights: [Flight], todayKey: String) -> Flight? {
        allFlights.first { f in
            guard let d = f.depSchedDate ?? f.depActualDate else { return false }
            return DateKey.key(for: d) > todayKey
        }
    }

    static func daysUntil(_ dateKey: String, todayKey: String) -> Int {
        guard let todayDate = DateKey.date(from: todayKey), let targetDate = DateKey.date(from: dateKey) else { return 0 }
        let comps = Calendar.current.dateComponents([.day], from: todayDate, to: targetDate)
        return comps.day ?? 0
    }

    /// Full route chain for the upcoming trip, e.g. "FRA-LIS-BLL-WAW-HAM-FRA"
    /// - starts at home base, one code per overnight stop (the *last*
    /// airport reached each day - a multi-sector day only contributes its
    /// final stop, not every intermediate one), ending back at home base
    /// once the rotation returns there. Converted to 3-letter codes only
    /// at the very end for display; compared internally in ICAO.
    static func upcomingRouteChain(startFlight: Flight, allFlights: [Flight], homeBase: String = Constants.homeBase) -> String? {
        guard let startIdx = allFlights.firstIndex(of: startFlight) else { return nil }

        var chain: [String] = [homeBase]
        var i = startIdx
        while i < allFlights.count {
            let cur = allFlights[i]
            let next: Flight? = (i + 1 < allFlights.count) ? allFlights[i + 1] : nil

            let curArrKey = (cur.arrSchedDate ?? cur.arrActualDate).map(DateKey.key(for:))
            let nextDepKey = next.flatMap { ($0.depSchedDate ?? $0.depActualDate).map(DateKey.key(for:)) }
            let isOvernightStop = next == nil || curArrKey != nextDepKey || cur.arrCode != next!.depCode

            if isOvernightStop {
                chain.append(cur.arrCode)
                if cur.arrCode == homeBase { break }
                if next == nil { break }
                if chain.count >= 10 { break } // sanity cap against malformed data
            }
            i += 1
        }
        return chain.map { Lookups.threeLetterCode($0) }.joined(separator: "-")
    }

    /// Once today's last flight has landed back at home base, switch into
    /// the same Ortstag-style view - 30 minutes after its *scheduled*
    /// arrival, not the actual one. Only applies while looking at the
    /// last flight of the day, so manually browsing an earlier leg isn't
    /// interrupted.
    static func shouldShowPostLandingHomeView(todayFlights: [Flight], selectedIndex: Int, now: Date = Date(), homeBase: String = Constants.homeBase) -> Bool {
        let n = todayFlights.count
        guard n > 0, selectedIndex == n - 1 else { return false }
        let last = todayFlights[n - 1]
        guard last.arrCode == homeBase, let arr = last.arrSchedDate else { return false }
        return now.timeIntervalSince(arr) >= Constants.postLandingSwitchSeconds
    }

    /// Combines the real duty_code check with the post-landing override -
    /// both end up looking like "Ortstag" since either way there's no
    /// more flying scheduled for the rest of today.
    static func effectiveDutyType(duties: [DutyEntry], todayKey: String, todayFlights: [Flight], selectedIndex: Int, now: Date = Date()) -> DutyType? {
        if let real = todayDutyType(duties: duties, todayKey: todayKey) { return real }
        return shouldShowPostLandingHomeView(todayFlights: todayFlights, selectedIndex: selectedIndex, now: now) ? .homeday : nil
    }

    /// Builds the full display info (countdown/briefing/route) for the
    /// duty status card, or nil if today isn't a recognized vacation/
    /// Ortstag/post-landing day.
    static func buildInfo(duties: [DutyEntry], allFlights: [Flight], todayFlights: [Flight], selectedIndex: Int, now: Date = Date()) -> DutyStatusInfo? {
        let todayKey = DateKey.key(for: now)
        guard let type = effectiveDutyType(duties: duties, todayKey: todayKey, todayFlights: todayFlights, selectedIndex: selectedIndex, now: now) else {
            return nil
        }

        guard let next = nextDutyFlight(allFlights: allFlights, todayKey: todayKey) else {
            return DutyStatusInfo(type: type, countdownText: "Kein weiterer Dienst in den nächsten 3 Wochen geplant.", briefingText: nil, routeText: nil)
        }

        let nextDate = next.depSchedDate ?? next.depActualDate ?? now
        let days = daysUntil(DateKey.key(for: nextDate), todayKey: todayKey)
        let dayWord = days == 1 ? "Tag" : "Tage"
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "dd.MM."
        let countdown = "Noch \(days) \(dayWord) bis zum nächsten Dienst (\(dateFormatter.string(from: nextDate)))."

        var briefing: String?
        if let depSched = next.depSchedDate {
            let briefingDate = depSched.addingTimeInterval(-Constants.briefingLeadSeconds)
            let briefingDateLabel = dateFormatter.string(from: briefingDate)
            briefing = "Briefing: \(briefingDateLabel), \(FlightParsing.fmtLocalTime(briefingDate)) (lokal)"
        }

        let route = upcomingRouteChain(startFlight: next, allFlights: allFlights).map { "Route: \($0)" }

        return DutyStatusInfo(type: type, countdownText: countdown, briefingText: briefing, routeText: route)
    }
}
