/* ═══════════════════════════════════════════════════════════════
   player.js — Pulsar audio engine
   ---------------------------------------------------------------
   Wraps a single <audio> element with: play/pause, next/prev,
   seek, volume/mute, shuffle, repeat, an explicit play queue,
   auto-advance, Media Session integration and keyboard-friendly
   state used by app.js.

   Graceful fallback: if a demo stream fails to load (offline,
   blocked, etc.) the engine switches to SIMULATED playback —
   the timeline still advances using the song's known duration so
   the entire UI remains fully functional.
   ═══════════════════════════════════════════════════════════════ */

const Player = {
  audio: null,

  state: {
    queue: [],            // array of song ids — the play context
    qIndex: -1,           // index of the current track inside queue
    playing: false,
    shuffle: false,
    repeat: "off",        // "off" | "all" | "one"
    volume: store.get("volume", 0.8),
    muted: false,
    mode: "real",         // "real" audio | "sim" fallback
    simTime: 0,
  },

  /* ─────────────── lifecycle ─────────────── */
  init() {
    this.audio = el("audio");
    const a = this.audio;
    a.volume = this.state.muted ? 0 : this.state.volume;
    this.syncVolumeUI();

    // real-audio events
    a.addEventListener("loadedmetadata", () => {
      clearTimeout(this._loadTimer);
      if (isFinite(a.duration) && a.duration > 0) {
        const s = this.currentSong();
        if (s) App.onMeta(s, a.duration);
      }
      this.updateMediaSession();
    });
    a.addEventListener("canplay", () => { clearTimeout(this._loadTimer); this.state.mode = "real"; });
    a.addEventListener("error", () => { if (this.currentSong()) this.enterSimMode(); });
    a.addEventListener("play",  () => { this.state.playing = true;  App.syncNowPlaying(); });
    a.addEventListener("pause", () => { this.state.playing = false; App.syncNowPlaying(); });
    a.addEventListener("ended", () => this.onEnded());

    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  },

  /* ─────────────── core helpers ─────────────── */
  currentSong() {
    const id = this.state.queue[this.state.qIndex];
    return id ? getSong(id) : null;
  },
  currentDuration() {
    const s = this.currentSong();
    if (!s) return 0;
    const d = this.audio.duration;
    return this.state.mode === "real" && isFinite(d) && d > 0 ? d : s.duration;
  },
  currentTime() {
    return this.state.mode === "real" ? this.audio.currentTime : this.state.simTime;
  },

  /* Play a list of song ids starting at index (the main entry point) */
  playList(ids, startIndex = 0, { shuffleAll = false } = {}) {
    if (!ids.length) return;
    this.state.queue = [...ids];
    this.state.qIndex = Math.min(Math.max(0, startIndex), ids.length - 1);
    if (shuffleAll) this.shuffleQueue(this.state.qIndex === 0);
    this.loadAndPlay(true);
  },

  playIndex(i) {
    if (i < 0 || i >= this.state.queue.length) return;
    this.state.qIndex = i;
    this.loadAndPlay(true);
  },

  loadAndPlay(autoplay) {
    const song = this.currentSong();
    if (!song) return;
    const a = this.audio;
    this.state.mode = "real";
    this.state.simTime = 0;
    clearTimeout(this._loadTimer);
    a.src = song.src;
    a.volume = this.state.muted ? 0 : this.state.volume;
    if (autoplay) {
      const p = a.play();
      if (p && p.catch) p.catch(err => {
        // autoplay blocked → stay paused; network failure → simulate
        if (err.name !== "NotAllowedError") this.enterSimMode();
        this.state.playing = false;
        App.syncNowPlaying();
      });
      this.state.playing = true;
    }
    // if the stream stalls before it can play, fall back to simulation
    this._loadTimer = setTimeout(() => {
      if (a.readyState < 3 && this.state.playing) this.enterSimMode();
    }, 4000);

    App.pushRecent(song.id);
    App.onTrackChange?.(song);
    App.syncNowPlaying();
    App.onTime(0, this.currentDuration());
    this.updateMediaSession();
  },

  enterSimMode() {
    if (this.state.mode === "sim") return;
    this.state.mode = "sim";
    this.audio.pause();
    clearTimeout(this._loadTimer);
    App.toast("Streaming demo audio — using offline preview mode", "fa-wifi");
  },

  toggle() {
    const song = this.currentSong();
    if (!song) {
      // nothing loaded yet → start the featured track
      this.playList(COLLECTIONS.topHits, 0);
      return;
    }
    if (this.state.mode === "sim") {
      this.state.playing = !this.state.playing;
      App.syncNowPlaying();
      return;
    }
    if (this.audio.paused) {
      const p = this.audio.play();
      if (p && p.catch) p.catch(() => this.enterSimMode());
    } else {
      this.audio.pause();
    }
  },

  next(auto = false) {
    const { queue } = this.state;
    if (!queue.length) return;
    if (this.state.qIndex + 1 < queue.length) {
      this.state.qIndex++;
      this.loadAndPlay(true);
    } else if (this.state.repeat === "all") {
      this.state.qIndex = 0;
      this.loadAndPlay(true);
    } else if (auto) {
      // end of queue — stop cleanly
      this.audio.pause();
      this.state.playing = false;
      this.state.simTime = 0;
      if (this.state.mode === "real") this.audio.currentTime = 0;
      App.syncNowPlaying();
      App.onTime(0, this.currentDuration());
    } else {
      this.state.qIndex = 0;          // manual next wraps around
      this.loadAndPlay(true);
    }
  },

  prev() {
    // standard behaviour: restart the track if >3s in, else go back one
    if (this.currentTime() > 3) { this.seekSeconds(0); return; }
    const { queue } = this.state;
    if (!queue.length) return;
    this.state.qIndex = this.state.qIndex - 1 < 0 ? queue.length - 1 : this.state.qIndex - 1;
    this.loadAndPlay(true);
  },

  onEnded() {
    if (this.state.repeat === "one") { this.seekSeconds(0); this.realOrSimPlay(); return; }
    this.next(true);
  },

  realOrSimPlay() {
    if (this.state.mode === "sim") { this.state.simTime = 0; this.state.playing = true; App.syncNowPlaying(); }
    else { this.audio.currentTime = 0; this.audio.play().catch(() => {}); }
  },

  /* ─────────────── seeking ─────────────── */
  seekFrac(frac) {
    frac = Math.min(Math.max(frac, 0), 1);
    this.seekSeconds(frac * this.currentDuration());
  },
  seekSeconds(sec) {
    if (!this.currentSong()) return;
    sec = Math.min(Math.max(sec, 0), this.currentDuration());
    if (this.state.mode === "real") this.audio.currentTime = sec;
    else this.state.simTime = sec;
    App.onTime(sec, this.currentDuration());
  },
  skip(delta) { this.seekSeconds(this.currentTime() + delta); },

  /* ─────────────── volume ─────────────── */
  setVolume(v) {
    v = Math.min(Math.max(v, 0), 1);
    this.state.volume = v;
    this.state.muted = v === 0;
    this.audio.volume = v;
    store.set("volume", v);
    this.syncVolumeUI();
  },
  nudgeVolume(d) { this.setVolume((this.state.muted ? 0 : this.state.volume) + d); },
  toggleMute() {
    this.state.muted = !this.state.muted;
    this.audio.volume = this.state.muted ? 0 : this.state.volume;
    this.syncVolumeUI();
  },
  syncVolumeUI() {
    const shown = this.state.muted ? 0 : this.state.volume;
    const pct = Math.round(shown * 100);
    [el("volSlider"), el("fsVol")].forEach(s => { if (s) { s.value = pct; s.style.setProperty("--fill", pct + "%"); } });
    const icon = this.state.muted || shown === 0 ? "fa-volume-xmark" : shown < 0.4 ? "fa-volume-low" : "fa-volume-high";
    [el("btnMute"), el("fsMute")].forEach(b => { if (b) b.innerHTML = `<i class="fa-solid ${icon}"></i>`; });
  },

  /* ─────────────── shuffle & repeat ─────────────── */
  cycleShuffle() {
    this.state.shuffle = !this.state.shuffle;
    if (this.state.shuffle) this.shuffleQueue(true);
    App.syncNowPlaying();
    App.toast(this.state.shuffle ? "Shuffle on" : "Shuffle off", "fa-shuffle");
  },
  enableShuffle() { this.state.shuffle = true; },
  shuffleQueue(keepFirst) {
    const { queue } = this.state;
    const start = keepFirst ? this.state.qIndex + 1 : 0;
    const head = queue.slice(0, start);
    const tail = queue.slice(start);
    for (let i = tail.length - 1; i > 0; i--) {           // Fisher–Yates
      const j = Math.floor(Math.random() * (i + 1));
      [tail[i], tail[j]] = [tail[j], tail[i]];
    }
    this.state.queue = [...head, ...tail];
  },
  cycleRepeat() {
    this.state.repeat = { off: "all", all: "one", one: "off" }[this.state.repeat];
    App.syncNowPlaying();
    App.toast(`Repeat: ${this.state.repeat === "off" ? "off" : this.state.repeat === "all" ? "whole queue" : "this track"}`, "fa-repeat");
  },

  /* ─────────────── queue management ─────────────── */
  addToQueue(id) {
    if (!this.state.queue.length) { this.playList([id], 0); return; }
    this.state.queue.push(id);
    App.onQueueChange();
  },
  playNext(id) {
    if (!this.state.queue.length) { this.playList([id], 0); return; }
    this.state.queue.splice(this.state.qIndex + 1, 0, id);
    App.onQueueChange();
  },
  removeFromQueue(i) {
    if (i <= this.state.qIndex || i >= this.state.queue.length) return;
    this.state.queue.splice(i, 1);
    App.onQueueChange();
  },

  /* ─────────────── main animation loop ─────────────── */
  tick(ts) {
    const st = this.state;
    if (st.playing && this.currentSong()) {
      if (st.mode === "sim") {
        // simulated clock (fallback when streams can't load)
        const dt = this._lastTs ? (ts - this._lastTs) / 1000 : 0;
        st.simTime += Math.min(dt, 0.25);
        const dur = this.currentDuration();
        App.onTime(st.simTime, dur);
        if (st.simTime >= dur) { st.simTime = dur; this.onEnded(); }
      } else {
        App.onTime(this.audio.currentTime, this.currentDuration());
      }
    }
    this._lastTs = ts;
    requestAnimationFrame(this.tick);
  },

  /* ─────────────── OS media integration (bonus) ─────────────── */
  updateMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const s = this.currentSong();
    if (!s) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.title, artist: s.artist, album: s.album,
        artwork: [{ src: s.cover, sizes: "560x560", type: "image/jpeg" }],
      });
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => this.toggle());
      ms.setActionHandler("pause", () => this.toggle());
      ms.setActionHandler("previoustrack", () => this.prev());
      ms.setActionHandler("nexttrack", () => this.next());
    } catch { /* older browsers */ }
  },
};
