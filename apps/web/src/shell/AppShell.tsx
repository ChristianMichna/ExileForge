import type { ReactNode } from "react";
import { Badge, Sigil } from "@exileforge/ui";
import type { RouteId } from "./route";
import { NAV } from "./route";

// Static ember specks; purely decorative, positioned in app.css.
const EMBERS = [1, 2, 3, 4, 5, 6] as const;

export function AppShell({ route, children }: { route: RouteId; children: ReactNode }) {
  return (
    <div className="shell">
      <div className="embers" aria-hidden="true">
        {EMBERS.map((n) => (
          <span key={n} className={`ember ember--${n}`} />
        ))}
      </div>
      <header className="topbar">
        <a className="brand" href="#/" aria-label="ExileForge, go to build overview">
          <Sigil size={44} />
          <span className="brand__name ef-molten">ExileForge</span>
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
          <Badge tone="gold">Sample data</Badge>
          <Badge>PoB offline</Badge>
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
