import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from '../src/postgres.mjs';
import {artistOriginalStep,validateArtistDraft,acceptsArtistReview} from '../src/artist-originals.mjs';
import {campaignWindow} from '../src/artist-campaign.mjs';
import {VISUAL_CONTRACT,isOpenMeme} from '../src/visual-contract.mjs';
import {reconcileX} from '../src/integrations.mjs';
import {XClient} from '../src/x.mjs';
const env={GEMINI_API_KEY:'fixture'};
const direction={brief:'A synthetic artist makes complete independent works',projectId:'finished'};
const campaign={project:'Completed film',schedule:[],publicationLedger:[]};
const draft={title:'A choice of light',intention:'Two sources of light disagree',development:'A second reflection changes the first reading',manuscript:'The reflection has somewhere else to be.',formatReason:'The entire relationship is visible in one still image',medium:'image',duration:4,ratio:'1:1',alt:'Synthetic light study',alternatives:[0,1,2].map(i=>({id:String(i),concept:'Construction '+i,visualMechanism:'Meaningful relation '+i,composition:'Viewpoint '+i,viewerExperience:'Discovery '+i,renderPrompt:'A synthetic light relationship '+i,personalStake:'Attention to competing directions',renderer:'single'})),selectedId:'0',diversityComparison:'Spatial arrangement differs from the previous image'};
const verdict={accepted:true,standaloneWork:true,meaningInArtifact:true,honestClaims:true,distinctFromRecent:true,formatComplete:true,evidence:'The second reflection changes the visible relationship.',reason:'A complete image, no supporting essay required.'};
async function fixture(fn){
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(q,a)=>{const r=await db.query(q,a);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const store=new PostgresStore({query:c.query,connect:async()=>c});await store.begin('birth','birth',()=>({maximum:0}));await store.complete('birth',0,{name:'Synthetic'});
 let calls=0,posts=0,verifications=0;
 const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls%2?draft:verdict})};
 const x={recentPosts:async()=>[],post:async()=>{posts++;return {id:'123',url:'https://x.com/i/web/status/123'};},verifyPost:async()=>{verifications++;}};
 const run=(cam=campaign,now=new Date())=>artistOriginalStep(store,provider,env,now,x,direction,cam);
 const ready=async()=>{
  const data={assetId:'asset',mediaId:'999',mime:'image/jpeg',finalized:true,expiresAt:Date.now()+86400000,publicationPolicy:VISUAL_CONTRACT,review:{decision:'publish',text:draft.manuscript,alt:draft.alt,visualLanguageResult:'supported',integrityResult:'supported',editorialResult:'supported'},styleAudit:{decision:'publish',commissionResult:'supported',visualLanguageResult:'supported',integrityResult:'supported',editorialResult:'supported'}};
  await db.query("UPDATE agent_media_jobs SET state='ready',data=$1",[JSON.stringify(data)]);
 };
 try{await fn({store,db,provider,x,run,ready,counts:()=>({calls,posts,verifications})});}finally{await db.close();}
}
test('artist draft preserves a long manuscript and never compresses it into a caption',()=>{
 const full='A complete authored paragraph. '.repeat(40);const result=validateArtistDraft({...draft,manuscript:full},env);
 assert.equal(result.supported,false);assert.equal(result.draft.manuscript,full);
 assert.equal(acceptsArtistReview({...verdict,meaningInArtifact:false}),false);
 assert.equal(isOpenMeme({artistWork:{},preparationCycle:'artist',stylePolicy:'reference'}),false);
});
test('artist work flows from new commission through verified media to one verified original',()=>fixture(async({store,run,ready,counts})=>{
 assert.equal((await run()).status,'artist_work_prepared');assert.equal((await run()).status,'artist_concept_reviewed');assert.equal((await run()).status,'artist_media_pending');
 assert.equal(await store.latest('x_post'),null);await ready();assert.equal((await run()).status,'published');
 assert.deepEqual(counts(),{calls:2,posts:1,verifications:1});assert.equal((await store.latest('x_post')).text,draft.manuscript);
 await run();assert.equal(counts().posts,1);
}));
test('native campaign spacing gates delivery but never stops preparation',()=>fixture(async({run,ready,counts})=>{
 const now=new Date(),cam={...campaign,schedule:[{id:'film',at:new Date(now.getTime()+60*60000).toISOString(),status:'scheduled_in_x_verified'}]};
 assert.equal((await run(cam)).status,'artist_work_prepared');await run(cam);await run(cam);await ready();assert.equal((await run(cam)).status,'artist_campaign_spacing');assert.equal(counts().posts,0);
 assert.equal(campaignWindow(cam,new Date(now.getTime()+61*60000)).status,'artist_campaign_verification_required');
 const published={...cam,publicationLedger:[{id:'film',publishedAtUtc:now.toISOString()}]};assert.equal(campaignWindow(published,now).status,'artist_publication_interval');assert.equal(campaignWindow(published,new Date(now.getTime()+121*60000)).due,true);
}));
test('manual original and altered manuscript prevent publication',()=>fixture(async({db,x,run,ready,counts})=>{
 await run();await run();await run();await ready();
 x.recentPosts=async()=>[{id:'888',text:'Manual original',created_at:new Date().toISOString()}];
 assert.equal((await run()).status,'artist_ready');assert.equal(counts().posts,0);
 x.recentPosts=async()=>[];
 await db.query(`UPDATE agent_media_jobs SET data=jsonb_set(data,'{review,text}','"Rewritten caption"')`);
 assert.equal((await run()).status,'artist_package_blocked');assert.equal(counts().posts,0);
}));
test('verification failure keeps submission pending and recovers exact text plus attachment without resend',()=>fixture(async({db,x,run,ready,counts,store})=>{
 await run();await run();await run();await ready();x.verifyPost=async()=>{throw Error('read timeout');};
 await assert.rejects(run(),/read timeout/);assert.equal(await store.latest('x_post'),null);
 await db.query("UPDATE agent_events SET created=$1 WHERE kind='operation_started'",[new Date(Date.now()-6*60000).toISOString()]);
 x.recentPosts=async()=>[{id:'123',text:draft.manuscript,attachments:{media_keys:['3_999']}}];
 assert.equal((await reconcileX(store,x)).status,'reconciled_published');assert.equal(counts().posts,1);
}));
test('known concept rejection has bounded recovery rather than permanent silence',()=>fixture(async({provider,run,db,counts})=>{
 let n=0;provider.generate=async()=>({costMicrodollars:1,value:++n%2?draft:{...verdict,accepted:false}});
 for(let i=0;i<5;i++)await run();assert.equal((await run()).status,'artist_editorial_cooldown');assert.equal(n,4);
 await db.query("UPDATE agent_events SET created=$1 WHERE kind='artist_publication_blocked'",[new Date(Date.now()-61*60000).toISOString()]);
 assert.equal((await run()).status,'artist_work_prepared');assert.equal(n,5);assert.equal(counts().posts,0);
}));
test('X readback checks author, complete text and attachment',async()=>{
 const client=Object.create(XClient.prototype);client.verify=async()=>({id:'42'});
 let post={id:'123',author_id:'42',text:'Exact manuscript https://t.co/image',attachments:{media_keys:['3_999']}};
 client.request=async()=>({data:post});await client.verifyPost('123','Exact manuscript','999');
 for(const changed of [{...post,author_id:'wrong'},{...post,text:'Different text'},{...post,attachments:{media_keys:['3_111']}}]){const original=post;post=changed;await assert.rejects(client.verifyPost('123','Exact manuscript','999'),/VERIFICATION/);post=original;}
});
