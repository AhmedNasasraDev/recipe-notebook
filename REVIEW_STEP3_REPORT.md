# דוח שלב 3 — חיבור Supabase אמיתי: Auth, Database, RLS

פרויקט: **Recipe Notebook** · `qxdpsomelzpvphkhkqrw` · אזור `eu-central-1` ·
ארגון `irainiamjxzwcvqxxwfn` · תוכנית חינמית ($0/חודש)
URL: `https://qxdpsomelzpvphkhkqrw.supabase.co`

קומיט: `5c7c627` על `claude/recipe-notebook-initial-review-fwfb2e`

---

## 0. מה קרה לפני שלב 3 — השבתת הפרויקט שאישרת

לפי האישור שלך הושבת **רק** `tbkcxrpenmpcwjicnxnd` (WhatsApp AI Assistant).

| פרויקט | ref | מצב עכשיו |
|---|---|---|
| Presenzo Production | `fglnzrpuffswapjsnppg` | `ACTIVE_HEALTHY` — **לא נגעתי בו בשום צורה** |
| WhatsApp AI Assistant | `tbkcxrpenmpcwjicnxnd` | `INACTIVE` — מושבת, **לא נמחק**, הנתונים והמבנה לא שונו |
| Recipe Notebook | `qxdpsomelzpvphkhkqrw` | `ACTIVE_HEALTHY` — חדש |
| Presenzo Platform | `ddbedqgfasvpzuaghuzm` | `INACTIVE` — כפי שהיה |
| Aureal Coffee Roasters | `mqmzotmogsvmlfooidpn` | `INACTIVE` — כפי שהיה |

WhatsApp AI Assistant נשאר בחשבון במצב מושבת וניתן לשחזר אותו (`restore_project`)
כשתרצה.

---

## 1. מה נבנה

### חיבור Supabase אמיתי

האפליקציה מדברת עם פרויקט חי. לא placeholder, לא סימולציה. מה שמצא את עצמו
נכון: **התפר שנבנה בשלב 2 החזיק** — אף קומפוננטת מסך לא שונתה כדי להתאים
ל-Supabase, והבחירה איזה repository פעיל היא שלוש שורות ב-`AppDataProvider`:

```ts
if (repository) return repository;                                  // בטסטים
if (client && userId) return createSupabaseRepository({ client, userId });
return createLocalDemoRepository();                                 // בלי .env.local
```

### Authentication (HANDOFF §2)

`AuthProvider` מחזיק את הסשן, ואף קוד אחר באפליקציה לא ניגש ל-`supabase.auth`.
יש לו **ארבעה** מצבים ולא שלושה, וההבדל חשוב:

| מצב | מה קורה |
|---|---|
| `loading` | הסשן השמור עוד משוחזר. בלי המצב הזה מסך ההתחברות היה מהבהב למשתמש מחובר בכל רענון |
| `unconfigured` | אין `.env.local` בהתקנה הזאת. האפליקציה רצה על מתכוני הדמו לקריאה בלבד ואומרת זאת |
| `signed-out` | מוגדר, אף אחד לא מחובר → מסך התחברות |
| `signed-in` | מוגדר, יש סשן → האפליקציה |

מה שמומש: הרשמה, התחברות, התנתקות, שחזור סשן אחרי רענון, ותגובה להתנתקות
שקרתה בטאב אחר. הודעות השגיאה של Supabase מתורגמות לעברית, והודעה שלא מופיעה
ברשימה מועברת כמו שהיא ולא נבלעת.

שני דברים שהמסך הזה מסרב לעשות:

1. **לא מצהיר שהחשבון מוכן** כשהפרויקט דורש אישור אימייל. Supabase מסמן את זה
   בכך שהוא מחזיר user בלי session, וזה בדיוק מה שהמסך מדווח. (אם תשנה את
   ההגדרה בפרויקט — הקוד מטפל בשני המקרים, בלי שינוי.)
2. **לא בולע שגיאה.** כל כשל מוצג.

**התנתקות מוחקת את ההעתק המקומי לפני שהיא מסיימת את הסשן.** ההעתק ב-IndexedDB
הוא עותק גלוי של מחברת אחת — על טאבלט מטבח, למשל, שמשותף לכמה אנשים. אם הוא
היה נשאר, המשתמש הבא היה יכול לקרוא את המחברת הקודמת מהמטמון עוד לפני התשובה
הראשונה מהשרת. הסדר מכוון: אם המחיקה נכשלת, המשתמש נשאר מחובר עם מטמון שלם,
ולא מנותק עם מתכונים של מישהו אחר על המכשיר.

### פרופיל, העדפות ו-Onboarding (דרישה 3)

ה-Onboarding הפסיק להיות דמו. `profiles.onboarding_done` הוא ה-`prefs.done`
של הלקוח; טריגר `on_auth_user_created` יוצר שורת פרופיל לכל חשבון חדש, כך שאף
מסך לא צריך לטפל ב"אין פרופיל".

נשמרים בשרת: סוג הפרופיל (`home`/`pro`/`study`), `locale`, רשימת היחידות,
הדגל `touched_units`, **וגדלי כלי המדידה** (`tools` — כוס/כף/כפית). יש טסט
שמוכיח שכוס 250 מ"ל מגיעה מהשרת עד לדף המתכון: 2 כוסות קמח קוראות `250 גר'`
ולא `240 גר'` — זה B1 מקצה לקצה.

### מתכונים (דרישה 4)

`SupabaseRepository` מאחורי אותו `Repository` interface. create, read, update.
`RECIPE_SELECT` שולף מתכון שלם בסבב אחד (כולל ingredients / steps / issues /
trials / batches / recipe_versions). שורות הבן מוחלפות במלואן בשמירה — רשימת
רכיבים היא קצרה ומסודרת, ו-diff עליה היה מוסיף סיכון בלי להוסיף מהירות.

`mappers.ts` הוא המקום היחיד שמכיר את שני הצדדים, והוא שומר על שני כללים:

- **`null` אינו `0`.** `yield_actual IS NULL` פירושו "השתמש בתשואה התאורטית"
  (§1.1, §18.11); אפס פירושו אפס שנמדד. אותו דבר ל-`water_pct` (NULL = לפי
  הטבלה המשותפת; 0 = שמן, שאין בו מים). איחוד של השניים היה משנה בשקט כל
  מספר תשואה, הידרציה ועלות באפליקציה.
- **שום דבר לא מומצא** בשני הכיוונים. עמודה בלי ערך מגיעה כ-`undefined`
  והמנוע מחליט מה זה אומר.

**הבעלים נלקח תמיד מה-repository ולא מה-payload.** אין מסלול קוד שבו לקוח
בוחר את `owner_id`.

### פרטיות (דרישה 5) — ראה סעיף 5

### נתוני דמו (דרישה 6)

חשבון חדש מקבל **מחברת ריקה**. מתכוני הדמו לא מוצגים לחשבון מחובר בכלל, ובמצב
`unconfigured` הם מסומנים במפורש בבאנר של ה-shell ("מוצגים מתכוני הדמו לקריאה
בלבד"). יש שלושה טסטים על זה, כולל אחד שמוודא שמתכון של חשבון אחר לא מופיע
גם כשהוא באותו store.

### Offline (דרישה 7)

בלי sync ובלי conflict resolution חדשים, כפי שביקשת. IndexedDB נשאר מטמון:
Supabase הוא מקור האמת. קריאה שנכשלת נופלת להעתק המקומי ו-`servingFromCache`
נדלק, וה-shell אומר "מוצג מהעתק שנשמר על המכשיר... אי אפשר לשמור שינויים".
כתיבה בלי רשת **מסורבת** (`WriteNotAllowedError`) ולא נתקעת בתור.

### מצב חישוב חלקי (דרישה 8)

זה החלק שהכי שווה להסתכל עליו. המנוע כבר מסרב להמציא צפיפות — שורה שהוא לא
יכול לשקול חוזרת עם `g === null` ונכנסת ל-`Computed.unresolved`. אבל **כל סכום
בדף המתכון הוא סכום על השורות שכן נשקלו, וסכום על חלק מהשורות נראה בדיוק כמו
סכום על כולן.**

`calcState()` מסווג לשלושה מצבים, והמסך מציג כל אחד אחרת:

| מצב | מה מוצג |
|---|---|
| `full` | שום הודעה. אין מה לגלות |
| `partial` | הודעה בראש הדף: "נתונים חלקיים — חסרים נתונים עבור X רכיבים. סך המשקל, העלות והמחיר מחושבים מ-Y בלבד ואינם מלאים", עם שמות הרכיבים החסרים; ותג **"חלקי"** ליד כל מספר שהוא סכום על השורות |
| `none` | "לא ניתן לחשב" + **מקף במקום מספר** בכל שדה שנגזר ממשקל או מעלות |

המקף הוא העיקר במצב `none`: עלות כוללת של ₪0.00 נקראת "המתכון הזה בחינם", וזו
בדיוק התקלה שהדרישה נועדה למנוע.

שני שדות **לא** מסומנים כחלקיים, כי הם קלט ולא סכום: "יעד פוד קוסט"
ו-"טמפ' מים מחושבת".

**לא הומצאה שום צפיפות ולא נוסף שום fallback.** הדרך לצאת מ-`partial` היא כיול
אישי או ערך מאומת, ויש טסט שמוכיח שכיול אישי סוגר את הפער.

---

## 2. אילו קבצים נוגעו

45 קבצים, ‎+4747 / ‎-165.

### חדשים — Auth
- `apps/web/src/auth/AuthProvider.tsx` — הסשן, ארבעת המצבים, תרגום השגיאות
- `apps/web/src/auth/AuthGate.tsx` + `.module.css` — מה מוצג לפני שהסשן ידוע
- `apps/web/src/routes/AuthScreen.tsx` + `.module.css` — הרשמה/התחברות
- `apps/web/src/routes/MoreScreen.tsx` + `.module.css` — בלוק החשבון + התנתקות

### חדשים — נתונים
- `apps/web/src/data/supabaseRepository.ts` — המימוש מול Supabase
- `apps/web/src/data/mappers.ts` — row ↔ domain, המקום היחיד שמכיר את שני הצדדים

### חדשים — חישוב חלקי
- `apps/web/src/features/recipe/completeness.ts` — `calcState()`

### חדשים — תשתית טסטים
- `apps/web/src/test/fakeSupabase.ts` — כפיל in-memory **שמדמה את ה-policies עצמן**
- `apps/web/src/test/fakeAuth.ts` — כפיל ל-`supabase.auth`
- `apps/web/src/test/memoryIdb.ts` — idb-keyval בזיכרון (ל-jsdom אין IndexedDB)

### חדשים — טסטים
`AuthProvider.test.tsx` (21) · `supabaseRepository.test.ts` (27) ·
`mappers.test.ts` (24) · `completeness.test.ts` (11) · `AppSession.test.tsx` (10)

### חדשים — Supabase
- `supabase/migrations/0006_revoke_execute_on_trigger_functions.sql`
- `supabase/tests/rls-isolation.sql` — הוכחת הבידוד
- `supabase/schema.snapshot.json` — הסכימה שנקראה חזרה מהמסד
- `supabase/scripts/check-types-against-schema.mjs` — `npm run schema:check`

### שונו
`App.tsx` (שלוש שכבות מסביב לראוטר) · `app/AppDataProvider.tsx` (בחירת
repository + `describeBackend`) · `data/offlineMirror.ts` (`clearMirror`) ·
`data/repository.ts` + `data/localDemoRepository.ts` (הערות שהתיישנו) ·
`lib/supabase.ts` (חיזוק המגן על המפתח) · `lib/database.types.ts` (interface →
type — ראה סעיף 8) · `routes/RecipeScreen.tsx` + `features/recipe/recipe.module.css`
(דרישה 8) · `shell/AppShell.tsx` (מתי מוצג הבאנר) · `lib/supabase.test.ts`
(env מקובע) · `vite.config.ts` · `package.json` · `.gitignore` ·
`apps/web/.env.example` · `supabase/README.md` · 5 קבצי מיגרציה + הגנרטור

### לא נוגע
`design_handoff_recipe_notebook/` — **0 שינויים**, `git status` ריק עליו.
`packages/engine/src/**` — לא שונה בכלל בשלב הזה.

`apps/web/.env.local` **לא נדחף** (ב-`.gitignore`, אומת עם `git check-ignore`
ועם בדיקה שהוא לא ב-staging).

---

## 3. אילו מיגרציות הורצו

כולן הורצו בפועל על `qxdpsomelzpvphkhkqrw`. פלט `list_migrations`:

| version | name |
|---|---|
| `20260916025842` | `profiles_and_calibrations` |
| `20260916025923` | `recipes_and_children` |
| `20260916025958` | `versions_private_notes_catalog` |
| `20260916030018` | `density_table` |
| `20260916030224` | `density_seed` |
| `20260916030429` | `revoke_execute_on_trigger_functions` |

**13 טבלאות, 136 עמודות.** RLS מופעל על כל טבלה שמחזיקה נתוני משתמש.

`get_advisors(security)` מחזיר **רשימה ריקה**.

### אימות הזריעה, לא אמון בה

נתוני צפיפות הם נתונים מקצועיים שהתמחור נשען עליהם, ולכן לא הסתפקתי ב-
`{"success":true}`. חישבתי טביעת אצבע (SHA-256) של 34 השורות **מתוך המסד** —
כולל כל ה-`sources`, ה-`review_note`, ה-`match_terms` וה-nullים — וטביעת אצבע
מקבילה מ-`DENSITY_TABLE` במנוע:

```
מהמנוע: af400157376420b307404ab0da38715ce04386e31d63563d2a49353b61624735
מהמסד:  af400157376420b307404ab0da38715ce04386e31d63563d2a49353b61624735
```

זהות. אין טעות העתקה. 34 שורות, 11 פערי נתונים ידועים, ו-12 השורות שאין להן
ערך נשארו בלי ערך (`g_per_100 IS NULL`) — כפי שאישרת.

---

## 4. תוצאות הבדיקות

הכול הורץ בפועל, הרגע, על הקוד שנדחף.

| מה | תוצאה |
|---|---|
| `npm test` — engine | **180 / 180** עוברים (7 קבצים) |
| `npm test` — web | **174 / 174** עוברים (13 קבצים) |
| **סה"כ** | **354 / 354** |
| `npm run typecheck` | נקי, שני ה-workspaces, strict + `noUncheckedIndexedAccess` |
| `npm run build` | נקי — ‎475.36 kB, gzip ‎141.97 kB |
| `npm run seed:check` | `0005_density_seed.sql is up to date (34 rows)` |
| `npm run schema:check` | `matches the applied schema: 13 tables, 136 columns` |
| `rls-isolation.sql` | **27 / 27** עוברים, 0 שורות fixture נשארו |
| `get_advisors(security)` | ריק |
| הפרוטוטייפ המקורי | 0 שינויים |

180 הטסטים של שלב 1 עוברים כפי שהיו. מ-67 טסטי web בשלב 2 הגענו ל-174.

### בדיקת דליפת מפתחות ב-bundle

חיפשתי ב-JS שנבנה: אין `sb_secret_`, אין service_role JWT, אין
`api.anthropic.com`, אין `sk-ant`. שני ההיטים על המילים האלה הם **המחרוזות של
קוד ההגנה עצמו** (`e.startsWith("sb_secret_")` וההודעה בעברית שמסבירה למה
מפתח כזה לא בשימוש). המפתח היחיד ב-bundle הוא ה-publishable, וזה בכוונה.

### 11 תחומי הבדיקה שדרשת

| # | מה | איפה |
|---|---|---|
| 1 | Sign Up / In / Out | `AuthProvider.test.tsx` — כולל שני מצבי אישור-אימייל |
| 2 | שחזור סשן | `AuthProvider.test.tsx` — כולל שחזור שנכשל וכולל התנתקות מטאב אחר |
| 3 | שמירת Onboarding | `supabaseRepository.test.ts` + `AppSession.test.tsx` (remount = רענון) |
| 4 | שמירת העדפות | `supabaseRepository.test.ts` — profile, units, touched_units |
| 5 | שמירת כלי מדידה | `supabaseRepository.test.ts` + `AppSession.test.tsx` (250 מ"ל עד המסך) |
| 6 | CRUD מתכונים | `supabaseRepository.test.ts` — create, read, update, החלפת שורות בן |
| 7 | התמדה אחרי רענון | `AppSession.test.tsx` — unmount + render מחדש |
| 8 | בידוד RLS בין שני משתמשים | `rls-isolation.sql` (מול המסד החי) + `supabaseRepository.test.ts` + `AppSession.test.tsx` |
| 9 | בידוד `private_notes` | `rls-isolation.sql` — קריאה בשני הכיוונים + UPDATE חוצה-חשבון |
| 10 | בידוד `calibrations` | `rls-isolation.sql` + `supabaseRepository.test.ts` (128 גר' מול 141 גר') |
| 11 | תצוגת חישוב חלקי | `completeness.test.ts` (11) + `RecipeScreen.test.tsx` (8 חדשים) |

---

## 5. הוכחה ש-RLS מבודד שני משתמשים

ביקשת במפורש: *"אל תסתפק בבדיקת UI. בדוק זאת מול RLS בפועל."* צדקת שזה נדרש.
מסך שמציג את השורות הנכונות מוכיח שהשאילתה כללה את הפילטר הנכון. הוא לא מוכיח
כלום על מה שקורה **כשמסירים את הפילטר** — וזה הדבר הראשון שתוקף עושה.

`supabase/tests/rls-isolation.sql` מסיר את הפילטר ושואל את המסד.

### איך הקשר הביטחוני שוחזר

PostgREST מטפל בבקשה של משתמש מחובר בשתי פעולות בדיוק: הוא עובר לתפקיד
`authenticated`, ושם את תוכן ה-JWT ב-GUC בשם `request.jwt.claims`.
`auth.uid()` קורא את `sub` משם. הסקריפט קובע את אותו תפקיד ואת אותו claim, ולכן
כל policy מוערך מול אותם קלטים בדיוק כמו בבקשה אמיתית. **זה מסלול האכיפה, לא
סימולציה שלו.**

השורה `set local role authenticated` היא הקריטית: `postgres` הוא הבעלים של
הטבלאות ולכן **עוקף RLS לחלוטין**. גרסה של הסקריפט בלי השורה הזאת הייתה
מדווחת על בידוד מושלם בזמן שהיא לא בודקת שום דבר.

### מה נבדק — 27 בדיקות, כולן עברו

**קריאות של א', ללא פילטר בכלל או עם פילטר לכיוון ב':**

| טבלה | מה נבדק | צפוי | קיבלנו |
|---|---|---|---|
| `recipes` | `select count(*)` בלי פילטר | 1 (רק של א') | 1 ✓ |
| `recipes` | `where owner_id = <ב'>` | 0 | 0 ✓ |
| `ingredients` | בלי פילטר | 1 | 1 ✓ |
| `private_notes` | בלי פילטר | 1 | 1 ✓ |
| `calibrations` | בלי פילטר | 1 | 1 ✓ |
| `profiles` | בלי פילטר | 1 | 1 ✓ |
| `profiles` | גדלי כלי המדידה של ב' | `(none)` | `(none)` ✓ |
| `density_table` | נתוני עזר משותפים | 34 | 34 ✓ |

**כתיבות חוצות-חשבון של א':**

| פעולה | צפוי | קיבלנו |
|---|---|---|
| `update recipes` של ב' | 0 שורות | 0 ✓ |
| `delete recipes` של ב' | 0 שורות | 0 ✓ |
| `update private_notes` של ב' | 0 שורות | 0 ✓ |
| `update calibrations` של ב' | 0 שורות | 0 ✓ |
| `update profiles` של ב' | 0 שורות | 0 ✓ |
| `insert` מתכון בבעלות ב' | נדחה (42501) | נדחה ✓ |
| `update density_table` (ערך מקצועי) | נדחה | נדחה ✓ |

**א' עדיין רואה את עצמו** — בידוד שחוסם גם את הבעלים הוא לא בידוד אלא תקלה:
מתכון ✓, הערה פרטית ✓, כיול ✓.

**הכיוון ההפוך**, כדי שהתוצאה לא תהיה תוצר של מי היה ראשון: ב' לא רואה שום
דבר של א' ✓, רואה רק את ההערה שלו ✓, רק את הכיול שלו ✓, ורואה את המתכון שלו ✓.

**קורא אנונימי** (בקשה בלי JWT): 0 מתכונים ✓, 0 הערות ✓, 0 כיולים ✓,
0 שורות צפיפות ✓.

**ניקוי:** שני חשבונות ה-fixture נמחקו, וההצהרה האחרונה בסקריפט היא שספירת
השורות שנשארו בכל הטבלאות היא 0. עברה. אימות נוסף לאחר מכן: המסד מכיל
0 users, 0 profiles, 0 recipes, 0 ingredients, 0 private_notes, 0 calibrations,
34 שורות צפיפות, ו-0 שורות שערך הצפיפות שלהן שונה.

### מגבלה שאני מציין במפורש

**הבדיקה רצה מעל SQL ולא מעל HTTP.** מדיניות ה-egress של הסביבה הזאת חוסמת
`*.supabase.co` (`CONNECT tunnel failed, 403`), ולכן לא יכולתי להריץ את הבקשות
דרך REST API עם JWT אמיתי מכאן. הגבול שנבדק הוא אותו גבול בשני המקרים — RLS
נאכף ב-Postgres, לא ב-PostgREST — אבל זה הפרש שכדאי שתדע עליו. אם תרצה, אפשר
להריץ את אותו סקריפט מתוך ה-SQL Editor בדשבורד, או להוסיף בדיקת HTTP אמיתית
מסביבה בלי החסימה.

---

## 6. מה עדיין Mock או Local בלבד

1. **אין UI ליצירת מתכון או לעריכתו.** `SupabaseRepository` תומך ב-create
   וב-update ויש לזה טסטים, אבל אין מסך עורך — שלב 2 לא בנה אחד, ובניית עורך
   מלא היא הרחבת scope שלא אישרת. לכן חשבון חדש רואה "המחברת ריקה." בלי דרך
   להוסיף מתכון מהמסך. **זה הפער הבולט ביותר בשלב הזה** וזה הדבר הראשון
   שכדאי לסגור.
2. **`private_notes` — טבלה, RLS וטסטי בידוד קיימים; אין UI.** §8 דורש מסך
   הערות פרטיות. לא נבנה.
3. **`recipe_versions` — טבלה + RLS + קריאה במאפר; אין UI ואין restore.** §9.
4. **`ingredient_catalog` — טבלה + RLS; לא בשימוש.** עדכון מחיר מרוכז (§13).
5. **`trials`, `batches` — טבלאות + RLS + קריאה במאפר; אין UI.** §13a HACCP.
6. **המסכים "בית" ו-"קבוצות"** — עדיין `NotImplementedScreen` כפי שהיה.
7. **כיול אישי — המנוע מלא, השמירה עובדת, אין מסך.** כפתור "לכייל את הרכיב
   הזה אצלי במטבח" בגיליון ההמרה סוגר כרגע את הגיליון בלבד. דרישה 8 מפנה
   לכיול כדרך לצאת מ-`partial`, ולכן גם זה שווה קדימות.
8. **תבניות האימייל וכתובת ה-redirect** בפרויקט — ברירות המחדל של Supabase,
   לא נגעתי. הקוד מטפל בשני מצבי "אישור אימייל".
9. **Storage, AI proxy, Cook Mode, קבוצות, קורסים, שיתוף** — לא התחלתי, כפי
   שהנחית.

---

## 7. מה נשאר לשלב 4

לפי סדר עדיפות מקצועי, לא לפי סדר המפרט:

1. **עורך מתכון.** בלי זה המערכת לא שמישה: אפשר להתחבר ולא אפשר להוסיף כלום.
   ה-repository מוכן; חסר המסך.
2. **מסך כיול אישי.** זה גם פיצ'ר וגם התיקון לפערי הצפיפות — כיול אחד הופך
   `partial` ל-`full` בלי לגעת בטבלה.
3. **הערות פרטיות (§8)** — הטבלה וה-RLS הכי חשובים כבר עומדים.
4. **גרסאות ושחזור (§9)**, כולל הכלל ב-§18.7 שאוסר שחזור בזמן `locked`.
5. **אימות 5 ערכי הצפיפות שבהמתנה** — קקאו, אורז, קמח מלא, spirit, liqueur —
   ו-7 השורות שממתינות לפי צורה, מול מקורות מקצועיים. זה לא קוד, זו החלטה
   מקצועית שרק אתה יכול לקבל.
6. **Storage לתמונות (§5)** עם bucket פרטי ו-`taken_at` שנקבע בשרת (§13a).
7. **פרוקסי לפירוק מתכונים (§6)** — edge function עם rate limit לכל משתמש.
8. **קבוצות וקורסים (§4, §12)** — הכי גדול, והכי דורש `save-copy` בשרת.
9. **ערבית (§15)** — `profiles.locale` כבר קיים ומוגבל ל-`he`/`ar`.

---

## 8. כל ההחלטות והחריגות

### חריגות מהמפרט — מהסכימה

היו כבר בשלב 2 ומתועדות ב-`supabase/README.md`; מסוכמות כאן כי הן הורצו עכשיו:

1. **`users` → `auth.users`.** המפרט מגדיר `users(id, email, created_at, locale)`.
   Supabase כבר מחזיק את הטבלה הזאת ואסור לאפליקציה להסתיר אותה, ולכן
   `auth.users` ממלא את התפקיד ו-`locale` עבר ל-`profiles`.
2. **מפתחות זרים נדחים.** `recipes.group_id`, `recipes.saved_from_item_id`,
   `private_notes.group_item_id` — עמודות `uuid` nullable בלי האילוץ, כי טבלת
   המטרה לא קיימת. מיגרציית הקבוצות תוסיף את האילוצים.
3. **טמפרטורות ב-`batches`:** `core_temp`/`chill_temp` ולא `tempIn`/`tempOut`,
   כי `haccpOf()` תלוי בידיעה איזו טמפרטורה הוא קורא.
4. **`density_table` גדלה בשלוש עמודות** (`resolution`, `sources`,
   `needs_review`) ו-`g_per_100` nullable — 12 מ-34 השורות בכוונה בלי ערך.
5. **אין עמודת `status` ב-`batches`.** §13a דורש שמצב HACCP ייגזר ולא יישמר.

### חריגות שהוספתי בזמן ההרצה

שלוש, כולן ברמת הפלטפורמה ולא ברמת הסכימה, וכולן רשומות בכותרת המיגרציה שלהן:

6. **`(select auth.uid())` בכל predicate של policy**, במקום `auth.uid()` חשוף.
   משמעות זהה לחלוטין. Postgres מרים את תת-השאילתה ל-InitPlan ומעריך אותה
   פעם אחת לשאילתה ולא פעם אחת לשורה. זה ההבדל בין מחברת מהירה ואיטית ברגע
   שלחשבון יש מאות מתכונים.
7. **`set search_path = ''` בכל פונקציה**, עם שמות טבלאות מלאים. פונקציית
   `SECURITY DEFINER` שיורשת את ה-`search_path` של הקורא יכולה להיות מופנית
   על ידו לטבלה אחרת.
8. **מיגרציה `0006` — שלילת EXECUTE.** לא תוכנן. יועץ האבטחה של Supabase דיווח
   מיד אחרי `0001`–`0005`:

   > `Function public.handle_new_user() can be executed by the anon role as a SECURITY DEFINER function via /rest/v1/rpc/handle_new_user.`

   `CREATE FUNCTION` מעניק EXECUTE ל-`PUBLIC` כברירת מחדל. זה בלתי-מזיק
   בפונקציה רגילה ולא בלתי-מזיק ב-`SECURITY DEFINER`. קריאה ישירה לפונקציית
   טריגר נכשלת ("trigger functions can only be called as triggers"), ולכן אין
   פה exploit מוכר — אבל "אין דרך פנימה" היא תכונה עדיפה בהרבה על "הדרך פנימה
   במקרה נכשלת", והמחיר הוא מיגרציה אחת. `owns_recipe` שומרת EXECUTE ל-
   `authenticated` כי ה-policies של טבלאות הבן קוראות לה בשם.

### החלטות ארכיטקטוניות

9. **`profiles.onboarding_done` = `prefs.done`.** §4 דורש שה-Onboarding ירוץ
   פעם אחת וניתן לאיפוס מההגדרות. שמירה בשרת ולא בדפדפן היא מה שמאפשר את
   "התחברות ממכשיר אחר" שדרשת.
10. **טריגר `on_auth_user_created` יוצר שורת פרופיל.** בלעדיו כל מסך היה צריך
    לטפל ב"אין פרופיל".
11. **`clearMirror()` בהתנתקות, לפני שהסשן נסגר.** נומק בסעיף 1.
12. **`AuthGate` לפני `AppDataProvider`.** בחירת ה-repository תלויה בסשן, ולכן
    הסשן חייב להיות ידוע קודם. הסדר לא ניתן להחלפה.
13. **`useOptionalAuth()`** לצד `useAuth()`. טסטי מסך משלב 2 מרנדרים
    `AppDataProvider` עם repository מוזרק ובלי auth בכלל, וזה חייב להמשיך
    לעבוד — אחרת כל טסט משלב 2 היה צריך עטיפת auth שאין לו שימוש בה.
14. **`database.types.ts` נשאר בכתיבת יד**, במקום להחליף אותו בפלט של
    `supabase gen types`. הגנרטור מרחיב כל CHECK ל-`string` וכל `jsonb`
    ל-`Json`, וזורק בדיוק את ההבחנות שהאפליקציה נשענת עליהן: `ToolId`,
    `PriceUnit`, `temp_unit 'C' | 'F'`, וארבעת מצבי ה-`resolution`. במקום
    לסמוך על זהירות הוספתי `npm run schema:check`, שמשווה את שמות העמודות
    ואת ה-nullability מול `schema.snapshot.json` שנקרא מהמסד החי. השוויתי את
    שני הצדדים — הסטים זהים.
15. **כפיל Supabase in-memory שמדמה את ה-policies.** מדיניות ה-egress חוסמת
    גישה למסד מהטסטים. במקום למוק את הקריאות בנפרד בכל טסט, `fakeSupabase.ts`
    מממש פונקציה אחת לכל טבלה שמשקפת את ה-`USING` של ה-policy שלה. זה הופך
    טסט כמו "א' לא רואה את המתכון של ב'" למשמעותי: גם אם מסירים את
    `.eq('owner_id', userId)` מה-repository, `policyFor` מסתיר את השורה — וזו
    בדיוק התכונה שיש למערכת האמיתית. הכפיל **זורק** על צורת שאילתה שהוא לא
    מכיר, כדי שטסט לא יעבור בגלל שהכפיל בשקט לא עשה כלום.
16. **גדלי הכפיל תואמים את ברירות המחדל של Postgres.** בלי `created_at` ו-
    `updated_at` על INSERT הכפיל היה מחזיר שורות שאף Postgres אמיתי לא היה
    מייצר, וטסט היה נכשל מסיבה שלא יכולה לקרות בייצור.
17. **הודעת הכפתור: "כניסה למחברת" ולא "התחברות".** ראה סעיף 9.
18. **מיקום ההתנתקות: לשונית "עוד".** §2 כבר מציין "הגדרות" תחת הלשונית הזאת,
    ולכן זו השלמת מסך ולא redesign. שאר התוכן של `NotImplementedScreen` נשמר.
19. **המפתח שנבחר: publishable (`sb_publishable_...`) ולא ה-anon JWT הישן.**
    שניהם עובדים ושניהם מותרים בדפדפן. ה-publishable ניתן לסבב עצמאי, וזו
    ההמלצה הרשמית של Supabase לאפליקציות חדשות.

### מה **לא** עשיתי, בכוונה

20. **לא יצרתי מנגנון conflict resolution** ולא sync. כפי שהנחית.
21. **לא שיניתי UI כדי להתאים ל-Supabase.** שכבת ה-repository עשתה את ההתאמה.
    השינויים ב-`RecipeScreen` הם דרישה 8, לא התאמה לבקנד.
22. **לא המצאתי אף ערך צפיפות** ולא הוספתי fallback. 5 השורות שממתינות לאימות
    ו-7 שממתינות לפי צורה נשארו בלי ערך, ו-11 פערי הנתונים נשארו פערים.
23. **לא נגעתי בפרוטוטייפ** ולא ב-`packages/engine/src`.
24. **לא נגעתי ב-Presenzo Production** בשום צורה.
25. **לא מחקתי ולא שיניתי את WhatsApp AI Assistant** — רק Pause, כפי שאישרת.
26. **לא יצרתי Pull Request.** לא ביקשת.

---

## 9. תקלות שנמצאו ותוקנו בדרך

ראויות לציון כי כולן היו באגים אמיתיים, לא רק כשלי טסט:

1. **`database.types.ts` הכריז את טיפוסי השורות כ-`interface`.** ל-interface
   אין index signature משתמעת, ולכן `Database['public']` נכשל בשקט בבדיקת
   `GenericSchema` של postgrest, פרמטר ה-`Schema` של הלקוח התפענח ל-`never`,
   וכל insert נדחה כ-`never` בלי שום רמז למה. עכשיו הם `type` aliases עם הערה
   מסבירה. **זו תקלה שאי אפשר היה לגלות ללא typecheck** — היא לא מפילה כלום
   בזמן ריצה, היא רק הופכת את הטיפוסים לחסרי תועלת.
2. **`mappers.ts` קרא ל-`.slice` על `created_at` בלי הגנה.** פרויקציה שלא
   ביקשה את העמודה הייתה מפילה את כל המסך על תווית תאריך. עכשיו `toDay()`
   מחזיר מחרוזת ריקה, ולא ממציא את היום של היום.
3. **כפתור השליחה ולשונית המצב נקראו שניהם "התחברות"** — שני פקדים עם אותו
   accessible name שעושים דברים שונים. קורא מסך היה מקריא אותם כאותו כפתור.
   השליחה היא "כניסה למחברת".
4. **`supabase.test.ts` בדק את המצב "לא מוגדר"** והתחיל להיכשל ברגע שנוצר
   פרויקט — הטסטים קראו את `.env.local` של המכונה. עכשיו כל מקרה מקבע את
   שני משתני הסביבה במפורש, ו-`vite.config.ts` מרוקן אותם כברירת מחדל בהרצת
   הטסטים. הסוויטה נותנת אותה תוצאה עם או בלי `.env.local` מקומי.
5. **`looksLikeServiceRoleKey` הבין רק JWT-ים ישנים** והיה מדווח על מפתח
   `sb_secret_...` מודרני כבטוח — כי הוא לא JWT ולכן היה נופל מהפענוח החוצה
   כ-`false`. עכשיו בדיקת prefix קודמת לפענוח.
6. **באג בסקריפט הבדיקה שכתבתי עצמי:** ה-destructuring דילג על קבוצת regex
   אחת פחות מהנדרש וקרא את סמן ה-`?` במקום הטיפוס, ולכן דיווח על 37 אי-התאמות
   שווא בין הטיפוסים לסכימה. תוקן, ואחרי התיקון הסכימה מתאימה.
7. **הנחה שגויה שלי בטסט:** הנחתי ש-`ingredientKeyOf` מחזיר את מפתח שורת
   הצפיפות (`'cocoa'`), אבל הוא מחזיר את **שם הרכיב המנורמל** (`'קקאו'`).
   אלה שני namespace-ים שונים, וערבוב ביניהם גורם לכיול לא להתאים אף פעם —
   בדיוק האזור של באג B4. תיקנתי את הטסט, לא את המנוע, והוספתי הערה.

---

## 10. איך לבדוק את זה בעצמך

```bash
npm ci
npm test                 # 354 טסטים
npm run typecheck
npm run build
npm run seed:check
npm run schema:check
```

להרצת האפליקציה נגד הפרויקט החי נדרש `apps/web/.env.local` (לא בריפו):

```
VITE_SUPABASE_URL=https://qxdpsomelzpvphkhkqrw.supabase.co
VITE_SUPABASE_ANON_KEY=<המפתח ה-publishable מהדשבורד>
```

ואז `npm run dev`. בלי הקובץ האפליקציה רצה על מתכוני הדמו לקריאה בלבד ואומרת
זאת על המסך.

להרצת הוכחת הבידוד: `supabase/tests/rls-isolation.sql` ב-SQL Editor של הפרויקט.
כל שורה בתוצאה צריכה להיות `pass = true`, והשורה האחרונה היא אימות שהניקוי
הצליח.
