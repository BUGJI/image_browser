import colorsys
import os

seeds = ['aurora','forest','mountain','ocean','city','sunset','flower','snow',
'desert','lake','stars','rain','spring','summer','autumn','winter',
'cloud','river','valley','island','bridge','tower','street','night',
'dawn','dusk','garden','park','beach','canyon','waterfall','meadow',
'harbor','village','castle','temple','statue','fountain','pier','skyline']

outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-img')
os.makedirs(outdir, exist_ok=True)

for i, seed in enumerate(seeds):
    w = 300 + ((i * 97) % 520)
    h = 220 + ((i * 173) % 640)
    hue = (i * 47) % 360
    c1 = colorsys.hsv_to_rgb(hue / 360, 0.55, 0.9)
    c2 = colorsys.hsv_to_rgb(((hue + 60) % 360) / 360, 0.65, 0.55)
    c1s = ','.join(str(int(x * 255)) for x in c1)
    c2s = ','.join(str(int(x * 255)) for x in c2)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="rgb({c1s})"/><stop offset="100%" stop-color="rgb({c2s})"/>
</linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" font-size="24" fill="rgba(255,255,255,0.85)" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">{seed} {w}x{h}</text>
</svg>'''
    with open(os.path.join(outdir, f'{seed}.svg'), 'w') as f:
        f.write(svg)
print('generated', len(seeds), 'svgs')
