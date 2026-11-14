/* global __PRODUCTION__ */
import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { api, apiMode, realtime } from "./api/index.js";
import { clearSession, getSession, saveSession } from "./api/session.js";
import AdminConsole from "./components/AdminConsole.jsx";
import EntryConsole from "./components/EntryConsole.jsx";
import ExitConsole from "./components/ExitConsole.jsx";
import LoginForm from "./components/LoginForm.jsx";
import Logo from "./components/Logo.jsx";
import LotMap from "./components/LotMap.jsx";
import SimulationConsole from "./components/SimulationConsole.jsx";

const consoles = [
  { path: "/entry-1", label: "Entry Gate 1", role: "Entry operator", gateId: "Entry-1" },
  { path: "/entry-2", label: "Entry Gate 2", role: "Entry operator", gateId: "Entry-2" },
  { path: "/exit-1", label: "Exit Gate 1", role: "Exit operator", gateId: "Exit-1" },
  { path: "/exit-2", label: "Exit Gate 2", role: "Exit operator", gateId: "Exit-2" },
  { path: "/admin", label: "Admin Dashboard", role: "Admin" },
];

// "mock" (default) or "real" — set VITE_API_MODE=real to talk to the backend (see client/README.md).
const isReal = apiMode === "real";
const isDemo = !isReal;
// The developer tool is compiled out of production builds.
const isProduction = typeof __PRODUCTION__ !== "undefined" && __PRODUCTION__;

// Where each account lands after signing in: admin -> /admin, "Entry-1" -> /entry-1, ...
const homePathFor = ({ role, gateId }) =>
  role === "admin" ? "/admin" : gateId ? `/${gateId.toLowerCase()}` : "/login";

const readPath = () => window.location.pathname.replace(/\/$/, "") || "/";

function ConsoleView({ gateId, role }) {
  if (role === "Admin") return <AdminConsole api={api} realtime={realtime} />;
  if (gateId.startsWith("Entry")) return <EntryConsole gateId={gateId} api={api} />;
  return <ExitConsole gateId={gateId} api={api} />;
}

function App() {
  const [path, setPath] = useState(readPath);
  const [session, setSession] = useState(() => getSession());

  const navigate = useCallback((nextPath) => {
    if (readPath() !== nextPath) window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(readPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function handleSignedIn(nextSession) {
    saveSession(nextSession);
    setSession(nextSession);
    navigate(homePathFor(nextSession));
  }

  function signOut() {
    clearSession();
    setSession(null);
    navigate("/login");
  }

  const currentConsole = consoles.find(({ path: consolePath }) => consolePath === path);
  const isLogin = path === "/login" || path === "/";
  // Developer-only: reachable by typing the address or via run.sh, never linked from a role console (VPS-DEV-003).
  const isSimulation = path === "/dev/simulate" && !isProduction;
  const canUseConsole =
    !isReal ||
    Boolean(
      session &&
      (currentConsole?.role === "Admin"
        ? session.role === "admin"
        : session.gateId && session.gateId === currentConsole?.gateId),
    );

  // A signed-in visitor who lands on the sign-in page is sent to their own console.
  useEffect(() => {
    if (!session || !isLogin) return undefined;
    const timer = setTimeout(() => navigate(homePathFor(session)), 0);
    return () => clearTimeout(timer);
  }, [session, isLogin, navigate]);

  const pageTitle = currentConsole
    ? currentConsole.label
    : isLogin
      ? "Sign in"
      : isSimulation
        ? "Developer tools"
        : "Page not found";

  const pageIntro = currentConsole
    ? `${currentConsole.role} workspace at ${currentConsole.gateId ?? "all gates"}.`
    : isLogin
      ? "Use your gate or administrator account. Demo credentials can be filled in one click."
      : isSimulation
        ? "Developer utility for demos and load testing. Gate operators and admins never see it."
        : "That address does not match a console.";

  // Each page load is a new document, so give it a meaningful title for screen readers and tabs.
  useEffect(() => {
    document.title = `${pageTitle} · Vehicle Parking System`;
  }, [pageTitle]);

  const signedInLabel = session
    ? (session.gateId ?? (session.role === "admin" ? "Admin" : session.role))
    : null;

  return (
    <div className="parking-app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <button
          type="button"
          className="brand brand-button"
          onClick={() => navigate(session ? homePathFor(session) : "/login")}
          aria-label="Parkwise home"
        >
          <Logo size={38} />
          <span className="brand-copy">
            <span className="brand-name">Parkwise</span>
            <span className="brand-tagline">smart parking operations</span>
          </span>
        </button>
        <div className="header-actions">
          {isDemo && <span className="env-pill">DEMO DATA</span>}
          {session ? (
            <>
              <span className="session-chip">
                <span className="live-dot" aria-hidden="true" />
                {signedInLabel}
              </span>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <span className="session-chip session-chip--muted">Parking operations</span>
          )}
        </div>
      </header>

      <main id="main-content" tabIndex={-1} key={path} className="page-enter">
        {isSimulation ? (
          <>
            <section className="welcome-panel" aria-labelledby="page-title">
              <p className="eyebrow">DEVELOPER TOOL · DEMO TRAFFIC</p>
              <h1 id="page-title">Developer tools</h1>
              <p className="intro">
                Start the bot fleet, then act as the gate operators. Every car waits for a
                human ticket or payment before it moves on.
              </p>
            </section>
            <SimulationConsole api={api} />
            {(!isReal || session) && <LotMap api={api} realtime={realtime} />}
          </>
        ) : currentConsole ? (
          <>
            <section className="welcome-panel console-hero" aria-labelledby="page-title">
              <div>
                <p className="eyebrow">{currentConsole.role.toUpperCase()}</p>
                <h1 id="page-title">{currentConsole.label}</h1>
                <p className="intro">{pageIntro}</p>
              </div>
              <span className="gate-badge">{currentConsole.gateId ?? "ALL GATES"}</span>
            </section>

            {isReal && !session ? (
              <LoginForm
                api={api}
                onSuccess={handleSignedIn}
                context={`Sign in to open ${currentConsole.label}`}
              />
            ) : isReal && !canUseConsole ? (
              <section className="console-panel access-panel">
                <p role="alert">
                  This account is signed in as {signedInLabel}, not{" "}
                  {currentConsole.gateId ?? currentConsole.role}.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => navigate(homePathFor(session))}
                  >
                    Go to my console
                  </button>
                  <button type="button" className="secondary-button" onClick={signOut}>
                    Switch account
                  </button>
                </div>
              </section>
            ) : (
              <>
                <ConsoleView gateId={currentConsole.gateId} role={currentConsole.role} />
                <LotMap api={api} realtime={realtime} gateId={currentConsole.gateId} />
              </>
            )}
          </>
        ) : isLogin ? (
          <div className="login-shell">
            <section className="login-hero" aria-labelledby="welcome-title">
              <div className="login-hero__badge">
                <Logo size={54} />
              </div>
              <p className="eyebrow">VEHICLE PARKING SYSTEM</p>
              <h1 id="welcome-title" className="login-hero__headline">
                One login.
                <br />
                Five live consoles.
              </h1>
              <p className="intro">
                Sign in as an entry operator, exit operator or the lot manager. Every
                session stays in sync in real time.
              </p>
              <ul className="login-hero__points">
                <li>
                  <strong>Entry gates</strong> issue tickets and allot spots atomically.
                </li>
                <li>
                  <strong>Exit gates</strong> scan tickets, settle fares and handle lost
                  slips.
                </li>
                <li>
                  <strong>Admin</strong> watches revenue, overstays and the raw database
                  live.
                </li>
              </ul>
              <div className="login-hero__status">
                <span className="live-dot" aria-hidden="true" />
                {isReal ? "Live backend connected" : "Offline demo data"}
                <span className="login-hero__separator">·</span>
                <span>{isReal ? "live lot map" : "16 demo spots"}</span>
              </div>
            </section>
            <LoginForm api={api} onSuccess={handleSignedIn} />
          </div>
        ) : (
          <section className="console-panel not-found">
            <p className="eyebrow">404</p>
            <h1 id="page-title">Page not found</h1>
            <p className="intro">{pageIntro}</p>
            <div className="button-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate(session ? homePathFor(session) : "/login")}
              >
                {session ? "Back to my console" : "Go to sign in"}
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <span>Live parking operations</span>
        <span className="status">
          <span aria-hidden="true" /> Systems ready
        </span>
      </footer>
    </div>
  );
}

export default App;
