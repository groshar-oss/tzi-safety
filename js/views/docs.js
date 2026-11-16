// מסמכים להדפסה: כתב הסמכה לנציג מבצע הבנייה, ושלט אתר לפי תקנה 7
import { S, siteOrgs, conNames } from '../app.js';
import { derive, ACTIVITIES, CAT, ROLES, LAW } from '../duties.js';
import { esc, fmtDate } from '../util.js';

const LOGO = () => new URL('icons/tzi-logo-color.svg', location.href).href;
// עמוד להדפסה במיתוג צי הנדסה. bar = הודעה למסך בלבד (לא מודפסת)
const page = (title, body, bar = '') => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap" rel="stylesheet">
<style>body{font-family:Heebo,Arial,sans-serif;color:#1C232C;max-width:780px;margin:24px auto;padding:0 18px;line-height:1.6;background:#fff}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px;color:#3D5A78}.mut{color:#68717D;font-size:13px}table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border:1px solid #DDE1E6;padding:6px 8px;text-align:right;vertical-align:top}th{background:#EEF0F2;color:#1C232C}.sig{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:36px}
.sig div{border-top:1px solid #1C232C;padding-top:6px;font-size:13px}.bar{position:sticky;top:0;background:#fff;padding:8px 0;margin-bottom:10px;border-bottom:1px solid #DDE1E6;font-size:13px;color:#68717D}
.bar p{margin:6px 0 0}button{font:inherit;padding:6px 16px;border-radius:8px;border:1px solid #3D5A78;background:#3D5A78;color:#fff;cursor:pointer}
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:3px solid #1C232C;padding-bottom:10px;margin-bottom:16px}.head img{height:58px}
.head .dot{width:9px;height:9px;border-radius:50%;background:#E8912D;display:inline-block;margin-inline-end:6px}
.sign{border:8px solid #1C232C;border-radius:14px;padding:24px 28px 18px;font-size:20px;position:relative}
.sign .logo{display:block;height:92px;margin:0 auto 10px}
.sign h1{font-size:38px;text-align:center;margin:0 0 4px;letter-spacing:.02em}
.sign .rule{height:4px;background:#3D5A78;border-radius:2px;margin:10px auto 18px;width:70%;position:relative}
.sign .rule::after{content:"";position:absolute;inset-inline-end:-10px;top:-5px;width:14px;height:14px;border-radius:50%;background:#E8912D}
.sign table{font-size:19px}.sign th{width:34%;background:#EEF0F2;font-size:18px}.sign td{font-size:20px;font-weight:600;padding:10px 12px}
.note{font-size:12px;color:#68717D;margin-top:10px}@media print{.bar{display:none}body{margin:0}}</style></head>
<body><div class="bar"><button onclick="print()">הדפסה / שמירה כ-PDF</button>${bar}</div>${body}</body></html>`;

function open(html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) location.href = url;
}

// רשימת חובות מנהל העבודה שהנציג מבצע באתר הזה (לפי הפרופיל)
export function wmDutiesFor(site) {
  const d = derive(site.profile || {});
  const out = [
    ['נוכחות והשגחה באתר בכל יום עבודה, וצ\'ק-אין במערכת', 'תקנות 2(ב), 2ג'],
    ['פיקוח מטעם מבצע הבנייה על עמידה בהוראות הבטיחות לפי התקנות, וביצוע כל חובה שהוטלה על מנהל עבודה לפי כל דין', 'תקנה 2ג'],
    ['הכרת הקבלנים שנכנסים לאתר ווידוא שהם עובדים לפי הוראות הבטיחות ובתיאום ביניהם', 'ע"א 1051/14'],
    ['רישום הבדיקות וההוראות בפנקס הכללי, ושמירת העתק באתר', 'תקנה 2(ט)']
  ];
  if (d.scaffolds) out.push(['בדיקת רכיבי פיגום ופסילה; בדיקת פיגום עם ההתקנה, אחת ל-7 ימים, אחרי הפסקה ואחרי שינוי; רישום בפנקס', 'תקנות 19, 20']);
  for (const [k, [what, ref]] of Object.entries(ACTIVITIES)) if (d.act[k]) out.push([what + ': ' + ref.replace(/ \(.*\)$/, ''), ref.match(/\((.*)\)/)?.[1] || ref]);
  return out;
}

// נוסח כתב ההסמכה (בלי חתימות). זה הנוסח שנחתם, וממנו מחושבת טביעת האצבע
// ctx: בעמוד ההרשמה בלי כניסה אין נתוני אתר בדפדפן, והשרת מוסר את שמות הקבלן וממלאי המקום (invite_info)
export function authLetterBody(site, person, ctx = null) {
  const con = (ctx ? ctx.con || [] : conNames(site.id)).join(', ') || '________________';
  const backups = ctx ? ctx.backups || [] : S.data.site_people.filter(p => p.site_id === site.id && p.role === 'rep' && p.backup && p.active !== false && p.id !== person.id);
  const rows = wmDutiesFor(site).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('');
  return `<h2>הצדדים והאתר</h2>
    <table><tr><th>מבצע הבנייה</th><td>${esc(con)}</td></tr><tr><th>האתר</th><td>${esc(site.name)}, ${esc(site.address || '')}</td></tr>
      <tr><th>הנציג</th><td>${esc(person.name)}${person.phone ? ' · ' + esc(person.phone) : ''}${person.email ? ' · ' + esc(person.email) : ''}</td></tr>
      ${backups.length ? `<tr><th>ממלא מקום</th><td>${backups.map(b => esc(b.name) + (b.phone ? ' · ' + esc(b.phone) : '')).join('<br>')}</td></tr>` : ''}
      <tr><th>מתאריך</th><td>${esc(fmtDate(person.from_date) || '________')}${person.to_date ? ' עד ' + esc(fmtDate(person.to_date)) : ''}</td></tr></table>
    <h2>ההסמכה</h2>
    <p>העבודות באתר הן מסוג העבודות שבתקנה 2(ז), ולכן מבצע הבנייה אינו חייב במינוי מנהל עבודה, וכל עוד לא מינה מנהל עבודה חלות עליו גם החובות החלות על מנהל עבודה.</p>
    <p>מבצע הבנייה מסמיך בזה את הנציג לבצע מטעמו, באתר, את חובות מנהל העבודה המפורטות להלן, ולהיות נוכח ומשגיח באתר בכל יום שבו מתבצעת עבודה. כשהנציג אינו באתר, ממלא מקומו מבצע את החובות.</p>
    <table><tr><th>החובה</th><th>מקור</th></tr>${rows}</table>
    <p><b>האחריות לפי הדין נשארת על מבצע הבנייה.</b> ההסמכה אינה מינוי מנהל עבודה לפי תקנה 2(א)(1), ואינה מעבירה את האחריות מבצע הבנייה לנציג.</p>
    <p>הנציג מאשר שקרא את החובות, שהוא מבין אותן, ושידווח מיד למבצע הבנייה על כל סיכון שאינו קביל או על כל מצב שבו אינו יכול לבצע אותן.</p>`;
}
const sigFmt = t => new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
// sigs = { executor, rep } חתימות תקפות (על הנוסח הנוכחי). בלי חתימות: שורות חתימה ריקות להדפסה
export function authLetter(site, person, sigs = {}) {
  const slot = (k, label) => sigs[k]
    ? `<div><img src="${sigs[k].image}" alt="חתימה" style="height:70px;display:block"><b>${esc(sigs[k].signer_name)}</b>${sigs[k].signer_title ? ', ' + esc(sigs[k].signer_title) : ''}<br>${label} · נחתם ${esc(sigFmt(sigs[k].signed_at))}</div>`
    : `<div>${label}: שם, תפקיד, חתימה${k === 'executor' ? ' וחותמת' : ''}</div><div>תאריך</div>`;
  const signed = sigs.executor && sigs.rep;
  const audit = Object.values(sigs).filter(Boolean).length ? `<h2>תיעוד החתימות</h2><table><tr><th>חותם</th><th>מועד (שעון השרת)</th><th>משתמש במערכת</th><th>מכשיר</th></tr>
    ${Object.values(sigs).filter(Boolean).map(g => `<tr><td>${esc(g.signer_name)}${g.signer_title ? ' · ' + esc(g.signer_title) : ''}</td><td>${esc(sigFmt(g.signed_at))}</td><td dir="ltr">${esc(g.signed_by_email || '')}</td><td style="font-size:11px">${esc((g.user_agent || '').slice(0, 90))}${g.lat ? '<br>מיקום: ' + g.lat.toFixed(5) + ', ' + g.lng.toFixed(5) : ''}</td></tr>`).join('')}</table>
    <p class="note">טביעת אצבע של הנוסח שנחתם (SHA-256): <span dir="ltr" style="font-family:monospace">${esc(Object.values(sigs).find(Boolean).doc_hash)}</span>. החתימות נשמרו במערכת ואינן ניתנות לעריכה או למחיקה.</p>` : '';
  open(page('כתב הסמכה · ' + person.name, `
    <div class="head"><div><h1>כתב הסמכה לנציג מבצע הבנייה באתר</h1>
    <div class="mut"><span class="dot"></span>לפי תקנה 2(ז) ל${esc(LAW.B)} (תיקון התשפ"ו-2025)</div></div><img src="${LOGO()}" alt="צי הנדסה"></div>
    ${authLetterBody(site, person)}
    <div class="sig">${slot('executor', 'מבצע הבנייה')}${slot('rep', 'הנציג: ' + esc(person.name))}</div>
    ${audit}
    <p class="note">${signed ? 'הכתב נחתם במערכת וצורף לחובה "רישום נציג מבצע הבנייה באתר" ולפנקס הכללי.' : 'את הכתב החתום מצרפים במערכת לחובה "רישום נציג מבצע הבנייה באתר", ומצרפים עותק לפנקס הכללי באתר (תקנה 2(ט)).'} המסמך הופק ממערכת ניהול הבטיחות של צי הנדסה ואינו חוות דעת משפטית.</p>`,
    signed ? '' : Object.keys(sigs).some(k => sigs[k]) ? '<p style="color:#c62828"><b>חסרה חתימה אחת. הכתב עוד לא בתוקף.</b></p>' : ''));
}

// שלט אתר: הפרטים של תקנה 7, במיתוג צי הנדסה. שדה בלי ערך לא מופיע בשלט; הרשימה של מה שחסר מוצגת רק במסך.
// באתר 2(ז) בלי מנהל עבודה מוצג האחראי מטעם מבצע הבנייה (המלצה; הנוסח של תקנה 7 לא כולל פטור מפורש)
export function siteSign(site) {
  const d = derive(site.profile || {});
  const P = r => S.data.site_people.filter(p => p.site_id === site.id && p.role === r && p.active !== false && !p.backup);
  const con = siteOrgs(site.id, 'contractor'), dev = siteOrgs(site.id, 'developer');
  const wm = P('wm')[0], rep = P('rep')[0], bakar = P('bakar')[0], sm = P('sm')[0];
  const WT = { new: 'בנייה חדשה', addition: 'תוספת בנייה', fitout: 'עבודות גמר ופיט-אאוט', renovation: 'עבודות שיפוץ', infra: 'תשתיות ופיתוח', demolition: 'הריסה', gas: 'החלפת מיתקן גז' };
  const who = (p, extra = '') => p ? esc(p.name) + (extra ? ' · ' + esc(extra) : '') + (p.phone ? ' · ' + esc(p.phone) : '') : '';
  const missing = [];
  const rows = [];
  const add = (label, value, required = true) => { if (value) rows.push(`<tr><th>${label}</th><td>${value}</td></tr>`); else if (required) missing.push(label); };
  // מבצע הבנייה: הארגון שמשויך לאתר, ואם לא שויך ארגון, בעל התפקיד "מבצע הבנייה" מלשונית בעלי התפקידים
  add('מבצע הבנייה', con.length ? con.map(o => esc(o.name)).join(', ') : P('con').map(p => who(p)).join(', '));
  if (wm) add('מנהל העבודה', who(wm, wm.license));
  else if (d.exempt27) add('אחראי מטעם מבצע הבנייה', rep ? who(rep) + '<div style="font-size:14px;font-weight:400;color:#68717D">אין חובת מינוי מנהל עבודה (תקנה 2(ז))</div>' : '');
  else add('מנהל העבודה', '');
  const what = [WT[site.profile?.work_type], site.address].filter(Boolean).map(esc).join(' · ');
  add('מהות העבודה', what);
  add('המזמין', dev.map(o => esc(o.name)).join(', '), false);
  if (d.clientDuties) add('בקר הבטיחות', bakar ? who(bakar, bakar.license) : '');
  if (d.siteMgr) add('מנהל האתר', sm ? who(sm, sm.license) : '');
  const bar = (missing.length ? `<p style="color:#c62828"><b>לא יופיעו בשלט כי עוד לא הוזנו:</b> ${missing.join(', ')}. משלימים בלשונית "בעלי תפקידים" ומפיקים שוב.${!wm && !d.exempt27 ? ' אסור לעבוד באתר בלי מנהל עבודה.' : ''}</p>` : '')
    + `<p>לפי תקנה 7: שם מבצע הבנייה ומענו, שם מנהל העבודה ומענו, מהות העבודה, ושם המזמין, בקר הבטיחות ומנהל האתר עם מספרי רישום, כשהם קיימים. כדאי להוסיף את כתובות המען בשלט המודפס.${d.exempt27 && !wm ? ' באתר בלי חובת מינוי מנהל עבודה, תקנה 7 לא אומרת מה לכתוב בשדה הזה. הצגת האחראי מטעם מבצע הבנייה היא המלצה של המערכת.' : ''}</p>`;
  open(page('שלט אתר · ' + site.name, `<div class="sign"><img class="logo" src="${LOGO()}" alt="צי הנדסה – ניהול וביצוע"><h1>אתר בנייה</h1><div class="rule"></div><table>
    ${rows.join('')}
    </table></div>`, bar));
}
// מכתב רשמי מהודעה שאושרה (למשל קבלת אחריות כוללת לפי תקנה 6(ד))
export function noticeLetter(site, n) {
  const rows = (n.fields || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  open(page(n.subject + ' · ' + site.name, `
    <div class="head"><div><h1>${esc(n.subject)}</h1><div class="mut"><span class="dot"></span>${esc(fmtDate(new Date().toISOString()))}</div></div><img src="${LOGO()}" alt="צי הנדסה"></div>
    <table>${rows}</table>
    <p style="white-space:pre-line">${esc(n.body)}</p>
    <div class="sig"><div>הקבלן המקבל את האחריות: שם, תפקיד, חתימה וחותמת</div><div>המזמין: שם, תפקיד וחתימה</div><div>תאריך</div><div>תאריך</div></div>
    <p class="note">את המכתב החתום שולחים למפקח העבודה האזורי ומצרפים במערכת לחובה. המסמך הופק ממערכת ניהול הבטיחות של צי הנדסה ואינו חוות דעת משפטית.</p>`,
    n.status !== 'sent' && n.status !== 'approved' ? '<p style="color:#c62828"><b>טיוטה: ההודעה עוד לא אושרה במערכת.</b></p>' : ''));
}
export { CAT, ROLES };
