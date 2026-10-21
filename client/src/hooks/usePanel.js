import { useEffect, useState } from "react";

// Loads data for one panel: { status: "loading" | "ready" | "error", data, error }.
// `fetcher` must be stable (wrap in useCallback). `retry` reloads this panel only.
export default function usePanel(fetcher) {
  const [state, setState] = useState({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    new Promise((resolve) => resolve(fetcher()))
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: "error", error });
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  return { ...state, retry };
}
