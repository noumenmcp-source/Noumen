export {
  consentFieldCategory,
  eventFieldCategory,
  PROFILE_FIELD_CCPA_CATEGORIES,
  profileFieldKeys,
  profileReportItem,
} from "./categories.js";
export { planDeletion } from "./deletion.js";
export { executeDeletion, type DsarEraser, type DeletionResult } from "./execute.js";
export { assembleAccessReport } from "./report.js";
export { isPiiTraitKey, redactProfile, TOMBSTONE_MARKER } from "./redact.js";
export { sortDeletionTargets, sortReportItems } from "./sort.js";
export type {
  AccessReport,
  CcpaCategory,
  ConsentReader,
  DeletionPlan,
  DeletionTarget,
  DeletionTargetType,
  DsarReaders,
  DsarRequest,
  EventReader,
  LegalHold,
  ProfileReader,
  ReportItem,
  Subject,
} from "./types.js";
export { ACCESS_REPORT_SCHEMA_VERSION } from "./types.js";
export {
  buildAdAudienceCsv,
  hashEmail,
  hashPhone,
  normalizeEmail,
  normalizePhone,
  type AdPlatform,
  type AdAudienceRow,
  type AdAudienceCsvOptions,
} from "./ad-audiences.js";
