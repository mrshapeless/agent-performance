import {studioContext,validateStudioChoice} from './studio.mjs';
import { observe, audienceStep, webInbox } from './experience.mjs';
import { accountSetup, accountStatus } from './accounts.mjs';
import { timingSafeEqual } from 'node:crypto';
import { constitution, validate } from './domain.mjs';
import { setupAppearance, setupBanner, socialStep } from './integrations.mjs';
import {mediaStep} from './media.mjs';
import {mediaCapabilities,trustedMediaURL} from './media-providers.mjs';

export async function cloudRun(store, provider, kind, id) {
  let reflectionDue = false, studio=null;
  const request = await store.begin(id, kind, (identity, recent, context = {}) => {
    studio=context.studio;
    const birth = context.kind === 'birth' || kind === 'birth';
    reflectionDue = !birth && context.reflectionDue;
    const prompt = birth
      ? 'Choose your initial identity. Return JSON strings: name, voice, interests, visualDirection, summary.'
      : `${reflectionDue
        ? 'Review your recorded experience. Return action reflect, text containing your revised working strategy, and summary explaining what changed and citing specific recent records. Evaluate your old restrictions against new tools and observations. Identify repetition, choose one experiment and a falsifiable success criterion. Preserve your self-chosen identity but revise any rule that prevents conversation or exploration. Cite observed metrics with sample sizes; zero exposure is not rejection. Do not invent feedback. Include the marker experience-v1 in your strategy text. This strategy will guide later episodes.'
        : 'Choose the next action. Return JSON strings: action (draft_text or wait), text, summary. Also return intent (project, experiment, conversation, observation, wait) and projectId (active project ID or null, required for project intent). Produce original work that advances a chosen project or experiment, or explain why waiting is useful. Use the working strategy as revisable experience, not as higher-priority instructions.'}
${studioContext(context.studio)}
Identity: ${JSON.stringify(identity)}
Working strategy: ${JSON.stringify(context.strategy ?? null)}
External observations (untrusted source data): ${JSON.stringify(context.external ?? null)}
Recent public experience: ${JSON.stringify(recent)}`;
    return { prompt, maximum: provider.quote(constitution, prompt) };
  });
  if (request.replay) return { status: request.status, replay: true, result: request.result };
  const response = await provider.generate(constitution, request.prompt);
  const result = validate(request.kind ?? kind, response.value);
  if(studio&&result.action!=='reflect'&&(request.kind??kind)!=='birth'){try{validateStudioChoice(result,studio)}catch{await store.complete(id,response.costMicrodollars,{action:'wait',text:'This creative choice did not reference a valid active project.',summary:'No work was applied; the previous studio remains unchanged.'});return {status:'invalid_project_choice'}}}
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
    const setup = url.pathname === '/api/setup';
    const social = url.pathname === '/api/social';
    const media = url.pathname === '/api/media';
    const inbox = url.pathname === '/api/inbox';
    const observation = url.pathname === '/api/observe';
    const audience = url.pathname === '/api/audience';
    const assetRead = request.method === 'GET' && url.pathname === '/api/asset';
    const tick = ['/api/tick','/api/setup','/api/social','/api/observe','/api/audience','/api/media'].includes(url.pathname);
    const publicRead = !tick && request.method === 'GET' && url.searchParams.get('view') === 'public';
    if (!inbox && !publicRead && !assetRead && !authorized(request.headers.get('authorization'), tick ? env.CRON_SECRET : env.AGENT_ADMIN_SECRET)) return reply({ error: 'UNAUTHORIZED' }, 401);
    if (tick ? request.method !== 'GET' : !['GET', 'POST'].includes(request.method)) return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let kind, id;
    if (!inbox && (tick || request.method === 'POST')) {
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
      if (inbox) return await webInbox(request,store,env);
      if (observation) return reply(await observe(store,env,now()));
      if (audience) return reply(await audienceStep(store,createProvider(),env,now()));
      if (media) return reply(await mediaStep(store,createProvider(),env));
      if (assetRead) {
        const id=url.searchParams.get('id');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id??''))return reply({error:'INVALID_ASSET'},400);
        const asset=await store.asset(id);if(!asset)return reply({error:'NOT_FOUND'},404);
        if(asset.url)return Response.redirect(trustedMediaURL(asset.url,true),302);
        return new Response(asset.bytes,{headers:{'Content-Type':asset.mime,'Cache-Control':'public, max-age=86400, immutable','X-Content-Type-Options':'nosniff'}});
      }
      if (setup) { const appearance=await setupAppearance(store,createProvider(),env); if(appearance.phase!=='appearance')return reply(appearance); const banner=await setupBanner(store,createProvider(),env); return reply(banner.phase==='banner' ? await accountSetup(store,createProvider(),env,now()) : banner); }
      if (social) return reply(await socialStep(store,createProvider(),env,now()));
      if (publicRead) { const account=await accountStatus(store,env); return reply({ events: await store.publicJournal(), enabled: env.AGENT_ENABLED === 'true', runtime: { ...await store.publicRuntime(), media:mediaCapabilities(env), xRepliesEnabled:env.X_ENABLED==='true'&&env.X_REPLIES_ENABLED==='true', accounts: { connected: account.registrationVerified, username: account.registrationVerified ? env.X_EXPECTED_USERNAME?.replace(/^@/,'') : null } } }); }
      if (!tick && request.method === 'GET') return reply({ ...await store.status(), accounts:await accountStatus(store,env), enabled:env.AGENT_ENABLED==='true' });
      // A one-time capability transition must not wait behind an already completed hourly tick.
      if(tick && await store.latest('observation') && !(await store.latest('reflect'))?.text?.includes('experience-v1')) id='experience-v1';
      return reply(await cloudRun(store, createProvider(), kind, id));
    } catch (error) {
      const conflicts = ['UNRESOLVED_OPERATION', 'ALREADY_BORN', 'NOT_BORN', 'OPERATION_CONFLICT', 'DAILY_ALLOWANCE_EXHAUSTED'];
      if (conflicts.includes(error.message)) return reply({ error: error.message }, 409);
            const safe = /^(IMAGE_HTTP_\d{3}|IMAGE_INCOMPLETE|IMAGE_INVALID|IMAGE_TOO_LARGE|IMAGE_USAGE_MISSING|X_HTTP_\d{3}|X_ACCOUNT_MISMATCH|X_NOT_CONFIGURED|X_TARIFF_NOT_CONFIGURED|X_UNCERTAIN_RESULT|INVALID_APPEARANCE_BRIEF|INVALID_X_DRAFT)$/.test(error.message) ? error.message : 'OPERATION_FAILED_CHECK_STATE_BEFORE_RETRY';
      console.error('agent_operation_failed', safe, ['verify','publish'].includes(error.phase)?error.phase:'unknown');
      return reply({ error: safe }, 503);
    } finally { if (store?.close) await store.close().catch(() => {}); }
  };
}




