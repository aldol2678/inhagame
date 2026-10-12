// Local candidate only. Authorization is supplied by the host's current auth session, never storage here.
export function createIncomeCandidateRequest({ getAuthorization, fetcher = fetch,
  location = globalThis.location, getAccountEpoch = () => null, endpoint = '/api/world-income-candidate' }) {
  if (!['localhost', '127.0.0.1'].includes(location?.hostname) || endpoint !== '/api/world-income-candidate') {
    throw new Error('INCOME_CANDIDATE_LOCAL_ONLY');
  }
  return async body => {
    const epoch = getAccountEpoch();
    let authorization;
    try { authorization = await getAuthorization(); } catch { throw Object.assign(new Error('AUTH_UNAVAILABLE'), { code: 'AUTH_UNAVAILABLE', status: 503 }); }
    if (epoch !== getAccountEpoch()) throw Object.assign(new Error('AUTH_CHANGED'), { code: 'AUTH_CHANGED', status: 409 });
    if (!/^Bearer [A-Za-z0-9._~-]{20,4096}$/.test(authorization ?? '')) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED', status: 401 });
    let response, result;
    try {
      response = await fetcher(endpoint, { method: 'POST', redirect: 'error', credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
      result = await response.json();
    } catch { throw Object.assign(new Error('INCOME_UNAVAILABLE'), { code: 'INCOME_UNAVAILABLE', status: 503 }); }
    if (!response.ok) {
      const code = typeof result?.error === 'string' && /^[A-Z_]{1,80}$/.test(result.error) ? result.error : 'INCOME_UNAVAILABLE';
      throw Object.assign(new Error(code), { code, status: response.status });
    }
    return result;
  };
}
