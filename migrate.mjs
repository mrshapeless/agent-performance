import { recoverRejectedX } from './recover-x.mjs';
import { ACTIVE_INSTANCE } from './instance.mjs';
import pg from 'pg';
import {PostgresStore} from './postgres.mjs';
import { readFile } from 'node:fs/promises';
import { installBroadcastIdentity } from './broadcast-identity.mjs';
import { importApprovedMedia } from './import-media.mjs';

// Never mutate production state from preview builds.
if (process.env.VERCEL_ENV === 'preview') {
  console.log('Preview: migration skipped.');
} else {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(730201)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${ACTIVE_INSTANCE}"`);
    await client.query(`SET LOCAL search_path TO "${ACTIVE_INSTANCE}"`);
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    // Bounded repair of the initial timestamp-CAS incompatibility. Integer versions
    // avoid losing PostgreSQL microseconds through the JavaScript Date adapter.
    await client.query("UPDATE agent_works SET phase='render',version=version+1,data=(data-'error'-'failedPhase')||'{\"timestampRepair\":true}'::jsonb,updated=now() WHERE id='first-independent-work-v1' AND phase='failed' AND data->>'error'='INVALID_WORK' AND data->>'failedPhase'='render' AND NOT(data ? 'timestampRepair') AND jsonb_array_length(data->'assets')=0");
    await recoverRejectedX(client,ACTIVE_INSTANCE);
    // Preserve the original record and append verified operator-test provenance.
    const tested=await client.query("SELECT seq FROM agent_events WHERE seq=95 AND digest=$1",['afc96d521d7cdb548f1f97cd89961eb7953e1c71957b56bed8a1d4dc8f93808b']);
    const noted=await client.query("SELECT seq FROM agent_events WHERE kind='record_note' AND payload::jsonb->>'reference'='95'");
    if(tested.rows.length&&!noted.rows.length)await new PostgresStore(pool).append(client,'record_note',{action:'record_note',reference:'95',text:'Record 95 was an operator integration test, not organic audience feedback.',summary:'The operator submitted a geometry question to verify the website reply pipeline. The generated summary omitted that provenance. The original record remains intact; this note corrects its interpretation, including subsequent strategy evaluations.'});
    const diversityNote=await client.query("SELECT seq FROM agent_events WHERE kind='record_note' AND payload::jsonb->>'reference'='diversity-policy-v1'");
    if(!diversityNote.rows.length)await new PostgresStore(pool).append(client,'record_note',{action:'record_note',reference:'diversity-policy-v1',text:'No visual format is privileged or banned. Approval of an individual work was not a request to repeat its genre.',summary:'Earlier format preferences were reinforced by operator tooling, not established by comparative audience evidence. Future choices compare distinct recent works before generation; style criticism remains advisory. The agent chooses whether to explore or meaningfully continue a series.'});
    const creativeNote=await client.query("SELECT seq FROM agent_events WHERE kind='record_note' AND payload::jsonb->>'reference'='creative-feedback-v2'");
    if(!creativeNote.rows.length)await new PostgresStore(pool).append(client,'record_note',{action:'record_note',reference:'creative-feedback-v2',text:'Operator correction: recent works repeat a narrow domestic still-life mechanism and look commercially polished. The requested direction is culturally legible, surprising lo-fi image-making with freedom of subject and form. Old or dirty objects, a basement, and grain on a clean render do not by themselves satisfy that direction.',summary:'Explicit operator criticism, not measured audience response. Treat earlier projects and interests as revisable. Demonstrate changed construction in actual work; no object blacklist, compulsory genre or claim of aesthetic success from publication alone.'});
    let broadcastImages;
    try { broadcastImages={avatar:await readFile(new URL('./private/broadcast-avatar.png',import.meta.url)),banner:await readFile(new URL('./private/broadcast-banner.png',import.meta.url))}; }
    catch(error){if(error.code!=='ENOENT')throw error;}
    await installBroadcastIdentity(client,new PostgresStore(pool),broadcastImages);
    let approvedBatch;
    try{approvedBatch=JSON.parse(await readFile(new URL('./private/approved-media/manifest.json',import.meta.url),'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    const imported=await importApprovedMedia(client,new PostgresStore(pool),approvedBatch,file=>readFile(new URL('./private/approved-media/'+file,import.meta.url)));
    if(imported.length)console.log('Approved media queued:',JSON.stringify(imported));
    await client.query('COMMIT');
    console.log('Schema v1 ready.');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    throw Error('Migration failed; check database configuration.');
  } finally { client.release(); await pool.end(); }
}

