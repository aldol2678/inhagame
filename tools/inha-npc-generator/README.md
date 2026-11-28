# 인하월드 NPC 생성기 v0.4

Blender 4.3+. 프로젝트용 얼굴형·헤어·수염·안경·키(140–200cm)를 조합하고, 20관절과 공통 동작이 포함된 GLB를 내보냅니다. 이미 있는 임의 모델의 자동 리깅 도구는 아닙니다.

- **GUI:** Blender 설정 → Add-ons → Install from Disk에서 `INHA_NPC_Generator_Addon_v04.zip`을 설치한 뒤 활성화합니다. `templates/`의 템플릿을 열고, 3D 뷰의 N 메뉴 → **INHA NPC**에서 외형과 저장 위치를 지정합니다. Templates Folder는 저장소의 `templates/`를 선택합니다.
- **CLI:** 저장소 루트에서 `blender -b --python-exit-code 5 --python tools/inha-npc-generator/generate.py -- --base botany --height 172 --glasses round --name CampusSample`. 기본 결과 폴더는 현재 위치의 `inha-npc-output/`이고 `--output-dir`로 바꿀 수 있습니다.
- **63명 재생성:** 새 작업 폴더에서 Blender로 절대 경로의 `build.py -- 0 1`을 실행합니다(Blender 인자: `-b --python-exit-code 9 --python /절대경로/build.py -- 0 1`). 60명이 `models/`에 저장됩니다. 일괄 내보내기가 현재 인경호 6명의 활동 리깅도 자동으로 넣습니다. 기존 생활 NPC 3명은 같은 작업 폴더에서 `python /절대경로/preserve_daily.py /저장소/apps/world`를 실행합니다. 생활 NPC의 소켓·애니메이션·관절 데이터는 보존합니다. 재생성된 GLB의 바이트는 Blender·내보내기 환경에 따라 달라질 수 있습니다. 배포 후보에 커밋된 정본 해시는 게임 쪽 `assets/npcs/refresh-72/manifest.json`입니다.

## 게임에서 보기
- 새 외형은 기본입니다. 로컬 검토 경로는 `/campus/?campusLife=roster`입니다. 대조용 `npcModels=legacy`를 붙이면 근거리·생활 NPC의 기존 외형으로 돌아오고 그 생성 모델을 요청하지 않습니다. 정석 로비의 새 안내 모델은 두 경우 모두 사용합니다.
- 이벤트 NPC를 제외한 63종이 저장소에 있습니다. 근거리 로더는 캠퍼스·비룡·일부 안내/상점 캐릭터만 최대 5개까지 요청·유지합니다. 인경호 생활 NPC 3개는 원래 생활 행동을 사용하는 전용 연결입니다. 해당 동작 소켓이 없거나 로딩이 실패할 때만 그 활동에 기존 외형을 사용합니다.
- 좀비대학교의 NPC 9명은 퇴역하여 생성 목록과 게임 로딩에서 제외됩니다. 행사 맵과 과거 미니게임 코드는 보존합니다. 정석 로비 안내는 다른 NPC의 대조 옵션과 무관하게 방에 들어가면 새 모델을 불러옵니다.
- 얼굴·의상은 프로젝트 제작물과 가상 NPC 프리셋을 사용합니다. 실존 인물의 얼굴 스캔, 사진 원본, 학교 문장 파일은 포함하지 않습니다. 별도 교수 검토판 6종은 이 63종에 포함하지 않습니다.
- 이 제작 도구는 `tools/`에 있으며, Cloudflare 런타임에는 내보낸 GLB, 매니페스트, 로더만 포함합니다.

### 활동 리깅 골라 내보내기

**INHA NPC → 활동 리깅**에서 원하는 항목을 여러 개 선택하고 **Generate and Export GLB**를 누르세요. 선택은 내보낸 GLB에 반영됩니다. Blender의 외형 미리보기와 CLI가 보존하는 작업용 `.blend`에는 기존 기본 동작만 들어 있습니다. 카메라, 책, 컵, 휴대폰, 샌드위치 메시 파일을 GLB에 중복 삽입하지 않고, 게임에서 소켓에 연결합니다.

| 프리셋 | GLB에 포함되는 동작 |
|---|---|
| `seat` | 앉은 자세와 좌판 접점 |
| `photo` | 카메라 촬영 자세 |
| `read` | 왼팔로 책을 끼고 걷기와 양손 독서 |
| `coffee` | 컵 들기 → 마시기 → 내려놓기 |
| `phone` | 화면을 들어 자기 쪽으로 보고 내리기 |
| `snack` | 간식을 들고 한 입 베어 먹는 동작 |

```sh
blender -b --python-exit-code 5 --python tools/inha-npc-generator/generate.py -- --base botany --height 172 --name CampusSample --rig read --rig phone
```

- 기본 Blender 4.3+ 환경의 NumPy·mathutils로 동작하며 SciPy 설치는 필요하지 않습니다. Blender 밖에서 기존 GLB에 덧붙이는 이전 `rig_activity.py` CLI는 Python 3·NumPy·SciPy가 필요합니다. 이전 인터페이스의 두 번째 경로는 `seat`의 원본 벤치 참조에만 사용합니다.
- 일괄 프리셋: 003 책, 005 휴대폰, 006 간식, 009 사진, 010 좌판, 012 책·커피. 일괄 생성 시 자동 반영되며 이전 기본 파일에서 재개해도 이미 정상인 클립을 중복으로 추가하지 않습니다. 시작 전 생성 대상을 지정하고, 내보낸 모델의 체형과 의상을 실제 화면에서 확인하세요.
- 이 프리셋은 동일한 INHA 리그에 동작과 소켓을 추가하는 기능입니다. 임의의 외부 모델에 새 뼈대를 자동으로 붙이지 않습니다.
- 배포용으로 스테이징한 매니페스트와 GLB를 함께 검사하세요:
  `INHA_NPC_ASSETS=/path/to/stage/assets/npcs/refresh-72 node --test apps/world/tests/npc-generated-activity-rig.test.mjs`.

### 기존 NPC GLB에 동작만 추가하기 (v0.4)

1. 아무 Blender 씬에서 **INHA NPC → 기존 GLB에 동작 추가**를 열고, INHA NPC 생성기로 내보낸 원본 GLB를 고릅니다. 새로 템플릿을 열 필요는 없습니다.
2. **GLB 동작 확인**으로 이미 있는 동작을 보고, 위의 **활동 리깅**에서 원하는 동작을 선택합니다.
3. **새 GLB 저장 경로**에 아직 없는 파일명을 지정하고 **동작 추가 후 새 GLB 저장**을 누릅니다.

원본은 보존하고 새 동작과 필요한 소켓만 붙입니다. 기존 메시·재질·관절·동작은 그대로 남습니다. 같은 동작을 다시 고르면 중복되지 않으며, 전부 이미 있으면 새 파일을 만들지 않습니다. 외부 모델이나 호환되지 않는 GLB에는 새 뼈대를 붙이지 않습니다. 새 GLB를 게임에 적용하려면 게임 매니페스트의 크기와 SHA-256도 갱신해야 합니다.

검사: `python tools/inha-npc-generator/tests/test_patch_existing.py` (Python 3, NumPy, SciPy)
