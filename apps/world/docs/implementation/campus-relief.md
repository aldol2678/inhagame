# 본관 대계단과 캠퍼스 상대 고도

중앙 잔디광장 쪽에서 본관 현관까지 오르는 계단을 2026년 10월 14일 답사 사진집 7·10·11쪽에 맞춰 재구성했다. 중앙의 밝은 석재 계단, 상부 참, 양옆의 사면과 관목 배치를 참고했다. 사진과 현장 복원 문서에는 단수나 표고 측량값이 없다. 게임 설정은 15단, 총 상승 1.35 WU, 폭 10.4 WU이다. 사진 원본은 드라이브에서 관리한다. [답사 사진집](https://drive.google.com/file/d/1SLA3BbhV222JMTA_GguS61xtE3j_4d_0/view) · [복원 명세](https://docs.google.com/document/d/18aB6eWjgrYuvEBI3rdCpF0U_CrgReat9/edit)

본관 외곽선 217958071과 광장 횡단로 481241692가 계단의 방향과 하단 범위를 결정한다. 481241657과 258995842는 수로 양편의 보행로다. 상부 참은 현관 문턱과 높이를 맞추고, 길찾기는 기존 본관 도착점을 거쳐 참까지 연결한다. [본관](https://www.openstreetmap.org/way/217958071) · [횡단로](https://www.openstreetmap.org/way/481241692)

## 캠퍼스 지형

인하대 교지 472447787 안의 녹지와 시설 사이 빈터에 인접 보행면을 기준으로 한 높낮이를 적용했다. 중앙 잔디는 답사 전경에 맞게 0.45 WU 이내로 완화했다. OSM은 평면 경계와 도로를 제공한다. 이번 캠퍼스 조회 범위에서 절대 표고를 뜻하는 `ele` 태그는 없었다. 넓은 지역의 상대적인 경향은 Mapzen Terrain Tiles를 썼다. 건물 근처 DEM 표본으로 계단 높이나 단수를 추정하지 않는다. 도로·시설·수면·운동장 및 정원 진입부에는 각각의 기존 기준면이 있다. [OSM 교지](https://www.openstreetmap.org/way/472447787) · [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) · [지형 데이터 저작자 표시](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)

고도 입력은 3 WU 간격의 삼각망으로 구웠다. 보행자는 화면과 같은 대각선으로 나눈 삼각형에서 높이를 읽는다. 전체 자료는 번들에 포함되며 게임 실행 중 OSM이나 DEM 서버에 접속할 필요가 없다. OSM 자료는 © OpenStreetMap contributors, ODbL. [OSM 라이선스](https://www.openstreetmap.org/copyright)

## 재현

OSM API bbox는 `126.6488,37.4455,126.6600,37.4537`이다. 2026-11-25 KST에 사용한 JSON 응답 SHA-256은 `4339c01ee2610e37e6026c429b20f550e01246b169850292e5a2c3831aeb8512`다. 공개 API의 현재 데이터는 바뀔 수 있다. 같은 시점의 추출본과 아래 타일로 같은 격자를 재현할 수 있다. [OSM 추출 요청](https://api.openstreetmap.org/api/0.6/map.json?bbox=126.6488,37.4455,126.6600,37.4537)

| Terrarium 타일 | SHA-256 |
|---|---|
| 14/13955/6351 | c8efe24695a255f722b0342762c8ae3611c60e1639bcf2e19ccc36bfea99661e |
| 14/13956/6351 | 4a6523f862570fbd610c115aba6549f94165260e4b8ddc8ca540c64cc5ed372d |

게임 소스 디렉터리에서 아래 명령을 실행한다. Python에는 Pillow, NumPy, SciPy가 필요하다. 마스크는 같은 버전의 게임 파일에서 추출한다.

```sh
python scripts/bake-campus-relief.py campus-osm.json tile-cache
node --test tests/campus-relief.test.mjs
node scripts/verify-cloudflare-live.mjs
```
