/* Weerdashboard-windkaart v0.3.1 - modelgegevens van Open-Meteo (geen metingen), waarnemingen van Buienradar */
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
const BASEMAPS = {
  osm: { label: 'Wereld (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', minZoom: 4, attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers' },
  pdok_grijs: { label: 'Nederland, grijs (PDOK)', url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png', minZoom: 6, attr: 'Kaartgegevens &copy; <a href="https://www.pdok.nl/">Kadaster/PDOK</a>' },
};
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* negeren */ } };
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v)) ? 'n.b.' : Number(v).toFixed(d).replace('.', ',');
const loadLeaflet = () => window.__wdLeaflet || (window.__wdLeaflet = new Promise((resolve, reject) => {
  if (window.L && window.L.map) return resolve(window.L);
  let tag = document.querySelector(`script[src="${LEAFLET_JS}"]`);
  if (!tag) { tag = document.createElement('script'); tag.src = LEAFLET_JS; document.head.appendChild(tag); }
  const fail = () => { window.__wdLeaflet = null; reject(new Error('De kaartbibliotheek (Leaflet) kon niet worden geladen. Controleer de internetverbinding van deze browser.')); };
  tag.addEventListener('error', fail);
  let n = 0; const iv = setInterval(() => { if (window.L && window.L.map) { clearInterval(iv); resolve(window.L); } else if (++n > 300) { clearInterval(iv); fail(); } }, 50);
}));

/* ---------- pure helpers (ook gebruikt door de tests) ---------- */
const BFT_MS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const BFT_COL = ['#d6e8f5', '#aee0f2', '#7fd0e8', '#4fbfd8', '#35b58a', '#7ccf3c', '#e6d52e', '#f4a62a', '#ee6a24', '#d9342b', '#b01e5b', '#7a2a9e', '#4b1a6e'];
const BFT_KMH = ['<1', '1–5', '6–11', '12–19', '20–28', '29–38', '39–49', '50–61', '62–74', '75–88', '89–102', '103–117', '≥118'];
const BFT_KTS = ['<1', '1–3', '4–6', '7–10', '11–16', '17–21', '22–27', '28–33', '34–40', '41–47', '48–55', '56–63', '≥64'];
const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
const bftOf = ms => { if (ms == null || Number.isNaN(ms)) return null; for (let b = 0; b < 12; b++) if (ms < BFT_MS[b]) return b; return 12; };
const compassOf = d => d == null ? null : COMPASS[Math.floor(((d % 360) / 22.5) + 0.5) % 16];
const dirFromUV = (u, v) => (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;   // richting WAARUIT de wind komt
const kmhOf = ms => ms * 3.6, ktsOf = ms => ms * 3.6 / 1.852;

function makeGridSampler(g) {
  return (lat, lon, k) => {
    if (!g || k < 0 || lat < g.lat0 || lat > g.lat1 || lon < g.lon0 || lon > g.lon1) return null;
    const fy = (lat - g.lat0) / g.dlat, fx = (lon - g.lon0) / g.dlon;
    const j = Math.max(0, Math.min(Math.floor(fy), g.ny - 2)), i = Math.max(0, Math.min(Math.floor(fx), g.nx - 2));
    const ty = fy - j, tx = fx - i, U = g.u[k], V = g.v[k]; if (!U || !V) return null;
    const ix = [j * g.nx + i, j * g.nx + i + 1, (j + 1) * g.nx + i, (j + 1) * g.nx + i + 1], w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let u = 0, v = 0;
    for (let n = 0; n < 4; n++) { const a = U[ix[n]], b = V[ix[n]]; if (a == null || b == null) return null; u += a * w[n]; v += b * w[n]; }
    return [u / 10, v / 10];
  };
}
function stepIndexOf(g, t) {
  if (!g || !g.times.length) return -1;
  let best = -1, bd = 1e12; g.times.forEach((x, i) => { const d = Math.abs(x - t); if (d < bd) { bd = d; best = i; } });
  return bd <= 5400 ? best : -1;
}
function sampleAt(grids, t, lat, lon) {   // fijn raster waar dat kan, anders het grove; nooit iets verzinnen
  for (const g of [grids.fine, grids.coarse]) {
    if (!g) continue;
    const s = g.sampler(lat, lon, stepIndexOf(g, t)); if (s) return s;
  }
  return null;
}
const dateKey = (t, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t * 1000);
const hmOf = (t, tz) => new Intl.DateTimeFormat('nl-NL', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(t * 1000);
function groupDays(times, tz) {
  const out = [];
  for (const t of times) { const key = dateKey(t, tz); let d = out[out.length - 1]; if (!d || d.key !== key) { d = { key, steps: [] }; out.push(d); } d.steps.push(t); }
  return out;
}
const tzLabel = tz => { try { const p = new Intl.DateTimeFormat('nl-NL', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date()).find(x => x.type === 'timeZoneName'); return `${tz} (${(p ? p.value : '').replace('GMT', 'UTC')})`; } catch (e) { return tz; } };
const rowAt = (rows, t, tol = 1800) => { let best = null, bd = 1e12; for (const r of rows || []) { const d = Math.abs(r.t - t); if (d < bd) { bd = d; best = r; } } return best && bd <= tol ? best : null; };
function pathSegments(pts) {   // onderbreekt de lijn bij ontbrekende waarden
  const segs = []; let cur = [];
  for (const p of pts) { if (p[1] == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length) segs.push(cur); return segs;
}

const CSS = `
:host{display:block;max-width:100%;overflow:hidden}.wrap{display:grid;gap:10px;color:var(--primary-text-color);min-width:0}.wrap>*{min-width:0}.src{font-size:.7em;color:var(--secondary-text-color);line-height:1.35}.src summary{cursor:pointer}
#map{width:100%;height:min(56vh,480px);min-height:260px;border-radius:10px;overflow:hidden;background:var(--secondary-background-color);position:relative;z-index:0}
.wcv{position:absolute;inset:0;pointer-events:none;z-index:450}.wcv canvas{position:absolute;left:0;top:0}.wcv .c{filter:blur(5px);opacity:.85}
#map.dark .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.9) contrast(.9)}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}.muted{color:var(--secondary-text-color);font-size:.85em}
button,select,input[type=text]{font:inherit;color:var(--primary-text-color);background:var(--secondary-background-color);border:1px solid var(--divider-color);border-radius:8px;padding:6px 10px;cursor:pointer}
input[type=text]{cursor:text;min-width:0}button.on{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:.8em;font-weight:600;color:#fff;background:#6b7280}.b-home{background:#e11d48}.b-fav{background:#d99a00}.b-saved{background:#3b82f6}.b-temp{background:#f97316}
.legend{display:flex;gap:2px;overflow-x:auto}.legend div{flex:1;min-width:54px;padding:3px 4px;font-size:.7em;text-align:center;color:#111;border-radius:4px}
.steps{display:flex;gap:4px;overflow-x:auto;padding-bottom:2px}.steps button{flex:1;min-width:58px}.steps button.now{border-color:var(--primary-color);border-width:2px}.steps button.past{opacity:.6}
.card2{border:1px solid var(--divider-color);border-radius:10px;padding:10px;background:var(--card-background-color)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:10px}.big{font-size:1.8em;font-weight:300}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin-top:6px}.kv span:nth-child(odd){color:var(--secondary-text-color)}
.dg{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(150px,100%),1fr));gap:8px}.dg .card2{cursor:pointer;padding:8px;font-size:.88em}.dg .card2.sel{border-color:var(--primary-color);border-width:2px}
table{border-collapse:collapse;width:100%;min-width:480px}th,td{padding:5px 8px;text-align:right;border-bottom:1px solid var(--divider-color);white-space:nowrap}th:first-child,td:first-child{text-align:left}th{font-weight:500;color:var(--secondary-text-color);font-size:.85em}.scroll{overflow-x:auto}
.warn{background:#f0a50022;border:1px solid #f0a500;border-radius:8px;padding:6px 10px;font-size:.9em}
svg text{fill:var(--secondary-text-color);font-size:10px}@media(max-width:560px){button,select,input[type=text]{padding:4px 8px;font-size:.85em}.steps button{min-width:50px}.big{font-size:1.5em}}
[hidden]{display:none!important}label.lb{display:flex;gap:4px;align-items:center}
`;

class WeerdashboardWind extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    Object.assign(this, { grids: { fine: null, coarse: null }, locs: [], homeId: null, tz: 'Europe/Amsterdam', selT: null, dayKey: null, pt: null, pdata: null, unit: lsGet('wd_wunit', 'kmh'),
      per: 24, showColor: true, showFlow: !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), map: null, F: null, P: [], animOn: false, ready: false, msg: [], markers: null, sel: null, tempM: null, cmp: null, cmpOpen: false });
    this.shadowRoot.innerHTML = `<style>${CSS}</style><link rel="stylesheet" href="${LEAFLET_CSS}"><div class="wrap">
      <div class="row"><b id="tzl" class="muted"></b></div>
      <div id="map"></div>
      <div class="row"><label class="lb"><input type="checkbox" id="lc" checked> Kleur</label><label class="lb"><input type="checkbox" id="lp"> Stroming</label>
        <select id="unit" aria-label="Eenheid"><option value="kmh">km/u</option><option value="kts">knopen</option></select>
        <select id="base" aria-label="Achtergrondkaart">${Object.entries(BASEMAPS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
        <button data-act="home">🏠 Thuis</button><button data-act="cmp">Vergelijk locaties</button></div>
      <div class="legend" id="legend"></div>
      <div class="row"><button data-act="dprev" aria-label="Vorige dag">◀</button><b id="dlabel" class="grow" style="text-align:center"></b><button data-act="dnext" aria-label="Volgende dag">▶</button></div>
      <div class="steps" id="steps"></div>
      <div id="info"></div><div id="cmp" hidden></div>
      <div class="row"><b class="grow">Windverloop</b><button data-act="per" data-v="24">Gekozen dag</button><button data-act="per" data-v="168">7 dagen</button></div>
      <div id="chart"></div><div class="dg" id="daily"></div><div id="msg"></div>
      <details class="src" id="src"><summary>Bron en uitleg</summary>Open-Meteo, modelverwachting (geen metingen). Kaartraster: ca. 0,25° boven Nederland en omgeving, 2–3° voor de rest van Europa. De gemeten wind staat alleen bij "Actueel" als er een Buienradar-station binnen 40 km ligt.</details></div>`;
    const $ = id => this.shadowRoot.getElementById(id); this.$ = $;
    $('unit').value = this.unit; $('lp').checked = this.showFlow;
    this.baseKey = BASEMAPS[lsGet('wd_base', '')] ? lsGet('wd_base', '') : 'osm';
    $('base').value = this.baseKey;
    $('lc').onchange = e => { this.showColor = e.target.checked; this.drawColor(); };
    $('lp').onchange = e => { this.showFlow = e.target.checked; this.flow(this.showFlow); };
    $('unit').onchange = e => { this.unit = e.target.value; lsSet('wd_wunit', this.unit); this.renderPoint(); };
    $('base').onchange = e => { this.baseKey = e.target.value; lsSet('wd_base', this.baseKey); this.setBase(); };
    this.shadowRoot.addEventListener('click', e => this.click(e));
    this.shadowRoot.addEventListener('input', e => { if (e.target.id === 'savename') this.saveName = e.target.value; });
    $('legend').innerHTML = BFT_COL.map((c, b) => `<div style="background:${c}"><b>Bft ${b}</b><br>${BFT_KMH[b]} km/u<br>${BFT_KTS[b]} kts</div>`).join('');
  }
  set hass(h) { this._hass = h; this._dark = !!(h && h.themes && h.themes.darkMode); const m = this.$ && this.$('map'); if (m && m.classList) m.classList.toggle('dark', this._dark); if (!this._started) { this._started = true; this.start(); } }
  setActive(loc, tz) {
    const tzChanged = tz && tz !== this.tz; if (tz) this.tz = tz;
    this.active = loc;
    if (!this.ready) return;
    if (tzChanged) this.loadGrids(true);
    if (loc) { this.selectPoint(loc.lat, loc.lon); const b = this.map.getBounds(); if (!b.contains([loc.lat, loc.lon])) this.map.setView([loc.lat, loc.lon], this.map.getZoom()); }
  }
  connectedCallback() { if (this.map) setTimeout(() => this.map.invalidateSize(), 50); if (this.ready && this.showFlow) this.flow(true); if (this._started && !this.timer) this.timer = setInterval(() => document.visibilityState === 'visible' && this.loadGrids(true), 1800000); }
  disconnectedCallback() { clearInterval(this.timer); this.timer = null; this.animOn = false; }

  async start() {
    try { this.L = await loadLeaflet(); } catch (e) { this.$('msg').innerHTML = `<div class="warn">${esc(e.message)}</div>`; return; }
    const L = this.L;
    this.map = L.map(this.$('map'), { minZoom: 4, maxZoom: 11, zoomSnap: 0.5 }).setView([52.2, 5.3], 7);
    const box = document.createElement('div'); box.className = 'wcv';
    this.cc = Object.assign(document.createElement('canvas'), { className: 'c' }); this.pc = document.createElement('canvas'); box.append(this.cc, this.pc);
    this.$('map').appendChild(box); this.box = box;
    this.setBase();
    this.markers = L.layerGroup().addTo(this.map);
    this.map.on('click', e => this.selectPoint(e.latlng.lat, e.latlng.lng));
    this.map.on('movestart zoomstart', () => { this.box.style.visibility = 'hidden'; this.animOn = false; });
    this.map.on('moveend', () => { this.field(); this.box.style.visibility = 'visible'; if (this.showFlow) this.flow(true); this.maybeCoarse(); });
    this.ready = true;
    this.timer = setInterval(() => document.visibilityState === 'visible' && this.loadGrids(true), 1800000);
    await this.loadLocs();
    await this.loadGrids();
    if (this.active) this.setActive(this.active); else if (this.homeLoc()) this.selectPoint(this.homeLoc().lat, this.homeLoc().lon);
    setTimeout(() => this.map.invalidateSize(), 100);
  }
  setBase() {
    const b = BASEMAPS[this.baseKey] || BASEMAPS.osm; this.map.setMinZoom(b.minZoom);
    if (this.base) this.base.remove();
    this.base = this.L.tileLayer(b.url, { attribution: b.attr, maxZoom: 19, minZoom: b.minZoom, referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(this.map);
    if (this.base.bringToBack) this.base.bringToBack();
    const m = this.$('map'); if (m && m.classList) m.classList.toggle('dark', !!this._dark);
  }
  homeLoc() { return this.locs.find(l => l.id === this.homeId) || this.locs[0]; }
  async ws(msg) { try { return await this._hass.callWS(msg); } catch (e) { this.addMsg(e.message || e.code || 'Opdracht mislukt.'); return null; } }
  addMsg(t) { this.msg = [...new Set([...this.msg, t])].slice(-3); this.$('msg').innerHTML = this.msg.map(m => `<div class="warn">⚠ ${esc(m)}</div>`).join(''); }
  async loadLocs() {
    const r = await this.ws({ type: 'weerdashboard/locations' }); if (!r) return;
    this.locs = r.locations; this.homeId = r.home_id; this.drawMarkers();
  }
  drawMarkers() {
    const L = this.L; if (!this.markers) return; this.markers.clearLayers();
    for (const l of this.locs) {
      const home = l.id === this.homeId, col = home ? '#e11d48' : l.favorite ? '#f5b301' : '#3b82f6';
      L.circleMarker([l.lat, l.lon], { radius: home ? 8 : 6, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(Object.assign(document.createElement('span'), { textContent: (home ? '🏠 ' : l.favorite ? '★ ' : '') + l.name }), { direction: 'top', offset: [0, -6] })
        .on('click', () => this.selectPoint(l.lat, l.lon)).addTo(this.markers);
    }
  }

  /* ---------- rasters ---------- */
  async loadGrids(silent) {
    const g = await this.ws({ type: 'weerdashboard/wind_grid', kind: 'fine', tz: this.tz });
    if (g) this.takeGrid('fine', g);
    if (this.grids.coarse) { const c = await this.ws({ type: 'weerdashboard/wind_grid', kind: 'coarse', tz: this.tz }); if (c) this.takeGrid('coarse', c); }
    this.buildTimeline(silent); this.field(); if (this.showFlow) this.flow(true); this.renderPoint();
  }
  takeGrid(kind, g) {
    g.sampler = makeGridSampler(g); this.grids[kind] = g;
    (g.errors || []).forEach(e => this.addMsg(e));
  }
  async maybeCoarse() {
    if (this.grids.coarse || this.coarseBusy || !this.map) return;
    const f = this.grids.fine, b = this.map.getBounds();
    if (f && b.getSouth() >= f.lat0 - 0.5 && b.getNorth() <= f.lat1 + 0.5 && b.getWest() >= f.lon0 - 0.5 && b.getEast() <= f.lon1 + 0.5) return;
    this.coarseBusy = true;
    const c = await this.ws({ type: 'weerdashboard/wind_grid', kind: 'coarse', tz: this.tz });
    this.coarseBusy = false; if (c) { this.takeGrid('coarse', c); this.field(); if (this.showFlow) this.flow(true); }
  }
  primary() { return this.grids.fine || this.grids.coarse; }
  buildTimeline(keep) {
    const g = this.primary(); if (!g) { this.$('steps').innerHTML = '<div class="warn">Geen windraster beschikbaar.</div>'; return; }
    this.days = groupDays(g.times, this.tz);
    const nowT = g.times[g.now_index];
    if (!keep || this.selT == null || stepIndexOf(g, this.selT) < 0) { this.selT = nowT; this.dayKey = dateKey(nowT, this.tz); }
    this.nowT = nowT; this.renderTimeline();
  }
  renderTimeline() {
    const g = this.primary(); if (!g) return;
    const di = Math.max(0, this.days.findIndex(d => d.key === this.dayKey)), day = this.days[di];
    this.$('tzl').textContent = `Tijdzone: ${tzLabel(this.tz)}. Tijdstippen zijn lokale tijd van de actieve locatie.`;
    this.$('dlabel').textContent = new Intl.DateTimeFormat('nl-NL', { timeZone: this.tz, weekday: 'long', day: 'numeric', month: 'long' }).format(day.steps[0] * 1000);
    this.$('steps').innerHTML = day.steps.map(t => `<button data-act="step" data-t="${t}" class="${t === this.selT ? 'on' : ''} ${t === this.nowT ? 'now' : ''} ${t < this.nowT ? 'past' : ''}" title="${t === this.nowT ? 'Dichtstbijzijnde modeltijdstip van nu' : t < this.nowT ? 'Verstreken tijdstip (modelanalyse)' : ''}">${hmOf(t, this.tz)}</button>`).join('');
  }
  moveDay(dir) {
    const i = this.days.findIndex(d => d.key === this.dayKey), n = this.days[i + dir]; if (!n) return;
    this.dayKey = n.key; if (!n.steps.includes(this.selT)) this.selT = n.steps.find(t => hmOf(t, this.tz) >= '12:00') || n.steps[0];
    this.renderTimeline(); this.timeChanged();
  }
  timeChanged() { this.field(); if (this.showFlow) this.flow(true); this.renderPoint(); this.renderCompare(); }

  /* ---------- kleur en stroming ---------- */
  field() {
    if (!this.map || !this.primary()) return;
    const m = this.map, s = m.getSize(), cell = 12, nx = Math.ceil(s.x / cell) + 1, ny = Math.ceil(s.y / cell) + 1;
    const U = new Float32Array(nx * ny).fill(NaN), V = new Float32Array(nx * ny).fill(NaN);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const ll = m.containerPointToLatLng(this.L.point(i * cell, j * cell)), r = sampleAt(this.grids, this.selT, ll.lat, ll.lng);
      if (r) { U[j * nx + i] = r[0]; V[j * nx + i] = r[1]; }
    }
    this.F = { nx, ny, cell, U, V, w: s.x, h: s.y };
    for (const c of [this.cc, this.pc]) { if (c.width !== s.x) c.width = s.x; if (c.height !== s.y) c.height = s.y; }
    this.drawColor();
  }
  drawColor() {
    if (!this.cc || !this.F) return; const ctx = this.cc.getContext('2d'); if (!ctx) return; ctx.clearRect(0, 0, this.cc.width, this.cc.height);
    this.cc.style.display = this.showColor ? '' : 'none'; if (!this.showColor) return;
    const { nx, ny, cell, U, V } = this.F;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const u = U[j * nx + i], v = V[j * nx + i]; if (Number.isNaN(u)) continue;
      ctx.fillStyle = BFT_COL[bftOf(Math.hypot(u, v))] + 'aa'; ctx.fillRect(i * cell - cell / 2, j * cell - cell / 2, cell, cell);
    }
  }
  vec(x, y) {
    const { nx, ny, cell, U, V } = this.F, fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= ny - 1) return null;
    const tx = fx - i, ty = fy - j, a = j * nx + i, ix = [a, a + 1, a + nx, a + nx + 1], w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let u = 0, v = 0; for (let n = 0; n < 4; n++) { const p = U[ix[n]]; if (Number.isNaN(p)) return null; u += p * w[n]; v += V[ix[n]] * w[n]; }
    return [u, v];
  }
  flow(on) {
    this.animOn = false; const ctx = this.pc && this.pc.getContext('2d'); if (ctx) ctx.clearRect(0, 0, this.pc.width, this.pc.height);
    if (!on || !this.F || !this.isConnected) return;
    const n = Math.max(200, Math.min((navigator.hardwareConcurrency || 4) <= 4 ? 700 : 1300, Math.floor(this.F.w * this.F.h / 2500)));
    this.P = Array.from({ length: n }, () => this.spawn({}));
    this.animOn = true; this.last = 0; const raf = window.requestAnimationFrame || (f => setTimeout(() => f(Date.now()), 33));
    const tick = ts => {
      if (!this.animOn || document.hidden || !this.isConnected) { this.animOn = false; return; }
      raf(tick); if (ts - this.last < 33) return; this.last = ts;
      const c = this.pc.getContext('2d'); if (!c || !this.F) return;
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(0, 0, this.pc.width, this.pc.height);
      c.globalCompositeOperation = 'source-over'; c.strokeStyle = 'rgba(15,23,42,0.7)'; c.lineWidth = 1.2; c.beginPath();
      for (const p of this.P) {
        const v = this.vec(p.x, p.y); if (!v || p.age++ > p.max) { this.spawn(p); continue; }
        const nx = p.x + v[0] * 0.35, ny = p.y - v[1] * 0.35; c.moveTo(p.x, p.y); c.lineTo(nx, ny); p.x = nx; p.y = ny;
      }
      c.stroke();
    };
    raf(tick);
  }
  spawn(p) { const F = this.F || { w: 300, h: 300 }; p.x = Math.random() * F.w; p.y = Math.random() * F.h; p.age = 0; p.max = 40 + Math.random() * 80; return p; }

  /* ---------- punt kiezen en weergeven ---------- */
  async selectPoint(lat, lon) {
    if (!this._hass) return;
    this.pt = { lat, lon }; this.pdata = null; this.saveName = ''; this.renderPoint(true); this.placeSel();
    const d = await this.ws({ type: 'weerdashboard/wind_point', lat, lon });
    if (!this.pt || this.pt.lat !== lat || this.pt.lon !== lon) return;   // inmiddels een ander punt gekozen
    this.pdata = d; this.renderPoint();
  }
  placeSel() {
    const L = this.L, p = [this.pt.lat, this.pt.lon]; if (this.sel) this.sel.remove();
    this.sel = L.circleMarker(p, { radius: 11, color: '#f97316', weight: 3, fill: false, interactive: false }).addTo(this.map);
  }
  kind() {
    const d = this.pdata; if (!d || !d.saved_id) return ['b-temp', 'Tijdelijke selectie (niet opgeslagen)', null];
    const l = this.locs.find(x => x.id === d.saved_id); if (!l) return ['b-temp', 'Tijdelijke selectie (niet opgeslagen)', null];
    return l.id === this.homeId ? ['b-home', 'Thuislocatie', l] : l.favorite ? ['b-fav', 'Opgeslagen favoriet', l] : ['b-saved', 'Opgeslagen locatie', l];
  }
  conv(kmh) { return kmh == null ? null : this.unit === 'kts' ? kmh / 1.852 : kmh; }
  uLabel() { return this.unit === 'kts' ? 'kts' : 'km/u'; }
  windBlock(r) {
    if (!r || r.wind_kmh == null) return '<div class="muted">Niet beschikbaar</div>';
    const arrow = r.dir_deg == null ? '' : `<svg viewBox="-12 -12 24 24" width="22" height="22" style="vertical-align:middle"><g transform="rotate(${(r.dir_deg + 180) % 360})"><path d="M0-9L5 7 0 4-5 7z" fill="var(--primary-color)"/></g></svg>`;
    return `<div class="big">${nf(r.wind_kmh)} <span style="font-size:.5em">km/u</span> · ${nf(r.wind_kts)} <span style="font-size:.5em">kts</span> · Bft ${nf(r.bft)}</div>
      <div class="kv"><span>Richting</span><span>${arrow} ${r.compass || 'n.b.'} ${r.dir_deg != null ? `(${r.dir_deg}°, waaruit de wind komt)` : ''}</span><span>Windstoten</span><span>${nf(r.gust_kmh)} km/u · ${nf(r.gust_kts)} kts · Bft ${nf(r.gust_bft)}</span>
      <span>Temperatuur</span><span>${r.temp != null ? nf(r.temp, 1) + ' °C' : 'n.b.'}</span><span>Neerslag</span><span>${r.precip_mm != null ? nf(r.precip_mm, 1) + ' mm' : (r.precip_mm_h != null ? nf(r.precip_mm_h, 1) + ' mm/u' : 'n.b.')}</span></div>`;
  }
  renderPoint(loading) {
    const box = this.$('info'); if (!this.pt) { box.innerHTML = '<div class="muted">Klik op de kaart of op een locatie voor de windverwachting van dat punt.</div>'; return; }
    if (loading || !this.pdata) { box.innerHTML = `<div class="card2">${loading ? 'Windgegevens laden…' : '<span class="warn">Geen windgegevens voor dit punt.</span>'}</div>`; this.$('chart').innerHTML = ''; this.$('daily').innerHTML = ''; return; }
    const d = this.pdata, [cls, label, loc] = this.kind(), tz = this.tz;
    const name = loc ? loc.name : `${nf(this.pt.lat, 3)}°N ${nf(this.pt.lon, 3)}°O`, cur = d.current, fr = rowAt(d.hourly, this.selT);
    const curBlock = cur ? this.windBlock({ wind_kmh: cur.wind_kmh, wind_kts: cur.wind_kts, bft: cur.bft, dir_deg: cur.dir_deg, compass: cur.compass, gust_kmh: cur.gust_kmh, gust_kts: cur.gust_kts, gust_bft: cur.gust_bft, temp: cur.temp, precip_mm_h: cur.precip_mm_h }) : '<div class="muted">Niet beschikbaar</div>';
    const curSrc = !cur ? '' : cur.source === 'observed' ? `<span class="badge" style="background:#2e9e44">Waarneming</span> station ${esc(cur.station)} (${nf(cur.distance_km, 1)} km) · ${cur.time ? hmOf(cur.time, tz) : ''}${cur.age_min > 45 ? ' · ⚠ verouderd' : ''}` : '<span class="badge" style="background:#d9730d">Modelverwachting</span> geen meting, Open-Meteo';
    let actions = '';
    if (!loc) actions = `<div class="row" style="margin-top:8px"><input type="text" id="savename" placeholder="Naam voor deze locatie" maxlength="60" value="${esc(this.saveName || '')}" class="grow"><button class="on" data-act="save">Opslaan als locatie</button></div>`;
    else actions = `<div class="row" style="margin-top:8px"><button data-act="fav" data-id="${esc(loc.id)}" data-v="${loc.favorite ? 0 : 1}">${loc.favorite ? '★ Verwijder uit favorieten' : '☆ Opslaan als favoriet'}</button></div>`;
    box.innerHTML = `<div class="card2"><div class="row"><b class="grow">${esc(name)}</b><span class="badge ${cls}">${label}</span></div>
      <div class="grid2" style="margin-top:8px"><div><div class="muted">Actueel ${curSrc ? '' : ''}</div>${curBlock}<div class="muted" style="margin-top:4px">${curSrc}</div></div>
      <div><div class="muted">Verwachting op ${this.selT ? new Intl.DateTimeFormat('nl-NL', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(this.selT * 1000) : ''}</div>${this.windBlock(fr)}<div class="muted" style="margin-top:4px"><span class="badge" style="background:#d9730d">Modelverwachting</span> Open-Meteo</div></div></div>${actions}
      ${(d.errors || []).map(e => `<div class="warn" style="margin-top:6px">⚠ ${esc(e)}</div>`).join('')}</div>`;
    this.renderChart(); this.renderDaily();
  }
  renderChart() {
    const d = this.pdata, el = this.$('chart'); if (!d || !d.hourly.length) { el.innerHTML = ''; return; }
    const tz = this.tz, key = this.dayKey;
    const rows = this.per === 24 ? d.hourly.filter(r => dateKey(r.t, tz) === key) : d.hourly;
    if (rows.length < 2) { el.innerHTML = '<div class="muted">Geen gegevens voor deze periode.</div>'; return; }
    const pick = r => this.unit === 'kts' ? [r.wind_kts, r.gust_kts] : [r.wind_kmh, r.gust_kmh];
    const vals = rows.flatMap(r => pick(r)).filter(v => v != null), max = Math.max(10, Math.ceil(Math.max(...vals, 0) / 10) * 10);
    const W = 640, H = 200, L = 36, B = 40, t0 = rows[0].t, t1 = rows[rows.length - 1].t, X = t => L + (t - t0) / (t1 - t0) * (W - L - 8), Y = v => 10 + (1 - v / max) * (H - B - 10);
    const line = (idx, col, dash) => pathSegments(rows.map(r => [r.t, pick(r)[idx]])).map(s => `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="5 4"' : ''} points="${s.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
    const stepH = this.per === 24 ? 3 : 12, arrows = rows.filter((r, i) => r.dir_deg != null && Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(r.t * 1000)) % stepH === 0).map(r => `<g transform="translate(${X(r.t).toFixed(1)},${H - 24}) rotate(${(r.dir_deg + 180) % 360})"><path d="M0-8L4 6 0 3-4 6z" fill="var(--primary-color)"/></g>`).join('');
    const ticks = rows.filter(r => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(r.t * 1000)) % (this.per === 24 ? 3 : 24) === 0).map(r => `<text x="${X(r.t).toFixed(1)}" y="${H - 4}" text-anchor="middle">${this.per === 24 ? hmOf(r.t, tz) : new Intl.DateTimeFormat('nl-NL', { timeZone: tz, weekday: 'short', day: 'numeric' }).format(r.t * 1000)}</text>`).join('');
    const sel = this.selT >= t0 && this.selT <= t1 ? `<line x1="${X(this.selT)}" y1="8" x2="${X(this.selT)}" y2="${H - B}" stroke="var(--primary-text-color)" stroke-dasharray="2 3"/>` : '';
    const grid = [0, .5, 1].map(f => `<line x1="${L}" y1="${Y(max * f)}" x2="${W}" y2="${Y(max * f)}" stroke="var(--divider-color)"/><text x="${L - 4}" y="${Y(max * f) + 3}" text-anchor="end">${Math.round(max * f)}</text>`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Windsnelheid">${grid}${sel}${line(1, '#f97316', true)}${line(0, '#2563eb', false)}${arrows}${ticks}</svg>
      <div class="src"><b style="color:#2563eb">━</b> gemiddelde wind · <b style="color:#f97316">╍</b> windstoten · pijlen: richting waarin de wind waait (wind komt uit de andere kant) · eenheid: ${this.uLabel()}. Het gemiddelde is per uur, windstoten zijn de hoogste stoot in dat uur.</div>`;
    for (const b of this.shadowRoot.querySelectorAll('[data-act="per"]')) b.classList.toggle('on', Number(b.dataset.v) === this.per);
  }
  renderDaily() {
    const d = this.pdata, el = this.$('daily'); if (!d || !d.daily.length) { el.innerHTML = ''; return; }
    const gmax = Math.max(1, ...d.daily.flatMap(x => x.series.filter(v => v != null)));
    el.innerHTML = d.daily.map(x => {
      const spark = x.series.map((v, i) => v == null ? '' : `${(i / Math.max(1, x.series.length - 1) * 100).toFixed(1)},${(24 - v / gmax * 22).toFixed(1)}`).filter(Boolean).join(' ');
      const arrow = x.dir_deg == null ? '' : `<svg viewBox="-10 -10 20 20" width="16" height="16" style="vertical-align:middle"><g transform="rotate(${(x.dir_deg + 180) % 360})"><path d="M0-8L4 6 0 3-4 6z" fill="var(--primary-color)"/></g></svg>`;
      const f = v => v == null ? 'n.b.' : nf(this.conv(v));
      return `<div class="card2 ${x.date === this.dayKey ? 'sel' : ''}" data-act="day" data-k="${esc(x.date)}"><b>${new Intl.DateTimeFormat('nl-NL', { timeZone: this.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(x.t0 * 1000)}</b>
        <div>Gem. ${f(x.mean_kmh)} · max ${f(x.max_kmh)} · stoten ${f(x.gust_kmh)} ${this.uLabel()}</div><div>Bft ${nf(x.bft_mean)}–${nf(x.bft_max)} · ${arrow} ${x.compass || 'n.b.'}</div>
        <div class="muted">Sterkst: ${x.strongest.map(t => hmOf(t, this.tz)).join(', ') || 'n.b.'}</div><svg viewBox="0 0 100 26" width="100%" height="26" preserveAspectRatio="none"><polyline fill="none" stroke="#2563eb" stroke-width="1.5" points="${spark}"/></svg></div>`;
    }).join('');
  }
  async renderCompare() {
    const box = this.$('cmp'); box.hidden = !this.cmpOpen; if (!this.cmpOpen) return;
    if (!this.cmp) { box.innerHTML = '<div class="card2">Laden…</div>'; const r = await this.ws({ type: 'weerdashboard/wind_compare', tz: this.tz }); if (!r) return; this.cmp = r; }
    const t = this.selT, rows = this.cmp.locations.map(l => ({ l, r: rowAt(l.rows, t, 5400) })).sort((a, b) => (b.r?.wind_kmh ?? -1) - (a.r?.wind_kmh ?? -1));
    box.innerHTML = `<div class="card2"><div class="row"><b class="grow">Locaties vergelijken op ${new Intl.DateTimeFormat('nl-NL', { timeZone: this.tz, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(t * 1000)}</b><button data-act="cmp">Sluiten</button></div>
      <div class="scroll"><table><thead><tr><th>Locatie</th><th>km/u</th><th>kts</th><th>Bft</th><th>Richting</th><th>Stoten km/u</th></tr></thead><tbody>${rows.map(({ l, r }) => `<tr><td>${l.id === this.homeId ? '🏠 ' : ''}${esc(l.name)}</td><td>${nf(r?.wind_kmh)}</td><td>${nf(r?.wind_kts)}</td><td>${nf(r?.bft)}</td><td>${r?.compass || 'n.b.'}</td><td>${nf(r?.gust_kmh)}</td></tr>`).join('')}</tbody></table></div>
      <div class="src">Modelverwachting Open-Meteo voor het gekozen tijdstip. Het gekozen tijdstip en de locaties zijn onafhankelijk van elkaar.</div></div>`;
  }

  /* ---------- bediening ---------- */
  async click(e) {
    const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
    if (a === 'step') { this.selT = Number(b.dataset.t); this.renderTimeline(); this.timeChanged(); }
    else if (a === 'dprev') this.moveDay(-1); else if (a === 'dnext') this.moveDay(1);
    else if (a === 'per') { this.per = Number(b.dataset.v); this.renderChart(); }
    else if (a === 'day') { this.dayKey = b.dataset.k; const day = this.days.find(d => d.key === this.dayKey); if (day) { this.selT = day.steps.find(t => hmOf(t, this.tz) >= '12:00') || day.steps[0]; this.renderTimeline(); this.timeChanged(); } }
    else if (a === 'home') { const h = this.homeLoc(); if (h) { this.map.setView([h.lat, h.lon], Math.max(this.map.getZoom(), 8)); this.selectPoint(h.lat, h.lon); } }
    else if (a === 'cmp') { this.cmpOpen = !this.cmpOpen; if (this.cmpOpen) this.cmp = null; this.renderCompare(); }
    else if (a === 'save') await this.saveLoc();
    else if (a === 'fav') { const r = await this.ws({ type: 'weerdashboard/location_favorite', location_id: b.dataset.id, favorite: b.dataset.v === '1' }); if (r) { this.locs = r.locations; this.homeId = r.home_id; this.drawMarkers(); this.renderPoint(); this.changed(); } }
  }
  async saveLoc() {
    const name = (this.saveName || '').trim(); if (!name) { this.addMsg('Geef de locatie eerst een naam.'); return; }
    const r = await this.ws({ type: 'weerdashboard/location_save', name, lat: this.pt.lat, lon: this.pt.lon, make_home: false }); if (!r) return;
    this.locs = r.locations; this.homeId = r.home_id; this.drawMarkers(); this.cmp = null;
    if (this.pdata) this.pdata.saved_id = r.location.id; this.saveName = ''; this.renderPoint(); this.changed();
  }
  changed() { this.dispatchEvent(new CustomEvent('wd-locations-changed', { bubbles: true, composed: true })); }
}
if (!customElements.get('weerdashboard-wind')) customElements.define('weerdashboard-wind', WeerdashboardWind);
window.__wdWind = { bftOf, compassOf, dirFromUV, kmhOf, ktsOf, makeGridSampler, stepIndexOf, sampleAt, groupDays, dateKey, hmOf, rowAt, pathSegments, esc };
