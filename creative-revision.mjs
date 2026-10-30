// Bump only when an editorial change invalidates unfinished creative intentions.
export const CREATIVE_REVISION = 'internet-native-2026-10-30-v6';
export const stampCreativePlan = plan => ({...plan, creativeRevision: CREATIVE_REVISION});
export const isCurrentCreativePlan = plan => plan?.creativeRevision === CREATIVE_REVISION;

// This is an internal ledger event, not a public creative work. Never erase a
// provider request or change its accounting while reconsidering its intention.
export async function reconcileCreativeRevision(store, now = new Date()) {
  return store.transaction(async c => {
    const events = (await c.query("SELECT payload FROM agent_events WHERE kind='creative_revision_internal' ORDER BY seq DESC")).rows.map(r => JSON.parse(r.payload));
    let migration = events.find(e => e.revision === CREATIVE_REVISION && e.phase === 'snapshot');
    if (!migration) {
      const tasks = (await c.query("SELECT * FROM agent_agenda WHERE status IN ('active','commissioned') ORDER BY id")).rows;
      migration = {revision:CREATIVE_REVISION, phase:'snapshot', tasks};
      await store.append(c, 'creative_revision_internal', migration);
    }
    const operations = (await c.query('SELECT id,status,result,amount FROM agent_operations')).rows;
    const jobs = (await c.query("SELECT * FROM agent_media_jobs WHERE state NOT IN ('published','failed','rejected','superseded','reconsideration') FOR UPDATE")).rows;
    const result = {superseded:[], held:[], deferred:[], tasks:[]};
    for (const job of jobs) {
      if (isCurrentCreativePlan(job.plan)) continue;
      const publishPrefix = `x-publish-${job.plan_id.replace(/^x-plan-/, '')}`;
      const related = operations.filter(o => o.id === job.id || o.id.startsWith(`${job.id}-`));
      const writes = operations.filter(o => o.id === publishPrefix || o.id.startsWith(`${publishPrefix}-`));
      const unresolved = related.some(o => o.status === 'pending') || writes.some(o => o.status === 'pending');
      // External predictions must finish/archive normally; the next pass holds
      // their rendered asset. A completed publication must reconcile normally.
      const recoveringPrediction = related.some(o => o.result?.predictionId) && job.state === 'queued';
      if ((job.lease_until && new Date(job.lease_until) > now) || unresolved || job.state === 'processing' || recoveringPrediction || writes.some(o => o.result?.action === 'x_post')) {
        result.deferred.push(job.id); continue;
      }
      const unstarted = job.state === 'queued' && related.length === 0 && !Object.keys(job.data ?? {}).length;
      const state = unstarted ? 'superseded' : 'reconsideration';
      await c.query('UPDATE agent_media_jobs SET state=$1,data=data || $2::jsonb,lease_until=NULL,lease_token=NULL,updated=now() WHERE id=$3', [state, JSON.stringify({creativeRevisionHold:{revision:CREATIVE_REVISION, previousRevision:job.plan.creativeRevision ?? null, previousState:job.state, reason:'Editorial direction changed; reconsider intention before reuse or publication.'}}), job.id]);
      result[unstarted ? 'superseded' : 'held'].push(job.id);
    }
    // Snapshot only pre-change tasks. A later freshly chosen commission is not
    // invalidated on every worker tick, even when it reuses the same task id.
    const done = new Set(events.filter(e => e.revision === CREATIVE_REVISION && e.phase === 'task').map(e => `${e.id}:${e.version}`));
    for (const original of migration.tasks) {
      if (done.has(`${original.id}:${original.version}`)) continue;
      // Unknown writes cannot be cancelled: their outcome may already be public.
      if (operations.some(o => o.status === 'pending' && o.id.startsWith('x-publish-'))) continue;
      const changed = await c.query("UPDATE agent_agenda SET status='active',next_step=$1,version=version+1,updated=now() WHERE id=$2 AND version=$3 AND status IN ('active','commissioned') RETURNING goal_id", ['Reconsider this intention under the current creative direction. Inspect previous work before choosing to revise, replace, or continue; do not automatically recommission it.', original.id, original.version]);
      if (changed.rows.length) {
        if (changed.rows[0].goal_id) await c.query("UPDATE agent_goals SET status='paused',version=version+1,updated=now() WHERE id=$1 AND status='active'", [changed.rows[0].goal_id]);
        result.tasks.push(original.id);
      }
      await store.append(c, 'creative_revision_internal', {revision:CREATIVE_REVISION,phase:'task',id:original.id,version:original.version,changed:changed.rows.length > 0});
    }
    if (result.superseded.length || result.held.length) await store.append(c, 'creative_revision_internal', {revision:CREATIVE_REVISION,phase:'queue',...result});
    return result;
  });
}
