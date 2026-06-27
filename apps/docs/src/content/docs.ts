export type Endpoint = Readonly<{
  method: string;
  path: string;
  auth: string;
  status: "live" | "planned";
  request: string;
  response: string;
}>;

export const endpoints: readonly Endpoint[] = [
  {
    method: "POST",
    path: "/v1/signup",
    auth: "None",
    status: "live",
    request: '{"companyName":"Acme Inc","ownerEmail":"owner@example.com"}',
    response: '{"ok":true,"tenant":{"id":"tenant_...","writeKey":"wk_..."},"apiToken":"tok_..."}',
  },
  {
    method: "GET",
    path: "/v1/modules",
    auth: "None",
    status: "live",
    request: "No body",
    response: '{"modules":[{"key":"email","title":"Email","requiresConsent":["marketing_email"]}]}',
  },
  {
    method: "POST",
    path: "/v1/tenants/:id/modules/:key",
    auth: "Bearer apiToken",
    status: "live",
    request: "No body",
    response: '{"ok":true}',
  },
  {
    method: "POST",
    path: "/v1/track",
    auth: "writeKey in body",
    status: "live",
    request: '{"writeKey":"wk_...","events":[{"type":"track","anonymousId":"anon_1","event":"Page Viewed"}]}',
    response: '{"accepted":true}',
  },
  {
    method: "GET",
    path: "/v1/tenants/:id/profiles",
    auth: "Bearer apiToken",
    status: "planned",
    request: "No body",
    response: '{"profiles":[]}',
  },
  {
    method: "GET",
    path: "/v1/tenants/:id/events?anonymousId=anon_1",
    auth: "Bearer apiToken",
    status: "planned",
    request: "No body",
    response: '{"events":[]}',
  },
  {
    method: "GET",
    path: "/v1/health",
    auth: "None",
    status: "live",
    request: "No body",
    response: '{"status":"ok","region":"us","counters":{}}',
  },
];

export const modules = [
  ["email", "Sends compliant campaigns from CDP profiles and consent state."],
  ["social-intel", "Uses audience and YouTube signals to enrich intent."],
  ["automation", "Turns CDP segments into social and messaging workflows."],
  ["consent", "Collects US privacy choices for analytics, email, sale/share, and TCPA messaging."],
  ["billing", "Separates product boundaries and plan entitlements."],
] as const;
