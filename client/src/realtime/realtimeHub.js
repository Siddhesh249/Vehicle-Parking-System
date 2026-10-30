// Shares ONE realtime connection between everything on the page (lot map, admin panels).
// Connects when the first subscriber arrives and disconnects when the last one leaves.
export function createRealtimeHub(connect) {
  const subscribers = new Set();
  let disconnect = null;
  let status = null;

  const fanOut = (name) => (payload) => subscribers.forEach((s) => s[name]?.(payload));

  return {
    subscribe(handlers) {
      subscribers.add(handlers);
      if (!disconnect) {
        disconnect = connect({
          onSnapshot: fanOut("onSnapshot"),
          onUpdate: fanOut("onUpdate"),
          onOverstay: fanOut("onOverstay"),
          onStatus: (next) => {
            status = next;
            fanOut("onStatus")(next);
          },
        });
      } else if (status) {
        handlers.onStatus?.(status);
      }

      return () => {
        subscribers.delete(handlers);
        if (subscribers.size === 0 && disconnect) {
          disconnect();
          disconnect = null;
          status = null;
        }
      };
    },
  };
}
