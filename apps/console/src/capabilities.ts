import type { IconName } from "./widgets";

/** Live demo wired into the capability detail page (data fetched from the API). */
export type CapabilityDemo = "funnel" | "retention" | "audiences" | "attribution";

export interface Endpoint {
  readonly method: "GET" | "POST";
  readonly path: string;
}

export interface Capability {
  readonly key: string;
  readonly name: string;
  readonly icon: IconName;
  readonly summary: string;
  readonly desc: string;
  readonly features: readonly string[];
  readonly role: string;
  readonly endpoints: readonly Endpoint[];
  readonly demo?: CapabilityDemo;
}

const T = "/v1/tenants/:tenantId";

/** The full module surface of the CDP runtime. Endpoints mirror the live API
 * routes; `demo` marks modules whose detail page renders real fetched data. */
export const CAPABILITIES: readonly Capability[] = [
  {
    key: "analytics", name: "Analytics", icon: "chart", demo: "funnel",
    summary: "Funnels, conversion, retention and time series over tenant events.",
    desc: "funnel · retention",
    features: ["Multi-step conversion funnels", "Cohort retention curves", "Daily event/user time series", "Step-to-step conversion rates"],
    role: "analyst", endpoints: [
      { method: "POST", path: `${T}/analytics/funnel` },
      { method: "POST", path: `${T}/analytics/conversion` },
      { method: "POST", path: `${T}/analytics/retention` },
      { method: "POST", path: `${T}/analytics/timeseries` },
    ],
  },
  {
    key: "audiences", name: "Audiences", icon: "users", demo: "audiences",
    summary: "Build and size segments from profile traits, with overlap analysis.",
    desc: "live segments",
    features: ["Predicate-based segment rules", "Exact audience sizing", "A∩B overlap between segments", "Sampled member IDs"],
    role: "analyst", endpoints: [{ method: "POST", path: `${T}/audiences/evaluate` }],
  },
  {
    key: "cohorts", name: "Cohorts", icon: "layers", demo: "retention",
    summary: "Day-by-day retention grids for a signup cohort.",
    desc: "retention grids",
    features: ["Cohort-day anchoring", "Configurable retention window", "Per-day retained rate"],
    role: "analyst", endpoints: [{ method: "POST", path: `${T}/analytics/cohorts` }],
  },
  {
    key: "journeys", name: "Journeys", icon: "route",
    summary: "Run multi-step orchestration flows against a tenant's profiles.",
    desc: "multi-step flows",
    features: ["Sequenced step execution", "Halt / reject outcomes", "Per-step result trace"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/journeys/run` }],
  },
  {
    key: "automations", name: "Automations", icon: "bolt",
    summary: "Event-triggered automation rules executed server-side.",
    desc: "event triggers",
    features: ["Trigger on event type", "Action pipelines", "Idempotent runs"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/automations/run` }],
  },
  {
    key: "lead-scoring", name: "Lead scoring", icon: "target",
    summary: "Score profiles 0–100 from engagement and firmographic signals.",
    desc: "0–100 intent",
    features: ["Behavioural + firmographic inputs", "0–100 normalised score", "Per-profile scoring"],
    role: "analyst", endpoints: [{ method: "POST", path: `${T}/leads/score` }],
  },
  {
    key: "enrichment", name: "Enrichment", icon: "sparkle",
    summary: "Augment profiles with firmographic and company attributes.",
    desc: "firmographics",
    features: ["Domain → company resolution", "Industry / size / revenue", "Trait merge into profile"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/enrich` }],
  },
  {
    key: "deliverability", name: "Deliverability", icon: "mail",
    summary: "Inbox-health checks and the email suppression list.",
    desc: "inbox health",
    features: ["Address validity check", "Suppression list (bounces/complaints)", "CAN-SPAM aligned"],
    role: "admin", endpoints: [
      { method: "POST", path: `${T}/deliverability/check` },
      { method: "GET", path: `${T}/deliverability/suppression` },
    ],
  },
  {
    key: "destinations", name: "Destinations", icon: "plug",
    summary: "Sync audiences and events to warehouses and downstream tools.",
    desc: "warehouse + tools",
    features: ["Audience → destination sync", "Batch + delta modes", "Per-destination status"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/destinations/sync` }],
  },
  {
    key: "attribution", name: "Attribution", icon: "share", demo: "attribution",
    summary: "Credit conversions across acquisition channels.",
    desc: "multi-touch",
    features: ["First-touch channel credit", "Channel revenue share", "Campaign rollups"],
    role: "analyst", endpoints: [{ method: "POST", path: `${T}/attribution` }],
  },
  {
    key: "data-quality", name: "Data quality", icon: "shield",
    summary: "Validate profile completeness and flag anomalies.",
    desc: "validation rules",
    features: ["Required-field completeness", "Type / format checks", "Quality score"],
    role: "analyst", endpoints: [{ method: "POST", path: `${T}/quality/check` }],
  },
  {
    key: "forms", name: "Forms", icon: "form",
    summary: "Capture lead submissions straight into the CDP.",
    desc: "lead capture",
    features: ["Server-side form ingest", "Maps to identify+track", "Consent capture"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/forms/submit` }],
  },
  {
    key: "social-intel", name: "Social intel", icon: "globe",
    summary: "External social and web signals layered onto profiles.",
    desc: "external signals",
    features: ["Collector registry", "Signal ingestion", "Module-gated"],
    role: "admin · module enabled", endpoints: [{ method: "GET", path: `${T}/intel` }],
  },
  {
    key: "warehouse-sync", name: "Warehouse sync", icon: "database",
    summary: "Scheduled export of CDP data to a data warehouse.",
    desc: "scheduled export",
    features: ["Full + incremental sync", "Schema mapping", "Run status"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/warehouse/sync` }],
  },
  {
    key: "webhooks", name: "Webhooks", icon: "webhook",
    summary: "Inbound webhooks from external providers into the event stream.",
    desc: "inbound events",
    features: ["Per-provider endpoints", "Signature verification", "Maps to track events"],
    role: "system", endpoints: [{ method: "POST", path: `${T}/webhooks/:provider` }],
  },
  {
    key: "data-export", name: "Data export", icon: "download",
    summary: "DSAR access/erase and bulk profile export.",
    desc: "DSAR + bulk",
    features: ["CCPA/CPRA right-to-access", "Right-to-delete execution", "Bulk export"],
    role: "admin", endpoints: [{ method: "POST", path: `${T}/dsar` }],
  },
  {
    key: "audit-log", name: "Audit log", icon: "history",
    summary: "Immutable trail of privileged and compliance actions.",
    desc: "immutable trail",
    features: ["Append-only entries", "DSAR + module changes logged", "Tamper-evident"],
    role: "admin", endpoints: [{ method: "GET", path: `${T}/audit` }],
  },
];

export function getCapability(key: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.key === key);
}
