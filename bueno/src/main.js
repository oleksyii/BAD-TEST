// «Bueno» — birthday greeting animation. Deterministic: window.renderAt(t) draws the frame at time t (seconds).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const W = 1080, H = 1920, FPS = 30;
const DEG = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const X_AXIS = V3(1, 0, 0);

// ------------------------------------------------------------------ timeline (seconds)
const T = {
  lightOn: 0.30,
  closeIn: 2.0, closeOut: 5.0, // close-up of the Bueno waiting on the plate
  flicker: 3.6,
  stepsHeard: 4.3, // footsteps start in the dark, before the walker is in frame
  walkEnd: 9.0, // the walker comes to rest at the cart
  lookDown: 9.3,
  headToCam: 12.8, headBack: 14.8,
  reach: 18.0, grab: 18.55, turn: 19.0,
  tear: 19.9,
  offer: 21.3, caption1: 21.6,
  lowerStart: 27.0, lowerEnd: 28.4,
  eat1: 28.45, bites1: [28.65, 29.05, 29.45],
  captionWas: 29.55,
  eat2: 29.7, bites2: [29.95, 30.3, 30.65],
  party: 32.0,
  blackout: 40.12,
  end: 43.8,
};
window.TIMELINE = T;

// ------------------------------------------------------------------ small helpers
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0), 0, 1);
const SNAP = 2 / FPS; // stiff moves happen in two frames
const smoothstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
const vlerp = (a, b, k) => a.clone().lerp(b, k);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261004);
const rr = (a, b) => a + (b - a) * rand();

// ------------------------------------------------------------------ renderer / scene / camera
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const CAM = { target: V3(0.05, 0.3, -0.25), el: 30, yaw: 5, dist: 14.0, fov: 44 };
const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 0.1, 60);
function orbit(cam, target, el, yaw, dist) { // angles in degrees
  el *= DEG; yaw *= DEG;
  cam.position.set(
    target.x + dist * Math.sin(yaw) * Math.cos(el),
    target.y + dist * Math.sin(el),
    target.z + dist * Math.cos(yaw) * Math.cos(el));
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
}
function placeCamera() {
  camera.fov = CAM.fov;
  orbit(camera, CAM.target, CAM.el, CAM.yaw, CAM.dist);
}
placeCamera();
window.CAM = CAM; window.placeCamera = placeCamera;

// ------------------------------------------------------------------ the one light
const SPOT = { pos: V3(0.12, 7.0, 0.05), angle: 0.355, penumbra: 0.75, intensity: 250 };
const spot = new THREE.SpotLight(0xfff6ec, SPOT.intensity, 0, SPOT.angle, SPOT.penumbra, 2);
spot.position.copy(SPOT.pos);
spot.target.position.set(SPOT.pos.x, 0, SPOT.pos.z);
spot.castShadow = true;
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.camera.near = 4.5;
spot.shadow.camera.far = 8.0;
spot.shadow.bias = -0.0003;
spot.shadow.normalBias = 0.012;
scene.add(spot, spot.target);
const COS_OUT = Math.cos(SPOT.angle), COS_IN = Math.cos(SPOT.angle * (1 - SPOT.penumbra));
function spotFactor(p) {
  const d = SPOT.pos.clone().sub(p);
  return smoothstep(COS_OUT, COS_IN, d.y / d.length());
}

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256);
  const floorBand = g.createLinearGradient(0, 128, 0, 256);
  floorBand.addColorStop(0, '#2a2a2a'); floorBand.addColorStop(0.25, '#8a8a8a'); floorBand.addColorStop(1, '#b0b0b0');
  g.fillStyle = floorBand; g.fillRect(0, 128, 512, 128);
  const top = g.createLinearGradient(0, 0, 0, 40);
  top.addColorStop(0, '#ffffff'); top.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = top; g.fillRect(0, 0, 512, 40);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return pmrem.fromEquirectangular(t).texture;
})();

// ------------------------------------------------------------------ procedural textures
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noiseFill(g, w, h, fn) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, c = fn(x, y);
    d[i] = clamp(c[0], 0, 255); d[i + 1] = clamp(c[1], 0, 255); d[i + 2] = clamp(c[2], 0, 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

const TILE = 0.62, FLOOR = 28;
const checkerTex = canvasTex(512, 512, (g) => {
  g.fillStyle = '#090909'; g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, 256, 256); g.fillRect(256, 256, 256, 256);
}, true);
checkerTex.repeat.set(FLOOR / (2 * TILE), FLOOR / (2 * TILE));

const knitTex = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, (x, y) => {
  const col = x % 6, row = y % 6;
  const vee = Math.abs(col - 2.5) / 2.5;
  const s = Math.sin(((row + vee * 3) / 6) * Math.PI * 2) * 0.5 + 0.5;
  const b = 122 + 14 * s - (col === 0 ? 8 : 0) + (rand() - 0.5) * 34;
  return [b, b, b];
}), true);
knitTex.repeat.set(4, 4);

const denimTex = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, (x, y) => {
  const tw = ((x + y) % 6 < 3 ? 1 : 0);
  const n = (rand() - 0.5) * 26;
  return [70 + 10 * tw + n * 0.6, 120 + 12 * tw + n, 170 + 14 * tw + n];
}), true);
denimTex.repeat.set(2, 2);

const hairTex = canvasTex(512, 512, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#33281f'); grad.addColorStop(0.22, '#574334');
  grad.addColorStop(0.6, '#6a5442'); grad.addColorStop(1, '#7b634e');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    const x = rand() * w, light = rand() < 0.5, lw = 0.6 + rand() * 1.8, a = 0.07 + rand() * 0.2;
    g.strokeStyle = light ? `rgba(214,182,140,${a})` : `rgba(28,18,10,${a})`;
    g.lineWidth = lw;
    for (const ox of [-w, 0, w]) {
      g.beginPath(); g.moveTo(x + ox, 0);
      g.bezierCurveTo(x + ox + (rand() - 0.5) * 8, h * 0.3, x + ox + (rand() - 0.5) * 8, h * 0.65, x + ox + (rand() - 0.5) * 12, h);
      g.stroke();
    }
  }
  const sheen = g.createLinearGradient(0, h * 0.1, 0, h * 0.36);
  sheen.addColorStop(0, 'rgba(255,228,186,0)'); sheen.addColorStop(0.5, 'rgba(255,228,186,0.16)'); sheen.addColorStop(1, 'rgba(255,228,186,0)');
  g.fillStyle = sheen; g.fillRect(0, h * 0.1, w, h * 0.26);
}, true);

const stickTex = canvasTex(512, 96, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#8a4f2c'); grad.addColorStop(0.5, '#7a4325'); grad.addColorStop(1, '#5e321b');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // wafer ridges
  for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 6, h); }
  // dark chocolate drizzle
  g.strokeStyle = '#3a1b0c'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath();
  for (let x = -20; x < w + 40; x += 36) { g.moveTo(x, 8); g.quadraticCurveTo(x + 22, h * 0.5, x + 10, h - 8); }
  g.stroke();
  g.strokeStyle = 'rgba(255,220,180,0.18)'; g.lineWidth = 2;
  g.beginPath();
  for (let x = -20; x < w + 40; x += 36) { g.moveTo(x - 2, 8); g.quadraticCurveTo(x + 20, h * 0.5, x + 8, h - 8); }
  g.stroke();
});

const loader = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res, rej) => loader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));

// ------------------------------------------------------------------ materials
const M = {
  floor: new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.55, metalness: 0 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xb8bdc3, metalness: 0.72, roughness: 0.4, envMap: envTex, envMapIntensity: 1.0 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xf6f6f3, roughness: 0.22, metalness: 0, flatShading: true }),
  wrap: new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05, alphaTest: 0.5, side: THREE.DoubleSide }),
  wrapBody: new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05, envMap: envTex, envMapIntensity: 0.3 }),
  packBody: new THREE.MeshStandardMaterial({ color: 0xf3f1ee, roughness: 0.35 }),
  stick: new THREE.MeshStandardMaterial({ map: stickTex, roughness: 0.42, emissive: 0xffffff, emissiveMap: stickTex, emissiveIntensity: 0 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xe3a68d, roughness: 0.6, emissive: 0xe3a68d, emissiveIntensity: 0 }),
  sweater: new THREE.MeshStandardMaterial({ color: 0xffffff, map: knitTex, roughness: 1.0, emissive: 0xffffff, emissiveMap: knitTex, emissiveIntensity: 0 }),
  jeans: new THREE.MeshStandardMaterial({ color: 0xffffff, map: denimTex, roughness: 0.95, emissive: 0xffffff, emissiveMap: denimTex, emissiveIntensity: 0 }),
  shoeRed: new THREE.MeshStandardMaterial({ color: 0xb8232c, roughness: 0.5, emissive: 0xb8232c, emissiveIntensity: 0 }),
  shoeWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.55, emissive: 0xf2f2f2, emissiveIntensity: 0 }),
  hair: new THREE.MeshStandardMaterial({ color: 0xffffff, map: hairTex, roughness: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: hairTex, emissiveIntensity: 0 }),
  face: new THREE.MeshStandardMaterial({ roughness: 0.62, emissive: 0xffffff, emissiveIntensity: 0 }),
};
// emissive "bounce/fill" strength per material, scaled by how lit the character is
const FILL = new Map([[M.skin, 0.28], [M.sweater, 0.2], [M.jeans, 0.2], [M.shoeRed, 0.22], [M.shoeWhite, 0.2], [M.hair, 0.3], [M.face, 0.5], [M.stick, 0.2]]);

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}

// ------------------------------------------------------------------ floor
const floorGroup = new THREE.Group();
floorGroup.rotation.y = 32 * DEG;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), M.floor);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
floorGroup.add(floor);
scene.add(floorGroup);

// ------------------------------------------------------------------ cart
const CART = { pos: V3(0.28, 0, -0.25), L: 0.96, D: 0.52, top: 0.70, bot: 0.17 };
function makeCart() {
  const g = new THREE.Group();
  const { L, D, top, bot } = CART;
  const tray = (y) => {
    const t = new THREE.Group();
    const base = mesh(new THREE.BoxGeometry(L, 0.012, D), M.steel); base.position.y = y; t.add(base);
    const lip = 0.032, th = 0.012;
    for (const s of [-1, 1]) {
      const e1 = mesh(new THREE.BoxGeometry(L, lip, th), M.steel); e1.position.set(0, y + lip / 2, s * (D / 2 - th / 2)); t.add(e1);
      const e2 = mesh(new THREE.BoxGeometry(th, lip, D), M.steel); e2.position.set(s * (L / 2 - th / 2), y + lip / 2, 0); t.add(e2);
    }
    return t;
  };
  g.add(tray(top), tray(bot));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (L / 2 - 0.03), z = sz * (D / 2 - 0.03);
    const leg = mesh(new THREE.BoxGeometry(0.03, top - 0.07, 0.03), M.steel); leg.position.set(x, 0.07 + (top - 0.07) / 2, z); g.add(leg);
    const fork = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), M.steel); fork.position.set(x, 0.065, z); g.add(fork);
    const wheel = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.024, 18), M.rubber); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.033, z); g.add(wheel);
  }
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 + 0.012), z0 = D / 2 - 0.07, hTop = top + 0.15;
    const curve = new THREE.CatmullRomCurve3([
      V3(x, top + 0.01, z0), V3(x, top + 0.09, z0), V3(x + sx * 0.012, hTop, z0 - 0.04),
      V3(x + sx * 0.015, hTop + 0.004, 0), V3(x + sx * 0.012, hTop, -z0 + 0.04), V3(x, top + 0.09, -z0), V3(x, top + 0.01, -z0),
    ], false, 'centripetal');
    g.add(mesh(new THREE.TubeGeometry(curve, 80, 0.012, 12, false), M.steel));
  }
  g.position.copy(CART.pos);
  return g;
}
scene.add(makeCart());

// ------------------------------------------------------------------ plate (low-poly on purpose)
const PLATE_POS = V3(0.14, CART.top + 0.012, -0.25);
const platePts = [[0, 0.004], [0.11, 0.004], [0.125, 0.007], [0.15, 0.016], [0.19, 0.026], [0.212, 0.031], [0.215, 0.027], [0.19, 0.019], [0.13, 0.006], [0.105, 0], [0, 0]];
const plate = mesh(new THREE.LatheGeometry(platePts.slice().reverse().map(([r, y]) => new THREE.Vector2(r, y)), 12), M.plate);
plate.position.copy(PLATE_POS);
plate.rotation.y = 7 * DEG;
scene.add(plate);

// ------------------------------------------------------------------ Kinder Bueno pack (two halves) + two sticks
const PACK_L = 0.30, PACK_W = PACK_L * 316 / 882, PACK_T = 0.026, CRIMP = 0.012;
const PACK_ZF = 0.487 * PACK_W, PACK_ZB = -0.399 * PACK_W; // front/back edge of the pack in the wrapper photo
const packUV = (x, z) => [(x + PACK_L / 2) / PACK_L, 0.5 - z / PACK_W]; // photo projected from above, pack space
function makePackBody(side) { // pillow sleeve with round long edges that flattens into the crimp; white caps
  const S = [0, 0.5, 0.75, 0.86, 0.92, 0.96, 0.985, 1], NA = 10, len = PACK_L / 2 - CRIMP;
  const pos = [], uv = [], idx = [];
  let n = 0;
  for (const s of S) {
    const x = side * lerp(-0.0015, len, s), h = (PACK_T / 2) * (1 - 0.85 * smoothstep(0.8, 1, s)); // halves overlap a hair at the seam
    const ring = [];
    for (let i = 0; i <= NA; i++) { const a = Math.PI * (i / NA - 0.5); ring.push([PACK_ZF - h + h * Math.cos(a), h * Math.sin(a)]); }
    for (let i = 0; i <= NA; i++) { const a = Math.PI * (i / NA + 0.5); ring.push([PACK_ZB + h + h * Math.cos(a), h * Math.sin(a)]); }
    n = ring.length;
    for (const [z, y] of ring) {
      const [u, v] = packUV(x, z);
      pos.push(x - side * PACK_L / 4, y, z); uv.push(clamp(u, 0.04, 0.96), clamp(v, 0.02, 0.89));
    }
  }
  for (let k = 0; k + 1 < S.length; k++) for (let i = 0; i < n; i++) {
    const a = k * n + i, b = k * n + (i + 1) % n, c = a + n, d = b + n;
    if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const sideCount = idx.length;
  for (const [k, plusX] of [[0, side < 0], [S.length - 1, side > 0]]) { // torn end at the seam, crimp end
    const c0 = pos.length / 3;
    let cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const j = (k * n + i) * 3;
      pos.push(pos[j], pos[j + 1], pos[j + 2]); uv.push(0, 0);
      cy += pos[j + 1] / n; cz += pos[j + 2] / n;
    }
    pos.push(pos[k * n * 3], cy, cz); uv.push(0, 0);
    for (let i = 0; i < n; i++) {
      const p = c0 + i, q = c0 + (i + 1) % n;
      if (plusX) idx.push(c0 + n, q, p); else idx.push(c0 + n, p, q);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.addGroup(0, sideCount, 0); geo.addGroup(sideCount, idx.length - sideCount, 1);
  geo.computeVertexNormals();
  return mesh(geo, [M.wrapBody, M.packBody]);
}
function makeCrimp(side) { // flat sealed end of the wrapper (zig-zag edge comes from the photo's alpha)
  const w = CRIMP + 0.003;
  const geo = new THREE.PlaneGeometry(w, PACK_ZF - PACK_ZB);
  geo.rotateX(-Math.PI / 2);
  geo.translate(side * (PACK_L / 2 - w / 2) - side * PACK_L / 4, 0, (PACK_ZF + PACK_ZB) / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, ...packUV(p.getX(i) + side * PACK_L / 4, p.getZ(i)));
  return mesh(geo, M.wrap);
}
function makePackHalf(side) { // side -1: half nearer the right hand (u 0..0.5), +1: other half
  const g = new THREE.Group();
  g.add(makePackBody(side), makeCrimp(side));
  g.position.x = side * PACK_L / 4;
  return g;
}
const pack = new THREE.Group();
const halfR = makePackHalf(-1), halfL = makePackHalf(1);
pack.add(halfR, halfL);
scene.add(pack);
const PACK_POS0 = V3(PLATE_POS.x, PLATE_POS.y + 0.016 + PACK_T / 2, PLATE_POS.z);
const PACK_Q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -10 * DEG, 0));
const PACK_AXIS0 = X_AXIS.clone().applyQuaternion(PACK_Q0);

const STICK_LEN = 0.22;
function makeStick() {
  const geo = new RoundedBoxGeometry(STICK_LEN, 0.034, 0.036, 3, 0.012);
  geo.translate(STICK_LEN / 2, 0, 0);
  const m = mesh(geo, M.stick);
  const holder = new THREE.Group(); holder.add(m);
  scene.add(holder);
  return { holder, mesh: m };
}
const stickR = makeStick(), stickL = makeStick();

// ------------------------------------------------------------------ close-up of the Bueno (hard cut in and out, slow push-in)
const CLOSE = { target: PACK_POS0.clone(), el: [33, 29], yaw: [-16, -8], dist: [1.38, 1.13], fov: 30 };
const closeCam = new THREE.PerspectiveCamera(CLOSE.fov, W / H, 0.05, 30);
function shotCamera(t) {
  const close = t >= T.closeIn && t < T.closeOut;
  spot.shadow.focus = close ? 0.35 : 1; // the close-up only needs shadows around the cart, at higher resolution
  if (!close) return camera;
  const k = prog(t, T.closeIn, T.closeOut);
  orbit(closeCam, CLOSE.target, lerp(CLOSE.el[0], CLOSE.el[1], k), lerp(CLOSE.yaw[0], CLOSE.yaw[1], k), lerp(CLOSE.dist[0], CLOSE.dist[1], k));
  return closeCam;
}

// ------------------------------------------------------------------ character
const RX = 0.118, RY = 0.165, RZ = 0.135, FRONT_FLAT = 0.93, FACE_WIN = 0.4008;
const HEAD_UP = 0.15, HEAD_FWD = 0.015, HEAD_SCALE = 1.12;

function faceRelief(X, Y) {
  const nx = X + 0.0135;
  let nose = 0;
  if (Y < 0.032 && Y > -0.075) {
    const k = clamp((0.025 - Y) / 0.07, 0, 1);
    let prof = 0.2 + 0.8 * Math.pow(k, 1.6);
    if (Y < -0.045) prof *= Math.pow(Math.max(0, 1 - (-0.045 - Y) / 0.019), 1.5);
    nose = 0.03 * prof * gauss(nx, 0.0085 + 0.007 * k);
    nose += 0.006 * gauss(Math.abs(nx) - 0.017, 0.006) * gauss(Y + 0.05, 0.008);
  }
  const brow = 0.006 * gauss(Math.abs(X + 0.009) - 0.04, 0.025) * gauss(Y - 0.03, 0.009);
  const eyes = -0.007 * (gauss(X + 0.0535, 0.014) + gauss(X - 0.036, 0.014)) * gauss(Y + 0.001, 0.01);
  const lips = 0.006 * gauss(X + 0.011, 0.024) * gauss(Y + 0.094, 0.011);
  const chin = 0.008 * gauss(X - 0.004, 0.022) * gauss(Y + 0.145, 0.016);
  return nose + brow + eyes + lips + chin;
}
function headPoint(ux, uy, uz) {
  const down = Math.max(0, -uy);
  const X = ux * RX * (1 - 0.2 * down * down);
  const Y = uy * RY;
  let Z = uz * RZ * (1 - 0.12 * down * down) * (uz > 0 ? FRONT_FLAT : 1);
  const w = smoothstep(0.25, 0.6, uz);
  if (w > 0) Z += w * faceRelief(X, Y);
  return [X, Y, Z];
}
function makeHeadGeometry() {
  const geo = new THREE.SphereGeometry(1, 128, 96);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const [X, Y, Z] = headPoint(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, X, Y, Z);
    uv.setXY(i, 0.5 + X / FACE_WIN, 0.5 + Y / FACE_WIN); // planar projection of the photo from the front
  }
  geo.computeVertexNormals();
  return geo;
}
// face opening of the hair (half-angle) as a function of height, traced from the photo's hairline
const HAIRLINE = [[0.135, 0], [0.126, 4], [0.122, 14], [0.115, 26], [0.08, 38], [0.05, 52], [0.02, 66], [0, 74], [-0.06, 78], [-0.12, 78], [-0.2, 74], [-0.3, 72]];
function hairOpening(Y) {
  if (Y >= HAIRLINE[0][0]) return 0;
  for (let i = 1; i < HAIRLINE.length; i++) {
    if (Y >= HAIRLINE[i][0]) {
      const [y0, a0] = HAIRLINE[i - 1], [y1, a1] = HAIRLINE[i];
      return (a0 + (a1 - a0) * (y0 - Y) / (y0 - y1)) * DEG;
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1] * DEG;
}
function R0(phi) {
  const rz = Math.cos(phi) > 0 ? RZ * FRONT_FLAT : RZ;
  return 1 / Math.sqrt((Math.sin(phi) / RX) ** 2 + (Math.cos(phi) / rz) ** 2);
}
function makeHairGeometry() {
  const NU = 140, NV = 72, VW = 0.45, YTOP = RY + 0.012;
  const pos = [], uvs = [], idx = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const th = Math.min(1, v / VW) * (Math.PI / 2);
    const Yrow = v <= VW ? YTOP * Math.cos(th) : -0.25 * (v - VW) / (1 - VW);
    const open = hairOpening(Yrow);
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const phi = open + u * (2 * Math.PI - 2 * open);
      const ps = Math.abs(phi > Math.PI ? phi - 2 * Math.PI : phi);
      const back = 0.5 - 0.5 * Math.cos(phi);
      const off = 0.005 + 0.011 * back;
      let x, y, z;
      if (v <= VW) {
        const r = (R0(phi) + off) * Math.sin(th);
        y = (RY + off + 0.004) * Math.cos(th);
        x = r * Math.sin(phi); z = r * Math.cos(phi);
      } else {
        const s = (v - VW) / (1 - VW);
        const side = Math.abs(Math.sin(phi));
        const yEnd = -0.25 + 0.08 * gauss(ps - Math.PI / 2, 0.38) + 0.012 * Math.sin(phi * 23) + 0.008 * Math.sin(phi * 41 + 1.3);
        y = s * yEnd;
        const r = R0(phi) + off + (0.02 + 0.045 * side) * s * s;
        x = r * Math.sin(phi); z = r * Math.cos(phi);
      }
      pos.push(x, y, z);
      uvs.push(u * 6, 1 - v);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeArm(side) { // side +1 = character's left (+x), -1 = right
  const shoulder = new THREE.Group(); shoulder.position.set(side * 0.158, 0.275, 0);
  const upper = mesh(new THREE.CapsuleGeometry(0.043, 0.085, 6, 14), M.sweater); upper.position.y = -0.07; shoulder.add(upper);
  const elbow = new THREE.Group(); elbow.position.y = -0.16; shoulder.add(elbow);
  const fore = mesh(new THREE.CapsuleGeometry(0.039, 0.075, 6, 14), M.sweater); fore.position.y = -0.06; elbow.add(fore);
  const hand = new THREE.Group(); hand.position.y = -0.175; elbow.add(hand);
  const palm = mesh(new THREE.SphereGeometry(0.046, 18, 14), M.skin); palm.scale.set(0.9, 1.1, 0.82); hand.add(palm);
  const thumb = mesh(new THREE.CapsuleGeometry(0.014, 0.022, 4, 8), M.skin); thumb.position.set(-side * 0.012, 0.004, 0.036); thumb.rotation.x = 0.7; hand.add(thumb);
  return { shoulder, elbow, hand, side };
}
function makeLeg(side) {
  const hip = new THREE.Group(); hip.position.set(side * 0.068, -0.005, 0);
  const thigh = mesh(new THREE.CapsuleGeometry(0.058, 0.074, 6, 14), M.jeans); thigh.position.y = -0.095; hip.add(thigh);
  const knee = new THREE.Group(); knee.position.y = -0.19; hip.add(knee);
  const shin = mesh(new THREE.CapsuleGeometry(0.05, 0.065, 6, 14), M.jeans); shin.position.y = -0.075; knee.add(shin);
  const ankle = new THREE.Group(); ankle.position.y = -0.155; knee.add(ankle);
  const sole = mesh(new RoundedBoxGeometry(0.1, 0.03, 0.175, 2, 0.012), M.shoeWhite); sole.position.set(0, -0.03, 0.032); ankle.add(sole);
  const upperShoe = mesh(new RoundedBoxGeometry(0.092, 0.062, 0.155, 3, 0.026), M.shoeRed); upperShoe.position.set(0, 0.0, 0.026); ankle.add(upperShoe);
  const toe = mesh(new RoundedBoxGeometry(0.094, 0.034, 0.05, 2, 0.015), M.shoeWhite); toe.position.set(0, -0.012, 0.095); ankle.add(toe);
  const lace = mesh(new THREE.BoxGeometry(0.03, 0.006, 0.07), M.shoeWhite); lace.position.set(0, 0.032, 0.045); lace.rotation.x = -0.25; ankle.add(lace);
  return { hip, knee, ankle };
}
function makeCharacter() {
  const root = new THREE.Group();
  const pelvis = new THREE.Group(); root.add(pelvis);
  pelvis.add(mesh(new RoundedBoxGeometry(0.25, 0.12, 0.165, 3, 0.045), M.jeans));
  const spine = new THREE.Group(); spine.position.y = 0.02; pelvis.add(spine);
  const torso = mesh(new THREE.CapsuleGeometry(0.085, 0.15, 8, 20), M.sweater); torso.scale.set(1.6, 1, 1.02); torso.position.y = 0.165; spine.add(torso);
  const collar = mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.05, 18), M.sweater); collar.position.y = 0.325; spine.add(collar);
  const neck = new THREE.Group(); neck.position.y = 0.335; spine.add(neck);
  const head = new THREE.Group(); head.rotation.order = 'YXZ'; head.scale.setScalar(HEAD_SCALE); neck.add(head);
  const headMesh = mesh(makeHeadGeometry(), M.face); headMesh.position.set(0, HEAD_UP, HEAD_FWD); head.add(headMesh);
  const hairMesh = mesh(makeHairGeometry(), M.hair); hairMesh.position.copy(headMesh.position); head.add(hairMesh);
  const armR = makeArm(-1), armL = makeArm(1);
  spine.add(armR.shoulder, armL.shoulder);
  const legR = makeLeg(-1), legL = makeLeg(1);
  pelvis.add(legR.hip, legL.hip);
  // "V" fingers for the final pose (posed in world space)
  const vFingers = new THREE.Group();
  for (const s of [-1, 1]) {
    const f = mesh(new THREE.CapsuleGeometry(0.0125, 0.05, 4, 8), M.skin);
    f.position.set(s * 0.016, 0.04, 0); f.rotation.z = -s * 0.24; vFingers.add(f);
  }
  scene.add(vFingers);
  scene.add(root);
  return { root, pelvis, spine, neck, head, headMesh, hairMesh, armR, armL, legR, legL, vFingers };
}
const char = makeCharacter();

// two-bone IK: put the hand centre at targetW, elbow bending towards poleW (both world space)
const _m4 = new THREE.Matrix4();
function solveArm(arm, targetW, poleW) {
  const parent = arm.shoulder.parent;
  parent.updateWorldMatrix(true, false);
  const inv = _m4.copy(parent.matrixWorld).invert();
  const Tg = targetW.clone().applyMatrix4(inv).sub(arm.shoulder.position);
  const P = poleW.clone().applyMatrix4(inv).sub(arm.shoulder.position);
  const L1 = 0.16, L2 = 0.175;
  const d = clamp(Tg.length(), 0.06, L1 + L2 - 1e-4);
  const dir = Tg.clone().normalize();
  const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  let pole = P.clone().sub(dir.clone().multiplyScalar(P.dot(dir)));
  if (pole.lengthSq() < 1e-8) pole = V3(0, 0, -1);
  pole.normalize();
  const upperDir = dir.clone().multiplyScalar(Math.cos(A)).addScaledVector(pole, Math.sin(A)).normalize();
  const fore = dir.clone().multiplyScalar(d).sub(upperDir.clone().multiplyScalar(L1));
  let zAxis = fore.clone().sub(upperDir.clone().multiplyScalar(fore.dot(upperDir)));
  if (zAxis.lengthSq() < 1e-8) zAxis = pole.clone().negate().sub(upperDir.clone().multiplyScalar(-pole.dot(upperDir)));
  zAxis.normalize();
  const yAxis = upperDir.clone().negate();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  zAxis.crossVectors(xAxis, yAxis).normalize();
  _m4.makeBasis(xAxis, yAxis, zAxis);
  arm.shoulder.quaternion.setFromRotationMatrix(_m4);
  const B = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  arm.elbow.rotation.set(-(Math.PI - B), 0, 0);
}

// ------------------------------------------------------------------ simple deterministic particle sim (pre-baked at 30 fps)
function bake(p0, v0, opt) {
  const sub = 8, dt = 1 / (FPS * sub), n = Math.ceil(opt.dur * FPS);
  const out = new Float32Array((n + 1) * 3);
  const p = p0.clone(), v = v0.clone();
  let landed = -1;
  for (let f = 0; f <= n; f++) {
    out[f * 3] = p.x; out[f * 3 + 1] = p.y; out[f * 3 + 2] = p.z;
    for (let s = 0; s < sub && landed < 0; s++) {
      const tau = (f * sub + s) * dt;
      if (opt.flutter) {
        const sw = opt.sway * Math.sin(opt.w * tau + opt.ph);
        const tgt = V3(sw, -opt.vfall, opt.sway * 0.6 * Math.cos(opt.w * 1.3 * tau + opt.ph));
        v.addScaledVector(tgt.sub(v), Math.min(1, opt.k * dt));
      } else {
        v.y -= 9.81 * dt;
        v.multiplyScalar(1 - opt.k * dt);
      }
      p.addScaledVector(v, dt);
      if (p.y <= opt.ground && v.y < 0) { p.y = opt.ground; landed = f + 1; }
    }
  }
  return { path: out, n, landed: landed < 0 ? Infinity : landed };
}
function samplePath(b, tau, outV) {
  const fi = clamp(tau * FPS, 0, b.n), i0 = Math.floor(fi), i1 = Math.min(b.n, i0 + 1), k = fi - i0;
  return outV.set(
    lerp(b.path[i0 * 3], b.path[i1 * 3], k),
    lerp(b.path[i0 * 3 + 1], b.path[i1 * 3 + 1], k),
    lerp(b.path[i0 * 3 + 2], b.path[i1 * 3 + 2], k));
}

// ------------------------------------------------------------------ confetti
const CONF_N = 1100;
const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), CONF_N);
confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
confetti.frustumCulled = false;
scene.add(confetti);
const CONF_COLORS = ['#ff3b5c', '#ffd23f', '#2ec4b6', '#3a86ff', '#ff8c42', '#b86bff', '#ffffff', '#7cff6b', '#ff5fd2'].map((c) => new THREE.Color(c));
const confData = [];
function setupConfetti() {
  // emitters just above the top corners of the frame
  const above = (nx, ny, dist) => {
    const p = V3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    return camera.position.clone().addScaledVector(p, dist);
  };
  for (let i = 0; i < CONF_N; i++) {
    const kind = i < 600 ? 'burst' : 'rain';
    let p0, v0, ts;
    if (kind === 'burst') {
      const side = i % 2 ? 1 : -1;
      ts = T.party + rr(0, 0.18);
      p0 = above(side * rr(0.75, 1.0), rr(1.02, 1.1), rr(6.5, 9.5));
      const toward = V3(-side * rr(0.6, 3.2), rr(-2.5, 1.5), rr(-0.8, 1.4));
      v0 = toward.multiplyScalar(rr(1.2, 2.4));
    } else {
      ts = T.party + 0.15 + rand() * 7.6;
      p0 = above(rr(-1.1, 1.1), rr(1.03, 1.12), rr(7.0, 11.5));
      v0 = V3(rr(-0.3, 0.3), rr(-1.2, -0.3), rr(-0.3, 0.3));
    }
    const b = bake(p0, v0, { dur: T.blackout - T.party + 0.5, flutter: true, k: rr(1.6, 2.6), vfall: rr(0.55, 1.0), sway: rr(0.12, 0.35), w: rr(2.5, 5.5), ph: rr(0, 6.28), ground: 0.003 + i * 0.000003 });
    confData.push({
      b, ts, color: CONF_COLORS[i % CONF_COLORS.length].clone(),
      rot: V3(rr(0, 6.28), rr(0, 6.28), rr(0, 6.28)), spin: V3(rr(-9, 9), rr(-9, 9), rr(-6, 6)), yawLand: rr(0, 6.28),
      scale: rr(0.75, 1.25),
    });
  }
}
const _o = new THREE.Object3D(), _c = new THREE.Color(), _p = V3();
function updateConfetti(t) {
  if (!confData.length) return; // not baked yet (during init)
  for (let i = 0; i < CONF_N; i++) {
    const c = confData[i], tau = t - c.ts;
    if (tau < 0 || t >= T.blackout) {
      _o.position.set(0, -50, 0); _o.scale.setScalar(0.0001); _o.rotation.set(0, 0, 0);
      _o.updateMatrix(); confetti.setMatrixAt(i, _o.matrix); continue;
    }
    samplePath(c.b, tau, _p);
    const landed = tau * FPS >= c.b.landed;
    _o.position.copy(_p);
    let flick = 1;
    if (landed) _o.rotation.set(-Math.PI / 2, 0, c.yawLand);
    else {
      _o.rotation.set(c.rot.x + c.spin.x * tau, c.rot.y + c.spin.y * tau, c.rot.z + c.spin.z * tau);
      flick = 0.55 + 0.45 * Math.abs(Math.cos(c.rot.x + c.spin.x * tau) * Math.cos(c.rot.y + c.spin.y * tau));
    }
    _o.scale.setScalar(c.scale);
    _o.updateMatrix();
    confetti.setMatrixAt(i, _o.matrix);
    const sf = spotFactor(_p);
    const lit = landed ? sf : Math.max(sf, 0.55 * smoothstep(0.05, 1.0, _p.y));
    confetti.setColorAt(i, _c.copy(c.color).multiplyScalar(lit * flick));
  }
  confetti.instanceMatrix.needsUpdate = true;
  if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
}

// ------------------------------------------------------------------ wrapper shreds + flying halves (baked at init)
const SHRED_N = 26;
const shreds = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.024, 0.016), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4 }), SHRED_N);
shreds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
shreds.frustumCulled = false; shreds.castShadow = true;
scene.add(shreds);
const SHRED_COLORS = ['#f4f2ee', '#e2412a', '#6b3a1e', '#f4f2ee', '#d8b16a'].map((c) => new THREE.Color(c));
const tearState = { halves: [], shreds: [] };

// ------------------------------------------------------------------ poses (character space: +z forward, +x = character's left)
const CHAR_POS = V3(-0.40, 0, -0.40);
const BACK_X = -0.55;
const REST_R = V3(-0.19, 0.36, 0.03), REST_L = V3(0.19, 0.36, 0.03);
const POLE_BACK_R = V3(-0.5, 0.5, -0.7), POLE_BACK_L = V3(0.5, 0.5, -0.7);
const POLE_OUT_R = V3(-0.8, 0.3, -0.1), POLE_OUT_L = V3(0.8, 0.3, -0.1);
const HOLD1_R = V3(-0.07, 0.6, 0.2);
const HOLD_R = V3(-0.11, 0.6, 0.2), HOLD_L = V3(0.11, 0.6, 0.2);
const TORN_R = V3(-0.25, 0.66, 0.16), TORN_L = V3(0.25, 0.66, 0.16);
const STICK_R = V3(-0.2, 0.6, 0.18), STICK_L = V3(0.2, 0.6, 0.18);
const STICK_L2 = V3(0.16, 0.56, 0.16), LOW_R = V3(-0.17, 0.5, 0.2);
const KNEE_L = V3(0.1, 0.29, 0.2);
const DIR_UP_R = V3(-0.12, 1, 0.08).normalize(), DIR_UP_L = V3(0.12, 1, 0.08).normalize();
const DIR_OFFER = V3(-0.05, 1, 0.22).normalize();
const DIR_EAT_R = V3(0.2, 0.75, -0.6).normalize(), DIR_EAT_L = V3(-0.2, 0.75, -0.6).normalize();
const MOUTH_LOCAL = V3(-0.011, -0.094, 0.13); // in head-mesh space
const LOOK_YAW = -28 * DEG; // head turned a bit towards camera while staring at the Bueno
let FACE_YAW = 0, GRAB_R = V3(), OFFER_R = V3(), V_R = V3();

const toWorld = (v) => char.root.localToWorld(v.clone());
const toChar = (v) => char.root.worldToLocal(v.clone());
const dirToWorld = (d) => d.clone().applyQuaternion(char.root.quaternion);

function camAngles() {
  char.neck.updateWorldMatrix(true, false);
  const d = char.neck.worldToLocal(camera.position.clone()).sub(V3(0, HEAD_UP * HEAD_SCALE, 0.1));
  return [Math.atan2(d.x, d.z), -Math.atan2(d.y, Math.hypot(d.x, d.z))];
}
function biteLeft(t, bites) { // remaining fraction of a stick being eaten
  const n = bites.filter((b) => t >= b).length;
  return [1, 0.68, 0.36, 0][n];
}
function setLegs(kneel) {
  const L = char.legL, R = char.legR;
  L.hip.rotation.order = R.hip.rotation.order = 'XYZ'; // the walk switches to ZXY
  L.hip.rotation.set(-85 * DEG * kneel, 0, 4 * DEG * kneel);
  L.knee.rotation.set(85 * DEG * kneel, 0, 0);
  L.ankle.rotation.set(0, 0, 0);
  R.hip.rotation.set(8 * DEG * kneel, 0, -4 * DEG * kneel);
  R.knee.rotation.set(98 * DEG * kneel, 0, 0);
  R.ankle.rotation.set(-35 * DEG * kneel, 0, 0);
}

// ------------------------------------------------------------------ walk-in: procedural gait with planted feet
// The body cruises in from the dark and brakes to a stop at CHAR_POS (T.walkEnd). Footfall k (even: right foot, odd:
// left) lands at fallT(k), on the spot the hip will pass over at mid-stance, so the steps shorten by themselves while
// braking and a foot never slides. The last full step lands where the body stops; the other foot then closes up.
const GAIT = {
  v: 0.95, step: 0.29, duty: 0.6, brake: 0.6, // cruise speed (m/s), seconds per step, stance share, braking time
  hip: 0.374, bob: 0.012, sway: 0.012, lift: 0.055, // mean hip height while walking, its bob, side sway, foot lift
  heel: 14 * DEG, toe: 34 * DEG, // foot roll at heel strike and toe-off
  arm: 0.075, lean: 4 * DEG, twist: 4 * DEG, tilt: 2 * DEG, // arm swing (m), spine lean/twist, head tilt
};
const THIGH = 0.19, SHIN = 0.155, ANKLE_H = 0.045, HEEL_Z = -0.05, TOE_Z = 0.11; // see makeLeg()
const HIP_REST = 0.39, STEP = GAIT.step, MID = GAIT.duty * STEP, STRIDE = 2 * GAIT.v * STEP;
const BRAKE0 = T.walkEnd - GAIT.brake, S0 = T.walkEnd - MID, WALK_DONE = S0 + STEP + 0.05;
function bodyX(t) { // cruise, then brake with a smoothstep speed profile
  const v = GAIT.v, D = GAIT.brake, x0 = CHAR_POS.x - v * D / 2;
  if (t >= T.walkEnd) return CHAR_POS.x;
  if (t <= BRAKE0) return x0 - v * (BRAKE0 - t);
  const u = t - BRAKE0, k = u / D;
  return x0 + v * (u - D * k * k * k * (1 - k / 2));
}
const walkSpeed = (t) => 1 - smoothstep(BRAKE0, T.walkEnd, t); // relative to cruise
const fallT = (k) => S0 + k * STEP;
const plantX = (k) => bodyX(fallT(k) + MID);
function footRoll(z, pitch) { // ankle [z, y] of a foot planted at z, rolled onto its heel (pitch < 0) or toe (> 0)
  const p = pitch > 0 ? TOE_Z : HEEL_Z;
  return [z + p * (1 - Math.cos(pitch)) + ANKLE_H * Math.sin(pitch), ANKLE_H * Math.cos(pitch) + p * Math.sin(pitch)];
}
function footAt(t, parity, xb) { // parity 0: right foot, 1: left -> ankle [z, y] in character space and foot pitch
  let k = Math.floor((t - S0) / STEP);
  if ((k & 1) !== parity) k -= 1;
  const s = fallT(k), here = plantX(k), next = plantX(k + 2);
  const out = Math.min(1, (next - here) / STRIDE); // size of the coming step, 0 once the walk is over
  if (t < s + 2 * MID) { // stance: roll off the heel, stand flat, peel the heel up for the toe-off
    const q = (t - s) / (2 * MID), r = clamp((q - 0.55) / 0.45, 0, 1);
    const pitch = -GAIT.heel * Math.min(1, (here - plantX(k - 2)) / STRIDE) * (1 - smoothstep(0, 0.15, q)) + GAIT.toe * out * r * r;
    return [...footRoll(here - xb, pitch), pitch];
  }
  const u = (t - s - 2 * MID) / (2 * STEP - 2 * MID); // swing: toe-off -> next heel strike
  const p0 = GAIT.toe * out, p1 = -GAIT.heel * out;
  const [z0, y0] = footRoll(here - xb, p0), [z1, y1] = footRoll(next - xb, p1);
  return [lerp(z0, z1, smoothstep(0, 1, u)), lerp(y0, y1, u) + GAIT.lift * Math.sqrt(out) * Math.sin(Math.PI * u), lerp(p0, p1, smoothstep(0, 0.8, u))];
}
function solveLeg(leg, ax, ay, az, pitch) { // planar two-bone IK; ankle target in character space, pelvis unrotated
  const p = char.pelvis.position, h = leg.hip.position;
  const dx = ax - p.x - h.x, dy = ay - p.y - h.y, dz = az - p.z - h.z;
  const roll = Math.atan2(dx, -dy), down = Math.hypot(dx, dy), d = Math.min(Math.hypot(down, dz), THIGH + SHIN);
  const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
  const thigh = Math.atan2(dz, down) + Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
  leg.hip.rotation.order = 'ZXY';
  leg.hip.rotation.set(-thigh, 0, roll);
  leg.knee.rotation.set(knee, 0, 0);
  leg.ankle.rotation.set(pitch + thigh - knee, 0, -roll);
}
function walkCycle(t) { // shared by body, arms and head
  const w = walkSpeed(t), ph = (t - S0) / STEP; // ph: steps since the last full footfall
  return { w, ph, armR: GAIT.arm * w * Math.cos(Math.PI * (ph - 1.15)) }; // right arm swings forward with the left foot
}
function poseWalk(t) {
  const { w, ph, armR } = walkCycle(t), xb = bodyX(t);
  const hip = lerp(HIP_REST, GAIT.hip - GAIT.bob * Math.cos(2 * Math.PI * (ph - 0.1)), w); // lowest in double support
  char.pelvis.position.set(GAIT.sway * w * Math.cos(Math.PI * (ph - 1 - GAIT.duty)), hip + 0.005, 0); // over the stance foot
  char.spine.rotation.set(GAIT.lean * w, GAIT.twist * armR / GAIT.arm, 0);
  for (const [leg, parity] of [[char.legR, 0], [char.legL, 1]]) {
    const [z, y, pitch] = footAt(t, parity, xb);
    solveLeg(leg, leg.hip.position.x, y, z, pitch);
  }
}

function poseBody(t) {
  // root: walk in, slide back after grabbing, snap-turn to camera
  let x = CHAR_POS.x, yaw = 90 * DEG;
  if (t < T.walkEnd) x = bodyX(t);
  if (t >= T.grab) x = lerp(CHAR_POS.x, BACK_X, prog(t, T.grab + 0.05, T.turn - 0.05));
  if (t >= T.turn) yaw = lerp(90 * DEG, FACE_YAW, prog(t, T.turn, T.turn + 3 / FPS));
  char.root.position.set(x, 0, CHAR_POS.z);
  char.root.rotation.set(0, yaw, 0);
  const kneel = prog(t, T.party, T.party + 3 / FPS);
  let lean = 0;
  if (t >= T.reach && t < T.turn) lean = 22 * DEG * (prog(t, T.reach, T.grab) - prog(t, T.grab + 0.05, T.turn - 0.05));
  lean = lerp(lean, 7 * DEG, kneel);
  let bob = 0;
  if (t >= T.party + 0.2) { const ph = ((t - T.party) * 3) % 1; bob = -0.006 * Math.exp(-ph * 5); }
  char.pelvis.position.set(0, lerp(0.395, 0.235, kneel) + bob, 0);
  char.spine.rotation.set(lean, 0, 0);
  setLegs(kneel);
  if (t < WALK_DONE) poseWalk(t);
  char.head.rotation.set(0, 0, 0);
  char.root.updateMatrixWorld(true);
  return kneel;
}

function poseHead(t, kneel) {
  const [cy, cp] = camAngles();
  let hy = 0, hp = 0, hr = 0;
  if (t < T.turn) {
    const look = prog(t, T.lookDown, T.lookDown + 0.3);
    let by = LOOK_YAW * look, bp = 10 * DEG * look;
    if (t >= T.reach) {
      by = lerp(LOOK_YAW, -18 * DEG, prog(t, T.reach, T.grab));
      bp = lerp(10 * DEG, 16 * DEG, prog(t, T.reach, T.grab)) - 6 * DEG * prog(t, T.grab, T.turn);
    }
    const k = prog(t, T.headToCam, T.headToCam + SNAP) * (1 - prog(t, T.headBack, T.headBack + SNAP));
    hy = lerp(by, cy, k); hp = lerp(bp, cp, k);
    if (t < WALK_DONE) { // keep facing ahead against the shoulder twist, wobble towards the stance foot
      const { w, ph, armR } = walkCycle(t);
      hy -= GAIT.twist * armR / GAIT.arm;
      hr = -GAIT.tilt * w * Math.cos(Math.PI * (ph - 1 - GAIT.duty));
    }
  } else {
    hy = cy; hp = cp;
    // recoil from the "explosion"
    if (t >= T.tear && t < T.tear + 0.16) hp -= 9 * DEG;
    // inspect the two sticks
    const insp = prog(t, T.tear + 0.18, T.tear + 0.18 + SNAP) * (1 - prog(t, T.offer, T.offer + SNAP));
    hy = lerp(hy, -22 * DEG, insp); hp = lerp(hp, 15 * DEG, insp);
    // bite nods + chewing
    for (const b of [...T.bites1, ...T.bites2]) if (t >= b && t < b + 0.07) hp += 6 * DEG;
    if (t >= T.bites2[2] + 0.1 && t < T.party) hp += 2.5 * DEG * Math.sin((t - T.bites2[2]) * 2 * Math.PI * 3.2);
    hr = 9 * DEG * kneel;
  }
  char.head.rotation.set(hp, hy, hr);
  char.head.updateMatrixWorld(true);
}

function mouthChar() {
  return toChar(char.headMesh.localToWorld(MOUTH_LOCAL.clone()));
}

function poseArms(t, kneel) {
  let hR = REST_R.clone(), hL = REST_L.clone(), pR = POLE_BACK_R, pL = POLE_BACK_L;
  let dR = DIR_UP_R.clone(), dL = DIR_UP_L.clone();
  let lenR = 1, lenL = 1;
  if (t < WALK_DONE) { // swing against the legs, ride along with the pelvis, a little elbow bend while walking
    const { w, armR } = walkCycle(t), p = char.pelvis.position;
    const up = p.y - 0.395 + 0.02 * w + 1.5 * armR * armR;
    hR.add(V3(p.x, up, 0.018 * w + armR)); hL.add(V3(p.x, up, 0.018 * w - armR));
  }
  if (t >= T.reach && t < T.turn) {
    hR = vlerp(REST_R, GRAB_R, prog(t, T.reach, T.grab)).lerp(HOLD1_R, prog(t, T.grab + 0.05, T.turn - 0.05));
    pR = POLE_OUT_R;
  }
  if (t >= T.turn) {
    const k = prog(t, T.turn, T.turn + 3 / FPS);
    hR = vlerp(HOLD1_R, HOLD_R, k); hL = vlerp(REST_L, HOLD_L, k); pR = POLE_OUT_R; pL = POLE_OUT_L;
  }
  if (t >= T.tear) {
    const k = prog(t, T.tear, T.tear + SNAP), k2 = prog(t, T.tear + 0.2, T.tear + 0.45);
    hR = vlerp(HOLD_R, TORN_R, k).lerp(STICK_R, k2); hL = vlerp(HOLD_L, TORN_L, k).lerp(STICK_L, k2);
  }
  if (t >= T.offer) {
    const k = prog(t, T.offer, T.offer + 0.25);
    hR = vlerp(STICK_R, OFFER_R, k); hL = vlerp(STICK_L, STICK_L2, k);
    dR = vlerp(DIR_UP_R, DIR_OFFER, k).normalize();
  }
  if (t >= T.lowerStart) {
    hR = vlerp(OFFER_R, LOW_R, prog(t, T.lowerStart, T.lowerEnd));
    dR = DIR_OFFER.clone();
  }
  const mouth = mouthChar();
  // eat stick #1 (the one that was "for you")
  if (t >= T.eat1) {
    lenR = biteLeft(t, T.bites1);
    const eatPos = mouth.clone().addScaledVector(DIR_EAT_R, -(lenR * STICK_LEN + 0.015));
    const k = prog(t, T.eat1, T.eat1 + SNAP);
    hR = vlerp(LOW_R, eatPos, k); dR = vlerp(DIR_OFFER, DIR_EAT_R, k).normalize(); pR = POLE_OUT_R;
    if (lenR === 0) { hR = vlerp(eatPos, REST_R, prog(t, T.bites1[2] + 0.05, T.bites1[2] + 0.15)); pR = POLE_BACK_R; }
  }
  // eat stick #2
  if (t >= T.eat2) {
    lenL = biteLeft(t, T.bites2);
    const eatPos = mouth.clone().addScaledVector(DIR_EAT_L, -(lenL * STICK_LEN + 0.015));
    const k = prog(t, T.eat2, T.eat2 + SNAP);
    hL = vlerp(STICK_L2, eatPos, k); dL = vlerp(DIR_UP_L, DIR_EAT_L, k).normalize(); pL = POLE_OUT_L;
    if (lenL === 0) { hL = vlerp(eatPos, REST_L, prog(t, T.bites2[2] + 0.05, T.bites2[2] + 0.15)); pL = POLE_BACK_L; }
  }
  // final: on one knee, reaching for the viewer with a "V"
  if (kneel > 0) {
    hR = vlerp(REST_R, V_R, kneel); hL = vlerp(REST_L, KNEE_L, kneel);
    pR = POLE_OUT_R; pL = POLE_OUT_L;
  }
  solveArm(char.armR, toWorld(hR), toWorld(pR));
  solveArm(char.armL, toWorld(hL), toWorld(pL));
  char.root.updateMatrixWorld(true);
  return { dR, dL, lenR, lenL };
}

const handW = (arm) => arm.hand.getWorldPosition(V3());

function placeStick(st, arm, dirChar, len, visible) {
  st.holder.visible = visible && len > 0;
  if (!st.holder.visible) return;
  const d = dirToWorld(dirChar).normalize();
  st.holder.position.copy(handW(arm)).addScaledVector(d, -0.03);
  st.holder.quaternion.setFromUnitVectors(X_AXIS, d);
  st.mesh.scale.x = len;
}

function posePack(t) {
  pack.visible = t < T.tear;
  if (!pack.visible) return;
  if (t < T.grab) {
    pack.position.copy(PACK_POS0); pack.quaternion.copy(PACK_Q0);
  } else if (t < T.turn) {
    pack.quaternion.copy(PACK_Q0);
    pack.position.copy(handW(char.armR)).addScaledVector(PACK_AXIS0, PACK_L / 2 - 0.035).add(V3(0, 0.01, 0));
  } else {
    const a = handW(char.armR), b = handW(char.armL);
    const axis = b.clone().sub(a).normalize();
    const center = a.clone().add(b).multiplyScalar(0.5);
    const n = camera.position.clone().sub(center).normalize();
    n.addScaledVector(axis, -n.dot(axis)).normalize();
    const z = V3().crossVectors(axis, n);
    _m4.makeBasis(axis, n, z);
    pack.quaternion.setFromRotationMatrix(_m4);
    pack.position.copy(center).addScaledVector(n, 0.03);
  }
}

function poseTornBits(t) {
  if (!tearState.halves.length) return; // not baked yet (during init)
  const on = t >= T.tear && t < T.blackout;
  for (let h = 0; h < 2; h++) {
    const hs = tearState.halves[h];
    hs.obj.visible = on;
    if (!on) continue;
    const tau = t - T.tear;
    samplePath(hs.b, tau, hs.obj.position);
    if (tau * FPS >= hs.b.landed) {
      hs.obj.quaternion.setFromEuler(new THREE.Euler(0, hs.yawLand, 0));
      hs.obj.position.y = PACK_T / 2 + 0.002;
    } else {
      hs.obj.quaternion.setFromAxisAngle(hs.axis, hs.spin * tau).multiply(hs.q0);
    }
  }
  for (let i = 0; i < SHRED_N; i++) {
    const s = tearState.shreds[i];
    const tau = t - T.tear;
    if (!on) { _o.position.set(0, -50, 0); _o.scale.setScalar(0.0001); }
    else {
      samplePath(s.b, tau, _o.position);
      if (tau * FPS >= s.b.landed) _o.rotation.set(-Math.PI / 2, 0, s.yaw);
      else _o.rotation.set(s.rot.x + s.spin.x * tau, s.rot.y + s.spin.y * tau, s.rot.z);
      _o.scale.setScalar(s.scale);
    }
    _o.updateMatrix();
    shreds.setMatrixAt(i, _o.matrix);
  }
  shreds.instanceMatrix.needsUpdate = true;
}

function poseFingers(t, kneel) {
  const f = char.vFingers;
  f.visible = kneel > 0.99 && t < T.blackout;
  if (!f.visible) return;
  const hand = handW(char.armR);
  const toCam = camera.position.clone().sub(hand).normalize();
  const camUp = V3(0, 1, 0).applyQuaternion(camera.quaternion);
  const up = camUp.clone().addScaledVector(toCam, 0.35).normalize();
  const side = V3().crossVectors(up, toCam).normalize();
  const fwd = V3().crossVectors(side, up).normalize();
  _m4.makeBasis(side, up, fwd);
  f.quaternion.setFromRotationMatrix(_m4);
  f.position.copy(hand).addScaledVector(up, 0.025).addScaledVector(toCam, 0.02);
}

// ------------------------------------------------------------------ light level over time
function lightLevel(t) {
  if (t < T.lightOn || t >= T.blackout) return 0;
  const f = t - T.lightOn;
  if (f < 0.07) return 1.0;
  if (f < 0.13) return 0.0;
  if (f < 0.17) return 0.55;
  if (f < 0.24) return 0.0;
  if (f < 0.30) return 0.85;
  let L = 1;
  if (t >= T.flicker && t < T.flicker + 0.1) L = 0.72;
  const k = t - T.tear;
  if (k >= 0 && k < 1 / FPS) L = 1.45;
  else if (k >= 1 / FPS && k < 3 / FPS) L = 0.35;
  else if (k >= 3 / FPS && k < 4 / FPS) L = 1.0;
  else if (k >= 4 / FPS && k < 5 / FPS) L = 0.6;
  if (t >= T.party) { const ph = ((t - T.party) * 3) % 1; L *= 1 + 0.07 * Math.exp(-ph * 6); }
  return L;
}

// ------------------------------------------------------------------ overlay: captions + big title
const ov = document.getElementById('ov');
const g2 = ov.getContext('2d');
const seg = new Intl.Segmenter('uk', { granularity: 'grapheme' });
const graphemes = (s) => [...seg.segment(s)].map((x) => x.segment);
const CAPTION_Y = 1585;
function drawCaption(text) {
  g2.save();
  g2.font = '500 66px Rubik';
  g2.letterSpacing = '1px';
  g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillStyle = '#ffffff';
  g2.shadowColor = 'rgba(0,0,0,0.9)'; g2.shadowBlur = 8;
  g2.fillText(text, W / 2, CAPTION_Y);
  g2.restore();
}
function popScale(tt) {
  if (tt < 0) return 0;
  if (tt < 0.1) return lerp(0.3, 1.16, tt / 0.1);
  if (tt < 0.22) return lerp(1.16, 0.95, (tt - 0.1) / 0.12);
  if (tt < 0.32) return lerp(0.95, 1.0, (tt - 0.22) / 0.1);
  return 1;
}
function drawWordLine(text, size, cy, tt, startIdx, fill) {
  const chars = graphemes(text);
  g2.font = `800 ${size}px Rubik`;
  const widths = chars.map((c) => g2.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = W / 2 - total / 2;
  chars.forEach((ch, i) => {
    const idx = startIdx + i;
    const w = widths[i];
    const wave = Math.sin(tt * 2 * Math.PI * 1.5 - idx * 0.55);
    const dy = -10 * wave;
    const rot = 0.05 * Math.sin(tt * 2 * Math.PI * 0.75 - idx * 0.9);
    const s = popScale(tt - idx * 0.012);
    g2.save();
    g2.translate(x + w / 2, cy + dy);
    g2.rotate(rot);
    g2.scale(s, s);
    g2.font = `800 ${size}px Rubik`;
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.lineJoin = 'round';
    g2.shadowColor = '#4a0f6b'; g2.shadowOffsetY = 9; g2.shadowOffsetX = 3; g2.shadowBlur = 0;
    g2.strokeStyle = '#ffffff'; g2.lineWidth = size * 0.17;
    g2.strokeText(ch, 0, 0);
    g2.shadowColor = 'transparent';
    const gr = g2.createLinearGradient(0, -size * 0.45, 0, size * 0.4);
    fill.forEach(([o, c]) => gr.addColorStop(o, c));
    g2.fillStyle = gr;
    g2.fillText(ch, 0, 0);
    g2.restore();
    x += w;
  });
  return chars.length;
}
function drawEmoji(list, size, cx, cy, tt) {
  const gap = size * 1.12;
  list.forEach((e, i) => {
    const s = popScale(tt - 0.15 - i * 0.06);
    const bounce = -Math.abs(Math.sin(tt * Math.PI * 3 - i * 0.9)) * 18;
    g2.save();
    g2.translate(cx + (i - (list.length - 1) / 2) * gap, cy + bounce);
    g2.rotate(0.12 * Math.sin(tt * 2 * Math.PI * 1.5 + i));
    g2.scale(s, s);
    g2.font = `${size}px "Noto Color Emoji"`;
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText(e, 0, 0);
    g2.restore();
  });
}
const TITLE_FILL = [[0, '#fff7a1'], [0.45, '#ffc21f'], [0.75, '#ff7a2f'], [1, '#ff3d8b']];
function drawOverlay(t) {
  g2.clearRect(0, 0, W, H);
  if (t >= T.blackout) return;
  if (t >= T.caption1 && t < T.captionWas) drawCaption('Одна тобі.');
  else if (t >= T.captionWas && t < T.party) drawCaption('...була.');
  if (t >= T.party) {
    const tt = t - T.party;
    const beat = ((t - T.party) * 3) % 1;
    const pulse = 1 + 0.035 * Math.exp(-beat * 7);
    g2.save();
    g2.translate(W / 2, 470); g2.scale(pulse, pulse); g2.translate(-W / 2, -470);
    const n1 = drawWordLine('З днем народження,', 86, 360, tt, 0, TITLE_FILL);
    drawWordLine('Мартуся!', 150, 520, tt, n1, TITLE_FILL);
    drawEmoji(['😇', '❤️', '🎉'], 112, W / 2, 680, tt);
    g2.restore();
  }
}

// ------------------------------------------------------------------ frame
function applyFill(level) {
  // character "bounce light" follows how lit the character is
  const lit = level * (0.15 + 0.85 * spotFactor(char.root.position.clone().setY(0.9)));
  for (const [mat, k] of FILL) mat.emissiveIntensity = k * lit;
  M.steel.envMapIntensity = 1.0 * level;
  M.wrapBody.envMapIntensity = 0.3 * level;
}

function animate(t) {
  const kneel = poseBody(t);
  poseHead(t, kneel);
  const arms = poseArms(t, kneel);
  posePack(t);
  const sticksOut = t >= T.tear;
  placeStick(stickR, char.armR, arms.dR, arms.lenR, sticksOut);
  placeStick(stickL, char.armL, arms.dL, arms.lenL, sticksOut);
  poseTornBits(t);
  poseFingers(t, kneel);
  updateConfetti(t);
  const L = lightLevel(t);
  spot.intensity = SPOT.intensity * L;
  applyFill(L);
  return L;
}

window.renderAt = (t) => {
  const L = animate(t);
  if (L <= 0) { renderer.setRenderTarget(null); renderer.clear(); }
  else renderer.render(scene, shotCamera(t));
  drawOverlay(t);
};

// ------------------------------------------------------------------ init
async function init() {
  const [faceTex, wrapTex] = await Promise.all([loadTex('../assets/face.jpg'), loadTex('../assets/bueno_wrapper.png')]);
  M.face.map = faceTex; M.face.emissiveMap = faceTex; M.face.needsUpdate = true;
  M.wrap.map = wrapTex; M.wrap.needsUpdate = true;
  M.wrapBody.map = wrapTex; M.wrapBody.needsUpdate = true;
  await Promise.all([document.fonts.load('800 80px Rubik'), document.fonts.load('500 60px Rubik')]);

  // face the camera (a touch towards the cart) once the character has turned
  const at = V3(BACK_X, 0, CHAR_POS.z);
  FACE_YAW = Math.atan2(camera.position.x - at.x, camera.position.z - at.z) + 6 * DEG;

  // grab point at the near end of the pack, in character space at the reach pose
  char.root.position.copy(CHAR_POS); char.root.rotation.set(0, 90 * DEG, 0); char.root.updateMatrixWorld(true);
  GRAB_R = toChar(PACK_POS0.clone().addScaledVector(PACK_AXIS0, -PACK_L / 2 + 0.04));

  // offer: arm stretched towards the camera
  char.root.position.set(BACK_X, 0, CHAR_POS.z); char.root.rotation.set(0, FACE_YAW, 0); char.root.updateMatrixWorld(true);
  const sh = V3(-0.158, 0.395 + 0.02 + 0.275, 0);
  OFFER_R = sh.clone().addScaledVector(toChar(camera.position).sub(sh).normalize(), 0.31).add(V3(-0.06, 0, 0));
  const shK = V3(-0.158, 0.235 + 0.02 + 0.275 * Math.cos(7 * DEG), 0.275 * Math.sin(7 * DEG));
  V_R = shK.clone().addScaledVector(toChar(camera.position).sub(shK).normalize(), 0.3);

  // capture pack state just before the tear and bake the flying bits
  animate(T.tear - 1 / FPS);
  pack.updateMatrixWorld(true);
  const tearCenter = pack.position.clone();
  const vel = [V3(-1.3, 1.6, 0.9), V3(1.0, 1.8, 1.4)];
  [halfR, halfL].forEach((half, h) => {
    const p0 = half.getWorldPosition(V3()), q0 = half.getWorldQuaternion(new THREE.Quaternion());
    const obj = half.clone(true);
    scene.add(obj);
    const v0 = dirToWorld(vel[h]);
    tearState.halves.push({
      obj, q0, axis: V3(rr(-1, 1), rr(-1, 1), rr(-1, 1)).normalize(), spin: rr(9, 14), yawLand: rr(0, 6.28),
      b: bake(p0, v0, { dur: 25, flutter: false, k: 0.25, ground: PACK_T / 2 + 0.002 }),
    });
  });
  for (let i = 0; i < SHRED_N; i++) {
    const dir = V3(rr(-1, 1), rr(-0.2, 1.2), rr(-0.6, 1)).normalize();
    tearState.shreds.push({
      b: bake(tearCenter.clone().add(V3(rr(-0.06, 0.06), rr(-0.02, 0.02), rr(-0.02, 0.02))), dir.multiplyScalar(rr(1.2, 3.4)), { dur: 25, flutter: false, k: 1.4, ground: 0.003 }),
      rot: V3(rr(0, 6), rr(0, 6), rr(0, 6)), spin: V3(rr(-14, 14), rr(-14, 14), 0), yaw: rr(0, 6.28), scale: rr(0.7, 1.4),
    });
    shreds.setColorAt(i, SHRED_COLORS[i % SHRED_COLORS.length]);
  }
  shreds.instanceColor.needsUpdate = true;

  setupConfetti();
  for (let i = 0; i < CONF_N; i++) confetti.setColorAt(i, confData[i].color);

  // audible footfalls: time, where the foot lands, step size relative to a full stride
  const steps = [];
  for (let k = Math.ceil((T.stepsHeard - S0) / STEP); fallT(k) < WALK_DONE; k++) {
    const len = plantX(k) - plantX(k - 2);
    if (len > 0.005) steps.push({ t: fallT(k), x: plantX(k), size: Math.min(1, len / STRIDE) });
  }
  window.EVENTS = { ...T, halfLand: tearState.halves.map((h) => T.tear + h.b.landed / FPS), steps };
  renderer.compile(scene, camera);
  window.renderAt(T.party + 1);
  window.renderAt(0);
  window.__ready = true;
}
init().catch((e) => { console.error('init failed', e); window.__initError = String(e && e.stack || e); });
