# ADR-0002: Claude-Abo nur über MCP-Connector, Pipeline für beide KI-Wege gleich

- Status: angenommen (folgt aus Projektplan und Christians Vorgaben)
- Datum: 2026-11-24

## Kontext

Der Projektplan sieht vier KI-Zugangswege vor: A BYOK, B Remote-MCP (Abo),
C lokal mit `claude -p`, D Betreiber-Key. Christians Vorgabe: ExileForge muss mit
einem regulären Claude-Abo laufen.

## Entscheidung

- **Modus B ist der Hauptweg für Freunde.** Jeder nutzt sein eigenes Claude-Abo
  in Anthropics Clients.
- **Modus A** (BYOK über `llm-gateway`) wird gleichwertig gebaut, ist aber kein
  Muss für Freunde.
- **Modus C** nur für Christians eigenen Gebrauch, nicht für Freunde verteilt,
  solange die Bedingungen für „Claude Code in Produkten" nicht geprüft sind.
- **Modus D** bleibt aus.
- Die Build-Pipeline (S0–S11) ist eine **Zustandsmaschine bei ExileForge**. Jede
  LLM-Stufe wird in kleine Aufgaben zerlegt und entweder vom Gateway (A) ausgeführt
  oder dem Claude-Client über `forge.next` / `forge.submit` (B) gegeben
  ([ADR-0003](0003-hybrid-eigenes-frontend-iterativer-claude-chat.md)). Schema-Validierung,
  Gates G1–G8, Rechnungen und Speicherung laufen in beiden Fällen gleich.

## Folgen

- Kein „Mit Claude anmelden" auf der Website, keine Abo-Token auf dem Server.
- Die Abo-Limits des Freundes gelten. Werkzeuge rechnen deshalb so viel wie
  möglich deterministisch (Optimierer, `calc.evalBatch`), damit Claude nur
  Entscheidungen trifft und die vielen kleinen Aufgaben wenig Kontingent kosten.
- Prompts in `packages/agents/prompts` dienen beiden Wegen: als Systemprompt im
  Gateway und als Aufgabenbeschreibung in `forge.submit`-Antworten bzw. als
  MCP-Prompt.
