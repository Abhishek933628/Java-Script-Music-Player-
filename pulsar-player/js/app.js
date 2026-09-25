/* ═══════════════════════════════════════════════════════════════
   app.js — Pulsar UI layer
   ---------------------------------------------------------------
   Owns: app state, view routing/rendering, search, playlists,
   liked songs, recently played, context menus, panels, modals,
   toasts and keyboard shortcuts.
   The audio engine lives in player.js; the two talk through a
   small set of callbacks (App.onTrackChange / onPlayState / …).
   ═══════════════════════════════════════════════════════════════ */

const el = id => document.getElementById(id);
const esc = str => String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const attr = obj => JSON.stringify(obj); // for data-* attributes holding JSON

/* tiny safe localStorage wrapper */
const store = {
  get(key, fallback) { try { const v = localStorage.getItem("pulsar." + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, val) { try { localStorage.setItem("pulsar." + key, JSON.stringify(val)); } catch { /* private mode etc. */ } },
};

const App = {
  /* ─────────────── state ─────────────── */
  state: {
    view: { name: "home", param: null },
    history: [], future: [],
    liked: new Set(store.get("liked", [])),
    playlists: store.get("playlists", null) || SEED_PLAYLISTS.map(p => ({ ...p, songs: [...p.songs] })),
    recent: store.get("recent", []),          // song ids, most-recent first
    lyrics: [], activeLyric: -1,
    ctx: null,                                 // context-menu payload
    searchQuery: "",
    panels: { queue: false, lyrics: false, fullscreen: false },
    seekDragging: false,
  },

  /* ═══════════════════ INIT ═══════════════════ */
  init() {
    this.cacheDom();
    // reveal-on-scroll observer (root = scrolling view) — must exist before first render
    this.revealObs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); this.revealObs.unobserve(e.target); } });
    }, { root: this.dom.view, threshold: 0.06 });
    this.bindGlobalEvents();
    this.renderSidebar();
    this.buildMiniTransport();
    this.navigate({ name: "home" }, { history: false });
  },

  cacheDom() {
    this.dom = {
      view: el("view"), sidebar: el("sidebar"), backdrop: el("sidebarBackdrop"),
      topbar: el("topbar"), searchInput: el("searchInput"), searchClear: el("searchClear"),
      queuePanel: el("queuePanel"), queueBody: el("queueBody"),
      lyricsPanel: el("lyricsPanel"), lyricsBody: el("lyricsBody"),
      fullscreen: el("fullscreen"), ctxMenu: el("ctxMenu"), toast: el("toast"),
      modal: el("modalOverlay"), modalInput: el("modalInput"),
    };
  },

  /* Creates the compact prev/play/next cluster shown on ≤640px */
  buildMiniTransport() {
    const mini = document.createElement("div");
    mini.className = "mini-transport";
    mini.innerHTML = `
      <button class="icon-btn ghost" data-mini="prev" aria-label="Previous"><i class="fa-solid fa-backward-step"></i></button>
      <button class="play-btn" data-mini="play" aria-label="Play or pause"><i class="fa-solid fa-play"></i></button>
      <button class="icon-btn ghost" data-mini="next" aria-label="Next"><i class="fa-solid fa-forward-step"></i></button>`;
    el("player").appendChild(mini);
    this.dom.miniPlay = mini.querySelector('[data-mini="play"]');
  },

  /* ═══════════════════ NAVIGATION / ROUTING ═══════════════════ */
  navigate(view, { history = true, restoreScroll = null } = {}) {
    const same = view.name === this.state.view.name && view.param === this.state.view.param;
    if (history && !same) {
      this.state.history.push({ ...this.state.view, scroll: this.dom.view.scrollTop });
      this.state.future = [];
      if (this.state.history.length > 40) this.state.history.shift();
    }
    this.state.view = view;
    this.render(restoreScroll);
    this.updateNavChrome();
    this.dom.view.scrollTop = restoreScroll ?? 0;
  },

  goBack() {
    const prev = this.state.history.pop();
    if (!prev) return;
    this.state.future.push({ ...this.state.view, scroll: this.dom.view.scrollTop });
    this.state.view = prev;
    this.render(prev.scroll);
    this.updateNavChrome();
    this.dom.view.scrollTop = prev.scroll || 0;
  },

  goFwd() {
    const nxt = this.state.future.pop();
    if (!nxt) return;
    this.state.history.push({ ...this.state.view, scroll: this.dom.view.scrollTop });
    this.state.view = nxt;
    this.render(nxt.scroll);
    this.updateNavChrome();
    this.dom.view.scrollTop = nxt.scroll || 0;
  },

  updateNavChrome() {
    el("btnBack").disabled = !this.state.history.length;
    el("btnFwd").disabled = !this.state.future.length;
    const v = this.state.view.name;
    document.querySelectorAll("[data-nav]").forEach(b =>
      b.classList.toggle("active", b.dataset.nav === v || (v === "playlist" && b.dataset.nav === "library")));
    this.renderSidebar(true);
  },

  /* ═══════════════════ RENDER DISPATCH ═══════════════════ */
  render(restoreScroll = null) {
    const { name, param } = this.state.view;
    const html =
      name === "home" ? this.viewHome() :
      name === "search" ? this.viewSearch() :
      name === "library" ? this.viewLibrary() :
      name === "liked" ? this.viewLiked() :
      name === "recent" ? this.viewRecent() :
      name === "playlist" ? this.viewPlaylist(param) :
      name === "artist" ? this.viewArtist(param) :
      name === "album" ? this.viewAlbum(param) :
      this.viewHome();
    this.dom.view.innerHTML = html;
    // hook up reveal animations
    this.dom.view.querySelectorAll(".reveal").forEach((n, i) => {
      n.style.transitionDelay = `${Math.min(i * 45, 260)}ms`;
      this.revealObs?.observe(n);
    });
    this.syncNowPlaying();
  },

  /* ═══════════════════ REUSABLE HTML BUILDERS ═══════════════════ */

  /* Song card for horizontal rows */
  songCard(song, queueIds) {
    const isCur = Player.currentSong()?.id === song.id;
    return `
    <article class="card song-card reveal ${isCur ? "playing" : ""}" data-song="${song.id}" data-queue='${attr(queueIds)}'>
      <div class="card-art">
        <img src="${song.cover}" alt="${esc(song.album)} artwork" loading="lazy" />
        ${isCur ? this.eqHTML() : ""}
        <button class="play-btn card-play" data-act="card-play" aria-label="Play ${esc(song.title)}">
          <i class="fa-solid ${isCur && Player.state.playing ? "fa-pause" : "fa-play"}"></i>
        </button>
        <button class="card-menu" data-act="menu" data-id="${song.id}" aria-label="More options"><i class="fa-solid fa-ellipsis"></i></button>
      </div>
      <p class="card-title">${esc(song.title)}</p>
      <p class="card-sub">${esc(song.artist)} · ${esc(song.album)}</p>
    </article>`;
  },

  artistCard(a) {
    const count = songsOfArtist(a.name).length;
    return `
    <article class="card artist reveal" data-artist="${esc(a.name)}">
      <div class="card-art">
        <img src="${a.avatar}" alt="${esc(a.name)}" loading="lazy" />
        <button class="play-btn card-play" data-act="artist-play" data-artist="${esc(a.name)}" aria-label="Play ${esc(a.name)}">
          <i class="fa-solid fa-play"></i>
        </button>
      </div>
      <p class="card-title">${esc(a.name)}</p>
      <p class="card-sub">Artist · ${count} tracks</p>
    </article>`;
  },

  eqHTML() { return `<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`; },

  row(title, icon, songs, queueIds, { artistMode = false } = {}) {
    if (!songs.length) return "";
    const cards = artistMode
      ? songs.map(a => this.artistCard(a)).join("")
      : songs.map(s => this.songCard(s, queueIds)).join("");
    return `
    <section class="section reveal">
      <div class="section-head">
        <h2><i class="fa-solid ${icon}"></i>${title}</h2>
      </div>
      <div class="row-scroll">${cards}</div>
    </section>`;
  },

  /* One row of the track table */
  trackRow(song, i, queueIds, opts = {}) {
    const isCur = Player.currentSong()?.id === song.id;
    const liked = this.state.liked.has(song.id);
    return `
    <div class="tt-row reveal ${isCur ? "active" : ""} ${isCur && !Player.state.playing ? "paused-active" : ""}"
         data-song="${song.id}" data-queue='${attr(queueIds)}'>
      <span class="tt-num num">
        <span class="n">${i + 1}</span>
        <i class="fa-solid fa-play"></i>
        ${this.eqHTML()}
      </span>
      <div class="tt-main">
        <img src="${song.cover}" alt="" loading="lazy" />
        <div class="tt-text">
          <p class="tt-title">${esc(song.title)}</p>
          <p class="tt-artist" data-act="artist" data-artist="${esc(song.artist)}">${esc(song.artist)}</p>
        </div>
      </div>
      <span class="tt-album" data-act="album" data-album="${esc(song.album)}">${esc(song.album)}</span>
      <button class="icon-btn like-btn ${liked ? "liked" : ""}" data-act="like" data-id="${song.id}" aria-label="Like">
        <i class="${liked ? "fa-solid" : "fa-regular"} fa-heart"></i>
      </button>
      <span class="tt-dur" data-dur-for="${song.id}">${fmtTime(song.duration)}</span>
      <span class="tt-menu-cell" style="display:flex;justify-content:flex-end">
        ${opts.removable ? `<button class="icon-btn sm tt-remove" data-act="remove" data-id="${song.id}" data-pl="${opts.playlistId}" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button>` : ""}
        <button class="icon-btn sm" data-act="menu" data-id="${song.id}" aria-label="More"><i class="fa-solid fa-ellipsis"></i></button>
      </span>
    </div>`;
  },

  tableHead(removable = false) {
    return `
    <div class="tt-head">
      <span class="num">#</span><span>Title</span><span class="col-album">Album</span>
      <span></span><span class="col-dur" style="text-align:right"><i class="fa-regular fa-clock"></i></span>
      <span class="col-menu"></span>
    </div>`;
  },

  /* ═══════════════════ VIEWS ═══════════════════ */

  greeting() {
    const h = new Date().getHours();
    return h < 5 ? "Still awake" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  },

  viewHome() {
    const f = getSong(COLLECTIONS.featured.id);
    const artist = getArtist(f.artist);
    const quick = [
      { name: "Liked Songs", sub: `${this.state.liked.size} songs`, img: null, nav: { name: "liked" }, icon: "fa-heart" },
      ...this.state.playlists.slice(0, 3).map(p => ({
        name: p.name, sub: `${p.songs.length} songs`, img: getSong(p.songs[0])?.cover || null,
        nav: { name: "playlist", param: p.id }, icon: "fa-list-ul",
      })),
      ...(this.state.recent.length ? [{ name: "Recently Played", sub: "Jump back in", img: getSong(this.state.recent[0])?.cover, nav: { name: "recent" }, icon: "fa-clock-rotate-left" }] : []),
    ];

    const trending = COLLECTIONS.trending.map(getSong);
    const chill = COLLECTIONS.chill.map(getSong);
    const top = COLLECTIONS.topHits.map(getSong);
    const forYou = COLLECTIONS.madeForYou.map(getSong);
    const recentIds = this.state.recent.length ? this.state.recent : COLLECTIONS.madeForYou;
    const recent = recentIds.map(getSong).filter(Boolean);

    return `
    <!-- HERO -->
    <section class="hero reveal" style="--hero-c1:${f.colors[0]};--hero-c2:${f.colors[1]};--hero-grad:linear-gradient(120deg, ${shade(f.colors[2] || f.colors[0], -0.35)}, #0a0d14 65%)">
      <div class="hero-bg"></div>
      <div class="hero-blobs" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="hero-info">
        <span class="hero-badge"><i class="fa-solid fa-bolt"></i> ${COLLECTIONS.featured.badge}</span>
        <h1 class="hero-title">${esc(f.title)}</h1>
        <p class="hero-artist">
          <img src="${artist.avatar}" alt="" /> ${esc(f.artist)}
          <span class="dot">·</span> <span class="muted">${esc(f.album)} · ${esc(f.genre)}</span>
        </p>
        <p class="hero-desc">${COLLECTIONS.featured.desc}</p>
        <div class="hero-actions">
          <button class="btn accent" data-act="hero-play" data-id="${f.id}"><i class="fa-solid fa-play"></i> Play Now</button>
          <button class="btn ghost" data-act="menu" data-id="${f.id}"><i class="fa-solid fa-plus"></i> Add to Playlist</button>
          <button class="icon-btn lg like-btn ${this.state.liked.has(f.id) ? "liked" : ""}" data-act="like" data-id="${f.id}" aria-label="Like"><i class="${this.state.liked.has(f.id) ? "fa-solid" : "fa-regular"} fa-heart"></i></button>
        </div>
      </div>
      <div class="hero-art"><img src="${f.cover}" alt="${esc(f.title)} artwork" /></div>
    </section>

    <!-- QUICK TILES -->
    <section class="section reveal" style="margin-top:30px">
      <div class="section-head"><h2 style="font-size:19px">${this.greeting()}, Aarav</h2></div>
      <div class="quick-grid">
        ${quick.map(q => `
        <div class="quick-tile" data-quick='${attr(q.nav)}'>
          ${q.img ? `<img src="${q.img}" alt="" />` : `<span style="width:68px;height:68px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#7b5cff,#19e3a4);font-size:22px;color:#fff"><i class="fa-solid ${q.icon}"></i></span>`}
          <div style="min-width:0"><p class="qt-name">${esc(q.name)}</p><p class="qt-sub">${esc(q.sub)}</p></div>
        </div>`).join("")}
      </div>
    </section>

    ${this.row("Recently Played", "fa-clock-rotate-left", recent, recentIds)}
    ${this.row("Trending Now", "fa-fire-flame-curved", trending, COLLECTIONS.trending)}
    ${this.row("Popular Artists", "fa-star", ARTISTS, null, { artistMode: true })}
    ${this.row("Made For You", "fa-wand-magic-sparkles", forYou, COLLECTIONS.madeForYou)}
    ${this.row("Chill Vibes", "fa-mug-hot", chill, COLLECTIONS.chill)}
    ${this.row("Top Hits", "fa-crown", top, COLLECTIONS.topHits)}
    `;
  },

  viewSearch() {
    const q = this.state.searchQuery.trim().toLowerCase();
    if (!q) {
      const genres = [...new Set(SONGS.map(s => s.genre))];
      const icons = { Synthwave: "fa-city", "Dream Pop": "fa-cloud-moon", Indie: "fa-seedling", Electronic: "fa-bolt", Chill: "fa-water", "Hip-Hop": "fa-microphone", "Alt Rock": "fa-guitar", Ambient: "fa-mountain-sun", "Lo-Fi": "fa-compact-disc" };
      return `
      <section class="reveal">
        <div class="section-head"><h2><i class="fa-solid fa-compass"></i>Browse by mood</h2></div>
        <div class="genre-grid">
          ${genres.map((g, i) => {
            const c = SONGS.find(s => s.genre === g).colors;
            return `<div class="genre-card" data-genre="${esc(g)}" style="background:linear-gradient(135deg, ${shade(c[0], -0.25)}, ${shade(c[1], -0.45)})">${esc(g)}<i class="fa-solid ${icons[g] || "fa-music"}"></i></div>`;
          }).join("")}
        </div>
        <div class="section-head" style="margin-top:36px"><h2 style="font-size:18px">Popular searches</h2></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${ARTISTS.slice(0, 6).map(a => `<button class="chip" data-search="${esc(a.name)}"><i class="fa-solid fa-magnifying-glass"></i>${esc(a.name)}</button>`).join("")}
        </div>
      </section>`;
    }

    const songs = SONGS.filter(s => [s.title, s.artist, s.album, s.genre].some(f => f.toLowerCase().includes(q)));
    const artists = ARTISTS.filter(a => a.name.toLowerCase().includes(q));
    const albums = albumsList().filter(a => a.album.toLowerCase().includes(q));
    const ids = songs.map(s => s.id);

    const top = songs[0] || null;
    return `
    <section class="reveal">
      <div class="section-head"><h2><i class="fa-solid fa-magnifying-glass"></i>Results for “${esc(this.state.searchQuery.trim())}”</h2></div>
      ${top ? `
      <div class="search-hero" data-song="${top.id}" data-queue='${attr(ids)}'>
        <img src="${top.cover}" alt="" />
        <div><p style="font-size:11px;letter-spacing:.2em;color:var(--text-3);font-weight:700;margin-bottom:6px">TOP MATCH · ${esc(top.genre)}</p>
        <p class="sh-title">${esc(top.title)}</p><p class="sh-sub">${esc(top.artist)} · ${esc(top.album)}</p></div>
        <button class="play-btn" data-act="card-play" aria-label="Play"><i class="fa-solid fa-play"></i></button>
      </div>` : ""}
      ${songs.length ? `
      <div class="search-group"><h3><i class="fa-solid fa-music"></i>Songs</h3>
        <div class="track-table">${this.tableHead()}${songs.map((s, i) => this.trackRow(s, i, ids)).join("")}</div>
      </div>` : ""}
      ${artists.length ? `
      <div class="search-group"><h3><i class="fa-solid fa-microphone"></i>Artists</h3>
        <div class="row-scroll">${artists.map(a => this.artistCard(a)).join("")}</div>
      </div>` : ""}
      ${albums.length ? `
      <div class="search-group"><h3><i class="fa-solid fa-compact-disc"></i>Albums</h3>
        <div class="row-scroll">${albums.map(a => {
          const albumSongs = SONGS.filter(s => s.album === a.album);
          return `
          <article class="card reveal" data-album="${esc(a.album)}">
            <div class="card-art"><img src="${a.cover}" alt="" loading="lazy" />
              <button class="play-btn card-play" data-act="album-play" data-album="${esc(a.album)}" aria-label="Play album"><i class="fa-solid fa-play"></i></button>
            </div>
            <p class="card-title">${esc(a.album)}</p><p class="card-sub">${esc(a.artist)} · ${albumSongs.length} tracks</p>
          </article>`;
        }).join("")}</div>
      </div>` : ""}
      ${!songs.length && !artists.length && !albums.length ? `
      <div class="empty-state"><i class="fa-regular fa-face-frown"></i>
        <h3>No matches found</h3><p>Try a different spelling, or browse moods from the search home.</p></div>` : ""}
    </section>`;
  },

  viewLibrary() {
    return `
    <section class="reveal">
      <div class="page-head" style="margin-bottom:22px">
        <div>
          <p class="ph-eyebrow">Your Collection</p>
          <h1>Your Library</h1>
          <p class="ph-sub"><b>${this.state.playlists.length}</b> playlists · <b>${this.state.liked.size}</b> liked songs</p>
        </div>
      </div>
      <div class="lib-grid">
        <article class="card lib-card liked-card" data-nav="liked">
          <div class="card-art"><i class="fa-solid fa-heart"></i>
            <button class="play-btn card-play" data-act="play-liked" aria-label="Play liked songs"><i class="fa-solid fa-play"></i></button>
          </div>
          <p class="card-title">Liked Songs</p><p class="card-sub">${this.state.liked.size} songs</p>
        </article>
        ${this.state.playlists.map(p => {
          const cover = getSong(p.songs[0])?.cover;
          return `
          <article class="card lib-card" data-playlist="${p.id}">
            <div class="card-art">${cover
              ? `<img src="${cover}" alt="" loading="lazy" />`
              : `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1c2430,#10151d);font-size:34px;color:var(--text-3);border-radius:var(--r-sm)"><i class="fa-solid fa-music"></i></div>`}
              <button class="play-btn card-play" data-act="pl-play" data-pl="${p.id}" aria-label="Play ${esc(p.name)}"><i class="fa-solid fa-play"></i></button>
              <button class="card-menu" data-act="pl-menu" data-pl="${p.id}" aria-label="More"><i class="fa-solid fa-ellipsis"></i></button>
            </div>
            <p class="card-title">${esc(p.name)}</p><p class="card-sub">${p.songs.length} songs</p>
          </article>`;
        }).join("")}
      </div>
    </section>`;
  },

  viewLiked() {
    const ids = [...this.state.liked];
    const songs = ids.map(getSong).filter(Boolean);
    const total = songs.reduce((a, s) => a + s.duration, 0);
    return `
    <section class="reveal">
      <div class="page-head">
        <div class="big-art" style="background:linear-gradient(135deg,#7b5cff,#19e3a4);display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-heart" style="font-size:64px;color:#fff;filter:drop-shadow(0 8px 24px rgba(0,0,0,.4))"></i></div>
        <div>
          <p class="ph-eyebrow">Playlist · Yours</p>
          <h1>Liked Songs</h1>
          <p class="ph-sub"><b>Aarav</b> · ${songs.length} songs${songs.length ? ` · ${fmtTime(total)}` : ""}</p>
        </div>
      </div>
      ${songs.length ? `
      <div class="page-actions">
        <button class="play-btn xl" data-act="play-ids" data-ids='${attr(ids)}' aria-label="Play all"><i class="fa-solid fa-play"></i></button>
        <button class="icon-btn lg" data-act="shuffle-ids" data-ids='${attr(ids)}' title="Shuffle play" aria-label="Shuffle"><i class="fa-solid fa-shuffle"></i></button>
      </div>
      <div class="track-table">${this.tableHead()}${songs.map((s, i) => this.trackRow(s, i, ids)).join("")}</div>` :
      `<div class="empty-state"><i class="fa-regular fa-heart"></i><h3>No liked songs yet</h3>
       <p>Tap the heart on any track and it will live here forever.</p></div>`}
    </section>`;
  },

  viewRecent() {
    const ids = this.state.recent;
    const songs = ids.map(getSong).filter(Boolean);
    return `
    <section class="reveal">
      <div class="page-head">
        <div class="big-art" style="background:linear-gradient(135deg,#123a5e,#19e3a4);display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-clock-rotate-left" style="font-size:58px;color:#fff"></i></div>
        <div><p class="ph-eyebrow">History</p><h1>Recently Played</h1>
        <p class="ph-sub">${songs.length} tracks · newest first</p></div>
      </div>
      ${songs.length ? `<div class="track-table">${this.tableHead()}${songs.map((s, i) => this.trackRow(s, i, ids)).join("")}</div>` :
      `<div class="empty-state"><i class="fa-regular fa-clock"></i><h3>Nothing here yet</h3><p>Songs you play will show up in this list.</p></div>`}
    </section>`;
  },

  viewPlaylist(id) {
    const p = this.state.playlists.find(x => x.id === id);
    if (!p) return this.viewLibrary();
    const songs = p.songs.map(getSong).filter(Boolean);
    const total = songs.reduce((a, s) => a + s.duration, 0);
    const cover = songs[0]?.cover;
    return `
    <section class="reveal">
      <div class="page-head">
        ${cover ? `<img class="big-art" src="${cover}" alt="" />` :
        `<div class="big-art" style="background:linear-gradient(135deg,#1c2430,#10151d);display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-list-ul" style="font-size:56px;color:var(--text-3)"></i></div>`}
        <div>
          <p class="ph-eyebrow">Playlist</p>
          <h1>${esc(p.name)}</h1>
          ${p.desc ? `<p class="ph-desc">${esc(p.desc)}</p>` : ""}
          <p class="ph-sub"><b>Aarav</b> · ${songs.length} songs${songs.length ? ` · ${fmtTime(total)}` : ""}</p>
        </div>
      </div>
      ${songs.length ? `
      <div class="page-actions">
        <button class="play-btn xl" data-act="pl-play" data-pl="${p.id}" aria-label="Play all"><i class="fa-solid fa-play"></i></button>
        <button class="icon-btn lg" data-act="pl-shuffle" data-pl="${p.id}" title="Shuffle" aria-label="Shuffle"><i class="fa-solid fa-shuffle"></i></button>
        <button class="btn ghost" data-act="pl-add" data-pl="${p.id}" style="margin-left:6px"><i class="fa-solid fa-plus"></i> Add Songs</button>
      </div>
      <div class="track-table">${this.tableHead(true)}${songs.map((s, i) => this.trackRow(s, i, p.songs, { removable: true, playlistId: p.id })).join("")}</div>` :
      `<div class="empty-state"><i class="fa-solid fa-list-ul"></i><h3>This playlist is empty</h3>
       <p>Use “Add Songs” above, or the ⋯ menu on any track.</p>
       <button class="btn accent" data-act="pl-add" data-pl="${p.id}" style="margin-top:20px"><i class="fa-solid fa-plus"></i> Add Songs</button></div>`}
    </section>`;
  },

  viewArtist(name) {
    const a = getArtist(name);
    if (!a) return this.viewHome();
    const songs = songsOfArtist(name);
    const ids = songs.map(s => s.id);
    const albums = [...new Set(songs.map(s => s.album))];
    return `
    <section class="reveal">
      <div class="page-head">
        <img class="big-art round" src="${a.avatar}" alt="${esc(name)}" />
        <div>
          <p class="ph-eyebrow"><i class="fa-solid fa-circle-check" style="color:var(--accent-2)"></i> Verified Artist</p>
          <h1>${esc(name)}</h1>
          <p class="ph-sub">${esc(a.listeners)}</p>
          <p class="ph-desc">${esc(a.bio)}</p>
        </div>
      </div>
      <div class="page-actions">
        <button class="play-btn xl" data-act="play-ids" data-ids='${attr(ids)}' aria-label="Play all"><i class="fa-solid fa-play"></i></button>
        <button class="icon-btn lg" data-act="shuffle-ids" data-ids='${attr(ids)}' title="Shuffle" aria-label="Shuffle"><i class="fa-solid fa-shuffle"></i></button>
        <button class="btn ghost" data-act="artist-follow" data-artist="${esc(name)}"><i class="fa-regular fa-bell"></i> Follow</button>
      </div>
      ${this.row("Popular", "fa-fire", songs, ids)}
      <div class="section reveal">
        <div class="section-head"><h2><i class="fa-solid fa-compact-disc"></i>Albums</h2></div>
        <div class="row-scroll">
          ${albums.map(al => {
            const s0 = SONGS.find(s => s.album === al);
            return `<article class="card" data-album="${esc(al)}">
              <div class="card-art"><img src="${s0.cover}" alt="" loading="lazy" />
                <button class="play-btn card-play" data-act="album-play" data-album="${esc(al)}" aria-label="Play"><i class="fa-solid fa-play"></i></button></div>
              <p class="card-title">${esc(al)}</p><p class="card-sub">${s0.genre} · ${SONGS.filter(s => s.album === al).length} tracks</p>
            </article>`;
          }).join("")}
        </div>
      </div>
    </section>`;
  },

  viewAlbum(album) {
    const songs = SONGS.filter(s => s.album === album);
    if (!songs.length) return this.viewHome();
    const ids = songs.map(s => s.id);
    const total = songs.reduce((a, s) => a + s.duration, 0);
    return `
    <section class="reveal">
      <div class="page-head">
        <img class="big-art" src="${songs[0].cover}" alt="${esc(album)}" />
        <div>
          <p class="ph-eyebrow">Album</p>
          <h1>${esc(album)}</h1>
          <p class="ph-sub"><b data-act="artist" data-artist="${esc(songs[0].artist)}" style="cursor:pointer">${esc(songs[0].artist)}</b> · ${songs.length} songs · ${fmtTime(total)}</p>
        </div>
      </div>
      <div class="page-actions">
        <button class="play-btn xl" data-act="play-ids" data-ids='${attr(ids)}' aria-label="Play album"><i class="fa-solid fa-play"></i></button>
        <button class="icon-btn lg" data-act="shuffle-ids" data-ids='${attr(ids)}' title="Shuffle" aria-label="Shuffle"><i class="fa-solid fa-shuffle"></i></button>
      </div>
      <div class="track-table">${this.tableHead()}${songs.map((s, i) => this.trackRow(s, i, ids)).join("")}</div>
    </section>`;
  },

  /* ═══════════════════ SIDEBAR ═══════════════════ */
  renderSidebar(onlyLists = false) {
    el("likedCountSide").textContent = this.state.liked.size;
    const v = this.state.view;
    el("sidebarPlaylists").innerHTML = this.state.playlists.map(p => {
      const cover = getSong(p.songs[0])?.cover;
      const active = v.name === "playlist" && v.param === p.id;
      return `
      <button class="pl-link ${active ? "active" : ""}" data-playlist="${p.id}">
        ${cover ? `<img class="pl-thumb" src="${cover}" alt="" />` : `<span class="pl-thumb"><i class="fa-solid fa-music"></i></span>`}
        <span class="pl-meta"><span class="pl-name">${esc(p.name)}</span><span class="pl-sub">${p.songs.length} songs</span></span>
      </button>`;
    }).join("");
  },

  /* ═══════════════════ PLAYLISTS & LIKED ═══════════════════ */
  savePlaylists() { store.set("playlists", this.state.playlists); },
  saveLiked() { store.set("liked", [...this.state.liked]); },

  createPlaylist(name) {
    const id = "pl" + Date.now();
    this.state.playlists.unshift({ id, name: name || "My Playlist", desc: "A brand-new playlist", songs: [] });
    this.savePlaylists();
    this.toast(`Playlist “${name || "My Playlist"}” created`, "fa-wand-magic-sparkles");
    this.navigate({ name: "playlist", param: id });
  },

  addToPlaylist(plId, songId) {
    const p = this.state.playlists.find(x => x.id === plId);
    if (!p) return;
    if (p.songs.includes(songId)) { this.toast(`Already in “${p.name}”`, "fa-circle-info"); return; }
    p.songs.push(songId);
    this.savePlaylists();
    this.toast(`Added to “${p.name}”`, "fa-check");
    if (this.state.view.name === "playlist" && this.state.view.param === plId) this.render();
    this.renderSidebar(true);
  },

  removeFromPlaylist(plId, songId) {
    const p = this.state.playlists.find(x => x.id === plId);
    if (!p) return;
    p.songs = p.songs.filter(id => id !== songId);
    this.savePlaylists();
    this.toast("Removed from playlist", "fa-trash-can");
    if (this.state.view.name === "playlist" && this.state.view.param === plId) this.render();
    this.renderSidebar(true);
  },

  toggleLike(songId) {
    const liked = this.state.liked;
    let nowLiked;
    if (liked.has(songId)) { liked.delete(songId); nowLiked = false; } else { liked.add(songId); nowLiked = true; }
    this.saveLiked();
    this.toast(nowLiked ? "Added to Liked Songs" : "Removed from Liked Songs", nowLiked ? "fa-heart" : "fa-heart-crack");
    // update every like button for this song without full re-render
    document.querySelectorAll(`[data-act="like"][data-id="${songId}"]`).forEach(b => {
      b.classList.toggle("liked", nowLiked);
      const i = b.querySelector("i");
      i.className = `${nowLiked ? "fa-solid" : "fa-regular"} fa-heart`;
      if (nowLiked) { b.classList.add("pop"); setTimeout(() => b.classList.remove("pop"), 500); }
    });
    this.renderSidebar(true);
    if (["liked", "library"].includes(this.state.view.name)) this.render();
  },

  pushRecent(songId) {
    this.state.recent = [songId, ...this.state.recent.filter(id => id !== songId)].slice(0, 14);
    store.set("recent", this.state.recent);
  },

  /* ═══════════════════ NOW-PLAYING SYNC ═══════════════════ */
  syncNowPlaying() {
    const song = Player.currentSong();
    const playing = Player.state.playing;

    // player bar + fullscreen info
    if (song) {
      el("npCover").src = song.cover;
      el("npTitle").textContent = song.title;
      el("npArtist").textContent = `${song.artist} · ${song.album}`;
      el("fsCover").src = song.cover;
      el("fsTitle").textContent = song.title;
      el("fsArtist").textContent = song.artist;
      el("fsEyebrow").textContent = `NOW PLAYING · ${song.album.toUpperCase()}`;
      el("fsBg").style.backgroundImage = `url(${song.cover})`;
      el("btnLike").disabled = false;
      document.title = `${song.title} · ${song.artist} — Pulsar`;
      // like buttons state
      const liked = this.state.liked.has(song.id);
      [el("btnLike"), el("fsLike")].forEach(b => {
        b.classList.toggle("liked", liked);
        b.querySelector("i").className = `${liked ? "fa-solid" : "fa-regular"} fa-heart`;
      });
    }

    // play/pause icons everywhere
    const icon = playing ? "fa-pause" : "fa-play";
    el("btnPlay").innerHTML = `<i class="fa-solid ${icon}"></i>`;
    el("fsPlay").innerHTML = `<i class="fa-solid ${icon}"></i>`;
    if (this.dom.miniPlay) this.dom.miniPlay.innerHTML = `<i class="fa-solid ${icon}"></i>`;

    // shuffle / repeat indicators
    el("btnShuffle").classList.toggle("active", Player.state.shuffle);
    el("fsShuffle").classList.toggle("active", Player.state.shuffle);
    const repIcon = Player.state.repeat === "one" ? "fa-repeat" : "fa-repeat";
    [el("btnRepeat"), el("fsRepeat")].forEach(b => {
      b.classList.toggle("active", Player.state.repeat !== "off");
      b.innerHTML = `<i class="fa-solid ${repIcon}"></i>${Player.state.repeat === "one" ? '<span style="position:absolute;font-size:8px;font-weight:800;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none">1</span>' : ""}`;
    });

    // highlight active rows/cards + eq state
    document.querySelectorAll("[data-song]").forEach(node => {
      const isCur = song && node.dataset.song === song.id;
      node.classList.toggle("playing", isCur && node.classList.contains("card"));
      node.classList.toggle("active", isCur && node.classList.contains("tt-row"));
      node.classList.toggle("paused-active", isCur && !playing && node.classList.contains("tt-row"));
      const t = node.querySelector(".tt-title, .np-title, .card-title");
      if (t && node.classList.contains("tt-row")) t.style.color = isCur ? "var(--accent)" : "";
      // swap card play icon
      const cp = node.querySelector('[data-act="card-play"] i');
      if (cp && isCur) cp.className = `fa-solid ${icon}`;
      else if (cp) cp.className = "fa-solid fa-play";
      // eq bars present?
      const eq = node.querySelector(".eq");
      if (isCur && !eq && node.classList.contains("card")) {
        node.querySelector(".card-art").insertAdjacentHTML("beforeend", this.eqHTML());
      } else if (isCur && !eq && node.classList.contains("tt-row")) {
        node.querySelector(".tt-num").insertAdjacentHTML("beforeend", this.eqHTML());
        const n = node.querySelector(".tt-num .n"); if (n) n.style.display = "none";
      }
      if (!isCur && eq) {
        eq.remove();
        const n = node.querySelector(".tt-num .n"); if (n) n.style.display = "";
      }
      if (isCur && eq) eq.querySelectorAll("i").forEach(b => b.style.animationPlayState = playing ? "running" : "paused");
    });
    el("npTitle").classList.toggle("playing", !!playing);

    this.renderQueuePanel();
    this.renderLyrics();
  },

  /* Called by Player on every animation frame while playing */
  onTime(current, duration) {
    const frac = duration ? Math.min(current / duration, 1) : 0;
    [["seek", el("seek")], ["fsSeek", el("fsSeek")]].forEach(([, s]) => {
      if (!this.state.seekDragging) { s.value = Math.round(frac * 1000); }
      s.style.setProperty("--fill", (frac * 100).toFixed(2) + "%");
    });
    const t = fmtTime(current), d = fmtTime(duration);
    el("curTime").textContent = t; el("durTime").textContent = d;
    el("fsCur").textContent = t; el("fsDur").textContent = d;
    el("playerHairline").style.setProperty("--hair", (frac * 100).toFixed(2) + "%");
    this.syncLyric(current);
  },

  /* Called by Player when metadata reveals the true duration */
  onMeta(song, duration) {
    song.duration = Math.round(duration) || song.duration;
    document.querySelectorAll(`[data-dur-for="${song.id}"]`).forEach(n => n.textContent = fmtTime(song.duration));
  },

  onQueueChange() { this.renderQueuePanel(); },

  /* ═══════════════════ QUEUE PANEL ═══════════════════ */
  toggleQueue(force) {
    this.state.panels.queue = force ?? !this.state.panels.queue;
    if (this.state.panels.queue) this.state.panels.lyrics = false;
    this.applyPanels();
  },

  renderQueuePanel() {
    const { queue, qIndex } = Player.state;
    const cur = Player.currentSong();
    const upcoming = queue.slice(qIndex + 1).map(getSong).filter(Boolean);
    el("queueBody").innerHTML = !cur ? `<div class="empty-state" style="padding:40px 10px"><i class="fa-solid fa-bars-staggered"></i><h3>Queue is empty</h3><p>Play something and it will line up here.</p></div>` : `
      <p class="q-label">Now playing</p>
      <div class="q-item current"><img src="${cur.cover}" alt="" />
        <div class="q-text"><p class="q-title">${esc(cur.title)}</p><p class="q-artist">${esc(cur.artist)}</p></div>
        ${this.eqHTML()}
      </div>
      <p class="q-label" style="margin-top:14px">Next up · ${upcoming.length}</p>
      ${upcoming.map((s, i) => `
      <div class="q-item" data-act="q-jump" data-index="${qIndex + 1 + i}">
        <img src="${s.cover}" alt="" />
        <div class="q-text"><p class="q-title">${esc(s.title)}</p><p class="q-artist">${esc(s.artist)}</p></div>
        <button class="icon-btn sm" data-act="q-remove" data-index="${qIndex + 1 + i}" aria-label="Remove from queue"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("") || `<p style="color:var(--text-3);font-size:13px;padding:8px">Nothing queued — add tracks with the ⋯ menu.</p>`}
    `;
  },

  /* ═══════════════════ LYRICS PANEL ═══════════════════ */
  toggleLyrics(force) {
    this.state.panels.lyrics = force ?? !this.state.panels.lyrics;
    if (this.state.panels.lyrics) this.state.panels.queue = false;
    this.applyPanels();
  },

  renderLyrics() {
    const song = Player.currentSong();
    if (!song) { el("lyricsBody").innerHTML = `<div class="empty-state" style="padding:40px 10px"><i class="fa-solid fa-microphone-lines"></i><h3>No lyrics yet</h3><p>Start a song to see time-synced lyrics.</p></div>`; return; }
    this.state.lyrics = lyricsFor(song);
    this.state.activeLyric = -1;
    el("lyricsBody").innerHTML =
      `<p class="lyrics-head">${esc(song.title)} — ${esc(song.artist)}</p>` +
      this.state.lyrics.map((l, i) => `<p class="lyric-line" data-act="lyric" data-i="${i}">${esc(l.text)}</p>`).join("");
  },

  syncLyric(current) {
    if (!this.state.panels.lyrics || !this.state.lyrics.length) return;
    let idx = -1;
    this.state.lyrics.forEach((l, i) => { if (current >= l.time) idx = i; });
    if (idx === this.state.activeLyric) return;
    this.state.activeLyric = idx;
    const lines = el("lyricsBody").querySelectorAll(".lyric-line");
    lines.forEach((n, i) => {
      n.classList.toggle("current", i === idx);
      n.classList.toggle("past", i < idx);
    });
    if (lines[idx]) lines[idx].scrollIntoView({ block: "center", behavior: "smooth" });
  },

  applyPanels() {
    el("queuePanel").classList.toggle("open", this.state.panels.queue);
    el("lyricsPanel").classList.toggle("open", this.state.panels.lyrics);
    el("queuePanel").setAttribute("aria-hidden", !this.state.panels.queue);
    el("lyricsPanel").setAttribute("aria-hidden", !this.state.panels.lyrics);
    el("btnQueue").classList.toggle("active", this.state.panels.queue);
    el("btnLyrics").classList.toggle("active", this.state.panels.lyrics);
    if (this.state.panels.queue) this.renderQueuePanel();
    if (this.state.panels.lyrics) this.renderLyrics();
  },

  /* ═══════════════════ FULLSCREEN PLAYER ═══════════════════ */
  toggleFullscreen(force) {
    this.state.panels.fullscreen = force ?? !this.state.panels.fullscreen;
    el("fullscreen").classList.toggle("open", this.state.panels.fullscreen);
    el("fullscreen").setAttribute("aria-hidden", !this.state.panels.fullscreen);
    document.body.style.overflow = this.state.panels.fullscreen ? "hidden" : "";
    if (this.state.panels.fullscreen) this.syncNowPlaying();
  },

  /* ═══════════════════ CONTEXT MENU ═══════════════════ */
  openCtx(x, y, songId, extra = {}) {
    const song = getSong(songId);
    if (!song) return;
    const liked = this.state.liked.has(songId);
    this.state.ctx = { songId, extra };
    this.renderCtxMain(song, liked);
    const menu = this.dom.ctxMenu;
    menu.classList.add("open");
    menu.setAttribute("aria-hidden", "false");
    // position (clamped inside viewport)
    const r = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 12);
    const py = Math.min(y, window.innerHeight - r.height - 12);
    menu.style.left = Math.max(8, px) + "px";
    menu.style.top = Math.max(8, py) + "px";
  },

  renderCtxMain(song, liked) {
    const inPlaylistView = this.state.view.name === "playlist";
    this.dom.ctxMenu.innerHTML = `
      <button class="ctx-item" data-ctx="play-next"><i class="fa-solid fa-play"></i> Play next</button>
      <button class="ctx-item" data-ctx="queue"><i class="fa-solid fa-list-ol"></i> Add to queue</button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" data-ctx="artist"><i class="fa-solid fa-user"></i> Go to ${esc(song.artist)}</button>
      <button class="ctx-item" data-ctx="album"><i class="fa-solid fa-compact-disc"></i> Go to ${esc(song.album)}</button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" data-ctx="like"><i class="${liked ? "fa-solid" : "fa-regular"} fa-heart" ${liked ? 'style="color:var(--accent)"' : ""}></i> ${liked ? "Remove from Liked" : "Save to Liked Songs"}</button>
      <button class="ctx-item" data-ctx="addpl"><i class="fa-solid fa-plus"></i> Add to playlist <i class="fa-solid fa-chevron-right ctx-caret"></i></button>
      ${inPlaylistView ? `<div class="ctx-sep"></div>
      <button class="ctx-item danger" data-ctx="remove"><i class="fa-solid fa-trash-can"></i> Remove from ${esc(this.state.playlists.find(p => p.id === this.state.view.param)?.name || "playlist")}</button>` : ""}
    `;
  },

  renderCtxPlaylists() {
    this.dom.ctxMenu.innerHTML = `
      <button class="ctx-item" data-ctx="back"><i class="fa-solid fa-chevron-left"></i> Back</button>
      <div class="ctx-sep"></div>
      <p class="ctx-label">Add “${esc(getSong(this.state.ctx.songId).title)}” to…</p>
      ${this.state.playlists.map(p => `
        <button class="ctx-item" data-ctx="to-pl" data-pl="${p.id}"><i class="fa-solid fa-list-ul" style="color:var(--accent)"></i> ${esc(p.name)}</button>`).join("")}
      <div class="ctx-sep"></div>
      <button class="ctx-item" data-ctx="new-pl"><i class="fa-solid fa-wand-magic-sparkles"></i> New playlist…</button>
    `;
    // reposition if it grew past the viewport
    const r = this.dom.ctxMenu.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) this.dom.ctxMenu.style.top = Math.max(8, window.innerHeight - r.height - 8) + "px";
    if (r.right > window.innerWidth - 8) this.dom.ctxMenu.style.left = Math.max(8, window.innerWidth - r.width - 8) + "px";
  },

  closeCtx() { this.dom.ctxMenu.classList.remove("open"); this.dom.ctxMenu.setAttribute("aria-hidden", "true"); },

  handleCtx(action, target) {
    const songId = this.state.ctx?.songId;
    if (!songId) return;
    switch (action) {
      case "play-next": Player.playNext(songId); this.toast("Playing next", "fa-play"); break;
      case "queue": Player.addToQueue(songId); this.toast("Added to queue", "fa-list-ol"); break;
      case "artist": this.navigate({ name: "artist", param: getSong(songId).artist }); break;
      case "album": this.navigate({ name: "album", param: getSong(songId).album }); break;
      case "like": this.toggleLike(songId); break;
      case "addpl": this.renderCtxPlaylists(); return; // keep menu open
      case "to-pl": this.addToPlaylist(target.dataset.pl, songId); break;
      case "new-pl": this.openModal(() => {
        const name = this.dom.modalInput.value.trim() || "My Playlist";
        this.createPlaylist(name);
        this.addToPlaylist(this.state.playlists[0].id, songId);
      }); this.closeCtx(); return;
      case "back": this.renderCtxMain(getSong(songId), this.state.liked.has(songId)); return;
      case "remove": this.removeFromPlaylist(this.state.view.param, songId); break;
    }
    this.closeCtx();
  },

  /* Actions from the playlist (⋯) menu on library cards */
  handlePlCtx(action, target) {
    const plId = target.dataset.pl;
    const p = this.state.playlists.find(x => x.id === plId);
    this.closeCtx();
    if (!p) return;
    if (action === "pl-play") {
      if (p.songs.length) Player.playList(p.songs, 0);
      else this.toast("This playlist is empty", "fa-circle-info");
    } else if (action === "pl-shuffle") {
      if (p.songs.length) { Player.enableShuffle(); Player.playList(p.songs, 0, { shuffleAll: true }); }
      else this.toast("This playlist is empty", "fa-circle-info");
    } else if (action === "pl-delete") {
      this.state.playlists = this.state.playlists.filter(x => x.id !== plId);
      this.savePlaylists();
      this.toast(`Deleted “${p.name}”`, "fa-trash-can");
      if (this.state.view.name === "playlist" && this.state.view.param === plId) this.navigate({ name: "library" });
      this.renderSidebar(true);
    }
  },

  /* Playlist (⋯) menu on library cards */
  openPlMenu(x, y, plId) {
    const p = this.state.playlists.find(v => v.id === plId);
    if (!p) return;
    this.dom.ctxMenu.innerHTML = `
      <button class="ctx-item" data-ctx="pl-play" data-pl="${plId}"><i class="fa-solid fa-play"></i> Play</button>
      <button class="ctx-item" data-ctx="pl-shuffle" data-pl="${plId}"><i class="fa-solid fa-shuffle"></i> Shuffle</button>
      <div class="ctx-sep"></div>
      <button class="ctx-item danger" data-ctx="pl-delete" data-pl="${plId}"><i class="fa-solid fa-trash-can"></i> Delete playlist</button>`;
    this.dom.ctxMenu.classList.add("open");
    const r = this.dom.ctxMenu.getBoundingClientRect();
    this.dom.ctxMenu.style.left = Math.min(x, window.innerWidth - r.width - 12) + "px";
    this.dom.ctxMenu.style.top = Math.min(y, window.innerHeight - r.height - 12) + "px";
  },

  /* ═══════════════════ SONG PICKER MODAL (add songs to playlist) ═══════════════════ */
  openSongPicker(plId) {
    const p = this.state.playlists.find(v => v.id === plId);
    if (!p) return;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" style="width:min(480px, calc(100vw - 40px))">
        <h3><i class="fa-solid fa-plus"></i> Add to “${esc(p.name)}”</h3>
        <p class="modal-sub">Tap a song to add it. Songs already in the playlist are dimmed.</p>
        <div style="max-height:46vh;overflow-y:auto;margin-top:16px;display:flex;flex-direction:column;gap:4px">
          ${SONGS.map(s => {
            const has = p.songs.includes(s.id);
            return `<button class="q-item" data-pick="${s.id}" style="${has ? "opacity:.4;pointer-events:none" : ""}">
              <img src="${s.cover}" alt="" /><div class="q-text"><p class="q-title">${esc(s.title)}</p><p class="q-artist">${esc(s.artist)}</p></div>
              ${has ? '<i class="fa-solid fa-check" style="color:var(--accent)"></i>' : '<i class="fa-solid fa-plus" style="color:var(--text-3)"></i>'}
            </button>`;
          }).join("")}
        </div>
        <div class="modal-actions"><button class="btn ghost" data-close>Done</button></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => {
      const pick = e.target.closest("[data-pick]");
      if (pick) {
        this.addToPlaylist(plId, pick.dataset.pick);
        pick.style.opacity = ".4"; pick.style.pointerEvents = "none";
        pick.querySelector(".fa-plus").className = "fa-solid fa-check";
        return;
      }
      if (e.target.closest("[data-close]") || e.target === overlay) overlay.remove();
    });
  },

  /* ═══════════════════ CREATE-PLAYLIST MODAL ═══════════════════ */
  openModal(onConfirm) {
    this.dom.modal.hidden = false;
    this.dom.modalInput.value = "";
    this._modalConfirm = onConfirm;
    setTimeout(() => this.dom.modalInput.focus(), 60);
  },
  closeModal() { this.dom.modal.hidden = true; },

  /* ═══════════════════ TOAST ═══════════════════ */
  toast(msg, icon = "fa-circle-check") {
    const t = this.dom.toast;
    t.innerHTML = `<i class="fa-solid ${icon}"></i> ${esc(msg)}`;
    t.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove("show"), 2400);
  },

  /* ═══════════════════ GLOBAL EVENT WIRING ═══════════════════ */
  bindGlobalEvents() {
    const dom = this.dom;

    /* ---- delegated clicks across the whole document ---- */
    document.addEventListener("click", e => {
      const t = e.target;
      const act = t.closest("[data-act]");

      /* context menu clicks */
      const ctxItem = t.closest("[data-ctx]");
      if (ctxItem) {
        const action = ctxItem.dataset.ctx;
        if (action.startsWith("pl-")) this.handlePlCtx(action, ctxItem);
        else this.handleCtx(action, ctxItem);
        return;
      }
      if (!t.closest("#ctxMenu")) this.closeCtx();

      /* mini transport (mobile) */
      const mini = t.closest("[data-mini]");
      if (mini) {
        if (mini.dataset.mini === "play") Player.toggle();
        if (mini.dataset.mini === "next") Player.next();
        if (mini.dataset.mini === "prev") Player.prev();
        return;
      }

      if (act) {
        const a = act.dataset.act;
        const id = act.dataset.id;
        switch (a) {
          case "card-play": case "hero-play": {
            const host = act.closest("[data-song]") || act.closest("[data-queue]");
            const queue = host?.dataset.queue ? JSON.parse(host.dataset.queue) : [id || act.dataset.id];
            const songId = id || host?.dataset.song;
            const cur = Player.currentSong();
            if (cur && cur.id === songId) Player.toggle();
            else Player.playList(queue, Math.max(0, queue.indexOf(songId)));
            return;
          }
          case "play-ids": case "pl-play": {
            let ids = act.dataset.ids ? JSON.parse(act.dataset.ids) : null;
            if (!ids) {
              const p = this.state.playlists.find(x => x.id === act.dataset.pl);
              ids = p ? [...p.songs] : [];
            }
            if (ids.length) Player.playList(ids, 0); else this.toast("Nothing to play yet", "fa-circle-info");
            return;
          }
          case "shuffle-ids": case "pl-shuffle": {
            let ids = act.dataset.ids ? JSON.parse(act.dataset.ids) : null;
            if (!ids) { const p = this.state.playlists.find(x => x.id === act.dataset.pl); ids = p ? [...p.songs] : []; }
            if (ids.length) { Player.enableShuffle(); Player.playList(ids, 0, { shuffleAll: true }); }
            return;
          }
          case "play-liked": {
            const ids = [...this.state.liked];
            if (ids.length) Player.playList(ids, 0); else this.toast("Like some songs first 💚", "fa-heart");
            return;
          }
          case "menu": {
            e.stopPropagation();
            const r = act.getBoundingClientRect();
            this.openCtx(r.right - 200, r.bottom + 8, id, {});
            return;
          }
          case "pl-menu": { e.stopPropagation(); const r = act.getBoundingClientRect(); this.openPlMenu(r.left - 140, r.bottom + 8, act.dataset.pl); return; }
          case "like": { this.toggleLike(id); return; }
          case "artist": { this.navigate({ name: "artist", param: act.dataset.artist }); return; }
          case "album": { this.navigate({ name: "album", param: act.dataset.album }); return; }
          case "album-play": {
            const ids = SONGS.filter(s => s.album === act.dataset.album).map(s => s.id);
            Player.playList(ids, 0); return;
          }
          case "artist-play": {
            const ids = songsOfArtist(act.dataset.artist).map(s => s.id);
            Player.playList(ids, 0); return;
          }
          case "artist-follow": { this.toast(`Following ${act.dataset.artist} 🎶`, "fa-bell"); return; }
          case "pl-add": { this.openSongPicker(act.dataset.pl); return; }
          case "remove": { this.removeFromPlaylist(act.dataset.pl, act.dataset.id); return; }
          case "q-jump": { Player.playIndex(+act.dataset.index); return; }
          case "q-remove": { e.stopPropagation(); Player.removeFromQueue(+act.dataset.index); return; }
          case "lyric": {
            const l = this.state.lyrics[+act.dataset.i];
            if (l) Player.seekSeconds(l.time);
            return;
          }
        }
      }

      /* clicking a whole card / row plays it */
      const card = t.closest("[data-song]");
      if (card && !t.closest("button")) {
        const queue = card.dataset.queue ? JSON.parse(card.dataset.queue) : [card.dataset.song];
        const songId = card.dataset.song;
        const cur = Player.currentSong();
        if (cur && cur.id === songId) Player.toggle();
        else Player.playList(queue, Math.max(0, queue.indexOf(songId)));
        return;
      }
      const artistCard = t.closest("[data-artist]:not([data-act])");
      if (artistCard && !t.closest("button")) { this.navigate({ name: "artist", param: artistCard.dataset.artist }); return; }
      const albumCard = t.closest("[data-album]:not([data-act])");
      if (albumCard && !t.closest("button")) { this.navigate({ name: "album", param: albumCard.dataset.album }); return; }
      const plCard = t.closest("[data-playlist]");
      if (plCard && !t.closest("button[data-act]")) { this.navigate({ name: "playlist", param: plCard.dataset.playlist }); return; }
      const quick = t.closest("[data-quick]");
      if (quick) { this.navigate(JSON.parse(quick.dataset.quick)); return; }
      const genre = t.closest("[data-genre]");
      if (genre) { this.dom.searchInput.value = genre.dataset.genre; this.state.searchQuery = genre.dataset.genre; this.navigate({ name: "search" }); return; }
      const sChip = t.closest("[data-search]");
      if (sChip) { this.dom.searchInput.value = sChip.dataset.search; this.state.searchQuery = sChip.dataset.search; this.navigate({ name: "search" }); return; }

      /* sidebar / mobile nav links */
      const nav = t.closest("[data-nav]");
      if (nav) {
        e.preventDefault();
        this.navigate({ name: nav.dataset.nav });
        document.body.classList.remove("sidebar-open", "search-open");
        dom.backdrop.hidden = true;
        return;
      }
    });

    /* ---- topbar buttons ---- */
    el("btnBack").addEventListener("click", () => this.goBack());
    el("btnFwd").addEventListener("click", () => this.goFwd());
    el("btnMenu").addEventListener("click", () => {
      document.body.classList.add("sidebar-open");
      dom.backdrop.hidden = false;
    });
    dom.backdrop.addEventListener("click", () => {
      document.body.classList.remove("sidebar-open");
      dom.backdrop.hidden = true;
    });
    el("btnSearchMobile").addEventListener("click", () => {
      document.body.classList.add("search-open");
      this.navigate({ name: "search" });
      dom.searchInput.focus();
    });
    el("btnNotif").addEventListener("click", () => this.toast("No new notifications — just good music.", "fa-bell"));
    el("btnSettings").addEventListener("click", () => this.toast("Settings coming soon. Space = play/pause, N/P = skip.", "fa-gear"));
    el("btnProfile").addEventListener("click", () => this.toast("Signed in as Aarav · Free demo account", "fa-user"));

    /* ---- search ---- */
    let deb;
    dom.searchInput.addEventListener("input", () => {
      clearTimeout(deb);
      const q = dom.searchInput.value;
      dom.searchClear.hidden = !q;
      deb = setTimeout(() => {
        this.state.searchQuery = q;
        const wasSearch = this.state.view.name === "search";
        this.navigate({ name: "search" }, { history: !wasSearch });
      }, 180);
    });
    dom.searchInput.addEventListener("keydown", e => { if (e.key === "Escape") { dom.searchInput.value = ""; dom.searchInput.blur(); document.body.classList.remove("search-open"); this.state.searchQuery = ""; dom.searchClear.hidden = true; if (this.state.view.name === "search") this.navigate({ name: "home" }); } });
    dom.searchClear.addEventListener("click", () => {
      dom.searchInput.value = ""; this.state.searchQuery = ""; dom.searchClear.hidden = true;
      if (this.state.view.name === "search") this.navigate({ name: "home" });
    });

    /* ---- player bar controls ---- */
    el("btnPlay").addEventListener("click", () => Player.toggle());
    el("fsPlay").addEventListener("click", () => Player.toggle());
    el("btnNext").addEventListener("click", () => Player.next());
    el("fsNext").addEventListener("click", () => Player.next());
    el("btnPrev").addEventListener("click", () => Player.prev());
    el("fsPrev").addEventListener("click", () => Player.prev());
    el("btnShuffle").addEventListener("click", () => Player.cycleShuffle());
    el("fsShuffle").addEventListener("click", () => Player.cycleShuffle());
    el("btnRepeat").addEventListener("click", () => Player.cycleRepeat());
    el("fsRepeat").addEventListener("click", () => Player.cycleRepeat());
    el("btnLike").addEventListener("click", () => { const s = Player.currentSong(); if (s) this.toggleLike(s.id); });
    el("fsLike").addEventListener("click", () => { const s = Player.currentSong(); if (s) this.toggleLike(s.id); });
    el("btnQueue").addEventListener("click", () => this.toggleQueue());
    el("fsQueue").addEventListener("click", () => this.toggleQueue());
    el("queueClose").addEventListener("click", () => this.toggleQueue(false));
    el("btnLyrics").addEventListener("click", () => this.toggleLyrics());
    el("fsLyrics").addEventListener("click", () => this.toggleLyrics());
    el("lyricsClose").addEventListener("click", () => this.toggleLyrics(false));
    el("btnExpand").addEventListener("click", () => this.toggleFullscreen(true));
    el("btnExpandMini").addEventListener("click", () => this.toggleFullscreen(true));
    el("fsClose").addEventListener("click", () => this.toggleFullscreen(false));

    /* seek + volume sliders (both bars) */
    const bindSeek = slider => {
      const start = () => this.state.seekDragging = true;
      const end = () => { this.state.seekDragging = false; Player.seekFrac(slider.value / 1000); };
      slider.addEventListener("pointerdown", start);
      slider.addEventListener("pointerup", end);
      slider.addEventListener("keydown", () => start());
      slider.addEventListener("keyup", end);
      slider.addEventListener("input", () => {
        slider.style.setProperty("--fill", (slider.value / 10) + "%");
        el("curTime").textContent = fmtTime(slider.value / 1000 * (Player.currentDuration() || 0));
      });
      slider.addEventListener("change", end);
    };
    bindSeek(el("seek")); bindSeek(el("fsSeek"));

    const bindVol = slider => slider.addEventListener("input", () => {
      Player.setVolume(slider.value / 100);
      [el("volSlider"), el("fsVol")].forEach(s => { s.value = slider.value; s.style.setProperty("--fill", slider.value + "%"); });
    });
    bindVol(el("volSlider")); bindVol(el("fsVol"));
    el("btnMute").addEventListener("click", () => Player.toggleMute());
    el("fsMute").addEventListener("click", () => Player.toggleMute());

    /* ---- create playlist ---- */
    el("btnCreatePlaylist").addEventListener("click", () => this.openModal(name => this.createPlaylist(name)));
    el("btnCreatePlaylistBig").addEventListener("click", () => this.openModal(name => this.createPlaylist(name)));
    el("modalCancel").addEventListener("click", () => this.closeModal());
    el("modalOverlay").addEventListener("click", e => { if (e.target === e.currentTarget) this.closeModal(); });
    el("modalConfirm").addEventListener("click", () => {
      const cb = this._modalConfirm; this.closeModal();
      if (cb) cb(this.dom.modalInput.value.trim());
    });
    dom.modalInput.addEventListener("keydown", e => { if (e.key === "Enter") el("modalConfirm").click(); });

    /* ---- topbar shadow on scroll ---- */
    dom.view.addEventListener("scroll", () => dom.topbar.classList.toggle("scrolled", dom.view.scrollTop > 12), { passive: true });

    /* ---- keyboard shortcuts ---- */
    document.addEventListener("keydown", e => {
      const typing = ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if (e.key === "Escape") {
        if (this.dom.ctxMenu.classList.contains("open")) return this.closeCtx();
        if (!dom.modal.hidden) return this.closeModal();
        if (this.state.panels.fullscreen) return this.toggleFullscreen(false);
        if (this.state.panels.queue || this.state.panels.lyrics) return this.applyPanels.call(this, this.state.panels.queue = this.state.panels.lyrics = false);
        if (document.body.classList.contains("sidebar-open")) { document.body.classList.remove("sidebar-open"); dom.backdrop.hidden = true; }
        return;
      }
      if (typing) return;
      const tag = e.target.tagName;
      switch (e.key) {
        case " ":
          if (tag === "BUTTON" || tag === "A") return; // let the button handle it
          e.preventDefault(); Player.toggle(); break;
        case "ArrowRight": e.shiftKey ? Player.next() : Player.skip(5); e.preventDefault(); break;
        case "ArrowLeft": e.shiftKey ? Player.prev() : Player.skip(-5); e.preventDefault(); break;
        case "ArrowUp": e.preventDefault(); Player.nudgeVolume(0.05); break;
        case "ArrowDown": e.preventDefault(); Player.nudgeVolume(-0.05); break;
        case "n": case "N": Player.next(); break;
        case "p": case "P": Player.prev(); break;
        case "m": case "M": Player.toggleMute(); break;
        case "s": case "S": Player.cycleShuffle(); break;
        case "r": case "R": Player.cycleRepeat(); break;
        case "q": case "Q": this.toggleQueue(); break;
        case "l": case "L": this.toggleLyrics(); break;
        case "f": case "F": this.toggleFullscreen(); break;
        case "/": e.preventDefault(); this.navigate({ name: "search" }); dom.searchInput.focus(); break;
      }
    });

    /* close panels when clicking outside on desktop */
    document.addEventListener("pointerdown", e => {
      ["queuePanel", "lyricsPanel"].forEach(pid => {
        const p = el(pid);
        if (p.classList.contains("open") && !p.contains(e.target) && !e.target.closest(`#btn${pid === "queuePanel" ? "Queue" : "Lyrics"}`) && !e.target.closest("#fsQueue,#fsLyrics")) {
          this.state.panels[pid === "queuePanel" ? "queue" : "lyrics"] = false;
          this.applyPanels();
        }
      });
    });

    window.addEventListener("resize", () => this.closeCtx());
  },
};
