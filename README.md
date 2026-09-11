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

## Bekannte Einschränkungen / offene Punkte

- **API-Schema ungetestet:** Ich hatte während der Entwicklung keinen
  Zugriff auf `openairlog.de` (Netzwerk-Egress war blockiert) und keinen
  echten API-Schlüssel. Das Feld-Mapping in `assets/app.js`
  (`normalizeFlight`, `airportCode`, `timeField`, …) probiert daher mehrere
  gängige Feldnamen durch (`departure_airport`/`dep_icao`/`origin`/…,
  verschachtelt oder flach). Über den Button „Rohdaten anzeigen“ am Ende
  der Seite lässt sich das tatsächliche JSON eines Flugs einsehen – falls
  Felder falsch oder leer angezeigt werden, bitte die Rohdaten schicken,
  dann passe ich das Mapping gezielt an.
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
- Crew aus PDF wird als reiner Extrakttext angezeigt (kein automatisches
  Parsen in Namen/Rollen), um keine falschen Namen/Rollen zu erraten.

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
