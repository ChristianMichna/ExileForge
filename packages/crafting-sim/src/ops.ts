import { z } from "zod";
import type { CraftingRule } from "@astrolabe/contracts";

/*
 * Vocabulary of crafting rule ops (CraftingRule.op + params). This package
 * owns it; the data release supplies the rules and every game value in their
 * params (generation types, limits, domains, rarities, flags). A new currency
 * of a patch is a new rule composed of these ops, not new code.
 *
 * Mod choice (add-random-mod): candidates are the release's mods whose domain
 * list contains `domain`, whose generation type is listed, whose required level
 * is <= item level and whose spawn weight for the item is > 0. The weight is
 * that of the first spawn weight entry whose tag is on the base item (the order
 * of the source data), so a later "default" entry cannot override an earlier
 * match. A candidate is dropped if one of its groups is already on the item or
 * the generation type is at its limit.
 *
 * Fixed mod (add-specific-mod): adds the mod the release names for the item class of
 * the base item. Blocked (not applied) when the item already has a mod of one of its
 * groups, or a given limit for its generation type is reached. Rarity rules of a
 * currency are separate require-rarity / set-rarity entries from the release.
 */

const id = z.string().min(1);

export const AddRandomMod = z.object({
  op: z.literal("add-random-mod"),
  params: z.object({
    generationTypes: z.array(id).min(1),
    /** Maximum number of mods per generation type on one item; every listed type needs one. */
    limits: z.record(id, z.int().nonnegative()),
    domain: id,
    count: z.int().positive().default(1),
  }),
});

export const AddSpecificMod = z.object({
  op: z.literal("add-specific-mod"),
  params: z.object({
    /**
     * Mod to add per item class of the base item (ids of the data release). A base whose
     * class is not listed makes the action unusable for it (reported as a problem, not
     * skipped silently).
     */
    modByItemClass: z.record(id, id).refine((m) => Object.keys(m).length > 0, "must not be empty"),
    /** Optional maximum number of mods per generation type; blocked at the limit. */
    limits: z.record(id, z.int().nonnegative()).optional(),
  }),
});

export const RemoveRandomMod = z.object({
  op: z.literal("remove-random-mod"),
  params: z.object({ generationTypes: z.array(id).min(1).optional() }),
});

export const ClearMods = z.object({
  op: z.literal("clear-mods"),
  params: z.object({ generationTypes: z.array(id).min(1).optional() }),
});

export const SetRarity = z.object({
  op: z.literal("set-rarity"),
  params: z.object({ rarity: id }),
});

export const SetFlag = z.object({
  op: z.literal("set-flag"),
  params: z.object({ flag: id }),
});

export const RequireRarity = z.object({
  op: z.literal("require-rarity"),
  params: z.object({ rarities: z.array(id).min(1) }),
});

export const ForbidFlag = z.object({
  op: z.literal("forbid-flag"),
  params: z.object({ flag: id }),
});

export const RequireModCount = z.object({
  op: z.literal("require-mod-count"),
  params: z.object({
    generationTypes: z.array(id).min(1).optional(),
    min: z.int().nonnegative().optional(),
    max: z.int().nonnegative().optional(),
  }),
});

export const EffectOp = z.discriminatedUnion("op", [
  AddRandomMod,
  AddSpecificMod,
  RemoveRandomMod,
  ClearMods,
  SetRarity,
  SetFlag,
]);
export type EffectOp = z.infer<typeof EffectOp>;

export const PreconditionOp = z.discriminatedUnion("op", [
  RequireRarity,
  ForbidFlag,
  RequireModCount,
]);
export type PreconditionOp = z.infer<typeof PreconditionOp>;

export type ParsedRule<T> = { ok: true; rule: T } | { ok: false; reason: string };

function parse<T>(schema: z.ZodType<T>, rule: CraftingRule, what: string): ParsedRule<T> {
  const result = schema.safeParse(rule);
  if (result.success) return { ok: true, rule: result.data };
  const known = (schema as unknown as { options?: { shape: { op: z.ZodLiteral<string> } }[] })
    .options;
  const ops = known?.map((o) => o.shape.op.value) ?? [];
  const reason = ops.includes(rule.op)
    ? `${what} "${rule.op}" has invalid params: ${result.error.message}`
    : `${what} "${rule.op}" is not supported by this simulator version`;
  return { ok: false, reason };
}

export const parseEffect = (rule: CraftingRule) => parse(EffectOp, rule, "effect");
export const parsePrecondition = (rule: CraftingRule) =>
  parse(PreconditionOp, rule, "precondition");
