"""Create an initial Windows application icon without committing binary font/image assets.

Brand-neutral temporary mark for internal preview builds. Replace with a
licensed, approved final app icon before the public release.
"""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path("electron/build/icon.ico")
out.parent.mkdir(parents=True, exist_ok=True)
im = Image.new("RGBA", (256, 256), (15, 18, 28, 255))
draw = ImageDraw.Draw(im)
draw.rounded_rectangle((12, 12, 244, 244), radius=48, fill=(38, 38, 48), outline=(180, 170, 255), width=5)
draw.polygon([(47, 70), (104, 70), (150, 148), (190, 70), (224, 70), (154, 206), (125, 206)], fill=(244, 242, 255))
im.save(out, format="ICO", sizes=[(16,16), (24,24), (32,32), (48,48), (64,64), (128,128), (256,256)])
print(out)
