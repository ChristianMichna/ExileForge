import { AppShell } from "./shell/AppShell";
import { useRoute } from "./shell/route";
import { BuildOverview } from "./views/BuildOverview";
import { DesignSystem } from "./views/DesignSystem";
import { PlanWithClaude } from "./views/PlanWithClaude";

export function App() {
  const route = useRoute();
  return (
    <AppShell route={route}>
      {route === "design" ? (
        <DesignSystem />
      ) : route === "plan" ? (
        <PlanWithClaude />
      ) : (
        <BuildOverview />
      )}
    </AppShell>
  );
}
