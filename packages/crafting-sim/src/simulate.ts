import type {
  CraftItemState,
  CraftSimRequest,
  CraftSimResult,
  CraftingAction,
  DataReleaseId,
  EntityRef,
  Mod,
  PriceBook,
  PrimarySource,
  Source,
} from "@astrolabe/contracts";
import { CraftSimRequest as CraftSimRequestSchema } from "@astrolabe/contracts";
import type { SimCatalog } from "./catalog.js";
import type { CraftSimConfig } from "./config.js";
import { CraftSimInputError } from "./errors.js";
import { parseEffect, parsePrecondition } from "./ops.js";
import { PriceLookup } from "./pricing.js";
import { Rng } from "./rng.js";

/** Version of the simulation formulas; part of every derived source. */
export const CRAFT_SIM_FORMULA_VERSION = "1";

export interface SimulateOptions {
  catalog: SimCatalog;
  config: CraftSimConfig;
  /** Prices; must be of the request's data release and league, else costs are uncalibrated. Absent = no costs. */
  prices?: PriceBook | undefined;
  /** Clock for the price book's age check; injectable for tests. */
  now?: () => Date;
}

interface State {
  mods: string[];
  rarity: string;
  flags: Set<string>;
}

/** An action cannot be applied (precondition not met or no mod can be added). */
const BLOCKED = Symbol("blocked");
type Apply = (state: State, rng: Rng) => typeof BLOCKED | undefined;

interface CompiledAction {
  action: CraftingAction;
  check: ((state: State) => boolean)[];
  effects: Apply[];
  /** Ids of all mods an add-random-mod effect of this action can draw from (the chance depends on their weights). */
  poolModIds: string[];
  /** Mods an add-specific-mod effect of this action sets (their groups and generation type decide whether it applies). */
  fixedModIds: string[];
}

type Derived = Extract<Source, { kind: "derived" }>;
type Outcomes = NonNullable<CraftSimResult["outcomes"]>;
const noOutcomes = (): Outcomes => ({
  succeeded: 0,
  finishedWithoutGoal: 0,
  abandoned: 0,
  blocked: 0,
});

function assertNever(value: never): never {
  throw new Error(`internal error: unhandled case ${JSON.stringify(value)}`);
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`internal error: missing ${what}`);
  return value;
}

function bump(counts: number[], index: number): void {
  counts[index] = must(counts[index], "counter") + 1;
}

const uncal = (reason: string) => ({ status: "uncalibrated" as const, reason });

function uncalibratedResult(
  request: CraftSimRequest,
  runs: number,
  seed: number,
  reason: string,
): CraftSimResult {
  return {
    dataReleaseId: request.dataReleaseId,
    runs,
    seed,
    successChance: uncal(reason),
    successInterval: uncal(reason),
    expectedAttempts: uncal(reason),
    actions: [],
    steps: [],
    expectedCost: uncal(reason),
  };
}

export function simulate(rawRequest: CraftSimRequest, options: SimulateOptions): CraftSimResult {
  const parsed = CraftSimRequestSchema.safeParse(rawRequest);
  if (!parsed.success) {
    throw new CraftSimInputError(`invalid craft.simulate request: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  const request = parsed.data;
  const { catalog, config } = options;
  const runs = request.runs ?? config.defaultRuns;
  if (runs > config.maxRuns) {
    throw new CraftSimInputError(`runs ${runs} exceeds the configured maximum ${config.maxRuns}`);
  }
  const seed = request.seed ?? config.defaultSeed;

  const base = catalog.baseItem(request.start.baseItemId);
  if (!base) throw new CraftSimInputError(`unknown base item ${request.start.baseItemId}`);
  for (const id of request.start.modIds) {
    if (!catalog.mod(id)) throw new CraftSimInputError(`unknown mod ${id} on the start item`);
  }
  for (const clause of request.goal.clauses) {
    for (const id of clause.anyOfModIds) {
      if (!catalog.mod(id)) throw new CraftSimInputError(`unknown mod ${id} in the goal`);
    }
  }
  const steps = [...request.strategy.steps].sort((a, b) => a.order - b.order);
  for (const step of steps) {
    for (const clause of step.until?.clauses ?? []) {
      for (const id of clause.anyOfModIds) {
        if (!catalog.mod(id))
          throw new CraftSimInputError(`unknown mod ${id} in step ${step.order}`);
      }
    }
  }

  // Compile the rules of every action the strategy uses; collect what is missing.
  const compiled = new Map<string, CompiledAction>();
  const problems: string[] = [];
  for (const step of steps) {
    for (const actionId of step.actionIds) {
      if (compiled.has(actionId)) continue;
      const action = catalog.action(actionId);
      if (!action) throw new CraftSimInputError(`unknown crafting action ${actionId}`);
      const result = compileAction(action, request.start, base.tags, catalog);
      if (result.problems.length > 0) problems.push(...result.problems);
      else compiled.set(actionId, result.compiled);
    }
  }
  if (problems.length > 0) {
    return uncalibratedResult(request, runs, seed, problems.join("; "));
  }

  const byOrder = new Map(steps.map((s, i) => [s.order, i]));
  const rng = new Rng(seed);
  const uses = new Map<string, number>();
  const reached = new Array<number>(steps.length).fill(0);
  const executed = new Array<number>(steps.length).fill(0);
  const passedCount = new Array<number>(steps.length).fill(0);
  let successes = 0;
  const outcomes: Outcomes = noOutcomes();
  let limitHits = 0;

  const holds = (state: State, clauses: { anyOfModIds: readonly string[] }[]) =>
    clauses.every((c) => c.anyOfModIds.some((m) => state.mods.includes(m)));

  for (let run = 0; run < runs; run++) {
    const state: State = {
      mods: [...request.start.modIds],
      rarity: request.start.rarity,
      flags: new Set(request.start.flags),
    };
    const seen = new Set<number>();
    let cur = 0;
    let executions = 0;
    attempt: for (;;) {
      if (++executions > config.maxStepExecutionsPerAttempt) {
        limitHits++;
        break;
      }
      const step = must(steps[cur], "step index");
      if (!seen.has(cur)) {
        seen.add(cur);
        bump(reached, cur);
      }
      for (const actionId of step.actionIds) {
        const c = must(compiled.get(actionId), "compiled action");
        if (!c.check.every((f) => f(state))) {
          outcomes.blocked++;
          break attempt;
        }
        for (const effect of c.effects) {
          if (effect(state, rng) === BLOCKED) {
            outcomes.blocked++;
            break attempt;
          }
        }
        // Only an applied action is consumed; a blocked one costs nothing.
        uses.set(actionId, (uses.get(actionId) ?? 0) + 1);
      }
      bump(executed, cur);
      if (!step.until || holds(state, step.until.clauses)) {
        bump(passedCount, cur);
        if (cur + 1 >= steps.length) {
          if (holds(state, request.goal.clauses)) successes++;
          else outcomes.finishedWithoutGoal++;
          break;
        }
        cur++;
        continue;
      }
      switch (step.onFail.action) {
        case "repeat":
          continue;
        case "goto":
          cur = must(byOrder.get(step.onFail.order), "goto target");
          continue;
        case "accept":
          if (holds(state, request.goal.clauses)) successes++;
          else outcomes.finishedWithoutGoal++;
          break attempt;
        case "restart":
        case "abort":
          outcomes.abandoned++;
          break attempt;
        default:
          return assertNever(step.onFail);
      }
    }
  }

  const gamedata = gamedataInputs(request.dataReleaseId, request.start, compiled);
  const derived = (formula: string, extra: PrimarySource[] = []): Derived => ({
    kind: "derived" as const,
    formula,
    formulaVersion: `${CRAFT_SIM_FORMULA_VERSION}; runs=${runs}`,
    inputs: [...gamedata, ...extra] as [PrimarySource, ...PrimarySource[]],
    seed,
  });

  if (limitHits > 0) {
    const error = {
      code: "step_limit_exceeded",
      message: `${limitHits} of ${runs} attempts needed more than ${config.maxStepExecutionsPerAttempt} step executions; the strategy may never end`,
    };
    return {
      dataReleaseId: request.dataReleaseId,
      runs,
      seed,
      successChance: { status: "failed", error },
      successInterval: { status: "failed", error },
      expectedAttempts: { status: "failed", error },
      actions: [],
      steps: [],
      expectedCost: { status: "failed", error },
    };
  }

  const chance = successes / runs;
  const noSuccess = uncal(`no attempt out of ${runs} reached the goal`);
  const chanceSource = derived("crafting.monte-carlo.success-chance");
  const attemptsSource = derived("crafting.monte-carlo.expected-attempts");
  const usedActions = [...compiled.keys()];

  return {
    dataReleaseId: request.dataReleaseId,
    runs,
    seed,
    successChance: { status: "ok", value: chance, source: chanceSource },
    successInterval: {
      status: "ok",
      value: wilson(successes, runs),
      source: derived("crafting.monte-carlo.success-interval.wilson-95"),
    },
    outcomes: { ...outcomes, succeeded: successes },
    expectedAttempts:
      successes > 0 ? { status: "ok", value: runs / successes, source: attemptsSource } : noSuccess,
    actions: usedActions.map((actionId) => ({
      actionId: actionId as CraftSimResult["actions"][number]["actionId"],
      perAttempt: {
        status: "ok",
        value: (uses.get(actionId) ?? 0) / runs,
        source: derived("crafting.monte-carlo.uses-per-attempt"),
      },
      perSuccess:
        successes > 0
          ? {
              status: "ok",
              value: (uses.get(actionId) ?? 0) / successes,
              source: derived("crafting.monte-carlo.uses-per-success"),
            }
          : noSuccess,
    })),
    steps: steps.map((s, i) => ({
      order: s.order,
      reached: {
        status: "ok",
        value: must(reached[i], "reached") / runs,
        source: derived("crafting.monte-carlo.step-reached"),
      },
      passed:
        must(executed[i], "executed") > 0
          ? {
              status: "ok",
              value: must(passedCount[i], "passed") / must(executed[i], "executed"),
              source: derived("crafting.monte-carlo.step-passed"),
            }
          : uncal("step was never executed"),
    })),
    expectedCost: cost(
      request,
      runs,
      successes,
      uses,
      compiled,
      options.prices,
      options.now ?? (() => new Date()),
      config.maxPriceBookAgeMinutes,
      derived,
    ),
  };
}

function cost(
  request: CraftSimRequest,
  runs: number,
  successes: number,
  uses: Map<string, number>,
  compiled: Map<string, CompiledAction>,
  book: PriceBook | undefined,
  now: () => Date,
  maxAgeMinutes: number,
  derived: (formula: string, extra?: PrimarySource[]) => Derived,
): CraftSimResult["expectedCost"] {
  const target = request.costCurrencyItemId;
  if (!target) return uncal("no cost currency requested");
  if (!request.startCost)
    return uncal("start cost missing; pass startCost (0 if the item is free)");
  if (request.startCost.status === "failed") return request.startCost;
  if (request.startCost.status !== "ok") return uncal(`start cost is ${request.startCost.status}`);
  if (!book) return uncal("no price book for the requested league");
  if (book.dataReleaseId !== request.dataReleaseId) {
    return uncal(
      `price book maps provider ids to release ${book.dataReleaseId}, request is for ${request.dataReleaseId}`,
    );
  }
  if (request.league !== undefined && book.league !== request.league) {
    return uncal(`price book is for league ${book.league}, request names ${request.league}`);
  }
  const ageMinutes = (now().getTime() - Date.parse(book.fetchedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) {
    return uncal(`price book has no usable fetch time (${book.fetchedAt})`);
  }
  if (ageMinutes > maxAgeMinutes) {
    return uncal(`price book is stale (fetched ${book.fetchedAt}, limit ${maxAgeMinutes} minutes)`);
  }
  if (successes === 0) return uncal(`no attempt out of ${runs} reached the goal`);

  const prices = new PriceLookup(book);
  const missing: string[] = [];
  const unit = (itemId: string) => {
    const p = prices.unitPrice(itemId);
    if (p === undefined) missing.push(itemId);
    return p;
  };
  const targetUnit = unit(target);
  const startUnit = unit(request.startCost.value.currencyItemId);
  let total = 0;
  for (const [actionId, count] of uses) {
    const itemId = compiled.get(actionId)?.action.itemId;
    if (!itemId) {
      missing.push(`${actionId} (action has no item to price)`);
      continue;
    }
    const p = unit(itemId);
    if (p !== undefined) total += count * p;
  }
  if (missing.length > 0 || targetUnit === undefined || startUnit === undefined) {
    return uncal(`no price for ${[...new Set(missing)].join(", ")}`);
  }
  total += runs * request.startCost.value.amount * startUnit;

  const startSource = request.startCost.source;
  const extra: PrimarySource[] = [];
  const market = prices.usedSource();
  if (market) extra.push(market);
  if (startSource.kind === "market") extra.push(startSource);
  else if (startSource.kind === "derived") extra.push(...startSource.inputs);
  else assertNever(startSource);
  return {
    status: "ok",
    value: { amount: total / successes / targetUnit, currencyItemId: target },
    source: derived("crafting.expected-cost", extra),
  };
}

function compileAction(
  action: CraftingAction,
  start: CraftItemState,
  baseTags: readonly string[],
  catalog: SimCatalog,
): { compiled: CompiledAction; problems: string[] } {
  const problems: string[] = [];
  const check: CompiledAction["check"] = [];
  const effects: Apply[] = [];
  const poolModIds: string[] = [];
  const fixedModIds: string[] = [];
  const where = `action ${action.id}`;
  const itemClassOf = catalog.baseItem(start.baseItemId)?.itemClass;
  // every rarity the item can have while this action runs, to check them against the release
  const rarityIds = [
    start.rarity,
    ...action.effects.flatMap((e) => {
      const target = e.op === "set-rarity" ? e.params["rarity"] : undefined;
      return typeof target === "string" ? [target] : [];
    }),
  ];

  for (const rule of action.preconditions) {
    const p = parsePrecondition(rule);
    if (!p.ok) {
      problems.push(`${where}: ${p.reason}`);
      continue;
    }
    const r = p.rule;
    if (r.op === "require-rarity") check.push((s) => r.params.rarities.includes(s.rarity));
    else if (r.op === "forbid-flag") check.push((s) => !s.flags.has(r.params.flag));
    else {
      check.push((s) => {
        const n = countMods(s, catalog, r.params.generationTypes);
        return (
          (r.params.min === undefined || n >= r.params.min) &&
          (r.params.max === undefined || n <= r.params.max)
        );
      });
    }
  }

  for (const rule of action.effects) {
    const p = parseEffect(rule);
    if (!p.ok) {
      problems.push(`${where}: ${p.reason}`);
      continue;
    }
    const r = p.rule;
    switch (r.op) {
      case "set-rarity":
        effects.push((s) => void (s.rarity = r.params.rarity));
        break;
      case "set-flag":
        effects.push((s) => void s.flags.add(r.params.flag));
        break;
      case "clear-mods":
        effects.push((s) => {
          s.mods = s.mods.filter((m) => {
            const gen = catalog.mod(m)?.generationType;
            return r.params.generationTypes
              ? !(gen && r.params.generationTypes.includes(gen))
              : false;
          });
          return undefined;
        });
        break;
      case "remove-random-mod":
        effects.push((s, rng) => {
          const idx = s.mods
            .map((m, i) => ({ gen: catalog.mod(m)?.generationType, i }))
            .filter(
              (x) =>
                !r.params.generationTypes || (x.gen && r.params.generationTypes.includes(x.gen)),
            )
            .map((x) => x.i);
          if (idx.length === 0) return BLOCKED;
          s.mods.splice(must(idx[rng.int(idx.length)], "mod index"), 1);
          return undefined;
        });
        break;
      case "add-specific-mod": {
        const limitOf = limitResolver(
          r.params.limits,
          r.params.limitsByRarity,
          catalog,
          itemClassOf,
          rarityIds,
          problems,
          where,
        );
        if (!action.preconditions.some((c) => c.op === "require-rarity")) {
          problems.push(
            `${where}: add-specific-mod needs a require-rarity precondition; the release gives no rarity rule, so the action cannot be simulated`,
          );
          break;
        }
        const itemClass = catalog.baseItem(start.baseItemId)?.itemClass;
        const modId = itemClass === undefined ? undefined : r.params.modByItemClass[itemClass];
        const mod = modId === undefined ? undefined : catalog.mod(modId);
        if (modId === undefined || !mod) {
          problems.push(
            modId === undefined
              ? `${where}: no mod given for item class ${String(itemClass)} of base ${start.baseItemId}`
              : `${where}: mod ${modId} is not in the data release`,
          );
          break;
        }
        fixedModIds.push(mod.id);
        effects.push((s) => {
          if (s.mods.includes(mod.id)) return BLOCKED;
          const limit = limitOf(s, mod.generationType);
          let count = 0;
          for (const m of s.mods) {
            const other = catalog.mod(m);
            if (!other) continue;
            if (other.groups.some((g) => mod.groups.includes(g))) return BLOCKED;
            if (other.generationType === mod.generationType) count++;
          }
          // a limit that is missing for a release-based rule means: this rarity takes none
          if (
            r.params.limitsByRarity ? count >= (limit ?? 0) : limit !== undefined && count >= limit
          )
            return BLOCKED;
          s.mods.push(mod.id);
          return undefined;
        });
        break;
      }
      case "add-random-mod": {
        const missingLimit = r.params.limits
          ? r.params.generationTypes.filter((g) => r.params.limits?.[g] === undefined)
          : [];
        if (missingLimit.length > 0) {
          problems.push(`${where}: no limit given for generation type ${missingLimit.join(", ")}`);
          break;
        }
        const limitOf = limitResolver(
          r.params.limits,
          r.params.limitsByRarity,
          catalog,
          itemClassOf,
          rarityIds,
          problems,
          where,
        );
        const candidates = poolFor(catalog.mods(), r.params, start.itemLevel, baseTags);
        if (candidates.length === 0) {
          problems.push(
            `${where}: no mod with a spawn weight for base ${start.baseItemId} in domain ${r.params.domain} at item level ${start.itemLevel}${r.params.minModLevel === undefined ? "" : ` and minimum mod level ${r.params.minModLevel}`}`,
          );
          break;
        }
        for (const c of candidates) poolModIds.push(c.mod.id);
        effects.push((s, rng) => {
          for (let n = 0; n < r.params.count; n++) {
            const counts = new Map<string, number>();
            const groups = new Set<string>();
            for (const m of s.mods) {
              const mod = catalog.mod(m);
              if (!mod) continue;
              counts.set(mod.generationType, (counts.get(mod.generationType) ?? 0) + 1);
              for (const g of mod.groups) groups.add(g);
            }
            const pool = candidates.filter(
              (c) =>
                (counts.get(c.mod.generationType) ?? 0) < (limitOf(s, c.mod.generationType) ?? 0) &&
                !c.mod.groups.some((g) => groups.has(g)) &&
                !s.mods.includes(c.mod.id),
            );
            const pick = rng.weighted(pool.map((c) => c.weight));
            if (pick < 0) return BLOCKED;
            const chosen = must(pool[pick], "pool entry").mod;
            s.mods.push(chosen.id);
          }
          return undefined;
        });
        break;
      }
    }
  }
  return { compiled: { action, check, effects, poolModIds, fixedModIds }, problems };
}

function countMods(s: State, catalog: SimCatalog, gens: readonly string[] | undefined): number {
  return s.mods.filter((m) => {
    if (!gens) return true;
    const gen = catalog.mod(m)?.generationType;
    return gen !== undefined && gens.includes(gen);
  }).length;
}

function poolFor(
  mods: readonly Mod[],
  params: { generationTypes: string[]; domain: string; minModLevel?: number | undefined },
  itemLevel: number,
  baseTags: readonly string[],
): { mod: Mod; weight: number }[] {
  const out: { mod: Mod; weight: number }[] = [];
  for (const mod of mods) {
    if (!params.generationTypes.includes(mod.generationType)) continue;
    if (!mod.domains.includes(params.domain)) continue;
    if (mod.requiredLevel > itemLevel) continue;
    if (params.minModLevel !== undefined && mod.requiredLevel < params.minModLevel) continue;
    const match = mod.spawnWeights.find((w) => baseTags.includes(w.tag));
    if (match && match.weight > 0) out.push({ mod, weight: match.weight });
  }
  return out;
}

function gamedataInputs(
  dataReleaseId: DataReleaseId,
  start: CraftItemState,
  compiled: Map<string, CompiledAction>,
): PrimarySource[] {
  const pool = new Set<string>();
  const fixed = new Set<string>();
  for (const c of compiled.values()) {
    for (const id of c.poolModIds) pool.add(id);
    for (const id of c.fixedModIds) fixed.add(id);
  }
  const src = (entity: EntityRef, field: string): PrimarySource => ({
    kind: "gamedata",
    dataReleaseId,
    entity,
    field,
  });
  return [
    src({ kind: "baseItem", id: start.baseItemId }, "/tags"),
    ...[...compiled.keys()].map((id) => src({ kind: "craftingAction", id }, "/effects")),
    ...(fixed.size > 0 ? [src({ kind: "baseItem", id: start.baseItemId }, "/itemClass")] : []),
    ...[...pool].sort().map((id) => src({ kind: "mod", id }, "/spawnWeights")),
    ...[...fixed]
      .sort()
      .flatMap((id) => [
        src({ kind: "mod", id }, "/groups"),
        src({ kind: "mod", id }, "/generationType"),
      ]),
  ];
}

/** 95 % Wilson score interval. */
function wilson(successes: number, n: number): { low: number; high: number } {
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * The limit of a generation type for the item in its current state: fixed by
 * the rule, or the release's limit for the item's rarity (an item-class entry
 * wins over the rarity's general one). A rarity the release does not list, or
 * one without a limit for the type, means the item takes no mod of that type.
 * Without any rarities in the release the action cannot be simulated.
 */
function limitResolver(
  fixed: Record<string, number> | undefined,
  byRarity: true | undefined,
  catalog: SimCatalog,
  itemClass: string | undefined,
  rarityIds: readonly string[],
  problems: string[],
  where: string,
): (state: State, generationType: string) => number | undefined {
  if (!byRarity) return (_s, g) => fixed?.[g];
  if (!catalog.hasRarities())
    problems.push(`${where}: the release lists no rarities, so the affix limits are unknown`);
  else
    for (const id of new Set(rarityIds))
      if (!catalog.rarity(id))
        problems.push(
          `${where}: rarity ${id} is not in the data release, so its limits are unknown`,
        );
  return (s, g) => {
    const rarity = catalog.rarity(s.rarity);
    const byClass =
      itemClass === undefined ? undefined : rarity?.maxAffixesByItemClass?.[itemClass];
    return (byClass ?? rarity?.maxAffixes)?.[g];
  };
}
