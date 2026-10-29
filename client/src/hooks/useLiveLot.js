import { useCallback, useEffect, useReducer, useState } from "react";

// spots: null until the first load. `synced` becomes true once a lot:snapshot has arrived;
// a snapshot is always fresher than the one-off REST load, so it wins.
export function lotReducer(state, action) {
  switch (action.type) {
    case "loaded":
      return state.synced ? state : { ...state, spots: action.spots };
    case "snapshot":
      return { spots: action.spots, synced: true };
    case "update":
      if (!state.spots) return state;
      return {
        ...state,
        spots: state.spots.map((spot) =>
          spot.id === action.spotId ? { ...spot, status: action.status } : spot,
        ),
      };
    default:
      return state;
  }
}

// Lot state = initial GET /api/lot/status, then kept current by spot:update / lot:snapshot.
export default function useLiveLot({ api, realtime }) {
  const [lot, dispatch] = useReducer(lotReducer, { spots: null, synced: false });
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState(realtime ? "connecting" : null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    new Promise((resolve) => resolve(api.getLotStatus()))
      .then((data) => {
        if (!cancelled) dispatch({ type: "loaded", spots: data.spots });
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  useEffect(() => {
    if (!realtime) return undefined;
    return realtime.subscribe({
      onSnapshot: (spots) => dispatch({ type: "snapshot", spots }),
      onUpdate: ({ spotId, status }) => dispatch({ type: "update", spotId, status }),
      onStatus: setConnection,
    });
  }, [realtime]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const status = lot.spots ? "ready" : error ? "error" : "loading";
  return { status, spots: lot.spots ?? [], error, connection, retry };
}
