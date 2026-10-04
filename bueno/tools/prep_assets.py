"""Prepare textures: face projection map and Bueno wrapper with alpha."""
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np

# --- Face: level the eyes, crop a 300x300 window centred on the head, upscale.
# Head ellipsoid centre in the levelled photo is (317, 298); 300px window -> 0.4008 m.
im = Image.open('assets/face_src.jpg').convert('RGB')
rot = im.rotate(-6, resample=Image.BICUBIC, center=(322, 295))
face = rot.crop((167, 148, 467, 448)).resize((1024, 1024), Image.LANCZOS)
face = face.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
face = ImageEnhance.Color(face).enhance(1.08)
face.save('assets/face.jpg', quality=95)

# --- Bueno wrapper: already has alpha; drop the soft drop-shadow under it.
w = Image.open('assets/bueno_src.webp').convert('RGBA')
a = np.asarray(w).copy()
a[614:, :, 3] = 0
w = Image.fromarray(a).crop((58, 300, 940, 616))
w.save('assets/bueno_wrapper.png')
print('wrapper size', w.size)
