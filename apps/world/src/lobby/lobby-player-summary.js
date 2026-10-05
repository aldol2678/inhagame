export const DEFAULT_LOBBY_CHARACTER = "기본 인덕이 · 기본 외형";

const formatCount = (value) => Number(value).toLocaleString("ko-KR");

export function lobbyProgressionText(view) {
  if (!view?.levelText || !view?.expText) return view?.fullText ?? "";
  return `${view.levelText} · ${String(view.expText).replace(/\s*\/\s*/g, "/")}`;
}

export function createLobbyPlayerSummary({
  nameElement,
  lookElement,
  progressionElement,
  walletElement,
  accountElement,
  profile,
  character
} = {}) {
  let progressionView = null;
  let walletBalance = null;

  const renderStats = () => {
    const signedIn = profile?.signedIn === true;

    if (progressionElement) {
      const text = signedIn ? lobbyProgressionText(progressionView) : "";
      progressionElement.textContent = text;
      progressionElement.hidden = !text;
    }

    if (walletElement) {
      const validBalance = signedIn && Number.isSafeInteger(walletBalance) && walletBalance >= 0;
      walletElement.textContent = validBalance ? `🪙 ${formatCount(walletBalance)}` : "";
      walletElement.hidden = !validBalance;
    }
  };

  const render = () => {
    if (nameElement) nameElement.textContent = profile?.nickname || "인덕이";
    if (lookElement) lookElement.textContent = DEFAULT_LOBBY_CHARACTER;
    if (accountElement) accountElement.textContent = profile?.signedIn ? "INHAGAME 계정" : "게스트";
    renderStats();
    return {
      nickname: profile?.nickname || "인덕이",
      signedIn: profile?.signedIn === true,
      character: DEFAULT_LOBBY_CHARACTER,
      modelState: character?.modelState ?? "unknown"
    };
  };

  const setProgression = (view) => {
    progressionView = view?.fullText ? view : null;
    renderStats();
    return progressionView;
  };

  const setWalletBalance = (balance) => {
    walletBalance = Number.isSafeInteger(balance) && balance >= 0 ? balance : null;
    renderStats();
    return walletBalance;
  };

  render();
  character?.ready?.then?.(render, render);

  return {
    render,
    setProgression,
    setWalletBalance,
    status: () => ({
      nickname: profile?.nickname || "인덕이",
      signedIn: profile?.signedIn === true,
      character: DEFAULT_LOBBY_CHARACTER,
      modelState: character?.modelState ?? "unknown"
    })
  };
}
