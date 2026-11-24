import { useState } from "react";
import {
  Button,
  Callout,
  GuideNotes,
  ItemTooltip,
  Panel,
  ProvenanceBadge,
  StatGrid,
  StatValue,
  Tabs,
  formatNumber,
} from "@exileforge/ui";
import type { SampleStage, SampleStat } from "../fixtures/sample-build";
import { SAMPLE_BUILD, SAMPLE_ITEMS, SAMPLE_STAGES } from "../fixtures/sample-build";
import { PageHeader } from "../shell/PageHeader";

export function BuildOverview() {
  // Opens on the second stage so the dial shows done, current and upcoming marks.
  const [stage, setStage] = useState(SAMPLE_STAGES[1]?.id ?? "");
  const current = SAMPLE_STAGES.find((s) => s.id === stage);
  const keyStat = current?.stats.find((s) => s.emphasis);
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
        variant="dial"
        value={stage}
        onChange={setStage}
        dialCenter={keyStat ? <DialReadout stat={keyStat} /> : null}
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

/** Key figure in the centre of the dial. Shows the state, never a fallback number. */
function DialReadout({ stat }: { stat: SampleStat }) {
  const { state } = stat;
  return (
    <div className="dial-readout">
      <span className="dial-readout__label">{stat.label}</span>
      {state.status === "ready" && Number.isFinite(state.value) ? (
        <>
          <span className="dial-readout__value ef-numeric">
            {formatNumber(state.value, stat.format)}
          </span>
          <ProvenanceBadge provenance={state.provenance} />
        </>
      ) : (
        <span className="dial-readout__status">
          {state.status === "loading"
            ? "Calculating …"
            : state.status === "error"
              ? "Unavailable"
              : state.status === "uncalibrated"
                ? "Uncalibrated"
                : "Invalid value"}
        </span>
      )}
    </div>
  );
}

function StageView({ stage }: { stage: SampleStage }) {
  return (
    <div className="stage">
      <Panel title={stage.label} kicker={`Readouts · ${stage.levels}`}>
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
      <Panel title="Notes" kicker="Guide" variant="recessed">
        <GuideNotes>
          {stage.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </GuideNotes>
      </Panel>
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
