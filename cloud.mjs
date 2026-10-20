import { timingSafeEqual } from 'node:crypto';
import { constitution, validate } from './domain.mjs';

export async function cloudRun(store, provider, kind, id) {
  const request = await store.begin(id, kind, (identity, recent) => {
    const prompt = kind === 'birth'
      ? 'Choose your initial identity. Return JSON strings: name, voice, interests, visualDirection, summary.'
      : `Choose the next action. Return JSON strings: action (draft_text or wait), text, summary.
Identity: ${JSON.stringify(identity)}
Recent public experience: ${JSON.stringify(recent)}`;
    return { prompt, maximum: provider.quote(constitution, prompt) };
  });
  if (request.replay) return { status: request.status, replay: true, result: request.result };
  const response = await provider.generate(constitution, request.prompt);
  const result = validate(kind, response.value);
  await store.complete(id, response.costMicrodollars, result);
  return { status: 'complete', replay: false, result };
}

export function authorized(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createHandler({ env, openStore, createProvider }) {
  return async request => {
    const reply = (body, status = 200) => Response.json(body, {
      status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    const url = new URL(request.url);
    const publicRead = request.method === 'GET' && url.searchParams.get('view') === 'public';
    if (!publicRead && !authorized(request.headers.get('authorization'), env.AGENT_ADMIN_SECRET)) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (!['GET', 'POST'].includes(request.method)) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let kind, id;
    if (request.method === 'POST') {
      if (env.VERCEL_ENV !== 'production') return reply({ error: 'PRODUCTION_ONLY' }, 403);
      if (env.AGENT_ENABLED !== 'true') return reply({ error: 'AGENT_DISABLED' }, 409);
      kind = url.searchParams.get('action');
      id = request.headers.get('idempotency-key');
      if (!['birth', 'step'].includes(kind) || !/^[a-zA-Z0-9_-]{1,100}$/.test(id ?? ''))
        return reply({ error: 'INVALID_ACTION_OR_IDEMPOTENCY_KEY' }, 400);
    }
    let store;
    try {
      store = await openStore();
      if (publicRead) return reply({ events: await store.publicJournal(), enabled: env.AGENT_ENABLED === 'true' });
      if (request.method === 'GET') return reply(await store.status());
      return reply(await cloudRun(store, createProvider(), kind, id));
    } catch (error) {
      const conflicts = ['UNRESOLVED_OPERATION', 'ALREADY_BORN', 'NOT_BORN', 'OPERATION_CONFLICT', 'DAILY_ALLOWANCE_EXHAUSTED'];
      if (conflicts.includes(error.message)) return reply({ error: error.message }, 409);
      // Never return provider errors, SQL errors, connection strings or secret values.
      return reply({ error: 'OPERATION_FAILED_CHECK_STATE_BEFORE_RETRY' }, 503);
    } finally { if (store?.close) await store.close().catch(() => {}); }
  };
}
