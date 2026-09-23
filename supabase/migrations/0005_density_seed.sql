-- GENERATED from packages/engine DENSITY_TABLE — do not edit by hand.
-- Regenerate: node supabase/scripts/generate-density-seed.mjs
-- Verify:     npm run seed:check
--
-- 34 rows: 14 accepted, 8 accepted-single-source,
-- 5 pending-verification, 7 pending-form.
-- 11 known data gaps.
--
-- A pending row carries NO value on purpose (spec §5.1 rule 5). See CONFLICTS.md
-- for what each one is waiting on.
--
-- APPLIED to project qxdpsomelzpvphkhkqrw (Recipe Notebook, eu-central-1).
-- Verified after applying: the digest of the 34 rows in the database matches the
-- digest of DENSITY_TABLE, so the seed is the engine's data and not a retyping
-- of it.

insert into public.density_table
  (key, match_terms, exclude_terms, word_match, g_per_100, confidence,
   resolution, note, sources, needs_review, review_note, forms, ord)
values
  ('flour.wholemeal', ARRAY['קמח מלא', 'כוסמין']::text[], ARRAY['שקדים', 'שקד', 'קוקוס', 'חומוס', 'תירס', 'אורז', 'כוסמת', 'טפיוקה', 'קינואה', 'חרובים', 'סויה']::text[], false, NULL, 'system', 'pending-verification', 'כוס מכופלת בכף, בלי לדחוס', '{"measure.TABLE":54,"engine.CUP_DRY":50}'::jsonb, true, 'measure.TABLE נותן 54, ו-engine.CUP_DRY נתן 120 גר'' לכוס (=50) כי לא הבדיל בין קמח מלא לקמח לבן. פער 7.4%. אין ערך בשימוש עד אימות.', '{}'::text[], 0),
  ('flour.white', ARRAY['קמח תופח', 'קמח לבן', 'קמח']::text[], ARRAY['שקדים', 'שקד', 'קוקוס', 'חומוס', 'תירס', 'אורז', 'כוסמת', 'טפיוקה', 'קינואה', 'חרובים', 'סויה']::text[], false, 50, 'system', 'accepted', 'כוס מכופלת בכף, בלי לדחוס', '{"measure.TABLE":50,"engine.CUP_DRY":50,"parser.DRY":50}'::jsonb, false, '', '{}'::text[], 1),
  ('starch.corn', ARRAY['קורנפלור', 'קורן פלור', 'עמילן']::text[], '{}'::text[], false, 50, 'system', 'accepted-single-source', '', '{"measure.TABLE":50}'::jsonb, true, 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.', '{}'::text[], 2),
  ('sugar.powdered', ARRAY['אבקת סוכר']::text[], '{}'::text[], false, 46, 'system', 'accepted', '', '{"measure.TABLE":46,"engine.CUP_DRY":45.83,"parser.DRY":45.83}'::jsonb, false, '', '{}'::text[], 3),
  ('cocoa', ARRAY['קקאו']::text[], '{}'::text[], false, NULL, 'system', 'pending-verification', '', '{"measure.TABLE":42,"engine.CUP_DRY":45.83,"parser.DRY":45.83}'::jsonb, true, 'measure.TABLE נותן 42. engine.CUP_DRY ו-parser.DRY נתנו 110 גר'' לכוס (=45.8) כי קיבצו קקאו יחד עם אבקת סוכר. פער 9.1%. אין ערך בשימוש עד אימות.', '{}'::text[], 4),
  ('sugar.brown', ARRAY['סוכר חום', 'דמררה', 'מוסקובדו']::text[], '{}'::text[], false, 79, 'system', 'accepted', 'נמדד דחוס קלות', '{"measure.TABLE":79,"engine.CUP_DRY":79.17,"parser.DRY":79.17}'::jsonb, false, '', '{}'::text[], 5),
  ('sugar.granulated', ARRAY['אבקת סוכר וניל', 'סוכר']::text[], '{}'::text[], false, 83, 'system', 'accepted', '', '{"measure.TABLE":83,"engine.CUP_DRY":83.33,"parser.DRY":83.33}'::jsonb, false, '', '{}'::text[], 6),
  ('butter', ARRAY['חמאה', 'מרגרינה']::text[], '{}'::text[], false, 95, 'system', 'accepted', 'רכה, נדחסת לכלי', '{"measure.TABLE":95,"engine.CUP_DRY":94.58,"parser.DRY":94.58}'::jsonb, false, '', '{}'::text[], 7),
  ('water', ARRAY['מים']::text[], '{}'::text[], true, 100, 'system', 'accepted', '', '{"measure.TABLE":100,"engine.DENS":100}'::jsonb, false, '', '{}'::text[], 8),
  ('milk', ARRAY['חלב']::text[], ARRAY['אבקת חלב']::text[], true, 103, 'system', 'accepted', '', '{"measure.TABLE":103,"engine.DENS":103}'::jsonb, false, '', '{}'::text[], 9),
  ('cream', ARRAY['שמנת', 'קרם פרש', 'מסקרפונה']::text[], '{}'::text[], false, 99, 'system', 'accepted', '', '{"measure.TABLE":99,"engine.DENS":99}'::jsonb, false, '', '{}'::text[], 10),
  ('yogurt', ARRAY['יוגורט', 'לבנה', 'שמנת חמוצה']::text[], '{}'::text[], false, 104, 'system', 'accepted-single-source', '', '{"measure.TABLE":104}'::jsonb, true, 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.', '{}'::text[], 11),
  ('oil', ARRAY['שמן', 'קנולה', 'זית', 'חמניות']::text[], '{}'::text[], false, 92, 'system', 'accepted', '', '{"measure.TABLE":92,"engine.DENS":92}'::jsonb, false, '', '{}'::text[], 12),
  ('syrup.invert', ARRAY['דבש', 'סילאן', 'גלוקוז', 'מייפל', 'אינוורט']::text[], '{}'::text[], false, 142, 'system', 'accepted', '', '{"measure.TABLE":142,"engine.DENS":142}'::jsonb, false, '', '{}'::text[], 13),
  ('syrup.thick', ARRAY['סירופ', 'מולסה']::text[], '{}'::text[], false, 133, 'system', 'accepted-single-source', '', '{"engine.DENS":133}'::jsonb, true, 'קיים רק ב-engine.DENS (1.33). אין שורה מקבילה ב-measure.TABLE ולכן אין מקור שני לאימות.', '{}'::text[], 14),
  ('salt', ARRAY['מלח']::text[], '{}'::text[], false, 121, 'system', 'accepted', 'מלח שולחן דק', '{"measure.TABLE":121,"engine.CUP_DRY":120.83,"parser.DRY":120.83}'::jsonb, false, '', '{}'::text[], 15),
  ('leaven.chemical', ARRAY['אבקת אפייה', 'סודה לשתייה']::text[], '{}'::text[], false, 92, 'system', 'accepted-single-source', '', '{"measure.TABLE":92}'::jsonb, true, 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.', '{}'::text[], 16),
  ('yeast.dry', ARRAY['שמרים יבשים', 'שמרים אינסטנט']::text[], '{}'::text[], false, 62, 'system', 'accepted-single-source', '', '{"measure.TABLE":62}'::jsonb, true, 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.', '{}'::text[], 17),
  ('chocolate', ARRAY['שוקולד', 'צ''יפס שוקולד']::text[], '{}'::text[], false, 71, 'estimate', 'accepted', 'תלוי בגודל הפיסות', '{"measure.TABLE":71,"engine.CUP_DRY":70.83}'::jsonb, false, '', '{}'::text[], 18),
  ('nuts.ground', ARRAY['אבקת שקדים', 'שקדים טחונים', 'שקד טחון', 'אגוזים טחונים', 'אגוז טחון', 'פיסטוק טחון', 'אבקת פיסטוק', 'אבקת אגוזים', 'קמח שקדים']::text[], '{}'::text[], false, NULL, 'estimate', 'pending-form', '', '{"measure.TABLE":42}'::jsonb, true, 'הערך 42 של measure.TABLE מתאים לצורה הטחונה, אבל הוא נמדד לשורה מקובצת ולא לצורה הזו במפורש. דרוש נתון מאומת לאגוז טחון.', ARRAY['nuts.ground', 'nuts.chopped', 'nuts.whole']::text[], 19),
  ('nuts.chopped', ARRAY['שקדים קצוצים', 'שקדים פרוסים', 'אגוזים קצוצים', 'אגוז קצוץ', 'פקאן קצוץ', 'פיסטוק קצוץ']::text[], '{}'::text[], false, NULL, 'estimate', 'pending-form', '', '{}'::jsonb, true, 'אין לצורה הזו נתון באף אחת מארבע הטבלאות. דרושה מדידה.', ARRAY['nuts.ground', 'nuts.chopped', 'nuts.whole']::text[], 20),
  ('nuts.whole', ARRAY['שקדים שלמים', 'שקד שלם', 'אגוזים שלמים', 'אגוז שלם', 'פקאן שלם']::text[], '{}'::text[], false, NULL, 'estimate', 'pending-form', '', '{"engine.CUP_DRY":66.67,"parser.DRY":66.67}'::jsonb, true, 'הערך 66.7 (=160 גר'' לכוס) מתאים לצורה השלמה, אבל engine.CUP_DRY קיבץ אגוזים יחד עם אורז באותה שורה ולכן הוא לא נמדד לצורה הזו במפורש. דרוש נתון מאומת.', ARRAY['nuts.ground', 'nuts.chopped', 'nuts.whole']::text[], 21),
  ('nuts.unspecified', ARRAY['שקד', 'אגוז', 'פקאן', 'פיסטוק', 'קשיו', 'לוז', 'מקדמיה']::text[], '{}'::text[], false, NULL, 'estimate', 'pending-form', '', '{"measure.TABLE":42,"engine.CUP_DRY":66.67,"parser.DRY":66.67}'::jsonb, true, 'שם בלי צורה. אגוז שלם, קצוץ וטחון נמדדים אחרת — פער של פי 1.6 בין שני המקורות הישנים. לא מוצג ערך אחד לצורה לא ידועה.', ARRAY['nuts.ground', 'nuts.chopped', 'nuts.whole']::text[], 22),
  ('oats', ARRAY['שיבולת שועל', 'קוואקר']::text[], '{}'::text[], false, 38, 'estimate', 'accepted', '', '{"measure.TABLE":38,"engine.CUP_DRY":37.5}'::jsonb, false, '', '{}'::text[], 23),
  ('rice', ARRAY['אורז']::text[], '{}'::text[], false, NULL, 'system', 'pending-verification', '', '{"measure.TABLE":77,"engine.CUP_DRY":66.67,"parser.DRY":66.67}'::jsonb, true, 'measure.TABLE נותן 77. engine.CUP_DRY ו-parser.DRY נתנו 160 גר'' לכוס (=66.7) כי קיבצו אורז יחד עם אגוזים. פער 13.4%. אין ערך בשימוש עד אימות.', '{}'::text[], 24),
  ('juice', ARRAY['מיץ', 'פולפה', 'פירה']::text[], '{}'::text[], false, 105, 'system', 'accepted', '', '{"measure.TABLE":105,"engine.DENS":105}'::jsonb, false, '', '{}'::text[], 25),
  ('alcohol.wine', ARRAY['יין']::text[], '{}'::text[], false, 98, 'system', 'accepted-single-source', '', '{"measure.TABLE":98}'::jsonb, true, 'רק measure.TABLE מכסה יין, ובתוך שורה מקובצת יחד עם משקאות חריפים. ל-engine.DENS אין שורה ליין. אין סתירה, אבל גם אין מקור שני.', '{}'::text[], 26),
  ('alcohol.spirit', ARRAY['רום', 'ברנדי', 'וודקה']::text[], '{}'::text[], false, NULL, 'system', 'pending-verification', '', '{"measure.TABLE":98,"engine.DENS":94}'::jsonb, true, 'measure.TABLE נותן 98 (בשורה מקובצת עם יין), engine.DENS נותן 0.94 (=94). פער 4.1%. פיזיקלית 0.94 מתאים ל-40% אלכוהול ו-0.98 ליין — שתיהן נכונות לחומר גלם אחר. אין ערך בשימוש עד אימות.', '{}'::text[], 27),
  ('alcohol.liqueur', ARRAY['ליקר']::text[], '{}'::text[], false, NULL, 'system', 'pending-verification', '', '{"measure.TABLE":98,"engine.DENS":94}'::jsonb, true, 'שתי הטבלאות קיבצו ליקר יחד עם משקאות חריפים, ואף אחת לא מדדה ליקר בנפרד. צפיפות ליקר משתנה מאוד עם תכולת הסוכר. אין ערך בשימוש עד אימות.', '{}'::text[], 28),
  ('coffee.liquid', ARRAY['אספרסו', 'קפה נוזלי']::text[], '{}'::text[], false, 100, 'system', 'accepted-single-source', '', '{"measure.TABLE":100}'::jsonb, true, 'מקור אחד בלבד (measure.TABLE). אין מקור שני לאימות.', '{}'::text[], 29),
  ('coffee.ground', ARRAY['קפה טחון', 'קפה']::text[], '{}'::text[], false, 42, 'estimate', 'accepted-single-source', 'תלוי בדרגת הטחינה', '{"measure.TABLE":42}'::jsonb, true, 'מקור אחד בלבד, ומסומן כהערכה כי הצפיפות משתנה מאוד עם דרגת הטחינה.', '{}'::text[], 30),
  ('egg.yolk', ARRAY['חלמון']::text[], '{}'::text[], false, NULL, 'system', 'pending-form', '', '{"engine.DENS":103}'::jsonb, true, 'engine.DENS נתן 1.03 לחלמון, לחלבון, לביצה שלמה ולחלב — אותו ערך לארבעה דברים שונים. דרוש נתון מאומת לחלמון.', ARRAY['egg.whole', 'egg.white', 'egg.yolk']::text[], 31),
  ('egg.white', ARRAY['חלבון ביצה', 'חלבון']::text[], ARRAY['קמח', 'אבקת חלבון']::text[], false, NULL, 'system', 'pending-form', '', '{"engine.DENS":103}'::jsonb, true, 'engine.DENS נתן 1.03 גם לחלבון. דרוש נתון מאומת לחלבון ביצה.', ARRAY['egg.whole', 'egg.white', 'egg.yolk']::text[], 32),
  ('egg.whole', ARRAY['ביצה', 'ביצים', 'מלנג''']::text[], ARRAY['קמח']::text[], false, NULL, 'system', 'pending-form', '', '{"engine.DENS":103}'::jsonb, true, 'engine.DENS נתן 1.03 לביצה שלמה, בשורה מקובצת עם חלב, חלמון וחלבון. דרוש נתון מאומת לביצה שלמה. שימו לב: ביצים במתכונים נמדדות כמעט תמיד ביחידות עם משקל ליחידה, ולכן שורה זו כמעט אינה בשימוש.', ARRAY['egg.whole', 'egg.white', 'egg.yolk']::text[], 33)
on conflict (key) do update set
  match_terms   = excluded.match_terms,
  exclude_terms = excluded.exclude_terms,
  word_match    = excluded.word_match,
  g_per_100     = excluded.g_per_100,
  confidence    = excluded.confidence,
  resolution    = excluded.resolution,
  note          = excluded.note,
  sources       = excluded.sources,
  needs_review  = excluded.needs_review,
  review_note   = excluded.review_note,
  forms         = excluded.forms,
  ord           = excluded.ord;

insert into public.density_data_gaps (name)
values
  ('קמח קוקוס'),
  ('קמח חומוס'),
  ('קמח תירס'),
  ('קמח אורז'),
  ('קמח כוסמת'),
  ('קמח טפיוקה'),
  ('קמח קינואה'),
  ('קמח חרובים'),
  ('קמח סויה'),
  ('אבקת חלב'),
  ('אבקת חלבון')
on conflict (name) do nothing;
