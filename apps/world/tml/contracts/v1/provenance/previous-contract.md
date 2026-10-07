# TML Evidence / Execution / Settlement Contract v1 — 설계안

상태: 제안 계약. 구현·배포 완료 선언이 아니다.

기준: 공개 `aldol2678/inhagame` main `84448a7285bfda56aa466b5bf6f1ce374a584e14` (P9, 2026-10-03 03:24 UTC 확인).
과거 private repository와 production schema는 근거로 사용하지 않았다.
현재 repository 변경, production migration, merge, deployment는 수행하지 않았다.

## A. Contract Overview

v1의 목표는 **누구의, 어느 world의, 어떤 실행에서, 어느 상태/거래를 관측했는지**를 잃지 않으면서 기존 P3–P9의 adapter와 순차 orchestration을 유지하는 것이다.

1. **Scope**는 tenant, world, principal, execution을 고정한다. session은 작업이 실제로 session-bound일 때만 포함한다. entity instance는 Fact의 subject로 구분한다.
2. **Execution**은 단일 mutation 명령이다. pipeline은 여러 execution을 묶는 상관관계일 뿐 새 transaction이 아니다.
3. **Receipt**는 특정 execution의 커밋과 실제 적용된 ledger effect를 증명한다. 전체 잔액의 차이는 거래 증명을 대신하지 않는다.
4. **Observation**은 신뢰된 reader가 읽은 결과와 snapshot을 연결한다. **Fact**는 그 관측에서 도출된 typed assertion이다.
5. **Claim**은 판정할 명제다. **Evidence**는 해당 Claim에 사용할 불변 입력 집합이다. **VerificationResult**는 그 입력에 대해 evaluator가 낸 결과다.
6. `source`라는 이름, `confidence: 1`, JSON 안의 `trusted: true`, hash만으로 권위가 생기지 않는다. host가 source binding과 scope를 확인해야 한다.
7. timeout은 실패가 아니다. mutation을 자동 retry하지 않고, 동일 execution의 상태·receipt를 read-only로 재조회한다.
8. 정산 claim, 현재 상태 claim, projection이 거래를 반영했는지에 대한 claim은 분리한다.

### 기존 구현과의 차이

- P3–P6: readback, UNKNOWN/CONFLICT, 한 번의 mutation 시도, 명시적 plan을 유지한다.
- P7: receipt와 wallet/EXP 관측을 함께 수집하는 구조를 유지하되, 거래 판정을 balance delta에서 receipt/ledger 연결로 바꾼다.
- P8: ordinary 단계와 최종 reward 단계를 분리하고 rewardVersion을 검사하는 개선을 유지한다. 이전 감사의 “rewardVersion 미검사”는 현재 P8에는 그대로 적용되지 않는다.
- P9: 브라우저 Main 2 runtime에 연결된 memory-only shadow observer도 확인했다. 요청·write·영속화·UI 제어를 하지 않는 진단 경계를 유지한다. MATCH를 v1 authoritative Verification으로 자동 승격하지 않는다.
- 공개 SQL의 `private.world_reward_result_v1`에는 userId, rewardTransactionId, grantEntryId, childTransactionId가 이미 있다. Quest 응답에서는 일부가 축약된다. v1은 기존 정보를 보존하는 별도 DTO를 우선한다.
- 공개 wallet에는 version이 있지만 모든 Quest/EXP/Inventory reader에 공통 revision 계약이 존재한다고 가정하지 않는다.

### 범위

최초 v1은 단일 권위 backend의 원자적 mutation과 committed receipt를 지원한다. 분산 transaction, saga, 자동 보상, 범용 scheduler, 새로운 microservice는 만들지 않는다. 일반 언어 문법·VM도 이번 계약의 대상이 아니다.

## B. Type Model과 규범

아래 MUST는 v1 구현이 지켜야 할 조건이다. TypeScript 표기는 설명용이며 JS 객체 identity에 의존하지 않는다. 각 schema는 이 문서의 형태/상태 불변조건도 검사해야 한다.

### B1. 공통 타입

```ts
type Id = string;       // ASCII: [A-Za-z0-9][A-Za-z0-9._:/-]{0,127}
type Digest = string;   // sha256:<64 lowercase hex>
type I64 = string;      // canonical decimal, -2^63 .. 2^63-1
type U64 = string;      // canonical decimal, 0 .. 2^64-1
type Time = string;     // YYYY-MM-DDTHH:mm:ss.ffffffZ
type Ref = { id: Id; digest: Digest };
type ProfileRef = { id: Id; revision: Digest };

interface Header {
  schema: string;       // allowlisted: tml.fact, tml.evidence, ...
  version: "1.0";       // shape + semantic rules + canonical encoding
  id: Id;
  profile: ProfileRef;
}

type Value =
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "integer"; value: I64 }
  | { type: "number"; value: number }  // finite IEEE-754 binary64
  | { type: "null" }
  | { type: "time"; value: Time }
  | { type: "ref"; value: Id }
  | { type: "list"; value: Value[] }
  | { type: "object"; value: Record<string, Value> };

interface Scope {
  tenantId: Id;
  worldId: Id;
  principal: { kind: "account" | "service"; id: Id };
  executionId: Id;
  sessionId?: Id;
}

interface EntityRef { type: Id; id: Id }
interface SnapshotRef {
  source: Id;
  stream: Id;    // one independently versioned resource/aggregate
  epoch: Id;     // changes on restore/reset that breaks monotonicity
  revision: U64;
}
```

`Id`는 case-sensitive이며 trim, case folding, Unicode normalization을 하지 않는다. 새 execution/session/transaction ID는 lowercase UUID 기반 opaque ID를 권장한다. ID는 권한 증표가 아니다. `I64/U64`는 `0` 또는 선행 0 없는 십진수이며 `+1`, `01`, `-0`을 금지한다. counter overflow 시 epoch를 몰래 바꾸지 않고 명시적 rollover 절차가 필요하다.

단일 tenant/world 설치도 Scope를 생략하지 않는다. 인증된 host binding의 고정 설정을 쓸 수 있으므로 tenant/world용 새 DB 컬럼을 즉시 만들 필요는 없다. 해당 backend가 그 partition에 전용이라는 binding 근거가 있어야 한다. client가 전달한 world 이름을 단순히 응답에 복사하는 방식은 허용하지 않는다.

`worldId`는 지속적인 권위/데이터 partition이다. render chunk, AREA, browser tab, 일시적 connection ID가 아니다. account-global economy를 여러 world에서 공유하려면 profile이 공통 경제 partition을 명시해야 하며 임의의 world로 relabel하지 않는다. spawn된 entity가 재사용되면 entity instance ID는 새로 발급한다.

### B2. Scope 필드의 의미

| 필드 | 필수/위치 | lifetime · 비교 | 직렬화 | privacy | cache/replay |
|---|---|---|---|---|---|
| principal | Scope 필수; account/service 구별 | 계정/서비스 incarnation 동안; kind+id exact | opaque Id | 이메일·닉네임·토큰 금지; 계정 연결 정보는 접근 제한 | account A/B 분리, 삭제 후 같은 ID 재사용 금지 |
| tenant | Scope 필수 | 설치/tenant incarnation; exact | Id | 고객 이름 대신 opaque ID | cache namespace 최상위 |
| world | Scope 필수 | 지속적 권위 partition; exact | Id | 비공개 world 존재 자체도 접근 제한 | 다른 world로 재사용 금지 |
| entity instance | Fact/Observation/Claim subject 필수 | 특정 entity instance; type+id exact | EntityRef | 비공개 item/NPC/user 연결 주의 | template ID를 instance ID로 대체 불가 |
| session | session-bound 작업만 Scope에 필수; 보통 account 경제 작업은 생략 | session lifetime; absent는 wildcard가 아님 | Id, 선택 필드 | 인증 bearer 금지; 브라우저/기기 식별 최소화 | session 종료가 과거 committed receipt를 무효화하지 않음; live session claim은 별도 |
| execution | Scope 필수 | 한 mutation 또는 한 read-only evaluation; 재사용 금지 | Id | UUID형 상관관계 ID, 민감 trace 접근 제한 | 다른 execution의 Fact/Evidence를 그대로 섞지 않음 |
| snapshot revision | Fact/Observation 필수 | 동일 source+stream+epoch 안에서만 U64 순서 비교 | SnapshotRef | 내부 DB LSN/주소 노출 대신 논리 revision | pinned snapshot을 재현; max(timestamp)로 최신 선택 금지 |
| source | Fact/Observation/Receipt 필수 | binding identity; 이름 비교는 권위 확인과 별개 | Id | server hostname/credential 대신 논리 ID | 같은 이름이라도 host admission 없으면 untrusted |
| observedAt | Observation 필수, Fact에는 중복 저장하지 않음 | 관측 timestamp; Time ordering은 가능하나 snapshot ordering 아님 | UTC 6자리 소수초 | 활동 시간은 개인정보 취급 | cache hit으로 시간을 새로 찍지 않음 |

Fact는 Scope와 SnapshotRef를 직접 보존하며 Observation의 값과 일치해야 한다. Evidence도 같은 Scope를 보존한다. 수신 측은 caller의 evaluation Scope와 각 record Scope를 대조한다. 하나라도 다르면 `INVALID/SCOPE_MISMATCH`이며 OR의 다른 참값으로 덮지 않는다.

공유 world Fact는 service principal로 별도 평가할 수 있다. v1 account Evidence 안에서 service principal을 wildcard처럼 받아들이지 않는다. 여러 Scope의 판단이 필요하면 별도 VerificationResult를 상위 정책이 소비한다.

### B3. Execution: 명령 상태와 관측 상태를 분리

```ts
interface ExecutionRequest {
  version: "1.0";
  profile: ProfileRef;
  scope: Scope;
  capability: Id;
  args: Record<string, Value>;
  target: EntityRef;
  preconditions: Ref[];  // scope-free static Claim templates; runtime Evidence refs forbidden
  expectedReward?: { id: Id; version: U64 };
  idempotencyKey: Id;
}

type KnownExecutionStatus =
  "NOT_STARTED" | "ACCEPTED" | "EXECUTING" | "SUCCEEDED" | "FAILED";

interface Execution extends Header {
  schema: "tml.execution";
  request: ExecutionRequest;
  requestFingerprint: Digest;
  status: KnownExecutionStatus;
  startedAt?: Time;
  completedAt?: Time;
  receipts: Ref[];
  failureCode?: Id;
}

type ExecutionLookup =
  | { status: KnownExecutionStatus; execution: Execution; observedAt: Time }
  | { status: "UNKNOWN" | "RECOVERABLE";
      scope: Scope; requestFingerprint: Digest;
      lastKnownStatus?: KnownExecutionStatus;
      reason: Id; observedAt: Time };

// conceptual host interface, not current deployed endpoints
submitExecution(request: ExecutionRequest): Promise<ExecutionLookup>;
getExecution(scope: Scope, fingerprint: Digest): Promise<ExecutionLookup>;
getReceipt(scope: Scope, receipt: Ref): Promise<Receipt>;
```

`UNKNOWN/RECOVERABLE`는 DB의 성공/실패를 덮어쓰는 상태가 아니라 조회 결과의 knowledge 상태다. 이 구분 없이는 이미 성공한 거래를 timeout 때문에 FAILED로 저장하게 된다.

| 상태 | 의미 | 허용되는 다음 동작 |
|---|---|---|
| NOT_STARTED | host가 아직 전송하지 않음; 또는 authority가 미실행을 확정 | 최초 submit 한 번. timeout 후 단순 NOT_FOUND로 이 상태를 주장할 수 없음 |
| ACCEPTED | authority가 scope/key/fingerprint를 durable하게 등록 | 원래 작업 진행, read-only 조회 |
| EXECUTING | 원래 실행이 진행 중 | read-only 조회. 새 mutation 시도 금지 |
| SUCCEEDED | 선언된 원자적 command가 commit되고 receipt가 조회 가능 | receipt 조회, verification. postcondition 만족과는 별개 |
| FAILED | authority가 이 execution의 mutation 미커밋을 확정한 terminal 결과 | read-only 조회. 새로운 실행은 명시적 새 의도/승인과 새 key 필요 |
| UNKNOWN | 전송/응답/조회 문제로 결과를 모름 | 조회 가능성 조사; 실패·미실행으로 추정 금지 |
| RECOVERABLE | 결과는 아직 모르지만 durable execution locator로 읽기 복구가 가능 | 같은 execution의 GET 재시도/backoff만 허용 |

NOT_STARTED는 local view일 수 있다. ACCEPTED 이후 상태는 trusted authority만 발행한다. 일반 전이는 NOT_STARTED→ACCEPTED→EXECUTING→SUCCEEDED/FAILED이며 중간 관측은 생략될 수 있다. terminal 상태를 timeout 또는 늦은 응답으로 되돌리지 않는다. `startedAt`은 실제 실행 시작 때, `completedAt`은 terminal 때 기록한다. 시작 전 거절의 FAILED는 startedAt 없이 completedAt을 가질 수 있다. 시간값은 인과관계의 대체물이 아니다.

**멱등성과 fingerprint**

- key namespace: `(tenant, world, principal, capability, idempotencyKey)`. session은 필요하면 fingerprint에 들어가지만 key namespace를 바꿔 중복을 피하는 수단으로 쓰지 않는다.
- request fingerprint는 version, pinned profile, tenant/world/principal/semantic session, capability, target, args, preconditions, expectedReward를 canonical encoding한 hash다. executionId, idempotencyKey, transport timestamp, trace ID, credential은 제외한다.
- 같은 key+fingerprint는 기존 canonical executionId/status/receipt만 반환한다. 다른 proposed executionId를 새 실행으로 등록하지 않는다. host는 반환된 canonical ID에 명시적으로 결합한다.
- 같은 key에 다른 fingerprint는 `INVALID/IDEMPOTENCY_CONFLICT`; 기존 실행은 손대지 않는다. 같은 executionId에 다른 request 역시 거부한다.
- 등록·실행 상태·business mutation·receipt 연결 사이에 crash로 중복 commit될 틈이 없어야 한다. 최소 구현은 기존 domain DB의 lock/unique constraint와 최종 mutation+receipt의 동일 transaction이다.
- 실행 key는 재사용하지 않는다. receipt 보존 기간이 끝나도 key를 신규 요청으로 취급하지 않는다. 최소 tombstone 또는 인증 namespace 폐기 정책이 필요하다. 조회 불가/만료는 `UNKNOWN/RETENTION_EXPIRED`이며 자동 재실행 근거가 아니다.
- 서버가 partial effect를 commit한 기존 FAILED 응답을 v1 FAILED로 번역하면 안 된다. 최초 adapter는 원자적 Quest 완료 경로로 제한한다. 커밋된 conditional SKIPPED는 receipt로 표현하고 settlement claim이 별도로 판정한다.

조회 API는 현재 인증으로 해당 principal/world의 읽기 권한을 재검사한다. 요청 JSON의 principal을 신뢰하지 않으며 다른 계정의 execution 존재 여부나 ledger를 노출하지 않는다. Failure Matrix의 INVALID는 내부 검증 결과이고 외부 오류 응답은 계정 열거를 막도록 제한할 수 있다.

### B4. Receipt: 거래 단위의 불변 증명

```ts
type LedgerEntry = {
  entryId: Id;                 // stable grant/ledger entry identity
  ledger: "wallet" | "exp" | "inventory";
  target: EntityRef;           // currency / skill-or-campus-exp / item instance-or-stack
  effect: "ADD" | "REMOVE";
  requested: I64;              // non-negative magnitude
  applied: I64;                // non-negative actual magnitude
  outcome: "APPLIED" | "SKIPPED";
  reason?: Id;
  transactionId?: Id;          // required iff APPLIED; actual child ledger tx
  after: SnapshotRef;          // source stream including this effect; SKIPPED = checked state
};

interface Receipt extends Header {
  schema: "tml.receipt";
  scope: Scope;
  source: Id;                  // trusted transaction/receipt authority binding
  transactionId: Id;           // logical domain commit ID, not native pointer or SQL xid
  requestFingerprint: Digest;
  capability: Id;
  target: EntityRef;
  reward?: { id: Id; version: U64 };
  committedAt: Time;
  entries: LedgerEntry[];      // complete effect set for this declared command
  postState: Ref[];            // optional content: Fact refs from the commit snapshot; [] allowed
}
```

- Receipt는 committed 상태만 표현한다. pending/failed 실행은 Execution으로 표현한다. mutation 결과에 의미 있는 partial/skip이 있으면 entries가 이를 숨기지 않아야 한다.
- reward capability에는 reward ID와 version이 필수다. non-reward capability는 reward 필드를 생략한다.
- 같은 scope/source/transactionId의 receipt body와 digest는 영구 불변이다. 둘이 다르면 `CONFLICT`다. 조회마다 `replayed:true`를 body에 넣어 digest를 바꾸지 않는다. replay 여부는 transport metadata다.
- APPLIED entry의 requested/applied는 양수이며 실제 child ledger transaction과 연결되어야 한다. SKIPPED는 applied=`0`, reason 필수, child transaction은 없을 수 있다. 같은 entry ID 중복은 INVALID다. 동일 target의 다른 entry는 허용되며 profile의 grant ID로 구분한다.
- wallet delta, EXP delta, inventory mutation은 entries의 ledger+target+effect+applied로 표현한다. 중복된 별도 총액 필드는 최소 v1에서 두지 않는다. 필요 시 checked I64 합계를 파생한다. overflow는 ERROR이며 wrap하지 않는다.
- receipt는 account, execution, request fingerprint, reward ID/version, capability/target을 모두 기대값과 대조한다. 현재 원장 관계로 확인할 수 없는 필드를 추정해 채우지 않는다.
- committedAt은 authority가 기록한 transaction timestamp이고 receipt는 commit 후에만 authoritative하게 노출된다. SQL `now()`를 실제 물리 commit 시각/순서로 해석하지 않는다. ordering은 source revision으로 한다.
- 단일 backend의 committed receipt authority가 child ledger 관계를 검증해 증명하면 매번 ledger 전체를 내려받을 필요는 없다. 서로 독립적인 backend라면 그 authority가 보증하지 않는 효과를 한 receipt로 합치지 않는다. 분산 정산은 v1 범위 밖이다.

**정산 claim의 최소 의미**

1. scope/execution/fingerprint가 일치한다.
2. trusted host에서 admission된 immutable committed receipt다.
3. reward ID/version, capability와 target이 기대값과 일치한다.
4. expected grant entry 집합과 actual entry 집합을 ID로 대조한다. 숨겨진 추가 debit/item removal을 허용하지 않는다. 기본은 EXACT effect set이며 허용된 SKIPPED 등은 pinned profile에 명시한다.
5. requested/applied/effect/outcome이 기대 조건을 만족한다.
6. receipt의 child ledger refs와 revision 연결을 transaction authority가 보증한다.

`postBalance == preBalance + reward`는 이 조건에 포함하지 않는다. 예: 시작 100, 보상 +180, 동시에 구매 -50, 현재 230이라도 해당 reward receipt가 올바르면 settlement는 SATISFIED다.

Projection claim은 별도다. 같은 source/stream/epoch의 projection revision이 receipt entry.after 이상이고 stream 계약이 “revision까지 모든 ledger effect를 반영”함을 보증해야 적용 확인이 된다. revision의 숫자 크기만으로 적용을 추정하지 않는다. 더 최신 projection의 balance가 receipt 당시 balance와 같을 필요는 없다. exact commit-state claim은 receipt.postState가 가리키는 불변 Fact를 쓴다.

### B5. Fact, Observation, Claim, Evidence, VerificationResult

```ts
interface Fact extends Header {
  schema: "tml.fact";
  scope: Scope;
  subject: EntityRef;
  predicate: Id;
  value: Value;
  source: Id;
  snapshot: SnapshotRef;
  observationId: Id;
}

interface Observation extends Header {
  schema: "tml.observation";
  scope: Scope;
  source: Id;
  snapshot: SnapshotRef;
  observedAt: Time;
  query: { subject: EntityRef; predicates: Id[] };
  facts: Ref[];
}

type Expr =
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
      subject: EntityRef; predicate: Id; value: Value }
  | { op: "exists"; subject: EntityRef; predicate: Id }
  | { op: "and" | "or"; args: Expr[] }
  | { op: "not"; arg: Expr }
  | { op: "true" }; // explicit empty precondition only; validator controls placement

type ClaimBody =
  | { kind: "STATE"; expr: Expr }
  | { kind: "SETTLEMENT"; expectedReward: { id: Id; version: U64 };
      expectedEffects: Array<{
        entryId: Id; ledger: "wallet"|"exp"|"inventory";
        target: EntityRef; effect: "ADD"|"REMOVE"; requested: I64; applied: I64;
        allowedOutcome: "APPLIED"|"SKIPPED";
      }>; effectSet: "EXACT" }
  | { kind: "PROJECTION_APPLIED"; receipt: Ref; entryIds: Id[] };

interface Claim extends Header {
  schema: "tml.claim";
  scope: Scope;
  body: ClaimBody;
}

interface Evidence extends Header {
  schema: "tml.evidence";
  scope: Scope;
  claim: Ref;
  frame: {
    phase: "PRE" | "POST" | "RECOVERY";
    snapshots: SnapshotRef[]; // exact cut selected by host, not latest-by-time
  };
  observations: Ref[];
  facts: Ref[];
  receipts: Ref[];
}

interface VerificationResult extends Header {
  schema: "tml.verification";
  scope: Scope;
  claim: Ref;
  evidence: Ref;
  status: "SATISFIED" | "UNSATISFIED" | "UNKNOWN" | "CONFLICT" | "INVALID" | "ERROR";
  reason: Id;
  checkedAt: Time;
}
```

Fact→Observation은 ID만, Observation→Fact는 digest 포함 참조를 사용한다. 서로의 digest를 포함하는 순환 hash를 만들지 않는다. host는 같은 bundle에서 ID를 해석하고 scope/source/snapshot 및 Observation의 facts 목록을 검증한다. Fact 단독을 authoritative 입력으로 받지 않는다. 같은 record ID에 서로 다른 내용이 있으면 INVALID다. Execution의 Header.id는 request.scope.executionId와 같아야 한다.

ExecutionRequest의 preconditions는 scope-free 정적 Claim template 참조다. execution마다 생성되는 Claim/Evidence 참조를 request fingerprint에 넣지 않는다. 그렇지 않으면 executionId를 직접 제외해도 참조 digest를 통해 간접적으로 fingerprint에 들어가게 된다. 실제 평가용 Claim은 template을 해당 Scope에 instantiate한 별도 record다.

**Admission: 신뢰된 입력의 수용**

- evaluator 앞에서 profile revision을 host allowlist와 대조한다. caller의 profile이 자신을 authority로 지정해도 신뢰하지 않는다.
- host binding은 허용된 provider, predicate/capability, principal/tenant/world, stream, 증거 형식을 연결한다. server credential과 binding 구현은 wire에 내보내지 않는다.
- JSON에는 host의 신뢰 판단을 자기 신고하는 필드를 두지 않는다. host가 admission한 record digest의 별도 메모리 상태를 관리한다. serialized bundle을 다른 프로세스에서 읽으면 재검증이 필요하다.
- 최초 v1은 authenticated host binding으로 충분하다. offline 서명 증거는 고정된 서명 profile, 키의 authority 범위, 만료/폐기, Scope와 전체 record 집합을 포괄하는 payload를 정한 후 활성화한다. signature 필드만 추가해서 권위가 생기지는 않는다.

**Snapshot / cache / replay**

- STATE claim은 최초 v1에서 단일 source/stream/epoch/revision의 일관된 snapshot을 사용한다. 서로 다른 revision을 같은 frame에 넣으면 INVALID. 같은 snapshot의 모순된 값은 CONFLICT다.
- PRE와 POST는 별도 Evidence다. mutation 시점에도 precondition이 필요하면 backend가 재검사/CAS해야 한다. pre-read는 lock을 대신하지 않는다.
- 여러 stream을 동시에 관측했다고 주장하는 atomic compound STATE는 최초 v1에서 지원하지 않는다. 별도 claim으로 나눈다. SETTLEMENT는 transaction receipt의 인과관계를 다루므로 여러 ledger를 포함할 수 있다.
- 서로 다른 source/stream의 revision은 비교하지 않는다. restore/reset은 epoch를 바꾼다. 이전 epoch를 단순히 최신 epoch보다 작은 것으로 취급하지 않는다.
- 오래된 snapshot도 historical claim replay에는 유효하다. 현재 상태를 요구하는 evaluation에서는 host의 minimum revision 또는 명시적 fresh-read 조건을 충족하지 못하면 UNKNOWN/STALE_SNAPSHOT이다. JSON timestamp나 가장 큰 revision을 임의로 선택해 freshness를 추정하지 않는다.
- cache key는 Scope/source/stream/epoch/revision/profile revision을 포함한다. 다른 execution으로 Fact를 그대로 옮기지 않는다. 필요하면 trusted reader가 원래 snapshot을 보존하는 새 Observation을 발행한다. cached observation의 observedAt을 갱신하지 않는다.
- 현재 backend에 durable revision이 없으면 기존 P3 read를 legacy로 유지한다. client sequence나 updatedAt을 v1 revision으로 꾸미지 않는다. strict STATE evidence 활성화 전에 해당 aggregate에만 revision 계약을 추가한다.
- provenance 또는 필요한 record가 없는 정상 참조는 UNKNOWN. 해석된 record의 Scope/타입/hash가 틀리면 INVALID. 잘못된 bundle을 버리고 새 입력으로 평가할 수 있지만 같은 INVALID 결과를 조용히 SATISFIED로 바꾸지 않는다.

**참조와 실행 재사용의 추가 불변조건**

- bundle의 version/profile revision과 각 record의 값은 같아야 한다. record 참조는 id와 digest를 모두 확인한다.
- session-bound execution의 과거 receipt는 session이 종료되어도 바뀌지 않는다. 새 로그인 session으로 조회할 때는 원래 Scope를 보존하고 현재 인증에서 동일 principal의 조회 권한을 별도로 확인한다.
- 이미 실행된 reward를 다른 executionId로 재포장하지 않는다. 같은 key의 재조회는 원래 execution에 결합하며, 별도 execution의 no-op/이미 완료 응답은 원래 거래를 자신이 실행했다는 증거가 아니다.
- 순수 P3 read 평가에도 격리용 executionId를 발급하지만 mutation journal이나 idempotency 등록은 필요 없다. durable Execution 모델은 mutation에 적용한다.
- structural set 배열은 hashing 전에 고정 정렬한다: receipt.entries/expectedEffects는 entryId, record Ref 집합은 id, frame.snapshots는 source/stream/epoch/revision 튜플이다. ID 중복은 reject한다. 이것은 schema의 명시적 정규화이며 일반 Value.list, expression.args, command args 배열은 절대 재정렬하지 않는다. snapshot revision 정렬은 숫자 기준이며 snapshot 간 인과 순서를 뜻하지 않는다.

### B6. Semantic Rules

| 항목 | v1 규칙 |
|---|---|
| string | Unicode scalar sequence. lone surrogate/잘못된 UTF-8은 INVALID. NFC/NFKC, trim, case folding을 하지 않으며 equality는 scalar sequence 일치 |
| boolean | true/false만 허용. 0/1, 문자열과의 coercion 없음 |
| integer | tagged I64 십진 문자열. 정확한 비교, checked 연산. 입력 범위 초과는 INVALID, 연산 overflow는 ERROR |
| number | finite IEEE-754 binary64. JSON decimal을 round-to-nearest ties-to-even으로 decode. 금액·고정소수점에는 사용하지 않음. 기본 evaluator는 비교만 제공하며 범용 부동소수 연산을 추가하지 않음 |
| number precision | binary64의 약 15–17자리. 절댓값 2^53-1을 넘는 정수값은 number로 금지하고 integer 사용. 비영 decimal의 0 underflow, overflow, NaN/Infinity는 INVALID |
| -0 | number admission 시 +0으로 정규화. integer 문자열 '-0'은 금지 |
| numeric equality | 같은 type 안에서 엄밀 비교. integer('1')과 number(1)은 eq=false/ne=true. ordering은 같은 numeric type만 허용. 다른 타입 간 ordering은 INVALID |
| null | `{type:'null'}`만 허용. value 필드 없음. missing Fact, 누락 field, null은 서로 다름 |
| object | key 순서와 무관하게 key 집합 및 각 typed value를 재귀 비교. 중복 JSON key는 raw decode 시 INVALID |
| list | 순서·길이가 의미를 가짐. 순서를 바꾸면 다른 값 |
| time | UTC만 허용. 연도 0001–9999, 실제 Gregorian 날짜, 초 00–59, 소수초 6자리. offset/생략된 소수초/leap second는 v1 wire에서 INVALID. legacy adapter에서만 명시 변환 |
| time comparison | 정규화된 Time은 같은 순간이면 같은 문자열. ordering은 microsecond instant 기준이며 locale/Date.parse에 의존하지 않음. JS는 필요 시 BigInt microseconds 사용 |
| identifier | 앞서 정의한 ASCII, case-sensitive, 정규화 없음. ref equality는 ID 일치지만 Scope 검사가 선행 |
| string ordering | v1에서 gt/gte/lt/lte 금지. UI locale collation을 의미 규칙에 포함하지 않음 |
| object/list ordering | 금지. eq/ne만 허용 |
| exists | authoritative Fact가 있으면 SATISFIED. value=null도 존재. Fact가 없는 것만으로는 UNKNOWN이며 부재를 추정하지 않음 |

판정 상태:

- SATISFIED: 유효하고 충분한 authoritative 입력이 claim을 충족한다.
- UNSATISFIED: 유효하고 충분한 입력이 claim을 충족하지 않는다. 통신 실패와 다르다.
- UNKNOWN: 필요한 사실/receipt/freshness/provenance를 확인할 수 없다.
- CONFLICT: 동일 scope·snapshot·predicate의 admitted authority 입력이 모순된다.
- INVALID: schema/type/Scope/hash/profile revision/operand가 계약을 위반한다.
- ERROR: evaluator 내부 장애, checked 연산 overflow, 실행 중 자원 고갈 등이다. claim의 참거짓이 아니다.

전체 입력의 admission/schema 검사를 먼저 수행한다. profile이 predicate 타입을 지정하면 Fact 값과 Claim literal 모두 그 타입이어야 한다. 아래 primitive equality의 이종 타입 규칙은 profile 검사를 우회시키는 허가가 아니다. INVALID/ERROR를 OR의 다른 참값으로 숨기지 않는다. 이후는 P4 규칙을 보존한다: AND 우선순위는 CONFLICT > UNSATISFIED > UNKNOWN > SATISFIED, OR는 SATISFIED > CONFLICT > UNKNOWN > UNSATISFIED. NOT은 SATISFIED/UNSATISFIED만 반전한다. AND/OR의 빈 배열은 INVALID. 조건 없는 precondition은 validator가 허용한 explicit true로 변환한다.

공통 입력 한도는 bundle당 1 MiB, value/expr depth=32, record 4096개다. 바이트는 UTF-8 wire bytes, root depth=0으로 계산한다. 모든 runtime이 동일하게 적용한다. 한도 초과는 INVALID/LIMIT_EXCEEDED. provider timeout은 보통 UNKNOWN, host 내부 장애는 ERROR다. profile의 추가 제약도 revision에 포함한다.

### B7. Canonical Encoding

[RFC 8785 JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)를 사용한다. JSON.stringify의 삽입 순서는 의미 규칙이 아니다.

```
canonicalBytes(payload) = UTF8(JCS(normalizeAndValidate(payload)))
digest(domain, payload) = 'sha256:' + hexLower(
  SHA256(UTF8(domain + '\n') || canonicalBytes(payload)))
```

- domain은 `TML1/record`, `TML1/request`, `TML1/profile`, `TML1/vector`의 고정 ASCII 중 하나다. 서로 다른 용도의 hash를 재사용하지 않는다.
- UTF-8, BOM 없음, 끝 newline 없음. JCS object key는 UTF-16 code unit 순서다. Unicode scalar 순서나 locale 순서로 대체하지 않는다.
- object 자체에 자기 digest를 넣지 않는다. Ref는 별도 object의 hash를 보존한다. Header version/profile pin/Scope를 포함한 전체 record를 hash한다.
- 표준 JSON.parse로 중복 key 정보를 잃은 뒤 검사해서는 안 된다. decoded key가 같은 경우, 예를 들어 'a'와 '\u0061'도 중복이다.
- arbitrary JS value는 입력이 아니다. undefined, Date, Map, class instance, function, cycle, BigInt 자체는 DTO화 전에 reject한다. I64는 문자열로 DTO화한다.
- canonical number의 1.0/1e0은 1, -0은 0이다. 각 runtime은 JCS 준수 binary64 printer를 사용한다. C++ iostream이나 Rust 기본 formatter를 검증 없이 사용하지 않는다.
- integer 십진 문자열을 JCS 과정에서 JSON number로 바꾸지 않는다.
- unknown extension에 필수 의미를 넣지 않는다. 최초 v1 core는 unknown field를 reject한다. 확장이 필요하면 profile이 이를 명시하고 revision을 pin한다.
- hash는 integrity/content identity를 제공할 뿐 authority나 기밀성을 제공하지 않는다.

### B8. Version과 ownership

wire `version: '1.0'`, domain `profile: {id, revision: content hash}`만 기본으로 둔다. shape/semantic/canonical 버전을 각각 나누지 않는다. 알 수 없는 version은 조용히 수용하지 않는다. reward.version과 snapshot.revision은 domain state이며 contract version이 아니다.

**결:** 기본 입력은 Claim+VerificationResult와 Evidence digest이며 필요할 때 Evidence/Receipt를 해석한다. 기존 authority/evaluator 결과를 다른 의미 규칙으로 덮어쓰지 않는다. policy verdict가 필요하면 별도 `GyeolDecision`으로 반환하고 policy revision과 소비한 VerificationResult digest를 참조한다. TML은 사실·명제 검증, 결은 명시된 policy 판단을 소유한다. 결이 wallet을 변경하거나 누락된 Receipt를 창작하지 않는다. 동일 TML 규칙의 다른 runtime 재검증은 허용되지만 별도 사양의 판정이 되어서는 안 된다.

**WorldForge:** world document, behavior definition, capability declaration, static validation report와 artifact digest를 생성할 수 있다. host의 권한 부여, Fact/Receipt source admission, account/economy authority는 생성하지 못한다. static validation 성공을 runtime Verification SATISFIED로 변환하지 않는다. 선언한 capability도 host allowlist의 승인을 거쳐야 binding된다.

**Multi-runtime:** JS/TS는 DTO와 I64 BigInt, Rust는 struct/enum+i64/u64+JCS, C++는 variant/int64_t/uint64_t+JCS, WASM은 같은 canonical DTO를 사용할 수 있다. FFI는 복사한 UTF-8 bytes 또는 validated DTO와 stable handle을 전달한다. handle `{id,generation}`을 host Scope·소유권·수명에 연결하고, release 이후/generation 불일치/다른 Scope 사용을 거부한다. native pointer를 wire ref나 authority로 쓰지 않는다. WASM linear-memory offset은 호출 중 byte buffer 위치 지정에만 사용하며 영속 handle이 아니다. server capability 인가는 host callback마다 별도로 검사한다.

## C. Lifecycle

아래 ID·revision·시간은 합성 예시이며 production schema 설명이 아니다.

1. Quest final transition 선택. host가 인증으로 account A, 고정 binding으로 tenant T/world W를 결정한다. execution E와 key K를 한 번 만들고 profile hash, navigation reward v1, args, precondition을 pin한다.
2. Quest stage 8의 PRE Evidence를 평가한다. SATISFIED여도 backend는 mutation 시점에 stage 조건을 재검사한다.
3. authority가 K/fingerprint/E를 ACCEPTED로 등록한다. 원래 실행은 한 번만 시도한다. Quest 8→9와 reward child ledger+receipt를 기존 domain transaction으로 commit한다.
4. committed Receipt R은 E/fingerprint/A/W, wallet +180의 child tx C1, EXP +100의 child tx C2, reward ID/version, after revisions를 포함한다. Execution은 SUCCEEDED다.
5. 동시에 다른 purchase execution이 50을 소비해도 R은 변하지 않는다. receipt readback과 필요 시 projection을 읽는다.
6. Evidence(E, POST/RECOVERY)는 R digest, admitted Observation, 필요한 Fact를 pin한다. settlement claim은 R의 grant set을 평가해 SATISFIED가 된다. 별도의 projection claim은 wallet revision이 C1 적용 이후면 SATISFIED, 뒤처져 있으면 UNKNOWN이다.
7. pipeline은 Quest completion claim과 settlement claim을 모두 요구한다. projection 가시성까지 기다릴지는 profile에 명시하며 이를 임의로 settlement 실패로 바꾸지 않는다.
8. 결은 VerificationResult/Evidence 참조를 소비하고 정의된 policy를 적용한다. 새 transaction이나 authoritative Fact를 창작하지 않는다.

응답을 잃으면 실제 성공 상태는 바뀌지 않고 caller의 lookup status만 RECOVERABLE이다. getExecution(E)/getReceipt(R)로 5번부터 재개한다. Quest mutation을 재실행하지 않는다. stage 9만으로 E의 성공을 추정하지도 않는다.

## D. Failure Matrix

mutation retry와 read retry를 구분한다. 명시적인 새 작업은 자동 retry와 다르며 기존 실행의 무효과 terminal 상태 등을 확인한 뒤 별도로 판단한다.

| 상황 | Execution view | Verification | Mutation retry | Read-only recovery |
|---|---|---|---|---|
| request timeout, accept 여부 불명 | UNKNOWN, locator가 유효하면 RECOVERABLE | UNKNOWN | 금지 | 같은 E/K 조회. 404만으로 NOT_STARTED 판정 금지 |
| response lost | RECOVERABLE | UNKNOWN, receipt 이후 재평가 | 금지 | E와 receipt 조회 |
| transaction 성공, client unknown | authority SUCCEEDED / client RECOVERABLE | receipt 확인 후 SATISFIED 가능 | 금지 | committed receipt 반환 |
| 같은 key/fingerprint의 duplicate | 원래 canonical execution 반환 | 원래 결과 재평가 | 새 효과 금지 | 같은 receipt 조회 |
| 같은 key, 다른 fingerprint | 기존 execution 불변 | INVALID/IDEMPOTENCY_CONFLICT | 금지 | 기존의 정당한 요청만 조회 |
| concurrent wallet mutation | 원래 SUCCEEDED 유지 | 정당한 receipt이면 settlement SATISFIED | 불필요·금지 | 최신 projection 조회 가능 |
| stale snapshot | execution 불변 | current claim=UNKNOWN, historical replay 가능 | 금지 | 해당 source fresh read |
| snapshot 혼합/다른 epoch 비교 | execution 불변 | INVALID/SNAPSHOT_MISMATCH | 금지 | 올바른 cut 조회 |
| wrong principal | authority 요청 거절 | INVALID/SCOPE_MISMATCH | 금지 | 인증에서 올바른 Scope 재구성 |
| wrong world | 동일 | INVALID/SCOPE_MISMATCH | 금지 | 올바른 world binding |
| wrong reward version | commit되었으면 SUCCEEDED 유지 | 유효한 receipt이면 UNSATISFIED/REWARD_VERSION_MISMATCH | 금지 | execution/spec 대응 조사. 기대 spec을 사후 변경하지 않음 |
| malformed Fact | execution 불변 | INVALID/SCHEMA_VIOLATION | 금지 | provider/adapter 수정 후 재조회 |
| source 이름뿐이고 provenance 없음 | 불명 | UNKNOWN/UNTRUSTED_SOURCE | 금지 | trusted host admission |
| 동일 tx의 모순된 receipt | 추정하지 않음 | CONFLICT/RECEIPT_CONFLICT | 금지 | authority 측 조사 |
| 통신 문제로 readback 부족 | lastKnown 상태 유지 | UNKNOWN/READ_UNAVAILABLE | 금지 | read의 backoff retry 허용 |
| evaluator 내부 장애 | execution 불변 | ERROR | 금지 | 같은 immutable Evidence로 평가 재실행 가능 |
| receipt retention 종료 | UNKNOWN/RETENTION_EXPIRED | UNKNOWN | 금지 | 남은 authority 기록에서 복구, 없으면 수동 조사 |
| commit된 SKIPPED/partial | commit되었으면 SUCCEEDED | 기대 profile 조건에 따름, 기본 EXACT claim은 불일치 시 UNSATISFIED | 자동 보충 금지 | 같은 receipt 확인 |

## E. Backward Compatibility

| 현재 파일/구조 | 분류 | 최소 이전 |
|---|---|---|
| `tml/ir/tml-ir.ts`, `schema/tml-ir-v0.1.schema.json` | 구형 유지 + v1은 breaking | v0.1 reader 유지, 별도 v1 타입/schema 추가. 기존 strict schema에 필수 Scope를 끼워 넣지 않음 |
| `runtime/quest-read-adapter.mjs` | adapter 필요 | trusted account/world context, entity instance, source snapshot 부여. 없는 revision을 생성하지 않음 |
| `runtime/economic-read-adapters.mjs` | adapter 필요 | parser 재사용 가능. source DTO에서 user/stream/revision을 보존하고 표시 parser가 버린 값을 추측하지 않음 |
| `runtime/quest-advance-adapter.mjs` | additive API + adapter | executionId/key/fingerprint를 versioned provider에 전달. 구형 3인자 store는 legacy 유지 |
| `runtime/verification.mjs`, `conformance.mjs` | v1 의미는 breaking | 별도 v1 entry point. v0.1의 string ordering 등을 조용히 변경하지 않음 |
| `runtime/trace.mjs` | additive 외부 envelope | Ref와 Scope를 보존하는 새 trace. legacy trace를 authoritative v1으로 자동 승격하지 않음 |
| `runtime/verified-write-runtime.mjs` | 흐름 유지 | pre-read→한 번 submit→readback 유지. provider error와 execution failure 분리 |
| `runtime/verified-write-plan.mjs` | 대부분 유지 | 명시적 순서/stop 조건 유지. step마다 execution ID. plan ID를 transaction ID로 사용하지 않음 |
| `runtime/reward-settlement.mjs` | adapter + 판정 경계 교체 | delta 판정을 receipt claim으로 교체. snapshot 수집은 projection claim으로 유지 |
| `runtime/reward-aware-pipeline.mjs` | 대부분 유지 | P8 rewardVersion/source_transition 검사 유지. recovery 후 reward 평가만 재개, ordinary mutation 재실행 금지 |
| `runtime/main2-shadow*.mjs`, `npc-factory/main2-quest-client.mjs`, `dev-runtime.mjs`, `src/main.js` | 기존 진단 경계 유지 + additive context | scope/correlation을 가진 복사본을 관측. account/world/session 전환 시 pending 관측 분리·폐기. MATCH를 권위로 사용하지 않고 예외·UNKNOWN이 legacy 실행을 막지 않음 |
| `profiles/inha-world-v0.1.profile.json` | 구형 유지, 새 profile pin | predicate 타입 명시. quest.stage/wallet/EXP/reward.version은 integer. authority policy를 host allowlist에 pin |
| `fixtures/*.json`, `tests/tml-*.test.mjs` | 기존 유지 + 추가 | v1 counterpart와 strict migration vectors. 기존 roundtrip은 regression으로 유지 |
| `npc-factory/quest-store.mjs`, `quest-cloud-handler.mjs`, `quest-reward-shape.mjs` | additive provider boundary | v1 DTO/lookup을 별도 경로에 추가. 기존 축약 응답은 구형 client용 유지 |
| `private.world_reward_result_v1`, Quest RPC | 공개 schema 확인 후 additive migration 후보 | 기존 user/child transaction 활용. server-only ownership check가 있는 read RPC, 실행 journal/revision 등 부족한 부분만 추가 |

구형 number→integer는 profile에서 integer로 정의된 predicate이며 Number.isSafeInteger인 경우에만 변환한다. 이미 소실된 큰 정수의 자릿수는 복원할 수 없다. 구형 time은 adapter가 명시 변환하며 이미 잃은 microsecond 정밀도는 복원하지 않는다. 과거 Fact에 principal/world/provenance가 없으면 상상해서 넣지 않고 legacy evidence로 보존한다. server에서 다시 읽을 수 있는 것만 새 Observation으로 만든다.

과거 artifact ID만 보고 최신 profile로 바꾸지 않는다. legacy→v1 bridge는 원본 artifact digest, 채택 profile revision, 변환 결과를 기록하며 원본을 덮어쓰지 않는다.

## F. Conformance Corpus

동봉 `conformance-corpus.json`은 규범 시험 입력과 기대 결과이며 새 runtime 구현이나 완성된 runner가 아니다.

1. raw UTF-8 decode: duplicate key, Unicode, number, time 검증.
2. typed value: equality, ordering, overflow, canonical bytes/hash.
3. evidence: Scope, snapshot, provenance, profile pin, truth tables.
4. execution/settlement: fake authority와 immutable receipt로 timeout/duplicate/concurrent effect 재현.
5. bridge: handle generation, Scope, release 검사.

네 runtime의 합격 조건은 같은 corpus에서 canonical bytes, digest, status, reason이 완전히 일치하는 것이다. binding 권한과 timer/network는 결정적 fixture를 주입한다. 이번 설계 작업에서 네 runtime 구현의 통과를 주장하지 않는다. 최종 기준 커밋의 TML 테스트 68개는 baseline에서 통과했다.

## G. Minimal Patch Plan

| PR | 목적·범위 | 선행조건 | 필수 테스트 | migration | rollback |
|---|---|---|---|---|---|
| 1 | v1 spec, 타입/JSON Schema, corpus 동결 후보를 `tml/contracts/v1`에 추가 | ownership 합의 | schema 자체, ID/I64/Time, 모든 필수 record valid/invalid fixture | 불필요 | 아직 미사용이므로 제거 가능 |
| 2 | strict decode, typed equality, JCS/hash, v1 admission/evaluator entry | PR1 | duplicate key, Unicode 순서, numeric edge, P4 truth table, wrong scope, P3–P9 regression | 불필요 | flag로 기존 entry 사용. 구형 의미는 변경하지 않음 |
| 3 | source DTO, Scope/Observation/snapshot fake provider, legacy bridge와 P9 diagnostic context | PR2 | A/B·world 혼입, epoch/reset, old trace 거부, P9 계정 전환·예외가 실행에 영향 없음 | 원칙적으로 불필요. revision 없는 source의 strict mode는 미활성 | 새 adapter 비활성화, v0.1 유지 |
| 4 | 공개 로컬 DB에서 execution binding/receipt readback 최소 구현 | PR3 + 공개 SQL 기반 journal/scope/revision 확정 | local pgTAP/integration: auth, atomic commit, response loss, key conflict, child refs, lookup 무부작용 | 필요한 forward migration만. production 적용 없음 | 신규 writer 중단. 발행된 execution/receipt lookup과 tombstone은 유지 |
| 5 | P7 receipt settlement opt-in 경로, P8 recovery 통합 | PR4 | concurrent 구매/EXP, wrong version, partial/skip, commit 후 timeout, ordinary step 미재실행 | 원칙적으로 불필요 | 신규 v1 접수 중단, 기존 recovery 유지. 같은 미확정 작업을 old writer로 재전송하지 않음 |
| 6 | JS/Rust/C++ 및 WASM build의 corpus runner와 작은 DTO/handle bridge | PR2, settlement는 PR5 | bytes/hash/result 일치, stale handle, limit, precision, fault injection | 불필요 | native adapter별 비활성화. 영속 형식은 보존 |

PR4 전에 production 구조를 추측하지 않는다. 공개 wallet.version은 활용 후보지만 Quest/EXP/Inventory revision은 필요한 source별로 확인한다. 새 범용 ledger, repository 분할, microservice화는 필요 없다. PR4 이후 rollback은 이미 접수한 실행을 잊는 방식이어서는 안 된다.

### 구현 전에 확정할 최소 사항

- INHA binding의 tenant/world 고정값 및 account-global economy의 partition 대응.
- 처음 적용할 atomic command 하나: Main 2 최종 Quest+reward 권장.
- authority의 receipt 조회 범위, 최소 retention, 미확정 실행의 운영 대응.
- profile의 predicate 타입과 허용된 SKIPPED outcome.
- runtime 입력 한도와 각 언어 JCS 구현의 corpus 통과.

이는 구현 단계의 설정·policy 결정이며, 설계를 위해 production access나 변경은 필요하지 않다.
