import { useState } from "react";
import {
  Button,
  Callout,
  CodexProse,
  ItemTooltip,
  Panel,
  StatGrid,
  StatValue,
  Tabs,
} from "@exileforge/ui";
import type { SampleStage } from "../fixtures/sample-build";
import { SAMPLE_BUILD, SAMPLE_ITEMS, SAMPLE_STAGES } from "../fixtures/sample-build";
import { PageHeader } from "../shell/PageHeader";

export function BuildOverview() {
  // Opens on the second stage so the timeline shows cooled, glowing and cold ingots.
  const [stage, setStage] = useState(SAMPLE_STAGES[1]?.id ?? "");
  return (
    <div className="page">
      <PageHeader
        kicker={SAMPLE_BUILD.kicker}
        title={SAMPLE_BUILD.name}
        subtitle={SAMPLE_BUILD.idea}
        actions={
          <Button variant="secondary" onClick={() => (window.location.hash = "#/design")}>
            Design System
          </Button>
        }
      />
      <Callout tone="info" title="Sample data">
        Every number on this page is a made-up value from <code>calc-fake</code>. Real values come
        from Path of Building once the calc service is connected.
      </Callout>
      <Tabs
        label="Guide stages"
        variant="timeline"
        value={stage}
        onChange={setStage}
        items={SAMPLE_STAGES.map((s) => ({
          id: s.id,
          label: s.label,
          hint: s.levels,
          content: <StageView stage={s} />,
        }))}
      />
    </div>
  );
}

function StageView({ stage }: { stage: SampleStage }) {
  return (
    <div className="stage">
      <div className="stage__top">
        <Panel title={`Forged Stats · ${stage.label}`} kicker={stage.levels}>
          <StatGrid>
            {stage.stats.map((s) => (
              <StatValue
                key={s.id}
                label={s.label}
                state={s.state}
                format={s.format}
                emphasis={s.emphasis ?? false}
              />
            ))}
          </StatGrid>
        </Panel>
        <Panel title="From the Codex" variant="recessed">
          <CodexProse>
            <p>{stage.notes.join(" ")}</p>
          </CodexProse>
        </Panel>
      </div>
      <Panel title="Equipment" kicker="Modifier priority from top to bottom">
        <div className="item-row">
          {SAMPLE_ITEMS.map((item) => (
            <ItemTooltip key={item.id} item={item} showTiers={item.rarity === "rare"} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
