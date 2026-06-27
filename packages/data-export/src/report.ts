import type { ConsentState, IngestEvent, Profile } from "@cdp-us/contracts";
import {
  consentFieldCategory,
  eventFieldCategory,
  profileReportItem,
  PROFILE_FIELD_CCPA_CATEGORIES,
  profileFieldKeys,
} from "./categories.js";
import { sortReportItems } from "./sort.js";
import {
  ACCESS_REPORT_SCHEMA_VERSION,
  type AccessReport,
  type CcpaCategory,
  type DsarReaders,
  type DsarRequest,
  type ReportItem,
} from "./types.js";

/** @example const report = await assembleAccessReport(readers, request); */
export async function assembleAccessReport(readers: DsarReaders, request: DsarRequest): Promise<AccessReport> {
  const [profile, events, consent] = await Promise.all([
    readers.profiles.getBySubject(request.tenantId, request.subject),
    readers.events.listBySubject(request.tenantId, request.subject),
    readers.consent.getState(request.tenantId, request.subject),
  ]);

  return {
    schemaVersion: ACCESS_REPORT_SCHEMA_VERSION,
    tenantId: request.tenantId,
    subject: request.subject,
    requestedAt: request.requestedAt,
    categories: categorize([...profileItems(profile), ...eventItems(events), ...consentItems(consent)]),
  };
}

function categorize(items: readonly CategorizedItem[]): Record<CcpaCategory, readonly ReportItem[]> {
  return {
    identifiers: sortReportItems(itemsFor(items, "identifiers")),
    commercial: sortReportItems(itemsFor(items, "commercial")),
    internet_activity: sortReportItems(itemsFor(items, "internet_activity")),
    inferences: sortReportItems(itemsFor(items, "inferences")),
  };
}

function profileItems(profile: Profile | null): readonly CategorizedItem[] {
  if (!profile) return [];
  return profileFieldKeys().map((field) => ({
    category: PROFILE_FIELD_CCPA_CATEGORIES[field],
    item: profileReportItem(profile, field),
  }));
}

function eventItems(events: readonly IngestEvent[]): readonly CategorizedItem[] {
  return events.flatMap((event, index) =>
    Object.entries(event).map(([field, value]) => ({
      category: eventFieldCategory(field),
      item: { source: "event", field: `events.${index}.${field}`, value },
    })),
  );
}

function consentItems(consent: ConsentState | null): readonly CategorizedItem[] {
  if (!consent) return [];
  return Object.entries(consent).map(([field, value]) => ({
    category: consentFieldCategory(field),
    item: { source: "consent", field, value },
  }));
}

function itemsFor(items: readonly CategorizedItem[], category: CcpaCategory): readonly ReportItem[] {
  return items.filter((entry) => entry.category === category).map((entry) => entry.item);
}

type CategorizedItem = Readonly<{ category: CcpaCategory; item: ReportItem }>;
