import {PostgresStore} from './postgres.mjs';
// Incident-specific reconciliation: Vercel log at 2026-10-21T19:14:17.143Z
// confirmed X_HTTP_402 for this exact publication. Never infer rejection from age.
// Called inside migration's transaction, lock and generation search_path.
export async function recoverRejectedX(client,instance){
 if(instance!=='generation_02')return;
 for(const [id,code,at] of [['x-publish-248973','402','2026-10-21T19:14:17.143Z'],['x-publish-248975','401','2026-10-21T22:30:27.723Z']]){
 const row=(await client.query('SELECT status,amount FROM agent_operations WHERE id=$1',[id])).rows[0];
 if(row?.status!=='pending')continue;
 const result={action:'x_failed',text:`X rejected publication with HTTP ${code}; the interrupted operation has been reconciled.`,summary:`Confirmed from the production error log at ${at}. No publication confirmed. Conservative estimated cost retained.`,errorCode:'X_HTTP_'+code};
 const store=new PostgresStore(null);
 await store.append(client,'x_failed',result);
 await store.append(client,'operation_completed',{id,actualMicrodollars:Number(row.amount),costBasis:'conservative reservation retained after confirmed rejection',reconciled:true});
 await client.query("UPDATE agent_operations SET status='complete',result=$1 WHERE id=$2",[JSON.stringify(result),id]);
}

}
