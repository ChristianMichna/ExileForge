# @astrolabe/optimizer

Deterministische Optimierer (F-09, WS3). Ohne KI lauffähig; die KI liefert nur
Zielfunktion, Constraints und Prioritäten. **Jede Zahl misst Path of Building**
(Leitprinzip 1): der Optimierer rechnet nie selbst, er wählt Knoten und lässt
sie über einen `TreeEvaluator` bewerten.

## Schnittstelle

```ts
const evaluator = createPobTreeEvaluator({ pool, handle, profile, baseAllocated });
const graph = TreeGraph.build(catalogPassiveNodes, classStartNodeId);

const result = await optimizeTree({
  graph, allocated, budget, evaluator, config,
  objective: { weights: { FullDPS: 1, TotalEHP: 0.4 }, floors: { FireResist: 75 } },
  requiredNodeIds, forbiddenNodeIds, lockedNodeIds, priorityNodeIds,
});

const plan = await optimizeProgression({
  graph, target: result.allocated, objective, evaluator, config,
  stages: [{ key: "act1", budget: 12 }, { key: "act3", budget: 40 }, /* … */],
});
```

- `allocated` ist nur der Haupt-Tree, ohne Klassenstart (implizit) und ohne
  Ascendancy-Knoten. Der Graph enthält weder Ascendancy-Knoten noch fremde
  Klassenstarts (kein Pfad führt hindurch).
- `Objective`: `weights` = Gewicht des relativen Gewinns je PoB-Metrik,
  `floors` = harte Mindestwerte (Resistenzen, Attribute, Spirit …). Metrikname
  und Calc-Profil gibt der Aufrufer vor (PoB-Ausgabenamen, siehe `config/calc-profiles`).
  Ein verletzter Floor wird mit `floorPenalty` bestraft und steht im Ergebnis
  (`violations`, `feasible: false`); er wird nie versteckt.
  `floorsFromMetrics` (Metrik → Metrik) verlangt einen Wert mindestens in Höhe einer
  anderen, in derselben Auswertung gemessenen Metrik, z. B. `Int` gegen `ReqInt`;
  er wirkt wie ein Floor.
- `TreeGraph.build(..., availableNodeIds)`: Knoten mit `PassiveNode.unlockedBy` (PoB `unlockConstraint`, z. B. die Oracle-Knoten des normalen Baums) gehören nur dazu, wenn alle freischaltenden Knoten in `availableNodeIds` stehen (Standard: leer, also ausgeschlossen); sonst lehnt PoB die Allokation ab.
- Ergebnis: `allocated` (in Vergabereihenfolge), `added`, `removed`, `unspent`,
  Metriken des Start- und Endzustands samt `calcId`, `stoppedBy`, Zahl der
  PoB-Rechnungen und alle fehlgeschlagenen Zustände (`failedEvaluations`).
- Fehler (`OptimizerError`, mit `cause`): `invalid_input`, `base_failed`,
  `infeasible`, `evaluator_failed`, `aborted`. Ein nicht berechenbarer
  Kandidat wird übersprungen und gemeldet; ein fehlender Messwert ist ein
  Fehler, nie `0`.
- Die Suche rechnet mit `calc.evalBatch` (Basis + Delta). Die Zahlen im
  Ergebnis stammen aus einer vollen Bestätigungsrechnung (`confirm` des
  Evaluators, `confirmed: true`): Zustand anwenden, bei PoB-Patch-Warnungen
  abbrechen, `calc.stats`. Für `calcRef`s im Guide liefert
  `confirmResult(allocated)` das volle `CalcResult`.
- Unvollständige Läufe sind gekennzeichnet: `stoppedBy`, `refineStoppedBy`,
  `truncated` (Rechenbudget hat eine Runde abgeschnitten),
  `evaluation_failed`. Technische Fehler (`timeout`, `worker_crashed`) werden
  nicht gecacht.

## Verfahren

1. Pflichtknoten (samt Pfad) zuerst, Budget prüfen.
2. Vorbewertung: `calc.nodePower`, falls der Worker es kann (sonst
   `unknown_method` → Exploration; `priorSource` im Ergebnis sagt, was galt).
3. Gieriges Wachstum: je Runde bis `candidatesPerRound` Ziele (Pfadlänge ≤
   `maxPathCost`) als ein `calc.evalBatch`, bester Gewinn je Punkt gewinnt.
   Nicht gemessene Ziele (Priorität zuerst) und gemessene Ziele mischen sich nach
   `explorationShare`.
4. Verfeinerung: Einzelknoten-Tausch (Blatt entfernen, Nachbar vergeben), nur
   zusammenhängende Zustände, solange der Score steigt.
5. Progression: `optimizeProgression` ordnet einen Ziel-Tree in verschachtelte
   Stufen (jede Stufe ⊇ vorherige, damit ohne Respec), je Stufe mit eigener
   Zielfunktion möglich; die Stufe nutzt ihre Punkte immer voll aus.

Alle Suchparameter stehen in `config/optimizer/tree.json`. Gleiche Eingaben
liefern gleiche Ergebnisse; Zustände werden je Lauf nur einmal berechnet
(Cache), `maxEvaluations` begrenzt die PoB-Last.

## Grenzen (bewusst, Folgearbeiten)

- Keine Weapon-Set-Ebene und keine Jewel-Socket-Profile; Ascendancy getrennt.
- Tausch nur 1:1; Tausch ganzer Ketten und Beam Search fehlen. Das Ergebnis ist
  ein lokales Optimum, kein Beweis des Optimums.
- Respecs zwischen Stufen (`respecs` ist immer leer); erst nötig, wenn
  Leveling-Knoten außerhalb des Ziel-Trees gewollt sind.
- Gemessene Werte (Priors) werden nicht nach jeder Vergabe erneuert; nach
  Synergie-Änderungen kann die Reihenfolge der Kandidaten veraltet sein. Die
  Verfeinerung und das Wachstum messen aber immer den echten Zustand.
- `calc.nodePower` ist teuer (Vollsweep aller erreichbaren Knoten ca. 28 min
  mit 2 Workern): immer mit `priorityNodeIds` als Kandidatenliste aufrufen.
- `allocateNodes` vergibt in PoB den kürzesten Pfad; der Evaluator prüft das
  nur in `confirm`. Die Suche arbeitet mit vollständigen Pfaden und ist davon
  nicht betroffen.
- Tests nutzen eine synthetische Engine (Fantasiewerte, erfundene IDs). Ein
  Test gegen echtes PoB und Golden Builds folgt, sobald der Adapter im Server
  verdrahtet ist.

## Tests

```bash
pnpm --filter @astrolabe/optimizer test
```
