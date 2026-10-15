import { isUserId } from "./social-client.js";

// Own the identity callback's social UI work as well as the client's cache lifetime.
// A stale rejection is as unsafe as a stale success: neither may clear the new account's UI.
export function createSocialAccountSession({ social, onAccountChange = () => {}, onFriends = () => {} }) {
  let epoch = 0;
  let disposed = false;

  async function setAccount(userId) {
    if (disposed) return false;
    const current = ++epoch;
    const account = isUserId(userId) ? userId : null;
    const changed = social.setAccount(account);
    if (current !== epoch || disposed) return false;
    if (changed) onAccountChange();
    if (current !== epoch || disposed) return false;
    // Cache reset notifications run first; the summary must finish unknown after logout.
    if (changed || !account) onFriends(null);
    if (!account || current !== epoch || disposed) return false;
    try {
      const data = await social.mine();
      if (current !== epoch || disposed) return false;
      onFriends(data.friends);
      return true;
    } catch {
      if (current === epoch && !disposed) onFriends(null);
      return false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    epoch++;
    social.dispose();
  }

  return { setAccount, dispose };
}
