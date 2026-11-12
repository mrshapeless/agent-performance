import test from 'node:test';
import assert from 'node:assert/strict';
import {artistReleaseStep,publicArtistDirection,ARTIST_DIRECTION_REVISION,browserCommission} from '../src/artist-direction.mjs';
import {artistOriginalStep} from '../src/artist-originals.mjs';
import {socialStep} from '../src/integrations.mjs';

const commission={id:'synthetic-request',state:'active',medium:'video',tool:'grok_chrome',executor:'browser'};
test('browser video request prevents any unrelated planning, generation or publication',async()=>{
 const forbidden=new Proxy({}, {get(){throw Error('Unexpected autonomous work');}});
 const result=await artistOriginalStep(forbidden,forbidden,{},new Date(),forbidden,{brief:'Synthetic',commission},null);
 assert.equal(result.status,'artist_browser_execution_required');
 assert.equal(result.medium,'video');
 const publicStatus=publicArtistDirection({brief:'Synthetic',commission:{...commission,privatePrompt:'SECRET'}});
 assert.equal(publicStatus.execution.tool,'grok_chrome');
 assert.ok(!JSON.stringify(publicStatus).includes('SECRET'));
 assert.ok(!JSON.stringify(publicStatus).includes(commission.id));
});
test('wrong format, partial completion and malformed commission never release the constraint',()=>{
 assert.equal(browserCommission({commission:{...commission,state:'complete'}}).status,'artist_commission_invalid');
 assert.equal(browserCommission({commission:{...commission,state:'complete',verifiedPublication:{medium:'image',tool:'grok_chrome',url:'https://x.com/example/status/123'}}}).status,'artist_commission_invalid');
 assert.equal(browserCommission({commission:{...commission,tool:'unknown'}}).status,'artist_commission_invalid');
 assert.equal(browserCommission({commission:{state:'complete',verifiedPublication:{url:'https://x.com/example/status/123'}}}).status,'artist_commission_invalid');
 assert.equal(browserCommission({commission:{...commission,state:'complete',verifiedPublication:{medium:'video',tool:'grok_chrome',url:'https://x.com/example/status/123'}}}).status,'artist_commission_invalid');
 assert.equal(browserCommission({commission:{...commission,state:'complete',verifiedPublication:{verified:true,medium:'video',tool:'grok_chrome',url:'https://x.com/example/status/123'}}}),null);
 assert.equal(browserCommission({brief:'Synthetic'}),null);
});

test('artist status exposes only an allowlisted receipt, never private creative content',()=>{
 const v=publicArtistDirection({brief:'PRIVATE synthetic manuscript',projectId:'private-project',manuscript:'PRIVATE draft'});
 assert.equal(v.status,'artist_projects_enabled');
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
 assert.equal(result.status,'artist_projects_enabled');
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
