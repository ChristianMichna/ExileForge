# @exileforge/mcp-bridge

Claude-Desktop-Erweiterung (`.mcpb`) für ExileForge (ADR-0004): eine **dünne
stdio↔HTTP-Brücke** zum MCP-Endpunkt der laufenden App auf
`http://127.0.0.1:<port>/mcp`. Keine Werkzeuglogik, keine eigenen Daten; alle
Werkzeuge, Prompts und Prüfungen kommen aus `apps/server`.

- **Nur 127.0.0.1**: einstellbar ist nur der Port (`user_config.port` →
  `EXILEFORGE_PORT`, Standard 47615), nie der Host.
- **Zugriffstoken**: liest bei jeder Anfrage das Token der App
  (`%APPDATA%\ExileForge\access-token`, sonst `~/.config/exileforge/access-token`,
  überschreibbar mit `EXILEFORGE_TOKEN_FILE`) und sendet es als
  `Authorization: Bearer`. So funktioniert die Brücke auch, wenn die App erst
  nach Claude Desktop startet.
- **App läuft nicht**: Anfragen bekommen sofort den Fehler „The ExileForge app
  is not running … Start ExileForge on this computer, then try again." statt
  zu hängen.
- **Beim Freund ohne Entwicklerwerkzeuge**: Das Paket enthält eine gebündelte
  Datei (`server/index.js`, esbuild) und nutzt das in Claude Desktop
  eingebaute Node. Installation per Doppelklick auf `exileforge.mcpb`.
- Diagnose nur auf stderr (MCP-Log von Claude Desktop), stdout gehört dem
  Protokoll.

## Bauen

```bash
pnpm --filter @exileforge/mcp-bridge pack:mcpb   # → apps/mcp-bridge/dist/exileforge.mcpb
```

`manifest.json` folgt dem MCPB-Manifest v0.3 und wird beim Packen mit
`mcpb validate` geprüft. Die Werkzeugliste im Manifest ist nur Anzeige in
Claude Desktop; maßgeblich ist, was der Server bei `tools/list` meldet.

## Tests

`pnpm --filter @exileforge/mcp-bridge test`: Weiterleitung in beide
Richtungen gegen einen Fake-Server, Fehler bei nicht laufender App, Port nur
auf 127.0.0.1, Token-Header und fehlende Token-Datei. Ende zu Ende (manuell,
verbraucht Abo-Kontingent): `.mcpb` in Claude Desktop installieren, App
starten, Sitzung mit dem Code aus der App beginnen.

## Offen

- Signieren des Pakets (`mcpb sign`) und Auslieferung mit dem Installer
  (`apps/desktop`, Knopf „Mit Claude verbinden").
- Symbol (`icon`) im Stil des Design-Systems, ohne offizielle Spielgrafiken.
