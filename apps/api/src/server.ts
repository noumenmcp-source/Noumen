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
import { registerData } from "./routes/data.js";
import {
  FakeSender,
  ResendSender,
  type EmailSender,
} from "@cdp-us/email";
import { InMemoryUsageMeter, type UsageMeter } from "@cdp-us/billing";
import {
  InMemorySocialAdapter,
  InMemoryMessengerAdapter,
  type SocialAdapter,
  type MessengerAdapter,
} from "@cdp-us/automation";
import { registerEmail } from "./routes/email.js";
import { registerConsent } from "./routes/consent.js";
import { registerIntel, type CollectorRegistry } from "./routes/intel.js";
import { registerAutomations } from "./routes/automations.js";
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
    profileStore?: ProfileStore;
    emailSender?: EmailSender;
    usageMeter?: UsageMeter;
    collectors?: CollectorRegistry;
    socialAdapter?: SocialAdapter;
    messengerAdapter?: MessengerAdapter;
    rateLimit?: { max: number; timeWindow: number | string } | false;
  } = {},
) {
  const app = Fastify({ logger: opts.logger ?? true });
  const tenantStore = opts.tenantStore ?? createDefaultTenantStore();
  const ingestStore = opts.ingestStore ?? createDefaultIngestStore();
  const tokenStore = opts.tokenStore ?? createDefaultTokenStore();
  const profileStore = opts.profileStore ?? createDefaultProfileStore();
  const profileService = new ProfileService(profileStore);
  const emailSender = opts.emailSender ?? createDefaultEmailSender();
  const usageMeter = opts.usageMeter ?? new InMemoryUsageMeter();
  // No social providers are wired by default: intel returns 503 per platform
  // until a collector (with the tenant's provider creds) is injected.
  const collectors = opts.collectors ?? {};
  const socialAdapter = opts.socialAdapter ?? new InMemorySocialAdapter();
  const messengerAdapter = opts.messengerAdapter ?? new InMemoryMessengerAdapter();
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    // authorization is required: the console + SDKs send Bearer tokens on
    // read/write endpoints; without it the browser blocks the CORS preflight.
    allowedHeaders: ["content-type", "authorization"],
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
  registerIngest(app, ingestStore, tenantStore, profileService);
  registerData(app, profileStore, ingestStore, tokenStore);
  registerEmail(app, profileStore, tokenStore, {
    sender: emailSender,
    usageMeter,
  });
  registerConsent(app, tenantStore);
  registerIntel(app, tenantStore, tokenStore, { collectors });
  registerAutomations(app, tenantStore, tokenStore, {
    social: socialAdapter,
    messenger: messengerAdapter,
  });
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

function createDefaultEmailSender(): EmailSender {
  return process.env.RESEND_API_KEY ? new ResendSender() : new FakeSender();
}

function createDefaultProfileStore(): ProfileStore {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new DbProfileStore(createDb(connectionString));
  }
  return new InMemoryProfileStore();
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
