import { scopedPool, instanceEnv } from '../src/instance.mjs';
import pg from 'pg';
import { PostgresStore } from '../src/postgres.mjs';
import { Gemini } from '../src/gemini.mjs';
import { createHandler } from '../src/cloud.mjs';
import {LocalInference} from '../src/local-inference.mjs';
import {LocalInferenceStore} from '../src/local-inference-store.mjs';

export default {
  fetch: createHandler({
    env: instanceEnv(process.env),
    openStore: async () => {
      if (!process.env.DATABASE_URL) throw Error('DATABASE_NOT_CONFIGURED');
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
        max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
      const Store=process.env.ALIDADE_COMPUTE==='local'?LocalInferenceStore:PostgresStore;
      const store = new Store(scopedPool(pool));
      store.close = () => pool.end();
      return store;
    },
    createProvider: store => process.env.ALIDADE_COMPUTE==='local'?new LocalInference(store):new Gemini(),
  }),
};
