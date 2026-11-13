"""Synthesize Fluff hats, snares, claps and the tambourine.

python3 -I scripts/fluff-drums.py <out-dir> [virtuosity-samples-dir] [hats|snares|claps|perc]

Hats follow the TR-808/606 metal circuit: six free-running square oscillators
at the 808's inharmonic frequencies, summed, band-passed, through an
exponential VCA and a two-pole high-pass, with a little white noise for the
smoother 909-like sheen. Snares are 909-style (two tuned bridged-T bodies
with a pitch drop and high-passed "snappy" noise); claps are 909-style (three
or four noise bursts about 10 ms apart through a ~1.1 kHz band-pass, then a
filtered noise "reverb" tail). Everything is mono 44.1 kHz 16-bit, peak -1 dBFS.
"""
import subprocess, sys, wave
import numpy as np

SR = 44100
METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]


def rng(seed):
    return np.random.default_rng(seed)


def t(seconds):
    return np.arange(int(seconds * SR)) / SR


def square(freq, n, phase):
    """Band-limited square (odd harmonics below 20 kHz)."""
    x = np.zeros(n)
    tt = np.arange(n) / SR
    k = 1
    while k * freq < 20000:
        x += np.sin(2 * np.pi * k * freq * tt + k * phase) / k
        k += 2
    return x * 4 / np.pi


def biquad(x, kind, f0, q=0.707, gain=0.0):
    w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    alpha = sw / (2 * q)
    A = 10 ** (gain / 40)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bp":
        b = [alpha, 0, -alpha]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]; a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == "hshelf":
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s)]
        a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s]
    else:
        raise ValueError(kind)
    b0, b1, b2 = (v / a[0] for v in b)
    a1, a2 = a[1] / a[0], a[2] / a[0]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def rms(x):
    return np.sqrt((x ** 2).mean() + 1e-20)


def fade(x, start, end):
    """Hold until `start` seconds, then a raised-cosine fade to zero at `end`."""
    n = len(x)
    s, e = int(start * SR), min(n, int(end * SR))
    g = np.ones(n)
    if e > s:
        g[s:e] = 0.5 * (1 + np.cos(np.linspace(0, np.pi, e - s)))
    g[e:] = 0
    return x * (g if x.ndim == 1 else g[:, None])


def attack(x, seconds):
    n = max(1, int(seconds * SR))
    g = np.ones(len(x))
    g[:n] = np.sin(np.linspace(0, np.pi / 2, n)) ** 2
    return x * (g if x.ndim == 1 else g[:, None])


def metal(seconds, seed, scale=1.0):
    r = rng(seed)
    n = int(seconds * SR)
    return sum(square(f * scale, n, r.uniform(0, 2 * np.pi)) for f in METAL) / 6


def hat(seconds, seed, env, band, highpass, lowpass, noise, scale=1.0, q=1.0, stereo=True):
    """808 metal and white noise through the hat filters and a VCA envelope.
    The metal is shared; each side gets its own noise, so the sheen is wide
    and the body stays centred."""
    r = rng(seed + 1000)
    m = metal(seconds, seed, scale)
    m = biquad(m, "bp", band, q)
    sides = []
    for _ in range(2 if stereo else 1):
        w = r.standard_normal(len(m))
        w = biquad(w, "bp", band, q * 0.7)
        w *= rms(m) / rms(w)
        x = (1 - noise) * m + noise * w
        x = x * env
        x = biquad(biquad(x, "hp", highpass, 0.7), "hp", highpass, 0.7)
        sides.append(biquad(x, "lp", lowpass, 0.6))
    if not stereo:
        return sides[0]
    left, right = sides
    # A fifth of each side in the other keeps the sheen wide but not split.
    return np.stack([0.8 * left + 0.2 * right, 0.2 * left + 0.8 * right], axis=1)


def two_stage(seconds, fast, fast_share, slow):
    tt = t(seconds)
    return fast_share * np.exp(-tt / fast) + (1 - fast_share) * np.exp(-tt / slow)


def stereo(fn, *args):
    """Run a mono generator per channel with different seeds (args[1] is the
    seed), then blend a quarter of each side into the other so the image is
    wide but not split."""
    a = list(args)
    left = fn(*a)
    a[1] += 500
    right = fn(*a)
    return np.stack([0.75 * left + 0.25 * right, 0.25 * left + 0.75 * right], axis=1)


def crush(x, bits, hold=2):
    peak = np.abs(x).max() + 1e-12
    y = np.round(x / peak * 2 ** (bits - 1)) / 2 ** (bits - 1) * peak
    y = np.repeat(y[::hold], hold, axis=0)[: len(x)]
    return y


def write(path, x):
    x = x / (np.abs(x).max() + 1e-12) * 10 ** (-1 / 20)
    w = wave.open(path, "wb")
    w.setnchannels(1 if x.ndim == 1 else x.shape[1])
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(np.round(x * 32767).astype("<i2").tobytes())
    w.close()


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(float)


# ---------------------------------------------------------------- hats

def shaker(n, seed, band, highpass, rise, decay, lowpass):
    r = rng(seed)
    w = r.standard_normal(int(n * SR))
    beads = np.abs(biquad(r.standard_normal(len(w)), "lp", 500))
    beads /= beads.max()
    w = w * (0.55 + 0.45 * beads)
    tt = t(n)
    env = np.where(tt < rise, np.sin(np.pi / 2 * tt / rise) ** 2, np.exp(-(tt - rise) / decay))
    x = biquad(biquad(w, "bp", band, 0.9), "hp", highpass, 0.7) * env
    return biquad(x, "lp", lowpass, 0.6)


def ride(n, seed):
    """Hundreds of inharmonic partials with their own decays and slow pitch
    wander, dense enough to read as a wash rather than lines, a slower bell
    cluster around 3-6 kHz, a noise sheen and a stick tick."""
    r = rng(seed)
    tt = t(n)
    x = np.zeros(len(tt))
    freqs = np.exp(r.uniform(np.log(2600), np.log(14000), 700))
    for f in freqs:
        decay = r.uniform(0.2, 0.6) * (1.6 if 3000 < f < 6000 else 1.0)
        wander = 1 + 0.002 * np.sin(2 * np.pi * r.uniform(2, 7) * tt + r.uniform(0, 6.3))
        x += np.sin(2 * np.pi * np.cumsum(f * wander) / SR + r.uniform(0, 6.3)) * f ** -0.6 * np.exp(-tt / decay)
    x /= rms(x[: SR // 10])
    w = biquad(r.standard_normal(len(tt)), "hp", 5500, 0.7)
    w = w / rms(w) * np.exp(-tt / 0.25) * 0.6
    stick = biquad(r.standard_normal(len(tt)), "bp", 5000, 0.8)
    stick = stick / rms(stick) * np.exp(-tt / 0.003) * 1.6
    x = x + w + stick
    x = biquad(biquad(x, "hp", 2600, 0.7), "lp", 13000, 0.6)
    return attack(x, 0.0005)


def hats(out):
    # Closed: tight 808 closed hat, about 45 ms to -20 dB.
    n = 0.16
    env = np.exp(-t(n) / 0.024)
    write(f"{out}/hat-closed.wav", fade(hat(n, 1, env, 6800, 4800, 15000, 0.5), 0.11, n))
    # Open: smooth open hat, quick initial drop then an even exponential tail.
    n = 0.8
    env = two_stage(n, 0.012, 0.4, 0.15)
    write(f"{out}/hat-open.wav", fade(hat(n, 2, env, 7200, 5000, 14000, 0.6), 0.5, n))
    # Shaker: band-passed noise with a soft swell and bead texture, one take per side.
    n = 0.16
    write(f"{out}/hat-shaker.wav", fade(stereo(shaker, n, 3, 6000, 3500, 0.01, 0.03, 13000), 0.11, n))
    # Tick: very short, bright 606-style closed hat.
    n = 0.08
    env = np.exp(-t(n) / 0.012)
    write(f"{out}/hat-tick.wav", fade(hat(n, 4, env, 8200, 6000, 15500, 0.45, 1.12, 1.2), 0.06, n))
    # Ride: dense partial wash, wide.
    n = 1.6
    write(f"{out}/hat-ride.wav", fade(stereo(ride, n, 5), 1.2, n))
    # Offbeat: short 909-like open hat for the off-beat "tss".
    n = 0.4
    env = two_stage(n, 0.01, 0.35, 0.085)
    write(f"{out}/hat-offbeat.wav", fade(hat(n, 6, env, 7200, 5000, 14000, 0.6, 1.0, 0.8), 0.28, n))
    # Dusty: darker closed hat, crushed and saturated.
    n = 0.2
    env = np.exp(-t(n) / 0.024)
    x = hat(n, 7, env, 6200, 4200, 9000, 0.45)
    x = crush(np.tanh(x / np.abs(x).max() * 1.6), 10, 2)
    x = biquad(x[:, 0], "lp", 7500, 0.6), biquad(x[:, 1], "lp", 7500, 0.6)
    write(f"{out}/hat-dusty.wav", fade(np.stack(x, axis=1), 0.14, n))
    # Sizzle: long, airy open hat.
    n = 1.2
    env = two_stage(n, 0.015, 0.3, 0.24)
    write(f"{out}/hat-sizzle.wav", fade(hat(n, 8, env, 8600, 6000, 14500, 0.65, 1.04, 0.8), 0.9, n))


# ---------------------------------------------------------------- snares

def snare909(seconds, seed, tune, body_decay, snappy_fast, snappy_slow, snappy_share, noise_hp, noise_lp, body_level=1.0, noise_level=1.0):
    r = rng(seed)
    tt = t(seconds)
    body = np.zeros(len(tt))
    for f, level, decay in [(tune, 1.0, body_decay), (tune * 1.78, 0.55, body_decay * 0.6)]:
        freq = f * (1 + 0.5 * np.exp(-tt / 0.006))
        phase = 2 * np.pi * np.cumsum(freq) / SR
        body += level * np.sin(phase) * np.exp(-tt / decay)
    body /= rms(body[: int(0.03 * SR)])
    w = r.standard_normal(len(tt))
    w = biquad(biquad(w, "hp", noise_hp, 0.7), "lp", noise_lp, 0.7)
    w /= rms(w)
    env = snappy_share * np.exp(-tt / snappy_fast) + (1 - snappy_share) * np.exp(-tt / snappy_slow)
    x = body_level * body + noise_level * w * env
    x = np.tanh(x / np.abs(x).max() * 1.3)
    return attack(x, 0.0003)


def rimclick(seconds, seed):
    """808 rimshot: two bridged-T resonators struck briefly, high-passed."""
    tt = t(seconds)
    x = np.sin(2 * np.pi * 455 * tt) * np.exp(-tt / 0.004) + 0.9 * np.sin(2 * np.pi * 1667 * tt) * np.exp(-tt / 0.006)
    return biquad(x, "hp", 300, 0.7)


def snares(out, virtuosity):
    write(f"{out}/snare-house.wav", fade(snare909(0.38, 11, 185, 0.05, 0.012, 0.1, 0.45, 1100, 9500), 0.28, 0.38))
    x = snare909(0.24, 12, 235, 0.03, 0.008, 0.055, 0.5, 1700, 11000, 0.8, 1.0)
    click = rimclick(0.24, 13)
    x = x / np.abs(x).max() + 0.45 * click / np.abs(click).max()
    write(f"{out}/snare-garage.wav", fade(x, 0.16, 0.24))
    write(f"{out}/snare-roll.wav", fade(snare909(0.2, 14, 205, 0.035, 0.008, 0.06, 0.5, 1300, 10000), 0.13, 0.2))
    if virtuosity:
        close = decode(f"{virtuosity}/Samples__snaremic__snare__snaremic_snare_center_vl34.flac")
        over = decode(f"{virtuosity}/Samples__oh__snare__oh_snare_center_vl34.flac")
        n = int(0.42 * SR)
        def onset(x):
            return int(np.argmax(np.abs(x) > np.abs(x).max() * 0.1))
        close = close[max(0, onset(close) - 20):][:n]
        over = over[max(0, onset(over) - 20):][:n]
        x = close / np.abs(close).max() + 0.4 * over / np.abs(over).max()
        x = biquad(x, "hp", 100, 0.7)
        x = biquad(x, "peak", 210, 1.0, 3)
        x = biquad(x, "peak", 1150, 2.0, -4)
        x = biquad(x, "hshelf", 4500, 0.7, 4)
        x = np.tanh(x / np.abs(x).max() * 2.2)
        write(f"{out}/snare-break.wav", fade(x, 0.24, 0.42))


# ---------------------------------------------------------------- claps

def clap(seconds, seed, hits, band, q, tail, tail_level, burst=0.0035, air=0.15):
    r = rng(seed)
    tt = t(seconds)
    w = r.standard_normal(len(tt))
    bp = biquad(w, "bp", band, q)
    bp /= rms(bp)
    env = np.zeros(len(tt))
    for i, (at, level) in enumerate(hits):
        on = tt >= at
        env = np.maximum(env, np.where(on, level * np.exp(-(tt - at) / burst), 0))
    last = hits[-1][0]
    env = np.maximum(env, np.where(tt >= last, tail_level * np.exp(-(tt - last) / tail), 0))
    x = bp * env
    if air > 0:
        a = biquad(r.standard_normal(len(tt)), "hp", 5000, 0.7)
        x += air * a / rms(a) * env
    x = biquad(x, "hp", 500, 0.7)
    return attack(x, 0.0003)


HOUSE_HITS = [(0.0, 0.8), (0.0105, 0.9), (0.0215, 0.85), (0.033, 1.0)]


def room(x, seconds, seed, level):
    r = rng(seed)
    tt = t(seconds)
    ir = biquad(r.standard_normal(len(tt)), "lp", 6000, 0.6) * np.exp(-tt / 0.16)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum())
    wet = np.convolve(x, ir)[: len(x)]
    return x + level * wet / rms(wet) * rms(x)


def claps(out):
    write(f"{out}/clap-house.wav", fade(clap(0.4, 21, HOUSE_HITS, 1150, 1.1, 0.07, 0.55), 0.3, 0.4))
    write(f"{out}/clap-tight.wav", fade(clap(0.16, 22, [(0, 0.8), (0.008, 0.9), (0.016, 1.0)], 1500, 1.2, 0.035, 0.5, air=0.2), 0.11, 0.16))
    x = clap(0.65, 23, [(0, 0.8), (0.012, 0.9), (0.024, 0.85), (0.037, 1.0)], 1100, 1.0, 0.08, 0.55)
    write(f"{out}/clap-hall.wav", fade(room(x, 0.65, 24, 0.5), 0.5, 0.65))
    x = clap(0.35, 25, HOUSE_HITS, 1000, 1.0, 0.07, 0.55, air=0.05)
    x = biquad(x, "lp", 4500, 0.7)
    x = crush(np.tanh(x / np.abs(x).max() * 1.5), 10, 2)
    write(f"{out}/clap-dusty.wav", fade(biquad(x, "lp", 6000, 0.6), 0.27, 0.35))
    c = clap(0.38, 26, HOUSE_HITS, 1250, 1.1, 0.07, 0.55)
    s = snare909(0.38, 27, 190, 0.05, 0.012, 0.09, 0.45, 1100, 9500)
    x = c / np.abs(c).max() + 0.6 * s / np.abs(s).max()
    write(f"{out}/clap-layered.wav", fade(x, 0.28, 0.38))
    x = clap(0.35, 28, [(0, 0.7), (0.013, 0.85), (0.026, 0.8), (0.04, 1.0)], 1050, 0.9, 0.08, 0.6, burst=0.0045, air=0.05)
    x = biquad(attack(x, 0.0015), "lp", 3200, 0.7)
    write(f"{out}/clap-soft.wav", fade(x, 0.27, 0.35))


# ---------------------------------------------------------------- perc

def tamb_side(n, seed):
    r = rng(seed)
    tt = t(n)
    w = r.standard_normal(len(tt))
    x = np.zeros(len(tt))
    for f in np.exp(r.uniform(np.log(6000), np.log(11500), 9)):
        x += biquad(w, "bp", f, 5)
    x /= rms(x)
    hp = biquad(w, "hp", 7000, 0.7)
    x = 0.6 * x + 0.4 * hp / rms(hp)
    env = np.where(tt < 0.004, tt / 0.004, np.exp(-(tt - 0.004) / 0.04))
    return biquad(x * env, "lp", 12500, 0.6)


def tamb(out):
    """Tambourine: a cluster of moderately resonant jingle bands over bright
    noise, a different take per side."""
    n = 0.22
    write(f"{out}/perc-tamb.wav", fade(stereo(tamb_side, n, 31), 0.15, n))


if __name__ == "__main__":
    out = sys.argv[1]
    virt = sys.argv[2] if len(sys.argv) > 2 else ""
    which = sys.argv[3] if len(sys.argv) > 3 else "all"
    if which in ("all", "hats"):
        hats(out)
    if which in ("all", "snares"):
        snares(out, virt)
    if which in ("all", "claps"):
        claps(out)
    if which in ("all", "perc"):
        tamb(out)
