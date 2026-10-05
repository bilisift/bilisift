"""打包发布用的 zip：只包含插件运行需要的文件，写入固定时间戳，并检查有没有个人信息。"""
import json
import re
import sys
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ROOT = Path(__file__).parent
FILES = ['manifest.json', 'content.js', 'content.css', 'LICENSE']
ICONS = [f'icons/icon-{s}.png' for s in (16, 32, 48, 128)]
# PNG 里只允许这些数据块，tEXt / iTXt / eXIf 等可能带作者、软件、路径信息的块一律拒绝
PNG_OK = {b'IHDR', b'PLTE', b'tRNS', b'IDAT', b'IEND', b'sRGB', b'gAMA', b'pHYs'}
# 不应出现在发布包里的内容：本机路径、邮箱、用户目录名等
SENSITIVE = [
    r'(?<![A-Za-z])[A-Za-z]:[\\/]',  # Windows 盘符路径
    r'/(Users|home)/',            # macOS / Linux 用户目录
    r'[\w.+-]+@[\w-]+\.[\w.]+',   # 邮箱
    r'\b(SESSDATA|bili_jct|DedeUserID)\s*=',  # B 站 Cookie 值
]

version = json.loads((ROOT / 'manifest.json').read_text('utf-8'))['version']
out = ROOT / 'dist' / f'bilisift-v{version}.zip'
out.parent.mkdir(exist_ok=True)

problems = []
for name in FILES:
    text = (ROOT / name).read_text('utf-8')
    for pat in SENSITIVE:
        for m in re.finditer(pat, text):
            line = text.count('\n', 0, m.start()) + 1
            problems.append(f'{name}:{line}: {m.group(0)!r}')
for extra in sys.argv[1:]:
    for name in FILES:
        if extra.lower() in (ROOT / name).read_text('utf-8').lower():
            problems.append(f'{name}: contains {extra!r}')
for name in ICONS:
    data = (ROOT / name).read_bytes()
    pos = 8
    while pos < len(data):
        size = int.from_bytes(data[pos:pos + 4], 'big')
        kind = data[pos + 4:pos + 8]
        if kind not in PNG_OK:
            problems.append(f'{name}: 含有元数据块 {kind.decode("latin-1")}')
        pos += 12 + size
if problems:
    sys.exit('发现疑似个人信息，未打包：\n' + '\n'.join(problems))

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in FILES + ICONS:
        info = zipfile.ZipInfo(f'bilisift/{name}', date_time=(2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, (ROOT / name).read_bytes())
print(out)
