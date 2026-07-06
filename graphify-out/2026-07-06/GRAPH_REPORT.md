# Graph Report - .  (2026-07-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1562 nodes · 2928 edges · 112 communities (91 shown, 21 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8edb386c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_sync.ts|sync.ts]]
- [[_COMMUNITY_api.ts|api.ts]]
- [[_COMMUNITY_generators.ts|generators.ts]]
- [[_COMMUNITY_actions.ts|actions.ts]]
- [[_COMMUNITY_manager.ts|manager.ts]]
- [[_COMMUNITY_tenant.ts|tenant.ts]]
- [[_COMMUNITY_CdpClient|CdpClient]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_auth.ts|auth.ts]]
- [[_COMMUNITY_content.d.ts|content.d.ts]]
- [[_COMMUNITY_content.d.ts|content.d.ts]]
- [[_COMMUNITY_client.ts|client.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_profile-service.ts|profile-service.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_CDP-US Architecture|CDP-US Architecture]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_ConsentService|ConsentService]]
- [[_COMMUNITY_Db|Db]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_server.ts|server.ts]]
- [[_COMMUNITY_registerEmail|registerEmail]]
- [[_COMMUNITY_db.integration.test.ts|db.integration.test.ts]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_browser.ts|browser.ts]]
- [[_COMMUNITY_InMemoryTenantStore|InMemoryTenantStore]]
- [[_COMMUNITY_@cdp-usui|@cdp-us/ui]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_InMemoryProfileStore|InMemoryProfileStore]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_schema.ts|schema.ts]]
- [[_COMMUNITY_modulesmarketplacesREADME|modules/marketplaces/README.md]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_@cdp-usanalytics|@cdp-us/analytics]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_TenantStore|TenantStore]]
- [[_COMMUNITY_DbUsageMeter|DbUsageMeter]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_InMemoryIngestStore|InMemoryIngestStore]]
- [[_COMMUNITY_listTemplates|listTemplates]]
- [[_COMMUNITY_cdp|cdp]]
- [[_COMMUNITY_appsapi|apps/api]]
- [[_COMMUNITY_InMemorySubscriptionStore|InMemorySubscriptionStore]]
- [[_COMMUNITY_docs.ts|docs.ts]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_@cdp-ussdk|@cdp-us/sdk]]
- [[_COMMUNITY_modulesemail|modules/email]]
- [[_COMMUNITY_modulesautomationREADME|modules/automation/README.md]]
- [[_COMMUNITY_layout.tsx|layout.tsx]]
- [[_COMMUNITY_index.astro|index.astro]]
- [[_COMMUNITY_modulessocial-intel|modules/social-intel]]
- [[_COMMUNITY_no-core-import.test.ts|no-core-import.test.ts]]
- [[_COMMUNITY_track|track]]
- [[_COMMUNITY_sign|sign]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]
- [[_COMMUNITY_next.config.mjs|next.config.mjs]]
- [[_COMMUNITY_tailwind.config.ts|tailwind.config.ts]]
- [[_COMMUNITY_index.astro|index.astro]]
- [[_COMMUNITY_13-sdk-go|13-sdk-go]]
- [[_COMMUNITY_15-webhooks|15-webhooks]]
- [[_COMMUNITY_createTracker|createTracker]]
- [[_COMMUNITY_@cdp-ussdk-python|@cdp-us/sdk-python]]
- [[_COMMUNITY_platform|platform]]
- [[_COMMUNITY_anonymousId|anonymousId]]
- [[_COMMUNITY_flush|flush]]
- [[_COMMUNITY_identify|identify]]
- [[_COMMUNITY_cdp-us|cdp-us]]
- [[_COMMUNITY_Profile Tracking Service|Profile Tracking Service]]

## God Nodes (most connected - your core abstractions)
1. `buildServer()` - 32 edges
2. `CDP-US Architecture` - 23 edges
3. `Db` - 22 edges
4. `CdpClient` - 19 edges
5. `authenticate()` - 18 edges
6. `readSession()` - 17 edges
7. `YandexMarketPartnerClient` - 17 edges
8. `FetchLike` - 16 edges
9. `TokenStore` - 15 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `sendCampaign()` --indirect_call--> `profile()`  [INFERRED]
  modules/email/src/campaign.ts → packages/core-cdp/src/segments.test.ts
- `toStoredIngestEvent()` --calls--> `now()`  [INFERRED]
  apps/api/src/ingest-store.ts → packages/core-cdp/src/profile-service.test.ts
- `registerAutomation()` --calls--> `canMessage()`  [INFERRED]
  apps/api/src/routes/automation.ts → modules/consent/src/cmp.ts
- `registerConsent()` --calls--> `allowedPurposes()`  [INFERRED]
  apps/api/src/routes/consent.ts → modules/consent/src/cmp.ts
- `registerEmail()` --calls--> `canEmail()`  [INFERRED]
  apps/api/src/routes/email.ts → modules/consent/src/cmp.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CDP-US Core Data Flow** — docs_architecture_api_track, core_cdp_readme_core_cdp, docs_architecture_tenant, docs_architecture_profile [EXTRACTED 1.00]
- **US Compliance Framework** — docs_compliance_us_ccpa_cpra, docs_compliance_us_can_spam, docs_compliance_us_tcpa, docs_compliance_us_gdpr [EXTRACTED 1.00]
- **SDK Suite for CDP Platform** — packages_sdk, packages_sdk-react, packages_sdk-go [EXTRACTED 1.00]
- **Ingestion Pipeline Components** — packages_sdk, packages_sdk-go, packages_openapi, apps_api [INFERRED 0.90]
- **Email System Ecosystem** — modules_email, packages_email-templates, packages_email-templates_welcome, packages_email-templates_abandoned_cart, packages_email-templates_reactivation [EXTRACTED 1.00]
- **Analytics Computation Suite** — packages_analytics, packages_analytics_funnel, packages_analytics_retention, packages_analytics_conversionrate, packages_analytics_timeseries [EXTRACTED 1.00]
- **UI Component Library** — packages_ui, packages_ui_button, packages_ui_input, packages_ui_select, packages_ui_table, packages_ui_card, packages_ui_badge, packages_ui_alert, packages_ui_toast, packages_ui_emptystate, packages_ui_spinner, packages_ui_appshell [EXTRACTED 1.00]
- **US Compliance Modules** — modules_consent, modules_automation, modules_email, modules_social-intel [INFERRED 0.90]

## Communities (112 total, 21 thin omitted)

### Community 0 - "sync.ts"
Cohesion: 0.06
Nodes (59): cleanUndefined(), parseJsonResponse(), requireFetch(), generateMarketplaceInsights(), GenerateMarketplaceInsightsOptions, salesVelocityBySku(), severityRank(), stockoutRisk() (+51 more)

### Community 1 - "api.ts"
Cohesion: 0.07
Nodes (56): fakeTransport(), AutomationResult, TRIGGERS, ConnectPage(), CONSENT_LABELS, ConsentRecord, ConsentResponse, ConsentState (+48 more)

### Community 2 - "generators.ts"
Cohesion: 0.07
Nodes (44): ctx, CampaignRecipientResult, CampaignResult, sendCampaign(), SendCampaignOptions, base, canSpam, enforceCanSpam() (+36 more)

### Community 3 - "actions.ts"
Cohesion: 0.09
Nodes (57): authedGet(), enableModule(), health(), identify(), listModules(), login(), logout(), requireConfig() (+49 more)

### Community 4 - "manager.ts"
Cohesion: 0.08
Nodes (47): readGpc(), createConsentManager(), acceptAllConsent(), defaultConsent(), getPurposes(), isAllowed(), isConsentState(), isRecord() (+39 more)

### Community 5 - "tenant.ts"
Cohesion: 0.08
Nodes (24): App, App, App, DEFAULT_ALLOW, isAllowed(), key(), overrides, resetConsentOverrides() (+16 more)

### Community 6 - "CdpClient"
Cohesion: 0.09
Nodes (25): Event, JsonObject, CdpClient, CdpError, clamp(), IdentifyEvent, NonRetryableError, Send one CDP batch and return a status response. (+17 more)

### Community 7 - "index.ts"
Cohesion: 0.14
Nodes (25): analyzeIntent(), AnalyzeIntentOptions, countHits(), DEFAULT_INTENT_TOPICS, signals(), createCollector(), ProviderCollectorOptions, ProviderSocialCollector (+17 more)

### Community 8 - "index.ts"
Cohesion: 0.17
Nodes (22): analyzeComments(), cap(), extractContentIdeas(), NEGATIVE, POSITIVE, round4(), STOPWORDS, tokenize() (+14 more)

### Community 9 - "auth.ts"
Cohesion: 0.12
Nodes (15): authenticate(), AuthPrincipal, DbTokenStore, generateRawToken(), hashToken(), InMemoryTokenStore, IssuedToken, IssueTokenInput (+7 more)

### Community 10 - "content.d.ts"
Cohesion: 0.06
Nodes (30): AllValuesOf, AnyEntryMap, astro:content, CollectionEntry, CollectionKey, ContentCollectionKey, ContentConfig, ContentEntryMap (+22 more)

### Community 11 - "content.d.ts"
Cohesion: 0.06
Nodes (30): AllValuesOf, AnyEntryMap, astro:content, CollectionEntry, CollectionKey, ContentCollectionKey, ContentConfig, ContentEntryMap (+22 more)

### Community 12 - "client.ts"
Cohesion: 0.15
Nodes (16): CdpServer, clamp(), cleanEvent(), NonRetryableError, request(), sleep(), trackUrl(), CdpBatch (+8 more)

### Community 13 - "index.ts"
Cohesion: 0.15
Nodes (18): CapturedMessage, CapturedPost, DeliveryResult, InMemoryMessengerAdapter, InMemorySocialAdapter, MessengerAdapter, SocialAdapter, automationManifest (+10 more)

### Community 14 - "index.ts"
Cohesion: 0.14
Nodes (19): allowedPurposes(), BannerChoice, canEmail(), canMessage(), canSellOrShare(), resolveConsent(), ResolveConsentInput, AppendInput (+11 more)

### Community 15 - "profile-service.ts"
Cohesion: 0.15
Nodes (13): makeProfileId(), newProfile(), resolveExisting(), earliest(), eventTraits(), FIRMOGRAPHIC_KEYS, liftFirmographics(), mergeTraits() (+5 more)

### Community 16 - "index.ts"
Cohesion: 0.07
Nodes (27): CONSENT_PURPOSES, ConsentPurpose, ConsentRecord, ConsentState, Firmographics, IdentifyEvent, identifyEventSchema, IngestBatch (+19 more)

### Community 17 - "dependencies"
Cohesion: 0.07
Nodes (26): dependencies, @cdp-us/automation, @cdp-us/billing, @cdp-us/consent, @cdp-us/contracts, @cdp-us/core-cdp, @cdp-us/db, @cdp-us/email (+18 more)

### Community 18 - "CDP-US Architecture"
Cohesion: 0.11
Nodes (24): Core CDP Data Module, ADR-1: Social Intel No Third-Party Profiles, ADR-2: Revenue Reconciliation Out of Scope, ADR-3: Billing Enforced, ADR-4: Database Portability, GET /v1/tenants/:id/export API Endpoint, GET /v1/modules API Endpoint, GET /v1/tenants/:id/profiles API Endpoint (+16 more)

### Community 19 - "index.ts"
Cohesion: 0.22
Nodes (13): enforce(), EnforcementResult, withinLimit(), Metric, METRICS, Plan, PLAN_KEYS, PlanKey (+5 more)

### Community 20 - "ConsentService"
Cohesion: 0.15
Nodes (7): ConsentService, ConsentSink, keyOf(), RecordConsentInput, canonicalState(), DbConsentSink, registerConsent()

### Community 21 - "Db"
Cohesion: 0.16
Nodes (6): DbTenantStore, getTenant(), toTenant(), DbProfileStore, toProfile(), Db

### Community 22 - "dependencies"
Cohesion: 0.10
Nodes (20): dependencies, autoprefixer, next, postcss, react, react-dom, tailwindcss, @types/node (+12 more)

### Community 23 - "server.ts"
Cohesion: 0.21
Nodes (17): registerHealth(), registerOpenapi(), spec, SPEC_URL, registerSocialIntel(), buildServer(), createDefaultConsentService(), createDefaultEmailSender() (+9 more)

### Community 24 - "registerEmail"
Cohesion: 0.22
Nodes (13): roleSatisfies(), getModuleManifest(), isModuleKey(), listModuleManifests(), manifests, isStepArray(), registerAutomation(), STEP_KINDS (+5 more)

### Community 25 - "db.integration.test.ts"
Cohesion: 0.16
Nodes (10): run, DbIngestStore, StoredIngestEvent, toStoredIngestEvent(), counters, registerIngest(), DbSubscriptionStore, isBillable() (+2 more)

### Community 26 - "package.json"
Cohesion: 0.11
Nodes (18): default, dependencies, drizzle-orm, pg, devDependencies, drizzle-kit, @types/pg, exports (+10 more)

### Community 27 - "compilerOptions"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+9 more)

### Community 28 - "package.json"
Cohesion: 0.12
Nodes (17): default, dependencies, @cdp-us/contracts, @cdp-us/db, drizzle-orm, devDependencies, vitest, exports (+9 more)

### Community 29 - "package.json"
Cohesion: 0.12
Nodes (16): default, dependencies, @cdp-us/contracts, resend, devDependencies, vitest, exports, main (+8 more)

### Community 30 - "package.json"
Cohesion: 0.12
Nodes (15): bin, cdp, dependencies, commander, devDependencies, vitest, main, name (+7 more)

### Community 31 - "package.json"
Cohesion: 0.13
Nodes (15): default, dependencies, @cdp-us/contracts, devDependencies, vitest, exports, main, name (+7 more)

### Community 32 - "package.json"
Cohesion: 0.13
Nodes (15): default, dependencies, @cdp-us/contracts, devDependencies, vitest, exports, main, name (+7 more)

### Community 33 - "package.json"
Cohesion: 0.13
Nodes (15): default, dependencies, @cdp-us/contracts, devDependencies, vitest, exports, main, name (+7 more)

### Community 34 - "package.json"
Cohesion: 0.13
Nodes (15): default, dependencies, @cdp-us/contracts, devDependencies, vitest, exports, main, name (+7 more)

### Community 35 - "package.json"
Cohesion: 0.13
Nodes (15): default, dependencies, @cdp-us/contracts, devDependencies, vitest, exports, main, name (+7 more)

### Community 36 - "package.json"
Cohesion: 0.13
Nodes (14): devDependencies, tsx, @types/node, typescript, engines, node, name, packageManager (+6 more)

### Community 37 - "package.json"
Cohesion: 0.14
Nodes (14): default, devDependencies, jsdom, vitest, exports, main, name, private (+6 more)

### Community 38 - "package.json"
Cohesion: 0.15
Nodes (13): default, devDependencies, vitest, exports, main, name, private, scripts (+5 more)

### Community 39 - "package.json"
Cohesion: 0.15
Nodes (13): default, devDependencies, vitest, exports, main, name, private, scripts (+5 more)

### Community 40 - "browser.ts"
Cohesion: 0.24
Nodes (5): createTracker(), getAnonymousId(), buildBatch(), EventQueue, TrackerOptions

### Community 41 - "InMemoryTenantStore"
Cohesion: 0.19
Nodes (3): buildTenantAccount(), CreateTenantAccountInput, InMemoryTenantStore

### Community 42 - "@cdp-us/ui"
Cohesion: 0.15
Nodes (13): 17-ui, @cdp-us/ui, Alert, AppShell, Badge, Button, Card, EmptyState (+5 more)

### Community 43 - "package.json"
Cohesion: 0.17
Nodes (12): default, dependencies, zod, exports, main, name, private, scripts (+4 more)

### Community 44 - "index.ts"
Cohesion: 0.29
Nodes (10): evaluateSegment(), isRecord(), matches(), readPath(), segmentMembers(), SegmentRule, acme, anon (+2 more)

### Community 45 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, composite, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+4 more)

### Community 46 - "package.json"
Cohesion: 0.17
Nodes (11): dependencies, astro, @astrojs/tailwind, tailwindcss, devDependencies, name, private, scripts (+3 more)

### Community 47 - "InMemoryProfileStore"
Cohesion: 0.24
Nodes (3): InMemoryProfileStore, key(), stubStorage()

### Community 48 - "package.json"
Cohesion: 0.20
Nodes (9): dependencies, astro, devDependencies, name, private, scripts, build, type (+1 more)

### Community 49 - "schema.ts"
Cohesion: 0.20
Nodes (8): apiTokens, consentRecords, events, profiles, subscriptions, tenants, usageCounters, users

### Community 50 - "modules/marketplaces/README.md"
Cohesion: 0.25
Nodes (8): modules/marketplaces, Ozon Seller API, modules/marketplaces/README.md, syncOzonSnapshot, syncWildberriesSnapshot, syncYandexMarketSnapshot, Wildberries API, Yandex Market Partner API

### Community 51 - "tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, lib, outDir, rootDir, extends, include, references

### Community 52 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 53 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, outDir, rootDir, extends, include

### Community 54 - "@cdp-us/analytics"
Cohesion: 0.33
Nodes (7): 16-analytics, @cdp-us/analytics, conversionRate, funnel, retention, timeSeries, @cdp-us/contracts

### Community 55 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 56 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 57 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 58 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 59 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 60 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, outDir, rootDir, extends, include

### Community 61 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, include, references

### Community 62 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, outDir, rootDir, extends, include

### Community 65 - "tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 66 - "tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 67 - "tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 69 - "listTemplates"
Cohesion: 0.60
Nodes (5): abandoned_cart, listTemplates, reactivation, render, welcome

### Community 70 - "cdp"
Cohesion: 0.40
Nodes (5): cdp, Close, Flush, Identify, Track

### Community 71 - "apps/api"
Cohesion: 0.67
Nodes (4): apps/api, 12-openapi, @cdp-us/openapi, OpenAPI 3.1 Specification

### Community 73 - "docs.ts"
Cohesion: 0.50
Nodes (3): Endpoint, endpoints, modules

### Community 74 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): compilerOptions, types, extends

### Community 75 - "tsconfig.json"
Cohesion: 0.50
Nodes (3): compilerOptions, types, extends

### Community 76 - "@cdp-us/sdk"
Cohesion: 0.67
Nodes (4): 11-sdk-react, @cdp-us/sdk, @cdp-us/sdk-react, useCdp

### Community 77 - "modules/email"
Cohesion: 0.67
Nodes (4): 14-email-templates, modules/email, modules/email/README.md, @cdp-us/email-templates

### Community 78 - "modules/automation/README.md"
Cohesion: 0.50
Nodes (4): modules/automation, modules/automation/README.md, modules/consent, modules/consent/README.md

### Community 81 - "modules/social-intel"
Cohesion: 0.67
Nodes (3): modules/social-intel, analyzeIntent, modules/social-intel/README.md

### Community 83 - "track"
Cohesion: 0.67
Nodes (3): usePageViews, useTrack, track

### Community 84 - "sign"
Cohesion: 1.00
Nodes (3): sign, verifySignature, WebhookSender

## Knowledge Gaps
- **494 isolated node(s):** `name`, `version`, `private`, `type`, `main` (+489 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `registerSocialIntel()` connect `server.ts` to `registerEmail`, `auth.ts`, `index.ts`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `analyzeIntent()` connect `index.ts` to `server.ts`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `profile()` connect `index.ts` to `generators.ts`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `CdpClient` (e.g. with `test_close_flushes_buffered_events()` and `test_does_not_retry_4xx()`) actually correct?**
  _`CdpClient` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _497 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sync.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.057821782178217825 - nodes in this community are weakly interconnected._
- **Should `api.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07429718875502007 - nodes in this community are weakly interconnected._