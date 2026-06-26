import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import {
  InMemoryIngestStore,
  type IngestStore,
} from "./ingest-store.js";
import { registerHealth } from "./routes/health.js";
import { registerIngest } from "./routes/ingest.js";
import { registerSignup } from "./routes/signup.js";

export function buildServer(
  opts: { logger?: boolean; ingestStore?: IngestStore } = {},
) {
  const app = Fastify({ logger: opts.logger ?? true });
  const ingestStore = opts.ingestStore ?? new InMemoryIngestStore();
  registerHealth(app);
  registerSignup(app);
  registerIngest(app, ingestStore);
  return app;
}

const isEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntry) {
  const port = Number(process.env.PORT ?? 8110);
  const app = buildServer();
  app.listen({ port, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
