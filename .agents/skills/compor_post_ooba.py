#!/usr/bin/env python3
"""
Skill: compor_post_ooba
Monta a arte final de posts do Instagram da OOBA colando o LOGO REAL (não gerado por IA)
sobre um fundo fotográfico, dentro de um mockup de tela de TV com leve perspectiva,
usando a paleta oficial (azul #011581 -> roxo #AC3CCD) e dados reais.

IMPORTANTE: o logo NUNCA é redesenhado pela IA — é sempre o arquivo real
(brand_assets/ooba_logo.png / ooba_icone.png) colado via PIL com transformação de
perspectiva (numpy), garantindo fidelidade exata de cor e forma. A IA só gera o
fundo fotográfico (pessoas, ambiente) — nunca a tela nem o logo.

Uso:
  python3 compor_post_ooba.py --bg <caminho_fundo.png> --titulo "TELA EM DESTAQUE" \
    --linha1 "Academia R2 — Shopping Porto Feliz Boulevard" \
    --linha2 "Alcance mensal: 13.240 pessoas" \
    --linha3 "Horário: Seg-Dom 09h30-18h30" \
    --out post_final.png
"""
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BRAND_BLUE = (1, 21, 129)
BRAND_PURPLE = (172, 60, 205)
LOGO_PATH = "brand_assets/ooba_logo.png"
ICON_PATH = "brand_assets/ooba_icone.png"


def get_font(size, bold=True):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def find_coeffs(source_coords, target_coords):
    """Coeficientes para Image.transform(..., Image.PERSPECTIVE, coeffs).
    Mapeia o retangulo fonte (da logo) para o quadrilatero alvo (na tela)."""
    matrix = []
    for s, t in zip(source_coords, target_coords):
        matrix.append([t[0], t[1], 1, 0, 0, 0, -s[0] * t[0], -s[0] * t[1]])
        matrix.append([0, 0, 0, t[0], t[1], 1, -s[1] * t[0], -s[1] * t[1]])
    A = np.array(matrix, dtype=float)
    B = np.array(source_coords).reshape(8)
    res = np.linalg.solve(A, B)
    return res.tolist()


def paste_perspective(base, overlay_img, quad):
    """Cola overlay_img (RGBA) dentro do quadrilatero `quad` = [(x,y) x4] em base (RGBA),
    aplicando transformacao de perspectiva real (mantem cores/forma exatas)."""
    ow, oh = overlay_img.size
    src = [(0, 0), (ow, 0), (ow, oh), (0, oh)]
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cw, ch = int(max_x - min_x) + 2, int(max_y - min_y) + 2
    local_quad = [(x - min_x, y - min_y) for x, y in quad]

    coeffs = find_coeffs(src, local_quad)
    warped = overlay_img.transform((cw, ch), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    base.paste(warped, (int(min_x), int(min_y)), warped)


def draw_tv_mockup(bg, screen_quad, bezel_pad=18):
    """Desenha uma moldura de TV realista (bezel escuro) ao redor do quad da tela."""
    draw = ImageDraw.Draw(bg, "RGBA")
    xs = [p[0] for p in screen_quad]
    ys = [p[1] for p in screen_quad]
    outer = [
        (xs[0] - bezel_pad, ys[0] - bezel_pad),
        (xs[1] + bezel_pad, ys[1] - bezel_pad),
        (xs[2] + bezel_pad, ys[2] + bezel_pad),
        (xs[3] - bezel_pad, ys[3] + bezel_pad),
    ]
    # sombra suave atras da moldura
    shadow = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.polygon(outer, fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    bg.alpha_composite(shadow)
    draw.polygon(outer, fill=(12, 12, 14, 255), outline=(40, 40, 45, 255))
    # tela preta antes de colar o logo (evita transparencia estranha)
    draw.polygon(screen_quad, fill=(6, 6, 8, 255))


def compor(bg_path, titulo, linhas, out_path, logo_path=LOGO_PATH, icon_path=ICON_PATH,
           incluir_tela_mockup=True):
    bg = Image.open(bg_path).convert("RGBA")
    W, H = bg.size

    overlay = Image.new("RGBA", bg.size, (0, 0, 0, 90))
    bg = Image.alpha_composite(bg, overlay)

    if incluir_tela_mockup:
        # Quadrilatero da tela com leve perspectiva (efeito de angulo, nao reto)
        cx, cy = W * 0.5, H * 0.40
        w, h = W * 0.34, H * 0.34
        skew = W * 0.035  # leve inclinacao para parecer visto de lado
        screen_quad = [
            (cx - w / 2 + skew, cy - h / 2),          # topo-esquerda
            (cx + w / 2 + skew * 0.3, cy - h / 2 - 10),  # topo-direita (um pouco mais alto)
            (cx + w / 2, cy + h / 2),                  # baixo-direita
            (cx - w / 2, cy + h / 2 + 10),              # baixo-esquerda
        ]
        draw_tv_mockup(bg, screen_quad)

        # Monta um "slide" (icone + wordmark) para colar com perspectiva na tela
        icon = Image.open(icon_path).convert("RGBA")
        logo = Image.open(logo_path).convert("RGBA")
        slide_w, slide_h = 700, 900
        slide = Image.new("RGBA", (slide_w, slide_h), (8, 8, 10, 255))
        icon_size = 380
        icon_r = icon.resize((icon_size, icon_size), Image.LANCZOS)
        slide.paste(icon_r, ((slide_w - icon_size) // 2, 160), icon_r)
        logo_ratio = logo.width / logo.height
        logo_w2 = 520
        logo_h2 = int(logo_w2 / logo_ratio)
        logo_r = logo.resize((logo_w2, logo_h2), Image.LANCZOS)
        slide.paste(logo_r, ((slide_w - logo_w2) // 2, 160 + icon_size + 40), logo_r)

        paste_perspective(bg, slide, screen_quad)

        # leve brilho/reflexo diagonal sobre a tela pra parecer vidro
        gloss = Image.new("RGBA", bg.size, (0, 0, 0, 0))
        gdraw = ImageDraw.Draw(gloss)
        xs = [p[0] for p in screen_quad]
        ys = [p[1] for p in screen_quad]
        gdraw.polygon(screen_quad, fill=(255, 255, 255, 18))
        bg.alpha_composite(gloss)

    draw = ImageDraw.Draw(bg)
    title_font = get_font(52)
    value_font = get_font(34)
    sub_font = get_font(28)

    # Banner superior
    banner_h = 110
    draw.rectangle([0, 0, W, banner_h], fill=(*BRAND_BLUE, 230))
    bbox = draw.textbbox((0, 0), titulo, font=title_font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) / 2, (banner_h - (bbox[3] - bbox[1])) / 2 - bbox[1]), titulo,
               font=title_font, fill=(255, 255, 255, 255))

    # Painel inferior em gradiente oficial
    panel_h = 280
    panel_y = H - panel_h
    grad = Image.new("RGBA", (W, panel_h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(grad)
    for x in range(W):
        t = x / W
        r = int(BRAND_BLUE[0] + (BRAND_PURPLE[0] - BRAND_BLUE[0]) * t)
        g = int(BRAND_BLUE[1] + (BRAND_PURPLE[1] - BRAND_BLUE[1]) * t)
        b = int(BRAND_BLUE[2] + (BRAND_PURPLE[2] - BRAND_BLUE[2]) * t)
        gdraw.line([(x, 0), (x, panel_h)], fill=(r, g, b, 235))
    bg.paste(grad, (0, panel_y), grad)

    ly = panel_y + 30
    for txt in linhas:
        bbox = draw.textbbox((0, 0), txt, font=value_font)
        tw = bbox[2] - bbox[0]
        draw.text(((W - tw) / 2, ly), txt, font=value_font, fill=(255, 255, 255, 255))
        ly += 60

    contact = "ooba.com.br   |   contato@ooba.com.br"
    bbox = draw.textbbox((0, 0), contact, font=sub_font)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) / 2, H - 40), contact, font=sub_font, fill=(230, 230, 230, 255))

    bg.convert("RGB").save(out_path, quality=95)
    return out_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", required=True)
    ap.add_argument("--titulo", default="TELA EM DESTAQUE")
    ap.add_argument("--linha1", required=True)
    ap.add_argument("--linha2", required=True)
    ap.add_argument("--linha3", required=True)
    ap.add_argument("--out", default="post_final.png")
    ap.add_argument("--sem-mockup", action="store_true")
    args = ap.parse_args()

    compor(args.bg, args.titulo, [args.linha1, args.linha2, args.linha3], args.out,
           incluir_tela_mockup=not args.sem_mockup)
    print(f"Imagem gerada: {args.out}")
