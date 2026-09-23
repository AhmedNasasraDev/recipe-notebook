// Free-text recipe parsing — ported from parser.js.
//
// `parseTime` and `parseTemp` are verbatim; they had no defects.
//
// The cup/spoon handling changed, because it was the third copy of B1:
// parser.js:65,69,72 hard-coded 240 ml and carried its own `DRY` table. It now
// goes through the shared density path with the user's tool sizes, and when
// there is no reliable density it KEEPS the original unit instead of inventing
// 150 g per cup — the importer must not fabricate a weight either.

import type { IngredientLike, MeasurementPrefs } from './types.js';
import { densityFor } from './density.js';
import { mlPerUnit } from './units.js';

const UNIT_WORDS = [
  'גרם', "גר'", "ג'", 'ק"ג', 'קילו', 'מ"ל', 'מל', 'ליטר',
  'כוס', 'כוסות', 'כף', 'כפות', 'כפית', 'כפיות', "יח'", 'יחידות', 'יחידה',
];
const LIQUID_WORDS = ['מים', 'חלב', 'שמנת', 'שמן', 'מיץ', 'יין', 'ביצ', 'דבש', 'סירופ', 'יוגורט'];
const FLOUR_WORDS = ['קמח', 'סולת', 'כוסמין', 'שיפון'];
const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
};
/*
  SECTION HEADINGS. They used to be dropped and forgotten; now they are READ.
  A recipe pasted from anywhere is "ingredients, then a heading, then steps",
  and a line that comes after "אופן ההכנה" is an instruction even when it
  carries a number and a unit ("מוסיפים 100 גרם חמאה"). Treating such lines
  as ingredients is how butter, milk and vanilla appeared twice on the
  weighing list of a pasted brioche (QA 22.09.2026, §3).
*/
const INGREDIENT_HEADING =
  /^(רכיבים|מצרכים|חומרים|חומרי גלם|לבצק|למילוי|לציפוי|לקרם|לרוטב|לתערובת|לבסיס|למחמצת)\s*:?\s*$/;
const STEP_HEADING =
  /^(אופן ההכנה|אופן הכנה|הוראות הכנה|הוראות|הכנה|שלבי הכנה|שלבי העבודה|סדר עבודה|דרך ההכנה|דרך הכנה)\s*:?\s*$/;

/*
  A LINE THAT DESCRIBES THE BATCH IS NOT AN INGREDIENT.

  "משקל בצק לפני אפייה: 1200 גרם" has a number and a unit, so the quantity
  heuristic below would make it an ingredient called "משקל בצק לפני אפייה"
  — and it would then be weighed out on the bench (the same QA finding). It
  is the recipe's own weight before the oven, which the notebook keeps in a
  field of its own, so it is read into that field and out of the list.
*/
const META_LINES: ReadonlyArray<[RegExp, Exclude<keyof ParsedMeta, 'name'>]> = [
  [/^משקל\s*(?:ה?בצק|ה?תערובת)?\s*לפני\s*(?:ה)?אפייה/u, 'weightBefore'],
  [/^משקל\s*(?:ה?בצק|ה?תערובת)?\s*אחרי\s*(?:ה)?אפייה/u, 'weightAfter'],
  [/^משקל\s*סופי/u, 'weightAfter'],
  [/^משקל\s*(?:ל)?יחידה/u, 'unitWeight'],
  [/^(?:תפוקה|מספר\s*יחידות|כמות\s*יחידות|מניב|יחידות)\s*:?/u, 'yieldUnits'],
];
/** A line about loss or totals: not an ingredient, not a step, nothing to keep. */
const NOISE_LINE = /^(?:פחת|אחוז\s*פחת|סה"כ|סה״כ|סך\s*הכל|סך\s*הכול)(?=\s|:|$)/u;

/*
  An instruction that happens to name a quantity. The verb is the tell: a
  line that starts with what to DO is a step whatever numbers follow it.
*/
const INSTRUCTION_START =
  /^(?:מוסיפים|מערבבים|לשים|לערבב|להוסיף|מחממים|לחמם|אופים|לאפות|מקציפים|להקציף|מקפלים|לקפל|מניחים|להניח|יוצקים|ליצוק|מכניסים|להכניס|מוציאים|להוציא|ממיסים|להמיס|מנפים|לנפות|מבשלים|לבשל|מקררים|לקרר|מכסים|לכסות|מתפיחים|להתפיח|לרדד|מרדדים|מברישים|להבריש|מפזרים|לפזר|לחלק|מחלקים|מורחים|למרוח|טורפים|לטרוף|שוקלים|לשקול|מכינים|להכין|ממתינים|להמתין|מחכים|לחכות|נותנים|לתת|קולים|לקלות|מטגנים|לטגן|מסננים|לסנן|לועסים|מקשטים|לקשט|מגלגלים|לגלגל|מעצבים|לעצב|מעבירים|להעביר|מנערים|לנער|מצננים|לצנן|חותכים|לחתוך|מקפיאים|להקפיא)(?=\s|$)/u;
/* Things that are counted rather than weighed: a line "4 ביצים" has no unit
   word and is an ingredient all the same. */
const COUNTED_WORDS = /(?:ביצ|חלמון|חלבון|יחיד|פרוס|עלה|ענף|שקית|קופס|מקל|וניל\s*מקל)/u;

export function parseQuantity(raw: string): number | null {
  const s = (raw ?? '').trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)?\s*(\d+)\s*\/\s*(\d+)/);
  if (frac) return (Number(frac[1]) || 0) + Number(frac[2]) / Number(frac[3]);
  for (const k of Object.keys(FRACTIONS)) {
    if (s.includes(k)) {
      const whole = s.match(/\d+(\.\d+)?/);
      return (whole ? parseFloat(whole[0]) : 0) + FRACTIONS[k]!;
    }
  }
  const m = s.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function parseTime(line: string): number | '' {
  if (/שעתיים וחצי/.test(line)) return 150;
  if (/שעתיים/.test(line)) return 120;
  if (/שעה וחצי/.test(line)) return 90;
  if (/חצי שעה/.test(line)) return 30;
  const h = line.match(/(\d+(\.\d+)?)\s*שע/);
  if (h) return Math.round(parseFloat(h[1]!) * 60);
  if (/\bשעה\b/.test(line)) return 60;
  const m = line.match(/(\d+)\s*דק/);
  return m ? Number(m[1]) : '';
}

export function parseTemp(line: string): string {
  const m = line.match(/(\d{2,3})\s*(?:מעלות|°|C|c\b)/);
  return m ? m[1]! : '';
}

/** Facts about the batch that a pasted recipe states in its own lines. */
export interface ParsedMeta {
  /** the first line, when it reads as a title rather than as a line of the recipe */
  name?: string;
  weightBefore?: number;
  weightAfter?: number;
  unitWeight?: number;
  yieldUnits?: number;
}

export interface ParsedRecipe {
  ingredients: IngredientLike[];
  steps: Array<{ id: string; text: string; temp: string; tempUnit: string; minutes: number | '' }>;
  /** lines whose cup/spoon amount could not be converted, kept in their own unit */
  keptAsWritten: Array<{ name: string; unit: string; reason: string }>;
  /** weights and counts read out of the text into the recipe's own fields */
  meta: ParsedMeta;
}

/**
 * Local parser. `prefs` is required for any cup/spoon line to be converted; it
 * is optional only so a caller can parse with factory defaults on purpose.
 */
export function parseLocal(
  text: string,
  prefs?: MeasurementPrefs,
): ParsedRecipe {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const ingredients: IngredientLike[] = [];
  const steps: ParsedRecipe['steps'] = [];
  const keptAsWritten: ParsedRecipe['keptAsWritten'] = [];
  const meta: ParsedMeta = {};
  /** which part of the recipe the reader is in; `null` until a heading says */
  let section: 'ingredients' | 'steps' | null = null;

  lines.forEach((line, i) => {
    if (INGREDIENT_HEADING.test(line)) {
      section = 'ingredients';
      return;
    }
    if (STEP_HEADING.test(line)) {
      section = 'steps';
      return;
    }
    const bare = line.replace(/^[-•*]\s*/, '').trim();
    for (const [re, key] of META_LINES) {
      if (re.test(bare)) {
        const q = parseQuantity(bare.replace(re, ''));
        if (q !== null && q > 0) meta[key] = q;
        return;
      }
    }
    if (NOISE_LINE.test(bare)) return;

    const hasNum = /\d|½|¼|¾|⅓|⅔/.test(line);
    const unitWord = UNIT_WORDS.find((u) => line.includes(u));
    const reads = section === 'steps' || INSTRUCTION_START.test(bare) ? 'step' : 'maybe';
    /*
      THE TITLE. The first line of a paste, before anything that reads as an
      ingredient or a step, with no number in it, is the recipe's name — not
      an instruction, which is what a 13-character line used to become.
    */
    if (
      reads === 'maybe' &&
      section === null &&
      ingredients.length === 0 &&
      steps.length === 0 &&
      meta.name === undefined &&
      !hasNum &&
      bare.length <= 60
    ) {
      meta.name = bare;
      return;
    }
    /* A counted ingredient ("4 ביצים") or any short numbered line inside the
       ingredient section: an ingredient, in pieces when no unit was written. */
    const counted =
      hasNum && !unitWord && bare.length < 60 &&
      (section === 'ingredients' || COUNTED_WORDS.test(bare)) &&
      /^[\d½¼¾⅓⅔]/.test(bare);

    if (reads === 'maybe' && hasNum && (unitWord || counted) && line.length < 60) {
      let name = line.replace(/^[-•*]\s*/, '').trim();
      const q = parseQuantity(name);
      name = name.replace(/^[\d½¼¾⅓⅔./\s]+/, '').trim();
      for (const u of [...UNIT_WORDS].sort((a, b) => b.length - a.length)) {
        if (name.startsWith(u)) {
          name = name.slice(u.length).trim();
          break;
        }
      }
      name = name
        .replace(/^(של|מ־|מ )\s*/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (!name) return;

      const qty = q ?? 0;
      const isLiq = LIQUID_WORDS.some((k) => name.includes(k));
      const ing: IngredientLike = { id: `n${i}`, name, qty, unit: 'גרם' };

      if (/ק"ג|קילו/.test(line)) {
        ing.qty = qty;
        ing.unit = 'ק"ג';
      } else if (/ליטר/.test(line)) {
        ing.qty = qty;
        ing.unit = 'ליטר';
      } else if (/מ"ל|(^|\s)מל(\s|$)/.test(line)) {
        ing.qty = qty;
        ing.unit = 'מ"ל';
      } else if (/כוס/.test(line)) {
        applyHomeMeasure(ing, 'כוס', qty, prefs, keptAsWritten);
      } else if (/כפית|כפיות/.test(line)) {
        applyHomeMeasure(ing, 'כפית', qty, prefs, keptAsWritten);
      } else if (/כף|כפות/.test(line)) {
        applyHomeMeasure(ing, 'כף', qty, prefs, keptAsWritten);
      } else if (/יח'|יחיד/.test(line) || (counted && !unitWord)) {
        ing.qty = qty;
        ing.unit = "יח'";
      }

      if (FLOUR_WORDS.some((k) => name.includes(k))) ing.flour = true;
      if (isLiq) ing.liquid = true;
      ingredients.push(ing);
      return;
    }

    if (line.length > 12) {
      steps.push({
        id: `s${i}`,
        text: line,
        temp: parseTemp(line),
        tempUnit: 'C',
        minutes: parseTime(line),
      });
    }
  });

  return { ingredients, steps, keptAsWritten, meta };
}

/**
 * Convert a cup/spoon line to grams (or millilitres) through the shared density
 * path, preserving the original wording in `note` exactly as before. When there
 * is no reliable density the line keeps its home measure — no invented number.
 */
function applyHomeMeasure(
  ing: IngredientLike,
  heUnit: 'כוס' | 'כף' | 'כפית',
  qty: number,
  prefs: MeasurementPrefs | undefined,
  keptAsWritten: ParsedRecipe['keptAsWritten'],
): void {
  const ml = mlPerUnit(heUnit, prefs);
  const d = densityFor({ name: ing.name }, prefs, heUnit);
  ing.note = `במקור ${qty} ${heUnit}`;

  if (ml == null || !d) {
    ing.qty = qty;
    ing.unit = heUnit;
    keptAsWritten.push({
      name: ing.name ?? '',
      unit: heUnit,
      reason: d
        ? 'אין גודל כלי מוגדר'
        : 'אין נתון צפיפות אמין — הכמות נשמרה כפי שנכתבה',
    });
    return;
  }

  const grams = (qty * ml * d.gPer100) / 100;
  ing.qty = Math.round(grams * 10) / 10;
  ing.unit = 'גרם';
}

export const SMART_PARSE_PROMPT = (text: string, categories: string[]): string =>
  `נתח את המתכון הבא והחזר JSON בלבד, בלי טקסט נוסף.
סכימה: {"name":string,"category":one of ${JSON.stringify(categories)},"tags":string[],"ingredients":[{"name":string,"qty":number,"unit":"גרם"|"ק\\"ג"|"מ\\"ל"|"ליטר"|"יח'","unitWeight":number|null,"flour":boolean,"liquid":boolean,"note":string}],"steps":[{"text":string,"temp":string,"minutes":number}]}
כללים: קטגוריה ויחידה רק מהרשימות הסגורות. כוסות וכפות להמיר לגרם או מ"ל ולשמור את הניסוח המקורי בשדה note. לשמור את נוסח השלבים כמעט כפי שהוא. אסור להמציא רכיבים, כמויות, זמנים, טמפרטורות או מחירים. אין שדה מחיר.
המתכון:
${text}`;
