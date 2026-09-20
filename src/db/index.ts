import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];