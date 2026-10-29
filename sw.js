// Cache do app para uso offline (cálculo de frete). Rotas e mapas precisam de internet.
const VERSAO = 'frete-antt-v3';
const ARQUIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'frete.js', 'antt-tabela.js', 'fazendas-padrao.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.includes('osrm')) return; // rotas sempre online
  // Arquivos do app: rede primeiro (pega tabela nova), cache se offline. Bibliotecas e mapas: cache primeiro.
  if (url.origin === location.origin) {
    // no-cache: revalida com o servidor, para não ficar preso a uma versão antiga no cache HTTP.
    e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then(r => {
      const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia)); return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => {
      if (url.hostname.includes('tile.openstreetmap.org') && r.ok) {
        const copia = r.clone(); caches.open(VERSAO + '-mapa').then(c => c.put(e.request, copia));
      }
      return r;
    })));
  }
});
