import "./App.css";
import EntryConsole from "./components/EntryConsole.jsx";
import ExitConsole from "./components/ExitConsole.jsx";
import AdminConsole from "./components/AdminConsole.jsx";
import { mockApi } from "./components/mockApi.js";

const consoles = [
  { path: "/entry-1", label: "Entry Gate 1", role: "Entry operator" },
  { path: "/entry-2", label: "Entry Gate 2", role: "Entry operator" },
  { path: "/exit-1", label: "Exit Gate 1", role: "Exit operator" },
  { path: "/exit-2", label: "Exit Gate 2", role: "Exit operator" },
  { path: "/admin", label: "Admin Dashboard", role: "Admin" },
];

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
          <div className="route-toolbar">
            <span className="route-role">{currentConsole.role} console</span>
            <a className="text-link" href="/">
              All consoles
            </a>
          </div>
          {currentPath.startsWith("/entry-") && (
            <EntryConsole
              gateId={currentPath === "/entry-2" ? "Entry-2" : "Entry-1"}
              api={mockApi}
            />
          )}
          {currentPath.startsWith("/exit-") && (
            <ExitConsole
              gateId={currentPath === "/exit-2" ? "Exit-2" : "Exit-1"}
              api={mockApi}
            />
          )}
          {currentPath === "/admin" && <AdminConsole api={mockApi} />}
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
