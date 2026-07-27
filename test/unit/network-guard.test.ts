import { afterEach, describe, expect, it, vi } from 'vitest';

import { disableNetworkAccess } from '../../src/worker/network-guard';

describe('disableNetworkAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes fetch throw instead of reaching the network', () => {
    vi.stubGlobal('fetch', vi.fn());
    disableNetworkAccess();
    expect(() => (globalThis.fetch as (url: string) => unknown)('https://example.com')).toThrow(
      /Network access is disabled/
    );
  });

  it('makes XMLHttpRequest construction throw (the engine has a real call site)', () => {
    vi.stubGlobal('XMLHttpRequest', class {});
    disableNetworkAccess();
    const Ctor = (globalThis as Record<string, unknown>).XMLHttpRequest as new () => unknown;
    expect(() => new Ctor()).toThrow(/Network access is disabled/);
  });

  it('covers WebSocket and EventSource as well', () => {
    disableNetworkAccess();
    const globals = globalThis as Record<string, unknown>;
    for (const name of ['WebSocket', 'EventSource']) {
      const Ctor = globals[name] as new (url: string) => unknown;
      expect(() => new Ctor('https://example.com')).toThrow(/Network access is disabled/);
    }
  });
});
