// Classic · Wires UI handlers and starts account auth, the event countdown and focus refresh.
// Classic script (not a module): shares one global scope with the other js/*.js files and must
// load in index.html order: dom -> online -> game -> boot.
updateSoundButton();
soundToggleBtn.onclick=toggleSound;
homeGameBtn.onclick=openExitConfirm;
resumeGameBtn.onclick=resumeFromExitConfirm;
exitToHomeBtn.onclick=exitRunToHome;
document.getElementById('startBtn').onclick=startGame;
document.getElementById('restartBtn').onclick=startGame;
document.getElementById('stageSelectBtn').onclick=()=>{
  const context=lastGeneralResultContext;
  if(context){
    void logGeneralProgressionEvent('stage_select_return',context,null);
  }
  lastGeneralResultContext=null;
  endOverlay.classList.add('hidden');
  startOverlay.classList.remove('hidden');
  setPlayState('HOME');
  setTelemetryLastScreen('stage_select');
  void logTelemetryUiEvent('stage_select_view','stage_select');
  renderStageGrid();
  void refreshEventLeaderboard({force:true});
};
document.getElementById('nextStageBtn').onclick=()=>{
  const context=lastGeneralResultContext;
  if(stageCfg().id<4){
    if(context?.targetStageId){
      void logGeneralProgressionEvent('next_stage_cta_click',context,context.targetStageId);
    }
    currentStageIndex++;
    applyStage();
    endOverlay.classList.add('hidden');
    startGame();
  }
};

accountOpenBtn.onclick=openAccount;
accountCloseBtn.onclick=closeAccount;
accountSignupTab.onclick=()=>setAccountMode('signup');
accountLoginTab.onclick=()=>setAccountMode('login');
accountSignupBtn.onclick=beginAccountSignup;
accountPasswordLoginBtn.onclick=signInAccountPassword;
accountLoginLinkBtn.onclick=sendAccountLoginLink;
accountSetPasswordBtn.onclick=setAccountPassword;
accountRefreshBtn.onclick=refreshAccountState;
accountSignOutBtn.onclick=signOutAccount;
accountInhaRequestBtn.onclick=requestInhaBadge;
accountInhaConfirmBtn.onclick=confirmInhaBadge;
accountNicknameSaveBtn.onclick=saveAccountNickname;
document.getElementById('rankingOpenBtn').onclick=()=>{rankingMode='general';rankingTab='overall';openRanking();};
document.getElementById('eventRankingBtn').onclick=()=>{rankingMode='ranked';rankingTab='overall';openRanking();};
document.getElementById('rankingCloseBtn').onclick=closeRanking;
document.getElementById('badgeCollectionBtn').onclick=openBadgeCollection;
document.getElementById('badgeCloseBtn').onclick=closeBadgeCollection;
resultRankingBtn.onclick=()=>{rankingMode='ranked';rankingTab='overall';openRanking();};
document.getElementById('profileSaveBtn').onclick=saveOnlineProfile;
document.querySelectorAll('.ranking-mode-tab').forEach(b=>b.onclick=async()=>{
  rankingMode=b.dataset.rankingMode;rankingTab='overall';await renderLeaderboard();
});
document.querySelectorAll('.rank-tab').forEach(b=>b.onclick=async()=>{rankingTab=b.dataset.rankTab;await renderLeaderboard();});
document.getElementById('shareBtn').onclick=async()=>{
  const site='https://duck.inhagame.example/';
  const text=isSecretStage()?`인하 오리 잡기 · 비룡의 밤 ${score}점 · 최고 콤보 ${maxCombo} 🐲\n${site}`:`인하 오리 잡기 · ${score}점 · ${rankFor(score)} · 최고 콤보 ${maxCombo}\n${site}`;
  try{
    if(navigator.share) await navigator.share({title:'인하 오리 잡기',text});
    else{await navigator.clipboard.writeText(text);showToast('결과 복사 완료!')}
  }catch(e){}
};
void initAccountAuth().then(()=>refreshEventLeaderboard({force:true}));
setInterval(updateEventCountdown,60000);
window.addEventListener('focus',()=>{void refreshEventLeaderboard();updateEventCountdown()});
