'use strict';
/**
 * RF email module types (152-ФЗ / закон «О рекламе»; русский клиентский текст).
 * Ported from US modules/email/types.ts, with the US legal footer (CAN-SPAM
 * physical address) replaced by 152-ФЗ operator identification.
 *
 * @typedef {'welcome'|'abandoned_cart'|'reactivation'} EmailTrigger
 *
 * @typedef {Object} GenerationContext
 * @property {EmailTrigger} trigger
 * @property {string} brandName            имя бренда/отправителя в тексте
 * @property {string} [productName]
 * @property {string} [ctaUrl]
 *
 * @typedef {Object} GeneratedEmail
 * @property {string} subject
 * @property {string} html
 *
 * @typedef {Object} OutboundMessage
 * @property {string} to
 * @property {string} from
 * @property {string} subject
 * @property {string} html
 *
 * @typedef {Object} Compliance152fzOptions
 * @property {string} operator         идентификация оператора/отправителя (название, ИНН, контакты)
 * @property {string} unsubscribeUrl   рабочая ссылка отписки от рассылки
 */

/** Lifecycle triggers (universal; copy is RU). */
const EMAIL_TRIGGERS = ['welcome', 'abandoned_cart', 'reactivation'];

module.exports = { EMAIL_TRIGGERS };
