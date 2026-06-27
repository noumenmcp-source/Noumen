Implementation strategy for `cdp`:
- Prefer a modular monolith plus async workers over microservices-first.
- Extract services only when a domain boundary is obvious: ingest scale, send/queue throughput, search/index, or strict tenancy/compliance.
- Default tenancy model should be hybrid: shared control plane, tenant-aware data plane, optional isolated DBs for enterprise customers.
- Identity resolution should be deterministic first, probabilistic only when necessary.
- First sellable MVP: event collector, unified profile, segments, MJML-based email campaigns, one sending provider, basic automation (welcome/abandon/re-engage), delivery tracking, tenant admin/RBAC/audit.
- Commercial wedge: owned first-party data, faster deployment, local support, and data-residency/self-hosting for clients who cannot use HubSpot-style SaaS as-is.