// GENERATED from design_handoff_recipe_notebook/data.js — do not edit by hand.
// Regenerate with: node scripts/generate-demo-data.mjs
//
// These are the prototype's five demo recipes, typed. They are seed content for
// development only; once Supabase is connected a new account starts empty and
// may import them explicitly.

import type { Recipe } from '@recipe-notebook/engine';

export const DEMO_CATEGORIES: readonly string[] = [
  "בצקים",
  "לחמים",
  "קרמים ומילויים",
  "גנאשים ורטבים",
  "עוגות ועוגיות",
  "מנות חמות",
  "אחר"
];

export const DEMO_CONTACTS: readonly { id: string; name: string; role: string }[] =
  [
  {
    "id": "u1",
    "name": "דנה לוי",
    "role": "קונדיטורית, מטבח מרכזי"
  },
  {
    "id": "u2",
    "name": "אחותי — מיכל",
    "role": "איש קשר פרטי"
  },
  {
    "id": "u3",
    "name": "יוסי אברהם",
    "role": "שף מסעדת לביא"
  },
  {
    "id": "u4",
    "name": "צוות הבוקר",
    "role": "4 אנשים"
  },
  {
    "id": "u5",
    "name": "רותם בן חיים",
    "role": "סטאז'רית"
  }
];

export const DEMO_RECIPES: readonly Recipe[] = [
  {
    "id": "ganache",
    "name": "גנאש שוקולד מריר 64%",
    "category": "גנאשים ורטבים",
    "tags": [
      "בסיס",
      "מילוי"
    ],
    "isSub": true,
    "locked": false,
    "yieldUnits": 0,
    "unitWeight": 0,
    "yieldActual": 1140,
    "targetFC": 22,
    "createdAt": "2025-11-02",
    "ingredients": [
      {
        "id": "g1",
        "name": "שמנת מתוקה 38%",
        "qty": 500,
        "unit": "גרם",
        "liquid": true,
        "price": 24,
        "priceUnit": "ליטר"
      },
      {
        "id": "g2",
        "name": "שוקולד מריר 64%",
        "qty": 600,
        "unit": "גרם",
        "price": 62,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "g3",
        "name": "גלוקוז",
        "qty": 40,
        "unit": "גרם",
        "price": 18,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "g4",
        "name": "חמאה 82%",
        "qty": 50,
        "unit": "גרם",
        "price": 38,
        "priceUnit": "ק\"ג",
        "note": "קרה, בקוביות"
      }
    ],
    "steps": [
      {
        "id": "s1",
        "text": "מרתיחים את השמנת עם הגלוקוז.",
        "temp": "",
        "minutes": ""
      },
      {
        "id": "s2",
        "text": "יוצקים על השוקולד בשלוש פעימות ומערבבים מהמרכז החוצה עד אמולסיה מלאה.",
        "temp": "",
        "minutes": ""
      },
      {
        "id": "s3",
        "text": "כשהגנאש מתחת ל־40 מעלות מוסיפים את החמאה ומערבבים בבלנדר מקל בלי להכניס אוויר.",
        "temp": "40",
        "tempUnit": "C",
        "minutes": ""
      },
      {
        "id": "s4",
        "text": "מכסים במגע ומייצבים בקירור.",
        "temp": "",
        "minutes": "720"
      }
    ],
    "shelfLife": "7 ימים בקירור",
    "storage": "כלי אטום, מכוסה במגע",
    "freezing": "עד חודש",
    "thawing": "לילה בקירור, לערבב לפני שימוש",
    "equipment": "בלנדר מקל, סיר, מרזב סיליקון",
    "notes": "אם הגנאש נשבר — מוסיפים כף שמנת חמה ומערבבים במרכז עד שחוזר לחיבור.",
    "issues": [
      {
        "id": "i1",
        "p": "גנאש גרגירי או שמנוני",
        "s": "אמולסיה נשברה. לחמם ל־35 ולערבב בבלנדר מקל."
      },
      {
        "id": "i2",
        "p": "גנאש נוזלי מדי",
        "s": "שוקולד עם אחוז מוצקים נמוך. להוריד שמנת ב־5%."
      }
    ],
    "trials": [
      {
        "id": "t1",
        "date": "2025-11-14",
        "note": "מעבר לגלוקוז 40 גרם — מרקם חלק יותר, מבריק ביום השני."
      }
    ]
  },
  {
    "id": "brioche",
    "name": "בריוש נאנטר",
    "category": "בצקים",
    "tags": [
      "שמרים",
      "עשיר"
    ],
    "isSub": false,
    "locked": true,
    "yieldUnits": 12,
    "unitWeight": 85,
    "yieldActual": 1150,
    "weightBefore": 100,
    "weightAfter": 88,
    "targetFC": 25,
    "doughMode": true,
    "ddt": 24,
    "flourTemp": 21,
    "roomTemp": 26,
    "friction": 8,
    "createdAt": "2025-09-08",
    "ingredients": [
      {
        "id": "b1",
        "name": "קמח לחם 13% חלבון",
        "qty": 500,
        "unit": "גרם",
        "flour": true,
        "price": 5.4,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "b2",
        "name": "ביצים",
        "qty": 5,
        "unit": "יח'",
        "unitWeight": 55,
        "liquid": true,
        "price": 22,
        "priceUnit": "ק\"ג",
        "note": "בטמפ' החדר"
      },
      {
        "id": "b3",
        "name": "חלב 3%",
        "qty": 60,
        "unit": "מ\"ל",
        "liquid": true,
        "price": 6.5,
        "priceUnit": "ליטר"
      },
      {
        "id": "b4",
        "name": "סוכר",
        "qty": 60,
        "unit": "גרם",
        "price": 4.2,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "b5",
        "name": "שמרים טריים",
        "qty": 20,
        "unit": "גרם",
        "price": 14,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "b6",
        "name": "מלח",
        "qty": 11,
        "unit": "גרם",
        "price": 3,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "b7",
        "name": "חמאה 82%",
        "qty": 250,
        "unit": "גרם",
        "price": 38,
        "priceUnit": "ק\"ג",
        "note": "קרה, בקוביות"
      }
    ],
    "steps": [
      {
        "id": "bs1",
        "text": "לשים קמח, ביצים, חלב, סוכר ושמרים בווים 4 דקות במהירות נמוכה.",
        "minutes": "4"
      },
      {
        "id": "bs2",
        "text": "מוסיפים מלח וממשיכים 6 דקות עד פיתוח גלוטן בינוני.",
        "minutes": "6"
      },
      {
        "id": "bs3",
        "text": "מוסיפים חמאה בשלושה חלקים, כל חלק נבלע לפני הבא. הבצק מסיים ב־24 מעלות.",
        "temp": "24",
        "tempUnit": "C",
        "minutes": "10"
      },
      {
        "id": "bs4",
        "text": "תפיחה ראשונה בטמפרטורת החדר עד עלייה של שליש, ואז קיפול ולילה בקירור.",
        "minutes": "60"
      },
      {
        "id": "bs5",
        "text": "מחלקים ל־12, מעגלים, מניחים בתבניות ומתפיחים עד שלושה רבעים.",
        "minutes": "120"
      },
      {
        "id": "bs6",
        "text": "מברישים בביצה ואופים בתנור סטטי.",
        "temp": "165",
        "tempUnit": "C",
        "minutes": "18"
      }
    ],
    "shelfLife": "יום אחד באיכות מלאה",
    "storage": "שקית נייר בטמפ' החדר",
    "freezing": "להקפיא אפוי, עטוף פעמיים",
    "thawing": "20 דקות בטמפ' החדר, חימום 3 דקות ב־160",
    "equipment": "מיקסר עם וו לישה, תבניות בריוש, מברשת",
    "pan": {
      "kind": "loaf",
      "width": 11,
      "length": 30,
      "height": 7
    },
    "notes": "החמאה חייבת להיות קרה אך גמישה. בצק שמתחמם מעל 26 מעלות משחרר שומן ולא יתפח כראוי.",
    "issues": [
      {
        "id": "bi1",
        "p": "הבצק שמנוני ונקרע",
        "s": "התחמם יתר על המידה. לקרר 20 דקות ולהמשיך ללוש."
      },
      {
        "id": "bi2",
        "p": "הבריוש שקע אחרי האפייה",
        "s": "תפיחה יתרה. לקצר את התפיחה השנייה לשלושה רבעים."
      }
    ],
    "trials": [
      {
        "id": "bt1",
        "date": "2025-09-19",
        "note": "הורדת שמרים מ־25 ל־20 גרם והארכת קירור לילה — ארומה נקייה יותר."
      },
      {
        "id": "bt2",
        "date": "2025-10-03",
        "note": "אפייה ב־165 במקום 180 — קרום דק וצבע אחיד."
      }
    ]
  },
  {
    "id": "croissant",
    "name": "קרואסון חמאה",
    "category": "בצקים",
    "tags": [
      "למינציה",
      "בוקר"
    ],
    "isSub": false,
    "locked": false,
    "yieldUnits": 33,
    "unitWeight": 53,
    "yieldActual": 2180,
    "weightBefore": 100,
    "weightAfter": 82,
    "targetFC": 24,
    "doughMode": true,
    "ddt": 22,
    "flourTemp": 20,
    "roomTemp": 24,
    "friction": 6,
    "createdAt": "2025-10-11",
    "ingredients": [
      {
        "id": "c1",
        "name": "קמח לחם 12.5% חלבון",
        "qty": 1000,
        "unit": "גרם",
        "flour": true,
        "price": 5.4,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "c2",
        "name": "מים",
        "qty": 420,
        "unit": "מ\"ל",
        "liquid": true
      },
      {
        "id": "c3",
        "name": "חלב 3%",
        "qty": 100,
        "unit": "מ\"ל",
        "liquid": true,
        "price": 6.5,
        "priceUnit": "ליטר"
      },
      {
        "id": "c4",
        "name": "סוכר",
        "qty": 120,
        "unit": "גרם",
        "price": 4.2,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "c5",
        "name": "מלח",
        "qty": 22,
        "unit": "גרם",
        "price": 3,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "c6",
        "name": "שמרים טריים",
        "qty": 35,
        "unit": "גרם",
        "price": 14,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "c7",
        "name": "חמאה 82% ללישה",
        "qty": 60,
        "unit": "גרם",
        "price": 38,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "c8",
        "name": "חמאת למינציה 84%",
        "qty": 500,
        "unit": "גרם",
        "price": 44,
        "priceUnit": "ק\"ג",
        "note": "יריעה, 14 מעלות"
      }
    ],
    "steps": [
      {
        "id": "cs1",
        "text": "לשים את כל מרכיבי הבצק 6 דקות עד פיתוח חלקי. הבצק מסיים ב־22 מעלות.",
        "temp": "22",
        "tempUnit": "C",
        "minutes": "6"
      },
      {
        "id": "cs2",
        "text": "משטחים למלבן, עוטפים ומקררים לילה ב־4 מעלות.",
        "temp": "4",
        "tempUnit": "C",
        "minutes": "720"
      },
      {
        "id": "cs3",
        "text": "עוטפים את יריעת החמאה ועושים קיפול כפול ואחריו קיפול יחיד, עם מנוחה של 40 דקות בין קיפולים.",
        "minutes": "80"
      },
      {
        "id": "cs4",
        "text": "מרדדים ל־3.5 מ\"מ, חותכים משולשים של 65 גרם ומגלגלים.",
        "minutes": "30"
      },
      {
        "id": "cs5",
        "text": "מתפיחים ב־26 מעלות עד הכפלה וריחוף ברור של השכבות.",
        "temp": "26",
        "tempUnit": "C",
        "minutes": "150"
      },
      {
        "id": "cs6",
        "text": "אופים בתנור טורבו, 8 דקות ואז הנמכה ל־170 לעוד 10 דקות.",
        "temp": "190",
        "tempUnit": "C",
        "minutes": "18"
      }
    ],
    "shelfLife": "שש שעות מהאפייה",
    "storage": "מגש פתוח, לא בקירור",
    "freezing": "להקפיא מגולגל לפני תפיחה",
    "thawing": "תפיחה ישירה מהקפאה, 3 שעות ב־26 מעלות",
    "equipment": "מרדד או מערוך, סכין פיצה, מתפיח",
    "notes": "טמפרטורת החמאה והבצק חייבות להיות זהות. הפרש של שלוש מעלות שובר את השכבות.",
    "issues": [
      {
        "id": "ci1",
        "p": "חמאה נשפכת באפייה",
        "s": "למינציה לא אטומה או תפיחה יתרה. לבדוק אטימת קצוות ולקצר תפיחה."
      },
      {
        "id": "ci2",
        "p": "חלות דבש במקום שכבות",
        "s": "תפיחה בטמפרטורה גבוהה מדי. להתפיח ב־26 ולא מעל."
      }
    ],
    "trials": [
      {
        "id": "ct1",
        "date": "2025-10-28",
        "note": "קיפול כפול + יחיד במקום שלושה יחידים — חלת דבש פתוחה יותר."
      }
    ]
  },
  {
    "pan": {
      "kind": "round",
      "diameter": 20,
      "height": 5
    },
    "id": "pastrycream",
    "name": "קרם פטיסייר וניל",
    "category": "קרמים ומילויים",
    "tags": [
      "בסיס"
    ],
    "isSub": true,
    "locked": false,
    "yieldUnits": 0,
    "unitWeight": 0,
    "yieldActual": 1490,
    "targetFC": 20,
    "createdAt": "2025-08-22",
    "ingredients": [
      {
        "id": "p1",
        "name": "חלב 3%",
        "qty": 1,
        "unit": "ליטר",
        "liquid": true,
        "price": 6.5,
        "priceUnit": "ליטר"
      },
      {
        "id": "p2",
        "name": "חלמונים",
        "qty": 8,
        "unit": "יח'",
        "unitWeight": 18,
        "liquid": true,
        "price": 34,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "p3",
        "name": "סוכר",
        "qty": 200,
        "unit": "גרם",
        "price": 4.2,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "p4",
        "name": "קורנפלור",
        "qty": 90,
        "unit": "גרם",
        "price": 9,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "p5",
        "name": "חמאה 82%",
        "qty": 80,
        "unit": "גרם",
        "price": 38,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "p6",
        "name": "מקל וניל",
        "qty": 1,
        "unit": "יח'",
        "unitWeight": 3,
        "price": 900,
        "priceUnit": "ק\"ג"
      }
    ],
    "steps": [
      {
        "id": "ps1",
        "text": "מרתיחים חלב עם הווניל ומשהים מכוסה עשר דקות.",
        "minutes": "10"
      },
      {
        "id": "ps2",
        "text": "מקציפים חלמונים עם סוכר וקורנפלור עד בהיר.",
        "minutes": "2"
      },
      {
        "id": "ps3",
        "text": "ממזגים, מחזירים לסיר ומבשלים תוך טריפה עד רתיחה של דקה שלמה.",
        "temp": "85",
        "tempUnit": "C",
        "minutes": "3"
      },
      {
        "id": "ps4",
        "text": "מורידים מהאש, מוסיפים חמאה, מסננים ומקררים במגש דק מכוסה במגע.",
        "minutes": ""
      }
    ],
    "shelfLife": "3 ימים בקירור",
    "storage": "מגש דק, ניילון במגע",
    "freezing": "לא מתאים להקפאה",
    "thawing": "—",
    "equipment": "סיר, מטרפה, מסננת, מגש גסטרונום",
    "notes": "רתיחה של דקה שלמה הכרחית לנטרול האנזים בחלמון, אחרת הקרם ידלול בקירור.",
    "issues": [
      {
        "id": "pi1",
        "p": "הקרם נוזלי אחרי קירור",
        "s": "לא הגיע לרתיחה מלאה. לבשל שוב עם קורנפלור נוסף."
      }
    ],
    "trials": []
  },
  {
    "id": "brioche-choc",
    "name": "בריוש שוקולד",
    "category": "בצקים",
    "tags": [
      "גרסה"
    ],
    "isSub": false,
    "locked": false,
    "versionOf": "brioche",
    "versionNote": "הוספת גנאש כמילוי והורדת סוכר בבצק",
    "yieldUnits": 12,
    "unitWeight": 105,
    "yieldActual": 1400,
    "weightBefore": 100,
    "weightAfter": 89,
    "targetFC": 26,
    "doughMode": true,
    "ddt": 24,
    "flourTemp": 21,
    "roomTemp": 26,
    "friction": 8,
    "createdAt": "2026-01-16",
    "ingredients": [
      {
        "id": "x1",
        "name": "קמח לחם 13% חלבון",
        "qty": 500,
        "unit": "גרם",
        "flour": true,
        "price": 5.4,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "x2",
        "name": "ביצים",
        "qty": 5,
        "unit": "יח'",
        "unitWeight": 55,
        "liquid": true,
        "price": 22,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "x3",
        "name": "חלב 3%",
        "qty": 60,
        "unit": "מ\"ל",
        "liquid": true,
        "price": 6.5,
        "priceUnit": "ליטר"
      },
      {
        "id": "x4",
        "name": "סוכר",
        "qty": 40,
        "unit": "גרם",
        "price": 4.2,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "x5",
        "name": "שמרים טריים",
        "qty": 20,
        "unit": "גרם",
        "price": 14,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "x6",
        "name": "מלח",
        "qty": 11,
        "unit": "גרם",
        "price": 3,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "x7",
        "name": "חמאה 82%",
        "qty": 250,
        "unit": "גרם",
        "price": 38,
        "priceUnit": "ק\"ג"
      },
      {
        "id": "x8",
        "name": "גנאש שוקולד מריר 64%",
        "qty": 300,
        "unit": "גרם",
        "subId": "ganache",
        "countSubFormula": false,
        "note": "מקורר, בשק זילוף"
      }
    ],
    "steps": [
      {
        "id": "xs1",
        "text": "לשים את הבצק כמו בריוש נאנטר.",
        "minutes": "20"
      },
      {
        "id": "xs2",
        "text": "לילה בקירור, מרדדים, מורחים גנאש ומגלגלים לרולדה.",
        "minutes": ""
      },
      {
        "id": "xs3",
        "text": "חותכים, מניחים בתבניות, מתפיחים ואופים.",
        "temp": "165",
        "tempUnit": "C",
        "minutes": "20"
      }
    ],
    "shelfLife": "יום אחד",
    "storage": "שקית נייר",
    "freezing": "עד שבועיים אפוי",
    "thawing": "20 דקות בטמפ' החדר",
    "equipment": "מיקסר, מערוך, שק זילוף",
    "notes": "",
    "issues": [],
    "trials": [
      {
        "id": "xt1",
        "date": "2026-02-02",
        "note": "גנאש קר מונע נזילה בגלגול."
      }
    ]
  }
];
