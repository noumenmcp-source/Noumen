'use strict';
/**
 * RF consent contracts (152-ФЗ).
 *
 * The law-agnostic ledger mechanics (hash-chain + Ed25519) are ported from the
 * US `modules/consent`. The US purpose set (CCPA `sale_or_share`, TCPA
 * `messaging_tcpa`, Global Privacy Control) is intentionally REPLACED here with
 * a 152-ФЗ opt-in purpose model. Cross-border transfer defaults to DENY under RF
 * data residency (ст. 12).
 *
 * @typedef {Object} ConsentState
 * @property {boolean} pdn_processing        обработка персональных данных (базовое согласие, ст. 9)
 * @property {boolean} marketing_email       маркетинговые email-рассылки
 * @property {boolean} analytics             аналитика / cookies
 * @property {boolean} third_party_transfer  передача третьим лицам
 * @property {boolean} cross_border          трансграничная передача (по умолчанию запрещена)
 *
 * @typedef {Object} ConsentRecord
 * @property {string} tenantId
 * @property {string} subject    anonymousId | userId | hashed email
 * @property {ConsentState} state
 * @property {string} source     "checkbox" | "preference_center" | "api" | "withdrawal"
 * @property {string} ts         ISO timestamp
 * @property {string} prevHash
 * @property {string} hash
 * @property {string} [sig]      Ed25519 signature over `hash` (base64)
 */

/** Canonical 152-ФЗ consent purposes (all opt-in). */
const CONSENT_PURPOSES = [
  'pdn_processing',
  'marketing_email',
  'marketing_messaging',
  'analytics',
  'third_party_transfer',
  'cross_border',
];

module.exports = { CONSENT_PURPOSES };
