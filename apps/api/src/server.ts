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
  DbProfileStore,
  InMemoryProfileStore,
  ProfileService,
  type ProfileStore,
} from "@cdp-us/core-cdp";
import { InMemoryUsageMeter, type UsageMeter } from "@cdp-us/billing";
import { FakeSender, ResendSender, type EmailSender } from "@cdp-us/email";
import { ConsentService } from "./consent-service.js";
import { registerAutomation } from "./routes/automation.js";
import { registerConsent } from "./routes/consent.js";
import { registerData } from "./routes/data.js";
import { registerEmail } from "./routes/email.js";
import { registerExport } from "./routes/export.js";
import { registerSegments } from "./routes/segments.js";
import { registerSocialIntel } from "./routes/social-intel.js";
import {
  DbIngestStore,
  InMemoryIngestStore,
  type IngestStore,
} from "./ingest-store.js";
import { registerHealth } from "./routes/health.js";
import { registerOpenapi } from "./routes/openapi.js";
import { registerIngest } from "./routes/ingest.js";
import { registerModules } from "./routes/modules.js";
import { registerSignup } from "./routes/signup.js";
import {
  DbSubscriptionStore,
  InMemorySubscriptionStore,
  type SubscriptionStore,
} from "./subscription.js";
import { DbUsageMeter } from "./usage-store.js";
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
    profileStore?: ProfileStore;
    subscriptionStore?: SubscriptionStore;
    usageMeter?: UsageMeter;
    emailSender?: EmailSender;
    rateLimit?: { max: number; timeWindow: number | string } | false;
  } = {},
) {
  const app = Fastify({ logger: opts.logger ?? true });
  const tenantStore = opts.tenantStore ?? createDefaultTenantStore();
  const ingestStore = opts.ingestStore ?? createDefaultIngestStore();
  const tokenStore = opts.tokenStore ?? createDefaultTokenStore();
  const profileStore = opts.profileStore ?? createDefaultProfileStore();
  const subscriptionStore =
    opts.subscriptionStore ?? createDefaultSubscriptionStore();
  const usageMeter = opts.usageMeter ?? createDefaultUsageMeter();
  const consentService = new ConsentService();
  const emailSender = opts.emailSender ?? createDefaultEmailSender();
  const profileService = new ProfileService(profileStore);
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
  registerOpenapi(app);
  registerModules(app, tenantStore, tokenStore, subscriptionStore);
  registerSignup(app, tenantStore, tokenStore);
  registerIngest(
    app,
    ingestStore,
    tenantStore,
    profileService,
    subscriptionStore,
    usageMeter,
  );
  registerData(app, profileStore, ingestStore, tokenStore);
  registerExport(app, profileStore, ingestStore, tokenStore);
  registerSegments(app, profileStore, tokenStore);
  registerConsent(app, tenantStore, tokenStore, consentService);
  registerEmail(
    app,
    profileStore,
    tokenStore,
    subscriptionStore,
    usageMeter,
    consentService,
    emailSender,
  );
  registerAutomation(app, tokenStore, subscriptionStore, consentService);
  registerSocialIntel(app, tokenStore, subscriptionStore);
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

function createDefaultSubscriptionStore(): SubscriptionStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbSubscriptionStore(createDb(connectionString));
  }
  return new InMemorySubscriptionStore();
}

function createDefaultUsageMeter(): UsageMeter {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbUsageMeter(createDb(connectionString));
  }
  return new InMemoryUsageMeter();
}

function createDefaultProfileStore(): ProfileStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbProfileStore(createDb(connectionString));
  }
  return new InMemoryProfileStore();
}

/**
 * Production email sender when `RESEND_API_KEY` is set, else the in-memory
 * FakeSender so dev/test never make a real ESP call.
 */
function createDefaultEmailSender(): EmailSender {
  return process.env.RESEND_API_KEY ? new ResendSender() : new FakeSender();
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
