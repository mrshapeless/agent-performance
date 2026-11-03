import {createHash} from 'node:crypto';
// Stable per confirmed post, never rerolled by polling. Five-minute worker cadence
// adds up to five minutes: eligibility 30-45m yields a normal 30-50m window.
export function originalDelayMinutes(postId) {
  return 30 + createHash('sha256').update(String(postId)).digest().readUInt32BE(0) % 16;
}
export async function originalPublicationWindow(query, now = new Date()) {
  const last = (await query("SELECT seq,payload,created FROM agent_events WHERE kind='x_post' ORDER BY seq DESC LIMIT 1")).rows[0];
  if (!last) return {due:true,nextAt:null};
  const payload=typeof last.payload==='string'?JSON.parse(last.payload):last.payload;
  const nextAt=new Date(Date.parse(last.created)+originalDelayMinutes(payload.postId??last.seq)*60000);
  return {due:now.getTime()>=nextAt.getTime(),nextAt:nextAt.toISOString()};
}
