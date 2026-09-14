import Foundation

enum Constants {
    static let apiBase = "https://openairlog.de/api/v1"

    /// Home base the rotation returns to - Frankfurt (ICAO EDDF, not the
    /// IATA "FRA"). Used to detect the post-landing Ortstag switch and to
    /// make sure landing back home is never mistaken for a hotel layover.
    static let homeBase = "EDDF"

    /// On a multi-leg day, only switch the shown flight to the next one
    /// starting 90 minutes before its departure - before that, stay on the
    /// most recently completed leg.
    static let nextFlightLeadSeconds: TimeInterval = 90 * 60

    /// Once today's last flight has landed back at home base, switch into
    /// the Ortstag-style duty status view this many seconds after its
    /// *scheduled* arrival.
    static let postLandingSwitchSeconds: TimeInterval = 30 * 60

    /// Briefing time = the next duty's scheduled departure minus this many
    /// seconds, shown in local time.
    static let briefingLeadSeconds: TimeInterval = 120 * 60

    static let dataStaleCheckInterval: TimeInterval = 5 * 60
    static let tickerInterval: TimeInterval = 30
    static let requestTimeout: TimeInterval = 15
}
