# ADR-0004: Lokal zuerst – läuft auf Christians PC, per Installer weitergebbar

- Status: **angenommen** (Christian, 2026-11-24: „Hauptsache es funktioniert bei
  mir lokal und ich kann es bei Bedarf einfach einem Freund verschicken" und
  „in der Cloud sollte es nicht sein, also vermutlich eine lokale Anwendung")
- Datum: 2026-11-24
- Ersetzt: Betriebsform „gehostet" aus [ADR-0001](0001-web-app-und-remote-mcp.md)
  und Abschnitte 1–2 (Betrieb, Connector) von [ADR-0003](0003-hybrid-frontend-und-chat.md)
- Unverändert gültig: eigenes Frontend, KI-Schritte iterativ im Claude-Chat über
  `forge.attach`/`forge.next`/`forge.submit`, Zerlegung in kleine Aufgaben,
  Eingriffe und Rückfragen im Frontend (ADR-0003 Abschnitte 3–4), Abo-Regeln (ADR-0002)

## Kontext

Wichtigstes Ziel ist, dass Astrolabe **auf Christians eigenem PC** läuft und er es
**bei Bedarf einfach einem Freund schicken** kann. Ein öffentlicher Dienst ist
kein Ziel. Ein gehosteter Server würde Kosten, Betrieb, Konten und OAuth bedeuten,
ohne dass es dafür einen Bedarf gibt.

## Prüfung: Funktioniert der Hybrid ohne Server?

Ja. Die Hybrid-Schleife braucht nur, dass Claude die Astrolabe-Werkzeuge
erreicht und das Frontend denselben Laufzustand sieht. Das geht lokal:

| Claude-Client | Weg zu Astrolabe | Lokal möglich? |
| --- | --- | --- |
| **Claude Desktop** | Lokaler MCP-Server als Erweiterung (`.mcpb`, Doppelklick), stdio | **Ja, Hauptweg** |
| **Claude Code** | `claude mcp add --transport http astrolabe http://127.0.0.1:<port>/mcp` | Ja |
| claude.ai im Browser / Handy-App | Nur öffentlich erreichbare Connectors | Nein (bräuchte Hosting) |

## Entscheidung

1. **Eine Desktop-App für Windows** (Electron), die alles enthält:
   - eigenes Frontend (React + Vite, Komponenten aus `packages/ui`),
   - lokalen Server auf `127.0.0.1` mit API, Live-Status und MCP-Endpunkt,
   - Calc-Service: mitgeliefertes LuaJIT + gepinntes PoB-PoE2, Worker-Pool im Hintergrund,
   - Pipeline als Zustandsmaschine im Prozess, Zustand in **SQLite** (übersteht Neustart).
2. **Claude-Anbindung:** Die App bringt eine **Claude-Desktop-Erweiterung**
   (`.mcpb`) mit. Sie ist eine dünne stdio-Brücke zum lokalen MCP-Endpunkt der App.
   Knopf „Mit Claude verbinden" in der App öffnet sie. Für Claude Code zeigt die
   App den `claude mcp add`-Befehl.
3. **Start einer Planung** wie in ADR-0003: „Mit Claude planen" im Frontend,
   Claude Desktop wird geöffnet, Startsatz mit Sitzungscode zum Kopieren,
   `forge.attach` → Schleife. Kein OAuth und kein Konto nötig: alles bleibt auf
   dem PC, der Sitzungscode wählt nur den Lauf.
4. **Weitergabe an Freunde:** Installer (`Astrolabe-Setup.exe`) über GitHub
   Releases, Auto-Update über `electron-updater`. Der Freund braucht nur
   Claude Desktop mit seinem eigenen Abo. Builds lassen sich als Datei
   (`.astrolabe.json`) und als `.build` weitergeben.
5. **Daten und Patches:** Daten-Releases (Katalog, Icons, ID-Tabellen) baut die
   Daten-Pipeline in GitHub Actions und veröffentlicht sie als Release-Dateien.
   Die App lädt neue Daten-Releases und PoB-Versionen selbst nach, ohne neuen
   Installer, und prüft gespeicherte Guides neu.
6. **Hosting bleibt möglich, ist aber kein Ziel.** Kern (`contracts`, `calc`,
   Pipeline, `ui`) bleibt vom Electron-Teil getrennt, damit später eine
   gehostete Variante (ADR-0001) ohne Umbau des Kerns möglich wäre.

## Folgen

- Keine Serverkosten, kein Betrieb, keine Konten, kein OAuth, keine DSGVO-Pflichten
  einer Website.
- Tech-Stack des Plans wird für den lokalen Betrieb vereinfacht (Plan: „Änderungen
  nur per ADR", das ist dieses ADR):

  | Plan (gehostet) | Lokal |
  | --- | --- |
  | Next.js | React + Vite in Electron |
  | Fastify-API | lokaler Fastify-Server auf `127.0.0.1` im App-Prozess |
  | Temporal | Zustandsmaschine im Prozess, persistiert in SQLite |
  | PostgreSQL + pgvector | SQLite (Wissensbasis-Suche später z. B. mit `sqlite-vec`) |
  | Redis | Cache im Speicher / SQLite |
  | S3 + CDN | Dateien im App-Datenordner, Downloads von GitHub Releases |
  | Langfuse, Sentry, OTel | lokale Logdatei; später optional |
  | Docker | entfällt für Nutzer; Docker nur in CI |

- **PoB muss unter Windows laufen.** Der Windows-CI-Lauf aus PR #2 wird damit
  wieder wichtig: LuaJIT + `lua-utf8` werden in CI für Windows gebaut und in den
  Installer gepackt.
- Planen geht nur in Claude Desktop oder Claude Code, nicht in claude.ai im Browser
  oder am Handy. Den fertigen Guide liest man in der App; Lesen am Handy wäre ein
  späterer Export (z. B. PDF/Markdown) oder die gehostete Variante.
- Ohne Code-Signing zeigt Windows beim ersten Start eine SmartScreen-Warnung
  („Weitere Informationen → Trotzdem ausführen"). Für Freunde vertretbar.
- BYOK (Modus A) bleibt möglich: Der Freund trägt in der App einen eigenen
  API-Key ein, dann arbeitet das `llm-gateway` dieselben Aufgaben lokal ab.

## Offen (Proof of Concept)

1. `.mcpb`-Erweiterung als stdio-Brücke zur laufenden App in Claude Desktop.
2. Wie viele Werkzeugaufrufe Claude Desktop pro Antwort macht (wie ADR-0003).
3. Ob Claude Desktop per Link mit vorausgefülltem Text geöffnet werden kann;
   sonst Kopieren-Knopf.
4. Größe des Installers mit PoB-Daten und LuaJIT; Kaltstart der PoB-Worker auf
   einem normalen Spiele-PC.
