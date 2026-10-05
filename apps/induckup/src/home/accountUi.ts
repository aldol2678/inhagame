import { InhaGameAccount, type AccountSnapshot } from '../account/InhaGameAccount';

export function mountAccountUi(
  slot: HTMLElement,
  host: HTMLElement,
  onSnapshot?: (snapshot: AccountSnapshot) => void,
): InhaGameAccount {
  slot.innerHTML = '<button class="account-chip home-account-chip" type="button" data-account-open>👤 <span data-account-label>계정</span></button>';

  host.insertAdjacentHTML('beforeend', `
    <div class="account-overlay" data-account-overlay hidden>
      <section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="induckup-account-title">
        <div class="account-head">
          <h2 id="induckup-account-title">👤 INHAGAME 계정</h2>
          <button type="button" data-account-close aria-label="닫기">×</button>
        </div>
        <p class="account-status" data-account-status>계정 상태 확인 중...</p>
        <div class="account-guest" data-account-guest>
          <div class="account-tabs" role="tablist" aria-label="계정 메뉴">
            <button type="button" class="account-tab active" data-account-tab="signup">회원가입</button>
            <button type="button" class="account-tab" data-account-tab="login">로그인</button>
          </div>
          <div class="account-auth-panel" data-account-signup-panel>
            <p>게스트 기록을 유지하면서 INHAGAME 계정으로 연결합니다.</p>
            <label>이메일<input type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" data-account-signup-email></label>
            <button type="button" data-account-signup>1. 인증 메일 보내기</button>
            <button class="secondary" type="button" data-account-refresh>2. 인증 완료 확인</button>
            <p class="account-help">메일 인증 후 비밀번호를 설정하면 다른 기기에서도 인덕업 기록을 불러올 수 있습니다.</p>
          </div>
          <div class="account-auth-panel" data-account-login-panel hidden>
            <label>이메일<input type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" data-account-login-email></label>
            <label>비밀번호<input type="password" autocomplete="current-password" minlength="8" placeholder="8자 이상" data-account-login-password></label>
            <button type="button" data-account-password-login>로그인</button>
            <button class="secondary" type="button" data-account-login-link>로그인 링크 받기</button>
          </div>
        </div>
        <div class="account-permanent" data-account-permanent hidden>
          <p class="account-email" data-account-address></p>
          <div class="account-inha-badge">
            <p data-inha-verified hidden>🎓 인하 메일 인증 완료</p>
            <div data-inha-form>
              <label>인하대 메일<input type="email" inputmode="email" autocomplete="email" placeholder="name@inha.edu" data-inha-email></label>
              <button type="button" class="secondary" data-inha-request>1. 6자리 코드 받기</button>
              <label>인증 코드<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6자리 숫자" data-inha-code></label>
              <button type="button" class="secondary" data-inha-confirm>2. 코드 확인하고 뱃지 받기</button>
              <p class="account-help">로그인 이메일은 그대로 두고 인하대 메일 소유 여부만 확인합니다.</p>
            </div>
          </div>
          <div class="account-progress" data-account-progress></div>
          <div class="account-password-setup">
            <strong>비밀번호 설정 / 변경</strong>
            <label>비밀번호<input type="password" autocomplete="new-password" minlength="8" placeholder="8자 이상" data-account-new-password></label>
            <label>비밀번호 확인<input type="password" autocomplete="new-password" minlength="8" placeholder="한 번 더 입력" data-account-new-password-confirm></label>
            <button type="button" data-account-set-password>비밀번호 저장</button>
          </div>
          <button class="secondary" type="button" data-account-sync>지금 기록 동기화</button>
          <button class="secondary" type="button" data-account-signout>로그아웃</button>
        </div>
        <small>랭킹 기록은 일반 진행도와 분리해 서버에서 검증·저장합니다.</small>
      </section>
    </div>`);

  const account = new InhaGameAccount();
  const overlay = host.querySelector<HTMLElement>('[data-account-overlay]')!;
  const status = host.querySelector<HTMLElement>('[data-account-status]')!;
  const guest = host.querySelector<HTMLElement>('[data-account-guest]')!;
  const permanent = host.querySelector<HTMLElement>('[data-account-permanent]')!;
  const signupPanel = host.querySelector<HTMLElement>('[data-account-signup-panel]')!;
  const loginPanel = host.querySelector<HTMLElement>('[data-account-login-panel]')!;
  const signupEmail = host.querySelector<HTMLInputElement>('[data-account-signup-email]')!;
  const loginEmail = host.querySelector<HTMLInputElement>('[data-account-login-email]')!;
  const loginPassword = host.querySelector<HTMLInputElement>('[data-account-login-password]')!;
  const newPassword = host.querySelector<HTMLInputElement>('[data-account-new-password]')!;
  const newPasswordConfirm = host.querySelector<HTMLInputElement>('[data-account-new-password-confirm]')!;
  const inhaEmail = host.querySelector<HTMLInputElement>('[data-inha-email]')!;
  const inhaCode = host.querySelector<HTMLInputElement>('[data-inha-code]')!;
  const address = host.querySelector<HTMLElement>('[data-account-address]')!;
  const progress = host.querySelector<HTMLElement>('[data-account-progress]')!;
  const label = slot.querySelector<HTMLElement>('[data-account-label]')!;
  const verified = host.querySelector<HTMLElement>('[data-inha-verified]')!;
  const inhaForm = host.querySelector<HTMLElement>('[data-inha-form]')!;

  account.subscribe(snapshot => {
    status.textContent = snapshot.message;
    const isPermanent = snapshot.state === 'permanent';
    guest.hidden = isPermanent;
    permanent.hidden = !isPermanent;
    label.textContent = snapshot.inhaVerified ? '🎓 인하 인증' : isPermanent ? '연결됨' : '계정';
    verified.hidden = !snapshot.inhaVerified;
    inhaForm.hidden = snapshot.inhaVerified;
    if (isPermanent) {
      address.textContent = snapshot.email ?? '이메일 계정';
      progress.textContent =
        `플레이 ${snapshot.progress.runsRecorded} · CLEAR ${snapshot.progress.clears} · 최고 LV.${snapshot.progress.bestLevel} · 진화 ${snapshot.progress.maxEvolutions}`;
    }
    onSnapshot?.(snapshot);
  });

  const setMode = (mode: 'signup' | 'login') => {
    const signup = mode === 'signup';
    signupPanel.hidden = !signup;
    loginPanel.hidden = signup;
    host.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.accountTab === mode);
    });
  };

  slot.querySelector<HTMLButtonElement>('[data-account-open]')!.onclick = () => { overlay.hidden = false; };
  host.querySelector<HTMLButtonElement>('[data-account-close]')!.onclick = () => { overlay.hidden = true; };
  host.querySelectorAll<HTMLButtonElement>('[data-account-tab]').forEach(button => {
    button.onclick = () => setMode(button.dataset.accountTab === 'login' ? 'login' : 'signup');
  });
  host.querySelector<HTMLButtonElement>('[data-account-signup]')!.onclick =
    () => { void account.beginSignup(signupEmail.value); };
  host.querySelector<HTMLButtonElement>('[data-account-password-login]')!.onclick =
    () => { void account.signInWithPassword(loginEmail.value, loginPassword.value); };
  host.querySelector<HTMLButtonElement>('[data-account-login-link]')!.onclick =
    () => { void account.signInExisting(loginEmail.value); };
  host.querySelector<HTMLButtonElement>('[data-account-refresh]')!.onclick =
    () => { void account.refresh(); };
  host.querySelector<HTMLButtonElement>('[data-account-set-password]')!.onclick =
    () => { void account.setPassword(newPassword.value, newPasswordConfirm.value); };
  host.querySelector<HTMLButtonElement>('[data-account-sync]')!.onclick =
    () => { void account.syncNow(); };
  host.querySelector<HTMLButtonElement>('[data-inha-request]')!.onclick =
    () => { void account.requestInhaVerification(inhaEmail.value); };
  host.querySelector<HTMLButtonElement>('[data-inha-confirm]')!.onclick =
    () => { void account.confirmInhaVerification(inhaEmail.value, inhaCode.value); };
  host.querySelector<HTMLButtonElement>('[data-account-signout]')!.onclick =
    () => { void account.signOut(); };

  setMode('signup');
  void account.init();
  return account;
}
