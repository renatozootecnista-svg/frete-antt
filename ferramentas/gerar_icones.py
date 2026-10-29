"""Gera os ícones PNG do app (caminhão branco sobre verde) sem bibliotecas externas."""
import struct
import zlib
from pathlib import Path

VERDE = (27, 94, 32)
BRANCO = (255, 255, 255)


def pixel(x, y):
    # coordenadas normalizadas 0..1; desenho dentro da zona segura (80% central)
    if 0.18 <= x <= 0.58 and 0.34 <= y <= 0.62:          # baú
        return BRANCO
    if 0.60 <= x <= 0.80 and 0.44 <= y <= 0.62:          # cabine
        return BRANCO if not (0.65 <= x <= 0.76 and 0.47 <= y <= 0.53) else VERDE
    for cx in (0.30, 0.48, 0.70):                        # rodas
        if (x - cx) ** 2 + (y - 0.67) ** 2 <= 0.055 ** 2:
            return BRANCO if (x - cx) ** 2 + (y - 0.67) ** 2 > 0.025 ** 2 else VERDE
    return VERDE


def png(tam, destino):
    linhas = b''.join(
        b'\x00' + bytes(c for x in range(tam) for c in pixel(x / tam, y / tam)) for y in range(tam)
    )

    def bloco(tipo, dados):
        return struct.pack('>I', len(dados)) + tipo + dados + struct.pack('>I', zlib.crc32(tipo + dados))

    dados = (b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', struct.pack('>IIBBBBB', tam, tam, 8, 2, 0, 0, 0))
             + bloco(b'IDAT', zlib.compress(linhas, 9)) + bloco(b'IEND', b''))
    destino.write_bytes(dados)


if __name__ == '__main__':
    pasta = Path(__file__).resolve().parent.parent / 'icons'
    pasta.mkdir(exist_ok=True)
    for t in (192, 512):
        png(t, pasta / f'icon-{t}.png')
    print('ícones gerados em', pasta)
