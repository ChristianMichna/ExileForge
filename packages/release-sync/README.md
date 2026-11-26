# @astrolabe/release-sync

Holt neue Daten-Releases (F-01) von GitHub Releases in den Ordner `releasesDir` der App, aus dem
`guide_revalidate` (F-19) und der Katalog-Start lesen. Kein Electron; die Desktop-Hülle ruft es auf.

- `listRemoteReleases`: Releases des Repos (`data-poe2-<Version>-r<n>`, Asset `catalog-….tar.gz` + `.sha256`),
  neueste zuerst. Entwürfe, fremde Tags und Downloads von anderen Adressen als `github.com/<repo>/releases/download/`
  werden übersprungen. Schlägt die Anfrage fehl, ist das ein Fehler, nie eine leere Liste.
- `pickNewRelease`: das neueste Release, das neuer ist als alles Installierte; Pre-Releases nur mit `includePrereleases`.
- `installRelease`: Download mit Größengrenze, SHA-256 gegen die veröffentlichte Prüfsumme, Entpacken nur von
  Dateien und Ordnern (keine Links), Manifest gegen den Vertrag, Release-ID und Shard-Hashes prüfen, dann ein
  atomares `rename` nach `<releasesDir>/<Release-ID>`. Ein installiertes Release wird nie überschrieben;
  bei einem Fehler bleibt nichts zurück.
- `installedReleaseIds`, `removeLeftovers`: Bestand lesen und Reste unterbrochener Installationen entfernen.

Grenzen (`maxDownloadBytes`, `maxUnpackedBytes`), Repo und User-Agent kommen vom Aufrufer (Konfig), nicht aus dem Code.
Der Netzzugriff wird als `fetch` übergeben, damit Tests ohne Netz laufen.

Sicherheit: Downloads nur von `https://github.com/<repo>/releases/download/…`, Weiterleitungen nur auf https und
Hosts aus der Konfiguration (`allowedRedirectHosts`). Die Prüfsumme kommt aus derselben Quelle wie das Archiv und
schützt deshalb vor beschädigten, nicht vor manipulierten Downloads; eine Signatur wäre ein eigenes Ticket.
Beim Entpacken zählen `maxUnpackedBytes`, `maxEntries` und `maxDecompressionRatio` schon vor dem Schreiben.
`removeLeftovers(dir, minAgeMs)` löscht nur Reste, die älter sind als `minAgeMs`. Die Release-Liste liest nur die
erste Seite (100 Einträge) der GitHub-API.
`removeLeftovers` richtet sich nach dem Änderungszeitpunkt des Ordners; `minAgeMs` sollte deshalb deutlich länger sein
als die längste Installation (Stunden). `allowedRedirectHosts` wird für jede Antwort geprüft, `github.com` gehört also
in die Liste; das übergebene `fetch` muss `response.url` setzen (Node-`fetch` und Electron-`net.fetch` tun das).
