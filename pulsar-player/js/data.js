/* ═══════════════════════════════════════════════════════════════
   data.js — Pulsar music library
   ---------------------------------------------------------------
   • Song / playlist data lives here, separate from UI logic.
   • Album art is generated procedurally on a <canvas> (original,
     offline, zero external assets).
   • Audio uses SoundHelix demo tracks. To use your own files,
     put them in /assets/audio and change `src` below, e.g.
        src: "assets/audio/neon-skyline.mp3"
   ═══════════════════════════════════════════════════════════════ */

/* Demo audio base — replace with local paths for production */
const AUDIO_BASE = "https://www.soundhelix.com/examples/mp3/";

/* ─────────────── Seeded random helpers (deterministic art) ─────────────── */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─────────────── Album-art generator ─────────────── */
/* Draws gradient + blobs + a geometric motif + grain + vignette. */
function makeCover(seedStr, colors, size = 560) {
  const rand = mulberry32(hashString(seedStr));
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const [c1, c2, c3] = colors;

  // Base diagonal gradient (darkened so UI text stays readable on cards)
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, shade(c1, -0.38));
  g.addColorStop(0.55, shade(c2, -0.46));
  g.addColorStop(1, shade(c3 || c1, -0.56));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Soft colour blobs
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    const x = rand() * size, y = rand() * size, r = size * (0.18 + rand() * 0.3);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = [c1, c2, c3 || c1][i % 3];
    rg.addColorStop(0, hexA(col, 0.34));
    rg.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = "source-over";

  // Geometric motif — chosen by seed so each album feels distinct
  const motif = Math.floor(rand() * 4);
  ctx.save();
  ctx.strokeStyle = hexA("#ffffff", 0.5);
  ctx.fillStyle = hexA("#ffffff", 0.5);
  ctx.lineWidth = Math.max(2, size / 220);
  if (motif === 0) {                       // concentric rings
    const cx = size * (0.3 + rand() * 0.4), cy = size * (0.3 + rand() * 0.4);
    for (let i = 1; i <= 5; i++) {
      ctx.globalAlpha = 0.55 - i * 0.08;
      ctx.beginPath(); ctx.arc(cx, cy, (size * 0.09) * i, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (motif === 1) {                // sound waves
    for (let w = 0; w < 5; w++) {
      ctx.globalAlpha = 0.4 - w * 0.06;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 6) {
        const y = size * (0.3 + w * 0.1) + Math.sin(x / size * Math.PI * (2 + rand() * 0.01) + w) * size * 0.07;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (motif === 2) {                // eclipse orb
    const cx = size * (0.35 + rand() * 0.3), cy = size * (0.35 + rand() * 0.3), r = size * 0.24;
    const og = ctx.createRadialGradient(cx - r / 3, cy - r / 3, r / 6, cx, cy, r);
    og.addColorStop(0, hexA(c1, 0.95)); og.addColorStop(1, hexA(c2, 0.15));
    ctx.globalAlpha = 0.9; ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = hexA("#ffffff", 0.7);
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.28, rand() * Math.PI, rand() * Math.PI + Math.PI * 1.3); ctx.stroke();
  } else {                                 // starfield dots + horizon
    for (let i = 0; i < 90; i++) {
      ctx.globalAlpha = 0.15 + rand() * 0.6;
      const x = rand() * size, y = rand() * size * 0.75, r = rand() * size * 0.006 + 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(0, size * 0.82); ctx.lineTo(size, size * 0.74); ctx.stroke();
  }
  ctx.restore();

  // Grain overlay (tileable noise, generated once)
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = grainPattern(ctx, 90);
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 1;

  // Vignette
  const vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.78);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, size, size);

  return cv.toDataURL("image/jpeg", 0.88);
}

let _grain = null;
function grainPattern(ctx, n) {
  if (_grain) return ctx.createPattern(_grain, "repeat");
  const c = document.createElement("canvas"); c.width = c.height = n;
  const x = c.getContext("2d");
  const img = x.createImageData(n, n);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  _grain = c;
  return ctx.createPattern(c, "repeat");
}

/* Colour utilities */
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function shade(hex, amt) { // amt < 0 darkens
  const [r, g, b] = hexToRgb(hex).map(v => Math.max(0, Math.min(255, Math.round(v * (1 + amt)))));
  return `rgb(${r},${g},${b})`;
}
function hexA(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/* Small circular avatar for artists */
function makeAvatar(name, colors, size = 220) {
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.arc(size * 0.75, size * 0.2, size * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${size * 0.42}px 'Outfit', sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  ctx.fillText(initials, size / 2, size / 2 + size * 0.03);
  return cv.toDataURL("image/jpeg", 0.9);
}

/* ═══════════════════════ THE SONG LIBRARY ═══════════════════════
   Each song: id, title, artist, album, genre, duration (seconds),
   src (audio URL), colors (art palette). `cover` is generated.   */
const SONGS = [
  { id: "s1",  title: "Neon Skyline",   artist: "Luna Waves",     album: "Afterglow",        genre: "Synthwave", duration: 372, src: AUDIO_BASE + "SoundHelix-Song-1.mp3",  colors: ["#19e3a4", "#0bb8d9", "#123a5e"] },
  { id: "s2",  title: "Midnight Drive", artist: "The Velvet Echo",album: "City Lights",      genre: "Dream Pop", duration: 425, src: AUDIO_BASE + "SoundHelix-Song-2.mp3",  colors: ["#7b5cff", "#ff4fd8", "#1b1040"] },
  { id: "s3",  title: "Golden Hour",    artist: "Ava Sterling",   album: "Sunset Sessions",  genre: "Indie",     duration: 296, src: AUDIO_BASE + "SoundHelix-Song-3.mp3",  colors: ["#ffb347", "#ff5e62", "#4a1f2b"] },
  { id: "s4",  title: "Electric Dreams",artist: "Neon Circuit",   album: "Voltage",          genre: "Electronic",duration: 388, src: AUDIO_BASE + "SoundHelix-Song-4.mp3",  colors: ["#00e5ff", "#2979ff", "#0a1e3f"] },
  { id: "s5",  title: "Ocean Breeze",   artist: "Coral Skies",    album: "Tidal",            genre: "Chill",     duration: 341, src: AUDIO_BASE + "SoundHelix-Song-5.mp3",  colors: ["#43cea2", "#185a9d", "#0c2b45"] },
  { id: "s6",  title: "Starlight",      artist: "Luna Waves",     album: "Afterglow",        genre: "Synthwave", duration: 402, src: AUDIO_BASE + "SoundHelix-Song-6.mp3",  colors: ["#c471ed", "#12c2e9", "#141034"] },
  { id: "s7",  title: "City Pulse",     artist: "Metro Motion",   album: "Concrete Jungle",  genre: "Hip-Hop",   duration: 268, src: AUDIO_BASE + "SoundHelix-Song-7.mp3",  colors: ["#f7971e", "#ff5858", "#33130f"] },
  { id: "s8",  title: "Wildfire",       artist: "The Velvet Echo",album: "City Lights",      genre: "Alt Rock",  duration: 355, src: AUDIO_BASE + "SoundHelix-Song-8.mp3",  colors: ["#ff416c", "#ff4b2b", "#3b0d16"] },
  { id: "s9",  title: "Daydream",       artist: "Ava Sterling",   album: "Sunset Sessions",  genre: "Indie",     duration: 312, src: AUDIO_BASE + "SoundHelix-Song-9.mp3",  colors: ["#a8ff78", "#78ffd6", "#123b2c"] },
  { id: "s10", title: "Gravity",        artist: "Neon Circuit",   album: "Voltage",          genre: "Electronic",duration: 434, src: AUDIO_BASE + "SoundHelix-Song-10.mp3", colors: ["#5f72bd", "#9b23ea", "#160f33"] },
  { id: "s11", title: "Northern Lights",artist: "Coral Skies",    album: "Tidal",            genre: "Ambient",   duration: 389, src: AUDIO_BASE + "SoundHelix-Song-11.mp3", colors: ["#2af598", "#009efd", "#08223a"] },
  { id: "s12", title: "Echoes of You",  artist: "Metro Motion",   album: "Concrete Jungle",  genre: "Lo-Fi",     duration: 284, src: AUDIO_BASE + "SoundHelix-Song-12.mp3", colors: ["#f9d423", "#e14fad", "#37123a"] },
];

/* Generate covers once at load (fast: ~12 canvases) */
SONGS.forEach(s => { s.cover = makeCover(s.id + s.title, s.colors); });

/* ─────────────── Artists (derived + curated metadata) ─────────────── */
const ARTISTS = [...new Set(SONGS.map(s => s.artist))].map((name, i) => {
  const palette = [["#19e3a4", "#0bb8d9"], ["#7b5cff", "#ff4fd8"], ["#ffb347", "#ff5e62"],
                   ["#00e5ff", "#2979ff"], ["#43cea2", "#185a9d"], ["#f7971e", "#ff5858"],
                   ["#c471ed", "#12c2e9"], ["#a8ff78", "#78ffd6"]][i % 8];
  return {
    name,
    avatar: makeAvatar(name, palette),
    colors: palette,
    listeners: (1.2 + (hashString(name) % 800) / 100).toFixed(1) + "M monthly listeners",
    bio: `${name} crafts immersive soundscapes that blur the line between midnight nostalgia and futuristic pop. A defining voice of the new wave.`,
  };
});

/* ─────────────── Curated collections for the home rows ─────────────── */
const COLLECTIONS = {
  featured:  { id: "s1", badge: "Track of the Week",
               desc: "A shimmering synthwave journey through rain-slick streets and holographic skies. Luna Waves' signature anthem opens her acclaimed album Afterglow — press play and let the neon take over." },
  trending:  ["s4", "s8", "s2", "s12", "s6", "s10", "s1", "s7"],
  chill:     ["s5", "s11", "s9", "s3", "s12", "s6"],
  topHits:   ["s1", "s3", "s7", "s2", "s10", "s8", "s4", "s11"],
  madeForYou:["s9", "s5", "s6", "s11", "s3", "s1"],
};

/* ─────────────── Starter playlists (persisted & editable) ─────────────── */
const SEED_PLAYLISTS = [
  { id: "pl1", name: "Midnight Drive",  desc: "Late-night roads, city glow", songs: ["s2", "s1", "s6", "s10", "s8"] },
  { id: "pl2", name: "Focus Flow",      desc: "Deep work, zero distractions", songs: ["s5", "s11", "s12", "s9"] },
  { id: "pl3", name: "Workout Energy",  desc: "Push past the last rep",       songs: ["s4", "s7", "s8", "s1", "s10"] },
  { id: "pl4", name: "Golden Mornings", desc: "Slow starts & warm light",     songs: ["s3", "s9", "s5", "s11"] },
];

/* ─────────────── Lookup helpers ─────────────── */
const getSong    = id => SONGS.find(s => s.id === id);
const getArtist  = name => ARTISTS.find(a => a.name === name);
const songsOfArtist = name => SONGS.filter(s => s.artist === name);
const albumsList = () => [...new Map(SONGS.map(s => [s.album, s])).values()];

/* Format seconds → m:ss */
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* Placeholder time-synced "lyrics" — deterministic per song.
   Replace with real lyric data (array of {time, text}) if you have it. */
const LYRIC_LINES = [
  "City lights are fading in the mirror",
  "Every heartbeat hums a little nearer",
  "We were golden in the afterglow",
  "Static skies where the dreamers go",
  "Hold the night like it's never letting go",
  "Echoes of you on a midnight radio",
  "Turn it up until the stars align",
  "Lost in the rhythm, one more time",
  "Colours bleeding through the morning haze",
  "We are the sound of brighter days",
  "Drive slow where the neon flows",
  "Everything glows where your shadow goes",
];
function lyricsFor(song) {
  const rand = mulberry32(hashString("lyr" + song.id));
  const pool = [...LYRIC_LINES].sort(() => rand() - 0.5).slice(0, 10);
  const step = song.duration / pool.length;
  return pool.map((text, i) => ({ time: i * step, text }));
}
