// Agent-authored working instructions are versioned experiments, not constitution edits.
export const policySchema={type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['module','instruction','reason','evidence','test','expiresAfterHours'],properties:{module:{type:'string',enum:['perception','recall','exploration','self_monitor']},instruction:{type:'string',minLength:1,maxLength:900},reason:{type:'string',minLength:1,maxLength:600},evidence:{type:'array',minItems:1,maxItems:4,items:{type:'string'}},test:{type:'string',minLength:1,maxLength:600},expiresAfterHours:{type:'integer',minimum:1,maximum:24}}}};
export function validatePolicies(policies,evidence){
 if(!Array.isArray(policies)||policies.length>4)throw Error('INVALID_ADAPTIVE_POLICY');
 const ids=new Set(evidence.filter(e=>['record_note','workspace_outcome','workspace_note','media_review','x_post','audience_measurement'].includes(e.kind)).map(e=>e.id));
 const modules=new Set();
 for(const p of policies){
  if(!policySchema.items.properties.module.enum.includes(p.module)||modules.has(p.module)||!['instruction','reason','test'].every(k=>typeof p[k]==='string'&&p[k].trim()&&p[k].length<=policySchema.items.properties[k].maxLength)||!Array.isArray(p.evidence)||!p.evidence.length||p.evidence.length>4||!p.evidence.every(id=>ids.has(id))||!Number.isInteger(p.expiresAfterHours)||p.expiresAfterHours<1||p.expiresAfterHours>24)throw Error('INVALID_ADAPTIVE_POLICY');
  modules.add(p.module);
 }
 return policies.map(p=>Object.fromEntries(policySchema.items.required.map(k=>[k,p[k]])));
}
export function workingPolicy(broadcast,module,episode){
 const previous=Number(broadcast?.episode?.split('-').at(-1)),current=Number(episode?.split('-').at(-1));
 if(!Number.isFinite(previous)||!Number.isFinite(current)||current<=previous)return null;
 const p=broadcast?.workingPolicies?.find(p=>p.module===module);
 if(!p||current-previous>p.expiresAfterHours)return null;
 return {version:broadcast.episode,module,instruction:p.instruction,test:p.test,evidence:p.evidence};
}
export function policyInstruction(policy){
 return policy?`AGENT-AUTHORED WORKING EXPERIMENT ${JSON.stringify(policy)}. Apply this revision to your method and proposal, within the immutable constitution and current operator requirements. It cannot grant tools, permissions, publication rights or change identity anchors. Treat cited claims as hypotheses. Your novelty field must state what applying this experiment changed or why evidence warrants departing from it.`:'';
}
