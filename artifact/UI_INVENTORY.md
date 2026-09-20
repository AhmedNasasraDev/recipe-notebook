<!-- GENERATED from artifact/inventory.json by artifact/scripts/report.mjs.
     Edit the JSON, not this file. -->

# UI Inventory — מה קיים בפועל בקוד

רשימת כל ה-routes, המסכים והקומפוננטות שקיימים בקוד כרגע, עם הנתיב שמגיע אליהם ומקור הנתונים. נבנתה מסריקת הקוד, לא מהמפרט.

מקור האמת: הקוד ב-commit `f4c5179`. כל שורה כאן ניתנת למיפוי לקובץ בפרויקט.

## Routes (24)

| Route | מסך | קומפוננטה | קובץ | איך מגיעים | מקור נתונים | תלות Backend |
|---|---|---|---|---|---|---|
| `/onboarding` | שאלות הפתיחה | OnboardingScreen | `apps/web/src/routes/OnboardingScreen.tsx` | OnboardingGate מפנה לכאן כש-prefs.done אינו true · הגדרות → «שאלות הפתיחה» | prefs (טבלת profiles) דרך AppDataProvider | profiles: getPrefs/savePrefs |
| `/notebook` | מחברת | NotebookScreen | `apps/web/src/routes/NotebookScreen.tsx` | טאב «מחברת» · ברירת המחדל של catch-all | listRecipes() | recipes + ingredients/steps/issues (RLS: recipes_own) |
| `/paste` | הדבקת מתכון | PasteScreen | `apps/web/src/routes/PasteScreen.tsx` | מחברת → «הדבקה» | parser מקומי (packages/engine) | saveRecipe (RPC save_recipe) בשמירה בלבד |
| `/recipe/new` | מתכון חדש | RecipeEditScreen | `apps/web/src/routes/RecipeEditScreen.tsx` | מחברת → «מתכון חדש» | draft מקומי | save_recipe |
| `/recipe/:recipeId/edit` | עריכת מתכון | RecipeEditScreen | `apps/web/src/routes/RecipeEditScreen.tsx` | מסך מתכון → «עריכה» · תווית → קישור אזהרה · Cook Mode → יציאה | getRecipe(id) | save_recipe (עם expected_updated_at) |
| `/recipe/:recipeId` | מתכון | RecipeScreen | `apps/web/src/routes/RecipeScreen.tsx` | כרטיס במחברת · «המשך מאיפה שעצרת» בבית · מתכוני בסיס · חומרי גלם | getRecipe + catalog + prefs → compute() | recipes/ingredients/steps/issues · recipe_versions · private_notes · recipe_images (bucket פרטי) |
| `/recipe/:recipeId/cook` | מצב הכנה (Mise en place → שלבים) | CookScreen | `apps/web/src/routes/CookScreen.tsx` | מסך מתכון → «מצב הכנה» (הקישור נושא את ה-scale) · בית → «המשך» | compute(recipe, notebook, {factor}) לפי ה-scale שב-URL + mirror (ticks, started, step) | קריאה בלבד; ההתקדמות והסימונים נשמרים ב-IndexedDB מקומית |
| `/recipe/:recipeId/label` | תווית | LabelScreen | `apps/web/src/routes/LabelScreen.tsx` | מסך מתכון → «תווית» | compute() + labelComposition() + lastBatch()/haccpOf() | קריאה בלבד (batches נקראות, לא נכתבות) |
| `/recipe/:recipeId/order` | דף הזמנה | OrderScreen | `apps/web/src/routes/OrderScreen.tsx` | מסך מתכון → «דף הזמנה» (כולל פרמטרי scale ב-URL) | compute() בקנה המידה שב-URL | קריאה בלבד |
| `/home` | בית | HomeScreen | `apps/web/src/routes/HomeScreen.tsx` | טאב «בית» | listRecipes + mirror (lastOpened) | recipes |
| `/groups` | קבוצות | GroupsScreen | `apps/web/src/routes/GroupsScreen.tsx` | טאב «קבוצות» | listGroups() + myJoinRequests() + group_unread_counts() | groups · group_members · group_join_requests · RPC create_group/request_group_join |
| `/group/:groupId` | קבוצה | GroupScreen | `apps/web/src/routes/GroupScreen.tsx` | כרטיס ברשימת הקבוצות · אחרי פדיון הזמנה | getGroup() (courses→lessons→items) + group_roster() + signed avatar URLs | courses/lessons/group_recipe_items · RPC group_roster · Realtime (בטאב הצ׳אט) |
| `/group/:groupId/perms` | הרשאות | PermsScreen | `apps/web/src/routes/PermsScreen.tsx` | מסך קבוצה → «חברים והרשאות» (מוצג לדרגה≥2) | getGroup + roster + listInvites + listJoinRequests | group_members (members_role/members_remove) · group_invites + RPC create/revoke/resend · approve/reject_group_join · group_recipe_items · Edge Function send-group-invite |
| `/group/:groupId/item/:itemId` | מתכון קבוצתי | GroupRecipeScreen | `apps/web/src/routes/GroupRecipeScreen.tsx` | שיעור בקבוצה → פריט מתכון | getGroup + fetchRecipe(recipeId) + getItemNote(itemId) | recipes (recipes_group_read) · private_notes · RPC save_group_recipe_copy/save_item_note |
| `/ingredients` | חומרי גלם ומחירים | IngredientsScreen | `apps/web/src/routes/IngredientsScreen.tsx` | עוד → «חומרי גלם ומחירים» | listCatalog() | ingredient_catalog · RPC record_purchase · purchase_history · recipes_pricing_on |
| `/plans` | תכנון ייצור | PlansScreen | `apps/web/src/routes/PlansScreen.tsx` | עוד → «תכנון ייצור ורכש» | listPlans() | production_plans · RPC save_production_plan |
| `/plan/:planId` | יום ייצור | PlanScreen | `apps/web/src/routes/PlanScreen.tsx` | רשימת התוכניות → שם התוכנית | getPlan + recipes + catalog → explode/timeline/purchase | production_plans + items + stock · RPC set_plan_locked |
| `/more` | עוד | MoreScreen | `apps/web/src/routes/MoreScreen.tsx` | טאב «עוד» | useAuth + capabilities | auth session בלבד |
| `/settings` | הגדרות | SettingsScreen | `apps/web/src/routes/SettingsScreen.tsx` | עוד → «הגדרות» | prefs + auth + getIdentity() | profiles (prefs + display_name + avatar_path) · bucket avatars · auth (שינוי סיסמה/יציאה) |
| `/tools` | כלי המדידה שלי | ToolsScreen | `apps/web/src/routes/ToolsScreen.tsx` | עוד → «כלי המדידה שלי» | prefs.tools + prefs.calib | profiles.tools · calibrations |
| `/join/:token` | הזמנה לקבוצה | JoinScreen | `apps/web/src/routes/JoinScreen.tsx` | קישור הזמנה מהמייל או מהעתקה — מחוץ ל-AppShell | הטוקן מה-URL בלבד | RPC redeem_group_invite / reject_group_invite |
| `*` | הפניה לברירת מחדל | Navigate → /notebook | `apps/web/src/App.tsx` | כל כתובת שאינה מוכרת | — | — |
| `(אין route)` | התחברות / הרשמה | AuthScreen | `apps/web/src/routes/AuthScreen.tsx` | AuthGate מציג אותו כאשר status === 'signed-out' (כלומר: פרויקט מוגדר והמשתמש אינו מחובר) | auth session | Supabase GoTrue (signUp/signIn/reset) |
| `(אין route)` | NotImplementedScreen | NotImplementedScreen | `apps/web/src/routes/NotImplementedScreen.tsx` | אין — אף route ואף קומפוננטה אינם מפנים אליו יותר | — | — |

## קומפוננטות, גליות ופאנלים (18)

| שם | קובץ | מוצג בתוך | מה הוא | בדיקות |
|---|---|---|---|---|
| AppShell | `apps/web/src/shell/AppShell.tsx` | כל מסכי הטאבים | מסגרת, סרגל מצב הנתונים (§17), TabBar | AppSession.test.tsx |
| TabBar | `apps/web/src/shell/TabBar.tsx` | AppShell | 4 טאבים + tabOf(); אין יותר תווית «בהכנה» | TabBar.test.tsx (7) |
| ConvertSheet | `apps/web/src/features/recipe/ConvertSheet.tsx` | RecipeScreen | §5.3 גלית המרת יחידה | דרך RecipeScreen.test.tsx |
| CalibrateSheet | `apps/web/src/features/recipe/CalibrateSheet.tsx` | RecipeScreen · RecipeEditScreen | כיול כלי מדידה בזמן עבודה | CalibrateSheet.test.tsx |
| PanCard | `apps/web/src/features/recipe/PanCard.tsx` | RecipeScreen | §7 התאמת תבנית | PanCard.test.tsx |
| PrivateNote | `apps/web/src/features/recipe/PrivateNote.tsx` | RecipeScreen | §8 הערה אישית על מתכון | PrivateNote.test.tsx |
| VersionHistory | `apps/web/src/features/recipe/VersionHistory.tsx` | RecipeScreen | §9 היסטוריית גרסאות + שחזור | VersionHistory.test.tsx · VersionFlow |
| VersionCompare | `apps/web/src/features/recipe/VersionCompare.tsx` | VersionHistory | §2 מסך 14 «השוואת גרסאות» — קיים כקומפוננטה בתוך ההיסטוריה, לא כמסך | VersionCompare.test.tsx |
| CostingPanel | `apps/web/src/features/pricing/CostingPanel.tsx` | RecipeScreen | עלות, food cost, רווחיות | CostingFlow · PricingFlow |
| RecipeImages | `apps/web/src/features/images/RecipeImages.tsx` | RecipeScreen | §5 תמונות מתכון (bucket פרטי, WebP) | RecipeImages.test.tsx (21) |
| GroupChat | `apps/web/src/features/groups/GroupChat.tsx` | GroupScreen | §10 צ׳אט: היסטוריה, pagination, unread, עריכה/מחיקה/תשובה, Realtime | GroupChat.test.tsx (34) |
| IdentityCard | `apps/web/src/features/groups/IdentityCard.tsx` | SettingsScreen | §10.1 שם ותמונה שהקבוצה רואה | IdentityCard.test.tsx (11) |
| SourceBadge | `apps/web/src/components/SourceBadge.tsx` | RecipeScreen · RecipeEditScreen · ConvertSheet | מקור הצפיפות/הנתון (§5.1) | דרך מסכי המתכון |
| AuthGate | `apps/web/src/auth/AuthGate.tsx` | App | loading / unconfigured / signed-out / signed-in | AppSession.test.tsx |
| OnboardingGate | `apps/web/src/app/OnboardingGate.tsx` | App | §4 חוסם את הטאבים עד לסיום | AppSession.test.tsx |
| Mise en place (בתוך CookScreen) | `apps/web/src/routes/CookScreen.tsx + features/cook/mise.ts` | /recipe/:recipeId/cook | רשימת השקילה ושער הכניסה לשלבים; הלוגיקה (זהות סימון, «הושלם», חתימת scale) ב-mise.ts | mise.test.ts (20) · CookScreen.test.tsx (35) |
| rowLabel | `apps/web/src/features/recipe/rowLabel.ts` | מסך מתכון + Mise en place | מה שורת רכיב מציגה (§5.4) — מימוש אחד לשני המסכים | דרך RecipeScreen.test.tsx ו-CookScreen.test.tsx |
| scaleLink | `apps/web/src/features/recipe/scaleLink.ts` | מסך מתכון → דף הזמנה / מצב הכנה | כתיבת וקריאת ה-scale ב-URL; מנתח אחד לשלושה מסכים | scaleLink.test.ts (14) |
