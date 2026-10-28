// One public, versioned visual contract for planning, rendering and inspection.
// This describes capture and identity, never a mandatory subject or composition.
export const VISUAL_CONTRACT='out-of-frame-v1';
export const visualDirection='The current visual reference is Out of frame: soft low-resolution camcorder capture, subdued colors, diffuse available light and expressive spontaneous performance. Preserve the synthetic Alidade face without turning her into a glossy figurine or a different realistic actress. Match the image-making, not the reference location, costume or pose. Choose freely among situations, emotions, settings and actions. No required collage, stickers, slogans, nostalgic devices, basement or greeting card. A beautiful clean commercial render with added noise fails this direction. Low fidelity is not an excuse for broken hands, nonsensical object construction or melting facial landmarks. Simplify detail that cannot survive the intended capture.';
export const qualityFields={
 visualLanguageResult:{type:'string',enum:['supported','partly','not_supported']},
 referenceComparison:{type:'string',minLength:20,maxLength:1200},
 integrityResult:{type:'string',enum:['supported','not_supported','uncertain']},
 integrityEvidence:{type:'string',minLength:20,maxLength:1200}
};
export function qualitySchema(base){return {...base,properties:{...base.properties,...qualityFields},required:[...new Set([...base.required,...Object.keys(qualityFields)])]};}
export const qualityInstruction=`${visualDirection} Compare the actual candidate against the current reference pixels. Return visualLanguageResult supported/partly/not_supported and referenceComparison naming similarities AND differences in focus, light, surface detail and capture. Separately return integrityResult supported/not_supported/uncertain and integrityEvidence: inspect hands, face, text, money, object contact and, in video, continuity and deformation across beginning/middle/end. Deliberate stylization is allowed; unintended malformed focal details are not. Unsupported or uncertain evidence must not pass. Publication requires supported visual language and integrity, plus recognizable identity when Alidade appears. Judge pixels, not the intention in a prompt.`;
export function passesQuality(v){return v?.decision==='publish'&&v.visualLanguageResult==='supported'&&v.integrityResult==='supported'&&['referenceComparison','integrityEvidence'].every(k=>typeof v[k]==='string'&&v[k].trim().length>=20);}
