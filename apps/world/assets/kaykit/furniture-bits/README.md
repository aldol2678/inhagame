# KayKit Furniture Bits: personal-room fixtures

Created by Kay Lousberg. Source: https://kaylousberg.itch.io/furniture-bits
Pack: `KayKit_Furniture_Bits_1.0_FREE.zip` (Furniture Bits 1.0).
Original pack SHA-256: `e6d75f34c5545486b5a8f45f86209dbd49092f3e77ae23011bdb87edab89e7e4`.

The following files are copied unmodified from the pack. The included original
`License.txt` grants CC0 use, including commercial use; credit is optional.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| License.txt | 860 | `cd8a847d4936a2aa1c97ef632808a8c9b9297ad1b1ac9fa069cf8490ada017af` |
| chair_A.bin | 16504 | `8db53212634ccc983dc0e9940f2809b3951abe91d0cc8ad040cf74d7100f19a8` |
| chair_A.gltf | 3022 | `fdc71044f23c89c5cff9093cff18bac295c9b750e73daf3cbd8ee6ca9e930dbb` |
| furniturebits_texture.png | 15605 | `de62db37a80d1801c3d9eb674890ae04b04469e0c149481a51fa250562c628dc` |
| lamp_standing.bin | 11648 | `ee58a9e2776406071c8ac60714f1b4dd7ad83a11848ee24aec77b297c9d535d9` |
| lamp_standing.gltf | 3034 | `ff42a083e688c94948493c441d4db51c7e0736336525b3eed4f4da75825b88b7` |
| shelf_B_large_decorated.bin | 25772 | `80b560eac9dd1d2750149f96f4845ead4c734f446088975a5c0a1c259dd50611` |
| shelf_B_large_decorated.gltf | 3069 | `fc613ad31e07529ad1ec9044a8e7e900821c8636efbd714a3238292326a49fad` |
| table_medium.bin | 9328 | `0e6ba8fd006f673d946979e45487067f4e274be9bbd07816fd371578d2a37518` |
| table_medium.gltf | 2973 | `fd5e5fe8bbf1d3729b6bd725165d58490e9cbd8dd46ce42314b01f20951a302b` |

The fixed personal-room chair uses `chair_A`. The room-local anchor stays at
`[2.95, 0, 0.85]`, with uniform scale `0.5` and yaw `180` degrees to put the backrest
on the existing +Z side. The room root applies its existing Z reflection.
Scaled bounds are about 0.375 × 0.629 × 0.423 world units (width × height × depth).
The glTF references the colocated binary and texture; no remote asset dependency is added.

The existing box chair remains visible until the container is instantiated and attached.
A failed load keeps it visible for the lifetime of that scene. Room re-entry reuses
the same request/result; destroying the room ignores a late loader callback.


The room also has three optional template decorations, each with a uniform scale of 0.5:

| Decoration | Asset | Room-local anchor | Yaw | Model offset |
| --- | --- | --- | ---: | --- |
| Reading table | table_medium | [-3.85, 0, -2.25] | 0 | [0, 0, 0] |
| Standing lamp | lamp_standing | [-4.65, 0, -3] | 0 | [0, 0.000001, 0] |
| West-wall decorated shelf | shelf_B_large_decorated | [-5.235, 1.32, -1.8] | 90 | [-0.125, 0.050001, 0] |

Each loads independently and retains its own placeholder on failure. The shelf is centred
using its one-sided source depth and lifted to correct its negative source Y pivot.
These are optional template decorations, not owned items: no prices, grants, catalog
entries, saved coordinates, or server reservations are introduced. A decoration yields
to a three-dimensional overlap with an owned placement and removes its collider;
moving/removing that placement restores the decoration without fetching another model.
Flat owned rugs can remain beneath floor decorations. Existing desk/bed placement
surfaces and saved layout validation remain unchanged.
