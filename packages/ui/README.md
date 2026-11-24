# @exileforge/ui

Design-System von ExileForge im Stil **„Glutschmiede"**: Die App ist eine
Schmiede. Rußschwarzes Eisen, genietete Platten, eingeprägte Kennzahlen,
glühendes Metall für Fokus und Fortschritt (Stufen als Barren an einer
glühenden Naht). Die Guide-Ansicht nutzt Kodex-Elemente: rote Initialen,
Kassenbuch-Zeilen, Fell-Schrift. Entschieden aus drei Entwürfen
(Glutschmiede, Kodex, Obsidian-Instrument). Vorgaben:
`docs/architecture.md` §3.4 und Skill `poe-ui-design`.

## Verwendung

```tsx
import "@exileforge/ui/styles.css"; // einmal an der App-Wurzel
import { Panel, ItemTooltip, StatValue } from "@exileforge/ui";
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
| Grund | `ground`, `surface-1…3`, `inset`, `line`, `line-strong` |
| Glut | `coal`, `ember`, `heat`, `heat-bright`, `white-hot`; Verläufe `--ef-gradient-molten/ingot/cooled/seam` |
| Kodex | `rubric`, `vellum`, `ink-rule` |
| Rückmeldung | `danger`, `warning`, `success`, `info` (+ `-ground`) |
| Seltenheit | `rarity-normal/magic/rare/unique`, `gem`, `currency` |
| Herkunft | `prov-pob/market/derived/gamedata/sample/uncalibrated` |
| Schrift | `--ef-font-display` (Grenze Gotisch), `--ef-font-body` (Alegreya Sans), `--ef-font-codex`/`--ef-font-flavour` (IM Fell English), `--ef-font-mono` |
| Abstände | `--ef-space-1…7` = 4/8/12/16/24/32/48 px |
| Form | harte Kanten, Fasen `--ef-chamfer-sm/md`, Barren `--ef-shape-ingot`, Nieten `--ef-rivet-size` |

## Bausteine

| Baustein | Zweck |
|---|---|
| `Panel` | genietete Eisenplatte (`plate`) oder eingelassene Schale (`recessed`), Titel, Kicker, Aktionen |
| `Button` | `primary`, `secondary`, `ghost`, `danger`; `sm`/`md`; `busy` (z. B. „PoB rechnet") |
| `Tabs` | gesteuert, WAI-ARIA-Muster, Pfeiltasten/Home/End; `variant="timeline"` zeigt Stufen als Barren an einer glühenden Naht |
| `ItemTooltip` | Seltenheitskopf, Eigenschaften, Anforderungen (nicht erfüllt auch als Text), Implizite, Mods mit Präfix/Suffix, Tier und Wertebereich (`showTiers`), Flavour, Bezug |
| `StatValue`, `StatGrid` | Kennzahl mit Herkunft; Zustände `ready`, `loading`, `error`, `uncalibrated`, `stale`. `StatValue` rendert `dt`/`dd` und gehört immer in ein `StatGrid` |
| `ProvenanceBadge` | Herkunft einer Zahl; Form des Markers je Art, Farbe nie einziges Signal |
| `Callout`, `Badge` | Hinweise und Zustände, Ton immer auch als Text/Icon |
| `Ledger`, `CodexProse` | Kodex-Elemente für den Guide: Wertezeilen mit Herkunft und Zuständen, Text mit roter Initiale |
| `Sigil`, `OrnamentDivider`, `Diamond` | eigene Ornamente (Amboss mit Flamme, Schweißnaht) |

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
- Passive Tree (PixiJS), Crafting-Flow (React Flow), Gem-Setup, Stat-Kurven
- Abbildung `Sourced<T>` → `ProvenanceView`, sobald `packages/contracts` da ist
