---
name: poe-ui-design
description: Gestaltet und prüft die ExileForge-Oberfläche im eigenen Dark-Fantasy-Stil für PoE-Spieler – Design-Tokens, Typografie, Item-Karten, Tree-Darstellung, Crafting-Flow, Zahlen mit Herkunft – und erkennt generischen KI-Look. Verwenden beim Anlegen des Design-Systems, bei neuen UI-Komponenten und bei Reviews von Styling-Änderungen in apps/ui.
---

<!-- Teilweise adaptiert aus everything-claude-code (skills/design-system:
     Audit-Dimensionen und „AI-Slop"-Liste), MIT, © 2026 Affaan Mustafa.
     Siehe .claude/THIRD_PARTY_NOTICES.md. Stilvorgaben aus docs/architecture.md §3.4. -->

# PoE-UI-Design

Vorgabe: „optisch ansprechend für PoE-Spieler", eigene Gestaltung, **keine
kopierten Spielgrafiken**. Quelle: `docs/architecture.md` §3.4.

## Tokens (einzige Quelle für Farben, Schrift, Abstände)

Liegen zentral (z. B. `apps/ui/src/theme/tokens.ts` + CSS Custom Properties).
Komponenten nutzen nur Tokens, nie freie Hex-Werte.

| Gruppe | Richtung |
|---|---|
| Grund | Stein-Schwarz, Anthrazit, abgestufte Flächen |
| Akzent | Bronze / Altgold für Rahmen, aktive Elemente, Überschriften |
| Warnung/Fehler | gedämpftes Blutrot, immer mit Icon oder Text |
| Seltenheit | Konventionsfarben: Normal weiß, Magisch blau, Selten gelb, Unique orange (sofort lesbar für Spieler) |
| Herkunft | eigene dezente Farbe für „PoB x.y.z", „Marktpreis", „berechnet" |
| Schrift | Cinzel (OFL) für Überschriften; gut lesbare Sans für Text; tabellarische Ziffern für Werte |
| Abstände | feste Skala (4/8/12/16/24/32) |

## Bausteine

- **Item-Karte**: Kopf in Seltenheitsfarbe, Basistyp, Mods nach Priorität mit
  Tier, Alternativen, Bezugsquelle; Rahmen aus eigenem SVG-Ornament.
- **Passive Tree** (PixiJS): neue Knoten je Stufe hervorgehoben, Reihenfolge
  der Punkte, Waffenset 1/2, Zoom/Pan, Stufen-Slider. Knotenformen eigen,
  solange die Icon-Frage (⚠) offen ist. Textliste der Knoten als Alternative.
- **Crafting-Flow** (React Flow): Schritt → Ergebnis → Plan B, Kosten je
  Schritt und Summe, jede Zahl mit Herkunft.
- **Kennzahlen**: Verlauf über Stufen (DPS, EHP, Leben); Fehlerzustand
  sichtbar statt `0`.

## Audit (0–10 je Punkt, mit `datei:zeile` und Fix)

1. Farben nur aus Tokens?
2. Typografie-Hierarchie klar (Cinzel nur für Überschriften)?
3. Abstände auf der Skala?
4. Gleiche Elemente sehen gleich aus (Item-Karten, Buttons, Panels)?
5. Fenstergrößen: kleine Laptop-Auflösung bis 4K, Tree skaliert?
6. Animation sparsam und zweckmäßig?
7. Zugänglichkeit: Kontrast auf dunklem Grund, Fokusrahmen, Farbe nie
   einziges Signal (Seltenheit + Text)?
8. Informationsdichte: Spieler wollen viele Werte, aber gruppiert?
9. Zustände: Laden (PoB rechnet), leer, Fehler, veraltet (Patch)?
10. Herkunft jeder Zahl sichtbar?

## Generischer KI-Look – vermeiden

- Verläufe auf allem, Lila→Blau, Glasmorphismus ohne Zweck
- Starke Rundungen überall (passt nicht zum Stil: eher harte Kanten, Fasen)
- Zentrierter Hero-Text über Farbverlauf, Scroll-Animationen
- Neutrale Sans ohne Charakter für Überschriften
- Emoji als Icons

## Rechtliches

Keine Texturen, Logos, Schriftarten oder Icons aus dem Spiel kopieren.
Eigene SVGs; frei lizenzierte Schriften mit Lizenzdatei im Repo.
