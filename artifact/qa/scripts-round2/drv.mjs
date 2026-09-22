// Shared Playwright driver for the QA run.
import fs from 'node:fs';
import path from 'node:path';
process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = '1';
const PW = '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
export const BASE = 'http://127.0.0.1:5199';
export const SHOTS = '/home/user/recipe-notebook/artifact/qa/shots-real';
fs.mkdirSync(SHOTS, { recursive: true });
export const PHONE = { width: 402, height: 874 };
export const DESK = { width: 1440, height: 900 };
export const results = [];
export function check(id, label, pass, detail = '') {
  results.push({ id, label, pass, detail });
  console.log(`${pass === true ? 'ok  ' : pass === false ? 'FAIL' : 'note'} ${id} ${label}${detail ? ` -- ${detail}` : ''}`);
}
export async function launch({ viewport = PHONE, storageState, headless = true } = {}) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless,
    proxy: { server: process.env.HTTPS_PROXY || 'http://127.0.0.1:41587', bypass: 'localhost;127.0.0.1' },
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({
    viewport,
    locale: 'he-IL',
    ignoreHTTPSErrors: false,
    ...(storageState ? { storageState } : {}),
  });
  const page = await ctx.newPage();
  const net = [];
  const errors = [];
  page.on('request', (r) => { if (r.url().includes('supabase.co')) net.push({ m: r.method(), u: r.url().replace('https://qxdpsomelzpvphkhkqrw.supabase.co', ''), t: Date.now() }); });
  page.on('response', async (r) => { if (r.status() >= 400 && !r.url().includes('supabase.co')) { try { errors.push(`HTTP ${r.status()} ${r.url()}`); } catch {} }
    if (r.url().includes('supabase.co') && r.status() >= 300 && r.status() !== 304) { try { const t = await r.text(); net.push({ bodyOf: r.url().replace('https://qxdpsomelzpvphkhkqrw.supabase.co', '').slice(0, 80), status: r.status(), body: t.slice(0, 300) }); } catch {} }
    if (r.url().includes('supabase.co')) { const e = net.find((x) => x.u === r.url().replace('https://qxdpsomelzpvphkhkqrw.supabase.co', '') && x.s === undefined); if (e) e.s = r.status(); } });
  page.on('requestfailed', (r) => { if (r.url().includes('supabase.co')) net.push({ m: r.method(), u: r.url().replace('https://qxdpsomelzpvphkhkqrw.supabase.co', ''), failed: r.failure()?.errorText }); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.setDefaultTimeout(15000);
  return { browser, ctx, page, net, errors };
}
export async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); }
export async function shotFull(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function text(page) { return (await page.locator('body').innerText()).replace(/\s+/g, ' '); }
export function creds(n) {
  const f = './creds.json';
  return JSON.parse(fs.readFileSync(f, 'utf8'))[n];
}
