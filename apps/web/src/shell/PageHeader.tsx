import type { ReactNode } from "react";
import { OrnamentDivider } from "@exileforge/ui";

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__row">
        <div>
          <p className="page-header__kicker">{kicker}</p>
          <h1 className="page-header__title">{title}</h1>
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
      <OrnamentDivider className="page-header__divider" />
    </header>
  );
}
