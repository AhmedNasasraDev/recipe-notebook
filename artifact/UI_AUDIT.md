<!-- GENERATED from artifact/inventory.json by artifact/scripts/report.mjs.
     Edit the JSON, not this file. -->

# UI Audit — מסך אחר מסך

לכל מסך: מה הוא מציג, אילו פעולות קיימות, על מה הוא נשען בשרת, ומה נבדק. כל 24 המסכים נבדקו ב-402 / 820 / 1440 — 72 צמדי route×רוחב, אפס שגיאות ואפס גלישה אופקית (artifact/scripts/probe.mjs).

מקור האמת: הקוד ב-commit `80f2a7e`. כל שורה כאן ניתנת למיפוי לקובץ בפרויקט.

## שאלות הפתיחה — `/onboarding`

| | |
|---|---|
| **קומפוננטה** | OnboardingScreen |
| **קובץ** | `apps/web/src/routes/OnboardingScreen.tsx` |
| **מפרט** | מסך 1 |
| **איך מגיעים** | OnboardingGate מפנה לכאן כש-prefs.done אינו true · הגדרות → «שאלות הפתיחה» |
| **מקור נתונים** | prefs (טבלת profiles) דרך AppDataProvider |
| **תלות Backend** | profiles: getPrefs/savePrefs |
| **פעולות** | בחירת פרופיל · בחירת יחידות · כיול כלים · סיום → /notebook |
| **States** | 3 שלבים · גייט שמונע מעבר לטאבים |
| **בדיקות יחידה/מסך** | OnboardingScreen.test.tsx · AppSession.test.tsx |
| **E2E בדפדפן** | stage4 — עובר את כל השלבים |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## מחברת — `/notebook`

| | |
|---|---|
| **קומפוננטה** | NotebookScreen |
| **קובץ** | `apps/web/src/routes/NotebookScreen.tsx` |
| **מפרט** | מסך 3 |
| **איך מגיעים** | טאב «מחברת» · ברירת המחדל של catch-all |
| **מקור נתונים** | listRecipes() |
| **תלות Backend** | recipes + ingredients/steps/issues (RLS: recipes_own) |
| **פעולות** | חיפוש · סינון לפי קטגוריה · מתכון חדש · הדבקה · פתיחת מתכון |
| **States** | loading · empty (אין מתכונים) · סרגל מצב נתונים (AppShell) |
| **בדיקות יחידה/מסך** | NotebookScreen.test.tsx · RecipeFlow.test.tsx |
| **E2E בדפדפן** | stage4 + stage5 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## הדבקת מתכון — `/paste`

| | |
|---|---|
| **קומפוננטה** | PasteScreen |
| **קובץ** | `apps/web/src/routes/PasteScreen.tsx` |
| **מפרט** | מסך 6 |
| **איך מגיעים** | מחברת → «הדבקה» |
| **מקור נתונים** | parser מקומי (packages/engine) |
| **תלות Backend** | saveRecipe (RPC save_recipe) בשמירה בלבד |
| **פעולות** | פענוח מקומי · שמירה → /recipe/:id |
| **States** | empty · שגיאת פענוח |
| **בדיקות יחידה/מסך** | PasteScreen.test.tsx |
| **E2E בדפדפן** | לא — לא נבדק בדפדפן |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |
| **הערה** | «פענוח חכם» (Claude) אינו קיים בקוד — ראו findings |

## מתכון חדש — `/recipe/new`

| | |
|---|---|
| **קומפוננטה** | RecipeEditScreen |
| **קובץ** | `apps/web/src/routes/RecipeEditScreen.tsx` |
| **מפרט** | מסך 5 |
| **איך מגיעים** | מחברת → «מתכון חדש» |
| **מקור נתונים** | draft מקומי |
| **תלות Backend** | save_recipe |
| **פעולות** | טופס מלא · הוספת רכיבים/שלבים/תקלות · בחירת מתכון בסיס · שמירה |
| **States** | ולידציה · locked · שגיאת שמירה |
| **בדיקות יחידה/מסך** | RecipeEditScreen.test.tsx · RecipeFlow.test.tsx |
| **E2E בדפדפן** | stage4 + stage5 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## עריכת מתכון — `/recipe/:recipeId/edit`

| | |
|---|---|
| **קומפוננטה** | RecipeEditScreen |
| **קובץ** | `apps/web/src/routes/RecipeEditScreen.tsx` |
| **מפרט** | מסך 5 |
| **איך מגיעים** | מסך מתכון → «עריכה» · תווית → קישור אזהרה · Cook Mode → יציאה |
| **מקור נתונים** | getRecipe(id) |
| **תלות Backend** | save_recipe (עם expected_updated_at) |
| **פעולות** | עריכה · שמירה · ביטול · כיול כלי (CalibrateSheet) |
| **States** | locked — מסך אישור לפני עריכת נוסחה מאושרת · התנגשות שמירה |
| **בדיקות יחידה/מסך** | RecipeEditScreen.test.tsx · VersionFlow.test.tsx |
| **E2E בדפדפן** | stage5 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## מתכון — `/recipe/:recipeId`

| | |
|---|---|
| **קומפוננטה** | RecipeScreen |
| **קובץ** | `apps/web/src/routes/RecipeScreen.tsx` |
| **מפרט** | מסך 4 |
| **איך מגיעים** | כרטיס במחברת · «המשך מאיפה שעצרת» בבית · מתכוני בסיס · חומרי גלם |
| **מקור נתונים** | getRecipe + catalog + prefs → compute() |
| **תלות Backend** | recipes/ingredients/steps/issues · recipe_versions · private_notes · recipe_images (bucket פרטי) |
| **פעולות** | שינוי מנות/תפוקה · המרת יחידה (ConvertSheet) · כיול (CalibrateSheet) · התאמת תבנית (PanCard) · הערה אישית · גרסאות + השוואה · תמחור (CostingPanel) · תמונות · שכפול · מחיקה · Cook Mode · תווית · דף הזמנה · עריכה |
| **States** | loading · not found · locked · מצב חישוב חלקי (CalcNotice) · סירוב מחיקה (RecipeInUseError) · תמונות: loading/empty/failed/URL null |
| **בדיקות יחידה/מסך** | RecipeScreen.test.tsx · RecipeFlow · VersionFlow · CostingFlow · DeleteGuardFlow |
| **E2E בדפדפן** | stage5 (ניווט מתוך המחברת) |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |
| **הערה** | המסך הגדול במוצר (~1000 שורות). תמונות: signedImageUrl מחזיר null בתצוגה |

## מצב הכנה (Mise en place → שלבים) — `/recipe/:recipeId/cook`

| | |
|---|---|
| **קומפוננטה** | CookScreen |
| **קובץ** | `apps/web/src/routes/CookScreen.tsx` |
| **מפרט** | מסך 7 |
| **איך מגיעים** | מסך מתכון → «מצב הכנה» (הקישור נושא את ה-scale) · בית → «המשך» |
| **מקור נתונים** | compute(recipe, notebook, {factor}) לפי ה-scale שב-URL + mirror (ticks, started, step) |
| **תלות Backend** | קריאה בלבד; ההתקדמות והסימונים נשמרים ב-IndexedDB מקומית |
| **פעולות** | סימון חומר גלם כמוכן · ביטול סימון · הכול מוכן — מתחילים בהכנה (חסום עד 100%) · סימון שלב · ניווט בין שלבים · טיימר · סיום ההכנה · יציאה |
| **States** | Mise en place — 0..100%, הכפתור disabled מתחת ל-100% · מתכון בלי חומרי גלם — «אין מה לשקול», הכפתור פעיל · שלבים — מסך מלא ללא טאבים · ללא שלבים — הודעה והפניה לעריכה · שחזור: ticks + started לפי חתימת ה-scale |
| **בדיקות יחידה/מסך** | CookScreen.test.tsx (35) · features/cook/mise.test.ts (20) · e2e/stage14.mjs (40) |
| **E2E בדפדפן** | stage14 — 402 ו-1440 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |
| **הערה** | ה-h1 הוא «הכנת חומרי גלם» עד שההכנה מתחילה; אחריו אין h1 והכיתוב הראשי הוא מספר השלב |

## תווית — `/recipe/:recipeId/label`

| | |
|---|---|
| **קומפוננטה** | LabelScreen |
| **קובץ** | `apps/web/src/routes/LabelScreen.tsx` |
| **מפרט** | מסך 8 |
| **איך מגיעים** | מסך מתכון → «תווית» |
| **מקור נתונים** | compute() + labelComposition() + lastBatch()/haccpOf() |
| **תלות Backend** | קריאה בלבד (batches נקראות, לא נכתבות) |
| **פעולות** | הדפסה (window.print) |
| **States** | אלרגנים לא ודאיים → הסרת אחוזים · אין אצווה → אין שורת HACCP · אזהרת «אינה תווית מאושרת» |
| **בדיקות יחידה/מסך** | LabelScreen.test.tsx (18) |
| **E2E בדפדפן** | לא — לא נבדק בדפדפן |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |
| **הערה** | מסך הדפסה: @media print ב-global.css |

## דף הזמנה — `/recipe/:recipeId/order`

| | |
|---|---|
| **קומפוננטה** | OrderScreen |
| **קובץ** | `apps/web/src/routes/OrderScreen.tsx` |
| **מפרט** | מסך 9 |
| **איך מגיעים** | מסך מתכון → «דף הזמנה» (כולל פרמטרי scale ב-URL) |
| **מקור נתונים** | compute() בקנה המידה שב-URL |
| **תלות Backend** | קריאה בלבד |
| **פעולות** | מילוי פרטי הזמנה (לא נשמר) · הדפסה |
| **States** | משקל לא ידוע → ______ · עלות לא מלאה → מסויגת · אין מספר הזמנה |
| **בדיקות יחידה/מסך** | OrderScreen.test.tsx (23) |
| **E2E בדפדפן** | לא — לא נבדק בדפדפן |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## בית — `/home`

| | |
|---|---|
| **קומפוננטה** | HomeScreen |
| **קובץ** | `apps/web/src/routes/HomeScreen.tsx` |
| **מפרט** | מסך 2 |
| **איך מגיעים** | טאב «בית» |
| **מקור נתונים** | listRecipes + mirror (lastOpened) |
| **תלות Backend** | recipes |
| **פעולות** | המשך מאיפה שעצרת · קטגוריות · מתכוני בסיס |
| **States** | אין מתכון פתוח · אין עלות |
| **בדיקות יחידה/מסך** | HomeScreen.test.tsx |
| **E2E בדפדפן** | stage4 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## קבוצות — `/groups`

| | |
|---|---|
| **קומפוננטה** | GroupsScreen |
| **קובץ** | `apps/web/src/routes/GroupsScreen.tsx` |
| **מפרט** | מסך 15 |
| **איך מגיעים** | טאב «קבוצות» |
| **מקור נתונים** | listGroups() + myJoinRequests() + group_unread_counts() |
| **תלות Backend** | groups · group_members · group_join_requests · RPC create_group/request_group_join |
| **פעולות** | יצירת קבוצה · הצטרפות עם קוד · ביטול בקשה · פתיחת קבוצה |
| **States** | loading · empty + ארבע דרכי הצטרפות · ללא שרת → הודעה ואין כפתורים · alert על שגיאה · badge לא נקראו |
| **בדיקות יחידה/מסך** | GroupsScreen.test.tsx (14) |
| **E2E בדפדפן** | stage12 (מצב ללא שרת בלבד) |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |


## קבוצה — `/group/:groupId`

| | |
|---|---|
| **קומפוננטה** | GroupScreen |
| **קובץ** | `apps/web/src/routes/GroupScreen.tsx` |
| **מפרט** | מסך 16 |
| **איך מגיעים** | כרטיס ברשימת הקבוצות · אחרי פדיון הזמנה |
| **מקור נתונים** | getGroup() (courses→lessons→items) + group_roster() + signed avatar URLs |
| **תלות Backend** | courses/lessons/group_recipe_items · RPC group_roster · Realtime (בטאב הצ׳אט) |
| **פעולות** | טאב שיעורים/צ׳אט · (דרגה≥2) קורס חדש, שיעור חדש, הוספת מתכון מהמחברת, סימון שיעור, הסרת פריט · יציאה מהקבוצה · מעבר להרשאות |
| **States** | loading · הקבוצה אינה קיימת/אין גישה — הודעה אחת · אין קורסים (נוסח שונה לתלמיד ולמדריך) · קוד הקבוצה מוצג לדרגה≥2 · badge לא נקראו |
| **בדיקות יחידה/מסך** | GroupScreen.test.tsx (20) |
| **E2E בדפדפן** | לא — דורש נתוני קבוצה |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |


## הרשאות — `/group/:groupId/perms`

| | |
|---|---|
| **קומפוננטה** | PermsScreen |
| **קובץ** | `apps/web/src/routes/PermsScreen.tsx` |
| **מפרט** | מסך 18 |
| **איך מגיעים** | מסך קבוצה → «חברים והרשאות» (מוצג לדרגה≥2) |
| **מקור נתונים** | getGroup + roster + listInvites + listJoinRequests |
| **תלות Backend** | group_members (members_role/members_remove) · group_invites + RPC create/revoke/resend · approve/reject_group_join · group_recipe_items · Edge Function send-group-invite |
| **פעולות** | שינוי תפקיד · הסרת חבר · אישור/דחיית בקשה · יצירת הזמנה (מייל או קישור) · ביטול/שליחה מחדש · חמישה מתגי הרשאה לכל מתכון |
| **States** | תלמיד → «למדריכים ולמנהלים בלבד» · מדריך → ללא שליטה בתפקידים · בעלים — אין מה לשנות · הזמנה: ממתינה/נוצלה/בוטלה/נדחתה/פג תוקף · מייל לא נשלח → הסבר + קישור |
| **בדיקות יחידה/מסך** | PermsScreen.test.tsx (25) |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |
| **הערה** | שליחת מייל אינה מופעלת בתצוגה — BACKEND NOT EXECUTED |

## מתכון קבוצתי — `/group/:groupId/item/:itemId`

| | |
|---|---|
| **קומפוננטה** | GroupRecipeScreen |
| **קובץ** | `apps/web/src/routes/GroupRecipeScreen.tsx` |
| **מפרט** | מסך 17 |
| **איך מגיעים** | שיעור בקבוצה → פריט מתכון |
| **מקור נתונים** | getGroup + fetchRecipe(recipeId) + getItemNote(itemId) |
| **תלות Backend** | recipes (recipes_group_read) · private_notes · RPC save_group_recipe_copy/save_item_note |
| **פעולות** | צפייה ברכיבים ובשלבים · כרטיס «מה מותר לי כאן» · הערה אישית · שמירת עותק למחברת · הדפסה (אם מותר) |
| **States** | אינו זמין — הודעה אחת לכל סיבה · save חסום → נוסח המפרט · מתכון בסיס שלא שותף → הודעה · העותק נוצר → הודעה + מעבר |
| **בדיקות יחידה/מסך** | GroupRecipeScreen.test.tsx (14) |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |


## חומרי גלם ומחירים — `/ingredients`

| | |
|---|---|
| **קומפוננטה** | IngredientsScreen |
| **קובץ** | `apps/web/src/routes/IngredientsScreen.tsx` |
| **מפרט** | מסך 11 |
| **איך מגיעים** | עוד → «חומרי גלם ומחירים» |
| **מקור נתונים** | listCatalog() |
| **תלות Backend** | ingredient_catalog · RPC record_purchase · purchase_history · recipes_pricing_on |
| **פעולות** | הוספה/עריכה/מחיקה של חומר גלם · רישום קנייה · היסטוריית מחירים · אילו מתכונים נשענים על המחיר |
| **States** | empty · מחיר לא ידוע ≠ 0 · עלות נגזרת ע״י המסד |
| **בדיקות יחידה/מסך** | IngredientsScreen.test.tsx · PricingFlow · CostingFlow |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |
| **הערה** | ל-5 מתכוני הדמו אין ingredientKey; ההתאמה נעשית לפי שם מנורמל |

## תכנון ייצור — `/plans`

| | |
|---|---|
| **קומפוננטה** | PlansScreen |
| **קובץ** | `apps/web/src/routes/PlansScreen.tsx` |
| **מפרט** | מסך 10 |
| **איך מגיעים** | עוד → «תכנון ייצור ורכש» |
| **מקור נתונים** | listPlans() |
| **תלות Backend** | production_plans · RPC save_production_plan |
| **פעולות** | תוכנית חדשה · פתיחת תוכנית · מחיקה |
| **States** | loading · empty · נעול/פתוח |
| **בדיקות יחידה/מסך** | PlanningFlow.test.tsx (דרך appHarness) |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |
| **הערה** | אין קובץ בדיקה ייעודי למסך |

## יום ייצור — `/plan/:planId`

| | |
|---|---|
| **קומפוננטה** | PlanScreen |
| **קובץ** | `apps/web/src/routes/PlanScreen.tsx` |
| **מפרט** | מסך 10 |
| **איך מגיעים** | רשימת התוכניות → שם התוכנית |
| **מקור נתונים** | getPlan + recipes + catalog → explode/timeline/purchase |
| **תלות Backend** | production_plans + items + stock · RPC set_plan_locked |
| **פעולות** | הוספת פריטים · מלאי קיים · נעילה (snapshot) · מחיקה |
| **States** | נעול = קורא מה-snapshot · חסר מחיר → לא מוצגת עלות · לוח זמנים אחורה |
| **בדיקות יחידה/מסך** | PlanningFlow.test.tsx |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |
| **הערה** | אין קובץ בדיקה ייעודי למסך |

## עוד — `/more`

| | |
|---|---|
| **קומפוננטה** | MoreScreen |
| **קובץ** | `apps/web/src/routes/MoreScreen.tsx` |
| **מפרט** | מסך 19 |
| **איך מגיעים** | טאב «עוד» |
| **מקור נתונים** | useAuth + capabilities |
| **תלות Backend** | auth session בלבד |
| **פעולות** | 4 כניסות: חומרי גלם, תכנון ייצור, כלי מדידה, הגדרות |
| **States** | מחובר/לא מחובר · הערת מצב נתונים |
| **בדיקות יחידה/מסך** | AppSession.test.tsx (מותקן ב-harness) |
| **E2E בדפדפן** | stage4 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |
| **הערה** | אין קובץ בדיקה ייעודי |

## הגדרות — `/settings`

| | |
|---|---|
| **קומפוננטה** | SettingsScreen |
| **קובץ** | `apps/web/src/routes/SettingsScreen.tsx` |
| **מפרט** | מסך 20 |
| **איך מגיעים** | עוד → «הגדרות» |
| **מקור נתונים** | prefs + auth + getIdentity() |
| **תלות Backend** | profiles (prefs + display_name + avatar_path) · bucket avatars · auth (שינוי סיסמה/יציאה) |
| **פעולות** | פרופיל · יחידות · שם ותמונה לקבוצות (IdentityCard) · איפוס שאלות פתיחה · שינוי סיסמה · יציאה |
| **States** | שפה: ערבית «בהכנה» — ללא מתג · פרטיות: טקסט, אין מה לכבות · ללא שרת → שדות מושבתים |
| **בדיקות יחידה/מסך** | SettingsScreen.test.tsx · IdentityCard.test.tsx (11) |
| **E2E בדפדפן** | stage4 + stage12 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |
| **הערה** | העלאת תמונה בתצוגה אינה מגיעה ל-Storage |

## כלי המדידה שלי — `/tools`

| | |
|---|---|
| **קומפוננטה** | ToolsScreen |
| **קובץ** | `apps/web/src/routes/ToolsScreen.tsx` |
| **מפרט** | מסך 21 |
| **איך מגיעים** | עוד → «כלי המדידה שלי» |
| **מקור נתונים** | prefs.tools + prefs.calib |
| **תלות Backend** | profiles.tools · calibrations |
| **פעולות** | גודל כוס/כף/כפית · oz מול fl oz · כיול אישי · מחיקת כיול |
| **States** | אין כיולים · כיול מוקפא מזמן היצירה |
| **בדיקות יחידה/מסך** | ToolsScreen.test.tsx |
| **E2E בדפדפן** | stage4 + stage5 |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## הזמנה לקבוצה — `/join/:token`

| | |
|---|---|
| **קומפוננטה** | JoinScreen |
| **קובץ** | `apps/web/src/routes/JoinScreen.tsx` |
| **מפרט** | §10.2 |
| **איך מגיעים** | קישור הזמנה מהמייל או מהעתקה — מחוץ ל-AppShell |
| **מקור נתונים** | הטוקן מה-URL בלבד |
| **תלות Backend** | RPC redeem_group_invite / reject_group_invite |
| **פעולות** | הצטרפות · דחייה |
| **States** | אינו פודה בטעינה · סירוב אחד לכל הסיבות · נדחתה |
| **בדיקות יחידה/מסך** | JoinScreen.test.tsx (7) |
| **E2E בדפדפן** | stage12 (מצב ללא שרת) |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | ARTIFACT FIXTURE |
| **הערה** | הטוקן אינו מוצג במסך |

## הפניה לברירת מחדל — `*`

| | |
|---|---|
| **קומפוננטה** | Navigate → /notebook |
| **קובץ** | `apps/web/src/App.tsx` |
| **מפרט** | — |
| **איך מגיעים** | כל כתובת שאינה מוכרת |
| **מקור נתונים** | — |
| **תלות Backend** | — |
| **פעולות** | redirect |
| **States** | replace: true |
| **בדיקות יחידה/מסך** | AppSession.test.tsx |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | נתוני המוצר (מתכוני הדמו) |


## התחברות / הרשמה — `(אין route)`

| | |
|---|---|
| **קומפוננטה** | AuthScreen |
| **קובץ** | `apps/web/src/routes/AuthScreen.tsx` |
| **מפרט** | §2 · HANDOFF §2 |
| **איך מגיעים** | AuthGate מציג אותו כאשר status === 'signed-out' (כלומר: פרויקט מוגדר והמשתמש אינו מחובר) |
| **מקור נתונים** | auth session |
| **תלות Backend** | Supabase GoTrue (signUp/signIn/reset) |
| **פעולות** | הרשמה · התחברות · איפוס סיסמה |
| **States** | loading · unconfigured → אינו מוצג כלל · שגיאת התחברות |
| **בדיקות יחידה/מסך** | אין קובץ בדיקה |
| **E2E בדפדפן** | לא |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | קומפוננטה בלבד — BACKEND NOT EXECUTED |
| **הערה** | בתצוגה מוצג בנתיב /__inspector/auth — לא route של המוצר. BACKEND NOT EXECUTED |

## NotImplementedScreen — `(אין route)`

| | |
|---|---|
| **קומפוננטה** | NotImplementedScreen |
| **קובץ** | `apps/web/src/routes/NotImplementedScreen.tsx` |
| **מפרט** | — |
| **איך מגיעים** | אין — אף route ואף קומפוננטה אינם מפנים אליו יותר |
| **מקור נתונים** | — |
| **תלות Backend** | — |
| **פעולות** | — |
| **States** | — |
| **בדיקות יחידה/מסך** | אין |
| **E2E בדפדפן** | — |
| **Mobile 402 / Tablet 820 / Desktop 1440** | נטען, אפס שגיאות, אפס גלישה |
| **בתצוגה** | קוד מת — אינו מוצג |
| **הערה** | קוד מת מאז ש-/groups קיבל מסך אמיתי |

