// THE TWO DOCUMENTS THAT TRAVEL WITH THE FILM.
//
// Extracted from film-render.mjs when film-sync.mjs appeared: the corrected
// cut has its own cue list, and a chapter list or a narration script generated
// from a different one would be exactly the sort of quiet mismatch the sync
// pass exists to remove. One generator, whichever timeline is passed in.

import fs from 'node:fs';
import path from 'node:path';

export const mmss = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * @param take  { duration, cues: [{ t, text, chapter, hold }] } — `t` in the
 *              timeline of the file being delivered, not of the recording.
 * @param root  where to write the two .md files
 */
export function writeDocs(take, root) {

/*
  ── THE TIMESTAMPS IN THIS LIST ARE HONEST ABOUT WHAT THEY ARE ────────────

  They come from the harness's own clock, and the drift described above means
  they are approximate against the file — good to a few seconds, not to the
  frame. The captions themselves are IN the picture, so nothing depends on
  these being exact; they are a table of contents, and that is what they are
  labelled as.
*/
const chapters = [...new Set(take.cues.map((c) => c.chapter))];
const lines = [
  '# מחברת מתכונים — סרטון הצגה',
  '',
  `משך: ${mmss(take.duration)} · ${chapters.length} פרקים · ${take.cues.length} כתוביות`,
  '',
  'הכתוביות מוטבעות בתמונה עצמה. הזמנים כאן הם תוכן עניינים ומדויקים לכמה שניות.',
  '',
  '## פרקים',
  '',
];
for (const name of chapters) {
  const first = take.cues.find((c) => c.chapter === name);
  lines.push(`- **${mmss(first.t)}** — ${name}`);
}
lines.push('', '## כל הכתוביות, לפי הסדר', '');
for (const cue of take.cues) {
  lines.push(`- \`${mmss(cue.t)}\` ${cue.text}`);
}
lines.push(
  '',
  '## מה אמיתי ומה סימולציה בהקלטה',
  '',
  '- **אמיתי** — כל המסכים, הניווט, האשף, חישוב הכמויות, ההמרות, העלויות,',
  '  האלרגנים, מצב ההכנה, הטיימר, שמירת ההתקדמות, כלי המדידה, תמונת המתכון',
  '  והתאמת המיקום שלה. זה קוד המוצר מחשב לעצמו.',
  '- **סימולציה מקומית** — הקבוצות, הצ׳אט, ההזמנות ותוכנית הייצור. הסכימה,',
  '  ההרשאות וה־RLS קיימים כמיגרציות, אבל אין שרת רץ בסביבה הזאת, ולכן',
  '  המשתמשים והמסירה מדומים. הכתוביות אומרות זאת במסכים האלה.',
  '- **לא מומש** — «פענוח חכם» של מתכון מודבק (דורש proxy עם מפתח בצד שרת),',
  '  ומצב הסקיילינג «נפח סופי». שניהם אינם מוצגים בסרטון.',
  '- **קיים במוצר ואינו מוצג בסרטון הזה** — איסוף האלרגנים האוטומטי וההערה',
  '  האישית. בהקלטה נשאר גיליון ההמרה פתוח מעליהם, ולכן הקטע הזה נחתך',
  '  בעריכת הסנכרון במקום להשאיר כיתוב מעל מסך שאינו מתאים לו. ראה',
  '  SYNC-NOTES.md.',
  '',
);
const chaptersFile = path.join(root, 'WALKTHROUGH_CHAPTERS.md');
fs.writeFileSync(chaptersFile, `${lines.join('\n')}\n`);

/*
  ── THE NARRATION SCRIPT, GENERATED FROM THE FILM ─────────────────────────

  Ahmed asked for narration IN the video. It could not be produced here and
  the reason is written down in NARRATION.md rather than glossed over: this
  environment reaches package registries and nothing else, so no neural voice
  can be fetched, and the one offline synthesiser installed (espeak-ng) reads
  unvocalised Hebrew letter by letter.

  What CAN be delivered is a script that cannot drift from the film, because
  it is generated from the same cue list the film painted: every line, the
  second it appears, and the window it has. Each window is at least as long
  as an unhurried reading of the line — that is what `holdFor` guarantees in
  film.mjs — so a voice recorded to this script fits without being sped up,
  which is the thing Ahmed ruled out.
*/
const narration = [
  '# מחברת מתכונים — תסריט קריינות',
  '',
  `${take.cues.length} משפטים · ${mmss(take.duration)} · מיועד להקראה מעל הסרטון.`,
  '',
  '## איך להקריא',
  '',
  '- קצב רגוע, טון מקצועי ובטוח. בלי הדגשה מכירתית ובלי האצה.',
  '- כל משפט נקרא כשהכיתובית שלו על המסך. חלון הזמן של כל משפט רשום בטבלה,',
  '  והוא ארוך לפחות כמו הקראה שקטה שלו — אין צורך למהר.',
  '- בין המשפטים יש שקט. אין צורך למלא אותו.',
  '',
  '## הגייה',
  '',
  '- «מיז אן פלאס» — mise en place, בהגייה צרפתית מרוככת.',
  '- «בריוש נאנטר» — Brioche Nanterre.',
  '- «פוד קוסט» — כפי שנהוג במטבח המקצועי, לא «עלות מזון».',
  '- מספרים, מטבע ויחידות כתובים במילים בתסריט («שלוש מאות וארבעים שקלים»,',
  '  «קילוגרם»), כדי שלא ייקראו כקיצור.',
  '',
  '## הטקסט, לפי הסדר',
  '',
  '| # | מופיע ב־ | חלון | הטקסט |',
  '| --- | --- | --- | --- |',
];
for (const [i, cue] of take.cues.entries()) {
  const window = cue.hold ? `${(cue.hold / 1000).toFixed(1)} שנ׳` : 'רץ עם הפעולה';
  narration.push(`| ${String(i + 1).padStart(2, '0')} | ${mmss(cue.t)} | ${window} | ${cue.text} |`);
}
const narrationFile = path.join(root, 'WALKTHROUGH_NARRATION.md');
fs.writeFileSync(narrationFile, `${narration.join('\n')}\n`);


  return { chaptersFile, narrationFile, chapterCount: chapters.length };
}
