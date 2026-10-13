"""Constanten voor Weerdashboard."""
DOMAIN = "weerdashboard"
VERSION = "0.3.0"
STATIC_URL = "/weerdashboard_static"
OM_TTL = 900        # Open-Meteo: 15 minuten
FEED_TTL = 600      # Buienradar-feed: 10 minuten
NOWCAST_TTL = 300   # Buienradar raintext: 5 minuten
MAX_LOCATIONS = 50
WIND_POINT_TTL = 900   # klikpunt en vergelijking: 15 minuten
