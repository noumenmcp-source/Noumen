'use strict';
/**
 * 152-ФЗ / закон «О рекламе» (ст. 18) footer enforcement — replaces the US
 * CAN-SPAM module. Every advertising message MUST carry:
 *  - identification of the operator/sender (название, ИНН, контакты), and
 *  - a working unsubscribe mechanism.
 * (Prior consent of the recipient is enforced separately by the campaign's
 * marketing-consent gate against the consent-ledger.)
 *
 * Throws when either field is missing, so a non-compliant ad can never ship.
 */
function enforce152fz(html, opts) {
  const operator = ((opts && opts.operator) || '').trim();
  const unsubscribeUrl = ((opts && opts.unsubscribeUrl) || '').trim();

  if (!operator) {
    throw new Error('Нарушение «О рекламе» ст.18: требуется идентификация оператора/отправителя.');
  }
  if (!unsubscribeUrl) {
    throw new Error('Нарушение «О рекламе» ст.18: требуется рабочая ссылка отписки.');
  }

  const footer =
    '<div class="cdp-152fz-footer" ' +
    'style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#666;line-height:1.5;">' +
    `<p style="margin:0 0 8px;">${escapeHtml(operator)}</p>` +
    '<p style="margin:0;">Вы получили это письмо, так как дали согласие на рекламную рассылку. ' +
    `<a href="${escapeAttr(unsubscribeUrl)}">Отписаться</a> можно в любой момент.</p>` +
    '</div>';

  const closingBody = /<\/body>/i;
  if (closingBody.test(html)) return html.replace(closingBody, `${footer}</body>`);
  return `${html}${footer}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

module.exports = { enforce152fz };
