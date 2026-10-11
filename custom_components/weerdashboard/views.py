"""HTTP-view die radarbeelden doorgeeft. Vereist inloggen (ondertekende URL)."""
from __future__ import annotations

from aiohttp import web

from homeassistant.components.http import HomeAssistantView

from .const import DOMAIN
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
