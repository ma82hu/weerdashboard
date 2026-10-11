import os, sys, unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "custom_components", "weerdashboard"))
import radar_logic as R  # noqa: E402

CAPS = """<?xml version="1.0"?><WMS_Capabilities xmlns="http://www.opengis.net/wms" version="1.3.0"><Capability>
<Layer><Title>WMS</Title><Layer queryable="1"><Name>precipitation_nowcast</Name>
<Dimension name="time" units="ISO8601" default="2026-10-10T17:55:00Z">2026-10-03T16:00:00Z/2026-10-10T17:55:00Z/PT5M</Dimension>
<Dimension name="reference_time" units="ISO8601" default="2026-10-10T15:55:00Z">2026-10-03T16:00:00Z/2026-10-10T15:55:00Z/PT5M</Dimension>
</Layer><Layer><Name>other</Name><Dimension name="time">2026-01-01T00:00:00Z</Dimension></Layer></Layer></Capability></WMS_Capabilities>"""
T = lambda s: R.parse_iso(s)
OBS = "2026-10-03T16:00:00Z/2026-10-10T15:50:00Z/PT5M"
FC_T, FC_R = "2026-10-03T16:00:00Z/2026-10-10T17:55:00Z/PT5M", "2026-10-03T16:00:00Z/2026-10-10T15:55:00Z/PT5M"


class Dim(unittest.TestCase):
    def test_duration(self):
        self.assertEqual(R.parse_duration("PT5M"), timedelta(minutes=5))
        self.assertEqual(R.parse_duration("PT1H"), timedelta(hours=1))
        self.assertEqual(R.parse_duration("P1D"), timedelta(days=1))
        with self.assertRaises(ValueError): R.parse_duration("5 minuten")

    def test_expand_last_n(self):
        t = R.expand_dimension(OBS, 3)
        self.assertEqual([x.strftime("%H:%M") for x in t], ["15:40", "15:45", "15:50"])
        self.assertEqual(len(R.expand_dimension(OBS, 13)), 13)

    def test_expand_list_and_single(self):
        t = R.expand_dimension("2026-10-10T10:00:00Z,2026-10-10T11:00:00Z/2026-10-10T11:10:00Z/PT5M", 10)
        self.assertEqual([x.strftime("%H:%M") for x in t], ["10:00", "11:00", "11:05", "11:10"])
        self.assertEqual(R.expand_dimension("", 5), [])

    def test_expand_short_interval(self):
        self.assertEqual(len(R.expand_dimension("2026-10-10T10:00:00Z/2026-10-10T10:10:00Z/PT5M", 50)), 3)

    def test_layer_dimensions(self):
        d = R.layer_dimensions(CAPS, "precipitation_nowcast")
        self.assertIn("reference_time", d); self.assertTrue(d["time"].endswith("PT5M"))
        self.assertEqual(R.layer_dimensions(CAPS, "other"), {"time": "2026-01-01T00:00:00Z"})
        with self.assertRaises(ValueError): R.layer_dimensions(CAPS, "bestaat_niet")


class Plan(unittest.TestCase):
    def test_observed(self):
        o = R.plan_observed(OBS)
        self.assertEqual(len(o), 13); self.assertEqual(o[-1], T("2026-10-10T15:50:00Z"))
        self.assertEqual(o[-1] - o[0], timedelta(hours=1))

    def test_forecast_after_last_observed(self):
        ref, fc = R.plan_forecast(FC_T, FC_R, T("2026-10-10T15:50:00Z"))
        self.assertEqual(ref, T("2026-10-10T15:55:00Z"))
        self.assertEqual(len(fc), 24); self.assertEqual(fc[0], T("2026-10-10T16:00:00Z")); self.assertEqual(fc[-1], T("2026-10-10T17:55:00Z"))
        self.assertEqual(sorted(fc), fc)

    def test_forecast_skips_frames_already_observed(self):
        ref, fc = R.plan_forecast(FC_T, FC_R, T("2026-10-10T16:30:00Z"))
        self.assertEqual(fc[0], T("2026-10-10T16:35:00Z"))

    def test_forecast_limited_by_dimension_end(self):
        ref, fc = R.plan_forecast("2026-10-03T16:00:00Z/2026-10-10T16:30:00Z/PT5M", FC_R, None)
        self.assertEqual(fc[-1], T("2026-10-10T16:30:00Z")); self.assertEqual(len(fc), 7)

    def test_forecast_unavailable(self):
        self.assertEqual(R.plan_forecast("", "", None), (None, []))


class Validate(unittest.TestCase):
    NOW = T("2026-10-10T16:00:00Z")

    def test_ok(self):
        t, r = R.validate_request("obs", "20261010T155000Z", None, self.NOW)
        self.assertEqual(t, T("2026-10-10T15:50:00Z")); self.assertIsNone(r)
        t, r = R.validate_request("fc", "20261010T163000Z", "20261010T155500Z", self.NOW)
        self.assertEqual(r, T("2026-10-10T15:55:00Z"))

    def test_rejects(self):
        for args in [("obs", "20261010T120000Z", None), ("obs", "20261011T000000Z", None), ("obs", "nonsens", None),
                     ("obs", "20261010T155000", None), ("xx", "20261010T155000Z", None),
                     ("fc", "20261010T163000Z", None), ("fc", "20261010T155000Z", "20261010T155500Z"),
                     ("fc", "20261010T190000Z", "20261010T155500Z"), ("fc", "20261010T163000Z", "20261009T000000Z")]:
            with self.assertRaises(ValueError, msg=str(args)): R.validate_request(*args, self.NOW)


class Params(unittest.TestCase):
    def test_getmap(self):
        p = R.getmap_params("obs", T("2026-10-10T15:50:00Z"))
        self.assertEqual((p["LAYERS"], p["CRS"], p["TIME"]), ("precipitation", "EPSG:3857", "2026-10-10T15:50:00Z"))
        self.assertNotIn("DIM_reference_time", p)
        self.assertEqual(p["TRANSPARENT"], "TRUE"); self.assertEqual(len(p["BBOX"].split(",")), 4)
        q = R.getmap_params("fc", T("2026-10-10T16:30:00Z"), T("2026-10-10T15:55:00Z"))
        self.assertEqual((q["LAYERS"], q["DIM_reference_time"]), ("precipitation_nowcast", "2026-10-10T15:55:00Z"))

    def test_aspect_ratio_matches_bbox(self):
        w = R.BBOX_3857[2] - R.BBOX_3857[0]; h = R.BBOX_3857[3] - R.BBOX_3857[1]
        self.assertAlmostEqual(R.IMG_H / R.IMG_W, h / w, delta=0.002)

    def test_bounds(self):
        (s, w), (n, e) = R.bounds_latlon()
        self.assertAlmostEqual(s, 48.8953, places=2); self.assertAlmostEqual(n, 55.9736, places=2)
        self.assertEqual(w, 0.0); self.assertAlmostEqual(e, 10.8565, places=2)

    def test_legend(self):
        self.assertEqual(R.legend_params("fc")["layer"], "precipitation_nowcast")

    def test_compact_roundtrip(self):
        t = T("2026-10-10T15:50:00Z")
        self.assertEqual(R.from_compact(R.to_compact(t)), t)
        with self.assertRaises(ValueError): R.from_compact("2026-10-10")


class Frames(unittest.TestCase):
    def test_frame_urls(self):
        o = R.plan_observed(OBS); ref, fc = R.plan_forecast(FC_T, FC_R, o[-1])
        fr = R.frame_urls({"observed": o, "forecast": fc, "ref": ref}, lambda p: p + "?sig")
        self.assertEqual(len(fr), 37); self.assertEqual([f["t"] for f in fr], sorted(f["t"] for f in fr))
        self.assertEqual(fr[12]["kind"], "observed"); self.assertEqual(fr[13]["kind"], "forecast")
        self.assertTrue(fr[0]["url"].startswith("/api/weerdashboard/radar/obs/")); self.assertIn("/fc/20261010T160000Z/20261010T155500Z", fr[13]["url"])

    def test_no_forecast_without_ref(self):
        fr = R.frame_urls({"observed": R.plan_observed(OBS), "forecast": [], "ref": None}, lambda p: p)
        self.assertTrue(all(f["kind"] == "observed" for f in fr))


if __name__ == "__main__":
    unittest.main()
