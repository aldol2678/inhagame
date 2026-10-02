import {
  emptyInduckUpProgress,
  mergeInduckUpProgress,
  normalizeInduckUpProgress,
  recordInduckUpRun,
  type InduckUpProgress,
  type InduckUpRunResult,
} from './accountProgress';
import {
  clearLocalCampaignProgress, loadCampaignProgress, mergeCampaignProgress, saveCampaignProgress,
} from '../home/progress';
import { activeCosmetic, activeEquipment, emptyMeta, mergeMeta, normalizeMeta,
  equipmentUnlocked, cosmeticUnlocked, type EquipmentId, type CosmeticId,
} from '../home/equipment';

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config/supabase-public-config.js';
const LOCAL_KEY = 'induckupProgressV1';
const GUEST_KEY = 'induckupGuestProgressV1';

interface UserLike {
  id: string;
  email?: string | null;
  is_anonymous?: boolean;
}

interface SessionLike { user: UserLike; access_token?: string }

interface SupabaseLike {
  auth: {
    getSession(): Promise<{ data: { session: SessionLike | null }; error?: unknown }>;
    signInAnonymously(): Promise<{ data: { user?: UserLike | null; session?: SessionLike | null }; error?: unknown }>;
    updateUser(attributes: { email?: string; password?: string }): Promise<{ data: unknown; error?: unknown }>;
    signInWithPassword(args: { email: string; password: string }):
      Promise<{ data: { user?: UserLike | null; session?: SessionLike | null }; error?: unknown }>;
    signInWithOtp(args: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }):
      Promise<{ data: unknown; error?: unknown }>;
    verifyOtp(args: { email: string; token: string; type: 'email' }):
      Promise<{ data: { session?: SessionLike | null }; error?: unknown }>;
    refreshSession(): Promise<{ data: { session: SessionLike | null }; error?: unknown }>;
    signOut(options: { scope: 'local' }): Promise<{ error?: unknown }>;
    onAuthStateChange(callback: (event: string, session: SessionLike | null) => void):
      { data: { subscription: { unsubscribe(): void } } };
  };
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error?: unknown }>;
}

declare global {
  interface Window {
    supabase?: {
      createClient(url: string, key: string, options: Record<string, unknown>): SupabaseLike;
    };
  }
}

export type AccountState = 'unavailable' | 'guest' | 'permanent';

export interface AccountSnapshot {
  state: AccountState;
  email: string | null;
  inhaVerified: boolean;
  progress: InduckUpProgress;
  message: string;
}

type Listener = (snapshot: AccountSnapshot) => void;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message?: unknown }).message ?? '');
  return String(error ?? '');
}

export class InhaGameAccount {
  private readonly client: SupabaseLike | null;
  private user: UserLike | null = null;
  private progress = this.loadLocal();
  private listener: Listener | null = null;
  private cloudReady = false;
  private syncTimer: number | null = null;
  private emailRequestBlockedUntil = 0;
  private inhaVerified = false;
  private memberActivityLastAt = 0;
  private memberActivityPending = false;

  constructor() {
    this.client = window.supabase?.createClient
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
      : null;
  }

  private async touchMemberActivity(force = false): Promise<boolean> {
    if (!this.client || !this.isPermanent() || this.memberActivityPending) return false;
    const now = Date.now();
    if (!force && now - this.memberActivityLastAt < 300_000) return false;
    this.memberActivityPending = true;
    try {
      const result = await this.client.rpc('touch_inhagame_member_activity_v1', { p_surface: 'induckup' });
      if (result?.error) throw result.error;
      this.memberActivityLastAt = now;
      return true;
    } catch (error) {
      console.warn('INHAGAME member activity touch failed', error);
      return false;
    } finally {
      this.memberActivityPending = false;
    }
  }

  subscribe(listener: Listener): void {
    this.listener = listener;
    this.emit(this.client ? '계정 상태 확인 중...' : '계정 서비스를 불러오지 못했습니다.');
  }

  getProgress(): InduckUpProgress {
    return normalizeInduckUpProgress(this.progress);
  }

  getActiveEquipment(): EquipmentId | null {
    if (this.isPermanent() && !this.cloudReady) return null;
    return activeEquipment(this.progress.campaign, this.progress.meta);
  }

  getActiveCosmetic(): CosmeticId | null {
    if (this.isPermanent() && !this.cloudReady) return null;
    return activeCosmetic(this.progress.campaign, this.progress.meta);
  }

  async selectEquipment(id: EquipmentId | null): Promise<boolean> {
    if (id && !equipmentUnlocked(this.progress.campaign, id)) return false;
    if (this.isPermanent() && !(await this.refreshSelection())) return false;
    if (id && !equipmentUnlocked(this.progress.campaign, id)) return false;
    this.progress.meta = { ...this.progress.meta, selectedEquipmentId: id,
      equipmentChangedAt: new Date().toISOString() };
    this.saveLocal();
    if (this.isPermanent()) {
      if (!(await this.pushCloud(true))) {
        this.emit('선택을 기기에 저장했지만 클라우드 동기화에 실패했습니다. 다시 시도해 주세요.');
        return true;
      }
    }
    this.emit(id ? '장비를 선택했습니다. 다음 캠페인 런부터 적용됩니다.' : '장비를 해제했습니다.');
    return true;
  }

  async selectCosmetic(id: CosmeticId | null): Promise<boolean> {
    if (id && !cosmeticUnlocked(this.progress.campaign, id)) return false;
    if (this.isPermanent() && !(await this.refreshSelection())) return false;
    if (id && !cosmeticUnlocked(this.progress.campaign, id)) return false;
    this.progress.meta = { ...this.progress.meta, selectedCosmeticId: id,
      cosmeticChangedAt: new Date().toISOString() };
    this.saveLocal();
    if (this.isPermanent()) {
      if (!(await this.pushCloud(true))) {
        this.emit('선택을 기기에 저장했지만 클라우드 동기화에 실패했습니다. 다시 시도해 주세요.');
        return true;
      }
    }
    this.emit(id ? '외형을 선택했습니다.' : '외형을 해제했습니다.');
    return true;
  }

  private async refreshSelection(): Promise<boolean> {
    if (!this.client || !this.cloudReady || !this.user) return false;
    const userId = this.user.id;
    try {
      const { data, error } = await this.client.rpc('get_my_game_progress', { p_game_slug: 'induckup' });
      if (error || this.user?.id !== userId) return false;
      const row = Array.isArray(data) ? data[0] as { progress?: unknown } | undefined : undefined;
      if (row?.progress) {
        const remote = normalizeInduckUpProgress(row.progress);
        this.progress = mergeInduckUpProgress(this.progress, remote);
      }
      return true;
    } catch { return false; }
  }

  async init(): Promise<void> {
    if (!this.client) return;
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      this.user = data.session?.user ?? null;
      if (this.isPermanent()) { void this.touchMemberActivity(true); await this.loadInhaBadge(); await this.syncFromCloud(); }
      else this.emit('게스트 플레이 중 · 로그인 없이도 계속 플레이할 수 있어요.');
      this.client.auth.onAuthStateChange((_event, session) => {
        if (this.user?.id !== session?.user?.id) this.inhaVerified = false;
        this.user = session?.user ?? null;
        if (!this.user) {
          this.cloudReady = false;
          if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
          this.syncTimer = null;
        }
        setTimeout(() => {
          if (this.isPermanent()) { void this.touchMemberActivity(true); void this.loadInhaBadge(); }
          else this.inhaVerified = false;
          if (this.isPermanent() && !this.cloudReady) void this.syncFromCloud();
          else this.emit(this.isPermanent() ? 'INHAGAME 계정 연결됨' : '게스트 플레이 중');
        }, 0);
      });
    } catch (error) {
      console.warn('INHAGAME account init failed', error);
      this.emit('계정 상태를 확인하지 못했습니다.');
    }
  }

  async ensureGuest(): Promise<UserLike | null> {
    if (!this.client) return null;
    if (this.user) return this.user;
    try {
      const { data, error } = await this.client.auth.signInAnonymously();
      if (error) throw error;
      this.user = data.user ?? data.session?.user ?? null;
      this.emit('게스트 계정 준비 완료');
      return this.user;
    } catch (error) {
      console.warn('anonymous auth failed', error);
      this.emit('게스트 계정을 준비하지 못했습니다.');
      return null;
    }
  }

  async beginSignup(email: string): Promise<boolean> {
    if (!this.client) return false;
    if (!this.canRequestEmail()) return false;
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      this.emit('이메일 주소를 확인해 주세요.');
      return false;
    }
    const user = await this.ensureGuest();
    if (!user) return false;
    if (this.isPermanent()) {
      this.emit('이미 INHAGAME 계정이 연결되어 있습니다.');
      return true;
    }
    try {
      this.emit('회원가입 인증 메일을 보내는 중...');
      const { error } = await this.client.auth.updateUser({ email: clean });
      if (error) throw error;
      this.blockEmailRequests();
      this.emit('회원가입 인증 메일을 보냈어요. 메일 인증 후 돌아와 “인증 완료 확인”을 눌러 주세요.');
      return true;
    } catch (error) {
      console.warn('email link failed', error);
      const message = errorMessage(error);
      if (/rate limit/i.test(message)) {
        this.blockEmailRequests();
        this.emit('회원가입 메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.');
      } else if (/already|registered|exists|identity/i.test(message)) {
        this.emit('이미 가입된 이메일일 수 있어요. 로그인 탭에서 로그인해 주세요.');
      } else {
        this.emit('회원가입을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      return false;
    }
  }

  async signInWithPassword(email: string, password: string): Promise<boolean> {
    if (!this.client) return false;
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      this.emit('이메일 주소를 확인해 주세요.');
      return false;
    }
    if (password.length < 8) {
      this.emit('비밀번호는 8자 이상 입력해 주세요.');
      return false;
    }
    try {
      this.emit('로그인 중...');
      const { data, error } = await this.client.auth.signInWithPassword({ email: clean, password });
      if (error) throw error;
      this.user = data.user ?? data.session?.user ?? null;
      this.cloudReady = false;
      if (!this.isPermanent()) {
        this.emit('정식 계정 로그인에 실패했습니다.');
        return false;
      }
      void this.touchMemberActivity(true);
      await this.loadInhaBadge();
      await this.syncFromCloud();
      this.emit('로그인 완료 · INHAGAME 계정이 연결됐습니다.');
      return true;
    } catch (error) {
      console.warn('password sign in failed', error);
      const message = errorMessage(error);
      this.emit(/invalid login credentials/i.test(message)
        ? '이메일 또는 비밀번호가 맞지 않습니다.'
        : /email not confirmed/i.test(message)
          ? '이메일 인증을 먼저 완료해 주세요.'
          : '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }
  }

  async setPassword(password: string, confirmation: string): Promise<boolean> {
    if (!this.client || !this.isPermanent()) {
      this.emit('이메일 인증을 먼저 완료해 주세요.');
      return false;
    }
    if (password.length < 8) {
      this.emit('비밀번호는 8자 이상 입력해 주세요.');
      return false;
    }
    if (password !== confirmation) {
      this.emit('비밀번호 확인이 일치하지 않습니다.');
      return false;
    }
    try {
      this.emit('비밀번호를 설정하는 중...');
      const { error } = await this.client.auth.updateUser({ password });
      if (error) throw error;
      this.emit('회원가입 완료 · 이제 이메일과 비밀번호로 로그인할 수 있습니다.');
      return true;
    } catch (error) {
      console.warn('password setup failed', error);
      this.emit('비밀번호를 설정하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }
  }

  async signInExisting(email: string): Promise<boolean> {
    if (!this.client) return false;
    if (!this.canRequestEmail()) return false;
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      this.emit('이메일 주소를 확인해 주세요.');
      return false;
    }
    try {
      this.emit('로그인 링크를 보내는 중...');
      const { error } = await this.client.auth.signInWithOtp({
        email: clean,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${location.origin}/`,
        },
      });
      if (error) throw error;
      this.blockEmailRequests();
      this.emit('로그인 링크를 보냈어요. 메일에서 열면 이 기기에서도 같은 계정을 사용할 수 있습니다.');
      return true;
    } catch (error) {
      console.warn('existing account sign in failed', error);
      const message = errorMessage(error);
      if (/rate limit/i.test(message)) {
        this.blockEmailRequests();
        this.emit('로그인 메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.');
      } else if (/signups not allowed for otp/i.test(message)) {
        this.emit('가입된 계정을 찾지 못했습니다. 회원가입 탭에서 먼저 가입해 주세요.');
      } else {
        this.emit('기존 계정 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
      return false;
    }
  }

  async refresh(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const { data, error } = await this.client.auth.refreshSession();
      if (error) throw error;
      this.user = data.session?.user ?? this.user;
      this.cloudReady = false;
      if (this.isPermanent()) {
        await this.loadInhaBadge();
        await this.syncFromCloud();
        return true;
      }
      this.emit('아직 이메일 인증이 완료되지 않았습니다.');
      return false;
    } catch (error) {
      console.warn('account refresh failed', error);
      this.emit('인증 상태를 확인하지 못했습니다.');
      return false;
    }
  }

  async requestInhaVerification(email: string): Promise<boolean> {
    if (!this.client || !this.isPermanent() || !this.user) {
      this.emit('기존 계정으로 먼저 로그인해 주세요.');
      return false;
    }
    if (!this.canRequestEmail()) return false;
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/.test(clean)) {
      this.emit('인하대 메일 주소(@inha.edu 또는 @inha.ac.kr)를 입력해 주세요.');
      return false;
    }
    try {
      this.emit('인하대 메일로 인증 링크를 보내는 중...');
      const { error } = await this.client.auth.signInWithOtp({
        email: clean,
        options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/verify-inha.html` },
      });
      if (error) throw error;
      this.blockEmailRequests();
      this.emit('인증 링크를 보냈어요. 메일의 6자리 코드를 아래에 입력하면 기존 계정에 뱃지가 추가됩니다.');
      return true;
    } catch (error) {
      console.warn('school mailbox verification request failed', error);
      this.emit(/rate limit/i.test(errorMessage(error))
        ? '인증 메일 요청이 잦아요. 잠시 후 다시 시도해 주세요.'
        : '인증 링크를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }
  }

  async confirmInhaVerification(email: string, code: string): Promise<boolean> {
    if (!this.client || !this.isPermanent() || !this.user) return false;
    const clean = email.trim().toLowerCase();
    if (!/^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/.test(clean) || !/^\d{6}$/.test(code.trim())) {
      this.emit('인하대 메일과 6자리 인증 코드를 확인해 주세요.');
      return false;
    }
    try {
      this.emit('인하대 메일 인증 중...');
      const secondary = window.supabase!.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data: verified, error: otpError } = await secondary.auth.verifyOtp({
        email: clean, token: code.trim(), type: 'email',
      });
      if (otpError || !verified.session?.access_token) throw otpError ?? new Error('No school session');
      const { data: { session: original } } = await this.client.auth.getSession();
      if (!original?.access_token || original.user.id !== this.user.id) throw new Error('Primary session changed');
      const response = await fetch(`${SUPABASE_URL}/functions/v1/verify-inha-mail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${original.access_token}`,
        },
        body: JSON.stringify({ school_access_token: verified.session.access_token }),
      });
      const result = await response.json();
      if (!response.ok) {
        this.emit(result.error === 'EMAIL_ALREADY_LINKED'
          ? '이미 다른 계정에서 사용 중인 인하대 메일입니다.'
          : '인증을 완료하지 못했어요. 코드를 다시 확인해 주세요.');
        return false;
      }
      await this.loadInhaBadge();
      this.emit('🎓 인하 메일 인증 뱃지가 추가됐어요.');
      return true;
    } catch (error) {
      console.warn('school mailbox confirmation failed', error);
      this.emit('인증 코드가 만료되었거나 맞지 않아요. 새 인증 메일을 요청해 주세요.');
      return false;
    }
  }

  private async loadInhaBadge(): Promise<void> {
    if (!this.client || !this.isPermanent() || !this.user) return;
    const userId = this.user.id;
    const { data, error } = await this.client.rpc('my_inha_mail_badge', {});
    if (error || this.user?.id !== userId) return;
    this.inhaVerified = data === true;
    this.emit('INHAGAME 계정 연결됨');
  }

  async signOut(): Promise<boolean> {
    if (!this.client || !this.isPermanent() || !this.user) return false;
    const previousId = this.user.id;
    const previousProgress = this.getProgress();
    this.emit('로그아웃 중...');
    try {
      // A CLEAR may be waiting in the debounce queue when the user signs out.
      // Submit while the authenticated session still exists.
      if (!this.cloudReady) await this.syncFromCloud();
      if (this.cloudReady) await this.pushCloud(true);
      const { error } = await this.client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
      this.syncTimer = null;
      try {
        localStorage.setItem(`induckupAccountProgressV1:${previousId}`, JSON.stringify(previousProgress));
        localStorage.removeItem(LOCAL_KEY);
        clearLocalCampaignProgress();
      } catch (storageError) {
        console.warn('induckup local progress reset failed', storageError);
      }
      this.user = null;
      this.inhaVerified = false;
      this.cloudReady = false;
      try {
        this.progress = mergeInduckUpProgress(emptyInduckUpProgress(),
          JSON.parse(localStorage.getItem(GUEST_KEY) ?? 'null'));
        saveCampaignProgress(this.progress.campaign);
        if (localStorage.getItem(GUEST_KEY)) localStorage.setItem(LOCAL_KEY, JSON.stringify(this.progress));
      } catch { this.progress = emptyInduckUpProgress(); }
      this.emit('이 게임에서 로그아웃했습니다.');
      window.location.reload();
      return true;
    } catch (error) {
      console.warn('account sign out failed', error);
      this.emit('로그아웃에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      return false;
    }
  }

  recordRun(result: InduckUpRunResult): void {
    this.progress = recordInduckUpRun(this.progress, result);
    this.saveLocal();
    this.emit(this.isPermanent() ? '플레이 기록 저장됨 · 클라우드 동기화 대기' : '플레이 기록 저장됨 · 게스트 기기 저장');
    if (this.isPermanent() && this.cloudReady) this.scheduleCloudSync();
  }

  async syncNow(): Promise<boolean> {
    if (!this.isPermanent()) {
      this.emit('계정을 연결하면 클라우드 동기화를 사용할 수 있어요.');
      return false;
    }
    return this.pushCloud(false);
  }

  private isPermanent(): boolean {
    return this.user?.is_anonymous === false;
  }

  private canRequestEmail(): boolean {
    const remainingMs = this.emailRequestBlockedUntil - Date.now();
    if (remainingMs <= 0) return true;
    const seconds = Math.ceil(remainingMs / 1000);
    this.emit(`인증 메일 재요청까지 약 ${seconds}초 기다려 주세요.`);
    return false;
  }

  private blockEmailRequests(seconds = 60): void {
    this.emailRequestBlockedUntil = Math.max(this.emailRequestBlockedUntil, Date.now() + seconds * 1000);
  }

  private loadLocal(): InduckUpProgress {
    try {
      const current = normalizeInduckUpProgress(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'));
      current.campaign = mergeCampaignProgress(current.campaign, loadCampaignProgress());
      return current;
    } catch {
      return emptyInduckUpProgress();
    }
  }

  private saveLocal(): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.progress));
      saveCampaignProgress(this.progress.campaign);
      if (!this.isPermanent()) localStorage.setItem(GUEST_KEY, JSON.stringify(this.progress));
    } catch {}
  }

  private async syncFromCloud(): Promise<void> {
    if (!this.client || !this.isPermanent() || !this.user) return;
    const userId = this.user.id;
    let accountMeta = emptyMeta();
    try {
      const cached = localStorage.getItem(`induckupAccountProgressV1:${userId}`);
      if (cached) {
        const cachedProgress = JSON.parse(cached);
        accountMeta = normalizeMeta(cachedProgress?.meta);
        this.progress = mergeInduckUpProgress(this.progress, cachedProgress);
        this.saveLocal();
      }
    } catch (error) {
      console.warn('account progress cache unavailable', error);
    }
    try {
      const { data, error } = await this.client.rpc('get_my_game_progress', { p_game_slug: 'induckup' });
      if (this.user?.id !== userId) return;
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] as { progress?: unknown } | undefined : undefined;
      if (row?.progress) {
        this.progress = mergeInduckUpProgress(this.progress, row.progress);
        // Campaign CLEARs may migrate from a guest, but account equipment choices may not.
        this.progress.meta = mergeMeta(accountMeta, normalizeInduckUpProgress(row.progress).meta);
        this.saveLocal();
        this.cloudReady = true;
        await this.pushCloud(true);
      } else {
        this.progress.meta = accountMeta;
        this.saveLocal();
        this.cloudReady = true;
        await this.pushCloud(true, true);
      }
      this.emit('INHAGAME 계정 연결됨 · 인덕업 기록 동기화 중');
    } catch (error) {
      console.warn('cloud progress load failed', error);
      this.emit('계정은 연결됐지만 인덕업 클라우드 기록을 불러오지 못했습니다.');
    }
  }

  private scheduleCloudSync(): void {
    if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = null;
      void this.pushCloud(true);
    }, 800);
  }

  private async pushCloud(quiet: boolean, migratedFromLocal = false): Promise<boolean> {
    if (!this.client || !this.isPermanent() || !this.user) return false;
    const userId = this.user.id;
    try {
      const { error } = await this.client.rpc('save_my_game_progress', {
        p_game_slug: 'induckup',
        p_progress: this.progress,
        p_schema_version: 1,
        p_migrated_from_local: migratedFromLocal,
      });
      if (this.user?.id !== userId) return false;
      if (error) throw error;
      this.cloudReady = true;
      try { localStorage.removeItem(`induckupAccountProgressV1:${userId}`); } catch {}
      if (!quiet) this.emit('인덕업 기록을 클라우드에 동기화했습니다.');
      return true;
    } catch (error) {
      console.warn('cloud progress save failed', error);
      if (!quiet) this.emit('클라우드 동기화에 실패했습니다.');
      return false;
    }
  }

  private emit(message: string): void {
    this.listener?.({
      state: !this.client ? 'unavailable' : this.isPermanent() ? 'permanent' : 'guest',
      email: this.user?.email ?? null,
      inhaVerified: this.isPermanent() && this.inhaVerified,
      progress: this.getProgress(),
      message,
    });
  }
}
