/* Weerdashboard-radar v0.2.1 - KNMI radar (waarneming) en KNMI nowcast (verwachting) */
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const BASEMAPS = {
  osm: { label: 'Wereld (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', minZoom: 4,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers' },
  pdok_grijs: { label: 'Nederland, grijs (PDOK)', url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png', minZoom: 6,
    attr: 'Kaartgegevens &copy; <a href="https://www.pdok.nl/">Kadaster/PDOK</a>' },
  pdok_standaard: { label: 'Nederland, kleur (PDOK)', url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', minZoom: 6,
    attr: 'Kaartgegevens &copy; <a href="https://www.pdok.nl/">Kadaster/PDOK</a>' },
};
const DEFAULT_BASE = 'osm';
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* negeren */ } };
const loadLeaflet = () => window.__wdLeaflet || (window.__wdLeaflet = new Promise((resolve, reject) => {
  if (window.L && window.L.map) return resolve(window.L);
  let tag = document.querySelector(`script[src="${LEAFLET_JS}"]`);
  if (!tag) { tag = document.createElement('script'); tag.src = LEAFLET_JS; document.head.appendChild(tag); }
  const fail = () => { window.__wdLeaflet = null; reject(new Error('De kaartbibliotheek (Leaflet) kon niet worden geladen. Controleer de internetverbinding van deze browser.')); };
  tag.addEventListener('error', fail);
  let n = 0; const iv = setInterval(() => { if (window.L && window.L.map) { clearInterval(iv); resolve(window.L); } else if (++n > 300) { clearInterval(iv); fail(); } }, 50);
}));

/* ---- pure helpers (ook gebruikt door de tests) ---- */
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usable = f => f && f.state !== 'missing';
function stepIndex(frames, i, dir) {          // volgende bruikbare frame, zonder te lopen
  for (let k = i + dir; k >= 0 && k < frames.length; k += dir) if (usable(frames[k])) return k;
  return i;
}
function firstUsable(frames) { const k = frames.findIndex(usable); return k < 0 ? 0 : k; }
function nowIndex(frames) {                    // laatste waarneming = "nu"
  let k = -1; frames.forEach((f, i) => { if (f.kind === 'observed') k = i; });
  return k < 0 ? 0 : k;
}
function frameLabel(f, nowT, fmt) {
  if (!f) return '';
  if (f.kind === 'observed') return `Waarneming ${fmt(f.t)}`;
  return `Verwachting ${fmt(f.t)} (+${Math.round((f.t - nowT) / 60)} min)`;
}

const CSS = `
:host{display:block;max-width:100%;overflow:hidden}.wrap{display:grid;gap:8px;color:var(--wd-text, var(--primary-text-color));min-width:0}.wrap>*{min-width:0}.src{font-size:.7em;color:var(--wd-muted, var(--secondary-text-color));line-height:1.35}.src summary{cursor:pointer}
#map{width:100%;height:min(56vh,480px);min-height:260px;border-radius:10px;overflow:hidden;background:var(--wd-tile, rgba(0,0,0,.14));position:relative;z-index:0}
.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--wd-muted, var(--secondary-text-color));font-size:.85em}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-weight:600;font-size:.85em;color:#fff;background:#888}
.b-obs{background:#2e9e44}.b-fc{background:#d9730d}.b-none{background:#888}
.ctl{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
button,select{font:inherit;color:var(--wd-text, var(--primary-text-color));background:var(--wd-tile, rgba(0,0,0,.14));border:1px solid var(--wd-line, var(--divider-color));border-radius:8px;padding:6px 10px;cursor:pointer}
input[type=range]{flex:1;min-width:140px}
.track{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:1px}.track div{flex:1;background:#999}
.track .o{background:#2e9e44}.track .f{background:#d9730d}.track .m{background:repeating-linear-gradient(45deg,#999,#999 3px,#ccc 3px,#ccc 6px)}.track .l{opacity:.35}.track .c{outline:2px solid var(--wd-text, var(--primary-text-color));outline-offset:-2px}
.tl{display:flex;justify-content:space-between;font-size:.75em;color:var(--wd-muted, var(--secondary-text-color))}
.warn{background:#f0a50022;border:1px solid #f0a500;border-radius:8px;padding:6px 10px;font-size:.9em}
.leg{display:flex;gap:16px;flex-wrap:wrap}.leg img{max-width:150px;height:auto;background:#fff;border-radius:6px}
.miss{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:500;background:var(--wd-card, var(--card-background-color));padding:8px 14px;border-radius:8px;border:1px solid var(--wd-line, var(--divider-color));pointer-events:none}
#map.dark .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)}
[hidden]{display:none!important}
@media(max-width:560px){button,select{padding:4px 8px;font-size:.85em}input[type=range]{min-width:80px}.ctl{gap:4px}.top{gap:6px}}
`;

class WeerdashboardRadar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    Object.assign(this, { frames: [], idx: 0, playing: false, speed: 1, map: null, ov: [null, null], active: 0, marker: null,
      loc: null, tz: 'Europe/Amsterdam', data: null, timer: null, refresh: null, token: 0, legendLoaded: false, ready: false });
    this.shadowRoot.innerHTML = `<style>${CSS}</style><link rel="stylesheet" href="${LEAFLET_CSS}">
      <div class="wrap">
        <div class="top"><span class="badge b-none" id="kind">Radar</span><b id="time">Laden…</b><span class="muted" id="age"></span></div>
        <div id="map"><div class="miss" id="miss" hidden></div></div>
        <div class="ctl"><button id="prev" title="Vorig tijdstip" aria-label="Vorig tijdstip">⏮</button><button id="play" title="Afspelen" aria-label="Afspelen">▶</button><button id="next" title="Volgend tijdstip" aria-label="Volgend tijdstip">⏭</button>
          <input type="range" id="sl" min="0" max="0" value="0" aria-label="Tijdstip"><select id="spd" aria-label="Afspeelsnelheid"><option value="0.5">0,5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
          <select id="base" aria-label="Achtergrondkaart">${Object.entries(BASEMAPS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select><button id="here">◎ Mijn locatie</button><button id="legb">Legenda</button></div>
        <div class="track" id="track" aria-hidden="true"></div>
        <div class="tl"><span id="t0"></span><span id="tn">nu</span><span id="t1"></span></div>
        <div class="leg" id="leg" hidden></div>
        <div id="msg"></div>
        <div class="src" id="src"></div></div>`;
    const $ = id => this.shadowRoot.getElementById(id); this.$ = $;
    $('play').onclick = () => (this.playing ? this.pause() : this.play());
    $('prev').onclick = () => { this.pause(); this.show(stepIndex(this.frames, this.idx, -1)); };
    $('next').onclick = () => { this.pause(); this.show(stepIndex(this.frames, this.idx, 1)); };
    $('sl').oninput = e => { this.pause(); this.show(+e.target.value); };
    $('spd').onchange = e => { this.speed = +e.target.value; };
    this.baseKey = BASEMAPS[lsGet('wd_base', '')] ? lsGet('wd_base', '') : DEFAULT_BASE;
    $('base').value = this.baseKey;
    $('base').onchange = e => { this.baseKey = e.target.value; lsSet('wd_base', this.baseKey); this.setBase(this.baseKey); };
    $('here').onclick = () => { if (this.map && this.loc) this.map.setView([this.loc.lat, this.loc.lon], 9); };
    $('legb').onclick = () => this.toggleLegend();
  }
  set hass(h) { this._hass = h; this._dark = !!(h && h.themes && h.themes.darkMode); const m = this.$ && this.$('map'); if (m && m.classList) m.classList.toggle('dark', this._dark); if (!this._started) { this._started = true; this._start(); } }
  setLocation(loc, tz) {
    this.loc = loc; if (tz) this.tz = tz;
    if (this.map && loc) this.placeMarker();
    if (this.frames.length) this.updateLabels();
  }
  refreshSize() { if (this.map) setTimeout(() => this.map.invalidateSize(), 30); }
  connectedCallback() {
    if (this.map) setTimeout(() => this.map.invalidateSize(), 50);
    if (this._resume) { this._resume = false; this.play(); }
    if (this._started && !this.refresh) this.refresh = setInterval(() => document.visibilityState === 'visible' && this.loadFrames(true), 300000);
  }
  disconnectedCallback() {
    clearInterval(this.refresh); this.refresh = null;
    if (this.playing) { this._resume = true; this.pause(); }
  }

  async _start() {
    try { this.L = await loadLeaflet(); } catch (e) { this.$('msg').innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
    const L = this.L;
    this.map = L.map(this.$('map'), { minZoom: 4, maxZoom: 12, zoomSnap: 0.5 }).setView([52.2, 5.3], 7);
    this.setBase(this.baseKey);
    this.ready = true;
    if (this.loc) this.placeMarker();
    this.refresh = setInterval(() => document.visibilityState === 'visible' && this.loadFrames(true), 300000);
    await this.loadFrames();
    setTimeout(() => this.map.invalidateSize(), 100);
  }
  setBase(key) {
    if (!this.map) return;
    const b = BASEMAPS[key] || BASEMAPS[DEFAULT_BASE];
    this.map.setMinZoom(b.minZoom);
    if (this.base) this.base.remove();
    // referrerPolicy: Home Assistant onderdrukt de Referer standaard, maar OpenStreetMap eist die
    this.base = this.L.tileLayer(b.url, { attribution: b.attr, maxZoom: 19, minZoom: b.minZoom, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(this.map);
    if (this.base.bringToBack) this.base.bringToBack();
    const m = this.$('map'); if (m && m.classList) m.classList.toggle('dark', !!this._dark);
  }
  placeMarker() {
    const L = this.L, p = [this.loc.lat, this.loc.lon];
    if (this.marker) this.marker.remove();
    this.marker = L.circleMarker(p, { radius: 7, color: '#fff', weight: 2, fillColor: '#e11d48', fillOpacity: 1 })
      .bindTooltip(Object.assign(document.createElement('span'), { textContent: this.loc.name || 'Locatie' }), { permanent: true, direction: 'top', offset: [0, -6] }).addTo(this.map);
  }
  fmt(t) { return new Intl.DateTimeFormat('nl-NL', { timeZone: this.tz, hour: '2-digit', minute: '2-digit' }).format(t * 1000); }

  async loadFrames(silent) {
    let d;
    try { d = await this._hass.callWS({ type: 'weerdashboard/radar_frames' }); }
    catch (e) { this.$('msg').innerHTML = `<div class="warn">Radargegevens ophalen mislukt: ${esc(e.message || e.code || 'onbekende fout')}</div>`; return; }
    const same = this.frames.length === d.frames.length && this.frames.every((f, i) => f.url === d.frames[i].url);
    this.data = d;
    const errs = (d.errors || []).map(e => `<div class="warn">⚠ ${esc(e)}</div>`).join('');
    const note = d.mode === 'anonymous' ? '<div class="src">Anonieme KNMI-toegang (gedeelde limiet). Voeg een eigen KNMI API-sleutel toe via Instellingen → Weerdashboard → Configureren voor betrouwbaarder gebruik.</div>' : '';
    this.$('msg').innerHTML = errs + (d.frames.length ? '' : '<div class="warn">Er zijn nu geen radarbeelden beschikbaar.</div>') + note;
    this.$('src').innerHTML = '<details><summary>Bron: KNMI Data Platform (CC-BY-4.0) · uitleg</summary>Groen = waargenomen radar, oranje = verwachting (KNMI nowcast), twee verschillende producten. De radar dekt Benelux en omgeving (gestippeld kader, ca. 49–56°N en 0–11°O); daarbuiten zijn geen radarbeelden beschikbaar. Bronvermelding van de kaart staat rechtsonder in de kaart.</details>';
    if (!this.ready) return;
    if (this.ov[0] === null) {
      const L = this.L;
      this.ov = [0, 1].map(() => L.imageOverlay(BLANK, d.bounds, { opacity: 0, interactive: false }).addTo(this.map));
      L.rectangle(d.bounds, { color: '#888', weight: 1, fill: false, dashArray: '4 4', interactive: false }).addTo(this.map);
    }
    if (same && silent) return;
    const wasPlaying = this.playing; this.pause();
    this.frames = d.frames.map(f => ({ ...f, state: 'loading' }));
    this.token++; this.legendLoaded = false;
    this.$('sl').max = Math.max(0, this.frames.length - 1);
    this.idx = nowIndex(this.frames);
    this.buildTrack(); this.updateLabels(); this.preload();
    if (wasPlaying) this.play();
  }
  preload() {
    const tok = this.token, order = this.frames.map((f, i) => i).sort((a, b) => Math.abs(a - this.idx) - Math.abs(b - this.idx));
    let next = 0, running = 0;
    const pump = () => {
      while (running < 4 && next < order.length) {
        const i = order[next++], f = this.frames[i]; running++;
        const img = new Image();
        img.onload = () => { done(i, 'ok'); }; img.onerror = () => { done(i, 'missing'); };
        img.src = f.url; f._img = img;
      }
    };
    const done = (i, st) => {
      running--;
      if (tok !== this.token) return;
      this.frames[i].state = st; this.buildTrack();
      if (i === this.idx) this.show(this.idx);
      pump();
    };
    pump();
  }
  buildTrack() {
    const nowT = this.frames[nowIndex(this.frames)]?.t;
    this.$('track').innerHTML = this.frames.map((f, i) => `<div class="${f.state === 'missing' ? 'm' : f.kind === 'observed' ? 'o' : 'f'} ${f.state === 'loading' ? 'l' : ''} ${i === this.idx ? 'c' : ''}" title="${frameLabel(f, nowT, t => this.fmt(t))}"></div>`).join('');
    if (this.frames.length) { this.$('t0').textContent = this.fmt(this.frames[0].t); this.$('t1').textContent = this.fmt(this.frames[this.frames.length - 1].t); }
  }
  updateLabels() {
    const f = this.frames[this.idx]; if (!f) return;
    const nowT = this.frames[nowIndex(this.frames)].t, k = this.$('kind');
    k.textContent = f.kind === 'observed' ? 'Waarneming' : 'Verwachting';
    k.className = 'badge ' + (f.kind === 'observed' ? 'b-obs' : 'b-fc');
    this.$('time').textContent = frameLabel(f, nowT, t => this.fmt(t)).replace(/^(Waarneming|Verwachting) /, '');
    const ago = Math.round((Date.now() / 1000 - nowT) / 60);
    this.$('age').textContent = f.kind === 'observed' ? `${ago} min geleden` : '';
    this.$('sl').value = this.idx; this.buildTrack();
  }
  show(i) {
    const f = this.frames[i]; if (!f) return;
    this.idx = i; this.updateLabels();
    const miss = this.$('miss');
    if (f.state === 'missing') { miss.hidden = false; miss.textContent = `Radarbeeld van ${this.fmt(f.t)} is niet beschikbaar`; this.ov.forEach(o => o && o.setOpacity(0)); return; }
    miss.hidden = true;
    if (f.state !== 'ok') { this.ov.forEach(o => o && o.setOpacity(0)); miss.hidden = false; miss.textContent = 'Beeld laden…'; return; }
    const incoming = this.ov[1 - this.active], outgoing = this.ov[this.active];
    this._swap = (this._swap || 0) + 1;
    const my = this._swap, swap = () => { if (my !== this._swap) return; incoming.setOpacity(0.75); outgoing.setOpacity(0); this.active = 1 - this.active; };
    if (incoming._url === f.url) swap();   // zelfde beeld: de browser geeft dan geen 'load'-gebeurtenis
    else { incoming.once('load', swap); incoming.setUrl(f.url); }
  }
  play() {
    if (!this.frames.length) return;
    this.playing = true; this.$('play').textContent = '⏸'; this.$('play').setAttribute('aria-label', 'Pauzeren');
    const tick = () => {
      if (!this.playing) return;
      if (this.offsetParent === null) { this.pause(); return; }   // tabblad verborgen: afspelen stoppen
      let n = stepIndex(this.frames, this.idx, 1), hold = 0;
      if (n === this.idx) { n = firstUsable(this.frames); hold = 1200; }
      this.show(n);
      this.timer = setTimeout(tick, 600 / this.speed + hold);
    };
    tick();
  }
  pause() { this.playing = false; clearTimeout(this.timer); this.$('play').textContent = '▶'; this.$('play').setAttribute('aria-label', 'Afspelen'); }
  toggleLegend() {
    const box = this.$('leg'); box.hidden = !box.hidden;
    if (!box.hidden && !this.legendLoaded && this.data) {
      this.legendLoaded = true;
      box.innerHTML = `<div><div class="muted">Waarneming (mm/u)</div><img alt="Legenda waarneming" src="${this.data.legend.observed}"></div><div><div class="muted">Verwachting</div><img alt="Legenda verwachting" src="${this.data.legend.forecast}"></div>`;
    }
  }
}
if (!customElements.get('weerdashboard-radar')) customElements.define('weerdashboard-radar', WeerdashboardRadar);
window.__wdRadar = { stepIndex, firstUsable, nowIndex, frameLabel, esc };
