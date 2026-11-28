# 인하월드 NPC 생성기 v0.2

Blender 4.3+. 프로젝트용 얼굴형·헤어·수염·안경·키(140–200cm)를 조합하고, 20관절과 공통 동작이 포함된 GLB를 내보냅니다. 이미 있는 임의 모델의 자동 리깅 도구는 아닙니다.

- **GUI:** Blender 설정 → Add-ons → Install from Disk에서 `INHA_NPC_Generator_Addon_v02.zip`을 설치한 뒤 활성화합니다. `templates/`의 템플릿을 열고, 3D 뷰의 N 메뉴 → **INHA NPC**에서 외형과 저장 위치를 지정합니다. Templates Folder는 저장소의 `templates/`를 선택합니다.
- **CLI:** 저장소 루트에서 `blender -b --python-exit-code 5 --python tools/inha-npc-generator/generate.py -- --base botany --height 172 --glasses round --name CampusSample`. 기본 결과 폴더는 현재 위치의 `inha-npc-output/`이고 `--output-dir`로 바꿀 수 있습니다.
- **63명 재생성:** 새 작업 폴더에서 Blender로 절대 경로의 `build.py -- 0 1`을 실행합니다(Blender 인자: `-b --python-exit-code 9 --python /절대경로/build.py -- 0 1`). 60명이 `models/`에 저장됩니다. 기존 생활 NPC 3명은 같은 작업 폴더에서 `python /절대경로/preserve_daily.py /저장소/apps/world`를 실행합니다. 생활 NPC의 소켓·애니메이션·관절 데이터는 보존합니다. 재생성된 GLB의 바이트는 Blender·내보내기 환경에 따라 달라질 수 있습니다. 배포 후보에 커밋된 정본 해시는 게임 쪽 `assets/npcs/refresh-72/manifest.json`입니다.

## 게임에서 보기
- 새 외형은 기본입니다. 로컬 검토 경로는 `/campus/?campusLife=roster`입니다. 대조용 `npcModels=legacy`를 붙이면 근거리·생활 NPC의 기존 외형으로 돌아오고 그 생성 모델을 요청하지 않습니다. 정석 로비의 새 안내 모델은 두 경우 모두 사용합니다.
- 이벤트 NPC를 제외한 63종가 저장소에 있습니다. 근거리 로더는 캠퍼스·비룡·일부 안내/상점 캐릭터만 최대 5개까지 요청·유지합니다. 인경호 생활 NPC 3개는 원래 생활 행동을 사용하는 전용 연결입니다. 앉기·소품 활동·실패 시 기존 외형 경로를 유지합니다.
- 좀비대학교의 NPC 9명은 퇴역하여 생성 목록과 게임 로딩에서 제외됩니다. 행사 맵과 과거 미니게임 코드는 보존합니다. 정석 로비 안내는 다른 NPC의 대조 옵션과 무관하게 방에 들어가면 새 모델을 불러옵니다.
- 얼굴·의상은 프로젝트 제작물과 가상 NPC 프리셋을 사용합니다. 실존 인물의 얼굴 스캔, 사진 원본, 학교 문장 파일은 포함하지 않습니다. 별도 교수 검토판 6종은 이 63종에 포함하지 않습니다.
- 이 제작 도구는 `tools/`에 있으며, Cloudflare 런타임에는 내보낸 GLB, 매니페스트, 로더만 포함합니다.

### 활동 리깅 추가
009(촬영)와 010(벤치)은 기본 일괄 생성 후 `rig_activity.py`로 활동 클립을 덧붙입니다. Python 3에 NumPy·SciPy가 필요합니다. 입력은 활동 클립을 넣기 전의 GLB이고 출력은 다른 경로여야 합니다. `photo`는 손 본에 카메라 소켓을, `seat`는 기존 생활 벤치 포즈를 호환 리그에 옮기며 변형된 바지 메시로 좌판 접촉점을 계산합니다.

```sh
python rig_activity.py photo models/INKYUNG_NPC_009.glb /저장소/apps/world/assets/npcs/inkyung-daily-v031/bench-sit.glb INKYUNG_NPC_009.glb
python rig_activity.py seat models/INKYUNG_NPC_010.glb /저장소/apps/world/assets/npcs/inkyung-daily-v031/bench-sit.glb INKYUNG_NPC_010.glb
```

같은 활동을 하는 다른 캐릭터에 전파하기 전에 체형·의상과 벤치 높이에 맞춰 다시 검수합니다. 그 외 미지원 활동 및 로딩·거리·실패 대비 기존 외형은 보존합니다.

003(나수현)과 012(가지안)에는 활동 모드 `read`를 적용합니다. 목적이 독서일 때 이동 중에는 기존 `Carry_Book_Walk`와 새 왼팔꿈치 소켓을 쓰고, 도착하면 펼친 책을 두 손으로 받칩니다. 012에는 `coffee`를 추가 적용합니다. 컵은 오른손에 연결되어 준비 → 한 모금 → 내리기 순으로 반복합니다. 말 걸기 중에는 활동 소품을 비우며, 대화 후 해당 활동이 이어질 때만 다시 표시합니다.

```sh
python rig_activity.py read models/INKYUNG_NPC_003.glb models/INKYUNG_NPC_003.glb NPC_003_read.glb
python rig_activity.py read models/INKYUNG_NPC_012.glb models/INKYUNG_NPC_012.glb NPC_012_read.glb
python rig_activity.py coffee NPC_012_read.glb NPC_012_read.glb NPC_012_read_coffee.glb
```

`photo`, `read`, `coffee`의 두 번째 경로는 사용하지 않습니다(동일 CLI 형태 유지). 이 두 NPC의 일정이나 상호작용 권한은 바꾸지 않습니다.
