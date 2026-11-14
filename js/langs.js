// נוסח אישור קבלת ההדרכה בשפת העובד. העובד חותם על שני הנוסחים: עברית ושפתו
export const LANGS = {
  he: { he: 'עברית', native: 'עברית', dir: 'rtl' },
  ar: { he: 'ערבית', native: 'العربية', dir: 'rtl' },
  ru: { he: 'רוסית', native: 'русский', dir: 'ltr' },
  th: { he: 'תאית', native: 'ไทย', dir: 'ltr' },
  ro: { he: 'רומנית', native: 'română', dir: 'ltr' },
  zh: { he: 'סינית', native: '中文', dir: 'ltr' },
  en: { he: 'אנגלית', native: 'English', dir: 'ltr' }
};
export const langLabel = c => LANGS[c]?.he || c || '';
// "ערבית" או "ar" ← קוד שפה
export const langCode = v => LANGS[v] ? v : Object.keys(LANGS).find(k => LANGS[k].he === String(v || '').trim()) || null;

const KINDS = {
  ar: { intro: 'تدريباً للعامل الجديد قبل بدء العمل', annual: 'تدريب السلامة السنوي', height: 'تدريباً على العمل في الأماكن المرتفعة', toolbox: 'إحاطة السلامة (اجتماع الصباح)', other: 'تدريباً آخر' },
  ru: { intro: 'вводный инструктаж для нового работника перед началом работы', annual: 'ежегодный инструктаж по технике безопасности', height: 'инструктаж по работе на высоте', toolbox: 'инструктаж по безопасности (утренняя планёрка)', other: 'другой инструктаж' },
  th: { intro: 'การอบรมสำหรับพนักงานใหม่ก่อนเริ่มงาน', annual: 'การอบรมความปลอดภัยประจำปี', height: 'การอบรมการทำงานบนที่สูง', toolbox: 'การบรรยายสรุปความปลอดภัย (ประชุมตอนเช้า)', other: 'การอบรมอื่น ๆ' },
  ro: { intro: 'instruirea lucrătorului nou înainte de începerea lucrului', annual: 'instruirea anuală privind securitatea muncii', height: 'instruirea pentru lucrul la înălțime', toolbox: 'instructajul de securitate (ședința de dimineață)', other: 'altă instruire' },
  zh: { intro: '新员工上岗前培训', annual: '年度安全培训', height: '高处作业培训', toolbox: '安全简报（早班会）', other: '其他培训' },
  en: { intro: 'new worker training before starting work', annual: 'annual safety training', height: 'work at height training', toolbox: 'safety briefing (morning talk)', other: 'other training' }
};
const ID = {
  ar: ['رقم الهوية', 'جواز سفر'], ru: ['удостоверение личности', 'паспорт'], th: ['บัตรประจำตัว', 'หนังสือเดินทาง'],
  ro: ['act de identitate', 'pașaport'], zh: ['身份证号', '护照号'], en: ['ID no.', 'passport']
};
const T = {
  ar: x => `أنا، ${x.name}، ${x.idl} ${x.id}، أُقرّ بأنني تلقيت اليوم، ${x.date}، ${x.kind} في موقع ${x.site}. قدّم لي التدريب ${x.trainer} وجهاً لوجه، بلغة أفهمها (${x.lang})، وقد فهمته.`,
  ru: x => `Я, ${x.name}, ${x.idl} ${x.id}, подтверждаю, что сегодня, ${x.date}, прошёл(-ла) ${x.kind} на объекте ${x.site}. Инструктаж провёл(-а) со мной лично ${x.trainer} на понятном мне языке (${x.lang}), и я его понял(-а).`,
  th: x => `ข้าพเจ้า ${x.name} ${x.idl} ${x.id} ขอยืนยันว่าวันนี้ (${x.date}) ข้าพเจ้าได้รับ${x.kind} ที่ไซต์งาน ${x.site} การอบรมดำเนินการต่อหน้าโดย ${x.trainer} เป็นภาษาที่ข้าพเจ้าเข้าใจ (${x.lang}) และข้าพเจ้าเข้าใจเนื้อหาแล้ว`,
  ro: x => `Eu, ${x.name}, ${x.idl} ${x.id}, confirm că astăzi, ${x.date}, am primit ${x.kind} pe șantierul ${x.site}. Instruirea mi-a fost făcută față în față de ${x.trainer}, într-o limbă pe care o înțeleg (${x.lang}), și am înțeles-o.`,
  zh: x => `本人 ${x.name}，${x.idl} ${x.id}，确认于今天（${x.date}）在 ${x.site} 工地接受了${x.kind}。培训由 ${x.trainer} 以我能听懂的语言（${x.lang}）当面讲授，我已理解培训内容。`,
  en: x => `I, ${x.name}, ${x.idl} ${x.id}, confirm that today, ${x.date}, I received ${x.kind} at the ${x.site} site. The training was given to me face to face by ${x.trainer}, in a language I understand (${x.lang}), and I understood it.`
};
export const OK_BTN = { he: 'אישור וחתימה', ar: 'موافقة وتوقيع', ru: 'Подтвердить и подписать', th: 'ยืนยันและลงนาม', ro: 'Confirm și semnez', zh: '确认并签名', en: 'Confirm and sign' };
export const SIGN_HERE = { he: 'חתימה', ar: 'وقّع هنا', ru: 'Подпишите здесь', th: 'ลงนามที่นี่', ro: 'Semnați aici', zh: '请在此签名', en: 'Sign here' };

// הנוסח בשפת העובד. null לעברית או לשפה בלי תרגום
export function localStatement(code, { name, idType, id, kind, site, trainer, trainingLang }) {
  if (!T[code]) return null;
  const d = new Date(), date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const tl = langCode(trainingLang);
  return T[code]({ name, idl: ID[code][idType === 'passport' ? 1 : 0], id, date, kind: KINDS[code][kind] || KINDS[code].other, site, trainer, lang: tl ? LANGS[tl].native : (trainingLang || LANGS[code].native) });
}

// תזכורת לעובד לפני שאישור פג (נשלחת בוואטסאפ בלחיצה). עברית ואחריה שפת העובד
const DOC = {
  he: { height: 'אישור העבודה בגובה שלך', permit: 'היתר העבודה שלך' },
  ar: { height: 'تصريح العمل على المرتفعات الخاص بك', permit: 'تصريح العمل الخاص بك' },
  ru: { height: 'допуск к работе на высоте', permit: 'разрешение на работу' },
  th: { height: 'ใบอนุญาตทำงานบนที่สูง', permit: 'ใบอนุญาตทำงาน' },
  ro: { height: 'Atestatul de lucru la înălțime', permit: 'Permisul de muncă' },
  zh: { height: '高处作业证', permit: '工作许可证' },
  en: { height: 'work at height certificate', permit: 'work permit' }
};
const REM = {
  he: x => `שלום ${x.name}, ${x.doc} בתוקף עד ${x.date}. צריך לחדש אותו ולהביא את המסמך החדש למנהל העבודה. בלי מסמך בתוקף אי אפשר לעבוד באתר ${x.site}.`,
  ar: x => `مرحباً ${x.name}، ${x.doc} صالح حتى ${x.date}. يجب تجديده وإحضار المستند الجديد إلى مدير العمل. بدون مستند ساري المفعول لا يمكن العمل في موقع ${x.site}.`,
  ru: x => `Здравствуйте, ${x.name}! Документ «${x.doc}» действителен до ${x.date}. Его нужно продлить и принести новый документ прорабу. Без действующего документа работать на объекте ${x.site} нельзя.`,
  th: x => `สวัสดี ${x.name} ${x.doc}ของคุณใช้ได้ถึงวันที่ ${x.date} กรุณาต่ออายุและนำเอกสารใหม่มาให้หัวหน้างาน หากไม่มีเอกสารที่ยังไม่หมดอายุ จะไม่สามารถทำงานที่ไซต์ ${x.site} ได้`,
  ro: x => `Bună ziua, ${x.name}! ${x.doc} este valabil până la ${x.date}. Trebuie reînnoit, iar documentul nou trebuie adus șefului de lucrări. Fără un document valabil nu puteți lucra pe șantierul ${x.site}.`,
  zh: x => `${x.name}您好，您的${x.doc}有效期至${x.date}。请及时续办，并将新证件交给施工经理。没有有效证件将不能在${x.site}工地工作。`,
  en: x => `Hello ${x.name}, your ${x.doc} is valid until ${x.date}. Please renew it and bring the new document to the work manager. Without a valid document you cannot work at the ${x.site} site.`
};
export function reminderText(code, kind, { name, date, site }) {
  const he = REM.he({ name, doc: DOC.he[kind], date, site });
  const c = REM[code] && code !== 'he' ? code : null;
  return c ? he + '\n\n' + REM[c]({ name, doc: DOC[c][kind], date, site }) : he;
}

// חתימה על הדרכה בטלפון של העובד, דרך קישור אישי
export const LINK_MSG = {
  he: x => `שלום ${x.name}, זה קישור אישי לחתימה על ${x.kind} באתר ${x.site}. פותחים, קוראים וחותמים באצבע. הקישור בתוקף עד ${x.until}.`,
  ar: x => `مرحباً ${x.name}، هذا رابط شخصي للتوقيع على التدريب في موقع ${x.site}. افتح الرابط، اقرأ ووقّع بإصبعك. الرابط صالح حتى ${x.until}.`,
  ru: x => `Здравствуйте, ${x.name}! Это личная ссылка для подписи об инструктаже на объекте ${x.site}. Откройте, прочитайте и подпишите пальцем. Ссылка действует до ${x.until}.`,
  th: x => `สวัสดี ${x.name} นี่คือลิงก์ส่วนตัวสำหรับลงนามรับการอบรมที่ไซต์ ${x.site} เปิดลิงก์ อ่าน แล้วลงนามด้วยนิ้ว ลิงก์ใช้ได้ถึง ${x.until}`,
  ro: x => `Bună ziua, ${x.name}! Acesta este un link personal pentru semnarea instruirii pe șantierul ${x.site}. Deschideți, citiți și semnați cu degetul. Linkul este valabil până la ${x.until}.`,
  zh: x => `${x.name}您好，这是您在${x.site}工地签署培训确认的个人链接。请打开、阅读并用手指签名。链接有效期至${x.until}。`,
  en: x => `Hello ${x.name}, this is your personal link to sign for the training at the ${x.site} site. Open it, read and sign with your finger. The link is valid until ${x.until}.`
};
export const READ_OK = { he: 'קראתי והבנתי', ar: 'قرأت وفهمت', ru: 'Я прочитал(-а) и понял(-а)', th: 'ข้าพเจ้าอ่านและเข้าใจแล้ว', ro: 'Am citit și am înțeles', zh: '我已阅读并理解', en: 'I have read and understood' };
export const SIGNED_OK = { he: 'החתימה נשמרה. תודה! אפשר לסגור את הדף.', ar: 'تم حفظ التوقيع. شكراً! يمكنك إغلاق الصفحة.', ru: 'Подпись сохранена. Спасибо! Страницу можно закрыть.', th: 'บันทึกลายเซ็นแล้ว ขอบคุณ! ปิดหน้านี้ได้เลย', ro: 'Semnătura a fost salvată. Mulțumim! Puteți închide pagina.', zh: '签名已保存。谢谢！可以关闭此页面。', en: 'Your signature was saved. Thank you! You can close this page.' };
