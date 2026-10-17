"""Pure windlogica: rasters, 3-uurstappen, dagoverzicht, vergelijking (alleen standaardbibliotheek)."""
from __future__ import annotations

import math
from datetime import datetime
from zoneinfo import ZoneInfo

try:  # als pakket (Home Assistant) of los (tests)
    from .logic import NL_TZ, _num, _r, nearest_station, station_current, model_current, wind_fields
except ImportError:  # pragma: no cover
    from logic import NL_TZ, _num, _r, nearest_station, station_current, model_current, wind_fields

GRIDS = {
    "fine": {"lat0": 50.5, "lat1": 54.0, "lon0": 2.5, "lon1": 7.5, "dlat": 0.25, "dlon": 0.25, "ttl": 3 * 3600},
    "coarse": {"lat0": 36.0, "lat1": 68.0, "lon0": -12.0, "lon1": 33.0, "dlat": 2.0, "dlon": 3.0, "ttl": 6 * 3600},
}
DAILY_BUDGET = 8500   # eigen veiligheidsgrens onder de 10.000 aanroepen per dag van Open-Meteo
MINUTE_BUDGET = 560   # onder de 600 per minuut
DAYS = 7


def axis(lo, hi, d):
    n = int(round((hi - lo) / d))
    return [round(lo + i * d, 4) for i in range(n + 1)]


def grid_dims(kind):
    g = GRIDS[kind]
    return len(axis(g["lat0"], g["lat1"], g["dlat"])), len(axis(g["lon0"], g["lon1"], g["dlon"]))


def grid_points(kind):
    """Rij voor rij van zuid naar noord, binnen een rij van west naar oost."""
    g = GRIDS[kind]
    lats, lons = axis(g["lat0"], g["lat1"], g["dlat"]), axis(g["lon0"], g["lon1"], g["dlon"])
    return [la for la in lats for _ in lons], [lo for _ in lats for lo in lons]


def coord_str(vals):
    return ",".join(f"{v:g}" for v in vals)


def uv_ms(speed_ms, dir_deg):
    """Windcomponenten (oost, noord) in m/s. De richting is die waaruit de wind komt."""
    if speed_ms is None or dir_deg is None:
        return None, None
    r = math.radians(dir_deg)
    return -speed_ms * math.sin(r), -speed_ms * math.cos(r)


def local_step_indices(times, tz_name, now_ts, step_h=3, back_s=24 * 3600):
    """Indices van tijdstippen op een heel veelvoud van `step_h` uur lokale tijd. Ook de verstreken blokken van vandaag blijven
    beschikbaar (modeldata vanaf lokale middernacht), zodat de dagtijdlijn compleet is."""
    tz = ZoneInfo(tz_name)
    out = []
    for i, t in enumerate(times):
        if t < now_ts - back_s:
            continue
        d = datetime.fromtimestamp(t, tz)
        if d.minute == 0 and d.hour % step_h == 0:
            out.append(i)
    return out


def safe_tz(tz_name):
    try:
        ZoneInfo(tz_name)
        return tz_name
    except Exception:  # noqa: BLE001 (onbekende of lege tijdzone)
        return NL_TZ


def build_grid(kind, locs_hourly, now_ts, tz_name):
    """Compact raster (0,1 m/s als geheel getal) op 3-uurstappen in lokale tijd."""
    g, (ny, nx) = GRIDS[kind], grid_dims(kind)
    if len(locs_hourly) != ny * nx:
        raise ValueError(f"Verwacht {ny * nx} punten, kreeg {len(locs_hourly)}.")
    times = locs_hourly[0].get("time") or []
    idx = local_step_indices(times, tz_name, now_ts)
    u, v = [], []
    for i in idx:
        ur, vr = [], []
        for loc in locs_hourly:
            sp, di = loc.get("wind_speed_10m"), loc.get("wind_direction_10m")
            s = _num(sp[i]) if sp and i < len(sp) else None
            d = _num(di[i]) if di and i < len(di) else None
            uu, vv = uv_ms(s, d)
            ur.append(None if uu is None else int(round(uu * 10)))
            vr.append(None if vv is None else int(round(vv * 10)))
        u.append(ur); v.append(vr)
    steps = [times[i] for i in idx]
    now_idx = max([k for k, t in enumerate(steps) if t <= now_ts], default=0)
    return {"kind": kind, "lat0": g["lat0"], "lat1": g["lat1"], "lon0": g["lon0"], "lon1": g["lon1"],
            "dlat": g["dlat"], "dlon": g["dlon"], "ny": ny, "nx": nx, "times": steps, "u": u, "v": v,
            "now_index": now_idx, "unit": "0,1 m/s", "tz": tz_name, "generated": int(now_ts),
            "source": "Open-Meteo (modelverwachting, geen meting)"}


def parse_multi(resp, n):
    """Open-Meteo geeft een lijst bij meerdere punten en een object bij één punt."""
    items = resp if isinstance(resp, list) else [resp]
    if len(items) != n:
        raise ValueError(f"Verwacht {n} punten, kreeg {len(items)}.")
    return items


def wind_rows(om):
    """Uurrijen met wind (km/u) voor een punt. Neerslag = het uur dat op het tijdstip begint."""
    h = (om or {}).get("hourly") or {}
    times = h.get("time") or []
    idx = {t: i for i, t in enumerate(times)}

    def g(key, t):
        arr, i = h.get(key), idx.get(t)
        return None if arr is None or i is None or i >= len(arr) else _num(arr[i])

    rows = []
    for t in sorted(idx):
        row = {"t": t, "temp": _r(g("temperature_2m", t)), "precip_mm": _r(g("precipitation", t + 3600), 2)}
        row.update(wind_fields(g("wind_speed_10m", t), g("wind_gusts_10m", t), g("wind_direction_10m", t)))
        rows.append(row)
    return rows


def _mean(vals):
    vals = [v for v in vals if v is not None]
    return None if not vals else sum(vals) / len(vals)


def circular_mean_deg(rows):
    """Overheersende windrichting (waaruit), gewogen met de windsnelheid."""
    sx = sy = 0.0
    for r in rows:
        if r.get("wind_kmh") is not None and r.get("dir_deg") is not None:
            a = math.radians(r["dir_deg"])
            sx += r["wind_kmh"] * math.sin(a)
            sy += r["wind_kmh"] * math.cos(a)
    if abs(sx) < 1e-9 and abs(sy) < 1e-9:
        return None
    return math.degrees(math.atan2(sx, sy)) % 360


def daily_summary(rows, tz_name):
    """Per lokale dag: gemiddelde, maximum, stoten, hoofdrichting, sterkste uren en het uurverloop."""
    tz = ZoneInfo(tz_name)
    days, order = {}, []
    for r in rows:
        key = datetime.fromtimestamp(r["t"], tz).date().isoformat()
        if key not in days:
            days[key] = []; order.append(key)
        days[key].append(r)
    out = []
    for key in order:
        rs = days[key]
        speeds = [r["wind_kmh"] for r in rs if r["wind_kmh"] is not None]
        gusts = [r["gust_kmh"] for r in rs if r["gust_kmh"] is not None]
        ranked = sorted((r for r in rs if r["wind_kmh"] is not None), key=lambda r: (-r["wind_kmh"], r["t"]))[:3]
        deg = circular_mean_deg(rs)
        mean = _mean(speeds)
        out.append({
            "date": key, "t0": rs[0]["t"], "hours": len(rs),
            "mean_kmh": _r(mean), "max_kmh": _r(max(speeds)) if speeds else None,
            "gust_kmh": _r(max(gusts)) if gusts else None,
            "dir_deg": None if deg is None else int(round(deg)) % 360,
            "bft_mean": wind_fields(mean, None, None)["bft"], "bft_max": wind_fields(max(speeds), None, None)["bft"] if speeds else None,
            "strongest": sorted(r["t"] for r in ranked), "series": [r["wind_kmh"] for r in rs],
        })
        out[-1]["compass"] = wind_fields(None, None, deg)["compass"]
    return out


def build_point(om, feed, lat, lon, now_ts, tz_default=NL_TZ):
    tz = (om or {}).get("timezone") or tz_default
    rows = wind_rows(om)
    cur = None
    st = nearest_station(feed, lat, lon, now_ts) if feed else None
    if st:
        s, km, ts = st
        cur = station_current(s, km, ts, now_ts)
    else:
        cur = model_current(om)
    return {"lat": lat, "lon": lon, "timezone": tz, "now": int(now_ts), "current": cur, "hourly": rows,
            "daily": daily_summary(rows, tz) if rows else [], "source": "Open-Meteo (modelverwachting, geen meting)"}


def build_compare(om_list, locs, now_ts, tz_name):
    out = []
    for om, loc in zip(om_list, locs):
        rows = wind_rows(om)
        keep = set(local_step_indices([r["t"] for r in rows], tz_name, now_ts))
        steps = [{k: r[k] for k in ("t", "wind_kmh", "wind_kts", "bft", "gust_kmh", "dir_deg", "compass")}
                 for i, r in enumerate(rows) if i in keep]
        out.append({"id": loc["id"], "name": loc["name"], "lat": loc["lat"], "lon": loc["lon"], "rows": steps})
    return out
