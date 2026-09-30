"use strict";

const PDF_CREW_STORAGE_KEY = "oal_pdf_crew";
const ROSTER_URL_STORAGE_KEY = "oal_roster_url";
const DEBUG_ALL_MONTH_STORAGE_KEY = "oal_debug_all_month";
const FR24_KEY_STORAGE_KEY = "oal_fr24_key";
const FR24_API_BASE = "https://fr24api.flightradar24.com/api";
// 15s was too tight for a real Flightradar24 response over a weak mobile
// connection - confirmed by a real "Verbindung testen" tap surfacing an
// AbortError (WebKit's exact wording for our own fetchWithTimeout()
// aborting it, not a CORS rejection, which fails near-instantly with a
// different error shape) rather than a genuine timeout being the right
// call.
const FETCH_TIMEOUT_MS = 30000;

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
  dutyStatusPickup: document.getElementById("dutyStatusPickup"),
  dutyStatusPickupValue: document.getElementById("dutyStatusPickupValue"),
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

  crewPdfCard: document.getElementById("crewPdfCard"),
  crewPdfInput: document.getElementById("crewPdfInput"),
  crewPdfLabel: document.getElementById("crewPdfLabel"),
  crewPdfStatus: document.getElementById("crewPdfStatus"),
  crewPdfRawToggle: document.getElementById("crewPdfRawToggle"),
  crewPdfResult: document.getElementById("crewPdfResult"),
  ownNameInput: document.getElementById("ownNameInput"),
  saveOwnNameBtn: document.getElementById("saveOwnNameBtn"),

  rosterCard: document.getElementById("rosterCard"),
  rosterUrlInput: document.getElementById("rosterUrlInput"),
  saveRosterBtn: document.getElementById("saveRosterBtn"),
  rosterStatus: document.getElementById("rosterStatus"),
  testRosterBtn: document.getElementById("testRosterBtn"),
  rosterTestResult: document.getElementById("rosterTestResult"),
  rosterTestRaw: document.getElementById("rosterTestRaw"),
  resetRosterBtn: document.getElementById("resetRosterBtn"),
  corsProxyKeyInput: document.getElementById("corsProxyKeyInput"),
  saveCorsProxyKeyBtn: document.getElementById("saveCorsProxyKeyBtn"),
  corsProxyKeyStatus: document.getElementById("corsProxyKeyStatus"),
  resetCorsProxyKeyBtn: document.getElementById("resetCorsProxyKeyBtn"),

  fr24Card: document.getElementById("fr24Card"),
  fr24KeyInput: document.getElementById("fr24KeyInput"),
  saveFr24Btn: document.getElementById("saveFr24Btn"),
  fr24Status: document.getElementById("fr24Status"),
  testFr24Btn: document.getElementById("testFr24Btn"),
  fr24TestResult: document.getElementById("fr24TestResult"),
  fr24TestRaw: document.getElementById("fr24TestRaw"),
  resetFr24Btn: document.getElementById("resetFr24Btn"),

  debugCard: document.getElementById("debugCard"),
  debugAllMonthInput: document.getElementById("debugAllMonthInput"),

  refreshBtn: document.getElementById("refreshBtn"),
  dataStamp: document.getElementById("dataStamp"),
};

/** @type {{flights: any[], index: number, pdfCrew: {crew: any[], rotation: any, fileName: string}|null}} */
const state = {
  flights: [], allFlights: [], allDuties: [], index: 0,
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
  els.testRosterBtn.hidden = !url;
  els.rosterTestResult.hidden = true;
  els.rosterTestRaw.hidden = true;
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

// Debug-only toggle (see #debugCard) - not tied to any one API, just
// swaps what renderFlight() shows as the ordinary flight-card carousel
// content, see renderDebugAllMonthCarousel().
function getDebugAllMonth() {
  try { return localStorage.getItem(DEBUG_ALL_MONTH_STORAGE_KEY) === "1"; } catch { return false; }
}
function setDebugAllMonth(on) {
  try { localStorage.setItem(DEBUG_ALL_MONTH_STORAGE_KEY, on ? "1" : "0"); } catch { /* private mode etc. */ }
}

// ---------- Flightradar24 API - primary live-data source ----------
//
// Confirmed against the real, official docs (fr24api.flightradar24.com):
// Bearer token in the Authorization header, plus an Accept-Version: v1
// header - both required on every request. Base URL
// https://fr24api.flightradar24.com/api. The Flight Summary endpoint
// (/flight-summary/full) is the one workhorse used for everything here:
// queried either by "flights" (flight number) or "registrations" (tail
// number) plus a required flight_datetime_from/flight_datetime_to window,
// it returns real ADS-B-observed data - registration, callsign, actual
// takeoff/landing times - never a "scheduled" time (FR24 tracks what
// actually happened/is happening, not an airline's own schedule), so
// depSchedDate/arrSchedDate below are always null: the flight's own
// planned times keep coming from wherever the flight itself was loaded
// from, same as before. The exact request datetime format (with or
// without trailing "Z"/milliseconds) isn't confirmed from an actual
// response - "Verbindung testen" below shows the raw JSON so that's
// checkable against a real key rather than guessed blind.

function getFr24Key() {
  try { return localStorage.getItem(FR24_KEY_STORAGE_KEY) || ""; } catch { return ""; }
}
function setFr24Key(key) {
  try { localStorage.setItem(FR24_KEY_STORAGE_KEY, key); } catch { /* private mode etc. */ }
}
function clearFr24Key() {
  try { localStorage.removeItem(FR24_KEY_STORAGE_KEY); } catch { /* ignore */ }
}

function renderFr24Status() {
  const key = getFr24Key();
  els.fr24Status.hidden = !key;
  els.fr24Status.textContent = key ? "API-Schlüssel hinterlegt." : "";
  els.testFr24Btn.hidden = !key;
  els.fr24TestResult.hidden = true;
  els.fr24TestRaw.hidden = true;
  els.resetFr24Btn.hidden = !key;
}

// A {DateTime string} as ISO 8601 - the exact presence/absence of a "Z"
// suffix isn't confirmed from a real response, so "Z" is appended
// whenever the string doesn't already carry an explicit zone offset,
// same defensive approach as the removed Lufthansa integration used for
// the same reason.
function parseFr24DateTime(s) {
  if (!s) return null;
  const iso = /[Z+-]\d{2}:?\d{2}$|Z$/.test(s) ? s : `${s}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeFr24Leg(entry) {
  if (!entry) return null;
  const depDate = parseFr24DateTime(entry.datetime_takeoff);
  const arrDate = parseFr24DateTime(entry.datetime_landed);
  return {
    depCode: entry.orig_icao || "---",
    arrCode: entry.dest_icao_actual || entry.dest_icao || "---",
    depDate, arrDate,
    // datetime_takeoff is wheels-up, not off-block (leaving the gate) -
    // a real, earlier, separately-reported ADS-B/event moment (see
    // fetchGateDepartureEvent() below) - so this is only ever a fallback
    // approximation for updateFlightTimerDisplay()'s "confirmed
    // off-block, retire the countdown pill" signal, used until/unless
    // the real gate_departure event has loaded.
    depRunwayDate: depDate,
    // Needed to query /historic/flight-events/full for this exact flight
    // instance (see fetchGateDepartureEvent()) - that endpoint takes
    // fr24_id, never a flight number or registration.
    fr24Id: entry.fr24_id || null,
    // FR24 only ever reports what actually happened/is happening, never
    // a schedule - see the module comment above.
    depSchedDate: null,
    arrSchedDate: null,
    flightNumber: String(entry.flight || "").replace(/\s+/g, ""),
    status: entry.flight_ended ? "Landed" : depDate ? "En Route" : "Scheduled",
    registration: entry.reg || null,
    aircraftType: entry.type || null,
    callSign: entry.callsign || null,
  };
}

// Shared GET against /flight-summary/full - filterParam is "flights" (a
// flight number, e.g. "LH1212") or "registrations" (a tail number, e.g.
// "D-AIZR"); date range query and ID query are mutually exclusive per the
// docs, so this only ever uses the date-range form.
async function fetchFr24FlightSummary(filterParam, filterValue, fromParam, toParam) {
  const key = getFr24Key();
  if (!key || !filterValue) return null;
  const params = new URLSearchParams({
    [filterParam]: filterValue,
    flight_datetime_from: fromParam,
    flight_datetime_to: toParam,
  });
  const url = `${FR24_API_BASE}/flight-summary/full?${params}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", "Accept-Version": "v1", Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn("[Flightradar24] flight-summary failed", res.status, url);
      return null;
    }
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn("[Flightradar24] flight-summary request failed (network/CORS?)", err, url);
    return null;
  }
}

// ---------- Flightradar24 historic flight events - the real off-block moment ----------
//
// Confirmed via the official fr24api-mcp source (github.com/Flightradar24/
// fr24api-mcp - the fr24api.flightradar24.com docs domain itself isn't
// reachable from here): GET /historic/flight-events/full, queried by
// flight_ids (comma-separated fr24_id values, up to 15 - never a flight
// number or registration, so this only ever runs *after* a flight-summary
// lookup has already resolved one) and event_types (comma-separated, or
// "all"). Response is one entry per fr24_id, each with an events[] array
// of {type, timestamp, lat?, lon?, alt?, gspeed?, details?} - type one of
// gate_departure, takeoff, cruising, airspace_transition, descent,
// landed, gate_arrival. "gate_departure" (leaving the gate) is the real
// off-block moment - a separate, earlier event than "takeoff" (wheels-up,
// what flight-summary/full's own datetime_takeoff actually reports, used
// as an off-block approximation until this resolves - see
// normalizeFr24Leg()'s depRunwayDate).
async function fetchGateDepartureEvent(fr24Id) {
  const key = getFr24Key();
  if (!key || !fr24Id) return null;
  const params = new URLSearchParams({ flight_ids: fr24Id, event_types: "gate_departure" });
  const url = `${FR24_API_BASE}/historic/flight-events/full?${params}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", "Accept-Version": "v1", Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn("[Flightradar24] historic flight-events failed", res.status, url);
      return null;
    }
    const json = await res.json();
    const entry = Array.isArray(json) ? json[0] : null;
    const ev = entry && Array.isArray(entry.events)
      ? entry.events.find((e) => e.type === "gate_departure")
      : null;
    return ev ? parseFr24DateTime(ev.timestamp) : null;
  } catch (err) {
    console.warn("[Flightradar24] historic flight-events request failed (network/CORS?)", err, url);
    return null;
  }
}

const gateDepartureCache = new Map(); // fr24Id -> { date: Date|null, fetchedAt }
const gateDepartureLoading = new Set(); // fr24Id currently in flight, to avoid duplicate concurrent requests

// Fire-and-forget, same pattern as ensureAircraftScheduleLoaded() - fetches
// once per fr24_id, caches (including a real "no gate_departure event
// (yet)" null, so a miss doesn't retry every render), then re-renders so
// updateFlightTimerDisplay() picks up the real off-block moment once known.
async function ensureGateDepartureLoaded(fr24Id) {
  if (!fr24Id || gateDepartureCache.has(fr24Id) || gateDepartureLoading.has(fr24Id)) return;
  gateDepartureLoading.add(fr24Id);
  const date = await fetchGateDepartureEvent(fr24Id);
  gateDepartureLoading.delete(fr24Id);
  gateDepartureCache.set(fr24Id, { date, fetchedAt: Date.now() });
  renderFlight();
}

// ISO-ish, no milliseconds/zone suffix - matches the one confirmed real
// example in the docs (an airline/airport lookup, not flight-summary
// itself); "Verbindung testen" is how this gets checked against a real
// key rather than guessed blind (see the module comment above).
function fr24DateTimeParam(date) {
  return date.toISOString().slice(0, 19);
}

async function fetchFlightByNumber(flightNumber, dateKey) {
  if (!flightNumber || !dateKey) return null;
  const entries = await fetchFr24FlightSummary(
    "flights", flightNumber, `${dateKey}T00:00:00`, `${dateKey}T23:59:59`
  );
  if (!entries || !entries.length) return null;
  // Several rows can come back (e.g. a diversion, or more than one
  // physical leg sharing the number that day) - prefer one that's
  // actually happened/happening over a still-unflown placeholder.
  const best = entries.find((e) => e.datetime_takeoff) || entries[0];
  return normalizeFr24Leg(best);
}

// The aircraft's own schedule around the given reference flight - 3 days
// back (covers a multi-day rotation's own prior legs, same reach as the
// removed AeroDataBox version needed in practice) to 1 day ahead.
async function fetchAircraftSchedule(registration, referenceDate) {
  if (!registration || registration === "–") return null;
  const center = referenceDate || new Date();
  const from = fr24DateTimeParam(new Date(center.getTime() - 3 * 86400000));
  const to = fr24DateTimeParam(new Date(center.getTime() + 1 * 86400000));
  const entries = await fetchFr24FlightSummary("registrations", registration, from, to);
  if (!entries) return null;
  return entries
    .map(normalizeFr24Leg)
    .filter((leg) => leg.depDate)
    .sort((a, b) => a.depDate - b.depDate);
}

// Within that aircraft's day schedule, the leg landing at the given
// station right before the given departure time - i.e. what this
// aircraft flew immediately before becoming available for pickup there.
// Requires an exact station match: without it there could be an earlier,
// unrelated leg in between.
function findPriorLegArrival(legs, stationIcao, beforeDate) {
  if (!legs || !beforeDate) return null;
  let best = null;
  for (const leg of legs) {
    if (leg.arrCode !== stationIcao || !leg.arrDate || leg.arrDate >= beforeDate) continue;
    if (!best || leg.arrDate > best.arrDate) best = leg;
  }
  return best;
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
  if (leg && leg.registration) ensureAircraftScheduleLoaded(leg.registration, leg.depDate);
  else renderFlight();
}

const aircraftScheduleCache = new Map(); // registration -> { legs, fetchedAt }

// Fire-and-forget, same pattern as ensureCurrentWeatherLoaded(): fetches
// once per registration, caches (including failures, as an empty list, so
// a lookup miss doesn't retry every render), then re-renders.
async function ensureAircraftScheduleLoaded(registration, referenceDate) {
  const legs = await fetchAircraftSchedule(registration, referenceDate);
  aircraftScheduleCache.set(registration, { legs: legs || [], fetchedAt: Date.now() });
  renderFlight();
}

// Shared by the flight number's callsign suffix and the depTime/arrTime
// deviation labels - the one place that checks the cache and triggers a
// fetch if stale, rather than each caller doing that separately. peekOnly
// reads whatever's cached without triggering a new fetch - used for the
// cards the user isn't currently looking at, so scrolling past several of
// them doesn't fire off a lookup for each one.
function getOwnFlightLiveLeg(f, opts) {
  const dateKey = f.raw && f.raw.date;
  if (!f.flightNumber || !dateKey || !getFr24Key()) return null;
  const cacheKey = `${f.flightNumber}|${dateKey}`;
  const peekOnly = opts && opts.peekOnly;
  const cached = flightByNumberCache.get(cacheKey);
  if (!peekOnly && !cached) ensureFlightByNumberLoaded(f.flightNumber, dateKey);
  return cached ? cached.leg : null;
}

// Same in-app probe pattern the other API cards used - shows the raw
// response right on the page so the request/response shape (genuinely
// unconfirmed in places, see the module comment above) can be checked
// against a real key without needing separate console/Web Inspector
// access.
async function testFr24Connection() {
  const key = getFr24Key();
  if (!key) return;
  const testFlight = state.flights[state.index] || state.allFlights[0];
  if (!testFlight || !testFlight.flightNumber || !(testFlight.raw && testFlight.raw.date)) {
    els.fr24TestResult.hidden = false;
    els.fr24TestResult.textContent = "Kein Testflug verfügbar - erst Flugdaten laden.";
    return;
  }

  els.testFr24Btn.disabled = true;
  els.fr24TestResult.hidden = false;
  els.fr24TestResult.textContent = `Teste mit ${testFlight.flightNumber} …`;
  els.fr24TestRaw.hidden = true;
  els.fr24TestRaw.textContent = "";

  function showRaw(value) {
    els.fr24TestRaw.hidden = false;
    els.fr24TestRaw.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  const dateKey = testFlight.raw.date;
  const params = new URLSearchParams({
    flights: testFlight.flightNumber,
    flight_datetime_from: `${dateKey}T00:00:00`,
    flight_datetime_to: `${dateKey}T23:59:59`,
  });
  const url = `${FR24_API_BASE}/flight-summary/full?${params}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", "Accept-Version": "v1", Authorization: `Bearer ${key}` },
    });
    const text = await res.text();
    if (!res.ok) {
      els.fr24TestResult.textContent = `Fehlgeschlagen: Antwort ${res.status} von fr24api.flightradar24.com. Key/Abo prüfen.`;
      showRaw(text);
    } else {
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      const entries = Array.isArray(json) ? json : [];
      els.fr24TestResult.textContent = entries.length
        ? `Erfolgreich - ${entries.length} Eintrag/Einträge für ${testFlight.flightNumber} gefunden.`
        : "Antwort kam an, aber leer oder kein gültiges JSON-Array.";
      showRaw(json !== null ? json : text);
    }
  } catch (err) {
    // AbortError specifically means OUR OWN fetchWithTimeout() gave up
    // after FETCH_TIMEOUT_MS with no response at all - a CORS rejection
    // fails near-instantly with a different error shape, so this is a
    // genuinely slow/unreachable API call, not a browser-side block.
    els.fr24TestResult.textContent = err && err.name === "AbortError"
      ? `Fehlgeschlagen: Keine Antwort von fr24api.flightradar24.com innerhalb von ${FETCH_TIMEOUT_MS / 1000}s.`
      : "Fehlgeschlagen: Netzwerk- oder CORS-Fehler (Anfrage kam nicht durch).";
    showRaw(String(err));
  }
  els.testFr24Btn.disabled = false;
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
  els.crewPdfCard.hidden = !open;
  els.rosterCard.hidden = !open;
  els.fr24Card.hidden = !open;
  els.debugCard.hidden = !open;
  if (open) {
    renderRosterStatus();
    renderCorsProxyKeyStatus();
    renderFr24Status();
    els.ownNameInput.value = getOwnName();
    els.debugAllMonthInput.checked = getDebugAllMonth();
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

// Shows the current time under the scheduled one
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
// the real time - once a live data source (ownLeg, from Flightradar24 -
// see getOwnFlightLiveLeg()) has resolved a confirmed off-block moment
// (whether or not it's off enough from schedule to show as a deviation
// next to depTime/arrTime), it's redundant and goes away rather than
// sitting there next to more current information. Called for every card
// on each render/tick, so the pill doesn't reappear on a card after
// being hidden here.
function updateFlightTimerDisplay(f, ownLeg, statusEl, isActive) {
  if (f.isDeadhead || !ownLeg) {
    statusEl.hidden = false;
    renderTimerPill(f, statusEl);
    return;
  }

  // The real gate_departure event once known (see
  // ensureGateDepartureLoaded()) - falls back to depRunwayDate (FR24's
  // own takeoff time, an approximation, see normalizeFr24Leg()) until
  // then, since *something* confirmed-off-block-looking should retire
  // the countdown as soon as reasonably possible, not only once the
  // more precise event has loaded.
  const cached = ownLeg.fr24Id ? gateDepartureCache.get(ownLeg.fr24Id) : undefined;
  if (ownLeg.fr24Id && cached === undefined && isActive) ensureGateDepartureLoaded(ownLeg.fr24Id);
  const confirmedOffBlock = (cached && cached.date) || ownLeg.depRunwayDate;

  // A revised/estimated time alone (depDate) isn't enough to retire the
  // countdown, since that can change again before departure actually
  // happens - only a confirmed off-block moment does.
  if (confirmedOffBlock) {
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
    regPriorArrival: node.querySelector(".reg-prior-arrival"),
    transitInfo: node.querySelector(".transit-info"),
  };
}

// (Re)builds one card per today's flight into the horizontally scrollable
// track, plus a matching dot per card - only needed when the actual set
// of flights changes (see the signature check in renderFlight()), not on
// every re-render, so an async lookup resolving mid-scroll doesn't wipe
// the user's scroll position. When previewLayover is given (see
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
// registration differs from this one's), which aircraft that is. Every
// card has its own transit line, about its own next flight.
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

  // The next flight's own registration is missing on some future-dated
  // entries - when that happens, fall back to looking it up by its own
  // flight number via Flightradar24 instead (see
  // ensureFlightByNumberLoaded()), which also backfills the registration
  // itself, so everything below works the same either way.
  let nextRegistration = nextFlight && nextFlight.registration !== "–" ? nextFlight.registration : null;
  if (transitLabel && !nextRegistration && getFr24Key() && nextFlight.flightNumber) {
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
    if (getFr24Key()) {
      const cached = aircraftScheduleCache.get(nextRegistration);
      if (!cached) {
        if (isActive) ensureAircraftScheduleLoaded(nextRegistration, nextFlight.depSchedDate);
      } else {
        const priorLeg = findPriorLegArrival(cached.legs, nextFlight.depCode, nextFlight.depSchedDate);
        if (priorLeg && priorLeg.arrDate) transitText += ` ${priorLeg.flightNumber} ${fmtTime(priorLeg.arrDate)}`;
      }
    }
  }
  cardEls.transitInfo.hidden = !transitText;
  cardEls.transitInfo.textContent = transitText;
}

// Fills one card's content. Takes an explicit flights/cardNodes array pair
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
  const ownLeg = getOwnFlightLiveLeg(f, { peekOnly: !isActive });
  cardEls.flightNumber.textContent = ownLeg && ownLeg.callSign ? `${f.flightNumber} (${ownLeg.callSign})` : f.flightNumber;
  updateFlightTimerDisplay(f, ownLeg, cardEls.flightStatus, isActive);

  // The roster feed itself carries no aircraft/registration at all (see
  // rosterEventsToRawFlights()) - Flightradar24 is the only source for
  // either now, so backfill them onto the flight object itself once
  // known, the same way ensureAircraftScheduleLoaded()'s own cache works.
  // Written back here rather than read fresh from ownLeg everywhere else
  // this card's registration is used (renderRegistrationPriorArrival(),
  // renderFlightCardTransit()'s "next A/C" check) - those need it too,
  // and a stable f.registration is simpler than threading ownLeg through
  // all of them separately.
  if (ownLeg) {
    if (f.registration === "–" && ownLeg.registration) f.registration = ownLeg.registration;
    if (f.aircraft === "–" && ownLeg.aircraftType) f.aircraft = ownLeg.aircraftType;
  }

  cardEls.depCode.textContent = threeLetterCode(f.depCode);
  cardEls.arrCode.textContent = threeLetterCode(f.arrCode);
  cardEls.depTime.textContent = fmtTime(f.depSchedDate);
  cardEls.arrTime.textContent = fmtTime(f.arrSchedDate);
  renderTimeDeviation(cardEls.depActualTime, f.depSchedDate, ownLeg && ownLeg.depDate);
  renderTimeDeviation(cardEls.arrActualTime, f.arrSchedDate, ownLeg && ownLeg.arrDate);

  cardEls.aircraft.textContent = f.aircraft;
  cardEls.registration.textContent = f.registration;
  renderRegistrationPriorArrival(f, isActive, cardEls);

  renderFlightCardTransit(flights, i, isActive, cardEls);
}

// Under the registration itself - when this exact aircraft is known and
// a Flightradar24 key is configured, when it arrived here from whatever
// it flew right before (same aircraft-schedule lookup the transit line's
// own "next A/C" note uses for the NEXT flight's aircraft - see
// ensureAircraftScheduleLoaded()/findPriorLegArrival() - just applied to
// this card's own flight instead), so that's visible directly on the
// card showing that aircraft, not only buried in the preceding card's own
// transit line whenever this happens to be a Flugzeugwechsel.
function renderRegistrationPriorArrival(f, isActive, cardEls) {
  if (!cardEls.regPriorArrival) return;
  cardEls.regPriorArrival.hidden = true;
  cardEls.regPriorArrival.textContent = "";
  if (!getFr24Key() || !f.registration || f.registration === "–" || !f.depCode || !f.depSchedDate) return;

  const cached = aircraftScheduleCache.get(f.registration);
  if (!cached) {
    if (isActive) ensureAircraftScheduleLoaded(f.registration, f.depSchedDate);
    return;
  }
  const priorLeg = findPriorLegArrival(cached.legs, f.depCode, f.depSchedDate);
  if (priorLeg && priorLeg.arrDate) {
    cardEls.regPriorArrival.hidden = false;
    cardEls.regPriorArrival.textContent = `Ankunft ${fmtTime(priorLeg.arrDate)}`;
  }
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
// content plus everything below the cards that follows the current
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
  // Coming back from the preview page above, which hides it - otherwise
  // renderCrew() below fills #crewList right back in, but the card
  // itself stays hidden, making the crew look like it vanished.
  els.crewCard.hidden = false;
  renderFlightCardContent(state.flights, state.cardNodes, state.index, true);
  renderAirlineBadge(f.flightNumber);
  renderCrew(f);
  ensureCrewLoaded(f);
}

// Debug-only (see #debugCard/getDebugAllMonth()) - every real flight in
// state.allFlights (however wide a window the current data source
// loads), not just today's own state.flights, as one long scrollable
// card carousel. Deliberately ignores the Layover/
// Ortstag mode switches entirely (this is for eyeballing card fields
// across many flights, not for representing "right now") - state.mode is
// still forced to "flights" and state.previewLayover cleared so the
// shared dots/height/scroll-listener code (which branch on those) behave
// exactly like the ordinary case with no preview page attached.
// Not "everything the roster happens to carry" - state.allFlights can
// now span the roster's whole ROSTER_WINDOW_PAST_MS/ROSTER_WINDOW_FUTURE_MS
// window (~75 days, see rosterEventsToRawFlights()), which is more than
// this debug switch was ever meant to dump into one carousel (see the
// comment above - "eyeballing card fields", not a full rotation
// history). Capped to a week back/two weeks ahead around today instead.
const DEBUG_ALL_MONTH_WINDOW_PAST_MS = 7 * 24 * 3600 * 1000;
const DEBUG_ALL_MONTH_WINDOW_FUTURE_MS = 14 * 24 * 3600 * 1000;

function renderDebugAllMonthCarousel() {
  state.mode = "flights";
  state.previewLayover = null;
  const now = Date.now();
  state.flights = state.allFlights.filter((f) => {
    if (!f.flightNumber || f.isDeadhead) return false;
    const d = f.depSchedDate || f.depActualDate;
    if (!d) return false;
    const delta = d.getTime() - now;
    return delta >= -DEBUG_ALL_MONTH_WINDOW_PAST_MS && delta <= DEBUG_ALL_MONTH_WINDOW_FUTURE_MS;
  });
  if (state.index >= state.flights.length) state.index = 0;

  els.dutyStatusCard.hidden = true;
  els.layoverCard.hidden = true;
  if (els.layoverCard.parentElement !== els.flightCardTrack && els.layoverCard.previousElementSibling !== els.crewCard) {
    els.crewCard.after(els.layoverCard);
  }

  const showFlightCard = !!state.flights.length;
  els.flightCardTrack.hidden = !showFlightCard;
  els.crewCard.hidden = !showFlightCard;
  if (!showFlightCard) {
    els.flightCardDots.hidden = true;
    renderAirlineBadge(null);
    showBanner("Keine Flüge im geladenen Zeitraum.", "");
    return;
  }

  const signature = flightsSignature(state.flights) + "|DEBUG_ALL_MONTH";
  const rebuilt = signature !== lastCardSignature;
  if (rebuilt) {
    buildFlightCards(null);
    lastCardSignature = signature;
  }

  state.flights.forEach((flight, i) => renderFlightCardContent(state.flights, state.cardNodes, i, i === state.index));
  if (rebuilt) scrollTrackToIndex(state.index);
  els.flightCardDots.hidden = state.flights.length <= 1;
  renderFlightDots();
  updateTrackHeight();

  const f = state.flights[state.index];
  renderAirlineBadge(f.flightNumber);
  renderCrew(f);
  ensureCrewLoaded(f);
}

function renderFlight() {
  // Debug-only escape hatch (see #debugCard) - bypasses everything below
  // (today-only filtering, the Ortstag/post-landing switch, the dedicated
  // Layover carousel) in favor of one long scrollable carousel over every
  // real flight in the whole loaded window, so card fields can be checked
  // across a full month without waiting for each flight to actually
  // become "today".
  if (getDebugAllMonth()) {
    renderDebugAllMonthCarousel();
    return;
  }

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

// Deadheading covers both OpenAirLog crew (see normalizeCrewMember()'s
// isDeadhead) and a PDF crew list, which marks the same thing directly in
// the role text. Someone deadheading isn't actually working that flight -
// shown in the crew list, but never counted as part of it for anything
// that needs to know who's actually operating (e.g. renderLayoverCrew()'s
// own room-list filtering).
function isOperatingCrewMember(member) {
  return !member.isDeadhead && String(member.role || "").toUpperCase() !== "DH";
}

function renderCrewMembers(listEl, crew, opts = {}) {
  const {
    leaving = new Set(), joining = new Set(),
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
      // The PDF's own "Ex" column, when it prints one - a block can start
      // with no Ex column at all (no prior flight documented for that
      // colleague), which still means they're joining, just with nothing
      // more specific to caption the arrow with.
      const pdfRef = pdfExRefs.get(key);
      if (pdfRef) {
        const info = document.createElement("span");
        info.className = "crew-arrow-info";
        info.textContent = `← inbound ${pdfRef}`;
        name.appendChild(info);
      }
    }
    if (isLeaving) {
      const pdfRef = pdfToRefs.get(key);
      if (pdfRef) {
        const info = document.createElement("span");
        info.className = "crew-arrow-info";
        info.textContent = `→ outbound ${pdfRef}`;
        name.appendChild(info);
      }
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

// Shared by formatPdfFlightRef(): picks whichever of the neighboring
// three months makes the PDF's bare day-of-month fall closest to the
// flight this reference is shown on - arithmetic on a confirmed digit,
// not a guess about undocumented syntax.
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

function formatPdfFlightRef(raw, contextDateKey) {
  const resolved = resolvePdfRef(raw, contextDateKey);
  if (!resolved) return raw;
  const dateLabel = resolved.candidate.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return `${resolved.flightNumber} am ${dateLabel}`;
}

// Live variants via Flightradar24 (see ensureFlightByNumberLoaded()),
// preferred over the plain PDF-text fallback above whenever a key is
// configured - they reflect this exact occurrence's actual status, not
// just the bare flight number/date the PDF itself printed. Both read the
// connecting flight's own observed time (FR24 has no "scheduled" concept,
// see the module comment above) - which for a still-future connection is
// simply not there yet, falling back to the bare flight number until it
// actually happens.
function formatExRefLabelLive(flightNumber, leg) {
  if (!flightNumber) return null;
  if (leg && leg.arrDate) return `${flightNumber} ${fmtTime(leg.arrDate)}`;
  return flightNumber;
}
function formatToRefLabelLive(flightNumber, leg) {
  if (!flightNumber) return null;
  if (leg && leg.depDate) return `${flightNumber} ${fmtTime(leg.depDate)}`;
  return flightNumber;
}

// Per-member Ex/To reference (verbatim from the uploaded PDF, reformatted
// via the live Flightradar24 lookup when available, else just the flight
// number plus the resolved date) - an "exRef" only counts for the block's
// first flight, a "toRef" only for its last (see parseCrewFromLines()),
// so a colleague who shows up in more than one PDF block doesn't leak the
// wrong block's reference onto a flight it doesn't belong to.
function buildPdfRefMap(f, field) {
  const map = new Map();
  if (!state.pdfCrew) return map;
  const blockField = field === "exRef" ? "blockFirstFlight" : "blockLastFlight";
  for (const m of state.pdfCrew.crew) {
    if (!m[field] || m[blockField] !== f.flightNumber) continue;

    const resolved = resolvePdfRef(m[field], f.raw && f.raw.date);
    let label = m[field];

    if (resolved && getFr24Key()) {
      const cacheKey = `${resolved.flightNumber}|${resolved.dateKey}`;
      const cached = flightByNumberCache.get(cacheKey);
      if (!cached) ensureFlightByNumberLoaded(resolved.flightNumber, resolved.dateKey);
      const leg = cached && cached.leg;
      label = field === "exRef"
        ? (formatExRefLabelLive(resolved.flightNumber, leg) || m[field])
        : (formatToRefLabelLive(resolved.flightNumber, leg) || m[field]);
    } else if (resolved) {
      label = formatPdfFlightRef(m[field], f.raw && f.raw.date);
    }

    map.set(crewKey(m.role, m.name), label);
  }
  return map;
}

// Position of a flight number in the PDF's own leg table (state.pdfLegs,
// in document order) - or -1 if the PDF doesn't cover it at all.
function pdfLegIndex(flightNumber) {
  return state.pdfLegs.findIndex((leg) => leg.flightNumber === flightNumber);
}

// A PDF crew table only ever lists a CHANGE, never the full roster for
// its own block - confirmed on a real Umlaufcrewliste: a block with no
// crew change at all doesn't even get its own crew table ("OD-Crew wird
// nicht geändert!" stands in for one), and a later block's table only
// lists the people who actually join or leave there, not everyone still
// on board unchanged. So a crew member with only one PDF row continues
// for the REST of the rotation from that row's block onward, not just
// through that one block - and a second row for the same person (role +
// name) is what actually marks them leaving, not the first row's own
// blockLastFlight. The sole exception is the rotation's very first
// block: its rows are the starting roster, not a join relative to some
// earlier state, so nobody there gets a join arrow on its first flight.
//
// Returns a Map of crewKey -> ordered list of {startIdx, endIdx, joinMember,
// leaveMember, joins} windows (endIdx null while still open/ongoing).
function pdfCrewWindows() {
  const windows = new Map();
  for (const m of state.pdfCrew.crew) {
    const startIdx = pdfLegIndex(m.blockFirstFlight);
    const endIdx = pdfLegIndex(m.blockLastFlight);
    if (startIdx === -1 || endIdx === -1) continue;
    const key = crewKey(m.role, m.name);
    let list = windows.get(key);
    if (!list) { list = []; windows.set(key, list); }
    const open = list.length && list[list.length - 1].endIdx === null ? list[list.length - 1] : null;
    if (open) {
      open.endIdx = endIdx;
      open.leaveMember = m;
    } else {
      list.push({ startIdx, endIdx: null, joinMember: m, leaveMember: null, joins: startIdx !== 0 });
    }
  }
  return windows;
}

// Who's actually on the crew for a given flight (deduped - a member with
// two PDF rows, one for joining and one for leaving, only appears once),
// plus which of those are joining/leaving right on this flight - derived
// from pdfCrewWindows() rather than any single row's own boundaries (see
// its comment for why that's not the same thing).
function computePdfCrewState(flightNumber) {
  const idx = pdfLegIndex(flightNumber);
  const members = [];
  const joining = new Set();
  const leaving = new Set();
  if (idx === -1) return { members, joining, leaving };
  for (const [key, list] of pdfCrewWindows()) {
    const w = list.find((win) => idx >= win.startIdx && (win.endIdx === null || idx <= win.endIdx));
    if (!w) continue;
    members.push(w.joinMember);
    if (idx === w.startIdx && w.joins) joining.add(key);
    if (w.endIdx !== null && idx === w.endIdx) leaving.add(key);
  }
  return { members, joining, leaving };
}

// Crew only ever comes from the uploaded PDF now (see state.pdfCrew) -
// there's no other source left to fall back to or switch between.
function renderCrew(f) {
  // A PDF's routing table can simply not cover this particular flight - a
  // rotation regenerated under a new Umlauf number, an old upload left over
  // from a previous day, or (in "alle Kacheln" debug mode) a flight outside
  // the PDF's own date range altogether. Showing it as "PDF · Umlauf ..."
  // regardless would silently attach a completely unrelated crew list.
  // Only trust it here once its own leg table actually lists this flight
  // number; no leg table at all (parsing failed but crew rows still did)
  // keeps the old permissive behavior rather than blocking on nothing.
  const pdfCoversFlight = !state.pdfLegs.length ||
    state.pdfLegs.some((leg) => leg.flightNumber === f.flightNumber);
  const hasPdfCrew = !!(state.pdfCrew && state.pdfCrew.crew.length && pdfCoversFlight);

  els.crewList.innerHTML = "";
  els.crewEmpty.hidden = true;

  if (!hasPdfCrew) {
    els.crewSource.textContent = "";
    els.crewEmpty.hidden = false;
    els.crewEmpty.textContent = "Keine Crewdaten - bitte Umlaufcrewliste als PDF hochladen.";
    return;
  }

  const ownName = getOwnName();
  const maxDuty = computeMaxLegalOnBlock(f);
  const legalOnBlockLabel = maxDuty
    ? `latest Onblock: ${fmtTime(maxDuty.latestOnBlockUtc).replace("Z", " UTC")} (${maxDuty.source})`
    : null;

  const { rotation, fileName } = state.pdfCrew;
  els.crewSource.textContent = rotation ? `PDF · Umlauf ${rotation.rotation}` : `PDF · ${fileName}`;
  // Who's actually on this flight's crew, and who's joining/leaving right
  // here, comes from pdfCrewWindows()' running roster (see its comment) -
  // not from each row's own block boundaries, since a later block's crew
  // table only ever lists who changes, never the people already on board
  // who stay unchanged. Falls back to the raw flat list, unfiltered, when
  // the leg table itself didn't parse (pdfCoversFlight's permissive
  // branch above) - there's no flight index to place anyone against then.
  const { members, joining, leaving } = state.pdfLegs.length
    ? computePdfCrewState(f.flightNumber)
    : { members: state.pdfCrew.crew, joining: new Set(), leaving: new Set() };
  const pdfExRefs = buildPdfRefMap(f, "exRef");
  const pdfToRefs = buildPdfRefMap(f, "toRef");
  renderCrewMembers(els.crewList, members, {
    leaving, joining,
    pdfExRefs, pdfToRefs,
    ownName, legalOnBlockLabel,
  });
}

// OpenAirLog removed - crew now only ever comes from the PDF crew list
// (see renderCrew()/state.pdfCrew). Kept as a no-op stub since callers
// still call it unconditionally before falling back to whatever crew data
// is already on the flight object.
async function ensureCrewLoaded(f) {}

// ---------- data loading ----------

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
// past arrival" becomes true while the app just sits there. A flight the
// pilot is only deadheading on doesn't get its own card - it's excluded
// here rather than in the caller so it's also gone from "the last flight
// of the day" special-casing below.
function computeTodayFlights(allFlights) {
  const todayKey = localDateKey(new Date());
  const today = allFlights.filter((f) => {
    if (f.isDeadhead) return false;
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
      let fullName = name.trim().replace(/\s+/g, " ");
      // A multi-word given name can itself wrap onto its own line - distinct
      // from CREW_ROW_SURNAME_WRAP_RE's surname wrap below, this is the
      // surname *and* the first word of the given name already fitting on
      // this line, with the rest of the given name alone on the next one
      // (confirmed on a real Umlaufcrewliste: "BARTELS YOSHIDA, JONAS" /
      // "LINO", with the PK-Nummer only appearing after that) - without
      // this, the name is silently truncated ("..., Jonas" instead of
      // "..., Jonas Lino").
      if (looksLikeNameContinuation(lines[i + 1])) {
        fullName = `${fullName} ${lines[i + 1].trim()}`;
        i++;
      }
      crew.push({ role: role.trim(), name: displayName(fullName), details: "", ...refFields });
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

// IATA -> ICAO, for turning MyTime roster's own 3-letter station codes
// ("LH 1172: FRA-LIS", confirmed real format - see
// rosterEventsToRawFlights()) into the 4-letter ICAO codes the rest of
// this app is built around (ICAO_CITY/TIMEZONE_BY_ICAO above, and
// Flightradar24's own orig_icao/dest_icao fields) - standard, publicly
// documented IATA/ICAO pairs (unlike an airline-internal callsign, not
// something that needs confirming one at a time), covering exactly the
// same airports ICAO_CITY already does, so nothing here introduces a
// station this codebase doesn't already trust. An airport missing from
// this table (a station outside that list) is passed through unconverted
// rather than dropped - degrades to "ICAO_CITY/Flightradar24 just won't
// recognize it," not a crash.
const IATA_TO_ICAO = {
  FRA: "EDDF", MUC: "EDDM", BER: "EDDB", HAM: "EDDH", DUS: "EDDL", CGN: "EDDK",
  STR: "EDDS", NUE: "EDDN", BRE: "EDDW", LEJ: "EDDP", SCN: "EDDR", HAJ: "EDDV",
  DRS: "EDDC", FMO: "EDDG",
  VIE: "LOWW", SZG: "LOWS", INN: "LOWI", GRZ: "LOWG", LNZ: "LOWL",
  ZRH: "LSZH", GVA: "LSGG", BRN: "LSZB", BSL: "LFSB",
  LHR: "EGLL", LGW: "EGKK", STN: "EGSS", LTN: "EGGW", LCY: "EGLC", MAN: "EGCC",
  BHX: "EGBB", EDI: "EGPH", GLA: "EGPF", NCL: "EGNT", DUB: "EIDW",
  CDG: "LFPG", ORY: "LFPO", LYS: "LFLL", NCE: "LFMN", MRS: "LFML", TLS: "LFBO",
  NTE: "LFRS", SXB: "LFST", BOD: "LFBD", AMS: "EHAM", BRU: "EBBR",
  MAD: "LEMD", BCN: "LEBL", PMI: "LEPA", AGP: "LEMG", SVQ: "LEZL", VLC: "LEVC",
  ALC: "LEAL", BIO: "LEBB", LPA: "GCLP", TFS: "GCTS", LIS: "LPPT", OPO: "LPPR",
  FAO: "LPFR",
  FCO: "LIRF", CIA: "LIRA", LIN: "LIML", MXP: "LIMC", NAP: "LIRN", FLR: "LIRQ",
  VCE: "LIPZ", PMO: "LICJ", CTA: "LICC", BRI: "LIBD",
  ARN: "ESSA", OSL: "ENGM", CPH: "EKCH", BLL: "EKBI", HEL: "EFHK", VNO: "EYVI",
  RIX: "EVRA", TLL: "EETN",
  WAW: "EPWA", KRK: "EPKK", POZ: "EPPO", WRO: "EPWR", GDN: "EPGD", PRG: "LKPR",
  BUD: "LHBP", OTP: "LROP", SOF: "LBSF", ZAG: "LDZA", SPU: "LDSP", DBV: "LDDU",
  LJU: "LJLJ", BEG: "LYBE", RMO: "LUKK",
  ATH: "LGAV", SKG: "LGTS", HER: "LGIR", RHO: "LGRP", IST: "LTFM", AYT: "LTAI",
  SAW: "LTFJ", LCA: "LCLK", MLA: "LMML",
  CMN: "GMMN", CAI: "HECA", HRG: "HEGN", SSH: "HESH", DXB: "OMDB", DOH: "OTHH",
  AUH: "OMAA", RUH: "OERK", JED: "OEJN",
  JFK: "KJFK", EWR: "KEWR", LAX: "KLAX", ORD: "KORD", MIA: "KMIA", IAD: "KIAD",
  BOS: "KBOS", SFO: "KSFO", ATL: "KATL", YYZ: "CYYZ", YUL: "CYUL",
  NRT: "RJAA", HND: "RJTT", PEK: "ZBAA", HKG: "VHHH", SIN: "WSSS", BOM: "VABB",
  DEL: "VIDP", ICN: "RKSI", JNB: "FAOR", NBO: "HKJK", SYD: "YSSY", GRU: "SBGR",
};

function iataToIcao(code) {
  return IATA_TO_ICAO[code] || code;
}

// ICAO -> IATA (the 3-letter code pilots and passengers actually know an
// airport by), inverted from IATA_TO_ICAO above rather than hand-
// maintained separately - same trusted, publicly documented pairs, so
// there's no second table that could quietly drift out of sync with the
// first. This used to be a small hand-picked THREE_LETTER_CODE table
// (only entries confirmed one at a time, out of an old, now-outdated
// caution about station codes in general - see the IATA_TO_ICAO comment
// on why that caution doesn't apply to IATA itself) - replaced now that
// every airport this app already trusts (ICAO_CITY's own list) has a
// real IATA code behind it. Falls back to the raw ICAO code for anything
// outside that list rather than showing nothing.
const ICAO_TO_IATA = Object.fromEntries(
  Object.entries(IATA_TO_ICAO).map(([iata, icao]) => [icao, iata])
);

function threeLetterCode(icao) {
  return ICAO_TO_IATA[icao] || icao;
}

// IANA time zone per ICAO code - only populated for stations actually
// seen in a real backup-pickup calculation so far (unlike threeLetterCode()
// above, a time zone isn't public standard data the same way an IATA
// code is, so this stays deliberately narrow). Every station
// computeLegalRestReference() can ever produce a time for, so a backup
// pickup can always be shown in local time, matching a roster pickup's
// "LT" formatting instead of a bare UTC instant.
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

// Today's flights including a deadhead one, unlike state.flights (the
// card list, see computeTodayFlights()) - a deadhead leg to the layover
// city is still a real physical event that decides where the day actually
// ends, even though it doesn't get its own card. Filtered straight from
// state.allFlights (untouched, all dates) rather than cached, so it always
// reflects the current date the same way computeTodayFlights() does.
function todaysFlightsIncludingDeadhead() {
  const todayKey = localDateKey(new Date());
  return state.allFlights.filter((f) => {
    const d = f.depSchedDate || f.depActualDate;
    return d && localDateKey(d) === todayKey;
  });
}

// Once today's own last flight - including a trailing deadhead leg, which
// is what actually puts the pilot at the layover city even without a card
// of its own (see todaysFlightsIncludingDeadhead()) - has actually
// departed, not merely still scheduled to, the pilot wants a look ahead at
// the layover it's flying into, attached as one more swipeable page right
// after the last card in the ordinary flight-card carousel (see
// buildFlightCards()/renderFlight()), well before findApiLayover()'s own
// POST_LANDING_SWITCH_MS gate flips the whole app over into the dedicated
// Layover carousel. Same non-home-base/same-day-connection exclusions as
// findApiLayover() - this is genuinely a preview of the SAME layover that
// eventually takes over there, not a separate concept, and stays scoped to
// today's own flights so it starts over once midnight rolls the date over,
// same as the rest of the app (see computeTodayFlights()).
function previewLayoverFlight() {
  const today = todaysFlightsIncludingDeadhead();
  const last = today[today.length - 1];
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

// Once today's last flight - including a trailing deadhead leg home, which
// is what actually gets the pilot back even without a card of its own (see
// todaysFlightsIncludingDeadhead()) - has landed back at home base, the
// pilot wants the dashboard to switch into the same "Ortstag" view as an
// actual ORTSTAG duty_code would produce - 30 minutes after that flight's
// *scheduled* arrival, not the actual one (matches the rest of the app,
// which times things off the schedule rather than waiting on actual
// block times that may never get filled in). Only applies while looking
// at the last flight of the day, so manually browsing an earlier leg via
// the nav arrows isn't interrupted by the switch.
function shouldShowPostLandingHomeView() {
  const n = state.flights.length;
  if (!n || state.index !== n - 1) return false;
  const today = todaysFlightsIncludingDeadhead();
  const last = today[today.length - 1];
  if (!last || last.arrCode !== HOME_BASE || !last.arrSchedDate) return false;
  return Date.now() - last.arrSchedDate.getTime() >= POST_LANDING_SWITCH_MS;
}

// What renderDutyStatus() actually shows: a real duty_code (vacation/
// Ortstag - never actually produced by the roster feed itself, see
// todayDutyType(), but kept in case a source that does exist again some
// day), the post-landing override above, or - now the only way an
// ordinary rest day at home (no flight at all today, not just "landed
// 30+ min ago") can be recognized at all, since the roster never marks
// a day off explicitly the way a duty_code would - simply having
// nothing scheduled today. Without this, a genuine day off at home
// silently showed nothing at all (no flight card, since there's no
// flight - and no duty status card either, since neither of the other
// two conditions ever applied): blank screen, including the "next duty"
// countdown/Pickup/Briefing preview this card is the only place that
// shows. Gated on findApiLayover() being null too - a rest day *away*
// from home in the middle of a multi-day layover is still a layover,
// not a home day, and already has its own card for exactly that.
function effectiveDutyType() {
  if (todayDutyType()) return todayDutyType();
  if (shouldShowPostLandingHomeView()) return "homeday";
  if (!todaysFlightsIncludingDeadhead().length && !findApiLayover(state.allFlights)) return "homeday";
  return null;
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
const currentWeatherLoading = new Set(); // icao currently in flight, to avoid duplicate
// concurrent requests - renderLayover() itself calls this (see fillLayoverCardContent()),
// and renderFlight() calls renderLayover() a second time in the same pass, so without this
// two identical requests would fire back to back before the first one caches anything.
async function ensureCurrentWeatherLoaded(icao, cityLabel) {
  const cached = currentWeatherCache.get(icao);
  if (cached && Date.now() - cached.fetchedAt < CURRENT_WEATHER_CACHE_MS) return;
  if (currentWeatherLoading.has(icao)) return;
  currentWeatherLoading.add(icao);

  const coords = await geocodeCity(cityLabel);
  const weather = coords ? await fetchCurrentWeather(coords.lat, coords.lon) : null;
  currentWeatherCache.set(icao, { ...(weather || {}), fetchedAt: Date.now() });
  currentWeatherLoading.delete(icao);
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

// Matches the confirmed real "Flight"/"Deadhead" SUMMARY formats (see the
// module comment above): "LH 1172: FRA-LIS" or, deadheading, "DH LH 895:
// VNO-FRA". Layover/Pickup/Briefing events never match this (no
// "XX 1234: AAA-AAA" shape), so they fall straight through untouched.
const ROSTER_FLIGHT_SUMMARY_RE = /^(DH\s+)?([A-Z]{2,3})\s+(\d{1,4}):\s*([A-Z]{3})-([A-Z]{3})/;

// Turns the roster's own flight/deadhead events into OpenAirLog-shaped
// raw entries (flight_number/departure/arrival/date/scheduled_off_block/
// scheduled_on_block/duty_code) - the exact shape normalizeFlight()
// already knows how to read - so applyLoadedFlights() can be reused
// completely unchanged as the duty-plan pipeline, just fed from the
// roster instead of a live API now. Registration/aircraft type/crew
// aren't in the roster feed at all - registration/callsign/actual times
// come from Flightradar24 instead (see getOwnFlightLiveLeg()), crew only
// ever from the uploaded PDF (see renderCrew()).
//
// A MyTime "Teilen"-Link is a persistent calendar subscription, not a
// bounded "next N days" API response the way OpenAirLog's /flights used
// to be - left unfiltered, it can carry a pilot's entire flying history
// (every rotation ever synced, going back months or years). Bounded here
// to a window wide enough for every actual use (adjacentFlight()'s
// neighbor lookups, computeRouteStops(), "next duty" after a vacation/
// vacancy, the debug "alle Kacheln" carousel) without keeping years of
// irrelevant history in state.allFlights.
const ROSTER_WINDOW_PAST_MS = 14 * 24 * 3600 * 1000;
const ROSTER_WINDOW_FUTURE_MS = 60 * 24 * 3600 * 1000;

// Confirmed real SUMMARY text for a simulator session: just "Simulator"
// (an earlier guess also expected a session-code suffix like "EBTF3A" -
// not part of the confirmed text itself, but this still matches it fine
// since it only checks for the word anywhere in the summary). Ground
// training, never real duty flying - shared by rosterEventsToRawFlights()
// (so a session never becomes a "flight"/"next duty") and
// findRosterBriefing() (so that session's own Briefing, always earlier
// the same day, never gets mistaken for a real flight's).
function isSimulatorEvent(ev) {
  return /simulator/i.test(ev.summary || "");
}

function rosterEventsToRawFlights(events) {
  const raw = [];
  const now = Date.now();
  for (const ev of events) {
    if (!ev.summary || !ev.dtstart || !ev.dtend) continue;
    // See isSimulatorEvent() - checked before the flight-summary regex
    // below regardless of whether a session happens to also look
    // route-shaped, so this can't accidentally slip through either way.
    if (isSimulatorEvent(ev)) continue;
    const t = ev.dtstart.getTime();
    if (t < now - ROSTER_WINDOW_PAST_MS || t > now + ROSTER_WINDOW_FUTURE_MS) continue;
    const m = ROSTER_FLIGHT_SUMMARY_RE.exec(ev.summary.trim());
    if (!m) continue;
    const [, dh, airline, number, depCode, arrCode] = m;
    raw.push({
      flight_number: `${airline}${number}`,
      // The roster's own codes are IATA ("FRA") - converted to ICAO here
      // so depCode/arrCode stay consistent with the rest of the app
      // (ICAO_CITY/TIMEZONE_BY_ICAO, Flightradar24's own orig_icao/
      // dest_icao) - see iataToIcao().
      departure: iataToIcao(depCode),
      arrival: iataToIcao(arrCode),
      date: ev.dtstart.toISOString().slice(0, 10),
      scheduled_off_block: ev.dtstart.toISOString(),
      scheduled_on_block: ev.dtend.toISOString(),
      duty_code: dh ? "DH" : undefined,
    });
  }
  return raw;
}

const PICKUP_SUMMARY_RE = /^(\d{2}:\d{2})\s*LT\s*Pickup\s+(\S+)/i;
// Same shape as PICKUP_SUMMARY_RE, just the "Briefing" keyword instead
// of "Pickup" - both confirmed real formats, see the module comment above.
const BRIEFING_SUMMARY_RE = /^(\d{2}:\d{2})\s*LT\s*Briefing\s+(\S+)/i;

// Next Pickup event for the given station after the layover's arrival
// time - "next" rather than "closest", since a pickup only ever makes
// sense in the future relative to landing.
function findRosterPickup(events, stationIcao, afterDate) {
  return findRosterTimedEvent(events, PICKUP_SUMMARY_RE, stationIcao, afterDate);
}

// Next Briefing event for the given station after afterDate - used by
// renderDutyStatus() to show the real MyTime briefing time for the
// upcoming duty. Real-or-nothing, same as the layover card's own Pickup
// line - no computed estimate, see renderDutyStatus()'s own comment.
// A Simulator session gets its own Briefing too, always the same day
// and earlier than the session itself (see isSimulatorEvent()) - always
// excluded here regardless of which flight it's being matched against,
// not just when it happens to fall on some unrelated flight's own day
// (the briefingSameDay check in renderDutyStatus() already guards
// against that specific case, but a same-day real duty would still slip
// through without this).
function findRosterBriefing(events, stationIcao, afterDate) {
  const filtered = events.filter((ev) => {
    if (!ev.dtstart || !BRIEFING_SUMMARY_RE.test((ev.summary || "").trim())) return true;
    return !events.some((other) =>
      other.dtstart && isSimulatorEvent(other) && other.dtstart > ev.dtstart &&
      localDateKey(other.dtstart) === localDateKey(ev.dtstart)
    );
  });
  return findRosterTimedEvent(filtered, BRIEFING_SUMMARY_RE, stationIcao, afterDate);
}

function findRosterTimedEvent(events, re, stationIcao, afterDate) {
  const station3 = threeLetterCode(stationIcao).toUpperCase();
  let best = null;
  for (const ev of events) {
    if (!ev.summary || !ev.dtstart) continue;
    const m = re.exec(ev.summary.trim());
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

// Same in-app probe pattern the other API cards use (see
// testFr24Connection()) - shows exactly what the roster feed actually
// returns and how parseIcsEvents() reads it, right on the page, so a
// wrong/stale Pickup or Briefing time (or a link that silently stopped
// working) can be checked against the real feed without needing
// separate console/Web Inspector access. Runs the exact same
// fetchRosterIcsText()/parseIcsEvents() pipeline ensureRosterLoaded()
// itself uses - same CORS-proxy fallback chain, same parsing - rather
// than a simplified stand-in that could pass while the real thing fails.
async function testRosterConnection() {
  const url = getRosterUrl();
  if (!url) return;

  els.testRosterBtn.disabled = true;
  els.rosterTestResult.hidden = false;
  els.rosterTestResult.textContent = "Teste …";
  els.rosterTestRaw.hidden = true;
  els.rosterTestRaw.textContent = "";

  function showRaw(value) {
    els.rosterTestRaw.hidden = false;
    els.rosterTestRaw.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  try {
    const { text, viaProxy } = await fetchRosterIcsText(url);
    const events = parseIcsEvents(text);
    const via = viaProxy ? ` (über ${viaProxy})` : "";
    els.rosterTestResult.textContent = events.length
      ? `Erfolgreich${via} - ${events.length} Termin(e) im Feed gefunden.`
      : `Antwort kam an${via}, aber keine Termine im Feed erkannt.`;
    showRaw(events.map((ev) => ({
      summary: ev.summary || null,
      location: ev.location || null,
      dtstart: ev.dtstart ? ev.dtstart.toISOString() : null,
      dtend: ev.dtend ? ev.dtend.toISOString() : null,
    })));
  } catch (err) {
    els.rosterTestResult.textContent = `Fehlgeschlagen: ${briefErrorReason(err)}`;
    showRaw(String(err));
  }
  els.testRosterBtn.disabled = false;
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

      // MyTime roster is the primary duty-plan source now - its own
      // flight/deadhead events become state.flights/allFlights via the
      // same applyLoadedFlights()/normalizeFlight() pipeline a live API
      // used to feed (see rosterEventsToRawFlights()), which re-renders
      // the flight card and Layover itself. Scheduled times come straight
      // from the roster's own DTSTART/DTEND, faithfully, with no
      // freshness-based override logic - see computeMaxLegalOnBlock()'s
      // comment on why silently shifting a flight's own scheduled time
      // once already broke the legal FDP figure shown there.
      applyLoadedFlights(rosterEventsToRawFlights(events));
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
    els.dutyStatusPickup.hidden = true;
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

    // Pickup/Briefing: the real MyTime roster events for this duty's own
    // departure station when published (findRosterPickup()/
    // findRosterBriefing()) - real-or-nothing for both, no computed
    // guess for either (a made-up Briefing lead time used to fill in
    // here, confirmed wrong against a real MyTime briefing - 05:05
    // guessed vs. 05:45 actual - so it's gone; not every duty gets
    // picked up either, e.g. home base/self-driven, so Pickup never had
    // one to begin with). Bounded to before the duty's own departure so
    // a duty with no Pickup/Briefing of its own can't accidentally pick
    // up some later, unrelated duty's event instead.
    if (!rosterEventsCache.events) ensureRosterLoaded();
    const now = new Date();
    const rosterPickup = rosterEventsCache.events && next.depCode
      ? findRosterPickup(rosterEventsCache.events, next.depCode, now)
      : null;
    // Searched from a day before the duty itself, not from "now" - using
    // "now" as the lower bound meant checking this card after the
    // duty's own real Briefing time had already passed today (a very
    // normal thing to do) rejected it outright, even though the real
    // roster event was sitting right there. The briefingSameDay check
    // below is what actually keeps this from matching some unrelated
    // day's event at the same station, so "now" was never doing useful
    // work here in the first place.
    const rosterBriefing = rosterEventsCache.events && next.depCode && next.depSchedDate
      ? findRosterBriefing(rosterEventsCache.events, next.depCode, new Date(next.depSchedDate.getTime() - 24 * 3600 * 1000))
      : null;

    if (rosterPickup && (!next.depSchedDate || rosterPickup.dtstart <= next.depSchedDate)) {
      const pickupDateLabel = `${weekdayShortLocal(rosterPickup.dtstart)}, ${rosterPickup.dtstart.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`;
      els.dutyStatusPickup.hidden = false;
      els.dutyStatusPickupValue.textContent = `${pickupDateLabel} - ${rosterPickup.time} LT`;
    } else {
      els.dutyStatusPickup.hidden = true;
    }

    // A flight day's own Briefing always starts on the same calendar day
    // as the flight itself - a same-station Briefing event found on a
    // different day (e.g. a Simulator session's own Briefing, a day or
    // more before the real duty) is never this flight's, even though
    // it'd otherwise still satisfy "before departure" above.
    const briefingSameDay = rosterBriefing && next.depSchedDate &&
      localDateKey(rosterBriefing.dtstart) === localDateKey(next.depSchedDate);
    if (briefingSameDay) {
      const briefingDateLabel = `${weekdayShortLocal(rosterBriefing.dtstart)}, ${rosterBriefing.dtstart.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}`;
      els.dutyStatusBriefing.hidden = false;
      els.dutyStatusBriefingValue.textContent = `${briefingDateLabel} - ${rosterBriefing.time} LT`;
    } else {
      // No computed estimate here (there used to be a BRIEFING_LEAD_MS-
      // before-departure guess) - a made-up lead time was never reliably
      // right (confirmed wrong against a real MyTime briefing) and there's
      // no way to make it right, so same rule as Pickup: only the real
      // roster event, or nothing at all.
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
  els.layoverPlace.textContent = city || threeLetterCode(layover.arrCode);

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

// Only shown once a PDF has actually been uploaded (the only crew
// source). Narrowed to whoever's actually on the flight that landed here
// (so they're really at this layover, not just listed somewhere else in
// the PDF) and still on the next flight too (a room number is only
// useful for coordinating with someone who's still around tomorrow, not
// a colleague leaving the crew at this stop) - determined from the PDF's
// own running roster (computePdfCrewState()), the same source the
// join/leave arrows use now, rather than the flight's own live-tracked
// crew (OpenAirLog only, always empty since crew went PDF-only).
function renderLayoverCrew(arrCode, hotel, flight) {
  const hasPdfCrew = !!(state.pdfCrew && state.pdfCrew.crew.length);
  const ownName = getOwnName();
  const next = flight ? adjacentFlight(flight, 1) : null;

  // "On the crew for both" via computePdfCrewState()'s running roster
  // (see its comment) - not each row's own block boundaries, since
  // someone established earlier (the base crew, or an earlier join) and
  // never mentioned again is still on board, not just through their own
  // row's block.
  let crew = [];
  if (hasPdfCrew && flight && next) {
    const hereKeys = new Set(computePdfCrewState(flight.flightNumber).members.map((m) => crewKey(m.role, m.name)));
    crew = computePdfCrewState(next.flightNumber).members.filter(
      (m) => hereKeys.has(crewKey(m.role, m.name)) && !isOwnName(m.name, ownName)
    );
  }

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
      els.crewPdfStatus.textContent =
        `${crew.length} Crewmitglied(er) erkannt und oben als Crew übernommen.` +
        (rotation ? ` (Umlauf ${rotation.rotation})` : "");
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

els.settingsBtn.addEventListener("click", () => {
  setSettingsOpen(els.crewPdfCard.hidden);
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

els.testRosterBtn.addEventListener("click", testRosterConnection);

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

els.saveFr24Btn.addEventListener("click", () => {
  const val = els.fr24KeyInput.value.trim();
  if (!val) return;
  setFr24Key(val);
  els.fr24KeyInput.value = "";
  flightByNumberCache.clear();
  aircraftScheduleCache.clear();
  renderFr24Status();
  renderFlight();
});

els.resetFr24Btn.addEventListener("click", () => {
  if (!confirm("Flightradar24-API-Schlüssel auf diesem Gerät entfernen?")) return;
  clearFr24Key();
  flightByNumberCache.clear();
  aircraftScheduleCache.clear();
  renderFr24Status();
  renderFlight();
});

els.testFr24Btn.addEventListener("click", testFr24Connection);

els.debugAllMonthInput.addEventListener("change", () => {
  const on = els.debugAllMonthInput.checked;
  setDebugAllMonth(on);
  // Turning it back off: state.flights is left holding whatever
  // renderDebugAllMonthCarousel() put there (the whole month) - nothing
  // else recomputes it back down on its own (the 30s ticker's own reset
  // is deliberately skipped while debug mode is on, see its own comment),
  // so this has to do it here, the same way that ticker normally would.
  if (!on && state.allFlights.length) {
    state.flights = computeTodayFlights(state.allFlights);
    state.index = state.flights.length ? Math.min(pickInitialIndex(state.flights), state.flights.length - 1) : 0;
  }
  lastCardSignature = null; // force a rebuild either way, switching card sets
  renderFlight();
});

// ↻ refreshes the MyTime roster and clears the Flightradar24 lookup
// caches, so a stale registration/callsign/live-time lookup doesn't keep
// showing after the pilot explicitly asks for fresh data - the normal
// "fetch if not yet cached" logic then re-fetches whatever's relevant to
// what ends up shown once this re-renders.
async function refreshAll() {
  flightByNumberCache.clear();
  aircraftScheduleCache.clear();
  await ensureRosterLoaded(true);
  lastUpdateAt = new Date();
  isOffline = false;
  renderDataStamp();
  renderFlight();
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

els.saveOwnNameBtn.addEventListener("click", () => {
  setOwnName(els.ownNameInput.value.trim());
  renderBrandName();
  const f = state.flights[state.index];
  if (f) renderCrew(f);
  renderLayover();
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

// Lets the app shell itself load offline (see sw.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support just won't be available */ });
  });
}

// Startup never fetches anything live - state.allFlights simply stays
// empty until a data source populates it (applyLoadedFlights() is ready
// for that, just nothing calls it yet). Flightradar24 only ever enriches
// flights already known from elsewhere, it isn't a source of which
// flights exist. Never fetched automatically, on startup or otherwise -
// the pilot's own explicit choice to control when a sync happens (mobile
// data, freshness) - only ↻ (refreshAll()) ever loads the roster and
// clears the Flightradar24 lookup caches. The dashboard genuinely starts
// blank on every open until that first manual tap; nothing here is
// cached across page loads to show in the meantime.
function loadInitial() {
  els.refreshBtn.hidden = false;
  showBanner("", "");
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
  // Skipped entirely while the debug "all month" toggle is on (see
  // renderDebugAllMonthCarousel()) - otherwise this would reset
  // state.flights back down to just today's list every 30s, immediately
  // undoing what that toggle is for.
  if (state.allFlights.length && !getDebugAllMonth()) {
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
  // active card's own live lookup is allowed to actually fire.
  state.flights.forEach((f, i) => {
    const node = state.cardNodes[i];
    if (!node) return;
    const statusEl = node.querySelector(".status-pill");
    const ownLeg = getOwnFlightLiveLeg(f, { peekOnly: i !== state.index });
    updateFlightTimerDisplay(f, ownLeg, statusEl, i === state.index);
  });
  tickPostLandingSwitch();
}, 30000);

