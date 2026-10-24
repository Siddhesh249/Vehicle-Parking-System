import "./App.css";
import { mockApi } from "./api/mockApi.js";
import AdminConsole from "./components/AdminConsole.jsx";
import EntryConsole from "./components/EntryConsole.jsx";
import ExitConsole from "./components/ExitConsole.jsx";
import LotMap from "./components/LotMap.jsx";

const consoles = [
  { path: "/entry-1", label: "Entry Gate 1", role: "Entry operator", gateId: "Entry-1" },
  { path: "/entry-2", label: "Entry Gate 2", role: "Entry operator", gateId: "Entry-2" },
  { path: "/exit-1", label: "Exit Gate 1", role: "Exit operator", gateId: "Exit-1" },
  { path: "/exit-2", label: "Exit Gate 2", role: "Exit operator", gateId: "Exit-2" },
  { path: "/admin", label: "Admin Dashboard", role: "Admin" },
];

// Renders the working console for a route. Uses the mock API until the real client lands in Sprint 3.
function ConsoleView({ gateId, role }) {
  if (role === "Admin") return <AdminConsole api={mockApi} />;
  if (gateId.startsWith("Entry")) return <EntryConsole gateId={gateId} api={mockApi} />;
  return <ExitConsole gateId={gateId} api={mockApi} />;
}

function App() {
  const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
  const currentConsole = consoles.find(({ path }) => path === currentPath);

  return (
    <main className="parking-app">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Parkwise home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>Parkwise</span>
        </a>
        <span className="environment-label">Parking operations</span>
      </header>

      <section className="welcome-panel" aria-labelledby="page-title">
        <p className="eyebrow">VEHICLE PARKING SYSTEM</p>
        <h1 id="page-title">
          {currentConsole ? currentConsole.label : "Choose a console"}
        </h1>
        <p className="intro">
          {currentConsole
            ? `${currentConsole.role} workspace. Sign in to continue to your assigned gate.`
            : "Select a gate console or the administrator workspace to get started."}
        </p>
      </section>

      {currentConsole ? (
        <>
          <section className="console-card" aria-labelledby="console-title">
            <div className="card-icon" aria-hidden="true">
              {currentPath === "/admin" ? "A" : "G"}
            </div>
            <div>
              <h2 id="console-title">{currentConsole.role} console</h2>
              <p>Running on mock data until the backend is connected.</p>
            </div>
            <a className="text-link" href="/">
              All consoles
            </a>
          </section>
          <ConsoleView gateId={currentConsole.gateId} role={currentConsole.role} />
          <LotMap api={mockApi} />
        </>
      ) : (
        <nav className="console-grid" aria-label="Parking system consoles">
          {consoles.map(({ path, label, role }) => (
            <a className="console-card" href={path} key={path}>
              <span className="card-icon" aria-hidden="true">
                {role === "Admin" ? "A" : "G"}
              </span>
              <span className="card-copy">
                <span className="card-title">{label}</span>
                <span className="card-role">{role}</span>
              </span>
              <span className="card-arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </nav>
      )}

      <footer className="app-footer">
        <span>Live parking operations</span>
        <span className="status">
          <span aria-hidden="true" /> Ready
        </span>
      </footer>
    </main>
  );
}

export default App;
