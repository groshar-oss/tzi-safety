// המערכת עברה: ה-service worker הזה מוחק את המטמון הישן ומסיר את עצמו, כדי שטלפון שהתקין את המערכת הישנה יגיע לדף ההפניה.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then(cs => cs.forEach(c => c.navigate(c.url).catch(() => {}))));
});
