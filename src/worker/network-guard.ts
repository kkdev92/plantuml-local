/**
 * Disables network APIs inside the render worker.
 *
 * The engine bundle contains one real `new XMLHttpRequest()` call site
 * (the browser build's URL-include loader) and Node ≥ 18 provides a
 * global `fetch`. Audits show neither is reached — URL-based includes
 * are rejected before the source enters the worker — but "never leaves
 * the machine" should not rest on call-site audits alone. Replacing the
 * globals with throwing stubs turns any future network attempt, from the
 * engine or a dependency, into an immediate render error instead of an
 * outbound request.
 */

const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const;

export function disableNetworkAccess(): void {
  const globals = globalThis as Record<string, unknown>;

  for (const name of BLOCKED) {
    // A plain function throws from its body for both call styles that
    // matter here: `fetch(...)` and `new XMLHttpRequest()`.
    globals[name] = function blockedNetworkApi(): never {
      throw new Error(`Network access is disabled in the PlantUML render worker (${name})`);
    };
  }
}
