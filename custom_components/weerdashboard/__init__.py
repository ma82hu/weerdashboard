"""Weerdashboard: Nederlandstalig weerdashboard voor Home Assistant."""
from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import WeerApi
from .const import DOMAIN, STATIC_URL, VERSION
from .logic import DEFAULT_OPTIONS
from .manager import WeerManager
from .views import RadarView
from .ws import COMMANDS

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor"]


class RegenpakCoordinator(DataUpdateCoordinator):
    """Haalt elke 10 minuten het advies op voor de thuislocatie."""

    def __init__(self, hass, entry, manager):
        super().__init__(hass, _LOGGER, config_entry=entry, name=DOMAIN, update_interval=timedelta(minutes=10))
        self.manager = manager

    async def _async_update_data(self):
        try:
            return await self.manager.async_get_data(self.manager.home_id)
        except ValueError as err:
            raise UpdateFailed(str(err)) from err


def _options(entry):
    o = {**DEFAULT_OPTIONS, **entry.options}
    o["window_h"] = int(o["window_h"])
    return o


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    if "manager" not in data:
        manager = WeerManager(hass, WeerApi(async_get_clientsession(hass)))
        await manager.async_load()
        data["manager"] = manager
    manager = data["manager"]
    manager.options = _options(entry)

    if not data.get("frontend"):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), False)])
        add_extra_js_url(hass, f"{STATIC_URL}/weerdashboard-card.js?v={VERSION}")
        add_extra_js_url(hass, f"{STATIC_URL}/weerdashboard-radar.js?v={VERSION}")
        hass.http.register_view(RadarView(hass))
        for cmd in COMMANDS:
            websocket_api.async_register_command(hass, cmd)
        data["frontend"] = True

    coordinator = RegenpakCoordinator(hass, entry, manager)
    await coordinator.async_config_entry_first_refresh()
    data[entry.entry_id] = coordinator
    entry.async_on_unload(entry.add_update_listener(_reload))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def _reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return ok
