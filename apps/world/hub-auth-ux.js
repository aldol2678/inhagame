/* Visual-only auth enhancements. Existing Supabase flows remain in hub-account.js. */
(() => {
  'use strict';
  const tabs = document.getElementById('hub-auth-tabs');
  const loginTab = tabs?.querySelector('[data-auth-mode="login"]');
  if (!tabs || !loginTab) return;

  // The auth controller initializes in signup mode. Choose login as the
  // initial view only after its event listeners are installed.
  const showLoginOnEntry = () => {
    if (!tabs.hidden) loginTab.click();
  };
  const observer = new MutationObserver(() => showLoginOnEntry());
  observer.observe(tabs, { attributes: true, attributeFilter: ['hidden'] });
  showLoginOnEntry();

  const revealButtons = Array.from(document.querySelectorAll('[data-auth-password-toggle]'));
  function concealAllPasswords() {
    for (const button of revealButtons) {
      const input = button.parentElement?.querySelector('input');
      if (!input) continue;
      input.type = 'password';
      button.textContent = '보기';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', input.name === 'passwordConfirm' ? '비밀번호 확인 표시' : '비밀번호 표시');
    }
  }
  for (const button of revealButtons) {
    button.addEventListener('click', () => {
      const input = button.parentElement?.querySelector('input');
      if (!input) return;
      const isNowVisible = input.type === 'password';
      input.type = isNowVisible ? 'text' : 'password';
      button.textContent = isNowVisible ? '숨기기' : '보기';
      button.setAttribute('aria-pressed', String(isNowVisible));
      button.setAttribute('aria-label', (input.name === 'passwordConfirm' ? '비밀번호 확인 ' : '비밀번호 ') + (isNowVisible ? '숨기기' : '표시'));
      input.focus({ preventScroll: true });
    });
  }
  for (const tab of tabs.querySelectorAll('[data-auth-mode]')) {
    tab.addEventListener('click', concealAllPasswords);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) concealAllPasswords();
  });
})();
