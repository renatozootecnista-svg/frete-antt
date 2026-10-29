"""Atualiza antt-tabela.js consultando a calculadora oficial da ANTT.

A ANTT atualiza os coeficientes (CCD e CC) por resolução ou portaria SUROC, em geral em
janeiro e julho, ou quando o diesel varia mais de 5% (Lei 13.703/2018). Rode este script
depois de cada atualização e publique o novo antt-tabela.js junto com o app.

Uso:
    python atualizar_tabela_antt.py            # tabela completa (~336 consultas, ~6 min)
    python atualizar_tabela_antt.py --teste    # só 3 consultas, para conferir o acesso
"""
import datetime as dt
import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

URL = 'https://calculadorafrete.antt.gov.br/'
EIXOS = [2, 3, 4, 5, 6, 7, 9]
# letra: (composição veicular / lotação, alto desempenho)
TABELAS = {'A': (True, False), 'B': (False, False), 'C': (True, True), 'D': (False, True)}
DESTINO = Path(__file__).resolve().parent.parent / 'antt-tabela.js'

jar = http.cookiejar.CookieJar()
abrir = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)).open


def texto(h):
    h = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', h, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', h))).strip()


def br(v):
    return float(v.replace('.', '').replace(',', '.'))


def pagina_inicial():
    h = abrir(URL, timeout=30).read().decode('utf-8')
    token = re.search(r'name="__RequestVerificationToken" type="hidden" value="([^"]+)"', h).group(1)
    sel = re.search(r'id="Filtro_IdTipoCarga".*?</select>', h, re.S).group(0)
    tipos = {v: html.unescape(n).strip() for v, n in re.findall(r'<option value="(\d+)">([^<]+)</option>', sel)}
    return token, tipos


def consultar(token, tipo, eixos, lotacao, alto):
    campos = [('__RequestVerificationToken', token), ('Filtro.IdTipoCarga', tipo),
              ('Filtro.NumeroEixos', eixos), ('Filtro.Distancia', 100)]
    for nome, marcado in (('CargaLotacao', lotacao), ('AltoDesempenho', alto), ('RetornoVazio', False)):
        if marcado:
            campos.append((f'Filtro.{nome}', 'true'))
        campos.append((f'Filtro.{nome}', 'false'))
    req = urllib.request.Request(URL + '?Length=4', data=urllib.parse.urlencode(campos).encode(),
                                 headers={'X-Requested-With': 'XMLHttpRequest'})
    t = texto(abrir(req, timeout=30).read().decode('utf-8'))
    m = re.search(r'Opera[çc][ãa]o de Transporte:\s*(.*?)\s*Dist[âa]ncia.*?\(CCD\):\s*([\d.,]+).*?\(CC\):\s*([\d.,]+)', t)
    if not m:
        raise RuntimeError(f'resposta inesperada para tipo {tipo}, {eixos} eixos: {t[:300]}')
    norma = re.search(r'CONFORME (Resolu.*?)\s+R\$', t)
    return m.group(1), br(m.group(2)), br(m.group(3)), norma.group(1) if norma else ''


def main():
    teste = '--teste' in sys.argv
    token, tipos = pagina_inicial()
    print(f'{len(tipos)} tipos de carga encontrados')
    tabelas, nomes, norma = {}, {}, ''
    for letra, (lot, alto) in TABELAS.items():
        tabelas[letra] = {}
        for tipo in tipos:
            tabelas[letra][tipo] = {}
            for e in EIXOS:
                nome, ccd, cc, norma = consultar(token, tipo, e, lot, alto)
                nomes[letra] = nome
                tabelas[letra][tipo][e] = [ccd, cc]
                print(f'{letra} {tipos[tipo]:<40} {e} eixos  CCD {ccd:8.4f}  CC {cc:9.2f}')
                time.sleep(0.4)
                if teste and sum(len(x) for t in tabelas.values() for x in t.values()) >= 3:
                    print('Teste ok:', norma)
                    return
    # "Resolução ANTT nº 5.867/2020, atualizada em 30/09/2026 pela PORT.SUROC Nº22/2026"
    m = re.match(r'(.*?),?\s*atualizada em (.*)', norma)
    dados = {
        'norma': m.group(1) if m else norma,
        'atualizacao': m.group(2).replace(' pela ', ' – ') if m else '',
        'fonte': 'Calculadora oficial de piso mínimo de frete – ANTT',
        'url': URL,
        'consultadoEm': dt.date.today().strftime('%d/%m/%Y'),
        'fatorRetornoVazio': 0.92,
        'nomesTabelas': nomes,
        'tipos': tipos,
        'tabelas': tabelas,
    }
    DESTINO.write_text(
        '// Coeficientes do piso mínimo de frete ANTT (gerado por ferramentas/atualizar_tabela_antt.py).\n'
        '// Valores por eixo já incluem a regra da ANTT para eixos sem coeficiente próprio.\n'
        'window.ANTT_TABELA = ' + json.dumps(dados, ensure_ascii=False, indent=1) + ';\n',
        encoding='utf-8')
    print('Gravado', DESTINO)


if __name__ == '__main__':
    main()
