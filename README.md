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
   Repo. **Kein automatisches Nachladen:** Von OpenAirLog geholt werden die
   Daten (Flüge, eingebettete Crew) nur beim ersten Öffnen der Seite und
   bei jedem Tap auf das ↻-Icon oben – bewusst kein Hintergrund-Polling.
   Der 30-Sekunden-Timer im Hintergrund aktualisiert nur den Countdown und
   den Layover-Status aus den bereits geladenen Daten, ruft OpenAirLog
   aber nicht erneut auf. Ändert sich etwas bei OpenAirLog (z. B. ein neuer
   P1), während die Seite schon offen ist, zeigt das ↻-Icon das also erst
   nach einem manuellen Tap – der Fetch nutzt zudem `cache: "no-store"`,
   damit dabei garantiert der aktuelle Stand geholt wird und nicht eine vom
   Browser zwischengespeicherte Antwort. Klein neben dem ↻-Icon steht dafür
   „Stand: HH:MMZ“ – das ist `updated_at` des gerade angezeigten Flugs aus
   OpenAirLog selbst (wann der Datensatz dort zuletzt geändert wurde, z. B.
   durch einen Crew-Tausch), nicht wann die App zuletzt geladen hat. So
   lässt sich auf einen Blick einschätzen, ob es sich lohnt, nochmal auf
   ↻ zu tippen.
3. Optional: „Zum Home-Bildschirm“ in Safari, damit die App wie eine
   native App startet (Statusleiste, eigenes Icon).
4. Angezeigt werden **nur Flüge des heutigen Tages** (lokales Gerätedatum,
   keine Historie). Gibt es an dem Tag laut OpenAirLog keinen Flug, bleibt
   die Flugkarte einfach leer/ausgeblendet – ohne Hinweistext (z. B. wenn
   gerade nur ein Layover ansteht, siehe Punkt 6). Gibt es mehrere Flüge
   heute, lässt sich mit den Pfeilen oben zwischen ihnen blättern;
   automatisch ausgewählt ist der aktuell aktive Flug. Ist keiner aktiv,
   bleibt bei mehreren Flügen am Tag der zuletzt abgeschlossene Flug
   sichtbar, bis **90 Minuten vor dem Abflug** des nächsten Flugs – erst
   dann wechselt die App automatisch dorthin (beim allerersten Flug des
   Tages wird stattdessen sofort dieser gezeigt, auch wenn er noch weiter
   als 90 Minuten entfernt ist). Statt eines Status-Textes zeigt die Karte
   einen Live-Countdown zur geplanten Abflugzeit (grün „-N min“ davor, rot
   „+N min“ danach) – außer bei einem **Deadhead-Flug** (`crew_position`,
   `duty_code` oder `remarks` = `"DH"` bei OpenAirLog), dann steht dort
   stattdessen ein „DH“-Badge. Zwischen Flugzeugtyp und Kennzeichen sitzt
   mittig ein kleines **Airline-Badge**: der zweistellige IATA-Code aus der
   Flugnummer (z. B. `LH` bei `LH1556`), farblich an die Airline angelehnt
   – über eine lokale Tabelle `AIRLINE_BY_PREFIX` in `assets/app.js`
   (deckt die Lufthansa-Group-Carrier ab, die auf einem Deadhead realistisch
   vorkommen: LH, LX, OS, SN, EW, 4Y). Bewusst **kein echtes Logo-Bild**,
   um keine markenrechtlich geschützten Logo-Dateien ins Repo aufzunehmen –
   bei einem unbekannten Code fällt das Badge auf die App-eigene Akzentfarbe
   zurück und zeigt trotzdem den rohen Code. **Kein ATC-Callsign:** ein
   früherer Versuch, das Funk-Callsign als ICAO-Code + Ziffern der
   Flugnummer zu berechnen (z. B. „LH1557“ → „DLH1557“), stimmte zufällig
   bei diesem einen Flug, ist aber keine echte Regel – laut Pilot nutzt
   z. B. „LH1386“ tatsächlich „DLH8KF“, ein zugewiesenes Callsign ganz ohne
   Bezug zur Flugnummer. Da OpenAirLog auch kein Callsign-Feld liefert,
   gibt es dafür keine zuverlässige Quelle – die App zeigt deshalb bewusst
   gar kein (potenziell falsches) Callsign an.
5. Crewliste als PDF liegt in den **Settings** (Zahnrad-Icon oben rechts,
   zusammen mit dem API-Schlüssel – sonst enthalten die Settings nichts
   weiteres) und ist optional. Werden darin Crew-Zeilen erkannt,
   **wird die Crew-Anzeige automatisch auf die PDF umgestellt** (statt sie
   nur zu ergänzen) – z. B. weil die PDF Vor- **und** Nachnamen ausschreibt,
   während OpenAirLog Kolleg:innen teils anonymisiert als „H., Nicolas“
   liefert – **aber nur, wenn mindestens ein Vorname mit der
   OpenAirLog-Crew übereinstimmt** (Vergleich per Vorname, sonst bliebe
   z. B. eine PDF von einem ganz anderen Umlauf unbemerkt aktiv). Stimmt
   kein einziger Name überein, bleibt die OpenAirLog-Crew aktiv (vermutlich
   falsche/alte PDF) – ein Hinweis erklärt das, manuell lässt sich trotzdem
   zur PDF-Crew wechseln. **Die PDF ist dabei kein starres Abbild:** Pro
   Rolle wird verglichen, ob der Vorname aus OpenAirLog noch zu einem
   PDF-Eintrag mit derselben Rolle passt – wenn ja, wird der schönere
   PDF-Name (mit Nachnamen) gezeigt; hat sich die Rolle seit dem
   PDF-Zeitpunkt auf jemand komplett anderen geändert (z. B. ein kurzfristig
   getauschter P1), erscheint stattdessen automatisch der aktuelle
   OpenAirLog-Name für genau diesen einen Eintrag, alle anderen Rollen
   bleiben mit dem hübscheren PDF-Namen. So ist die PDF-Crew nie "eingefroren"
   auf einen veralteten Stand, sondern immer live mit OpenAirLog abgeglichen.
   Über den Button unter der Crew-Liste lässt sich jederzeit zurück zur
   OpenAirLog-Crew wechseln (und wieder zurück zur PDF-Crew). Das PDF wird
   nur lokal im Browser gelesen (per pdf.js), nicht hochgeladen. Werden
   keine Crew-Zeilen erkannt, wird
   nichts überschrieben und stattdessen der extrahierte Rohtext angezeigt.
6. **Übernachtung/Layover:** Wird **aus OpenAirLog erkannt**, nicht aus der
   PDF: Landet der letzte Flug irgendwann in der Vergangenheit an einem Ort
   und ist seitdem kein weiterer Abflug erfolgt, gilt das als aktueller
   Layover dort ("wenn der Tag davor in RMO endet, ist das eine
   Übernachtung dort") – dafür wird `/flights` intern bis zu 7 Tage zurück
   abgefragt (angezeigt wird weiterhin nur der heutige Flug). Die Karte
   zeigt groß nur den Ort – über eine lokale Zuordnungstabelle `ICAO_CITY`
   in `assets/app.js` den Städtenamen zum ICAO-Flughafencode, den
   OpenAirLog liefert (z. B. `LUKK` → „Chișinău“; nicht erschöpfend, deckt
   größere europäische und internationale Flughäfen ab). Ist der Code
   darin nicht bekannt, wird ersatzweise der rohe Code angezeigt; der Code
   selbst steht sonst nirgends mehr auf der Karte. **An einem Flugtag**
   (mindestens ein Flug für heute vorhanden, also die Flugkarte zeigt
   etwas) blendet die Layover-Karte die Überschrift „Layover“ und den
   großen Städtenamen komplett aus – die Flugkarte nennt den Zielort ja
   bereits, das wäre doppelt. An einem reinen Ruhetag ohne Flug (nur
   Übernachtung, keine Flugkarte sichtbar) bleiben Überschrift und
   Städtename dagegen wie gewohnt sichtbar, da sie dort die einzige
   Ortsangabe sind. Direkt sichtbar bleiben in beiden Fällen Hotelname und
   Pickup-Hinweis; Umrechner und Zimmernummern
   liegen dahinter in **zwei getrennten, standardmäßig zugeklappten
   Aufklappern** (native `<details>`/`<summary>`, ein Tap öffnet/schließt
   jeweils nur den einen) – auf einem Flugtag stehen so erst Flugdaten,
   dann die Crew-Karte, dann die Layover-Karte mit den beiden geschlossenen
   Aufklappern, ohne dass Zimmer/Währung den Blick aufs Wesentliche
   verstellen; gebraucht werden sie ja ohnehin erst am Layover-Ort selbst.
   Der erste Aufklapper „Umrechnung (…)“ erscheint nur in Ländern ohne
   Euro: links ein Eingabefeld für einen Betrag in der Landeswährung,
   rechts live daneben der entsprechende Euro-Betrag (bei jeder Eingabe
   direkt neu berechnet, kein Button nötig) – über eine lokale
   Zuordnungstabelle `CURRENCY_BY_ICAO` in `assets/app.js` vom ICAO-Code
   zur ISO-Währung (deckt gängige Layover-Ziele außerhalb der Eurozone ab,
   z. B. `LUKK` → `MDL`); für Eurozone-Ziele oder unbekannte Codes bleibt
   dieser Aufklapper ganz ausgeblendet. Der Kurs wird bei Bedarf live von
   `open.er-api.com` (kostenlos, kein API-Key) geladen und für 6 Stunden im
   Speicher gecacht; ist der Dienst nicht erreichbar, greift eine statische
   Näherungstabelle (`APPROX_EUR_RATES`) mit sichtbarem Hinweis „Ungefährer
   Kurs (keine Live-Kursdaten verfügbar, ggf. veraltet).“ darunter. Das
   Eingabefeld wird nur beim Wechsel auf eine andere Landeswährung
   zurückgesetzt, nicht bei jedem automatischen Neuladen der Daten. Der
   zweite Aufklapper „Zimmernummern“ ist immer vorhanden und enthält ein
   Eingabefeld für die eigene Zimmernummer (pro Ort+Hotel lokal
   gespeichert, übersteht einen Refresh). Ist zusätzlich eine passende
   Umlaufcrewliste als PDF hochgeladen (gleicher Ankunftsort), wird deren
   Hotelname oben auf der Layover-Karte ergänzt – die PDF liefert hier nur
   diese Zusatzinfo, nicht die Layover-Erkennung selbst. Wurde ein PDF
   hochgeladen **und** als Crew-Quelle akzeptiert (s. o., also mit
   Namensüberschneidung zu OpenAirLog), erscheint die daraus erkannte Crew
   zusätzlich in diesem selben Aufklapper unter der eigenen Zimmernummer,
   jeweils mit eigenem Zimmernummer-Feld (ebenfalls lokal gespeichert) –
   vereinfachend wird angenommen, dass die komplette PDF-Crew im selben
   Hotel wohnt, da sich eine zuverlässige Pro-Flugabschnitt-Zuordnung aus
   der PDF nicht extrahieren lässt. Die eigene Person taucht in dieser
   Crew-Liste nicht auf: In den Settings lässt sich unter „Eigener Name“
   der eigene Name (wie er in der Crewliste steht, also „Nachname,
   Vorname“) hinterlegen, der dann herausgefiltert wird – für die eigene
   Zimmernummer gibt es ja bereits das Feld direkt darüber. Derselbe Name
   ersetzt außerdem den Schriftzug „Pilot Dashboard“ oben links, dort aber
   in natürlicher Reihenfolge als „Vorname Nachname“ (`formatOwnNameForDisplay()`
   in `assets/app.js`); ist kein Name hinterlegt, bleibt es bei „Pilot
   Dashboard“. Ein „Pickup“-Hinweis für den nächsten Tag wird
   angezeigt (außerhalb der Aufklapper, direkt unter Ort/Hotel), wenn eine
   PDF-Zeile die Abkürzung „PU 4:20“ (bestätigtes Format aus echten
   Rosters) oder ersatzweise ein Wort wie „Pickup“/„Abholung“ enthält;
   im zweiten Fall ist das genaue Zeit-Format nicht bekannt/bestätigt,
   daher nur Best-Effort-Erkennung einer Uhrzeit darin, sonst wird die
   gefundene Zeile unverändert gezeigt. Über die OpenAirLog-API/den
   Connector ist keine Pickup-Zeit verfügbar (`remarks`/`duty_code` sind
   dort leer) – wie Umlaufnummer und Hotelname bleibt das PDF-only.

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

**Cache-Busting:** `index.html` bindet `assets/app.js` und
`assets/style.css` mit einem `?v=N`-Query-Parameter ein. iOS Safari
(besonders als „Zum Home-Bildschirm“ hinzugefügte App) cacht diese Dateien
sonst hartnäckig und zeigt nach einem Deploy weiter die alte Version, auch
wenn `index.html` selbst schon aktuell ist. Bei jeder inhaltlichen Änderung
an `app.js` oder `style.css` muss deshalb `N` in `index.html` erhöht
werden, sonst kommt das Update auf den Geräten nicht an.
