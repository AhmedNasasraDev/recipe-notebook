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
   - `Redirect URLs`: אותה כתובת, וגם כתובות preview אם יש.
2. **Authentication → Providers → Email**: `Confirm email` דלוק (כפי שהוא היום). אם רוצים הרשמה בלי אימות, לכבות — ההודעות באפליקציה מטפלות בשני המצבים.
3. **Authentication → Password**: מומלץ להדליק `Leaked password protection` (אזהרת אבטחה פתוחה של Supabase).
4. **Edge Function `send-group-invite`** — לפרוס מחדש את הגרסה שבמאגר (`supabase/functions/send-group-invite/index.ts`), שמוסיפה מענה ל-preflight ו-CORS. בלי זה הדפדפן חוסם את הקריאה ואף מייל הזמנה לא נשלח:
   ```bash
   npx supabase functions deploy send-group-invite --project-ref <project-ref>
   ```
   וסודות (ראו `supabase/README.md`, "Connecting the invitation email"): `RESEND_API_KEY`, `INVITE_FROM`, `PUBLIC_SITE_URL`. עד שהם קיימים הפונקציה עונה `{ sent: false }` והאפליקציה מציעה להעתיק את הקישור.
5. **Database**: כל 38 המיגרציות ב-`supabase/migrations` מוחלות (אומת ב-22.09.2026). אין מיגרציה חדשה בסבב הזה.
6. **Storage**: buckets פרטיים `recipe-images` (webp, עד 2MB) ו-`avatars` (webp, עד 512KB) קיימים.
7. **אזהרות אבטחה של Supabase שלא טופלו** (החלטה של בעל הפרויקט): 9 פונקציות `SECURITY DEFINER` ניתנות להרצה למשתמשים מחוברים (`approve_group_join`, `course_rank`, `group_rank`, `group_roster`, `lesson_rank`, `redeem_group_invite`, `reject_group_invite`, `request_group_join`, `shares_group_with`). כולן בודקות `auth.uid()` והרשאות בגוף הפונקציה; הן מכוונות. אפשר להשאיר, ואפשר לצמצם בהמשך.

## 4. פריסה (Vercel, לדוגמה)

- Framework: Vite · Root: `apps/web` · Build: `npm run build` (מהשורש) · Output: `apps/web/dist`.
- Rewrite: כל נתיב → `/index.html`.
- Environment Variables: השניים מסעיף 2 (Production, וגם Preview אם רוצים).
- אין במאגר `vercel.json` או GitHub Actions — **דחיפה למאגר אינה מפרסמת כלום** עד שמחברים את הפרויקט ידנית.

## 5. בדיקה אחרי הפרסום (10 דקות)

1. פותחים את הכתובת בטלפון: מסך התחברות, אין באנר "הדגמה".
2. הרשמה עם מייל חדש → המייל מגיע → הקישור מחזיר **לכתובת הפריסה** ומחובר → שאלות הפתיחה → מחברת ריקה.
3. F5: נשארים במחברת (לא חוזרים לשאלות הפתיחה).
4. מתכון חדש עם 2 רכיבים ומחיר עם יחידה → נשמר → F5 → קיים. ניסיון שמירה עם כמות 0 → נחסם.
5. תמונה למתכון → מופיעה בכרטיס במחברת → פתיחה בדפדפן אחר עם אותו חשבון → מופיעה.
6. מצב הכנה → טיימר אישי דקה → F5 → הטיימר ממשיך → בסיום נשמע צליל (בטלפון: רטט).
7. קבוצה חדשה → מוצג "קוד הקבוצה" → מחשבון שני "הצטרפות עם קוד" → בקשה → אישור → חבר.
8. הזמנה במייל (אם הסודות הוגדרו): המייל מגיע והקישור מצטרף; אחרת המסך אומר שהמייל לא נשלח ומציע להעתיק קישור.
9. צ׳אט: הודעה מחשבון ב מופיעה אצל א בלי רענון (Realtime דרך WebSocket — לא ניתן היה לבדוק בסביבת הבדיקה).
10. ניתוק רשת ושמירה: הודעה בעברית, הנתונים נשארים, חזרה לרשת ושמירה → רשומה אחת.
