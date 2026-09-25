# 🎧 Pulsar — JavaScript Music Player

An original, premium dark-themed music streaming UI built with **pure vanilla JavaScript** — no frameworks, no UI libraries. Inspired by the usability of modern streaming apps, but with its own branding, layout, and components.

> **Pulsar · feel the frequency**

---

## ✨ Features

| Area | What's included |
|---|---|
| **Layout** | Fixed sidebar (nav + playlists), glassmorphic top navbar with back/forward history, scrollable content views, fixed bottom player |
| **Hero** | Featured track with animated gradient blobs, floating artwork, Play / Add-to-playlist / Like actions |
| **Browse** | Recently Played, Trending Now, Popular Artists, Made For You, Chill Vibes, Top Hits — horizontal card rows with hover play buttons & ⋯ menus |
| **Audio engine** | Real HTML5 Audio API: play/pause, next/prev, seek (click + drag), volume, mute, shuffle, repeat (off/all/one), auto-advance |
| **Offline fallback** | If demo streams can't load, the engine switches to *simulated playback* so the whole UI stays functional |
| **Playlists** | Create, add to, remove from, delete, shuffle-play — persisted in `localStorage` |
| **Liked Songs** | Heart any track; dedicated collection view, persisted |
| **Queue** | Slide-in panel: now playing + next up, jump to any track, remove items, "Play next" / "Add to queue" from any ⋯ menu |
| **Lyrics** | Slide-in time-synced lyrics panel (placeholder lines — click a line to seek) |
| **Full-screen player** | Expanded now-playing view with blurred artwork backdrop |
| **Search** | Instant client-side search over songs, artists, albums & genres, with top match, grouped results, and mood browsing |
| **Views** | Home, Search, Library, Liked, Recent, Playlist, Artist, Album — with in-app back/forward navigation |
| **Responsive** | Desktop → tablet (off-canvas sidebar) → mobile (bottom nav, compact player with hairline progress, full-screen player) |
| **Extras** | Media Session API integration (OS media controls), keyboard shortcuts, toast notifications, scroll-reveal animations, playing-now equalizer indicator |

## ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `N` / `P` | Next / previous track |
| `←` / `→` | Seek ∓5 s (`Shift+←/→` = prev/next track) |
| `↑` / `↓` | Volume |
| `M` | Mute · `S` shuffle · `R` repeat · `Q` queue · `L` lyrics · `F` full-screen |
| `/` | Focus search · `Esc` | Close menu / panel / overlays |

## 📁 Project structure

```
pulsar-player/
├── index.html          # semantic app shell
├── css/style.css       # design tokens, components, responsive breakpoints
├── js/
│   ├── data.js         # song library, artists, playlists + procedural cover-art generator
│   ├── app.js          # UI layer: routing/views, search, playlists, panels, menus
│   └── player.js       # audio engine: transport, queue, shuffle/repeat, fallback
└── vendor/             # Font Awesome (self-hosted, works offline)
```

## 🔁 Using your own media

1. **Audio** — drop files into `assets/audio/` and edit `js/data.js`:
   ```js
   { id: "s1", title: "…", artist: "…", album: "…", genre: "…",
     duration: 372, src: "assets/audio/your-track.mp3", colors: ["#19e3a4", "#0bb8d9", "#123a5e"] }
   ```
   The demo currently streams royalty-free tracks from [SoundHelix](https://www.soundhelix.com/audio-examples).
2. **Cover art** — albums use a procedural canvas generator (no image files needed). To use real artwork instead, add a `cover: "assets/img/cover.jpg"` field to a song and remove/short-circuit the `makeCover` loop at the bottom of the song list.

## 🚀 Run it

Any static server works:

```bash
npx serve .          # or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## 🧰 Tech

HTML5 · CSS3 (custom properties, grid, glassmorphism, keyframes) · Vanilla JS (ES2020) · HTML5 Audio API · Font Awesome (self-hosted) · Google Fonts (Outfit + Inter, with system fallbacks)

*Built as a portfolio project — all branding, artwork and UI are original.*
