// Ephemeral practice only. This model has no Inventory, Wallet, Life, Collection or RPC dependency.
export const COOKING_TRIAL_ORDER = Object.freeze({
  id: 'trial.late_lunch', title: '늦어진 점심', requester: '점심을 놓친 캠퍼스 근무자',
  conditions: Object.freeze(['먹기 편한 한입 크기', '소스는 적게, 순한 간']),
  disclosure: '무보상 체험 · 코인·EXP·SP·아이템 지급 없음 · 개인 재료 소모 없음'
});
const initial = () => ({ phase: 'ORDER', cuts: [], side: 0, heat: 'medium', cooked: [0, 0], sauce: null, feedback: '', success: false });
export function createCookingTrial({ getAccountId = () => null } = {}) {
  let accountId = null, generation = 0, active = false, data = initial();
  function close() { generation++; active = false; accountId = null; data = initial(); }
  function valid(token = generation) {
    if (active && getAccountId() !== accountId) close();
    return active && token === generation;
  }
  const snapshot = () => { valid(); return { ...data, cuts: [...data.cuts], cooked: [...data.cooked], active, accountId, generation }; };
  function act(action, value, token = generation) {
    if (!valid(token)) return false;
    data.feedback = '';
    if (action === 'retry') { data = initial(); return true; }
    if (data.phase === 'ORDER' && action === 'accept') { data.phase = 'PREP'; return true; }
    if (data.phase === 'PREP') {
      if (action === 'cut' && Number.isInteger(value) && value >= 0 && value < 3 && !data.cuts.includes(value)) {
        data.cuts.push(value); data.feedback = '칼집을 따라 잘랐어요. 한입 크기로 나눠 주세요.'; return true;
      }
      if (action === 'next') {
        if (data.cuts.length !== 3) { data.feedback = '세 곳의 칼집을 모두 잘라야 네 조각이 돼요.'; return false; }
        data.phase = 'GRILL'; return true;
      }
    }
    if (data.phase === 'GRILL') {
      if (action === 'heat' && ['low','medium','high'].includes(value)) { data.heat = value; return true; }
      if (action === 'flip') { data.side = 1 - data.side; data.feedback = '뒤집었어요. 양쪽 면의 색을 살펴보세요.'; return true; }
      if (action === 'cook') {
        data.cooked[data.side] += { low: 1, medium: 2, high: 4 }[data.heat];
        if (data.cooked[data.side] > 4) { data.phase = 'FAILED'; data.feedback = '한쪽 면이 탔어요. 중불 두 번 또는 약불 네 번으로 한 면을 익히고 뒤집어 보세요.'; }
        else data.feedback = data.cooked[data.side] === 4 ? '이 면은 노릇해졌어요. 반대쪽도 확인해 주세요.' : '아직 덜 익었어요. 불을 조절하고 한 번 더 구워 주세요.';
        return true;
      }
      if (action === 'next') {
        if (!data.cooked.every(v => v === 4)) { data.feedback = '양면이 모두 노릇해야 해요. 덜 익은 면을 조금 더 구워 주세요.'; return false; }
        data.phase = 'PLATE'; return true;
      }
    }
    if (data.phase === 'PLATE') {
      if (action === 'sauce' && ['light','rich'].includes(value)) { data.sauce = value; return true; }
      if (action === 'submit') {
        if (!data.sauce) { data.feedback = '주문 조건에 맞게 소스 양을 골라 주세요.'; return false; }
        data.success = data.sauce === 'light'; data.phase = data.success ? 'DONE' : 'FAILED';
        data.feedback = data.success ? '“한입 크기에 간도 순해서 좋아요. 덕분에 늦은 점심을 먹겠네요!”' : '“소스가 조금 많네요. 순하게 부탁드렸어요.” 소스를 적게 담아 다시 도전해 보세요.';
        return true;
      }
    }
    return false;
  }
  return { open({ accountId: actor = getAccountId() } = {}) {
    if (active || actor !== getAccountId()) return false;
    generation++; accountId = actor; active = true; data = initial(); return true;
  }, close, act, snapshot, valid };
}
