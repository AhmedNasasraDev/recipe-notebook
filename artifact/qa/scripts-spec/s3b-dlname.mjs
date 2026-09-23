// Why did the download report "download" as its name? Compare ASCII vs Hebrew names, remove-now vs keep.
import { launch, BASE, sleep } from './drv.mjs';
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + '/'); await sleep(1500);
for (const [label, name, removeNow] of [['ascii-remove', 'test-backup.json', true], ['hebrew-remove', 'מחברת-מתכונים-גיבוי-2026-09-23.json', true], ['ascii-keep', 'test-backup.json', false], ['hebrew-keep', 'מחברת-גיבוי.json', false]]) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.evaluate(([n, rm]) => { const blob = new Blob(['{}'], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = n; document.body.appendChild(a); a.click(); if (rm) a.remove(); }, [name, removeNow])]);
  console.log(label, '->', JSON.stringify(dl.suggestedFilename()));
}
await browser.close();
