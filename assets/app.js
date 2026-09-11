"use strict";

const API_BASE = "https://openairlog.de/api/v1";
const STORAGE_KEY = "oal_api_key";

const els = {
  setupCard: document.getElementById("setupCard"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  setupError: document.getElementById("setupError"),
  settingsBtn: document.getElementById("settingsBtn"),

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

  crewCard: document.getElementById("crewCard"),
  crewSource: document.getElementById("crewSource"),
  crewList: document.getElementById("crewList"),
  crewEmpty: document.getElementById("crewEmpty"),
  crewSourceSwitchBtn: document.getElementById("crewSourceSwitchBtn"),

  crewPdfInput: document.getElementById("crewPdfInput"),
  crewPdfLabel: document.getElementById("crewPdfLabel"),
  crewPdfStatus: document.getElementById("crewPdfStatus"),
  crewPdfRawToggle: document.getElementById("crewPdfRawToggle"),
  crewPdfResult: document.getElementById("crewPdfResult"),

  rawToggle: document.getElementById("rawToggle"),
  rawData: document.getElementById("rawData"),

  refreshBtn: document.getElementById("refreshBtn"),
  resetKeyBtn: document.getElementById("resetKeyBtn"),
};

/** @type {{flights: any[], index: number, crewSource: "api"|"pdf", pdfCrew: {crew: any[], rotation: any, fileName: string}|null}} */
const state = { flights: [], index: 0, crewSource: "api", pdfCrew: null };
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

function localDateLabel(d) {
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
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

function normalizeCrewMember(m) {
  if (typeof m === "string") return { name: m, role: "" };
  const name = pick(m, ["name", "full_name", "fullName", "display_name"]) ||
    [pick(m, ["first_name", "firstName"]), pick(m, ["last_name", "lastName"])].filter(Boolean).join(" ") ||
    "Unbekannt";
  const role = pick(m, ["role", "function", "position", "rank", "duty"]) || "";
  return { name: String(name), role: String(role) };
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

  // Crew can be embedded directly in the flight object (confirmed) and/or
  // fetched separately via GET /flights/{id}/crew (crew:read scope) -
  // ensureCrewLoaded() prefers this embedded copy when non-empty.
  const crewRaw = pick(raw, ["crew", "crew_members", "crewMembers", "crewlist"]);
  const embeddedCrew = Array.isArray(crewRaw) ? crewRaw.map(normalizeCrewMember) : [];

  return {
    raw,
    id,
    flightNumber: String(flightNumber),
    depCode, arrCode,
    depSchedDate, depActualDate, arrSchedDate, arrActualDate,
    aircraft: aircraft || "–",
    registration: registration || "–",
    status: status ? String(status) : "",
    embeddedCrew,
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

// ---------- rendering ----------

function showBanner(message, kind) {
  els.statusBanner.hidden = !message;
  els.statusBanner.textContent = message || "";
  els.statusBanner.className = "status-banner" + (kind ? " " + kind : "");
}

function pickInitialIndex(flights) {
  const now = new Date();
  let best = -1;
  for (let i = 0; i < flights.length; i++) {
    const f = flights[i];
    const dep = f.depActualDate || f.depSchedDate;
    const arr = f.arrActualDate || f.arrSchedDate;
    if (dep && arr && dep <= now && now <= arr) return i; // currently in the air / on the ground for this leg
  }
  for (let i = 0; i < flights.length; i++) {
    const dep = flights[i].depActualDate || flights[i].depSchedDate;
    if (dep && dep > now) return i; // next upcoming
  }
  return flights.length ? flights.length - 1 : -1; // most recent past
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

function statusLabel(f) {
  const now = new Date();
  const dep = f.depActualDate || f.depSchedDate;
  const arr = f.arrActualDate || f.arrSchedDate;
  if (dep && arr && dep <= now && now <= arr) return { text: "Aktiv", cls: "active" };
  if (dep && dep > now) return { text: "Bevorstehend", cls: "upcoming" };
  if (f.status) return { text: f.status, cls: "" };
  return { text: "Abgeschlossen", cls: "" };
}

function renderFlight() {
  const f = state.flights[state.index];
  els.flightCard.hidden = !f;
  els.crewCard.hidden = !f;
  if (!f) return;

  els.flightNumber.textContent = f.flightNumber;
  const st = statusLabel(f);
  els.flightStatus.textContent = st.text;
  els.flightStatus.className = "status-pill" + (st.cls ? " " + st.cls : "");

  els.depCode.textContent = f.depCode;
  els.arrCode.textContent = f.arrCode;
  els.depTime.textContent = fmtTime(f.depSchedDate);
  els.arrTime.textContent = fmtTime(f.arrSchedDate);

  els.aircraft.textContent = f.aircraft;
  els.registration.textContent = f.registration;

  renderCrew(f);
  ensureCrewLoaded(f);

  els.rawData.textContent = JSON.stringify(f.raw, null, 2);
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
    renderCrewMembers(els.crewList, crew);
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
    res = await fetch(`${API_BASE}/flights/${encodeURIComponent(f.id)}/crew`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
  } catch {
    crewCache.set(f.id, { status: "error", crew: [], message: "Crew-Anfrage fehlgeschlagen (Netzwerk/CORS)." });
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
    els.setupCard.hidden = false;
    els.flightCard.hidden = true;
    els.crewCard.hidden = true;
    els.flightNav.hidden = true;
    els.refreshBtn.hidden = true;
    els.resetKeyBtn.hidden = true;
    return;
  }

  els.setupCard.hidden = true;
  els.refreshBtn.hidden = false;
  els.resetKeyBtn.hidden = false;
  showBanner("Lade Flugdaten …", "");

  // Small +/-1 day buffer (not "history"): the API's from/to are UTC dates,
  // and a flight scheduled "today" in local time can fall on the adjacent
  // UTC date depending on the device's timezone. We still only ever show
  // flights whose local calendar day is today (filtered below).
  const from = todayISO(-1);
  const to = todayISO(1);
  const url = `${API_BASE}/flights?from=${from}&to=${to}&per_page=100`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    showBanner(
      "Verbindung zu OpenAirLog fehlgeschlagen. Das kann an fehlendem Internet liegen " +
      "oder daran, dass die API keine Anfragen direkt aus dem Browser erlaubt (CORS). " +
      "Falls das dauerhaft passiert, muss OpenAirLog diese Web-App-Adresse freigeben.",
      "error"
    );
    return;
  }

  if (res.status === 401 || res.status === 403) {
    showBanner("API-Schlüssel ungültig oder abgelaufen. Bitte neu eingeben.", "error");
    els.setupCard.hidden = false;
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

  if (!flights.length) {
    let msg = `Heute (${localDateLabel(new Date())}) sind keine Flüge für dich hinterlegt.`;
    if (allFlights.length) {
      msg += ` OpenAirLog liefert für den abgefragten Zeitraum ${allFlights.length} Flug(e), aber keiner davon liegt heute – bitte Datum/Uhrzeit auf dem Gerät und in „Rohdaten anzeigen“ prüfen.`;
      els.rawData.textContent = JSON.stringify(allFlights.map((f) => f.raw), null, 2);
    }
    showBanner(msg, "");
    renderFlight();
    return;
  }

  state.index = pickInitialIndex(flights);
  showBanner("", "");
  renderFlight();
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
// followed by "NACHNAME, VORNAME" (all-caps, as used in these official
// rotation crew lists) and trailing columns. Deliberately not a fixed
// role whitelist, since role codes differ between airlines/roster
// systems. The PK-Nummer/staff-ID column (starts with a digit) is used
// as an anchor so the lazily-matched name doesn't get cut short; a
// second, looser pattern covers rows with no such trailing column.
const CREW_ROW_WITH_ID_RE = /^([A-Z][A-Z0-9]{0,2})\s+([A-ZÄÖÜß][A-ZÄÖÜß\-]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*?)\s+(\d\S*)\s*(.*)$/;
const CREW_ROW_NO_ID_RE = /^([A-Z][A-Z0-9]{0,2})\s+([A-ZÄÖÜß][A-ZÄÖÜß\-]*,\s*[A-ZÄÖÜß][A-ZÄÖÜß\- ]*)$/;

function parseCrewFromLines(lines) {
  const crew = [];
  for (const line of lines) {
    let m = line.match(CREW_ROW_WITH_ID_RE);
    if (m) {
      const [, role, name, , details] = m;
      crew.push({ role: role.trim(), name: name.trim().replace(/\s+/g, " "), details: (details || "").trim() });
      continue;
    }
    m = line.match(CREW_ROW_NO_ID_RE);
    if (m) {
      const [, role, name] = m;
      crew.push({ role: role.trim(), name: name.trim().replace(/\s+/g, " "), details: "" });
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

    els.crewPdfRawToggle.hidden = false;
    els.crewPdfRawToggle.textContent = "Rohtext anzeigen";
    els.crewPdfResult.textContent = rawText || "Kein Text im PDF gefunden.";

    if (crew.length) {
      // Overwrites the OpenAirLog crew above; the switch button there lets
      // the pilot go back to the OpenAirLog data if this wasn't wanted.
      state.pdfCrew = { crew, rotation, fileName: file.name };
      state.crewSource = "pdf";
      els.crewPdfStatus.hidden = false;
      els.crewPdfStatus.textContent =
        `${crew.length} Crewmitglied(er) erkannt und oben als Crew übernommen.` +
        (rotation ? ` (Umlauf ${rotation.rotation})` : "");
      els.crewPdfResult.hidden = true; // available via "Rohtext anzeigen"
    } else {
      // Couldn't recognize crew rows in this layout: nothing to overwrite
      // with, show the raw text directly instead of hiding it behind a
      // toggle with nothing else to show.
      els.crewPdfResult.hidden = false;
      els.crewPdfStatus.hidden = false;
      els.crewPdfStatus.textContent = "Konnte keine Crew-Zeilen in dieser PDF erkennen, siehe Rohtext unten.";
    }

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
  els.setupCard.hidden = !els.setupCard.hidden;
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

els.rawToggle.addEventListener("click", () => {
  els.rawData.hidden = !els.rawData.hidden;
  els.rawToggle.textContent = els.rawData.hidden ? "Rohdaten anzeigen" : "Rohdaten ausblenden";
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
  const f = state.flights[state.index];
  if (f) renderCrew(f);
});

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ---------- init ----------

loadFlights();
