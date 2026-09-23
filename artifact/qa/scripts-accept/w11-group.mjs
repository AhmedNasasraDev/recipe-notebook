import { launch, BASE, sleep } from './drv.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const { browser, page, net, errors } = await launch({ storageState: 'state-qa1.json' });
const reqs = [];
page.on('request', (r) => { if (r.url().includes('supabase')) reqs.push(`${r.method()} ${r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 110)}`); });
page.on('requestfailed', (r) => reqs.push(`FAILED ${r.url().slice(0, 110)} ${r.failure()?.errorText}`));
await page.goto(BASE + `/group/${G}`); await page.waitForSelector('main'); 
for (const t of [1, 3, 6, 10]) { await sleep(t === 1 ? 1000 : 3000); console.log(`t=${t}s`, (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)); }
console.log('REQS', JSON.stringify(reqs, null, 0));
console.log('ERR', JSON.stringify(errors.slice(0, 5)));
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-group-loading.png' });
// groups list
await page.goto(BASE + '/groups'); await page.waitForSelector('main'); await sleep(2500);
console.log('GROUPS LIST', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
await page.locator('a[href*="/group/"]').first().click().catch(() => console.log('no group link')); await sleep(4000);
console.log('AFTER CLICK', page.url(), (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200));
// recipe image section
await page.goto(BASE + `/recipe/${id}`); await page.waitForSelector('main'); await sleep(2500);
const b = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const i = b.indexOf('החלפת התמונה'); console.log('IMG SECTION', b.slice(Math.max(0, i - 300), i + 200));
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-image-orphan.png', fullPage: true });
console.log('NET', JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 120)} ${n.s}`)));
await browser.close();
