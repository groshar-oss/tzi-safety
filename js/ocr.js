// סריקת תעודה בטלפון: קריאת שורות ה-MRZ (השורות עם >>> בתחתית הדרכון או בגב תעודת הזהות הביומטרית) ומילוי פרטי העובד.
// הקריאה נעשית בדפדפן עצמו (Tesseract), הצילום לא נשלח לשום שירות חיצוני.
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

// ספרת ביקורת של ICAO 9303 (משקלים 7, 3, 1)
const val = c => c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55;
export const mrzCheck = s => String([...s].reduce((t, c, i) => t + val(c) * [7, 3, 1][i % 3], 0) % 10);
// ספרת ביקורת של תעודת זהות ישראלית
export function ilIdOk(id) {
  const s = String(id || '').replace(/\D/g, ''); if (!s || s.length > 9) return false;
  return [...s.padStart(9, '0')].reduce((t, c, i) => { const x = +c * (i % 2 + 1); return t + (x > 9 ? x - 9 : x); }, 0) % 10 === 0;
}

const NAT = { ISR: 'ישראל', THA: 'תאילנד', CHN: 'סין', ROU: 'רומניה', MDA: 'מולדובה', UKR: 'אוקראינה', RUS: 'רוסיה', IND: 'הודו', LKA: 'סרי לנקה', UZB: 'אוזבקיסטן',
  PHL: 'פיליפינים', TUR: 'טורקיה', BGR: 'בולגריה', GEO: 'גאורגיה', NPL: 'נפאל', JOR: 'ירדן', EGY: 'מצרים', ETH: 'אתיופיה', ERI: 'אריתריאה', SDN: 'סודן', BLR: 'בלארוס', KAZ: 'קזחסטן', SRB: 'סרביה', POL: 'פולין', D: 'גרמניה', PSE: 'פלסטין' };
const LANG = { THA: 'th', CHN: 'zh', ROU: 'ro', MDA: 'ro', RUS: 'ru', UKR: 'ru', BLR: 'ru', KAZ: 'ru', UZB: 'ru', JOR: 'ar', EGY: 'ar', PSE: 'ar', SDN: 'ar' };
export const natName = c => NAT[(c || '').replace(/</g, '')] || (c || '').replace(/</g, '');
export const natLang = c => LANG[(c || '').replace(/</g, '')] || '';

// YYMMDD לתאריך. תאריך לידה: שנה עתידית שייכת למאה הקודמת
function date6(s, birth) {
  if (!/^\d{6}$/.test(s)) return '';
  const yy = +s.slice(0, 2), mm = s.slice(2, 4), dd = s.slice(4, 6), now = new Date().getFullYear() % 100;
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return '';
  return `${birth ? (yy > now ? 1900 : 2000) + yy : 2000 + yy}-${mm}-${dd}`;
}
const nameOf = s => { const [sur, giv = ''] = s.replace(/<+$/, '').split('<<'); const f = x => x.split('<').filter(Boolean).map(w => w[0] + w.slice(1).toLowerCase()).join(' ');
  return { surname: f(sur), given: f(giv), full: [f(giv), f(sur)].filter(Boolean).join(' ') }; };

// טעויות קריאה נפוצות בשדות של ספרות
const digits = s => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/G/g, '6');

// מקבל את הטקסט שנקרא ומחזיר את הפרטים, או null
export function parseMRZ(text) {
  const lines = String(text || '').toUpperCase().split(/\n/).map(l => l.replace(/[\s«]/g, '').replace(/[^A-Z0-9<]/g, '')).filter(l => l.length >= 28);
  // דרכון: 2 שורות של 44
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i], b = lines[i + 1];
    if (a.length >= 42 && b.length >= 42 && /^P/.test(a)) {
      const l1 = a.padEnd(44, '<').slice(0, 44), l2 = b.padEnd(44, '<').slice(0, 44);
      const num = l2.slice(0, 9), dob = digits(l2.slice(13, 19)), exp = digits(l2.slice(21, 27));
      const checks = { number: mrzCheck(num) === digits(l2[9]), birth: mrzCheck(dob) === digits(l2[19]), expiry: mrzCheck(exp) === digits(l2[27]) };
      const n = nameOf(l1.slice(5));
      return { kind: 'passport', id_type: 'passport', number: num.replace(/<+$/, ''), country: l1.slice(2, 5).replace(/</g, ''), nationality: l2.slice(10, 13).replace(/</g, ''),
        birth_date: date6(dob, true), expiry: date6(exp, false), sex: l2[20], name: n.full, ...n, checks, ok: checks.number && checks.birth };
    }
  }
  // תעודה בפורמט כרטיס (TD1): 3 שורות של 30, כמו תעודת זהות ביומטרית
  for (let i = 0; i + 2 < lines.length; i++) {
    const [a, b, c] = [lines[i], lines[i + 1], lines[i + 2]].map(x => x.padEnd(30, '<').slice(0, 30));
    if (!/^[IAC]/.test(a) || !/^[0-9OILSBZG]{6}/.test(b)) continue;
    const doc = a.slice(5, 14), opt = a.slice(15, 30), dob = digits(b.slice(0, 6)), exp = digits(b.slice(8, 14));
    const checks = { number: mrzCheck(doc) === digits(a[14]), birth: mrzCheck(dob) === digits(b[6]), expiry: mrzCheck(exp) === digits(b[14]) };
    const country = a.slice(2, 5).replace(/</g, ''), nationality = b.slice(15, 18).replace(/</g, '');
    // תעודה ישראלית: מספר תעודת הזהות (9 ספרות עם ספרת ביקורת תקינה) נמצא באחד השדות
    let number = doc.replace(/<+$/, ''), id_type = 'passport';
    if (country === 'ISR' || nationality === 'ISR') {
      const cands = [...`${digits(opt)} ${digits(doc)}`.matchAll(/\d{9}/g)].map(m => m[0]);
      const tz = cands.find(ilIdOk);
      if (tz) { number = tz; id_type = 'il'; }
    }
    const n = nameOf(c);
    return { kind: 'card', id_type, number, country, nationality, birth_date: date6(dob, true), expiry: date6(exp, false), sex: b[7], name: n.full, ...n, checks, ok: checks.birth && (id_type === 'il' || checks.number) };
  }
  return null;
}

// הכנת התמונה: הקטנה, אפור וחידוד ניגודיות. MRZ נמצא בחלק התחתון, אז קוראים קודם את התחתית
async function prep(file, part) {
  const bmp = await createImageBitmap(file);
  const W = Math.min(2000, bmp.width), sc = W / bmp.width, H = Math.round(bmp.height * sc);
  const y0 = part === 'bottom' ? Math.round(H * 0.55) : 0, h = H - y0;
  const c = document.createElement('canvas'); c.width = W; c.height = h;
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.6)'; g.drawImage(bmp, 0, -y0, W, H);
  return c;
}
let worker = null;
const loadTess = () => window.Tesseract ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = TESS; s.onload = res; s.onerror = () => rej(new Error('צריך קליטה בפעם הראשונה כדי לטעון את קורא התעודות')); document.head.appendChild(s); });
async function getWorker() {
  if (worker) return worker;
  await loadTess();
  worker = await window.Tesseract.createWorker('eng');
  await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', preserve_interword_spaces: '0' });
  return worker;
}
export async function scanId(file) {
  const w = await getWorker();
  for (const part of ['bottom', 'all']) {
    const { data } = await w.recognize(await prep(file, part));
    const r = parseMRZ(data.text);
    if (r) return r;
  }
  return null;
}

// ===== אישור עבודה בגובה: מציאת התוקף בצילום =====
// אם כתוב "בתוקף עד" לוקחים את התאריך הזה. אחרת לוקחים את התאריך האחרון שכבר עבר (מועד ההדרכה או ההנפקה) ומוסיפים שנתיים (תקנה 6(ג) לתקנות העבודה בגובה)
const iso = d => d.toISOString().slice(0, 10);
export function parseHeightDates(text, now = new Date()) {
  const lines = String(text || '').split(/\n/), found = [];
  const re = /(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{4}|\d{2})(?!\d)/g;
  lines.forEach((l, i) => {
    for (const m of l.matchAll(re)) {
      const d = +m[1], mo = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2010 || y > 2045) continue;
      const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCDate() !== d) continue;
      const before = l.slice(0, m.index) + ' ' + (lines[i - 1] || '');
      found.push({ iso: iso(dt), dt, until: /תוקף|בתוקף|תפוגה|valid|expir/i.test(before) });
    }
  });
  if (!found.length) return null;
  const t0 = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())), today = iso(t0);
  const max = new Date(t0); max.setUTCFullYear(max.getUTCFullYear() + 2); max.setUTCDate(max.getUTCDate() + 1);
  const byDate = (a, b) => a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0;
  const exp = found.filter(f => f.until && f.iso <= iso(max)).sort(byDate).pop();
  if (exp) return { until: exp.iso, from: null, how: 'until', expired: exp.iso < today };
  const past = found.filter(f => f.iso <= today).sort(byDate).pop();
  if (!past) return null;
  const u = new Date(past.dt); u.setUTCFullYear(u.getUTCFullYear() + 2);
  return { until: iso(u), from: past.iso, how: 'from', expired: iso(u) < today };
}
let hworker = null;
export async function scanHeight(file) {
  if (!hworker) { await loadTess(); hworker = await window.Tesseract.createWorker(['heb', 'eng']); }
  const { data } = await hworker.recognize(await prep(file, 'all'));
  return parseHeightDates(data.text);
}
