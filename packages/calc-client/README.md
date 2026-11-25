# @exileforge/calc-client

Brücke zwischen den Entscheidungen im `BuildState` (`packages/contracts`) und dem
Calc-Service (`apps/calc`). Enthält keine Zahlen und kein Spielwissen; alles
Rechnen macht Path of Building (Leitprinzip 1).

## `diffBuildState(from, to, options?)`

Liefert die `PatchOp[]`, die den Zustand `from` (den der Calc-Service geladen
hat) in `to` überführen. Der Aufrufer schickt sie mit `build.applyPatch` an den
Pool und rechnet mit dem neuen Handle.

```ts
const ops = diffBuildState(loadedState, wantedState, { renderItem });
const { handle } = await pool.request("build.applyPatch", { handle: base, ops });
```

- Reihenfolge der Ops: Klasse, Ascendancy, Level, Passive (erst abwählen, dann
  vergeben, Waffensatz 0 zuerst), Skills, Items, Config.
- Nach einem Klassenwechsel wird die Ascendancy erneut gesetzt, weil PoB sie
  beim Wechsel verwirft.
- Skills werden über `SkillSetup.key` als `groupKey` verfolgt; Items über den Slot.
- Gleiche Zustände ergeben eine leere Liste.
- `renderItem(item, slot)` erzeugt den PoB-Itemtext aus einer `ItemSpec`. Das
  braucht Katalogdaten und wird deshalb vom Aufrufer geliefert; ohne Renderer
  scheitert ein geänderter Slot mit `PatchPlanError`.
- Was keine Op ausdrücken kann (Ascendancy entfernen, Config-Override
  zurücknehmen, doppelte Knoten, Skill-Keys oder Slots), wirft `PatchPlanError`
  statt still ignoriert zu werden.

## Offen

- Der erste Zustand: `diffBuildState` setzt einen geladenen Ausgangs-Build voraus
  (`build.load`). Wie dieser für einen neuen `BuildState` entsteht, ist eine
  Entscheidung für den Server (Vorlage-XML je Klasse oder Import).
- `renderItem` aus dem Katalog (Unique, Basis plus Mods) folgt mit dem Katalog-SDK.
