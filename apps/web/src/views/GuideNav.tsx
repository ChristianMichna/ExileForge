import { useEffect, useState } from "react";

/*
 * The index of the guide page: a rail that stays in view, lists the sections and marks the one the
 * reader is in. Sections are plain elements with an id; nothing here knows the guide's content.
 */

export interface NavSection {
  readonly id: string;
  readonly label: string;
}

export function GuideNav({ sections }: { sections: readonly NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // The first section on screen, in the order of the guide, is the one being read.
        const current = sections.find((s) => visible.has(s.id));
        if (current !== undefined) setActive(current.id);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);
  return (
    <nav className="guide-nav" aria-label="Guide sections">
      <ol>
        {sections.map((s, i) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={
                s.id === active ? "guide-nav__link guide-nav__link--active" : "guide-nav__link"
              }
              aria-current={s.id === active ? "location" : undefined}
              onClick={(e) => {
                // The page itself routes by hash, so a section link scrolls instead of navigating.
                e.preventDefault();
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActive(s.id);
              }}
            >
              <span className="guide-nav__index">{String(i + 1).padStart(2, "0")}</span>
              {s.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
