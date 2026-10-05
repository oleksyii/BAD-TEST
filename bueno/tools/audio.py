"""Soundtrack for «Bueno», synthesised and aligned to the event times exported by the scene (out/events.json)."""
import json
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
E = json.load(open('out/events.json'))
DUR = E['end']
N = int(round(DUR * SR))
HUM_FADE = (9.2, 12.0)
rng = np.random.default_rng(1004)

MAIN = np.zeros((2, N))
MUSIC = np.zeros((2, N))


def idx(t):
    return int(round(t * SR))


def add(sig, t, gain=1.0, pan=0.0, bus=MAIN):
    i = idx(t)
    if i >= N:
        return
    s = sig[-i:] if i < 0 else sig
    i = max(i, 0)
    n = min(len(s), N - i)
    a = (pan + 1) * np.pi / 4
    bus[0, i:i + n] += s[:n] * gain * np.cos(a) * np.sqrt(2)
    bus[1, i:i + n] += s[:n] * gain * np.sin(a) * np.sqrt(2)


def _sos(kind, f, order):
    return butter(order, f, btype=kind, fs=SR, output='sos')


def bp(x, lo, hi, order=2): return sosfilt(_sos('band', [lo, hi], order), x)
def lp(x, f, order=2): return sosfilt(_sos('low', f, order), x)
def hp(x, f, order=2): return sosfilt(_sos('high', f, order), x)
def decay(n, tau): return np.exp(-np.arange(n) / (tau * SR))
def noise(n): return rng.standard_normal(n)
def tsec(n): return np.arange(n) / SR
def db(x): return 10 ** (x / 20)
def midi_hz(m): return 440.0 * 2 ** ((m - 69) / 12)


def norm(x, peak=1.0):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def light_level(t):  # mirrors lightLevel() in main.js (start-up flicker + 3.6 s buzz)
    if t < E['lightOn'] or t >= E['blackout']:
        return 0.0
    f = t - E['lightOn']
    for lim, v in ((0.07, 1.0), (0.13, 0.0), (0.17, 0.55), (0.24, 0.0), (0.30, 0.85)):
        if f < lim:
            return v
    if E['flicker'] <= t < E['flicker'] + 0.1:
        return 0.72
    return 1.0


# ---------------------------------------------------------------- building blocks
def crinkle(dur, rate, lo=1500, hi=12000, gmin=0.001, gmax=0.007, curve=None):
    """Plastic wrapper: lots of tiny filtered clicks."""
    n = int(dur * SR)
    out = np.zeros(n)
    for s in np.sort(rng.uniform(0, dur, int(rate * dur))):
        i = int(s * SR)
        m = min(int(rng.uniform(gmin, gmax) * SR), n - i)
        if m <= 0:
            continue
        a = rng.uniform(0.15, 1.0) ** 2 * (curve(s / dur) if curve else 1.0)
        out[i:i + m] += noise(m) * decay(m, rng.uniform(0.0004, 0.0025)) * a
    return bp(out, lo, hi)


def switch_click(big=False):
    n = int(0.3 * SR)
    tt = tsec(n)
    c = hp(noise(n), 2000) * decay(n, 0.0025)
    body = np.sin(2 * np.pi * (85 if big else 150) * tt) * decay(n, 0.035 if big else 0.015)
    mid = np.sin(2 * np.pi * 420 * tt) * decay(n, 0.02)
    ring = sum(a * np.sin(2 * np.pi * f * tt) for f, a in ((1170, 0.15), (2310, 0.1), (3460, 0.06))) * decay(n, 0.06)
    return norm(c + body * (1.3 if big else 0.6) + mid * 0.4 + ring * (1.0 if big else 0.4))


def crunch(dur=0.14):
    n = int(dur * SR)
    out = np.zeros(n)
    for _ in range(rng.integers(10, 18)):
        i = int(rng.uniform(0, dur * 0.6) * SR)
        m = min(int(rng.uniform(0.002, 0.01) * SR), n - i)
        out[i:i + m] += noise(m) * decay(m, rng.uniform(0.0008, 0.003)) * rng.uniform(0.3, 1.0)
    out = bp(out, 600, 7000)
    thud = np.sin(2 * np.pi * 140 * tsec(n)) * decay(n, 0.025) * 0.35
    return norm(out + thud)


# ---------------------------------------------------------------- scene sounds
def lamp_hum():
    t0, t1 = E['lightOn'], HUM_FADE[1] + 0.2
    n = idx(t1) - idx(t0)
    tt = tsec(n)
    sig = np.zeros(n)
    amps = [0.6, 0.8, 0.5, 0.45, 0.3, 0.25, 0.15, 0.12, 0.09, 0.07, 0.05, 0.04]
    for k, a in enumerate(amps, start=1):
        sig += a * np.sin(2 * np.pi * 100 * k * tt + rng.uniform(0, 2 * np.pi))
    sig += 0.35 * bp(np.tanh(5 * np.sin(2 * np.pi * 100 * tt)), 500, 4000)
    sig *= 1 + 0.05 * np.sin(2 * np.pi * 0.23 * tt) + 0.03 * np.sin(2 * np.pi * 0.61 * tt + 1.0)
    # flicker crackle at 3.6 s
    k0 = idx(E['flicker'] - t0)
    kn = int(0.1 * SR)
    sig[k0:k0 + kn] += 0.9 * hp(np.tanh(9 * np.sin(2 * np.pi * 100 * tt[:kn])) * (rng.random(kn) < 0.3), 900)
    step = 48
    gate = np.array([light_level(t0 + x) for x in tt[::step]])
    gate = lp(np.interp(np.arange(n), np.arange(0, n, step)[:len(gate)], gate), 80, 1)
    fade = np.clip((HUM_FADE[1] - (t0 + tt)) / (HUM_FADE[1] - HUM_FADE[0]), 0, 1) ** 2
    return norm(sig * gate * fade)


def room_tone():
    n = idx(E['blackout']) - idx(E['lightOn'])
    pink = lp(noise(n), 2500, 1) + 0.5 * lp(noise(n), 300, 1)
    return pink / np.sqrt(np.mean(pink ** 2))


def tear_boom():
    n = int(4.0 * SR)
    tt = tsec(n)
    r = crinkle(0.2, 9000, 900, 14000, curve=lambda x: 0.4 + 0.6 * x)
    rt = tsec(len(r))
    am = 0.55 + 0.45 * (np.sin(2 * np.pi * (70 * rt + 260 * rt * rt)) > 0)
    rip = np.zeros(n)
    rip[:len(r)] = r * am
    crack = hp(noise(n), 600) * decay(n, 0.03)
    f = 32 + 75 * np.exp(-tt / 0.09)
    boom = np.tanh(2.5 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * decay(n, 0.7)
    thump = np.sin(2 * np.pi * 150 * tt) * decay(n, 0.12)
    rumble = norm(lp(noise(n), 160, 4)) * decay(n, 1.1)
    deb = np.zeros(n)
    d = crinkle(2.0, 140, 600, 9000, curve=lambda x: (1 - x) ** 2)
    deb[int(0.08 * SR):int(0.08 * SR) + len(d)] = d
    dry = norm(rip) * 0.8 + norm(crack) * 0.9 + norm(boom) * 1.0 + thump * 0.6 + rumble * 0.7 + norm(deb) * 0.25
    irn = int(2.5 * SR)
    ir = lp(noise(irn), 2500) * decay(irn, 0.5)
    wet = fftconvolve(dry, ir / np.sqrt(np.sum(ir ** 2)))[:n]
    out = dry + 0.6 * norm(wet) * np.max(np.abs(dry))
    return norm(np.tanh(1.6 * norm(out)), db(-0.8))


step_rng = np.random.default_rng(905)  # own generator, so the other sounds keep their random draws


def footstep(size):
    """Small sneaker on hard tiles: heel knock, then the sole slaps down. size: step length vs a full stride."""
    n = int(0.25 * SR)
    tt = tsec(n)
    heel = (np.sin(2 * np.pi * step_rng.uniform(140, 175) * tt) * decay(n, 0.02)
            + 0.9 * bp(step_rng.standard_normal(n), 300, 3000) * decay(n, 0.005))
    slap = np.zeros(n)
    j = int(step_rng.uniform(0.04, 0.055) * SR)
    slap[j:] = bp(step_rng.standard_normal(n - j), 900, 6000) * decay(n - j, 0.004) * (0.25 + 0.5 * size)
    return norm(heel + slap) * (0.45 + 0.55 * size)


def knee_thud():
    n = int(0.3 * SR)
    tt = tsec(n)
    s = np.sin(2 * np.pi * 75 * tt) * decay(n, 0.08) + 0.6 * np.sin(2 * np.pi * 170 * tt) * decay(n, 0.04)
    return norm(s + 0.4 * lp(noise(n), 900) * decay(n, 0.03))


def popper():
    n = int(0.35 * SR)
    pop = hp(noise(n), 1000) * decay(n, 0.006)
    ring = np.sin(2 * np.pi * 1800 * tsec(n)) * decay(n, 0.03) * 0.3
    sparkle = crinkle(0.35, 300, 3000, 14000, curve=lambda x: (1 - x) ** 2) * 0.4
    return norm(pop + ring + sparkle)


def party_horn():
    n = int(0.75 * SR)
    tt = tsec(n)
    f = 330 + 170 * (1 - np.exp(-tt / 0.08)) + 6 * np.sin(2 * np.pi * 7 * tt)
    ph = 2 * np.pi * np.cumsum(f) / SR
    saw = sum(np.sin(k * ph) / k for k in range(1, 25))
    s = bp(saw, 600, 3500) + 0.3 * saw
    env = np.minimum(1, tt / 0.02) * np.where(tt < 0.6, 1.0, np.exp(-(tt - 0.6) / 0.05))
    return norm(s * (1 + 0.35 * np.sin(2 * np.pi * 28 * tt)) * env)


def crash(dur=2.4):
    n = int(dur * SR)
    tt = tsec(n)
    metal = sum(np.sin(2 * np.pi * f * tt + rng.uniform(0, 6)) for f in (3170, 4270, 5110, 6630, 7830)) * 0.05
    return norm(hp(noise(n), 3500) * decay(n, 0.7) + metal * decay(n, 0.5))


# ---------------------------------------------------------------- Happy Birthday (public domain melody)
def brass(m, dur):
    f = midi_hz(m)
    n = int((dur + 0.08) * SR)
    tt = tsec(n)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * tt) * np.clip((tt - 0.12) / 0.1, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    fc = 1600 + 2600 * np.exp(-tt / 0.06)
    out = np.zeros(n)
    for k in range(1, int(9000 / f) + 1):
        amp = (1 / k) / np.sqrt(1 + (k * f / fc) ** 4)
        for det in (0.997, 1.003):
            out += amp * np.sin(k * ph * det + rng.uniform(0, 6.28))
    env = np.minimum(1, tt / 0.015) * (0.75 + 0.25 * np.exp(-tt / 0.08))
    return out * env * np.clip((dur - tt) / 0.06 + 1, 0, 1)


def bell(m, dur):
    f = midi_hz(m + 12)
    n = int(min(dur + 0.6, 1.2) * SR)
    tt = tsec(n)
    s = (np.sin(2 * np.pi * f * tt) * decay(n, 0.35) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt) * decay(n, 0.12)
         + 0.2 * np.sin(2 * np.pi * f * 5.4 * tt) * decay(n, 0.05))
    return s * np.minimum(1, tt / 0.002)


def stab(notes, dur=0.22):
    n = int(dur * SR)
    tt = tsec(n)
    out = np.zeros(n)
    for m in notes:
        f = midi_hz(m)
        for k, a in enumerate((1, 0.45, 0.25, 0.12, 0.06), start=1):
            out += a * np.sin(2 * np.pi * f * k * tt) * decay(n, 0.18 / k ** 0.5)
    return out * np.minimum(1, tt / 0.003)


def bass(m, dur=0.3):
    f = midi_hz(m)
    n = int(dur * SR)
    tt = tsec(n)
    out = sum(np.sin(2 * np.pi * f * k * tt) / k for k in (1, 3, 5, 7)) * decay(n, 0.22)
    out += 0.45 * np.sin(2 * np.pi * 2 * f * tt) * decay(n, 0.15)
    return out * np.minimum(1, tt / 0.004)


def kick():
    n = int(0.3 * SR)
    tt = tsec(n)
    f = 45 + 90 * np.exp(-tt / 0.03)
    return norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * decay(n, 0.12) + 0.3 * hp(noise(n), 3000) * decay(n, 0.002))


def snare():
    n = int(0.2 * SR)
    tt = tsec(n)
    return norm(bp(noise(n), 1200, 7000) * decay(n, 0.06) + 0.5 * np.sin(2 * np.pi * 190 * tt) * decay(n, 0.04))


def hat():
    n = int(0.05 * SR)
    return norm(hp(noise(n), 7000) * decay(n, 0.012))


def tamb():
    n = int(0.12 * SR)
    tt = tsec(n)
    jingle = sum(np.sin(2 * np.pi * f * tt) for f in (5200, 6900, 8100)) * decay(n, 0.04) * 0.2
    return norm(hp(noise(n), 6000) * decay(n, 0.03) + jingle)


def music():
    B = 60 / 180
    M0 = E['party']
    bt = lambda b: M0 + b * B
    mel = [(67, 2, .75), (67, 2.75, .25), (69, 3, 1), (67, 4, 1), (72, 5, 1), (71, 6, 2), (67, 8, .75), (67, 8.75, .25),
           (69, 9, 1), (67, 10, 1), (74, 11, 1), (72, 12, 2), (67, 14, .75), (67, 14.75, .25), (79, 15, 1), (76, 16, 1),
           (72, 17, 1), (71, 18, 1), (69, 19, 1), (77, 20, .75), (77, 20.75, .25), (76, 21, 1), (72, 22, 1), (74, 23, 1), (72, 24, 3)]
    chords = {'C': (36, (60, 64, 67)), 'G7': (43, (59, 62, 65, 67)), 'C7': (36, (58, 64, 67)), 'F': (41, (60, 65, 69))}
    bars = ['C', 'G7', 'G7', 'C', 'C7', 'F', 'C', 'C']
    # "ta-da!" intro
    for b, d in ((0, 0.45), (1, 0.9)):
        for m in (60, 64, 67, 72):
            add(brass(m, d * B), bt(b), 0.22, 0, MUSIC)
        add(kick(), bt(b), 0.55, 0, MUSIC)
    add(snare(), bt(1), 0.3, 0, MUSIC)
    add(crash(), bt(0), 0.3, -0.2, MUSIC)
    for m, b, d in mel:
        add(brass(m, d * B * 0.95), bt(b), 0.5, 0, MUSIC)
        add(bell(m, d * B), bt(b), 0.17, 0.25, MUSIC)
    for k, name in enumerate(bars, start=1):
        b0 = 3 * k
        root, notes = chords[name]
        add(bass(root, 0.9 * B), bt(b0), 0.4, 0, MUSIC)
        add(kick(), bt(b0), 0.55, 0, MUSIC)
        for j in (1, 2):
            nm = 'G7' if (k == 7 and j == 2) else name
            add(stab(chords[nm][1], 0.6 * B), bt(b0 + j), 0.17, -0.2, MUSIC)
            add(snare(), bt(b0 + j), 0.28, 0, MUSIC)
            add(tamb(), bt(b0 + j), 0.1, 0.35, MUSIC)
        for h in range(6):
            add(hat(), bt(b0 + h * 0.5), 0.1 if h % 2 else 0.14, 0.3, MUSIC)
        if k in (1, 5):
            add(crash(), bt(b0), 0.25, 0.2, MUSIC)
    # small room reverb, glue, loudness
    irn = int(0.6 * SR)
    ir = lp(noise(irn), 5000) * decay(irn, 0.12)
    ir /= np.sqrt(np.sum(ir ** 2))
    for c in range(2):
        MUSIC[c] += 0.18 * fftconvolve(MUSIC[c], ir)[:N] * (np.max(np.abs(MUSIC[c])) / max(1e-9, np.max(np.abs(fftconvolve(MUSIC[c], ir)[:N]))))
    MUSIC[:] = np.tanh(2.0 * MUSIC / np.max(np.abs(MUSIC)))
    MUSIC[:] = norm(MUSIC, db(-1.0))
    # hard cut when the light goes out
    cut = idx(E['blackout'])
    fade = int(0.004 * SR)
    MUSIC[:, cut:cut + fade] *= np.linspace(1, 0, fade)
    MUSIC[:, cut + fade:] = 0


# ---------------------------------------------------------------- arrangement
add(switch_click(), E['lightOn'], db(-14), -0.1)
for tick in (0.37, 0.43, 0.47, 0.54):
    add(switch_click() * 0.3, E['lightOn'] + tick - 0.30, db(-24), -0.1)
add(lamp_hum(), E['lightOn'], db(-20))
add(room_tone() * np.array([light_level(E['lightOn'] + x / SR) for x in range(0, idx(E['blackout']) - idx(E['lightOn']))]), E['lightOn'], db(-62))

# footsteps: faint in the dark, full level once the walker is in the light, panned along with the walker
FOOT = np.zeros((2, N))
for s in E['steps']:
    near = np.clip((s['x'] + 4.4) / 1.9, 0, 1)
    add(footstep(s['size']), s['t'], db(-28 + 10 * near), float(np.clip(s['x'] / 5, -0.8, 0.8)), FOOT)
irn = int(0.8 * SR)
ir = lp(step_rng.standard_normal(irn), 3500) * decay(irn, 0.16)
ir /= np.sqrt(np.sum(ir ** 2))
for c in range(2):
    MAIN[c] += FOOT[c] + 0.3 * fftconvolve(FOOT[c], ir)[:N]

add(crinkle(0.3, 500), E['grab'], db(-24), -0.2)
add(crinkle(0.25, 400), E['turn'], db(-28), -0.2)
add(tear_boom(), E['tear'], 1.0)
ringn = int(3.0 * SR)
add(np.sin(2 * np.pi * 4100 * tsec(ringn)) * np.minimum(1, tsec(ringn) / 0.3) * decay(ringn, 0.9), E['tear'] + 0.35, db(-36))
for t, pan in zip(E['halfLand'], (-0.5, 0.5)):
    add(norm(crinkle(0.09, 900)), t, db(-26), pan)

for b in E['bites1'] + E['bites2']:
    add(crunch(), b, db(-10))
t = E['bites2'][2] + 0.22
while t < E['party'] - 0.1:
    add(crunch(0.09), t, db(-22))
    t += 0.31 + rng.uniform(-0.03, 0.03)

add(knee_thud(), E['party'], db(-8))
add(popper(), E['party'], db(-6), -0.6)
add(popper(), E['party'] + 0.04, db(-6), 0.6)
add(party_horn(), E['party'] + 0.02, db(-9), 0.15)
music()
add(switch_click(big=True), E['blackout'], db(-6))

# another wrapper, quietly, in the dark
for t0, d, rate in ((41.3, 0.32, 260), (41.85, 0.38, 330), (42.45, 0.45, 420)):
    add(norm(crinkle(d, rate, 1500, 9000, curve=lambda x: np.sin(np.pi * x))), t0, db(-19), 0.25)
add(norm(crinkle(0.1, 3000, 1200, 10000)), 42.95, db(-22), 0.25)

mix = MAIN + MUSIC
mix = np.tanh(mix / 1.05) * 1.05
mix = np.clip(mix, -1, 1)
wavfile.write('out/audio.wav', SR, (mix.T * 32767).astype(np.int16))
print('wrote out/audio.wav', mix.shape, 'peak', np.max(np.abs(mix)).round(3))
