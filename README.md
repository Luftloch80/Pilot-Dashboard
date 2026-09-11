# Pilot Dashboard

Statische Web-App für iPhone/Safari: zeigt Abflug, Ankunft und Crew des
aktuellen Flugs, geladen aus der OpenAirLog-REST-API. Kein Server, kein
Build-Schritt – einfach die Dateien hosten (z. B. GitHub Pages, Netlify,
Vercel als statisches Verzeichnis).

## Nutzung

1. Seite auf dem iPhone in Safari öffnen.
2. Beim ersten Start nach dem OpenAirLog-API-Schlüssel fragen lassen und
   eingeben. Der Schlüssel wird **nur lokal im Browser** (`localStorage`)
   gespeichert und bei jeder Anfrage direkt im `Authorization`-Header an
   `https://openairlog.de/api/v1` gesendet – er landet nie im Code oder
   Repo.
3. Optional: „Zum Home-Bildschirm“ in Safari, damit die App wie eine
   native App startet (Statusleiste, eigenes Icon).
4. Mit den Pfeilen oben lässt sich zwischen den geladenen Flügen
   (heute ± einige Tage) blättern; automatisch ausgewählt ist der aktuell
   aktive bzw. der nächste anstehende Flug.
5. Crewliste als PDF ist optional und ergänzt die Crew-Daten aus
   OpenAirLog (z. B. für ein separates Briefing). Das PDF wird nur lokal
   im Browser gelesen (per pdf.js), nicht hochgeladen.

## API-Endpunkte

Verwendet werden aktuell:

| Endpunkt | Scope | Zweck in der App |
|---|---|---|
| `GET /flights` | `flights:read` | Flugliste (`from`, `to`, `per_page`) |
| `GET /flights/{id}/crew` | `crew:read` | Crew des ausgewählten Flugs (separater Call, sobald ein Flug ausgewählt ist) |

Der API-Schlüssel muss also mindestens die Scopes `flights:read` und
`crew:read` haben. Fehlt `crew:read`, zeigt die App das explizit an
(„Keine Berechtigung für Crew-Daten“), statt einfach nur leer zu bleiben.

Nicht genutzt (aber von OpenAirLog verfügbar, potenzielle Erweiterungen):
`GET /profile`, `GET /landings`, `GET /statistics`, `GET /documents`,
`GET /documents/{id}`, `GET /documents/{id}/download`.

## Bekannte Einschränkungen / offene Punkte

- **Flug-Feldnamen ungetestet:** Ich hatte während der Entwicklung keinen
  Netzwerkzugriff auf `openairlog.de` (Egress blockiert) und keinen echten
  API-Schlüssel. Für `/flights` selbst ist nur bekannt, dass es die Filter
  `from`, `to`, `updated_since`, `flight_number`, `airport`,
  `aircraft_type`, `per_page` gibt – die genauen Feldnamen im
  JSON-Objekt eines Flugs (Abflug-/Ankunftsfelder, Zeiten, Gate, …) nicht.
  Das Mapping in `assets/app.js` (`normalizeFlight`, `airportCode`,
  `timeField`, …) probiert daher mehrere gängige Varianten durch
  (`departure_airport`/`dep_icao`/`origin`/…, verschachtelt oder flach).
  Für `/flights/{id}/crew` wird sowohl eine rohe Liste als auch
  `{ data: [...] }`/`{ crew: [...] }` unterstützt, Feldnamen pro
  Crew-Mitglied wie `name`/`full_name` und `role`/`function`/`position`.
  Über „Rohdaten anzeigen“ am Ende der Seite lässt sich das tatsächliche
  Flug-JSON einsehen – falls Felder falsch oder leer angezeigt werden,
  bitte schicken, dann passe ich das Mapping gezielt an.
- **CORS:** Ob `openairlog.de` Browser-Anfragen von einer fremden
  Origin (deiner gehosteten URL) per CORS erlaubt, ist unbekannt. Schlägt
  das Laden mit einem Netzwerkfehler fehl (Banner „Verbindung zu
  OpenAirLog fehlgeschlagen …“), ist das der wahrscheinlichste Grund.
  Lösung dann entweder: OpenAirLog bittet, die gehostete Origin für CORS
  freizugeben, oder ein kleiner Proxy (z. B. eine Vercel/Netlify
  Serverless Function) wird vorgeschaltet, die den API-Key serverseitig
  hält.
- **Zeiten in UTC/Zulu:** Alle Zeiten werden bewusst in UTC (`HH:mmZ`)
  angezeigt, wie in der Luftfahrt üblich – nicht in der lokalen
  Zeitzone des iPhones.
- **Crew-PDF-Parsing:** Die App erkennt Crew-Zeilen im Stil einer
  „Umlaufcrewliste“ (Rollen-Kürzel wie `CP`/`FO`/`P1`/`FB` gefolgt von
  `NACHNAME, VORNAME` in Großbuchstaben, wie z. B. bei Lufthansa-Group-
  Rostern üblich) und zeigt sie als strukturierte Liste mit Rolle an –
  verifiziert gegen eine echte Umlaufcrewliste. Erkennt die App bei einem
  anderen PDF-Layout keine Zeilen, wird stattdessen automatisch der
  extrahierte Rohtext angezeigt (auch bei erkannter Crew über „Rohtext
  anzeigen“ einsehbar), damit nichts verloren geht.

## Deployment

Beliebiger statischer Hoster reicht, z. B.:

```bash
# Vercel
vercel deploy --prod

# Netlify
netlify deploy --prod

# oder GitHub Pages: Repo-Settings → Pages → Branch/Root
```

Keine Umgebungsvariablen nötig – der API-Schlüssel wird ausschließlich
vom Nutzer im Browser eingegeben und dort gespeichert.
