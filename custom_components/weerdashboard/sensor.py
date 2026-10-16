"""Sensor met het regenpak-advies voor de thuislocatie."""
from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, VERSION

STATES = {"geen": "geen", "jas": "regenjas", "pak": "regenpak", "onbekend": "onbekend"}


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([RegenpakSensor(coordinator, entry), KledingSensor(coordinator, entry)])


class RegenpakSensor(CoordinatorEntity, SensorEntity):
    _attr_has_entity_name = True
    _attr_name = "Regenpak-advies"
    _attr_icon = "mdi:umbrella"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = list(STATES.values())

    def __init__(self, coordinator, entry):
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_regenpak"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, entry.entry_id)}, name="Weerdashboard",
                                            manufacturer="Weerdashboard", sw_version=VERSION)

    @property
    def native_value(self):
        adv = (self.coordinator.data or {}).get("rain_advice")
        return STATES.get(adv["level"]) if adv else None

    @property
    def extra_state_attributes(self):
        d = self.coordinator.data or {}
        adv = d.get("rain_advice") or {}
        return {"titel": adv.get("title"), "reden": adv.get("reason"), "venster_uur": adv.get("window_h"),
                "piek_mm_per_uur": adv.get("peak_mm_h"), "windstoten_kmh": adv.get("gust_kmh"),
                "locatie": (d.get("location") or {}).get("name"),
                "bron": "Buienradar (2 uur) en Open-Meteo (uurverwachting)"}


class KledingSensor(CoordinatorEntity, SensorEntity):
    """Kledingadvies voor de thuislocatie, op basis van gevoelstemperatuur, wind, regen en UV."""

    _attr_has_entity_name = True
    _attr_name = "Kledingadvies"
    _attr_icon = "mdi:hanger"

    def __init__(self, coordinator, entry):
        super().__init__(coordinator)
        self._attr_unique_id = f"{entry.entry_id}_kleding"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, entry.entry_id)}, name="Weerdashboard",
                                            manufacturer="Weerdashboard", sw_version=VERSION)

    @property
    def native_value(self):
        k = (self.coordinator.data or {}).get("clothing")
        return k["summary"][:255] if k else None

    @property
    def extra_state_attributes(self):
        d = self.coordinator.data or {}
        k = d.get("clothing") or {}
        return {"kleding": [i["label"] for i in k.get("items", [])], "reden": k.get("reason"), "opmerkingen": k.get("notes"),
                "venster_uur": k.get("window_h"), "gevoelstemperatuur_min": k.get("feels_min"), "gevoelstemperatuur_max": k.get("feels_max"),
                "windstoten_kmh": k.get("gust_kmh"), "uv_max": k.get("uv_max"), "locatie": (d.get("location") or {}).get("name"),
                "bron": "Open-Meteo (modelverwachting) en Buienradar"}
