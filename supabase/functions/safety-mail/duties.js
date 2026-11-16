// מנוע החובות: קטלוג החובות לפי הדין, פרופיל משפטי לאתר, יצירת מופעי חובה ומועדים, ורמות חריגה
// כל חובה כוללת מקור משפטי. הקטלוג נבנה לפי נוסח התקנות המשולב (תיקון התשפ"ו-2025, בתוקף מ-16.10.2026).

export const EFFECTIVE = '2026-10-16'; // תחילת תיקון תקנות עבודות בנייה
const DAY = 864e5, HOUR = 36e5;

export const LAW = {
  B: 'תקנות הבטיחות בעבודה (עבודות בנייה), התשמ"ח-1988',
  M: 'תקנות ארגון הפיקוח על העבודה (ממונים על הבטיחות), התשנ"ו-1996',
  H: 'תקנות ארגון הפיקוח על העבודה (מסירת מידע והדרכת עובדים), התשנ"ט-1999',
  P: 'פקודת הבטיחות בעבודה [נוסח חדש], התש"ל-1970',
  T: 'פקודת תאונות ומחלות משלח-יד (הודעה), 1945',
  S: 'תקנות ארגון הפיקוח על העבודה (תכנית לניהול הבטיחות), התשע"ג-2013',
  G: 'תקנות הבטיחות בעבודה (עבודה בגובה), התשס"ז-2007',
  Y: 'תקנות עבודת הנוער (עבודות אסורות ועבודות מוגבלות), התשנ"ו-1995',
  F: 'חוק עובדים זרים, התשנ"א-1991'
};

export const ROLES = {
  dev: 'נציג היזם (המזמין)',
  bakar: 'בקר בטיחות',
  con: 'מבצע הבנייה (קבלן ראשי)',
  so: 'ממונה על הבטיחות',
  sm: 'מנהל אתר',
  wm: 'מנהל עבודה',
  rep: 'נציג מבצע הבנייה באתר (ממלא חובות מנהל עבודה)',
  fa: 'אחראי עזרה ראשונה',
  sub: 'קבלן משנה',
  viewer: 'צופה'
};
// תפקידים שאפשר לרשום באתר: רק מה שהתקנות דורשות. "קבלן משנה" ו"צופה" לא נדרשים בתקנות ולכן לא נרשמים
export const ASSIGNABLE = ['dev', 'bakar', 'con', 'so', 'sm', 'wm', 'rep', 'fa'];
export const SIDE_OF = { dev: 'dev', bakar: 'dev', con: 'con', so: 'con', sm: 'con', wm: 'con', rep: 'con', fa: 'con', sub: 'con', viewer: 'dev' };

export const WORK_TYPES = {
  new: 'בנייה חדשה', addition: 'תוספת בנייה', fitout: 'גמר ופיט-אאוט במבנה קיים', renovation: 'שיפוץ במבנה קיים',
  infra: 'תשתיות ופיתוח', demolition: 'הריסה', gas: 'החלפת מיתקן גז לצריכה עצמית'
};
// עבודות באתר שמפעילות חובות נוספות של מנהל העבודה (או של מבצע הבנייה / נציגו כשאין מנהל עבודה)
export const ACTIVITIES = {
  excavation: ['חפירות, מילוי, חציבה או דיפון', 'ביקורת יומית לפני תחילת העבודה (תקנה 122)'],
  machines: ['מכונות עם חלקים מסוכנים (מסורים, מקדחות שולחן וכדומה)', 'ביקורת גידור יומית (תקנה 142א)'],
  formwork: ['טפסות שנדרשת להן תוכנית הנדסית', 'בדיקה ואישור לפני כל יציקה (תקנה 84)'],
  hoist: ['התקן הרמה עם גלגלת', 'בדיקה עם ההתקנה ולפני שימוש (תקנה 172)'],
  mech_scaffold: ['פיגום ממוכן (תלוי)', 'אי-הפעלה אחרי פגם עד תיקון (תקנה 52)'],
  crane: ['עגורן צריח', 'תקנות עגורני-צריח, תקנה 3(ב)'],
  roofs: ['עבודה על גגות שבירים או תלולים', 'תקנות עבודה על גגות שבירים או תלולים, תקנה 17(ב)']
};
export const STAGES = { excavation: 'חפירה', foundation: 'ביסוס', skeleton: 'שלד', finishes: 'גמר' };

// ===== פרופיל משפטי =====
export function derive(p = {}) {
  const workers = +p.workers_max || 0, area = +p.area || 0;
  const existing = ['fitout', 'renovation'].includes(p.work_type) && !!p.completion_cert;
  const exempt27 = (existing && !p.engineer_needed) || !!p.permit_exempt || p.work_type === 'gas';
  const exemptWhy = p.work_type === 'gas' ? 'החלפת מיתקן גז לצריכה עצמית (תקנה 2(ז)(3))'
    : p.permit_exempt ? 'עבודה פטורה מהיתר בנייה (תקנה 2(ז)(2))'
    : existing && !p.engineer_needed ? 'שיפוץ במבנה עם תעודת גמר שלא נדרש לו אישור מהנדס רשוי (תקנה 2(ז)(1))' : '';
  const selfBuild = !!p.self_build;
  const clientDuties = !exempt27 && !selfBuild;
  const contractors = Math.max(1, +p.contractors || 1);
  const devIsExecutor = contractors > 1 && !p.single_responsible;
  const planType = workers >= 50 ? 'mgmt' : exempt27 ? null : 'org';
  return {
    workers, area, existing, exempt27, exemptWhy, selfBuild, clientDuties, contractors, devIsExecutor, planType,
    planName: planType === 'mgmt' ? 'תוכנית לניהול הבטיחות (50 עובדים ומעלה)' : planType === 'org' ? 'תוכנית ארגון בטיחות לאתר (עד 49 עובדים, תקנה 166)' : 'לא נדרשת לפי תקנה 166 (עבודה מסוג 2(ז))',
    siteMgr: area >= 15000, so: workers >= 100, firstAidTrained: workers > 50,
    n192: (+p.duration_weeks || 0) >= 6, wmRequired: !exempt27,
    foreign: !!p.foreign_workers, scaffolds: !!p.scaffolds,
    act: Object.fromEntries(Object.keys(ACTIVITIES).map(k => [k, !!p.activities?.[k]])),
    workDays: Array.isArray(p.work_days) && p.work_days.length ? p.work_days.map(Number) : [0, 1, 2, 3, 4],
    checkinBy: /^\d\d:\d\d$/.test(p.checkin_by || '') ? p.checkin_by : '09:00',
    start: p.start_date || null
  };
}

// מזמין ובקר בטיחות: האם נדרשים ולמה (תקנות 1, 1א, 2(ז))
export const CLIENT_KINDS = { '': 'בחירה…', owner: 'בעל הנכס (עבודה בלי היתר)', permit: 'בעל ההיתר', tenant: 'שוכר / דייר שהזמין את העבודה' };
export function clientSummary(p = {}) {
  const d = derive(p);
  const why = d.clientDuties
    ? (p.permit_required && !p.permit_exempt ? 'העבודה טעונה היתר בנייה'
      : d.existing && p.engineer_needed ? 'נדרש אישור מהנדס רשוי (למשל שינוי בקונסטרוקציה)'
      : ['fitout', 'renovation'].includes(p.work_type) && !p.completion_cert ? 'המבנה לא קיבל תעודת גמר'
      : 'העבודה אינה מסוג 2(ז)')
    : (d.selfBuild ? 'עבודת בנייה עצמית' : d.exemptWhy);
  const text = d.clientDuties
    ? `נדרשים. ${why}, ולכן חלות חובות המזמין: אישור בכתב להתחלת העבודה ומינוי בקר בטיחות (תקנה 1א).`
    : `לא נדרשים לפי התקנות. ${why}, ולכן חובות המזמין, כולל מינוי בקר, לא חלות (תקנה 1א(ד)). אפשר לרשום אותם מרצון.`;
  const tenant = p.client_kind === 'tenant'
    ? 'המזמין שסומן הוא שוכר. לפי ההגדרה בתקנה 1, המזמין הוא בעל הנכס (בעבודה בלי היתר) או בעל ההיתר. התקנות לא מתייחסות לשוכר במפורש, ולכן כדאי לברר עם יועץ מי נושא בחובות המזמין.' : '';
  return { need: d.clientDuties, why, text, tenant };
}

// הסבר מילולי לפרופיל (מה חל ולמה)
export function profileNotes(p) {
  const d = derive(p), out = [];
  out.push(d.clientDuties
    ? ['ok', 'חובות המזמין חלות (תקנה 1א): מינוי בקר בטיחות, נספח משאבים בהסכם, וידוא תוכנית בטיחות ואישור בכתב להתחלת עבודה.']
    : ['na', `חובות המזמין לא חלות: ${d.selfBuild ? 'עבודת בנייה עצמית' : d.exemptWhy} (תקנה 1א(ד)).`]);
  if (d.exempt27) out.push(['warn', 'אין חובה למנות מנהל עבודה, אבל כל חובות מנהל העבודה חלות על מבצע הבנייה כל עוד לא מונה (תקנה 2(ז)). צריך לרשום נציג מבצע הבנייה באתר, עם כתב הסמכה חתום וצ\'ק-אין בכל יום עבודה, ולצרף מסמך שמוכיח את הפטור.']);
  const acts = Object.keys(ACTIVITIES).filter(k => d.act[k]);
  if (acts.length) out.push(['ok', 'חובות נוספות של ' + (d.exempt27 ? 'מנהל העבודה (או הנציג)' : 'מנהל העבודה') + ': ' + acts.map(k => ACTIVITIES[k][1]).join('; ') + '.']);
  out.push(['ok', `סוג תוכנית הבטיחות: ${d.planName}.`]);
  out.push(d.siteMgr ? ['ok', 'שטח לפי ההיתר 15,000 מ"ר ומעלה: חובה למנות מנהל אתר (תקנה 2(א)(2)).'] : ['na', 'אין חובת מנהל אתר (פחות מ-15,000 מ"ר). חובות מנהל האתר חלות על מנהל העבודה (תקנה 2(ח)).']);
  out.push(d.so ? ['ok', '100 עובדים ומעלה בו-זמנית: חובה למנות ממונה על הבטיחות (תקנה 4(3) לתקנות הממונים).'] : ['na', 'אין חובת מינוי ממונה על הבטיחות (פחות מ-100 עובדים), אלא אם מפקח אזורי הורה בכתב.']);
  if (d.firstAidTrained) out.push(['ok', 'מעל 50 עובדים: האחראי על ארגז העזרה הראשונה חייב להיות מאומן (תקנה 187).']);
  out.push(d.n192 ? ['ok', 'משך מעל 6 שבועות: חובת הודעה למפקח העבודה האזורי (ס\' 192 לפקודה, תקנה 6א).'] : ['na', 'משך צפוי פחות מ-6 שבועות: אין חובת הודעה לפי ס\' 192(ב). יש לאשר שההערכה סבירה.']);
  if (d.contractors > 1) out.push(d.devIsExecutor ? ['warn', 'יותר מקבלן ראשי אחד ואף אחד מהם לא קיבל אחריות כוללת בכתב: היזם הוא מבצע הבנייה ונושא בכל חובותיו (תקנה 6(ג)).'] : ['ok', 'אחד הקבלנים הראשיים קיבל בכתב אחריות כוללת של מבצע בנייה (תקנה 6(ד)).']);
  if (d.foreign) out.push(['ok', 'עובדים זרים: הדרכה נוספת של 8 שעות לפני תום חודש מהכניסה לישראל (תקנה 3א לתקנות ההדרכה).']);
  const cs = clientSummary(p); if (cs.tenant) out.push(['warn', cs.tenant]);
  if (p.active_before) out.push(['warn', 'האתר היה פעיל לפני 16.10.2026: החובות החדשות חלות ממועד התחילה. חובות שטרם בוצעו מופיעות כפער.']);
  return out;
}

// ===== קטלוג החובות =====
const always = () => true;
export const CATALOG = [
  // --- לפני התחלת עבודה: צד היזם ---
  { key: 'dev_bakar', side: 'dev', holder: 'dev', kind: 'pre', gate: true, critical: true, newLaw: true,
    title: 'מינוי בקר בטיחות והעברת פרטיו למבצע הבנייה', ref: `תקנות 1א(א)(3), 2א(א) ל${LAW.B}`,
    plain: 'בקר הבטיחות הוא מהנדס או הנדסאי רשום בהנדסה אזרחית, או ממונה על הבטיחות עם השתלמות ענפית בבנייה. אסור שיהיה גם מנהל העבודה, מנהל האתר או הממונה על הבטיחות באותו אתר.',
    evidence: 'כתב מינוי, מספר רישום או אישור כשירות, ואישור שהפרטים נמסרו לקבלן', applies: d => d.clientDuties },
  { key: 'dev_plan_check', side: 'dev', holder: 'dev', kind: 'pre', gate: true, newLaw: true,
    title: 'וידוא שהוכנה תוכנית בטיחות והעתקה בפנקס הכללי ובאתר', ref: `תקנה 1א(א)(1) ל${LAW.B}`,
    plain: 'המזמין לא יאשר התחלת עבודה לפני שהוכנה תוכנית בטיחות ושהעתק שלה נמצא בפנקס הכללי באתר.',
    evidence: 'עותק תוכנית הבטיחות החתומה', applies: d => d.clientDuties },
  { key: 'dev_resources', side: 'dev', holder: 'dev', kind: 'pre', gate: true, newLaw: true,
    title: 'פירוט משאבי יישום תוכנית הבטיחות בהסכם עם מבצע הבנייה', ref: `תקנה 1א(א)(2) ל${LAW.B}`,
    plain: 'בהסכם עם מבצע הבנייה צריך לפרט את המשאבים ליישום תוכנית הבטיחות, לפי פרקי התוכנית והסיכונים שבה. אם היזם הוא מבצע הבנייה, המשאבים מפורטים בתוכנית עצמה.',
    evidence: 'נספח משאבי בטיחות חתום', applies: d => d.clientDuties },
  { key: 'dev_multi', side: 'dev', holder: 'dev', kind: 'pre', gate: true,
    title: 'כמה קבלנים ראשיים: קבלת אחריות כוללת בכתב או נשיאה בחובות מבצע הבנייה', ref: `תקנה 6(ג), 6(ד) ל${LAW.B}`,
    plain: 'כשהעבודה מוטלת על יותר מקבלן ראשי אחד, היזם נחשב מבצע הבנייה, אלא אם אחד הקבלנים קיבל בכתב את האחריות הכוללת ושלח הודעה למפקח העבודה האזורי.',
    evidence: 'כתב קבלת אחריות והודעה למפקח, או החלטה שהיזם נושא בחובות', applies: d => d.contractors > 1 },
  // --- לפני התחלת עבודה: צד הקבלן ---
  { key: 'con_wm', side: 'con', holder: 'con', kind: 'pre', gate: true, critical: true,
    title: 'מינוי מנהל עבודה רשום במרשם מנהלי העבודה והודעה מקוונת למפקח', ref: `תקנות 2(א)(1), 6א ל${LAW.B}`,
    plain: 'אסור להתחיל או להמשיך עבודה בלי מנהל עבודה רשום בסיווג המתאים, שנמצא באתר ומשגיח על העבודה (תקנה 2(ב)).',
    evidence: 'כתב מינוי, מספר רישום במרשם ואישור הגשת ההודעה המקוונת', applies: d => d.wmRequired },
  { key: 'con_sm', side: 'con', holder: 'con', kind: 'pre', gate: true, newLaw: true,
    title: 'מינוי מנהל אתר והודעה מקוונת למפקח', ref: `תקנות 2(א)(2), 2ב(א), 6א ל${LAW.B}`,
    plain: 'באתר ששטחו לפי ההיתר 15,000 מ"ר לפחות. מנהל האתר הוא מהנדס או הנדסאי רשום בהנדסה אזרחית, ולא מנהל העבודה או הבקר באותו אתר.',
    evidence: 'כתב מינוי, מספר רישום ואישור הגשה', applies: d => d.siteMgr },
  { key: 'con_plan', side: 'con', holder: 'con', kind: 'pre', gate: true, newLaw: true,
    title: 'הכנת תוכנית בטיחות, חתימת מבצע הבנייה ומסירת העתק לבקר ולמנהל האתר', ref: `תקנות 2(א)(3), 166 והתוספת השלישית ל${LAW.B}; ${LAW.S}`,
    plain: 'עד 49 עובדים בו-זמנית: תוכנית ארגון בטיחות (8 פרקים). 50 ומעלה: תוכנית לניהול הבטיחות. העתק מצורף לפנקס הכללי ונמצא באתר.',
    evidence: 'תוכנית חתומה ואישור מסירה לבקר ולמנהל האתר', applies: d => !!d.planType },
  { key: 'con_notice_start', side: 'con', holder: 'con', kind: 'pre', gate: true,
    title: 'הודעה מקוונת למפקח העבודה האזורי על התחלת עבודה ועל מינוי בעלי התפקידים', ref: `תקנה 6א(א)(1) ל${LAW.B}; סעיף 192 ל${LAW.P}`,
    plain: 'ההודעה מוגשת בטופס המקוון של משרד העבודה. המפקח מנפיק אישור הגשה, והעתקו נשמר בפנקס הכללי.',
    evidence: 'מספר אישור ההגשה וקובץ האישור', applies: d => d.n192 || d.clientDuties },
  { key: 'con_sign', side: 'con', holder: 'con', kind: 'pre', gate: true,
    title: 'שלט אתר עם כל הפרטים הנדרשים', ref: `תקנה 7 ל${LAW.B}`,
    plain: 'מבצע הבנייה, מנהל העבודה, מהות העבודה, המזמין, בקר הבטיחות ומספר רישומו, ומנהל האתר ומספר רישומו. אתר בלי שלט נחשב "לא מוסדר" לעניין צו הפסקת עבודה אחרי תאונה.',
    evidence: 'צילום השלט באתר', applies: always },
  { key: 'con_firstaid', side: 'con', holder: 'con', kind: 'pre', gate: true,
    title: 'מינוי אחראי ארגז עזרה ראשונה, הצגת שמו באתר ורישומו בפנקס', ref: `תקנה 187 ל${LAW.B}`,
    plain: 'האחראי נמצא באתר כל שעות העבודה. באתר עם יותר מ-50 עובדים הוא חייב להיות מאומן בעזרה ראשונה.',
    evidence: 'שם האחראי וצילום ההודעה באתר', applies: always },
  { key: 'con_so', side: 'con', holder: 'con', kind: 'pre', gate: true,
    title: 'מינוי ממונה על הבטיחות', ref: `תקנה 4(3) ל${LAW.M}`,
    plain: 'חובה כשמבצע הבנייה מעסיק, בעצמו או דרך קבלני משנה, 100 עובדים ומעלה בו-זמנית, או כשמפקח אזורי הורה בכתב.',
    evidence: 'כתב מינוי ואישור כשירות של הממונה', applies: d => d.so },
  { key: 'dev_start_approval', side: 'dev', holder: 'dev', kind: 'pre', gate: 'final', critical: true, newLaw: true,
    title: 'אישור בכתב של המזמין להתחלת עבודה', ref: `תקנות 1א(א), 2(א)(4) ל${LAW.B}`,
    plain: 'מבצע הבנייה לא יתחיל לעבוד בלי אישור בכתב מהמזמין, והמזמין לא יאשר לפני שכל התנאים התקיימו. המערכת מאפשרת לאשר רק כשכל תנאי שער ההתחלה ירוקים.',
    evidence: 'מסמך אישור התחלה חתום', applies: d => d.clientDuties },

  // --- אתר פטור ממינוי מנהל עבודה (תקנה 2(ז)) ---
  { key: 'con_exempt_proof', side: 'con', holder: 'con', kind: 'pre', gate: true, critical: true, newLaw: true,
    title: 'תיעוד הבסיס לפטור ממינוי מנהל עבודה (תקנה 2(ז))', ref: `תקנות 1 (הגדרת "עבודות שיפוץ"), 2(ז) ל${LAW.B}`,
    plain: 'מצרפים את המסמך שמוכיח שהעבודה בפטור: בשיפוץ, תעודת גמר של המבנה והצהרת מהנדס או אדריכל שלא נדרש אישור מהנדס רשוי לפי סעיף 12; בעבודה פטורה מהיתר, המסמך שמראה את הפטור; בהחלפת מיתקן גז, תיאור העבודה. עד הצירוף הסיווג לא מאומת, ויש לעבוד עם מנהל עבודה רשום. שינוי בהיקף העבודה (למשל פתיחת קיר נושא) מחייב לעדכן את הפרופיל.',
    evidence: 'תעודת גמר והצהרת מהנדס/אדריכל, או מסמך הפטור מהיתר', applies: d => d.exempt27 },
  { key: 'con_rep', side: 'con', holder: 'con', kind: 'pre', gate: true, critical: true, newLaw: true,
    title: 'רישום נציג מבצע הבנייה באתר וכתב הסמכה חתום (או מינוי מנהל עבודה רשום)', ref: `תקנות 2(ב), 2(ז), 2(ט), 2ג ל${LAW.B}`,
    plain: 'כל עוד לא מונה מנהל עבודה, החובות שלו חלות על מבצע הבנייה. בפועל צריך אדם בשם שנמצא באתר ומבצע אותן מטעם המבצע. מפיקים כתב הסמכה מלשונית "בעלי תפקידים", חותמים ומצרפים כאן. כתב ההסמכה נכנס לפנקס הכללי. האחריות לפי הדין נשארת על מבצע הבנייה.',
    evidence: 'כתב הסמכה חתום על ידי מבצע הבנייה והנציג', applies: d => d.exempt27 },
  { key: 'daily_checkin', side: 'con', holder: 'wm', kind: 'daily', critical: true, warnH: 2,
    title: 'צ\'ק-אין יומי והשגחה באתר (מנהל העבודה או נציג מבצע הבנייה)', ref: `תקנות 2(ב), 2ג ל${LAW.B}`,
    plain: 'מבצע הבנייה עובד רק בנוכחות ובהשגחה של מנהל העבודה. באתר פטור לפי 2(ז), המערכת דורשת שהנציג או ממלא מקומו יסמנו נוכחות בכל יום עבודה (קריאה שמרנית של הדין, ברוח הפסיקה). יום בלי צ\'ק-אין נשאר פתוח עד שמסבירים אותו.',
    evidence: 'צ\'ק-אין מהטלפון, עם ביקורות היום', applies: always },

  // --- חובות חוזרות ---
  { key: 'bakar_visit', side: 'dev', holder: 'bakar', kind: 'recur', every: 90, warnH: 14 * 24, newLaw: true,
    title: 'ביקור בקר בטיחות באתר (לפחות אחת לשלושה חודשים)', ref: `תקנה 2א(ב)(1) ל${LAW.B}`,
    plain: 'בכל ביקור הבקר בודק את יישום תוכנית הבטיחות, המענים לסיכונים, אמצעי המיגון וההדרכות. אחרי הביקור נפתחת חובת דוח תוך 48 שעות.',
    evidence: 'תאריך הביקור ורשימת ממצאים', spawn: 'bakar_report', applies: d => d.clientDuties },
  { key: 'sm_control', side: 'con', holder: 'sm', kind: 'recur', every: 30, warnH: 5 * 24, newLaw: true,
    title: 'בקרת יישום המענים שבתוכנית הבטיחות ודוח למבצע הבנייה (כל 30 יום)', ref: `תקנות 2ב(ב)(2), 2(ח) ל${LAW.B}`,
    plain: 'אם אין חובת מנהל אתר, החובה חלה על מנהל העבודה.', evidence: 'דוח הבקרה', applies: d => d.siteMgr || !d.exempt27 },
  { key: 'sm_training', side: 'con', holder: 'sm', kind: 'recur', every: 30, warnH: 5 * 24, newLaw: true,
    title: 'בקרת קיום הדרכות לעובדים ודוח למבצע הבנייה (כל 30 יום)', ref: `תקנות 2ב(ב)(4), 2(ח) ל${LAW.B}`,
    plain: 'בודקים שכל העובדים באתר עברו הדרכה לפי תקנה 3 לתקנות ההדרכה.', evidence: 'דוח הבקרה', applies: d => d.siteMgr || !d.exempt27 },
  { key: 'training_annual', side: 'con', holder: 'con', kind: 'recur', every: 365, warnH: 30 * 24, firstAt: 0,
    title: 'הדרכת בטיחות פרונטלית לעובדים ורישום בפנקס ההדרכה (לפני תחילת עבודה ואחת לשנה)', ref: `תקנות 3(א), 3(א2), 6, 10 ל${LAW.H}`,
    plain: 'באתר בנייה ההדרכה פנים אל פנים בלבד, בשפה המובנת לעובד, בידי בעל מקצוע מתאים שחתם על הצהרה. אסור להעסיק עובד שלא הודרך.',
    evidence: 'רשימת משתתפים חתומה והצהרת המדריך', applies: always },
  { key: 'scaffold_weekly', side: 'con', holder: 'wm', kind: 'recur', every: 7, warnH: 48,
    title: 'בדיקת פיגומים ורישום בפנקס הכללי (לפחות אחת ל-7 ימים)', ref: `תקנה 20 ל${LAW.B}`,
    plain: 'בנוסף: עם ההתקנה ולפני השימוש, אחרי הפסקה של 3 ימים ומעלה, אחרי הפסקה בגלל גשם או רוח, ואחרי כל שינוי.',
    evidence: 'רישום הבדיקה בפנקס הכללי', applies: d => d.scaffolds },

  // --- חובות מתמשכות ---
  { key: 'foreign_training', side: 'con', holder: 'con', kind: 'ongoing',
    title: 'הדרכה נוספת של 8 שעות לכל עובד זר, לפני תום חודש מכניסתו לישראל, ונספח בפנקס ההדרכה', ref: `תקנה 3א ל${LAW.H} (תיקון התשפ"ו-2026)`,
    plain: 'במוסד הכשרה מוכר ובשפת העובד. הנספח כולל שם, דרכון, אזרחות, תאריך כניסה ראשונה, תאריך ההדרכה ושם המוסד. מעקב לכל עובד יתווסף בשלב העובדים.',
    evidence: 'נוהל, רשימת עובדים זרים ומועדי הדרכה', applies: d => d.foreign },

  // --- חובות שנוצרות מאירוע ---
  { key: 'bakar_report', side: 'dev', holder: 'bakar', kind: 'event', dueH: 48, warnH: 12, newLaw: true,
    title: 'דוח ממצאי ביקור בכתב למזמין ולמבצע הבנייה (תוך 48 שעות מהביקור)', ref: `תקנות 2א(ב)(3), 2א(ד) ל${LAW.B}`,
    plain: 'הדוח נמסר למזמין ולמבצע הבנייה, ומבצע הבנייה מצרף אותו לפנקס הכללי.', evidence: 'דוח הביקור' },
  { key: 'con_respond', side: 'con', holder: 'con', kind: 'event', dueH: 24, warnH: 12, critical: true,
    title: 'מענה מיידי לסיכון שאינו קביל ועדכון תוכנית הבטיחות', ref: `תקנה 2(ו) ל${LAW.B}`,
    plain: 'לסיכון שאינו קביל המבצע נותן מענה מיד ומעדכן את התוכנית. במערכת "מיידי" מסומן באדום אחרי 24 שעות.', evidence: 'תיאור המענה וצילום לפני ואחרי' },
  { key: 'dev_approve48', side: 'dev', holder: 'dev', kind: 'event', dueH: 48, warnH: 24, critical: true, newLaw: true,
    title: 'אישור בכתב של המזמין שניתן מענה לסיכון שדווח, ומסירתו למבצע הבנייה (תוך 48 שעות)', ref: `תקנה 1א(ג) ל${LAW.B}`,
    plain: 'נספר מרגע הדיווח של בקר הבטיחות, כולל שבת וחג. האישור נעשה במערכת ולא בהודעה.', evidence: 'אישור המזמין' },
  { key: 'so_report48', side: 'con', holder: 'so', kind: 'event', dueH: 48, warnH: 12, newLaw: true,
    title: 'דיווח ממונה הבטיחות למנהל העבודה ולמנהל האתר, כולל מפגעים קודמים שטרם הוסרו (תוך 48 שעות)', ref: `תקנה 5א(א)(1)-(3) ל${LAW.B}`,
    plain: 'נוסף על הדיווח למבצע הבנייה. העתק מצורף לפנקס הכללי.', evidence: 'הדיווח' },
  { key: 'so_stop_notice', side: 'con', holder: 'so', kind: 'event', dueH: 24, warnH: 6, critical: true, newLaw: true,
    title: 'הפסקת עבודה בידי הממונה: דיווח מיידי למנהל העבודה, לבקר ולמנהל האתר, וטופס מקוון למפקח', ref: `תקנה 5א(א)(4) והתוספת הראשונה ל${LAW.B}`,
    plain: '', evidence: 'הדיווח ואישור הגשת הטופס' },
  { key: 'sm_stop_report', side: 'con', holder: 'sm', kind: 'event', dueH: 24, warnH: 6, critical: true, newLaw: true,
    title: 'הפסקת עבודה בידי מנהל האתר: דיווח מיידי בכתב למבצע הבנייה, למזמין ולבקר', ref: `תקנה 2ב(ב)(5) ל${LAW.B}`,
    plain: 'כשיש סיכון שאינו קביל וחסרים משאבים למענה.', evidence: 'הוראת ההפסקה והדיווח' },
  { key: 'dev_bakar_left', side: 'dev', holder: 'dev', kind: 'event', dueH: 24, warnH: 6, critical: true, newLaw: true,
    title: 'בקר הבטיחות סיים כהונה: הודעה מיידית למבצע הבנייה', ref: `תקנה 1א(ב) ל${LAW.B}`, plain: '', evidence: 'ההודעה' },
  { key: 'dev_bakar_replace', side: 'dev', holder: 'dev', kind: 'ongoing', critical: true, newLaw: true,
    title: 'מינוי בקר בטיחות מחליף. עד המינוי, חובות הבקר חלות על היזם', ref: `תקנה 1א(ב) ל${LAW.B}`,
    plain: 'אחרי המינוי, מבצע הבנייה מדווח עליו למפקח בטופס מקוון.', evidence: 'כתב מינוי הבקר החדש' },
  { key: 'con_role_left_notice', side: 'con', holder: 'con', kind: 'event', dueH: 24, warnH: 6, critical: true,
    title: 'מנהל העבודה או מנהל האתר הפסיק לכהן: הודעה מקוונת מיידית למפקח', ref: `תקנות 2(ג), 6א(א)(3) ל${LAW.B}`, plain: '', evidence: 'אישור הגשה' },
  { key: 'con_wm_replace', side: 'con', holder: 'con', kind: 'ongoing', critical: true,
    title: 'מינוי מנהל עבודה חדש. עד המינוי אסור להמשיך בעבודה', ref: `תקנה 2(ד) ל${LAW.B}`, plain: '', evidence: 'כתב מינוי והודעה מקוונת' },
  { key: 'accident_notice', side: 'con', holder: 'con', kind: 'event', dueH: 24, warnH: 6, critical: true,
    title: 'הודעה בכתב למפקח העבודה האזורי על תאונה (מוות או אי-כושר מעל 3 ימים)', ref: `סעיף 3 ל${LAW.T}`,
    plain: 'החובה על המעסיק של הנפגע. בתאונה קשה המפקח רשאי לסגור את האתר בצו לשני ימי עבודה (סעיף 6א לחוק ארגון הפיקוח על העבודה).', evidence: 'ההודעה' },
  { key: 'scaffold_recheck', side: 'con', holder: 'wm', kind: 'event', dueH: 24, warnH: 6,
    title: 'בדיקת פיגומים לפני חידוש העבודה אחרי הפסקה (גשם, רוח או 3 ימים ומעלה) או שינוי', ref: `תקנה 20(ב) ל${LAW.B}`, plain: '', evidence: 'רישום הבדיקה בפנקס' },
  { key: 'con_rep_resume', side: 'con', holder: 'con', kind: 'event', dueH: 24, warnH: 6, critical: true, newLaw: true,
    title: 'מנהל העבודה עזב אתר פטור: חובותיו חזרו למבצע הבנייה. לרשום נציג או מנהל עבודה חדש לפני יום העבודה הבא', ref: `תקנה 2(ז) ל${LAW.B}`,
    plain: 'באתר מסוג 2(ז) אין חובת מינוי, ולכן לא חלה עצירת העבודה של תקנה 2(ד). אבל עד שיש אדם באתר שמבצע את החובות, אין מי שמשגיח.', evidence: 'שם הנציג החדש וכתב הסמכה, או כתב מינוי מנהל עבודה' },
  { key: 'scaffold_install_check', side: 'con', holder: 'wm', kind: 'event', dueH: 0, warnH: 0, critical: true,
    title: 'פיגום חדש: בדיקת רכיבים ופסילת רכיב לא מתאים, ובדיקת הפיגום עם ההתקנה ולפני השימוש', ref: `תקנות 19, 20(ב) ל${LAW.B}`,
    plain: 'רכיב שנפסל מורחק מהאתר וההוראה נרשמת בפנקס הכללי. אם הפיגום נבנה בידי בונה מקצועי לפיגומי זקפים, הבדיקה נעשית יחד איתו. אסור להשתמש בפיגום לפני הבדיקה.', evidence: 'רישום הבדיקה בפנקס הכללי' },
  { key: 'formwork_check', side: 'con', holder: 'wm', kind: 'event', dueH: 0, warnH: 0, critical: true, newLaw: true,
    title: 'בדיקת מערכת הטפסות ואישור לפני יציקה, רישום בפנקס ומסירת האישור למבצע הבנייה', ref: `תקנה 84 ל${LAW.B}`,
    plain: 'כשנדרשת תוכנית הנדסית לטפסות (תקנה 85): אסור לצקת לפני הבדיקה והאישור.', evidence: 'רישום הבדיקה ואישור בכתב' },
  { key: 'hoist_check', side: 'con', holder: 'wm', kind: 'event', dueH: 0, warnH: 0, critical: true,
    title: 'בדיקת התקן הרמה (גלגלת, שלוחה, עיגון, כבל) עם ההתקנה ולפני שימוש, ורישום בפנקס', ref: `תקנה 172(ד) ל${LAW.B}`,
    plain: '', evidence: 'רישום הבדיקה בפנקס הכללי' },
  { key: 'mech_scaffold_fix', side: 'con', holder: 'wm', kind: 'ongoing', critical: true,
    title: 'פגם בפיגום ממוכן: אסור להפעיל עד התיקון. רישום התיקון בפנקס הכללי', ref: `תקנות 51(ד), 52 ל${LAW.B}`,
    plain: 'מנהל העבודה ומבצע הבנייה אחראים שהפיגום לא יופעל עד התיקון.', evidence: 'רישום התיקון בפנקס' },
  { key: 'con_notice_end', side: 'con', holder: 'con', kind: 'event', dueH: 24, warnH: 6,
    title: 'הודעה מקוונת למפקח על סיום העבודה', ref: `תקנה 6א(א)(2) ל${LAW.B}`, plain: '', evidence: 'אישור הגשה' }
];
// ===== תוקף: חובה לכל עובד ולכל ציוד, לפי תאריך התוקף. המפתח: exp_xxx:<מזהה> =====
// נוצרות ונסגרות לבד מפנקס העובדים ומרשימת הציוד, לא ידנית
export const EXPIRY = [
  { key: 'exp_train', side: 'con', holder: 'wm', kind: 'expiry', critical: true, warnH: 14 * 24, ref: `תקנות 3(א), 6 ל${LAW.H}`,
    plain: 'אסור להעסיק עובד שלא קיבל הדרכה לפני תחילת העבודה ואחת לשנה. נסגר לבד כשהעובד חותם על הדרכה שנתית או הדרכת עובד חדש.', evidence: 'חתימת העובד על הדרכה' },
  { key: 'exp_height', side: 'con', holder: 'wm', kind: 'expiry', critical: true, warnH: 14 * 24, ref: `תקנות 5, 6(ג), 6(ד) ל${LAW.G}`,
    plain: 'עבודה בגובה רק עם אישור בתוקף (עד שנתיים). נסגר לבד כשמעדכנים תוקף חדש וצילום של האישור בכרטיס העובד.', evidence: 'אישור עבודה בגובה בתוקף' },
  { key: 'exp_permit', side: 'con', holder: 'wm', kind: 'expiry', critical: true, warnH: 14 * 24, ref: `סעיפים 1יג, 2 ל${LAW.F}`,
    plain: 'אסור להעסיק עובד זר בלי היתר והרשאה לעבוד בישראל. נסגר לבד כשמעדכנים תוקף חדש בכרטיס העובד.', evidence: 'היתר בתוקף' },
  { key: 'exp_f8', side: 'con', holder: 'wm', kind: 'expiry', critical: true, warnH: 10 * 24, ref: `תקנה 3א ל${LAW.H}`,
    plain: 'עובד זר עובר הדרכה נוספת של 8 שעות במוסד הכשרה מוכר, בשפתו, לפני תום חודש מכניסתו לישראל. נסגר לבד כשמזינים את תאריך ההדרכה והמוסד בכרטיס העובד.', evidence: 'אישור המוסד' },
  { key: 'exp_equip', side: 'con', holder: 'con', kind: 'expiry', critical: true, warnH: 30 * 24, ref: `סעיפים 75, 76, 81, 86 ל${LAW.P}`,
    plain: 'מכונת הרמה נבדקת בידי בודק מוסמך לפחות אחת ל-14 חודשים, ושרשראות, חבלים ואביזרי הרמה אחת ל-6 חודשים. אין להשתמש בציוד בלי תסקיר בתוקף. נסגר לבד כשמזינים תסקיר חדש.', evidence: 'תסקיר בודק מוסמך' }
];
const CAT0 = Object.fromEntries([...CATALOG, ...EXPIRY].map(c => [c.key, c]));
// חובת תוקף נמצאת לפי תחילת המפתח (exp_height:<id> → exp_height)
export const CAT = new Proxy(CAT0, { get: (t, k) => t[k] ?? (typeof k === 'string' && k.includes(':') ? t[k.split(':')[0]] : undefined) });

// אירועים שהמשתמש מדווח, ומה כל אחד פותח
export const EVENTS = {
  unacceptable: { label: 'סיכון שאינו קביל דווח', spawn: ['con_respond', 'dev_approve48'], critical: true },
  bakar_visit: { label: 'ביקור בקר בטיחות בוצע', spawn: ['bakar_report'] },
  so_hazard: { label: 'הממונה איתר מפגע או הפרה', spawn: ['so_report48'] },
  so_stop: { label: 'הממונה הורה על הפסקת עבודה', spawn: ['so_stop_notice'], critical: true },
  sm_stop: { label: 'מנהל האתר הורה על הפסקת עבודה', spawn: ['sm_stop_report'], critical: true },
  bakar_left: { label: 'בקר הבטיחות סיים כהונה', spawn: ['dev_bakar_left', 'dev_bakar_replace'], critical: true },
  wm_left: { label: 'מנהל העבודה הפסיק לכהן', spawn: ['con_role_left_notice', 'con_wm_replace'], critical: true },
  smgr_left: { label: 'מנהל האתר הפסיק לכהן', spawn: ['con_role_left_notice'], critical: true },
  accident: { label: 'תאונה: מוות או אי-כושר מעל 3 ימים', spawn: ['accident_notice'], critical: true },
  weather_stop: { label: 'הפסקת עבודה בגלל גשם או רוח, או 3 ימים ומעלה', spawn: ['scaffold_recheck'] },
  scaffold_installed: { label: 'הותקן פיגום חדש', spawn: ['scaffold_install_check'] },
  scaffold_changed: { label: 'נעשה שינוי בפיגום', spawn: ['scaffold_recheck'] },
  pour_planned: { label: 'מתוכננת יציקה בטפסות', spawn: ['formwork_check'] },
  hoist_installed: { label: 'הותקן התקן הרמה (גלגלת)', spawn: ['hoist_check'] },
  mech_scaffold_defect: { label: 'נמצא פגם בפיגום ממוכן', spawn: ['mech_scaffold_fix'], critical: true },
  work_end: { label: 'העבודה באתר הסתיימה', spawn: ['con_notice_end'] }
};

// ===== מועדים =====
const ms = s => s ? new Date(s.length === 10 ? s + 'T08:00:00' : s).getTime() : null;
const iso = t => t == null ? null : new Date(t).toISOString();
function anchor(site, c) {
  const st = ms(site.profile?.start_date) ?? ms(site.created_at) ?? Date.now();
  return c.newLaw ? Math.max(st, ms(EFFECTIVE)) : st;
}
const WARN = { pre: 7 * 24, recur: 5 * 24, event: 12, ongoing: 0 };
export const warnHours = (c, st = {}) => +(st.warn?.[c.key] ?? c.warnH ?? WARN[c.kind]);

export function newInstance(site, c, { due = null, event = null, seq = 1 } = {}) {
  return { site_id: site.id, key: c.key, side: c.side, holder: c.holder, kind: c.kind, title: c.title, ref: c.ref, critical: !!c.critical,
    due_at: iso(due), status: 'open', event_id: event?.id || null, seq, auto: true };
}

// מסנכרן את מופעי החובה של אתר מול הפרופיל. מחזיר מה להוסיף ומה לעדכן (לא מוחק אף פעם)
export function sync(site, inst, now = Date.now()) {
  const d = derive(site.profile || {});
  const add = [], upd = [];
  const byKey = k => inst.filter(i => i.key === k);
  for (const c of CATALOG) {
    if (c.kind === 'event') continue;
    if (c.key === 'dev_bakar_replace' || c.key === 'con_wm_replace' || c.key === 'mech_scaffold_fix') continue; // נוצרות מאירוע
    if (c.kind === 'daily') continue; // נוצרת לפי לוח ימי העבודה, למטה
    const ok = c.applies(d), list = byKey(c.key);
    const open = list.filter(i => i.status === 'open');
    if (!ok) {
      for (const i of open) upd.push({ id: i.id, status: 'na', na_reason: 'לא חל לפי הפרופיל המשפטי של האתר', closed_at: new Date().toISOString() });
      continue;
    }
    const autoNa = list.filter(i => i.status === 'na' && i.na_reason === 'לא חל לפי הפרופיל המשפטי של האתר');
    if (c.kind === 'recur') {
      if (open.length) continue;
      if (autoNa.length && !list.some(i => i.status === 'done')) { upd.push({ id: autoNa.at(-1).id, status: 'open', na_reason: null, closed_at: null }); continue; }
      const done = list.filter(i => i.status === 'done' || i.status === 'waived').sort((a, b) => ms(b.done_at || b.closed_at) - ms(a.done_at || a.closed_at))[0];
      const base = done ? ms(done.done_at || done.closed_at) : anchor(site, c) - (c.firstAt === 0 ? c.every * DAY : 0);
      add.push(newInstance(site, c, { due: base + c.every * DAY, seq: list.length + 1 }));
    } else {
      if (list.some(i => i.status !== 'na')) continue;
      if (autoNa.length) { upd.push({ id: autoNa.at(-1).id, status: 'open', na_reason: null, closed_at: null }); continue; }
      add.push(newInstance(site, c, { due: c.kind === 'pre' ? anchor(site, c) : null }));
    }
  }
  // ביקור בקר בכל שלב בנייה שהוזן לו תאריך (ברירת מחדל: עד 14 יום מתחילת השלב)
  if (d.clientDuties) for (const [k, label] of Object.entries(STAGES)) {
    const dt = site.profile?.stages?.[k]; if (!dt) continue;
    const key = 'bakar_stage_' + k;
    if (!inst.some(i => i.key === key)) add.push({ ...newInstance(site, { key, side: 'dev', holder: 'bakar', kind: 'stage', critical: false,
      title: `ביקור בקר בטיחות בשלב ה${label}`, ref: `תקנה 2א(ב)(1) ל${LAW.B}` }, { due: Math.max(ms(dt), ms(EFFECTIVE)) + 14 * DAY }) });
  }
  // צ'ק-אין יומי: מופע לכל יום עבודה מתחילת העבודה, עד היום (לא אחורה יותר מ-7 ימים, ולא לפני 16.10.2026)
  const c = CAT.daily_checkin;
  if (isWorking(site)) {
    const today = dayKey(now);
    const first = Math.max(ms(d.start) ?? now, ms(EFFECTIVE), now - 6 * DAY, ms(site.created_at) || 0);
    for (let t = startOfDay(first); t <= now; t += DAY) {
      const dt = new Date(t), key = dayKey(t);
      if (!d.workDays.includes(dt.getDay())) continue;
      if (inst.some(i => i.key === 'daily_checkin' && i.seq === +key)) continue;
      const [hh, mm] = d.checkinBy.split(':').map(Number);
      add.push(newInstance(site, c, { due: new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), hh, mm).getTime(), seq: +key }));
      if (key === today) break;
    }
  }
  return { add, upd };
}
export const dayKey = t => { const x = new Date(t); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`; };
const startOfDay = t => { const x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); };
// אתר שעובדים בו: התחיל (תאריך התחלה עבר) ולא הושבת או הסתיים
export const isWorking = (site, now = Date.now()) => !['stopped', 'closed_order', 'done'].includes(site.status) && (ms(site.profile?.start_date) ?? Infinity) <= now
  && (site.status === 'active' || site.status === 'approved' || derive(site.profile || {}).exempt27 || !derive(site.profile || {}).clientDuties);

// אירוע: יוצר מופעים לפי סוג האירוע
export function spawnForEvent(site, ev) {
  const d = derive(site.profile || {});
  const def = EVENTS[ev.type]; if (!def) return [];
  const t = ms(ev.occurred_at);
  let keys = def.spawn;
  if (ev.type === 'wm_left' && d.exempt27) keys = ['con_rep_resume']; // באתר 2(ז) אין עצירה ואין חובת הודעה על מינוי שלא היה חובה
  return keys.map(k => CAT[k]).filter(c => c && !(c.key === 'dev_approve48' && !d.clientDuties))
    .map(c => newInstance(site, c, { due: c.kind === 'ongoing' ? null : t + c.dueH * HOUR, event: ev }));
}

// ===== רמות חריגה =====
// ok: בוצע · na: לא חל · plan: מתוכנן · info: מידע · warn: אזהרה · red: חריגה · crit: קריטי
export const LEVELS = {
  crit: { label: 'קריטי', color: '#7a0f0f', chip: 'red', rank: 5 },
  red: { label: 'חריגה', color: '#c62828', chip: 'red', rank: 4 },
  warn: { label: 'אזהרה', color: '#e08a00', chip: 'amber', rank: 3 },
  info: { label: 'מידע', color: '#3D5A78', chip: 'blue', rank: 2 },
  plan: { label: 'מתוכנן', color: '#8a93b0', chip: '', rank: 1 },
  ok: { label: 'בוצע', color: '#13804a', chip: 'green', rank: 0 },
  na: { label: 'לא חל', color: '#9aa1b5', chip: '', rank: 0 }
};

export function level(i, now = Date.now(), st = {}) {
  if (i.status === 'done' || i.status === 'waived') return 'ok';
  if (i.status === 'na') return 'na';
  const c = CAT[i.key] || { kind: i.kind, warnH: 14 * 24 };
  if (i.critical && (i.kind === 'event' || i.kind === 'ongoing')) return 'crit';
  if (!i.due_at) return i.critical ? 'crit' : 'info';
  const left = ms(i.due_at) - now, wh = warnHours(c, st) * HOUR;
  if (left < 0) return i.critical ? 'crit' : 'red';
  if (left <= wh) return 'warn';
  if (left <= Math.max(wh * 2, 7 * DAY)) return 'info';
  return 'plan';
}
export const overdueHours = (i, now = Date.now()) => i.due_at && i.status === 'open' ? Math.max(0, (now - ms(i.due_at)) / HOUR) : 0;

// זמן שנותר, בעברית
export function leftText(i, now = Date.now()) {
  if (!i.due_at) return i.status === 'open' ? 'ללא מועד, פתוח עד ביצוע' : '';
  const diff = ms(i.due_at) - now, a = Math.abs(diff);
  const s = a < HOUR ? `${Math.max(1, Math.round(a / 6e4))} דק'` : a < 48 * HOUR ? `${Math.round(a / HOUR)} שעות` : `${Math.round(a / DAY)} ימים`;
  return diff < 0 ? `באיחור של ${s}` : `נותרו ${s}`;
}

// שער התחלה: כל חובות ה-gate (חוץ מהאישור עצמו) בוצעו או לא חלות
export function gateStatus(inst) {
  const g = inst.filter(i => CAT[i.key]?.gate === true);
  const missing = g.filter(i => i.status === 'open');
  return { items: g, missing, ready: !missing.length };
}

// ===== נמענים =====
// מי אחראי בפועל (כולל העברת חובה כשבעל התפקיד לא מונה) ומי מקבל לידיעה לפי רמה והסלמה
export function responsibleRoles(i, site, people) {
  const d = derive(site.profile || {});
  const has = r => people.some(p => p.site_id === site.id && p.role === r && p.active !== false);
  let r = [i.holder], note = '';
  if (i.holder === 'bakar' && !has('bakar')) { r = ['dev']; note = 'אין בקר בטיחות ממונה: חובות הבקר חלות על היזם (תקנה 1א(ב))'; }
  if (i.holder === 'sm' && !has('sm')) { r = has('wm') ? ['wm'] : ['con']; note = 'אין מנהל אתר: החובה חלה על מנהל העבודה (תקנה 2(ח))'; }
  if (i.holder === 'wm' && !has('wm')) {
    if (d.exempt27 && has('rep')) { r = ['rep']; note = 'אין מנהל עבודה (תקנה 2(ז)): החובה חלה על מבצע הבנייה ומבוצעת על ידי הנציג שלו באתר'; }
    else { r = ['con']; note = d.exempt27 ? 'אין מנהל עבודה ואין נציג באתר: החובה חלה על מבצע הבנייה (תקנה 2(ז)). צריך לרשום נציג' : 'אין מנהל עבודה רשום: החובה חלה על מבצע הבנייה, ואסור לעבוד עד המינוי (תקנה 2(ד))'; }
  }
  if (i.holder === 'sm' && r.includes('wm') && !has('wm') && d.exempt27) r = has('rep') ? ['rep'] : ['con'];
  if (i.holder === 'so' && !has('so')) r = ['con'];
  if (d.devIsExecutor && r.includes('con')) { r = [...r, 'dev']; note = note || 'היזם הוא מבצע הבנייה (כמה קבלנים ראשיים, תקנה 6(ג))'; }
  return { roles: [...new Set(r)], note };
}

export function recipients(i, site, people, now = Date.now(), st = {}) {
  const lv = level(i, now, st);
  const { roles, note } = responsibleRoles(i, site, people);
  const cc = new Set();
  const late = overdueHours(i, now);
  if (lv === 'crit') ['dev', 'con', 'bakar', 'sm', 'wm', 'so'].forEach(r => cc.add(r));
  if (lv === 'red') { cc.add('dev'); cc.add('con'); }
  if (late >= 24) { cc.add('sm'); cc.add('so'); }
  if (late >= 48) { cc.add('con'); cc.add('dev'); }
  if (roles.includes('rep')) cc.add('con'); // מבצע הבנייה מקבל עותק של כל חובה שהנציג מבצע מטעמו
  roles.forEach(r => cc.delete(r));
  const act = people.filter(p => p.site_id === site.id && p.active !== false);
  const pick = rs => act.filter(p => rs.includes(p.role) && !p.backup);
  const backups = rs => act.filter(p => rs.includes(p.role) && p.backup);
  const main = pick(roles);
  const extra = late >= 24 || lv === 'crit' ? backups(roles) : []; // מחליף מקבל כשהאחראי לא הגיב
  return { level: lv, roles, note, to: [...main, ...extra], cc: pick([...cc]) };
}
