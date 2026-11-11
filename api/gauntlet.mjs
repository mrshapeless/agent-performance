import pg from 'pg';
import {Gemini} from '../src/gemini.mjs';
import {createGauntletHandler} from '../src/gauntlet.mjs';
export default {fetch:createGauntletHandler({env:process.env,createProvider:()=>{if(process.env.ALIDADE_COMPUTE==='local')throw Error('LOCAL_GAUNTLET_NOT_CONFIGURED');return new Gemini()},openPool:async()=>new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,statement_timeout:30000})})};
