// No global listeners; every asynchronous speech callback is invalidated on navigation.
export function createLearningSpeech({win=globalThis.window,onText=()=>{},onStatus=()=>{}}={}) {
  let recognition=null,utterance=null,generation=0,timer=null;
  const locale=lang=>({en:'en-US',zh:'zh-CN',ja:'ja-JP'}[lang]||'en-US');
  const support=()=>({recognition:!!(win?.isSecureContext&&(win.SpeechRecognition||win.webkitSpeechRecognition)),playback:!!(win?.speechSynthesis&&win.SpeechSynthesisUtterance)});
  function stop(){
    generation++;if(timer!==null)win.clearTimeout(timer);timer=null;
    if(recognition){const r=recognition;recognition=null;r.onresult=r.onerror=r.onend=null;try{r.abort();}catch{}}
    if(utterance){utterance.onerror=utterance.onend=null;utterance=null;try{win.speechSynthesis.cancel();}catch{}}
  }
  return {support,stop,
    listen(lang){
      stop();if(!support().recognition){onStatus('음성 인식 미지원 · 직접 입력해 주세요.');return false;}
      const at=generation;
      try{
        const Rec=win.SpeechRecognition||win.webkitSpeechRecognition,r=new Rec();recognition=r;r.lang=locale(lang);r.interimResults=false;r.continuous=false;
        r.onresult=e=>{if(at!==generation)return;const value=e.results?.[0]?.[0]?.transcript||'';stop();onText(value);};
        r.onerror=()=>{if(at!==generation)return;stop();onStatus('음성 인식 실패 또는 권한 거부 · 직접 입력해 주세요.');};
        r.onend=()=>{if(at!==generation)return;stop();onStatus('인식이 끝났어요. 직접 입력하거나 다시 시도해 주세요.');};
        timer=win.setTimeout(()=>{if(at===generation){stop();onStatus('음성 인식 시간 초과 · 직접 입력해 주세요.');}},15000);
        r.start();return true;
      }catch{stop();onStatus('마이크를 시작하지 못했어요. 직접 입력해 주세요.');return false;}
    },
    play(lang,text){
      stop();if(!support().playback){onStatus('음성 재생 미지원 · 화면의 문장을 읽어 주세요.');return false;}
      const at=generation;
      try{
        const voices=win.speechSynthesis.getVoices(),voice=voices.find(v=>v.lang?.toLowerCase().startsWith(lang));
        if(!voice){onStatus('이 언어의 음성이 없어요. 화면의 문장을 읽어 주세요.');return false;}
        const u=new win.SpeechSynthesisUtterance(text);utterance=u;u.lang=locale(lang);u.voice=voice;u.rate=.85;
        u.onerror=()=>{if(at===generation){stop();onStatus('음성 재생 실패 · 화면의 문장을 읽어 주세요.');}};
        u.onend=()=>{if(at===generation)utterance=null;};win.speechSynthesis.speak(u);return true;
      }catch{stop();onStatus('음성 재생 실패 · 화면의 문장을 읽어 주세요.');return false;}
    }
  };
}
