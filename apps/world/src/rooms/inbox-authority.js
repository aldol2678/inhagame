// Defense in depth for already-authorized/cached provider channels. Only the authenticated
// admission RPC and per-recipient server fanout disclose this unguessable capability.
// It is not E2EE or protection against a compromised server/service key or the recipient itself.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createInboxAuthority(clock, maxLeaseMs) {
  const accepted = new Map();
  const prune = () => { for (const [nonce, until] of accepted) if (clock.now() >= until) accepted.delete(nonce); };
  return {
    admit(nonce, until) {
      prune();
      if (!UUID.test(nonce ?? '') || !Number.isFinite(until) || until <= clock.now() || until > clock.now() + maxLeaseMs) return false;
      accepted.set(nonce, until);
      // Rotating renewals can overlap in flight. Old capabilities never outlive their original
      // lease; cap memory independently of malicious or excessive renewal responses.
      while (accepted.size > 8) accepted.delete(accepted.keys().next().value);
      return true;
    },
    accepts(nonce) { prune(); return accepted.has(nonce); },
    clear() { accepted.clear(); }
  };
}
