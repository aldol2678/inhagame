import { TML_MAIN2_CANARY_EXECUTION_CONTRACT } from './canary-execution-contract.mjs';

export const TML_MAIN2_CANARY_ADAPTER_INTERFACE_PACK = 'main2-canary-adapter-interfaces@p17';

export const TML_CANARY_ADAPTER_INTERFACE = Object.freeze({
  COHORT_RESOLVER: 'tml.canary.cohort-resolver@p17',
  ACTIVATION_PREFLIGHT: 'tml.canary.activation-preflight@p17',
  OBSERVABILITY_ADAPTER: 'tml.canary.observability-adapter@p17',
  ROLLBACK_ADAPTER: 'tml.canary.rollback-adapter@p17',
  EXPIRY_GUARD: 'tml.canary.expiry-guard@p17'
});

const MAX_REF_LENGTH = 256;

const INTERFACE_DESCRIPTORS = Object.freeze({
  cohortResolver: Object.freeze({
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.COHORT_RESOLVER,
    role: 'Resolve an externally managed cohort reference without embedding members in TML.',
    requiredMethods: Object.freeze([
      Object.freeze({
        name: 'inspect',
        input: 'P16.cohort',
        output: 'COHORT_METADATA_ONLY',
        effect: 'READ_ONLY'
      })
    ]),
    prohibitedEffects: Object.freeze([
      'ASSIGN_USERS',
      'MUTATE_COHORT',
      'ROUTE_TRAFFIC',
      'EMBED_MEMBERSHIP'
    ])
  }),
  activationPreflight: Object.freeze({
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ACTIVATION_PREFLIGHT,
    role: 'Validate all external dependencies before any future activation attempt.',
    requiredMethods: Object.freeze([
      Object.freeze({
        name: 'check',
        input: 'P16_EXECUTION_CONTRACT_PLUS_ADAPTER_REFERENCES',
        output: 'BLOCKED_OR_READY_FOR_SEPARATE_HUMAN_ACTIVATION',
        effect: 'READ_ONLY'
      })
    ]),
    prohibitedEffects: Object.freeze([
      'ACTIVATE',
      'ROUTE_TRAFFIC',
      'CHANGE_AUTHORITY',
      'DEPLOY'
    ])
  }),
  observabilityAdapter: Object.freeze({
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.OBSERVABILITY_ADAPTER,
    role: 'Read canary observability using the opaque P16 observability handle.',
    requiredMethods: Object.freeze([
      Object.freeze({
        name: 'inspect',
        input: 'P16.observabilityHandle',
        output: 'OBSERVABILITY_CAPABILITY_METADATA',
        effect: 'READ_ONLY'
      }),
      Object.freeze({
        name: 'snapshot',
        input: 'EXTERNAL_OBSERVABILITY_SESSION_REF',
        output: 'CANARY_METRIC_SNAPSHOT',
        effect: 'READ_ONLY'
      })
    ]),
    prohibitedEffects: Object.freeze([
      'WRITE_METRICS',
      'CHANGE_ROUTING',
      'CHANGE_AUTHORITY',
      'ACKNOWLEDGE_SUCCESS_AUTOMATICALLY'
    ])
  }),
  rollbackAdapter: Object.freeze({
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.ROLLBACK_ADAPTER,
    role: 'Validate that a rollback path exists for the opaque P16 rollback handle.',
    requiredMethods: Object.freeze([
      Object.freeze({
        name: 'inspect',
        input: 'P16.rollbackHandle',
        output: 'ROLLBACK_CAPABILITY_METADATA',
        effect: 'READ_ONLY'
      }),
      Object.freeze({
        name: 'propose',
        input: 'ROLLBACK_REASON_PLUS_CONTRACT_REF',
        output: 'ROLLBACK_PROPOSAL_ONLY',
        effect: 'PROPOSAL_ONLY'
      })
    ]),
    prohibitedEffects: Object.freeze([
      'EXECUTE_ROLLBACK',
      'CHANGE_ROUTING',
      'CHANGE_AUTHORITY',
      'DEPLOY'
    ])
  }),
  expiryGuard: Object.freeze({
    interfaceContract: TML_CANARY_ADAPTER_INTERFACE.EXPIRY_GUARD,
    role: 'Re-check P16 expiry at the moment a future activation is requested.',
    requiredMethods: Object.freeze([
      Object.freeze({
        name: 'check',
        input: 'P16.validity_PLUS_CURRENT_TIME',
        output: 'VALID_OR_EXPIRED',
        effect: 'PURE'
      })
    ]),
    prohibitedEffects: Object.freeze([
      'EXTEND_EXPIRY',
      'REFRESH_APPROVAL',
      'ACTIVATE',
      'CHANGE_AUTHORITY'
    ])
  })
});

function fail(code, message) {
  const error = new Error(message);
  error.name = 'TmlCanaryAdapterInterfaceError';
  error.code = code;
  throw error;
}

function textRef(value, code, label) {
  if (typeof value !== 'string') fail(code, `${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_REF_LENGTH) {
    fail(code, `${label} must be 1..${MAX_REF_LENGTH} characters`);
  }
  return trimmed;
}

function isoTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_INTERFACE_PACK_TIME', 'generatedAt must be an ISO-compatible timestamp');
  }
  return value;
}

function freezeCopy(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeCopy));
  if (typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezeCopy(item)])
    ));
  }
  return value;
}

function validateExecutionContract(contract) {
  if (!contract || typeof contract !== 'object') {
    fail('P16_CONTRACT_REQUIRED', 'P17 requires a P16 canary execution contract');
  }
  if (contract.schema !== 'tml.canary-execution-contract' ||
      contract.version !== '0.1' ||
      contract.contract !== TML_MAIN2_CANARY_EXECUTION_CONTRACT ||
      contract.status !== 'CONTRACT_READY') {
    fail('INVALID_P16_CONTRACT', 'P17 requires the current CONTRACT_READY P16 contract');
  }

  if (contract.advisoryOnly !== true ||
      contract.executable !== false ||
      contract.activationAllowed !== false ||
      contract.routingEffect !== 'NONE' ||
      contract.deploymentEffect !== 'NONE' ||
      contract.runtimeEffect !== 'NONE' ||
      contract.persistenceEffect !== 'NONE' ||
      contract.authorityChangeAllowed !== false) {
    fail('P16_EFFECT_BOUNDARY_INVALID', 'P16 contract must remain non-executable and effect-free');
  }

  if (contract.authority?.current !== 'legacy-main2' ||
      contract.authority?.currentRemainsAuthoritative !== true) {
    fail('P16_AUTHORITY_BOUNDARY_INVALID', 'legacy Main 2 must remain authoritative');
  }

  if (typeof contract.evidence?.contractFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(contract.evidence.contractFingerprint)) {
    fail('P16_CONTRACT_FINGERPRINT_INVALID', 'P16 contract fingerprint must be SHA-256 hex');
  }

  if (typeof contract.cohort?.id !== 'string' ||
      contract.cohort.assignmentMode !== 'EXTERNAL_EXPLICIT_COHORT' ||
      contract.cohort.membershipEmbedded !== false) {
    fail('P16_COHORT_BOUNDARY_INVALID', 'P16 cohort must remain an external metadata reference');
  }

  if (typeof contract.handles?.rollback !== 'string' ||
      typeof contract.handles?.observability !== 'string') {
    fail('P16_HANDLES_REQUIRED', 'P16 rollback and observability handles are required');
  }

  if (!Array.isArray(contract.requirements) ||
      !contract.requirements.includes('EXTERNAL_ROUTER_IMPLEMENTATION_REQUIRED') ||
      !contract.requirements.includes('EXTERNAL_ROLLBACK_ADAPTER_REQUIRED') ||
      !contract.requirements.includes('EXTERNAL_OBSERVABILITY_ADAPTER_REQUIRED') ||
      !contract.requirements.includes('EXPIRY_CHECK_REQUIRED_AT_ACTIVATION')) {
    fail('P16_REQUIREMENTS_INCOMPLETE', 'P16 external adapter requirements are incomplete');
  }

  return contract;
}

function normalizeBinding(key, input) {
  const descriptor = INTERFACE_DESCRIPTORS[key];
  if (!descriptor) fail('UNKNOWN_ADAPTER_INTERFACE', `unknown adapter interface: ${key}`);
  if (!input || typeof input !== 'object') {
    fail('ADAPTER_BINDING_REQUIRED', `adapter binding required for ${key}`);
  }

  const interfaceContract = textRef(
    input.interfaceContract,
    'INVALID_INTERFACE_CONTRACT',
    `${key}.interfaceContract`
  );
  if (interfaceContract !== descriptor.interfaceContract) {
    fail(
      'INTERFACE_CONTRACT_MISMATCH',
      `${key} must bind ${descriptor.interfaceContract}`
    );
  }

  const implementationRef = textRef(
    input.implementationRef,
    'INVALID_IMPLEMENTATION_REF',
    `${key}.implementationRef`
  );
  const versionRef = textRef(
    input.versionRef,
    'INVALID_VERSION_REF',
    `${key}.versionRef`
  );
  const ownerRef = textRef(
    input.ownerRef,
    'INVALID_OWNER_REF',
    `${key}.ownerRef`
  );

  if ('implementation' in input ||
      'handler' in input ||
      'fn' in input ||
      'members' in input ||
      'userIds' in input) {
    fail(
      'EXECUTABLE_OR_MEMBERSHIP_DATA_FORBIDDEN',
      `${key} binding may contain references only, not executable code or user membership`
    );
  }

  return Object.freeze({
    interfaceContract,
    implementationRef,
    versionRef,
    ownerRef
  });
}

export function getTmlCanaryAdapterInterfaceDescriptors() {
  return INTERFACE_DESCRIPTORS;
}

export function buildTmlMain2CanaryAdapterInterfacePack({
  executionContract,
  adapters,
  generatedAt = new Date().toISOString()
} = {}) {
  const contract = validateExecutionContract(executionContract);
  isoTime(generatedAt);

  if (!adapters || typeof adapters !== 'object') {
    fail('ADAPTER_BINDINGS_REQUIRED', 'P17 requires adapter binding references');
  }

  const expectedKeys = Object.keys(INTERFACE_DESCRIPTORS);
  const actualKeys = Object.keys(adapters);

  for (const key of expectedKeys) {
    if (!(key in adapters)) fail('ADAPTER_BINDING_REQUIRED', `missing adapter binding: ${key}`);
  }
  for (const key of actualKeys) {
    if (!expectedKeys.includes(key)) {
      fail('UNKNOWN_ADAPTER_BINDING', `unknown adapter binding: ${key}`);
    }
  }

  const normalizedBindings = Object.fromEntries(
    expectedKeys.map((key) => [key, normalizeBinding(key, adapters[key])])
  );

  return freezeCopy({
    schema: 'tml.canary-adapter-interface-pack',
    version: '0.1',
    contract: TML_MAIN2_CANARY_ADAPTER_INTERFACE_PACK,
    generatedAt,
    status: 'INTERFACES_BOUND_BY_REFERENCE',
    advisoryOnly: true,
    executable: false,
    adapterInvocationAllowed: false,
    routingEffect: 'NONE',
    deploymentEffect: 'NONE',
    runtimeEffect: 'NONE',
    persistenceEffect: 'NONE',
    authorityChangeAllowed: false,
    authority: {
      current: 'legacy-main2',
      candidate: 'tml-main2',
      currentRemainsAuthoritative: true
    },
    sourceExecutionContract: {
      id: contract.id,
      contract: contract.contract,
      contractFingerprint: contract.evidence.contractFingerprint,
      phaseId: contract.phase.id,
      cohortId: contract.cohort.id,
      rollbackHandle: contract.handles.rollback,
      observabilityHandle: contract.handles.observability,
      expiresAt: contract.expiresAt
    },
    interfaces: INTERFACE_DESCRIPTORS,
    bindings: normalizedBindings,
    futureActivationRequirements: [
      'VERIFY_ALL_ADAPTER_IMPLEMENTATIONS_SEPARATELY',
      'RUN_ACTIVATION_PREFLIGHT_WITHOUT_SIDE_EFFECTS',
      'RECHECK_P16_EXPIRY',
      'REQUIRE_SEPARATE_HUMAN_ACTIVATION',
      'KEEP_LEGACY_ROLLBACK_AVAILABLE'
    ],
    nextAction: 'HUMAN_REVIEW_ADAPTER_IMPLEMENTATION_PLAN_ONLY'
  });
}
