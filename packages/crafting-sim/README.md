# @astrolabe/crafting-sim

Crafting-Simulator (F-15): Monte Carlo über die deklarativen `CraftingAction`-Regeln
und die Mod-Gewichte eines Daten-Release. Vertrag: `craft.simulate`
(`packages/contracts/src/craft`). Enthält kein Spielwissen; alle Spielwerte
(Generierungstypen, Limits, Domänen, Seltenheiten, Flags) kommen aus den Regeln
und Mods des Release.

```ts
const catalog = createSimCatalog({ baseItems, mods, actions }); // aus dem Daten-Release
const result = simulate(request, { catalog, config, prices }); // prices: PriceBook oder undefined
```

## Ablauf

- Strategie = Schritte mit Aktionen, optionalem Prüfziel (`until`) und `onFail`
  (`repeat`, `goto`, `restart`, `accept`, `abort`). Nach dem letzten Schritt
  entscheidet das Ziel der Anfrage. Ein Versuch geht vom Startitem bis zum Ende.
- Fester Seed (`config/crafting/sim.json`, oder je Anfrage), Generator mulberry32:
  gleicher Seed, gleiches Ergebnis. Das Ergebnis nennt den verwendeten Seed.
- Ergebnis: Erfolgschance mit 95-%-Wilson-Intervall, erwartete Versuche bis zum
  Erfolg, Verbrauch je Aktion, Anteil je Schritt, `outcomes` (Erfolg, Ende ohne
  Ziel, abgebrochen, blockiert; Summe = Läufe) und Erwartungskosten.
- Herkunft: Chancen, Versuche und Verbrauch sind `derived` (Formel, Version,
  Seed) mit `gamedata`-Eingaben (Aktionen, Basis, gezogene Mods). Kosten kommen
  zusätzlich mit der `market`-Quelle des Preisbuchs (schwächste Konfidenz der
  verwendeten Preise).

## Op-Vokabular (`src/ops.ts`)

Effekte: `add-random-mod`, `add-specific-mod`, `remove-random-mod`, `clear-mods`, `set-rarity`,
`set-flag`. Bedingungen: `require-rarity`, `forbid-flag`, `require-mod-count`.
Neue Währungen eines Patches sind Daten aus diesen Ops. Eine neue Mechanik
braucht einen neuen Op hier, und bis dahin meldet der Simulator die Aktion als
„uncalibrated".

`add-random-mod` zieht aus den Mods der Release, die in der Domäne gelten, einen
gelisteten Generierungstyp haben, deren Mindestlevel ≤ Item-Level ist und deren
Gewicht > 0 ist. **Annahme (gegen echte Release-Daten zu prüfen):** Das Gewicht
ist der erste `spawnWeights`-Eintrag, dessen Tag auf der Basis liegt. Mods einer
bereits vorhandenen Gruppe und volle Generierungstypen sind ausgeschlossen.

`add-specific-mod` (z. B. für Essenzen) setzt den Mod, den die Release je
Item-Klasse der Basis nennt: `params: { modByItemClass: { <Item-Klasse>: <Mod-ID> }, limits? }`.
Steht die Klasse der Basis nicht in der Liste oder fehlt der Mod im Katalog, ist
das Ergebnis `uncalibrated` mit Grund. Ein Mod einer schon vorhandenen Gruppe oder
ein erreichtes Limit blockiert die Anwendung. Raritätsregeln einer Währung stehen
als eigene `require-rarity`/`set-rarity`-Einträge in den Daten, nicht im Op. Ohne
`require-rarity`-Bedingung läuft die Aktion nicht auf beliebiger Rarität, sondern
wird als `uncalibrated` gemeldet.

## Ehrlichkeit statt Ersatzwert

- Fehlt im Release eine Regel, ein Op, ein Limit oder jedes Gewicht für die
  Basis, ist das Ergebnis `uncalibrated` mit Grund, nie eine Zahl.
- Eine nicht anwendbare Aktion (Bedingung nicht erfüllt, kein Mod mehr im Pool)
  beendet den Versuch als Fehlschlag und zählt in `outcomes.blocked`.
- Läuft eine Strategie über `maxStepExecutionsPerAttempt` hinaus, ist das
  Ergebnis `failed` (`step_limit_exceeded`), nicht eine verzerrte Chance.
- Kosten: ohne Kostenwährung, Startkosten (explizit 0 für ein freies Item),
  Preisbuch oder Preis einer verbrauchten Aktion ist `expectedCost`
  `uncalibrated` und nennt die fehlenden Items. Die Referenzwährung des
  Preisbuchs kostet exakt 1 ihrer selbst, alles andere braucht eine Quote.
- Preisbuch: andere Release-ID oder (bei genannter `league`) andere Liga, älter
  als `maxPriceBookAgeMinutes` oder Quote ohne endlichen positiven Betrag →
  `uncalibrated` mit Grund. Das Alter prüft gegen `options.now` (Standard: Uhr).
- Ohne `league` in der Anfrage akzeptiert die Bibliothek jedes Preisbuch; die
  aktuelle Liga aus der Economy-Config wählt der Aufrufer. Das Buch muss er
  vorher gegen `PriceBook` validieren.
- Herkunft der Chance: alle Mods der Pools aller `add-random-mod`-Effekte als
  `gamedata`-Eingaben (sortiert, unabhängig vom Seed); die Läufe stehen in
  `formulaVersion`.
- Begriffe: Ein *Versuch* geht vom Startitem bis zum Ende; `restart` und `abort`
  beenden ihn als `abandoned`, der nächste Versuch beginnt mit einem frischen
  Startitem (Startkosten fallen erneut an). Verbrauch zählt nur
  angewendete Aktionen; eine blockierte kostet nichts.
- `outcomes` fehlt bei `uncalibrated` und `failed`; Nullen würden wie eine
  Messung aussehen.
- Ausnahme vom Determinismus: Die Altersprüfung des Preisbuchs nutzt die Uhr
  (`options.now`, injizierbar); Chancen und Verbrauch hängen nur vom Seed ab.
- Unbekannte Katalog-IDs in der Anfrage werfen `CraftSimInputError`.

## Grenzen

- Mod-Werte (Rolls) sind nicht modelliert, nur welche Mods auf dem Item liegen.
- Das Katalog-Release enthält noch keine Crafting-Aktionen (PoB führt sie nicht);
  echte Währungen, Essences und Omens brauchen die dat-Extraktion (Projektplan,
  Freigabe offen). Die Tests nutzen deshalb ausschließlich erfundene Fixtures.
- Planer (`craft.plan`, Suche über Aktionsfolgen) ist ein eigenes Ticket (F-16).
