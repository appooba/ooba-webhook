#!/usr/bin/env python3
"""
Skill: compor_post_ooba
Monta a arte final de posts do Instagram da OOBA colando o LOGO REAL (não gerado por IA)
sobre um fundo fotográfico, com a paleta oficial (azul #011581 -> roxo #AC3CCD) e dados reais.

Uso:
  python3 compor_post_ooba.py --bg <caminho_fundo.png> --titulo "TELA EM DESTAQUE" \
    --linha1 "Academia R2 — Shopping Porto Feliz Boulevard" \
    --linha2 "Alcance mensal: 13.240 pessoas" \
    --linha3 "Horário: Seg-Dom 09h30-18h30" \
    --out post_final.png

Requisitos:
  - Fundo deve ser gerado via generate_image ANTES, com uma área central reservada
    para uma "tela" (screen) em branco/escura — descreva isso no prompt de geração.
  - Logo real: brand_assets/ooba_logo.png
  - Ícone real: brand_assets/ooba_icone.png
  - NUNCA peça pra IA "desenhar" o logo OOBA — sempre colar o arquivo real via PIL.
  - SEMPRE puxar nome/giro/horário reais da entidade "Tela" (nunca inventar).
"""
import argparse
from PIL import Image, ImageDraw, ImageFont

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


def compor(bg_path, titulo, linhas, out_path, logo_path=LOGO_PATH, icon_path=ICON_PATH,
           incluir_tela_mockup=True):
    bg = Image.open(bg_path).convert("RGBA")
    W, H = bg.size

    overlay = Image.new("RGBA", bg.size, (0, 0, 0, 90))
    bg = Image.alpha_composite(bg, overlay)
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

    if incluir_tela_mockup:
        frame_w, frame_h = 420, 520
        fx, fy = (W - frame_w) // 2, 260
        draw.rounded_rectangle([fx - 15, fy - 15, fx + frame_w + 15, fy + frame_h + 15],
                                 radius=20, fill=(15, 15, 15, 255))
        draw.rounded_rectangle([fx, fy, fx + frame_w, fy + frame_h], radius=12,
                                 fill=(8, 8, 10, 255))

        icon = Image.open(icon_path).convert("RGBA")
        icon_size = 220
        icon = icon.resize((icon_size, icon_size), Image.LANCZOS)
        icon_x = fx + (frame_w - icon_size) // 2
        icon_y = fy + 60
        bg.paste(icon, (icon_x, icon_y), icon)

        logo = Image.open(logo_path).convert("RGBA")
        logo_ratio = logo.width / logo.height
        logo_w = 300
        logo_h = int(logo_w / logo_ratio)
        logo_resized = logo.resize((logo_w, logo_h), Image.LANCZOS)
        logo_x = fx + (frame_w - logo_w) // 2
        logo_y = icon_y + icon_size + 20
        bg.paste(logo_resized, (logo_x, logo_y), logo_resized)

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
    ap.add_argument("--sem-mockup", action="store_true", help="Não desenhar mockup de tela (para posts institucionais/educacionais)")
    args = ap.parse_args()

    compor(args.bg, args.titulo, [args.linha1, args.linha2, args.linha3], args.out,
           incluir_tela_mockup=not args.sem_mockup)
    print(f"Imagem gerada: {args.out}")
