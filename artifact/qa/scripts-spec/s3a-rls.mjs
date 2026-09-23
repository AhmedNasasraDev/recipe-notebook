// A-11 side check: migration 0040 must not widen reading. An account that neither owns the recipe nor uploaded the
// file must still be refused a signed URL for qa1's brioche photo; qa1 itself must get one.
import { launch, BASE, sleep } from './drv.mjs';
const PATH = 'cd1630f3-4a80-4a74-b4ea-775d29cd64c0/13551e39-5568-4a6e-97b8-6626e96725cf.webp';
const out = {};
for (const who of ['qa1', 'qa2', 'qa3']) {
  const { browser, page } = await launch({ storageState: `state-${who}.json` });
  await page.goto(BASE + '/notebook'); await sleep(2500);
  out[who] = await page.evaluate(async (p) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const sess = key ? JSON.parse(localStorage.getItem(key)) : null;
    const token = sess?.access_token; if (!token) return { error: 'no session' };
    const anon = (window.__ENV && window.__ENV.VITE_SUPABASE_ANON_KEY) || null;
    const r = await fetch('https://qxdpsomelzpvphkhkqrw.supabase.co/storage/v1/object/sign/recipe-images/' + p, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, apikey: token }, body: JSON.stringify({ expiresIn: 60 }) });
    const t = await r.text();
    return { status: r.status, body: t.slice(0, 120).replace(/token=[^"&]+/, 'token=…') };
  }, PATH);
  await browser.close();
}
console.log(JSON.stringify(out, null, 1));
