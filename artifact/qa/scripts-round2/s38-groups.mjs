// Groups with two accounts on the real project: create → code → join by code → approve → member; invite by email (CORS path).
import { launch, BASE, text, sleep, shot, check, results, creds } from './drv.mjs';
import fs from 'node:fs';
const { browser, page: p1, net, errors } = await launch({ storageState: 'state-qa1.json' });
const dump = async (p, label) => { console.log(label, '| inputs:', await p.locator('input, textarea').evaluateAll((els) => els.map((e) => `${e.id}|${e.placeholder}|${e.getAttribute('aria-label')}`)), '| buttons:', await p.locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()).filter(Boolean).slice(0, 14))); };
await p1.goto(BASE + '/groups'); await p1.waitForSelector('main'); await sleep(1500);
await p1.getByRole('button', { name: 'קבוצה חדשה' }).click(); await sleep(600);
await dump(p1, 'create form');
await p1.locator('input').first().fill('בדיקה-QA קבוצה סבב 2');
await p1.getByRole('button', { name: /^יצירת הקבוצה$|^יצירה$|^יצירת קבוצה$/ }).first().click().catch(async () => { await p1.getByRole('button', { name: /יציר/ }).last().click(); });
await sleep(3500);
// the list shows the new group; the code lives on the group's own page
await p1.getByRole('link', { name: /בדיקה-QA קבוצה סבב 2/ }).first().click().catch(async () => { await p1.getByText('בדיקה-QA קבוצה סבב 2').first().click(); });
await sleep(2500);
let t = await text(p1);
const code = (t.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/) || [])[0];
console.log('group url:', p1.url(), '| code:', code, '|', t.slice(0, 200));
check('G01', 'group created and a join code is shown', !!code && /\/group\//.test(p1.url()), code ?? t.slice(0, 120));
const G = p1.url().split('/group/')[1]?.split('/')[0];
await shot(p1, 'W26-group-created');
fs.writeFileSync('group2-id.txt', G ?? '');

// qa2 joins by code
const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' });
const p2 = await ctx2.newPage();
await p2.goto(BASE + '/groups'); await p2.waitForSelector('main'); await sleep(1500);
await p2.getByRole('button', { name: 'הצטרפות עם קוד' }).click(); await sleep(500);
await dump(p2, 'join form');
await p2.locator('input').first().fill(code.toLowerCase());
await p2.getByRole('button', { name: /שליחת בקשה|הצטרפות|בקשה/ }).last().click(); await sleep(3500);
let t2 = (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
console.log('after join request:', t2.slice(0, 200));
check('G02', 'qa2: request sent with the code typed in lower case (normalised)', /בקשה|ממתין|נשלחה/.test(t2) && !/נכשל|שגיאה/.test(t2), t2.slice(0, 120));

// qa1 approves
await p1.goto(`${BASE}/group/${G}/perms`); await p1.waitForSelector('main'); await sleep(2500);
await dump(p1, 'perms');
t = await text(p1);
const approve = p1.getByRole('button', { name: /אישור/ }).first();
check('G03', 'qa1 sees the pending request from qa2', (await approve.count()) > 0 && /qa2/.test(t), t.match(/qa2[^ ]*/)?.[0] ?? t.slice(0, 120));
if (await approve.count()) { await approve.click(); await sleep(3000); }
await p2.goto(`${BASE}/groups`); await p2.waitForSelector('main'); await sleep(2500);
t2 = (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
check('G04', 'qa2 is now a member and sees the group', /בדיקה-QA קבוצה סבב 2/.test(t2) && !/אינכם חברים באף קבוצה/.test(t2), t2.slice(0, 120));
await shot(p2, 'W27-qa2-member');

// invite by email from qa1 (CORS fix; mail secrets absent → honest message)
await p1.goto(`${BASE}/group/${G}/perms`); await p1.waitForSelector('main'); await sleep(2000);
const emailInput = p1.locator('input[type=email]').first();
if (await emailInput.count()) {
  await emailInput.fill('nasasraah+qa3@gmail.com');
  await p1.getByRole('button', { name: 'יצירת הזמנה' }).click(); await sleep(4000);
  t = await text(p1);
  const fn = net.filter((n) => n.u.includes('functions/v1/send-group-invite'));
  check('G05', 'invite: edge function reached (no CORS block), honest "mail not connected" message', fn.some((n) => n.s === 200) && /שירות המייל אינו מחובר|לא נשלח/.test(t), JSON.stringify(fn.map((n) => `${n.m} ${n.s}`)) + ' ' + (t.match(/שירות המייל[^.]*/)?.[0] ?? ''));
} else {
  check('G05', 'invite by email form not found on perms screen', false, '');
}
// chat: message from qa2, seen by qa1 after reload (realtime not testable here)
await p2.goto(`${BASE}/group/${G}`); await p2.waitForSelector('main'); await sleep(2000);
const chatBtn = p2.getByRole('button', { name: 'צ׳אט' });
if (await chatBtn.count()) {
  await chatBtn.click(); await sleep(1000);
  await p2.fill('#chat-draft', 'בדיקה-QA שלום סבב 2'); await p2.getByRole('button', { name: 'שליחה' }).click(); await sleep(2500);
  await p1.goto(`${BASE}/group/${G}`); await p1.waitForSelector('main'); await sleep(2000);
  await p1.getByRole('button', { name: 'צ׳אט' }).click(); await sleep(2000);
  t = await text(p1);
  check('G06', 'chat message from qa2 is stored and shown to qa1 (after load; realtime push not testable in this sandbox)', /בדיקה-QA שלום סבב 2/.test(t), '');
}
await ctx2.close();
console.log('errors:', errors.filter((e) => !/40[034]/.test(e)).slice(0, 5));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
