# The Konkan Coast's ground

The grids in this folder (`height.bin`, `far.bin`, `cover.bin`) are 8 km (and, for `far.bin`, 24 km) of the coast of
Raigad, Maharashtra, round Kashid beach (18.44 N, 72.922 E), made by `tools/konkan.py` from:

- **Elevation:** SRTM 1 arc-second (Shuttle Radar Topography Mission), courtesy of the U.S. Geological Survey
  (NASA/NGA). Public domain. Read from the AWS Terrain Tiles' skadi tiles (Mapzen):
  https://s3.amazonaws.com/elevation-tiles-prod/skadi/N18/N18E072.hgt.gz and N18E073.hgt.gz.
  Changed: smoothed lightly, resampled every 10 m (40 m beyond the map), the coast shaped to WorldCover's waterline,
  the sea floor and the reservoir's basin given a depth.
- **Land cover:** © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA
  WorldCover consortium. ESA WorldCover 10 m 2021 v200, licensed under CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Tile N18E072:
  https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N18E072_Map.tif.
  Changed: resampled every 10 m, the sea (its open water reaching the map's west edge) told from inland water.
