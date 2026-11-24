import { useState } from "react";
import type { ProvenanceView } from "@exileforge/ui";
import {
  Badge,
  Button,
  COLOR_TOKEN_GROUPS,
  Callout,
  CodexProse,
  ItemTooltip,
  Ledger,
  OrnamentDivider,
  Panel,
  ProvenanceBadge,
  SPACE_STEPS,
  Sigil,
  StatGrid,
  StatValue,
  Tabs,
  colorVar,
} from "@exileforge/ui";
import { SAMPLE_ITEMS } from "../fixtures/sample-build";
import { PageHeader } from "../shell/PageHeader";

// Gallery of every token and component. Doubles as the screenshot target
// for visual regression tests (e2e/smoke.spec.ts).

const PROVENANCE_EXAMPLES: readonly ProvenanceView[] = [
  { kind: "pob", pobVersion: "x.y.z", calcProfile: "profile" },
  { kind: "market", provider: "Provider", fetchedAt: "fetch time" },
  { kind: "derived", formula: "attempts × price" },
  { kind: "gamedata", dataRelease: "data release" },
  { kind: "sample", fixture: "calc-fake" },
];

export function DesignSystem() {
  const [tab, setTab] = useState("a");
  const [stage, setStage] = useState("s2");
  return (
    <div className="page">
      <PageHeader
        kicker="Reference"
        title="Design System"
        subtitle="Tokens, typography and building blocks of ExileForge. Original artwork, no game assets."
      />

      <div className="gallery">
        <Panel title="Colours" kicker="Tokens only, never raw values" className="gallery__wide">
          <div className="swatch-groups">
            {COLOR_TOKEN_GROUPS.map((group) => (
              <div key={group.title} className="swatch-group">
                <h3 className="gallery__label">{group.title}</h3>
                <ul className="swatches">
                  {group.tokens.map((token) => (
                    <li key={token} className="swatch">
                      <span className="swatch__chip" style={{ background: colorVar(token) }} />
                      <code className="swatch__name">{token}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Typography" kicker="Grenze Gotisch · Alegreya Sans · IM Fell English">
          <div className="type-samples">
            <p className="type-sample type-sample--display ef-molten">The Forge of the Exiled</p>
            <p className="type-sample type-sample--h2">Heading Level 2</p>
            <p className="type-sample type-sample--h3">Heading Level 3</p>
            <p className="type-sample">
              Body text for guides: easy to read even on a second monitor, with clear figures and
              punctuation.
            </p>
            <p className="type-sample type-sample--small">Small text for metadata and provenance</p>
            <p className="type-sample type-sample--numbers ef-numeric">1,234,567 · 89.5% · ×2.40</p>
            <p className="type-sample type-sample--flavour">Forged from ash, tempered in embers.</p>
            <p className="type-sample type-sample--codex">Codex text for the guide reader</p>
          </div>
        </Panel>

        <Panel title="Spacing" kicker="4 · 8 · 12 · 16 · 24 · 32 · 48 px">
          <ul className="space-scale">
            {SPACE_STEPS.map((step) => (
              <li key={step} className="space-scale__row">
                <code className="swatch__name">space-{step}</code>
                <span className="space-scale__bar" style={{ width: `var(--ef-space-${step})` }} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Buttons">
          <div className="row">
            <Button variant="primary">Forge Build</Button>
            <Button variant="secondary">Choose Variant</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Discard Stage</Button>
          </div>
          <div className="row">
            <Button variant="primary" size="sm">
              Small
            </Button>
            <Button variant="secondary" size="sm">
              Small
            </Button>
            <Button variant="secondary" busy>
              Calculating
            </Button>
            <Button variant="secondary" disabled>
              Locked
            </Button>
          </div>
        </Panel>

        <Panel title="Tabs">
          <Tabs
            label="Example timeline"
            variant="timeline"
            value={stage}
            onChange={setStage}
            items={[
              { id: "s1", label: "Start", hint: "Level 1–12", content: null },
              { id: "s2", label: "Build-up", hint: "Level 13–28", content: null },
              { id: "s3", label: "Transition", hint: "Level 29–52", content: null },
              { id: "s4", label: "Endgame", hint: "Level 53+", content: null },
            ]}
          />
          <Tabs
            label="Example tabs"
            value={tab}
            onChange={setTab}
            items={[
              { id: "a", label: "Leveling", hint: "Level 1–52", content: <p>Leveling content</p> },
              { id: "b", label: "Endgame", hint: "Level 53+", content: <p>Endgame content</p> },
              { id: "c", label: "Locked", disabled: true, content: null },
            ]}
          />
        </Panel>

        <Panel title="Badges and Provenance" kicker="Every number names its source">
          <div className="row">
            <Badge>Neutral</Badge>
            <Badge tone="gold">Recommended</Badge>
            <Badge tone="success">Verified</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="warning">Outdated</Badge>
            <Badge tone="danger">Error</Badge>
          </div>
          <ul className="prov-list">
            {PROVENANCE_EXAMPLES.map((p) => (
              <li key={p.kind}>
                <ProvenanceBadge provenance={p} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Ornaments" kicker="Original SVGs, no game assets">
          <div className="ornament-row">
            <Sigil size={64} title="ExileForge sigil" />
            <Sigil size={40} />
            <Sigil size={24} />
          </div>
          <OrnamentDivider className="gallery__divider" />
          <Panel title="Recessed Panel" variant="recessed">
            <p>A sunken tray for content inside a plate.</p>
          </Panel>
        </Panel>

        <Panel title="Stat States" className="gallery__wide">
          <StatGrid>
            <StatValue
              label="Ready"
              emphasis
              state={{
                status: "ready",
                value: 48210,
                provenance: { kind: "sample", fixture: "calc-fake" },
              }}
            />
            <StatValue
              label="Outdated"
              state={{
                status: "ready",
                value: 1200,
                stale: true,
                provenance: { kind: "sample", fixture: "calc-fake" },
              }}
            />
            <StatValue label="Loading" state={{ status: "loading" }} />
            <StatValue
              label="Error"
              state={{ status: "error", message: "PoB worker unreachable" }}
            />
            <StatValue
              label="Uncalibrated"
              state={{ status: "uncalibrated", reason: "No market data" }}
            />
          </StatGrid>
        </Panel>

        <Panel title="Codex" kicker="Guide reader: ledger and prose">
          <Ledger
            caption="The Reckoning"
            rows={[
              {
                id: "dps",
                label: "Hit DPS",
                emphasis: true,
                state: {
                  status: "ready",
                  value: 6120,
                  provenance: { kind: "sample", fixture: "calc-fake" },
                },
              },
              { id: "ehp", label: "Effective Hit Pool", state: { status: "loading" } },
              {
                id: "cost",
                label: "Stage Cost",
                state: { status: "error", message: "worker timed out" },
              },
            ]}
          />
        </Panel>

        <Panel title="Codex Prose">
          <CodexProse>
            <p>
              Pick up a second ember source before the transition, then swap both rings for ones
              with resistance.
            </p>
            <p>Keep the starting staff until the twentieth level.</p>
          </CodexProse>
        </Panel>

        <Panel title="Messages" className="gallery__wide">
          <div className="stack">
            <Callout tone="info" title="New data release available">
              Saved guides are being rechecked in the background.
            </Callout>
            <Callout tone="success" title="All checks passed" />
            <Callout tone="warning" title="Two values are outdated">
              They come from an older data release.
            </Callout>
            <Callout
              tone="danger"
              title="Calculation failed"
              actions={
                <Button size="sm" variant="danger">
                  Retry
                </Button>
              }
            >
              The PoB worker did not respond. No value is shown.
            </Callout>
          </div>
        </Panel>

        <Panel
          title="Item Cards"
          kicker="Normal · Magic · Rare (planner view with tiers) · Unique"
          className="gallery__wide"
        >
          <div className="item-row">
            {[...SAMPLE_ITEMS].reverse().map((item) => (
              <ItemTooltip key={item.id} item={item} showTiers={item.rarity === "rare"} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
