"""Locatiebeheer, caching en samenstellen van de gegevens."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import defaultdict

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .api import WeerApi
from .const import AIR_TTL, DOMAIN, FEED_TTL, MAX_LOCATIONS, NOWCAST_TTL, OM_TTL, WIND_POINT_TTL
from .logic import DEFAULT_OPTIONS, build_payload, parse_raintext
from .radar import RadarService
from .wind_logic import (DAILY_BUDGET, GRIDS, MINUTE_BUDGET, build_compare, build_grid, build_point,
                         grid_points, parse_multi, safe_tz)

_LOGGER = logging.getLogger(__name__)


class WeerManager:
    def __init__(self, hass: HomeAssistant, api: WeerApi) -> None:
        self.hass, self.api = hass, api
        self._store = Store(hass, 1, f"{DOMAIN}.locations")
        self._pstore = Store(hass, 1, f"{DOMAIN}.pressure")
        self.locations: list[dict] = []
        self.home_id: str | None = None
        self.options = dict(DEFAULT_OPTIONS)
        self._pressure: dict[str, list] = {}
        self._cache: dict[str, tuple[float, object]] = {}
        self._locks = defaultdict(asyncio.Lock)
        self.radar = RadarService(api.session, lambda: self.options.get("knmi_api_key", ""))
        self._signed: dict = {}
        self._weights: list = []   # (tijdstip, gewicht) van aanroepen naar Open-Meteo, voor de dag- en minuutlimiet

    # ----- opslag -----
    async def async_load(self):
        data = await self._store.async_load() or {}
        self.locations = data.get("locations") or []
        self.home_id = data.get("home_id")
        if not self.locations:  # eerste start: begin met de HA-locatie als startpunt; daarna volledig eigen beheer
            loc = {"id": uuid.uuid4().hex[:8], "name": "Thuis", "lat": round(self.hass.config.latitude, 5),
                   "lon": round(self.hass.config.longitude, 5), "favorite": True}
            self.locations, self.home_id = [loc], loc["id"]
            await self._save()
        elif self.get(self.home_id) is None:
            self.home_id = self.locations[0]["id"]
            await self._save()
        self._pressure = ((await self._pstore.async_load()) or {}).get("samples", {})

    async def _save(self):
        await self._store.async_save({"home_id": self.home_id, "locations": self.locations})

    def get(self, loc_id):
        return next((l for l in self.locations if l["id"] == loc_id), None)

    def payload(self):
        return {"home_id": self.home_id, "locations": self.locations}

    # ----- locaties -----
    async def save_location(self, loc_id, name, lat, lon, make_home=False):
        name = (name or "").strip()
        if not 1 <= len(name) <= 60:
            raise ValueError("De naam moet tussen 1 en 60 tekens lang zijn.")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("Ongeldige coördinaten.")
        if loc_id:
            loc = self.get(loc_id)
            if loc is None:
                raise ValueError("Locatie niet gevonden.")
            loc.update(name=name, lat=round(lat, 5), lon=round(lon, 5))
            self._cache = {k: v for k, v in self._cache.items() if not k.startswith(f"loc:{loc_id}")}
            self._pressure.pop(loc_id, None)
        else:
            if len(self.locations) >= MAX_LOCATIONS:
                raise ValueError(f"Maximaal {MAX_LOCATIONS} locaties.")
            loc = {"id": uuid.uuid4().hex[:8], "name": name, "lat": round(lat, 5),
                   "lon": round(lon, 5), "favorite": False}
            self.locations.append(loc)
        if make_home or not self.home_id:
            self.home_id = loc["id"]
        await self._save()
        return loc

    async def delete_location(self, loc_id):
        if loc_id == self.home_id:
            raise ValueError("Dit is je thuislocatie. Stel eerst een andere locatie in als thuis.")
        if self.get(loc_id) is None:
            raise ValueError("Locatie niet gevonden.")
        self.locations = [l for l in self.locations if l["id"] != loc_id]
        self._pressure.pop(loc_id, None)
        await self._save()

    async def set_favorite(self, loc_id, fav):
        loc = self.get(loc_id)
        if loc is None:
            raise ValueError("Locatie niet gevonden.")
        loc["favorite"] = bool(fav)
        await self._save()

    async def set_home(self, loc_id):
        if self.get(loc_id) is None:
            raise ValueError("Locatie niet gevonden.")
        self.home_id = loc_id
        await self._save()

    # ----- bronnen met cache -----
    async def _cached(self, key, ttl, fetch, errors, label):
        now = time.time()
        hit = self._cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        async with self._locks[key]:
            hit = self._cache.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
            try:
                data = await fetch()
            except Exception as err:  # netwerk, HTTP of parsefout: de rest van het dashboard blijft werken
                _LOGGER.warning("%s ophalen mislukt: %s", label, err)
                if hit:
                    errors.append(f"{label}: tijdelijk niet bereikbaar, oudere gegevens getoond.")
                    return hit[1]
                errors.append(f"{label}: niet beschikbaar ({type(err).__name__}).")
                return None
            self._cache[key] = (time.time(), data)
            return data

    async def async_get_data(self, loc_id, window_h=None):
        loc = self.get(loc_id)
        if loc is None:
            raise ValueError("Locatie niet gevonden.")
        lat, lon, errors = loc["lat"], loc["lon"], []
        now = time.time()
        opts = {**DEFAULT_OPTIONS, **self.options}
        window = int(window_h or opts["window_h"])
        k = f"loc:{loc['id']}"
        async def _om():
            data = await self.api.open_meteo(lat, lon)
            self._spend(1.2)
            return data
        om = await self._cached(f"{k}:om", OM_TTL, _om, errors, "Open-Meteo")
        feed = None
        if 48 <= lat <= 56 and 0 <= lon <= 12:
            feed = await self._cached("feed", FEED_TTL, self.api.buienradar_feed, errors, "Buienradar-waarnemingen")
        nowcast, nc_err = [], None
        if 50 <= lat <= 54 and 1 <= lon <= 9:
            async def _nc():
                return parse_raintext(await self.api.raintext(lat, lon), time.time())
            nowcast = await self._cached(f"{k}:nc", NOWCAST_TTL, _nc, errors, "Buienradar-regenverwachting") or []
            if not nowcast:
                nc_err = "Regenverwachting voor 2 uur is nu niet beschikbaar."
        else:
            nc_err = "Deze locatie ligt buiten het dekkingsgebied van de Buienradar-regenverwachting."
        air_errors = []

        async def _air():
            data = await self.api.air_quality(lat, lon)
            self._spend(1)
            return data
        air = await self._cached(f"{k}:air", AIR_TTL, _air, air_errors, "Luchtkwaliteit")
        payload = build_payload(loc, om, feed, nowcast, nc_err, self._pressure.get(loc["id"], []),
                                now, window, opts, errors, air=air, air_error=None if air else (air_errors[0] if air_errors else None))
        payload["is_home"] = loc["id"] == self.home_id
        self._record_pressure(loc["id"], payload["current"])
        return payload

    def _record_pressure(self, loc_id, cur):
        if cur.get("source") != "observed" or cur.get("pressure_msl") is None or cur.get("time") is None:
            return
        samples = self._pressure.setdefault(loc_id, [])
        if samples and cur["time"] - samples[-1][0] < 540:
            return
        samples.append([int(cur["time"]), cur["pressure_msl"]])
        cutoff = time.time() - 7 * 86400
        self._pressure[loc_id] = [s for s in samples if s[0] >= cutoff]
        self._pstore.async_delay_save(lambda: {"samples": self._pressure}, 60)

    def sign(self, connection, path):
        """Ondertekende URL (2 uur geldig); hergebruikt zodat de browsercache blijft werken."""
        from datetime import timedelta
        from homeassistant.components.http.auth import async_sign_path

        now = time.time()
        self._signed = {k: v for k, v in self._signed.items() if v[0] - now > 600}
        k = (connection.refresh_token_id, path)
        if k not in self._signed:
            url = async_sign_path(self.hass, path, timedelta(hours=2), refresh_token_id=connection.refresh_token_id)
            self._signed[k] = (now + 7200, url)
        return self._signed[k][1]

    # ---- Open-Meteo budget ----
    def _spend(self, weight):
        self._weights.append((time.time(), weight))

    def _used(self, window):
        cutoff = time.time() - window
        self._weights = [w for w in self._weights if w[0] >= time.time() - 86400]
        return sum(w for t, w in self._weights if t >= cutoff)

    def _refund(self, weight):
        """Geeft gereserveerd budget terug als de aanvraag Open-Meteo niet bereikt of mislukt is."""
        for i in range(len(self._weights) - 1, -1, -1):
            if self._weights[i][1] == weight:
                del self._weights[i]
                return

    async def _reserve(self, weight):
        """Wacht kort als de minuutlimiet dreigt en weigert als het dagbudget op is."""
        if self._used(86400) + weight > DAILY_BUDGET:
            raise ValueError("Het dagelijkse aanroepbudget voor Open-Meteo is bijna op. Probeer het later opnieuw.")
        waited = 0
        while self._used(60) + weight > MINUTE_BUDGET and waited < 65:
            await asyncio.sleep(5)
            waited += 5
        self._spend(weight)

    # ---- wind ----
    async def async_get_wind_grid(self, kind, tz_name):
        if kind not in GRIDS:
            raise ValueError("Onbekend raster.")
        tz = safe_tz(tz_name)
        key, ttl, now = f"wgrid:{kind}", GRIDS[kind]["ttl"], time.time()
        hit = self._cache.get(key)
        errors = []
        if not hit or now - hit[0] >= ttl:
            async with self._locks[key]:
                hit = self._cache.get(key)
                if not hit or time.time() - hit[0] >= ttl:
                    lats, lons = grid_points(kind)
                    try:
                        await self._reserve(len(lats))
                        raw = parse_multi(await self.api.wind_grid(lats, lons), len(lats))
                        raw = [r.get("hourly") or {} for r in raw]
                        self._cache[key] = hit = (time.time(), raw)
                    except ValueError as err:   # budget op of onverwacht antwoord
                        if not hit:
                            raise
                        errors.append(f"{err} Oudere windgegevens getoond.")
                    except Exception as err:    # netwerk of HTTP
                        self._refund(len(lats))
                        _LOGGER.warning("Windraster ophalen mislukt: %s", err)
                        if not hit:
                            raise ValueError("Windgegevens zijn nu niet beschikbaar (Open-Meteo niet bereikbaar).") from err
                        errors.append("Open-Meteo niet bereikbaar. Oudere windgegevens getoond.")
        grid = build_grid(kind, hit[1], now, tz)
        grid["errors"] = errors
        grid["age_min"] = int((now - hit[0]) // 60)
        return grid

    async def async_get_wind_point(self, lat, lon):
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("Ongeldige coördinaten.")
        now, errors = time.time(), []
        key = f"wpoint:{round(lat, 2)},{round(lon, 2)}"

        async def fetch():
            await self._reserve(1)
            try:
                data = await self.api.wind_points([round(lat, 4)], [round(lon, 4)])
            except Exception:
                self._refund(1)
                raise
            return parse_multi(data, 1)[0]
        om = await self._cached(key, WIND_POINT_TTL, fetch, errors, "Open-Meteo")
        feed = None
        if 48 <= lat <= 56 and 0 <= lon <= 12:
            feed = await self._cached("feed", FEED_TTL, self.api.buienradar_feed, errors, "Buienradar-waarnemingen")
        if om is None:
            raise ValueError("Geen windgegevens beschikbaar voor dit punt. " + " ".join(errors))
        payload = build_point(om, feed, lat, lon, now)
        payload["errors"] = errors
        near = min(self.locations, key=lambda l: (l["lat"] - lat) ** 2 + (l["lon"] - lon) ** 2, default=None)
        payload["saved_id"] = None
        if near and abs(near["lat"] - lat) < 0.01 and abs(near["lon"] - lon) < 0.01:
            payload["saved_id"] = near["id"]
        return payload

    async def async_get_wind_compare(self, tz_name):
        locs = list(self.locations)
        tz, now, errors = safe_tz(tz_name), time.time(), []
        if not locs:
            return {"locations": [], "errors": []}
        key = "wcmp:" + ";".join(f"{l['id']}:{l['lat']},{l['lon']}" for l in locs)

        async def fetch():
            await self._reserve(len(locs))
            try:
                data = await self.api.wind_points([l["lat"] for l in locs], [l["lon"] for l in locs])
            except Exception:
                self._refund(len(locs))
                raise
            return parse_multi(data, len(locs))
        oms = await self._cached(key, WIND_POINT_TTL, fetch, errors, "Open-Meteo")
        if oms is None:
            raise ValueError("Vergelijken is nu niet mogelijk. " + " ".join(errors))
        return {"locations": build_compare(oms, locs, now, tz), "errors": errors, "timezone": tz}
