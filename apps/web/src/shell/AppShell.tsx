import type { ReactNode } from "react";
import { Badge, Sigil } from "@exileforge/ui";
import type { RouteId } from "./route";
import { NAV } from "./route";

export function AppShell({ route, children }: { route: RouteId; children: ReactNode }) {
  return (
    <div className="shell">
      <svg className="engraving" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle cx="50" cy="50" r="49" />
        <circle cx="50" cy="50" r="38" />
        <circle className="engraving__ticks" cx="50" cy="50" r="44" />
        <path d="M50 1 V99 M1 50 H99" />
      </svg>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="ExileForge, go to build overview">
          <Sigil size={36} />
          <span className="brand__name">
            Exile<span className="brand__accent">Forge</span>
          </span>
        </a>
        <nav className="nav" aria-label="Main navigation">
          <ul className="nav__list">
            {NAV.map((entry) => {
              const current = entry.id === route;
              return (
                <li key={entry.id}>
                  {entry.href ? (
                    <a
                      className="nav__link"
                      href={entry.href}
                      aria-current={current ? "page" : undefined}
                    >
                      {entry.label}
                    </a>
                  ) : (
                    <span className="nav__link nav__link--upcoming" aria-disabled="true">
                      {entry.label}
                      <span className="nav__soon">soon</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="topbar__status">
          <Badge tone="accent">Sample data</Badge>
          <Badge tone="warning">PoB offline</Badge>
        </div>
      </header>
      <main className="content">{children}</main>
      <footer className="footer">
        Fan project. Not affiliated with or endorsed by Grinding Gear Games. Path of Exile is a
        trademark of Grinding Gear Games.
      </footer>
    </div>
  );
}
