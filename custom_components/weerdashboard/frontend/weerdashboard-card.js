/* Weerdashboard-kaart v0.4.0 - gegevens: Open-Meteo.com en Buienradar.nl */
const nf = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v)) ? 'n.b.' : Number(v).toFixed(d).replace('.', ',');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* negeren */ } } };

/* ---------- pictogrammen (64x64) ---------- */
const sunSvg = (cx, cy, r) => { let rays = ''; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rays += `<line x1="${cx + Math.cos(a) * (r + 4)}" y1="${cy + Math.sin(a) * (r + 4)}" x2="${cx + Math.cos(a) * (r + 9)}" y2="${cy + Math.sin(a) * (r + 9)}"/>`; } return `<g stroke="#f5b301" stroke-width="3" stroke-linecap="round"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f5b301"/>${rays}</g>`; };
const moonSvg = (x, y, s) => `<path transform="translate(${x},${y}) scale(${s})" d="M26 4a22 22 0 1 0 22 28A17 17 0 0 1 26 4z" fill="#cdd6e8"/>`;
const cloudSvg = (c, tr = '') => `<path ${tr ? `transform="${tr}"` : ''} d="M18 48h28a10 10 0 0 0 1-20 13 13 0 0 0-25-3 11 11 0 0 0-4 23z" fill="${c}"/>`;
const drops = (n, long) => { let o = ''; for (let i = 0; i < n; i++) { const x = 20 + i * (24 / Math.max(1, n - 1)) * (n > 1 ? 1 : 0) + (n === 1 ? 12 : 0); o += `<line x1="${x}" y1="${long ? 50 : 52}" x2="${x - 4}" y2="${long ? 62 : 60}" stroke="#3b82f6" stroke-width="3" stroke-linecap="round"/>`; } return o; };
function icon(key, isDay = true, size = 48) {
  const L = '#b7c2d0', D = '#7b8798', day = isDay !== false;
  const clr = day ? sunSvg(32, 32, 11) : moonSvg(12, 10, 1);
  const parts = {
    clear: clr,
    partly: (day ? sunSvg(24, 22, 8) : moonSvg(6, 4, .75)) + cloudSvg(L, 'translate(8,6) scale(.9)'),
    cloudy: cloudSvg(D, 'translate(-6,-6) scale(.9)') + cloudSvg(L, 'translate(4,4) scale(.9)'),
    fog: cloudSvg(L, 'translate(0,-6)') + '<g stroke="#9aa7b8" stroke-width="3" stroke-linecap="round"><line x1="12" y1="52" x2="52" y2="52"/><line x1="18" y1="59" x2="46" y2="59"/></g>',
    drizzle: cloudSvg(L, 'translate(0,-6)') + drops(2, false),
    rain: cloudSvg(D, 'translate(0,-6)') + drops(3, false),
    heavy_rain: cloudSvg('#5f6b7b', 'translate(0,-8)') + drops(4, true),
    thunder: cloudSvg('#5f6b7b', 'translate(0,-8)') + '<polygon points="34,40 24,54 31,54 28,64 42,46 34,46" fill="#f5b301"/>',
    snow: cloudSvg(L, 'translate(0,-6)') + '<g fill="#8fc7ff"><circle cx="22" cy="54" r="3"/><circle cx="34" cy="58" r="3"/><circle cx="46" cy="54" r="3"/></g>',
    sleet: cloudSvg(D, 'translate(0,-6)') + drops(2, false) + '<g fill="#8fc7ff"><circle cx="38" cy="56" r="3"/></g>',
    unknown: '<circle cx="32" cy="32" r="22" fill="none" stroke="#9aa7b8" stroke-width="3"/><text x="32" y="40" text-anchor="middle" font-size="24" fill="#9aa7b8">?</text>',
  };
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${parts[key] || parts.unknown}</svg>`;
}

const CARD_VERSION = '0.4.0';
const TABS = [['nu', 'Nu'], ['uur', 'Uur'], ['radar', 'Radar'], ['wind', 'Wind'], ['meters', 'Meters'], ['alles', 'Alles']];
function pathSegs(pts) {   // onderbreekt een lijn bij ontbrekende waarden
  const segs = []; let cur = [];
  for (const p of pts) { if (p[1] == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length) segs.push(cur); return segs;
}
const textOn = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff'; const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111' : '#fff'; };
const jacketPath = '<path d="M22 10 6 42l8 5 8-16v25h20V31l8 16 8-5L42 10l-6 6h-8z"';
const CLOTH = {
  tshirt: '<path d="M22 10 8 20l6 10 8-4v28h20V26l8 4 6-10L42 10q-10 8-20 0z" fill="#4f8cff"/>',
  sweater: '<path d="M22 10 6 40l8 5 8-14v25h20V31l8 14 8-5L42 10q-10 7-20 0z" fill="#8b5cf6"/>',
  jacket: jacketPath + ' fill="#e5833b"/><path d="M32 16v40" stroke="#fff" stroke-width="2"/>',
  coat: '<circle cx="32" cy="14" r="9" fill="#1f6f8b"/><path d="M22 18 6 46l8 5 8-16v23h20V35l8 16 8-5L42 18z" fill="#2a8fb0"/><path d="M32 18v40" stroke="#fff" stroke-width="2"/><circle cx="28" cy="30" r="1.8" fill="#fff"/><circle cx="28" cy="40" r="1.8" fill="#fff"/><circle cx="28" cy="50" r="1.8" fill="#fff"/>',
  pants: '<path d="M20 8h24l3 48H35l-3-30-3 30H17z" fill="#4b5563"/>',
  shorts: '<path d="M18 14h28l3 26H35l-3-12-3 12H15z" fill="#4b5563"/>',
  hat: '<path d="M14 40a18 18 0 0 1 36 0z" fill="#d9342b"/><rect x="12" y="40" width="40" height="8" rx="3" fill="#a31d1d"/><circle cx="32" cy="17" r="5" fill="#d9342b"/>',
  rain_jacket: jacketPath + ' fill="#f5b301"/><path d="M32 16v40" stroke="#fff" stroke-width="2"/><g stroke="#3b82f6" stroke-width="3" stroke-linecap="round"><line x1="52" y1="6" x2="49" y2="13"/><line x1="59" y1="14" x2="56" y2="21"/><line x1="10" y1="6" x2="7" y2="13"/></g>',
  rain_suit: jacketPath + ' fill="#d99a00"/><path d="M32 16v40" stroke="#fff" stroke-width="2"/><g stroke="#2563eb" stroke-width="3" stroke-linecap="round"><line x1="52" y1="4" x2="49" y2="11"/><line x1="59" y1="12" x2="56" y2="19"/><line x1="59" y1="26" x2="56" y2="33"/><line x1="10" y1="4" x2="7" y2="11"/><line x1="4" y1="14" x2="1" y2="21"/></g>',
  wind: '<g fill="none" stroke="#60a5fa" stroke-width="4" stroke-linecap="round"><path d="M8 22h30a7 7 0 1 0-7-7"/><path d="M8 34h42a7 7 0 1 1-7 7"/><path d="M8 46h22"/></g>',
  sun: sunSvg(32, 32, 11),
};
const clothIcon = (key, size = 44) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${CLOTH[key] || '<circle cx="32" cy="32" r="20" fill="none" stroke="#9aa7b8" stroke-width="3"/>'}</svg>`;
const windArrow = (deg, size = 84) => deg == null ? '<div class="muted">richting n.b.</div>' :
  `<svg viewBox="-50 -50 100 100" width="${size}" height="${size}" aria-label="Wind uit ${nf(deg)} graden"><circle r="42" fill="none" stroke="var(--wd-line, var(--divider-color))" stroke-width="2"/><g font-size="11" fill="var(--wd-muted, var(--secondary-text-color))" text-anchor="middle"><text y="-30">N</text><text x="32" y="4">O</text><text y="38">Z</text><text x="-32" y="4">W</text></g><g transform="rotate(${(deg + 180) % 360})"><path d="M0-24L8 12 0 6-8 12z" fill="var(--primary-color)"/></g></svg>`;
const smallArrow = deg => deg == null ? '' : `<span class="ar" style="transform:rotate(${(deg + 180) % 360}deg)">↑</span>`;

const HEAT_STOPS = [[-10, '#3b6fd1'], [0, '#3b6fd1'], [10, '#4a9be0'], [18, '#5bbfb0'], [25, '#59b25a'], [30, '#f2c500'], [35, '#f08a00'], [40, '#d63a2f'], [45, '#8e1b3a']];

const gPt = (cx, cy, r, a) => { const t = a * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function stopColor(stops, pos) {   // kleurverloop tussen de kleurpunten [[0..100, '#rrggbb']]
  if (pos <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (pos <= stops[i][0]) {
    const [p0, c0] = stops[i - 1], [p1, c1] = stops[i], f = p1 === p0 ? 1 : (pos - p0) / (p1 - p0), a = hex2rgb(c0), b = hex2rgb(c1);
    return 'rgb(' + a.map((x, k) => Math.round(x + (b[k] - x) * f)).join(',') + ')';
  }
  return stops[stops.length - 1][1];
}
function gaugeSvg({ value, min, max, stops, ticks, valueText, label, color, aria }) {   // ronde meter als een toerenteller (240 graden)
  const cx = 100, cy = 95, r = 62, sw = 12, A0 = -120, A1 = 120, N = 60, fr = v => Math.max(0, Math.min(1, (v - min) / (max - min))), ang = v => A0 + (A1 - A0) * fr(v);
  let arcs = '';
  for (let i = 0; i < N; i++) {
    const a = A0 + (A1 - A0) * i / N, b = Math.min(A1, A0 + (A1 - A0) * (i + 1) / N + 0.8), [x1, y1] = gPt(cx, cy, r, a), [x2, y2] = gPt(cx, cy, r, b);
    arcs += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${stopColor(stops, (i + .5) / N * 100)}" stroke-width="${sw}" fill="none"/>`;
  }
  const tk = ticks.map(([v, l]) => { const a = ang(v), [tx, ty] = gPt(cx, cy, r + sw / 2 + 9, a), [x1, y1] = gPt(cx, cy, r + sw / 2, a), [x2, y2] = gPt(cx, cy, r + sw / 2 + 3, a);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--wd-muted, var(--secondary-text-color))"/><text class="gt" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${l}</text>`; }).join('');
  let needle = '';
  if (value != null) { const [nx, ny] = gPt(cx, cy, r - 3, ang(value));
    needle = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--wd-text, var(--primary-text-color))" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="7" fill="var(--wd-text, var(--primary-text-color))"/><circle cx="${cx}" cy="${cy}" r="2.5" fill="var(--wd-card, var(--card-background-color))"/>`; }
  const col = color || 'var(--wd-muted, var(--secondary-text-color))';
  return `<svg viewBox="0 0 200 150" role="img" aria-label="${esc(aria)}">${arcs}${tk}${needle}<text x="100" y="124" text-anchor="middle" style="font-size:25px;font-weight:500;fill:${col}">${valueText}</text><text x="100" y="142" text-anchor="middle" style="font-size:12px;fill:${col}">${esc(label)}</text></svg>`;
}
const heatPos = v => Math.max(0, Math.min(100, (v + 10) / 55 * 100));
const uvPos = v => Math.max(0, Math.min(100, v / 12 * 100));

const CSS = `
:host{display:block;max-width:100%;overflow-x:hidden;--wd-tile:rgba(0,0,0,.14);--wd-muted:var(--secondary-text-color)}
@supports (color:color-mix(in srgb,red 50%,blue)){:host{--wd-muted:color-mix(in srgb,var(--primary-text-color) 85%,transparent)}}
.wrap{padding:12px;display:grid;gap:12px;color:var(--wd-text, var(--primary-text-color))}
section{min-width:0;border:1px solid var(--wd-line, var(--divider-color));border-radius:12px;padding:12px;background:var(--wd-card, var(--card-background-color))}
h2{margin:0 0 8px;font-size:1.05em;font-weight:600}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}
.muted{color:var(--wd-muted, var(--secondary-text-color));font-size:.85em}
button,select,input{font:inherit;color:var(--wd-text, var(--primary-text-color));background:var(--wd-tile, rgba(0,0,0,.14));border:1px solid var(--wd-line, var(--divider-color));border-radius:8px;padding:6px 10px}
button{cursor:pointer}button.on{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}
button.danger{color:var(--error-color)}
input{min-width:0;width:100%;box-sizing:border-box}
.badge{display:inline-block;font-size:.75em;padding:1px 8px;border-radius:10px;background:var(--wd-tile, rgba(0,0,0,.14));border:1px solid var(--wd-line, var(--divider-color))}
.warn{background:#f0a50022;border:1px solid #f0a500;border-radius:8px;padding:6px 10px;font-size:.9em}
.cur{display:grid;grid-template-columns:auto auto auto;gap:8px 18px;align-items:center;justify-content:start}.rose{text-align:center;font-size:.85em;line-height:1.25}
.temp{font-size:3.2em;font-weight:300;line-height:1}.feels{color:var(--wd-muted, var(--secondary-text-color))}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:12px}
.stat{background:var(--wd-tile, rgba(0,0,0,.14));border:1px solid var(--wd-line, var(--divider-color));border-radius:8px;padding:8px}.stat b{display:block;font-size:1.15em}
.advice{border-radius:10px;padding:10px 12px;margin-bottom:8px;border-left:6px solid}
.a-geen{background:#2e9e4422;border-color:#2e9e44}.a-jas{background:#f2c50033;border-color:#f2c500}.a-pak{background:#d63a2f22;border-color:#d63a2f}.a-onbekend{background:#8883;border-color:#888}
.advice b{font-size:1.15em}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:640px}
th,td{padding:6px 8px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--wd-line, var(--divider-color))}th:first-child,td:first-child{text-align:left}th:nth-child(4),td:nth-child(4){text-align:left}
th{font-weight:500;color:var(--wd-muted, var(--secondary-text-color));font-size:.85em}.day td{background:var(--wd-tile, rgba(0,0,0,.14));font-weight:600;text-align:left}
.heavy{background:#3b82f633}.cold{color:#3b82f6}.hot{color:#d63a2f}.windy{background:#f0a50033}
.ar{display:inline-block;font-weight:bold;margin-left:4px}
.meters{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gauge{max-width:220px;margin:0 auto}.gauge svg{width:100%;height:auto;display:block}.gauge .gt,.gt{fill:var(--wd-muted, var(--secondary-text-color));font-size:10px}
.scale{position:relative;height:14px;border-radius:7px;margin:22px 0 4px}.ptr{position:absolute;top:-8px;width:0;transform:translateX(-50%)}
.ptr:before{content:"";display:block;width:4px;height:30px;background:var(--wd-text, var(--primary-text-color));border:1px solid var(--wd-card, var(--card-background-color));border-radius:2px;margin-left:-2px}
.ticks{position:relative;height:16px;font-size:.75em;color:var(--wd-muted, var(--secondary-text-color))}.ticks span{position:absolute;transform:translateX(-50%)}
.big{font-size:2em;font-weight:300}.mini{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:4px;margin-top:8px}.mini div{text-align:center;font-size:.78em;background:var(--wd-tile, rgba(0,0,0,.14));border-radius:6px;padding:3px 2px}
svg text{fill:var(--wd-muted, var(--secondary-text-color));font-size:10px}
.loc{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--wd-line, var(--divider-color))}
.res{cursor:pointer;padding:6px;border-radius:6px}.res:hover{background:var(--wd-tile, rgba(0,0,0,.14))}
.form{display:grid;gap:8px;margin-top:8px}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tab{display:grid;gap:12px;min-width:0}.tab[hidden]{display:none}
.tabs{display:flex;gap:4px;position:sticky;top:0;z-index:5;background:var(--wd-card, var(--card-background-color));border:1px solid var(--wd-line, var(--divider-color));border-radius:12px;padding:4px;overflow-x:auto}.tabs button{flex:1;white-space:nowrap;border:0;background:transparent;padding:6px 8px}.tabs button.on{background:var(--primary-color)}
.sumbar{border-left:6px solid var(--primary-color)}.sumtxt{font-size:1.02em;line-height:1.45;font-weight:500}
.sunbar{position:relative;height:10px;border-radius:5px;background:var(--wd-tile, rgba(0,0,0,.14));margin:12px 6px 10px}.sunfill{height:100%;border-radius:5px;background:linear-gradient(90deg,#f6c453,#f08a00)}.sundot{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#f5b301;border:2px solid var(--wd-card, var(--card-background-color))}
.drow{display:grid;grid-template-columns:3.1em 30px 1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--wd-line, var(--divider-color));font-size:.92em}.drow:last-of-type{border-bottom:0}
.tbar{display:grid;grid-template-columns:2.4em 1fr 2.4em;gap:6px;align-items:center;text-align:center}.trk{position:relative;height:6px;border-radius:3px;background:var(--wd-tile, rgba(0,0,0,.14))}.rng{position:absolute;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,#4a9be0,#f5b301)}
.dr{text-align:right;font-size:.9em;white-space:nowrap}
.aqi{min-width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.15em}
.pol{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;margin-top:10px}.pl{display:flex;flex-direction:column;gap:2px;background:var(--wd-tile, rgba(0,0,0,.14));border:1px solid var(--wd-line, var(--divider-color));border-radius:8px;padding:6px 8px;font-size:.85em}.pl small{color:var(--wd-muted, var(--secondary-text-color))}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
.ctiles{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}.ct{display:flex;flex-direction:column;align-items:center;width:80px;text-align:center;font-size:.72em;line-height:1.2;background:var(--wd-tile, rgba(0,0,0,.14));border-radius:10px;padding:6px 4px}.src{font-size:.7em;color:var(--wd-muted, var(--secondary-text-color));margin-top:6px;line-height:1.35}.src summary{cursor:pointer}.src p{margin:4px 0}.wrap>*{min-width:0}
@media(max-width:560px){.ct{width:70px}.wrap{padding:8px;gap:8px}section{padding:10px}.cur{gap:6px 10px}.cur .ico svg{width:60px;height:60px}.cur .rose svg{width:64px;height:64px}.temp{font-size:2.3em}.stats{grid-template-columns:repeat(auto-fill,minmax(110px,1fr))}.meters{gap:8px}.meters section{padding:8px}.meters h2{font-size:.95em;margin-bottom:2px}.meters .mini div:nth-child(n+5){display:none}.meters .mini div{font-size:.72em}.meters .muted{font-size:.75em}}
`;

class WeerdashboardCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.s = { locs: [], homeId: null, selId: LS.get('wd_sel', null), data: null, loading: true, err: null, view: 'dash', tab: LS.get('wd_tab', 'nu'),
      win: parseInt(LS.get('wd_win', '2'), 10) || 2, hours: parseInt(LS.get('wd_hours', '24'), 10) || 24,
      pw: parseInt(LS.get('wd_pw', '24'), 10) || 24, form: { id: null, name: '', query: '', lat: '', lon: '', home: false }, results: [], formMsg: '' };
    this.shadowRoot.addEventListener('click', e => this._click(e));
    this.shadowRoot.addEventListener('change', e => this._change(e));
    this.shadowRoot.addEventListener('input', e => this._input(e));
    this.shadowRoot.addEventListener('wd-locations-changed', async () => { await this._loadLocs(); this._render(); });
  }
  setConfig(c) { this._cfg = c || {}; this._applyTheme(); }
  _applyTheme() {   // optionele kleuren uit de kaartconfiguratie, bijvoorbeeld text_color: "#ffffff"
    const map = { text_color: '--wd-text', muted_color: '--wd-muted', tile_color: '--wd-tile', card_color: '--wd-card', line_color: '--wd-line' };
    for (const [k, v] of Object.entries(map)) { if (this._cfg && this._cfg[k]) this.style.setProperty(v, String(this._cfg[k])); else this.style.removeProperty(v); }
  }
  getCardSize() { return 14; }
  static getStubConfig() { return {}; }
  set hass(h) { this._hass = h; if (this._radarEl) this._radarEl.hass = h; if (this._windEl) this._windEl.hass = h; if (!this._started) { this._started = true; this._boot(); } }
  connectedCallback() { if (this._started && !this._timer) this._timer = setInterval(() => this._load(true), 300000); }
  disconnectedCallback() { clearInterval(this._timer); this._timer = null; }

  async _boot() {
    this._timer = setInterval(() => this._load(true), 300000);
    await this._loadLocs();
    await this._load();
  }
  async _loadLocs() {
    try {
      const r = await this._hass.callWS({ type: 'weerdashboard/locations' });
      this.s.locs = r.locations; this.s.homeId = r.home_id;
      if (!r.locations.find(l => l.id === this.s.selId)) this.s.selId = r.home_id;
    } catch (e) { this.s.err = 'Weerdashboard-integratie niet gevonden. Is de integratie toegevoegd en Home Assistant herstart?'; }
  }
  async _load(silent) {
    if (!this.s.selId) { this._render(); return; }
    if (!silent) { this.s.loading = true; this._render(); }
    try {
      this.s.data = await this._hass.callWS({ type: 'weerdashboard/data', location_id: this.s.selId, window_h: this.s.win });
      this.s.err = null;
    } catch (e) { this.s.err = 'Gegevens ophalen mislukt: ' + (e.message || e.code || 'onbekende fout'); }
    this.s.loading = false; this._render();
  }
  async _ws(msg) {
    try { return await this._hass.callWS(msg); } catch (e) { this.s.formMsg = e.message || 'Opdracht mislukt.'; this._render(); return null; }
  }

  /* ---------- events ---------- */
  _click(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, id = b.dataset.id, v = b.dataset.v, s = this.s;
    if (a === 'refresh') this._load();
    else if (a === 'view') { s.view = v; s.formMsg = ''; this._render(); }
    else if (a === 'tab') { s.tab = v; LS.set('wd_tab', v); this._showTab(v); }
    else if (a === 'win') { s.win = +v; LS.set('wd_win', v); this._load(true); }
    else if (a === 'hours') { s.hours = +v; LS.set('wd_hours', v); this._render(); }
    else if (a === 'pw') { s.pw = +v; LS.set('wd_pw', v); this._render(); }
    else if (a === 'pick') { s.selId = id; LS.set('wd_sel', id); s.view = 'dash'; this._load(); }
    else if (a === 'fav') this._ws({ type: 'weerdashboard/location_favorite', location_id: id, favorite: v === '1' }).then(r => r && this._applyLocs(r));
    else if (a === 'home') this._ws({ type: 'weerdashboard/location_home', location_id: id }).then(r => { if (r) { this._applyLocs(r); this._load(true); } });
    else if (a === 'del') { const l = s.locs.find(x => x.id === id); if (l && confirm(`Locatie "${l.name}" verwijderen?`)) this._ws({ type: 'weerdashboard/location_delete', location_id: id }).then(r => { if (r) { this._applyLocs(r); if (s.selId === id) { s.selId = r.home_id; this._load(); } } }); }
    else if (a === 'edit') { const l = s.locs.find(x => x.id === id); s.form = { id, name: l.name, query: '', lat: String(l.lat), lon: String(l.lon), home: false }; s.results = []; s.formMsg = ''; this._render(); }
    else if (a === 'cancel') { s.form = { id: null, name: '', query: '', lat: '', lon: '', home: false }; s.results = []; s.formMsg = ''; this._render(); }
    else if (a === 'search') this._search();
    else if (a === 'result') { const r = s.results[+v]; s.form.lat = String(r.lat); s.form.lon = String(r.lon); if (!s.form.name) s.form.name = r.name; s.results = []; s.formMsg = `Gekozen: ${r.name} (${nf(r.lat, 3)}; ${nf(r.lon, 3)})`; this._render(); }
    else if (a === 'save') this._save();
  }
  _change(e) { if (e.target.dataset.sel !== undefined) { this.s.selId = e.target.value; LS.set('wd_sel', e.target.value); this._load(); } if (e.target.dataset.f === 'home') this.s.form.home = e.target.checked; }
  _input(e) { const f = e.target.dataset.f; if (f && f !== 'home') this.s.form[f] = e.target.value; }
  _applyLocs(r) { this.s.locs = r.locations; this.s.homeId = r.home_id; this._render(); }
  async _search() {
    const q = this.s.form.query.trim(); if (q.length < 2) { this.s.formMsg = 'Typ minimaal 2 tekens.'; this._render(); return; }
    const r = await this._ws({ type: 'weerdashboard/search', query: q });
    if (r) { this.s.results = r; this.s.formMsg = r.length ? '' : 'Niets gevonden. Probeer een andere schrijfwijze of vul coördinaten in.'; this._render(); }
  }
  async _save() {
    const f = this.s.form, lat = parseFloat(String(f.lat).replace(',', '.')), lon = parseFloat(String(f.lon).replace(',', '.'));
    if (!f.name.trim()) { this.s.formMsg = 'Geef de locatie een naam.'; this._render(); return; }
    if (Number.isNaN(lat) || Number.isNaN(lon)) { this.s.formMsg = 'Zoek eerst een plaats of vul coördinaten in.'; this._render(); return; }
    const msg = { type: 'weerdashboard/location_save', name: f.name.trim(), lat, lon, make_home: f.home };
    if (f.id) msg.location_id = f.id;
    const r = await this._ws(msg); if (!r) return;
    this.s.locs = r.locations; this.s.homeId = r.home_id;
    if (!f.id) { this.s.selId = r.location.id; LS.set('wd_sel', r.location.id); }
    this.s.form = { id: null, name: '', query: '', lat: '', lon: '', home: false }; this.s.results = []; this.s.formMsg = 'Opgeslagen.';
    this._load();
  }

  /* ---------- helpers ---------- */
  _tf(t, o) { return new Intl.DateTimeFormat('nl-NL', { timeZone: this.s.data?.timezone || 'Europe/Amsterdam', ...o }).format(t * 1000); }
  _hm(t) { return t == null ? 'n.b.' : this._tf(t, { hour: '2-digit', minute: '2-digit' }); }
  _day(t) { return this._tf(t, { weekday: 'long', day: 'numeric', month: 'long' }); }

  /* ---------- weergave ---------- */
  _render() {
    const s = this.s;
    let body = '';
    if (s.err && !s.data) body = `<section><div class="warn">${esc(s.err)}</div></section>`;
    else if (s.view === 'locs') body = this._locs();
    else if (s.loading && !s.data) body = '<section>Gegevens laden…</section>';
    else if (s.data) {
      const tab = TABS.some(t => t[0] === s.tab) ? s.tab : 'nu';
      const groups = { nu: [this._summary(), this._current(), this._advice(), this._sun()], uur: [this._hourly(), this._daily()], radar: [this._rain()],
        wind: [this._wind()], meters: [this._meters(), this._air(), this._baro()] };
      body = this._tabbar(tab) + Object.entries(groups).map(([k, parts]) => `<div class="tab" data-tab="${k}" ${tab === 'alles' || tab === k ? '' : 'hidden'}>${parts.join('')}</div>`).join('') + this._footer();
    }
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card><div class="wrap">${this._hdr()}${body}</div></ha-card>`;
    this._mountRadar(); this._mountWind();
  }
  _tabbar(tab) { return `<div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-act="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
  _showTab(v) {   // alleen tonen/verbergen: kaarten en gekozen punten blijven bestaan
    for (const el of this.shadowRoot.querySelectorAll('.tab')) el.hidden = !(v === 'alles' || el.dataset.tab === v);
    for (const b of this.shadowRoot.querySelectorAll('[data-act="tab"]')) b.classList.toggle('on', b.dataset.v === v);
    (window.requestAnimationFrame || (f => setTimeout(f, 30)))(() => { if (this._radarEl && this._radarEl.refreshSize) this._radarEl.refreshSize(); if (this._windEl && this._windEl.refreshSize) this._windEl.refreshSize(); });
  }
  _summary() { const sm = this.s.data.summary; return sm ? `<section class="sumbar"><div class="sumtxt">${esc(sm.text)}</div></section>` : ''; }
  _sun() {
    const u = this.s.data.sun; if (!u) return '';
    const hm = t => this._hm(t), dl = `${Math.floor(u.daylight_min / 60)}u ${String(u.daylight_min % 60).padStart(2, '0')}m`, pct = (u.fraction * 100).toFixed(1);
    const diff = u.diff_min == null ? '' : ` (${u.diff_min > 0 ? '+' : u.diff_min < 0 ? '−' : '±'}${Math.abs(u.diff_min)} min t.o.v. gisteren)`;
    const nxt = u.next ? `${u.next.kind === 'sunrise' ? 'Zon op' : 'Zon onder'} om ${hm(u.next.t)}` : '';
    return `<section><div class="row"><b class="grow">Zon</b><span class="muted">${nxt}${u.is_day ? '' : ' · nu is het donker'}</span></div>
      <div class="sunbar" role="img" aria-label="Stand van de zon tussen opkomst en ondergang"><div class="sunfill" style="width:${pct}%"></div><div class="sundot" style="left:${pct}%"></div></div>
      <div class="row" style="justify-content:space-between"><span>↑ ${hm(u.sunrise)}</span><span class="muted">daglicht ${dl}${diff}</span><span>↓ ${hm(u.sunset)}</span></div></section>`;
  }
  _hourChart(rows) {
    if (rows.length < 2) return '';
    const tz = this.s.data.timezone, W = 640, H = 236, L = 34, R = 8, T = 10, ch = 120, rb = H - 42, rh = 44;
    const temps = rows.flatMap(r => [r.temp, r.feels]).filter(v => v != null);
    if (!temps.length) return '<div class="muted">Geen temperatuurgegevens voor de grafiek.</div>';
    const t0 = rows[0].t, t1 = rows[rows.length - 1].t, X = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R);
    const lo = Math.floor(Math.min(...temps) - 1), hi = Math.ceil(Math.max(...temps) + 1), Y = v => T + (hi - v) / Math.max(1, hi - lo) * ch;
    const line = (key, col, dash) => pathSegs(rows.map(r => [r.t, r[key]])).map(sg => `<polyline fill="none" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="4 3"' : ''} points="${sg.map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
    const maxP = Math.max(2, ...rows.map(r => r.precip_mm ?? 0)), bw = Math.max(2, (W - L - R) / rows.length - 2);
    const bars = rows.map(r => r.precip_mm == null || r.precip_mm <= 0 ? '' : `<rect x="${(X(r.t) - bw / 2).toFixed(1)}" y="${(rb - r.precip_mm / maxP * rh).toFixed(1)}" width="${bw.toFixed(1)}" height="${(r.precip_mm / maxP * rh).toFixed(1)}" fill="${r.precip_mm >= 2.5 ? '#1d4ed8' : r.precip_mm >= 0.5 ? '#3b82f6' : '#93c5fd'}"><title>${this._hm(r.t)}: ${nf(r.precip_mm, 1)} mm</title></rect>`).join('');
    const lh = t => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(t * 1000));
    const step = rows.length <= 14 ? 2 : rows.length <= 26 ? 3 : 6;
    const ticks = rows.filter((r, i) => i % step === 0).map(r => `<text x="${X(r.t).toFixed(1)}" y="${H - 4}" text-anchor="middle">${this._hm(r.t)}</text>`).join('');
    const days = rows.filter((r, i) => i > 0 && lh(r.t) === 0).map(r => `<line x1="${X(r.t).toFixed(1)}" y1="${T}" x2="${X(r.t).toFixed(1)}" y2="${rb}" stroke="var(--wd-line, var(--divider-color))" stroke-dasharray="2 3"/><text x="${(X(r.t) + 3).toFixed(1)}" y="${T + 9}">${new Intl.DateTimeFormat('nl-NL', { timeZone: tz, weekday: 'short' }).format(r.t * 1000)}</text>`).join('');
    const grid = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - R}" y2="${Y(v).toFixed(1)}" stroke="var(--wd-line, var(--divider-color))"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v)}°</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Temperatuur en neerslag per uur">${grid}${days}${bars}${line('feels', '#f97316', true)}${line('temp', '#2563eb', false)}<line x1="${L}" y1="${rb}" x2="${W - R}" y2="${rb}" stroke="var(--wd-line, var(--divider-color))"/><text x="${L - 4}" y="${rb - rh + 3}" text-anchor="end">${nf(maxP, 1)}</text><text x="${L - 4}" y="${rb}" text-anchor="end">0</text>${ticks}</svg>
      <div class="src"><b style="color:#2563eb">━</b> temperatuur · <b style="color:#f97316">╍</b> gevoelstemperatuur · blokjes = neerslag in mm per uur (schaal links onder)</div>`;
  }
  _daily() {
    const days = this.s.data.daily || [], tz = this.s.data.timezone;
    if (!days.length) return '<section><h2>7 dagen</h2><div class="warn">Dagverwachting niet beschikbaar.</div></section>';
    const mins = days.map(d => d.tmin).filter(v => v != null), maxs = days.map(d => d.tmax).filter(v => v != null), mn = Math.min(...mins), span = Math.max(1, Math.max(...maxs) - mn);
    const rows = days.map(d => {
      const lab = new Intl.DateTimeFormat('nl-NL', { timeZone: tz, weekday: 'short', day: 'numeric' }).format(d.t * 1000);
      const bar = d.tmin == null || d.tmax == null ? '<div class="trk"></div>' : `<div class="trk"><div class="rng" style="left:${((d.tmin - mn) / span * 100).toFixed(1)}%;width:${Math.max(3, (d.tmax - d.tmin) / span * 100).toFixed(1)}%"></div></div>`;
      return `<div class="drow" title="${esc(d.desc)}"><b>${esc(lab)}</b><div>${icon(d.icon, true, 30)}</div><div class="tbar"><span>${nf(d.tmin)}°</span>${bar}<span>${nf(d.tmax)}°</span></div>
        <div class="dr"><div>${nf(d.precip_mm, 1)} mm${d.precip_prob == null ? '' : ` · ${nf(d.precip_prob)}%`}</div><div class="muted">Bft ${nf(d.bft)} ${d.compass || ''}${d.uv_max != null ? ` · UV ${nf(d.uv_max, 0)}` : ''}</div></div></div>`;
    }).join('');
    return `<section><h2>7 dagen</h2>${rows}<details class="src"><summary>Uitleg en bron</summary>Neerslag = totale hoeveelheid per dag in mm; het percentage is de hoogste neerslagkans die dag (geen hoeveelheid). Wind = hoogste uurgemiddelde, in Beaufort, met de richting waaruit de wind komt. UV = verwacht maximum. Bron: Open-Meteo (modelverwachting).</details></section>`;
  }
  _air() {
    const a = this.s.data.air; if (!a) return '';
    const head = '<section><h2>Luchtkwaliteit en pollen</h2>';
    if (a.error && !a.aqi && !a.pollen) return `${head}<div class="warn">${esc(a.error)}</div></section>`;
    const q = a.aqi ? `<div class="row"><div class="aqi" style="background:${a.aqi.color};color:${textOn(a.aqi.color)}">${a.aqi.value}</div><div><b>${esc(a.aqi.label)}</b><div class="muted">Europese luchtkwaliteitsindex (EAQI)</div><div class="muted">PM2,5 ${nf(a.aqi.pm2_5, 1)} · PM10 ${nf(a.aqi.pm10, 1)} µg/m³</div></div></div>` : '<div class="muted">Luchtkwaliteit niet beschikbaar.</div>';
    const pol = a.pollen ? `<div class="pol">${a.pollen.slice(0, 6).map(p => `<div class="pl"><b>${esc(p.label)}</b><span><i class="dot" style="background:${p.color}"></i>${esc(p.level)}</span><small>${nf(p.max, 0)}/m³</small></div>`).join('')}</div>` : '<div class="muted" style="margin-top:8px">Geen pollengegevens (buiten het pollenseizoen of buiten Europa).</div>';
    return `${head}${q}${pol}<details class="src"><summary>Uitleg en bron</summary>Bron: ${esc(a.source)}. Pollen in korrels per m³, hoogste waarde in de komende 24 uur; de indeling (Geen, Laag, Matig, Hoog, Zeer hoog) is een eigen indicatie, geen officiële norm. Pollen is alleen beschikbaar in Europa tijdens het pollenseizoen.</details></section>`;
  }
  _wind() { return '<section><h2>Windkaart</h2><div id="wind-slot"></div></section>'; }
  _mountWind() {
    const slot = this.shadowRoot.getElementById('wind-slot'); if (!slot) return;
    if (!customElements.get('weerdashboard-wind')) { slot.innerHTML = '<div class="warn">Windmodule niet geladen. Ververs de pagina met Ctrl+F5 en controleer of Home Assistant is herstart na de update.</div>'; return; }
    if (!this._windEl) this._windEl = document.createElement('weerdashboard-wind');
    slot.replaceWith(this._windEl);   // hetzelfde element blijft bestaan, dus kaart, tijdstip en gekozen punt blijven behouden
    this._windEl.hass = this._hass;
    const loc = this.s.locs.find(l => l.id === this.s.selId), tz = this.s.data?.timezone, key = `${this.s.selId}|${tz}`;
    if (loc && key !== this._windKey) { this._windKey = key; this._windEl.setActive(loc, tz); }
  }
  _mountRadar() {
    const slot = this.shadowRoot.getElementById('radar-slot'); if (!slot) return;
    if (!customElements.get('weerdashboard-radar')) { slot.innerHTML = '<div class="warn">Radarmodule niet geladen. Ververs de pagina met Ctrl+F5 en controleer of Home Assistant is herstart na de update.</div>'; return; }
    if (!this._radarEl) this._radarEl = document.createElement('weerdashboard-radar');
    slot.replaceWith(this._radarEl);   // hetzelfde element blijft bestaan, dus de kaart en het afspelen worden niet gereset
    const loc = this.s.locs.find(l => l.id === this.s.selId);
    this._radarEl.hass = this._hass;
    if (loc) this._radarEl.setLocation(loc, this.s.data?.timezone);
  }
  _hdr() {
    const s = this.s, loc = s.locs.find(l => l.id === s.selId);
    const opts = s.locs.map(l => `<option value="${esc(l.id)}" ${l.id === s.selId ? 'selected' : ''}>${l.id === s.homeId ? '🏠 ' : l.favorite ? '★ ' : ''}${esc(l.name)}</option>`).join('');
    const kind = !loc ? '' : loc.id === s.homeId ? 'Thuislocatie' : loc.favorite ? 'Favoriete locatie' : 'Opgeslagen locatie';
    return `<section><div class="row"><select data-sel class="grow" aria-label="Locatie">${opts}</select>
      <button data-act="refresh" title="Vernieuwen">↻</button>
      <button data-act="view" data-v="${s.view === 'locs' ? 'dash' : 'locs'}">${s.view === 'locs' ? '← Dashboard' : 'Mijn locaties'}</button></div>
      <div class="muted" style="margin-top:6px">${loc ? `<span class="badge">${kind}</span> ${esc(loc.name)} · ${nf(loc.lat, 3)}°N ${nf(loc.lon, 3)}°O · tijdzone ${esc(s.data?.timezone || '')}` : ''}${s.data ? ` · bijgewerkt ${this._hm(s.data.now)}` : ''}</div>
      ${(s.data?.errors || []).map(e => `<div class="warn" style="margin-top:6px">⚠ ${esc(e)}</div>`).join('')}${s.err && s.data ? `<div class="warn" style="margin-top:6px">⚠ ${esc(s.err)}</div>` : ''}</section>`;
  }
  _current() {
    const c = this.s.data.current || {};
    if (c.temp == null && !c.desc) return '<section><h2>Actueel weer</h2><div class="warn">Geen actuele gegevens beschikbaar voor deze locatie.</div></section>';
    const obs = c.source === 'observed';
    const src = obs ? `Waarneming · station ${esc(c.station)} (${nf(c.distance_km, 1)} km) · ${this._hm(c.time)}${c.age_min > 45 ? ` · <b>⚠ verouderd (${c.age_min} min)</b>` : ''}` : 'Modelverwachting (geen meting) · Open-Meteo';
    return `<section><h2>Actueel weer</h2><div class="cur"><div class="ico">${icon(c.icon, c.is_day, 80)}</div>
      <div class="tt"><div class="temp">${nf(c.temp, 1)}°</div><div class="feels">Voelt als ${nf(c.feels, 1)}°</div><div><b>${esc(c.desc)}</b></div></div>
      <div class="rose">${windArrow(c.dir_deg, 76)}<div><b>${c.compass ? 'uit ' + c.compass : 'n.b.'}</b> ${c.dir_deg != null ? `(${c.dir_deg}°)` : ''}</div></div></div>
      <div class="src">${src}</div>
      <div class="stats">
        <div class="stat">Wind (gemiddeld)<b>${nf(c.wind_kmh)} km/u</b>${nf(c.wind_kts)} kts · Bft ${nf(c.bft)}</div>
        <div class="stat">Windstoten<b>${nf(c.gust_kmh)} km/u</b>${nf(c.gust_kts)} kts · Bft ${nf(c.gust_bft)}</div>
        <div class="stat">Luchtvochtigheid<b>${nf(c.humidity)}%</b></div>
        <div class="stat">Neerslag nu<b>${nf(c.precip_mm_h, 1)} mm/u</b></div>
        <div class="stat">Luchtdruk<b>${nf(this.s.data.pressure.current, 1)} hPa</b>zeeniveau</div></div>
      <details class="src"><summary>Uitleg windkracht</summary>Windkracht (Bft) is gebaseerd op de gemiddelde windsnelheid; bij windstoten staat de Bft van de stoten apart.</details></section>`;
  }
  _advice() {
    const d = this.s.data, a = d.rain_advice;
    const wins = [1, 2, 4].map(h => `<button data-act="win" data-v="${h}" class="${this.s.win === h ? 'on' : ''}">${h} uur</button>`).join('');
    return `<section><div class="row"><h2 class="grow">Regenpak-advies</h2>${wins}</div>
      <div class="advice a-${a.level}"><b>${esc(a.title)}</b><div>${esc(a.reason)}</div></div>
      ${this._clothing()}
      <details class="src"><summary>Uitleg en bron</summary>Gebaseerd op neerslagintensiteit (mm/u), niet op neerslagkans. Tijdvenster: komende ${a.window_h} uur. Hulpmiddel op basis van modeldata, geen garantie. Bronnen: Buienradar (2 uur) en Open-Meteo (uurverwachting).</details></section>`;
  }
  _clothing() {
    const k = this.s.data.clothing; if (!k) return '';
    if (k.level === 'onbekend') return `<h2 style="margin:12px 0 6px">Kledingadvies</h2><div class="warn">${esc(k.reason)}</div>`;
    return `<h2 style="margin:12px 0 6px">Kledingadvies</h2><div class="ctiles">${k.items.map(i => `<div class="ct" data-k="${esc(i.key)}">${clothIcon(i.key, 44)}<span>${esc(i.label)}</span></div>`).join('')}</div>
      <div><b>${esc(k.title)}</b></div><div class="muted">${esc(k.reason)}</div>${(k.notes || []).map(n => `<div class="muted">• ${esc(n)}</div>`).join('')}`;
  }
  _rain() {
    const nc = this.s.data.nowcast;
    return `<section><h2>Buienradar</h2><div id="radar-slot"></div>
      <h2 style="margin-top:14px">Regen komende 2 uur op deze locatie</h2>${this._rainChart(nc)}</section>`;
  }
  _rainChart(nc) {
    const pts = nc.points || [];
    if (!pts.length) return `<div class="warn">${esc(nc.error || 'Niet beschikbaar.')}</div>`;
    const W = 600, H = 120, max = Math.max(2, ...pts.map(p => p.mm_h)), bw = W / pts.length;
    const bars = pts.map((p, i) => { const h = p.mm_h / max * (H - 24); const col = p.mm_h >= 2.5 ? '#1d4ed8' : p.mm_h >= 0.5 ? '#3b82f6' : '#93c5fd'; return `<rect x="${i * bw + 1}" y="${H - 16 - h}" width="${bw - 2}" height="${Math.max(h, p.mm_h > 0 ? 1.5 : 0)}" fill="${col}"><title>${this._hm(p.t)}: ${nf(p.mm_h, 2)} mm/u</title></rect>`; }).join('');
    const ticks = pts.map((p, i) => i % 6 === 0 ? `<text x="${i * bw}" y="${H - 3}">${this._hm(p.t)}</text>` : '').join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Neerslag komende 2 uur"><line x1="0" y1="${H - 16}" x2="${W}" y2="${H - 16}" stroke="var(--wd-line, var(--divider-color))"/><text x="2" y="10">${nf(max, 1)} mm/u</text>${bars}${ticks}</svg><div class="src">Bron: ${esc(nc.source)} · intensiteit in mm/u (verwachting)</div>`;
  }
  _hourly() {
    const d = this.s.data, rows = d.hourly.slice(0, this.s.hours);
    const btn = [12, 24, 48].map(h => `<button data-act="hours" data-v="${h}" class="${this.s.hours === h ? 'on' : ''}">${h} uur</button>`).join('');
    let html = `<section><div class="row"><h2 class="grow">Weersverwachting per uur</h2>${btn}</div>`;
    if (!rows.length) return html + '<div class="warn">Uurverwachting niet beschikbaar.</div></section>';
    let lastDay = '';
    const trs = rows.map(r => {
      const day = this._day(r.t); let hdr = '';
      if (day !== lastDay) { hdr = `<tr class="day"><td colspan="9">${esc(day)}</td></tr>`; lastDay = day; }
      const tc = r.temp != null && r.temp <= 0 ? 'cold' : r.temp != null && r.temp >= 25 ? 'hot' : '';
      return hdr + `<tr><td>${this._hm(r.t)}</td><td class="${tc}">${nf(r.temp, 1)}°</td><td>${icon(r.icon, r.is_day, 28)}</td><td>${esc(r.desc)}</td>
        <td class="${r.precip_mm >= 2.5 ? 'heavy' : ''}">${nf(r.precip_mm, 1)}</td><td>${r.precip_prob == null ? 'n.b.' : nf(r.precip_prob) + '%'}</td>
        <td class="${r.bft >= 6 ? 'windy' : ''}">${nf(r.bft)}</td><td>${nf(r.wind_kts)}</td><td>${r.compass || 'n.b.'}${smallArrow(r.dir_deg)}</td></tr>`;
    }).join('');
    return html + this._hourChart(rows) + `<div class="scroll"><table><thead><tr><th>Tijd</th><th>Temp.</th><th></th><th>Weer</th><th title="Hoeveelheid in mm gedurende het uur vanaf dit tijdstip">Neerslag (mm)</th><th title="Kans op neerslag, geen hoeveelheid">Kans</th><th>Bft</th><th>kts</th><th>Richting</th></tr></thead><tbody>${trs}</tbody></table></div>
      <details class="src"><summary>Uitleg en bron</summary>Tijden in lokale tijd (${esc(d.timezone)}). Neerslag = hoeveelheid in dat uur; de kans is een aparte kolom. Bft en kts zijn gebaseerd op de gemiddelde wind; richting is waaruit de wind komt. Bron: Open-Meteo (modelverwachting).</details></section>`;
  }
  _mini(series, fmt) { return `<div class="mini">${series.slice(0, 6).map(p => `<div>${this._hm(p.t)}<br><b>${fmt(p.v)}</b></div>`).join('')}</div>`; }
  _meters() {
    const d = this.s.data, uv = d.uv, h = d.heat, hv = h.feels ?? h.temp, GREY = [[0, '#c4c9d1'], [100, '#c4c9d1']];
    const uvStops = [[0, '#2e9e44'], [18, '#2e9e44'], [30, '#f2c500'], [42, '#f2c500'], [52, '#f08a00'], [60, '#f08a00'], [72, '#d63a2f'], [84, '#d63a2f'], [92, '#7a3fb5'], [100, '#7a3fb5']];
    const uvOk = uv.value != null, hOk = hv != null;
    const uvG = gaugeSvg({ value: uvOk ? uv.value : null, min: 0, max: 12, stops: uvOk ? uvStops : GREY, ticks: [[0, '0'], [3, '3'], [6, '6'], [8, '8'], [11, '11+']],
      valueText: uvOk ? nf(uv.value, 1) : 'n.b.', label: uvOk ? uv.category.label : 'niet beschikbaar', color: uvOk ? uv.category.color : null, aria: `UV-index ${uvOk ? nf(uv.value, 1) + ', ' + uv.category.label : 'niet beschikbaar'}` });
    const hG = gaugeSvg({ value: hOk ? hv : null, min: -10, max: 45, stops: hOk ? HEAT_STOPS.map(([v, c]) => [heatPos(v), c]) : GREY, ticks: [0, 10, 20, 30, 40].map(v => [v, v + '°']),
      valueText: hOk ? nf(hv, 1) + '°' : 'n.b.', label: hOk ? h.category.label : 'niet beschikbaar', color: hOk ? h.category.color : null, aria: `Hittekracht ${hOk ? nf(hv, 1) + ' graden, ' + h.category.label : 'niet beschikbaar'}` });
    return `<div class="meters"><section><h2>UV-zonkracht</h2><div class="gauge">${uvG}</div>
      <div class="muted" style="text-align:center">Verwacht maximum vandaag: ${uv.max_today == null ? 'n.b.' : nf(uv.max_today, 1)}</div>${uv.series.length ? this._mini(uv.series, v => nf(v, 1)) : ''}
      <details class="src"><summary>Uitleg en bron</summary>Laag 0–2 · Matig 3–5 · Hoog 6–7 · Zeer hoog 8–10 · Extreem 11+. Bron: ${esc(uv.source)}</details></section>
      <section><h2>Hittekracht</h2><div class="gauge">${hG}</div>
      <div class="muted" style="text-align:center">Temperatuur ${nf(h.temp, 1)}° · voelt als ${nf(h.feels, 1)}°</div>${h.series.length ? this._mini(h.series, v => nf(v) + '°') : ''}
      <details class="src"><summary>Uitleg en bron</summary>Indicator: ${esc(h.basis)}. De hitte-indicator is iets anders dan de UV-index. De bandindeling (Koud, Koel, Aangenaam, Warm, Heet, Zeer heet, Extreem heet) is een eigen indeling voor gevoelstemperatuur. Bron: ${esc(h.source)}</details></section></div>`;
  }
  _baro() {
    const p = this.s.data.pressure, now = this.s.data.now;
    const btn = [[24, '24 uur'], [48, '48 uur'], [168, '7 dagen']].map(([h, l]) => `<button data-act="pw" data-v="${h}" class="${this.s.pw === h ? 'on' : ''}">${l}</button>`).join('');
    const tr = { stijgend: ['↗', 'Stijgend'], dalend: ['↘', 'Dalend'], stabiel: ['→', 'Stabiel'], onbekend: ['?', 'Onbekend'] }[p.trend];
    const ch = d => d == null ? 'n.b.' : (d > 0 ? '+' : '') + nf(d, 1) + ' hPa';
    return `<section><div class="row"><h2 class="grow">Barometer</h2>${btn}</div>
      <div class="row" style="gap:20px"><div><div class="big">${nf(p.current, 1)} <span style="font-size:.5em">hPa</span></div><div class="muted">${nf(p.current, 1)} mbar · ${esc(p.kind)}${p.current_source ? ' · ' + esc(p.current_source) : ''}</div></div>
      <div><div class="big">${tr[0]} <span style="font-size:.5em">${tr[1]}</span></div><div class="muted">3 uur: ${ch(p.delta3)} · 6 uur: ${ch(p.delta6)}</div></div></div>
      ${this._baroChart(p, now)}
      <details class="src"><summary>Toelichting en bron</summary><p>${esc(p.note)}</p><p>Grafiek: ${esc(p.series_source)}.${p.surface_model != null ? ` Modelwaarde op locatiehoogte: ${nf(p.surface_model, 1)} hPa.` : ''} De trend (stijgend/dalend vanaf 1 hPa per 3 uur, anders stabiel) wordt berekend uit tijdgestempelde waarden.</p></details></section>`;
  }
  _baroChart(p, now) {
    const hrs = this.s.pw, t0 = now - hrs * 3600, pts = p.series.filter(x => x[0] >= t0 && x[0] <= now + 60);
    if (pts.length < 2) return '<div class="warn" style="margin-top:8px">Nog onvoldoende gegevens voor deze periode. Er worden metingen verzameld.</div>';
    const W = 600, H = 170, L = 38, B = 18, vals = pts.map(x => x[1]);
    const lo = Math.floor(Math.min(...vals) - 1), hi = Math.ceil(Math.max(...vals) + 1);
    const X = t => L + (t - t0) / (now - t0) * (W - L - 6), Y = v => 8 + (hi - v) / (hi - lo) * (H - B - 8);
    const line = pts.map(x => `${X(x[0]).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const fmt = t => hrs > 48 ? this._tf(t, { weekday: 'short', day: 'numeric' }) : this._hm(t);
    const xt = [0, .5, 1].map(f => { const t = t0 + f * (now - t0); return `<text x="${X(t)}" y="${H - 4}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${fmt(t)}</text>`; }).join('');
    const gaps = pts[0][0] > t0 + hrs * 3600 * .15 ? `<div class="muted">Gegevens beschikbaar vanaf ${this._tf(pts[0][0], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}; er wordt verder verzameld.</div>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Luchtdrukverloop"><line x1="${L}" y1="8" x2="${L}" y2="${H - B}" stroke="var(--wd-line, var(--divider-color))"/><line x1="${L}" y1="${H - B}" x2="${W}" y2="${H - B}" stroke="var(--wd-line, var(--divider-color))"/>
      <text x="${L - 4}" y="14" text-anchor="end">${hi}</text><text x="${L - 4}" y="${H - B}" text-anchor="end">${lo}</text><polyline fill="none" stroke="var(--primary-color)" stroke-width="2" points="${line}"/>
      <circle cx="${X(last[0])}" cy="${Y(last[1])}" r="4" fill="var(--primary-color)"/>${xt}</svg>${gaps}`;
  }
  _locs() {
    const s = this.s, f = s.form;
    const rows = s.locs.map(l => `<div class="loc"><div class="grow"><b>${esc(l.name)}</b> ${l.id === s.homeId ? '<span class="badge">Thuis</span>' : l.favorite ? '<span class="badge">Favoriet</span>' : ''}<div class="muted">${nf(l.lat, 3)}°N ${nf(l.lon, 3)}°O</div></div>
      <button data-act="pick" data-id="${esc(l.id)}">Bekijk</button><button data-act="fav" data-id="${esc(l.id)}" data-v="${l.favorite ? 0 : 1}" title="Favoriet">${l.favorite ? '★' : '☆'}</button>
      ${l.id === s.homeId ? '' : `<button data-act="home" data-id="${esc(l.id)}">Instellen als thuislocatie</button>`}
      <button data-act="edit" data-id="${esc(l.id)}">Wijzig</button>${l.id === s.homeId ? '' : `<button class="danger" data-act="del" data-id="${esc(l.id)}">Verwijder</button>`}</div>`).join('');
    const res = s.results.map((r, i) => `<div class="res" data-act="result" data-v="${i}">${esc(r.name)}${r.admin1 ? ', ' + esc(r.admin1) : ''}${r.country ? ' (' + esc(r.country) + ')' : ''} <span class="muted">${nf(r.lat, 3)}; ${nf(r.lon, 3)}</span></div>`).join('');
    return `<section><h2>Mijn locaties</h2>${rows}</section>
      <section><h2>${f.id ? 'Locatie wijzigen' : 'Locatie toevoegen'}</h2><div class="form">
        <input data-f="name" placeholder="Naam (bijv. Kustlocatie, Werk)" value="${esc(f.name)}" maxlength="60">
        <div class="row"><input class="grow" data-f="query" placeholder="Zoek plaatsnaam of postcode" value="${esc(f.query)}"><button data-act="search">Zoeken</button></div>${res}
        <div class="two"><input data-f="lat" placeholder="Breedtegraad (bijv. 52,09)" value="${esc(f.lat)}" inputmode="decimal"><input data-f="lon" placeholder="Lengtegraad (bijv. 5,12)" value="${esc(f.lon)}" inputmode="decimal"></div>
        <label class="row"><input type="checkbox" data-f="home" style="width:auto" ${f.home ? 'checked' : ''}> Direct instellen als thuislocatie</label>
        <div class="row"><button class="on" data-act="save">${f.id ? 'Wijzigingen opslaan' : 'Locatie opslaan'}</button>${f.id ? '<button data-act="cancel">Annuleren</button>' : ''}</div>
        ${s.formMsg ? `<div class="muted">${esc(s.formMsg)}</div>` : ''}
        <div class="muted">Alleen beheerders kunnen locaties wijzigen. Locaties blijven bewaard na een herstart van Home Assistant. Je thuislocatie staat los van de standaardlocatie van Home Assistant.</div></div></section>`;
  }
  _footer() { return '<div class="src" style="text-align:center">Weergegevens: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo.com</a> · Waarnemingen en regenverwachting: <a href="https://www.buienradar.nl" target="_blank" rel="noopener">Buienradar.nl</a> · Radar: <a href="https://dataplatform.knmi.nl" target="_blank" rel="noopener">KNMI Data Platform</a> (CC-BY-4.0) · Lucht en pollen: CAMS (Copernicus) via Open-Meteo · kaart v' + CARD_VERSION + '</div>'; }
}
if (!customElements.get('weerdashboard-card')) customElements.define('weerdashboard-card', WeerdashboardCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(x => x.type === 'weerdashboard-card')) window.customCards.push({ type: 'weerdashboard-card', name: 'Weerdashboard', description: 'Actueel weer, uurverwachting, regenpak-advies, UV, hitte en barometer met eigen locaties.' });
window.__wdCard = { clothIcon, CLOTH, CARD_VERSION };
