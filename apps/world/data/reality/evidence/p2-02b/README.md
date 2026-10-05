# P2-02B active research — 2026-09-25

This pass supersedes the **pond** hold in the earlier emergency closeout.
Original P2-01 evidence remains intact. No inference from non-canonical notes
is used as a geometry source.

## Pond: promoted

OSM Way 218264623 was retrieved directly from the public OSM API, followed by
its referenced nodes. Initial full-way requests returned 429; later individual
way and batch-node requests succeeded. `pond-source.json` preserves the exact
ordered coordinates, tags, IDs, version, source timestamp and retrieval time.
Contributor account identifiers are omitted. Source: ODbL, © OpenStreetMap contributors.

The [official Inha map](https://www.inha.ac.kr/kr/1121/subview.do) and its
[illustrated map](https://www.inha.ac.kr/sites/kr/files/campusmap_front.jpg)
identify the pond northeast of Main Hall and west of Student Center. The
[English campus map](https://uol.de/fileadmin/io/partnerhochschulen/asien/inha-university/uni-oldenburg-inha-campusplan.pdf)
corroborates the In-Kung Pond identity. This is Rule B identity/location
corroboration; the illustration is not a surveyed boundary. OSM is the sole
coordinate source. No official survey accuracy or 2026 physical survey is claimed.

- Way version 7, timestamp 2017-03-18T17:04:18Z; tags `name=인경호`, `natural=water`.
- 13 unique vertices / 14 closed-ring pairs, clockwise in east/north axes.
- Area: 2,830.135100 m²; area-weighted centroid: 37.449664980476, 126.65596360247206.
- Bounds: latitude 37.449236–37.4501596; longitude 126.6555303–126.6563875.
- Centroid, area and bounds are derived in the existing campus local projection.
- No islands, gazebo, bridge, or shore furnishings are represented by this outer-ring source.

## Student Center: live authority conflict remains

`student-center-revalidation.json` contains the exact WFS query, raw-response
hash, two extracted government features, IDs, complete geometry, attributes,
calculated areas and separate building-register query URLs. The public WFS
and point-query ledger were both fetched again; no credentials were needed.

The live WFS geometry associated with GIS ID `1980169232404388511200000000`,
building ID `12163`, dong `7동 (7호관 학생회관)` reproduces the old Feature #39.
It is one MultiPolygon member with one closed outer ring and **no holes**.
Its approximately 19,735 m² polygon is about 370.4% larger than the attached
4,195.01 m² register area. Full precision did not resolve the discrepancy.
It is not a locally truncated multipolygon or a missing-hole conversion.
No evidence establishes it as a compound Student Center footprint.

The [official building detail endpoint](https://www.inha.ac.kr/campusMap/kr/getMap.do?artclSeq=7)
places Student Center at **37.449682, 126.656588**, east of the pond.
This point lies in a different government polygon: GIS ID
`1983169543854386672600000000`, building ID `12093`, labelled
`5-5동 (5북서관)`. The point-query ledger at the official location independently
returns that same conflicting dong label. OSM Way 218038027 names the eastern
outline Student Center. The stored `7동` polygon and official campus Student
Center location therefore cannot currently be treated as the same physical entity.
The exact upstream cause of the association conflict is **unknown**.

The [AURUM record](https://www.aurum.re.kr/Bits/BuildingDoc.aspx?num=525&page=1&tb=E)
confirms six above-ground floors and 15,758 m² gross floor area. These attributes
do not resolve the spatial association. No Student Center footprint or runtime
mass is promoted, and no estimated height is written to canonical data.

## Other entities and geography

Main Hall's OSM outline was recovered for future corroboration, without changing
its existing blockout/collision/tour. Buildings 6/9 remain unresolved and are not
implemented. No other candidate is automatically promoted from a dong label.

The promoted pond projects to X 103.415418–141.294192, Z -4.602240–46.747611 WU,
entirely inside C03_CENTRAL. Pond and Agora envelopes with a **10 WU (20 m)**
traversal/camera margin already fit the current world and combined C02/C03
coverage (the western margin crosses the existing C02/C03 seam).
World bounds therefore remain X -49–174, Z -145–104, and C01/C02/C03 remain the
three zones. No unnecessary C04/C05 zone or always-loaded campus mesh is added.
Legacy bounds are not an authority limit; a later verified footprint outside
them must drive expansion. Rejected/conflicting government geometry is not
included in the verified envelope.
