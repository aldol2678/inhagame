const scalarTypes = new Set(['string', 'number', 'boolean', 'time', 'null']);

function diagnostic(code, path, message) {
  return Object.freeze({ code, path, message });
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
  if (parameter.type === 'object') return value.type === 'object' && value.value && typeof value.value === 'object';
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
