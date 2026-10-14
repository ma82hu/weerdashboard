"""HTTP-view die radarbeelden doorgeeft. Vereist inloggen (ondertekende URL)."""
from __future__ import annotations

import os

from aiohttp import web

from homeassistant.components.http import HomeAssistantView

from .const import DOMAIN, STATIC_URL
from .radar import RadarError


class RadarView(HomeAssistantView):
    url = "/api/weerdashboard/radar/{kind}/{ts}"
    extra_urls = ["/api/weerdashboard/radar/{kind}/{ts}/{ref}"]
    name = "api:weerdashboard:radar"
    requires_auth = True

    def __init__(self, hass):
        self.hass = hass

    async def get(self, request, kind, ts, ref=None):
        mgr = (self.hass.data.get(DOMAIN) or {}).get("manager")
        if mgr is None:
            return web.Response(status=503, text="Weerdashboard is niet geladen.")
        try:
            data = await (mgr.radar.legend(ts) if kind == "legend" else mgr.radar.image(kind, ts, ref))
        except RadarError as err:
            return web.Response(status=err.status, text=str(err))
        return web.Response(body=data, content_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


class FrontendView(HomeAssistantView):
    """Serveert de kaartbestanden met `Cache-Control: no-cache`: browsers en de app controleren dan bij elk gebruik
    of er een nieuwere versie is (via ETag), in plaats van zelf te gokken hoe lang een oude kopie bruikbaar is."""

    url = STATIC_URL + "/{name}"
    name = "weerdashboard:frontend"
    requires_auth = False

    def __init__(self, directory, files):
        self._dir, self._files = directory, set(files)

    async def get(self, request, name):
        if name not in self._files:   # alleen bekende bestanden, geen willekeurige paden
            return web.Response(status=404, text="Niet gevonden")
        return web.FileResponse(os.path.join(self._dir, name), headers={"Cache-Control": "no-cache"})
