// Keeps one visible avatar per remote session, driven only by RemotePlayerManager samples.
// Rendering is delegated to `createAvatar(sample)` → { update(sample, dtSec), destroy() }, so this
// class stays engine-free. Avatars are visual only: no colliders, no effect on local physics.

export class RemotePlayerView {
  constructor({ createAvatar, localSessionId }) {
    this.createAvatar = createAvatar;
    this.localSessionId = localSessionId;
    this.avatars = new Map();
    this.spawned = 0;
    this.removed = 0;
  }

  get size() { return this.avatars.size; }
  has(sessionId) { return this.avatars.has(sessionId); }

  sync(samples, dtSec) {
    const seen = new Set();
    for (const sample of samples) {
      if (!sample?.pose || sample.sessionId === this.localSessionId || seen.has(sample.sessionId)) continue;
      seen.add(sample.sessionId);
      let avatar = this.avatars.get(sample.sessionId);
      if (!avatar) {
        avatar = this.createAvatar(sample);
        this.avatars.set(sample.sessionId, avatar);
        this.spawned += 1;
      }
      avatar.update(sample, dtSec);
    }
    for (const [sessionId, avatar] of this.avatars) {
      if (seen.has(sessionId)) continue;
      this.avatars.delete(sessionId);
      this.removed += 1;
      try { avatar.destroy(); } catch { /* a broken avatar never blocks cleanup */ }
    }
  }

  clear() {
    this.sync([], 0);
  }
}
