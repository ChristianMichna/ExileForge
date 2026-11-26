import type { EntityRef } from "@astrolabe/contracts/common";
import type { GuideView } from "@astrolabe/contracts/guide";
import { Badge, Panel } from "@astrolabe/ui";
import { RichTextView, nameOf } from "../guide/RichTextView";

/*
 * The written parts of a guide after its numbers: how to play, the atlas strategy, variants and
 * the troubleshooting questions. Names come from the server's catalog; an entity it does not know
 * is shown as its id and marked as unresolved.
 */

const VARIANT_LABEL = {
  alternative: "Alternative",
  hardcore: "Hardcore",
  ssf: "Solo self-found",
} as const;

function EntityName({ view, entity }: { view: GuideView; entity: EntityRef }) {
  const name = nameOf(view, entity);
  return name === undefined ? (
    <span className="guide-unresolved" title="Not in the catalog of this release">
      {entity.id}
    </span>
  ) : (
    <strong>{name}</strong>
  );
}

function Prose({
  title,
  view,
  text,
}: {
  title: string;
  view: GuideView;
  text: Parameters<typeof RichTextView>[0]["text"];
}) {
  return (
    <>
      <h3>{title}</h3>
      <p>
        <RichTextView text={text} view={view} />
      </p>
    </>
  );
}

export function PlaystyleSection({ view }: { view: GuideView }) {
  const { playstyle } = view.guide;
  return (
    <Panel title="Playstyle" kicker="How to play it">
      <Prose title="Rotation" view={view} text={playstyle.rotation} />
      {playstyle.keybinds === undefined ? null : (
        <Prose title="Keybinds" view={view} text={playstyle.keybinds} />
      )}
      <Prose title="Mapping" view={view} text={playstyle.mapping} />
      <Prose title="Bossing" view={view} text={playstyle.bossing} />
      <Prose title="Positioning" view={view} text={playstyle.positioning} />
      {playstyle.bossMechanics.length > 0 ? (
        <>
          <h3>Boss mechanics</h3>
          <ul>
            {playstyle.bossMechanics.map((m, i) => (
              <li key={i}>
                {m.subject === undefined ? null : (
                  <>
                    <EntityName view={view} entity={m.subject} />:{" "}
                  </>
                )}
                <RichTextView text={m.advice} view={view} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

export function AtlasSection({ view }: { view: GuideView }) {
  const { atlas } = view.guide;
  return (
    <Panel title="Atlas" kicker="Endgame strategy">
      <p>
        <RichTextView text={atlas.strategy} view={view} />
      </p>
      {atlas.avoidMods.length > 0 ? (
        <>
          <h3>Map modifiers to avoid</h3>
          <ul>
            {atlas.avoidMods.map((m) => (
              <li key={m.modId}>
                <EntityName view={view} entity={{ kind: "mod", id: m.modId }} />:{" "}
                <RichTextView text={m.reason} view={view} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

export function VariantsSection({ view }: { view: GuideView }) {
  const { variants } = view.guide;
  if (variants.length === 0) return null;
  return (
    <Panel title="Variants" kicker="Other ways to play it">
      <ul className="guide-variants">
        {variants.map((v, i) => (
          <li key={i}>
            <Badge>{VARIANT_LABEL[v.kind]}</Badge>{" "}
            {v.replaces === undefined ? null : (
              <>
                Replace <EntityName view={view} entity={v.replaces} />
                {v.with.length > 0 ? " with " : ""}
              </>
            )}
            {v.with.map((w, j) => (
              <span key={`${w.kind}:${w.id}`}>
                {j > 0 ? ", " : ""}
                <EntityName view={view} entity={w} />
              </span>
            ))}
            <p>
              <RichTextView text={v.explanation} view={view} />
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function FaqSection({ view }: { view: GuideView }) {
  const { faq } = view.guide;
  if (faq.length === 0) return null;
  return (
    <Panel title="Troubleshooting" kicker="Questions">
      {faq.map((entry, i) => (
        <details key={i} className="guide-faq">
          <summary>
            <RichTextView text={entry.question} view={view} />
          </summary>
          <p>
            <RichTextView text={entry.answer} view={view} />
          </p>
          {entry.checklist.length > 0 ? (
            <ul>
              {entry.checklist.map((c, j) => (
                <li key={j}>
                  <RichTextView text={c} view={view} />
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ))}
    </Panel>
  );
}
