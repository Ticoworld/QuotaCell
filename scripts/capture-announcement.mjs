import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'captures');
const site = 'https://quotacell.netlify.app';
const pocket = '0x0c2d5a5bfdbe9e77d02bac5cc64e6a27f8522f8ebbf9bda3ae4b8d1453b7abd8';
await mkdir(output, { recursive: true });

const report = {
  source: site,
  capturedAt: new Date().toISOString(),
  purpose: 'Public beta announcement, real live-domain browser screenshots',
  screenshots: [],
  errors: []
};

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const makePage = (viewport, scale = 1) => browser.newPage({ viewport, deviceScaleFactor: scale, locale: 'en-US', reducedMotion: 'reduce' });
  const record = async (page, file, selector, description) => {
    const target = selector ? page.locator(selector) : page;
    const path = join(output, file);
    if (selector) await target.screenshot({ path, animations: 'disabled', timeout: 30000 });
    else await page.screenshot({ path, animations: 'disabled', timeout: 30000 });
    report.screenshots.push({ file, url: page.url(), description, capturedAt: new Date().toISOString() });
    console.log('CAPTURED ' + file + ' from ' + page.url());
  };
  const desktop = await makePage({ width: 1440, height: 900 }, 1.5);
  const initial = await desktop.goto(site + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!initial || !initial.ok() || new URL(desktop.url()).origin !== site) throw new Error('Landing page did not return a valid live-domain response');
  await desktop.locator('.land-hero h1').waitFor({ state: 'visible', timeout: 30000 });
  await desktop.evaluate(async () => {
    await document.fonts.ready;
    const image = document.querySelector('.land-hero-art img');
    if (image && !image.complete) await new Promise(done => { image.addEventListener('load', done, {once: true}); image.addEventListener('error', done, {once: true}); setTimeout(done, 10000); });
  });
  const buttonLabel = (await desktop.locator('.land-hero a[href="/app"]').innerText()).trim();
  if (!buttonLabel.toLowerCase().includes('launch app')) throw new Error('Unexpected landing version: hero CTA = ' + buttonLabel);
  await record(desktop, '01-desktop-landing.png', null, 'QuotaCell live desktop landing, hero and launch CTA');
  await record(desktop, '02-use-cases.png', '#use-cases', 'Live audience section explaining teams and operators');
  await record(desktop, '03-testnet-evidence.png', '#proof', 'Live Pudge testnet evidence section with explorer links');
  await desktop.close();

  const mobile = await makePage({ width: 390, height: 844 }, 2);
  const m = await mobile.goto(site + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!m || !m.ok() || new URL(mobile.url()).origin !== site) throw new Error('Mobile landing did not return live site');
  await mobile.locator('.land-hero h1').waitFor({ state: 'visible', timeout: 30000 });
  await mobile.evaluate(async () => { await document.fonts.ready; });
  await record(mobile, '04-mobile-landing.png', null, 'QuotaCell mobile landing at 390 CSS px');
  await mobile.close();

  // This is public read-only Pocket inspection. No wallet extension,
  // account information, signing or transactions are available here.
  const publicApp = await makePage({ width: 1440, height: 960 }, 1.5);
  try {
    const response = await publicApp.goto(site + '/app?pocket=' + pocket, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!response || !response.ok() || new URL(publicApp.url()).origin !== site) throw new Error('Public Pocket route did not return the live site');
    await publicApp.locator('main.app-page').waitFor({ state: 'visible', timeout: 90000 });
    // Confirm that the live app is serving the new official blue logo,
    // not the older cell glyph captured in the previous media kit.
    const logo = publicApp.locator('.topbar .brand img');
    await logo.waitFor({ state: 'visible', timeout: 15000 });
    const logoCheck = await logo.evaluate(img => ({
      src: img.currentSrc,
      loaded: img.complete && img.naturalWidth > 0,
      width: img.naturalWidth,
      height: img.naturalHeight
    }));
    const isExternalOfficialLogo = logoCheck.src.includes('quotacell-logo-blue');
    // Vite can inline small SVG imports as data URLs. Compare its actual
    // geometry and fill against the source-controlled official brand mark.
    const decodedInlineLogo = logoCheck.src.startsWith('data:image/svg+xml,')
      ? decodeURIComponent(logoCheck.src.split(',').slice(1).join(','))
      : '';
    const isOfficialInlineLogo = decodedInlineLogo.includes('viewBox="0 0 425 390"')
      && decodedInlineLogo.includes('fill="#2457e8"')
      && decodedInlineLogo.includes('aria-label="QuotaCell logo"');
    if (!logoCheck.loaded || (!isExternalOfficialLogo && !isOfficialInlineLogo)) {
      throw new Error('Production /app does not show the updated official blue brand logo: ' + JSON.stringify(logoCheck));
    }
    logoCheck.match = isExternalOfficialLogo ? 'official-file' : 'official-inlined-svg';
    report.walletHeaderLogo = logoCheck;
    // The history is verified asynchronously. Never publish a screenshot
    // showing a loading placeholder as completed public proof.
    await publicApp.locator('text=/Loading committed transactions from Pudge/i').waitFor({ state: 'hidden', timeout: 65000 });
    await publicApp.waitForTimeout(350);
    const body = await publicApp.locator('main.app-page').innerText();
    if (!/Closed|Active|Protected balance|Policy terminal capacity/i.test(body)) throw new Error('Public Pocket did not present a verified state');
    if (/Loading committed transactions from Pudge|Could not load transaction history/i.test(body)) throw new Error('Public Pocket history did not finish verification');
    await record(publicApp, '05-live-public-pocket.png', null, 'Public Pudge Pocket state in live app, without a connected wallet');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    report.errors.push({ capture: '05-live-public-pocket.png', error: message.slice(0, 500) });
    console.warn('SKIPPED public Pocket screenshot: ' + message.slice(0, 300));
  } finally { await publicApp.close(); }
} catch (e) {
  report.errors.push({ fatal: e instanceof Error ? e.message : String(e) });
  console.error('CAPTURE ERROR', e);
} finally {
  if (browser) await browser.close();
  await writeFile(join(output, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('CAPTURE RESULTS', JSON.stringify(report));
}
if (report.screenshots.length < 5 || !report.walletHeaderLogo?.loaded) process.exitCode = 1;
