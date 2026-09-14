# Pilot Dashboard – native iOS app (SwiftUI)

This is a complete native SwiftUI re-implementation of the web dashboard
(`/index.html`, `/assets/app.js`) — same OpenAirLog data, same feature set
(currency calculator, room numbers, airline badge, layover/duty status,
route chain, briefing time, staleness check, PDF crew import), written as
plain `.swift` source files with no `.xcodeproj` included.

**Important:** this project was written and reviewed in a Linux cloud
environment with no macOS/Xcode available, so it has **not been compiled
or run**. Everything below is carefully hand-checked against Swift/SwiftUI
APIs, but you should expect to fix a handful of small build errors the
first time you open it in Xcode — treat this as a strong starting point,
not a guaranteed drop-in build.

## 1. Create the Xcode project

1. Xcode → File → New → Project → iOS → **App**.
2. Product Name: `PilotDashboard`. Interface: **SwiftUI**. Language: **Swift**.
   Storage: None (no Core Data / SwiftData needed — the app uses
   `UserDefaults` + Keychain).
3. Set the **Deployment Target to iOS 17.0** or later (the currency
   calculator uses the two-parameter `onChange(of:)` API introduced in
   iOS 17).
4. Delete the auto-generated `ContentView.swift` and `<AppName>App.swift`
   that Xcode creates — this project brings its own.

## 2. Add the source files

Drag the entire `PilotDashboard/` folder from this repo (the one next to
this README, containing `Models/`, `Networking/`, `Services/`,
`ViewModels/`, `Views/`, and `PilotDashboardApp.swift`) into the Xcode
project navigator. Choose **"Create groups"** (not folder references) and
make sure **"Copy items if needed"** and your app target are checked.

No third-party dependencies (no CocoaPods/SwiftPM packages) — everything
uses only `Foundation`, `SwiftUI`, `PDFKit`, `Combine`, and `Security`
(Keychain), all part of the standard iOS SDK.

## 3. Capabilities / entitlements

None needed beyond the defaults:
- Network access (HTTPS to `openairlog.de` and `open.er-api.com`) works
  out of the box under App Transport Security's default HTTPS-only policy
  — no `Info.plist` exceptions required.
- Keychain access for the app's own items needs no special entitlement.
- Importing a PDF uses `.fileImporter`, which needs no extra Info.plist
  entries either.

## 4. First run

1. Build & run on a simulator or device.
2. On first launch you'll see the setup screen — paste your OpenAirLog
   API key (find/generate it in your OpenAirLog account). It's saved to
   the Keychain, not `UserDefaults` (a deliberate security upgrade over
   the web app, which uses `localStorage`).
3. The dashboard loads flights for -7d..+21d around today and shows
   today's flight, an active layover, or the Urlaub/Ortstag duty status
   card — whichever applies.
4. In Settings (gear icon), you can set your own name (as
   "Nachname, Vorname", matching how OpenAirLog spells crew names) for
   crew-matching and the header greeting, and optionally import a PDF
   Umlaufcrewliste.

## Known gaps vs. the web app

- **PDF hotel/leg extraction was intentionally not ported.** The web app
  (`assets/app.js`) has extra regex-based extraction for flight legs and
  hotel names from the PDF, built up over several rounds of fixes against
  real PDFs. I don't have that exact logic verbatim outside the web app's
  source, and didn't want to guess a plausible-looking but unverified
  regex for it (same "don't guess" principle applied elsewhere in this
  project — see e.g. `Lookups.threeLetterCode`). `PDFCrewParser.swift`
  only extracts **crew rows** (role + name) and a **pickup time**, which
  covers the crew-list reconciliation feature fully. Room numbers are
  still tracked per arrival airport (no hotel name in the key), matching
  what the crew-matching feature actually needs.
- **PDF text extraction uses PDFKit's per-page `.string`,** not pdf.js's
  positioned-fragment/y-coordinate clustering that the web app uses. This
  works well for straightforward single-column crew rosters; a complex
  multi-column PDF layout might not extract in the right row order. If a
  real PDF doesn't parse, nothing is silently guessed or overwritten —
  the crew source just stays on the live OpenAirLog data (same "don't
  guess" fallback as the web app).
- **3-letter station codes** (`Lookups.threeLetterCode`) only cover the
  six pairs the pilot has explicitly confirmed (EDDF→FRA, LUKK→RMO,
  LPPT→LIS, EKBI→BLL, EPWA→WAW, EDDH→HAM); any other ICAO code in the
  route chain falls back to showing the raw ICAO code rather than
  guessing an airline-internal 3-letter code (same policy as the web
  app, established after the ATC-callsign guessing mistake earlier in
  this project).

## Architecture at a glance

- `Models/` — `Flight`, `CrewMember`, `DutyEntry`/`DutyType`, and the
  static lookup tables (`AirlineInfo`, ICAO→city, ICAO→currency, 3-letter
  codes, approximate EUR rates).
- `Networking/` — `OpenAirLogClient` (URLSession, no-cache reads),
  `KeychainStore`, `CurrencyRateClient` (6h in-memory cache + fallback),
  and `RawFlightEntry`/`FlightsResponseParser` for the raw JSON schema.
- `Services/` — pure business logic ported 1:1 from the web app's
  functions: `FlightParsing`, `FlightSelection`, `LayoverDetector`,
  `DutyStatusService`, `CrewMerge`, `AirlineBadge`, `PDFCrewParser`.
- `ViewModels/DashboardViewModel.swift` — the single `@MainActor
  ObservableObject` source of truth, including the two background loops
  (30s UI ticker, 5-minute passive staleness check — see the file's own
  doc comment for exactly what each does and doesn't touch).
- `Views/` — `ContentView` (setup vs. dashboard), `SetupView`,
  `SettingsView`, and `Views/Components/` for the individual cards
  (flight, crew, layover + currency calculator + room numbers, duty
  status) plus the data-freshness stamp and airline badge.
