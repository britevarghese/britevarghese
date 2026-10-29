# Audio helpers for build_audio.py: decode anything with ffmpeg, write 16-bit WAV, envelopes, trims.
import subprocess, numpy as np, wave, os

def load(path, sr=44100, ch=None, start=None, dur=None):
    """Decode any file to float32. ch=None -> mono mix, 'stereo' -> (n,2), 0/1 -> that channel."""
    args = ['ffmpeg', '-v', 'error']
    if start is not None: args += ['-ss', str(start)]
    if dur is not None: args += ['-t', str(dur)]
    args += ['-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', str(sr), '-ac', '2', '-']
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    if ch == 'stereo': return x
    if ch is None: return x.mean(axis=1)
    return x[:, ch]

def save(path, x, sr=44100, peak_db=-1.0):
    x = np.asarray(x, dtype=np.float64)
    if peak_db is not None:
        p = np.max(np.abs(x)) or 1.0
        x = x * (10 ** (peak_db / 20) / p)
    y = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(y.tobytes())

def env_db(x, sr, win=0.005):
    n = max(1, int(sr * win)); m = len(x) // n
    r = np.sqrt(np.mean(x[:m * n].reshape(m, n) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(r), n

def fade(x, sr, fin=0.002, fout=0.03, curve=2.0):
    x = x.copy(); a = int(sr * fin); b = int(sr * fout)
    if a: x[:a] *= np.linspace(0, 1, a)
    if b and b < len(x): x[-b:] *= np.linspace(1, 0, b) ** curve
    return x

def trim_tail(x, sr, thr_db=-55, pad=0.02):
    """Cut where the level falls below thr_db (relative to peak) for good."""
    e, n = env_db(x / (np.max(np.abs(x)) + 1e-12), sr, 0.005)
    idx = np.where(e > thr_db)[0]
    end = (idx[-1] + 1) * n + int(pad * sr) if len(idx) else len(x)
    return x[:min(len(x), end)]
