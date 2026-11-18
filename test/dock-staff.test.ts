import { describe, expect, it } from 'vitest';
import { staffStatus } from '../src/dock/staff.js';

type Fetch = typeof fetch;

/** A fetch that records each call and answers with what `reply` gives. */
function recorder(reply: () => Response | Promise<Response>) {
  const calls: [string, RequestInit | undefined][] = [];
  const fetch: Fetch = async (input, init) => {
    calls.push([String(input), init]);
    return reply();
  };
  return { fetch, calls };
}

const hinted = { getItem: () => '1' };
const bare = { getItem: () => null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('staffStatus', () => {
  it('makes no request without the hint', async () => {
    const { fetch, calls } = recorder(() => json({ email: 'a@b.c', role: 'admin', waiting: 1 }));
    expect(await staffStatus({ fetch, storage: bare })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('makes no request when the hint is some other value', async () => {
    const { fetch, calls } = recorder(() => json({ email: 'a@b.c', role: 'admin', waiting: 1 }));
    expect(await staffStatus({ fetch, storage: { getItem: () => '0' } })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('makes no request, and does not throw, when storage cannot be read', async () => {
    const { fetch, calls } = recorder(() => json({ email: 'a@b.c', role: 'admin', waiting: 1 }));
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(await staffStatus({ fetch, storage })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('asks /admin/api/me without following redirects, and returns the status', async () => {
    const { fetch, calls } = recorder(() => json({ email: 'boss@example.com', role: 'admin', waiting: 2 }));
    expect(await staffStatus({ fetch, storage: hinted })).toEqual({ email: 'boss@example.com', role: 'admin', waiting: 2 });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe('/admin/api/me');
    expect(init?.redirect).toBe('manual');
  });

  it('returns null for a signed-out 403', async () => {
    const { fetch } = recorder(() => new Response(null, { status: 403 }));
    expect(await staffStatus({ fetch, storage: hinted })).toBeNull();
  });

  it('returns null for an opaque redirect (Access sending a visitor to sign in)', async () => {
    const opaque = { type: 'opaqueredirect', ok: false, status: 0 } as unknown as Response;
    const { fetch } = recorder(() => opaque);
    expect(await staffStatus({ fetch, storage: hinted })).toBeNull();
  });

  it('returns null for a body that is not a status', async () => {
    const { fetch } = recorder(() => json({ email: 'a@b.c', role: 'owner', waiting: 0 }));
    expect(await staffStatus({ fetch, storage: hinted })).toBeNull();
    const second = recorder(() => json({ email: 'a@b.c', role: 'editor', waiting: -1 }));
    expect(await staffStatus({ fetch: second.fetch, storage: hinted })).toBeNull();
  });

  it('returns null, and does not throw, when the request fails', async () => {
    const { fetch } = recorder(() => {
      throw new TypeError('offline');
    });
    expect(await staffStatus({ fetch, storage: hinted })).toBeNull();
  });
});
