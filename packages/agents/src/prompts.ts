/*
 * Prompt texts of the stages. Short on purpose: each task has one response
 * schema and tools to look things up; nothing here states game facts.
 * Bump PROMPT_VERSION in config/agents/stages.json when a text changes.
 */

export const NO_MEMORY_RULES =
  "Use only ids you found with catalog_search or catalog_get in this run's data release; never ids or game facts from memory. Text fields are rich text segments: never type numbers, reference calculation results instead or rephrase without the number.";

export const S0_SKILL = [
  "The player described a skill idea but has not picked the main skill. Choose the one active skill gem that best matches the idea.",
  "Search the catalog (catalog_search with kind gem), exclude support gems, and explain the choice in the rationale.",
  NO_MEMORY_RULES,
].join(" ");

export const S1_PROFILE = [
  "Extend the mechanics profile of the main skill with what the catalog shows: stats that scale it, support gems that fit it, unique items and passive nodes that interact with it, and ascendancies that could carry it.",
  "Look candidates up with catalog_search (use tags of the skill) and catalog_get; keep each list to the most relevant entries and explain notable choices in notes.",
  NO_MEMORY_RULES,
].join(" ");

export const S2_CANDIDATE = (index: number, total: number): string =>
  [
    `Propose build archetype ${index} of ${total} for the player's skill idea and the mechanics profile.`,
    "It must differ clearly from the previous candidates (other class or other ascendancy) and respect the player's preferences and exclusions.",
    NO_MEMORY_RULES,
  ].join(" ");

export const S5_GEMS = (mainSkillPreset: boolean): string =>
  [
    "Choose the skill gem setup for the chosen archetype: exactly one setup with role main plus any secondary setups, each with supports.",
    mainSkillPreset
      ? "The main setup must use the player's main skill."
      : "Pick the main skill that best fits the player's idea.",
    "Use calc_evaluate (always with the runId) to compare setups before you submit; explain each choice in rationale without typing numbers.",
    NO_MEMORY_RULES,
  ].join(" ");

export const S6_NOTES = [
  "For each progression stage, write what the player does in it (tasks), what can go wrong (dangers) and why the stage looks as it does (rationale).",
  "Use exactly the stage keys given in the context, each once. The passive allocations and their measurements are fixed and come from Path of Building; you only describe them.",
  NO_MEMORY_RULES,
].join(" ");

export const S7_GEAR = [
  "Choose the target item for each gear slot of this budget tier, as an item spec: a unique, or a crafted rare with a base and wanted mods, plus how it is acquired.",
  "Use only the slots given in the context, each at most once, and fill every required slot. Respect solo self-found mode: no trade then. The context lists the earlier tiers' choices; keep them and upgrade from there. Cheaper tiers use items the player can realistically get with that budget; higher tiers upgrade the slots that gain the most.",
  "Use calc_evaluate (always with the runId) to compare options; explain each choice in rationale without typing numbers. Prices are not known to you and are measured afterwards.",
  NO_MEMORY_RULES,
].join(" ");

export const S8_CRAFT = [
  "Plan how to craft the target rare item of this slot: the start item (item level, rarity, mods it already has) and the strategy as ordered steps.",
  "Each step lists crafting action ids from the catalog, a plain-text goal, an optional check (`until`) and what happens when the check fails (repeat, restart, accept, abort, or goto another step).",
  "The goal of the whole craft is fixed: the mods the target item requires. Use craft_simulate (always with the runId) to try strategies before you submit; explain the choices in rationale without typing numbers.",
  NO_MEMORY_RULES,
].join(" ");

export const S9_SECTION = [
  "Write one section of the player's build guide from the plans already made. The guide is read by a player who wants to build and play this character.",
  "The context holds the request, the chosen archetype, the validated target, progression, gear and crafting plans, and the sections written so far. Describe and justify them; never change them. Be concrete about what to do, in which order and why.",
  "Reference measured values with calc segments using the calc ids given in the context; get the stat names with calc_evaluate (always with the runId) and never type a number. Do not name game mechanics that the plans and the catalog do not show. Mention catalog entities as entity segments.",
  NO_MEMORY_RULES,
].join(" ");
