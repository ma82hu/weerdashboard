"""Pure logica voor Weerdashboard. Alleen standaardbibliotheek, zodat dit los te testen is."""
from __future__ import annotations

import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

KMH_PER_KNOT = 1.852
NL_TZ = "Europe/Amsterdam"

DEFAULT_OPTIONS = {"window_h": 2, "light_mm_h": 0.1, "heavy_mm_h": 1.0, "gust_kmh": 50.0, "knmi_api_key": ""}

# ---------- hulpfuncties ----------


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def _r(v, d=1):
    return None if v is None else round(v, d)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def fmt_hm(ts, tz_name):
    return datetime.fromtimestamp(ts, ZoneInfo(tz_name)).strftime("%H:%M")


# ---------- wind ----------


def kmh_to_kts(kmh):
    return None if kmh is None else kmh / KMH_PER_KNOT


def ms_to_kmh(ms):
    return None if ms is None else ms * 3.6


# Bovengrenzen (m/s) van Bft 0..11; daarboven is het Bft 12.
_BFT_LIMITS_MS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]


def beaufort(kmh):
    if kmh is None:
        return None
    ms = kmh / 3.6
    for b, lim in enumerate(_BFT_LIMITS_MS):
        if ms < lim:
            return b
    return 12


COMPASS = ["N", "NNO", "NO", "ONO", "O", "OZO", "ZO", "ZZO",
           "Z", "ZZW", "ZW", "WZW", "W", "WNW", "NW", "NNW"]


def compass(deg):
    """Richting waaruit de wind komt, als Nederlandse kompasaanduiding."""
    if deg is None:
        return None
    return COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]


def wind_fields(speed_kmh, gust_kmh, deg):
    return {
        "wind_kmh": _r(speed_kmh), "wind_kts": _r(kmh_to_kts(speed_kmh)),
        "bft": beaufort(speed_kmh),
        "gust_kmh": _r(gust_kmh), "gust_kts": _r(kmh_to_kts(gust_kmh)),
        "gust_bft": beaufort(gust_kmh),
        "dir_deg": None if deg is None else int(round(deg % 360)) % 360,
        "compass": compass(deg),
    }


# ---------- UV en hitte ----------

UV_CATEGORIES = [
    (2, "Laag", "#2e9e44"), (5, "Matig", "#f2c500"), (7, "Hoog", "#f08a00"),
    (10, "Zeer hoog", "#d63a2f"), (10**6, "Extreem", "#7a3fb5"),
]


def uv_category(uv):
    """UV-index wordt volgens de gangbare conventie op een geheel getal afgerond."""
    if uv is None:
        return None
    v = math.floor(uv + 0.5)
    for upper, label, color in UV_CATEGORIES:
        if v <= upper:
            return {"label": label, "color": color, "index": v}
    return None


# Eigen bandindeling voor de gevoelstemperatuur (bovengrens exclusief).
HEAT_BANDS = [
    (0, "Vrieskou", "#3b6fd1"), (10, "Koud", "#4a9be0"), (18, "Koel", "#5bbfb0"),
    (25, "Aangenaam", "#59b25a"), (30, "Warm", "#f2c500"), (35, "Heet", "#f08a00"),
    (40, "Zeer heet", "#d63a2f"), (math.inf, "Extreem heet", "#8e1b3a"),
]


def heat_category(feels):
    if feels is None:
        return None
    for upper, label, color in HEAT_BANDS:
        if feels < upper:
            return {"label": label, "color": color}
    return None


# ---------- weertypen ----------

_WMO = {
    0: ("Onbewolkt", "clear"), 1: ("Vrijwel onbewolkt", "clear"), 2: ("Half bewolkt", "partly"),
    3: ("Bewolkt", "cloudy"), 45: ("Mist", "fog"), 48: ("Rijpmist", "fog"),
    51: ("Lichte motregen", "drizzle"), 53: ("Motregen", "drizzle"), 55: ("Dichte motregen", "drizzle"),
    56: ("Lichte ijzelmotregen", "sleet"), 57: ("Ijzelmotregen", "sleet"),
    61: ("Lichte regen", "rain"), 63: ("Regen", "rain"), 65: ("Zware regen", "heavy_rain"),
    66: ("Lichte ijzelregen", "sleet"), 67: ("Ijzelregen", "sleet"),
    71: ("Lichte sneeuw", "snow"), 73: ("Sneeuw", "snow"), 75: ("Zware sneeuw", "snow"),
    77: ("Sneeuwkorrels", "snow"), 80: ("Lichte regenbuien", "rain"), 81: ("Regenbuien", "rain"),
    82: ("Zware regenbuien", "heavy_rain"), 85: ("Lichte sneeuwbuien", "snow"),
    86: ("Zware sneeuwbuien", "snow"), 95: ("Onweer", "thunder"),
    96: ("Onweer met hagel", "thunder"), 99: ("Zwaar onweer met hagel", "thunder"),
}


def weather_info(code):
    c = _num(code)
    if c is None or int(c) not in _WMO:
        return "Niet beschikbaar", "unknown"
    return _WMO[int(c)]


def icon_from_description(desc):
    """Zet de Nederlandse weeromschrijving van een Buienradar-station om naar een pictogramsleutel."""
    if not desc:
        return "unknown"
    d = desc.lower()
    if "onweer" in d:
        return "thunder"
    if "sneeuw" in d:
        return "snow"
    if "hagel" in d or "ijzel" in d:
        return "sleet"
    if "motregen" in d:
        return "drizzle"
    if "regen" in d or "bui" in d:
        return "heavy_rain" if "zware" in d or "zwaar" in d else "rain"
    if "mist" in d or "nevel" in d:
        return "fog"
    if any(k in d for k in ("half", "licht bewolkt", "wolkenvelden", "enkele", "veel zon")):
        return "partly"
    if "bewolkt" in d:
        return "cloudy"
    if any(k in d for k in ("zonnig", "helder", "onbewolkt", "zon")):
        return "clear"
    return "unknown"


# ---------- Open-Meteo ----------


def build_hourly(om, now_ts, hours=48):
    """Uurrijen vanaf het huidige uur. Neerslag (mm) is het uur dat op het tijdstip BEGINT:
    Open-Meteo levert de som van het voorgaande uur, dus we lezen de waarde op t+1 uur."""
    h = (om or {}).get("hourly") or {}
    times = h.get("time") or []
    idx = {t: i for i, t in enumerate(times)}

    def g(key, t):
        arr = h.get(key)
        i = idx.get(t)
        if arr is None or i is None or i >= len(arr):
            return None
        return _num(arr[i])

    rows = []
    for t in sorted(idx):
        if t <= now_ts - 3600:
            continue
        if len(rows) >= hours:
            break
        desc, icon = weather_info(g("weather_code", t))
        isd = g("is_day", t)
        row = {
            "t": t, "temp": _r(g("temperature_2m", t)), "feels": _r(g("apparent_temperature", t)),
            "desc": desc, "icon": icon, "is_day": None if isd is None else bool(isd),
            "precip_mm": _r(g("precipitation", t + 3600), 2),
            "precip_prob": g("precipitation_probability", t),
            "uv": _r(g("uv_index", t)),
        }
        row.update(wind_fields(g("wind_speed_10m", t), g("wind_gusts_10m", t), g("wind_direction_10m", t)))
        rows.append(row)
    return rows


def model_current(om):
    c = (om or {}).get("current")
    if not c:
        return None
    desc, icon = weather_info(c.get("weather_code"))
    isd = _num(c.get("is_day"))
    out = {
        "source": "model", "time": c.get("time"), "temp": _r(_num(c.get("temperature_2m"))),
        "feels": _r(_num(c.get("apparent_temperature"))), "humidity": _num(c.get("relative_humidity_2m")),
        "precip_mm_h": _r(_num(c.get("precipitation")), 2), "desc": desc, "icon": icon,
        "is_day": None if isd is None else bool(isd),
        "pressure_msl": _r(_num(c.get("pressure_msl"))), "pressure_surface": _r(_num(c.get("surface_pressure"))),
    }
    out.update(wind_fields(_num(c.get("wind_speed_10m")), _num(c.get("wind_gusts_10m")), _num(c.get("wind_direction_10m"))))
    return out


# ---------- Buienradar ----------


def _station_ts(ts):
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(NL_TZ))
    return dt.timestamp()


def nearest_station(feed, lat, lon, now_ts, max_km=40, max_age_min=90):
    """Dichtstbijzijnde station met een temperatuurmeting die niet te oud is."""
    stations = ((feed or {}).get("actual") or {}).get("stationmeasurements") or []
    cands = []
    for st in stations:
        slat, slon = _num(st.get("lat")), _num(st.get("lon"))
        if slat is None or slon is None or _num(st.get("temperature")) is None:
            continue
        km = haversine_km(lat, lon, slat, slon)
        if km > max_km:
            continue
        ts = _station_ts(st.get("timestamp"))
        if ts is not None and now_ts - ts > max_age_min * 60:
            continue
        cands.append((km, st, ts))
    if not cands:
        return None
    km, st, ts = min(cands, key=lambda c: c[0])
    return st, round(km, 1), ts


def station_current(st, km, ts, now_ts, is_day=None):
    gust = ms_to_kmh(_num(st.get("windgusts")))
    out = {
        "source": "observed", "station": st.get("stationname"), "distance_km": km,
        "time": ts, "age_min": None if ts is None else max(0, int((now_ts - ts) // 60)),
        "temp": _r(_num(st.get("temperature"))), "feels": _r(_num(st.get("feeltemperature"))),
        "humidity": _num(st.get("humidity")), "precip_mm_h": _r(_num(st.get("precipitation")), 2),
        "desc": st.get("weatherdescription") or "Niet beschikbaar",
        "icon": icon_from_description(st.get("weatherdescription")), "is_day": is_day,
        "pressure_msl": _r(_num(st.get("airpressure"))),
    }
    out.update(wind_fields(ms_to_kmh(_num(st.get("windspeed"))), gust, _num(st.get("winddirectiondegrees"))))
    return out


def parse_raintext(text, now_ts, tz_name=NL_TZ):
    """Buienradar raintext: regels 'waarde|HH:MM', mm/u = 10^((waarde-109)/32), waarde 0 = droog."""
    tz = ZoneInfo(tz_name)
    now = datetime.fromtimestamp(now_ts, tz)
    pts, prev = [], None
    for line in (text or "").strip().splitlines():
        if "|" not in line:
            continue
        v, hm = line.strip().split("|", 1)
        try:
            val = float(v.replace(",", "."))
            hh, mm = hm.strip().split(":")[:2]
            dt = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
        except ValueError:
            continue
        if prev is None:
            if dt < now - timedelta(hours=6):
                dt += timedelta(days=1)
        else:
            while dt <= prev:
                dt += timedelta(days=1)
        prev = dt
        pts.append({"t": int(dt.timestamp()), "mm_h": 0.0 if val <= 0 else round(10 ** ((val - 109) / 32), 2)})
    return pts


# ---------- regenpak-advies ----------

ADVICE_TITLES = {"geen": "Geen regenpak nodig", "jas": "Regenjas meenemen",
                 "pak": "Regenpak aan", "onbekend": "Advies niet beschikbaar"}


def rain_advice(nowcast, hourly, now_ts, window_h, light, heavy, gust_limit, tz_name=NL_TZ):
    end = now_ts + window_h * 3600
    slots = []  # (start_ts, mm_h)
    nc_cover_end = None
    if nowcast:
        nc = [p for p in nowcast if now_ts - 300 < p["t"] <= end and p.get("mm_h") is not None]
        slots += [(p["t"], p["mm_h"]) for p in nc]
        if nc:
            nc_cover_end = max(p["t"] for p in nowcast)
    gusts = []
    for r in hourly or []:
        t = r["t"]
        if t + 3600 <= now_ts or t >= end:
            continue
        if r.get("gust_kmh") is not None:
            gusts.append(r["gust_kmh"])
        if r.get("precip_mm") is None:
            continue
        if nc_cover_end is not None and t + 3600 <= nc_cover_end:
            continue
        slots.append((max(t, now_ts), r["precip_mm"]))
    base = {"window_h": window_h, "peak_mm_h": None, "start_t": None, "gust_kmh": max(gusts) if gusts else None}
    if not slots:
        return {**base, "level": "onbekend", "title": ADVICE_TITLES["onbekend"],
                "reason": "Er zijn geen neerslaggegevens beschikbaar voor dit tijdvenster."}
    peak = max(mm for _, mm in slots)
    wet = [t for t, mm in sorted(slots) if mm >= light]
    start = wet[0] if wet else None
    gust = base["gust_kmh"]
    windy = gust is not None and gust >= gust_limit
    if peak >= heavy:
        level = "pak"
    elif peak >= light:
        level = "pak" if windy else "jas"
    else:
        level = "geen"
    if level == "geen":
        reason = f"Geen merkbare neerslag verwacht de komende {window_h} uur."
    else:
        when = "Nu al" if start <= now_ts + 300 else f"Vanaf {fmt_hm(start, tz_name)}"
        reason = f"{when} neerslag, piek ca. {str(round(peak, 1)).replace('.', ',')} mm/u"
        if gust is not None:
            reason += f", windstoten tot {round(gust)} km/u"
        reason += "."
        if level == "pak" and peak < heavy:
            reason += " Regen met veel wind."
    return {**base, "level": level, "title": ADVICE_TITLES[level], "reason": reason,
            "peak_mm_h": round(peak, 2), "start_t": start}


# ---------- luchtdruk ----------


def downsample(series, step=1800):
    out, last = [], None
    for t, v in series:
        b = t // step
        if b != last:
            out.append([t, v])
            last = b
    return out


def pressure_change(series, now_ts, hours, tol_s=2700, max_lag_s=5400):
    """Verschil tussen de laatste waarde en de waarde `hours` eerder, uit tijdgestempelde metingen."""
    pts = [(t, v) for t, v in series if t <= now_ts and v is not None]
    if not pts:
        return None
    cur_t, cur_v = max(pts, key=lambda p: p[0])
    if now_ts - cur_t > max_lag_s:
        return None
    target = cur_t - hours * 3600
    past_t, past_v = min(pts, key=lambda p: abs(p[0] - target))
    if abs(past_t - target) > tol_s:
        return None
    return round(cur_v - past_v, 1)


def pressure_trend(d3, d6=None):
    if d3 is None and d6 is not None:
        d3 = d6 / 2
    if d3 is None:
        return "onbekend"
    if d3 >= 1.0:
        return "stijgend"
    if d3 <= -1.0:
        return "dalend"
    return "stabiel"


TREND_NOTES = {
    "stijgend": "Een stijgende luchtdruk gaat vaak samen met rustiger of verbeterend weer. Dit is geen voorspelling.",
    "dalend": "Een dalende luchtdruk kan samengaan met naderend onrustiger weer, regen of meer wind. Dit is geen voorspelling.",
    "stabiel": "Een stabiele luchtdruk wijst meestal op weinig verandering in het weerpatroon. Dit is geen voorspelling.",
    "onbekend": "Er zijn nog onvoldoende gegevens om een trend te bepalen.",
}


def choose_pressure_series(observed, model, now_ts):
    obs = sorted((t, v) for t, v in observed if t <= now_ts and v is not None)
    if len(obs) >= 6 and obs[-1][0] - obs[0][0] >= 6 * 3600:
        return obs, "waarnemingen"
    return sorted((t, v) for t, v in model if v is not None), "model"


# ---------- totaalpayload ----------


def build_payload(location, om, feed, nowcast, nowcast_error, obs_samples, now_ts, window_h, opts, errors):
    lat, lon = location["lat"], location["lon"]
    tz = (om or {}).get("timezone") or NL_TZ
    hourly = build_hourly(om, now_ts, 48)
    mcur = model_current(om)

    current, station_info = None, nearest_station(feed, lat, lon, now_ts) if feed else None
    if station_info:
        st, km, ts = station_info
        current = station_current(st, km, ts, now_ts, mcur["is_day"] if mcur else None)
    if current is None:
        current = mcur or {}

    # UV
    daily = (om or {}).get("daily") or {}
    uv_max = None
    for t, v in zip(daily.get("time") or [], daily.get("uv_index_max") or []):
        if t <= now_ts:
            uv_max = _num(v)
    uv_now = hourly[0]["uv"] if hourly else None
    uv = {"value": uv_now, "max_today": _r(uv_max), "category": uv_category(uv_now),
          "series": [{"t": r["t"], "v": r["uv"]} for r in hourly[:12]],
          "source": "Open-Meteo (modelwaarde, geen meting)"}

    # Hitte (gevoelstemperatuur)
    feels = current.get("feels")
    basis = "gevoelstemperatuur"
    if feels is None and current.get("temp") is not None:
        feels, basis = current["temp"], "temperatuur (gevoelstemperatuur niet beschikbaar)"
    heat = {"temp": current.get("temp"), "feels": current.get("feels"), "indicator": "Gevoelstemperatuur",
            "unit": "°C", "basis": basis, "category": heat_category(feels),
            "series": [{"t": r["t"], "v": r["feels"]} for r in hourly[:12]],
            "source": "waarneming" if current.get("source") == "observed" else "Open-Meteo (model)"}

    # Luchtdruk
    h = (om or {}).get("hourly") or {}
    model_series = [(t, _num(v)) for t, v in zip(h.get("time") or [], h.get("pressure_msl") or [])]
    series, kind = choose_pressure_series([tuple(s) for s in obs_samples or []], model_series, now_ts)
    d3, d6 = pressure_change(series, now_ts, 3), pressure_change(series, now_ts, 6)
    trend = pressure_trend(d3, d6)
    if current.get("source") == "observed" and current.get("pressure_msl") is not None:
        p_cur, p_src = current["pressure_msl"], f"waarneming station {current.get('station')}"
    elif series:
        p_cur, p_src = _r(series[-1][1]), "Open-Meteo (model)"
    else:
        p_cur, p_src = None, None
    pressure = {
        "current": p_cur, "current_source": p_src, "kind": "zeeniveau (gemiddelde zeespiegel)",
        "surface_model": (mcur or {}).get("pressure_surface"),
        "series": downsample(series), "series_kind": kind,
        "series_source": ("Waarnemingen Buienradar-station (door deze integratie verzameld)" if kind == "waarnemingen"
                          else "Open-Meteo modelanalyse (geen eigen meting)"),
        "delta3": d3, "delta6": d6, "trend": trend, "note": TREND_NOTES[trend],
    }

    advice = rain_advice(nowcast, hourly, now_ts, window_h, opts["light_mm_h"], opts["heavy_mm_h"],
                         opts["gust_kmh"], tz)
    return {
        "now": int(now_ts), "timezone": tz, "location": location, "current": current,
        "hourly": hourly, "uv": uv, "heat": heat, "pressure": pressure,
        "nowcast": {"points": nowcast or [], "error": nowcast_error,
                    "source": "Buienradar (raintext, 5-minutenstappen)"},
        "rain_advice": advice, "errors": errors,
        "sources": ["Open-Meteo.com", "Buienradar.nl"],
    }
