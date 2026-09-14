import Foundation

struct LayoverInfo: Equatable {
    let arrCode: String
    let arrTime: Date
}

enum LayoverDetector {
    /// Primary layover detection from OpenAirLog flight data (not the
    /// PDF): the most recent completed arrival that hasn't been followed
    /// by a later departure means we're still there. Landing back at home
    /// base is being home, not a layover - explicitly excluded, otherwise
    /// the most recent arrival being EDDF (e.g. right before a vacation or
    /// Ortstag) would produce a nonsensical "layover" card for home.
    static func findApiLayover(_ allFlights: [Flight], now: Date = Date(), homeBase: String = Constants.homeBase) -> LayoverInfo? {
        var current: Flight?
        var currentArr: Date?

        for f in allFlights {
            guard let arr = f.arrActualDate ?? f.arrSchedDate, arr <= now else { continue }
            if current == nil || arr > currentArr! {
                current = f
                currentArr = arr
            }
        }
        guard let current = current, let currentArr = currentArr else { return nil }
        if current.arrCode == homeBase { return nil }

        let alreadyDeparted = allFlights.contains { f in
            guard let dep = f.depActualDate ?? f.depSchedDate else { return false }
            return dep > currentArr && dep <= now
        }
        return alreadyDeparted ? nil : LayoverInfo(arrCode: current.arrCode, arrTime: currentArr)
    }
}
