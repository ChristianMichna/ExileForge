// Placeholder screen. It exists so typecheck, unit tests, build and the
// Playwright screenshot test have a real target. The actual UI (design
// system, tree, item cards) comes with its own ticket via the poe-ui-design
// skill and replaces this file and its screenshot baseline.

export function App() {
  return (
    <main className="shell">
      <h1 className="title">ExileForge</h1>
      <p className="subtitle">Im Aufbau</p>
      <p className="notice">
        Fan-Projekt. Nicht mit Grinding Gear Games verbunden oder von ihnen unterstützt.
      </p>
    </main>
  );
}
