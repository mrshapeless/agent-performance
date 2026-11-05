// Prepare immediately after the last confirmed original; publish two hours later.
// A late worker never creates catch-up slots. Atomic store gate also uses this.
export function originalDelayMinutes(postId) {
  return 120;
}
export async function originalPublicationWindow(query, now = new Date()) {
  const last = (await query("SELECT seq,payload,created FROM agent_events WHERE kind='x_post' ORDER BY seq DESC LIMIT 1")).rows[0];
  if (!last) return {due:true,nextAt:null};
  const payload=typeof last.payload==='string'?JSON.parse(last.payload):last.payload;
  const nextAt=new Date(Date.parse(last.created)+originalDelayMinutes(payload.postId??last.seq)*60000);
  return {due:now.getTime()>=nextAt.getTime(),nextAt:nextAt.toISOString()};
}
