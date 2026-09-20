"use strict";

const API_BASE = "https://openairlog.de/api/v1";
const STORAGE_KEY = "oal_api_key";
const PDF_CREW_STORAGE_KEY = "oal_pdf_crew";
const ROSTER_URL_STORAGE_KEY = "oal_roster_url";
const AERODATABOX_KEY_STORAGE_KEY = "oal_aerodatabox_key";
const AERODATABOX_BASE = "https://prod.api.market/api/v1/aedbx/aerodatabox";
const FETCH_TIMEOUT_MS = 15000;

// Home base the rotation returns to - OpenAirLog has no field for this
// anywhere (checked every field on a real flight object), so it's
// detected instead from the flight data itself: every rotation starts and
// ends there, so whichever airport shows up as a departure/arrival most
// often in the loaded window is it - see detectHomeBase() below, run once
// flights are loaded. Confirmed against this pilot's own real logbook: a
// past base change (Munich, historically, to the current Frankfurt) shows
// up exactly as a shift in which airport dominates a recent window - a
// plain frequency count on real data, not a guess about anything
// airline-internal. "EDDF" here is just the fallback before that first
// detection runs (OpenAirLog uses ICAO codes throughout, not IATA "FRA").
let HOME_BASE = "EDDF";

// Returns null only when there's no flight data at all to go on - the
// caller then keeps whatever HOME_BASE already is instead of resetting it.
function detectHomeBase(allFlights) {
  const counts = new Map();
  for (const f of allFlights) {
    if (f.depCode) counts.set(f.depCode, (counts.get(f.depCode) || 0) + 1);
    if (f.arrCode) counts.set(f.arrCode, (counts.get(f.arrCode) || 0) + 1);
  }
  let best = null;
  for (const [code, count] of counts) {
    if (!best || count > best.count) best = { code, count };
  }
  return best ? best.code : null;
}

// Plain fetch() never times out on its own - a stalled connection (bad
// network, an unresponsive server) would otherwise leave the UI stuck on
// "Lade Flugdaten …" forever. Aborts after FETCH_TIMEOUT_MS instead.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

const els = {
  setupCard: document.getElementById("setupCard"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  setupError: document.getElementById("setupError"),
  settingsBtn: document.getElementById("settingsBtn"),
  brandName: document.getElementById("brandName"),
  brandAirlineBadge: document.getElementById("brandAirlineBadge"),
  brandAirlineBadgeCode: document.getElementById("brandAirlineBadgeCode"),

  statusBanner: document.getElementById("statusBanner"),

  flightCardTrack: document.getElementById("flightCardTrack"),
  flightCardDots: document.getElementById("flightCardDots"),
  flightCardTemplate: document.getElementById("flightCardTemplate"),

  dutyStatusCard: document.getElementById("dutyStatusCard"),
  dutyStatusTitle: document.getElementById("dutyStatusTitle"),
  dutyStatusCountdown: document.getElementById("dutyStatusCountdown"),
  dutyStatusBriefing: document.getElementById("dutyStatusBriefing"),
  dutyStatusBriefingValue: document.getElementById("dutyStatusBriefingValue"),
  dutyStatusEnd: document.getElementById("dutyStatusEnd"),
  dutyStatusEndValue: document.getElementById("dutyStatusEndValue"),
  dutyStatusRouteBtn: document.getElementById("dutyStatusRouteBtn"),
  dutyStatusWeather: document.getElementById("dutyStatusWeather"),

  layoverCard: document.getElementById("layoverCard"),
  layoverTitle: document.getElementById("layoverTitle"),
  layoverPlace: document.getElementById("layoverPlace"),
  layoverWeather: document.getElementById("layoverWeather"),
  layoverHotel: document.getElementById("layoverHotel"),
  roomDetails: document.getElementById("roomDetails"),
  roomNumberInput: document.getElementById("roomNumberInput"),
  layoverPickup: document.getElementById("layoverPickup"),
  layoverCurrency: document.getElementById("layoverCurrency"),
  currencyCode: document.getElementById("currencyCode"),
  currencyLocalInput: document.getElementById("currencyLocalInput"),
  currencyLocalUnit: document.getElementById("currencyLocalUnit"),
  currencyEurOutput: document.getElementById("currencyEurOutput"),
  currencyNote: document.getElementById("currencyNote"),
  layoverCrew: document.getElementById("layoverCrew"),
  layoverCrewList: document.getElementById("layoverCrewList"),

  crewCard: document.getElementById("crewCard"),
  crewSource: document.getElementById("crewSource"),
  crewList: document.getElementById("crewList"),
  crewEmpty: document.getElementById("crewEmpty"),
  crewSourceSwitchBtn: document.getElementById("crewSourceSwitchBtn"),

  crewPdfCard: document.getElementById("crewPdfCard"),
  crewPdfInput: document.getElementById("crewPdfInput"),
  crewPdfLabel: document.getElementById("crewPdfLabel"),
  crewPdfStatus: document.getElementById("crewPdfStatus"),
  crewPdfRawToggle: document.getElementById("crewPdfRawToggle"),
  crewPdfResult: document.getElementById("crewPdfResult"),

  rosterCard: document.getElementById("rosterCard"),
  rosterUrlInput: document.getElementById("rosterUrlInput"),
  saveRosterBtn: document.getElementById("saveRosterBtn"),
  rosterStatus: document.getElementById("rosterStatus"),
  resetRosterBtn: document.getElementById("resetRosterBtn"),
  corsProxyKeyInput: document.getElementById("corsProxyKeyInput"),
  saveCorsProxyKeyBtn: document.getElementById("saveCorsProxyKeyBtn"),
  corsProxyKeyStatus: document.getElementById("corsProxyKeyStatus"),
  resetCorsProxyKeyBtn: document.getElementById("resetCorsProxyKeyBtn"),

  aeroDataBoxCard: document.getElementById("aeroDataBoxCard"),
  aeroDataBoxKeyInput: document.getElementById("aeroDataBoxKeyInput"),
  saveAeroDataBoxBtn: document.getElementById("saveAeroDataBoxBtn"),
  aeroDataBoxStatus: document.getElementById("aeroDataBoxStatus"),
  testAeroDataBoxBtn: document.getElementById("testAeroDataBoxBtn"),
  aeroDataBoxTestResult: document.getElementById("aeroDataBoxTestResult"),
  aeroDataBoxTestRaw: document.getElementById("aeroDataBoxTestRaw"),
  resetAeroDataBoxBtn: document.getElementById("resetAeroDataBoxBtn"),

  refreshBtn: document.getElementById("refreshBtn"),
  dataStamp: document.getElementById("dataStamp"),
  resetKeyBtn: document.getElementById("resetKeyBtn"),
};

/** @type {{flights: any[], index: number, crewSource: "api"|"pdf", pdfCrew: {crew: any[], rotation: any, fileName: string}|null}} */
const state = {
  flights: [], allFlights: [], allDuties: [], index: 0, crewSource: "api",
  pdfCrew: null, pdfLegs: [], pdfLines: [], cardNodes: [],
  // "flights" (the ordinary carousel, state.flights/state.index/state.cardNodes -
  // once today's own last flight has departed into a layover,
  // previewLayoverFlight() attaches els.layoverCard as one more page at
  // index state.flights.length, tracked here in state.previewLayover) or
  // "layover" (renderLayoverCarousel()'s own, state.layoverFlights/
  // state.layoverPageIndex/state.layoverCardNodes, once 30 min past actual
  // arrival) - #flightCardTrack and #flightCardDots are shared DOM between
  // the two, never shown at once.
  mode: "flights", previewLayover: null,
  layoverFlights: [], layoverPageIndex: 0, layoverCardNodes: [],
};
const crewCache = new Map(); // flightId -> { status: "loading"|"ok"|"error"|"forbidden", crew: [], message?: string }

// ---------- helpers ----------

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
}

function pick(obj, paths) {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// Scheduled time only, no date - the dashboard only ever shows today's
// flights, so the date would be redundant here.
function fmtTime(d) {
  if (!d) return "–";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}Z`;
}

function fmtDurationHM(ms) {
  if (!(ms > 0)) return null;
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")} Std`;
}

// Local (device) time, deliberately not UTC like fmtTime() - used only for
// the briefing-time hint, where what matters is the wall-clock time to be
// at the airport by, in the pilot's own timezone (home base and device are
// both assumed to be the same timezone, i.e. Europe/Berlin).
function fmtLocalTime(d) {
  if (!d) return "–";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const WEEKDAY_SHORT_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// Weekday for a plain "yyyy-MM-dd" calendar date (route weather rows) -
// computed from its own UTC components, independent of the device's
// timezone, matching how these dates are defined elsewhere (OpenAirLog's
// own "date" field, not a calendar day derived from local time).
function weekdayShortForDateKey(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || "");
  if (!m) return "";
  return WEEKDAY_SHORT_DE[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
}

// Weekday for a real Date moment already shown in local time (the
// briefing line) - local calendar day, matching fmtLocalTime().
function weekdayShortLocal(d) {
  return WEEKDAY_SHORT_DE[d.getDay()];
}

// Confirmed OpenAirLog schema: scheduled/actual times are standalone
// "HH:MM:SS" strings, not full datetimes - combine with the flight's
// separate "date" field. Cross-checked as UTC against a real response
// (scheduled_off_block "18:00:00" matched a same-flight PDF's "STD UTC
// 1800"). Rolls to the next day if before `anchor` (overnight flights).
// Also accepts a full datetime in `timeStr` directly, in case some
// entries carry that instead of a bare time.
function combineDateAndTime(dateStr, timeStr, anchor) {
  if (!timeStr) return null;

  if (/\d{4}-\d{2}-\d{2}/.test(timeStr)) {
    const direct = new Date(timeStr);
    if (!isNaN(direct.getTime())) return direct;
  }

  if (!dateStr) return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr);
  if (!m) return null;
  let d = new Date(`${dateStr}T${m[1]}:${m[2]}:${m[3] || "00"}Z`);
  if (isNaN(d.getTime())) return null;
  if (anchor && d < anchor) d = new Date(d.getTime() + 24 * 3600 * 1000);
  return d;
}

function toDateOrNull(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function todayISO(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// Local (device) calendar day, not UTC - "heute" means the pilot's local day,
// even though flight times themselves are shown in UTC.
function localDateKey(d) {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- normalization (defensive: field names are inferred, not confirmed) ----------

function extractFlightsArray(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  for (const key of ["data", "flights", "items", "results"]) {
    if (Array.isArray(json[key])) return json[key];
  }
  return [];
}

function airportCode(raw, side) {
  // side: "departure" | "arrival"
  const nested = raw[side];
  if (nested && typeof nested === "object") {
    const code = pick(nested, ["icao", "iata", "code", "airport", "name"]);
    if (code) return String(code).toUpperCase();
  }
  const prefix = side === "departure" ? "dep" : "arr";
  const alt = side === "departure" ? "origin" : "destination";
  const flat = pick(raw, [
    `${prefix}_icao`, `${prefix}_iata`, `${prefix}Icao`, `${prefix}Iata`,
    `${prefix}_airport`, `${prefix}Airport`,
    `${alt}_icao`, `${alt}_iata`, alt,
    side, `${side}_airport`,
    side === "departure" ? "from" : "to",
  ]);
  return flat ? String(flat).toUpperCase() : "---";
}

function timeField(raw, side, kind) {
  // kind: "scheduled" | "actual"
  const nested = raw[side];
  if (nested && typeof nested === "object") {
    const v = pick(nested, [kind, kind === "scheduled" ? "sched" : "act", kind === "scheduled" ? "std" : "atd", kind === "scheduled" ? "sta" : "ata"]);
    if (v) return v;
  }
  const prefix = side === "departure" ? "dep" : "arr";
  const short = side === "departure"
    ? (kind === "scheduled" ? "std" : "atd")
    : (kind === "scheduled" ? "sta" : "ata");
  return pick(raw, [
    `${prefix}_${kind}`, `${prefix}${kind[0].toUpperCase()}${kind.slice(1)}`,
    `${side}_${kind}`,
    `${kind}_${side}`,
    short,
    kind === "scheduled" ? `${side}_time` : undefined,
    kind === "scheduled" ? `${prefix}_time` : undefined,
  ].filter(Boolean));
}

// Some sources (official rotation crew list PDFs) print names in solid
// caps; OpenAirLog's own API already gives proper mixed case. Only
// reformat strings with no case variation at all (all-caps or
// all-lowercase) - anything already mixed case is left exactly as given.
function hasMixedCase(str) {
  return /[a-zA-ZÄÖÜäöü]/.test(str) && str !== str.toUpperCase() && str !== str.toLowerCase();
}
function toTitleCase(str) {
  return str.toLowerCase().replace(/(^|[\s\-'.])\p{L}/gu, (c) => c.toUpperCase());
}
function displayName(str) {
  if (!str) return str;
  return hasMixedCase(str) ? str : toTitleCase(str);
}

function normalizeCrewMember(m) {
  if (typeof m === "string") return { name: displayName(m), role: "" };
  const name = pick(m, ["name", "full_name", "fullName", "display_name"]) ||
    [pick(m, ["first_name", "firstName"]), pick(m, ["last_name", "lastName"])].filter(Boolean).join(" ") ||
    "Unbekannt";
  const role = pick(m, ["role", "function", "position", "rank", "duty"]) || "";
  // Same DH markers checked for the pilot's own flight (see
  // normalizeFlight()'s isDeadhead) - a colleague can individually be
  // deadheading on this flight even when it isn't a deadhead for the
  // pilot themselves.
  const isDeadhead = ["crew_position", "duty_code", "remarks", "role", "function", "position", "rank", "duty"]
    .some((key) => String(m[key] || "").toUpperCase() === "DH");
  return { name: displayName(String(name)), role: String(role), isDeadhead };
}

const FLIGHT_NUMBER_KEYS = ["flight_number", "flightNumber", "flight_no", "flightNo", "number", "callsign"];

// OpenAirLog's /flights also returns non-flight duty entries (e.g.
// duty_code "ORTSTAG", block/ground days) alongside real flights - those
// have flight_number: null. Only entries with a flight number are flights.
function isRealFlightEntry(raw) {
  return pick(raw, FLIGHT_NUMBER_KEYS) !== undefined;
}

function normalizeFlight(raw) {
  const id = pick(raw, ["id", "flight_id", "flightId", "uuid"]);
  const flightNumber = pick(raw, FLIGHT_NUMBER_KEYS) || "–";
  const depCode = airportCode(raw, "departure");
  const arrCode = airportCode(raw, "arrival");

  // Prefer the confirmed date+time-string fields; fall back to the
  // generic (nested-or-flat, full-ISO-datetime) guesser for any other
  // shape this API - or a future change to it - might return.
  const depSchedDate = combineDateAndTime(raw.date, raw.scheduled_off_block, null)
    || toDateOrNull(timeField(raw, "departure", "scheduled"));
  const depActualDate = combineDateAndTime(raw.date, raw.off_block || raw.takeoff, null)
    || toDateOrNull(timeField(raw, "departure", "actual"));
  const arrSchedDate = combineDateAndTime(raw.date, raw.scheduled_on_block, depSchedDate)
    || toDateOrNull(timeField(raw, "arrival", "scheduled"));
  const arrActualDate = combineDateAndTime(raw.date, raw.on_block || raw.landing, depActualDate)
    || toDateOrNull(timeField(raw, "arrival", "actual"));

  const aircraft = pick(raw, ["aircraft_type", "aircraftType", "aircraft.type", "aircraft", "type"]);
  const registration = pick(raw, ["aircraft_registration", "registration", "reg", "tail_number", "tailNumber", "aircraft.registration"]);
  const status = pick(raw, ["status", "flight_status", "state"]);

  // Deadhead: this pilot is a passenger on this flight, not operating it.
  // OpenAirLog marks it in more than one field for the same flight
  // (crew_position, duty_code, remarks all showed "DH" on a real example);
  // checking all of them is cheap and more robust than picking just one.
  const isDeadhead = ["crew_position", "duty_code", "remarks"]
    .some((key) => String(raw[key] || "").toUpperCase() === "DH");

  // Crew can be embedded directly in the flight object (confirmed) and/or
  // fetched separately via GET /flights/{id}/crew (crew:read scope) -
  // ensureCrewLoaded() prefers this embedded copy when non-empty.
  const crewRaw = pick(raw, ["crew", "crew_members", "crewMembers", "crewlist"]);
  const embeddedCrew = Array.isArray(crewRaw) ? crewRaw.map(normalizeCrewMember) : [];

  // When OpenAirLog last touched this specific record (e.g. a crew swap) -
  // shown next to the refresh button so it's clear how fresh the currently
  // displayed data actually is, without having to guess from a manual tap.
  const updatedAt = toDateOrNull(pick(raw, ["updated_at", "updatedAt"]));

  return {
    raw,
    id,
    flightNumber: String(flightNumber),
    depCode, arrCode,
    depSchedDate, depActualDate, arrSchedDate, arrActualDate,
    aircraft: aircraft || "–",
    registration: registration || "–",
    status: status ? String(status) : "",
    isDeadhead,
    embeddedCrew,
    updatedAt,
  };
}

// ---------- API key storage ----------

function getApiKey() {
  try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
}
function setApiKey(key) {
  try { localStorage.setItem(STORAGE_KEY, key); } catch { /* private mode etc. */ }
}
function clearApiKey() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ---------- MyTime roster URL storage ----------

// MyTime's own "Teilen" (share) link uses the calendar-subscription
// "webcal://" scheme - a signal telling a calendar app "subscribe to
// this", always actually served over plain http(s) underneath (that's
// the whole point of the scheme: a client that understands it swaps in
// https:// itself before fetching, exactly like the iPhone Calendar app
// does). fetch() has no concept of "webcal:" at all, and even the CORS
// proxy explicitly rejects it ("Protocol webcal: not allowed", confirmed
// against the pilot's own link) - swapped for the "https://" it was
// always going to resolve to. Applied on every read, not just at save
// time, so an already-stored webcal:// link self-heals without the
// pilot having to paste it in again.
function normalizeRosterUrl(raw) {
  const trimmed = (raw || "").trim();
  const m = /^webcals?:\/\//i.exec(trimmed);
  return m ? `https://${trimmed.slice(m[0].length)}` : trimmed;
}

function getRosterUrl() {
  try { return normalizeRosterUrl(localStorage.getItem(ROSTER_URL_STORAGE_KEY) || ""); } catch { return ""; }
}
function setRosterUrl(url) {
  try { localStorage.setItem(ROSTER_URL_STORAGE_KEY, url); } catch { /* private mode etc. */ }
}
function clearRosterUrl() {
  try { localStorage.removeItem(ROSTER_URL_STORAGE_KEY); } catch { /* ignore */ }
}

// ---------- corsproxy.io API key storage (see rosterCorsProxyBuilders()) ----------

const CORSPROXY_KEY_STORAGE_KEY = "oal_corsproxy_key";
function getCorsProxyKey() {
  try { return localStorage.getItem(CORSPROXY_KEY_STORAGE_KEY) || ""; } catch { return ""; }
}
function setCorsProxyKey(key) {
  try { localStorage.setItem(CORSPROXY_KEY_STORAGE_KEY, key); } catch { /* private mode etc. */ }
}
function clearCorsProxyKey() {
  try { localStorage.removeItem(CORSPROXY_KEY_STORAGE_KEY); } catch { /* ignore */ }
}

function renderCorsProxyKeyStatus() {
  const key = getCorsProxyKey();
  els.corsProxyKeyStatus.hidden = !key;
  els.corsProxyKeyStatus.textContent = key ? "corsproxy.io-Schlüssel hinterlegt." : "";
  els.resetCorsProxyKeyBtn.hidden = !key;
}

// Surfaces ensureRosterLoaded()'s actual outcome (see rosterEventsCache's
// lastError/fetchedAt) instead of a static "link saved" message - a
// silently failing fetch (network, CORS, a bad link) previously looked
// identical to "no matching pickup event", with no way to tell them
// apart from the Layover card alone.
function renderRosterStatus() {
  const url = getRosterUrl();
  els.rosterStatus.hidden = !url;
  els.resetRosterBtn.hidden = !url;
  if (!url) {
    els.rosterStatus.textContent = "";
    return;
  }
  if (rosterEventsCache.lastError) {
    els.rosterStatus.textContent = `Fehler beim Abrufen: ${rosterEventsCache.lastError}`;
    els.rosterStatus.classList.add("error-inline");
    return;
  }
  els.rosterStatus.classList.remove("error-inline");
  if (!rosterEventsCache.fetchedAt) {
    els.rosterStatus.textContent = "Roster-Link hinterlegt, noch nicht abgerufen.";
    return;
  }
  const via = rosterEventsCache.viaProxy ? ` (über ${rosterEventsCache.viaProxy})` : "";
  els.rosterStatus.textContent = `Zuletzt erfolgreich abgerufen: ${fmtLocalTime(new Date(rosterEventsCache.fetchedAt))}${via}`;
}

// ---------- AeroDataBox API key storage ----------

function getAeroDataBoxKey() {
  try { return localStorage.getItem(AERODATABOX_KEY_STORAGE_KEY) || ""; } catch { return ""; }
}
function setAeroDataBoxKey(key) {
  try { localStorage.setItem(AERODATABOX_KEY_STORAGE_KEY, key); } catch { /* private mode etc. */ }
}
function clearAeroDataBoxKey() {
  try { localStorage.removeItem(AERODATABOX_KEY_STORAGE_KEY); } catch { /* ignore */ }
}

function renderAeroDataBoxStatus() {
  const key = getAeroDataBoxKey();
  els.aeroDataBoxStatus.hidden = !key;
  els.aeroDataBoxStatus.textContent = key ? "API-Schlüssel hinterlegt." : "";
  els.testAeroDataBoxBtn.hidden = !key;
  els.aeroDataBoxTestResult.hidden = true;
  els.aeroDataBoxTestRaw.hidden = true;
  els.resetAeroDataBoxBtn.hidden = !key;
}

// A direct, in-app way to tell "no data ever shows up" apart from "the
// key/request itself doesn't work" - without needing to dig into the
// browser's own developer console (not always within easy reach, e.g. on
// an iPhone without a Mac to plug it into for Web Inspector). Tests
// against whichever real flight is already loaded, so a failure here
// means the exact same request the crew-list/off-block features make
// would also fail for real flight data, not just this one probe.
async function testAeroDataBoxConnection() {
  const key = getAeroDataBoxKey();
  if (!key) return;
  const testFlight = state.flights[state.index] || state.allFlights[0];
  if (!testFlight || !testFlight.flightNumber || !(testFlight.raw && testFlight.raw.date)) {
    els.aeroDataBoxTestResult.hidden = false;
    els.aeroDataBoxTestResult.textContent = "Kein Testflug verfügbar - erst Flugdaten laden.";
    return;
  }

  els.testAeroDataBoxBtn.disabled = true;
  els.aeroDataBoxTestResult.hidden = false;
  els.aeroDataBoxTestResult.textContent = `Teste mit ${testFlight.flightNumber} …`;
  els.aeroDataBoxTestRaw.hidden = true;
  els.aeroDataBoxTestRaw.textContent = "";

  // Shows the raw response right on the page - no separate console/Web
  // Inspector access needed to see exactly what came back.
  function showRaw(value) {
    els.aeroDataBoxTestRaw.hidden = false;
    els.aeroDataBoxTestRaw.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  const url = `${AERODATABOX_BASE}/flights/Number/${encodeURIComponent(testFlight.flightNumber)}/${encodeURIComponent(testFlight.raw.date)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: "application/json", "x-api-market-key": key } });
    const text = await res.text();
    if (!res.ok) {
      els.aeroDataBoxTestResult.textContent = `Fehlgeschlagen: Antwort ${res.status} von api.market. Key/Tarif prüfen.`;
      showRaw(text);
    } else {
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      const entries = Array.isArray(json) ? json : json ? [json] : [];
      els.aeroDataBoxTestResult.textContent = entries.length
        ? `Erfolgreich - ${entries.length} Eintrag/Einträge für ${testFlight.flightNumber} gefunden.`
        : "Antwort kam an, aber leer oder kein gültiges JSON.";
      showRaw(json !== null ? json : text);
    }
  } catch (err) {
    // The one failure mode a status code can't capture: the browser
    // blocked the response entirely (CORS) or there's no route to the
    // host at all - both look identical to page code, just "the fetch
    // rejected" with no further detail.
    els.aeroDataBoxTestResult.textContent =
      "Fehlgeschlagen: Netzwerk- oder CORS-Fehler (Anfrage kam nicht durch).";
    showRaw(String(err));
  }
  els.testAeroDataBoxBtn.disabled = false;
}

// Persist what was parsed from the uploaded PDF (crew, flight legs incl.
// hotel/layover info, and the raw extracted lines for pickup-time lookup) -
// not the PDF file itself - so it survives a page refresh instead of
// having to re-upload every time.
function savePdfCrew() {
  try {
    if (state.pdfCrew || state.pdfLegs.length) {
      localStorage.setItem(PDF_CREW_STORAGE_KEY, JSON.stringify({
        ...(state.pdfCrew || {}),
        crewSource: state.crewSource,
        legs: state.pdfLegs,
        lines: state.pdfLines,
      }));
    } else {
      localStorage.removeItem(PDF_CREW_STORAGE_KEY);
    }
  } catch { /* private mode etc. */ }
}

function loadStoredPdfCrew() {
  try {
    const raw = localStorage.getItem(PDF_CREW_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored) return;

    state.pdfLegs = Array.isArray(stored.legs) ? stored.legs.map(reviveLeg) : [];
    state.pdfLines = Array.isArray(stored.lines) ? stored.lines : [];

    if (Array.isArray(stored.crew) && stored.crew.length) {
      state.pdfCrew = { crew: stored.crew, rotation: stored.rotation || null, fileName: stored.fileName || "PDF" };
      state.crewSource = stored.crewSource === "pdf" ? "pdf" : "api";
      els.crewPdfLabel.textContent = stored.fileName || "PDF";
      els.crewPdfStatus.hidden = false;
      els.crewPdfStatus.textContent =
        `${stored.crew.length} Crewmitglied(er) aus vorherigem Upload (${stored.fileName || "PDF"}).` +
        (stored.rotation ? ` (Umlauf ${stored.rotation.rotation})` : "");
    }
  } catch { /* ignore malformed storage */ }
}

// ---------- rendering ----------

// Settings is a focused screen containing only the API key and the PDF
// upload: opening it hides the rest of the dashboard (flight, layover,
// crew) and shows the PDF upload card, which otherwise stays hidden.
// Closing it re-runs the normal render functions so flight/crew/layover
// reappear only if there's actually something to show.
function setSettingsOpen(open) {
  els.setupCard.hidden = !open;
  els.crewPdfCard.hidden = !open;
  els.rosterCard.hidden = !open;
  els.aeroDataBoxCard.hidden = !open;
  if (open) {
    renderRosterStatus();
    renderCorsProxyKeyStatus();
    renderAeroDataBoxStatus();
    els.flightCardTrack.hidden = true;
    els.flightCardDots.hidden = true;
    els.layoverCard.hidden = true;
    els.crewCard.hidden = true;
    els.dutyStatusCard.hidden = true;
  } else {
    // renderFlight() already decides flight card vs. duty status card
    // internally (including the post-landing "Ortstag" switch).
    renderFlight();
    renderLayover();
  }
}

function showBanner(message, kind) {
  els.statusBanner.hidden = !message;
  els.statusBanner.textContent = message || "";
  els.statusBanner.className = "status-banner" + (kind ? " " + kind : "");
}

// On a multi-leg day, only switch the shown flight to the next one starting
// 90 minutes before its departure - before that, stay on the most recently
// completed leg instead of jumping ahead as soon as the previous one ends.
const NEXT_FLIGHT_LEAD_MS = 90 * 60 * 1000;

function pickInitialIndex(flights) {
  const now = new Date();

  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    const dep = f.depActualDate || f.depSchedDate;
    const arr = f.arrActualDate || f.arrSchedDate;
    if (dep && arr && dep <= now && now <= arr) return i; // currently in the air / on the ground for this leg
  }

  let nextIndex = -1;
  for (let i = 0; i < flights.length; i++) {
    const dep = flights[i].depActualDate || flights[i].depSchedDate;
    if (dep && dep > now) { nextIndex = i; break; }
  }
  if (nextIndex !== -1) {
    const dep = flights[nextIndex].depActualDate || flights[nextIndex].depSchedDate;
    if (dep - now <= NEXT_FLIGHT_LEAD_MS || nextIndex === 0) return nextIndex;
    return nextIndex - 1; // still show the previous, just-completed leg for now
  }

  return flights.length ? flights.length - 1 : -1; // all of today's flights are done
}

// Small dots below the flight-card track, one per flight of the day,
// standing in for the removed "Flug X von Y" text now that the cards
// scroll horizontally - just marks count/position, no text.
function renderFlightDots() {
  const dots = els.flightCardDots.children;
  // #flightCardTrack/#flightCardDots are shared between the ordinary
  // flight-card carousel and the Layover card's own attached one (see
  // renderLayoverCarousel()) - state.mode says which index applies.
  const activeIndex = state.mode === "layover" ? state.layoverPageIndex : state.index;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle("active", i === activeIndex);
  }
}

// Shared by the flight number's callsign suffix and the depTime/arrTime
// deviation labels - all three want the same AeroDataBox lookup for this
// pilot's own current flight (its own flight number + date), so this is
// the one place that checks the cache and triggers a fetch if it's
// stale, rather than each caller doing that separately. peekOnly reads
// whatever's cached without triggering a new fetch - used for the cards
// the user isn't currently looking at, so scrolling past several of them
// doesn't fire off a lookup for each one.
function getOwnFlightAeroDataBoxLeg(f, opts) {
  const dateKey = f.raw && f.raw.date;
  if (!getAeroDataBoxKey() || !f.flightNumber || !dateKey) return null;
  const cacheKey = `${f.flightNumber}|${dateKey}`;
  const cached = flightByNumberCache.get(cacheKey);
  const peekOnly = opts && opts.peekOnly;
  // No time-based staleness re-fetch anymore - only ↻ (see refreshAll())
  // clears this cache, so a lookup only ever fires once per flight until
  // the pilot explicitly asks for new data.
  if (!peekOnly && !cached) {
    ensureFlightByNumberLoaded(f.flightNumber, dateKey);
  }
  return cached ? cached.leg : null;
}

// Shows the AeroDataBox-reported current time under the scheduled one
// when they meaningfully differ - green if it's now expected more than 3
// minutes early, red if more than 3 minutes late. Within that 3-minute
// span the schedule is treated as still accurate enough, so nothing is
// shown at all (not even in a neutral color) rather than noise for every
// small/normal fluctuation.
function renderTimeDeviation(el, scheduledDate, currentDate) {
  el.hidden = true;
  el.textContent = "";
  // classList.remove rather than resetting className outright - this
  // element also carries a dep-actual-time/arr-actual-time selector class
  // (see getCardEls()) that a full overwrite would silently strip on the
  // second render, leaving that card's lookup unable to find it again.
  el.classList.remove("early", "late");
  if (!scheduledDate || !currentDate) return;
  const diffMin = Math.round((currentDate.getTime() - scheduledDate.getTime()) / 60000);
  if (diffMin <= -3) {
    el.hidden = false;
    el.textContent = fmtTime(currentDate);
    el.classList.add("early");
  } else if (diffMin >= 3) {
    el.hidden = false;
    el.textContent = fmtTime(currentDate);
    el.classList.add("late");
  }
}

// T-minus/T-plus countdown against the scheduled departure: green "-N min"
// while still ahead of schedule, red "+N min" once that time has passed.
function renderTimerPill(f, statusEl) {
  if (f.isDeadhead) {
    statusEl.textContent = "DH";
    statusEl.className = "status-pill deadhead";
    return;
  }
  if (!f.depSchedDate) {
    statusEl.textContent = "–";
    statusEl.className = "status-pill";
    return;
  }
  const diffMin = Math.round((f.depSchedDate.getTime() - Date.now()) / 60000);
  if (diffMin > 0) {
    statusEl.textContent = `-${diffMin} min`;
    statusEl.className = "status-pill timer-before";
  } else {
    statusEl.textContent = `+${Math.abs(diffMin)} min`;
    statusEl.className = "status-pill timer-after";
  }
}

// The countdown-to-scheduled pill is only a stand-in for not yet knowing
// the real time - once AeroDataBox has actually resolved a current
// departure time (whether or not it's off enough from schedule to show
// as a deviation next to depTime/arrTime), it's redundant and goes away
// rather than sitting there next to more current information. Called for
// every card on each render/tick, so the pill doesn't reappear on a card
// after being hidden here.
function updateFlightTimerDisplay(f, ownLeg, statusEl) {
  // depRunwayDate only exists once AeroDataBox reports the aircraft has
  // actually left the blocks - a revised/estimated time alone (depDate)
  // isn't enough to retire the countdown, since that can change again
  // before departure actually happens.
  if (!f.isDeadhead && ownLeg && ownLeg.depRunwayDate) {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  renderTimerPill(f, statusEl);
}

// IATA airline designator (the leading 2 chars of the flight number, which
// can include a digit, e.g. "4Y") -> a styled badge instead of an actual
// logo image (avoids bundling trademarked logo assets into the repo).
// Covers Lufthansa Group carriers a Frankfurt-based pilot is likely to see
// on a deadhead; unrecognized prefixes fall back to the app's own accent
// color with the raw code.
//
// No ATC callsign here: an earlier version tried deriving it as
// ICAO-designator + the flight number's digits (e.g. "LH1557" ->
// "DLH1557"), which happened to match that one flight but is not a real
// rule - the pilot confirmed "LH1386" actually uses "DLH8KF" instead,
// an assigned callsign with no relation to the flight number. OpenAirLog
// has no callsign field either, so there's no reliable source for it at
// all; better to show nothing than a wrong callsign.
const AIRLINE_BY_PREFIX = {
  LH: { name: "Lufthansa", bg: "#05164d", fg: "#f9ba00" },
  LX: { name: "Swiss", bg: "#dc0018", fg: "#ffffff" },
  OS: { name: "Austrian Airlines", bg: "#c00d0d", fg: "#ffffff" },
  SN: { name: "Brussels Airlines", bg: "#00286e", fg: "#ffffff" },
  EW: { name: "Eurowings", bg: "#4b0a63", fg: "#ffffff" },
  "4Y": { name: "Eurowings Discover", bg: "#f5a623", fg: "#1c1c1c" },
};

// Updates the small header badge (which falls back to a plain dot - see
// .brand-airline-badge). Pass null when there's no current flight to show
// an airline for (e.g. Ortstag/Urlaub).
function renderAirlineBadge(flightNumber) {
  const prefix = (flightNumber || "").slice(0, 2).toUpperCase();

  if (!prefix) {
    els.brandAirlineBadge.classList.remove("has-airline");
    els.brandAirlineBadge.title = "";
    return;
  }

  const airline = AIRLINE_BY_PREFIX[prefix];
  const bg = airline ? airline.bg : "";
  const fg = airline ? airline.fg : "";
  const title = airline ? airline.name : prefix;

  els.brandAirlineBadge.classList.add("has-airline");
  els.brandAirlineBadgeCode.textContent = prefix;
  els.brandAirlineBadge.title = title;
  els.brandAirlineBadge.style.setProperty("--airline-bg", bg);
  els.brandAirlineBadge.style.setProperty("--airline-fg", fg);
}

// Cloned once per flight of the day into #flightCardTrack (see
// buildFlightCards()) - the inner fields are looked up by class rather
// than id, since (unlike the old single reused card) several copies of
// this template now exist in the DOM at once.
function getCardEls(node) {
  return {
    flightNumber: node.querySelector(".flight-number"),
    flightStatus: node.querySelector(".status-pill"),
    depCode: node.querySelector(".dep-code"),
    depTime: node.querySelector(".dep-time"),
    depActualTime: node.querySelector(".dep-actual-time"),
    arrCode: node.querySelector(".arr-code"),
    arrTime: node.querySelector(".arr-time"),
    arrActualTime: node.querySelector(".arr-actual-time"),
    aircraft: node.querySelector(".aircraft"),
    registration: node.querySelector(".registration"),
    transitInfo: node.querySelector(".transit-info"),
  };
}

// (Re)builds one card per today's flight into the horizontally scrollable
// track, plus a matching dot per card - only needed when the actual set
// of flights changes (see the signature check in renderFlight()), not on
// every re-render, so an AeroDataBox lookup resolving mid-scroll doesn't
// wipe the user's scroll position. When previewLayover is given (see
// previewLayoverFlight()), the real els.layoverCard is appended as one
// more trailing page + dot, moving it into this track exactly like
// buildLayoverCarousel() does for its own leading page - otherwise it's
// handed back to its native spot right after #crewCard (see
// renderLayover()), same place it sits on an ordinary day with no
// layover at all. Doing this move here, in the same pass that actually
// rebuilds the track, avoids a stray frame where the card would sit
// detached from both places while the DOM still catches up.
function buildFlightCards(previewLayover) {
  els.flightCardTrack.innerHTML = "";
  els.flightCardDots.innerHTML = "";
  state.cardNodes = state.flights.map(() => {
    const node = els.flightCardTemplate.content.firstElementChild.cloneNode(true);
    els.flightCardTrack.appendChild(node);
    const dot = document.createElement("span");
    dot.className = "dot";
    els.flightCardDots.appendChild(dot);
    return node;
  });
  if (previewLayover) {
    els.flightCardTrack.appendChild(els.layoverCard);
    const layoverDot = document.createElement("span");
    layoverDot.className = "dot";
    els.flightCardDots.appendChild(layoverDot);
  } else if (els.layoverCard.previousElementSibling !== els.crewCard) {
    els.crewCard.after(els.layoverCard);
  }
}

function scrollTrackToIndex(index) {
  const track = els.flightCardTrack;
  if (!track.clientWidth) return;
  track.scrollTo({ left: index * track.clientWidth, behavior: "auto" });
}

// A flex row's own height defaults to its tallest child no matter how the
// (shorter) others are cross-aligned - align-items:flex-start (see
// style.css) stops those shorter pages' content from being stretched, but
// left the track itself still as tall as the tallest page (e.g. the
// Layover card), leaving a blank gap below a shorter page's own content
// before #flightCardDots/#crewCard. Pinning the track's height to just the
// currently active page closes that gap, so the dots/crew card sit right
// under whatever page is actually visible. Called after every render pass
// and every settled scroll (see the two renderActive*Extras() and the
// flightCardTrack "scroll" listener below).
//
// The active page's own content can also still grow after that (e.g. the
// Layover card's currency/weather sections filling in once their own
// fetch resolves, well after the page first rendered) without any of
// those call sites re-running this - so the currently active node is kept
// under a live ResizeObserver that re-measures on any such change, rather
// than that being something every present and future async content
// source would need to remember to trigger itself.
const trackHeightObserver = new ResizeObserver(() => updateTrackHeight());
let observedTrackNode = null;

function updateTrackHeight() {
  const track = els.flightCardTrack;
  if (track.hidden) return;
  const node = state.mode === "layover"
    ? (state.layoverPageIndex === 0 ? els.layoverCard : state.layoverCardNodes[state.layoverPageIndex - 1])
    : (state.index === state.flights.length ? els.layoverCard : state.cardNodes[state.index]);
  if (node !== observedTrackNode) {
    if (observedTrackNode) trackHeightObserver.unobserve(observedTrackNode);
    if (node) trackHeightObserver.observe(node);
    observedTrackNode = node;
  }
  track.style.height = node ? `${node.offsetHeight}px` : "";
}

// Computed fallback pickup for a layover: rest starts 30 min after
// scheduled arrival (post-flight duties), pickup is 60 min before the
// next flight's own departure - checked across the whole loaded
// rotation (adjacentFlight()), not just today, since the next flight is
// often tomorrow's. Used wherever a layover is shown - the last flight's
// own transit line, and the separate Layover card once that takes over -
// whenever there's no MyTime roster pickup to show instead.
function findRosterPickupForFlight(flight) {
  if (!getRosterUrl()) return null;
  // Fires the fetch itself (ensureRosterLoaded() dedupes against an
  // already-cached URL or an in-flight request, so calling this on every
  // render pass costs nothing once loaded) - without this, a layover
  // shown ahead of time on the last flight card's own transit line (not
  // yet the CURRENTLY active one, which is what triggers the roster load
  // via resolveLayoverPickup()/renderLayover() instead) never got the
  // roster fetched at all until the pilot happened to tap refresh, stuck
  // showing computeLegalRestReference()'s estimate indefinitely until then.
  if (!rosterEventsCache.events) ensureRosterLoaded();
  if (!rosterEventsCache.events) return null;
  const arr = flight.arrActualDate || flight.arrSchedDate;
  if (!arr) return null;
  return findRosterPickup(rosterEventsCache.events, flight.arrCode, arr);
}

// The "Ruhezeit" (rest) duration always shown next to a layover is always
// this - even once a real MyTime roster Pickup event also exists (see
// findRosterPickupForFlight()) - because rest itself doesn't end at
// pickup: it ends at report time for the next known duty (that flight's
// own departure minus STANDARD_REPORT_BEFORE_DEP_MIN), same convention
// computeMaxLegalOnBlock() uses on the FDP side. Pickup usually happens
// somewhat before report (to allow for hotel/airport transfer), so it's
// a separate, purely logistical fact - the roster's own real Pickup time
// is shown for that (see renderFlightCardTransit()/renderLayover()), but
// never substituted in here. Always floored by the legal minimum rest
// (see computeMinRestAfterDuty(), itself always the stricter/longer of
// MTV and EASA) so it can never show less rest than the law actually
// requires - and is that legal minimum outright whenever the next flight
// isn't known yet at all. Returns null only when today's own duty day
// can't be determined at all.
function computeLegalRestReference(flight) {
  const minRest = computeMinRestAfterDuty(flight);
  if (!minRest) return null;

  // Rest doesn't end at pickup itself - it runs up to report time for the
  // next duty (STANDARD_REPORT_BEFORE_DEP_MIN before that flight's own
  // departure, same convention computeMaxLegalOnBlock() uses on the FDP
  // side), and pickup is set to land exactly there once the next flight is
  // actually known. Never earlier than the legal minimum rest above,
  // though (MTV/EASA, whichever's stricter) - and when no onward flight
  // is loaded yet at all, that legal minimum is all there is to go on.
  const onward = adjacentFlight(flight, 1);
  const onwardDep = onward && (onward.depSchedDate || onward.depActualDate);
  let pickupUtc = onwardDep
    ? new Date(onwardDep.getTime() - STANDARD_REPORT_BEFORE_DEP_MIN * 60000)
    : minRest.earliestPickupUtc;
  if (minRest.earliestPickupUtc > pickupUtc) pickupUtc = minRest.earliestPickupUtc;

  // minRest.source is which regulation's own minimum is the stricter one
  // for this duty (shown alongside the rest duration itself, same
  // "(MTV)"/"(EASA)" convention as the crew list's own legalOnBlockLabel) -
  // still meaningful even when the actual rest above ends up longer than
  // that minimum (the report-time-based case above), since it says which
  // rule this rest is being checked against, not just which one it
  // happened to equal.
  const restMinutes = (pickupUtc - minRest.restStart) / 60000;
  return {
    pickupUtc,
    restLabel: fmtDurationHM(pickupUtc - minRest.restStart),
    source: minRest.source,
    restMinutes,
    minMinutes: minRest.minMinutes,
  };
}

// Roster event first (see findRosterPickupForFlight()), the
// reference-sheet backup estimate (see computeLegalRestReference()) only
// once that has nothing - but only for layoverPickupCutoffPassed()'s own
// internal bookkeeping below (when to structurally drop the Layover page
// even without a real roster pickup ever showing up), never for display:
// the Layover card's own pickup line (see fillLayoverCardContent()) and
// the transit line (see renderFlightCardTransit()) both show a Pickup
// time only when the roster genuinely has one - a guessed clock time
// isn't something the pilot can actually rely on, so it's left blank
// instead rather than shown as if it were real.
function resolveLayoverPickup(layover) {
  if (!layover || !layover.flight) return null;
  const pickup = findRosterPickupForFlight(layover.flight);
  if (pickup) return { utc: pickup.dtstart, label: `${pickup.time} LT`, isBackup: false };
  const backup = computeLegalRestReference(layover.flight);
  if (!backup) return null;
  const label = fmtLocalTimeAtIcao(backup.pickupUtc, layover.arrCode) || fmtTime(backup.pickupUtc);
  return { utc: backup.pickupUtc, label, isBackup: true };
}

// Once the crew's actually been picked up, the Layover page has done its
// job - dropped from the flight-card carousel (see renderFlight()) 5
// minutes after the resolved pickup time. This is the only rule for when
// the Layover page goes away (an earlier fixed "2h before the next
// departure" cutoff in findApiLayover() was removed as redundant/wrong -
// pickup is what actually ends the layover, not a fixed lead time before
// departure). With no pickup time known at all (neither roster nor
// backup), there's nothing to count down from, so the page just isn't
// force-dropped this way and keeps showing until findApiLayover() itself
// lets go of it (e.g. once a next flight's own data no longer looks like
// a layover at all).
const LAYOVER_PAGE_DROP_AFTER_PICKUP_MS = 5 * 60 * 1000;
function layoverPickupCutoffPassed(layover) {
  const pickup = resolveLayoverPickup(layover);
  return !!(pickup && pickup.utc && Date.now() - pickup.utc.getTime() >= LAYOVER_PAGE_DROP_AFTER_PICKUP_MS);
}

// Transit to the next own flight and, on a Flugzeugwechsel (its
// registration differs from this one's), which aircraft that is - plus,
// when an AeroDataBox key is configured, when that aircraft is scheduled
// to arrive from whatever it flew right before (see
// ensureAircraftScheduleLoaded()/findPriorLegArrival()). Every card has
// its own transit line (about its own next flight), but only the active
// one is allowed to trigger AeroDataBox lookups - scrolling past several
// cards shouldn't fire off a lookup for each.
function renderFlightCardTransit(flights, i, isActive, cardEls) {
  const f = flights[i];
  const nextFlight = flights[i + 1];

  // Last flight of the day: no more flights today to transit into, but if
  // this landing isn't back at home base, it's a layover - show that
  // instead of leaving the line blank. Pickup is shown only when the
  // MyTime roster actually has a matching event (see
  // findRosterPickupForFlight()) - no more reference-sheet estimate as a
  // fallback (that used to fill in a guessed clock time, which the pilot
  // couldn't actually rely on); with no roster match, Pickup is simply
  // left out rather than showing a number that isn't real.
  if (!nextFlight) {
    if (f.arrCode === HOME_BASE) {
      cardEls.transitInfo.hidden = true;
      cardEls.transitInfo.textContent = "";
      return;
    }
    // "RZ" is the legal rest DURATION (report time for the next duty,
    // floored by MTV/EASA's own minimum, minus the end of the arriving
    // duty) - regardless of whether a MyTime roster Pickup event also
    // exists. See computeLegalRestReference()'s own comment. Colored
    // orange once it's within RZ_TIGHT_MARGIN_MIN of that minimum, red if
    // it's ever actually below it (shouldn't happen given
    // computeLegalRestReference()'s own flooring, but the display still
    // guards against it). "Fahrzeit" is only the gap between the
    // roster's real Pickup and that report time (the transfer time to
    // the hotel) - shown when a roster pickup is known and happens
    // before report time.
    const restRef = computeLegalRestReference(f);
    const pickup = findRosterPickupForFlight(f);

    const pickupLabel = pickup ? `Pickup: ${pickup.time} LT` : null;
    const travelLabel = pickup && restRef && pickup.dtstart < restRef.pickupUtc
      ? `Fahrzeit: ${fmtDurationHM(restRef.pickupUtc - pickup.dtstart)}`
      : null;

    cardEls.transitInfo.hidden = false;
    cardEls.transitInfo.textContent = "";
    const segments = [];
    if (restRef && restRef.restLabel) {
      const margin = restRef.restMinutes - restRef.minMinutes;
      const rzClass = margin < 0 ? "rz-illegal" : margin <= RZ_TIGHT_MARGIN_MIN ? "rz-tight" : null;
      const rzSpan = document.createElement("span");
      if (rzClass) rzSpan.className = rzClass;
      rzSpan.textContent = `RZ ${restRef.restLabel} (${restRef.source})`;
      segments.push(rzSpan);
    }
    if (travelLabel) segments.push(document.createTextNode(travelLabel));
    if (pickupLabel) segments.push(document.createTextNode(pickupLabel));
    segments.forEach((node, idx) => {
      if (idx > 0) cardEls.transitInfo.appendChild(document.createTextNode(" · "));
      cardEls.transitInfo.appendChild(node);
    });
    return;
  }

  const transitLabel = fmtDurationHM(nextFlight.depSchedDate - f.arrSchedDate);

  // OpenAirLog's registration is missing on some future-dated entries -
  // when that happens for the next flight, fall back to looking it up by
  // its own flight number via AeroDataBox instead (see
  // ensureFlightByNumberLoaded()), which also backfills the registration
  // itself, so everything below works the same either way.
  let nextRegistration = nextFlight && nextFlight.registration !== "–" ? nextFlight.registration : null;
  if (transitLabel && !nextRegistration && getAeroDataBoxKey() && nextFlight.flightNumber) {
    const dateKey = nextFlight.raw && nextFlight.raw.date;
    const cacheKey = `${nextFlight.flightNumber}|${dateKey}`;
    const cachedByNumber = flightByNumberCache.get(cacheKey);
    if (!cachedByNumber) {
      if (isActive) ensureFlightByNumberLoaded(nextFlight.flightNumber, dateKey);
    } else if (cachedByNumber.leg) {
      nextRegistration = cachedByNumber.leg.registration || null;
    }
  }

  const aircraftChange = transitLabel && nextRegistration && f.registration &&
    f.registration !== "–" && nextRegistration !== f.registration;

  let transitText = transitLabel ? `Transit: ${transitLabel}` : "";
  if (aircraftChange) {
    transitText += ` · next A/C ${nextRegistration}`;
    if (getAeroDataBoxKey()) {
      const cached = aircraftScheduleCache.get(nextRegistration);
      if (!cached) {
        if (isActive) ensureAircraftScheduleLoaded(nextRegistration);
      } else {
        const priorLeg = findPriorLegArrival(cached.legs, nextFlight.depCode, nextFlight.depSchedDate);
        if (priorLeg && priorLeg.arrDate) transitText += ` ${priorLeg.flightNumber} ${fmtTime(priorLeg.arrDate)}`;
      }
    }
  }
  cardEls.transitInfo.hidden = !transitText;
  cardEls.transitInfo.textContent = transitText;
}

// Fills one card's content. Only the active (currently scrolled-to) card
// is allowed to trigger AeroDataBox lookups (getOwnFlightAeroDataBoxLeg's
// peekOnly) - the others show whatever's already cached from an earlier
// visit, so simply having several cards in the DOM doesn't multiply the
// API quota this uses. Takes an explicit flights/cardNodes array pair
// rather than always reading state.flights/state.cardNodes, so the same
// rendering logic serves both the ordinary flight-card carousel and the
// Layover card's own attached carousel (see renderLayoverCarousel()),
// which draws its cards from a different day's sectors entirely.
function renderFlightCardContent(flights, cardNodes, i, isActive) {
  const f = flights[i];
  const cardEls = getCardEls(cardNodes[i]);

  // Callsign in parentheses, e.g. "LH1168 (DLH03H)" - only here in the
  // main flight card, not in the crew list's inbound/outbound labels or
  // the transit line, which are about other flights, not this one.
  const ownLeg = getOwnFlightAeroDataBoxLeg(f, { peekOnly: !isActive });
  cardEls.flightNumber.textContent = ownLeg && ownLeg.callSign ? `${f.flightNumber} (${ownLeg.callSign})` : f.flightNumber;
  updateFlightTimerDisplay(f, ownLeg, cardEls.flightStatus);

  cardEls.depCode.textContent = f.depCode;
  cardEls.arrCode.textContent = f.arrCode;
  cardEls.depTime.textContent = fmtTime(f.depSchedDate);
  cardEls.arrTime.textContent = fmtTime(f.arrSchedDate);
  renderTimeDeviation(cardEls.depActualTime, f.depSchedDate, ownLeg && ownLeg.depDate);
  renderTimeDeviation(cardEls.arrActualTime, f.arrSchedDate, ownLeg && ownLeg.arrDate);

  cardEls.aircraft.textContent = f.aircraft;
  cardEls.registration.textContent = f.registration;

  renderFlightCardTransit(flights, i, isActive, cardEls);
}

// Identifies today's flight list by flight number + date only (not
// times/registration, which can change on the same flight via a roster
// refresh) - used to tell whether the cards actually need rebuilding
// (added/removed/reordered flight) or just a content refresh in place.
function flightsSignature(flights) {
  return flights.map((f) => `${f.flightNumber}@${(f.raw && f.raw.date) || ""}`).join("|");
}
let lastCardSignature = null;

// Whichever flight the carousel is currently scrolled to - re-renders its
// content (promoting it to "active", so its own AeroDataBox lookups are
// now allowed) plus everything below the cards that follows the current
// flight (crew, airline badge, dots).
function renderActiveFlightExtras() {
  renderFlightDots();
  updateTrackHeight();
  // The attached Layover preview page (see previewLayoverFlight()) sits
  // one index past the real flights - its own content is already kept
  // current every render pass by fillLayoverCardContent() regardless of
  // which page is scrolled into view (same as the dedicated Layover
  // carousel), so scrolling onto it only needs the crew card/badge to
  // follow, same as landing on the Layover carousel's own page 0.
  if (state.index === state.flights.length && state.previewLayover) {
    els.crewCard.hidden = true;
    renderAirlineBadge(state.previewLayover.flight ? state.previewLayover.flight.flightNumber : null);
    return;
  }
  const f = state.flights[state.index];
  if (!f) return;
  renderFlightCardContent(state.flights, state.cardNodes, state.index, true);
  renderAirlineBadge(f.flightNumber);
  renderCrew(f);
  ensureCrewLoaded(f);
}

function renderFlight() {
  // 30+ min after today's last flight lands back at home base, show the
  // Ortstag-style duty status view instead of the (by then stale-feeling)
  // completed flight card - see shouldShowPostLandingHomeView(). And while
  // still genuinely in a layover (findApiLayover()) and less than
  // LAYOVER_PAGE_DROP_AFTER_PICKUP_MS past pickup - the only rule for when
  // the layover ends, see layoverPickupCutoffPassed() - the layover isn't
  // mixed into today's own flight-card carousel (state.flights, which
  // can span an unrelated multi-day rotation) - instead it gets its own
  // carousel, leading with the Layover card itself and followed by the
  // checkout day's own sectors (see renderLayoverCarousel()).
  const layover = effectiveDutyType() ? null : findApiLayover(state.allFlights);
  const layoverActive = !!layover && !layoverPickupCutoffPassed(layover);

  if (layoverActive) {
    state.mode = "layover";
    els.crewCard.hidden = true; // renderLayoverCarousel() below shows/hides it itself once it knows which page is active
    els.dutyStatusCard.hidden = true;
    renderAirlineBadge(layover.flight ? layover.flight.flightNumber : null);
    renderLayoverCarousel(layover);
    return;
  }

  // Not (or no longer) officially in a layover - make sure the Layover
  // card itself is marked hidden and back at its native spot in the
  // document (see renderLayover()), then fall through to the ordinary
  // flight-card/Ortstag logic. previewLayoverFlight() below may still
  // re-show and re-attach it as a look-ahead page once today's last
  // flight has departed, ahead of the official switch-over above.
  renderLayover();
  state.mode = "flights";

  const showFlightCard = !!state.flights.length && !shouldShowPostLandingHomeView();
  els.flightCardTrack.hidden = !showFlightCard;
  els.crewCard.hidden = !showFlightCard;

  if (!showFlightCard) {
    els.flightCardDots.hidden = true;
    renderAirlineBadge(null);
    renderDutyStatus();
    return;
  }
  els.dutyStatusCard.hidden = true;

  const previewLayover = previewLayoverFlight();
  state.previewLayover = previewLayover;
  // Safety clamp for the rare case the attached preview page itself goes
  // away without the flight set changing (e.g. an onward flight loads in
  // and turns out to make this a same-day connection after all, not a
  // real layover) while the carousel happened to be scrolled onto it -
  // same idea as the tick's own state.index reset when the flight set
  // itself changes (see the setInterval() below).
  const maxIndex = state.flights.length - 1 + (previewLayover ? 1 : 0);
  if (state.index > maxIndex) state.index = maxIndex;
  const signature = flightsSignature(state.flights) + (previewLayover ? "|LAYOVER" : "");
  const rebuilt = signature !== lastCardSignature;
  if (rebuilt) {
    buildFlightCards(previewLayover);
    lastCardSignature = signature;
  }

  state.flights.forEach((flight, i) => renderFlightCardContent(state.flights, state.cardNodes, i, i === state.index));
  // renderLayover() above already filled/unhid els.layoverCard when
  // previewLayover applies - just needs moving into the track here (see
  // buildFlightCards()) once the page structure itself changes.
  if (rebuilt) scrollTrackToIndex(state.index);
  els.flightCardDots.hidden = state.flights.length + (previewLayover ? 1 : 0) <= 1;
  renderFlightDots();
  updateTrackHeight();

  if (state.index === state.flights.length && previewLayover) {
    els.crewCard.hidden = true;
    renderAirlineBadge(previewLayover.flight ? previewLayover.flight.flightNumber : null);
    return;
  }
  const f = state.flights[state.index];
  if (!f) return;
  renderAirlineBadge(f.flightNumber);
  renderCrew(f);
  ensureCrewLoaded(f);
}

function crewKey(role, name) {
  return `${role.toUpperCase()}|${firstNameOf(name)}`;
}

// ---------- EASA max Flight Duty Period (ORO.FTL.205, Table 2) ----------
//
// Maximum daily FDP for an acclimatised crew member, by local start-of-FDP
// time band and number of sectors (columns: 1-2, 3, 4, 5, 6, 7, 8, 9, 10+),
// in minutes. Bands cover the full 24h with no gaps; 0000-0459 and
// 1700-2359 share the same (last) row since the regulation itself treats
// 1700-0459 as one continuous band.
const EASA_FDP_BANDS = [
  { start: 0, end: 299, max: [660, 630, 600, 570, 540, 540, 540, 540, 540] }, // 0000-0459 (=1700-0459)
  { start: 300, end: 314, max: [720, 690, 660, 630, 600, 570, 540, 540, 540] }, // 0500-0514
  { start: 315, end: 329, max: [735, 705, 675, 645, 615, 585, 555, 540, 540] }, // 0515-0529
  { start: 330, end: 344, max: [750, 720, 690, 660, 630, 600, 570, 540, 540] }, // 0530-0544
  { start: 345, end: 359, max: [765, 735, 705, 675, 645, 615, 585, 555, 540] }, // 0545-0559
  { start: 360, end: 809, max: [780, 750, 720, 690, 660, 630, 600, 570, 540] }, // 0600-1329
  { start: 810, end: 839, max: [765, 735, 705, 675, 645, 615, 585, 555, 540] }, // 1330-1359
  { start: 840, end: 869, max: [750, 720, 690, 660, 630, 600, 570, 540, 540] }, // 1400-1429
  { start: 870, end: 899, max: [735, 705, 675, 645, 615, 585, 555, 540, 540] }, // 1430-1459
  { start: 900, end: 929, max: [720, 690, 660, 630, 600, 570, 540, 540, 540] }, // 1500-1529
  { start: 930, end: 959, max: [705, 675, 645, 615, 585, 555, 540, 540, 540] }, // 1530-1559
  { start: 960, end: 989, max: [690, 660, 630, 600, 570, 540, 540, 540, 540] }, // 1600-1629
  { start: 990, end: 1019, max: [675, 645, 615, 585, 555, 540, 540, 540, 540] }, // 1630-1659
  { start: 1020, end: 1439, max: [660, 630, 600, 570, 540, 540, 540, 540, 540] }, // 1700-2359
];

// The pilot's home base is Germany, so "acclimatised local time" is taken
// as Europe/Berlin (same assumption fmtLocalTime() already makes) - this
// doesn't implement the full EASA acclimatisation tables (elapsed time
// since departing a reference time zone, time zones crossed on previous
// duties), which this app has no duty history to evaluate anyway. Good
// enough for the common case (rotation starts and ends at EDDF); not a
// substitute for the airline's own FTL system on anything unusual
// (long-haul, multi-day time zone hopping, reduced rest, split duty).
function localMinuteOfDayBerlin(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  let hh = Number(parts.find((p) => p.type === "hour").value);
  const mm = Number(parts.find((p) => p.type === "minute").value);
  if (hh === 24) hh = 0; // some engines print midnight as "24:00"
  return hh * 60 + mm;
}

// Maximum FDP in minutes for a report time (local minute-of-day) and
// sector count, per EASA_FDP_BANDS - sectors 1-2 share column 0, 10+
// shares the last column.
function easaMaxFdpMinutes(reportLocalMin, sectorCount) {
  const band = EASA_FDP_BANDS.find((b) => reportLocalMin >= b.start && reportLocalMin <= b.end);
  if (!band) return null;
  const colIdx = sectorCount <= 2 ? 0 : Math.min(sectorCount - 2, band.max.length - 1);
  return band.max[colIdx];
}

// ---------- DLH MTV Nr. 6 (Manteltarifvertrag Nr. 6), § 4 2. Abschnitt
// Abs. (2), table for Umlaufbeginn ab 01.01.2024 ----------
//
// The airline's own collective agreement caps daily FDP more tightly than
// bare EASA Table 2 in most bands, and stops at 5 sectors rather than 10+
// (more than 5 landings in one shift isn't plannable at all under Abs.
// (3), so a day with more sectors than that has no defined MTV value -
// null, same as an "X" cell in the printed table, i.e. not permitted at
// this start time regardless of FDP length). Columns: 1-2, 3, 4, 5
// sectors. Doesn't model Abs. (5)/(5a)'s FDP extensions (limited per
// 7-day period, needs specific rest before/after) - like the EASA side,
// this is the base table only, not every exception.
const MTV_FDP_BANDS = [
  { start: 0, end: 239, max: [630, 570, null, null] }, // 22:00-03:59 (wraps midnight)
  { start: 240, end: 299, max: [630, 600, 570, null] }, // 04:00-04:59
  { start: 300, end: 314, max: [720, 630, 630, 450] }, // 05:00-05:14
  { start: 315, end: 329, max: [735, 630, 630, 450] }, // 05:15-05:29
  { start: 330, end: 344, max: [750, 630, 630, 600] }, // 05:30-05:44
  { start: 345, end: 359, max: [750, 675, 645, 615] }, // 05:45-05:59
  { start: 360, end: 419, max: [750, 720, 690, 660] }, // 06:00-06:59
  { start: 420, end: 809, max: [780, 720, 690, 660] }, // 07:00-13:29
  { start: 810, end: 839, max: [765, 705, 675, 645] }, // 13:30-13:59
  { start: 840, end: 869, max: [750, 690, 660, 600] }, // 14:00-14:29
  { start: 870, end: 899, max: [735, 660, 645, 585] }, // 14:30-14:59
  { start: 900, end: 929, max: [720, 630, 615, 570] }, // 15:00-15:29
  { start: 930, end: 959, max: [705, 615, 600, 555] }, // 15:30-15:59
  { start: 960, end: 989, max: [690, 615, 600, 540] }, // 16:00-16:29
  { start: 990, end: 1019, max: [675, 600, 585, 450] }, // 16:30-16:59
  { start: 1020, end: 1319, max: [630, 600, 570, null] }, // 17:00-21:59
  { start: 1320, end: 1439, max: [630, 570, null, null] }, // 22:00-23:59 (wraps to start:0)
];

// Same shape as easaMaxFdpMinutes(), against the MTV table instead -
// returns null both when the start time falls outside the table (can't
// happen, it covers 24h) and when the cell for this many sectors is "X"
// (not permitted at this start time under the Tarifvertrag, see
// MTV_FDP_BANDS's comment). More than 5 sectors reuses the 5-sector
// column, the most restrictive one actually defined.
function mtvMaxFdpMinutes(reportLocalMin, sectorCount) {
  const band = MTV_FDP_BANDS.find((b) => reportLocalMin >= b.start && reportLocalMin <= b.end);
  if (!band) return null;
  const colIdx = sectorCount <= 2 ? 0 : Math.min(sectorCount - 2, band.max.length - 1);
  return band.max[colIdx];
}

// Standard report time before the first sector's scheduled departure -
// OpenAirLog has no explicit report-time field, so this assumes the
// pilot's own narrowbody (A320-family) standard briefing time. Confirmed
// against a real eFF FDP screen (rotation 225280, LH839 dep. 12:45Z): both
// the FDP MTV and FDP LAW tables' own COC and 1PU+2FB rows back-solve to
// the exact same 11:45Z start - i.e. 60 minutes before departure, not 45.
// Still wrong for a different aircraft type or a rotation with a
// non-standard report time - this is the pilot's own fleet default, not a
// universal constant.
const STANDARD_REPORT_BEFORE_DEP_MIN = 60;

// All of a flight's own duty-day sectors - grouped by OpenAirLog's own
// "date" field (the report/duty day it assigns each leg to), not a
// recomputed local calendar date, and searched across the whole loaded
// rotation (state.allFlights) rather than just today's (already-pruned)
// card list, so a flight retired from the swipe view (see
// FLIGHT_RETIRE_AFTER_ARRIVAL_MS) still counts as an earlier sector.
function sectorsForDutyDay(flight) {
  const dateKey = flight.raw && flight.raw.date;
  if (!dateKey) return [flight];
  return state.allFlights
    .filter((f) => f.raw && f.raw.date === dateKey)
    .sort((a, b) => (a.depSchedDate || 0) - (b.depSchedDate || 0));
}

// Latest legal on-block time for the LAST sector of this flight's duty
// day: report time (see STANDARD_REPORT_BEFORE_DEP_MIN) + the shorter of
// EASA's Table 2 (easaMaxFdpMinutes()) and the airline's own MTV Nr. 6
// table (mtvMaxFdpMinutes()) for that report time and the day's total
// sector count - whichever actually binds in practice, not both shown
// side by side. A simplified estimate either way (see
// localMinuteOfDayBerlin()'s comment) - not a substitute for the
// airline's own FTL system, and shown for information only. Always uses
// depSchedDate straight from OpenAirLog - never anything the MyTime
// roster feed might otherwise suggest instead (see ensureRosterLoaded()'s
// comment on why an earlier version of this app tried that and got it
// wrong), so this can't silently shift once a roster fetch resolves.
function computeMaxLegalOnBlock(flight) {
  const dutyDay = sectorsForDutyDay(flight);
  const first = dutyDay[0];
  if (!first || !first.depSchedDate) return null;
  const reportUtc = new Date(first.depSchedDate.getTime() - STANDARD_REPORT_BEFORE_DEP_MIN * 60000);
  const reportLocalMin = localMinuteOfDayBerlin(reportUtc);
  const easaMax = easaMaxFdpMinutes(reportLocalMin, dutyDay.length);
  const mtvMax = mtvMaxFdpMinutes(reportLocalMin, dutyDay.length);
  const candidates = [
    easaMax != null ? { min: easaMax, source: "EASA" } : null,
    mtvMax != null ? { min: mtvMax, source: "MTV" } : null,
  ].filter(Boolean);
  if (!candidates.length) return null;
  const strictest = candidates.reduce((a, b) => (b.min < a.min ? b : a));
  return {
    latestOnBlockUtc: new Date(reportUtc.getTime() + strictest.min * 60000),
    sectorCount: dutyDay.length,
    source: strictest.source,
  };
}

// ---------- Minimum rest away from the dienstlicher Wohnsitz (a
// mid-rotation layover) - DLH MTV Nr. 6, § 4, 4. Abschnitt Abs. (2) b)+e),
// and EASA ORO.FTL.235(b) ----------
//
// Confirmed against the real MTV Nr. 6 PDF text (Abs. (2) b): "Die
// Mindestruhezeiten... werden planmäßig unterwegs auf mindestens 12
// Stunden festgesetzt. Die Mindestruhezeit beträgt nach einer... geplanten
// Flugdienstzeit von mehr als 11 Stunden 12 Stunden und von mehr als 12
// Stunden 14 Stunden." - i.e. a flat 12h floor that only steps up to 14h
// once the day's own planned FDP itself exceeds 12h (the ">11h" clause
// restates the same 12h floor, so only the >12h step actually changes
// anything). This is Abs. (2)'s own "unterwegs" rule specifically - not
// Abs. (3)'s much larger return-to-home-base rest, which this app doesn't
// model (the Layover card/transit line are about an outstation overnight
// mid-rotation, never a return home).
const MTV_MIN_REST_BASE_MIN = 12 * 60;
const MTV_MIN_REST_EXTENDED_MIN = 14 * 60;
const MTV_MIN_REST_EXTENDED_THRESHOLD_MIN = 12 * 60;

// Same section, Abs. (2) e): a time-zone difference between where the
// preceding duty started and where it ended raises the minimum further,
// on top of (not instead of) the FDP-based floor above. Approximated as
// the whole-hour UTC offset difference between the two stations at
// utcOffsetDiffHours() - exact for any station pair actually on
// TIMEZONE_BY_ICAO (all within Europe so far, where a station's own
// standing offset is always a whole hour), though not literally the same
// thing as counting political time zones for a network this doesn't
// cover. In practice this pilot's own short/medium-haul European network
// never reaches the 4-zone threshold, so this rarely if ever changes
// anything - kept for correctness rather than because it's expected to
// bind.
const MTV_MIN_REST_TZ_BANDS = [
  { minZones: 8, min: 44 * 60 },
  { minZones: 6, min: 20 * 60 },
  { minZones: 4, min: 14 * 60 },
];

// EASA ORO.FTL.235(b): rest away from home base is at least as long as
// the preceding duty period, or 10 hours, whichever is greater. No fixed
// EU-wide time-zone extension the way MTV's own table spells out
// (ORO.FTL.235(c)'s jet-lag/acclimatisation provisions are qualitative
// guidance material, not a numeric lookup) - so, same spirit as
// easaMaxFdpMinutes()'s own acclimatisation caveat, this is the base rule
// only.
const EASA_MIN_REST_BASE_MIN = 10 * 60;

// How close the actual (report-time-based) rest is allowed to get to the
// legal minimum before the displayed "RZ" duration turns orange as a
// warning - red if it's ever actually below the minimum (shouldn't happen
// given computeLegalRestReference()'s own flooring, but the display still
// guards against it). See renderFlightCardTransit()'s RZ span.
const RZ_TIGHT_MARGIN_MIN = 30;

// Whole-hour UTC offset difference between two ICAO stations at a given
// instant (DST-aware, via each station's own IANA zone) - null when
// either station isn't on TIMEZONE_BY_ICAO, so the caller just skips the
// time-zone extension rather than guessing.
function utcOffsetDiffHours(icaoA, icaoB, at) {
  const tzA = TIMEZONE_BY_ICAO[icaoA];
  const tzB = TIMEZONE_BY_ICAO[icaoB];
  if (!tzA || !tzB || !at) return null;
  const offsetOf = (tz) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
    const raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = /GMT([+-]\d{1,2})/.exec(raw);
    return m ? Number(m[1]) : null;
  };
  const oa = offsetOf(tzA);
  const ob = offsetOf(tzB);
  return oa != null && ob != null ? Math.abs(oa - ob) : null;
}

// Earliest legally permitted pickup after this flight's own duty day ends
// - the stricter (longer) of MTV's and EASA's own minimum rest, same
// "whichever actually binds" pattern as computeMaxLegalOnBlock(). Rest
// itself never starts before the last sector's own arrival + 30 min
// Abschlussarbeiten (MTV § 4, 4. Abschnitt Abs. (1) a, referencing § 4, 1.
// Abschnitt Abs. (1) lit i) - the same 30-minute buffer
// computeLegalRestReference() already uses for its own restLabel. "Planned FDP"
// for both rules is the whole duty day's own report-to-last-onblock span
// (sectorsForDutyDay()) - confirmed against a real eFF RT screen (MTV
// 12:00, LAW 10:00, for an 08:35 planned FDP day) matching to the minute.
function computeMinRestAfterDuty(flight) {
  const dutyDay = sectorsForDutyDay(flight);
  const first = dutyDay[0];
  const last = dutyDay[dutyDay.length - 1];
  if (!first || !first.depSchedDate || !last || !last.arrSchedDate) return null;
  const reportUtc = new Date(first.depSchedDate.getTime() - STANDARD_REPORT_BEFORE_DEP_MIN * 60000);
  const restStart = new Date(last.arrSchedDate.getTime() + 30 * 60000);
  const plannedFdpMin = (last.arrSchedDate.getTime() - reportUtc.getTime()) / 60000;

  let mtvMin = plannedFdpMin > MTV_MIN_REST_EXTENDED_THRESHOLD_MIN ? MTV_MIN_REST_EXTENDED_MIN : MTV_MIN_REST_BASE_MIN;
  const zones = utcOffsetDiffHours(first.depCode, last.arrCode, last.arrSchedDate);
  if (zones != null) {
    const tzBand = MTV_MIN_REST_TZ_BANDS.find((b) => zones >= b.minZones);
    if (tzBand) mtvMin = Math.max(mtvMin, tzBand.min);
  }
  const easaMin = Math.max(plannedFdpMin, EASA_MIN_REST_BASE_MIN);

  const strictest = mtvMin >= easaMin ? { min: mtvMin, source: "MTV" } : { min: easaMin, source: "EASA" };
  return {
    earliestPickupUtc: new Date(restStart.getTime() + strictest.min * 60000),
    restStart,
    source: strictest.source,
    minMinutes: strictest.min,
  };
}

// "inbound" (joining, OpenAirLog-fallback case): the pilot's own previous
// flight, formatted the exact same "LHxxx <time>" way as a colleague's own
// PDF Ex reference does (see buildPdfRefMap()/formatExRefLabelLive()) - the
// live AeroDataBox onblock time when a key is configured, since that
// reflects this exact occurrence's actual/revised arrival rather than
// whatever OpenAirLog itself last recorded, falling back to OpenAirLog's
// own arrival time only when no AeroDataBox key is set. Used identically
// regardless of which crew source (OpenAirLog vs PDF) is currently
// displayed - see renderCrew() - so a joining colleague's info reads the
// same either way whenever they have no more specific PDF ref of their own.
function ownAdjacentFlightLiveLabel(flight) {
  if (!flight) return null;
  const dateKey = flight.raw && flight.raw.date;
  if (getAeroDataBoxKey() && dateKey) {
    const cacheKey = `${flight.flightNumber}|${dateKey}`;
    const cached = flightByNumberCache.get(cacheKey);
    if (!cached) ensureFlightByNumberLoaded(flight.flightNumber, dateKey);
    if (cached && cached.leg) return formatExRefLabelLive(flight.flightNumber, cached.leg);
  }
  const arr = flight.arrActualDate || flight.arrSchedDate;
  return arr ? `${flight.flightNumber} ${fmtTime(arr)}` : flight.flightNumber;
}

// "outbound" (leaving, OpenAirLog-fallback case) only needs the flight
// number and its departure time - already known locally (this is our own
// adjacent flight from OpenAirLog, not a lookup).
function nextFlightRefLabel(flight) {
  if (!flight) return null;
  return `${flight.flightNumber} ${fmtTime(flight.depSchedDate)}`;
}

// Deadheading covers both OpenAirLog crew (see normalizeCrewMember()'s
// isDeadhead) and a PDF crew list, which marks the same thing directly in
// the role text. Someone deadheading isn't actually working that flight,
// so they don't count as "still there" for findLeavingCrew()/
// findJoiningCrew() either - a colleague who leaves the operating crew
// today but only rides along DH tomorrow has genuinely left, not stayed
// on, even though their name still appears on tomorrow's crew list.
function isOperatingCrewMember(member) {
  return !member.isDeadhead && String(member.role || "").toUpperCase() !== "DH";
}

function renderCrewMembers(listEl, crew, opts = {}) {
  const {
    leaving = new Set(), joining = new Set(),
    leavingInfo = null, joiningInfo = null,
    pdfExRefs = new Map(), pdfToRefs = new Map(),
    ownName = "", legalOnBlockLabel = null,
  } = opts;
  listEl.innerHTML = "";
  for (const member of crew) {
    // Deadheading colleagues aren't working this flight - see
    // isOperatingCrewMember().
    if (!isOperatingCrewMember(member)) continue;
    const key = crewKey(member.role, member.name);
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = member.name;
    const isJoining = joining.has(key);
    const isLeaving = leaving.has(key);

    // Both arrows sit right next to the name first, with their
    // explanations stacked below (each still starting with its own arrow
    // symbol, since they're no longer directly next to it) - rather than
    // interleaving arrow/explanation/arrow/explanation, which pushed the
    // second arrow onto its own line once the first explanation's block
    // display forced a break.
    if (isJoining) {
      const arrow = document.createElement("span");
      arrow.className = "crew-joining";
      arrow.textContent = " ←";
      arrow.title = "Neu in der Crew ab diesem Flug";
      name.appendChild(arrow);
    }
    if (isLeaving) {
      const arrow = document.createElement("span");
      arrow.className = "crew-leaving";
      arrow.textContent = " →";
      arrow.title = "Verlässt die Crew nach diesem Flug";
      name.appendChild(arrow);
    }
    if (isJoining) {
      // Prefer the PDF's own "Ex" column when available - it's about this
      // specific colleague's own routing, not just our own neighboring
      // flight, which is all the OpenAirLog-only fallback can offer.
      const pdfRef = pdfExRefs.get(key);
      const info = document.createElement("span");
      info.className = "crew-arrow-info";
      if (pdfRef) info.textContent = `← inbound ${pdfRef}`;
      else if (joiningInfo) info.textContent = `← inbound ${joiningInfo}`;
      if (info.textContent) name.appendChild(info);
    }
    if (isLeaving) {
      const pdfRef = pdfToRefs.get(key);
      const info = document.createElement("span");
      info.className = "crew-arrow-info";
      if (pdfRef) info.textContent = `→ outbound ${pdfRef}`;
      else if (leavingInfo) info.textContent = `→ outbound ${leavingInfo}`;
      if (info.textContent) name.appendChild(info);
    }
    // Only ever appended to the pilot's own entry, never a colleague's -
    // see computeMaxLegalOnBlock().
    if (legalOnBlockLabel && isOwnName(member.name, ownName)) {
      const info = document.createElement("span");
      info.className = "crew-fdp-info";
      info.textContent = legalOnBlockLabel;
      name.appendChild(info);
    }
    const role = document.createElement("span");
    role.className = "crew-role";
    role.textContent = member.role;
    li.appendChild(name);
    li.appendChild(role);
    listEl.appendChild(li);
  }
}

// The flight one slot away from the given one in the loaded rotation
// (offset -1 = previous, +1 = next), or undefined at either end.
function adjacentFlight(flight, offset) {
  const idx = state.allFlights.indexOf(flight);
  return idx >= 0 ? state.allFlights[idx + offset] : undefined;
}

// Live OpenAirLog crew for that adjacent flight - embedded if present,
// otherwise whatever's already in crewCache, or null if that's genuinely
// not known yet.
function adjacentFlightCrew(flight, offset) {
  const adjacent = adjacentFlight(flight, offset);
  if (!adjacent) return null;
  if (adjacent.embeddedCrew.length) return adjacent.embeddedCrew;
  const cached = adjacent.id != null ? crewCache.get(adjacent.id) : undefined;
  return cached && cached.status === "ok" ? cached.crew : null;
}

// Whichever crew member on the currently viewed flight doesn't also show
// up (same role, same first name) on the next flight is - as far as live
// OpenAirLog data can tell - not continuing with the crew after this one;
// the mirror image (findJoiningCrew) checks the previous flight instead,
// for whoever's new as of this one. Compared by first name rather than
// the full name so this still works against OpenAirLog's partly-
// anonymized names ("H., Nicolas") and isn't thrown off by the PDF-merged
// display name. No adjacent flight loaded, or its crew not fetched yet,
// means nothing can be said either way - see ensureAdjacentFlightCrewLoaded()
// below, which fills that in and triggers a re-render once it's
// available, rather than this guessing in the meantime.
function findLeavingCrew(flight, crew) {
  const next = adjacentFlightCrew(flight, 1);
  if (!next) return new Set();
  const nextOperating = next.filter(isOperatingCrewMember);
  const leaving = new Set();
  for (const member of crew) {
    const staysOn = nextOperating.some((m) => crewKey(m.role, m.name) === crewKey(member.role, member.name));
    if (!staysOn) leaving.add(crewKey(member.role, member.name));
  }
  return leaving;
}

// A flight starts a new tour - rather than just continuing on from the
// previous leg - when there's no previous flight loaded, or that previous
// flight landed somewhere other than where this one departs from. Landing
// at home base mid-rotation and departing again the same day (a quick
// turn, common on short-haul) is NOT a new tour and must not be treated
// as one - confirmed against a real rotation where exactly this
// (EDDF->EKBI right after LPPT->EDDF) wrongly suppressed a real join
// before this was narrowed from a blanket "departs home base" check.
function startsNewTour(flight) {
  const previous = adjacentFlight(flight, -1);
  return !previous || previous.arrCode !== flight.depCode;
}

// Whoever's crew a flight starts a new tour from is unrelated to this one
// - the whole crew being "new" there is expected, not a meaningful join,
// and would just be noise.
function findJoiningCrew(flight, crew) {
  if (startsNewTour(flight)) return new Set();
  const previous = adjacentFlightCrew(flight, -1);
  if (!previous) return new Set();
  const previousOperating = previous.filter(isOperatingCrewMember);
  const joining = new Set();
  for (const member of crew) {
    const wasThereBefore = previousOperating.some((m) => crewKey(m.role, m.name) === crewKey(member.role, member.name));
    if (!wasThereBefore) joining.add(crewKey(member.role, member.name));
  }
  return joining;
}

// Fire-and-forget: the adjacent flight's crew is needed only to compute
// the leaving/joining indicators, not to show that flight itself, so this
// doesn't block rendering the current one - it just re-renders once the
// fetch resolves, if the pilot is still looking at the same flight by then.
async function ensureAdjacentFlightCrewLoaded(flight, offset) {
  const idx = state.allFlights.indexOf(flight);
  const adjacent = idx >= 0 ? state.allFlights[idx + offset] : undefined;
  if (!adjacent || adjacent.embeddedCrew.length) return;
  if (adjacent.id != null && crewCache.has(adjacent.id)) return; // already loading/loaded/forbidden/error

  await ensureCrewLoaded(adjacent);
  if (state.flights[state.index] === flight) renderCrew(flight);
}

// The PDF crew list is a snapshot from whenever it was uploaded/downloaded
// and can go stale mid-trip (e.g. a late P1 swap) - OpenAirLog stays the
// live source of truth. So rather than showing the PDF's list verbatim,
// take each OpenAirLog crew member and use the PDF's name for them only
// if the same role's first name still matches (the PDF's "Nachname,
// Vorname" is nicer than OpenAirLog's partly-anonymized "H., Nicolas");
// a role whose occupant has since changed falls back to OpenAirLog's own
// name for that entry instead of showing whoever the PDF still lists.
function mergeCrewWithPdf(apiCrew, pdfCrew) {
  return apiCrew.map((member) => {
    const match = pdfCrew.find(
      (p) => p.role.toUpperCase() === member.role.toUpperCase() &&
        firstNameOf(p.name) === firstNameOf(member.name)
    );
    return match ? { name: match.name, role: member.role } : member;
  });
}

// The PDF's own ref reads like "LH1168 -1/19" - flight number, an offset
// whose exact meaning isn't documented anywhere, and a bare day-of-month.
// Confirmed against a real Umlaufcrewliste (and the pilot's own reading of
// it): "-1/19" for a colleague joining on a flight dated 19SEP is 19.09,
// the same day - so the day-of-month is reliable and worth turning into a
// proper date ("LH1168 am 19.09."), but the offset itself is dropped
// rather than guessed at. The month is picked as whichever of the
// neighboring three makes that day-of-month fall closest to the flight
// this is shown on - arithmetic on a confirmed digit, not a guess about
// undocumented syntax.
const PDF_REF_RE = /^([A-Z]{1,3}\d{2,5})\s+-?\d{1,2}\/(\d{1,2})$/;

// Shared by formatPdfFlightRef() and the AeroDataBox lookups below: picks
// whichever of the neighboring three months makes the PDF's bare
// day-of-month fall closest to the flight this reference is shown on -
// arithmetic on a confirmed digit, not a guess about undocumented syntax.
function resolvePdfRef(raw, contextDateKey) {
  const m = PDF_REF_RE.exec(raw);
  if (!m || !contextDateKey) return null;
  const [, flightNumber, dayStr] = m;
  const day = Number(dayStr);
  const [ctxY, ctxM, ctxD] = contextDateKey.split("-").map(Number);
  const contextTime = Date.UTC(ctxY, ctxM - 1, ctxD);

  let best = null;
  for (const monthOffset of [-1, 0, 1]) {
    const candidate = new Date(Date.UTC(ctxY, ctxM - 1 + monthOffset, day));
    const diff = Math.abs(candidate.getTime() - contextTime);
    if (!best || diff < best.diff) best = { candidate, diff };
  }
  const dateKey = best.candidate.toISOString().slice(0, 10);
  return { flightNumber, dateKey, candidate: best.candidate };
}

function formatPdfFlightRef(raw, contextDateKey, route) {
  const resolved = resolvePdfRef(raw, contextDateKey);
  if (!resolved) return raw;
  const dateLabel = resolved.candidate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const routeLabel = route ? ` (${route.depCode}–${route.arrCode})` : "";
  return `${resolved.flightNumber}${routeLabel} am ${dateLabel}`;
}

// A colleague's Ex/To flight number (e.g. "LH1168") is one the pilot's
// own currently loaded rotation never mentions, so there's no flight
// object lying around with its citypair - looked up instead from the
// pilot's own OpenAirLog logbook history for that same flight number
// (confirmed on a real example: LH1168 shows EDDF-LPPT across every past
// occurrence in the logbook, since a flight number almost always flies
// the same route) rather than guessed at. Fire-and-forget, same pattern
// as ensureAdjacentFlightCrewLoaded() - re-renders the crew list once the
// lookup resolves, if still on the same flight by then.
const flightRouteCache = new Map(); // flightNumber -> { status: "loading"|"ok"|"error", depCode?, arrCode?, arrDate? }

async function ensureFlightRouteLoaded(flightNumber, f) {
  if (flightRouteCache.has(flightNumber)) return;
  flightRouteCache.set(flightNumber, { status: "loading" });

  const key = getApiKey();
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/flights?flight_number=${encodeURIComponent(flightNumber)}&per_page=1`,
      { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store" }
    );
    const body = res.ok ? await res.json() : null;
    const entries = body && Array.isArray(body.data) ? body.data : [];
    // Double-checked rather than trusting data[0] blindly - if the API
    // doesn't actually support filtering by flight_number, it would
    // otherwise silently attach some other flight's route here.
    const match = entries.find((e) => String(e.flight_number) === flightNumber);
    if (match && match.departure && match.arrival) {
      const depDate = combineDateAndTime(match.date, match.scheduled_off_block, null);
      const arrDate = combineDateAndTime(match.date, match.scheduled_on_block, depDate);
      flightRouteCache.set(flightNumber, { status: "ok", depCode: match.departure, arrCode: match.arrival, arrDate });
    } else {
      flightRouteCache.set(flightNumber, { status: "error" });
    }
  } catch {
    flightRouteCache.set(flightNumber, { status: "error" });
  }
  if (state.flights[state.index] === f) renderCrew(f);
}

// "kommt mit LH1168" only needs the flight number the colleague is
// arriving on plus when it lands (i.e. when they actually become
// available to join) - not the citypair/date formatPdfFlightRef() adds
// for "fliegt weiter mit", which is about a still-future connection.
function formatExRefLabel(refFlightNumber, route) {
  if (!refFlightNumber) return null;
  if (route && route.arrDate) return `${refFlightNumber} ${fmtTime(route.arrDate)}`;
  return refFlightNumber;
}

// Live variants via AeroDataBox (see ensureFlightByNumberLoaded()),
// preferred over the OpenAirLog-history fallback above whenever a key is
// configured - they reflect this exact occurrence's actual status, not
// just whichever route/time this flight number happened to have on some
// past day in the pilot's own logbook. A joining colleague's info uses
// the current (revised-if-known) arrival time - when they actually
// become available; a leaving colleague's uses the connecting flight's
// scheduled (not revised) departure - the plan they're working from, not
// a live delay that may still change before they even get there.
function formatExRefLabelLive(flightNumber, leg) {
  if (!flightNumber) return null;
  if (leg && leg.arrDate) return `${flightNumber} ${fmtTime(leg.arrDate)}`;
  return flightNumber;
}
function formatToRefLabelLive(flightNumber, leg) {
  if (!flightNumber) return null;
  if (leg && leg.depSchedDate) return `${flightNumber} ${fmtTime(leg.depSchedDate)}`;
  return flightNumber;
}

// Per-member Ex/To reference (verbatim from the uploaded PDF, reformatted
// via the live AeroDataBox lookup when available, else the OpenAirLog-
// history fallback) that applies to this exact flight - an "exRef" only
// counts for the block's first flight, a "toRef" only for its last (see
// parseCrewFromLines()), so a colleague who shows up in more than one PDF
// block doesn't leak the wrong block's reference onto a flight it
// doesn't belong to.
function buildPdfRefMap(f, field) {
  const map = new Map();
  if (!state.pdfCrew) return map;
  const blockField = field === "exRef" ? "blockFirstFlight" : "blockLastFlight";
  for (const m of state.pdfCrew.crew) {
    if (!m[field] || m[blockField] !== f.flightNumber) continue;

    const resolved = resolvePdfRef(m[field], f.raw && f.raw.date);
    let label = m[field];

    if (resolved && getAeroDataBoxKey()) {
      const cacheKey = `${resolved.flightNumber}|${resolved.dateKey}`;
      const cached = flightByNumberCache.get(cacheKey);
      if (!cached) {
        ensureFlightByNumberLoaded(resolved.flightNumber, resolved.dateKey);
      }
      const leg = cached && cached.leg;
      label = field === "exRef"
        ? (formatExRefLabelLive(resolved.flightNumber, leg) || m[field])
        : (formatToRefLabelLive(resolved.flightNumber, leg) || m[field]);
    } else if (resolved) {
      const refFlightNumber = resolved.flightNumber;
      const cachedRoute = flightRouteCache.get(refFlightNumber);
      if (!cachedRoute) ensureFlightRouteLoaded(refFlightNumber, f);
      const route = cachedRoute && cachedRoute.status === "ok" ? cachedRoute : null;
      label = field === "exRef"
        ? (formatExRefLabel(refFlightNumber, route) || m[field])
        : formatPdfFlightRef(m[field], f.raw && f.raw.date, route);
    }

    map.set(crewKey(m.role, m.name), label);
  }
  return map;
}

// Crew shown here comes either from OpenAirLog (per-flight, via
// /flights/{id}/crew) or - if the pilot uploaded a PDF - from that PDF,
// which then overwrites the OpenAirLog crew until switched back.
function renderCrew(f) {
  const entry = f.id != null ? crewCache.get(f.id) : undefined;
  const hasEmbedded = f.embeddedCrew.length > 0;
  const apiCrew = hasEmbedded ? f.embeddedCrew : entry && entry.status === "ok" ? entry.crew : [];
  const hasPdfCrew = !!(state.pdfCrew && state.pdfCrew.crew.length);

  const detectedOwnName = detectOwnName(f, apiCrew);
  if (detectedOwnName) applyDetectedOwnName(detectedOwnName);

  // Fill in the leaving/joining indicators once loaded, each re-renders itself
  ensureAdjacentFlightCrewLoaded(f, 1);
  ensureAdjacentFlightCrewLoaded(f, -1);

  if (hasPdfCrew) {
    els.crewSourceSwitchBtn.hidden = false;
    els.crewSourceSwitchBtn.textContent =
      state.crewSource === "pdf" ? "OpenAirLog-Crew stattdessen anzeigen" : "PDF-Crew stattdessen anzeigen";
  } else {
    els.crewSourceSwitchBtn.hidden = true;
    state.crewSource = "api"; // nothing to override with (anymore)
  }

  const useSource = hasPdfCrew && state.crewSource === "pdf" ? "pdf" : "api";

  els.crewList.innerHTML = "";
  els.crewEmpty.hidden = true;

  const ownName = getOwnName();
  const maxDuty = computeMaxLegalOnBlock(f);
  const legalOnBlockLabel = maxDuty
    ? `latest Onblock: ${fmtTime(maxDuty.latestOnBlockUtc).replace("Z", " UTC")} (${maxDuty.source})`
    : null;

  if (useSource === "pdf") {
    const { crew, rotation, fileName } = state.pdfCrew;
    els.crewSource.textContent = rotation ? `PDF · Umlauf ${rotation.rotation}` : `PDF · ${fileName}`;
    // Reconcile with the live OpenAirLog crew when it's available - falls
    // back to the raw PDF list only while the API crew hasn't loaded yet.
    const merged = apiCrew.length ? mergeCrewWithPdf(apiCrew, crew) : crew;
    // The PDF's own Ex/To columns are preferred when present (a colleague's
    // actual, specific connection), but not every join/leave has one there
    // (e.g. a name the PDF's own layout-based row parser missed, or a block
    // boundary that doesn't line up with this exact OpenAirLog flight) - so
    // this falls back to the same pilot's-own-adjacent-flight guess the
    // OpenAirLog view uses (see the api-source call below), rather than
    // silently showing nothing for a join/leave the arrow itself already
    // says is real.
    renderCrewMembers(els.crewList, merged, {
      leaving: findLeavingCrew(f, merged), joining: findJoiningCrew(f, merged),
      leavingInfo: nextFlightRefLabel(adjacentFlight(f, 1)), joiningInfo: ownAdjacentFlightLiveLabel(adjacentFlight(f, -1)),
      pdfExRefs: buildPdfRefMap(f, "exRef"), pdfToRefs: buildPdfRefMap(f, "toRef"),
      ownName, legalOnBlockLabel,
    });
    return;
  }

  els.crewSource.textContent = "OpenAirLog";

  if (!hasEmbedded && entry && entry.status === "loading") {
    els.crewEmpty.hidden = false;
    els.crewEmpty.textContent = "Lade Crew …";
    return;
  }
  if (!hasEmbedded && entry && entry.status === "forbidden") {
    els.crewEmpty.hidden = false;
    els.crewEmpty.textContent = "Keine Berechtigung für Crew-Daten (Scope crew:read fehlt für diesen API-Schlüssel).";
    return;
  }
  if (!hasEmbedded && entry && entry.status === "error") {
    els.crewEmpty.hidden = false;
    els.crewEmpty.textContent = entry.message || "Crew konnte nicht geladen werden.";
    return;
  }
  if (!apiCrew.length) {
    els.crewEmpty.hidden = false;
    els.crewEmpty.textContent = "Keine Crewdaten in OpenAirLog für diesen Flug hinterlegt.";
    return;
  }

  renderCrewMembers(els.crewList, apiCrew, {
    leaving: findLeavingCrew(f, apiCrew), joining: findJoiningCrew(f, apiCrew),
    leavingInfo: nextFlightRefLabel(adjacentFlight(f, 1)), joiningInfo: ownAdjacentFlightLiveLabel(adjacentFlight(f, -1)),
    pdfExRefs: buildPdfRefMap(f, "exRef"), pdfToRefs: buildPdfRefMap(f, "toRef"),
    ownName, legalOnBlockLabel,
  });
}

async function ensureCrewLoaded(f) {
  if (f.embeddedCrew.length > 0) return; // already have it, no need to call /flights/{id}/crew
  if (f.id == null) return; // no id to query /flights/{id}/crew with
  const cached = crewCache.get(f.id);
  if (cached && (cached.status === "ok" || cached.status === "forbidden")) return;

  crewCache.set(f.id, { status: "loading", crew: [] });
  if (state.flights[state.index] === f) renderCrew(f);

  const key = getApiKey();
  let res;
  try {
    res = await fetchWithTimeout(`${API_BASE}/flights/${encodeURIComponent(f.id)}/crew`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const message = err && err.name === "AbortError"
      ? "Crew-Anfrage hat zu lange gedauert (Zeitüberschreitung)."
      : "Crew-Anfrage fehlgeschlagen (Netzwerk/CORS).";
    crewCache.set(f.id, { status: "error", crew: [], message });
    if (state.flights[state.index] === f) renderCrew(f);
    return;
  }

  if (res.status === 401 || res.status === 403) {
    crewCache.set(f.id, { status: "forbidden", crew: [] });
    if (state.flights[state.index] === f) renderCrew(f);
    return;
  }
  if (!res.ok) {
    crewCache.set(f.id, { status: "error", crew: [], message: `Crew-Endpunkt antwortete mit Fehler ${res.status}.` });
    if (state.flights[state.index] === f) renderCrew(f);
    return;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    crewCache.set(f.id, { status: "error", crew: [], message: "Crew-Antwort war kein gültiges JSON." });
    if (state.flights[state.index] === f) renderCrew(f);
    return;
  }

  const rawCrew = extractFlightsArray(json);
  const crew = rawCrew.map(normalizeCrewMember);
  crewCache.set(f.id, { status: "ok", crew });
  if (state.flights[state.index] === f) renderCrew(f);
}

// ---------- data loading ----------

// Last successfully loaded raw flight window, kept in localStorage so a
// genuinely offline load (no internet, e.g. airplane mode) can still show
// something instead of just an error - see loadFlights()'s catch branch.
const FLIGHTS_CACHE_KEY = "oal_flights_cache";

function saveFlightsCache(allRaw) {
  try {
    localStorage.setItem(FLIGHTS_CACHE_KEY, JSON.stringify({ allRaw, fetchedAt: Date.now() }));
  } catch { /* private mode / quota */ }
}
function loadFlightsCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLIGHTS_CACHE_KEY) || "null");
    return parsed && Array.isArray(parsed.allRaw) ? parsed : null;
  } catch {
    return null;
  }
}

// Once a flight has been on the ground for a while, it's no longer worth
// keeping in the swipeable card list - decluttering it down to just
// what's still relevant. The current/last flight of the day is exempt:
// it stays until the real layover view takes over (findApiLayover(),
// 30 min after arrival - see POST_LANDING_SWITCH_MS), so there's no gap
// where neither the flight card nor the layover card has anything to show.
const FLIGHT_RETIRE_AFTER_ARRIVAL_MS = 20 * 60 * 1000;

// Today's flights (state.flights) - filtered from the full loaded window
// (state.allFlights, which stays untouched so crew/layover lookups that
// need to reach across days, e.g. adjacentFlight(), still work) down to
// today's date, then further down to what's still worth showing as a
// card. Re-run on every 30s tick as well as on load, since "20 minutes
// past arrival" becomes true while the app just sits there.
function computeTodayFlights(allFlights) {
  const todayKey = localDateKey(new Date());
  const today = allFlights.filter((f) => {
    const d = f.depSchedDate || f.depActualDate;
    return d && localDateKey(d) === todayKey;
  });
  const now = Date.now();
  return today.filter((f, idx) => {
    if (idx === today.length - 1) return true;
    const arr = f.arrActualDate || f.arrSchedDate;
    return !arr || now - arr.getTime() < FLIGHT_RETIRE_AFTER_ARRIVAL_MS;
  });
}

// Turns a raw /flights response array into rendered state - shared by the
// live load below and the offline fallback, so a cached window is applied
// exactly the same way a fresh one would be.
function applyLoadedFlights(allRaw) {
  // Real flights vs. duty-only entries (vacation "U<n>", home day "ORTSTAG",
  // etc. - flight_number null). Duty entries are kept (not discarded like
  // before) so a vacation/Ortstag day can be recognized and explained
  // instead of just showing "nothing planned".
  const rawFlights = allRaw.filter(isRealFlightEntry);
  const rawDuties = allRaw.filter((r) => !isRealFlightEntry(r) && r.duty_code);

  const allFlights = rawFlights.map(normalizeFlight).sort((a, b) => {
    const da = a.depSchedDate || a.depActualDate || new Date(0);
    const db = b.depSchedDate || b.depActualDate || new Date(0);
    return da - db;
  });
  const allDuties = rawDuties
    .map((r) => ({ date: String(r.date || ""), dutyCode: String(r.duty_code) }))
    .filter((d) => d.date);

  const flights = computeTodayFlights(allFlights);

  crewCache.clear();
  state.flights = flights;
  state.allFlights = allFlights;
  state.allDuties = allDuties;
  HOME_BASE = detectHomeBase(allFlights) || HOME_BASE;
  // Set before renderLayover(): it (indirectly, via effectiveDutyType())
  // reads state.index to check whether the post-landing switch applies,
  // which needs it to already reflect today's freshly loaded flights.
  state.index = flights.length ? pickInitialIndex(flights) : 0;
  renderLayover();

  // renderFlight() itself decides flight card vs. duty status card -
  // including the post-landing switch to "Ortstag" mode once today's last
  // flight landed at home base 30+ minutes ago (shouldShowPostLandingHomeView()).
  renderFlight();
}

// Small status text next to ↻, replacing the old separate "Offline -
// zeige letzten Stand..." banner line: either when this device last
// pulled a fresh copy (device-local time, like fmtLocalTime()'s other
// use), or "Offline" while showing a cached window instead.
let lastUpdateAt = null;
let isOffline = false;

function renderDataStamp() {
  els.dataStamp.hidden = false;
  els.dataStamp.classList.toggle("offline", isOffline);
  if (isOffline) {
    els.dataStamp.textContent = "Offline";
  } else if (lastUpdateAt) {
    els.dataStamp.textContent = fmtLocalTime(lastUpdateAt);
  } else {
    els.dataStamp.hidden = true;
  }
}

// No connection at all (offline, or a genuine network failure) - falls
// back to whatever window was cached from the last successful load rather
// than just an error, so the dashboard stays usable, e.g. mid-flight in
// airplane mode. Never silently passed off as live: the ↻ status stays on
// "Offline" (see renderDataStamp()) so it's always clear this isn't
// current data.
function useOfflineFallback() {
  isOffline = true;
  renderDataStamp();
  const cached = loadFlightsCache();
  if (!cached) {
    showBanner(
      "Verbindung zu OpenAirLog fehlgeschlagen. Das kann an fehlendem Internet liegen " +
        "oder daran, dass die API keine Anfragen direkt aus dem Browser erlaubt (CORS). " +
        "Falls das dauerhaft passiert, muss OpenAirLog diese Web-App-Adresse freigeben.",
      "error"
    );
    return;
  }
  showBanner("", "");
  applyLoadedFlights(cached.allRaw);
}

async function loadFlights() {
  const key = getApiKey();
  if (!key) {
    setSettingsOpen(true);
    els.refreshBtn.hidden = true;
    els.resetKeyBtn.hidden = true;
    return;
  }

  setSettingsOpen(false);
  els.refreshBtn.hidden = false;
  els.resetKeyBtn.hidden = false;
  showBanner("Lade Flugdaten …", "");

  // No point even trying the request (and waiting out its timeout) when
  // the device itself reports no connection at all - straight to the
  // cached window instead.
  if (!navigator.onLine) {
    useOfflineFallback();
    return;
  }

  // Only *today's* flights are ever shown as "the" flight (filtered below),
  // but layover detection needs to look back further - a layover can span
  // several days (e.g. landed 3 days ago, next departure tomorrow) - so the
  // fetch window itself reaches back a week to find the most recent arrival.
  // Forward it reaches 3 weeks out, so a vacation/Ortstag day can still find
  // the next real duty and, for Ortstag, the layovers on the trip after it.
  const from = todayISO(-7);
  const to = todayISO(21);
  const url = `${API_BASE}/flights?from=${from}&to=${to}&per_page=100`;

  let res;
  try {
    res = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
  } catch {
    // Covers both a genuine timeout (AbortError) and a plain network
    // failure - either way there's no live data, so the same offline
    // fallback applies rather than branching the message on which one.
    useOfflineFallback();
    return;
  }

  if (res.status === 401 || res.status === 403) {
    showBanner("API-Schlüssel ungültig oder abgelaufen. Bitte neu eingeben.", "error");
    setSettingsOpen(true);
    return;
  }
  if (!res.ok) {
    showBanner(`OpenAirLog antwortete mit Fehler ${res.status}.`, "error");
    return;
  }

  let json;
  try {
    json = await res.json();
  } catch {
    showBanner("Antwort von OpenAirLog konnte nicht gelesen werden (kein gültiges JSON).", "error");
    return;
  }

  const allRaw = extractFlightsArray(json);
  saveFlightsCache(allRaw);
  applyLoadedFlights(allRaw);

  isOffline = false;
  lastUpdateAt = new Date();
  renderDataStamp();

  if (els.flightCardTrack.hidden) {
    // A short hint only when the dashboard would otherwise show nothing at
    // all (no flight card, no layover, no recognized vacation/Ortstag/
    // post-landing status) - so it's clear the app loaded fine rather than
    // looking broken/blank.
    const nothingToShow = els.layoverCard.hidden && els.dutyStatusCard.hidden;
    showBanner(nothingToShow ? "Heute nichts geplant." : "", "");
  } else {
    showBanner("", "");
    // Land on the flight that matches the current time, not wherever the
    // page happened to be scrolled (e.g. after a refresh from further down).
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// ---------- PDF crew list (optional, supplementary) ----------
//
// Layout-aware extraction: pdf.js only gives us individual positioned text
// fragments, not rows. We cluster fragments by their y-coordinate into
// visual lines, then sort each line left-to-right by x, which reconstructs
// table rows like "CP DROSTE, ALEXANDER 770166A FRAL/OF-A/B" reliably
// enough to parse. Verified against a real "Umlaufcrewliste" (Lufthansa-
// style rotation crew list) PDF.

// A crew row's own "Ex"/"To" reference (the flight that person is coming
// from / continuing to - confirmed on a real Umlaufcrewliste as its own
// two columns, distinct from anything OpenAirLog knows about a colleague)
// renders as a single text fragment like "LH1167 -1/19" - kept as raw
// text here (parsed and reformatted later, in formatPdfFlightRef()).
const PDF_FLIGHT_REF_RE = /^[A-Z]{1,3}\d{2,5}\s+-?\d{1,2}\/\d{1,2}$/;

async function extractPdfLines(pdf) {
  const lines = [];
  const refs = []; // refs[i] = { exRef, toRef } | null, aligned with lines[i]
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter((it) => it.str.trim() !== "");

    const rows = [];
    const tolerance = 2;
    for (const it of items) {
      let row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y); // PDF y grows upward -> top of page first

    // The "Ex"/"To" column header x-positions, tracked as the page is
    // walked top-to-bottom and refreshed at each crew-table header - every
    // flight-leg block gets its own repeated header, and column x can
    // shift slightly between blocks.
    let exX = null;
    let toX = null;

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);

      const exItem = row.items.find((i) => i.str.trim() === "Ex");
      const toItem = row.items.find((i) => i.str.trim() === "To");
      if (exItem && toItem) { exX = exItem.x; toX = toItem.x; }

      // Classified by whichever column's x it starts closest to - verified
      // against a real Umlaufcrewliste: a joins-only row's ref always
      // lands in "Ex", a leaves-only row's always in "To".
      let rowRef = null;
      if (exX != null && toX != null) {
        const refItem = row.items.find((i) => PDF_FLIGHT_REF_RE.test(i.str.trim()));
        if (refItem) {
          const value = refItem.str.trim();
          rowRef = Math.abs(refItem.x - exX) <= Math.abs(refItem.x - toX)
            ? { exRef: value, toRef: null }
            : { exRef: null, toRef: value };
        }
      }

      const line = row.items.map((i) => i.str).join(" ")
        // Some rotation crew lists mark a per-person crew change (joins/
        // leaves) with an icon-font glyph rather than real text - it has
        // no printable form, but does occupy a Private Use Area codepoint
        // that would otherwise land right in the middle of a name and
        // break the row pattern below. Confirmed on a real Umlaufcrewliste
        // (U+F100/U+F101, rendered as invisible in the extracted text).
        .replace(/[-]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (line) { lines.push(line); refs.push(rowRef); }
    }
  }
  return { lines, refs };
}

// Matches crew-table rows: a short role code (CP, FO, P1, FB, PU, ...)
// followed by "Nachname, Vorname" and trailing columns. Case-insensitive,
// since names appear all-caps in some rotation crew lists (as in the
// original sample) and in regular Title Case in others. Deliberately not
// a fixed role whitelist, since role codes differ between airlines/roster
// systems. The PK-Nummer/staff-ID column (starts with a digit) is used
// as an anchor so the lazily-matched name doesn't get cut short; a
// second, looser pattern covers rows with no such trailing column.
//
// Surname allows an internal space as well as a hyphen (e.g. "VIDAL
// BARCELO" - a real compound Spanish surname, confirmed on a real
// Umlaufcrewliste), and an optional "#" between the role and the name -
// a second, distinct per-person marker some rotation crew lists print
// (separate from the icon-font glyphs already stripped in
// extractPdfLines(); this one's a literal character).
const CREW_ROW_WITH_ID_RE = /^([A-Z][A-Z0-9]{0,2})\s+#?\s*([A-ZÄÖÜß][A-ZÄÖÜß\- ]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*?)\s+(\d\S*)\s*(.*)$/i;
const CREW_ROW_NO_ID_RE = /^([A-Z][A-Z0-9]{0,2})\s+#?\s*([A-ZÄÖÜß][A-ZÄÖÜß\- ]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*)$/i;

// A long/hyphenated surname can wrap the firstname onto its own line in
// the PDF's table layout (confirmed on a real Umlaufcrewliste: "FB
// KOBUSINSKI-STERNFELD, 459008B ..." with "RAPHAEL" alone on the next
// line) - the surname-then-ID line alone doesn't match either pattern
// above (no firstname before the ID), so it's tried as a last resort and,
// if the very next line looks like a bare continuation of the name, the
// two are joined.
const CREW_ROW_SURNAME_WRAP_RE = /^([A-Z][A-Z0-9]{0,2})\s+#?\s*([A-ZÄÖÜß][A-ZÄÖÜß\- ]*?),\s*(\d\S*)\s*(.*)$/i;

function looksLikeNameContinuation(line) {
  const t = (line || "").trim();
  if (!t || t.length > 30) return false;
  if (/^(Sh\.|Cr\.|F\.|Zeichenerkl|UMLAUFCREWLISTE|OD-Crew|<<<|>>>)/i.test(t)) return false;
  if (LEG_ROW_RE.test(t) || CREW_ROW_WITH_ID_RE.test(t) || CREW_ROW_NO_ID_RE.test(t)) return false;
  return /^[A-ZÄÖÜß][A-ZÄÖÜß\- ]*$/i.test(t);
}

// Marks the crew table for the flight-leg block whose LEG_ROW_RE rows
// appeared since the previous such header - repeats before every block,
// possibly after several leg rows and even several "Sh. Fl." sub-headers
// (a block can span multiple flights sharing one crew, confirmed on a
// real Umlaufcrewliste: three legs, one crew table).
const CREW_TABLE_HEADER_RE = /^Cr\.\s+Name,\s*Vorname/i;

// Per the PDF's own legend ("<<< - die Person erweitert die Crew zum
// ersten Flug des angeführten Blocks", ">>> - ... zum letzten Flug"), a
// join applies at the block's first flight and a leave at its last -
// tracked here (blockFirstFlight/blockLastFlight) so a crew member's Ex/To
// reference can later be matched to the exact OpenAirLog flight it's
// relevant for, not just attached to every flight they're ever on.
function parseCrewFromLines(lines, refs = []) {
  const crew = [];
  let pendingLegFlights = [];
  let blockFirstFlight = null;
  let blockLastFlight = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const legMatch = line.match(LEG_ROW_RE);
    if (legMatch) {
      pendingLegFlights.push(legMatch[3]);
      continue;
    }
    if (CREW_TABLE_HEADER_RE.test(line)) {
      if (pendingLegFlights.length) {
        blockFirstFlight = pendingLegFlights[0];
        blockLastFlight = pendingLegFlights[pendingLegFlights.length - 1];
        pendingLegFlights = [];
      }
      continue;
    }

    const ref = refs[i] || null;
    const refFields = { exRef: ref && ref.exRef, toRef: ref && ref.toRef, blockFirstFlight, blockLastFlight };

    let m = line.match(CREW_ROW_WITH_ID_RE);
    if (m) {
      const [, role, name, , details] = m;
      crew.push({ role: role.trim(), name: displayName(name.trim().replace(/\s+/g, " ")), details: (details || "").trim(), ...refFields });
      continue;
    }
    m = line.match(CREW_ROW_NO_ID_RE);
    if (m) {
      const [, role, name] = m;
      crew.push({ role: role.trim(), name: displayName(name.trim().replace(/\s+/g, " ")), details: "", ...refFields });
      continue;
    }
    m = line.match(CREW_ROW_SURNAME_WRAP_RE);
    if (m && looksLikeNameContinuation(lines[i + 1])) {
      const [, role, surname, , details] = m;
      const name = `${surname.trim()}, ${lines[i + 1].trim()}`;
      crew.push({ role: role.trim(), name: displayName(name.replace(/\s+/g, " ")), details: (details || "").trim(), ...refFields });
      i++; // consume the continuation line so it isn't tried as its own row
    }
  }
  return crew;
}

function parseRotationHeader(lines) {
  for (const line of lines) {
    const m = line.match(/^(.*?)\s+Ihr angeforderter Flug.*?Umlaufs:\s*(\S+)/i);
    if (m) return { pilot: m[1].trim(), rotation: m[2].trim() };
  }
  return null;
}

// ---------- flight legs / layover (hotel) from the PDF's routing table ----------
//
// The routing table (separate from the crew table) looks like:
//   "1 1 LH1556 / 11SEP26 FRA - RMO 319 / DAILU 1800 / 2000 2020 / 2320 Courtyard by Marriott"
//   "Chisinau"                                                          <- wrapped hotel name
// Sh./Fl., designator+date, dep-arr, AC/reg, STD (UTC/LT), STA (UTC/LT), Hotel.
// A non-empty Hotel means the crew stays overnight there after that leg.

const PDF_MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

const LEG_ROW_RE = /^(\d+)\s+(\d+)\s+([A-Z]{2,3}\d+)\s*\/\s*(\d{2}[A-Z]{3}\d{2})\s+([A-Z]{3})\s*-\s*([A-Z]{3})\s+(\S+)\s*\/\s*(\S+)\s+(\d{3,4})\s*\/\s*(\d{3,4})\s+(\d{3,4})\s*\/\s*(\d{3,4})\s*(.*)$/;

const NON_HOTEL_CONTINUATION_RE = /^(Cr\.|F\.|Zeichenerkl|UMLAUFCREWLISTE|<<<|>>>)/i;

function legDateTimeUtc(dateToken, timeToken, anchor) {
  const dm = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(dateToken);
  if (!dm) return null;
  const month = PDF_MONTHS[dm[2]];
  if (month === undefined) return null;
  const hhmm = timeToken.padStart(4, "0");
  let d = new Date(Date.UTC(2000 + Number(dm[3]), month, Number(dm[1]), Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4))));
  if (anchor && d < anchor) d = new Date(d.getTime() + 24 * 3600 * 1000);
  return d;
}

function parseFlightLegs(lines) {
  const legs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LEG_ROW_RE);
    if (!m) continue;
    const [, , , flightNumber, dateStr, depCode, arrCode, , , stdUtc, , staUtc, , hotelRest] = m;
    let hotel = (hotelRest || "").trim();

    const next = lines[i + 1];
    if (hotel && next && !LEG_ROW_RE.test(next) && !CREW_ROW_WITH_ID_RE.test(next) &&
        !CREW_ROW_NO_ID_RE.test(next) && !NON_HOTEL_CONTINUATION_RE.test(next.trim()) && next.trim().length < 40) {
      hotel = `${hotel} ${next.trim()}`.trim();
    }

    const depUtc = legDateTimeUtc(dateStr, stdUtc, null);
    const arrUtc = legDateTimeUtc(dateStr, staUtc, depUtc);
    legs.push({ flightNumber, depCode: depCode.toUpperCase(), arrCode: arrCode.toUpperCase(), depUtc, arrUtc, hotel });
  }
  return legs;
}

// After JSON round-tripping through localStorage, Date fields come back as
// strings - restore them.
function reviveLeg(leg) {
  return {
    ...leg,
    depUtc: leg.depUtc ? new Date(leg.depUtc) : null,
    arrUtc: leg.arrUtc ? new Date(leg.arrUtc) : null,
  };
}

// City name for the ICAO airport codes OpenAirLog uses (departure/arrival
// are 4-letter ICAO, e.g. "EDDF" - not 3-letter IATA). Not exhaustive:
// covers major European and world airports; anything missing just shows
// the bare code, which is still correct, just less friendly.
const ICAO_CITY = {
  // Germany
  EDDF: "Frankfurt", EDDM: "München", EDDB: "Berlin", EDDH: "Hamburg",
  EDDL: "Düsseldorf", EDDK: "Köln/Bonn", EDDS: "Stuttgart", EDDN: "Nürnberg",
  EDDW: "Bremen", EDDP: "Leipzig/Halle", EDDR: "Saarbrücken", EDDV: "Hannover",
  EDDC: "Dresden", EDDG: "Münster/Osnabrück",
  // Austria / Switzerland
  LOWW: "Wien", LOWS: "Salzburg", LOWI: "Innsbruck", LOWG: "Graz", LOWL: "Linz",
  LSZH: "Zürich", LSGG: "Genf", LSZB: "Bern", LFSB: "Basel/Mulhouse",
  // UK / Ireland
  EGLL: "London (Heathrow)", EGKK: "London (Gatwick)", EGSS: "London (Stansted)",
  EGGW: "London (Luton)", EGLC: "London (City)", EGCC: "Manchester",
  EGBB: "Birmingham", EGPH: "Edinburgh", EGPF: "Glasgow", EGNT: "Newcastle",
  EIDW: "Dublin",
  // France / Benelux
  LFPG: "Paris (CDG)", LFPO: "Paris (Orly)", LFLL: "Lyon", LFMN: "Nizza",
  LFML: "Marseille", LFBO: "Toulouse", LFRS: "Nantes", LFST: "Straßburg",
  LFBD: "Bordeaux", EHAM: "Amsterdam", EBBR: "Brüssel",
  // Iberia
  LEMD: "Madrid", LEBL: "Barcelona", LEPA: "Palma de Mallorca", LEMG: "Málaga",
  LEZL: "Sevilla", LEVC: "Valencia", LEAL: "Alicante", LEBB: "Bilbao",
  GCLP: "Gran Canaria", GCTS: "Teneriffa Süd", LPPT: "Lissabon", LPPR: "Porto",
  LPFR: "Faro",
  // Italy
  LIRF: "Rom (Fiumicino)", LIRA: "Rom (Ciampino)", LIML: "Mailand (Linate)",
  LIMC: "Mailand (Malpensa)", LIRN: "Neapel", LIRQ: "Florenz", LIPZ: "Venedig",
  LICJ: "Palermo", LICC: "Catania", LIBD: "Bari",
  // Nordics / Baltics
  ESSA: "Stockholm", ENGM: "Oslo", EKCH: "Kopenhagen", EKBI: "Billund",
  EFHK: "Helsinki", EYVI: "Vilnius", EVRA: "Riga", EETN: "Tallinn",
  // Central / Eastern Europe
  EPWA: "Warschau", EPKK: "Krakau", EPPO: "Posen", EPWR: "Breslau", EPGD: "Danzig",
  LKPR: "Prag", LHBP: "Budapest", LROP: "Bukarest", LBSF: "Sofia",
  LDZA: "Zagreb", LDSP: "Split", LDDU: "Dubrovnik", LJLJ: "Ljubljana",
  LYBE: "Belgrad", LUKK: "Chișinău",
  // Southeastern Europe / Mediterranean
  LGAV: "Athen", LGTS: "Thessaloniki", LGIR: "Heraklion", LGRP: "Rhodos",
  LTFM: "Istanbul", LTAI: "Antalya", LTFJ: "Istanbul (Sabiha Gökçen)",
  LCLK: "Larnaka", LMML: "Malta",
  // North Africa / Middle East
  GMMN: "Casablanca", HECA: "Kairo", HEGN: "Hurghada", HESH: "Sharm El-Sheikh",
  OMDB: "Dubai", OTHH: "Doha", OMAA: "Abu Dhabi", OERK: "Riad", OEJN: "Jeddah",
  // North America
  KJFK: "New York (JFK)", KEWR: "Newark", KLAX: "Los Angeles", KORD: "Chicago",
  KMIA: "Miami", KIAD: "Washington", KBOS: "Boston", KSFO: "San Francisco",
  KATL: "Atlanta", CYYZ: "Toronto", CYUL: "Montreal",
  // Asia / Pacific / Africa / South America
  RJAA: "Tokio (Narita)", RJTT: "Tokio (Haneda)", ZBAA: "Peking",
  VHHH: "Hongkong", WSSS: "Singapur", VABB: "Mumbai", VIDP: "Delhi",
  RKSI: "Seoul", FAOR: "Johannesburg", HKJK: "Nairobi", YSSY: "Sydney",
  SBGR: "São Paulo",
};

function cityForIcao(code) {
  return ICAO_CITY[code] || null;
}

// 3-letter station code per ICAO code, for the route chain on the
// Urlaub/Ortstag cards. Deliberately only populated with codes the pilot
// has actually confirmed (EDDF/LUKK/LPPT/EKBI/EPWA/EDDH so far) rather
// than assumed IATA codes - the earlier mistake with a guessed ATC
// callsign (DLH1557 vs the real DLH8KF) showed that airline-internal
// station codes can't be reliably derived, only confirmed one by one.
// Falls back to the raw ICAO code for anything not yet in this table.
const THREE_LETTER_CODE = {
  EDDF: "FRA",
  LUKK: "RMO",
  LPPT: "LIS",
  EKBI: "BLL",
  EPWA: "WAW",
  EDDH: "HAM",
};

function threeLetterCode(icao) {
  return THREE_LETTER_CODE[icao] || icao;
}

// IANA time zone per ICAO code - unlike THREE_LETTER_CODE's airline-
// internal station codes, an airport's time zone is plain geography, not
// something that needs confirming per station. Scoped to exactly the
// codes THREE_LETTER_CODE already covers (extend both together) - that's
// also every station computeLegalRestReference() can ever produce a time for,
// so a backup pickup can always be shown in local time, matching a
// roster pickup's "LT" formatting instead of a bare UTC instant.
const TIMEZONE_BY_ICAO = {
  EDDF: "Europe/Berlin",
  LUKK: "Europe/Chisinau",
  LPPT: "Europe/Lisbon",
  EKBI: "Europe/Copenhagen",
  EPWA: "Europe/Warsaw",
  EDDH: "Europe/Berlin",
};

// "HH:MM LT" for a UTC instant at the given ICAO code's local time, or
// null when no time zone is on file for it (see TIMEZONE_BY_ICAO).
function fmtLocalTimeAtIcao(utcDate, icao) {
  const tz = TIMEZONE_BY_ICAO[icao];
  if (!tz || !utcDate) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcDate);
  let hh = Number(parts.find((p) => p.type === "hour").value);
  const mm = Number(parts.find((p) => p.type === "minute").value);
  if (hh === 24) hh = 0;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} LT`;
}

// ISO 4217 currency per ICAO code - only for airports outside the eurozone
// (a code from ICAO_CITY that's absent here uses the euro, needs no table).
// Not exhaustive: covers the airports already in ICAO_CITY.
const CURRENCY_BY_ICAO = {
  EGLL: "GBP", EGKK: "GBP", EGSS: "GBP", EGGW: "GBP", EGLC: "GBP", EGCC: "GBP",
  EGBB: "GBP", EGPH: "GBP", EGPF: "GBP", EGNT: "GBP",
  LSZH: "CHF", LSGG: "CHF", LSZB: "CHF",
  ESSA: "SEK", ENGM: "NOK", EKCH: "DKK", EKBI: "DKK",
  EPWA: "PLN", EPKK: "PLN", EPPO: "PLN", EPWR: "PLN", EPGD: "PLN",
  LKPR: "CZK", LHBP: "HUF", LROP: "RON", LBSF: "BGN", LYBE: "RSD", LUKK: "MDL",
  LTFM: "TRY", LTAI: "TRY", LTFJ: "TRY",
  GMMN: "MAD", HECA: "EGP", HEGN: "EGP", HESH: "EGP",
  OMDB: "AED", OMAA: "AED", OTHH: "QAR", OERK: "SAR", OEJN: "SAR",
  KJFK: "USD", KEWR: "USD", KLAX: "USD", KORD: "USD", KMIA: "USD", KIAD: "USD",
  KBOS: "USD", KSFO: "USD", KATL: "USD", CYYZ: "CAD", CYUL: "CAD",
  RJAA: "JPY", RJTT: "JPY", ZBAA: "CNY", VHHH: "HKD", WSSS: "SGD",
  VABB: "INR", VIDP: "INR", RKSI: "KRW", YSSY: "AUD", FAOR: "ZAR",
  HKJK: "KES", SBGR: "BRL",
};

// Fallback only: used when the live rate lookup fails (offline, CORS,
// etc). Rough 2026-era values, not meant to be exact - the UI marks them
// as approximate whenever this table (rather than a live rate) is used.
const APPROX_EUR_RATES = {
  GBP: 0.84, CHF: 0.95, SEK: 11.2, NOK: 11.5, DKK: 7.46, PLN: 4.3, CZK: 25,
  HUF: 400, RON: 5.0, BGN: 1.96, RSD: 117, MDL: 19.5, TRY: 39, MAD: 10.8,
  EGP: 51, AED: 3.97, QAR: 3.93, SAR: 4.05, USD: 1.08, CAD: 1.48, JPY: 162,
  CNY: 7.9, HKD: 8.4, SGD: 1.45, INR: 91, KRW: 1480, AUD: 1.63, ZAR: 20.5,
  KES: 140, BRL: 6.0,
};

// Cached in memory (not localStorage - a stale exchange rate isn't worth
// persisting across sessions) since rates barely move within a browsing
// session; avoids refetching on every 30s layover re-render.
let liveRatesCache = null;
let liveRatesFetchedAt = 0;
const LIVE_RATES_CACHE_MS = 6 * 3600 * 1000;

async function getEurRates() {
  const now = Date.now();
  if (liveRatesCache && now - liveRatesFetchedAt < LIVE_RATES_CACHE_MS) {
    return { rates: liveRatesCache, live: true };
  }
  try {
    const res = await fetchWithTimeout("https://open.er-api.com/v6/latest/EUR", {});
    if (!res.ok) throw new Error("bad status");
    const json = await res.json();
    if (!json || !json.rates) throw new Error("no rates in response");
    liveRatesCache = json.rates;
    liveRatesFetchedAt = now;
    return { rates: json.rates, live: true };
  } catch {
    return { rates: APPROX_EUR_RATES, live: false };
  }
}

// Guards against a slow/late fetch from an earlier call overwriting the UI
// after a newer renderLayover() already moved on to a different airport.
let layoverCurrencyToken = 0;

// rate = units of the local currency per 1 EUR (as returned by the API,
// EUR-based). Kept at module scope so the input listener can recompute
// without re-fetching.
let currentCurrencyCode = null;
let currentCurrencyRate = null;

function updateCurrencyOutput() {
  if (!currentCurrencyRate) {
    els.currencyEurOutput.textContent = "0";
    return;
  }
  const raw = parseFloat(els.currencyLocalInput.value);
  const local = Number.isFinite(raw) ? raw : 0;
  const eur = local / currentCurrencyRate;
  const decimals = eur >= 100 ? 0 : 2;
  els.currencyEurOutput.textContent = eur.toLocaleString("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

async function renderLayoverCurrency(arrCode) {
  const token = ++layoverCurrencyToken;
  const currency = CURRENCY_BY_ICAO[arrCode];
  if (!currency) {
    els.layoverCurrency.hidden = true;
    currentCurrencyRate = null;
    return;
  }

  const { rates, live } = await getEurRates();
  if (token !== layoverCurrencyToken) return; // superseded by a newer call

  const rate = rates[currency];
  if (!rate) {
    els.layoverCurrency.hidden = true;
    currentCurrencyRate = null;
    return;
  }

  els.layoverCurrency.hidden = false;
  els.currencyCode.textContent = currency;
  els.currencyLocalUnit.textContent = currency;
  // Only clear what the pilot typed when the currency itself changed
  // (new layover country), not on every periodic re-render.
  if (currency !== currentCurrencyCode) {
    els.currencyLocalInput.value = "";
    currentCurrencyCode = currency;
  }
  currentCurrencyRate = rate;
  updateCurrencyOutput();

  els.currencyNote.hidden = live;
  els.currencyNote.textContent = live ? "" : "Ungefährer Kurs (keine Live-Kursdaten verfügbar, ggf. veraltet).";
}

// A layover is purely about how much time sits between two flights - more
// than 10h counts as one regardless of whether that gap crosses a
// calendar day or not (a same-day quick turn with a big schedule gap is
// just as much "staying somewhere" as an overnight that happens to cross
// midnight). Below that, it's just a connection.
const LAYOVER_MIN_GAP_MS = 10 * 60 * 60 * 1000;

// Primary layover detection: OpenAirLog flight data, not the PDF. The most
// recent completed arrival, still more than LAYOVER_MIN_GAP_MS before
// whatever flight comes next (or with no next flight loaded at all) -
// "if the day before ended in RMO, that's an overnight stay there."
function findApiLayover(allFlights) {
  const now = new Date();
  let current = null;
  let currentArr = null;
  for (const f of allFlights) {
    const arr = f.arrActualDate || f.arrSchedDate;
    // Same POST_LANDING_SWITCH_MS buffer as the post-landing home-base
    // switch, so the flight card doesn't disappear the instant wheels
    // touch down - the layover view only takes over 30 minutes later.
    if (!arr || now - arr < POST_LANDING_SWITCH_MS) continue;
    if (!current || arr > currentArr) { current = f; currentArr = arr; }
  }
  if (!current) return null;
  // Landing back at home base is being home, not a layover - without this,
  // the most recent arrival being EDDF (e.g. right before a vacation or
  // Ortstag) would otherwise show a nonsensical "layover" card for home.
  if (current.arrCode === HOME_BASE) return null;

  let nextDep = null;
  for (const f of allFlights) {
    const dep = f.depActualDate || f.depSchedDate;
    if (dep && dep > currentArr && (!nextDep || dep < nextDep)) nextDep = dep;
  }
  if (nextDep && nextDep - currentArr <= LAYOVER_MIN_GAP_MS) return null; // just a connection

  return { arrCode: current.arrCode, arrTime: currentArr, flight: current };
}

// Once today's own last flight (state.flights, see computeTodayFlights())
// has actually departed - not merely still scheduled to - the pilot wants
// a look ahead at the layover it's flying into, attached as one more
// swipeable page right after that flight's own card in the ordinary
// flight-card carousel (see buildFlightCards()/renderFlight()), well
// before findApiLayover()'s own POST_LANDING_SWITCH_MS gate flips the
// whole app over into the dedicated Layover carousel. Same non-home-base/
// same-day-connection exclusions as findApiLayover() - this is genuinely
// a preview of the SAME layover that eventually takes over there, not a
// separate concept, and stays scoped to state.flights so it starts over
// with whatever today's own list is once midnight rolls the date over,
// same as the rest of the app (see computeTodayFlights()).
function previewLayoverFlight() {
  const last = state.flights[state.flights.length - 1];
  if (!last || last.arrCode === HOME_BASE) return null;
  const dep = last.depActualDate || last.depSchedDate;
  if (!dep || Date.now() < dep.getTime()) return null;
  const arr = last.arrActualDate || last.arrSchedDate;
  const onward = adjacentFlight(last, 1);
  const onwardDep = onward && (onward.depActualDate || onward.depSchedDate);
  if (onwardDep && arr && onwardDep - arr <= LAYOVER_MIN_GAP_MS) return null; // just a connection
  return { arrCode: last.arrCode, arrTime: arr, flight: last };
}

// The PDF is only used to enrich this with a hotel name, if a matching leg
// happens to have one - not to decide whether there's a layover in the
// first place. Matched by flight number rather than arrival airport: the
// PDF's own routing table prints 3-letter IATA-style codes ("LIS"), while
// OpenAirLog uses 4-letter ICAO ("LPPT") for the exact same airport -
// confirmed on a real Umlaufcrewliste - so airport codes from the two
// sources are never comparable directly, but a flight number is written
// the same way in both.
function findPdfHotelFor(flightNumber, legs) {
  for (const leg of legs) {
    if (leg.hotel && leg.flightNumber === flightNumber) return leg.hotel;
  }
  return null;
}

// Best-effort: this PDF format has no confirmed "pickup" field, so just
// find a line mentioning it and pull out a UTC/LT time pair (taking the
// local half) or a plain HH:MM, falling back to the raw line if neither
// pattern matches - better than hiding a pickup note we can't fully parse.
function findPickupLocal(lines) {
  // "PU 4:20" - the actual abbreviation used in real rosters - checked
  // first since it directly gives an unambiguous clock time.
  const puRe = /\bPU\b\s*(\d{1,2}):(\d{2})\b/;
  for (const line of lines) {
    const m = line.match(puRe);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]} LT`;
  }

  // Fallback: a spelled-out "Pickup"/"Abholung" mention, format unconfirmed.
  const mentionRe = /pick[- ]?up|abholung/i;
  for (const line of lines) {
    if (!mentionRe.test(line)) continue;
    const pair = line.match(/(\d{3,4})\s*\/\s*(\d{3,4})/);
    if (pair) {
      const local = pair[2].padStart(4, "0");
      return `${local.slice(0, 2)}:${local.slice(2)} LT`;
    }
    const single = line.match(/\b(\d{1,2}):(\d{2})\b/);
    if (single) return `${single[1].padStart(2, "0")}:${single[2]} LT`;
    return line.trim();
  }
  return null;
}

const ROOM_STORAGE_KEY = "oal_room_numbers";

function roomKeyFor(arrCode, hotel) {
  return `${arrCode}|${hotel || ""}`;
}
function crewRoomKeyFor(arrCode, hotel, name) {
  return `${roomKeyFor(arrCode, hotel)}|${name}`;
}
function getRoomNumber(key) {
  try {
    const all = JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) || "{}");
    return all[key] || "";
  } catch { return ""; }
}
function setRoomNumber(key, value) {
  try {
    const all = JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) || "{}");
    all[key] = value;
    localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify(all));
  } catch { /* private mode etc. */ }
}

// ---------- duty status: vacation ("U<n>") / home day ("ORTSTAG") ----------
//
// OpenAirLog's non-flight duty entries confirmed by the pilot: "U" followed
// by a number is vacation, "ORTSTAG" is a scheduled day at home base with
// no duty. Both just mean "nothing to fly today", so on such a day the
// dashboard shows how many days remain until the next real duty instead of
// the generic "nothing planned" banner - and for Ortstag specifically,
// which cities the upcoming trip is expected to overnight in.
function classifyDutyCode(code) {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (/^U\d+$/.test(c)) return "vacation";
  if (c === "ORTSTAG") return "homeday";
  return null; // an unrecognized code (e.g. "--") - not handled specially
}

function todayDutyType() {
  const todayKey = localDateKey(new Date());
  for (const d of state.allDuties) {
    if (d.date !== todayKey) continue;
    const type = classifyDutyCode(d.dutyCode);
    if (type) return type;
  }
  return null;
}

const POST_LANDING_SWITCH_MS = 30 * 60 * 1000;
const BRIEFING_LEAD_MS = 120 * 60 * 1000;

// Once today's last flight has landed back at home base, the pilot wants
// the dashboard to switch into the same "Ortstag" view as an actual
// ORTSTAG duty_code would produce - 30 minutes after that flight's
// *scheduled* arrival, not the actual one (matches the rest of the app,
// which times things off the schedule rather than waiting on actual
// block times that may never get filled in). Only applies while looking
// at the last flight of the day, so manually browsing an earlier leg via
// the nav arrows isn't interrupted by the switch.
function shouldShowPostLandingHomeView() {
  const n = state.flights.length;
  if (!n || state.index !== n - 1) return false;
  const last = state.flights[n - 1];
  if (last.arrCode !== HOME_BASE || !last.arrSchedDate) return false;
  return Date.now() - last.arrSchedDate.getTime() >= POST_LANDING_SWITCH_MS;
}

// What renderDutyStatus() actually shows: either a real duty_code
// (vacation/Ortstag) or, absent that, the post-landing override above -
// both end up looking like "Ortstag" since either way there's no more
// flying scheduled for the rest of today.
function effectiveDutyType() {
  return todayDutyType() || (shouldShowPostLandingHomeView() ? "homeday" : null);
}

// First real flight strictly after today - "next duty" for both vacation
// and Ortstag alike, since a home day right after a vacation isn't duty
// either and should just extend the count (any non-flight day in between
// is simply skipped over by this search, no special-casing needed).
function nextDutyFlight() {
  const todayKey = localDateKey(new Date());
  return state.allFlights.find((f) => {
    const d = f.depSchedDate || f.depActualDate;
    return d && localDateKey(d) > todayKey;
  }) || null;
}

function daysUntil(dateKey) {
  const todayKey = localDateKey(new Date());
  const today = new Date(`${todayKey}T00:00:00`);
  const target = new Date(`${dateKey}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

// One entry per overnight stop of the upcoming trip, e.g. home base on the
// departure day, then each layover (the *last* airport reached each day,
// per the pilot's own phrasing), then home base again on the day the
// rotation ends. Feeds both the compact "FRA-LIS-…" route-chain string and
// the per-city weather popup, so the two always agree on which day
// belongs to which city.
function computeRouteStops(startFlight) {
  const homeBase = startFlight.depCode;
  const startIdx = state.allFlights.indexOf(startFlight);
  if (startIdx === -1) return null;

  const stops = [{ icao: homeBase, dateKey: startFlight.raw && startFlight.raw.date }];
  for (let i = startIdx; i < state.allFlights.length; i++) {
    const cur = state.allFlights[i];
    const next = state.allFlights[i + 1];

    // cur is the last flight reaching a given stop before an overnight -
    // either there's nothing after it (fetch window ran out), or the next
    // flight departs a later calendar day, or from a different airport
    // (a gap the data doesn't explain, treated the same way).
    //
    // Compares OpenAirLog's own "date" field (raw.date) directly, not a
    // calendar day derived from the UTC arrival/departure times - deriving
    // it via the device's *local* timezone (as an earlier version did)
    // could shift a late-UTC arrival into the next local calendar day,
    // making it collide with the next flight's departure date even though
    // a real overnight layover sits in between (e.g. an EDDF-LPPT arrival
    // at 22:35Z reads as 00:35 local in CEST, one local day "too late").
    const curDateKey = cur.raw && cur.raw.date;
    const nextDepDateKey = next && next.raw && next.raw.date;
    const isOvernightStop = !next || curDateKey !== nextDepDateKey || cur.arrCode !== next.depCode;
    if (!isOvernightStop) continue;

    // `flight` (the actual leg that reaches this stop, not just its ICAO/
    // date) lets rotationEndFlight() below find the real scheduled arrival
    // time for the "Ende: …" line - the chain string itself only needs
    // icao/dateKey.
    stops.push({ icao: cur.arrCode, dateKey: curDateKey, flight: cur });
    if (cur.arrCode === homeBase) break; // back home - rotation complete
    if (!next) break; // fetch window ran out - chain is incomplete but as far as we can tell
    if (stops.length >= 10) break; // sanity cap against malformed data
  }
  return stops;
}

// The flight that lands the upcoming trip back at home base, or null if
// the rotation doesn't return home within the fetched window (fetch
// window ran out) or is a "trip" that never leaves in the first place.
function rotationEndFlight(stops) {
  if (!stops || stops.length < 2) return null;
  const last = stops[stops.length - 1];
  return last.icao === HOME_BASE ? last.flight : null;
}

// ---------- per-city weather for the route chain (tap "Route: …") ----------
//
// Uses Open-Meteo (open-meteo.com) - free, no API key, CORS-enabled for
// direct browser use. Two calls per city: geocode the city name to
// coordinates, then a one-day forecast for that date. Forecasts are only
// available a limited number of days out (Open-Meteo's free tier: ~16
// days); a stop further out than that just shows as unavailable rather
// than guessing.

// WMO weather codes, as returned in Open-Meteo's `daily.weathercode` -
// https://open-meteo.com/en/docs - a short, stable public standard, not
// airline-internal data, so hardcoding it here is safe (unlike e.g. the
// 3-letter station codes elsewhere in this file).
const WEATHER_CODE_INFO = {
  0: { label: "Klar", icon: "☀️" },
  1: { label: "Meist klar", icon: "🌤️" },
  2: { label: "Teils bewölkt", icon: "⛅" },
  3: { label: "Bewölkt", icon: "☁️" },
  45: { label: "Nebel", icon: "🌫️" },
  48: { label: "Nebel (Reif)", icon: "🌫️" },
  51: { label: "Niesel leicht", icon: "🌦️" },
  53: { label: "Niesel", icon: "🌦️" },
  55: { label: "Niesel stark", icon: "🌦️" },
  56: { label: "Gefr. Niesel", icon: "🌧️" },
  57: { label: "Gefr. Niesel stark", icon: "🌧️" },
  61: { label: "Regen leicht", icon: "🌧️" },
  63: { label: "Regen", icon: "🌧️" },
  65: { label: "Regen stark", icon: "🌧️" },
  66: { label: "Gefr. Regen", icon: "🌧️" },
  67: { label: "Gefr. Regen stark", icon: "🌧️" },
  71: { label: "Schnee leicht", icon: "🌨️" },
  73: { label: "Schnee", icon: "🌨️" },
  75: { label: "Schnee stark", icon: "❄️" },
  77: { label: "Schneegriesel", icon: "❄️" },
  80: { label: "Schauer leicht", icon: "🌦️" },
  81: { label: "Schauer", icon: "🌦️" },
  82: { label: "Schauer stark", icon: "⛈️" },
  85: { label: "Schneeschauer", icon: "🌨️" },
  86: { label: "Schneeschauer stark", icon: "🌨️" },
  95: { label: "Gewitter", icon: "⛈️" },
  96: { label: "Gewitter mit Hagel", icon: "⛈️" },
  99: { label: "Gewitter mit Hagel", icon: "⛈️" },
};

function weatherInfoForCode(code) {
  return WEATHER_CODE_INFO[code] || { label: "Unbekannt", icon: "🌡️" };
}

// City labels from ICAO_CITY sometimes carry a disambiguating airport name
// in parentheses (e.g. "Rom (Fiumicino)", "London (Heathrow)") - strip
// that for the geocoding query, the plain city name resolves better.
function geocodeQueryFor(cityLabel) {
  return cityLabel.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

const geocodeCache = new Map(); // query -> {lat, lon} | null (null = not found/failed)

async function geocodeCity(cityLabel) {
  const query = geocodeQueryFor(cityLabel);
  if (geocodeCache.has(query)) return geocodeCache.get(query);

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=de&format=json`;
  let coords = null;
  try {
    const res = await fetchWithTimeout(url, {});
    if (res.ok) {
      const json = await res.json();
      const hit = json && Array.isArray(json.results) && json.results[0];
      if (hit) coords = { lat: hit.latitude, lon: hit.longitude };
    }
  } catch {
    // leave coords null - shown as "not found" to the pilot, not guessed
  }
  geocodeCache.set(query, coords);
  return coords;
}

async function fetchDailyWeather(lat, lon, dateKey) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto` +
    `&start_date=${dateKey}&end_date=${dateKey}`;
  try {
    const res = await fetchWithTimeout(url, {});
    if (!res.ok) return null;
    const json = await res.json();
    const d = json && json.daily;
    if (!d || !Array.isArray(d.time) || !d.time.length) return null;
    return { code: d.weathercode[0], tMax: d.temperature_2m_max[0], tMin: d.temperature_2m_min[0] };
  } catch {
    return null;
  }
}

// Current conditions (not a forecast) at the layover's city, shown right
// next to the place name - distinct from the route-chain forecast above,
// which is a future-dated daily outlook for planning, not "right now".
const currentWeatherCache = new Map(); // icao -> { temp, code, fetchedAt } | { fetchedAt } on failure
const CURRENT_WEATHER_CACHE_MS = 30 * 60 * 1000;

async function fetchCurrentWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
  try {
    const res = await fetchWithTimeout(url, {});
    if (!res.ok) return null;
    const json = await res.json();
    const cw = json && json.current_weather;
    if (!cw || typeof cw.temperature !== "number") return null;
    return { temp: cw.temperature, code: cw.weathercode };
  } catch {
    return null;
  }
}

// Fire-and-forget, same pattern as the other ensure*Loaded() helpers -
// caches (including failures, so a geocoding miss doesn't get retried on
// every render) and re-renders the layover card once resolved.
async function ensureCurrentWeatherLoaded(icao, cityLabel) {
  const cached = currentWeatherCache.get(icao);
  if (cached && Date.now() - cached.fetchedAt < CURRENT_WEATHER_CACHE_MS) return;

  const coords = await geocodeCity(cityLabel);
  const weather = coords ? await fetchCurrentWeather(coords.lat, coords.lon) : null;
  currentWeatherCache.set(icao, { ...(weather || {}), fetchedAt: Date.now() });
  renderLayover();
}

// ---------- MyTime roster (.ics) - pickup time ----------
//
// The roster share URL returns a raw iCalendar feed. Real event formats
// below are confirmed from an actual export, never guessed:
//   Flight:   "LH 1172: FRA-LIS"      (space after the airline code)
//   Deadhead: "DH LH 895: VNO-FRA"
//   Layover:  "Layover [LIS]"
//   Pickup:   "14:55 LT Pickup LIS"   (local time already spelled out)
//   Briefing: "20:00 LT Briefing FRA"
// Only Pickup is used here - the local-time string in SUMMARY is shown
// as-is, so no per-station timezone conversion is needed.

function parseIcsEvents(text) {
  const rawLines = text.split(/\r\n|\n|\r/);
  // Unfold continuation lines (a leading space/tab means "part of the
  // previous line") before splitting into KEY:VALUE pairs.
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") { if (current) events.push(current); current = null; continue; }
    if (!current) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).split(";")[0].toUpperCase();
    const value = line.slice(idx + 1);
    if (key === "SUMMARY") current.summary = value;
    else if (key === "LOCATION") current.location = value;
    else if (key === "DTSTART") current.dtstart = icsDateToDate(value);
    else if (key === "DTEND") current.dtend = icsDateToDate(value);
    else if (key === "DTSTAMP") current.dtstamp = icsDateToDate(value);
  }
  return events;
}

function icsDateToDate(value) {
  // "20260919T135500Z" (timed) or "20260803" (all-day date only). Every
  // confirmed real timed value is UTC - DTSTART/DTEND always carry the
  // "Z" suffix, and DTSTAMP is UTC by the iCalendar spec even in this
  // feed's export, which omits the "Z" on it - so timed values are
  // always read as UTC regardless of that suffix.
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value || "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (h === undefined) return new Date(Date.UTC(+y, +mo - 1, +d));
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

const PICKUP_SUMMARY_RE = /^(\d{2}:\d{2})\s*LT\s*Pickup\s+(\S+)/i;

// Next Pickup event for the given station after the layover's arrival
// time - "next" rather than "closest", since a pickup only ever makes
// sense in the future relative to landing.
function findRosterPickup(events, stationIcao, afterDate) {
  const station3 = threeLetterCode(stationIcao).toUpperCase();
  let best = null;
  for (const ev of events) {
    if (!ev.summary || !ev.dtstart) continue;
    const m = PICKUP_SUMMARY_RE.exec(ev.summary.trim());
    if (!m) continue;
    const evStation = (ev.location || m[2] || "").toUpperCase();
    if (evStation !== station3) continue;
    if (afterDate && ev.dtstart < afterDate) continue;
    if (!best || ev.dtstart < best.dtstart) best = { time: m[1], dtstart: ev.dtstart };
  }
  return best;
}

const rosterEventsCache = { events: null, dtstamp: null, fetchedAt: 0, url: null, lastError: null, viaProxy: null };

// By the time this runs, the direct fetch AND every proxy in
// rosterCorsProxyBuilders() have already failed - fetchRosterIcsText()
// throws with all of their outcomes joined together (e.g. "direkt:
// Failed to fetch | corsproxy.io: HTTP 401 – ... | api.allorigins.win:
// Load failed"), shown as-is rather than collapsed into one generic
// message. See renderRosterStatus(), which surfaces this instead of
// silently leaving the pilot looking at an unexplained backup pickup.
function describeRosterFetchError(e) {
  return (e && e.message) || "Unbekannter Fehler beim Abrufen.";
}

// Fire-and-forget, same pattern as ensureCurrentWeatherLoaded(): fetches
// api.lufthansa.com doesn't send CORS headers for this endpoint (it's
// built for calendar apps subscribing over webcal://, not a browser page's
// own JavaScript - confirmed against the pilot's real device: the direct
// fetch below always fails with a network/CORS-shaped error, even though
// the same URL works fine for a native calendar client). A public CORS
// proxy fetches it server-side instead and relays the bytes back with its
// own permissive CORS headers - meaning the roster link (with its
// embedded MyTime key) is sent to this third party too, not just
// Lufthansa; disclosed in the Settings copy above the roster input.
//
// More than one, tried in order: a single public proxy is unreliable on
// its own (confirmed against the pilot's real link - allorigins.win came
// back with a bare "HTTP 400", which could be its own rate-limiting, a
// transient outage, or Lufthansa's server itself rejecting a request
// that arrives from a known proxy's IP/user-agent - not distinguishable
// from here). If one is down or blocked, the next gets a chance instead
// of the whole feature failing. corsproxy.io now requires an API key
// (confirmed: HTTP 401 without one) - see CORSPROXY_KEY_STORAGE_KEY;
// when the pilot has one, it's tried FIRST (an authenticated request is
// more likely to succeed than a free anonymous one), otherwise it's
// skipped entirely rather than wasting a round trip on a guaranteed 401.
function rosterCorsProxyBuilders() {
  const key = getCorsProxyKey();
  const allorigins = (url) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
  const corsproxyIo = (url) =>
    "https://corsproxy.io/?url=" + encodeURIComponent(url) + (key ? "&key=" + encodeURIComponent(key) : "");
  return key ? [corsproxyIo, allorigins] : [allorigins];
}

// One fetch attempt against `url`; throws with as much detail as the
// response actually gives (status + a short body snippet, since a proxy
// failure's body often explains why - e.g. an upstream rejection - far
// better than the bare status code alone).
async function fetchTextOrThrow(url) {
  // no-store: this URL never changes, so without it the browser's own
  // HTTP cache can silently keep answering from an old snapshot - a
  // real "refresh did nothing" bug this app has no way to detect, since
  // force just skips OUR cache, not the browser's underneath it.
  const res = await fetchWithTimeout(url, { cache: "no-store" });
  if (res.ok) return res.text();
  const snippet = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}${snippet ? ` – ${snippet.trim().slice(0, 150)}` : ""}`);
}

function briefErrorReason(e) {
  return e && e.name === "AbortError" ? "Zeitüberschreitung" : (e && e.message) || String(e);
}

// Tries the roster URL directly first (kept in case api.lufthansa.com
// ever adds CORS support, or a future roster source doesn't need a
// proxy at all), then each of rosterCorsProxyBuilders() in turn once
// that fails - so a direct success never touches any third party.
// Returns {text, viaProxy} (viaProxy is null for a direct success, else
// the proxy's hostname) on the first one that works, or - if all of them
// fail - throws with EVERY attempt's own outcome joined together, not
// just the last one. Losing the earlier ones made a chained failure
// undiagnosable from the outside: with a corsproxy.io key configured, a
// bare "api.allorigins.win: Load failed" said nothing about whether
// corsproxy.io itself had even been tried, or why it failed first.
async function fetchRosterIcsText(url) {
  const attempts = [];
  try {
    return { text: await fetchTextOrThrow(url), viaProxy: null };
  } catch (e) {
    attempts.push(`direkt: ${briefErrorReason(e)}`);
  }
  for (const buildProxyUrl of rosterCorsProxyBuilders()) {
    const proxied = buildProxyUrl(url);
    const hostname = new URL(proxied).hostname;
    try {
      const text = await fetchTextOrThrow(proxied);
      return { text, viaProxy: hostname };
    } catch (e) {
      attempts.push(`${hostname}: ${briefErrorReason(e)}`);
    }
  }
  throw new Error(attempts.join(" | "));
}

// Fire-and-forget, same pattern as ensureCurrentWeatherLoaded(): fetches
// once per URL and never again on its own (no automatic refresh - see
// refreshAll()), then re-renders so anything reading rosterEventsCache
// (pickup times, see findRosterPickupForFlight()) picks it up. force
// bypasses the "already fetched this URL" check, used by refreshAll()
// to actually pull a new copy on ↻ instead of reusing the cached one.
// A fetch already in flight, joined instead of starting another one -
// resolveLayoverPickup() now calls this from inside renderLayover(),
// which itself fires on every renderFlight() (every 30s tick, and
// several times per render pass) instead of from just a few dedicated
// call sites. Before this guard existed, several of those calls landing
// while the very first fetch was still pending (rosterEventsCache.events
// not set yet, so the "already cached" check doesn't help) each kicked
// off their own real network request - up to 6 concurrent hits for one
// tap of ↻ in testing. Wasteful in general, and a real cost against a
// rate-limited or metered CORS proxy (see rosterCorsProxyBuilders()).
let rosterLoadPromise = null;

async function ensureRosterLoaded(force) {
  const url = getRosterUrl();
  if (!url) return;
  if (!force && rosterEventsCache.url === url && rosterEventsCache.events) return;
  if (rosterLoadPromise) return rosterLoadPromise;
  rosterLoadPromise = (async () => {
    try {
      const { text, viaProxy } = await fetchRosterIcsText(url);
      const events = parseIcsEvents(text);
      rosterEventsCache.events = events;
      rosterEventsCache.dtstamp = events.find((ev) => ev.dtstamp)?.dtstamp || null;
      rosterEventsCache.fetchedAt = Date.now();
      rosterEventsCache.url = url;
      rosterEventsCache.viaProxy = viaProxy;
      rosterEventsCache.lastError = null;
      renderRosterStatus();

      // The last flight's transit line (and the Layover card) depend on
      // roster data too (its pickup time, see findRosterPickupForFlight()) -
      // re-render now that it's arrived. Scheduled flight times themselves
      // (depSchedDate/arrSchedDate) are never touched by roster data - see
      // computeMaxLegalOnBlock()'s comment: an earlier "trust whichever
      // source is fresher" override here shifted a flight's own scheduled
      // time away from OpenAirLog's, which in turn silently changed the
      // legal FDP limit already shown - confirmed wrong against a real eFF
      // screen, since FDP is computed against the officially planned
      // report time, not whatever a re-fetch happens to disagree on.
      renderFlight();
      renderLayover();
    } catch (e) {
      // Stays stale, retried on next call - but now at least visible in
      // Settings (see renderRosterStatus()) instead of a silent no-op.
      rosterEventsCache.lastError = describeRosterFetchError(e);
      renderRosterStatus();
    } finally {
      rosterLoadPromise = null;
    }
  })();
  return rosterLoadPromise;
}

// ---------- AeroDataBox - aircraft's full day schedule ----------
//
// Confirmed real response shape from a live api.market call to
// GET {AERODATABOX_BASE}/flights/Reg/{reg}?withAircraftImage=false&withLocation=false
// (header "x-api-market-key"): an array of flight objects, each with
// departure.airport.{icao,iata}, departure.scheduledTime.utc
// ("2026-09-19 06:25Z"), departure.revisedTime.utc (same shape, updated/
// actual), arrival (same shape, plus sometimes predictedTime instead of
// revisedTime for a still-scheduled flight), number ("LH 1173"), status,
// codeshareStatus ("IsOperator" | "IsCodeshared"), aircraft.reg. The SAME
// physical flight appears once per marketing carrier - a real LIS-FRA leg
// came back as six different flight numbers (LH, AC, OS, TG, TP, UA) all
// sharing the same departure/arrival airports and scheduled time - so
// this is deduplicated down to one entry per physical leg, preferring
// whichever duplicate is the "IsOperator" (operating carrier) record.

function parseAeroDataBoxUtc(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})Z$/.exec(s || "");
  return m ? new Date(`${m[1]}T${m[2]}:00Z`) : null;
}

function dedupeAircraftLegs(raw) {
  const byKey = new Map();
  for (const leg of raw) {
    const depIcao = leg.departure && leg.departure.airport && leg.departure.airport.icao;
    const arrIcao = leg.arrival && leg.arrival.airport && leg.arrival.airport.icao;
    const depUtc = leg.departure && leg.departure.scheduledTime && leg.departure.scheduledTime.utc;
    if (!depIcao || !arrIcao || !depUtc) continue;
    const key = `${depIcao}-${arrIcao}-${depUtc}`;
    const existing = byKey.get(key);
    if (!existing || (leg.codeshareStatus === "IsOperator" && existing.codeshareStatus !== "IsOperator")) {
      byKey.set(key, leg);
    }
  }
  return [...byKey.values()];
}

function normalizeAircraftLeg(leg) {
  const dep = leg.departure || {};
  const arr = leg.arrival || {};
  // runwayTime is only populated once the aircraft has actually left/
  // reached the blocks - preferred over revisedTime/predictedTime (still
  // just estimates) whenever it's there, so the deviation display below
  // the departure/arrival time reflects the real off-block/on-block
  // moment rather than the last estimate before it happened.
  const depDate = parseAeroDataBoxUtc(
    (dep.runwayTime && dep.runwayTime.utc) || (dep.revisedTime && dep.revisedTime.utc) || (dep.scheduledTime && dep.scheduledTime.utc)
  );
  const arrDate = parseAeroDataBoxUtc(
    (arr.runwayTime && arr.runwayTime.utc) || (arr.revisedTime && arr.revisedTime.utc) || (arr.predictedTime && arr.predictedTime.utc) || (arr.scheduledTime && arr.scheduledTime.utc)
  );
  return {
    depCode: (dep.airport && dep.airport.icao) || "---",
    arrCode: (arr.airport && arr.airport.icao) || "---",
    depDate, arrDate,
    // Genuinely confirmed off-block only (never a revised/scheduled
    // estimate) - see updateFlightTimerDisplay(), which keeps the
    // countdown pill showing until this specifically is set, not just
    // any depDate (a revised estimate alone isn't "off block" yet).
    depRunwayDate: parseAeroDataBoxUtc(dep.runwayTime && dep.runwayTime.utc),
    // Scheduled-only (never revised) - kept separate from depDate/arrDate
    // above for callers that specifically want the plan rather than the
    // live/updated time, e.g. the "outbound" label's departure.
    depSchedDate: parseAeroDataBoxUtc(dep.scheduledTime && dep.scheduledTime.utc),
    arrSchedDate: parseAeroDataBoxUtc(arr.scheduledTime && arr.scheduledTime.utc),
    flightNumber: String(leg.number || "").replace(/\s+/g, ""),
    status: leg.status || "",
    registration: (leg.aircraft && leg.aircraft.reg) || null,
    callSign: leg.callSign || null,
  };
}

const aircraftScheduleCache = new Map(); // registration -> { legs, fetchedAt }

async function fetchAircraftSchedule(registration) {
  const key = getAeroDataBoxKey();
  if (!key || !registration || registration === "–") return null;
  const url = `${AERODATABOX_BASE}/flights/Reg/${encodeURIComponent(registration)}?withAircraftImage=false&withLocation=false`;
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: "application/json", "x-api-market-key": key } });
    if (!res.ok) {
      console.warn("[AeroDataBox] flights/Reg failed", res.status, url);
      return null;
    }
    const json = await res.json();
    if (!Array.isArray(json)) {
      console.warn("[AeroDataBox] flights/Reg: unexpected response shape", json);
      return null;
    }
    return dedupeAircraftLegs(json)
      .map(normalizeAircraftLeg)
      .filter((leg) => leg.depDate)
      .sort((a, b) => a.depDate - b.depDate);
  } catch (err) {
    // A CORS rejection surfaces here as a plain "Failed to fetch"
    // TypeError - the browser gives no more detail than that, but at
    // least this makes the failure visible instead of just "no data ever
    // appears" with nothing in the console to explain why.
    console.warn("[AeroDataBox] flights/Reg request failed (network/CORS?)", err, url);
    return null;
  }
}

// When OpenAirLog doesn't give a registration for a flight (seen on some
// future-dated entries), fall back to looking that one flight up by its
// own number/date instead - confirmed real endpoint and response shape:
// GET {AERODATABOX_BASE}/flights/Number/{number}/{date} returns a single
// flight object (not an array, unlike /flights/Reg/{reg}), including
// aircraft.reg - so this also backfills the missing registration, which
// is what lets the existing Reg-based schedule lookup and "next A/C"
// line work exactly as before from here on.
async function fetchFlightByNumber(flightNumber, dateKey) {
  const key = getAeroDataBoxKey();
  if (!key || !flightNumber || !dateKey) return null;
  const url = `${AERODATABOX_BASE}/flights/Number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(dateKey)}`;
  try {
    const res = await fetchWithTimeout(url, { headers: { accept: "application/json", "x-api-market-key": key } });
    if (!res.ok) {
      console.warn("[AeroDataBox] flights/Number failed", res.status, url);
      return null;
    }
    const json = await res.json();
    // Confirmed via the in-app connection test: this endpoint doesn't
    // always return a single object the way our first real sample did -
    // for some flight number/date combinations it comes back as an array
    // (e.g. more than one codeshare/leg match), same as /flights/Reg/{reg}
    // already has to handle via dedupeAircraftLegs().
    const entries = Array.isArray(json) ? json : json ? [json] : [];
    if (!entries.length) {
      console.warn("[AeroDataBox] flights/Number: empty response", json);
      return null;
    }
    const best = entries.find((e) => e.codeshareStatus === "IsOperator") || entries[0];
    return normalizeAircraftLeg(best);
  } catch (err) {
    console.warn("[AeroDataBox] flights/Number request failed (network/CORS?)", err, url);
    return null;
  }
}

const flightByNumberCache = new Map(); // "flightNumber|dateKey" -> { leg, fetchedAt }
const flightByNumberLoading = new Set(); // cacheKey currently in flight, to avoid duplicate requests -
// buildPdfRefMap() can ask for the same flight number/date from several
// crew rows (and re-renders) before the first request even resolves.

// Fire-and-forget, same pattern as ensureAircraftScheduleLoaded() - once
// this resolves a registration, also kicks off the normal Reg-based
// schedule lookup for it so findPriorLegArrival() has something to work
// with on the next render.
async function ensureFlightByNumberLoaded(flightNumber, dateKey) {
  const cacheKey = `${flightNumber}|${dateKey}`;
  if (flightByNumberLoading.has(cacheKey)) return;
  flightByNumberLoading.add(cacheKey);
  const leg = await fetchFlightByNumber(flightNumber, dateKey);
  flightByNumberLoading.delete(cacheKey);
  flightByNumberCache.set(cacheKey, { leg, fetchedAt: Date.now() });
  if (leg && leg.registration) ensureAircraftScheduleLoaded(leg.registration);
  else renderFlight();
}

// Within that aircraft's day schedule, the leg landing at the given
// station right before the given departure time - i.e. what this
// aircraft flew immediately before becoming available for pickup there.
// Requires an exact station match for the same reason findApiLayover()'s
// predecessor (findIncomingLeg(), since removed) did: without it there
// could be an earlier, unrelated leg in between.
function findPriorLegArrival(legs, stationIcao, beforeDate) {
  if (!legs || !beforeDate) return null;
  let best = null;
  for (const leg of legs) {
    if (leg.arrCode !== stationIcao || !leg.arrDate || leg.arrDate >= beforeDate) continue;
    if (!best || leg.arrDate > best.arrDate) best = leg;
  }
  return best;
}

// Fire-and-forget, same pattern as ensureCurrentWeatherLoaded(): fetches
// once per registration, caches (including failures, as an empty list,
// so a lookup miss doesn't retry every render), then re-renders.
async function ensureAircraftScheduleLoaded(registration) {
  const legs = await fetchAircraftSchedule(registration);
  aircraftScheduleCache.set(registration, { legs: legs || [], fetchedAt: Date.now() });
  renderFlight();
}

let currentRouteStops = null;   // [{icao, dateKey}] for the route currently shown, or null
let routeWeatherLoaded = false; // avoid re-fetching every time the panel is toggled open again

function buildRouteWeatherRow(stop) {
  const row = document.createElement("div");
  row.className = "route-weather-row";

  const cityLabel = ICAO_CITY[stop.icao] || threeLetterCode(stop.icao);
  const dateLabel = stop.dateKey
    ? `${weekdayShortForDateKey(stop.dateKey)}, ${new Date(`${stop.dateKey}T00:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`
    : "–";

  const city = document.createElement("span");
  city.className = "route-weather-city";
  city.textContent = `${cityLabel} (${dateLabel})`;

  const info = document.createElement("span");
  info.className = "route-weather-info muted";
  info.textContent = "…";

  row.appendChild(city);
  row.appendChild(info);
  return { row, infoEl: info };
}

async function loadRouteWeather() {
  if (!currentRouteStops || routeWeatherLoaded) return;
  routeWeatherLoaded = true;

  els.dutyStatusWeather.innerHTML = "";
  // Home base is skipped - the pilot's already there (or about to be),
  // its weather isn't the point of this panel. Doesn't affect the
  // "FRA-LIS-…" route-chain text itself, only this weather list.
  const weatherStops = currentRouteStops.filter((s) => s.icao !== HOME_BASE);
  const rows = weatherStops.map((stop) => {
    const { row, infoEl } = buildRouteWeatherRow(stop);
    els.dutyStatusWeather.appendChild(row);
    return { stop, infoEl };
  });

  await Promise.all(rows.map(async ({ stop, infoEl }) => {
    if (!stop.dateKey) {
      infoEl.textContent = "Kein Datum";
      return;
    }
    const cityLabel = ICAO_CITY[stop.icao] || stop.icao;
    const coords = await geocodeCity(cityLabel);
    if (!coords) {
      infoEl.textContent = "Ort nicht gefunden";
      return;
    }
    const weather = await fetchDailyWeather(coords.lat, coords.lon, stop.dateKey);
    if (!weather) {
      infoEl.textContent = "Kein Forecast (zu weit voraus)";
      return;
    }
    const info = weatherInfoForCode(weather.code);
    infoEl.textContent = `${info.icon} ${Math.round(weather.tMin)}–${Math.round(weather.tMax)}°C`;
    infoEl.title = info.label;
  }));
}

function toggleRouteWeather() {
  const willOpen = els.dutyStatusWeather.hidden;
  els.dutyStatusWeather.hidden = !willOpen;
  els.dutyStatusRouteBtn.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) loadRouteWeather();
}

function renderDutyStatus() {
  const type = effectiveDutyType();
  if (!type) {
    els.dutyStatusCard.hidden = true;
    return;
  }

  const next = nextDutyFlight();
  // Header badge shows the *upcoming* duty's airline while on Ortstag/
  // Urlaub - falls back to the plain dot only if there's no next duty at
  // all to show one for.
  renderAirlineBadge(next ? next.flightNumber : null);
  els.dutyStatusCard.hidden = false;
  // "Ortstag" itself isn't shown - the countdown/briefing/route text
  // already makes clear there's no flight today without needing the
  // label spelled out. "Urlaub" still gets a title, since nothing else
  // on the card says so otherwise.
  els.dutyStatusTitle.hidden = type !== "vacation";
  els.dutyStatusTitle.textContent = type === "vacation" ? "Urlaub" : "";

  if (!next) {
    els.dutyStatusCountdown.textContent = "Kein weiterer Dienst in den nächsten 3 Wochen geplant.";
    els.dutyStatusBriefing.hidden = true;
    els.dutyStatusEnd.hidden = true;
    els.dutyStatusRouteBtn.hidden = true;
    els.dutyStatusWeather.hidden = true;
    currentRouteStops = null;
  } else {
    const nextDate = next.depSchedDate || next.depActualDate;
    const days = daysUntil(localDateKey(nextDate));
    const dayWord = days === 1 ? "Tag" : "Tage";
    els.dutyStatusCountdown.textContent = `Noch ${days} ${dayWord} bis zum nächsten Dienst.`;

    // Briefing = 120 min before the next duty's scheduled departure, shown
    // in local (not Zulu) time since that's what actually determines when
    // to leave for the airport.
    if (next.depSchedDate) {
      const briefing = new Date(next.depSchedDate.getTime() - BRIEFING_LEAD_MS);
      const briefingDateLabel = `${weekdayShortLocal(briefing)}, ${briefing.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`;
      els.dutyStatusBriefing.hidden = false;
      els.dutyStatusBriefingValue.textContent = `${briefingDateLabel} - ${fmtLocalTime(briefing)} LT`;
    } else {
      els.dutyStatusBriefing.hidden = true;
    }

    // Route chain (e.g. "EDDF-LUKK-EPPO-EDDF") - shown on both Urlaub and
    // Ortstag alike, not just Ortstag as before. Tapping it shows a short
    // per-city weather overview (see toggleRouteWeather()).
    const stops = computeRouteStops(next);
    const route = stops ? stops.map((s) => threeLetterCode(s.icao)).join("-") : null;
    currentRouteStops = stops;

    // Ende der Tour = letzte Landung in Frankfurt + 30 Minuten - the same
    // "30 min after landing" moment that switches today's own view into
    // Ortstag mode (shouldShowPostLandingHomeView), just for the *end* of
    // the upcoming trip instead of today. Local time, like the briefing.
    const endFlight = rotationEndFlight(stops);
    if (endFlight && endFlight.arrSchedDate) {
      const end = new Date(endFlight.arrSchedDate.getTime() + POST_LANDING_SWITCH_MS);
      const endDateLabel = `${weekdayShortLocal(end)}, ${end.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`;
      els.dutyStatusEnd.hidden = false;
      els.dutyStatusEndValue.textContent = `${endDateLabel} - ${fmtLocalTime(end)} LT`;
    } else {
      els.dutyStatusEnd.hidden = true;
    }
    routeWeatherLoaded = false;
    els.dutyStatusWeather.hidden = true;
    els.dutyStatusWeather.innerHTML = "";
    els.dutyStatusRouteBtn.hidden = !route;
    els.dutyStatusRouteBtn.setAttribute("aria-expanded", "false");
    els.dutyStatusRouteBtn.textContent = route ? `Route: ${route}` : "";
  }
}

// Called every 30s (see the ticker below) to catch the post-landing switch
// live, without going through the full renderFlight() - unnecessary here
// since this is a purely time-based UI transition with no new data to load.
function tickPostLandingSwitch() {
  if (els.flightCardTrack.hidden || !shouldShowPostLandingHomeView()) return;
  els.flightCardTrack.hidden = true;
  els.crewCard.hidden = true;
  els.flightCardDots.hidden = true;
  renderDutyStatus();
  const nothingToShow = els.layoverCard.hidden && els.dutyStatusCard.hidden;
  showBanner(nothingToShow ? "Heute nichts geplant." : "", "");
}

let currentLayoverKey = null; // roomKeyFor(arrCode, hotel) for the own room-number input

function renderLayover() {
  // Belt-and-suspenders on top of the HOME_BASE check in findApiLayover():
  // no layover card (and thus no room-number field) while on vacation or
  // an Ortstag - there's nowhere to have a hotel room on either. Also
  // drops off (see layoverPickupCutoffPassed()) once the pilot's actually
  // been picked up, 5 minutes later - renderFlight() then takes back over
  // and shows the ordinary flight-card carousel again.
  const layover = effectiveDutyType() ? null : findApiLayover(state.allFlights);
  const active = !!layover && !layoverPickupCutoffPassed(layover);
  // Once today's last flight has departed but the official gate above
  // hasn't fired yet, previewLayoverFlight() is the look-ahead page
  // attached to the ordinary flight-card carousel (see buildFlightCards()/
  // renderFlight()) - checked here too, not just from renderFlight()
  // itself, so a standalone renderLayover() call from an unrelated async
  // callback (e.g. ensureCurrentWeatherLoaded() below, once its fetch
  // resolves) doesn't wrongly hide/detach the card out from under that
  // preview between renderFlight() passes.
  const preview = !active && !effectiveDutyType() ? previewLayoverFlight() : null;
  const effective = active ? layover : preview;
  els.layoverCard.hidden = !effective;
  currentLayoverKey = null;
  if (!effective) {
    // Not part of renderLayoverCarousel()'s own carousel (its cards are
    // rebuilt from scratch there) - back at its native spot in index.html
    // (right after #crewCard), so buildFlightCards()'s innerHTML="" wipe
    // of the ordinary #flightCardTrack can't silently orphan it if it
    // was still sitting in there from a layover that just ended.
    if (els.layoverCard.parentElement !== els.flightCardTrack && els.layoverCard.previousElementSibling !== els.crewCard) {
      els.crewCard.after(els.layoverCard);
    }
    return;
  }

  fillLayoverCardContent(effective);
}

// The Layover card's own content, shared between the officially active
// (30+ min post-arrival, see findApiLayover()) case above and the earlier
// look-ahead preview attached to the ordinary flight-card carousel (see
// previewLayoverFlight()/renderFlight()) - both just fill the same real
// els.layoverCard, wherever it currently lives in the DOM.
function fillLayoverCardContent(layover) {
  const hotel = layover.flight ? findPdfHotelFor(layover.flight.flightNumber, state.pdfLegs) : null;
  currentLayoverKey = roomKeyFor(layover.arrCode, hotel);

  els.layoverTitle.hidden = false;
  els.layoverPlace.hidden = false;

  // Only ever shown when the MyTime roster actually has a matching
  // event (see findRosterPickupForFlight()) - no more reference-sheet
  // estimate as a fallback, and so no more green/orange source coloring
  // either (resolveLayoverPickup(), with that estimate, is still used
  // separately but only internally by layoverPickupCutoffPassed() below).
  const rosterPickup = layover.flight ? findRosterPickupForFlight(layover.flight) : null;
  els.layoverPickup.hidden = !rosterPickup;
  els.layoverPickup.textContent = rosterPickup ? `Pickup: ${rosterPickup.time} LT` : "";
  els.layoverPickup.classList.remove("is-roster", "is-backup");

  const city = cityForIcao(layover.arrCode);
  els.layoverPlace.textContent = city || layover.arrCode;

  const cachedWeather = currentWeatherCache.get(layover.arrCode);
  if (cachedWeather === undefined) ensureCurrentWeatherLoaded(layover.arrCode, city || threeLetterCode(layover.arrCode));
  els.layoverWeather.hidden = !cachedWeather || typeof cachedWeather.temp !== "number";
  if (cachedWeather && typeof cachedWeather.temp === "number") {
    const info = weatherInfoForCode(cachedWeather.code);
    els.layoverWeather.textContent = `${info.icon} ${Math.round(cachedWeather.temp)}°C`;
  }

  els.layoverHotel.hidden = !hotel;
  els.layoverHotel.textContent = hotel || "";
  els.roomNumberInput.value = getRoomNumber(currentLayoverKey);

  renderLayoverCurrency(layover.arrCode);

  els.roomDetails.hidden = false;
  renderLayoverCrew(layover.arrCode, hotel, layover.flight);
}

// Rebuilds #flightCardTrack/#flightCardDots for the Layover carousel:
// the real #layoverCard element as page 0 (moved in, not cloned - see
// renderLayover(), the only place that ever moves it back out), then one
// cloned flight-card template per checkout-day sector. Only called from
// renderLayoverCarousel() when that day's sector set has actually
// changed - same signature-gated rebuild pattern as buildFlightCards().
function buildLayoverCarousel(extraFlights) {
  els.flightCardTrack.innerHTML = "";
  els.flightCardDots.innerHTML = "";
  els.flightCardTrack.appendChild(els.layoverCard);
  const layoverDot = document.createElement("span");
  layoverDot.className = "dot";
  els.flightCardDots.appendChild(layoverDot);
  state.layoverCardNodes = extraFlights.map(() => {
    const node = els.flightCardTemplate.content.firstElementChild.cloneNode(true);
    els.flightCardTrack.appendChild(node);
    const dot = document.createElement("span");
    dot.className = "dot";
    els.flightCardDots.appendChild(dot);
    return node;
  });
}

let lastLayoverCarouselSignature = null;

// The Layover card's own carousel: itself as the leading page, followed
// by the checkout day's own sectors (the flights departing from this
// layover, e.g. "Layover Billund - LH839 - LH146 - LH147 - ..."), for
// scrolling - requested after the flight-card carousel's own attempt at
// merging the two (with the layover appended LAST, and drawing from
// today's own state.flights, which could be a completely unrelated day
// of a multi-day rotation) turned out confusing in practice. This one
// only ever draws from the checkout day's own sectors (sectorsForDutyDay()
// on whatever flight comes right after the layover in the loaded
// rotation), and always leads with the Layover card, never trails it.
function renderLayoverCarousel(layover) {
  const onward = adjacentFlight(layover.flight, 1);
  const extraFlights = onward ? sectorsForDutyDay(onward) : [];
  state.layoverFlights = extraFlights;

  const signature = `${layover.arrCode}@${layover.arrTime ? layover.arrTime.getTime() : ""}|${flightsSignature(extraFlights)}`;
  const rebuilt = signature !== lastLayoverCarouselSignature;
  if (rebuilt) {
    buildLayoverCarousel(extraFlights);
    lastLayoverCarouselSignature = signature;
    state.layoverPageIndex = 0; // always lands on the Layover page itself first
  }

  els.flightCardTrack.hidden = false;
  els.flightCardDots.hidden = 1 + extraFlights.length <= 1;

  renderLayover(); // fills page 0's own content
  extraFlights.forEach((flight, i) => {
    renderFlightCardContent(extraFlights, state.layoverCardNodes, i, i === state.layoverPageIndex - 1);
  });
  if (rebuilt) scrollTrackToIndex(state.layoverPageIndex);
  renderFlightDots();
  updateTrackHeight();

  if (state.layoverPageIndex === 0) {
    els.crewCard.hidden = true;
    return;
  }
  const f = extraFlights[state.layoverPageIndex - 1];
  els.crewCard.hidden = !f;
  if (f) {
    renderAirlineBadge(f.flightNumber);
    renderCrew(f);
    ensureCrewLoaded(f);
  }
}

// Mirror of renderActiveFlightExtras(), for whichever page of the Layover
// carousel (see renderLayoverCarousel()) is currently scrolled to.
function renderActiveLayoverExtras() {
  renderFlightDots();
  updateTrackHeight();
  const layover = effectiveDutyType() ? null : findApiLayover(state.allFlights);
  if (state.layoverPageIndex === 0 || !layover) {
    els.crewCard.hidden = true;
    renderAirlineBadge(layover && layover.flight ? layover.flight.flightNumber : null);
    return;
  }
  const f = state.layoverFlights[state.layoverPageIndex - 1];
  if (!f) return;
  renderFlightCardContent(state.layoverFlights, state.layoverCardNodes, state.layoverPageIndex - 1, true);
  els.crewCard.hidden = false;
  renderAirlineBadge(f.flightNumber);
  renderCrew(f);
  ensureCrewLoaded(f);
}

// First name only: OpenAirLog partly anonymizes crew (colleagues show as
// "H., Nicolas" - initial + full first name, only "is_self" gets a full
// surname), so the first name is the one part reliably comparable between
// OpenAirLog and a PDF's full names.
function firstNameOf(name) {
  const idx = name.indexOf(",");
  return (idx >= 0 ? name.slice(idx + 1) : name).trim().toLowerCase();
}

const OWN_NAME_STORAGE_KEY = "oal_own_name";
function getOwnName() {
  try { return localStorage.getItem(OWN_NAME_STORAGE_KEY) || ""; } catch { return ""; }
}
function setOwnName(name) {
  try { localStorage.setItem(OWN_NAME_STORAGE_KEY, name); } catch { /* private mode etc. */ }
}

// Auto-detects the pilot's own name from a flight's crew list, so it
// doesn't have to be typed in by hand. Two confirmed, real-data-verified
// signals (not a guess about unpublished airline-internal data - this is
// how OpenAirLog's own response is actually shaped):
// 1. The flight itself carries the pilot's own role as crew_position
//    (e.g. "CP") - the crew entry with that same role is, by definition,
//    this pilot.
// 2. OpenAirLog only gives the *authenticated pilot's own* crew entry a
//    full, un-anonymized name ("Droste, Alexander"); every colleague is
//    shown reduced to a single initial ("H., Nicolas") - confirmed across
//    multiple real flights. Kept as a fallback for the (should be rare)
//    case where crew_position doesn't line up with any crew role.
function detectOwnName(f, apiCrew) {
  if (!apiCrew || !apiCrew.length) return null;

  const myRole = f && f.raw && f.raw.crew_position;
  if (myRole) {
    const match = apiCrew.find((m) => m.role && m.role.toUpperCase() === String(myRole).toUpperCase());
    if (match && match.name && match.name.includes(",")) return match.name;
  }

  const unanonymized = apiCrew.filter((m) => {
    const comma = m.name.indexOf(",");
    if (comma === -1) return false;
    return !/^[A-ZÄÖÜ]\.$/.test(m.name.slice(0, comma).trim());
  });
  return unanonymized.length === 1 ? unanonymized[0].name : null;
}

// Keeps the stored own name in sync with what OpenAirLog's crew data says
// - fully automatic, no manual entry anywhere in the UI.
function applyDetectedOwnName(name) {
  if (getOwnName() === name) return;
  setOwnName(name);
  renderBrandName();
}

// The Settings field stores the name the same way OpenAirLog/the PDF write
// it ("Nachname, Vorname"), but the header reads better the natural way
// round ("Vorname Nachname"). A name typed without a comma is shown as-is.
function formatOwnNameForDisplay(name) {
  const idx = name.indexOf(",");
  if (idx < 0) return name.trim();
  const last = name.slice(0, idx).trim();
  const first = name.slice(idx + 1).trim();
  return first && last ? `${first} ${last}` : name.trim();
}

function renderBrandName() {
  const ownName = getOwnName().trim();
  els.brandName.textContent = ownName ? formatOwnNameForDisplay(ownName) : "PilotDashboard";
}

// Full-name match first (works when typed exactly as in the PDF), falling
// back to first name only - the same anonymization-robust comparison used
// for the OpenAirLog/PDF crew match, since "own name" might be typed to
// match either source's formatting.
function isOwnName(memberName, ownName) {
  if (!ownName) return false;
  const a = memberName.trim().toLowerCase();
  const b = ownName.trim().toLowerCase();
  if (!b) return false;
  if (a === b) return true;
  const fa = firstNameOf(memberName);
  return !!fa && fa === firstNameOf(ownName);
}

function allKnownApiCrewNames() {
  const names = new Set();
  for (const f of state.allFlights) {
    for (const m of f.embeddedCrew) names.add(firstNameOf(m.name));
  }
  return names;
}

// True if there's nothing to compare against (no OpenAirLog crew data
// loaded yet) or the PDF crew shares at least one first name with it -
// false only when both have data and share *no* names at all, i.e. the
// PDF is very likely for a different/stale rotation.
function crewListsPlausiblyMatch(pdfCrew) {
  const apiNames = allKnownApiCrewNames();
  if (!apiNames.size) return true;
  return pdfCrew.some((m) => apiNames.has(firstNameOf(m.name)));
}

// Only shown once a PDF has been uploaded *and* accepted as the active
// crew source. Narrowed to whoever's actually on the flight that landed
// here (so they're really at this layover, not just listed somewhere else
// in the PDF) and still on the next flight too (a room number is only
// useful for coordinating with someone who's still around tomorrow, not
// a colleague leaving the crew at this stop) - determined from
// OpenAirLog's own per-flight crew, the same live comparison the join/
// leave arrows already use, rather than the PDF's flat list.
function renderLayoverCrew(arrCode, hotel, flight) {
  const allCrew = state.crewSource === "pdf" && state.pdfCrew && state.pdfCrew.crew.length ? state.pdfCrew.crew : [];
  const ownName = getOwnName();
  let crew = allCrew.filter((m) => !isOwnName(m.name, ownName));

  const hereCrew = flight ? adjacentFlightCrew(flight, 0) : null;
  const nextCrew = flight ? adjacentFlightCrew(flight, 1) : null;
  crew = hereCrew && nextCrew
    ? crew.filter((m) => {
        const key = crewKey(m.role, m.name);
        return hereCrew.some((c) => crewKey(c.role, c.name) === key) &&
          nextCrew.some((c) => crewKey(c.role, c.name) === key);
      })
    : [];

  // The PDF crew list has one row per block a person appears in (see
  // parseCrewFromLines()) - the same person can show up more than once
  // there across several blocks, which would otherwise list them twice
  // here for the same layover.
  const seen = new Set();
  crew = crew.filter((m) => {
    const key = crewKey(m.role, m.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  els.layoverCrew.hidden = !crew.length;
  els.layoverCrewList.innerHTML = "";
  if (!crew.length) return;

  for (const member of crew) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.className = "layover-crew-name";
    name.textContent = member.name;
    if (member.role) {
      const role = document.createElement("span");
      role.className = "crew-role";
      role.textContent = member.role;
      name.appendChild(role);
    }

    const roomInput = document.createElement("input");
    roomInput.type = "text";
    roomInput.className = "layover-crew-room";
    roomInput.placeholder = "Zimmer";
    roomInput.autocomplete = "off";
    const key = crewRoomKeyFor(arrCode, hotel, member.name);
    roomInput.value = getRoomNumber(key);
    roomInput.addEventListener("input", () => setRoomNumber(key, roomInput.value));

    li.appendChild(name);
    li.appendChild(roomInput);
    els.layoverCrewList.appendChild(li);
  }
}

async function handleCrewPdf(file) {
  els.crewPdfLabel.textContent = file.name;
  els.crewPdfStatus.hidden = true;
  els.crewPdfRawToggle.hidden = true;
  els.crewPdfResult.hidden = false;
  els.crewPdfResult.textContent = "Lese PDF …";

  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const { lines, refs } = await extractPdfLines(pdf);
    const rawText = lines.join("\n");
    const rotation = parseRotationHeader(lines);
    const crew = parseCrewFromLines(lines, refs);
    const legs = parseFlightLegs(lines);

    state.pdfLegs = legs;
    state.pdfLines = lines;

    els.crewPdfRawToggle.hidden = false;
    els.crewPdfRawToggle.textContent = "Rohtext anzeigen";
    els.crewPdfResult.textContent = rawText || "Kein Text im PDF gefunden.";

    if (crew.length) {
      state.pdfCrew = { crew, rotation, fileName: file.name };
      els.crewPdfResult.hidden = true; // available via "Rohtext anzeigen"
      els.crewPdfStatus.hidden = false;

      // Only auto-apply the PDF crew if it plausibly belongs to this
      // rotation - if OpenAirLog's crew names have nothing in common with
      // the PDF's, it's likely a stale/wrong PDF, so keep OpenAirLog
      // active instead (still switchable by hand via the button below).
      if (crewListsPlausiblyMatch(crew)) {
        state.crewSource = "pdf";
        els.crewPdfStatus.textContent =
          `${crew.length} Crewmitglied(er) erkannt und oben als Crew übernommen.` +
          (rotation ? ` (Umlauf ${rotation.rotation})` : "");
      } else {
        state.crewSource = "api";
        els.crewPdfStatus.textContent =
          `${crew.length} Crewmitglied(er) erkannt, aber die Namen stimmen mit keinem ` +
          `OpenAirLog-Flug überein - vermutlich die falsche/eine alte PDF. OpenAirLog-Crew ` +
          `bleibt aktiv; über den Button unten lässt sich manuell zur PDF-Crew wechseln.`;
      }
    } else {
      // Couldn't recognize crew rows in this layout: nothing to overwrite
      // with, show the raw text directly instead of hiding it behind a
      // toggle with nothing else to show.
      els.crewPdfResult.hidden = false;
      els.crewPdfStatus.hidden = false;
      els.crewPdfStatus.textContent = "Konnte keine Crew-Zeilen in dieser PDF erkennen, siehe Rohtext unten.";
    }

    savePdfCrew(); // also persists legs/lines, even if no crew rows matched
    renderLayover();

    const f = state.flights[state.index];
    if (f) renderCrew(f);
  } catch (err) {
    els.crewPdfResult.hidden = false;
    els.crewPdfResult.textContent = "PDF konnte nicht gelesen werden: " + (err && err.message ? err.message : err);
  }
}

// ---------- event wiring ----------

els.saveKeyBtn.addEventListener("click", () => {
  const val = els.apiKeyInput.value.trim();
  if (!val) {
    els.setupError.hidden = false;
    els.setupError.textContent = "Bitte einen API-Schlüssel eingeben.";
    return;
  }
  els.setupError.hidden = true;
  setApiKey(val);
  els.apiKeyInput.value = "";
  loadFlights();
});

els.settingsBtn.addEventListener("click", () => {
  setSettingsOpen(els.setupCard.hidden);
});

els.resetKeyBtn.addEventListener("click", () => {
  if (!confirm("API-Schlüssel auf diesem Gerät entfernen?")) return;
  clearApiKey();
  state.flights = [];
  showBanner("", "");
  loadFlights();
});

els.saveRosterBtn.addEventListener("click", () => {
  const val = els.rosterUrlInput.value.trim();
  if (!val) return;
  setRosterUrl(val);
  els.rosterUrlInput.value = "";
  rosterEventsCache.events = null;
  rosterEventsCache.fetchedAt = 0;
  rosterEventsCache.url = null;
  rosterEventsCache.lastError = null;
  renderRosterStatus();
  renderLayover();
});

els.resetRosterBtn.addEventListener("click", () => {
  if (!confirm("Roster-Link auf diesem Gerät entfernen?")) return;
  clearRosterUrl();
  rosterEventsCache.events = null;
  rosterEventsCache.fetchedAt = 0;
  rosterEventsCache.url = null;
  rosterEventsCache.lastError = null;
  renderRosterStatus();
  renderLayover();
});

els.saveCorsProxyKeyBtn.addEventListener("click", () => {
  const val = els.corsProxyKeyInput.value.trim();
  if (!val) return;
  setCorsProxyKey(val);
  els.corsProxyKeyInput.value = "";
  renderCorsProxyKeyStatus();
  // A previous failure may only have been the missing key - retry now
  // rather than making the pilot tap ↻ separately.
  rosterEventsCache.events = null;
  rosterEventsCache.fetchedAt = 0;
  rosterEventsCache.url = null;
  rosterEventsCache.lastError = null;
  ensureRosterLoaded(true);
});

els.resetCorsProxyKeyBtn.addEventListener("click", () => {
  if (!confirm("corsproxy.io API-Schlüssel auf diesem Gerät entfernen?")) return;
  clearCorsProxyKey();
  renderCorsProxyKeyStatus();
});

els.saveAeroDataBoxBtn.addEventListener("click", () => {
  const val = els.aeroDataBoxKeyInput.value.trim();
  if (!val) return;
  setAeroDataBoxKey(val);
  els.aeroDataBoxKeyInput.value = "";
  aircraftScheduleCache.clear();
  renderAeroDataBoxStatus();
  renderFlight();
});

els.resetAeroDataBoxBtn.addEventListener("click", () => {
  if (!confirm("AeroDataBox-API-Schlüssel auf diesem Gerät entfernen?")) return;
  clearAeroDataBoxKey();
  aircraftScheduleCache.clear();
  renderAeroDataBoxStatus();
  renderFlight();
});

els.testAeroDataBoxBtn.addEventListener("click", testAeroDataBoxConnection);

// ↻ is now the only way any of this app's APIs get queried - there's no
// background/interval polling left (see the removed 5-minute check and
// the AeroDataBox lookups' plain "fetch if not yet cached" logic).
// Clearing the AeroDataBox caches here, rather than adding a separate
// "force" path to every lookup, lets that existing lazy logic naturally
// re-fetch whatever's relevant to what ends up shown once loadFlights()
// re-renders - own flight's callsign/deviation, the transit line's next
// A/C, and crew ex/to refs all go through the same two caches.
async function refreshAll() {
  flightByNumberCache.clear();
  aircraftScheduleCache.clear();
  // Roster overrides apply to state.allFlights, so this has to wait for
  // loadFlights() to finish replacing it with the fresh window first -
  // firing both at once let the roster fetch (if it happened to resolve
  // first) apply to the about-to-be-discarded old flights, silently
  // losing the override once loadFlights() landed.
  await loadFlights();
  await ensureRosterLoaded(true);
}

els.refreshBtn.addEventListener("click", refreshAll);

els.dutyStatusRouteBtn.addEventListener("click", toggleRouteWeather);

// Replaces the old prev/next buttons: swiping the track between flights
// is itself the navigation now. Debounced so this only fires once the
// swipe has actually settled on a card, not on every scroll tick while
// it's still moving.
let cardScrollDebounce = null;
els.flightCardTrack.addEventListener("scroll", () => {
  clearTimeout(cardScrollDebounce);
  cardScrollDebounce = setTimeout(() => {
    const track = els.flightCardTrack;
    if (!track.clientWidth) return;
    const newIndex = Math.round(track.scrollLeft / track.clientWidth);

    // Shared between the ordinary flight-card carousel and the Layover
    // card's own attached one (see renderLayoverCarousel()) - state.mode
    // (set by renderFlight()) says which page count/index applies.
    if (state.mode === "layover") {
      const totalPages = 1 + state.layoverFlights.length;
      if (!totalPages) return;
      const clamped = Math.max(0, Math.min(totalPages - 1, newIndex));
      if (clamped === state.layoverPageIndex) return;
      state.layoverPageIndex = clamped;
      renderActiveLayoverExtras();
      return;
    }

    if (!state.flights.length) return;
    // +1 page once previewLayoverFlight() has attached the Layover card
    // right after today's last flight (see buildFlightCards()) - that
    // extra page lives at index state.flights.length, one past the real
    // flights, same "one more slot past the array" pattern the Layover
    // carousel's own totalPages uses above.
    const totalPages = state.flights.length + (state.previewLayover ? 1 : 0);
    const clamped = Math.max(0, Math.min(totalPages - 1, newIndex));
    if (clamped === state.index) return;
    state.index = clamped;
    renderActiveFlightExtras();
  }, 120);
});

els.crewPdfInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleCrewPdf(file);
});

els.crewPdfRawToggle.addEventListener("click", () => {
  els.crewPdfResult.hidden = !els.crewPdfResult.hidden;
  els.crewPdfRawToggle.textContent = els.crewPdfResult.hidden ? "Rohtext anzeigen" : "Rohtext ausblenden";
});

els.crewSourceSwitchBtn.addEventListener("click", () => {
  state.crewSource = state.crewSource === "pdf" ? "api" : "pdf";
  savePdfCrew();
  const f = state.flights[state.index];
  if (f) renderCrew(f);
});

els.roomNumberInput.addEventListener("input", () => {
  if (currentLayoverKey) setRoomNumber(currentLayoverKey, els.roomNumberInput.value);
});

els.currencyLocalInput.addEventListener("input", updateCurrencyOutput);

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ---------- init ----------

// Lets the app shell itself load offline (see sw.js) - separate from the
// data-level offline fallback above (FLIGHTS_CACHE_KEY), which covers the
// flight/crew data once the shell is already running.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support just won't be available */ });
  });
}

// Startup (including a plain page reload or relaunching from the
// home-screen icon) never fetches anything live anymore - only applies
// whatever was cached from the last manual ↻ (see saveFlightsCache()).
// The roster works the same way: nothing persisted for it across
// sessions, so it only reappears once ↻ has actually run again. ↻
// (refreshAll()) is the only remaining path that talks to any API.
function loadInitial() {
  const key = getApiKey();
  if (!key) {
    setSettingsOpen(true);
    els.refreshBtn.hidden = true;
    els.resetKeyBtn.hidden = true;
    return;
  }
  setSettingsOpen(false);
  els.refreshBtn.hidden = false;
  els.resetKeyBtn.hidden = false;

  const cached = loadFlightsCache();
  if (!cached) {
    showBanner("Tippe oben auf ↻, um Flugdaten zu laden.", "");
    return;
  }
  applyLoadedFlights(cached.allRaw);
  lastUpdateAt = new Date(cached.fetchedAt);
  isOffline = false;
  renderDataStamp();
}

renderBrandName();
loadStoredPdfCrew();
renderLayover();
loadInitial();

// Keep the T-minus/T-plus countdown and the layover state current without
// a full data refresh.
setInterval(() => {
  // Re-applies the 20-minutes-past-arrival retirement (see
  // computeTodayFlights()) - purely time-based, so a flight can cross
  // that mark while the app just sits open, not only right after a load.
  if (state.allFlights.length) {
    const refreshed = computeTodayFlights(state.allFlights);
    if (refreshed.length !== state.flights.length || refreshed.some((f, i) => f !== state.flights[i])) {
      state.flights = refreshed;
      state.index = refreshed.length ? Math.min(pickInitialIndex(refreshed), refreshed.length - 1) : 0;
    }
  }
  // Called every tick, not just when the flight set actually changed -
  // it also re-evaluates the layover pickup cutoff (see
  // LAYOVER_PAGE_DROP_AFTER_PICKUP_MS), which is just as time-based and
  // needs to drop the Layover card (back to the ordinary flight-card
  // view) while the app just sits open, too. renderFlight()'s own
  // signature check rebuilds the flight cards only when that set
  // actually changed, so this stays cheap most ticks.
  renderFlight();

  // Ticks every card's countdown pill (cheap, pure date math) - only the
  // active card's own AeroDataBox lookup is allowed to actually fire.
  state.flights.forEach((f, i) => {
    const node = state.cardNodes[i];
    if (!node) return;
    const statusEl = node.querySelector(".status-pill");
    const ownLeg = getOwnFlightAeroDataBoxLeg(f, { peekOnly: i !== state.index });
    updateFlightTimerDisplay(f, ownLeg, statusEl);
  });
  tickPostLandingSwitch();
}, 30000);

