import Foundation
import PDFKit
import Combine

enum CrewSource { case api, pdf }

enum CrewDisplayState: Equatable {
    case empty
    case loading
    case forbidden
    case error(String)
    case ok
}

/// Central state + orchestration, mirroring the web app's `state` object
/// and its loadFlights()/renderX() functions. Two independent background
/// loops run once the view model is created:
/// - a 30s ticker that recomputes time-derived UI (countdown, layover,
///   duty status, the post-landing switch) from already-loaded data -
///   never touches the network or `dataStampFresh`.
/// - a 5-minute passive staleness check that re-fetches /flights only to
///   compare `updated_at` against what's shown, flipping the "Stand" flag
///   red/green without ever silently replacing the displayed data.
@MainActor
final class DashboardViewModel: ObservableObject {

    // MARK: - Setup / API key

    @Published var isApiKeyConfigured = false
    @Published var setupError: String?

    // MARK: - Flights

    @Published private(set) var flights: [Flight] = []       // today only
    @Published private(set) var allFlights: [Flight] = []    // -7d .. +21d
    @Published private(set) var allDuties: [DutyEntry] = []
    @Published var selectedIndex: Int = 0

    // MARK: - Derived display state (recomputed by recomputeDerived())

    @Published private(set) var layover: LayoverInfo?
    @Published private(set) var dutyStatus: DutyStatusInfo?
    @Published private(set) var currentCrew: [CrewMember] = []
    @Published private(set) var crewDisplayState: CrewDisplayState = .empty
    /// Freshness signal for the whole -7d/+21d window, not one specific
    /// flight (so it still means something on an Ortstag/Urlaub day with
    /// no flight selected) - drives the refresh button's color everywhere,
    /// not just on the flight card. See checkForUpdate().
    @Published private(set) var dataStampFresh = true

    // MARK: - Route weather (tap "Route: …" on the duty status card)

    /// Keyed by "\(icao)|\(dateKey)" - see DutyStatusCardView. Populated
    /// by loadRouteWeather(), called when the pilot expands the panel.
    @Published private(set) var routeWeather: [String: RouteWeatherState] = [:]
    private var routeWeatherLoadedForStops: [RouteStop] = []

    // MARK: - Crew source (OpenAirLog vs. uploaded PDF)

    @Published private(set) var crewSource: CrewSource = .api
    @Published private(set) var pdfCrew: [ParsedCrewMember] = []
    @Published private(set) var pdfCrewFileName: String?
    @Published private(set) var pdfCrewAccepted = true
    @Published private(set) var pdfLines: [String] = []
    @Published private(set) var pickupText: String?

    var hasPdfCrew: Bool { !pdfCrew.isEmpty }

    // MARK: - Settings

    @Published var ownName: String {
        didSet { UserDefaults.standard.set(ownName, forKey: Keys.ownName) }
    }

    // MARK: - Status / loading

    @Published var statusMessage = ""
    @Published var statusIsError = false
    @Published var isLoading = false

    // MARK: - Room numbers (own + crew, keyed per place+hotel[+name])

    @Published private(set) var roomNumbers: [String: String] = [:]

    // MARK: - Private

    private enum CrewCacheState { case loading, ok([CrewMember]), forbidden, error(String) }
    private var crewCache: [Int: CrewCacheState] = [:]
    /// Newest updated_at seen across the whole -7d/+21d window as of the
    /// last real load - the baseline checkForUpdate() compares against.
    /// Not tied to one specific flight (see dataStampFresh).
    private var lastKnownUpdatedAt: Date?

    private let client = OpenAirLogClient()
    private let currencyClient = CurrencyRateClient()
    private let weatherClient = WeatherService()
    private var tickerTask: Task<Void, Never>?
    private var stalenessTask: Task<Void, Never>?

    private enum Keys {
        static let ownName = "oal_own_name"
        static let roomNumbers = "oal_room_numbers"
        static let pdfCrew = "oal_pdf_crew_v1"
    }

    init() {
        ownName = UserDefaults.standard.string(forKey: Keys.ownName) ?? ""
        loadRoomNumbersFromDefaults()
        loadPdfCrewFromDefaults()
        isApiKeyConfigured = (KeychainStore.load()?.isEmpty == false)
        startBackgroundLoops()
    }

    deinit {
        tickerTask?.cancel()
        stalenessTask?.cancel()
    }

    // MARK: - Derived (computed, not stored - always read fresh by views)

    var currentFlight: Flight? {
        flights.indices.contains(selectedIndex) ? flights[selectedIndex] : nil
    }

    /// False once the post-landing switch (or a real vacation/Ortstag
    /// duty_code) means the duty status card should show instead of the
    /// flight card.
    var showFlightCard: Bool {
        guard currentFlight != nil else { return false }
        return !DutyStatusService.shouldShowPostLandingHomeView(todayFlights: flights, selectedIndex: selectedIndex)
    }

    /// "Vorname Nachname" from the Settings own-name field ("Nachname,
    /// Vorname" as typed), falling back to the app name when empty.
    var brandName: String {
        let trimmed = ownName.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return "Pilot Dashboard" }
        guard let commaIdx = trimmed.firstIndex(of: ",") else { return trimmed }
        let last = trimmed[trimmed.startIndex..<commaIdx].trimmingCharacters(in: .whitespaces)
        let first = trimmed[trimmed.index(after: commaIdx)...].trimmingCharacters(in: .whitespaces)
        guard !first.isEmpty, !last.isEmpty else { return trimmed }
        return "\(first) \(last)"
    }

    // MARK: - API key

    func saveApiKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            setupError = "Bitte einen API-Schlüssel eingeben."
            return
        }
        KeychainStore.save(trimmed)
        isApiKeyConfigured = true
        setupError = nil
        Task { await loadFlights() }
    }

    func resetApiKey() {
        KeychainStore.delete()
        isApiKeyConfigured = false
        flights = []; allFlights = []; allDuties = []
        layover = nil; dutyStatus = nil; currentCrew = []
        statusMessage = ""
        lastKnownUpdatedAt = nil
        dataStampFresh = true
    }

    // MARK: - Loading

    func loadFlights() async {
        guard let apiKey = KeychainStore.load(), !apiKey.isEmpty else {
            isApiKeyConfigured = false
            return
        }
        isLoading = true
        statusMessage = "Lade Flugdaten …"
        statusIsError = false
        defer { isLoading = false }

        let from = DateKey.todayISO(offsetDays: -7)
        let to = DateKey.todayISO(offsetDays: 21)

        do {
            let raw = try await client.fetchFlights(apiKey: apiKey, from: from, to: to)
            crewCache.removeAll()

            let parsed = raw.compactMap(FlightParsing.normalizeFlight)
                .sorted {
                    ($0.depSchedDate ?? $0.depActualDate ?? .distantPast) <
                    ($1.depSchedDate ?? $1.depActualDate ?? .distantPast)
                }
            let duties = FlightParsing.extractDutyEntries(raw)

            let todayKey = DateKey.key(for: Date())
            let todays = parsed.filter { f in
                guard let d = f.depSchedDate ?? f.depActualDate else { return false }
                return DateKey.key(for: d) == todayKey
            }

            allFlights = parsed
            allDuties = duties
            flights = todays
            selectedIndex = todays.isEmpty ? 0 : (FlightSelection.pickInitialIndex(todays) ?? 0)

            recomputeDerived()
            // Whatever just loaded is the new baseline - fresh again until
            // the next background check finds something newer on the server.
            lastKnownUpdatedAt = FlightParsing.maxUpdatedAt(raw)
            dataStampFresh = true

            if showFlightCard {
                statusMessage = ""
                await ensureCrewLoaded(for: currentFlight)
            } else {
                let nothingToShow = (layover == nil && dutyStatus == nil)
                statusMessage = nothingToShow ? "Heute nichts geplant." : ""
            }
        } catch {
            statusIsError = true
            statusMessage = (error as? LocalizedError)?.errorDescription ?? "Unbekannter Fehler."
            if case OpenAirLogError.unauthorized = error {
                isApiKeyConfigured = false
            }
        }
    }

    /// Recomputes everything derived from already-loaded data + the
    /// current time - called after a real load, after navigating between
    /// flights, and every 30s by the ticker. Deliberately never touches
    /// dataStampFresh (see checkForUpdate()).
    private func recomputeDerived(now: Date = Date()) {
        let todayKey = DateKey.key(for: now)
        let effType = DutyStatusService.effectiveDutyType(
            duties: allDuties, todayKey: todayKey,
            todayFlights: flights, selectedIndex: selectedIndex, now: now
        )
        // No layover card while on vacation/Ortstag/post-landing - there's
        // nowhere to have a hotel room in any of those (belt-and-suspenders
        // on top of LayoverDetector's own home-base exclusion).
        layover = effType != nil ? nil : LayoverDetector.findApiLayover(allFlights, now: now)
        dutyStatus = DutyStatusService.buildInfo(
            duties: allDuties, allFlights: allFlights,
            todayFlights: flights, selectedIndex: selectedIndex, now: now
        )
        updateCrewForCurrentFlight()
    }

    // MARK: - Flight navigation

    func selectPrevious() {
        guard selectedIndex > 0 else { return }
        selectedIndex -= 1
        recomputeDerived()
        Task { await ensureCrewLoaded(for: currentFlight) }
    }

    func selectNext() {
        guard selectedIndex < flights.count - 1 else { return }
        selectedIndex += 1
        recomputeDerived()
        Task { await ensureCrewLoaded(for: currentFlight) }
    }

    // MARK: - Crew

    func ensureCrewLoaded(for flight: Flight?) async {
        guard let flight = flight else { return }
        if !flight.embeddedCrew.isEmpty {
            crewCache[flight.id] = .ok(flight.embeddedCrew)
            updateCrewForCurrentFlight()
            return
        }
        if case .ok = crewCache[flight.id] { return }
        if case .forbidden = crewCache[flight.id] { return }

        crewCache[flight.id] = .loading
        updateCrewForCurrentFlight()

        guard let apiKey = KeychainStore.load() else { return }
        do {
            let raw = try await client.fetchCrew(apiKey: apiKey, flightId: flight.id)
            let crew = raw.map { CrewMember(name: displayName($0.name ?? "Unbekannt"), role: $0.role ?? "") }
            crewCache[flight.id] = .ok(crew)
        } catch OpenAirLogError.unauthorized {
            crewCache[flight.id] = .forbidden
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? "Crew konnte nicht geladen werden."
            crewCache[flight.id] = .error(message)
        }
        updateCrewForCurrentFlight()
    }

    private func updateCrewForCurrentFlight() {
        guard let flight = currentFlight else {
            currentCrew = []
            crewDisplayState = .empty
            return
        }

        let apiCrew: [CrewMember]
        switch crewCache[flight.id] {
        case .ok(let crew):
            apiCrew = crew
            crewDisplayState = crew.isEmpty ? .empty : .ok
        case .loading:
            apiCrew = []
            crewDisplayState = .loading
        case .forbidden:
            apiCrew = []
            crewDisplayState = .forbidden
        case .error(let message):
            apiCrew = []
            crewDisplayState = .error(message)
        case .none:
            apiCrew = flight.embeddedCrew
            crewDisplayState = apiCrew.isEmpty ? .empty : .ok
        }

        if crewSource == .pdf, hasPdfCrew {
            currentCrew = apiCrew.isEmpty
                ? pdfCrew.map { CrewMember(name: $0.name, role: $0.role) }
                : CrewMerge.mergeCrewWithPdf(apiCrew: apiCrew, pdfCrew: pdfCrew)
        } else {
            currentCrew = apiCrew
        }
    }

    func switchCrewSource() {
        guard hasPdfCrew else { return }
        crewSource = (crewSource == .pdf) ? .api : .pdf
        savePdfCrewToDefaults()
        updateCrewForCurrentFlight()
    }

    // MARK: - PDF import

    func importPDF(from url: URL) async {
        guard url.startAccessingSecurityScopedResource() else {
            statusMessage = "PDF konnte nicht geöffnet werden."
            statusIsError = true
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        guard let document = PDFDocument(url: url) else {
            statusMessage = "PDF konnte nicht gelesen werden."
            statusIsError = true
            return
        }

        let lines = PDFCrewParser.extractLines(from: document)
        let crew = PDFCrewParser.parseCrew(from: lines)
        pdfLines = lines
        pickupText = PDFCrewParser.findPickupLocal(in: lines)

        guard !crew.isEmpty else {
            pdfCrew = []
            pdfCrewFileName = url.lastPathComponent
            savePdfCrewToDefaults()
            return
        }

        let apiFirstNames = Set(allFlights.flatMap { $0.embeddedCrew.map { CrewMerge.firstName(of: $0.name) } })
        let plausible = CrewMerge.crewListsPlausiblyMatch(pdfCrew: crew, apiFirstNames: apiFirstNames)

        pdfCrew = crew
        pdfCrewFileName = url.lastPathComponent
        pdfCrewAccepted = plausible
        crewSource = plausible ? .pdf : .api
        savePdfCrewToDefaults()
        updateCrewForCurrentFlight()
    }

    // MARK: - Room numbers

    func roomKey(arrCode: String, hotel: String?) -> String { "\(arrCode)|\(hotel ?? "")" }
    func crewRoomKey(arrCode: String, hotel: String?, name: String) -> String {
        "\(roomKey(arrCode: arrCode, hotel: hotel))|\(name)"
    }
    func getRoomNumber(_ key: String) -> String { roomNumbers[key] ?? "" }
    func setRoomNumber(_ key: String, _ value: String) {
        roomNumbers[key] = value
        saveRoomNumbersToDefaults()
    }

    // MARK: - Currency

    func currencyInfo(for arrCode: String) async -> (code: String, rate: Double, live: Bool)? {
        guard let code = Lookups.currencyByIcao[arrCode] else { return nil }
        let (rates, live) = await currencyClient.rates()
        guard let rate = rates[code] else { return nil }
        return (code, rate, live)
    }

    // MARK: - Route weather

    nonisolated static func weatherKey(for stop: RouteStop) -> String {
        "\(stop.icao)|\(stop.dateKey ?? "")"
    }

    /// Fetches weather for every stop of the currently shown route chain
    /// in parallel, called when the pilot expands the "Route: …" panel.
    /// A no-op if already loaded for this exact route (so re-expanding
    /// doesn't refetch), but a genuinely new route (e.g. after a manual
    /// refresh changed the rotation) fetches fresh.
    func loadRouteWeather() async {
        guard let stops = dutyStatus?.routeStops, !stops.isEmpty else { return }
        if routeWeatherLoadedForStops == stops { return }
        routeWeatherLoadedForStops = stops

        for stop in stops {
            routeWeather[Self.weatherKey(for: stop)] = .loading
        }

        // Home base is skipped - the pilot's already there (or about to
        // be), its weather isn't the point of this panel. Doesn't affect
        // the "FRA-LIS-…" route-chain text itself, only this fetch.
        let client = weatherClient
        await withTaskGroup(of: (String, RouteWeatherState).self) { group in
            for stop in stops where stop.icao != Constants.homeBase {
                group.addTask {
                    let key = Self.weatherKey(for: stop)
                    guard let dateKey = stop.dateKey, !dateKey.isEmpty else { return (key, .noDate) }
                    let cityLabel = Lookups.icaoCity[stop.icao] ?? stop.icao
                    guard let coords = await client.geocodeCity(cityLabel) else { return (key, .notFound) }
                    guard let weather = await client.fetchDailyWeather(lat: coords.lat, lon: coords.lon, dateKey: dateKey) else {
                        return (key, .unavailable)
                    }
                    let info = WeatherService.infoForCode(weather.code)
                    return (key, .ok(icon: info.icon, tMin: weather.tMin, tMax: weather.tMax))
                }
            }
            for await (key, state) in group {
                routeWeather[key] = state
            }
        }
    }

    // MARK: - Background loops

    private func startBackgroundLoops() {
        tickerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Constants.tickerInterval * 1_000_000_000))
                guard !Task.isCancelled, let self else { break }
                await self.tick()
            }
        }
        stalenessTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Constants.dataStaleCheckInterval * 1_000_000_000))
                guard !Task.isCancelled, let self else { break }
                await self.checkForUpdate()
            }
        }
    }

    private func tick() {
        recomputeDerived()
    }

    /// Passive background check only - never auto-applies new data, just
    /// flips the freshness flag (see dataStampFresh) when OpenAirLog has
    /// something newer than the last real load, anywhere in the loaded
    /// window - not tied to one specific flight, so this still works on
    /// an Ortstag/Urlaub day with no flight selected at all.
    private func checkForUpdate() async {
        guard let lastKnownUpdatedAt, let apiKey = KeychainStore.load() else { return }

        let from = DateKey.todayISO(offsetDays: -7)
        let to = DateKey.todayISO(offsetDays: 21)
        do {
            let raw = try await client.fetchFlights(apiKey: apiKey, from: from, to: to)
            guard let freshMax = FlightParsing.maxUpdatedAt(raw) else { return }
            let nowFresh = freshMax <= lastKnownUpdatedAt
            if nowFresh != dataStampFresh {
                dataStampFresh = nowFresh
            }
        } catch {
            // silent - background check, no user-facing error for this
        }
    }

    // MARK: - Persistence helpers

    private func loadRoomNumbersFromDefaults() {
        guard let data = UserDefaults.standard.data(forKey: Keys.roomNumbers),
              let decoded = try? JSONDecoder().decode([String: String].self, from: data) else { return }
        roomNumbers = decoded
    }
    private func saveRoomNumbersToDefaults() {
        guard let data = try? JSONEncoder().encode(roomNumbers) else { return }
        UserDefaults.standard.set(data, forKey: Keys.roomNumbers)
    }

    private struct PersistedPdfCrewMember: Codable { let role: String; let name: String }
    private struct PersistedPdfCrew: Codable {
        let crew: [PersistedPdfCrewMember]
        let fileName: String?
        let crewSourceIsPdf: Bool
        let lines: [String]
    }

    private func savePdfCrewToDefaults() {
        let persisted = PersistedPdfCrew(
            crew: pdfCrew.map { PersistedPdfCrewMember(role: $0.role, name: $0.name) },
            fileName: pdfCrewFileName,
            crewSourceIsPdf: crewSource == .pdf,
            lines: pdfLines
        )
        guard let data = try? JSONEncoder().encode(persisted) else { return }
        UserDefaults.standard.set(data, forKey: Keys.pdfCrew)
    }

    private func loadPdfCrewFromDefaults() {
        guard let data = UserDefaults.standard.data(forKey: Keys.pdfCrew),
              let decoded = try? JSONDecoder().decode(PersistedPdfCrew.self, from: data) else { return }
        pdfCrew = decoded.crew.map { ParsedCrewMember(role: $0.role, name: $0.name) }
        pdfCrewFileName = decoded.fileName
        crewSource = decoded.crewSourceIsPdf ? .pdf : .api
        pdfLines = decoded.lines
        pickupText = PDFCrewParser.findPickupLocal(in: decoded.lines)
    }
}
