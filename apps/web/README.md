# apps/web

Das Frontend von Astrolabe (React + Vite, Komponenten aus `@astrolabe/ui`). Es läuft im Fenster der
Desktop-App (`apps/desktop`, `astrolabe://app/`) und als Vorschau im Browser mit Beispieldaten.

- Der Browser-Seite fehlt der Zugriffstoken; `/api/*` beantwortet das App-Protokoll der Desktop-Hülle
  und fügt ihn dort hinzu. Die Seite sieht den Token nie.
- `src/desktop/bridge.ts` ist eine strukturelle Kopie von `apps/desktop/src/shared/bridge.ts`.
- **Plan-Seite** (`src/views/PlanWithClaude.tsx`): Planungsformular, Live-Status des Laufs und die
  Prüfung gespeicherter Guides (`GuidePatchCheckPanel`, F-19). Sie zeigt je Guide das Urteil
  (unberührt / neu rechnen / kaputt) mit Zahl entfernter und geänderter Entitäten und geänderten
  Release-Fakten, oder den Fehlercode, warum nicht geprüft werden konnte. Ist die Prüfung aus
  (`enabled: false`), steht das da statt einer leeren Liste. Während die Prüfung läuft, fragt die Seite
  nach jeder Antwort nach 3 s erneut; schlägt eine Anfrage fehl, bleibt die letzte Liste mit einem Hinweis
  und „Try again“ stehen. Die Antwort wird gegen `GuidePatchStatusView` der Verträge geprüft.
- Im Nur-Katalog-Modus (`calcEngine: "none"`) ersetzt ein Hinweis das Planungsformular.
