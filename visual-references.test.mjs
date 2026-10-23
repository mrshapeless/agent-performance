import test from 'node:test';
import assert from 'node:assert/strict';
import {loadReferences,validateReferenceIds} from './visual-references.mjs';
import {AppearanceImage} from './appearance.mjs';
import {Gemini} from './gemini.mjs';
import {validateExperimentReview} from './experiments.mjs';

test('visual references are bounded catalog IDs, fetched without redirects and size limited',async()=>{
 for(const ids of [[1],[1,1],[1,25],['https://evil.test',2]])assert.throws(()=>validateReferenceIds(ids),/INVALID_VISUAL/);
 const refs=await loadReferences([2,10],async(url,options)=>{assert.equal(new URL(url).hostname,'i.pinimg.com');assert.equal(options.redirect,'error');return new Response('pixels',{headers:{'content-type':'image/jpeg'}})});
 assert.equal(refs.length,2);assert.equal(refs[0].hash.length,64);
 await assert.rejects(loadReferences([2,10],async()=>new Response('html',{headers:{'content-type':'text/html'}})),/MIME/);
 await assert.rejects(loadReferences([2,10],async()=>new Response('x',{headers:{'content-type':'image/jpeg','content-length':'2000001'}})),/TOO_LARGE/);
});
test('generator and reviewer receive real reference bytes, separately from the candidate',async()=>{
 const refs=[{mime:'image/jpeg',bytes:Buffer.from('pin one')},{mime:'image/png',bytes:Buffer.from('pin two')}];
 const im=new AppearanceImage({GEMINI_API_KEY:'test'},async(url,o)=>{const b=JSON.parse(o.body);assert.equal(b.store,false);assert.equal(b.input.length,3);assert.equal(b.input[1].data,refs[0].bytes.toString('base64'));return Response.json({status:'completed',steps:[{type:'model_output',content:[{type:'image',mime_type:'image/jpeg',data:Buffer.from('candidate').toString('base64')}]}],usage:{total_input_tokens:10,total_output_tokens:10,total_thought_tokens:0}})});
 await im.generate('An original image','1:1',refs);
 const model=new Gemini({GEMINI_API_KEY:'test',GEMINI_MODEL:'test',GEMINI_INPUT_USD_PER_MILLION:'1',GEMINI_OUTPUT_USD_PER_MILLION:'1'},async(url,o)=>{const parts=JSON.parse(o.body).contents[0].parts;assert.equal(Buffer.from(parts[1].inlineData.data,'base64').toString(),'candidate');assert.match(parts[2].text,/REFERENCE 1/);assert.equal(Buffer.from(parts[3].inlineData.data,'base64').toString(),'pin one');return Response.json({usageMetadata:{promptTokenCount:1,candidatesTokenCount:1},candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]})});
 await model.generate('review','compare',{mime:'image/jpeg',bytes:Buffer.from('candidate')},null,refs);
});
test('amusing subject cannot override failed or partial visual-language comparison',()=>{
 const v={action:'publish',hypothesisResult:'supported',observedResult:'A funny bull in a spa',noveltyEvidence:'A new subject',viewerHook:'Unmeasured',nextExperiment:'Change the actual image language',referenceComparison:'Candidate is a sharp campaign photo; references have flattened space and incompatible shading'};
 for(const visualLanguageResult of ['partly','not_supported'])assert.equal(validateExperimentReview({...v,visualLanguageResult},null,true).action,'reject');
 assert.throws(()=>validateExperimentReview(v,null,true),/INVALID_EXPERIMENT_REVIEW/);
 assert.equal(validateExperimentReview({...v,visualLanguageResult:'supported'},null,true).action,'publish');
});
