import {readFileSync} from 'node:fs';

// Native-X scheduling is a separate publisher. Import verified receipts, never
// submit these campaign entries through the autonomous artwork adapter.
export function loadArtistCampaign(path=new URL('../private/artist-campaign.json',import.meta.url)){
 try{
  const value=JSON.parse(readFileSync(path,'utf8'));
  if(!Array.isArray(value.schedule)||!Array.isArray(value.publicationLedger))return null;
  if(value.schedule.some(s=>!Number.isFinite(Date.parse(s.at))))return null;
  if(value.publicationLedger.some(p=>!Number.isFinite(Date.parse(p.publishedAtUtc))||!/^https:\/\/x\.com\/alidadenull\/status\/\d+$/.test(p.url)))return null;
  return value;
 }catch{return null;}
}
export function campaignWindow(campaign,now=new Date()){
 if(!campaign)return {due:false,status:'artist_campaign_state_required'};
 const receipts=campaign.publicationLedger;
 const latest=Math.max(0,...receipts.map(p=>Date.parse(p.publishedAtUtc)));
 if(now.getTime()<latest+7200000)return {due:false,status:'artist_publication_interval',nextAt:new Date(latest+7200000).toISOString()};
 const pending=campaign.schedule.filter(s=>s.status==='scheduled_in_x_verified'&&!receipts.some(p=>p.id===s.id)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const near=pending.find(s=>now.getTime()>=Date.parse(s.at)-7200000);
 if(near)return {due:false,status:now.getTime()<Date.parse(near.at)?'artist_campaign_spacing':'artist_campaign_verification_required',nextAt:near.at};
 return {due:true};
}
