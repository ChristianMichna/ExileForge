import { AppShell } from "./shell/AppShell";
import { useRoute } from "./shell/route";
import { BuildOverview } from "./views/BuildOverview";
import { DesignSystem } from "./views/DesignSystem";
import { GuidePage } from "./views/GuidePage";
import { PassiveTreePage } from "./views/PassiveTreePage";
import { PlanWithClaude } from "./views/PlanWithClaude";

export function App() {
  const route = useRoute();
  return (
    <AppShell route={route}>
      {route === "design" ? (
        <DesignSystem />
      ) : route === "tree" ? (
        <PassiveTreePage />
      ) : route === "plan" ? (
        <PlanWithClaude />
      ) : route === "guide" ? (
        <GuidePage />
      ) : (
        <BuildOverview />
      )}
    </AppShell>
  );
}
