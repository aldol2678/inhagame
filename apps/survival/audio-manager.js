(function(root){
  'use strict';

  const EVENTS=Object.freeze({
    fire:{a:920,b:690,d:.045,type:'triangle',gain:.018,min:65,voices:2,jitter:.045},
    hit:{a:610,b:370,d:.065,type:'triangle',gain:.026,min:65,voices:3,jitter:.04},
    kill:{a:330,b:520,d:.12,type:'sine',gain:.038,min:90,voices:3,jitter:.03},
    eliteHit:{a:250,b:390,d:.11,type:'square',gain:.032,min:100,voices:2,jitter:.02},
    dash:{a:360,b:760,d:.14,type:'sine',gain:.050,min:120,voices:1,jitter:0},
    hurt:{a:165,b:82,d:.18,type:'sawtooth',gain:.046,min:180,voices:1,jitter:0},
    quack:{a:290,b:150,d:.18,type:'square',gain:.060,min:180,voices:1,jitter:0},
    storm:{a:280,b:560,d:.24,type:'triangle',gain:.052,min:220,voices:1,jitter:0},
    ultimate:{a:210,b:920,d:.38,type:'sine',gain:.070,min:450,voices:1,jitter:0},
    xp:{a:740,b:980,d:.055,type:'sine',gain:.018,min:80,voices:2,jitter:.04},
    level:{a:520,b:940,d:.27,type:'sine',gain:.058,min:300,voices:1,jitter:0},
    evolve:{a:360,b:1120,d:.44,type:'triangle',gain:.070,min:650,voices:1,jitter:0},
    heal:{a:430,b:720,d:.19,type:'sine',gain:.040,min:180,voices:1,jitter:.015},
    objective:{a:510,b:860,d:.23,type:'sine',gain:.052,min:220,voices:1,jitter:0},
    clear:{a:440,b:1040,d:.62,type:'triangle',gain:.078,min:1000,voices:1,jitter:0},
    fail:{a:260,b:92,d:.55,type:'sawtooth',gain:.052,min:1000,voices:1,jitter:0},
    wave:{a:180,b:360,d:.20,type:'square',gain:.038,min:300,voices:1,jitter:0},
    unlock:{a:600,b:880,d:.20,type:'sine',gain:.048,min:250,voices:1,jitter:0},
    stairStart:{a:260,b:340,d:.12,type:'triangle',gain:.030,min:120,voices:1,jitter:0},
    stairCancel:{a:300,b:180,d:.12,type:'triangle',gain:.030,min:120,voices:1,jitter:0},
    stairDone:{a:340,b:560,d:.16,type:'sine',gain:.038,min:140,voices:1,jitter:0},
    bossWarning:{a:170,b:250,d:.28,type:'square',gain:.060,min:400,voices:1,jitter:0},
    bossPhase:{a:220,b:660,d:.34,type:'triangle',gain:.064,min:700,voices:1,jitter:0},
    bossDown:{a:280,b:980,d:.48,type:'sine',gain:.075,min:850,voices:1,jitter:0}
  });

  const BGM=Object.freeze({
    base:{freqs:[110,164.81],gain:.020},
    pressure:{freqs:[123.47,185.00],gain:.026},
    climax:{freqs:[146.83,220.00],gain:.032},
    resolve:{freqs:[130.81,196.00],gain:.016}
  });

  const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));
  const nowMs=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();

  function create(options={}){
    const AudioEngine=root.AudioContext||root.webkitAudioContext;
    let ctx=null,master=null,sfxBus=null,bgmBus=null;
    let settings={
      musicEnabled:options.musicEnabled!==false,
      sfxEnabled:options.sfxEnabled!==false,
      musicVolume:clamp01(options.musicVolume??.35),
      sfxVolume:clamp01(options.sfxVolume??.50)
    };
    let bgmState='base',stopped=false;
    const layerGains=new Map(),lastPlayed=new Map(),voiceCounts=new Map(),layers=[];

    function build(){
      if(ctx||!AudioEngine)return !!ctx;
      try{
        ctx=new AudioEngine();
        master=ctx.createGain();sfxBus=ctx.createGain();bgmBus=ctx.createGain();
        sfxBus.connect(master);bgmBus.connect(master);master.connect(ctx.destination);
        master.gain.value=.82;
        sfxBus.gain.value=settings.sfxEnabled?settings.sfxVolume:0;
        bgmBus.gain.value=settings.musicEnabled?settings.musicVolume:0;
        for(const [state,def] of Object.entries(BGM)){
          const layer=ctx.createGain();layer.gain.value=0;layer.connect(bgmBus);layerGains.set(state,layer);
          def.freqs.forEach((freq,i)=>{
            const osc=ctx.createOscillator(),g=ctx.createGain();
            osc.type=i?'sine':'triangle';osc.frequency.value=freq;
            g.gain.value=i?.34:.22;osc.connect(g);g.connect(layer);osc.start();
            layers.push({osc,g});
          });
        }
        applyBgm(true);
        return true;
      }catch{return false;}
    }

    function unlock(){
      if(stopped)return false;
      if(!build())return false;
      try{
        if(ctx.state==='suspended')ctx.resume().catch(()=>{});
        return true;
      }catch{return false;}
    }

    function applyBgm(immediate=false){
      if(!ctx)return;
      const t=ctx.currentTime,enabled=settings.musicEnabled?1:0;
      for(const [state,g] of layerGains){
        const target=(state===bgmState?BGM[state].gain:0)*enabled;
        g.gain.cancelScheduledValues(t);
        if(immediate)g.gain.setValueAtTime(target,t);
        else{
          g.gain.setValueAtTime(g.gain.value,t);
          g.gain.linearRampToValueAtTime(target,t+.34);
        }
      }
      bgmBus.gain.cancelScheduledValues(t);
      bgmBus.gain.setTargetAtTime(settings.musicEnabled?settings.musicVolume:0,t,.05);
    }

    function setSettings(next={}){
      settings={...settings,...next};
      settings.musicVolume=clamp01(settings.musicVolume);
      settings.sfxVolume=clamp01(settings.sfxVolume);
      if(!ctx)return;
      const t=ctx.currentTime;
      sfxBus.gain.setTargetAtTime(settings.sfxEnabled?settings.sfxVolume:0,t,.03);
      bgmBus.gain.setTargetAtTime(settings.musicEnabled?settings.musicVolume:0,t,.03);
      applyBgm(false);
    }

    function setBgmState(state){
      if(!BGM[state]||state===bgmState)return;
      bgmState=state;applyBgm(false);
    }

    function play(kind,opts={}){
      const def=EVENTS[kind];
      if(!def||!settings.sfxEnabled||!settings.sfxVolume||stopped)return false;
      if(!unlock()||ctx.state!=='running')return false;
      const now=nowMs(),last=lastPlayed.get(kind)||-Infinity;
      if(now-last<def.min)return false;
      const voices=voiceCounts.get(kind)||0;
      if(voices>=def.voices)return false;
      lastPlayed.set(kind,now);voiceCounts.set(kind,voices+1);
      try{
        const t=ctx.currentTime;
        const jitter=def.jitter?1+((Math.random()*2-1)*def.jitter):1;
        const pitch=Math.max(.5,Math.min(2,Number(opts.pitch)||1))*jitter;
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        osc.type=def.type;osc.frequency.setValueAtTime(Math.max(30,def.a*pitch),t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(30,def.b*pitch),t+def.d);
        gain.gain.setValueAtTime(.0001,t);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0001,def.gain),t+.008);
        gain.gain.exponentialRampToValueAtTime(.0001,t+def.d);
        osc.connect(gain);gain.connect(sfxBus);osc.start(t);osc.stop(t+def.d+.025);
        osc.onended=()=>{
          voiceCounts.set(kind,Math.max(0,(voiceCounts.get(kind)||1)-1));
          try{osc.disconnect();gain.disconnect();}catch{}
        };
        return true;
      }catch{
        voiceCounts.set(kind,Math.max(0,(voiceCounts.get(kind)||1)-1));
        return false;
      }
    }

    function duck(seconds=.45,factor=.28){
      if(!ctx||!settings.musicEnabled)return;
      const t=ctx.currentTime,normal=settings.musicVolume;
      bgmBus.gain.cancelScheduledValues(t);
      bgmBus.gain.setValueAtTime(bgmBus.gain.value,t);
      bgmBus.gain.linearRampToValueAtTime(normal*clamp01(factor),t+.04);
      bgmBus.gain.linearRampToValueAtTime(normal,t+Math.max(.12,seconds));
    }

    function stop(){
      stopped=true;
      if(!ctx)return;
      const t=ctx.currentTime;
      try{
        sfxBus.gain.setTargetAtTime(0,t,.02);bgmBus.gain.setTargetAtTime(0,t,.05);
        for(const {osc} of layers){try{osc.stop(t+.25);}catch{}}
      }catch{}
    }

    function snapshot(){
      return {available:!!AudioEngine,unlocked:!!ctx&&ctx.state==='running',bgmState,settings:{...settings}};
    }

    return {unlock,play,setSettings,setBgmState,duck,stop,snapshot};
  }

  root.InduckAudioManager=Object.freeze({create,EVENTS,BGM_STATES:Object.freeze(Object.keys(BGM))});
})(typeof window!=='undefined'?window:globalThis);
