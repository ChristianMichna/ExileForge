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
