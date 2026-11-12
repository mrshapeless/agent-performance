import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from '../src/postgres.mjs';
import {artistOriginalStep,validateArtistDraft,acceptsArtistReview,artistDraftSchema,artistReviewSchema} from '../src/artist-originals.mjs';
import {campaignWindow} from '../src/artist-campaign.mjs';
import {VISUAL_CONTRACT,isOpenMeme} from '../src/visual-contract.mjs';
import {reconcileX} from '../src/integrations.mjs';
import {acceptsPackage,projectSchema,packageReviewSchema,privateArtistProjects,requestProjectRevision,repeatsShelved,projectCursor} from '../src/artist-projects.mjs';
import {isCurrentCreativePlan,CREATIVE_REVISION} from '../src/creative-revision.mjs';
import {XClient} from '../src/x.mjs';
const env={GEMINI_API_KEY:'fixture'};
const direction={brief:'A synthetic artist makes complete independent works',projectId:'finished'};
const campaign={project:'Completed film',schedule:[],publicationLedger:[]};
const draft={title:'A choice of light',intention:'Two sources of light disagree',development:'A second reflection changes the first reading',manuscript:'The reflection has somewhere else to be.',formatReason:'The entire relationship is visible in one still image',medium:'image',duration:4,ratio:'1:1',alt:'Synthetic light study',alternatives:[0,1,2].map(i=>({id:String(i),concept:'Construction '+i,visualMechanism:'Meaningful relation '+i,composition:'Viewpoint '+i,viewerExperience:'Discovery '+i,renderPrompt:'A synthetic light relationship '+i,personalStake:'Attention to competing directions',renderer:'single'})),selectedId:'0',diversityComparison:'Spatial arrangement differs from the previous image'};
const verdict={accepted:true,standaloneWork:true,meaningInArtifact:true,honestClaims:true,distinctFromRecent:true,formatComplete:true,evidence:'The second reflection changes the visible relationship.',reason:'A complete image, no supporting essay required.'};
const intention={decision:'develop',title:'Light',question:'Where does a reflection belong?',reasonToExist:'A conflict between two visible directions',development:'A second reflection changes the whole reading',neededEvidence:'Actual rendered material, no factual process claims',nextReviewHours:6};
const packageVerdict={decision:'publish',literalReading:'Two lights reflected in opposite directions',textContribution:'Names the competing direction',discoverableDevelopment:'The second reflection contradicts the first',artistConnection:'Attention to unexpected independence of a constructed surface',visibleEvidence:[{location:'lower right',observation:'Reflection points away from the visible light'}],claims:[],propOnly:false,captionRescuesImage:false,misleadingLiteralClaim:false,completeInDeliveredForm:true,reason:'The visible conflict is complete without private explanation'};
async function fixture(fn){
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(q,a)=>{const r=await db.query(q,a);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const store=new PostgresStore({query:c.query,connect:async()=>c});await store.begin('birth','birth',()=>({maximum:0}));await store.complete('birth',0,{name:'Synthetic'});
 let calls=0,posts=0,verifications=0;
 const provider={quote:()=>1,generate:async(_s,_p,_a,schema)=>{calls++;return {costMicrodollars:1,value:schema===projectSchema?intention:schema===packageReviewSchema?packageVerdict:schema.properties.accepted?verdict:draft};}};
 const x={recentPosts:async()=>[],post:async()=>{posts++;return {id:'123',url:'https://x.com/i/web/status/123'};},verifyPost:async()=>{verifications++;}};
 const run=(cam=campaign,now=new Date(),pilot=true)=>artistOriginalStep(store,provider,env,now,x,direction,cam,{load:async()=>({mime:'image/jpeg',bytes:Buffer.from('synthetic')})},pilot);
 const prepare=async(cam)=>{for(let i=0;i<5;i++){const r=await run(cam);if(r.status==='artist_media_pending')return r;}throw Error('No media prepared');};
 const ready=async()=>{
  const data={assetId:'asset',mediaId:'999',mime:'image/jpeg',finalized:true,expiresAt:Date.now()+86400000,publicationPolicy:VISUAL_CONTRACT,review:{decision:'publish',text:draft.manuscript,alt:draft.alt,visualLanguageResult:'supported',integrityResult:'supported',editorialResult:'supported'},styleAudit:{decision:'publish',commissionResult:'supported',visualLanguageResult:'supported',integrityResult:'supported',editorialResult:'supported'}};
  await db.query("UPDATE agent_media_jobs SET state='ready',data=$1",[JSON.stringify(data)]);
 };
 try{await fn({store,db,provider,x,run,ready,prepare,counts:()=>({calls,posts,verifications})});}finally{await db.close();}
}
test('artist draft preserves a long manuscript and never compresses it into a caption',()=>{
 const full='A complete authored paragraph. '.repeat(40);const result=validateArtistDraft({...draft,manuscript:full},env);
 assert.equal(result.supported,false);assert.equal(result.draft.manuscript,full);
 assert.equal(acceptsArtistReview({...verdict,meaningInArtifact:false}),false);
 assert.equal(isOpenMeme({artistWork:{},preparationCycle:'artist',stylePolicy:'reference'}),false);
});
test('local intentions need an independent state/evidence review before deferral or production',()=>fixture(async({provider,run,store,counts})=>{
 provider.local=true;
 const original=provider.generate;
 provider.generate=async(s,p,a,schema)=>schema!==projectSchema&&schema.properties.accepted?{costMicrodollars:0,value:{accepted:false,evidence:'The candidate restarts a published work.',reason:'Publication receipts establish completion; no clips were supplied.'}}:original(s,p,a,schema);
 assert.equal((await run()).status,'artist_project_developed');
 assert.equal((await run()).status,'artist_intention_reviewed');
 assert.equal((await run()).status,'artist_intention_rejected');
 assert.equal((await store.latest('artist_project_checkpoint')).state,'shelved');
 assert.equal(counts().posts,0);
 assert.equal((await run()).status,'artist_repeated_topic_skipped');
 const checkpoint=await store.latest('artist_project_checkpoint');
 const next=await store.operation(checkpoint.projectId+'-intention');
 assert.equal(next.result.switchContext.shelved.critique.accepted,false);
}));
test('rejected topics are excluded without transmitting historical criticism as new rules',()=>fixture(async({provider,run,store})=>{
 provider.local=true;let stage=0;const prompts=[];
 provider.generate=async(s,p,a,schema)=>{prompts.push({s,p});return {costMicrodollars:0,value:schema===projectSchema?(stage++===0?intention:{...intention,title:'Rain',question:'Can a puddle keep the sky?'}):{accepted:false,evidence:'Synthetic conflict',reason:'Synthetic rejection'}};};
 await run();await run();await run();
 assert.equal((await run()).status,'artist_project_developed');
 const prompt=prompts.at(-1).p;
 assert.ok(prompt.includes('excludedTopics'));assert.ok(!prompt.includes('Synthetic rejection'));
 const editor=prompts[1].s;
 assert.ok(editor.includes('Lo-fi permits blur, refraction'));assert.ok(editor.includes('UNPRODUCED'));
 assert.equal((await store.latest('artist_project_checkpoint')).title,'Rain');
}));
test('repeat guard handles punctuation and permits a genuinely new topic',()=>{
 const history=[{state:'shelved',title:'The Held Note!',question:'What changes?'}];
 assert.equal(repeatsShelved({title:'the held note',question:'Different wording'},history),true);
 assert.equal(repeatsShelved({title:'Rain',question:'Which way does it fall?'},history),false);
});
test('artist work flows from new commission through verified media to one verified original',()=>fixture(async({store,run,ready,prepare,counts})=>{
 assert.equal((await run()).status,'artist_project_developed');await prepare();
 assert.equal(await store.latest('x_post'),null);await ready();assert.equal((await run()).status,'artist_package_reviewed');assert.equal((await run()).status,'published');
 assert.deepEqual(counts(),{calls:4,posts:1,verifications:1});assert.equal((await store.latest('x_post')).text,draft.manuscript);
 await run();assert.equal(counts().posts,1);
}));
test('native campaign spacing gates delivery but never stops preparation',()=>fixture(async({run,ready,prepare,counts})=>{
 const now=new Date(),cam={...campaign,schedule:[{id:'film',at:new Date(now.getTime()+60*60000).toISOString(),status:'scheduled_in_x_verified'}]};
 await prepare(cam);await ready();await run(cam);assert.equal((await run(cam)).status,'artist_campaign_spacing');assert.equal(counts().posts,0);
 assert.equal(campaignWindow(cam,new Date(now.getTime()+61*60000)).status,'artist_campaign_verification_required');
 const published={...cam,publicationLedger:[{id:'film',publishedAtUtc:now.toISOString()}]};assert.equal(campaignWindow(published,now).status,'artist_publication_interval');assert.equal(campaignWindow(published,new Date(now.getTime()+121*60000)).due,true);
}));
test('manual original and altered manuscript prevent publication',()=>fixture(async({db,x,run,ready,prepare,counts})=>{
 await prepare();await ready();await run();
 x.recentPosts=async()=>[{id:'888',text:'Manual original',created_at:new Date().toISOString()}];
 assert.equal((await run()).status,'artist_ready');assert.equal(counts().posts,0);
 x.recentPosts=async()=>[];
 await db.query(`UPDATE agent_media_jobs SET data=jsonb_set(data,'{review,text}','"Rewritten caption"')`);
 assert.equal((await run()).status,'artist_package_blocked');assert.equal(counts().posts,0);
}));
test('verification failure keeps submission pending and recovers exact text plus attachment without resend',()=>fixture(async({db,x,run,ready,prepare,counts,store})=>{
 await prepare();await ready();await run();x.verifyPost=async()=>{throw Error('read timeout');};
 await assert.rejects(run(),/read timeout/);assert.equal(await store.latest('x_post'),null);
 await db.query("UPDATE agent_events SET created=$1 WHERE kind='operation_started'",[new Date(Date.now()-6*60000).toISOString()]);
 x.recentPosts=async()=>[{id:'123',text:draft.manuscript,attachments:{media_keys:['3_999']}}];
 assert.equal((await reconcileX(store,x)).status,'reconciled_published');assert.equal(counts().posts,1);
}));
test('concept rejection starts a different idea next cycle without an hourly cooldown',()=>fixture(async({provider,run,store,counts})=>{
 let n=0,ideas=0;provider.generate=async(_s,_p,_a,schema)=>{if(schema===projectSchema)return {costMicrodollars:1,value:ideas++?{...intention,title:'Rain',question:'Where does rain go?'}:intention};n++;return {costMicrodollars:1,value:schema.properties.accepted?{...verdict,accepted:false}:draft};};
 for(let i=0;i<6;i++)await run();assert.equal((await run()).status,'artist_project_developed');assert.equal(n,4);
 assert.equal((await store.latest('artist_project_checkpoint')).title,'Rain');
 assert.equal((await run()).status,'artist_work_prepared');assert.equal(n,5);assert.equal(counts().posts,0);
}));
test('X readback checks author, complete text and attachment',async()=>{
 const client=Object.create(XClient.prototype);client.verify=async()=>({id:'42'});
 let post={id:'123',author_id:'42',text:'Exact manuscript https://t.co/image',attachments:{media_keys:['3_999']}};
 client.request=async()=>({data:post});await client.verifyPost('123','Exact manuscript','999');
 for(const changed of [{...post,author_id:'wrong'},{...post,text:'Different text'},{...post,attachments:{media_keys:['3_111']}}]){const original=post;post=changed;await assert.rejects(client.verifyPost('123','Exact manuscript','999'),/VERIFICATION/);post=original;}
});

test('old attractive tape package cannot publish despite prior media approvals',()=>fixture(async({provider,run,prepare,ready,counts,store})=>{
 const original=provider.generate;
 provider.generate=async(s,p,a,schema)=>schema===packageReviewSchema?{costMicrodollars:1,value:{...packageVerdict,decision:'reject',propOnly:true,misleadingLiteralClaim:true,claims:[{quote:'the only way to know if there is voice on it is to hold it between your teeth and pull',kind:'fact',supported:false,evidence:'The image does not establish a way to detect a recording.'}]}}:original(s,p,a,schema);
 await prepare();await ready();assert.equal((await run()).status,'artist_package_reviewed');
 assert.equal((await run()).status,'artist_package_rejected');assert.equal(counts().posts,0);
 assert.equal((await store.latest('artist_project_checkpoint')).state,'blocked');
 assert.equal(acceptsPackage({...packageVerdict,propOnly:true}),false);
 assert.equal(isCurrentCreativePlan({creativeRevision:CREATIVE_REVISION,artistWork:{version:'artist-originals-2026-11-10-v1'}}),false);
}));

test('full film survives as a visible execution request, never replaced by a short image',()=>fixture(async({provider,run,db,store,counts})=>{
 const original=provider.generate,full='A complete musical passage. '.repeat(50);
 provider.generate=async(s,p,a,schema)=>schema.properties.manuscript?{costMicrodollars:1,value:{...draft,medium:'music_film',duration:100,manuscript:full}}:original(s,p,a,schema);
 await run();await run();await run();assert.equal((await run()).status,'artist_format_delivery_required');
 const cursor=await store.latest('artist_project_checkpoint');assert.equal(cursor.state,'execution_required');
 const queue=await privateArtistProjects(store);assert.ok(queue.some(p=>p.result?.draft?.manuscript===full));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM agent_media_jobs')).rows[0].n,0);
 const before=counts();await run();assert.deepEqual(counts(),before);
}));

test('project identity survives an unrelated manual or campaign post',()=>fixture(async({run,store})=>{
 await run();const before=await store.latest('artist_project_checkpoint');
 const req=await store.begin('synthetic-manual-receipt','step',()=>({maximum:0}));await store.complete('synthetic-manual-receipt',0,{action:'x_post',text:'Existing campaign',url:'https://x.com/i/web/status/777'});
 await run();assert.equal((await store.latest('artist_project_checkpoint')).projectId,before.projectId);
}));

test('project planner can defer without manufacturing content or claiming a publication',()=>fixture(async({provider,run,store,counts})=>{
 provider.generate=async()=>({costMicrodollars:1,value:{...intention,decision:'defer'}});
 assert.equal((await run()).status,'artist_project_developed');assert.equal((await run()).status,'artist_project_deferred');
 assert.equal(await store.latest('x_post'),null);assert.equal(counts().posts,0);
}));

test('idle is capped at two hours and consecutive idle survives rejected proposals and restart',()=>fixture(async({provider,store})=>{
 const start=new Date('2030-01-01T00:00:00Z');
 provider.generate=async()=>({costMicrodollars:1,value:{...intention,decision:'defer',nextReviewHours:24}});
 const step=t=>projectCursor(store,provider,direction,new Date(t));
 await step(start);
 assert.equal((await step(start)).nextAt,'2030-01-01T02:00:00.000Z');
 assert.equal((await step('2030-01-01T02:00:00Z')).status,'artist_project_reconsideration');
 await step('2030-01-01T02:01:00Z');
 assert.equal((await step('2030-01-01T02:02:00Z')).status,'artist_consecutive_defer_rejected');
 await step('2030-01-01T02:03:00Z');
 assert.equal((await store.latest('artist_defer_policy')).blocked,true);
 assert.equal(await store.latest('x_post'),null);
}));

test('legacy stored 24 hour deferral expires from its original start, not deployment time',()=>fixture(async({provider,store})=>{
 const id='legacy-defer';
 await store.begin(id+'-intention','step',()=>({maximum:0}));
 await store.complete(id+'-intention',0,{action:'artist_project_internal',...intention,decision:'defer',nextReviewHours:24,nextReviewAt:'2030-01-02T00:00:00Z'});
 await store.begin('legacy-checkpoint','step',()=>({maximum:0}));
 await store.complete('legacy-checkpoint',0,{action:'artist_project_checkpoint',policy:'artist-projects-2026-11-10-v2',projectId:id,state:'intention',nextReviewAt:'2030-01-02T00:00:00Z'});
 assert.equal((await projectCursor(store,provider,direction,new Date('2030-01-01T03:00:00Z'))).status,'artist_project_reconsideration');
 assert.equal((await store.latest('artist_defer_policy')).nextReviewAt,'2030-01-01T02:00:00.000Z');
}));

test('initial actual pilot inspection is required beyond model approval',()=>fixture(async({run,prepare,ready,counts,store})=>{
 await prepare();await ready();await run();assert.equal((await run(campaign,new Date(),false)).status,'artist_pilot_inspection_required');assert.equal(counts().posts,0);
 const cursor=await store.latest('artist_project_checkpoint');assert.equal((await requestProjectRevision(store,cursor.projectId)).status,'revision_requested');
 assert.equal((await run()).status,'artist_project_developed');assert.notEqual((await store.latest('artist_project_checkpoint')).projectId,cursor.projectId);
}));

test('complete prose has an inspected, verified and idempotent browser return path',()=>fixture(async({provider,run,store,x,counts})=>{
 const {proseHandoff,inspectProseHandoff,returnProsePublication}=await import('../src/artist-projects.mjs');
 const original=provider.generate,full='An explicitly fictional paragraph. '.repeat(30);
 provider.generate=async(s,p,a,schema)=>schema.properties.manuscript?{costMicrodollars:1,value:{...draft,medium:'essay',duration:0,manuscript:full}}:original(s,p,a,schema);
 await run();await run();await run();assert.equal((await run()).status,'artist_format_delivery_required');
 const cursor=await store.latest('artist_project_checkpoint'),id=cursor.projectId,h=await proseHandoff(store,id);
 assert.equal(h.manuscript,full);
 await assert.rejects(returnProsePublication(store,id,'456',x),/INSPECTION/);
 await assert.rejects(inspectProseHandoff(store,id,'wrong','Inspected all paragraphs'),/INSPECTION/);
 await inspectProseHandoff(store,id,h.manuscriptHash,'Read the full fictional work; development is visible in the text.',new Date('2026-01-01'));
 x.verifyFullTextPost=async(postId,text)=>{assert.equal(postId,'456');assert.equal(text,full);return {created_at:'2026-01-02T00:00:00Z'};};
 assert.equal((await returnProsePublication(store,id,'456',x)).status,'published');
 assert.equal((await store.latest('x_post')).text,full);assert.equal(counts().posts,0);
 assert.equal((await returnProsePublication(store,id,'456',x)).replay,true);
 await run();const next=await store.latest('artist_project_checkpoint');
 await returnProsePublication(store,id,'456',x);assert.equal((await store.latest('artist_project_checkpoint')).projectId,next.projectId);
}));

test('unsupported prose claims fail despite concept approval and preserve actionable critique',()=>fixture(async({provider,run,store,counts})=>{
 const original=provider.generate;
 provider.generate=async(s,p,a,schema)=>schema.properties.manuscript?{costMicrodollars:1,value:{...draft,medium:'essay',manuscript:'Every synthetic singer needs this technique.'}}:schema===packageReviewSchema?{costMicrodollars:1,value:{...packageVerdict,decision:'revise',claims:[{quote:'Every synthetic singer',kind:'fact',supported:false,evidence:'No source or audio comparison was supplied.'}]}}:original(s,p,a,schema);
 await run();await run();await run();assert.equal((await run()).status,'artist_prose_revision_required');
 const c=await store.latest('artist_project_checkpoint');assert.equal(c.critique.claims[0].supported,false);assert.equal(counts().posts,0);
 const {proseHandoff}=await import('../src/artist-projects.mjs');await assert.rejects(proseHandoff(store,c.projectId),/NOT_AWAITING/);
 await requestProjectRevision(store,c.projectId);assert.equal((await store.latest('artist_project_checkpoint')).critique.claims[0].supported,false);
}));

test('long-post readback rejects truncated, wrong-author, reply and attachment substitutions',async()=>{
 const client=Object.create(XClient.prototype);client.verify=async()=>({id:'42'});
 const full='Complete paragraph. '.repeat(40),base={id:'123',author_id:'42',text:'Truncated preview',note_tweet:{text:full},created_at:'2026-01-02T00:00:00Z'};
 let post=base;client.request=async(method)=>{assert.equal(method,'GET');return {data:post};};
 await client.verifyFullTextPost('123',full);
 for(const altered of [{...base,note_tweet:undefined},{...base,author_id:'99'},{...base,referenced_tweets:[{type:'replied_to',id:'7'}]},{...base,attachments:{media_keys:['3_99']}},{...base,created_at:'unknown'}]){post=altered;await assert.rejects(client.verifyFullTextPost('123',full),/VERIFICATION/);}
});

test('failed prose review stays an explicit failure without a repeated paid call',()=>fixture(async({store,provider})=>{
 const {reviewCompleteProse}=await import('../src/artist-projects.mjs');let attempts=0;
 provider.generate=async()=>{attempts++;throw Error('provider unavailable');};
 assert.equal((await reviewCompleteProse(store,provider,'Synthetic complete prose')).status,'artist_prose_review_failed');
 assert.equal((await reviewCompleteProse(store,provider,'Synthetic complete prose')).status,'artist_prose_review_failed');assert.equal(attempts,1);
}));

test('revision critique survives intention generation and reaches the actual manuscript writer',()=>fixture(async({store,provider,run})=>{
 const {projectCheckpoint}=await import('../src/artist-projects.mjs');
 await run();const first=await store.latest('artist_project_checkpoint');
 await projectCheckpoint(store,first.projectId,'editorial_revision_required',{title:'Synthetic',critique:{reason:'Do not repeat the unsupported synthetic factual claim.'},nextAction:'Remove this claim or obtain evidence.'});
 await requestProjectRevision(store,first.projectId);
 await run();const second=await store.latest('artist_project_checkpoint');
 const intentionOp=await store.operation(second.projectId+'-intention');assert.equal(intentionOp.result.revisionContext.projectId,first.projectId);
 const original=provider.generate;let writerPrompt;
 provider.generate=async(s,p,a,schema)=>{if(schema.properties.manuscript)writerPrompt=p;return original(s,p,a,schema);};
 await run();assert.match(writerPrompt,/Do not repeat the unsupported synthetic factual claim/);assert.match(writerPrompt,/Remove this claim or obtain evidence/);
}));

test('long image manuscript receives independent claim review before execution handoff',()=>fixture(async({provider,run,store,counts,db})=>{
 const original=provider.generate,full='Most virtual singers always ignore the room. '.repeat(10);let reads=0;
 provider.generate=async(s,p,a,schema)=>{
  if(schema.properties.manuscript)return {costMicrodollars:1,value:{...draft,medium:'image',manuscript:full}};
  if(schema===packageReviewSchema){reads++;assert.match(p,/preliminary text-only check/);assert.doesNotMatch(p,/renderPrompt/);return {costMicrodollars:1,value:{...packageVerdict,decision:'revise',claims:[{quote:'Most virtual singers',kind:'fact',supported:false,evidence:'No evidence supports this population-wide claim.'}]}};}
  return original(s,p,a,schema);
 };
 await run();await run();await run();assert.equal((await run()).status,'artist_prose_revision_required');
 const checkpoint=await store.latest('artist_project_checkpoint');assert.equal(checkpoint.state,'editorial_revision_required');assert.equal(checkpoint.critique.claims[0].supported,false);
 await run();assert.equal(reads,1);assert.equal(counts().posts,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM agent_media_jobs')).rows[0].n,0);
}));

test('a rejected revision is shelved automatically and a different idea reaches the writer',()=>fixture(async({store,provider,run,counts})=>{
 const {projectCheckpoint}=await import('../src/artist-projects.mjs');
 await run();const first=await store.latest('artist_project_checkpoint');
 await projectCheckpoint(store,first.projectId,'editorial_revision_required',{title:'Synthetic first idea',critique:{reason:'Missing evidence'},nextAction:'Revise'});
 assert.equal((await requestProjectRevision(store,first.projectId)).status,'revision_requested');
 await run();const second=await store.latest('artist_project_checkpoint');
 await projectCheckpoint(store,second.projectId,'editorial_revision_required',{title:'Synthetic revised idea',critique:{reason:'Still missing evidence'},nextAction:'Revise'});
 const original=provider.generate;let planner,writer;
 provider.generate=async(s,p,a,schema)=>{if(schema===projectSchema){planner=p;return {costMicrodollars:1,value:{...intention,title:'Rain',question:'Which way does the rain fall?'}};}if(schema.properties.manuscript)writer=p;return original(s,p,a,schema);};
 await run();const third=await store.latest('artist_project_checkpoint');
 assert.notEqual(third.projectId,second.projectId);
 const next=(await store.operation(third.projectId+'-intention')).result;
 assert.equal(next.revisionContext,null);assert.equal(next.switchContext.shelved.state,'shelved');
 assert.equal(next.switchContext.shelved.critique.reason,'Still missing evidence');
 assert.equal(next.switchContext.shelved.previousRevision.critique.reason,'Missing evidence');
 assert.match(planner,/Do not rename, paraphrase or continue/);
 await run();assert.match(writer,/Choose a genuinely different artistic question/);
 assert.equal(counts().posts,0);
 assert.equal((await requestProjectRevision(store,second.projectId)).status,'not_revisable');
}));

test('exhausted concept attempts remain inspectable and reach the next writer on revision',()=>fixture(async({provider,run,store})=>{
 const original=provider.generate;
 provider.generate=async(s,p,a,schema)=>schema.properties.accepted?{costMicrodollars:1,value:{...verdict,accepted:false,honestClaims:false,reason:'Unsupported room-acoustic claim in actual text.'}}:original(s,p,a,schema);
 for(let i=0;i<6;i++)await run();
 const checkpoint=await store.latest('artist_project_checkpoint');assert.equal(checkpoint.failureCode,'CONCEPT_ATTEMPTS_EXHAUSTED');
 const rows=await privateArtistProjects(store);assert.equal(rows.filter(r=>r.result?.action==='artist_concept_review').length,2);
 await requestProjectRevision(store,checkpoint.projectId);
 const revision=await store.latest('artist_project_checkpoint');assert.equal(revision.critique.attempts.length,2);
 await run();let writerPrompt;
 provider.generate=async(s,p,a,schema)=>{if(schema.properties.manuscript)writerPrompt=p;return original(s,p,a,schema);};
 await run();assert.match(writerPrompt,/Unsupported room-acoustic claim in actual text/);
}));

test('external image package binds pixels, complete text, inspection and idempotent readback',()=>fixture(async({provider,run,store})=>{
 const sharp=(await import('sharp')).default;
 const {importImagePackage,inspectImageHandoff,returnImagePublication}=await import('../src/artist-projects.mjs');
 const original=provider.generate,full='A fictional reflection crosses the paper. '.repeat(10);
 provider.generate=async(s,p,a,schema)=>schema.properties.manuscript?{costMicrodollars:1,value:{...draft,manuscript:full}}:original(s,p,a,schema);
 for(let i=0;i<4;i++)await run();
 const project=(await store.latest('artist_project_checkpoint')).projectId;
 const bytes=await sharp({create:{width:300,height:300,channels:3,background:'#987654'}}).png().toBuffer();
 const h=await importImagePackage(store,provider,env,project,bytes.toString('base64'));
 assert.equal(h.accepted,true);assert.equal(h.manuscript,full);
 assert.equal((await store.operation(h.assetId)).result.purpose,'private_artist_image');
 const x={verifyImageFullTextPost:async(id,text,image)=>{assert.equal(text,full);assert.deepEqual(Buffer.from(image),bytes);return {created_at:new Date(Date.now()+1000).toISOString(),verifiedMediaKey:'3_1'};}};
 await assert.rejects(returnImagePublication(store,project,h.assetId,'987',x),/INSPECTION_REQUIRED/);
 await assert.rejects(inspectImageHandoff(store,project,h.assetId,'wrong','Actual pixels'),/INSPECTION_REQUIRED/);
 await inspectImageHandoff(store,project,h.assetId,h.manuscriptHash,'Actual square synthetic color field inspected with complete text.');
 assert.equal((await returnImagePublication(store,project,h.assetId,'987',x)).status,'published');
 assert.equal((await returnImagePublication(store,project,h.assetId,'987',x)).replay,true);
 assert.equal((await store.latest('x_post')).assetId,h.assetId);
}));

test('image readback tolerates recompression but rejects substitutions and unexpected media hosts',async()=>{
 const sharp=(await import('sharp')).default;
 const {matchesPublishedImage}=await import('../src/x.mjs');
 const bytes=await sharp({create:{width:320,height:256,channels:3,background:'#987654'}}).png().toBuffer();
 const compressed=await sharp(bytes).jpeg({quality:90}).toBuffer();
 const changed=await sharp({create:{width:320,height:256,channels:3,background:'#1122ff'}}).png().toBuffer();
 assert.equal(await matchesPublishedImage(bytes,compressed),true);
 assert.equal(await matchesPublishedImage(bytes,changed),false);
 const client=Object.create(XClient.prototype);client.verify=async()=>({id:'42'});
 const p={id:'123',author_id:'42',text:'Preview',note_tweet:{text:'Full exact text'},created_at:'2026-01-02T00:00:00Z',attachments:{media_keys:['3_1']}};
 let result={data:p,includes:{media:[{media_key:'3_1',type:'photo',url:'https://pbs.twimg.com/media/synthetic.jpg'}]}};
 client.request=async()=>result;client.fetcher=async()=>new Response(compressed);
 await client.verifyImageFullTextPost('123','Full exact text',bytes);
 for(const altered of [{...p,note_tweet:undefined},{...p,author_id:'99'},{...p,attachments:{media_keys:['3_2']}},{...p,referenced_tweets:[{type:'replied_to'}]}]){
  result={...result,data:altered};await assert.rejects(client.verifyImageFullTextPost('123','Full exact text',bytes));
 }
 result={data:p,includes:{media:[{media_key:'3_1',type:'photo',url:'https://example.com/private'}]}};
 await assert.rejects(client.verifyImageFullTextPost('123','Full exact text',bytes),/IMAGE_VERIFICATION_FAILED/);
});

test('generation schema carries server text bounds before local repair returns a draft',()=>{
 for(const k of ['title','question','reasonToExist','development','neededEvidence']){assert.equal(projectSchema.properties[k].minLength,1);assert.equal(projectSchema.properties[k].maxLength,2000);}
 for(const k of ['title','intention','development','formatReason','diversityComparison']){assert.equal(artistDraftSchema.properties[k].maxLength,1400); assert.throws(()=>validateArtistDraft({...draft,[k]:'a'.repeat(1401)},env),/INVALID_ARTIST_DRAFT/);}
 assert.equal(artistDraftSchema.properties.manuscript.maxLength,12000);
 assert.equal(artistDraftSchema.properties.alt.maxLength,500);
});

test('malformed concept review retries once, preserves failure and cannot loop',()=>fixture(async({provider,run,counts})=>{
 const original=provider.generate;let reviews=0;provider.generate=async(s,p,a,schema)=>{if(schema.properties.standaloneWork){reviews++;return {costMicrodollars:1,value:{...verdict,reason:'x'.repeat(1601)}};}return original(s,p,a,schema);};
 for(let i=0;i<10;i++)await run();assert.equal(reviews,2);assert.equal(counts().posts,0);
}));

test('planner and independent editor receive actual production capabilities before material',()=>fixture(async({store,provider})=>{
 provider.local=true;const prompts=[];const generate=provider.generate;
 provider.generate=async(s,p,a,schema)=>{prompts.push(p);return generate(s,p,a,schema);};
 const capabilities={image:true,character:false,video:false};
 await projectCursor(store,provider,direction,new Date(),capabilities);
 await projectCursor(store,provider,direction,new Date(),capabilities);
 assert.equal(prompts.length,2);
 for(const p of prompts)assert.ok(p.includes('"productionCapabilities":{"image":true,"character":false,"video":false}'));
 assert.ok(prompts[0].includes('not artistic genre preferences'));
 assert.ok(prompts[1].includes('Do not assume an operator will supply missing media or sound'));
}));

test('capability deployment preserves an admitted project with material already pending',()=>fixture(async({store,provider,counts})=>{
 provider.local=true;
 await projectCursor(store,provider,direction,new Date());
 await projectCursor(store,provider,direction,new Date());
 const project=await projectCursor(store,provider,direction,new Date());
 await store.begin('x-plan-'+project.id+'-0','step',()=>({maximum:0}));
 const before=counts().calls;
 const resumed=await projectCursor(store,provider,direction,new Date(),{image:true,character:false,video:false});
 assert.equal(resumed.id,project.id);
 assert.equal(counts().calls,before);
 assert.equal(await store.operation(project.id+'-intention-local-review-v4-capabilities'),null);
 assert.equal((await store.operation('x-plan-'+project.id+'-0')).status,'pending');
}));

test('material editor receives accepted intention and can reject a substituted artifact',()=>fixture(async({provider,run,counts})=>{
 const generate=provider.generate;let checked=false;
 provider.generate=async(s,p,a,schema)=>{
  if(schema===artistReviewSchema){
   assert.ok(p.includes('"acceptedIntention":'));
   assert.ok(p.includes(intention.question));
   assert.ok(p.includes('indispensable temporal, audible'));
   checked=true;return {costMicrodollars:0,value:{...verdict,accepted:false,formatComplete:false}};
  }
  return generate(s,p,a,schema);
 };
 for(let i=0;i<4;i++)await run();
 assert.equal(checked,true);assert.equal(counts().posts,0);
}));
