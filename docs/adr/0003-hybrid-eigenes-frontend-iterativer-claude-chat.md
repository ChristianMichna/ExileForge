# ADR-0003: Hybrid – eigenes Frontend, KI-Schritte iterativ im Claude-Chat

- Status: **angenommen** (Christian, 2026-11-24)
- Datum: 2026-11-24
- Präzisiert: [ADR-0001](0001-web-app-und-remote-mcp.md), [ADR-0002](0002-claude-abo-nur-ueber-connector.md)

## Kontext

Christian will ein **eigenes Frontend** und nicht die Claude-App als Oberfläche.
Gleichzeitig soll die KI mit dem regulären Claude-Abo des jeweiligen Freundes
laufen. Ein eigenes Frontend, das selbst mit dem Abo eines Nutzers spricht, ist
nach Anthropics Regeln ohne Genehmigung nicht erlaubt. Ausdrücklicher Wunsch:
**keine Single-Shot-Prompts**, sondern ein mehrstufiger, iterativer Ablauf.

## Entscheidung

1. **Das ExileForge-Frontend ist die Oberfläche für alles:** Skill-Wahl, Vorlieben,
   Live-Fortschritt, Variantenvergleich, Tree, Items, Crafting, Guide, Export.
2. **Nur die KI-Schritte laufen im Claude-Chat des Freundes**, über den
   ExileForge-Remote-Connector. Der Chat ist der „Motor", nicht die Oberfläche.
3. **Ablauf als Zustandsmaschine auf dem Server, in kleinen Schritten:**
   - Start im Frontend mit „Mit Claude planen"; das Frontend zeigt einen
     **Sitzungscode**, den der Freund im Claude-Chat nennt.
   - Claude holt per `forge.next` jeweils **eine kleine Aufgabe** mit Kontext und
     Ausgabe-Schema (z. B. „Archetyp 2 ausarbeiten", „Gems für Stufe 4").
   - Claude liefert per `forge.submit`. Der Server prüft sofort (Schema, Katalog,
     PoB, Gates) und gibt **konkrete Fehler** zurück, bis der Schritt grün ist.
   - Rückfragen stellt Claude per `forge.ask_user`; sie erscheinen als Karte
     **im Frontend**, die Antwort landet im nächsten `forge.next`.
4. **Eingriffe im Frontend:** Variante wählen, Knoten oder Items sperren bzw.
   ablehnen, einen Schritt neu anstoßen. Eingriffe werden als Feedback in die
   nächste Aufgabe von `forge.next` eingebaut.
5. **Live-Anzeige:** Das Frontend zeigt den aktuellen Schritt, die PoB-Zahlen und
   den Tree, während Claude arbeitet.

## Folgen

- Der Remote-Connector muss aus claude.ai erreichbar sein, also läuft ExileForge
  gehostet (Web-App, ADR-0001). Kosten für einen kleinen Server bleiben.
- Werkzeuge des Connectors: `forge.start`, `forge.next`, `forge.submit`,
  `forge.ask_user`, `forge.status` plus Lese-Werkzeuge (`catalog.*`, `calc.*`).
  Die Pipeline-Stufen S0–S11 des Plans werden in viele kleine Aufgaben zerlegt.
- BYOK (Modus A) nutzt dieselbe Zustandsmaschine; dort ruft das Gateway
  `forge.next`/`forge.submit` serverseitig in der Schleife.

## Offen (Proof of Concept)

- Wie viele Werkzeugaufrufe Claude pro Antwort macht, bevor ein „weiter" nötig ist.
- Ob claude.ai einen vorausgefüllten Prompt per URL annimmt (sonst Sitzungscode
  kopieren).
- Verknüpfung Connector-Nutzer ↔ ExileForge-Konto (OAuth des eigenen Dienstes).
