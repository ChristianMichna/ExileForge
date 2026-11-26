import type { CraftingPlan } from "@astrolabe/contracts/build";
import type { GuideView } from "@astrolabe/contracts/guide";
import type { ValueState } from "@astrolabe/ui";
import { measuredState } from "./measured";
import { nameOf } from "./RichTextView";

/** A measured price (an amount of a currency item) as label and state of a StatValue. */
export type MeasuredPrice = CraftingPlan["expectedTotal"];

export function priceLabel(price: MeasuredPrice, view: GuideView): string {
  if (price.status !== "ok") return "Cost";
  const currency = nameOf(view, { kind: "baseItem", id: price.value.currencyItemId });
  return `Cost in ${currency ?? price.value.currencyItemId}`;
}

export function priceState(price: MeasuredPrice): ValueState {
  return price.status === "ok"
    ? measuredState({ status: "ok", value: price.value.amount, source: price.source })
    : measuredState(price);
}
