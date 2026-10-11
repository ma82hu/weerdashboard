# Weerdashboard voor Home Assistant (fase 2)

Nederlandstalig weerdashboard als custom integratie met een eigen dashboardkaart.
Versie 0.2.0. Bedoeld voor Home Assistant 2026.9.

## Wat zit er in fase 1 en 2
- Actueel weer (waarneming van het dichtstbijzijnde Buienradar-station, anders modelgegevens, duidelijk gelabeld)
- Wind: kompasrichting (waaruit de wind komt), windroos, km/u, Beaufort, knopen, windstoten
- Uurverwachting voor 12, 24 of 48 uur (neerslag in mm, kans apart, ontbrekende waarden als "n.b.")
- Regenpak-advies met kiesbaar tijdvenster (1, 2 of 4 uur) en sensor `sensor.weerdashboard_regenpak_advies`
- **Radar (fase 2):** kaart met KNMI-radar van het afgelopen uur (waarneming) en 2 uur vooruit (KNMI-nowcast), met tijdlijn, afspelen/pauzeren, vorige/volgende, snelheid, legenda, in- en uitzoomen, verschuiven en je locatie gemarkeerd. Waarneming en verwachting hebben een eigen kleur in de tijdlijn en een eigen label.
- Regengrafiek komende 2 uur (Buienradar, mm/u)
- UV-zonkrachtmeter en hittekrachtmeter (gevoelstemperatuur), met verwachting komende uren
- Barometer met trend (3 en 6 uur) en grafiek over 24 uur, 48 uur en 7 dagen
- Thuislocatie en eigen locaties: toevoegen, wijzigen, verwijderen, favoriet, wisselen. Blijven bewaard na herstart.

**Nog niet aanwezig (fase 3):** windkaart met stroming, 3-uurstijdlijn en meerdaagse windverwachting, locatie kiezen op de kaart. Er staan geen knoppen voor deze onderdelen in de kaart.

**Buienradar en Buienalarm samenvoegen:** niet mogelijk. Buienradar biedt geen openbaar radarbeeld met tijdlijn en voor Buienalarm is geen openbare API met gebruiksvoorwaarden gevonden. Daarom gebruikt de radar de KNMI-radar. Buienradar levert de 2-uursgrafiek en de waarnemingen, als aparte, benoemde bron.

## Installatie
**Via HACS (aanbevolen)**
1. Zet de map van dit project in een eigen GitHub-repository (privé mag). Vervang in `custom_components/weerdashboard/manifest.json` de tekst `JOUW-GEBRUIKERSNAAM` door je GitHub-naam.
2. HACS → menu (⋮) → *Aangepaste repositories* → URL van je repository, categorie *Integratie* → Toevoegen.
3. Zoek "Weerdashboard" in HACS → Downloaden.
4. **Herstart Home Assistant.**

**Handmatig**
1. Kopieer de map `custom_components/weerdashboard` naar `/config/custom_components/weerdashboard`.
2. **Herstart Home Assistant.**

Daarna: Instellingen → Apparaten & services → Integratie toevoegen → **Weerdashboard**. Een tweede herstart is niet nodig. De kaart wordt automatisch geladen; vernieuw de browser met Ctrl+F5 als hij niet verschijnt.

## Dashboard toevoegen
Dashboard → bewerken → *Kaart toevoegen* → *Handmatig* en plak:
```yaml
type: custom:weerdashboard-card
```
Tip: kies bij de weergave het type *Paneel (1 kaart)* voor de volle breedte.

## Locaties
- Bij de eerste start wordt één locatie "Thuis" aangemaakt met de coördinaten van Home Assistant. Pas die aan via *Mijn locaties → Wijzig*; daarna is de thuislocatie volledig onafhankelijk van Home Assistant.
- *Mijn locaties*: zoek een plaatsnaam of postcode (zoekdienst Open-Meteo) of vul coördinaten in, geef een naam, sla op. Gebruik *Instellen als thuislocatie* om thuis te wijzigen.
- Alleen Home Assistant-beheerders kunnen locaties wijzigen. Andere gebruikers kunnen wel wisselen.
- Een gekozen locatie wordt per browser onthouden.

## KNMI API-sleutel voor de radar (aanbevolen)
De radar werkt ook zonder sleutel (anonieme toegang), maar die heeft een gedeelde limiet en kan tijdelijk geweigerd worden ("aanvraaglimiet bereikt"). Met een eigen gratis sleutel is het betrouwbaar.
1. Maak een account op https://developer.dataplatform.knmi.nl/ (let op: KNMI heeft het versturen van e-mail vanuit de portal tijdelijk uitgezet vanwege bots; lukt registreren niet, gebruik dan de anonieme toegang).
2. Ga naar *API Catalog* → *Web Map Service (WMS)* → *Request API Key* en bewaar de sleutel direct.
3. Home Assistant: Instellingen → Apparaten & services → Weerdashboard → *Configureren* → plak de sleutel bij *KNMI API-sleutel* → Verzenden. Een herstart is niet nodig.
De sleutel wordt door Home Assistant gebruikt en gaat nooit naar je browser.

## Configuratie
Instellingen → Apparaten & services → Weerdashboard → *Configureren*: KNMI API-sleutel, standaard tijdvenster, drempel regenjas (standaard 0,1 mm/u), drempel regenpak (1,0 mm/u) en windstootgrens bij regen (50 km/u).

Logica: geen neerslag boven de jasdrempel = geen pak. Tussen jas- en pakdrempel = regenjas, tenzij de windstoten de grens halen (dan regenpak). Vanaf de pakdrempel = regenpak. Zonder neerslagdata: "advies niet beschikbaar".

## Gegevensbronnen
| Bron | Gebruik | Sleutel | Voorwaarden |
|---|---|---|---|
| Open-Meteo.com | uurverwachting, UV, wind, luchtdruk, zoeken van plaatsen | geen | Gratis voor niet-commercieel gebruik, minder dan 10.000 aanroepen per dag. Bronvermelding. |
| Buienradar.nl JSON-feed | waarnemingen weerstations | geen | Vrij te gebruiken met bronvermelding en link naar buienradar.nl |
| Buienradar raintext | regen komende 2 uur | geen | Zelfde feed, dekking ongeveer 50–54°N en 1–9°O |

| KNMI Data Platform WMS | radarbeelden (waarneming `radar_reflectivity_composites`, verwachting `radar_forecast_2.0`) | optioneel, gratis | CC-BY-4.0. Met sleutel 1000 aanvragen per uur, anoniem veel minder (gedeeld, 1 per seconde per IP). |
| Leaflet (cdnjs.cloudflare.com) | kaartbibliotheek, wordt in je browser geladen | geen | Open source (BSD-2) |
| CARTO basemaps / OpenStreetMap | achtergrondkaart, in je browser geladen | geen | Gratis voor niet-commercieel gebruik met bronvermelding (staat in de kaart) |

Buienalarm wordt niet gebruikt: er is geen openbare, gedocumenteerde API met gebruiksvoorwaarden gevonden.

## Technische beperkingen
- Wind, UV en uurverwachting zijn **modelgegevens**, geen metingen. UV wordt zo gelabeld.
- Luchtdrukgrafiek: de integratie verzamelt metingen van het Buienradar-station. Zodra er ≥ 6 uur aan metingen is, worden die gebruikt. Daarvoor toont de grafiek de Open-Meteo-modelanalyse (gelabeld). Voor locaties die je zelden bekijkt wordt weinig verzameld; de thuislocatie wordt elke 10 minuten bijgewerkt.
- Het Buienradar-station moet binnen 40 km liggen en minder dan 90 minuten oud zijn, anders worden modelgegevens getoond.
- Buiten Nederland (bijv. België) werken uurverwachting, UV, wind en luchtdruk. De 2-uursregenverwachting werkt alleen binnen het Buienradar-dekkingsgebied.
- De banden van de hittemeter (Koud, Koel, Aangenaam, Warm, Heet, Zeer heet, Extreem heet) zijn een eigen indeling voor gevoelstemperatuur, geen officiële norm.
- Neerslag per uur is het uur dat op het getoonde tijdstip begint.
- Radar: er wordt één beeld per tijdstap voor heel Nederland en omgeving (ca. 49–56°N, 0–11°O) opgehaald en 3 uur in het geheugen van Home Assistant bewaard. Een nieuw beeld ontbreekt soms nog; dat wordt als "niet beschikbaar" getoond en nooit ingevuld met een verzonnen beeld.
- Radar: de kaartbibliotheek en achtergrondkaart worden door je browser van internet geladen. Zonder internet in de browser blijft de radar leeg (een melding verschijnt).
- Radar: kleurstijl en legenda komen rechtstreeks van KNMI (stijl `radar/nearest`). De legenda onder de knop *Legenda* toont wat de kleuren betekenen.
- Radar: de verwachting is een nowcast van KNMI, geen meting, en wordt elke 5 minuten ververst.

## Problemen oplossen
- **Kaart niet gevonden / "Custom element doesn't exist"**: Home Assistant herstarten, browser vernieuwen met Ctrl+F5.
- **"Weerdashboard-integratie niet gevonden"**: integratie nog niet toegevoegd via Apparaten & services.
- **Waarschuwing "niet bereikbaar"**: tijdelijk bronprobleem; de rest van het dashboard blijft werken. Controleer de internetverbinding van Home Assistant.
- **Radar blijft leeg of "aanvraaglimiet bereikt"**: plak een eigen KNMI-sleutel (zie boven) of wacht enkele minuten. "API-sleutel geweigerd" betekent een typefout of verlopen sleutel.
- **Radar: "Radarmodule niet geladen"**: na het updaten Home Assistant herstarten en de browser vernieuwen met Ctrl+F5.
- **Geen regenverwachting**: locatie ligt buiten het dekkingsgebied, of Buienradar reageert niet.
- **Meer details**: Instellingen → Systeem → Logboeken, zoek op `weerdashboard`.

## Bijwerken
Via HACS: *Bijwerken* → **Home Assistant herstarten** → browser vernieuwen (Ctrl+F5; in de app: frontend-cache opnieuw instellen). Handmatig: map vervangen en herstarten. Locaties en instellingen blijven behouden (opgeslagen in `/config/.storage/weerdashboard.*`).

## Verwijderen
1. Verwijder de kaart uit je dashboards.
2. Instellingen → Apparaten & services → Weerdashboard → Verwijderen.
3. Verwijder de integratie via HACS (of de map `custom_components/weerdashboard`) en herstart.
4. Optioneel: verwijder de bestanden `weerdashboard.locations` en `weerdashboard.pressure` uit `/config/.storage/`.

## Tests uitvoeren
`python3 -m unittest discover -s tests -v` (alleen standaardbibliotheek nodig). 54 tests dekken wind, UV, hitte, uurtabel, ontbrekende data, luchtdruk, regenpak-advies en de radar-tijdstappen.
