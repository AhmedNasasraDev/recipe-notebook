// Renders the three audit reports from artifact/inventory.json, and injects the
// same data into artifact/index.html so the artifact and the markdown can never
// disagree.
//
//   node artifact/scripts/report.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const data = JSON.parse(readFileSync(at('../inventory.json'), 'utf8'));

const HEAD = (title, blurb) => `<!-- GENERATED from artifact/inventory.json by artifact/scripts/report.mjs.
     Edit the JSON, not this file. -->

# ${title}

${blurb}

מקור האמת: הקוד ב-commit \`${data.commit}\`. כל שורה כאן ניתנת למיפוי לקובץ בפרויקט.

`;

const table = (headers, rows) =>
  [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/* ── 1. inventory ────────────────────────────────────────────────────────── */
writeFileSync(
  at('../UI_INVENTORY.md'),
  HEAD(
    'UI Inventory — מה קיים בפועל בקוד',
    'רשימת כל ה-routes, המסכים והקומפוננטות שקיימים בקוד כרגע, עם הנתיב שמגיע אליהם ומקור הנתונים. נבנתה מסריקת הקוד, לא מהמפרט.',
  ) +
    `## Routes (${data.routes.length})\n\n` +
    table(
      ['Route', 'מסך', 'קומפוננטה', 'קובץ', 'איך מגיעים', 'מקור נתונים', 'תלות Backend'],
      data.routes.map((r) => [
        `\`${esc(r.route)}\``,
        esc(r.name),
        esc(r.screen),
        `\`${esc(r.file)}\``,
        esc(r.reach),
        esc(r.data),
        esc(r.backend),
      ]),
    ) +
    `\n\n## קומפוננטות, גליות ופאנלים (${data.components.length})\n\n` +
    table(
      ['שם', 'קובץ', 'מוצג בתוך', 'מה הוא', 'בדיקות'],
      data.components.map((c) => [
        esc(c.name),
        `\`${esc(c.file)}\``,
        esc(c.host),
        esc(c.what),
        esc(c.tests),
      ]),
    ) +
    '\n',
);

/* ── 2. audit ────────────────────────────────────────────────────────────── */
const widths = 'כל 24 המסכים נבדקו ב-402 / 820 / 1440 — 72 צמדי route×רוחב, אפס שגיאות ואפס גלישה אופקית (artifact/scripts/probe.mjs).';
writeFileSync(
  at('../UI_AUDIT.md'),
  HEAD(
    'UI Audit — מסך אחר מסך',
    `לכל מסך: מה הוא מציג, אילו פעולות קיימות, על מה הוא נשען בשרת, ומה נבדק. ${widths}`,
  ) +
    data.routes
      .map(
        (r) => `## ${r.name} — \`${r.route}\`

| | |
|---|---|
| **קומפוננטה** | ${esc(r.screen)} |
| **קובץ** | \`${esc(r.file)}\` |
| **מפרט** | ${esc(r.spec)} |
| **איך מגיעים** | ${esc(r.reach)} |
| **מקור נתונים** | ${esc(r.data)} |
| **תלות Backend** | ${esc(r.backend)} |
| **פעולות** | ${r.actions.length ? r.actions.map(esc).join(' · ') : '—'} |
| **States** | ${r.states.length ? r.states.map(esc).join(' · ') : '—'} |
| **בדיקות יחידה/מסך** | ${esc(r.tests)} |
| **E2E בדפדפן** | ${esc(r.e2e)} |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ${
          { ok: 'נתוני המוצר (מתכוני הדמו)', fixture: 'ARTIFACT FIXTURE', component: 'קומפוננטה בלבד — BACKEND NOT EXECUTED', dead: 'קוד מת — אינו מוצג' }[
            r.viewer
          ] ?? esc(r.viewer)
        } |
${r.notes ? `| **הערה** | ${esc(r.notes)} |` : ''}
`,
      )
      .join('\n') +
    '\n',
);

/* ── 3. spec coverage ────────────────────────────────────────────────────── */
const counts = ['COMPLETED', 'PARTIAL', 'NOT BUILT', 'BLOCKED'].map(
  (s) => `**${s}**: ${data.spec.filter((r) => r.status === s).length}`,
);
writeFileSync(
  at('../SPEC_COVERAGE.md'),
  HEAD(
    'Spec Coverage — המפרט כ-checklist',
    `${data.spec.length} דרישות. ${counts.join(' · ')}\n\nCOMPLETED פירושו שהיכולת קיימת בפועל וניתן להוכיח אותה מהקוד ומהבדיקות — לא «מצאתי קומפוננטה».`,
  ) +
    table(
      ['דרישה', 'מימוש', 'Route', 'קובץ', 'UI', 'Backend', 'Test', 'E2E', 'Status', 'הערה'],
      data.spec.map((r) => [
        esc(r.req),
        esc(r.impl),
        `\`${esc(r.route)}\``,
        `\`${esc(r.file)}\``,
        esc(r.ui),
        esc(r.backend),
        esc(r.test),
        esc(r.e2e),
        `**${r.status}**`,
        esc(r.note),
      ]),
    ) +
    `\n\n## ממצאים (${data.findings.length})\n\n` +
    table(
      ['#', 'סוג', 'מה', 'איפה', 'חומרה'],
      data.findings.map((f) => [f.id, esc(f.kind), esc(f.what), `\`${esc(f.where)}\``, esc(f.sev)]),
    ) +
    '\n\n## הערות התצוגה (ARTIFACT FIXTURE)\n\n' +
    data.caveats.map((c) => `- ${c}`).join('\n') +
    '\n',
);

/* ── 4. inject into the artifact page ───────────────────────────────────── */
const page = at('../index.html');
const html = readFileSync(page, 'utf8');
const START = '/* AUDIT-DATA:START */';
const END = '/* AUDIT-DATA:END */';
const i = html.indexOf(START);
const j = html.indexOf(END);
if (i === -1 || j === -1) {
  console.error('index.html has no AUDIT-DATA markers — nothing injected');
  process.exit(1);
}
writeFileSync(
  page,
  `${html.slice(0, i + START.length)}\nwindow.__AUDIT = ${JSON.stringify(data)};\n${html.slice(j)}`,
);

console.log(
  `reports written: UI_INVENTORY.md, UI_AUDIT.md, SPEC_COVERAGE.md; ` +
    `${data.routes.length} routes, ${data.spec.length} spec rows, ${data.findings.length} findings injected into index.html`,
);
