import postgres from "postgres";
import { env } from "./env.ts";

export const sql = postgres(env.databaseUrl, {
  onnotice: () => {},
  transform: { undefined: null },
});

export type Sql = typeof sql;
