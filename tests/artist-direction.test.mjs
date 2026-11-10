import test from 'node:test';
import assert from 'node:assert/strict';
import {artistReleaseStep,publicArtistDirection,ARTIST_DIRECTION_REVISION} from '../src/artist-direction.mjs';
import {socialStep} from '../src/integrations.mjs';

test('artist status exposes only an allowlisted receipt, never private creative content',()=>{
 const v=publicArtistDirection({brief:'PRIVATE synthetic manuscript',projectId:'private-project',manuscript:'PRIVATE draft'});
 assert.equal(v.status,'artist_originals_enabled');
 assert.equal(v.legacyOriginalsEnabled,false);
 assert.equal(JSON.stringify(v).includes('PRIVATE'),false);
 assert.equal(JSON.stringify(v).includes('private-project'),false);
 assert.equal(v.fingerprint.length,64);
});
test('missing brief fails closed without legacy generation or writes',async()=>{
 assert.deepEqual(await artistReleaseStep({},null),{status:'artist_direction_required',revision:ARTIST_DIRECTION_REVISION});
});
test('full artist manuscript is retained idempotently, without publishing or spending',async()=>{
 let saved,completions=0;
 const store={begin:async()=>({replay:!!saved}),complete:async(id,cost,value)=>{assert.equal(cost,0);saved=value;completions++;}};
 const direction={brief:'Synthetic artist intention',projectId:'test-project',manuscript:'A full draft. '.repeat(100)};
 const result=await artistReleaseStep(store,direction);
 assert.equal(result.status,'artist_originals_enabled');
 assert.equal(saved.manuscript,direction.manuscript);
 assert.equal(saved.releaseState,'draft');
 await artistReleaseStep(store,direction);assert.equal(completions,1);
});
test('production social entry does not invoke retired short-caption generator',async()=>{
 const source=await import('node:fs/promises').then(fs=>fs.readFile(new URL('../src/integrations.mjs',import.meta.url),'utf8'));
 const entry=source.slice(source.indexOf('export async function socialStep('));
 assert.match(entry,/return artistOriginalStep\(store,provider,env,now,x\)/);
 assert.ok(entry.indexOf('reconcileX(')<entry.indexOf('artistOriginalStep('));
 assert.equal(entry.includes('return hourlyOriginalStep('),false);
 assert.equal((await socialStep({}, {}, {X_ENABLED:'false'})).status,'not_connected');
});
