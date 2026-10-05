(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BadgeSystem=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const GENERAL=Object.freeze([
    {code:'freshman',icon:'🌱',label:'새내기',score:0,stars:0},
    {code:'campus_patrol',icon:'🛟',label:'캠퍼스 순찰대',score:200,stars:4},
    {code:'duck_hunter',icon:'🎯',label:'오리 헌터',score:350,stars:6},
    {code:'campus_explorer',icon:'🧭',label:'캠퍼스 탐색가',score:500,stars:8},
    {code:'campus_master',icon:'🏅',label:'캠퍼스 마스터',score:750,stars:10},
    {code:'inha_king',icon:'🏆',label:'인하 오리왕',score:1000,stars:12}
  ]);
  const GRADES=Object.freeze([
    {code:'F',icon:'🥚',label:'미부화'},{code:'D0',icon:'🪶',label:'첫 날갯짓'},
    {code:'D+',icon:'🌙',label:'달빛 견습'},{code:'C0',icon:'🌘',label:'월식 관측자'},
    {code:'C+',icon:'🌗',label:'야간 추적자'},{code:'B0',icon:'🐲',label:'비룡 호출자'},
    {code:'B+',icon:'🐉',label:'비룡 기수'},{code:'A0',icon:'👑',label:'승천 지휘자'},
    {code:'A+',icon:'✨',label:'비룡의 눈'}
  ]);
  const EVENT=Object.freeze([
    {code:'inha_duck_s1_gold',icon:'🥇',label:'인하오리 S1 우승'},
    {code:'inha_duck_s1_silver',icon:'🥈',label:'인하오리 S1 준우승'},
    {code:'inha_duck_s1_bronze',icon:'🥉',label:'인하오리 S1 3위'},
    {code:'inha_duck_s1_top10',icon:'🏅',label:'인하오리 S1 TOP 10'}
  ]);
  function general(score=0,stars=0){let badge=GENERAL[0];for(const b of GENERAL)if(Number(score)>=b.score&&Number(stars)>=b.stars)badge=b;return badge}
  function grade(code='F'){return GRADES.find(b=>b.code===code)||GRADES[0]}
  function earnedGeneral(score=0,stars=0){return GENERAL.filter(b=>Number(score)>=b.score&&Number(stars)>=b.stars)}
  function earnedGrades(code='F'){const idx=Math.max(0,GRADES.findIndex(b=>b.code===code));return GRADES.slice(0,idx+1)}
  function generalByCode(code){return GENERAL.find(b=>b.code===code)||GENERAL[0]}
  function eventByCode(code){return EVENT.find(b=>b.code===code)||null}
  return Object.freeze({GENERAL,GRADES,EVENT,general,grade,earnedGeneral,earnedGrades,generalByCode,eventByCode});
});

// Attribute only visits that carry a fresh hub click ID.
if (typeof window !== 'undefined' && location.hostname === 'duck.inhagame.app') {
  const entryScript = document.createElement('script');
  entryScript.src = 'https://inhagame.app/game-entry.js';
  entryScript.dataset.game = 'classic';
  document.head.append(entryScript);
}
