# פריסה — מחברת מתכונים (`apps/web`)

מסמך זה מרכז את כל מה שצריך כדי לפרסם את האפליקציה האמיתית, ומה בודקים אחרי הפרסום. הוא נכתב ב-22.09.2026 בסיום סבב התיקונים; הגרסה שנבדקה מצוינת בדוח `artifact/qa/QA-FINAL-REPORT-2026-09-22.md`.

## 1. מה נבנה

```bash
npm ci
npm run typecheck          # engine + web
npm test                   # 243 בדיקות מנוע + ~1,400 בדיקות web
npm run build              # packages/engine ואז apps/web → apps/web/dist
```

הפלט הסטטי ב-`apps/web/dist` (HTML + JS + CSS + גופנים + favicon). האפליקציה היא SPA עם ניתוב בצד הלקוח, ולכן השרת חייב להחזיר את `index.html` לכל נתיב (rewrite), אחרת רענון ב-`/recipe/…` יחזיר 404.

## 2. משתני סביבה (בזמן build)

| משתנה | ערך | הערות |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` | מ-Supabase → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | מפתח **publishable** (`sb_publishable_…`) או anon JWT | **לעולם לא** `service_role` ולא `sb_secret_…` — הקוד מסרב להם, ובכל מקרה הם ייחשפו לכל גולש |

השניים נאפים לתוך ה-bundle בזמן `vite build`; שינוי שלהם דורש build מחדש. בלי שניהם האפליקציה עולה במצב הדגמה לקריאה בלבד ואומרת זאת על המסך. מקומית: `apps/web/.env.local` (ב-gitignore, ראו `apps/web/.env.example`).

## 3. הגדרות בפרויקט Supabase (פעם אחת, ידנית, לפני הפרסום)

1. **Authentication → URL Configuration**
   - `Site URL` = כתובת הפריסה (למשל `https://app.example.com`). היום הערך הוא `http://127.0.0.1:5199`, ולכן קישור אימות המייל מפנה למחשב המקומי ומשתמש אמיתי לא יכול לאשר את החשבון מהטלפון.
   - `Redirect URLs`: אותה כתובת, וגם כתובת ה-Preview מ-Vercel (סעיף 4) לצורך בדיקות — בלי למחוק את הקיימות.
2. **Authentication → Providers → Email**: `Confirm email` דלוק (כפי שהוא היום). אם רוצים הרשמה בלי אימות, לכבות — ההודעות באפליקציה מטפלות בשני המצבים.
3. **Authentication → Password**: מומלץ להדליק `Leaked password protection` (אזהרת אבטחה פתוחה של Supabase).
4. **Edge Function `send-group-invite`** — לפרוס מחדש את הגרסה שבמאגר (`supabase/functions/send-group-invite/index.ts`), שמוסיפה מענה ל-preflight ו-CORS. בלי זה הדפדפן חוסם את הקריאה ואף מייל הזמנה לא נשלח:
   ```bash
   npx supabase functions deploy send-group-invite --project-ref <project-ref>
   ```
   וסודות (ראו `supabase/README.md`, "Connecting the invitation email"): `RESEND_API_KEY`, `INVITE_FROM`, `PUBLIC_SITE_URL`. עד שהם קיימים הפונקציה עונה `{ sent: false }` והאפליקציה מציעה להעתיק את הקישור.
5. **Database**: כל 39 המיגרציות ב-`supabase/migrations` מוחלות. מיגרציה `0038_recipe_image_focus` (עמודות `focal_x`/`focal_y` ב-`recipe_images`) הוחלה על הפרויקט ב-22.09.2026 בסבב השני, באישור — בלעדיה שמירת מיקום התמונה נכשלה ב-PGRST204.
6. **Storage**: buckets פרטיים `recipe-images` (webp, עד 2MB) ו-`avatars` (webp, עד 512KB) קיימים.
7. **אזהרות אבטחה של Supabase שלא טופלו** (החלטה של בעל הפרויקט): 9 פונקציות `SECURITY DEFINER` ניתנות להרצה למשתמשים מחוברים (`approve_group_join`, `course_rank`, `group_rank`, `group_roster`, `lesson_rank`, `redeem_group_invite`, `reject_group_invite`, `request_group_join`, `shares_group_with`). כולן בודקות `auth.uid()` והרשאות בגוף הפונקציה; הן מכוונות. אפשר להשאיר, ואפשר לצמצם בהמשך.

## 4. פריסה (Vercel)

- ההגדרות נמצאות ב-`vercel.json` בשורש המאגר: Framework Vite, Install `npm ci`, Build `npm run build` (בונה קודם את המנוע ואז את האפליקציה), Output `apps/web/dist`, ו-rewrite של כל נתיב ל-`/index.html`. Root Directory של הפרויקט ב-Vercel נשאר **שורש המאגר** (לא `apps/web`), אחרת המנוע לא נבנה.
- Environment Variables: השניים מסעיף 2 (Preview, ו-Production כשמפרסמים).
- **Preview פרטי** (22.09.2026): הפרויקט `recipe-notebook-preview` ב-Vercel, עם Vercel Authentication על כל הפריסות (רק מי שמחובר לחשבון ה-Vercel של הפרויקט רואה אותן). כתובת ה-Preview הקבועה: `https://recipe-notebook-preview-ahmad-nsasra.vercel.app` (פריסת `staging`, משתני הסביבה של Preview). הפרויקט **אינו מקושר** למאגר ב-GitHub — אפליקציית GitHub של Vercel לא מותקנת על המאגר — ולכן **דחיפה למאגר אינה מפרסמת כלום**; כל פריסה נוצרת ידנית מ-commit מסוים דרך ה-API של Vercel (`gitSource` + `target: "staging"`).
- **מיגרציה 0039** (22.09.2026, שלב ב׳ של בדיקת הקבלה): policy המחיקה ב־`storage.objects` מאפשרת גם למי שהעלה קובץ למחוק אותו — הוחלה על הפרויקט. פריסת ה־Preview העדכנית: `dpl_4tiiSddpe6m8anXTc47wtxU8uVG1` מהקומיט `f4b807d`.
- **מיגרציה 0040** (23.09.2026, אפיון שלב 3א, A-11): policy הקריאה ב־`storage.objects` מאפשרת גם למי שהעלה קובץ לראות אותו אחרי שהמתכון נמחק, כדי ש־`remove()` של Storage ימצא וימחק אותו — הוחלה על הפרויקט באישור.
- **רענון ה־Preview** (23.09.2026): נפרסה מחדש כל עבודת מסמך האפיון (שלבים 0–7 + ארבעת תיקוני ההמשך — תפריט ⋮, Hero, לוח צבעים 3.1, Frank Ruhl Libre, אזורי לחיצה 44px, ניגודיות אפור/ענבר, כפתורי הדפסה). לאחר מכן דווח באג אמיתי ממכשיר: כפתורי הניווט במצב הכנה תקועים באמצע המסך בשלב קצר — תוקן (`.foot` קיבל `position: sticky` כמו `.gateBar`) ונפרס שוב.
- **תיקון גלילה אופקית** (23.09.2026): אחרי הפריסה הקודמת דווחו 4 צילומי מסך ממכשיר אמיתי המראים תוכן חתוך בקצה המסך וגלילה הצידה, בפריים אחד באמצע הטעינה (לפני ולאחריו המסך תקין). האבחנה: לפני שה-CSS של גלישת השורה (`flex-wrap`) נטען/מוחל, הדפדפן מיישם ברירת מחדל `nowrap`, מה שיכול להרחיב את העמוד מעבר לרוחב המסך לרגע. שום מסך באפליקציה לא אמור לגלול אופקית בכלל (גם §14 קובע זאת במפורש לגבי מצב הכנה), אז נוסף מגן גורף: `overflow-x: hidden` על `html, body` ב-`global.css`, כך שגם אם תוכן חורג לרגע הוא נחתך ולא גורם לגלילה נראית. לא ניתן היה לשחזר את הבאג במכשיר אמיתי מתוך הסביבה הזו (אין גישה ל-`*.vercel.app`), אז התיקון מבוסס על ניתוח הצילומים והקוד בלבד — מומלץ לאמת שוב בטלפון. פריסה נוכחית: `dpl_3Xqend3cW6csGxH8SbW4B7Fs5KLM` מהקומיט `7c87cfe` (הענף `claude/recipe-notebook-full-system-qa-fb7p1y`). הכתובת הקבועה `https://recipe-notebook-preview-ahmad-nsasra.vercel.app` מצביעה עליה עכשיו.
- **מלכודת של Vercel**: בפרויקט שאינו מקושר ל-Git, הפריסה *הראשונה* שנוצרת מ-`gitSource` מסומנת Production בלי קשר ל-`target` שנשלח, ורק הפריסות שאחריה מכבדות `target: "staging"`. לכן בפרויקט `recipe-notebook-preview` קיימת פריסה אחת שמסומנת Production (`recipe-notebook-preview-beta.vercel.app`, אותו commit, נבנתה **בלי** משתני הסביבה ולכן במצב הדגמה, מוגנת ב-Vercel Authentication). היא אינה פרסום: אין לה דומיין ציבורי והיא לא נגישה בלי התחברות. אפשר למחוק אותה מלוח הבקרה. הפרויקט `recipe-notebook-preview-discard` נוצר באותו ניסיון ראשון ואפשר למחוק אותו כולו.
- לפני פרסום לציבור: להתקין את אפליקציית GitHub של Vercel על המאגר, לחבר את המאגר לפרויקט (Settings → Git), להגדיר את `main` כענף Production, ולהוסיף את משתני הסביבה גם ל-Production. אחרי החיבור, כל דחיפה ל-`main` תפרסם.
- קישור אימות המייל חוזר לכתובת שממנה נרשמו (`emailRedirectTo` = origin), בתנאי שהכתובת רשומה ב-Redirect URLs של Supabase; אחרת Supabase נופל ל-Site URL.

## 5. בדיקה אחרי הפרסום (10 דקות)

1. פותחים את הכתובת בטלפון: מסך התחברות, אין באנר "הדגמה".
2. הרשמה עם מייל חדש → המייל מגיע → הקישור מחזיר **לכתובת הפריסה** ומחובר → שאלות הפתיחה → מחברת ריקה.
3. F5: נשארים במחברת (לא חוזרים לשאלות הפתיחה).
4. מתכון חדש עם 2 רכיבים ומחיר עם יחידה → נשמר → F5 → קיים. ניסיון שמירה עם כמות 0 → נחסם.
4א. במתכון: "הדפסה / שמירה כ-PDF" בסרגל העליון → תצוגת ההדפסה מציגה גיליון נקי (שם, תמונה, רכיבים, שלבים, זמנים, טמפרטורות) בלי כפתורי האפליקציה, ושמירה כ-PDF מהטלפון מייצרת קובץ עם שם המתכון.
4ב. בתמונה: "התאמת מיקום התמונה" → לחיצה על התמונה → "שמירת המיקום" → "המיקום נשמר" → F5 → החיתוך נשאר.
5. תמונה למתכון → מופיעה בכרטיס במחברת → פתיחה בדפדפן אחר עם אותו חשבון → מופיעה.
6. מצב הכנה → טיימר אישי דקה → F5 → הטיימר ממשיך → בסיום נשמע צליל (בטלפון: רטט).
7. קבוצה חדשה → מוצג "קוד הקבוצה" → מחשבון שני "הצטרפות עם קוד" → בקשה → אישור → חבר.
8. הזמנה במייל (אם הסודות הוגדרו): המייל מגיע והקישור מצטרף; אחרת המסך אומר שהמייל לא נשלח ומציע להעתיק קישור.
9. צ׳אט: הודעה מחשבון ב מופיעה אצל א בלי רענון (Realtime דרך WebSocket — לא ניתן היה לבדוק בסביבת הבדיקה).
10. ניתוק רשת ושמירה: הודעה בעברית, הנתונים נשארים, חזרה לרשת ושמירה → רשומה אחת.
