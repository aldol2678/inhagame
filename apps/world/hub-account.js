(() => {
  'use strict';
  const status = document.getElementById('hub-account-status');
  const loginForm = document.getElementById('hub-login-form');
  const signupForm = document.getElementById('hub-signup-form');
  const socialAuth = document.getElementById('hub-social-auth');
  const googleButton = document.getElementById('hub-google-auth');
  const profileSetup = document.getElementById('hub-profile-setup');
  const tabs = document.getElementById('hub-auth-tabs');
  const actions = document.getElementById('hub-account-actions');
  const inhaCard = document.getElementById('hub-inha-verification-card');
  const inhaBadge = document.getElementById('hub-inha-verification-badge');
  const inhaStatus = document.getElementById('hub-inha-verification-status');
  const inhaControls = document.getElementById('hub-inha-verification-controls');
  const inhaEmail = document.getElementById('hub-inha-email');
  const inhaCode = document.getElementById('hub-inha-code');
  const inhaRequest = document.getElementById('hub-inha-request');
  const inhaConfirm = document.getElementById('hub-inha-confirm');
  const deleteOpen = document.getElementById('hub-delete-account-open');
  const deletePanel = document.getElementById('hub-delete-account-panel');
  const deleteInput = document.getElementById('hub-delete-account-confirmation');
  const deleteCancel = document.getElementById('hub-delete-account-cancel');
  const deleteConfirm = document.getElementById('hub-delete-account-confirm');
  const deleteStatus = document.getElementById('hub-delete-account-status');
  const linkedIdentities = document.getElementById('hub-linked-identities');
  const googleLinkButton = document.getElementById('hub-link-google');
  const googleLinkBadge = document.getElementById('hub-google-link-badge');
  const googleLinkStatus = document.getElementById('hub-google-link-status');
  const modeButtons = Array.from(document.querySelectorAll('[data-auth-mode]'));
  const client = window.supabase?.createClient?.(
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url),
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey)
  );
  if (!client) { status.textContent = '계정 서비스를 불러올 수 없습니다.'; return; }
  window.InhaHubAccountClient = client;

  let epoch = 0;
  let mode = 'signup';
  let memberActivityLastAt = 0;
  let memberActivityPending = false;
  const nicknamePattern = /^[0-9A-Za-z가-힣_ ]{2,12}$/u;
  const inhaEmailPattern = /^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/i;

  async function touchMemberActivity(user, force = false) {
    if (!user?.id || user.is_anonymous === true || !client?.rpc || memberActivityPending) return false;
    const now = Date.now();
    if (!force && now - memberActivityLastAt < 300000) return false;
    memberActivityPending = true;
    try {
      const result = await client.rpc('touch_inhagame_member_activity_v1', { p_surface:'hub' });
      if (result?.error) throw result.error;
      memberActivityLastAt = now;
      return true;
    } catch (error) {
      console.warn('Hub member activity touch failed', error);
      return false;
    } finally {
      memberActivityPending = false;
    }
  }

  function renderInhaVerification(signedIn, verified = false) {
    if (!inhaCard) return;
    inhaCard.hidden = !signedIn;
    if (!signedIn) return;
    inhaBadge.textContent = verified ? '🎓 인증 완료' : '미인증';
    inhaStatus.textContent = verified
      ? '인하대 이메일 소유 확인이 완료됐습니다.'
      : '아직 인하대 인증을 완료하지 않았습니다.';
    inhaControls.hidden = verified;
  }

  function setMode(next) {
    mode = next === 'login' ? 'login' : 'signup';
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.authMode === mode));
    }
    signupForm.hidden = mode !== 'signup';
    loginForm.hidden = mode !== 'login';
  }

  async function ensureProfile(user) {
    const { data: existing, error: readError } = await client.from('profiles')
      .select('nickname').eq('user_id', user.id).maybeSingle();
    if (readError) throw readError;
    if (existing) return { state:'ready', profile:existing };

    const candidate = String(user.user_metadata?.nickname || '').trim();
    if (!nicknamePattern.test(candidate)) {
      return { state:'setup_required', profile:null };
    }
    const { data: created, error: insertError } = await client.from('profiles')
      .insert({ user_id:user.id, nickname:candidate, department_id:null })
      .select('nickname').single();
    if (insertError) throw insertError;
    return { state:'ready', profile:created };
  }

  async function completeProfile(user, nickname) {
    const clean = String(nickname || '').trim();
    if (!nicknamePattern.test(clean)) throw new Error('INVALID_NICKNAME');
    const { data: created, error } = await client.from('profiles')
      .insert({ user_id:user.id, nickname:clean, department_id:null })
      .select('nickname').single();
    if (!error) return created;

    if (String(error.code || '') === '23505') {
      const { data: existing, error: readError } = await client.from('profiles')
        .select('nickname').eq('user_id', user.id).maybeSingle();
      if (!readError && existing) return existing;
    }
    throw error;
  }

  function oauthReturnError() {
    const search = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : '');
    const code = search.get('error') || hash.get('error');
    if (!code) return null;
    return search.get('error_description') || hash.get('error_description') ||
      'Google 로그인을 완료하지 못했습니다.';
  }

  function linkedGoogleReturn() {
    const search = new URLSearchParams(location.search);
    return search.get('identity_linked') === 'google';
  }

  async function refreshLinkedIdentities(signedIn) {
    if (!linkedIdentities || !googleLinkButton || !googleLinkBadge || !googleLinkStatus) return;
    linkedIdentities.hidden = !signedIn;
    googleLinkStatus.textContent = '';
    if (!signedIn) return;

    googleLinkButton.disabled = true;
    googleLinkBadge.textContent = '확인 중';
    try {
      const { data, error } = await client.auth.getUserIdentities();
      if (error) throw error;
      const identities = Array.isArray(data?.identities) ? data.identities : [];
      const googleLinked = identities.some(identity => identity?.provider === 'google');
      googleLinkBadge.textContent = googleLinked ? 'Google 연동됨' : '미연동';
      googleLinkButton.textContent = googleLinked ? 'Google 계정 연동됨' : 'Google 계정 연동';
      googleLinkButton.disabled = googleLinked;
      if (googleLinked && linkedGoogleReturn()) {
        googleLinkStatus.textContent = 'Google 계정 연결이 완료됐습니다.';
        history.replaceState(null, '', '/?panel=account');
      }
    } catch (error) {
      console.warn('Hub identity read failed', error);
      googleLinkBadge.textContent = '확인 실패';
      googleLinkButton.textContent = 'Google 계정 연동';
      googleLinkButton.disabled = false;
      googleLinkStatus.textContent = '연결 상태를 확인하지 못했습니다.';
    }
  }

  async function refresh() {
    const current = ++epoch;
    const { data, error } = await client.auth.getUser();
    if (current !== epoch) return;
    if (error && error.name !== 'AuthSessionMissingError') {
      status.textContent = '계정 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.';
      loginForm.hidden = signupForm.hidden = tabs.hidden = actions.hidden = true;
      return;
    }
    const user = data?.user;
    const signedIn = !!user?.id && user.is_anonymous !== true && !!user.email;
    socialAuth.hidden = signedIn;
    tabs.hidden = signedIn;
    actions.hidden = true;
    profileSetup.hidden = true;
    if (linkedIdentities) linkedIdentities.hidden = true;
    if (deletePanel) deletePanel.hidden = true;
    if (deleteInput) deleteInput.value = '';
    if (deleteConfirm) deleteConfirm.disabled = true;
    if (deleteStatus) deleteStatus.textContent = '';
    renderInhaVerification(false, false);
    const homeAccountCta = document.getElementById('hub-home-account-cta');
    if (homeAccountCta) homeAccountCta.hidden = signedIn;

    if (!signedIn) {
      const oauthError = oauthReturnError();
      const deleted = sessionStorage.getItem('inhagame-account-deleted-v1') === '1';
      if (deleted) sessionStorage.removeItem('inhagame-account-deleted-v1');
      status.textContent = deleted
        ? '계정 탈퇴가 완료됐습니다. 서버 계정과 연결 정보가 삭제됐습니다.'
        : oauthError
          ? 'Google 로그인 실패 · ' + oauthError
          : '회원가입하거나 기존 계정으로 로그인하세요.';
      socialAuth.hidden = false;
      setMode(mode);
      return;
    }

    signupForm.hidden = loginForm.hidden = true;
    void touchMemberActivity(user, true);
    try {
      const profileState = await ensureProfile(user);
      if (current !== epoch) return;
      if (profileState.state === 'setup_required') {
        tabs.hidden = true;
        socialAuth.hidden = true;
        actions.hidden = true;
        profileSetup.hidden = false;
        renderInhaVerification(false, false);
        status.textContent = 'Google 로그인 완료 · INHAGAME에서 사용할 닉네임을 정해 주세요.';
        return;
      }

      const { data: badge, error: badgeError } = await client.rpc('my_inha_mail_badge');
      if (current !== epoch) return;
      if (badgeError) throw badgeError;
      actions.hidden = false;
      profileSetup.hidden = true;
      renderInhaVerification(true, badge === true);
      await refreshLinkedIdentities(true);
      status.textContent = (profileState.profile?.nickname || 'INHAGAME 사용자') +
        (badge === true ? ' · 인하대 인증 완료' : ' · 로그인됨');
    } catch (profileError) {
      console.warn('Hub profile bootstrap failed', profileError);
      status.textContent = '로그인됐지만 프로필을 준비하지 못했습니다. 내 프로필에서 다시 확인해 주세요.';
    }
  }

  client.auth.onAuthStateChange(() => { setTimeout(() => void refresh(), 0); });

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.authMode));
  }

  googleButton?.addEventListener('click', async () => {
    googleButton.disabled = true;
    status.textContent = 'Google 로그인으로 이동하는 중…';
    try {
      const redirectTo = new URL('/?panel=account', location.origin).href;
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (googleError) {
      console.warn('Hub Google sign in failed', googleError);
      status.textContent = 'Google 로그인을 시작하지 못했습니다. 기존 이메일 로그인도 계속 사용할 수 있습니다.';
      googleButton.disabled = false;
    }
  });

  googleLinkButton?.addEventListener('click', async () => {
    googleLinkButton.disabled = true;
    googleLinkStatus.textContent = 'Google 계정 연결로 이동하는 중…';
    try {
      await getPermanentSession();
      const redirectTo = new URL('/?panel=account&identity_linked=google', location.origin).href;
      const { error } = await client.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo }
      });
      if (error) throw error;
    } catch (error) {
      console.warn('Hub Google identity linking failed', error);
      const message = String(error?.message || error);
      googleLinkStatus.textContent = /manual linking/i.test(message)
        ? 'Google 계정 연동 설정이 아직 활성화되지 않았습니다.'
        : /already|linked/i.test(message)
          ? '이미 다른 계정에 연결된 Google 계정입니다.'
          : 'Google 계정 연동을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      googleLinkButton.disabled = false;
    }
  });

  profileSetup?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!profileSetup.reportValidity()) return;
    const button = profileSetup.querySelector('button[type="submit"]');
    const nickname = profileSetup.elements.nickname.value.trim();
    if (!nicknamePattern.test(nickname)) {
      status.textContent = '닉네임은 한글·영문·숫자·공백·_ 조합 2~12자로 입력해 주세요.';
      return;
    }
    button.disabled = true;
    status.textContent = 'INHAGAME 프로필을 준비하는 중…';
    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      const user = data?.user;
      if (!user?.id || user.is_anonymous === true || !user.email) {
        throw new Error('PERMANENT_ACCOUNT_REQUIRED');
      }
      await completeProfile(user, nickname);
      profileSetup.elements.nickname.value = '';
      await refresh();
    } catch (profileError) {
      console.warn('Hub profile completion failed', profileError);
      status.textContent = '프로필을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
    } finally {
      button.disabled = false;
    }
  });

  signupForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!signupForm.reportValidity()) return;
    const button = signupForm.querySelector('button[type="submit"]');
    const nickname = signupForm.elements.nickname.value.trim();
    const email = signupForm.elements.email.value.trim().toLowerCase();
    const password = signupForm.elements.password.value;
    const confirmation = signupForm.elements.passwordConfirm.value;

    if (!nicknamePattern.test(nickname)) {
      status.textContent = '닉네임은 한글·영문·숫자·공백·_ 조합 2~12자로 입력해 주세요.';
      return;
    }
    if (password.length < 8) {
      status.textContent = '비밀번호는 8자 이상 입력해 주세요.';
      return;
    }
    if (password !== confirmation) {
      status.textContent = '비밀번호 확인이 일치하지 않습니다.';
      return;
    }

    button.disabled = true;
    status.textContent = '회원가입을 처리하는 중…';
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { nickname },
          emailRedirectTo: 'https://inhagame.example/?panel=account'
        }
      });
      if (error) throw error;
      signupForm.elements.password.value = '';
      signupForm.elements.passwordConfirm.value = '';
      if (data?.session?.user) {
        const profileState = await ensureProfile(data.session.user);
        if (profileState.state !== 'ready') throw new Error('PROFILE_SETUP_REQUIRED');
        status.textContent = '회원가입 완료 · INHAGAME 계정으로 로그인됐습니다.';
        await refresh();
      } else {
        status.textContent = '인증 메일을 보냈습니다. 이메일 인증 후 허브로 돌아오면 가입이 완료됩니다.';
      }
    } catch (signupError) {
      console.warn('Hub signup failed', signupError);
      const code = String(signupError?.code || '');
      const message = String(signupError?.message || '');
      status.textContent = code === 'weak_password'
        ? '사용하기 어려운 비밀번호예요. 8자 이상으로 더 안전하게 입력해 주세요.'
        : /rate limit/i.test(message)
          ? '인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
          : '회원가입을 완료하지 못했습니다. 입력 정보를 확인하거나 기존 계정으로 로그인해 주세요.';
    } finally {
      button.disabled = false;
    }
  });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = '로그인하는 중…';
    const { error } = await client.auth.signInWithPassword({
      email: loginForm.elements.email.value.trim().toLowerCase(),
      password: loginForm.elements.password.value
    });
    loginForm.elements.password.value = '';
    button.disabled = false;
    if (error) {
      status.textContent = /email not confirmed/i.test(String(error.message || ''))
        ? '이메일 인증을 먼저 완료해 주세요.'
        : '로그인에 실패했습니다. 계정 정보를 확인해 주세요.';
      return;
    }
    void refresh();
  });

  async function getPermanentSession() {
    const { data: { session }, error } = await client.auth.getSession();
    if (error) throw error;
    if (!session?.access_token || !session.user?.id || session.user.is_anonymous === true) {
      throw new Error('PERMANENT_ACCOUNT_REQUIRED');
    }
    return session;
  }

  inhaRequest?.addEventListener('click', async () => {
    const email = inhaEmail.value.trim().toLowerCase();
    if (!inhaEmailPattern.test(email)) {
      inhaStatus.textContent = '인하대 이메일(@inha.edu 또는 @inha.ac.kr)을 입력해 주세요.';
      return;
    }
    inhaRequest.disabled = true;
    inhaStatus.textContent = '인증 메일을 보내는 중…';
    try {
      await getPermanentSession();
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          // Production Auth template discriminator for the 6-digit Inha OTP email.
          emailRedirectTo: 'https://duck.inhagame.example/verify-inha.html'
        }
      });
      if (error) throw error;
      inhaStatus.textContent = '인증 메일을 보냈습니다. 메일의 6자리 코드를 아래에 입력해 주세요.';
    } catch (error) {
      console.warn('Hub Inha verification request failed', error);
      inhaStatus.textContent = /rate limit/i.test(String(error?.message || error))
        ? '인증 메일 요청이 많습니다. 잠시 후 다시 시도해 주세요.'
        : '인증 메일을 보내지 못했습니다. 로그인 상태와 이메일을 확인해 주세요.';
    } finally {
      inhaRequest.disabled = false;
    }
  });

  inhaConfirm?.addEventListener('click', async () => {
    const email = inhaEmail.value.trim().toLowerCase();
    const code = inhaCode.value.trim();
    if (!inhaEmailPattern.test(email) || !/^\d{6}$/.test(code)) {
      inhaStatus.textContent = '인하대 이메일과 6자리 인증 코드를 확인해 주세요.';
      return;
    }
    inhaConfirm.disabled = true;
    inhaStatus.textContent = '인하대 인증을 완료하는 중…';
    try {
      const primary = await getPermanentSession();
      const secondary = window.supabase.createClient(
        ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url),
        ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey),
        { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } }
      );
      const { data: school, error: otpError } = await secondary.auth.verifyOtp({
        email,
        token: code,
        type: 'email'
      });
      if (otpError || !school.session?.access_token) throw otpError || new Error('No school session');
      const response = await fetch('' + ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url) + '/functions/v1/verify-inha-mail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey),
          Authorization: 'Bearer ' + primary.access_token
        },
        body: JSON.stringify({ school_access_token: school.session.access_token })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.error === 'EMAIL_ALREADY_LINKED') {
          inhaStatus.textContent = '이미 다른 INHAGAME 계정에 연결된 인하대 이메일입니다.';
          return;
        }
        throw new Error(result.error || 'VERIFY_INHA_FAILED');
      }
      inhaCode.value = '';
      await client.rpc('get_my_achievements');
      inhaStatus.textContent = '🎓 인하대 인증 완료 · 「인하대 인증」 업적을 획득했습니다.';
      await refresh();
    } catch (error) {
      console.warn('Hub Inha verification confirmation failed', error);
      inhaStatus.textContent = '인증 코드가 만료됐거나 올바르지 않습니다. 새 인증 메일을 요청해 주세요.';
    } finally {
      inhaConfirm.disabled = false;
    }
  });

  deleteOpen?.addEventListener('click', () => {
    deletePanel.hidden = false;
    deleteInput.value = '';
    deleteConfirm.disabled = true;
    deleteStatus.textContent = '';
    deleteInput.focus();
  });

  deleteCancel?.addEventListener('click', () => {
    deletePanel.hidden = true;
    deleteInput.value = '';
    deleteConfirm.disabled = true;
    deleteStatus.textContent = '';
  });

  deleteInput?.addEventListener('input', () => {
    deleteConfirm.disabled = deleteInput.value.trim() !== '탈퇴';
  });

  deleteConfirm?.addEventListener('click', async () => {
    if (deleteInput.value.trim() !== '탈퇴') return;
    deleteConfirm.disabled = true;
    deleteCancel.disabled = true;
    deleteStatus.textContent = '계정을 삭제하는 중…';
    try {
      await getPermanentSession();
      const { data, error } = await client.rpc('delete_my_inhagame_account_v1', {
        p_confirmation: '탈퇴'
      });
      if (error) throw error;
      if (data?.deleted !== true) throw new Error('ACCOUNT_DELETE_FAILED');

      sessionStorage.setItem('inhagame-account-deleted-v1', '1');
      try { await client.auth.signOut({ scope: 'local' }); } catch {}
      try { localStorage.removeItem('sb-oosshdsthgpqabjmbkjo-auth-token'); } catch {}
      location.replace('/?panel=account');
    } catch (error) {
      console.warn('Hub account deletion failed', error);
      const message = String(error?.message || error);
      deleteStatus.textContent = message.includes('ACCOUNT_REAUTH_REQUIRED')
        ? '보안을 위해 로그아웃한 뒤 다시 로그인하고 15분 안에 탈퇴를 다시 시도해 주세요.'
        : message.includes('STAFF_ACCOUNT_DELETION_BLOCKED')
          ? '운영자·GM 계정은 권한을 다른 계정으로 이전한 뒤 탈퇴할 수 있습니다.'
          : '계정을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      deleteConfirm.disabled = deleteInput.value.trim() !== '탈퇴';
      deleteCancel.disabled = false;
    }
  });

  document.getElementById('hub-sign-out').addEventListener('click', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) { status.textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; return; }
    epoch++;
    setMode('signup');
    void refresh();
  });

  setMode('signup');
  void refresh();
})();
