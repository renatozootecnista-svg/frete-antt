// Cálculo do piso mínimo de frete – Resolução ANTT nº 5.867/2020 (Lei 13.703/2018).
// Ida = Distância × CCD + CC ; Retorno vazio = 0,92 × Distância × CCD.
(function () {
  'use strict';

  // Tabela conforme a operação: composição/lotação (A, C) ou só veículo automotor (B, D);
  // alto desempenho (C, D).
  function letraTabela(composicao, altoDesempenho) {
    if (composicao) return altoDesempenho ? 'C' : 'A';
    return altoDesempenho ? 'D' : 'B';
  }

  // Nota 1 da ANTT: eixos não previstos usam a quantidade imediatamente inferior,
  // ou a superior quando não existe inferior.
  function coeficientes(tabela, letra, tipo, eixos) {
    const linha = (tabela.tabelas[letra] || {})[tipo] || {};
    const disponiveis = Object.keys(linha).map(Number).sort((a, b) => a - b);
    if (!disponiveis.length) return null;
    let usado = disponiveis.filter(e => e <= eixos).pop();
    if (usado === undefined) usado = disponiveis[0];
    const [ccd, cc] = linha[usado];
    return { ccd, cc, eixosUsados: usado, ajustado: usado !== eixos };
  }

  const arred2 = v => Math.round(v * 100) / 100;

  function calcular(tabela, p) {
    const letra = letraTabela(p.composicao, p.altoDesempenho);
    const c = coeficientes(tabela, letra, p.tipo, p.eixos);
    if (!c) return { erro: 'Não há coeficiente para este tipo de carga nesta tabela.' };
    const dist = Number(p.distancia) || 0;
    const distRet = p.retornoVazio ? (p.distanciaRetorno != null ? Number(p.distanciaRetorno) : dist) : 0;
    // Como na calculadora oficial: soma sem arredondar e arredonda só o resultado
    // (ex.: 433,035 + 213,178 = 646,21, e não 433,04 + 213,18 = 646,22).
    const idaBruta = dist * c.ccd + c.cc;
    const retornoBruto = p.retornoVazio ? tabela.fatorRetornoVazio * distRet * c.ccd : 0;
    const pedagio = arred2(Number(p.pedagio) || 0);
    const piso = arred2(idaBruta + retornoBruto);
    return {
      letra, ...c, distancia: dist, distanciaRetorno: distRet,
      ida: arred2(idaBruta), retorno: arred2(retornoBruto), piso, pedagio, total: arred2(piso + pedagio),
    };
  }

  window.FreteANTT = { letraTabela, coeficientes, calcular };
})();
