# KayKit Furniture Bits: basic-room chair

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

Only the fixed personal-room chair uses this model. The room-local anchor stays at
`[2.95, 0, 0.85]`, with uniform scale `0.5` and yaw `180` degrees to put the backrest
on the existing +Z side. The room root applies its existing Z reflection.
Scaled bounds are about 0.375 × 0.629 × 0.423 world units (width × height × depth).
The glTF references the colocated binary and texture; no remote asset dependency is added.

The existing box chair remains visible until the container is instantiated and attached.
A failed load keeps it visible for the lifetime of that scene. Room re-entry reuses
the same request/result; destroying the room ignores a late loader callback.
