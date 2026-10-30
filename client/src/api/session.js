// Per-tab session (sessionStorage), so each browser tab can be signed in as a different
// gate operator or admin for the multi-tab demo. Storage can be unavailable, so never throw.
const KEY = "vps.session";

export function getSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the user simply has to sign in again after a reload.
  }
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export const getToken = () => getSession()?.token ?? null;
