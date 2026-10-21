import {oauthStatus} from './oauth.mjs';
import { constitution } from './domain.mjs';
import { XClient } from './x.mjs';

const keys = ['X_API_KEY','X_API_SECRET','X_ACCESS_TOKEN','X_ACCESS_TOKEN_SECRET','X_EXPECTED_USERNAME'];
export async function accountSetup(store, provider, env, now = new Date()) {
  if (!await store.latest('account_profile')) {
    const id = 'x-account-profile-v1';
    const req = await store.begin(id, 'step', identity => {
      const prompt = `Prepare your own public X account profile. Choose a preferred username and two alternatives (5-15 ASCII letters, digits, underscores, no @), displayName (1-50 characters), bio (1-160 characters), and summary explaining your choice. Return JSON with strings username, alternative1, alternative2, displayName, bio, summary. Use your existing identity and appearance. Identify yourself transparently as an autonomous AI artist. Do not claim username availability, account registration or audience activity. No passwords, emails or other private details. Identity: ${JSON.stringify(identity)}`;
      return {prompt, maximum: provider.quote(constitution, prompt)};
    });
    if (req.replay) return {status:req.status};
    const answer = await provider.generate(constitution, req.prompt);
    const v = answer.value;
    const text = (s,max) => typeof s === 'string' && s.trim().length > 0 && [...s].length <= max;
    if (!v || !['username','alternative1','alternative2'].every(k=>/^[A-Za-z0-9_]{5,15}$/.test(v[k]??'')) || new Set([v.username,v.alternative1,v.alternative2].map(s=>s.toLowerCase())).size !== 3 || !text(v.displayName,50) || !text(v.bio,160) || !text(v.summary,2000)) throw Error('INVALID_ACCOUNT_PROFILE');
    await store.complete(id,answer.costMicrodollars,{action:'account_profile',username:v.username,alternative1:v.alternative1,alternative2:v.alternative2,displayName:v.displayName,bio:v.bio,summary:v.summary,text:`X profile prepared: @${v.username}\n${v.displayName}\n${v.bio}\nAlternatives: @${v.alternative1}, @${v.alternative2}. Availability and registration are not yet verified.`});
    return {status:'profile_ready'};
  }
  if(env.X_CLIENT_ID&&env.X_CLIENT_SECRET)return {status:(await oauthStatus(store))?.status??'owner_action_required'};
  if (!keys.every(k=>env[k])) return {status:'owner_action_required'};
  const expected=env.X_EXPECTED_USERNAME.replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{1,15}$/.test(expected))return {status:'invalid_username'};
  const previous = await store.latest('account_connection');
  if(previous?.status==='verified' && previous.username===expected)return {status:'verified'};
  const id='x-connect-'+expected+'-'+Math.floor(now.getTime()/3600000);
  const req=await store.begin(id,'step',()=>({maximum:10000}));
  if(req.replay)return {status:req.status};
  // Read-only ownership check. Never publish as part of account onboarding.
  let result;
  try {
    const account=await new XClient(env).verify();
    result={action:'account_connection',status:'verified',username:expected,text:`X account @${account.username} verified through its access token.`,summary:'Account ownership verified. Publishing still requires X_ENABLED=true.'};
  } catch(error) {
    const code=/^(X_HTTP_\d{3}|X_ACCOUNT_MISMATCH)$/.test(error.message)?error.message:'X_VERIFICATION_UNAVAILABLE';
    result={action:'account_connection',status:'failed',username:expected,text:'X account verification needs operator attention: '+code,summary:'No post was attempted. Read-only verification can retry in the next hourly slot.'};
  }
  await store.complete(id,10000,result);
  return {status:result.status};
}

export async function accountStatus(store,env){
  const profile=await store.latest('account_profile');
  const connection=await store.latest('account_connection');
  const oauth=!!(env.X_CLIENT_ID&&env.X_CLIENT_SECRET);
  const token=oauth?await oauthStatus(store):null;
  const missing=(oauth?['X_CLIENT_ID','X_CLIENT_SECRET','X_EXPECTED_USERNAME']:keys).filter(k=>!env[k]);
  const matches=oauth?token?.status==='connected'&&token.username===env.X_EXPECTED_USERNAME?.replace(/^@/,'').toLowerCase():connection?.status==='verified' && connection.username===env.X_EXPECTED_USERNAME?.replace(/^@/,'').toLowerCase();
  const stage=!profile?'preparing_profile':missing.length?'owner_action_required':!matches?'verification_pending':env.X_ENABLED==='true'?'posting_enabled':'activation_required';
  return {platform:'x',stage,authMethod:oauth?'oauth2':'oauth1',profile:profile?Object.fromEntries(['username','alternative1','alternative2','displayName','bio'].map(k=>[k,profile[k]])):null,
    registrationVerified:!!matches, missing, connectionMessage:connection?.text??null,
    nextAction:!profile?'The agent will prepare its profile on the next setup cycle.':missing.length?'Owner: complete X registration and developer access, then add the listed credentials in Vercel. The agent has prepared the profile; no account creation or username availability is claimed.':!matches?(oauth?'Operator: open OPERATOR ACCESS, enter the operator token and click Connect X.':'Waiting for a read-only account ownership check.'):env.X_ENABLED==='true'?'Original text posting is enabled. Replies and profile synchronization are not implemented yet.':'Owner connection verified. Set X_ENABLED=true to enable the existing posting schedule.'};
}
