import os, struct, zlib

def png_chunk(typ, data):
    c = struct.pack('>I', len(data)) + typ + data
    c += struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    return c

# 1024×1024：electron-builder 由单张高清 PNG 自动生成各平台 .icns / .ico 尺寸族。
# 256×256 不足以派生出 macOS 的 512@2x / Windows 的多尺寸 ico，Retina 下会发糊。
W = H = 1024
# 圆角半径按原比例（40/256）随尺寸缩放
R = W * 40 // 256
rows = []
for y in range(H):
    row = b'\x00'  # filter: None
    for x in range(W):
        in_rect = (R <= x < W - R) or (R <= y < H - R) or \
                  ((x - R) ** 2 + (y - R) ** 2 <= R * R) or \
                  ((x - (W - 1 - R)) ** 2 + (y - R) ** 2 <= R * R) or \
                  ((x - R) ** 2 + (y - (H - 1 - R)) ** 2 <= R * R) or \
                  ((x - (W - 1 - R)) ** 2 + (y - (H - 1 - R)) ** 2 <= R * R)
        if in_rect:
            t = (x + y) / (W + H)
            r_, g_, b_ = int(79 + (123 - 79) * t), int(110 + (92 - 110) * t), int(247 + (240 - 247) * t)
        else:
            r_, g_, b_ = 255, 255, 255
        row += bytes((r_, g_, b_, 255))
    rows.append(row)

raw = b''.join(rows)
png = b'\x89PNG\r\n\x1a\n'
png += png_chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
png += png_chunk(b'IDAT', zlib.compress(raw, 9))
png += png_chunk(b'IEND', b'')

here = os.path.dirname(os.path.abspath(__file__))
# build/icon.png：electron-builder 的 buildResources 源图；resources/icon.png：应用运行时图标。
for rel in (os.path.join('build', 'icon.png'), os.path.join('resources', 'icon.png')):
    out = os.path.join(here, '..', rel)
    with open(out, 'wb') as f:
        f.write(png)
    print('icon written:', out, len(png), 'bytes')
