// Cook mode on the pasted brioche: the weighing list, the timer, fullscreen sizes.
import { launch, BASE, text, sleep, shot, check, results } from './drv.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const { browser, page, errors } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}/cook`); await page.waitForSelector('li label', { timeout: 20000 }); await sleep(500);
const names = await page.locator('li label').allInnerTexts();
const list = names.map((s) => s.replace(/\s+/g, ' ').trim());
console.log('mise rows:', list);
check('M01', 'weighing list: 8 lines, one per ingredient', list.length === 8, String(list.length));
check('M02', 'no weight/yield lines on the weighing list', !list.some((l) => /משקל|פחת|תפוקה/.test(l)), '');
check('M03', 'butter, milk, vanilla each appear once', ['חמאה', 'חלב', 'וניל'].every((w) => list.filter((l) => l.includes(w)).length === 1), '');
const t0 = await text(page);
check('M04', 'no steps or timers on the weighing stage', !/הפעלת טיימר|סיימתי — לשלב הבא/.test(t0), '');
await shot(page, 'W14-mise-phone');
await page.getByRole('button', { name: /מעבר להכנה|מתחילים בהכנה/ }).click(); await sleep(800);
await page.getByRole('button', { name: 'שלב 2' }).click(); await sleep(300);
await page.getByRole('button', { name: /הפעלת טיימר/ }).click(); await sleep(1200);
const clock = () => page.evaluate(() => { const c = [...document.querySelectorAll('[aria-label="טיימרים"] .ltr')].find((e) => /^\d+:\d\d/.test(e.textContent)); if (!c) return null; const cs = getComputedStyle(c); return { text: c.textContent, px: parseFloat(cs.fontSize), color: cs.color, bg: getComputedStyle(c.closest('[role]')).backgroundColor }; });
let c = await clock();
check('T01', 'timer running: clock ≥ 44px in the normal view', c && c.px >= 44, JSON.stringify(c));
let t = await text(page);
check('T02', 'state written out: "פועל", buttons have words (עצירה, ביטול)', /פועל/.test(t) && /עצירה/.test(t) && /ביטול/.test(t), '');
const btn = await page.getByRole('button', { name: 'עצירת הטיימר של שלב 2' }).boundingBox();
check('T03', 'timer control ≥ 52px tall', btn && btn.height >= 52, JSON.stringify(btn));
await shot(page, 'W15-timer-running-phone');
await page.getByRole('button', { name: 'עצירת הטיימר של שלב 2' }).click(); await sleep(400);
t = await text(page);
check('T04', 'paused state written out: "מושהה" and "המשך"', /מושהה/.test(t) && /המשך/.test(t), '');
await shot(page, 'W16-timer-paused-phone');
await page.getByRole('button', { name: /^מסך מלא$/ }).click(); await sleep(800);
c = await clock();
check('T05', 'fullscreen: clock ≥ 64px', c && c.px >= 64, JSON.stringify(c));
await shot(page, 'W17-timer-fullscreen-phone');
// reload keeps the timer (paused)
await page.reload(); await page.waitForSelector('[aria-label="טיימרים"]', { timeout: 20000 }).catch(() => {}); await sleep(500);
t = await text(page);
check('T06', 'after reload the paused timer is still there', /מושהה/.test(t) && /שלב 2/.test(t), '');
// landscape
await page.setViewportSize({ width: 874, height: 402 }); await sleep(600);
c = await clock();
check('T07', 'landscape: clock still ≥ 40px and on screen', c && c.px >= 40, JSON.stringify(c));
await shot(page, 'W18-timer-landscape');
await page.setViewportSize({ width: 402, height: 874 });
// cancel
await page.getByRole('button', { name: 'מחיקת הטיימר של שלב 2' }).click(); await sleep(300);
t = await text(page);
check('T08', 'cancel is said: "בוטל"', /בוטל/.test(t), '');
check('T09', 'idle state on the step: "לא הופעל"', /לא הופעל/.test(t), '');
// finished state: personal 1-minute timer would take a minute; use a tiny own timer via the form? minutes are whole. Skip live; unit tests cover the end state.
check('T10', 'finished state (red card, "הסתיים", "הזמן נגמר") verified by unit test; a live minute is not waited for here', null, 'CookScreen.test "counts down in real time, and turns into an alert at zero"');
// no leak: open the copy's cook mode → no timers
const copy = fs.readFileSync('copy-id.txt', 'utf8').trim();
await page.getByRole('button', { name: /הפעלת טיימר/ }).click(); await sleep(500);
await page.goto(BASE + `/recipe/${copy}/cook`); await page.waitForSelector('li label', { timeout: 20000 }); await sleep(300);
t = await text(page);
check('T11', 'a timer started on one recipe does not appear on another', !/פועל|טיימר · שלב/.test(t), '');
console.log('errors:', errors.slice(0, 5));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
