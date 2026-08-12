import struct, zlib

def png_chunk(typ, data):
    c = struct.pack('>I', len(data)) + typ + data
    c += struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)
    return c

W = H = 256
rows = []
for y in range(H):
    row = b'\x00'  # filter: None
    for x in range(W):
        r = 40
        in_rect = (r <= x < W - r) or (r <= y < H - r) or \
                  ((x - r) ** 2 + (y - r) ** 2 <= r * r) or \
                  ((x - (W - 1 - r)) ** 2 + (y - r) ** 2 <= r * r) or \
                  ((x - r) ** 2 + (y - (H - 1 - r)) ** 2 <= r * r) or \
                  ((x - (W - 1 - r)) ** 2 + (y - (H - 1 - r)) ** 2 <= r * r)
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

out = '/vol3/1000/data/openclaw/image_browser/resources/icon.png'
with open(out, 'wb') as f:
    f.write(png)
print('icon written:', len(png), 'bytes')
