import type { RichText } from "@astrolabe/contracts/build";
import type { GuideView } from "@astrolabe/contracts/guide";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** Key of an entity in `GuideView.names`. */
export const nameKey = (ref: { kind: string; id: string }): string => `${ref.kind}:${ref.id}`;

/** Name of an entity, or undefined when the server could not resolve it. */
export function nameOf(view: GuideView, ref: { kind: string; id: string }): string | undefined {
  return view.names[nameKey(ref)];
}

/**
 * Guide prose: text as written, entities by their catalog name and numbers from the stored
 * calculation they reference. What cannot be resolved is shown as such, never as a made-up value.
 */
export function RichTextView({ text, view }: { text: RichText; view: GuideView }) {
  return (
    <>
      {text.map((segment, i) => {
        if (segment.type === "text") return <span key={i}>{segment.text}</span>;
        if (segment.type === "entity") {
          const name = nameOf(view, segment.ref);
          return name === undefined ? (
            <span key={i} className="guide-unresolved" title="Not in the catalog of this release">
              {segment.ref.id}
            </span>
          ) : (
            <strong key={i}>{name}</strong>
          );
        }
        if (segment.type === "source") {
          const at = view.guide.research.findIndex((f) => f.id === segment.id);
          const finding = view.guide.research[at];
          return finding === undefined ? (
            <span
              key={i}
              className="guide-unresolved"
              title="This source is not listed in the guide"
            >
              [{segment.id}]
            </span>
          ) : (
            <sup key={i} className="guide-cite">
              <a
                href={finding.source.url}
                target="_blank"
                rel="noreferrer"
                title={finding.source.title}
              >
                [{at + 1}]
              </a>
            </sup>
          );
        }
        const result = view.results[segment.ref.calcId];
        const value = result?.stats[segment.ref.stat];
        if (result === undefined || value === undefined) {
          return (
            <span
              key={i}
              className="guide-unresolved"
              title="The stored calculation is not available"
            >
              {segment.ref.stat}
            </span>
          );
        }
        return (
          <span
            key={i}
            className="ef-numeric"
            title={`Path of Building ${result.pobVersion}, profile ${result.calcProfile}`}
          >
            {number.format(value)}
          </span>
        );
      })}
    </>
  );
}
