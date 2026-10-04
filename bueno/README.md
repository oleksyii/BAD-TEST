# «Bueno» — відео-привітання

3D-анімація (~44 с, 1080×1920, 30 fps) за сценарієм «Bueno»: чорна порожнеча, шахова підлога під прожектором,
металевий візок із Kinder Bueno, маленький персонаж з великою головою-фото. Наприкінці — конфеті, музика й титр
«З днем народження, Мартуся!😇❤️🎉», потім світло гасне.

- `src/` — сцена на three.js; `window.renderAt(t)` детерміновано малює кадр у момент `t`.
- `tools/render.js` — рендер кадрів у headless Chromium (SwiftShader) → ffmpeg.
- `tools/audio.py` — синтезований звук (гудіння лампи, «вибух» обгортки, хрумкання, Happy Birthday, шурхіт у темряві),
  синхронізований з подіями сцени (`out/events.json`).
- `tools/build.sh` — повна збірка → `out/bueno_martusya.mp4`.

Потрібні: Node 18+ з Playwright/Chromium, Python 3 з numpy/scipy/pillow, ffmpeg. Вхідні файли — див. `assets/README.md`.
