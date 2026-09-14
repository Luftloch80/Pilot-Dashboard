import Foundation

enum FlightSelection {
    /// Which of today's flights should be shown right now:
    /// - the one currently in progress, if any
    /// - else, on a multi-leg day, the most recently completed leg until
    ///   90 minutes before the next one's departure (then switches ahead)
    /// - else the last flight of the day (all done)
    static func pickInitialIndex(_ flights: [Flight], now: Date = Date()) -> Int? {
        guard !flights.isEmpty else { return nil }

        for (i, f) in flights.enumerated() {
            if let dep = f.depActualDate ?? f.depSchedDate,
               let arr = f.arrActualDate ?? f.arrSchedDate,
               dep <= now, now <= arr {
                return i
            }
        }

        var nextIndex: Int?
        for (i, f) in flights.enumerated() {
            if let dep = f.depActualDate ?? f.depSchedDate, dep > now {
                nextIndex = i
                break
            }
        }
        if let nextIndex = nextIndex {
            let dep = flights[nextIndex].depActualDate ?? flights[nextIndex].depSchedDate ?? now
            if dep.timeIntervalSince(now) <= Constants.nextFlightLeadSeconds || nextIndex == 0 {
                return nextIndex
            }
            return nextIndex - 1
        }

        return flights.count - 1
    }
}
