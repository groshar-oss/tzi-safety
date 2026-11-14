// עמודים שנפתחים בלי שם משתמש וסיסמה, מקישור אישי:
// #/i/<קוד> צפייה בלבד למפקח עבודה, מוגבלת בזמן
// #/t/<קוד> עובד חותם בטלפון שלו על קבלת הדרכה
import { db } from '../db.js';
import { esc, h, $, toast } from '../util.js';
import { LANGS, localStatement, langCode, OK_BTN, SIGN_HERE, READ_OK, SIGNED_OK } from '../langs.js';
import { TRAINING_KINDS } from '../workers.js';
import { pad } from './sign.js';
import { sectionsHtml } from './inspect.js';

export const publicRoute = () => { const m = (location.hash || '').match(/^#\/(i|t)\/([0-9a-f]{32,128})\/?$/i); return m ? { kind: m[1], token: m[2] } : null; };
const fmtDT = t => t ? new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const LOGO = '<div class="pub-brand"><img src="icons/tzi-logo-color.svg" alt="צי הנדסה – ניהול וביצוע"><span>ניהול בטיחות באתר</span></div>';

function page(inner) { const el = h(`<div class="pub">${LOGO}${inner}</div>`); $('#root').replaceChildren(el); return el; }
const fail = m => page(`<div class="card pub-msg"><h2>הקישור לא נפתח</h2><p>${esc(m || 'הקישור לא בתוקף')}</p></div>`);

export async function renderPublic({ kind, token }) {
  page('<div class="card pub-msg"><p class="mut">טוען…</p></div>');
  try { await db.init(); } catch (e) { return fail('אין חיבור לאינטרנט. צריך לנסות שוב כשיש קליטה.'); }
  try {
    if (kind === 'i') return inspectorPage(await db.rpc('share_inspector', { p_token: token }));
    return trainingPage(token, await db.rpc('share_training', { p_token: token }));
  } catch (e) { return fail(e.offline ? 'אין חיבור לאינטרנט. צריך לנסות שוב כשיש קליטה.' : e.message); }
}

// ===== צפייה למפקח עבודה =====
function inspectorPage(r) {
  const p = r.payload;
  const el = page(`<div class="card pub-head"><h1>${esc(r.site || '')}</h1>
      <div class="sub">צפייה בלבד${r.label ? ' · ' + esc(r.label) : ''}</div>
      <div class="small mut">הנתונים עודכנו ${esc(fmtDT(r.payload_at))} · הקישור בתוקף עד ${esc(fmtDT(r.expires_at))}</div>
      <div class="actions noprint"><button class="btn ghost" data-print>הדפסה / שמירה כ-PDF</button></div></div>
    ${p?.secs?.length ? sectionsHtml(p.secs, (url, i, j) => url ? `<a class="btn link" href="${esc(url)}" target="_blank" rel="noopener">קובץ</a>` : '') : '<div class="card empty">עוד אין נתונים להצגה בקישור הזה</div>'}
    <p class="small mut pub-foot">הדף הופק ממערכת ניהול הבטיחות של צי הנדסה. הנתונים מתעדכנים בכל פעם שמישהו מצוות האתר נכנס למערכת. הקישור אישי, לצפייה בלבד, ונסגר לבד במועד שנקבע.</p>`);
  $('[data-print]', el).onclick = () => window.print();
  document.title = 'צפייה באתר · ' + (r.site || '');
}

// ===== חתימת עובד על הדרכה =====
function trainingPage(token, r) {
  const t = r.training, w = r.worker;
  const lang = w.language && w.language !== 'he' && LANGS[w.language] ? w.language : null;
  const kindHe = TRAINING_KINDS[t.kind] || TRAINING_KINDS.other;
  const date = new Date().toLocaleDateString('he-IL');
  const he = `אני, ${w.name}, ${w.id_type === 'passport' ? 'דרכון' : 'ת"ז'} ${w.id_masked}, מאשר/ת שהיום, ${date}, קיבלתי ${kindHe} באתר ${r.site}, בנושא: ${t.topic}. ההדרכה ניתנה פנים אל פנים בידי ${t.trainer_name}, בשפה שאני מבין/ה (${t.language || '—'}), והבנתי אותה.`;
  const loc = lang ? localStatement(lang, { name: w.name, idType: w.id_type, id: '{{ID}}', kind: t.kind, site: r.site, trainer: t.trainer_name, trainingLang: t.language }) : null;
  const dir = lang ? LANGS[lang].dir : 'rtl';
  if (r.signed_at) {
    page(`<div class="card pub-msg ok"><div class="big-ok">✓</div><h2>${esc(w.name)}</h2><p>כבר חתמת על ההדרכה, ${esc(fmtDT(r.signed_at))}.</p>${lang ? `<p dir="${dir}" lang="${lang}">${esc(SIGNED_OK[lang])}</p>` : ''}</div>`);
    return;
  }
  const el = page(`<div class="card pub-sign">
      <div class="signname">${esc(w.name)}</div>
      <div class="sub">${esc(kindHe)} · ${esc(r.site)}</div>
      <div class="kv small"><span>נושא ההדרכה</span><b>${esc(t.topic)}</b><span>המדריך</span><b>${esc(t.trainer_name)}${t.trainer_title ? ' · ' + esc(t.trainer_title) : ''}</b><span>מועד</span><b>${esc(fmtDT(t.held_at))}</b></div>
      ${loc ? `<p class="signtext local" dir="${dir}" lang="${lang}">${esc(loc.replace('{{ID}}', w.id_masked))}</p><div class="small mut">הנוסח בעברית:</div>` : ''}
      <p class="signtext">${esc(he)}</p>
      <label class="chk big"><input type="checkbox" name="ok"> קראתי והבנתי${lang ? ` · <span dir="${dir}" lang="${lang}">${esc(READ_OK[lang])}</span>` : ''}</label>
      <canvas class="sgpad tall" aria-label="משטח חתימה"></canvas>
      <div class="actions"><button type="button" class="btn ghost" data-clear>ניקוי${lang ? ' · ' + esc(SIGN_HERE[lang]) : ''}</button><button type="button" class="btn big" data-ok>אישור וחתימה${lang ? ' · ' + esc(OK_BTN[lang]) : ''}</button></div>
      <p class="small mut">החתימה נשמרת במערכת הבטיחות של האתר עם שעת השרת, ולא ניתנת לשינוי. הקישור אישי לך בלבד.</p></div>`);
  const p = pad($('canvas', el));
  $('[data-clear]', el).onclick = p.clear;
  $('[data-ok]', el).onclick = async e => {
    if (!$('[name=ok]', el).checked) return toast('צריך לסמן "קראתי והבנתי"', 'bad');
    if (p.empty()) return toast('צריך לחתום במשטח', 'bad');
    e.target.disabled = true;
    try {
      await db.rpc('share_training_sign', { p_token: token, p_image: p.png(), p_local: loc, p_lang: lang, p_client_at: new Date().toISOString(), p_ua: navigator.userAgent.slice(0, 300) });
      page(`<div class="card pub-msg ok"><div class="big-ok">✓</div><h2>${esc(w.name)}</h2><p>${esc(SIGNED_OK.he)}</p>${lang ? `<p dir="${dir}" lang="${lang}">${esc(SIGNED_OK[lang])}</p>` : ''}</div>`);
    } catch (x) { e.target.disabled = false; toast(x.offline ? 'אין קליטה. החתימה לא נשלחה, צריך לנסות שוב.' : x.message, 'bad'); }
  };
  document.title = 'חתימה על הדרכה · ' + w.name;
  void langCode;
}
