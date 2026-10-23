import {readFile} from 'node:fs/promises';
// Server-only operator material. Deliberately absent from the public repository.
let config={};
try { config=JSON.parse(await readFile(new URL('./private/references.json',import.meta.url),'utf8')); }
catch(error) { if(error.code!=='ENOENT')throw Error('INVALID_PRIVATE_REFERENCE_CONFIG'); }
export const privateReferences=config;
