# @astrolabe/ui

Design-System von Astrolabe im Stil **„Obsidian-Instrument"**: Die App ist
ein okkultes Messinstrument. Obsidianglas, feine gravierte Haarlinien in
Grünspan, Eckwinkel statt Rahmen, Messwerte in Mono-Schrift, Stufen als
Marken auf einem Astrolabium. Zinnoberrot ist Fehlern vorbehalten.
Christian hat diese Richtung am 24.11.2026 aus drei Entwürfen gewählt
(Glutschmiede, Kodex, Obsidian-Instrument). Vorgaben:
`docs/architecture.md` §3.4 und Skill `poe-ui-design`.

## Verwendung

```tsx
import "@astrolabe/ui/styles.css"; // einmal an der App-Wurzel
import { Panel, ItemTooltip, StatValue } from "@astrolabe/ui";
```

Das Paket ist ein Quellpaket: `exports` zeigt auf `src/`, gebündelt wird vom
Verbraucher (Vite in `apps/web`). `build` prüft nur die Typen.

Eine Galerie aller Bausteine läuft in der App unter `#/design`
(`apps/web/src/views/DesignSystem.tsx`) und ist zugleich Ziel der
Screenshot-Tests.

## Tokens

`src/theme/tokens.css` ist die einzige Stelle mit Farbwerten, Schriftstapeln
und Abständen (Präfix `--ef-`). Komponenten und App-CSS nutzen nur
`var(--ef-…)`.

| Gruppe | Tokens |
|---|---|
| Obsidian | `ground`, `surface-1…3`, `inset`, `line`, `line-strong`, `engraving` |
| Grünspan | `verdigris-deep/dim`, `verdigris`, `verdigris-bright`; `--ef-glow-verdigris` |
| Knochen (Text) | `text-strong`, `text`, `text-muted`, `text-faint` |
| Rückmeldung | `danger` (Zinnober), `warning`, `success`, `info` (+ `-ground`) |
| Seltenheit | `rarity-normal/magic/rare/unique`, `gem`, `currency` |
| Herkunft | `prov-pob/market/derived/gamedata/sample/uncalibrated` |
| Glas | `--ef-glass-sheen`, `--ef-ambient`, `--ef-gradient-hairline` |
| Schrift | `--ef-font-display` (Marcellus SC), `--ef-font-body`/`--ef-font-flavour` (Alegreya Sans), `--ef-font-mono` (IBM Plex Mono) |
| Abstände | `--ef-space-1…7` = 4/8/12/16/24/32/48 px |
| Form | keine Rundungen, Haarlinien `--ef-hairline`, Eckwinkel `--ef-bracket`, Fasen `--ef-chamfer-sm/md`, Astrolabium `--ef-dial-size` |

## Bausteine

| Baustein | Zweck |
|---|---|
| `Panel` | Glasplatte mit Eckwinkeln (`plate`) oder eingelassene Schale (`recessed`), Titel, Mono-Kicker, Haarlinie, Aktionen |
| `Button` | `primary`, `secondary`, `ghost`, `danger`; `sm`/`md`; `busy` (z. B. „PoB rechnet") |
| `Tabs` | gesteuert, WAI-ARIA-Muster, Pfeiltasten/Home/End; `variant="dial"` zeigt Stufen als Marken auf einem Astrolabium, Bogen bis zur aktuellen Stufe leuchtet, `dialCenter` für die Leitzahl |
| `ItemTooltip` | Glastafel mit Eckwinkeln in Seltenheitsfarbe, Mono-Kicker (Seltenheit · Klasse), Eigenschaften, Anforderungen (nicht erfüllt auch als Text), Implizite, Mods mit Präfix/Suffix, Tier und Wertebereich (`showTiers`), Flavour, Bezug |
| `StatValue`, `StatGrid` | Kennzahl mit Herkunft; Zustände `ready`, `loading`, `error`, `uncalibrated`, `stale`. `StatValue` rendert `dt`/`dd` und gehört immer in ein `StatGrid` |
| `ProvenanceBadge` | Herkunft einer Zahl; Form des Markers je Art, Farbe nie einziges Signal |
| `Callout`, `Badge` | Hinweise und Zustände, Ton immer auch als Text/Icon |
| `Ledger`, `GuideNotes` | Guide-Leser: Messwert-Tabelle mit Herkunft und Zuständen, nummerierte Notizen (01, 02, …) |
| `Sigil`, `OrnamentDivider`, `Diamond` | eigene Ornamente (Astrolabium-Siegel, gravierte Trennlinie) |

## Passive Tree

`PassiveTree` zeigt den Tree als Messinstrument: PixiJS (WebGL) zeichnet
Knoten, Verbindungen, die Orbit-Ringe jeder Gruppe als Gravur und einen
gradierten Lünettenring um den ganzen Tree. Eigene Knotenformen, keine
Spielgrafik: Punkt (klein), Raute (Attribut), Doppelring (Notable), Stern
im Ring (Keystone), Fadenkreuz (Jewel-Sockel), Skalenring (Klassenstart),
gravierte Rosette (reine Bildknoten, `decoration`).

Der Renderer zeichnet auf Anforderung (ein Frame nach jeder Änderung von
Kamera, Hervorhebung oder Fokus), nicht in einer Dauerschleife: der Tree ist
groß, und ein laufender Ticker hielt Software-WebGL (CI, Rechner ohne GPU)
so beschäftigt, dass Screenshots nie stabil wurden.

| Teil | Datei | Aufgabe |
|---|---|---|
| Modell | `tree/tree-model.ts` | `buildTreeView(nodes, groups, { include })` aus `PassiveNode`/`PassiveGroup` des Katalogs: Punkte, Bögen, Kanten (einmal je Paar, keine über Aufstiegsklassen hinweg), Grenzen. Knoten ohne Punkt oder mit unbekannter Art stehen in `issues`, nie bei 0,0 |
| Zeitleiste | `tree/tree-timeline.ts` | `buildTimeline(stages)` aus `allocationOrder`/`respecs` je Stufe (Form von `ProgressionStage`); Respecs werden vor den neuen Punkten erstattet. `stateAt(cursor)` liefert belegt, neu (mit Punktnummer) und erstattet |
| Renderer | `tree/renderer.ts` | Kamera (Zoom am Mauszeiger, Ziehen, Tastatur), Treffertest über ein Raster, Hervorhebung. Farben aus `--ef-tree-*`, wird nur per `import()` geladen |
| Oberfläche | `tree/PassiveTree.tsx`, `TreeCanvas.tsx`, `TreeTimelineRule.tsx` | Anzeigen in den Ecken (Stufe, Zähler, Suche, Zoom, Legende, Herkunft), Knotenkarte bei Hover/Klick, Namen belegter Notables ab einer Zoomstufe, Punktnummern, Zeitleiste als gravierte Skala mit Abspielen, Aufstiegs-Einschub, Textliste der Stufe als zugängliche Alternative |

Zustände: neu in der Stufe leuchtet (`--ef-tree-new`), früher belegt ist
gedämpft (`--ef-tree-allocated`), Respec ist bernsteinfarben und
durchgestrichen (`--ef-tree-respec`, auch in der Liste als Text). Schlägt
WebGL fehl, steht der Fehler im Rahmen, kein leerer Tree. Zählwerte im
Anzeigefeld sind Anzahlen von Knoten, keine Spielwerte.

## Zahlen

Komponenten erfinden keine Zahlen. `StatValue` bekommt einen `ValueState`;
es gibt keinen Ersatzwert: Laden, Fehler und „unkalibriert" sind sichtbare
Zustände, nie `0`. `formatNumber` formatiert nur (en-US, die App ist komplett englisch) und wirft bei
`NaN`/`Infinity`. `ProvenanceView` ist ein UI-Modell und wird aus dem
`Sourced<T>`-Vertrag in `packages/contracts` abgebildet, sobald dieser
vorliegt. Die Art `sample` kennzeichnet Fantasiewerte aus Fixtures
(`calc-fake`) und erscheint nie in echten Guides; die Abbildung aus
`Sourced<T>` darf `sample` nie erzeugen. Felder, die heute abweichen
(`calcProfile` statt `calcId`, `dataRelease` statt `gameVersion`+`table`,
fehlende `league`/`from`), werden mit dem Vertrag angeglichen.
`ItemTooltip` verlangt eine `provenance` für alle Zahlen der Karte.
`ModKind` folgt `ModSpec.kind` aus `docs/data-model.md`.

## Schriften und Rechtliches

Alle Schriften stehen unter der SIL Open Font License 1.1 und werden über
`@fontsource/*` mit der App ausgeliefert (kein CDN, offline). Siehe
[FONTS.md](FONTS.md). Keine Spielgrafiken, Spielschriften oder Logos.

## Offen

- Helles Thema (laut Plan zusätzlich)
- Passive Tree: Waffenset-Umschalter, Jewel-Radien, Sprite-Icons (F-03)
- Crafting-Flow (React Flow), Gem-Setup, Stat-Kurven
- Abbildung `Sourced<T>` → `ProvenanceView`, sobald `packages/contracts` da ist
