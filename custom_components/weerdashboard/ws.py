"""Websocket-commando's voor de frontendkaart."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api

from .const import DOMAIN
from .radar_logic import bounds_latlon, frame_urls


def _mgr(hass, connection, msg):
    mgr = (hass.data.get(DOMAIN) or {}).get("manager")
    if mgr is None:
        connection.send_error(msg["id"], "not_ready", "Weerdashboard is niet geladen.")
    return mgr


@websocket_api.websocket_command({vol.Required("type"): "weerdashboard/locations"})
@websocket_api.async_response
async def ws_locations(hass, connection, msg):
    if mgr := _mgr(hass, connection, msg):
        connection.send_result(msg["id"], mgr.payload())


@websocket_api.websocket_command({
    vol.Required("type"): "weerdashboard/data", vol.Required("location_id"): str,
    vol.Optional("window_h"): vol.In([1, 2, 4])})
@websocket_api.async_response
async def ws_data(hass, connection, msg):
    if not (mgr := _mgr(hass, connection, msg)):
        return
    try:
        connection.send_result(msg["id"], await mgr.async_get_data(msg["location_id"], msg.get("window_h")))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))


@websocket_api.websocket_command({vol.Required("type"): "weerdashboard/search", vol.Required("query"): str})
@websocket_api.async_response
async def ws_search(hass, connection, msg):
    if not (mgr := _mgr(hass, connection, msg)):
        return
    q = msg["query"].strip()
    if len(q) < 2:
        connection.send_result(msg["id"], [])
        return
    try:
        connection.send_result(msg["id"], await mgr.api.geocode(q))
    except Exception:  # noqa: BLE001
        connection.send_error(msg["id"], "unavailable", "De zoekdienst is nu niet bereikbaar.")


@websocket_api.websocket_command({
    vol.Required("type"): "weerdashboard/location_save", vol.Optional("location_id"): str,
    vol.Required("name"): str, vol.Required("lat"): vol.Coerce(float), vol.Required("lon"): vol.Coerce(float),
    vol.Optional("make_home", default=False): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass, connection, msg):
    if not (mgr := _mgr(hass, connection, msg)):
        return
    try:
        loc = await mgr.save_location(msg.get("location_id"), msg["name"], msg["lat"], msg["lon"], msg["make_home"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], {"location": loc, **mgr.payload()})


def _simple(cmd, extra, func_name):
    @websocket_api.websocket_command({vol.Required("type"): f"weerdashboard/{cmd}",
                                      vol.Required("location_id"): str, **extra})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def handler(hass, connection, msg):
        if not (mgr := _mgr(hass, connection, msg)):
            return
        try:
            args = [msg["location_id"]] + ([msg["favorite"]] if "favorite" in msg else [])
            await getattr(mgr, func_name)(*args)
        except ValueError as err:
            connection.send_error(msg["id"], "invalid", str(err))
            return
        connection.send_result(msg["id"], mgr.payload())
    return handler


ws_delete = _simple("location_delete", {}, "delete_location")
ws_home = _simple("location_home", {}, "set_home")
ws_favorite = _simple("location_favorite", {vol.Required("favorite"): bool}, "set_favorite")

@websocket_api.websocket_command({vol.Required("type"): "weerdashboard/radar_frames"})
@websocket_api.async_response
async def ws_radar(hass, connection, msg):
    if not (mgr := _mgr(hass, connection, msg)):
        return
    plan = await mgr.radar.frames()
    sign = lambda path: mgr.sign(connection, path)  # noqa: E731
    connection.send_result(msg["id"], {
        "bounds": bounds_latlon(), "frames": frame_urls(plan, sign), "mode": plan["mode"], "errors": plan["errors"],
        "ref": int(plan["ref"].timestamp()) if plan["ref"] else None,
        "legend": {"observed": sign("/api/weerdashboard/radar/legend/obs"),
                   "forecast": sign("/api/weerdashboard/radar/legend/fc")}})


COMMANDS = [ws_radar, ws_locations, ws_data, ws_search, ws_save, ws_delete, ws_home, ws_favorite]
