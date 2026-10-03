import io
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


DPI = 300
PAGE_MM = (62, 45)
ACCENT = "#17b3a2"
BLACK = "#1f1f1f"
WHITE = "#ffffff"


def px(mm):
    return int(round(mm * DPI / 25.4))


def pt(mm):
    return mm * 72 / 25.4


def font_path(*names):
    font_dir = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    for name in names:
        path = os.path.join(font_dir, name)
        if os.path.exists(path):
            return path
    return None


def load_font(size, *names):
    path = font_path(*names)
    if path:
        return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


FONTS = {
    "impact": lambda size: load_font(size, "impact.ttf", "arialbd.ttf"),
    "narrow": lambda size: load_font(size, "arialn.ttf", "arial.ttf"),
    "narrow_bold": lambda size: load_font(size, "arialnb.ttf", "arialbd.ttf"),
    "arial": lambda size: load_font(size, "arial.ttf"),
    "arial_bold": lambda size: load_font(size, "arialbd.ttf", "arial.ttf"),
}


def text_size(draw, text, font):
    if not text:
        return (0, 0)
    box = draw.textbbox((0, 0), text, font=font)
    return (box[2] - box[0], box[3] - box[1])


def fit_font(draw, text, font_factory, start_size, max_width, min_size=16):
    size = start_size
    font = font_factory(size)
    while size > min_size and text_size(draw, text, font)[0] > max_width:
        size -= 1
        font = font_factory(size)
    return font


def wrap_text(draw, text, font, max_width, max_lines):
    if not text:
        return []
    words = str(text).split()
    lines = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if text_size(draw, candidate, font)[0] <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    return lines[:max_lines]


QR_VERSIONS = [
    {"version": 1, "data": 19, "ecc": 7, "alignment": []},
    {"version": 2, "data": 34, "ecc": 10, "alignment": [6, 18]},
    {"version": 3, "data": 55, "ecc": 15, "alignment": [6, 22]},
    {"version": 4, "data": 80, "ecc": 20, "alignment": [6, 26]},
]


def make_qr_gf():
    exp = [0] * 512
    log = [0] * 256
    value = 1
    for index in range(255):
        exp[index] = value
        log[value] = index
        value <<= 1
        if value & 0x100:
            value ^= 0x11D
    for index in range(255, 512):
        exp[index] = exp[index - 255]
    return exp, log


QR_GF_EXP, QR_GF_LOG = make_qr_gf()


def gf_mul(left, right):
    if not left or not right:
        return 0
    return QR_GF_EXP[QR_GF_LOG[left] + QR_GF_LOG[right]]


def reed_solomon_generator(degree):
    poly = [1]
    for index in range(degree):
        next_poly = [0] * (len(poly) + 1)
        for pos, value in enumerate(poly):
            next_poly[pos] ^= value
            next_poly[pos + 1] ^= gf_mul(value, QR_GF_EXP[index])
        poly = next_poly
    return poly


def reed_solomon_remainder(data, degree):
    generator = reed_solomon_generator(degree)
    result = [0] * degree
    for byte in data:
        factor = byte ^ result.pop(0)
        result.append(0)
        for index in range(degree):
            result[index] ^= gf_mul(generator[index + 1], factor)
    return result


def make_qr_data(payload_bytes, data_codewords):
    bits = []

    def push_bits(value, length):
        for shift in range(length - 1, -1, -1):
            bits.append((value >> shift) & 1)

    push_bits(4, 4)
    push_bits(len(payload_bytes), 8)
    for byte in payload_bytes:
        push_bits(byte, 8)
    capacity = data_codewords * 8
    push_bits(0, min(4, capacity - len(bits)))
    while len(bits) % 8:
        bits.append(0)
    data = []
    for index in range(0, len(bits), 8):
        value = 0
        for bit in bits[index : index + 8]:
            value = (value << 1) | bit
        data.append(value)
    pad = 0xEC
    while len(data) < data_codewords:
        data.append(pad)
        pad = 0x11 if pad == 0xEC else 0xEC
    return data


def reserve_format_areas(reserved, size):
    for index in range(9):
        if index != 6:
            reserved[8][index] = True
            reserved[index][8] = True
    for index in range(8):
        reserved[8][size - 1 - index] = True
        reserved[size - 1 - index][8] = True


def place_qr_data(modules, reserved, size, codewords):
    bits = []
    for byte in codewords:
        for shift in range(7, -1, -1):
            bits.append((byte >> shift) & 1)
    bit_index = 0
    direction = -1
    right = size - 1
    while right >= 1:
        if right == 6:
            right -= 1
        for row in range(size):
            y = size - 1 - row if direction == -1 else row
            for column in range(2):
                x = right - column
                if reserved[y][x]:
                    continue
                bit = bits[bit_index] if bit_index < len(bits) else 0
                modules[y][x] = bool(bit ^ (1 if (x + y) % 2 == 0 else 0))
                bit_index += 1
        direction *= -1
        right -= 2


def write_format_bits(modules, reserved, size):
    bits = 0b111011111000100

    def set_bit(x, y, bit):
        modules[y][x] = bool(bit)
        reserved[y][x] = True

    for index in range(6):
        set_bit(index, 8, (bits >> index) & 1)
    set_bit(7, 8, (bits >> 6) & 1)
    set_bit(8, 8, (bits >> 7) & 1)
    set_bit(8, 7, (bits >> 8) & 1)
    for index in range(9, 15):
        set_bit(8, 14 - index, (bits >> index) & 1)
    for index in range(8):
        set_bit(size - 1 - index, 8, (bits >> index) & 1)
    for index in range(8, 15):
        set_bit(8, size - 15 + index, (bits >> index) & 1)


def draw_qr_matrix(config, codewords):
    size = 17 + config["version"] * 4
    modules = [[False for _ in range(size)] for _ in range(size)]
    reserved = [[False for _ in range(size)] for _ in range(size)]

    def set_module(x, y, dark, keep=True):
        if x < 0 or y < 0 or x >= size or y >= size:
            return
        modules[y][x] = bool(dark)
        if keep:
            reserved[y][x] = True

    def finder(left, top):
        for y in range(-1, 8):
            for x in range(-1, 8):
                xx = left + x
                yy = top + y
                if xx < 0 or yy < 0 or xx >= size or yy >= size:
                    continue
                dark = (
                    x >= 0
                    and x <= 6
                    and y >= 0
                    and y <= 6
                    and (
                        x == 0
                        or x == 6
                        or y == 0
                        or y == 6
                        or (x >= 2 and x <= 4 and y >= 2 and y <= 4)
                    )
                )
                set_module(xx, yy, dark)

    finder(0, 0)
    finder(size - 7, 0)
    finder(0, size - 7)

    for index in range(8, size - 8):
        dark = index % 2 == 0
        set_module(index, 6, dark)
        set_module(6, index, dark)

    for center_y in config["alignment"]:
        for center_x in config["alignment"]:
            touches_top_left = center_x == 6 and center_y == 6
            touches_top_right = center_x == size - 7 and center_y == 6
            touches_bottom_left = center_x == 6 and center_y == size - 7
            if touches_top_left or touches_top_right or touches_bottom_left:
                continue
            for y in range(-2, 3):
                for x in range(-2, 3):
                    set_module(center_x + x, center_y + y, max(abs(x), abs(y)) != 1)

    set_module(8, size - 8, True)
    reserve_format_areas(reserved, size)
    place_qr_data(modules, reserved, size, codewords)
    write_format_bits(modules, reserved, size)
    return ["".join("1" if cell else "0" for cell in row) for row in modules]


def make_qr_matrix(text):
    payload_bytes = list(str(text).encode("utf-8"))
    config = next((item for item in QR_VERSIONS if len(payload_bytes) <= item["data"] - 3), None)
    if not config:
        return []
    data = make_qr_data(payload_bytes, config["data"])
    ecc = reed_solomon_remainder(data, config["ecc"])
    return draw_qr_matrix(config, data + ecc)


def valid_qr_rows(rows):
    return (
        isinstance(rows, list)
        and len(rows) > 0
        and all(isinstance(row, str) and len(row) == len(rows) and set(row) <= {"0", "1"} for row in rows)
    )


def qr_rows_for_material(material):
    rows = ((material.get("qr_pdf") or {}).get("matrix") or [])
    if valid_qr_rows(rows):
        return rows
    payload = str(material.get("EAN_QR") or "").strip()
    if not payload:
        return []
    return make_qr_matrix(payload)


def draw_qr(draw, material, x, y, size_px):
    rows = qr_rows_for_material(material)
    if not rows:
        return
    quiet = 3
    matrix_size = len(rows)
    view_size = matrix_size + quiet * 2
    module = max(1, math.floor(size_px / view_size))
    actual = module * view_size
    offset_x = x + (size_px - actual) // 2
    offset_y = y + (size_px - actual) // 2
    draw.rectangle([offset_x, offset_y, offset_x + actual, offset_y + actual], fill=WHITE)
    for row_index, row in enumerate(rows):
        for col_index, value in enumerate(row):
            if value == "1":
                x0 = offset_x + (col_index + quiet) * module
                y0 = offset_y + (row_index + quiet) * module
                draw.rectangle([x0, y0, x0 + module - 1, y0 + module - 1], fill=BLACK)


def draw_label(material):
    page_w, page_h = px(PAGE_MM[0]), px(PAGE_MM[1])
    image = Image.new("RGB", (page_w, page_h), WHITE)
    draw = ImageDraw.Draw(image)

    label_x = px(2)
    label_y = px(2.5)
    label_w = px(58)
    label_h = px(40)
    border = px(2.4)
    header_h = px(11.5)

    x0, y0 = label_x, label_y
    x1, y1 = label_x + label_w, label_y + label_h
    draw.rectangle([x0, y0, x1, y1], fill=ACCENT)
    draw.rectangle([x0 + border, y0 + header_h, x1 - border, y1 - border], fill=WHITE)

    title = "MATERIÁL"
    title_font = FONTS["impact"](px(3.9))
    title_x = x0 + px(1.2)
    title_y = y0 + px(3.0)
    draw.text((title_x, title_y), title, font=title_font, fill=WHITE)

    meta_left = x0 + px(18.5)
    meta_right = x1 - px(1.8)
    order = str(material.get("poradove_cislo") or "").strip()
    code = str(material.get("interny_kod") or "").strip()
    order_font = fit_font(draw, order, FONTS["narrow"], px(3.1), meta_right - meta_left, px(2.1))
    code_font = fit_font(draw, code, FONTS["narrow_bold"], px(3.1), meta_right - meta_left, px(1.8))
    order_w, _ = text_size(draw, order, order_font)
    code_w, _ = text_size(draw, code, code_font)
    draw.text((meta_right - order_w, y0 + px(2.1)), order, font=order_font, fill=WHITE)
    draw.text((meta_right - code_w, y0 + px(5.5)), code, font=code_font, fill=WHITE)

    body_left = x0 + border
    body_top = y0 + header_h
    body_right = x1 - border
    body_bottom = y1 - border

    name = str(material.get("nazov") or "").strip()
    name_box = [
        body_left + px(1.7),
        body_top + px(1.0),
        body_right - px(1.7),
        body_top + px(11.7),
    ]
    name_font = FONTS["narrow_bold"](px(3.4))
    max_name_width = name_box[2] - name_box[0] - px(0.4)
    lines = wrap_text(draw, name, name_font, max_name_width, 3)
    name_layer_w = max(1, name_box[2] - name_box[0])
    name_layer_h = max(1, name_box[3] - name_box[1])
    name_layer = Image.new("RGBA", (name_layer_w, name_layer_h), (0, 0, 0, 0))
    name_draw = ImageDraw.Draw(name_layer)
    line_y = px(0.7)
    for line in lines:
        name_draw.text((px(0.2), line_y), line, font=name_font, fill=BLACK)
        line_y += px(3.9)
    image.paste(name_layer, (name_box[0], name_box[1]), name_layer)

    qr_size = px(13.3)
    qr_x = body_left - px(0.4)
    qr_y = body_bottom + px(0.45) - qr_size
    draw_qr(draw, material, qr_x, qr_y, qr_size)

    unit = str(material.get("merna_jednotka") or "").strip()
    unit_font = FONTS["arial_bold"](px(3.2))
    draw.text((body_left + px(13.7), body_bottom - px(5.7)), unit, font=unit_font, fill=BLACK)

    shortcut = str(material.get("skratka") or "").strip()
    shortcut_max = px(27)
    shortcut_font = fit_font(draw, shortcut, FONTS["arial_bold"], px(5.15), shortcut_max, px(2.7))
    shortcut_w, shortcut_h = text_size(draw, shortcut, shortcut_font)
    draw.text((body_right - px(1.7) - shortcut_w, body_bottom - px(6.7)), shortcut, font=shortcut_font, fill=BLACK)

    return image


def load_payload(stream):
    return json.loads(stream.read().decode("utf-8"))


def main():
    payload = load_payload(sys.stdin.buffer)
    materials = payload.get("materials") or []
    output = io.BytesIO()
    page_size = (pt(PAGE_MM[0]), pt(PAGE_MM[1]))
    pdf = canvas.Canvas(output, pagesize=page_size, pageCompression=1)

    for material in materials:
        image = draw_label(material)
        pdf.drawImage(ImageReader(image), 0, 0, width=page_size[0], height=page_size[1])
        pdf.showPage()

    pdf.save()
    sys.stdout.buffer.write(output.getvalue())


if __name__ == "__main__":
    main()
