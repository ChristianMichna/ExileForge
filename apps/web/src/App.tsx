import { AppShell } from "./shell/AppShell";
import { useRoute } from "./shell/route";
import { BuildOverview } from "./views/BuildOverview";
import { DesignSystem } from "./views/DesignSystem";

export function App() {
  const route = useRoute();
  return (
    <AppShell route={route}>{route === "design" ? <DesignSystem /> : <BuildOverview />}</AppShell>
  );
}
