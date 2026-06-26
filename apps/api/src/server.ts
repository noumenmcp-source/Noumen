import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { registerHealth } from "./routes/health.js";
import { registerIngest } from "./routes/ingest.js";

export function buildServer() {
  const app = Fastify({ logger: true });
  registerHealth(app);
  registerIngest(app);
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
