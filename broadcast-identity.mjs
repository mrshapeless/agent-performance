// Called within the migration transaction. Artwork is supplied privately at deploy time.
export async function installBroadcastIdentity(client, store, images) {
  if (!images) return false;
  const existing=await client.query("SELECT seq FROM agent_events WHERE kind='record_note' AND payload::jsonb->>'reference'='broadcast-identity-v1'");
  if(existing.rows.length)return false;
  for(const name of ['avatar','banner']){
    const bytes=images[name];
    if(!Buffer.isBuffer(bytes)||bytes.length>3500000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('INVALID_BROADCAST_ASSET');
  }
  for(const name of ['avatar','banner'])await client.query('INSERT INTO agent_assets(id,mime,bytes) VALUES($1,$2,$3)',['broadcast-'+name+'-v1','image/png',images[name]]);
  const description='An elongated dark face, expressive brows and direct gaze, a blunt white bob and orange high-neck top against cobalt blue. Low-resolution synthetic television portrait with soft scanlines.';
  await store.append(client,'appearance_image',{assetId:'broadcast-avatar-v1',text:description,summary:'The project creator selected this AI-generated portrait from visual studies. This is an editorial appearance choice, not an autonomous agent decision.'});
  await store.append(client,'banner_image',{assetId:'broadcast-banner-v1',text:'Cobalt broadcast field, orange signal streak and the approved white-haired persona on the right.',summary:'Companion banner commissioned by the project creator to match the selected portrait. The site uses this palette; individual artworks remain free to take other directions.'});
  const latest=await client.query("SELECT payload FROM agent_events WHERE kind='studio_revision' ORDER BY seq DESC LIMIT 1");
  if(latest.rows.length){
    const studio=JSON.parse(latest.rows[0].payload);
    if(studio.persona){
      studio.persona.embodiment={description,recognitionAnchors:'White blunt bob, elongated dark face, expressive direct gaze, orange high neck, cobalt field; imperfect synthetic TV rendering.',portraitPrompt:'Frontal avatar portrait of the established persona: '+description+' Keep an expressive recognizable face. Avoid glossy advertising lighting and robot mascots.'};
      studio.summary='Editorial update: the project creator selected the current portrait and broadcast palette. Existing voice, interests, personality and projects are preserved; this is not evidence of audience preference or autonomous learning.';
      await store.append(client,'studio_revision',studio);
    }
  }
  await store.append(client,'record_note',{reference:'broadcast-identity-v1',text:'The current portrait and site palette were selected by the project creator.',summary:'Original identity and development records remain intact. This appearance choice does not prescribe the subjects, media or palette of future art. No social profile was changed by this migration.'});
  return true;
}
