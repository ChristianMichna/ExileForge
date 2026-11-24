# ADR-0001: Gehostete Web-App mit Remote-MCP statt Desktop-App

- Status: **zurückgestellt** durch [ADR-0004](0004-lokal-first.md) (lokal zuerst). Bleibt als mögliche spätere gehostete Variante.
- Datum: 2026-11-24
- Ersetzt: Entscheidung „Electron-App + `.mcpb`-Erweiterung" aus Architektur v0.2

## Kontext

Vorgaben: Web- oder Desktop-App; KI muss mit regulärem Claude-Abo laufen; für
alle Freunde leicht zugänglich; jede Zahl aus Path of Building. Der
[Projektplan](../projektplan.md) sieht eine gehostete Web-Anwendung vor.

Anthropic erlaubt Drittanbietern keinen claude.ai-Login und kein Durchleiten von
Abo-Zugangsdaten. Erlaubt ist, dass Nutzer in Anthropics eigenen Clients
(claude.ai, Claude Desktop, Claude Code, Handy-App) MCP-Server von Dritten als
Connector verbinden.

## Entscheidung

1. ExileForge ist eine **Web-App** (Next.js) mit API und Calc-Service auf einem
   Server in der EU, wie im Projektplan beschrieben.
2. Die Abo-Nutzung läuft über einen **Remote-MCP-Server** (Streamable HTTP), den
   jeder Freund einmal als Connector in claude.ai einträgt. Das eigene Frontend
   ist die Oberfläche; im Chat laufen nur die KI-Schritte, iterativ und in kleinen
   Aufgaben (Details in ADR-0003).
3. Der Server ruft Claude **nie** mit Abo-Zugangsdaten auf. Serverseitige
   KI-Läufe gibt es nur mit einem API-Key, den der Nutzer selbst hinterlegt (BYOK).

## Folgen

- Freunde brauchen nur einen Browser und ein Claude-Konto. Keine Installation,
  kein SmartScreen, kein Windows-Zwang, Guide auf dem Handy lesbar.
- Christian betreibt und bezahlt einen Server (Schätzung 10–25 € im Monat für
  einen kleinen VPS, abhängig vom Speicherbedarf der PoB-Worker; in Phase 0 messen).
- Die App kann `.build`-Dateien nicht selbst in den Spielordner schreiben; der
  Nutzer lädt sie herunter und legt sie ab (so steht es auch im Plan).
- Electron, `.mcpb`, electron-updater, NSIS und lokales SQLite entfallen.
- Der Windows-CI-Lauf aus PR #2 wird für die Web-App nicht gebraucht.

## Verworfene Alternative

**Desktop-App (Electron) + Claude-Desktop-Erweiterung** (Architektur v0.2): kein
Server nötig, PoB rechnet lokal. Dafür Installer und Erweiterung je Freund,
Windows-only, Builds als Dateien statt Links, kein Lesen am Handy. Bleibt als
„lokaler Modus" (F-21) eine spätere Option.
