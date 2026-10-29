"""Gera fazendas-padrao.js a partir de um KMZ/KML: a lista de fazendas que já vem no app.

Uso:
    python embutir_fazendas.py "C:\\Users\\rvnat\\Downloads\\Fazendas.kmz"

Depois publique o novo fazendas-padrao.js junto com o app. Atenção: num site público,
qualquer pessoa com o endereço consegue ver esse arquivo.
"""
import datetime as dt
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

DESTINO = Path(__file__).resolve().parent.parent / 'fazendas-padrao.js'


def kmls(caminho):
    if caminho.suffix.lower() == '.kmz':
        with zipfile.ZipFile(caminho) as z:
            return [z.read(n) for n in z.namelist() if n.lower().endswith('.kml')]
    return [caminho.read_bytes()]


def local(tag):
    return tag.rsplit('}', 1)[-1]


def fazendas(dados):
    # Mesma regra do app (lerKML em app.js): ponto = coordenada; linha/polígono = média dos vértices.
    for pm in (e for e in ET.fromstring(dados).iter() if local(e.tag) == 'Placemark'):
        # Primeira ocorrência de cada tag: o Maps.me repete <name> ("Meu local") no ExtendedData.
        filhos = {}
        for e in pm.iter():
            filhos.setdefault(local(e.tag), e)
        coord = filhos.get('coordinates')
        if coord is None or not coord.text:
            continue
        pares = []
        for s in coord.text.split():
            p = s.split(',')
            try:
                pares.append((float(p[0]), float(p[1])))
            except (ValueError, IndexError):
                pass
        if not pares:
            continue
        nome = (filhos['name'].text or '').strip() if 'name' in filhos else ''
        desc = filhos['description'].text or '' if 'description' in filhos else ''
        yield {
            'nome': nome or 'Sem nome',
            'desc': re.sub(r'<[^>]*>', ' ', desc).strip()[:200],
            'lat': round(sum(p[1] for p in pares) / len(pares), 6),
            'lon': round(sum(p[0] for p in pares) / len(pares), 6),
        }


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    origem = Path(sys.argv[1])
    itens = [f for k in kmls(origem) for f in fazendas(k)]
    dados = {
        'arquivo': origem.name,
        'data': dt.datetime.fromtimestamp(origem.stat().st_mtime).strftime('%d/%m/%Y'),
        'itens': itens,
    }
    DESTINO.write_text(
        '// Fazendas que já vêm no app (gerado por ferramentas/embutir_fazendas.py).\n'
        'window.FAZENDAS_PADRAO = ' + json.dumps(dados, ensure_ascii=False, separators=(',', ':')) + ';\n',
        encoding='utf-8')
    print(f'{len(itens)} fazendas de {origem.name} gravadas em {DESTINO}')


if __name__ == '__main__':
    main()
