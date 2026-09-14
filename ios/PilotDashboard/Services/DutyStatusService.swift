import Foundation

/// One overnight stop of the upcoming trip - see
/// DutyStatusService.computeRouteStops. `dateKey` is OpenAirLog's own
/// operationalDate for the flight that reaches this stop, used both for
/// display and to look up that day's weather.
struct RouteStop: Equatable, Hashable, Sendable {
    let icao: String
    let dateKey: String?
}

struct DutyStatusInfo {
    let type: DutyType
    let countdownText: String
    let briefingText: String?
    let routeText: String?
    let routeStops: [RouteStop]?
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

    /// One entry per overnight stop of the upcoming trip - home base on
    /// the departure day, then each layover (the *last* airport reached
    /// each day - a multi-sector day only contributes its final stop, not
    /// every intermediate one), then home base again on the day the
    /// rotation ends. Feeds both the compact "FRA-LIS-…" route-chain
    /// string and the per-city weather popup, so the two always agree on
    /// which day belongs to which city.
    ///
    /// Same-day-vs-overnight is decided from each flight's own
    /// `operationalDate` (OpenAirLog's unambiguous "date" field), not a
    /// calendar day derived from the UTC arrival/departure times: deriving
    /// it via the device's local timezone can shift a late-UTC arrival
    /// into the next local calendar day, making it collide with the next
    /// flight's departure date even though a real overnight layover sits
    /// in between (e.g. an EDDF-LPPT arrival at 22:35Z reads as 00:35
    /// local in CEST - one local day "too late", silently dropping that
    /// stop from the chain).
    static func computeRouteStops(startFlight: Flight, allFlights: [Flight], homeBase: String = Constants.homeBase) -> [RouteStop]? {
        guard let startIdx = allFlights.firstIndex(of: startFlight) else { return nil }

        var stops: [RouteStop] = [RouteStop(icao: homeBase, dateKey: startFlight.operationalDate)]
        var i = startIdx
        while i < allFlights.count {
            let cur = allFlights[i]
            let next: Flight? = (i + 1 < allFlights.count) ? allFlights[i + 1] : nil

            let isOvernightStop = next == nil || cur.operationalDate != next!.operationalDate || cur.arrCode != next!.depCode

            if isOvernightStop {
                stops.append(RouteStop(icao: cur.arrCode, dateKey: cur.operationalDate))
                if cur.arrCode == homeBase { break }
                if next == nil { break }
                if stops.count >= 10 { break } // sanity cap against malformed data
            }
            i += 1
        }
        return stops
    }

    static func routeChainString(_ stops: [RouteStop]) -> String {
        stops.map { Lookups.threeLetterCode($0.icao) }.joined(separator: "-")
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
            return DutyStatusInfo(type: type, countdownText: "Kein weiterer Dienst in den nächsten 3 Wochen geplant.", briefingText: nil, routeText: nil, routeStops: nil)
        }

        let nextDate = next.depSchedDate ?? next.depActualDate ?? now
        let days = daysUntil(DateKey.key(for: nextDate), todayKey: todayKey)
        let dayWord = days == 1 ? "Tag" : "Tage"
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "dd.MM."
        let countdown = "Noch \(days) \(dayWord) bis zum nächsten Dienst."

        var briefing: String?
        if let depSched = next.depSchedDate {
            let briefingDate = depSched.addingTimeInterval(-Constants.briefingLeadSeconds)
            let briefingDateLabel = dateFormatter.string(from: briefingDate)
            briefing = "Briefing: \(briefingDateLabel) - \(FlightParsing.fmtLocalTime(briefingDate)) LT"
        }

        let stops = computeRouteStops(startFlight: next, allFlights: allFlights)
        let route = stops.map { "Route: \(routeChainString($0))" }

        return DutyStatusInfo(type: type, countdownText: countdown, briefingText: briefing, routeText: route, routeStops: stops)
    }
}
