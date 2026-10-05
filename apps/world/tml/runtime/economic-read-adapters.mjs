import { parseProgressionSnapshot } from '../../src/progression/progression-client.js';
import { parseWalletSnapshot } from '../../src/wallet/wallet-client.js';

function fail(name, code, message) {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  throw error;
}

function ensureTime(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('TmlEconomicReadError', 'INVALID_OBSERVED_AT', 'now() must return an ISO-compatible timestamp');
  }
  return value;
}

function token(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-|-$/g, '');
}

function makeFact({ id, subject, predicate, value, source, observedAt, sequence }) {
  return Object.freeze({
    kind: 'fact',
    id,
    subject,
    predicate,
    value: Object.freeze(value),
    source,
    observed_at: observedAt,
    confidence: 1,
    extensions: Object.freeze({ observation_sequence: sequence })
  });
}

function makeObservation({ id, subject, predicate, factId, source, observedAt, sequence }) {
  return Object.freeze({
    kind: 'observation',
    id,
    source,
    observed_at: observedAt,
    query: Object.freeze({ subject, predicate }),
    facts: Object.freeze([factId]),
    extensions: Object.freeze({ observation_sequence: sequence })
  });
}

export function walletSubject(currencyId) {
  if (typeof currencyId !== 'string' || currencyId.length === 0) {
    fail('TmlWalletReadError', 'INVALID_CURRENCY_ID', 'currency id must be a non-empty string');
  }
  return `wallet.${currencyId}`;
}

export function progressionSubject() {
  return 'progression.campus';
}

export function createTmlWalletReadAdapter({ readWallet, now = () => new Date().toISOString() } = {}) {
  if (typeof readWallet !== 'function') throw new TypeError('createTmlWalletReadAdapter requires readWallet(userId)');
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  let sequence = 0;

  return Object.freeze({
    capability: 'world.wallet.read',
    source: 'server.wallet',

    async read({ userId } = {}) {
      if (typeof userId !== 'string' || userId.length === 0) {
        fail('TmlWalletReadError', 'USER_ID_REQUIRED', 'world.wallet.read requires a non-empty userId');
      }

      const parsed = parseWalletSnapshot(await readWallet(userId));
      if (!parsed) fail('TmlWalletReadError', 'WALLET_READ_INVALID_RESPONSE', 'wallet read response is malformed');

      const observedAt = ensureTime(now());
      const currentSequence = ++sequence;
      const facts = [];
      const observations = [];

      for (const [currencyId, balance] of Object.entries(parsed.balances)) {
        const subject = walletSubject(currencyId);
        const factId = `fact.${token(subject)}.wallet.balance.${token(observedAt)}.${currentSequence}`;
        facts.push(makeFact({
          id: factId,
          subject,
          predicate: 'wallet.balance',
          value: { type: 'number', value: balance },
          source: 'server.wallet',
          observedAt,
          sequence: currentSequence
        }));
        observations.push(makeObservation({
          id: `observation.${token(subject)}.wallet.balance.${token(observedAt)}.${currentSequence}`,
          subject,
          predicate: 'wallet.balance',
          factId,
          source: 'server.wallet',
          observedAt,
          sequence: currentSequence
        }));
      }

      return Object.freeze({
        capability: 'world.wallet.read',
        source: 'server.wallet',
        observedAt,
        sequence: currentSequence,
        facts: Object.freeze(facts),
        observations: Object.freeze(observations)
      });
    }
  });
}

export function createTmlProgressionReadAdapter({ readProgression, now = () => new Date().toISOString() } = {}) {
  if (typeof readProgression !== 'function') {
    throw new TypeError('createTmlProgressionReadAdapter requires readProgression(userId)');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  let sequence = 0;

  return Object.freeze({
    capability: 'world.progression.read',
    source: 'server.progression',

    async read({ userId } = {}) {
      if (typeof userId !== 'string' || userId.length === 0) {
        fail('TmlProgressionReadError', 'USER_ID_REQUIRED', 'world.progression.read requires a non-empty userId');
      }

      const parsed = parseProgressionSnapshot(await readProgression(userId));
      if (!parsed) {
        fail('TmlProgressionReadError', 'PROGRESSION_READ_INVALID_RESPONSE', 'progression read response is malformed');
      }

      const observedAt = ensureTime(now());
      const currentSequence = ++sequence;
      const subject = progressionSubject();
      const facts = [
        makeFact({
          id: `fact.${subject}.progression.total_exp.${token(observedAt)}.${currentSequence}`,
          subject,
          predicate: 'progression.total_exp',
          value: { type: 'number', value: parsed.totalExp },
          source: 'server.progression',
          observedAt,
          sequence: currentSequence
        }),
        makeFact({
          id: `fact.${subject}.progression.level.${token(observedAt)}.${currentSequence}`,
          subject,
          predicate: 'progression.level',
          value: { type: 'number', value: parsed.level },
          source: 'server.progression',
          observedAt,
          sequence: currentSequence
        })
      ];

      const observations = facts.map((fact) => makeObservation({
        id: `observation.${token(fact.subject)}.${fact.predicate}.${token(observedAt)}.${currentSequence}`,
        subject: fact.subject,
        predicate: fact.predicate,
        factId: fact.id,
        source: 'server.progression',
        observedAt,
        sequence: currentSequence
      }));

      return Object.freeze({
        capability: 'world.progression.read',
        source: 'server.progression',
        observedAt,
        sequence: currentSequence,
        snapshot: parsed,
        facts: Object.freeze(facts),
        observations: Object.freeze(observations)
      });
    }
  });
}
