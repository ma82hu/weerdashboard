import os, sys, unittest
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "custom_components", "weerdashboard"))
import logic as L  # noqa: E402

TZ = ZoneInfo("Europe/Amsterdam")
NOW = int(datetime(2026, 10, 9, 14, 20, tzinfo=TZ).timestamp())
H14 = int(datetime(2026, 10, 9, 14, 0, tzinfo=TZ).timestamp())
OPTS = {"light_mm_h": 0.1, "heavy_mm_h": 1.0, "gust_kmh": 50.0}


def om(precip=None, gust=10, hours=50, **kw):
    t = [H14 - 3600 * 3 + 3600 * i for i in range(hours + 3)]
    n = len(t)
    h = {"time": t, "temperature_2m": [15.0] * n, "apparent_temperature": [14.0] * n,
         "precipitation": precip or [0.0] * n, "precipitation_probability": [20] * n,
         "weather_code": [3] * n, "is_day": [1] * n, "wind_speed_10m": [18.0] * n,
         "wind_gusts_10m": [gust] * n, "wind_direction_10m": [225] * n, "uv_index": [2.4] * n,
         "pressure_msl": [1010.0 + 0.2 * i for i in range(n)]}
    h.update(kw)
    return {"timezone": "Europe/Amsterdam", "hourly": h, "daily": {"time": [H14 - 14 * 3600], "uv_index_max": [4.2]},
            "current": {"time": NOW, "temperature_2m": 15.2, "apparent_temperature": 13.9, "weather_code": 3,
                        "is_day": 1, "wind_speed_10m": 18, "wind_gusts_10m": 30, "wind_direction_10m": 225,
                        "relative_humidity_2m": 70, "precipitation": 0, "pressure_msl": 1011.2, "surface_pressure": 1009.0}}


class Wind(unittest.TestCase):
    def test_kts(self):
        self.assertAlmostEqual(L.kmh_to_kts(1.852), 1.0)
        self.assertAlmostEqual(L.kmh_to_kts(37.04), 20.0, places=2)
        self.assertIsNone(L.kmh_to_kts(None))

    def test_beaufort(self):
        for kmh, b in [(0, 0), (1, 0), (5, 1), (20, 4), (38.0, 5), (39, 6), (61, 7), (88, 9), (117, 11), (118, 12), (200, 12)]:
            self.assertEqual(L.beaufort(kmh), b, kmh)
        self.assertIsNone(L.beaufort(None))

    def test_compass_is_direction_wind_comes_from(self):
        for deg, c in [(0, "N"), (360, "N"), (90, "O"), (180, "Z"), (225, "ZW"), (270, "W"), (348.7, "NNW"), (348.8, "N")]:
            self.assertEqual(L.compass(deg), c, deg)
        self.assertIsNone(L.compass(None))

    def test_wind_fields_missing_not_zero(self):
        f = L.wind_fields(None, None, None)
        self.assertTrue(all(v is None for v in f.values()))
        self.assertEqual(L.wind_fields(10, 20, 359.6)["dir_deg"], 0)

    def test_ms(self):
        self.assertAlmostEqual(L.ms_to_kmh(10), 36.0)


class Uv(unittest.TestCase):
    def test_categories(self):
        for uv, lab in [(0, "Laag"), (2.4, "Laag"), (2.5, "Matig"), (5, "Matig"), (6, "Hoog"), (7.4, "Hoog"),
                        (8, "Zeer hoog"), (10, "Zeer hoog"), (11, "Extreem"), (14, "Extreem")]:
            self.assertEqual(L.uv_category(uv)["label"], lab, uv)
        self.assertIsNone(L.uv_category(None))

    def test_heat(self):
        for v, lab in [(-3, "Vrieskou"), (0, "Koud"), (17.9, "Koel"), (18, "Aangenaam"), (25, "Warm"), (31, "Heet"),
                       (36, "Zeer heet"), (41, "Extreem heet")]:
            self.assertEqual(L.heat_category(v)["label"], lab, v)
        self.assertIsNone(L.heat_category(None))


class Hourly(unittest.TestCase):
    def test_order_and_start(self):
        p = om()
        p["hourly"]["time"].reverse()  # onjuiste volgorde moet toch chronologisch uitkomen
        for k in p["hourly"]:
            if k != "time":
                p["hourly"][k].reverse()
        rows = L.build_hourly(p, NOW, 48)
        self.assertEqual(len(rows), 48)
        self.assertEqual(rows[0]["t"], H14)
        self.assertEqual([r["t"] for r in rows], sorted(r["t"] for r in rows))

    def test_precip_is_hour_starting_at_t(self):
        n = 53
        pr = [0.0] * n
        pr[4] = 1.5  # waarde op H14+1u = som van uur 14:00-15:00
        rows = L.build_hourly(om(pr), NOW)
        self.assertEqual(rows[0]["t"], H14)
        self.assertEqual(rows[0]["precip_mm"], 1.5)
        self.assertEqual(rows[1]["precip_mm"], 0.0)

    def test_missing_values_stay_none(self):
        p = om()
        p["hourly"]["wind_gusts_10m"] = [None] * len(p["hourly"]["time"])
        p["hourly"].pop("uv_index")
        p["hourly"]["precipitation"] = [None] * len(p["hourly"]["time"])
        r = L.build_hourly(p, NOW)[0]
        self.assertIsNone(r["gust_kmh"]); self.assertIsNone(r["uv"]); self.assertIsNone(r["precip_mm"])
        self.assertEqual(L.build_hourly({}, NOW), [])

    def test_last_row_precip_missing_when_no_next_hour(self):
        p = om(hours=2)
        rows = L.build_hourly(p, NOW, 48)
        self.assertIsNone(rows[-1]["precip_mm"])

    def test_weather_codes(self):
        self.assertEqual(L.weather_info(65), ("Zware regen", "heavy_rain"))
        self.assertEqual(L.weather_info(None)[1], "unknown")
        self.assertEqual(L.weather_info(1234)[1], "unknown")


class Descriptions(unittest.TestCase):
    def test_icons(self):
        for d, i in [("Zonnig", "clear"), ("Half bewolkt", "partly"), ("Zwaar bewolkt", "cloudy"), ("Lichte regen", "rain"),
                     ("Zware regen", "heavy_rain"), ("Onweersbuien", "thunder"), ("Mist", "fog"), ("Lichte sneeuw", "snow"), (None, "unknown")]:
            self.assertEqual(L.icon_from_description(d), i, d)


class Buienradar(unittest.TestCase):
    FEED = {"actual": {"stationmeasurements": [
        {"stationname": "Ver", "lat": 53.0, "lon": 6.0, "temperature": 10, "timestamp": "2026-10-09T14:10:00"},
        {"stationname": "De Bilt", "lat": 52.10, "lon": 5.18, "temperature": 12.3, "feeltemperature": 10.1,
         "windspeed": 5.0, "windgusts": 9.0, "winddirectiondegrees": 200, "humidity": 80, "airpressure": 1012.3,
         "precipitation": 0.0, "weatherdescription": "Half bewolkt", "timestamp": "2026-10-09T14:10:00"},
        {"stationname": "Zonder temp", "lat": 52.09, "lon": 5.12, "temperature": None, "timestamp": "2026-10-09T14:10:00"},
        {"stationname": "Oud", "lat": 52.09, "lon": 5.12, "temperature": 9, "timestamp": "2026-10-09T09:00:00"}]}}

    def test_nearest(self):
        st, km, ts = L.nearest_station(self.FEED, 52.09, 5.12, NOW)
        self.assertEqual(st["stationname"], "De Bilt"); self.assertLess(km, 10)

    def test_none_when_too_far(self):
        self.assertIsNone(L.nearest_station(self.FEED, 50.0, 10.0, NOW))
        self.assertIsNone(L.nearest_station({}, 52, 5, NOW))

    def test_station_current_converts_once(self):
        st, km, ts = L.nearest_station(self.FEED, 52.09, 5.12, NOW)
        c = L.station_current(st, km, ts, NOW)
        self.assertEqual(c["source"], "observed"); self.assertEqual(c["wind_kmh"], 18.0)
        self.assertEqual(c["gust_kmh"], 32.4); self.assertEqual(c["bft"], 3); self.assertEqual(c["compass"], "ZZW")
        self.assertEqual(c["age_min"], 10)

    def test_raintext(self):
        pts = L.parse_raintext("000|14:20\n109|14:25\n141|14:30\nfout\n077|14:35", NOW)
        self.assertEqual([p["mm_h"] for p in pts], [0.0, 1.0, 10.0, 0.1])
        self.assertEqual(pts[0]["t"], NOW)

    def test_raintext_midnight(self):
        late = int(datetime(2026, 10, 9, 23, 50, tzinfo=TZ).timestamp())
        pts = L.parse_raintext("000|23:50\n000|23:55\n000|00:00\n000|00:05", late)
        self.assertEqual([b["t"] - a["t"] for a, b in zip(pts, pts[1:])], [300, 300, 300])
        self.assertEqual(L.parse_raintext("", NOW), [])


class Advice(unittest.TestCase):
    def hourly(self, mm=0.0, gust=15):
        return L.build_hourly(om([mm] * 60, gust=gust), NOW)

    def adv(self, nowcast, hourly, w=2):
        return L.rain_advice(nowcast, hourly, NOW, w, 0.1, 1.0, 50.0)

    def nc(self, vals):
        return [{"t": NOW + 300 * i, "mm_h": v} for i, v in enumerate(vals)]

    def test_geen(self):
        self.assertEqual(self.adv(self.nc([0.0] * 24), self.hourly())["level"], "geen")

    def test_jas(self):
        a = self.adv(self.nc([0, 0, 0.3, 0.4] + [0] * 20), self.hourly())
        self.assertEqual(a["level"], "jas"); self.assertIn("14:30", a["reason"])

    def test_pak_heavy(self):
        self.assertEqual(self.adv(self.nc([0, 2.1, 1.5] + [0] * 21), self.hourly())["level"], "pak")

    def test_pak_light_rain_with_wind(self):
        a = self.adv(self.nc([0.3] * 24), self.hourly(gust=70))
        self.assertEqual(a["level"], "pak"); self.assertIn("veel wind", a["reason"])

    def test_wind_without_rain_is_geen(self):
        self.assertEqual(self.adv(self.nc([0.0] * 24), self.hourly(gust=90))["level"], "geen")

    def test_rain_now(self):
        self.assertIn("Nu al", self.adv(self.nc([0.5] * 24), self.hourly())["reason"])

    def test_no_data_is_unknown_not_zero(self):
        a = self.adv([], [])
        self.assertEqual(a["level"], "onbekend"); self.assertIsNone(a["peak_mm_h"])
        none_rows = L.build_hourly(om([None] * 60), NOW)
        self.assertEqual(self.adv([], none_rows)["level"], "onbekend")

    def test_falls_back_to_hourly_without_nowcast(self):
        self.assertEqual(self.adv([], self.hourly(2.0))["level"], "pak")

    def test_window_4h_uses_hourly_beyond_nowcast(self):
        pr = [0.0] * 60
        pr[7] = 2.0  # uur 17:00-18:00 -> buiten 2 uur nowcast, wel binnen 4 uur... pas 17:00 start
        h = L.build_hourly(om(pr), NOW)
        nc = self.nc([0.0] * 24)
        self.assertEqual(self.adv(nc, h, 2)["level"], "geen")
        pr2 = [0.0] * 60
        pr2[6] = 2.0  # hour 16:00-17:00 start -> within 4h window
        self.assertEqual(self.adv(nc, L.build_hourly(om(pr2), NOW), 4)["level"], "pak")


class Pressure(unittest.TestCase):
    def series(self, hours=12, step=0.5, rate=-0.5):
        return [(NOW - int(i * 3600), 1010 + rate * (hours - i)) for i in range(hours, -1, -1)]

    def test_changes(self):
        s = [(NOW - 3600 * h, 1000.0 + (6 - h) * 0.5) for h in range(12, -1, -1)]  # +0,5 hPa/u
        self.assertEqual(L.pressure_change(s, NOW, 3), 1.5)
        self.assertEqual(L.pressure_change(s, NOW, 6), 3.0)

    def test_insufficient_data(self):
        self.assertIsNone(L.pressure_change([(NOW, 1010.0)], NOW, 3))
        self.assertIsNone(L.pressure_change([], NOW, 3))
        self.assertIsNone(L.pressure_change([(NOW - 3 * 3600 - 7200, 1000), (NOW, 1001)], NOW, 3))
        self.assertIsNone(L.pressure_change([(NOW - 10 * 3600, 1000)], NOW, 3))  # laatste meting te oud

    def test_trend(self):
        self.assertEqual(L.pressure_trend(1.0), "stijgend"); self.assertEqual(L.pressure_trend(0.9), "stabiel")
        self.assertEqual(L.pressure_trend(-1.0), "dalend"); self.assertEqual(L.pressure_trend(None), "onbekend")
        self.assertEqual(L.pressure_trend(None, -4), "dalend")

    def test_choose_series(self):
        model = [(NOW - 3600 * h, 1010.0) for h in range(10, 0, -1)]
        few = [(NOW - 600, 1011.0), (NOW, 1011.1)]
        s, k = L.choose_pressure_series(few, model, NOW); self.assertEqual(k, "model")
        obs = [(NOW - 3600 * h, 1011.0) for h in range(8, -1, -1)]
        s, k = L.choose_pressure_series(obs, model, NOW); self.assertEqual(k, "waarnemingen")

    def test_downsample(self):
        s = [(i * 600, 1000) for i in range(12)]
        self.assertEqual(len(L.downsample(s, 1800)), 4)


class Payload(unittest.TestCase):
    LOC = {"id": "a", "name": "Utrecht", "lat": 52.09, "lon": 5.12}

    def test_full_with_station(self):
        p = L.build_payload(self.LOC, om([0.0] * 60), Buienradar.FEED, [], "x", [], NOW, 2, {**L.DEFAULT_OPTIONS}, [])
        self.assertEqual(p["current"]["source"], "observed")
        self.assertEqual(p["uv"]["category"]["label"], "Laag"); self.assertEqual(p["uv"]["max_today"], 4.2)
        self.assertEqual(p["pressure"]["series_kind"], "model"); self.assertEqual(p["pressure"]["current"], 1012.3)
        self.assertEqual(len(p["hourly"]), 48)

    def test_model_when_no_station(self):
        p = L.build_payload(self.LOC, om(), None, [], None, [], NOW, 2, {**L.DEFAULT_OPTIONS}, [])
        self.assertEqual(p["current"]["source"], "model")
        self.assertEqual(p["heat"]["category"]["label"], "Koel")

    def test_everything_missing_does_not_crash(self):
        p = L.build_payload(self.LOC, None, None, [], "geen", [], NOW, 2, {**L.DEFAULT_OPTIONS}, ["fout"])
        self.assertEqual(p["hourly"], []); self.assertEqual(p["rain_advice"]["level"], "onbekend")
        self.assertIsNone(p["pressure"]["current"]); self.assertEqual(p["pressure"]["trend"], "onbekend")
        self.assertIsNone(p["uv"]["category"]); self.assertIsNone(p["heat"]["category"])


if __name__ == "__main__":
    unittest.main()
