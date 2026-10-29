(function () {
  'use strict';

  const ORIGENS = [
    { id: 'rv', nome: 'Grupo Cereal – Rio Verde/GO', lat: -17.7850265, lon: -50.8990135 },
    { id: 'pg', nome: 'Grupo Cereal – Palmeiras de Goiás/GO', lat: -16.8188889, lon: -49.9016667 },
  ];
  const OSRM = 'https://router.project-osrm.org';
  const CHAVES = {
    fazendas: 'frete.fazendas', estado: 'frete.estado', tabela: 'frete.tabela',
    cotacoes: 'frete.cotacoes', lote: 'frete.lote',
  };

  // ---------- utilidades ----------
  const $ = id => document.getElementById(id);
  const brl = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = (v, d = 1) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ler(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); return true; } catch (e) { return false; }
  }
  function tempo(seg) {
    const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
  }
  function linhaReta(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  let toastTimer;
  function aviso(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('vis');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('vis'), 3500);
  }

  // ---------- estado ----------
  let tabela = ler(CHAVES.tabela, null) || window.ANTT_TABELA;
  // Lista importada neste aparelho; sem ela, a lista que vem no app (fazendas-padrao.js).
  const PADRAO = window.FAZENDAS_PADRAO || { itens: [] };
  let fazendas = ler(CHAVES.fazendas, null) || PADRAO.itens;
  const usandoPadrao = () => { try { return !localStorage.getItem(CHAVES.fazendas); } catch (e) { return true; } };
  const salvo = ler(CHAVES.estado, {});
  let paradas = salvo.paradas || [];
  let rota = null; // { distancia, duracao, pernas: [...], kmIda, kmRetorno }
  let pontoLivre = null;
  let ultimoFrete = null; // último cálculo válido da aba Frete, base da cotação
  let cotacoes = ler(CHAVES.cotacoes, []);
  let lote = ler(CHAVES.lote, null); // { assinatura, data, itens: [{ kmRV, segRV, kmPG, segPG }] }

  function salvarEstado() {
    gravar(CHAVES.estado, {
      origem: $('origem').value, paradas, volta: $('volta-origem').checked,
      tipo: $('tipo-carga').value, eixos: $('eixos').value,
      composicao: $('composicao').checked, alto: $('alto-desempenho').checked,
      retorno: $('retorno-vazio').checked,
    });
  }
  const origemAtual = () => ORIGENS.find(o => o.id === $('origem').value) || ORIGENS[0];

  // ---------- mapa ----------
  const mapa = L.map('mapa', { preferCanvas: true }).setView([-16.9, -50.2], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(mapa);
  const camadaFazendas = L.layerGroup().addTo(mapa);
  const camadaRota = L.layerGroup().addTo(mapa);
  const iconeOrigem = L.divIcon({ className: 'pin-origem', html: '🏭', iconSize: [28, 28], iconAnchor: [14, 14] });
  ORIGENS.forEach(o => L.marker([o.lat, o.lon], { icon: iconeOrigem }).bindTooltip(o.nome).addTo(mapa));

  function desenharFazendas() {
    camadaFazendas.clearLayers();
    fazendas.forEach((f, i) => {
      L.circleMarker([f.lat, f.lon], { radius: 5, color: '#1565c0', weight: 1, fillOpacity: 0.7 })
        .bindPopup(() => `<b>${esc(f.nome)}</b>${f.desc ? '<br>' + esc(f.desc) : ''}<br>
          <button class="mini" data-add-faz="${i}">Adicionar à rota</button>`)
        .addTo(camadaFazendas);
    });
  }
  mapa.on('popupopen', e => {
    const el = e.popup.getElement();
    const b = el.querySelector('[data-add-faz]');
    if (b) b.onclick = () => { adicionarParada(fazendas[+b.dataset.addFaz]); mapa.closePopup(); };
    const l = el.querySelector('[data-add-livre]');
    if (l) l.onclick = () => {
      const n = prompt('Nome do ponto:', 'Ponto livre') || 'Ponto livre';
      adicionarParada({ nome: n, lat: pontoLivre.lat, lon: pontoLivre.lng }); mapa.closePopup();
    };
  });
  mapa.on('click', e => {
    pontoLivre = e.latlng;
    L.popup().setLatLng(e.latlng)
      .setContent(`${num(e.latlng.lat, 5)}, ${num(e.latlng.lng, 5)}<br><button class="mini" data-add-livre>Adicionar ponto livre</button>`)
      .openOn(mapa);
  });

  // ---------- paradas ----------
  function adicionarParada(p) {
    paradas.push({ nome: p.nome, lat: p.lat, lon: p.lon });
    rotaInvalida(); renderParadas(); aviso(`Adicionada: ${p.nome}`);
  }
  function renderParadas() {
    $('qtd-paradas').textContent = paradas.length;
    $('lista-paradas').innerHTML = paradas.map((p, i) => `
      <li><span class="nome">${esc(p.nome)}</span>
        <span class="acoes">
          <button data-sobe="${i}" title="Subir" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button data-desce="${i}" title="Descer" ${i === paradas.length - 1 ? 'disabled' : ''}>▼</button>
          <button data-remove="${i}" title="Remover">✕</button>
        </span></li>`).join('');
    salvarEstado();
  }
  $('lista-paradas').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +(b.dataset.sobe ?? b.dataset.desce ?? b.dataset.remove);
    if (b.dataset.sobe) [paradas[i - 1], paradas[i]] = [paradas[i], paradas[i - 1]];
    else if (b.dataset.desce) [paradas[i + 1], paradas[i]] = [paradas[i], paradas[i + 1]];
    else paradas.splice(i, 1);
    rotaInvalida(); renderParadas();
  };
  function rotaInvalida() {
    rota = null; camadaRota.clearLayers(); $('resumo-rota').classList.add('oculto');
  }

  // busca de fazendas
  $('busca-parada').oninput = () => {
    const q = norm($('busca-parada').value).trim();
    const ul = $('sugestoes');
    if (!q) { ul.innerHTML = ''; return; }
    const o = origemAtual();
    const achadas = fazendas.filter(f => norm(f.nome).includes(q) || norm(f.desc).includes(q)).slice(0, 20);
    ul.innerHTML = achadas.length
      ? achadas.map(f => { const i = fazendas.indexOf(f); return `<li data-i="${i}">${esc(f.nome)} <small>${distanciaTexto(i, f, o)}</small></li>`; }).join('')
      : `<li class="vazio">${fazendas.length ? 'Nada encontrado' : 'Importe as fazendas na aba Fazendas'}</li>`;
  };
  $('sugestoes').onclick = e => {
    const li = e.target.closest('li[data-i]'); if (!li) return;
    adicionarParada(fazendas[+li.dataset.i]);
    $('busca-parada').value = ''; $('sugestoes').innerHTML = '';
  };

  // ---------- OSRM ----------
  const coordsStr = pts => pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  async function osrm(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`OSRM respondeu ${r.status}`);
    const j = await r.json();
    if (j.code !== 'Ok') throw new Error(j.message || j.code);
    return j;
  }

  async function calcularRota() {
    if (!paradas.length) { aviso('Adicione ao menos uma parada.'); return; }
    const o = origemAtual(), volta = $('volta-origem').checked;
    const pts = [o, ...paradas, ...(volta ? [o] : [])];
    const btn = $('btn-rota'); btn.disabled = true; btn.textContent = 'Calculando…';
    try {
      const j = await osrm(`${OSRM}/route/v1/driving/${coordsStr(pts)}?overview=full&geometries=geojson&steps=false`);
      const r = j.routes[0];
      const pernas = r.legs.map((l, i) => ({
        de: i === 0 ? o.nome : paradas[i - 1].nome,
        para: i < paradas.length ? paradas[i].nome : o.nome,
        km: l.distance / 1000, seg: l.duration,
      }));
      const ida = pernas.slice(0, paradas.length), ret = pernas.slice(paradas.length);
      rota = {
        km: r.distance / 1000, seg: r.duration, pernas,
        kmIda: ida.reduce((s, p) => s + p.km, 0),
        kmRetorno: ret.reduce((s, p) => s + p.km, 0),
        volta,
      };
      camadaRota.clearLayers();
      const linha = L.geoJSON(r.geometry, { style: { color: '#2e7d32', weight: 5, opacity: 0.85 } }).addTo(camadaRota);
      paradas.forEach((p, i) => L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: 'pin-num', html: String(i + 1), iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).bindTooltip(p.nome).addTo(camadaRota));
      mapa.fitBounds(linha.getBounds(), { padding: [20, 20] });
      renderResumo();
      aplicarRotaNoFrete();
    } catch (e) {
      aviso('Não foi possível calcular a rota: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Calcular rota';
    }
  }

  function renderResumo() {
    const r = rota, el = $('resumo-rota');
    el.classList.remove('oculto');
    el.innerHTML = `
      <div class="kpis">
        <div><b>${num(r.km, 1)} km</b><span>distância total</span></div>
        <div><b>${tempo(r.seg)}</b><span>tempo ao volante</span></div>
      </div>
      <p>Ida (origem → última parada): <b>${num(r.kmIda, 1)} km</b>${r.volta ? ` · Volta: <b>${num(r.kmRetorno, 1)} km</b>` : ''}</p>
      <table class="grade"><thead><tr><th>Trecho</th><th>km</th><th>tempo</th></tr></thead><tbody>
      ${r.pernas.map(p => `<tr><td>${esc(p.de)} → ${esc(p.para)}</td><td>${num(p.km, 1)}</td><td>${tempo(p.seg)}</td></tr>`).join('')}
      </tbody></table>
      <p class="nota">Rota por estrada: OSRM / OpenStreetMap (servidor público de demonstração). Confira trechos de estrada de terra.</p>
      <button class="pri" id="btn-ir-frete">Ver frete desta rota →</button>`;
    $('btn-ir-frete').onclick = () => trocarAba('frete');
  }

  // ---------- otimização ----------
  // Ordem que minimiza a distância por estrada (matriz OSRM). Até 8 paradas: força bruta;
  // acima disso: vizinho mais próximo + 2-opt.
  function custo(ordem, D, fechada) {
    let c = D[0][ordem[0]];
    for (let i = 1; i < ordem.length; i++) c += D[ordem[i - 1]][ordem[i]];
    if (fechada) c += D[ordem[ordem.length - 1]][0];
    return c;
  }
  function permutacoes(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => permutacoes([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach(p => out.push([x, ...p])));
    return out;
  }
  function melhorOrdem(D, n, fechada) {
    const idx = Array.from({ length: n }, (_, i) => i + 1);
    if (n <= 8) {
      let melhor = idx, mc = Infinity;
      for (const p of permutacoes(idx)) { const c = custo(p, D, fechada); if (c < mc) { mc = c; melhor = p; } }
      return melhor;
    }
    const resto = new Set(idx), ordem = [];
    let atual = 0;
    while (resto.size) {
      let prox = null, dmin = Infinity;
      resto.forEach(j => { if (D[atual][j] < dmin) { dmin = D[atual][j]; prox = j; } });
      ordem.push(prox); resto.delete(prox); atual = prox;
    }
    let melhorou = true;
    while (melhorou) {
      melhorou = false;
      for (let i = 0; i < n - 1; i++) for (let k = i + 1; k < n; k++) {
        const nova = [...ordem.slice(0, i), ...ordem.slice(i, k + 1).reverse(), ...ordem.slice(k + 1)];
        if (custo(nova, D, fechada) < custo(ordem, D, fechada) - 1e-6) { ordem.splice(0, n, ...nova); melhorou = true; }
      }
    }
    return ordem;
  }
  async function otimizar() {
    if (paradas.length < 2) { aviso('Otimização precisa de 2 ou mais paradas.'); return; }
    if (paradas.length > 99) { aviso('Máximo de 99 paradas.'); return; }
    const btn = $('btn-otimizar'); btn.disabled = true; btn.textContent = 'Otimizando…';
    try {
      const pts = [origemAtual(), ...paradas];
      const j = await osrm(`${OSRM}/table/v1/driving/${coordsStr(pts)}?annotations=distance`);
      const D = j.distances.map(l => l.map(v => (v == null ? 1e12 : v)));
      const antes = custo(paradas.map((_, i) => i + 1), D, $('volta-origem').checked);
      const ordem = melhorOrdem(D, paradas.length, $('volta-origem').checked);
      const depois = custo(ordem, D, $('volta-origem').checked);
      paradas = ordem.map(i => paradas[i - 1]);
      renderParadas();
      aviso(`Ordem otimizada: ${num(antes / 1000, 0)} km → ${num(depois / 1000, 0)} km`);
      await calcularRota();
    } catch (e) {
      aviso('Falha na otimização: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Otimizar ordem';
    }
  }

  function abrirGoogleMaps() {
    if (!paradas.length) { aviso('Adicione paradas primeiro.'); return; }
    const o = origemAtual(), volta = $('volta-origem').checked;
    const destino = volta ? o : paradas[paradas.length - 1];
    const meio = volta ? paradas : paradas.slice(0, -1);
    const ll = p => `${p.lat},${p.lon}`;
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${ll(o)}&destination=${ll(destino)}`;
    if (meio.length) url += `&waypoints=${meio.map(ll).join('|')}`;
    if (meio.length > 9) aviso('O Google Maps aceita até 9 paradas intermediárias; o excesso pode ser ignorado.');
    window.open(url, '_blank');
  }

  // ---------- frete ----------
  function preencherTipos() {
    const sel = $('tipo-carga'), atual = sel.value || salvo.tipo || '1';
    sel.innerHTML = Object.entries(tabela.tipos)
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([id, nome]) => `<option value="${id}">${esc(nome)}</option>`).join('');
    sel.value = tabela.tipos[atual] ? atual : '1';
  }
  function aplicarRotaNoFrete() {
    if (!rota) return;
    $('distancia').value = Math.round(rota.kmIda);
    $('distancia-retorno').value = Math.round(rota.volta ? rota.kmRetorno : rota.kmIda);
    calcularFrete();
  }
  function calcularFrete() {
    // A calculadora da ANTT só aceita km inteiros.
    const dist = Math.round(Number($('distancia').value));
    const ret = $('retorno-vazio').checked;
    $('lbl-dist-retorno').classList.toggle('oculto', !ret);
    const out = $('resultado-frete');
    salvarEstado();
    ultimoFrete = null;
    if (!dist || dist < 1) { out.innerHTML = '<p>Informe a distância ou calcule uma rota.</p>'; $('nota-frete').textContent = ''; return; }
    const eixos = Number($('eixos').value);
    const r = FreteANTT.calcular(tabela, {
      tipo: $('tipo-carga').value, eixos, distancia: dist,
      composicao: $('composicao').checked, altoDesempenho: $('alto-desempenho').checked,
      retornoVazio: ret, distanciaRetorno: $('distancia-retorno').value === '' ? null : Math.round(Number($('distancia-retorno').value)),
      pedagio: $('pedagio').value,
    });
    if (r.erro) { out.innerHTML = `<p>${r.erro}</p>`; return; }
    const t = Number($('toneladas').value);
    ultimoFrete = { r, t, eixos, retornoVazio: ret };
    out.innerHTML = `
      <div class="total"><span>Piso mínimo ANTT${r.pedagio ? ' + pedágio' : ''}</span><b>${brl(r.total)}</b></div>
      <table class="grade"><tbody>
        <tr><td>Operação</td><td class="txt">${esc(tabela.nomesTabelas[r.letra])}</td></tr>
        <tr><td>CCD (R$/km)</td><td>${num(r.ccd, 4)}</td></tr>
        <tr><td>CC (R$)</td><td>${num(r.cc, 2)}</td></tr>
        <tr><td>Ida = ${num(r.distancia, 0)} km × CCD + CC</td><td>${brl(r.ida)}</td></tr>
        ${ret ? `<tr><td>Retorno vazio = 0,92 × ${num(r.distanciaRetorno, 0)} km × CCD</td><td>${brl(r.retorno)}</td></tr>` : ''}
        <tr><td><b>Piso mínimo</b></td><td><b>${brl(r.piso)}</b></td></tr>
        ${r.pedagio ? `<tr><td>Pedágio</td><td>${brl(r.pedagio)}</td></tr>` : ''}
        <tr><td>R$/km (ida)</td><td>${num(r.total / r.distancia, 2)}</td></tr>
        ${t > 0 ? `<tr><td>R$/t (${num(t, 1)} t)</td><td>${brl(r.total / t)}</td></tr>` : ''}
      </tbody></table>`;
    $('nota-frete').innerHTML =
      (r.ajustado ? `<b>Atenção:</b> não há coeficiente para ${eixos} eixos; usado ${r.eixosUsados} eixos (regra da ANTT). ` : '') +
      `Valores conforme ${esc(tabela.norma)}, atualizada em ${esc(tabela.atualizacao)}. ` +
      'Não inclui diárias, impostos, seguro e demais itens negociáveis (art. 5º, I, III e IV).';
  }

  // ---------- importação de fazendas ----------
  function lerKML(texto) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    const out = [];
    for (const pm of doc.getElementsByTagName('Placemark')) {
      const c = pm.getElementsByTagName('coordinates')[0];
      if (!c) continue;
      const pares = c.textContent.trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(p => p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]));
      if (!pares.length) continue;
      // Ponto: a própria coordenada; linha/polígono: média dos vértices.
      const lon = pares.reduce((s, p) => s + p[0], 0) / pares.length;
      const lat = pares.reduce((s, p) => s + p[1], 0) / pares.length;
      const nome = (pm.getElementsByTagName('name')[0]?.textContent || 'Sem nome').trim();
      const desc = (pm.getElementsByTagName('description')[0]?.textContent || '').replace(/<[^>]*>/g, ' ').trim().slice(0, 200);
      out.push({ nome, desc, lat, lon });
    }
    return out;
  }
  function lerPlanilha(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    const out = [];
    for (const nomeAba of wb.SheetNames) {
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: '' });
      // procura a linha de cabeçalho que tenha latitude e longitude
      for (let h = 0; h < Math.min(linhas.length, 15); h++) {
        const cab = linhas[h].map(norm);
        const iLat = cab.findIndex(c => /^lat/.test(c) || c.includes('latitude'));
        const iLon = cab.findIndex(c => /^(lon|lng)/.test(c) || c.includes('longitude'));
        const iCoord = cab.findIndex(c => c.includes('coordenada'));
        if ((iLat < 0 || iLon < 0) && iCoord < 0) continue;
        let iNome = cab.findIndex(c => /fazenda|nome|cliente|name|destino/.test(c));
        if (iNome < 0) iNome = 0;
        const iDesc = cab.findIndex(c => /descri|obs|municip|cidade/.test(c));
        for (const l of linhas.slice(h + 1)) {
          let lat, lon;
          if (iLat >= 0 && iLon >= 0) { lat = parseFloat(String(l[iLat]).replace(',', '.')); lon = parseFloat(String(l[iLon]).replace(',', '.')); }
          else { const m = String(l[iCoord]).match(/(-?\d+[.,]\d+)\s*[,;\s]\s*(-?\d+[.,]\d+)/); if (m) { lat = parseFloat(m[1].replace(',', '.')); lon = parseFloat(m[2].replace(',', '.')); } }
          if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
          out.push({ nome: String(l[iNome] || 'Sem nome').trim(), desc: iDesc >= 0 ? String(l[iDesc]).trim() : '', lat, lon });
        }
        break;
      }
      if (out.length) break;
    }
    return out;
  }
  $('arquivo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const st = $('status-import'); st.textContent = 'Lendo arquivo…';
    try {
      const ext = f.name.toLowerCase().split('.').pop();
      let novas;
      if (ext === 'kmz') {
        const zip = await JSZip.loadAsync(f);
        const kmls = Object.values(zip.files).filter(z => z.name.toLowerCase().endsWith('.kml'));
        if (!kmls.length) throw new Error('KMZ sem arquivo KML dentro');
        novas = (await Promise.all(kmls.map(k => k.async('string')))).flatMap(lerKML);
      } else if (ext === 'kml') {
        novas = lerKML(await f.text());
      } else {
        novas = lerPlanilha(new Uint8Array(await f.arrayBuffer()));
      }
      if (!novas.length) throw new Error('nenhum ponto com coordenadas encontrado');
      fazendas = $('substituir').checked ? novas : fazendas.concat(novas);
      const ok = gravar(CHAVES.fazendas, fazendas);
      st.textContent = `${novas.length} fazendas importadas de ${f.name}. Total: ${fazendas.length}.` + (ok ? '' : ' (Não foi possível salvar no aparelho.)');
      desenharFazendas(); renderFazendas(); renderStatusLote();
    } catch (err) {
      st.textContent = 'Erro ao importar: ' + err.message;
    }
    e.target.value = '';
  };
  // Km por estrada da unidade mais próxima, se o lote já foi calculado; senão, linha reta.
  function distanciaTexto(i, f, o) {
    const m = loteValido() && maisProxima(lote.itens[i]);
    if (m) return `${num(m.km, 0)} km por estrada de ${m.origem.id === 'pg' ? 'Palmeiras' : 'Rio Verde'}`;
    return `~${num(linhaReta(o, f), 0)} km lin. reta`;
  }
  function renderFazendas() {
    $('origem-fazendas').innerHTML = usandoPadrao()
      ? `<b>${fazendas.length} fazendas</b> da lista que vem no app${PADRAO.arquivo ? ` (${esc(PADRAO.arquivo)}, ${esc(PADRAO.data)})` : ''}.`
      : `<b>${fazendas.length} fazendas</b> importadas neste aparelho.`;
    const q = norm($('filtro-fazendas').value);
    const o = origemAtual();
    const lista = fazendas.map((f, i) => ({ f, i })).filter(x => !q || norm(x.f.nome).includes(q) || norm(x.f.desc).includes(q));
    $('lista-fazendas').innerHTML = lista.slice(0, 200).map(({ f, i }) =>
      `<li><span class="nome">${esc(f.nome)}<small>${f.desc ? esc(f.desc) + ' · ' : ''}${distanciaTexto(i, f, o)}</small></span>
        <span class="acoes"><button data-ver="${i}" title="Ver no mapa">📍</button><button data-add="${i}" title="Adicionar à rota">＋</button></span></li>`).join('')
      + (lista.length > 200 ? `<li class="vazio">… e mais ${lista.length - 200}. Use o filtro.</li>` : '')
      + (!fazendas.length ? '<li class="vazio">Nenhuma fazenda importada.</li>' : '');
  }
  $('filtro-fazendas').oninput = renderFazendas;
  $('lista-fazendas').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const f = fazendas[+(b.dataset.ver ?? b.dataset.add)];
    if (b.dataset.add) adicionarParada(f);
    else { mapa.setView([f.lat, f.lon], 13); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  };
  $('btn-apagar-fazendas').onclick = () => {
    if (!confirm(`Apagar as fazendas importadas deste aparelho e voltar às ${PADRAO.itens.length} fazendas que vêm no app?`)) return;
    try { localStorage.removeItem(CHAVES.fazendas); } catch (e) { /* sem armazenamento */ }
    fazendas = PADRAO.itens; desenharFazendas(); renderFazendas(); renderStatusLote();
  };

  // ---------- cotações ----------
  function montarCotacao() {
    if (!ultimoFrete) return null;
    const { r, t, eixos, retornoVazio } = ultimoFrete;
    // Paradas só entram se a distância informada for a da rota calculada.
    const daRota = rota && Math.round(rota.kmIda) === r.distancia;
    return {
      id: Date.now(), data: new Date().toISOString(),
      origem: origemAtual().nome,
      destinos: daRota ? paradas.map(p => p.nome) : [],
      seg: daRota ? rota.seg : null,
      tipo: tabela.tipos[$('tipo-carga').value], eixos, eixosUsados: r.eixosUsados,
      nomeTabela: tabela.nomesTabelas[r.letra], ccd: r.ccd, cc: r.cc,
      distancia: r.distancia, distanciaRetorno: r.distanciaRetorno, retornoVazio,
      ida: r.ida, retorno: r.retorno, piso: r.piso, pedagio: r.pedagio, total: r.total, toneladas: t,
      norma: `${tabela.norma}, atualizada em ${tabela.atualizacao}`,
    };
  }
  const dataBR = iso => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  function textoCotacao(c) {
    const l = [`*Cotação de frete – Grupo Cereal*`, `Data: ${dataBR(c.data)}`, `Origem: ${c.origem}`];
    if (c.destinos.length === 1) l.push(`Destino: ${c.destinos[0]}`);
    else if (c.destinos.length) l.push('Paradas:', ...c.destinos.map((d, i) => `  ${i + 1}. ${d}`));
    l.push(`Distância de ida: ${num(c.distancia, 0)} km` + (c.retornoVazio ? ` · retorno vazio: ${num(c.distanciaRetorno, 0)} km` : ''));
    if (c.seg) l.push(`Tempo ao volante (rota completa): ${tempo(c.seg)}`);
    l.push(`Carga: ${c.tipo} · ${c.eixos} eixos${c.eixosUsados !== c.eixos ? ` (tabela de ${c.eixosUsados})` : ''}`);
    l.push('', `*Piso mínimo ANTT: ${brl(c.piso)}*`, `  Ida: ${brl(c.ida)}`);
    if (c.retornoVazio) l.push(`  Retorno vazio: ${brl(c.retorno)}`);
    if (c.pedagio) l.push(`Pedágio: ${brl(c.pedagio)}`, `*Total: ${brl(c.total)}*`);
    l.push(`R$/km (ida): ${num(c.total / c.distancia, 2)}`);
    if (c.toneladas > 0) l.push(`R$/t (${num(c.toneladas, 1)} t): ${brl(c.total / c.toneladas)}`);
    l.push('', `_${c.nomeTabela}. ${c.norma}. Não inclui diárias, impostos e seguro._`);
    return l.join('\n');
  }

  async function compartilhar(c) {
    if (!c) { aviso('Calcule o frete primeiro.'); return; }
    const texto = textoCotacao(c);
    if (navigator.share) {
      try { await navigator.share({ title: 'Cotação de frete', text: texto }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
  }

  function imprimir(c) {
    if (!c) { aviso('Calcule o frete primeiro.'); return; }
    const linha = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    $('impressao').innerHTML = `
      <h1>Cotação de frete – Grupo Cereal</h1>
      <p>Emitida em ${esc(dataBR(c.data))}</p>
      <table>
        ${linha('Origem', esc(c.origem))}
        ${c.destinos.length ? linha(c.destinos.length > 1 ? 'Paradas' : 'Destino', c.destinos.map((d, i) => `${c.destinos.length > 1 ? i + 1 + '. ' : ''}${esc(d)}`).join('<br>')) : ''}
        ${linha('Distância de ida', `${num(c.distancia, 0)} km`)}
        ${c.retornoVazio ? linha('Distância do retorno vazio', `${num(c.distanciaRetorno, 0)} km`) : ''}
        ${c.seg ? linha('Tempo ao volante (rota completa)', tempo(c.seg)) : ''}
        ${linha('Tipo de carga', esc(c.tipo))}
        ${linha('Nº de eixos', c.eixos + (c.eixosUsados !== c.eixos ? ` (coeficiente de ${c.eixosUsados} eixos)` : ''))}
        ${linha('Operação', esc(c.nomeTabela))}
        ${linha('CCD (R$/km) / CC (R$)', `${num(c.ccd, 4)} / ${num(c.cc, 2)}`)}
        ${linha('Ida = km × CCD + CC', brl(c.ida))}
        ${c.retornoVazio ? linha('Retorno vazio = 0,92 × km × CCD', brl(c.retorno)) : ''}
        ${linha('<b>Piso mínimo ANTT</b>', `<b>${brl(c.piso)}</b>`)}
        ${c.pedagio ? linha('Pedágio', brl(c.pedagio)) + linha('<b>Total</b>', `<b>${brl(c.total)}</b>`) : ''}
        ${linha('R$/km (ida)', num(c.total / c.distancia, 2))}
        ${c.toneladas > 0 ? linha(`R$/t (${num(c.toneladas, 1)} t)`, brl(c.total / c.toneladas)) : ''}
      </table>
      <p class="rodape">${esc(c.norma)}. Fonte: calculadora oficial da ANTT (${esc(tabela.url)}).
        O piso não inclui diárias, impostos, seguro e demais itens negociáveis (art. 5º, I, III e IV).</p>`;
    window.print();
  }

  function salvarCotacao() {
    const c = montarCotacao();
    if (!c) { aviso('Calcule o frete primeiro.'); return; }
    cotacoes.unshift(c);
    cotacoes = cotacoes.slice(0, 100);
    aviso(gravar(CHAVES.cotacoes, cotacoes) ? 'Cotação salva.' : 'Não foi possível salvar no aparelho.');
    renderCotacoes();
  }
  function renderCotacoes() {
    $('qtd-cot').textContent = cotacoes.length;
    $('lista-cot').innerHTML = cotacoes.length ? cotacoes.map((c, i) => `
      <li><span class="nome">${esc(c.destinos.length ? c.destinos.join(' → ') : `${num(c.distancia, 0)} km`)}
        <small>${esc(dataBR(c.data))} · ${esc(c.tipo)} · ${c.eixos} eixos · <b>${brl(c.total)}</b></small></span>
        <span class="acoes"><button data-cot-share="${i}" title="Compartilhar">↗</button><button data-cot-pdf="${i}" title="PDF">🖨</button><button data-cot-del="${i}" title="Excluir">✕</button></span></li>`).join('')
      : '<li class="vazio">Nenhuma cotação salva.</li>';
  }
  $('lista-cot').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.cotShare) compartilhar(cotacoes[+d.cotShare]);
    else if (d.cotPdf) imprimir(cotacoes[+d.cotPdf]);
    else if (d.cotDel && confirm('Excluir esta cotação?')) {
      cotacoes.splice(+d.cotDel, 1); gravar(CHAVES.cotacoes, cotacoes); renderCotacoes();
    }
  };
  $('btn-compartilhar').onclick = () => compartilhar(montarCotacao());
  $('btn-pdf').onclick = () => imprimir(montarCotacao());
  $('btn-salvar-cot').onclick = salvarCotacao;

  // ---------- lote: km por estrada de todas as fazendas ----------
  // Identifica o conjunto de fazendas para saber se o lote salvo ainda vale.
  function assinaturaFazendas() {
    let h = 5381;
    for (const f of fazendas) for (const ch of `${f.lat.toFixed(5)},${f.lon.toFixed(5)};`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
    return `${fazendas.length}:${h}`;
  }
  const loteValido = () => !!lote && lote.assinatura === assinaturaFazendas() && lote.itens.length === fazendas.length;
  function maisProxima(it) {
    const rv = it.kmRV ?? Infinity, pg = it.kmPG ?? Infinity;
    if (rv === Infinity && pg === Infinity) return null;
    return rv <= pg ? { origem: ORIGENS[0], km: rv, seg: it.segRV } : { origem: ORIGENS[1], km: pg, seg: it.segPG };
  }
  const espera = ms => new Promise(r => setTimeout(r, ms));

  async function calcularLote() {
    if (!fazendas.length) { aviso('Importe as fazendas primeiro.'); return; }
    const btn = $('btn-lote'), prog = $('prog-lote'), st = $('status-lote');
    const BLOCO = 98; // o servidor público do OSRM aceita até 100 pontos por consulta
    const itens = new Array(fazendas.length);
    btn.disabled = true; prog.classList.remove('oculto'); prog.value = 0;
    try {
      for (let i = 0; i < fazendas.length; i += BLOCO) {
        const parte = fazendas.slice(i, i + BLOCO);
        const url = `${OSRM}/table/v1/driving/${coordsStr([ORIGENS[0], ORIGENS[1], ...parte])}?sources=0;1&annotations=distance,duration`;
        let j;
        for (let tentativa = 1; ; tentativa++) {
          try { j = await osrm(url); break; }
          catch (e) { if (tentativa >= 3) throw e; await espera(3000 * tentativa); }
        }
        parte.forEach((_, k) => {
          const d = j.distances, s = j.durations;
          itens[i + k] = {
            kmRV: d[0][k + 2] == null ? null : d[0][k + 2] / 1000, segRV: s[0][k + 2],
            kmPG: d[1][k + 2] == null ? null : d[1][k + 2] / 1000, segPG: s[1][k + 2],
          };
        });
        const feitos = Math.min(i + BLOCO, fazendas.length);
        prog.value = feitos / fazendas.length;
        st.textContent = `Calculando… ${feitos} de ${fazendas.length} fazendas`;
        await espera(1000);
      }
      lote = { assinatura: assinaturaFazendas(), data: new Date().toISOString(), itens };
      gravar(CHAVES.lote, lote);
      renderStatusLote(); renderFazendas();
    } catch (e) {
      st.textContent = 'Falha ao calcular as distâncias: ' + e.message + '. Tente de novo em alguns minutos.';
    } finally {
      btn.disabled = false; prog.classList.add('oculto');
    }
  }
  function renderStatusLote() {
    const st = $('status-lote');
    if (!loteValido()) { st.textContent = fazendas.length ? 'Ainda não calculado para as fazendas atuais.' : ''; return; }
    const prox = lote.itens.map(maisProxima);
    const cont = id => prox.filter(p => p && p.origem.id === id).length;
    const sem = prox.filter(p => !p).length;
    st.textContent = `Calculado em ${dataBR(lote.data)}: ${cont('pg')} fazendas mais perto de Palmeiras, ${cont('rv')} de Rio Verde` +
      (sem ? `, ${sem} sem rota por estrada.` : '.');
  }

  function exportarLote() {
    if (!loteValido()) { aviso('Calcule as distâncias primeiro (“Calcular todas”).'); return; }
    const p = {
      tipo: $('tipo-carga').value, eixos: Number($('eixos').value),
      composicao: $('composicao').checked, altoDesempenho: $('alto-desempenho').checked,
      retornoVazio: $('retorno-vazio').checked,
    };
    const t = Number($('toneladas').value);
    const r1 = v => (v == null ? '' : Math.round(v * 10) / 10);
    const min = s => (s == null ? '' : Math.round(s / 60));
    const linhas = fazendas.map((f, i) => {
      const it = lote.itens[i], m = maisProxima(it);
      const base = {
        'Fazenda': f.nome, 'Descrição': f.desc, 'Latitude': f.lat, 'Longitude': f.lon,
        'Km Rio Verde': r1(it.kmRV), 'Min Rio Verde': min(it.segRV),
        'Km Palmeiras': r1(it.kmPG), 'Min Palmeiras': min(it.segPG),
      };
      if (!m) return { ...base, 'Unidade mais próxima': 'sem rota' };
      const km = Math.max(1, Math.round(m.km));
      const r = FreteANTT.calcular(tabela, { ...p, distancia: km });
      return {
        ...base, 'Unidade mais próxima': m.origem.nome, 'Km ida (ANTT)': km,
        'CCD': r.ccd, 'CC': r.cc, 'Ida (R$)': r.ida, 'Retorno vazio (R$)': r.retorno, 'Piso ANTT (R$)': r.piso,
        'R$/km': Math.round(r.piso / km * 100) / 100,
        ...(t > 0 ? { [`R$/t (${num(t, 1)} t)`]: Math.round(r.piso / t * 100) / 100 } : {}),
      };
    });
    const letra = FreteANTT.letraTabela(p.composicao, p.altoDesempenho);
    const params = [
      ['Parâmetros do cálculo'], [],
      ['Tipo de carga', tabela.tipos[p.tipo]], ['Nº de eixos', p.eixos], ['Operação', tabela.nomesTabelas[letra]],
      ['Retorno vazio', p.retornoVazio ? 'Sim (0,92 × km × CCD)' : 'Não'], ['Toneladas', t > 0 ? t : '—'],
      ['Distâncias calculadas em', dataBR(lote.data)], ['Rotas', 'OSRM / OpenStreetMap (por estrada)'],
      ['Norma', `${tabela.norma}, atualizada em ${tabela.atualizacao}`], ['Fonte', tabela.url],
      ['Observação', 'Piso mínimo = km × CCD + CC (+ retorno vazio). Não inclui pedágio, diárias, impostos e seguro.'],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws['!cols'] = Object.keys(linhas.find(l => l['Piso ANTT (R$)'] !== undefined) || linhas[0]).map(k => ({ wch: k === 'Fazenda' || k === 'Descrição' || k === 'Unidade mais próxima' ? 34 : 13 }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    XLSX.utils.book_append_sheet(wb, ws, 'Fazendas');
    const wp = XLSX.utils.aoa_to_sheet(params);
    wp['!cols'] = [{ wch: 26 }, { wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wp, 'Parâmetros');
    XLSX.writeFile(wb, `Frete_ANTT_fazendas_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  $('btn-lote').onclick = calcularLote;
  $('btn-exportar-lote').onclick = exportarLote;

  // ---------- aba tabela ----------
  function renderTabela() {
    $('info-tabela').innerHTML = `
      <p><b>${esc(tabela.norma)}</b><br>Atualização: <b>${esc(tabela.atualizacao)}</b></p>
      <p>Fonte: <a href="${esc(tabela.url)}" target="_blank" rel="noopener">${esc(tabela.fonte)}</a><br>
      Coeficientes conferidos em: ${esc(tabela.consultadoEm)}</p>
      ${tabela !== window.ANTT_TABELA ? '<p class="alerta">Usando tabela importada neste aparelho.</p>' : ''}`;
    const letra = $('sel-tabela').value, t = tabela.tabelas[letra] || {};
    const eixos = [2, 3, 4, 5, 6, 7, 9];
    $('grade-tabela').innerHTML = `<thead><tr><th>Tipo de carga</th>${eixos.map(e => `<th>${e} eixos<br><small>CCD · CC</small></th>`).join('')}</tr></thead><tbody>` +
      Object.entries(tabela.tipos).map(([id, nome]) => `<tr><td>${esc(nome)}</td>${eixos.map(e => {
        const v = (t[id] || {})[e]; return `<td>${v ? `${num(v[0], 4)}<br><small>${num(v[1], 2)}</small>` : '–'}</td>`;
      }).join('')}</tr>`).join('') + '</tbody>';
  }
  $('sel-tabela').onchange = renderTabela;
  $('arquivo-tabela').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      let txt = await f.text();
      txt = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
      const t = JSON.parse(txt);
      if (!t.tabelas || !t.tipos || !t.tabelas.A) throw new Error('formato inválido');
      tabela = t; gravar(CHAVES.tabela, t);
      preencherTipos(); renderTabela(); calcularFrete(); aviso('Tabela importada.');
    } catch (err) { aviso('Erro ao importar tabela: ' + err.message); }
    e.target.value = '';
  };
  $('btn-tabela-padrao').onclick = () => {
    try { localStorage.removeItem(CHAVES.tabela); } catch (e) { /* sem armazenamento */ }
    tabela = window.ANTT_TABELA; preencherTipos(); renderTabela(); calcularFrete();
  };

  // ---------- abas e eventos ----------
  function trocarAba(nome) {
    document.querySelectorAll('.abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
    document.querySelectorAll('.aba').forEach(s => s.classList.toggle('ativa', s.id === 'aba-' + nome));
    if (nome === 'tabela') renderTabela();
    if (nome === 'fazendas') renderFazendas();
  }
  document.querySelector('.abas').onclick = e => { const b = e.target.closest('button'); if (b) trocarAba(b.dataset.aba); };

  $('origem').innerHTML = ORIGENS.map(o => `<option value="${o.id}">${esc(o.nome)}</option>`).join('');
  $('origem').value = salvo.origem || 'pg';
  $('origem').onchange = () => { rotaInvalida(); salvarEstado(); mapa.panTo([origemAtual().lat, origemAtual().lon]); };
  $('volta-origem').checked = salvo.volta ?? true;
  $('volta-origem').onchange = () => { rotaInvalida(); salvarEstado(); };
  $('btn-rota').onclick = calcularRota;
  $('btn-otimizar').onclick = otimizar;
  $('btn-limpar').onclick = () => { paradas = []; rotaInvalida(); renderParadas(); };
  $('btn-gmaps').onclick = abrirGoogleMaps;
  $('btn-usar-rota').onclick = () => rota ? aplicarRotaNoFrete() : aviso('Calcule uma rota na aba Rota.');

  preencherTipos();
  if (salvo.eixos) $('eixos').value = salvo.eixos;
  if (salvo.composicao !== undefined) $('composicao').checked = salvo.composicao;
  if (salvo.alto !== undefined) $('alto-desempenho').checked = salvo.alto;
  if (salvo.retorno !== undefined) $('retorno-vazio').checked = salvo.retorno;
  ['tipo-carga', 'eixos', 'distancia', 'composicao', 'alto-desempenho', 'retorno-vazio', 'distancia-retorno', 'pedagio', 'toneladas']
    .forEach(id => $(id).addEventListener('input', calcularFrete));

  desenharFazendas(); renderParadas(); calcularFrete(); renderCotacoes(); renderStatusLote();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sem offline */ });
  }
})();
