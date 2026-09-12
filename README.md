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
4. Angezeigt werden **nur Flüge des heutigen Tages** (lokales Gerätedatum,
   keine Historie). Gibt es an dem Tag laut OpenAirLog keinen Flug, bleibt
   die Flugkarte einfach leer/ausgeblendet – ohne Hinweistext (z. B. wenn
   gerade nur ein Layover ansteht, siehe Punkt 6). Gibt es mehrere Flüge
   heute, lässt sich mit den Pfeilen oben zwischen ihnen blättern;
   automatisch ausgewählt ist der aktuell aktive bzw. der nächste
   anstehende Flug des Tages.
5. Crewliste als PDF liegt in den **Settings** (Zahnrad-Icon oben rechts,
   zusammen mit dem API-Schlüssel – sonst enthalten die Settings nichts
   weiteres) und ist optional. Werden darin Crew-Zeilen erkannt,
   **überschreibt sie automatisch die Crew-Anzeige** (statt sie nur zu
   ergänzen) – z. B. wenn die offizielle Umlaufcrewliste aktueller ist als
   OpenAirLog. Über den Button unter der Crew-Liste lässt sich jederzeit
   zurück zur OpenAirLog-Crew wechseln (und wieder zurück zur PDF-Crew).
   Das PDF wird nur lokal im Browser gelesen (per pdf.js), nicht
   hochgeladen. Werden keine Crew-Zeilen erkannt, wird nichts überschrieben
   und stattdessen der extrahierte Rohtext angezeigt.
6. **Übernachtung/Layover:** Wird **aus OpenAirLog erkannt**, nicht aus der
   PDF: Landet der letzte Flug irgendwann in der Vergangenheit an einem Ort
   und ist seitdem kein weiterer Abflug erfolgt, gilt das als aktueller
   Layover dort ("wenn der Tag davor in RMO endet, ist das eine
   Übernachtung dort") – dafür wird `/flights` intern bis zu 7 Tage zurück
   abgefragt (angezeigt wird weiterhin nur der heutige Flug). Die Karte
   zeigt den Flughafencode oben im Dashboard, dazu ein Eingabefeld für die
   Zimmernummer (pro Ort+Hotel lokal gespeichert, übersteht einen Refresh).
   Ist zusätzlich eine passende Umlaufcrewliste als PDF hochgeladen (gleicher
   Ankunftsort), wird deren Hotelname ergänzt – die PDF liefert hier nur
   diese Zusatzinfo, nicht die Layover-Erkennung selbst. Ein
   „Pickup“-Hinweis für den nächsten Tag wird nur angezeigt, wenn die
   PDF-Zeilen ein Wort wie „Pickup“/„Abholung“ enthalten – das Format ist
   nicht bekannt/bestätigt, daher Best-Effort-Erkennung einer Uhrzeit
   darin, sonst wird die gefundene Zeile unverändert gezeigt.

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

## Bestätigtes `/flights`-Schema

Gegen eine echte API-Antwort verifiziert. Ein Eintrag ist ein Objekt mit
u. a.:

```jsonc
{
  "id": 2703415,
  "date": "2026-09-11",              // Datum, separat von den Uhrzeiten unten
  "flight_number": "LH1556",         // null bei Nicht-Flug-Einträgen (Dienste) -> werden ignoriert
  "duty_code": null,                 // z. B. "ORTSTAG" bei Diensten ohne Flug
  "departure": "EDDF",               // ICAO, flacher String
  "arrival": "LUKK",
  "scheduled_off_block": "18:00:00", // nur Uhrzeit (UTC), kein Datum -> mit "date" kombiniert
  "scheduled_on_block": "20:20:00",
  "off_block": null, "on_block": null,     // Ist-Zeiten, gleiches Format
  "takeoff": null, "landing": null,
  "aircraft_type": "A319",
  "aircraft_registration": "D-AILU",
  "crew": [ { "name": "Droste, Alexander", "role": "CP", "is_self": false }, ... ]
}
```

Wichtige Konsequenzen im Code (`assets/app.js`):

- **Nur Flüge, keine Dienste:** Einträge ohne `flight_number` (z. B.
  `duty_code: "ORTSTAG"`) werden vor jeder weiteren Verarbeitung
  herausgefiltert (`isRealFlightEntry`).
- **Zeiten = Datum + separate Uhrzeit:** `scheduled_off_block` &Co. sind
  reine `"HH:MM:SS"`-Strings ohne Datum und werden mit `date` zu einem
  UTC-Zeitstempel kombiniert (`combineDateAndTime`); bei Ankunft nach
  Mitternacht wird automatisch ein Tag addiert (Über-Nacht-Flüge).
- **Crew ist eingebettet:** `crew` liegt direkt im Flug-Objekt vor: Die App
  nutzt das zuerst und ruft `/flights/{id}/crew` nur auf, wenn kein
  eingebettetes Crew-Array vorhanden ist.

Für andere/künftige Antwortformen bleibt zusätzlich ein flexibler
Fallback-Parser aktiv (`airportCode`, `timeField`, `gateField` probieren
weitere gängige Feldnamen-Varianten durch, verschachtelt oder flach).
Über „Rohdaten anzeigen“ am Ende der Seite lässt sich das tatsächliche
Flug-JSON jederzeit einsehen.
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
