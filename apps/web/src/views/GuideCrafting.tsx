import type { CraftOnFail, CraftStep, CraftingPlan } from "@astrolabe/contracts/build";
import type { GuideView } from "@astrolabe/contracts/guide";
import { Panel, StatGrid, StatValue } from "@astrolabe/ui";
import { measuredState } from "../guide/measured";
import { RichTextView, nameOf } from "../guide/RichTextView";

/*
 * The crafting plans of a guide as a flow: the base item, then every step with its goal, chance,
 * expected attempts and cost, and what happens when a step fails. Chances, attempts and prices
 * keep their source; a value the engine does not have is shown as uncalibrated, never as 0.
 */

function failText(onFail: CraftOnFail, view: GuideView): React.ReactNode {
  switch (onFail.action) {
    case "repeat":
      return "On failure: repeat the step";
    case "restart":
      return "On failure: start again from the base item";
    case "accept":
      return "On failure: keep the item as it is";
    case "goto":
      return `On failure: go to step ${onFail.order + 1}`;
    case "abort":
      return (
        <>
          On failure: stop. <RichTextView text={onFail.reason} view={view} />
        </>
      );
  }
}

function priceLabel(price: CraftingPlan["expectedTotal"], view: GuideView): string {
  if (price.status !== "ok") return "Cost";
  const currency = nameOf(view, { kind: "baseItem", id: price.value.currencyItemId });
  return `Cost in ${currency ?? price.value.currencyItemId}`;
}

function priceState(price: CraftingPlan["expectedTotal"]) {
  return price.status === "ok"
    ? measuredState({ status: "ok", value: price.value.amount, source: price.source })
    : measuredState(price);
}

function StepNode({ step, view }: { step: CraftStep; view: GuideView }) {
  const actions = step.actionIds.map((id) => nameOf(view, { kind: "craftingAction", id }) ?? id);
  return (
    <li className="craft-step">
      <div className="craft-step__card">
        <p className="craft-step__order">Step {step.order + 1}</p>
        <h4>{actions.join(" + ")}</h4>
        <p>
          <RichTextView text={step.goal} view={view} />
        </p>
        <StatGrid>
          <StatValue
            label="Chance"
            format="percent"
            state={measuredState(step.successChance, 100)}
          />
          <StatValue
            label="Expected attempts"
            format="decimal1"
            state={measuredState(step.expectedAttempts)}
          />
          <StatValue
            label={priceLabel(step.expectedCost, view)}
            state={priceState(step.expectedCost)}
          />
        </StatGrid>
        <p className="craft-step__fail">{failText(step.onFail, view)}</p>
      </div>
    </li>
  );
}

function Plan({ plan, view }: { plan: CraftingPlan; view: GuideView }) {
  const base = nameOf(view, { kind: "baseItem", id: plan.start.baseItemId });
  return (
    <Panel
      title={plan.slot}
      kicker={plan.tier === undefined ? "Crafting plan" : `Crafting plan · ${plan.tier}`}
    >
      <ol className="craft-flow">
        <li className="craft-step craft-step--start">
          <div className="craft-step__card">
            <p className="craft-step__order">Start</p>
            <h4>{base ?? plan.start.baseItemId}</h4>
            <p>Item level {plan.start.itemLevel}</p>
            <StatGrid>
              <StatValue
                label={priceLabel(plan.start.cost, view)}
                state={priceState(plan.start.cost)}
              />
            </StatGrid>
          </div>
        </li>
        {[...plan.steps]
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <StepNode key={step.order} step={step} view={view} />
          ))}
      </ol>
      <StatGrid>
        <StatValue
          label={`Expected total · ${priceLabel(plan.expectedTotal, view)}`}
          emphasis
          state={priceState(plan.expectedTotal)}
        />
      </StatGrid>
      {plan.fallback === undefined ? null : (
        <p>
          <strong>If it does not work out: </strong>
          <RichTextView text={plan.fallback} view={view} />
        </p>
      )}
    </Panel>
  );
}

export function CraftingSection({ view }: { view: GuideView }) {
  if (view.guide.crafting.length === 0) return null;
  return (
    <>
      {view.guide.crafting.map((plan) => (
        <Plan key={plan.key} plan={plan} view={view} />
      ))}
    </>
  );
}
