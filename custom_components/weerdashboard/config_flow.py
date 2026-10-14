"""Configuratiestroom en opties."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import (NumberSelector, NumberSelectorConfig, NumberSelectorMode,
                                            SelectSelector, SelectSelectorConfig, SelectSelectorMode, TextSelector,
                                            TextSelectorConfig, TextSelectorType)

from .const import DOMAIN
from .logic import DEFAULT_OPTIONS


class WeerConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            return self.async_create_entry(title="Weerdashboard", data={})
        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return WeerOptionsFlow()


def _num(lo, hi, step, unit):
    return NumberSelector(NumberSelectorConfig(min=lo, max=hi, step=step, unit_of_measurement=unit,
                                               mode=NumberSelectorMode.BOX))


class WeerOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        o = {**DEFAULT_OPTIONS, **self.config_entry.options}
        schema = vol.Schema({
            vol.Required("window_h", default=str(o["window_h"])): SelectSelector(
                SelectSelectorConfig(options=["1", "2", "4"], mode=SelectSelectorMode.DROPDOWN,
                                     translation_key="window_h")),
            vol.Required("light_mm_h", default=o["light_mm_h"]): _num(0.05, 5, 0.05, "mm/u"),
            vol.Required("heavy_mm_h", default=o["heavy_mm_h"]): _num(0.1, 20, 0.1, "mm/u"),
            vol.Required("gust_kmh", default=o["gust_kmh"]): _num(20, 150, 1, "km/u"),
            vol.Optional("knmi_api_key", description={"suggested_value": o.get("knmi_api_key") or None}): TextSelector(
                TextSelectorConfig(type=TextSelectorType.PASSWORD)),
        })
        return self.async_show_form(step_id="init", data_schema=schema)
