const { chromium } = require('/private/tmp/claude-501/-Users-a1/0b05dba6-4f55-4a5a-ac96-7a24f52fbd0f/scratchpad/node_modules/playwright');
const dir = '/private/tmp/claude-501/-Users-a1/e2d1bdd1-13c9-4358-90fa-aa50b5d85288/scratchpad/axiom-deck';
const SHELL = '/Users/a1/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell';

(async () => {
  const browser = await chromium.launch({ executablePath: SHELL });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto('file://' + dir + '/deck-ru.html', { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(300);

  await page.pdf({
    path: dir + '/AXIOM-deck-RU.pdf',
    width: '1280px', height: '720px',
    printBackground: true, preferCSSPageSize: false,
  });

  const n = await page.locator('.slide').count();
  for (const i of [5]) {
    await page.locator('.slide').nth(i).screenshot({ path: dir + '/v_' + String(i + 1).padStart(2, '0') + '.png' });
  }
  console.log('slides=' + n);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
