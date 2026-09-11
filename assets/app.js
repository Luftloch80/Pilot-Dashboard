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
  depSched: document.getElementById("depSched"),
  depActual: document.getElementById("depActual"),
  depGate: document.getElementById("depGate"),
  arrSched: document.getElementById("arrSched"),
  arrActual: document.getElementById("arrActual"),
  arrGate: document.getElementById("arrGate"),
  aircraft: document.getElementById("aircraft"),
  registration: document.getElementById("registration"),

  crewCard: document.getElementById("crewCard"),
  crewList: document.getElementById("crewList"),
  crewEmpty: document.getElementById("crewEmpty"),

  crewPdfInput: document.getElementById("crewPdfInput"),
  crewPdfLabel: document.getElementById("crewPdfLabel"),
  crewPdfResult: document.getElementById("crewPdfResult"),

  rawToggle: document.getElementById("rawToggle"),
  rawData: document.getElementById("rawData"),

  refreshBtn: document.getElementById("refreshBtn"),
  resetKeyBtn: document.getElementById("resetKeyBtn"),
};

/** @type {{flights: any[], index: number}} */
const state = { flights: [], index: 0 };

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

function fmtTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${hh}:${mm}Z · ${dd}.${mo}.`;
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

function gateField(raw, side) {
  const nested = raw[side];
  if (nested && typeof nested === "object") {
    const v = pick(nested, ["gate", "gate_number"]);
    if (v) return v;
  }
  const prefix = side === "departure" ? "dep" : "arr";
  return pick(raw, [`${prefix}_gate`, `${prefix}Gate`, `${side}_gate`]);
}

function normalizeCrewMember(m) {
  if (typeof m === "string") return { name: m, role: "" };
  const name = pick(m, ["name", "full_name", "fullName", "display_name"]) ||
    [pick(m, ["first_name", "firstName"]), pick(m, ["last_name", "lastName"])].filter(Boolean).join(" ") ||
    "Unbekannt";
  const role = pick(m, ["role", "function", "position", "rank", "duty"]) || "";
  return { name: String(name), role: String(role) };
}

function normalizeFlight(raw) {
  const flightNumber = pick(raw, ["flight_number", "flightNumber", "flight_no", "flightNo", "number", "callsign"]) || "–";
  const depCode = airportCode(raw, "departure");
  const arrCode = airportCode(raw, "arrival");
  const depSched = timeField(raw, "departure", "scheduled");
  const depActual = timeField(raw, "departure", "actual");
  const arrSched = timeField(raw, "arrival", "scheduled");
  const arrActual = timeField(raw, "arrival", "actual");
  const depGate = gateField(raw, "departure");
  const arrGate = gateField(raw, "arrival");
  const aircraft = pick(raw, ["aircraft_type", "aircraftType", "aircraft.type", "aircraft", "type"]);
  const registration = pick(raw, ["registration", "reg", "tail_number", "tailNumber", "aircraft.registration"]);
  const status = pick(raw, ["status", "flight_status", "state"]);

  const crewRaw = pick(raw, ["crew", "crew_members", "crewMembers", "crewlist"]);
  const crew = Array.isArray(crewRaw) ? crewRaw.map(normalizeCrewMember) : [];

  return {
    raw,
    flightNumber: String(flightNumber),
    depCode, arrCode,
    depSchedDate: toDateOrNull(depSched),
    depActualDate: toDateOrNull(depActual),
    arrSchedDate: toDateOrNull(arrSched),
    arrActualDate: toDateOrNull(arrActual),
    depSchedRaw: depSched, depActualRaw: depActual,
    arrSchedRaw: arrSched, arrActualRaw: arrActual,
    depGate: depGate || "–", arrGate: arrGate || "–",
    aircraft: aircraft || "–",
    registration: registration || "–",
    status: status ? String(status) : "",
    crew,
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

  els.depSched.textContent = fmtTime(f.depSchedRaw);
  els.depActual.textContent = fmtTime(f.depActualRaw);
  els.depGate.textContent = f.depGate;

  els.arrSched.textContent = fmtTime(f.arrSchedRaw);
  els.arrActual.textContent = fmtTime(f.arrActualRaw);
  els.arrGate.textContent = f.arrGate;

  els.aircraft.textContent = f.aircraft;
  els.registration.textContent = f.registration;

  els.crewList.innerHTML = "";
  els.crewEmpty.hidden = f.crew.length > 0;
  for (const member of f.crew) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = member.name;
    const role = document.createElement("span");
    role.className = "crew-role";
    role.textContent = member.role;
    li.appendChild(name);
    li.appendChild(role);
    els.crewList.appendChild(li);
  }

  els.rawData.textContent = JSON.stringify(f.raw, null, 2);
  renderFlightNav();
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

  const from = todayISO(-2);
  const to = todayISO(10);
  const url = `${API_BASE}/flights?from=${from}&to=${to}`;

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

  const rawFlights = extractFlightsArray(json);
  if (!rawFlights.length) {
    showBanner("Keine Flüge im Zeitraum gefunden.", "warn");
    state.flights = [];
    renderFlight();
    return;
  }

  const flights = rawFlights.map(normalizeFlight).sort((a, b) => {
    const da = a.depSchedDate || a.depActualDate || new Date(0);
    const db = b.depSchedDate || b.depActualDate || new Date(0);
    return da - db;
  });

  state.flights = flights;
  state.index = pickInitialIndex(flights);
  showBanner("", "");
  renderFlight();
}

// ---------- PDF crew list (optional, supplementary) ----------

async function handleCrewPdf(file) {
  els.crewPdfLabel.textContent = file.name;
  els.crewPdfResult.hidden = false;
  els.crewPdfResult.textContent = "Lese PDF …";
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(" ") + "\n\n";
    }
    els.crewPdfResult.textContent = text.trim() || "Kein Text im PDF gefunden.";
  } catch (err) {
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

// ---------- init ----------

loadFlights();
