// Evidence classification only. It does not change the application, server or assertion outcome
// for errors during active play. Keep scope identities in memory, never in public artifacts.
export function isConfirmedRevokeRace({request, status, error, startedAt, receivedAt, revoke}) {
  return !!(revoke && revoke.status === 200 && revoke.active === false &&
    request?.op === 'move' && status === 409 && error === 'CONVENIENCE_SESSION_EXPIRED' &&
    ['connectionId', 'authoritySessionId'].every(key => typeof request[key] === 'string' && request[key].length > 0 && request[key] === revoke.request?.[key]) &&
    Number.isSafeInteger(request.fence) && request.fence > 0 && request.fence === revoke.request?.fence &&
    Number.isSafeInteger(revoke.sequence) && request.command?.sequence === revoke.sequence + 1 &&
    [startedAt, receivedAt, revoke.startedAt, revoke.receivedAt].every(Number.isFinite) &&
    startedAt <= revoke.startedAt && receivedAt >= revoke.receivedAt);
}

export function unexpectedBrowserProblems(problems, authorityUrl, confirmedRaceCount) {
  let http = confirmedRaceCount, console = confirmedRaceCount;
  return problems.filter(problem => {
    if (http > 0 && problem === `HTTP 409: ${authorityUrl}`) { http--; return false; }
    if (console > 0 && problem === `console.error: Failed to load resource: the server responded with a status of 409 (Conflict) (${authorityUrl})`) { console--; return false; }
    return true;
  });
}
