/**
 * Small HTTP polling helper. Using fetch instead of `curl` removes a
 * prerequisite that minimal Linux installs and some Windows shells lack.
 */
import { setTimeout as sleep } from "node:timers/promises";

export async function waitForHttp(
  url,
  { timeoutMs = 60000, intervalMs = 500, alive, predicate } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastBody = "";

  while (Date.now() < deadline) {
    if (alive && !alive()) {
      return { ok: false, reason: "process-exited", error: lastError, body: lastBody };
    }

    try {
      // `connection: close` avoids keeping an idle keep-alive socket open after
      // the checks, which would otherwise delay process exit for a few seconds.
      const response = await fetch(url, {
        headers: { connection: "close" },
        signal: AbortSignal.timeout(5000),
      });
      lastBody = await response.text();
      if (response.ok && (!predicate || predicate(lastBody, response))) {
        return { ok: true, status: response.status, body: lastBody };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(intervalMs);
  }

  return { ok: false, reason: "timeout", error: lastError, body: lastBody };
}
