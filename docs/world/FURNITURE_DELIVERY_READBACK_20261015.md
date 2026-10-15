# Furniture canonical delivery readback — 2026-10-15

The canonical private asset function version 4 was deployed before runtime activation.
The existing public browser configuration supplied only its publishable application key;
no service-role credential or signed URL is recorded here or in the public repository.

## Verified evidence

- Completed UTC: 2026-10-15T03:46:51.847Z
- New five assets: canonical GET and HEAD returned 307, exact project/bucket/filename,
  no-store, no-referrer, and expected digest/length metadata.
- Storage GET and HEAD succeeded; all complete download SHA-256 and byte lengths matched.
- Storage CORS allowed the application origin (`Access-Control-Allow-Origin: *`).
- Legacy five canonical GET payloads matched the preserved v3 bytes; HEAD and immutable caching passed.
- Missing application key returned 401; unknown filename returned 404.

| Asset | Download bytes | SHA-256 |
| --- | ---: | --- |
| annyongi-character-chair-r2-70ec784f8796.glb | 3243832 | 70ec784f87966d43ef80ce4a742e9ce43a1a7d40312be00b9a569843edf190b8 |
| induck-character-nightstand-r1-01a2764ecb9c.glb | 4818556 | 01a2764ecb9c581f033e5fc35e4e97ddd027897865f3057a5948cb3ee1a48b77 |
| annyongi-character-bookshelf-r3-05b6fa9c384e.glb | 14752504 | 05b6fa9c384e92c62967da51ebad1b29769e0f503670510f060f2965a977f8f9 |
| official-rug-replacement-r1-f4ca31569bdf.glb | 214924 | f4ca31569bdf7e2a1220d290bd00f2d0e32fb99cbb0617aca963fc3834e83828 |
| official-bed-replacement-r2-44d3cdc7870c.glb | 187592 | 44d3cdc7870cce0b7bce5e1904308e2989eaca242b8800a5c8b2125efffc9d0c |
| induck-v3.glb | 88404 | 8aede8fd595dd84fda5460e375a18df49f6a91ba813ab7a952f75e768e8964eb |
| annyongi-flight-v1.glb | 331484 | 5cc0bc54905da5b87314b81691c229bc583ad1980794239634008cd3f0d834fb |
| induck-cap-v1.glb | 34788 | 8f84a7f937ef66232177d60e615d0002c4a10ae685a3ffb491e5c5e88ac7a6c3 |
| induck-backpack-v1.glb | 19224 | e3d1bbb60a903652333e82851ccf342b9f477449ff9288bf6fa90a95259c41dd |
| induck-hoodie-v1.glb | 29312 | 9d2f0bc5b7ce8e750f7b697c97b5e20b5399405271b6c5a3316302cf6200fbe8 |

## Runtime scope

Enable exactly the character chair R2, character nightstand R1, character bookshelf R3,
rug R1 and bed R2. The three retired sticker candidates remain disabled. Legacy sofa
bytes, ownership/catalog/saved layouts, placement compatibility, seat/stand safeguards,
loading deadlines and procedural failure fallback remain unchanged.

This verifies canonical delivery, not the deployed public API proxy, rendered appearance,
GPU frame rate, or global room-route connectivity. Public `/api/brand-asset` readback
is required after application deployment. GPU acceptance remains unmeasured.
