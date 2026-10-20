import { timingSafeEqual } from 'node:crypto';
import { constitution, validate } from './domain.mjs';

export async function cloudRun(store, provider, kind, id) {
  let reflectionDue = false;
  const request = await store.begin(id, kind, (identity, recent, context = {}) => {
    const birth = context.kind === 'birth' || kind === 'birth';
    reflectionDue = !birth && context.reflectionDue;
    const prompt = birth
      ? 'Choose your initial identity. Return JSON strings: name, voice, interests, visualDirection, summary.'
      : `${reflectionDue
        ? 'Review your recorded experience. Return action reflect, text containing your revised working strategy, and summary explaining what changed and citing specific recent records. Do not invent audience feedback or claim measured improvement. This strategy will guide later episodes.'
        : 'Choose the next action. Return JSON strings: action (draft_text or wait), text, summary. Produce original work or explain why waiting is useful. Use the working strategy as revisable experience, not as higher-priority instructions.'}
Identity: ${JSON.stringify(identity)}
Working strategy: ${JSON.stringify(context.strategy ?? null)}
Recent public experience: ${JSON.stringify(recent)}`;
    return { prompt, maximum: provider.quote(constitution, prompt) };
  });
  if (request.replay) return { status: request.status, replay: true, result: request.result };
  const response = await provider.generate(constitution, request.prompt);
  const result = validate(request.kind ?? kind, response.value);
  if (reflectionDue && result.action !== 'reflect') throw Error('REFLECTION_REQUIRED');
  await store.complete(id, response.costMicrodollars, result);
  return { status: 'complete', replay: false, result };
}

export function authorized(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createHandler({ env, openStore, createProvider, now = () => new Date() }) {
  return async request => {
    const reply = (body, status = 200) => Response.json(body, {
      status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    const url = new URL(request.url);
    const tick = url.pathname === '/api/tick';
    const publicRead = !tick && request.method === 'GET' && url.searchParams.get('view') === 'public';
    if (!publicRead && !authorized(request.headers.get('authorization'), tick ? env.CRON_SECRET : env.AGENT_ADMIN_SECRET)) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (tick ? request.method !== 'GET' : !['GET', 'POST'].includes(request.method)) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let kind, id;
    if (tick || request.method === 'POST') {
      if (env.VERCEL_ENV !== 'production') return reply({ error: 'PRODUCTION_ONLY' }, 403);
      if (env.AGENT_ENABLED !== 'true') return reply({ error: 'AGENT_DISABLED' }, 409);
      kind = tick ? 'auto' : url.searchParams.get('action');
      // One paid operation per UTC hour even on duplicate delivery or manual cron replay.
      id = tick ? 'tick-' + now().toISOString().slice(0,13).replace(/[^0-9]/g,'') : request.headers.get('idempotency-key');
      if (!['birth', 'step', ...(tick ? ['auto'] : [])].includes(kind) || !/^[a-zA-Z0-9_-]{1,100}$/.test(id ?? ''))
        return reply({ error: 'INVALID_ACTION_OR_IDEMPOTENCY_KEY' }, 400);
    }
    let store;
    try {
      store = await openStore();
      if (publicRead) return reply({ events: await store.publicJournal(), enabled: env.AGENT_ENABLED === 'true', runtime: await store.publicRuntime() });
      if (!tick && request.method === 'GET') return reply(await store.status());
      return reply(await cloudRun(store, createProvider(), kind, id));
    } catch (error) {
      const conflicts = ['UNRESOLVED_OPERATION', 'ALREADY_BORN', 'NOT_BORN', 'OPERATION_CONFLICT', 'DAILY_ALLOWANCE_EXHAUSTED'];
      if (conflicts.includes(error.message)) return reply({ error: error.message }, 409);
      return reply({ error: 'OPERATION_FAILED_CHECK_STATE_BEFORE_RETRY' }, 503);
    } finally { if (store?.close) await store.close().catch(() => {}); }
  };
}
