"""Dunne asynchrone clients voor Open-Meteo en Buienradar."""
from __future__ import annotations

import aiohttp

from .const import VERSION

HEADERS = {"User-Agent": f"HomeAssistant-Weerdashboard/{VERSION}"}
OM_URL = "https://api.open-meteo.com/v1/forecast"
GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FEED_URL = "https://data.buienradar.nl/2.0/feed/json"
RAIN_URL = "https://gpsgadget.buienradar.nl/data/raintext"

OM_CURRENT = ("temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,is_day,"
              "wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,surface_pressure")
OM_HOURLY = ("temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,is_day,"
             "wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,pressure_msl")


class WeerApi:
    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._s = session
        self.session = session

    async def _get(self, url, params=None, as_json=True):
        async with self._s.get(url, params=params, headers=HEADERS,
                               timeout=aiohttp.ClientTimeout(total=20)) as r:
            r.raise_for_status()
            return await r.json(content_type=None) if as_json else await r.text()

    async def open_meteo(self, lat, lon):
        return await self._get(OM_URL, {
            "latitude": round(lat, 4), "longitude": round(lon, 4), "current": OM_CURRENT,
            "hourly": OM_HOURLY, "daily": "uv_index_max", "timezone": "auto", "timeformat": "unixtime",
            "past_days": 7, "forecast_days": 3, "wind_speed_unit": "kmh"})

    async def geocode(self, query):
        data = await self._get(GEO_URL, {"name": query, "count": 8, "language": "nl", "format": "json"})
        return [{"name": r.get("name"), "admin1": r.get("admin1"), "country": r.get("country"),
                 "lat": r.get("latitude"), "lon": r.get("longitude")} for r in data.get("results") or []]

    async def buienradar_feed(self):
        return await self._get(FEED_URL)

    async def raintext(self, lat, lon):
        return await self._get(RAIN_URL, {"lat": round(lat, 2), "lon": round(lon, 2)}, as_json=False)
