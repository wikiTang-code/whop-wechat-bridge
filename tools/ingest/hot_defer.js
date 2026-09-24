/**
 * CHG-062: work that must not hold the HOT syncing flag.
 * Failure or an empty extract result stays on this microtask; it does not re-enter the poller.
 */
export function deferOffHot(task) {
  setImmediate(() => {
    Promise.resolve()
      .then(() => task())
      .catch((err) => {
        console.error('[CHG-062] deferred HOT work failed:', err?.message || err);
      });
  });
}
