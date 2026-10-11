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
from .const import DOMAIN, FEED_TTL, MAX_LOCATIONS, NOWCAST_TTL, OM_TTL
from .logic import DEFAULT_OPTIONS, build_payload, parse_raintext
from .radar import RadarService

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
        om = await self._cached(f"{k}:om", OM_TTL, lambda: self.api.open_meteo(lat, lon), errors, "Open-Meteo")
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
        payload = build_payload(loc, om, feed, nowcast, nc_err, self._pressure.get(loc["id"], []),
                                now, window, opts, errors)
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
