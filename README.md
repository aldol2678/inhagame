# INHAGAME

INHAGAME는 인하대학교를 배경으로 한 웹 게임들과 가상 캠퍼스 프로젝트 INHA WORLD의 공개 개발 저장소입니다.
(INHAGAME is the public development repository for a set of web games and INHA WORLD, a virtual campus project inspired by Inha University.)

> **License:** All Rights Reserved. 소스는 공개되어 있지만 오픈소스 라이선스가 아닙니다. See [License](#license).

## Projects

| App | Directory |
| --- | --- |
| INHA WORLD (게임 허브 / 가상 캠퍼스) | `apps/world` |
| 인하오리 Classic | `apps/classic` |
| 인덕업 | `apps/induckup` |
| 인덕이 키우기 | `apps/induck-grow` |
| 인덕 서바이벌 (Survival) | `apps/survival` |

## Repository Structure

```
apps/        web games and INHA WORLD (apps/shared holds shared client config)
supabase/    database schema/migrations, pgTAP and integration tests, edge functions
.github/     public CI workflow and check scripts
scripts/     local verification utilities
```

## Local Development

필요한 것: Node.js (CI uses 24.19.0), 그리고 DB 검증에는 Docker와 Supabase CLI 2.117.0.
Production 접근 권한이나 credential은 필요하지 않습니다.

```bash
git clone https://github.com/aldol2678/inhagame.git
cd inhagame
```

앱 실행 예시 (각 앱의 `package.json` / 스크립트 기준):

```bash
node apps/world/dev-server.mjs          # INHA WORLD, default port 8080
(cd apps/classic && npm run serve)      # Classic preview, http://127.0.0.1:4173
(cd apps/induckup && npm ci && npm run dev)
```

Public CI와 동일한 로컬 검증:

```bash
bash scripts/public-ci.sh   # static / unit / build checks
bash scripts/public-db.sh   # disposable local Supabase replay: pgTAP, integration, types
```

기본 클라이언트 endpoint는 `http://127.0.0.1:54321`(로컬 Supabase)이며 공개 키는 무해한 placeholder입니다
(`.env.example` 참고).

## Public / Production Boundary

This repository is the public development repository for INHAGAME.

Production credentials, deployment configuration, operational data,
staff access, incident/recovery tooling, and private operational overlays
are maintained separately.

Public GitHub Actions do not deploy directly to Production.

이 저장소는 INHAGAME의 공개 개발 저장소입니다. Production credential, 배포 설정, 운영 데이터, 운영진 접근 권한,
장애/복구 도구, 비공개 운영 오버레이는 별도로 관리되며, 공개 GitHub Actions는 Production에 직접 배포하지 않습니다.
포함된 데이터베이스와 계정 식별자는 로컬 일회용 개발용 합성 데이터입니다.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. `main`은 보호되어 있으며 변경은 Pull Request와 CI(`verify`) 통과를 거칩니다.

## Security

[SECURITY.md](SECURITY.md)를 참고하세요. 공개 Issue에 credential이나 취약점 세부 내용을 올리지 마세요.

## License

All Rights Reserved. 이 저장소의 공개는 MIT, Apache 등 오픈소스 라이선스를 부여하지 않습니다.
소스 열람은 가능하지만 사용, 복제, 배포 권한은 별도로 허가되지 않습니다. 제3자 자료의 권리와 고지는
[NOTICE.md](NOTICE.md)에 기록되어 있고, 대학 등 제3자의 상표 사용 허가나 보증은 암시되지 않습니다.
자세한 내용은 [LICENSE](LICENSE)를 참고하세요. 캐릭터/장비 아트워크는 독립 생성된 QA용 단순 도형이며
[ASSET_PROVENANCE.json](ASSET_PROVENANCE.json)에 기록되어 있습니다.

<!-- Temporary docs-only CI acceptance; this branch must not be merged. -->
