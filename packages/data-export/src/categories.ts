import type { Profile } from "@cdp-us/contracts";
import type { CcpaCategory, ReportItem } from "./types.js";

/** @example const field: ProfileField = "email"; */
export type ProfileField = Extract<keyof Profile, string>;

/** @example const category = PROFILE_FIELD_CCPA_CATEGORIES.email; */
export const PROFILE_FIELD_CCPA_CATEGORIES = {
  id: "identifiers",
  tenantId: "commercial",
  anonymousId: "identifiers",
  userId: "identifiers",
  email: "identifiers",
  firmographics: "commercial",
  intent: "inferences",
  traits: "commercial",
  createdAt: "internet_activity",
  updatedAt: "internet_activity",
} as const satisfies Record<ProfileField, CcpaCategory>;

/** @example const keys = profileFieldKeys(); */
export function profileFieldKeys(): readonly ProfileField[] {
  return Object.keys(PROFILE_FIELD_CCPA_CATEGORIES).sort() as ProfileField[];
}

/** @example const item = profileReportItem(profile, "email"); */
export function profileReportItem(profile: Profile, field: ProfileField): ReportItem {
  return { source: "profile", field, value: profile[field] };
}

/** @example const category = eventFieldCategory("event"); */
export function eventFieldCategory(field: string): CcpaCategory {
  return field === "traits" ? "commercial" : "internet_activity";
}

/** @example const category = consentFieldCategory("gpc"); */
export function consentFieldCategory(_field: string): CcpaCategory {
  return "internet_activity";
}
