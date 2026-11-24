import { useState } from "react";
import type { ProvenanceView } from "@exileforge/ui";
import {
  Badge,
  Button,
  COLOR_TOKEN_GROUPS,
  Callout,
  ItemTooltip,
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
// for visual regression tests (e2e/design-system.spec.ts).

const PROVENANCE_EXAMPLES: readonly ProvenanceView[] = [
  { kind: "pob", pobVersion: "x.y.z", calcProfile: "Profil" },
  { kind: "market", provider: "Anbieter", fetchedAt: "Abrufzeit" },
  { kind: "derived", formula: "Versuche × Preis" },
  { kind: "gamedata", dataRelease: "Daten-Release" },
  { kind: "sample", fixture: "calc-fake" },
];

export function DesignSystem() {
  const [tab, setTab] = useState("a");
  return (
    <div className="page">
      <PageHeader
        kicker="Referenz"
        title="Design-System"
        subtitle="Tokens, Schrift und Bausteine von ExileForge. Eigene Gestaltung, keine Spielgrafiken."
      />

      <div className="gallery">
        <Panel title="Farben" kicker="Nur über Tokens, nie freie Werte" className="gallery__wide">
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

        <Panel title="Schrift" kicker="Cinzel · Source Sans 3 · EB Garamond">
          <div className="type-samples">
            <p className="type-sample type-sample--display">Die Schmiede der Verbannten</p>
            <p className="type-sample type-sample--h2">Überschrift Ebene 2</p>
            <p className="type-sample type-sample--h3">Überschrift Ebene 3</p>
            <p className="type-sample">
              Fließtext für Guides: gut lesbar auch auf dem zweiten Bildschirm, mit Umlauten ÄÖÜ und
              ß.
            </p>
            <p className="type-sample type-sample--small">Kleintext für Metadaten und Herkunft</p>
            <p className="type-sample type-sample--numbers ef-numeric">
              1.234.567 · 89,5 % · ×2,40
            </p>
            <p className="type-sample type-sample--flavour">
              Aus Asche geschmiedet, in Glut gehärtet.
            </p>
          </div>
        </Panel>

        <Panel title="Abstände" kicker="4 · 8 · 12 · 16 · 24 · 32 · 48 px">
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
            <Button variant="primary">Build schmieden</Button>
            <Button variant="secondary">Variante wählen</Button>
            <Button variant="ghost">Abbrechen</Button>
            <Button variant="danger">Stufe verwerfen</Button>
          </div>
          <div className="row">
            <Button variant="primary" size="sm">
              Klein
            </Button>
            <Button variant="secondary" size="sm">
              Klein
            </Button>
            <Button variant="secondary" busy>
              PoB rechnet
            </Button>
            <Button variant="secondary" disabled>
              Gesperrt
            </Button>
          </div>
        </Panel>

        <Panel title="Tabs">
          <Tabs
            label="Beispiel-Tabs"
            value={tab}
            onChange={setTab}
            items={[
              { id: "a", label: "Leveling", hint: "Stufe 1–52", content: <p>Inhalt Leveling</p> },
              { id: "b", label: "Endgame", hint: "Stufe 53+", content: <p>Inhalt Endgame</p> },
              { id: "c", label: "Gesperrt", disabled: true, content: null },
            ]}
          />
        </Panel>

        <Panel title="Badges und Herkunft" kicker="Jede Zahl nennt ihre Quelle">
          <div className="row">
            <Badge>Neutral</Badge>
            <Badge tone="gold">Empfohlen</Badge>
            <Badge tone="success">Geprüft</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="warning">Veraltet</Badge>
            <Badge tone="danger">Fehler</Badge>
          </div>
          <ul className="prov-list">
            {PROVENANCE_EXAMPLES.map((p) => (
              <li key={p.kind}>
                <ProvenanceBadge provenance={p} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Ornamente" kicker="Eigene SVGs, keine Spielgrafiken">
          <div className="ornament-row">
            <Sigil size={64} title="ExileForge-Zeichen" />
            <Sigil size={40} />
            <Sigil size={24} />
          </div>
          <OrnamentDivider className="gallery__divider" />
          <Panel title="Verschachteltes Panel" variant="plain">
            <p>Ohne Eckornamente, für Inhalte innerhalb eines Rahmens.</p>
          </Panel>
        </Panel>

        <Panel title="Kennzahlen-Zustände" className="gallery__wide">
          <StatGrid>
            <StatValue
              label="Bereit"
              emphasis
              state={{
                status: "ready",
                value: 48210,
                provenance: { kind: "sample", fixture: "calc-fake" },
              }}
            />
            <StatValue
              label="Veraltet"
              state={{
                status: "ready",
                value: 1200,
                stale: true,
                provenance: { kind: "sample", fixture: "calc-fake" },
              }}
            />
            <StatValue label="Lädt" state={{ status: "loading" }} />
            <StatValue
              label="Fehler"
              state={{ status: "error", message: "PoB-Worker nicht erreichbar" }}
            />
            <StatValue
              label="Unkalibriert"
              state={{ status: "uncalibrated", reason: "Keine Marktdaten" }}
            />
          </StatGrid>
        </Panel>

        <Panel title="Hinweise" className="gallery__wide">
          <div className="stack">
            <Callout tone="info" title="Neues Daten-Release verfügbar">
              Gespeicherte Guides werden im Hintergrund neu geprüft.
            </Callout>
            <Callout tone="success" title="Alle Prüfungen bestanden" />
            <Callout tone="warning" title="Zwei Werte sind veraltet">
              Sie stammen aus einem älteren Daten-Release.
            </Callout>
            <Callout
              tone="danger"
              title="Rechnung fehlgeschlagen"
              actions={
                <Button size="sm" variant="danger">
                  Erneut versuchen
                </Button>
              }
            >
              Der PoB-Worker hat nicht geantwortet. Es wird kein Wert angezeigt.
            </Callout>
          </div>
        </Panel>

        <Panel
          title="Item-Karten"
          kicker="Normal · Magisch · Selten (Planer-Ansicht mit Tiers) · Einzigartig"
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
