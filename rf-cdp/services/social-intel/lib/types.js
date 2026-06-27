'use strict';
/**
 * RF social-intel types — ported from US modules/social-intel/types.ts.
 * Law-agnostic. Collection (when wired) must use official provider APIs only and
 * every item must carry a public source URL (auditability), same as US.
 *
 * @typedef {'youtube'|'vk'|'telegram'|'rutube'} SocialPlatform
 * @typedef {Object} RawSocialItem
 * @property {string} [platform]
 * @property {string} [author]
 * @property {string} [text]
 * @property {string} [url]    public permalink — REQUIRED by normalize
 * @property {string} [ts]
 * @property {number} [likes]
 * @property {number} [replies]
 * @property {number} [shares]
 * @property {number} [views]
 * @typedef {Object} Engagement
 * @property {number} likes
 * @property {number} replies
 * @property {number} shares
 * @property {number} views
 * @typedef {Object} Signal
 * @property {SocialPlatform} platform
 * @property {string} author
 * @property {string} text
 * @property {string} url
 * @property {string} ts
 * @property {Engagement} engagement
 * @typedef {Object} IntentAnalysis
 * @property {string[]} topics
 * @property {number} score   0..100
 */

/**
 * RF-supported platforms. US `tiktok/x/reddit` replaced by RF-accessible
 * sources; YouTube kept (accessible from RF, multilingual).
 */
const SOCIAL_PLATFORMS = ['youtube', 'vk', 'telegram', 'rutube'];

module.exports = { SOCIAL_PLATFORMS };
