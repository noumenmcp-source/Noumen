import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createDb } from "@cdp-us/db";
import {
  DbTokenStore,
  InMemoryTokenStore,
  type TokenStore,
} from "./auth.js";
import {
  DbIngestStore,
  InMemoryIngestStore,
  type IngestStore,
} from "./ingest-store.js";
import { registerHealth } from "./routes/health.js";
import { registerIngest } from "./routes/ingest.js";
import { registerModules } from "./routes/modules.js";
import { registerSignup } from "./routes/signup.js";
import {
  DbTenantStore,
  InMemoryTenantStore,
  type TenantStore,
} from "./tenant.js";

export async function buildServer(
  opts: {
    logger?: boolean;
    ingestStore?: IngestStore;
    tenantStore?: TenantStore;
    tokenStore?: TokenStore;
    rateLimit?: { max: number; timeWindow: number | string } | false;
  } = {},
) {
  const app = Fastify({ logger: opts.logger ?? true });
  const tenantStore = opts.tenantStore ?? createDefaultTenantStore();
  const ingestStore = opts.ingestStore ?? createDefaultIngestStore();
  const tokenStore = opts.tokenStore ?? createDefaultTokenStore();
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
  });
  const rateLimitConfig = opts.rateLimit ?? defaultRateLimit();
  if (rateLimitConfig !== false) {
    await app.register(rateLimit, {
      max: rateLimitConfig.max,
      timeWindow: rateLimitConfig.timeWindow,
    });
  }
  registerHealth(app);
  registerModules(app, tenantStore, tokenStore);
  registerSignup(app, tenantStore, tokenStore);
  registerIngest(app, ingestStore, tenantStore);
  return app;
}

function createDefaultIngestStore(): IngestStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbIngestStore(createDb(connectionString));
  }
  return new InMemoryIngestStore();
}

function createDefaultTenantStore(): TenantStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbTenantStore(createDb(connectionString));
  }
  return new InMemoryTenantStore();
}

function createDefaultTokenStore(): TokenStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbTokenStore(createDb(connectionString));
  }
  return new InMemoryTokenStore();
}

function defaultRateLimit(): { max: number; timeWindow: number | string } {
  const max = Number(process.env.RATE_LIMIT_MAX ?? 600);
  const timeWindow = process.env.RATE_LIMIT_WINDOW ?? "1 minute";
  return { max: Number.isFinite(max) && max > 0 ? max : 600, timeWindow };
}

const isEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntry) {
  const port = Number(process.env.PORT ?? 8110);
  void buildServer().then((app) =>
    app.listen({ port, host: "0.0.0.0" }).catch((err) => {
      app.log.error(err);
      process.exit(1);
    }),
  );
}
