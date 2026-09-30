// Copy this file to assets/local-config.js (NOT committed to git - see
// .gitignore) and fill in your own values there. On first load, any
// non-empty value here gets written into this browser's own Settings
// (localStorage) ONCE, only if that setting isn't already set - it never
// overwrites a value you entered or cleared yourself in the app. This is
// meant for a self-hosted deployment (e.g. a Raspberry Pi) so a fresh
// device doesn't need the roster URL/API key typed in by hand, without
// ever putting real keys into this (public) repository.
window.LOCAL_CONFIG = {
  rosterUrl: "",    // MyTime .ics roster feed URL
  fr24Key: "",      // Flightradar24 API key
  corsProxyKey: "", // corsproxy.io API key, only if your roster fetch needs one
  ownName: "",      // your own name as it appears in the crew PDF, "Nachname, Vorname"
};
