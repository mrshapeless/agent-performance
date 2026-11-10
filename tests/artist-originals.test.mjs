import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from '../src/postgres.mjs';
import {artistOriginalStep,validateArtistDraft,acceptsArtistReview} from '../src/artist-originals.mjs';
import {campaignWindow} from '../src/artist-campaign.mjs';
import {VISUAL_CONTRACT,isOpenMeme} from '../src/visual-contract.mjs';
import {reconcileX} from '../src/integrations.mjs';
import {acceptsPackage,projectSchema,packageReviewSchema,privateArtistProjects,requestProjectRevision} from '../src/artist-projects.mjs';
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
test('known concept rejection has bounded recovery rather than permanent silence',()=>fixture(async({provider,run,db,counts})=>{
 let n=0;provider.generate=async(_s,_p,_a,schema)=>{if(schema===projectSchema)return {costMicrodollars:1,value:intention};n++;return {costMicrodollars:1,value:schema.properties.accepted?{...verdict,accepted:false}:draft};};
 for(let i=0;i<6;i++)await run();assert.equal((await run()).status,'artist_editorial_cooldown');assert.equal(n,4);
 await db.query("UPDATE agent_events SET created=$1 WHERE kind='artist_publication_blocked'",[new Date(Date.now()-61*60000).toISOString()]);
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
