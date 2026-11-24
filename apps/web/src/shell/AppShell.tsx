import type { ReactNode } from "react";
import { Badge, Diamond, Sigil } from "@exileforge/ui";
import type { RouteId } from "./route";
import { NAV } from "./route";

export function AppShell({ route, children }: { route: RouteId; children: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/" aria-label="ExileForge, go to build overview">
          <Sigil size={34} />
          <span className="brand__name">ExileForge</span>
        </a>
        <div className="topbar__status">
          <Badge tone="warning">Sample data</Badge>
          <Badge>PoB not connected</Badge>
        </div>
      </header>
      <nav className="sidebar" aria-label="Main navigation">
        <ul className="nav">
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
                    <Diamond className="nav__mark" />
                    {entry.label}
                  </a>
                ) : (
                  <span className="nav__link nav__link--upcoming" aria-disabled="true">
                    <Diamond className="nav__mark" />
                    {entry.label}
                    <span className="nav__soon">soon</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="content">{children}</main>
      <footer className="footer">
        Fan project. Not affiliated with or endorsed by Grinding Gear Games. Path of Exile is a
        trademark of Grinding Gear Games.
      </footer>
    </div>
  );
}
