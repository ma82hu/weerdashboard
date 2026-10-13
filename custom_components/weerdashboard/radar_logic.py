"""Pure logica voor de radar (alleen standaardbibliotheek)."""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

NS = "{http://www.opengis.net/wms}"
SOURCES = {
    "obs": {"dataset": "radar_reflectivity_composites", "layer": "precipitation", "style": "radar/nearest"},
    "fc": {"dataset": "radar_forecast_2.0", "layer": "precipitation_nowcast", "style": "radar/nearest"},
}
# Dekking van de KNMI-composieten in EPSG:3857 (uit GetCapabilities).
BBOX_3857 = (0.0, 6257115.396264, 1208534.924976, 7553162.131589)
IMG_W, IMG_H = 1100, 1180
_R = 6378137.0
STEP = timedelta(minutes=5)
N_OBS = 13          # laatste uur aan waarnemingen (13 tijdstippen)
N_FC = 24           # 2 uur aan verwachting
_COMPACT = re.compile(r"^\d{8}T\d{6}Z$")


def merc_to_latlon(x, y):
    return math.degrees(math.atan(math.sinh(y / _R))), math.degrees(x / _R)


def bounds_latlon():
    s, w = merc_to_latlon(BBOX_3857[0], BBOX_3857[1])
    n, e = merc_to_latlon(BBOX_3857[2], BBOX_3857[3])
    return [[round(s, 5), round(w, 5)], [round(n, 5), round(e, 5)]]


def parse_iso(s):
    return datetime.fromisoformat(s.strip().replace("Z", "+00:00")).astimezone(timezone.utc)


def to_iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_compact(dt):
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def from_compact(s):
    if not isinstance(s, str) or not _COMPACT.match(s):
        raise ValueError("Ongeldig tijdstip.")
    return datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def parse_duration(s):
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", s.strip())
    if not m or not any(m.groups()):
        raise ValueError(f"Onbekende duur: {s}")
    d, h, mi = (int(g or 0) for g in m.groups())
    return timedelta(days=d, hours=h, minutes=mi)


def expand_dimension(value, last_n):
    """Laatste `last_n` tijdstippen uit een WMS-dimensie ('start/eind/PT5M', evt. kommagescheiden)."""
    out = set()
    for part in (value or "").split(","):
        part = part.strip()
        if not part:
            continue
        if "/" in part:
            start, end, step = part.split("/")
            start, end, step = parse_iso(start), parse_iso(end), parse_duration(step)
            t, k = end, 0
            while t >= start and k < last_n:
                out.add(t)
                t -= step
                k += 1
        else:
            out.add(parse_iso(part))
    return sorted(out)[-last_n:]


def layer_dimensions(xml_text, layer_name):
    """Dimensiewaarden {naam: tekst} van een laag in een WMS GetCapabilities-document."""
    root = ET.fromstring(xml_text)
    for layer in root.iter(f"{NS}Layer"):
        name = layer.find(f"{NS}Name")
        if name is not None and (name.text or "").strip() == layer_name:
            return {d.get("name"): (d.text or "").strip() for d in layer.findall(f"{NS}Dimension")}
    raise ValueError(f"Laag {layer_name} niet gevonden.")


def plan_observed(time_value):
    return expand_dimension(time_value, N_OBS)


def plan_forecast(time_value, ref_value, last_obs=None):
    """Verwachtingstijdstippen ref+5 min ... ref+2 uur, alleen na de laatste waarneming en binnen de dimensie."""
    refs = expand_dimension(ref_value, 1)
    times = expand_dimension(time_value, 60)
    if not refs or not times:
        return None, []
    ref, end = refs[-1], times[-1]
    fc = [ref + STEP * k for k in range(1, N_FC + 1)]
    fc = [t for t in fc if t <= end and (last_obs is None or t > last_obs)]
    return ref, fc


def validate_request(kind, ts, ref, now):
    """Voorkomt dat de proxy voor willekeurige tijdstippen bij KNMI vragen."""
    if kind not in SOURCES:
        raise ValueError("Onbekend type radarbeeld.")
    t = from_compact(ts)
    if kind == "obs":
        if not now - timedelta(hours=3) <= t <= now + timedelta(minutes=15):
            raise ValueError("Tijdstip buiten het toegestane bereik.")
        return t, None
    r = from_compact(ref)
    if not now - timedelta(hours=3) <= r <= now + timedelta(minutes=15):
        raise ValueError("Referentietijd buiten het toegestane bereik.")
    if not r < t <= r + timedelta(hours=2, minutes=5):
        raise ValueError("Tijdstip hoort niet bij deze verwachting.")
    return t, r


def getmap_params(kind, t, ref=None):
    src = SOURCES[kind]
    p = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": src["layer"], "STYLES": src["style"],
         "CRS": "EPSG:3857", "BBOX": ",".join(repr(v) for v in BBOX_3857), "WIDTH": str(IMG_W), "HEIGHT": str(IMG_H),
         "FORMAT": "image/png", "TRANSPARENT": "TRUE", "TIME": to_iso(t)}
    if kind == "fc":
        p["DIM_reference_time"] = to_iso(ref)
    return p


def legend_params(kind):
    src = SOURCES[kind]
    return {"version": "1.1.1", "service": "WMS", "request": "GetLegendGraphic", "layer": src["layer"],
            "format": "image/png", "STYLE": src["style"]}


def frame_urls(plan, sign):
    """Zet een tijdstappenplan om in frames met ondertekende URL's (pure helper)."""
    frames = []
    for dt in plan["observed"]:
        frames.append({"t": int(dt.timestamp()), "kind": "observed", "url": sign(f"/api/weerdashboard/radar/obs/{to_compact(dt)}")})
    if plan["ref"]:
        for dt in plan["forecast"]:
            frames.append({"t": int(dt.timestamp()), "kind": "forecast",
                           "url": sign(f"/api/weerdashboard/radar/fc/{to_compact(dt)}/{to_compact(plan['ref'])}")})
    return frames
