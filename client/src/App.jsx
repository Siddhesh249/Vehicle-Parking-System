import "./App.css";
import { api, apiMode, realtime } from "./api/index.js";
import { clearSession, getSession, saveSession } from "./api/session.js";
import AdminConsole from "./components/AdminConsole.jsx";
import EntryConsole from "./components/EntryConsole.jsx";
import ExitConsole from "./components/ExitConsole.jsx";
import LoginForm from "./components/LoginForm.jsx";
import LotMap from "./components/LotMap.jsx";

const consoles = [
  { path: "/entry-1", label: "Entry Gate 1", role: "Entry operator", gateId: "Entry-1" },
  { path: "/entry-2", label: "Entry Gate 2", role: "Entry operator", gateId: "Entry-2" },
  { path: "/exit-1", label: "Exit Gate 1", role: "Exit operator", gateId: "Exit-1" },
  { path: "/exit-2", label: "Exit Gate 2", role: "Exit operator", gateId: "Exit-2" },
  { path: "/admin", label: "Admin Dashboard", role: "Admin" },
];

// "mock" (default) or "real" — set VITE_API_MODE=real to talk to the backend (see client/README.md).
const isReal = apiMode === "real";

// Where each account lands after signing in: admin -> /admin, "Entry-1" -> /entry-1, ...
const homePathFor = ({ role, gateId }) =>
  role === "admin" ? "/admin" : gateId ? `/${gateId.toLowerCase()}` : "/";

function handleSignedIn(session) {
  saveSession(session);
  window.location.assign(homePathFor(session));
}

function signOut() {
  clearSession();
  window.location.assign("/login");
}

function ConsoleView({ gateId, role }) {
  if (role === "Admin") return <AdminConsole api={api} realtime={realtime} />;
  if (gateId.startsWith("Entry")) return <EntryConsole gateId={gateId} api={api} />;
  return <ExitConsole gateId={gateId} api={api} />;
}

function App() {
  const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
  const currentConsole = consoles.find(({ path }) => path === currentPath);
  const isLogin = currentPath === "/login";
  const session = isReal ? getSession() : null;
  // The server rejects cross-gate requests anyway; this keeps the visible
  // console from pretending the session has access it does not have.
  const canUseConsole =
    !isReal ||
    Boolean(
      session &&
      (currentConsole?.role === "Admin"
        ? session.role === "admin"
        : session.gateId && session.gateId === currentConsole?.gateId),
    );

  return (
    <main className="parking-app">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Parkwise home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>Parkwise</span>
        </a>
        <span className="environment-label">
          {session ? (
            <>
              Signed in as {session.gateId ?? session.role} ·{" "}
              <button type="button" className="text-link" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            "Parking operations"
          )}
        </span>
      </header>

      <section className="welcome-panel" aria-labelledby="page-title">
        <p className="eyebrow">VEHICLE PARKING SYSTEM</p>
        <h1 id="page-title">
          {currentConsole
            ? currentConsole.label
            : isLogin
              ? "Sign in"
              : "Choose a console"}
        </h1>
        <p className="intro">
          {currentConsole
            ? `${currentConsole.role} workspace. Sign in to continue to your assigned gate.`
            : isLogin
              ? "Use your gate or administrator account."
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
              <p>
                {isReal
                  ? "Connected to the live backend."
                  : "Running on mock data until the backend is connected."}
              </p>
            </div>
            <a className="text-link" href="/">
              All consoles
            </a>
          </section>
          {isReal && !session ? (
            <section className="console-panel">
              <p>
                Sign in to use this console. <a href="/login">Go to sign in</a>
              </p>
            </section>
          ) : isReal && !canUseConsole ? (
            <section className="console-panel">
              <p role="alert">
                This account is signed in as {session.gateId ?? session.role}, not{" "}
                {currentConsole.gateId ?? currentConsole.role}.{" "}
                <a href={homePathFor(session)}>Go to your console</a>
              </p>
            </section>
          ) : (
            <>
              <ConsoleView gateId={currentConsole.gateId} role={currentConsole.role} />
              <LotMap api={api} realtime={realtime} />
            </>
          )}
        </>
      ) : isLogin ? (
        isReal ? (
          <LoginForm api={api} onSuccess={handleSignedIn} />
        ) : (
          <section className="console-panel">
            <p>
              Sign-in isn&apos;t needed while running on mock data.{" "}
              <a href="/">All consoles</a>
            </p>
          </section>
        )
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
