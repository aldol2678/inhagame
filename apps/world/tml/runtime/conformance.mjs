import irSchema from '../schema/tml-ir-v0.1.schema.json' with { type: 'json' };

const scalarTypes = new Set(['string', 'number', 'boolean', 'time', 'null']);
const schemaKeywords = new Set([
  '$ref', 'type', 'oneOf', 'properties', 'additionalProperties', 'required',
  'const', 'enum', 'items', 'minItems', 'uniqueItems', 'minLength',
  'minimum', 'maximum', 'format',
]);

function diagnostic(code, path, message) {
  return Object.freeze({ code, path, message });
}

// The published JSON schema owns structure. This walker implements only the
// keywords used by that schema; vocabulary/binding checks remain below.
function jsonDataError(value) {
  const ancestors = new Set();
  const pending = [{ value, path: '$' }];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item.leave) {
      ancestors.delete(item.value);
      continue;
    }
    const current = item.value;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number' && Number.isFinite(current)) continue;
    if (typeof current !== 'object') {
      return diagnostic('NON_JSON_VALUE', item.path, 'TML input must contain finite JSON data');
    }
    if (ancestors.has(current)) return diagnostic('NON_JSON_VALUE', item.path, 'TML input must not contain cycles');
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null &&
        !(Array.isArray(current) && prototype === Array.prototype)) {
      return diagnostic('NON_JSON_VALUE', item.path, 'TML input must contain plain JSON objects or arrays');
    }
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    if (Array.isArray(current) && keys.length !== current.length + 1) {
      return diagnostic('NON_JSON_VALUE', item.path, 'TML arrays must be dense and have no extra properties');
    }
    ancestors.add(current);
    pending.push({ value: current, leave: true });
    for (const key of keys) {
      if (Array.isArray(current) && key === 'length') continue;
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
          (Array.isArray(current) && (!/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) >= current.length))) {
        return diagnostic('NON_JSON_VALUE', item.path, 'TML input must not contain accessors or non-JSON properties');
      }
      pending.push({ value: descriptor.value, path: Array.isArray(current) ? `${item.path}[${key}]` : `${item.path}.${key}` });
    }
  }
  return null;
}

export function isTmlDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0] !== value) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, sign, offsetHourText = '0', offsetMinuteText = '0'] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    [yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) return false;
  if (second < 60) return true;
  // RFC 3339 permits a leap second at the end of a UTC month, including
  // representations with an offset. Do not normalize the supplied value.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const offset = (sign === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  date.setUTCHours(hour, minute - offset, 59, 0);
  const next = new Date(date.getTime() + 1000);
  return date.getUTCHours() === 23 && date.getUTCMinutes() === 59 && next.getUTCDate() === 1;
}

function validateSchemaNode(value, schema, path, errors) {
  const invalid = (message) => errors.push(diagnostic('SCHEMA_VALIDATION_ERROR', path, message));
  for (const keyword of Object.keys(schema)) {
    if (!schemaKeywords.has(keyword)) {
      errors.push(diagnostic('UNSUPPORTED_SCHEMA_KEYWORD', path, `unsupported published schema keyword: ${keyword}`));
      return;
    }
  }
  if (schema.$ref) {
    const name = schema.$ref.startsWith('#/$defs/') ? schema.$ref.slice('#/$defs/'.length) : null;
    if (!name || !Object.hasOwn(irSchema.$defs, name)) {
      errors.push(diagnostic('UNSUPPORTED_SCHEMA_REFERENCE', path, `unsupported published schema reference: ${schema.$ref}`));
      return;
    }
    validateSchemaNode(value, irSchema.$defs[name], path, errors);
  }
  if (schema.oneOf) {
    const alternatives = schema.oneOf.map((alternative) => {
      const problems = [];
      validateSchemaNode(value, alternative, path, problems);
      return problems;
    });
    errors.push(...alternatives.flat().filter((problem) => problem.code.startsWith('UNSUPPORTED_SCHEMA_')));
    if (alternatives.filter((problems) => problems.length === 0).length !== 1) {
      invalid('value must match exactly one published schema alternative');
    }
  }
  const matchesType = schema.type === undefined ||
    (schema.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) ||
    (schema.type === 'array' && Array.isArray(value)) ||
    (schema.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (schema.type === 'string' && typeof value === 'string') ||
    (schema.type === 'boolean' && typeof value === 'boolean');
  if (!matchesType) {
    invalid(`value must have schema type ${schema.type}`);
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) invalid(`value must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) invalid('value is not in the published schema enum');
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) invalid(`string must contain at least ${schema.minLength} character(s)`);
    if (schema.format !== undefined && (schema.format !== 'date-time' || !isTmlDateTime(value))) invalid(`value must match schema format ${schema.format}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) invalid(`number must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) invalid(`number must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) invalid(`array must contain at least ${schema.minItems} item(s)`);
    // The current schema uses uniqueItems only for string vocabulary arrays.
    if (schema.uniqueItems && schema.items?.type !== 'string') {
      errors.push(diagnostic('UNSUPPORTED_SCHEMA_KEYWORD', path, 'uniqueItems is supported only for published string vocabulary arrays'));
    } else if (schema.uniqueItems && new Set(value).size !== value.length) invalid('array items must be unique');
    if (schema.items) value.forEach((item, index) => validateSchemaNode(item, schema.items, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(diagnostic('SCHEMA_VALIDATION_ERROR', `${path}.${key}`, 'required field is missing'));
    }
    for (const key of Object.keys(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        validateSchemaNode(value[key], schema.properties[key], `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(diagnostic('SCHEMA_VALIDATION_ERROR', `${path}.${key}`, 'field is not allowed by the published schema'));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateSchemaNode(value[key], schema.additionalProperties, `${path}.${key}`, errors);
      }
    }
  }
}

function structureErrors(value, definition) {
  try {
    const jsonError = jsonDataError(value);
    if (jsonError) return [jsonError];
    const errors = [];
    validateSchemaNode(value, irSchema.$defs[definition], '$', errors);
    return errors;
  } catch {
    return [diagnostic('NON_JSON_VALUE', '$', 'TML input could not be inspected as finite JSON data')];
  }
}

export function assertTmlReadResultStructure(readResult) {
  let errors;
  try {
    const facts = readResult && typeof readResult === 'object'
      ? Object.getOwnPropertyDescriptor(readResult, 'facts') : null;
    const observations = readResult && typeof readResult === 'object'
      ? Object.getOwnPropertyDescriptor(readResult, 'observations') : null;
    if (Array.isArray(readResult) || !Array.isArray(facts?.value) || !Array.isArray(observations?.value)) {
      errors = [diagnostic('SCHEMA_VALIDATION_ERROR', '$', 'read result must contain facts and observations arrays')];
    } else {
      const records = { facts: facts.value, observations: observations.value };
      const jsonError = jsonDataError(records);
      errors = jsonError ? [jsonError] : [];
      if (!jsonError) {
        records.facts.forEach((fact, index) => validateSchemaNode(fact, irSchema.$defs.fact, `$.facts[${index}]`, errors));
        records.observations.forEach((observation, index) => validateSchemaNode(observation, irSchema.$defs.observation, `$.observations[${index}]`, errors));
      }
    }
  } catch {
    errors = [diagnostic('NON_JSON_VALUE', '$', 'read records could not be inspected as finite JSON data')];
  }
  if (errors.length === 0) return readResult;
  const error = new Error(errors.map((item) => `${item.code} at ${item.path}: ${item.message}`).join('\n'));
  error.name = 'TmlConformanceError';
  error.code = 'INVALID_READ_RESULT';
  error.diagnostics = errors;
  throw error;
}

function collectExprPredicates(expr, path, out) {
  if (!expr || typeof expr !== 'object') {
    out.push(diagnostic('INVALID_EXPRESSION', path, 'expression must be an object'));
    return;
  }

  if (typeof expr.predicate === 'string') {
    out.push({ predicate: expr.predicate, path: `${path}.predicate` });
  }

  if (Array.isArray(expr.args)) {
    expr.args.forEach((arg, index) => collectExprPredicates(arg, `${path}.args[${index}]`, out));
  }

  if (expr.arg !== undefined) {
    collectExprPredicates(expr.arg, `${path}.arg`, out);
  }
}

function valueMatchesParameter(value, parameter) {
  if (!value || typeof value !== 'object' || !parameter || typeof parameter !== 'object') return false;

  if (parameter.type === 'ref') return value.type === 'ref';
  if (parameter.type === 'list') {
    return value.type === 'list'
      && Array.isArray(value.value)
      && value.value.every((item) => valueMatchesParameter(item, parameter.items));
  }
  if (parameter.type === 'object') {
    return value.type === 'object' && value.value && typeof value.value === 'object' &&
      Object.entries(parameter.properties ?? {}).every(([key, child]) =>
        !Object.hasOwn(value.value, key) || valueMatchesParameter(value.value[key], child));
  }
  if (scalarTypes.has(parameter.type)) return value.type === parameter.type;
  return false;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateTmlProfile(profile) {
  const structural = structureErrors(profile, 'profile');
  if (structural.length > 0) return { ok: false, errors: structural };
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: [diagnostic('INVALID_PROFILE', '$', 'profile must be an object')] };
  }

  if (profile.schema !== 'tml.profile') {
    errors.push(diagnostic('INVALID_PROFILE_SCHEMA', '$.schema', "profile schema must be 'tml.profile'"));
  }

  if (profile.version !== '0.1') {
    errors.push(diagnostic('UNSUPPORTED_PROFILE_VERSION', '$.version', "profile version must be '0.1'"));
  }

  for (const [field, values] of [
    ['entity_types', profile.entity_types],
    ['predicates', profile.predicates],
    ['events', profile.events],
  ]) {
    if (!Array.isArray(values)) {
      errors.push(diagnostic('INVALID_PROFILE_COLLECTION', `$.${field}`, `${field} must be an array`));
      continue;
    }
    for (const duplicate of duplicateValues(values)) {
      errors.push(diagnostic('DUPLICATE_PROFILE_VALUE', `$.${field}`, `duplicate ${field} value: ${duplicate}`));
    }
  }

  const declaredPredicates = new Set(Array.isArray(profile.predicates) ? profile.predicates : []);
  const authorityRules = Array.isArray(profile.authority) ? profile.authority : [];
  const authorityByPredicate = new Map();

  authorityRules.forEach((rule, index) => {
    if (!rule || typeof rule.predicate !== 'string') return;
    if (authorityByPredicate.has(rule.predicate)) {
      errors.push(diagnostic(
        'DUPLICATE_AUTHORITY_RULE',
        `$.authority[${index}].predicate`,
        `duplicate authority rule for predicate: ${rule.predicate}`,
      ));
    } else {
      authorityByPredicate.set(rule.predicate, rule);
    }

    if (!declaredPredicates.has(rule.predicate)) {
      errors.push(diagnostic(
        'AUTHORITY_PREDICATE_UNDECLARED',
        `$.authority[${index}].predicate`,
        `authority rule uses undeclared predicate: ${rule.predicate}`,
      ));
    }
  });

  const capabilities = Array.isArray(profile.capabilities) ? profile.capabilities : [];
  const capabilityIds = capabilities.map((capability) => capability?.id).filter((id) => typeof id === 'string');
  for (const duplicate of duplicateValues(capabilityIds)) {
    errors.push(diagnostic('DUPLICATE_CAPABILITY', '$.capabilities', `duplicate capability id: ${duplicate}`));
  }

  capabilities.forEach((capability, index) => {
    if (!capability || typeof capability.id !== 'string') {
      errors.push(diagnostic('INVALID_CAPABILITY', `$.capabilities[${index}]`, 'capability requires a string id'));
      return;
    }

    if (!capability.parameters || typeof capability.parameters !== 'object' || Array.isArray(capability.parameters)) {
      errors.push(diagnostic(
        'INVALID_CAPABILITY_PARAMETERS',
        `$.capabilities[${index}].parameters`,
        `capability ${capability.id} parameters must be an object`,
      ));
    }

    if (capability.mutates === true) {
      if (!capability.verification) {
        errors.push(diagnostic(
          'MUTATING_CAPABILITY_VERIFICATION_MISSING',
          `$.capabilities[${index}].verification`,
          `mutating capability ${capability.id} requires verification metadata`,
        ));
        return;
      }

      const predicate = capability.verification.predicate;
      if (!declaredPredicates.has(predicate)) {
        errors.push(diagnostic(
          'VERIFICATION_PREDICATE_UNDECLARED',
          `$.capabilities[${index}].verification.predicate`,
          `verification uses undeclared predicate: ${predicate}`,
        ));
      }

      const authorityRule = authorityByPredicate.get(predicate);
      if (!authorityRule) {
        errors.push(diagnostic(
          'AUTHORITY_RULE_MISSING',
          `$.capabilities[${index}].verification`,
          `no authority rule exists for verification predicate: ${predicate}`,
        ));
      } else if (authorityRule.authority !== capability.verification.authority) {
        errors.push(diagnostic(
          'AUTHORITY_MISMATCH',
          `$.capabilities[${index}].verification.authority`,
          `capability authority ${capability.verification.authority} does not match profile authority ${authorityRule.authority}`,
        ));
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

export function validateTmlModule(module, profile) {
  const errors = [];
  const profileValidation = validateTmlProfile(profile);
  errors.push(...profileValidation.errors);
  errors.push(...structureErrors(module, 'module'));
  if (errors.length > 0) return { ok: false, errors };

  if (!module || typeof module !== 'object') {
    errors.push(diagnostic('INVALID_MODULE', '$', 'module must be an object'));
    return { ok: false, errors };
  }

  if (module.schema !== 'tml.module') {
    errors.push(diagnostic('INVALID_MODULE_SCHEMA', '$.schema', "module schema must be 'tml.module'"));
  }

  if (module.version !== '0.1') {
    errors.push(diagnostic('UNSUPPORTED_MODULE_VERSION', '$.version', "module version must be '0.1'"));
  }

  if (module.profile !== profile?.id) {
    errors.push(diagnostic(
      'PROFILE_ID_MISMATCH',
      '$.profile',
      `module profile ${String(module.profile)} does not match ${String(profile?.id)}`,
    ));
  }

  if (!Array.isArray(module.transitions)) {
    errors.push(diagnostic('INVALID_TRANSITIONS', '$.transitions', 'transitions must be an array'));
    return { ok: false, errors };
  }

  const declaredPredicates = new Set(Array.isArray(profile?.predicates) ? profile.predicates : []);
  const declaredEvents = new Set(Array.isArray(profile?.events) ? profile.events : []);
  const capabilities = new Map(
    (Array.isArray(profile?.capabilities) ? profile.capabilities : [])
      .filter((capability) => capability && typeof capability.id === 'string')
      .map((capability) => [capability.id, capability]),
  );
  const authorityByPredicate = new Map(
    (Array.isArray(profile?.authority) ? profile.authority : [])
      .filter((rule) => rule && typeof rule.predicate === 'string')
      .map((rule) => [rule.predicate, rule]),
  );

  const transitionIds = module.transitions.map((transition) => transition?.id).filter((id) => typeof id === 'string');
  for (const duplicate of duplicateValues(transitionIds)) {
    errors.push(diagnostic('DUPLICATE_TRANSITION_ID', '$.transitions', `duplicate transition id: ${duplicate}`));
  }

  const actionIds = [];

  module.transitions.forEach((transition, transitionIndex) => {
    const base = `$.transitions[${transitionIndex}]`;

    if (!transition || typeof transition !== 'object') {
      errors.push(diagnostic('INVALID_TRANSITION', base, 'transition must be an object'));
      return;
    }

    const predicateUses = [];
    if (transition.precondition !== undefined) {
      collectExprPredicates(transition.precondition, `${base}.precondition`, predicateUses);
    }
    collectExprPredicates(transition.postcondition, `${base}.postcondition`, predicateUses);

    for (const use of predicateUses) {
      if (use.predicate && !declaredPredicates.has(use.predicate)) {
        errors.push(diagnostic(
          'UNDECLARED_PREDICATE',
          use.path,
          `predicate is not declared by profile: ${use.predicate}`,
        ));
      }
    }

    if (transition.trigger) {
      if (!declaredEvents.has(transition.trigger.event)) {
        errors.push(diagnostic(
          'UNDECLARED_EVENT',
          `${base}.trigger.event`,
          `event is not declared by profile: ${String(transition.trigger.event)}`,
        ));
      }
    }

    if (!Array.isArray(transition.actions)) {
      errors.push(diagnostic('INVALID_ACTIONS', `${base}.actions`, 'actions must be an array'));
      return;
    }

    const postconditionPredicates = [];
    collectExprPredicates(transition.postcondition, `${base}.postcondition`, postconditionPredicates);
    const postconditionSet = new Set(postconditionPredicates.map((use) => use.predicate).filter(Boolean));

    transition.actions.forEach((action, actionIndex) => {
      const actionPath = `${base}.actions[${actionIndex}]`;
      if (!action || typeof action !== 'object') {
        errors.push(diagnostic('INVALID_ACTION', actionPath, 'action must be an object'));
        return;
      }

      if (typeof action.id === 'string') actionIds.push({ id: action.id, path: `${actionPath}.id` });

      const capability = capabilities.get(action.capability);
      if (!capability) {
        errors.push(diagnostic(
          'UNDECLARED_CAPABILITY',
          `${actionPath}.capability`,
          `capability is not declared by profile: ${String(action.capability)}`,
        ));
        return;
      }

      const args = action.args && typeof action.args === 'object' && !Array.isArray(action.args)
        ? action.args
        : {};
      const parameters = capability.parameters && typeof capability.parameters === 'object'
        ? capability.parameters
        : {};

      const argNames = Object.keys(args).sort();
      const parameterNames = Object.keys(parameters).sort();
      if (argNames.length !== parameterNames.length || argNames.some((name, index) => name !== parameterNames[index])) {
        errors.push(diagnostic(
          'ARGUMENT_SET_MISMATCH',
          `${actionPath}.args`,
          `arguments for ${capability.id} must be exactly: ${parameterNames.join(', ')}`,
        ));
      }

      for (const [name, parameter] of Object.entries(parameters)) {
        if (!(name in args)) continue;
        if (!valueMatchesParameter(args[name], parameter)) {
          errors.push(diagnostic(
            'ARGUMENT_TYPE_MISMATCH',
            `${actionPath}.args.${name}`,
            `argument ${name} does not match parameter type ${parameter.type}`,
          ));
        }
      }

      if (capability.mutates === true) {
        if (!capability.verification) {
          return;
        }

        const predicate = capability.verification.predicate;
        if (!postconditionSet.has(predicate)) {
          errors.push(diagnostic(
            'POSTCONDITION_VERIFICATION_PREDICATE_MISSING',
            `${base}.postcondition`,
            `postcondition must verify mutating capability predicate: ${predicate}`,
          ));
        }

        const authorityRule = authorityByPredicate.get(predicate);
        if (!authorityRule) {
          errors.push(diagnostic(
            'AUTHORITY_RULE_MISSING',
            `${actionPath}.capability`,
            `no authority rule exists for verification predicate: ${predicate}`,
          ));
        } else if (authorityRule.authority !== capability.verification.authority) {
          errors.push(diagnostic(
            'AUTHORITY_MISMATCH',
            `${actionPath}.capability`,
            `capability authority ${capability.verification.authority} does not match profile authority ${authorityRule.authority}`,
          ));
        }
      }
    });
  });

  const actionSeen = new Set();
  for (const action of actionIds) {
    if (actionSeen.has(action.id)) {
      errors.push(diagnostic('DUPLICATE_ACTION_ID', action.path, `duplicate action id: ${action.id}`));
    }
    actionSeen.add(action.id);
  }

  return { ok: errors.length === 0, errors };
}

export function assertTmlConformance(module, profile) {
  const result = validateTmlModule(module, profile);
  if (result.ok) return result;

  const error = new Error(
    result.errors.map((item) => `${item.code} at ${item.path}: ${item.message}`).join('\n'),
  );
  error.name = 'TmlConformanceError';
  error.diagnostics = result.errors;
  throw error;
}
