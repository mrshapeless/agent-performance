import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionHealth} from './workspace-state.mjs';
import {geminiFailure} from './gemini.mjs';
test('decision failure survives unrelated activity and clears only after a successful decision',()=>{
 const now=Date.parse('2026-10-30T12:00:00Z');
 const success={seq:1,kind:'workspace_broadcast',created:new Date(now-3600000).toISOString(),payload:'{}'};
 const failure={seq:2,kind:'cognition_failed',created:new Date(now-60000).toISOString(),payload:JSON.stringify({failureCode:'GEMINI_SCHEMA_COMPLEXITY'})};
 assert.equal(decisionHealth([success,failure],now).status,'failed');
 assert.equal(decisionHealth([success,failure,{...success,seq:3,created:new Date(now).toISOString()}],now).status,'healthy');
 assert.equal(decisionHealth([success],now+7200000).status,'stale');
 assert.equal(decisionHealth([],now).status,'stale');
});
test('provider diagnostics classify errors without exposing provider text or credentials',()=>{
 const e=geminiFailure(400,{error:{message:'schema produces a constraint with too many states secret-private-input'}});
 assert.equal(e.code,'GEMINI_SCHEMA_COMPLEXITY');assert.doesNotMatch(JSON.stringify(e),/secret-private/);
 assert.equal(geminiFailure(400,[{error:{message:'schema produces a constraint with too many states'}}]).code,'GEMINI_SCHEMA_COMPLEXITY');
 assert.equal(geminiFailure(400,{error:{message:JSON.stringify([{error:{message:'schema produces a constraint with too many states'}}])}}).code,'GEMINI_SCHEMA_COMPLEXITY');
 assert.equal(geminiFailure(400,{error:{message:'API key not valid'}}).code,'GEMINI_KEY_INVALID');
 assert.equal(geminiFailure(429,null).code,'GEMINI_RATE_LIMITED');
 assert.equal(geminiFailure(503,{error:{message:'private provider detail'}}).code,'GEMINI_HTTP_503');
 assert.doesNotMatch(JSON.stringify(geminiFailure(400,{error:{message:'private provider detail'}})),/private provider/);
});
