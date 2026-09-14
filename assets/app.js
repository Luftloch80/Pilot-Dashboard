"use strict";

const API_BASE = "https://openairlog.de/api/v1";
const STORAGE_KEY = "oal_api_key";
const PDF_CREW_STORAGE_KEY = "oal_pdf_crew";
const FETCH_TIMEOUT_MS = 15000;

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
  dataStamp: document.getElementById("dataStamp"),

  statusBanner: document.getElementById("statusBanner"),

  flightNav: document.getElementById("flightNav"),
  prevFlightBtn: document.getElementById("prevFlightBtn"),
  nextFlightBtn: document.getElementById("nextFlightBtn"),
  flightNavTitle: document.getElementById("flightNavTitle"),
  flightNavSub: document.getElementById("flightNavSub"),

  flightCard: document.getElementById("flightCard"),
  flightNumber: document.getElementById("flightNumber"),
  flightStatus: document.getElementById("flightStatus"),
  depCode: document.getElementById("depCode"),
  arrCode: document.getElementById("arrCode"),
  depTime: document.getElementById("depTime"),
  arrTime: document.getElementById("arrTime"),
  aircraft: document.getElementById("aircraft"),
  registration: document.getElementById("registration"),
  airlineBadge: document.getElementById("airlineBadge"),
  airlineBadgeCode: document.getElementById("airlineBadgeCode"),

  layoverCard: document.getElementById("layoverCard"),
  layoverTitle: document.getElementById("layoverTitle"),
  layoverPlace: document.getElementById("layoverPlace"),
  layoverHotel: document.getElementById("layoverHotel"),
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

  refreshBtn: document.getElementById("refreshBtn"),
  resetKeyBtn: document.getElementById("resetKeyBtn"),
  ownNameCard: document.getElementById("ownNameCard"),
  ownNameInput: document.getElementById("ownNameInput"),
};

/** @type {{flights: any[], index: number, crewSource: "api"|"pdf", pdfCrew: {crew: any[], rotation: any, fileName: string}|null}} */
const state = { flights: [], allFlights: [], index: 0, crewSource: "api", pdfCrew: null, pdfLegs: [], pdfLines: [] };
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
  return { name: displayName(String(name)), role: String(role) };
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
  els.ownNameCard.hidden = !open;
  els.crewPdfCard.hidden = !open;
  if (open) {
    els.flightNav.hidden = true;
    els.flightCard.hidden = true;
    els.layoverCard.hidden = true;
    els.crewCard.hidden = true;
  } else {
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

function renderFlightNav() {
  const n = state.flights.length;
  els.flightNav.hidden = n === 0;
  els.prevFlightBtn.disabled = state.index <= 0;
  els.nextFlightBtn.disabled = state.index >= n - 1;
  els.flightNavTitle.textContent = n ? `Flug ${state.index + 1} von ${n}` : "–";
  const f = state.flights[state.index];
  els.flightNavSub.textContent = f ? `${f.depCode} → ${f.arrCode}` : "–";
}

// T-minus/T-plus countdown against the scheduled departure: green "-N min"
// while still ahead of schedule, red "+N min" once that time has passed.
function renderTimerPill(f) {
  if (f.isDeadhead) {
    els.flightStatus.textContent = "DH";
    els.flightStatus.className = "status-pill deadhead";
    return;
  }
  if (!f.depSchedDate) {
    els.flightStatus.textContent = "–";
    els.flightStatus.className = "status-pill";
    return;
  }
  const diffMin = Math.round((f.depSchedDate.getTime() - Date.now()) / 60000);
  if (diffMin > 0) {
    els.flightStatus.textContent = `-${diffMin} min`;
    els.flightStatus.className = "status-pill timer-before";
  } else {
    els.flightStatus.textContent = `+${Math.abs(diffMin)} min`;
    els.flightStatus.className = "status-pill timer-after";
  }
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

function renderAirlineBadge(flightNumber) {
  const prefix = (flightNumber || "").slice(0, 2).toUpperCase();
  if (!prefix) {
    els.airlineBadge.hidden = true;
    return;
  }
  const airline = AIRLINE_BY_PREFIX[prefix];
  els.airlineBadge.hidden = false;
  els.airlineBadgeCode.textContent = prefix;
  els.airlineBadge.title = airline ? airline.name : prefix;
  els.airlineBadge.style.setProperty("--airline-bg", airline ? airline.bg : "");
  els.airlineBadge.style.setProperty("--airline-fg", airline ? airline.fg : "");
}

// "Stand: HH:MMZ" next to the refresh button - OpenAirLog's own
// updated_at for the currently shown flight, not when the app last
// fetched, so it reflects an actual OpenAirLog-side change (e.g. a crew
// swap) rather than just how recently the refresh button was tapped.
// Colored green while that's still the newest version, red once the
// background check (below) finds a newer updated_at on the server -
// the pilot still decides when to actually pull it in via ↻, this is
// only a signal that doing so would show something new.
let dataStampFresh = true;

function renderDataStamp(f) {
  if (!f || !f.updatedAt) {
    els.dataStamp.hidden = true;
    return;
  }
  els.dataStamp.hidden = false;
  els.dataStamp.textContent = `Stand: ${fmtTime(f.updatedAt)}`;
  els.dataStamp.title = dataStampFresh
    ? "Letzte Änderung an diesem Flug laut OpenAirLog - aktuell"
    : "OpenAirLog hat neuere Daten für diesen Flug - zum Übernehmen auf ↻ tippen";
  els.dataStamp.classList.toggle("fresh", dataStampFresh);
  els.dataStamp.classList.toggle("stale", !dataStampFresh);
}

// Background freshness check, every 5 minutes: re-fetches the flight list
// (same endpoint loadFlights() uses) but only compares the currently
// shown flight's updated_at against what's on screen - never replaces the
// rendered crew/flight data itself, since the pilot asked to keep that
// manual (via ↻) and just wants an early, passive signal here.
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function checkForUpdate() {
  const f = state.flights[state.index];
  if (!f || f.id == null || !f.updatedAt) return;

  const key = getApiKey();
  if (!key) return;

  const from = todayISO(-7);
  const to = todayISO(1);
  const url = `${API_BASE}/flights?from=${from}&to=${to}&per_page=100`;

  let res;
  try {
    res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return; // silent - background check, no user-facing error for this
  }
  if (!res.ok) return;

  let json;
  try { json = await res.json(); } catch { return; }

  const rawFlights = extractFlightsArray(json).filter(isRealFlightEntry);
  const match = rawFlights.find((raw) => String(pick(raw, ["id", "flight_id", "flightId", "uuid"])) === String(f.id));
  if (!match) return;

  const freshUpdatedAt = toDateOrNull(pick(match, ["updated_at", "updatedAt"]));
  if (!freshUpdatedAt) return;

  // Only re-render if the freshness actually changed, so this doesn't
  // fight with a manual refresh that happened in between.
  const stillCurrent = state.flights[state.index] === f;
  const nowFresh = freshUpdatedAt.getTime() <= f.updatedAt.getTime();
  if (stillCurrent && nowFresh !== dataStampFresh) {
    dataStampFresh = nowFresh;
    renderDataStamp(f);
  }
}

function renderFlight() {
  const f = state.flights[state.index];
  els.flightCard.hidden = !f;
  els.crewCard.hidden = !f;
  // Whatever's now shown (a fresh load, or switching to another already-
  // loaded flight) is the current baseline - mark it fresh again until the
  // next background check says otherwise.
  dataStampFresh = true;
  renderDataStamp(f);
  if (!f) return;

  els.flightNumber.textContent = f.flightNumber;
  renderTimerPill(f);

  els.depCode.textContent = f.depCode;
  els.arrCode.textContent = f.arrCode;
  els.depTime.textContent = fmtTime(f.depSchedDate);
  els.arrTime.textContent = fmtTime(f.arrSchedDate);

  els.aircraft.textContent = f.aircraft;
  els.registration.textContent = f.registration;
  renderAirlineBadge(f.flightNumber);

  renderCrew(f);
  ensureCrewLoaded(f);

  renderFlightNav();
}

function renderCrewMembers(listEl, crew) {
  listEl.innerHTML = "";
  for (const member of crew) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = member.name;
    const role = document.createElement("span");
    role.className = "crew-role";
    role.textContent = member.role;
    li.appendChild(name);
    li.appendChild(role);
    listEl.appendChild(li);
  }
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

// Crew shown here comes either from OpenAirLog (per-flight, via
// /flights/{id}/crew) or - if the pilot uploaded a PDF - from that PDF,
// which then overwrites the OpenAirLog crew until switched back.
function renderCrew(f) {
  const entry = f.id != null ? crewCache.get(f.id) : undefined;
  const hasEmbedded = f.embeddedCrew.length > 0;
  const apiCrew = hasEmbedded ? f.embeddedCrew : entry && entry.status === "ok" ? entry.crew : [];
  const hasPdfCrew = !!(state.pdfCrew && state.pdfCrew.crew.length);

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

  if (useSource === "pdf") {
    const { crew, rotation, fileName } = state.pdfCrew;
    els.crewSource.textContent = rotation ? `PDF · Umlauf ${rotation.rotation}` : `PDF · ${fileName}`;
    // Reconcile with the live OpenAirLog crew when it's available - falls
    // back to the raw PDF list only while the API crew hasn't loaded yet.
    renderCrewMembers(els.crewList, apiCrew.length ? mergeCrewWithPdf(apiCrew, crew) : crew);
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

  renderCrewMembers(els.crewList, apiCrew);
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

  // Only *today's* flights are ever shown as "the" flight (filtered below),
  // but layover detection needs to look back further - a layover can span
  // several days (e.g. landed 3 days ago, next departure tomorrow) - so the
  // fetch window itself reaches back a week to find the most recent arrival.
  const from = todayISO(-7);
  const to = todayISO(1);
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
  } catch (err) {
    showBanner(
      err && err.name === "AbortError"
        ? "Zeitüberschreitung bei der Verbindung zu OpenAirLog. Bitte auf „Aktualisieren“ tippen."
        : "Verbindung zu OpenAirLog fehlgeschlagen. Das kann an fehlendem Internet liegen " +
          "oder daran, dass die API keine Anfragen direkt aus dem Browser erlaubt (CORS). " +
          "Falls das dauerhaft passiert, muss OpenAirLog diese Web-App-Adresse freigeben.",
      "error"
    );
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

  // Ignore non-flight entries (duty/ground days etc.) - only real flights.
  const rawFlights = extractFlightsArray(json).filter(isRealFlightEntry);
  const allFlights = rawFlights.map(normalizeFlight).sort((a, b) => {
    const da = a.depSchedDate || a.depActualDate || new Date(0);
    const db = b.depSchedDate || b.depActualDate || new Date(0);
    return da - db;
  });

  const todayKey = localDateKey(new Date());
  const flights = allFlights.filter((f) => {
    const d = f.depSchedDate || f.depActualDate;
    return d && localDateKey(d) === todayKey;
  });

  crewCache.clear();
  state.flights = flights;
  state.allFlights = allFlights;
  renderLayover();

  if (!flights.length) {
    // A short hint only when the dashboard would otherwise show nothing at
    // all (no flight today and no layover) - so it's clear the app loaded
    // fine rather than looking broken/blank.
    showBanner(els.layoverCard.hidden ? "Heute nichts geplant." : "", "");
    renderFlight();
    return;
  }

  state.index = pickInitialIndex(flights);
  showBanner("", "");
  renderFlight();
  // Land on the flight that matches the current time, not wherever the
  // page happened to be scrolled (e.g. after a refresh from further down).
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- PDF crew list (optional, supplementary) ----------
//
// Layout-aware extraction: pdf.js only gives us individual positioned text
// fragments, not rows. We cluster fragments by their y-coordinate into
// visual lines, then sort each line left-to-right by x, which reconstructs
// table rows like "CP DROSTE, ALEXANDER 770166A FRAL/OF-A/B" reliably
// enough to parse. Verified against a real "Umlaufcrewliste" (Lufthansa-
// style rotation crew list) PDF.

async function extractPdfLines(pdf) {
  const lines = [];
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
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const line = row.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) lines.push(line);
    }
  }
  return lines;
}

// Matches crew-table rows: a short role code (CP, FO, P1, FB, PU, ...)
// followed by "Nachname, Vorname" and trailing columns. Case-insensitive,
// since names appear all-caps in some rotation crew lists (as in the
// original sample) and in regular Title Case in others. Deliberately not
// a fixed role whitelist, since role codes differ between airlines/roster
// systems. The PK-Nummer/staff-ID column (starts with a digit) is used
// as an anchor so the lazily-matched name doesn't get cut short; a
// second, looser pattern covers rows with no such trailing column.
const CREW_ROW_WITH_ID_RE = /^([A-Z][A-Z0-9]{0,2})\s+([A-ZÄÖÜß][A-ZÄÖÜß\-]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*?)\s+(\d\S*)\s*(.*)$/i;
const CREW_ROW_NO_ID_RE = /^([A-Z][A-Z0-9]{0,2})\s+([A-ZÄÖÜß][A-ZÄÖÜß\-]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*)$/i;

function parseCrewFromLines(lines) {
  const crew = [];
  for (const line of lines) {
    let m = line.match(CREW_ROW_WITH_ID_RE);
    if (m) {
      const [, role, name, , details] = m;
      crew.push({ role: role.trim(), name: displayName(name.trim().replace(/\s+/g, " ")), details: (details || "").trim() });
      continue;
    }
    m = line.match(CREW_ROW_NO_ID_RE);
    if (m) {
      const [, role, name] = m;
      crew.push({ role: role.trim(), name: displayName(name.trim().replace(/\s+/g, " ")), details: "" });
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

// Primary layover detection: OpenAirLog flight data, not the PDF. The most
// recent completed arrival that hasn't been followed by a later departure
// means we're still there - "if the day before ended in RMO, that's an
// overnight stay there."
function findApiLayover(allFlights) {
  const now = new Date();
  let current = null;
  let currentArr = null;
  for (const f of allFlights) {
    const arr = f.arrActualDate || f.arrSchedDate;
    if (!arr || arr > now) continue;
    if (!current || arr > currentArr) { current = f; currentArr = arr; }
  }
  if (!current) return null;
  const alreadyDeparted = allFlights.some((f) => {
    const dep = f.depActualDate || f.depSchedDate;
    return dep && dep > currentArr && dep <= now;
  });
  return alreadyDeparted ? null : { arrCode: current.arrCode, arrTime: currentArr };
}

// The PDF is only used to enrich this with a hotel name, if a matching leg
// (same arrival airport) happens to have one - not to decide whether
// there's a layover in the first place.
function findPdfHotelFor(arrCode, legs) {
  for (const leg of legs) {
    if (leg.hotel && leg.arrCode === arrCode) return leg.hotel;
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
    if (m) return `${m[1].padStart(2, "0")}:${m[2]} (lokal)`;
  }

  // Fallback: a spelled-out "Pickup"/"Abholung" mention, format unconfirmed.
  const mentionRe = /pick[- ]?up|abholung/i;
  for (const line of lines) {
    if (!mentionRe.test(line)) continue;
    const pair = line.match(/(\d{3,4})\s*\/\s*(\d{3,4})/);
    if (pair) {
      const local = pair[2].padStart(4, "0");
      return `${local.slice(0, 2)}:${local.slice(2)} (lokal)`;
    }
    const single = line.match(/\b(\d{1,2}):(\d{2})\b/);
    if (single) return `${single[1].padStart(2, "0")}:${single[2]} (lokal)`;
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

let currentLayoverKey = null; // roomKeyFor(arrCode, hotel) for the own room-number input

function renderLayover() {
  const layover = findApiLayover(state.allFlights);
  els.layoverCard.hidden = !layover;
  currentLayoverKey = null;
  if (!layover) return;

  const hotel = findPdfHotelFor(layover.arrCode, state.pdfLegs);
  currentLayoverKey = roomKeyFor(layover.arrCode, hotel);

  // On a flight day the flight card already anchors the location; the
  // "Layover" heading and city name would just repeat what's shown there,
  // so only show them on a pure rest day (no flight of the day at all).
  const isFlightDay = state.flights.length > 0;
  els.layoverTitle.hidden = isFlightDay;
  els.layoverPlace.hidden = isFlightDay;

  const city = cityForIcao(layover.arrCode);
  els.layoverPlace.textContent = city || layover.arrCode;
  els.layoverHotel.hidden = !hotel;
  els.layoverHotel.textContent = hotel || "";
  els.roomNumberInput.value = getRoomNumber(currentLayoverKey);

  const pickup = findPickupLocal(state.pdfLines);
  els.layoverPickup.hidden = !pickup;
  els.layoverPickup.textContent = pickup ? `Pickup morgen: ${pickup}` : "";

  renderLayoverCurrency(layover.arrCode);
  renderLayoverCrew(layover.arrCode, hotel);
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
  els.brandName.textContent = ownName ? formatOwnNameForDisplay(ownName) : "Pilot Dashboard";
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
// crew source - the PDF crew list is assumed to share this layover (the
// PDF has no reliable way to tell us which crew member is on which
// specific leg/hotel).
function renderLayoverCrew(arrCode, hotel) {
  const allCrew = state.crewSource === "pdf" && state.pdfCrew && state.pdfCrew.crew.length ? state.pdfCrew.crew : [];
  const ownName = getOwnName();
  const crew = allCrew.filter((m) => !isOwnName(m.name, ownName));
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
    const lines = await extractPdfLines(pdf);
    const rawText = lines.join("\n");
    const rotation = parseRotationHeader(lines);
    const crew = parseCrewFromLines(lines);
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

els.refreshBtn.addEventListener("click", loadFlights);

els.prevFlightBtn.addEventListener("click", () => {
  if (state.index > 0) { state.index--; renderFlight(); }
});
els.nextFlightBtn.addEventListener("click", () => {
  if (state.index < state.flights.length - 1) { state.index++; renderFlight(); }
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

els.ownNameInput.addEventListener("input", () => {
  setOwnName(els.ownNameInput.value);
  renderBrandName();
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

els.ownNameInput.value = getOwnName();
renderBrandName();
loadStoredPdfCrew();
renderLayover();
loadFlights();

// Keep the T-minus/T-plus countdown and the layover state current without
// a full data refresh.
setInterval(() => {
  const f = state.flights[state.index];
  if (f) renderTimerPill(f);
  renderLayover();
}, 30000);

// Passive background check only - never auto-applies new data, just flips
// the "Stand" stamp red when OpenAirLog has something newer than what's
// shown (see checkForUpdate() above for why).
setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
