import Foundation

struct AirlineInfo {
    let name: String
    let bgHex: String
    let fgHex: String
}

enum Lookups {

    // MARK: - Airline badge

    /// IATA airline designator (leading 2 chars of the flight number) ->
    /// styling for the badge on the flight card. Deliberately a styled
    /// badge, not a real logo image (avoids bundling trademarked logo
    /// assets). Covers Lufthansa Group carriers realistically seen on a
    /// deadhead out of Frankfurt; unrecognized prefixes fall back to the
    /// app's own accent color with the raw code.
    static let airlineByPrefix: [String: AirlineInfo] = [
        "LH": AirlineInfo(name: "Lufthansa", bgHex: "#05164d", fgHex: "#f9ba00"),
        "LX": AirlineInfo(name: "Swiss", bgHex: "#dc0018", fgHex: "#ffffff"),
        "OS": AirlineInfo(name: "Austrian Airlines", bgHex: "#c00d0d", fgHex: "#ffffff"),
        "SN": AirlineInfo(name: "Brussels Airlines", bgHex: "#00286e", fgHex: "#ffffff"),
        "EW": AirlineInfo(name: "Eurowings", bgHex: "#4b0a63", fgHex: "#ffffff"),
        "4Y": AirlineInfo(name: "Eurowings Discover", bgHex: "#f5a623", fgHex: "#1c1c1c"),
    ]

    // MARK: - 3-letter station codes for the route chain

    /// Deliberately only populated with codes the pilot has actually
    /// confirmed - these are airline-internal station codes, not always
    /// the real public IATA code (e.g. LUKK -> "RMO", not the real IATA
    /// "KIV" for Chisinau), so they can't be reliably derived the way
    /// icaoCity/currencyByIcao below can. An unconfirmed code falls back
    /// to the raw ICAO code.
    private static let threeLetterCodeMap: [String: String] = [
        "EDDF": "FRA",
        "LUKK": "RMO",
        "LPPT": "LIS",
        "EKBI": "BLL",
        "EPWA": "WAW",
        "EDDH": "HAM",
    ]

    static func threeLetterCode(_ icao: String) -> String {
        threeLetterCodeMap[icao] ?? icao
    }

    // MARK: - City names

    /// Not exhaustive - covers major European and international airports;
    /// anything missing just shows the bare ICAO code, still correct, just
    /// less friendly.
    static let icaoCity: [String: String] = [
        // Germany
        "EDDF": "Frankfurt", "EDDM": "München", "EDDB": "Berlin", "EDDH": "Hamburg",
        "EDDL": "Düsseldorf", "EDDK": "Köln/Bonn", "EDDS": "Stuttgart", "EDDN": "Nürnberg",
        "EDDW": "Bremen", "EDDP": "Leipzig/Halle", "EDDR": "Saarbrücken", "EDDV": "Hannover",
        "EDDC": "Dresden", "EDDG": "Münster/Osnabrück",
        // Austria / Switzerland
        "LOWW": "Wien", "LOWS": "Salzburg", "LOWI": "Innsbruck", "LOWG": "Graz", "LOWL": "Linz",
        "LSZH": "Zürich", "LSGG": "Genf", "LSZB": "Bern", "LFSB": "Basel/Mulhouse",
        // UK / Ireland
        "EGLL": "London (Heathrow)", "EGKK": "London (Gatwick)", "EGSS": "London (Stansted)",
        "EGCC": "Manchester", "EGPH": "Edinburgh", "EIDW": "Dublin",
        // France / Benelux
        "LFPG": "Paris (CDG)", "LFPO": "Paris (Orly)", "EHAM": "Amsterdam",
        "EBBR": "Brüssel", "ELLX": "Luxemburg",
        // Italy / Iberia
        "LIRF": "Rom (Fiumicino)", "LIML": "Mailand (Linate)", "LIMC": "Mailand (Malpensa)",
        "LEMD": "Madrid", "LEBL": "Barcelona", "LEMG": "Málaga", "LEBB": "Bilbao",
        "LPPT": "Lissabon", "LPPR": "Porto",
        // Scandinavia
        "ESSA": "Stockholm", "ENGM": "Oslo", "EKCH": "Kopenhagen", "EKBI": "Billund",
        "EFHK": "Helsinki",
        // Central / Eastern Europe
        "EPWA": "Warschau", "EPKK": "Krakau", "EPPO": "Posen", "EPWR": "Breslau", "EPGD": "Danzig",
        "LKPR": "Prag", "LHBP": "Budapest", "LROP": "Bukarest", "LBSF": "Sofia", "LYBE": "Belgrad",
        "LUKK": "Chișinău",
        // Turkey / Middle East / Africa
        "LTFM": "Istanbul", "LTAI": "Antalya",
        "OMDB": "Dubai", "OTHH": "Doha", "OERK": "Riad", "OEJN": "Dschidda",
        "HECA": "Kairo", "FAOR": "Johannesburg", "HKJK": "Nairobi",
        // Americas
        "KJFK": "New York (JFK)", "KEWR": "Newark", "KLAX": "Los Angeles", "KORD": "Chicago",
        "KMIA": "Miami", "KIAD": "Washington", "KBOS": "Boston", "KSFO": "San Francisco",
        "KATL": "Atlanta", "CYYZ": "Toronto", "CYUL": "Montreal", "SBGR": "São Paulo",
        // Asia / Pacific
        "RJAA": "Tokio (Narita)", "RJTT": "Tokio (Haneda)", "ZBAA": "Peking",
        "VHHH": "Hongkong", "WSSS": "Singapur", "VABB": "Mumbai", "VIDP": "Delhi",
        "RKSI": "Seoul", "YSSY": "Sydney",
    ]

    static func cityForIcao(_ code: String) -> String? { icaoCity[code] }

    // MARK: - Currency

    /// ISO 4217 currency per ICAO code - only for airports outside the
    /// eurozone (a code from icaoCity that's absent here uses the euro,
    /// needs no conversion table). Not exhaustive: covers the airports
    /// already in icaoCity.
    static let currencyByIcao: [String: String] = [
        "EGLL": "GBP", "EGKK": "GBP", "EGSS": "GBP", "EGCC": "GBP", "EGPH": "GBP",
        "LSZH": "CHF", "LSGG": "CHF", "LSZB": "CHF",
        "ESSA": "SEK", "ENGM": "NOK", "EKCH": "DKK", "EKBI": "DKK",
        "EPWA": "PLN", "EPKK": "PLN", "EPPO": "PLN", "EPWR": "PLN", "EPGD": "PLN",
        "LKPR": "CZK", "LHBP": "HUF", "LROP": "RON", "LBSF": "BGN", "LYBE": "RSD", "LUKK": "MDL",
        "LTFM": "TRY", "LTAI": "TRY",
        "HECA": "EGP",
        "OMDB": "AED", "OTHH": "QAR", "OERK": "SAR", "OEJN": "SAR",
        "KJFK": "USD", "KEWR": "USD", "KLAX": "USD", "KORD": "USD", "KMIA": "USD", "KIAD": "USD",
        "KBOS": "USD", "KSFO": "USD", "KATL": "USD", "CYYZ": "CAD", "CYUL": "CAD",
        "RJAA": "JPY", "RJTT": "JPY", "ZBAA": "CNY", "VHHH": "HKD", "WSSS": "SGD",
        "VABB": "INR", "VIDP": "INR", "RKSI": "KRW", "YSSY": "AUD", "FAOR": "ZAR",
        "HKJK": "KES", "SBGR": "BRL",
    ]

    /// Fallback only: used when the live rate lookup fails. Rough
    /// 2026-era values, not meant to be exact - the UI marks them as
    /// approximate whenever this table (rather than a live rate) is used.
    static let approxEurRates: [String: Double] = [
        "GBP": 0.84, "CHF": 0.95, "SEK": 11.2, "NOK": 11.5, "DKK": 7.46, "PLN": 4.3, "CZK": 25,
        "HUF": 400, "RON": 5.0, "BGN": 1.96, "RSD": 117, "MDL": 19.5, "TRY": 39,
        "EGP": 51, "AED": 3.97, "QAR": 3.93, "SAR": 4.05, "USD": 1.08, "CAD": 1.48, "JPY": 162,
        "CNY": 7.9, "HKD": 8.4, "SGD": 1.45, "INR": 91, "KRW": 1480, "AUD": 1.63, "ZAR": 20.5,
        "KES": 140, "BRL": 6.0,
    ]
}
