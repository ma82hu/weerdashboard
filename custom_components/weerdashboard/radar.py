"""KNMI-radar: tijdstappen en beelden ophalen via de WMS (met of zonder API-sleutel) en cachen."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

import aiohttp

from .api import HEADERS
from .radar_logic import (SOURCES, getmap_params, layer_dimensions, legend_params, plan_forecast,
                          plan_observed, validate_request)

_LOGGER = logging.getLogger(__name__)
BASE_KEY = "https://api.dataplatform.knmi.nl/wms/adaguc-server"
BASE_ANON = "https://anonymous.api.dataplatform.knmi.nl/wms/adaguc-server"
FRAMES_TTL = 150
IMG_TTL = 3 * 3600
MAX_IMAGES = 120
PNG = b"\x89PNG"


class RadarError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


class RadarService:
    def __init__(self, session: aiohttp.ClientSession, key_getter) -> None:
        self._s, self._key = session, key_getter
        self._frames = None
        self._images: dict = {}
        self._legends: dict = {}
        self._locks: dict = {}

    @property
    def mode(self):
        return "api_key" if (self._key() or "").strip() else "anonymous"

    async def _get(self, dataset, params):
        key = (self._key() or "").strip()
        base, headers = (BASE_KEY, {"Authorization": key}) if key else (BASE_ANON, {})
        try:
            async with self._s.get(base, params={"DATASET": dataset, **params}, headers={**HEADERS, **headers},
                                   timeout=aiohttp.ClientTimeout(total=25)) as r:
                if r.status == 429:
                    raise RadarError("KNMI: aanvraaglimiet bereikt. Probeer het over enkele minuten opnieuw of "
                                     "gebruik een eigen API-sleutel.", 429)
                if r.status in (401, 403):
                    raise RadarError("KNMI: API-sleutel geweigerd. Controleer de sleutel in de instellingen.", 401)
                if r.status >= 400:
                    raise RadarError(f"KNMI gaf foutcode {r.status}.")
                return await r.read()
        except asyncio.TimeoutError as err:
            raise RadarError("KNMI reageert niet (time-out).") from err
        except aiohttp.ClientError as err:
            raise RadarError("KNMI is niet bereikbaar.") from err

    async def _caps(self, kind):
        src = SOURCES[kind]
        raw = await self._get(src["dataset"], {"SERVICE": "WMS", "request": "GetCapabilities"})
        return layer_dimensions(raw.decode("utf-8", "replace"), src["layer"])

    async def frames(self):
        now = time.time()
        if self._frames and now - self._frames[0] < FRAMES_TTL:
            return self._frames[1]
        async with self._locks.setdefault("frames", asyncio.Lock()):
            if self._frames and time.time() - self._frames[0] < FRAMES_TTL:
                return self._frames[1]
            errors, observed, forecast, ref = [], [], [], None
            obs_res, fc_res = await asyncio.gather(self._caps("obs"), self._caps("fc"), return_exceptions=True)
            if isinstance(obs_res, Exception):
                errors.append(f"Waargenomen radar: {obs_res}")
            else:
                try:
                    observed = plan_observed(obs_res["time"])
                except (KeyError, ValueError) as err:
                    errors.append(f"Waargenomen radar: tijdstappen onleesbaar ({err}).")
            if isinstance(fc_res, Exception):
                errors.append(f"Radarverwachting: {fc_res}")
            else:
                try:
                    ref, forecast = plan_forecast(fc_res["time"], fc_res["reference_time"], observed[-1] if observed else None)
                except (KeyError, ValueError) as err:
                    errors.append(f"Radarverwachting: tijdstappen onleesbaar ({err}).")
            result = {"observed": observed, "forecast": forecast, "ref": ref, "mode": self.mode, "errors": errors}
            if not observed and not forecast and self._frames:  # alles mislukt: oude lijst met melding
                old = dict(self._frames[1])
                old["errors"] = errors + ["Oudere tijdstappen getoond."]
                return old
            self._frames = (time.time(), result)
            return result

    async def image(self, kind, ts, ref):
        try:
            t, r = validate_request(kind, ts, ref, datetime.now(timezone.utc))
        except ValueError as err:
            raise RadarError(str(err), 400) from err
        key = (kind, ts, ref)
        hit = self._images.get(key)
        if hit and time.time() - hit[0] < IMG_TTL:
            return hit[1]
        async with self._locks.setdefault(key, asyncio.Lock()):
            hit = self._images.get(key)
            if hit:
                return hit[1]
            data = await self._get(SOURCES[kind]["dataset"], getmap_params(kind, t, r))
            if not data.startswith(PNG):
                raise RadarError("KNMI gaf geen radarbeeld terug voor dit tijdstip.", 404)
            self._images[key] = (time.time(), data)
            if len(self._images) > MAX_IMAGES:
                for k, _ in sorted(self._images.items(), key=lambda kv: kv[1][0])[: len(self._images) - MAX_IMAGES]:
                    self._images.pop(k, None)
        self._locks.pop(key, None)
        return data

    async def legend(self, kind):
        if kind not in SOURCES:
            raise RadarError("Onbekend type legenda.", 400)
        hit = self._legends.get(kind)
        if hit and time.time() - hit[0] < 86400:
            return hit[1]
        data = await self._get(SOURCES[kind]["dataset"], legend_params(kind))
        if not data.startswith(PNG):
            raise RadarError("KNMI gaf geen legenda terug.", 404)
        self._legends[kind] = (time.time(), data)
        return data

