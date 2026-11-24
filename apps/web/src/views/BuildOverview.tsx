import { useState } from "react";
import { Button, Callout, ItemTooltip, Panel, StatGrid, StatValue, Tabs } from "@exileforge/ui";
import type { SampleStage } from "../fixtures/sample-build";
import { SAMPLE_BUILD, SAMPLE_ITEMS, SAMPLE_STAGES } from "../fixtures/sample-build";
import { PageHeader } from "../shell/PageHeader";

export function BuildOverview() {
  const [stage, setStage] = useState(SAMPLE_STAGES[0]?.id ?? "");
  return (
    <div className="page">
      <PageHeader
        kicker={SAMPLE_BUILD.kicker}
        title={SAMPLE_BUILD.name}
        subtitle={SAMPLE_BUILD.idea}
        actions={
          <Button variant="secondary" onClick={() => (window.location.hash = "#/design")}>
            Design-System
          </Button>
        }
      />
      <Callout tone="info" title="Beispieldaten">
        Alle Zahlen auf dieser Seite sind Fantasiewerte aus <code>calc-fake</code>. Echte Werte
        kommen aus Path of Building, sobald der Calc-Service angebunden ist.
      </Callout>
      <Tabs
        label="Stufen des Guides"
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
        <Panel title="Kennzahlen" kicker={stage.levels} className="stage__stats">
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
        <Panel title="Hinweise" variant="plain" className="stage__notes">
          <ol className="notes">
            {stage.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ol>
        </Panel>
      </div>
      <Panel title="Ausrüstung" kicker="Priorität der Mods von oben nach unten">
        <div className="item-row">
          {SAMPLE_ITEMS.map((item) => (
            <ItemTooltip key={item.id} item={item} showTiers={item.rarity === "rare"} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
