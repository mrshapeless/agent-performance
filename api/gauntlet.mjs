import pg from 'pg';
import {Gemini} from '../gemini.mjs';
import {createGauntletHandler} from '../gauntlet.mjs';
export default {fetch:createGauntletHandler({env:process.env,createProvider:()=>new Gemini(),openPool:async()=>new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,statement_timeout:30000})})};
