/**
 * @cdp-us/core-cdp — foundational CDP module.
 *
 * Builds user profiles from ingest events; other modules consume its profiles.
 * Depends only on @cdp-us/contracts and @cdp-us/db. US-only system.
 */
export {
  type ProfileStore,
  InMemoryProfileStore,
  DbProfileStore,
} from "./profile-store.js";
export { ProfileService } from "./profile-service.js";
export { resolveExisting, newProfile } from "./identity.js";
export {
  type SegmentRule,
  evaluateSegment,
  segmentMembers,
} from "./segments.js";
