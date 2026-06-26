import type {
  Engagement,
  RawSocialItem,
  Signal,
  SocialPlatform,
} from "./types.js";
import { SOCIAL_PLATFORMS } from "./types.js";

function isSupportedPlatform(value: string): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return 0;
}

/**
 * Normalize a raw provider item into a {@link Signal}.
 *
 * Invariant: every finding must be auditable back to a public source, so a
 * missing/blank `url` THROWS. This is a hard requirement, not a default.
 *
 * @param raw   Provider-shaped item.
 * @param fallbackPlatform Platform to use when the item omits one (e.g. the
 *              collector's platform). Optional.
 */
export function normalize(
  raw: RawSocialItem,
  fallbackPlatform?: SocialPlatform,
): Signal {
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!url) {
    // Hard fail: a signal without a source URL is not auditable.
    throw new Error("social-intel: normalize requires a source url");
  }

  const rawPlatform =
    typeof raw.platform === "string" ? raw.platform.trim().toLowerCase() : "";
  const platform: SocialPlatform = isSupportedPlatform(rawPlatform)
    ? rawPlatform
    : fallbackPlatform ??
      (() => {
        throw new Error(
          `social-intel: normalize received unknown platform "${raw.platform}"`,
        );
      })();

  const engagement: Engagement = {
    likes: toCount(raw.likes),
    replies: toCount(raw.replies),
    shares: toCount(raw.shares),
    views: toCount(raw.views),
  };

  return {
    platform,
    author: typeof raw.author === "string" ? raw.author : "",
    text: typeof raw.text === "string" ? raw.text : "",
    url,
    ts: typeof raw.ts === "string" && raw.ts ? raw.ts : new Date(0).toISOString(),
    engagement,
  };
}

/**
 * Normalize a batch, skipping nothing — any item missing a url throws, which
 * surfaces bad provider data loudly rather than silently dropping it.
 */
export function normalizeAll(
  items: RawSocialItem[],
  fallbackPlatform?: SocialPlatform,
): Signal[] {
  return items.map((item) => normalize(item, fallbackPlatform));
}
