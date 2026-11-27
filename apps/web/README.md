# apps/web

Das Frontend von Astrolabe (React + Vite, Komponenten aus `@astrolabe/ui`). Es läuft im Fenster der
Desktop-App (`apps/desktop`, `astrolabe://app/`) und als Vorschau im Browser mit Beispieldaten.

- Der Browser-Seite fehlt der Zugriffstoken; `/api/*` beantwortet das App-Protokoll der Desktop-Hülle
  und fügt ihn dort hinzu. Die Seite sieht den Token nie.
- `src/desktop/bridge.ts` ist eine strukturelle Kopie von `apps/desktop/src/shared/bridge.ts`.
- **Zahlen je Stufe** (`config/web/guide-stats.json`): `onlyWhenReported` zeigt eine Zeile nur, wenn das
  gespeicherte Ergebnis den Wert enthält, `hideWhenReported` blendet sie aus, wenn ein anderer Wert da ist.
  Damit zeigt ein Minion-Build den Minion-Schaden statt des eigenen DPS von 0; gerechnet wird hier nichts.
- **Verbindungsstatus** (`src/views/ClaudeConnectionStatus.tsx`): Schritt-für-Schritt neben den
  Verbindungsknöpfen. „Verbunden“ heißt nur, dass der Lauf `created` verlassen hat; nach 45 s ohne
  Verbindung nennt die Seite, was zu prüfen ist, und erklärt die Antwort „expected object, received
  string“ in einfachen Worten.
- **Erweiterung erreicht?** (`src/api/claude-status.ts`): fragt alle 3 s `GET /api/claude/status`, solange
  der Lauf `created` ist, und hört auf, sobald Claude den MCP-Endpunkt erreicht hat. Der Wert gilt seit Serverstart, nicht je Lauf.
  Jede Abfrage hat 5 s Zeit; Ablauf und Netzfehler stehen sichtbar auf der Seite, nie als „noch nicht verbunden“.
- **Plan-Seite** (`src/views/PlanWithClaude.tsx`): Planungsformular, Live-Status des Laufs und die
  Prüfung gespeicherter Guides (`GuidePatchCheckPanel`, F-19). Sie zeigt je Guide das Urteil
  (unberührt / neu rechnen / kaputt) mit Zahl entfernter und geänderter Entitäten und geänderten
  Release-Fakten, oder den Fehlercode, warum nicht geprüft werden konnte. Ist die Prüfung aus
  (`enabled: false`), steht das da statt einer leeren Liste. Während die Prüfung läuft, fragt die Seite
  nach jeder Antwort nach 3 s erneut; schlägt eine Anfrage fehl, bleibt die letzte Liste mit einem Hinweis
  und „Try again“ stehen. Die Antwort wird gegen `GuidePatchStatusView` der Verträge geprüft.
- **Guide-Seite** (`src/views/GuidePage.tsx`, F-12): Liste gespeicherter Guides und ein Guide mit Zusammenfassung, Stufen, Gear (`GuideGear.tsx`, Items mit Katalogtexten), Crafting als Ablauf (`GuideCrafting.tsx`, Zahlen mit Herkunft über `guide/measured.ts`; „uncalibrated“ und Fehler bleiben sichtbar, nie 0) und Passive Tree je Stufe (`GuideTree.tsx`) und die Zahlen je Stufe (`StageNumbers.tsx`): welche PoB-Werte gezeigt werden und in welcher Reihenfolge die Calc-Profile einer Stufe geprüft werden, steht in `config/web/guide-stats.json` (gelesen und geprüft in `guide/guide-stats.ts`; `apps/web/turbo.json` nimmt die Datei als Eingabe in den Cache-Schlüssel). Das erste vorhandene Profil zählt, auch wenn seine Rechnung fehlgeschlagen ist (dann steht der Fehler da, kein Ausweichen auf ein anderes Profil). Fehlendes Ergebnis, fehlgeschlagene Rechnung und fehlender Stat sind sichtbare Zustände, nie 0; ein Ergebnis eines anderen Daten-Release trägt „Outdated after patch“. Preise (Respec, Crafting) laufen über `guide/price.ts`. Die Stufen zeigen, was sich bei den Skills seit der Vorstufe ändert (`guide/gem-changes.ts`, über den stabilen Skill-Schlüssel), danach folgen die Textteile Playstyle, Atlas, Varianten und Troubleshooting (`GuideText.tsx`); Entitäten, die der Katalog nicht kennt, stehen als ID und sind markiert. Alles kommt von `GET /api/guides/:id/view` (`GuideView`); bei einem Guide älterer Daten gibt es keine Namen, Items und keinen Baum, sondern den Hinweis zur Revalidierung.
- **Guide-Dateien** (`src/views/GuideFile.tsx`, `src/api/guide-file.ts`, F-20): Die Guide-Liste hat „Import a guide file“ (`POST /api/guides/import`; der Server prüft die Datei gegen `GuideFile` und nennt den Grund, wenn er sie ablehnt; die Liste lädt danach neu), jeder Guide „Save as guide file“ (`GET /api/guides/:id/file`, die Datei bleibt, wie der Server sie schrieb). So kommt ein Guide samt seinen gespeicherten PoB-Ergebnissen auf einen anderen Rechner.
- **Export** (`src/views/BuildFileExport.tsx`, F-12): Ist ein Guide fertig (`guide.ready` liefert die
  `guideId`), speichert „Save as .build file“ ihn über `GET /api/guides/:id/build-file` als Datei des
  Build Planners. Was das Release nicht kennt (`omitted`), steht als Hinweis unter dem Knopf; Fehler
  des Servers erscheinen mit seinem Text, dann wird nichts gespeichert.
- Im Nur-Katalog-Modus (`calcEngine: "none"`) ersetzt ein Hinweis das Planungsformular.
