import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { env } from "./env.ts";
import { scheduleMaintenance } from "./maintenance.ts";
import { migrate } from "./migrate.ts";

await migrate();
scheduleMaintenance();

serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`Standing API listening on http://localhost:${info.port}`);
});
