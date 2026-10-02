// 인덕 서바이벌 스테이지 명세. 구현되지 않은 구역은 메뉴 정보만 제공한다.
(function(root){
  'use strict';
  const stages={
    1:{
      id:1,name:'인경호',implemented:true,nextStageId:2,
      clear:{kind:'survive',seconds:180},
      world:{minX:-18,maxX:18,minZ:-22,maxZ:20},
      start:{x:-1.4,z:10.3},
      map:{
        kind:'lake',
        lake:{x:-2.0,z:1.0,rx:8.65,rz:5.35,label:'💧 인경호 · 인덕의 집'},
        pavilion:{x:-10.6,z:-2.9,rotation:.18,label:'정자'},
        exit:{x:7.0,z:-18.5,label:'🏫 본관 방향 · STAGE 2'},
        trees:[[-15,-10],[-13,-14],[-8,-16],[-2,-18],[3,-17],[12,-14],[15,-8],[14,-1],[15,6],[13,12],[8,15],[2,17],[-5,16],[-12,14],[-15,9],[-14,4],[-12,1],[-9,7],[-7,11],[5,10],[8,7],[10,3],[9,-5],[-6,-9]],
        benches:[[-12.1,3.7,.20],[-8.2,9.8,-.25],[4.8,9.2,.15],[8.8,-7.1,Math.PI/2]],
        breakables:[['vending',10.5,10.8],['vending',11.9,-9.2],['board',-11.4,-10.7],['trash',-7.0,13.0],['trash',6.8,12.2],['trash',12.6,-2.6]]
      },
      encounters:{
        maxEnemies:85,initialEnemies:4,
        caps:[{until:30,count:9},{until:70,count:14},{until:110,count:19},{until:150,count:23},{until:Infinity,count:27}],
        waveBonus:9,waveSeconds:8.5,wavePack:{default:6,tank:4},
        waveCycle:['fast','mixed','ranged','tank'],
        waveLabels:{fast:'⏰ 지각 학생 러시',ranged:'🌙 밤샘 학생 포위',tank:'📚 시험 학생 행렬',mixed:'🎒 과제 학생 폭주'},
        spawnInterval:{wave:.35,early:.85,late:.65,lateFrom:120,first:.3},
        // 동일한 난수 한 번으로 순서대로 평가하여 기존 출현 확률을 보존한다.
        randomTypes:[{from:110,below:.14,type:'tank'},{from:70,below:.30,type:'ranged'},{from:30,below:.45,type:'fast'}],
        events:[
          {id:'lateRush',at:30,kind:'wave',enemy:'fast',toast:'⏰ 지각 학생 러시 · Q 꽥파동 해금!'},
          {id:'nightStudents',at:70,kind:'wave',enemy:'ranged',toast:'🌙 밤샘 학생 등장 · E 날갯짓 폭풍 해금!'},
          {id:'exams',at:110,kind:'wave',enemy:'tank',toast:'📚 시험 학생 등장 · 호안에서 버텨라!'},
          {id:'graduate',at:150,kind:'graduate',toast:'🎓 첫 대학원생 등장!'},
          {id:'countdown',at:170,kind:'notice',toast:'💧 인경호 클리어까지 10초!'}
        ]
      },
      phases:[
        {until:30,text:'STAGE 1 · 인덕의 집'},
        {until:70,text:'수변 산책로 · 지각 러시'},
        {until:110,text:'정자 구역 · 밤샘 학생'},
        {until:150,text:'돌 호안 · 시험 학생'},
        {until:170,text:'🎓 대학원생 출현'},
        {until:Infinity,kind:'countdown'}
      ]
    },
    2:{
      id:2,name:'본관',implemented:true,nextStageId:3,
      clear:{kind:'attendanceExit',seconds:180,deadline:210},
      world:{minX:-24,maxX:24,minZ:-26,maxZ:26},
      start:{x:0,z:21},
      map:{
        kind:'hall',
        exit:{x:0,z:-23,label:'🏫 본관 출구'},
        stamps:[
          {id:'west',x:-18,z:-6,at:35,hold:1.0,label:'서쪽 안내 데스크',color:0x58d5df},
          {id:'east',x:18,z:-6,at:95,hold:1.0,label:'동쪽 강의실 입구',color:0xf3bd65}
        ],
        columns:[[-8,-12],[-8,0],[-8,12],[8,-12],[8,0],[8,12],[-16,6],[16,6]],
        benches:[[-15,14,0],[15,14,0],[-13,-15,0],[13,-15,0]],
        breakables:[['board',-18,10],['vending',18,10],['board',-12,-19],['vending',12,-19],['trash',-21,18],['trash',21,18]]
      },
      encounters:{
        maxEnemies:70,initialEnemies:6,
        caps:[{until:30,count:13},{until:70,count:18},{until:110,count:22},{until:Infinity,count:25}],
        waveBonus:7,waveSeconds:8,wavePack:{default:5,tank:3},
        waveCycle:['fast','mixed','ranged','tank'],
        waveLabels:{fast:'⏰ 본관 지각 러시',ranged:'🌙 복도 밤샘 학생',tank:'📚 시험 학생 행렬',mixed:'🎒 과제 학생 물결'},
        spawnInterval:{wave:.48,early:.84,late:.68,lateFrom:120,first:.3},
        randomTypes:[{from:110,below:.16,type:'tank'},{from:70,below:.38,type:'ranged'},{from:30,below:.53,type:'fast'}],
        events:[
          {id:'lateRush',at:30,kind:'wave',enemy:'fast',toast:'⏰ 지각 학생 등장 · 복도를 벗어나자!'},
          {id:'nightStudents',at:70,kind:'wave',enemy:'ranged',toast:'🌙 밤샘 학생 · 투사체 주의!'},
          {id:'graduate',at:105,kind:'graduate',toast:'🎓 본관 대학원생 등장!'},
          {id:'exams',at:110,kind:'wave',enemy:'tank',toast:'📚 시험 학생 등장!'},
          {id:'assistant',at:150,kind:'boss',toast:'📋 조교 등장 · 궁극기 R로 대응!'},
          {id:'finalRush',at:165,kind:'wave',enemy:'fast',toast:'⏰ 출구 앞 지각 러시!'},
          {id:'exit',at:180,kind:'notice',toast:'🚪 본관 출구 개방 · 출석 2곳 확인!'}
        ]
      },
      phases:[
        {until:35,text:'STAGE 2 · 본관 입구'},
        {until:95,text:'서쪽 안내 데스크 · 출석'},
        {until:140,text:'동쪽 강의실 · 출석'},
        {until:180,text:'본관 복도 · 조교 주의'},
        {until:Infinity,text:'🚪 본관 출구 · 03:30까지 탈출'}
      ]
    },
    3:{
      id:3,name:'정석학술정보관',implemented:true,nextStageId:4,
      clear:{kind:'libraryReturn',seconds:180,deadline:225},
      world:{minX:-28,maxX:28,minZ:-30,maxZ:30},
      start:{x:0,z:24},
      map:{
        kind:'library',
        exit:{x:0,z:24,label:'🚪 1층 로비 · 출구'},
        stairs:[{x:-21,z:19,label:'서쪽 계단'},{x:21,z:19,label:'동쪽 계단'}],
        floors:[
          {id:1,name:'1층 로비',color:0x536e7c},
          {id:2,name:'2층 자연과학정보실',color:0x478a94},
          {id:3,name:'3층 인문과학정보실',color:0x85719d},
          {id:4,name:'4층 사회과학정보실',color:0x9a8465}
        ],
        documents:[
          {floor:2,x:17,z:-21,at:0,label:'자연과학 자료',color:0x59d6e8},
          {floor:3,x:-17,z:-21,at:45,label:'인문과학 자료',color:0xc5a4ff},
          {floor:4,x:17,z:-21,at:90,label:'사회과학 자료',color:0xffd083}
        ],
        trees:[],benches:[],breakables:[]
      },
      encounters:{
        maxEnemies:65,initialEnemies:5,
        caps:[{until:45,count:11},{until:90,count:15},{until:140,count:20},{until:180,count:23},{until:Infinity,count:24}],
        waveBonus:6,waveSeconds:7,wavePack:{default:4,tank:3},
        waveCycle:['fast','ranged','mixed','tank'],
        waveLabels:{fast:'⏰ 지각 학생 러시',ranged:'🌙 밤샘 학생 포위',tank:'📚 시험 학생 행렬',mixed:'🎒 과제 학생 물결'},
        spawnInterval:{wave:.55,early:.90,late:.75,lateFrom:120,first:.3},
        randomTypes:[{from:100,below:.12,type:'tank'},{from:45,below:.44,type:'ranged'},{from:25,below:.62,type:'fast'}],
        events:[
          {id:'rush',at:25,kind:'wave',enemy:'fast',toast:'⏰ 정석 지각 러시!'},
          {id:'night',at:45,kind:'wave',enemy:'ranged',toast:'🌙 서가 뒤 밤샘 학생 주의!'},
          {id:'exam',at:100,kind:'wave',enemy:'tank',toast:'📚 시험 학생 등장!'},
          {id:'graduate',at:135,kind:'graduate',toast:'🎓 대학원생 등장!'},
          {id:'nightRush',at:155,kind:'wave',enemy:'ranged',toast:'🌙 밤샘 학생 포위!'},
          {id:'return',at:180,kind:'notice',toast:'📚 자료를 모아 1층 출구로 돌아가자!'}
        ]
      },
      phases:[
        {until:45,text:'정석 · 자연과학 자료실'},
        {until:100,text:'정석 · 인문과학 자료실'},
        {until:140,text:'정석 · 사회과학 자료실'},
        {until:180,text:'정석 · 서가를 돌아 자료 찾기'},
        {until:Infinity,text:'정석 · 1층 로비로 복귀'}
      ]
    },
    4:{
      id:4,name:'5호관',implemented:true,nextStageId:5,
      clear:{kind:'campusReturn',seconds:220,deadline:285},
      world:{minX:-29,maxX:29,minZ:-31,maxZ:31},
      start:{x:0,z:26},
      // 5남/5서/5북/5동은 실제 건물 명칭. 방과 계단의 연결은 게임용 각색이다.
      map:{
        kind:'campus',exit:{floor:1,x:0,z:-26,label:'🚪 5북 1층 · 출구'},
        floors:[
          {id:0,name:'5남 B1 · 인쇄실',color:0x405968},
          {id:1,name:'5호관 1층 · 네 구역',color:0x4d6268},
          {id:2,name:'5동 2층 · 강의실',color:0x58647b}
        ],
        // [중심 x, 중심 z, 반폭, 반깊이]. 적 길찾기와 플레이 충돌이 같은 벽을 사용한다.
        walls:{
          0:[[-11,8,.6,8],[-24,-2,2,1],[-14,-2,2,1],[-24,-22,2,1],[-12,-21,1.3,2]],
          1:[[-10,-7.5,.30,4.5],[-10,7.5,.30,4.5],[10,0,.30,12],[0,12,10,.30],
             [-6.5,-12,3.5,.30],[6.5,-12,3.5,.30],[-23,0,1.15,1.2],[-17,-4,1.15,1.2],
             [22,0,1.15,1.2],[16,-5,1.15,1.2],[-7,20,1.15,1.2],[7,-20,1.15,1.2]],
          2:[[10,2,.6,6],[24,-1,1,2],[13,-4,1.1,2],[24,-20,1.1,1.7],[-9,-7,4,.7]]
        },
        portals:[
          {floor:1,x:-18,z:18,to:0,tx:-18,tz:18,label:'5남 지하 인쇄실',key:'down'},
          {floor:0,x:-18,z:18,to:1,tx:-18,tz:18,label:'5남 1층 입구',key:'up'},
          {floor:0,x:-18,z:-18,to:1,tx:-18,tz:-18,label:'5서 1층 복귀',key:'up'},
          {floor:1,x:-18,z:-18,to:0,tx:-18,tz:-18,label:'5남 지하 북쪽 계단',key:'down'},
          {floor:1,x:18,z:10,to:2,tx:18,tz:10,label:'5동 2층 강의실',key:'up'},
          {floor:2,x:18,z:10,to:1,tx:18,tz:10,label:'5동 1층 복귀',key:'down'},
          {floor:2,x:18,z:-18,to:1,tx:18,tz:-18,label:'5북 1층 복귀',key:'down'},
          {floor:1,x:18,z:-18,to:2,tx:18,tz:-18,label:'5동 2층 북쪽 계단',key:'up'}
        ],
        print:{floor:0,x:-17,z:-11,at:35,hold:1,label:'인쇄물 준비',color:0x6bdddc},
        lecture:{floor:2,x:18,z:-10,at:90,hold:1,label:'강의 출석',color:0xf3c780},
        defense:{floor:1,x:0,z:0,at:175,hold:16,label:'중앙 방어',color:0xa7e9b7},
        trees:[],benches:[],breakables:[]
      },
      encounters:{
        maxEnemies:60,initialEnemies:5,
        caps:[{until:45,count:10},{until:100,count:14},{until:175,count:18},{until:230,count:21},{until:Infinity,count:23}],
        waveBonus:5,waveSeconds:7,wavePack:{default:4,tank:2},
        waveCycle:['fast','ranged','mixed','tank'],
        waveLabels:{fast:'⏰ 복도 지각 러시',ranged:'🌙 강의실 밤샘 학생',tank:'📚 시험 학생 행렬',mixed:'🎒 과제 학생 물결'},
        spawnInterval:{wave:.58,early:.94,late:.79,lateFrom:130,first:.3},
        randomTypes:[{from:105,below:.14,type:'tank'},{from:55,below:.40,type:'ranged'},{from:25,below:.57,type:'fast'}],
        events:[
          {id:'print',at:35,kind:'notice',toast:'🖨️ 5남 지하 · 인쇄물 준비'},
          {id:'night',at:70,kind:'wave',enemy:'ranged',toast:'🌙 밤샘 학생 · 벽 뒤에서 쏜다!'},
          {id:'lecture',at:90,kind:'notice',toast:'📋 5동 2층 · 강의 출석'},
          {id:'graduate',at:130,kind:'graduate',toast:'🎓 대학원생 등장!'},
          {id:'defense',at:175,kind:'defenseCombo',toast:'🛡️ 1층 중앙 방어 · 복합 웨이브 시작'},
          {id:'defenseReinforce',at:181,kind:'defenseCombo2',toast:'🛡️ 중앙 방어 · 2차 압박'},
          {id:'exit',at:220,kind:'notice',toast:'🚪 5북 1층 출구 · 04:45 마감'}
        ]
      },
      phases:[
        {until:90,text:'5남 지하 · 인쇄물'},
        {until:175,text:'5동 2층 · 강의 출석'},
        {until:220,text:'5호관 중앙 · 16초 방어'},
        {until:Infinity,text:'5북 1층 · 출구 복귀'}
      ]
    },
    5:{
      id:5,name:'60주년기념관',implemented:true,nextStageId:6,
      clear:{kind:'reviewExit',seconds:200,deadline:250},
      world:{minX:-30,maxX:30,minZ:-28,maxZ:28},
      start:{x:0,z:22},
      map:{
        kind:'hall',
        exit:{x:0,z:27,label:'🚪 60주년기념관 · 남쪽 출구'},
        stamps:[
          {id:'expoWest',x:-18,z:0,at:0,hold:1.5,label:'왼쪽 전시 표식',color:0x6bdbe8},
          {id:'expoEast',x:18,z:0,at:0,hold:1.5,label:'오른쪽 전시 표식',color:0xf4c56c}
        ],
        columns:[[-25,-17],[-25,17],[25,-17],[25,17],[-10,-22],[10,-22]],
        benches:[[-22,10,Math.PI/2],[22,10,Math.PI/2],[-22,-10,Math.PI/2],[22,-10,Math.PI/2]],
        breakables:[],
        bossSpawn:{x:0,z:-20,label:'심사 조교'},
        roomLabels:[
          {x:-24,z:-22,label:'101호 방향'},
          {x:0,z:-24,label:'112호 방향'},
          {x:24,z:-22,label:'106호 방향'},
          {x:0,z:6,label:'B1 월천홀 ↓'}
        ]
      },
      encounters:{
        maxEnemies:55,initialEnemies:6,
        caps:[{until:45,count:12},{until:105,count:16},{until:125,count:18},{until:200,count:18},{until:Infinity,count:16}],
        waveBonus:4,waveSeconds:6.5,wavePack:{default:4,tank:2},
        waveCycle:['fast','ranged','mixed','tank'],
        waveLabels:{fast:'⏰ 로비 지각 러시',ranged:'🌙 전시 밤샘 학생',tank:'📚 심사 대기 학생',mixed:'🎒 로비 학생 물결'},
        spawnInterval:{wave:.58,early:.90,late:.76,lateFrom:120,first:.3},
        randomTypes:[{from:90,below:.13,type:'tank'},{from:45,below:.39,type:'ranged'},{from:20,below:.58,type:'fast'}],
        events:[
          {id:'lateRush',at:35,kind:'wave',enemy:'fast',toast:'⏰ 로비 지각 러시!'},
          {id:'night',at:50,kind:'wave',enemy:'ranged',toast:'🌙 전시대 사이 밤샘 학생 주의!'},
          {id:'exam',at:90,kind:'wave',enemy:'tank',toast:'📚 심사 대기 학생 합류!'},
          {id:'graduate',at:105,kind:'graduate',toast:'🎓 대학원생 등장!'},
          {id:'reviewWarning',at:115,kind:'notice',toast:'🚨 10초 후 심사 조교 등장'},
          {id:'reviewBoss',at:125,kind:'reviewBoss',toast:'📋 심사 조교 등장 · 패턴을 읽어라!'},
          {id:'exit',at:200,kind:'notice',toast:'🚪 조건을 갖추고 남쪽 출구로 이동!'}
        ]
      },
      phases:[
        {until:45,text:'60주년기념관 · 전시 표식 확인'},
        {until:115,text:'60주년기념관 · 로비 교전'},
        {until:125,text:'🚨 심사전 준비'},
        {until:200,text:'📋 심사 조교 결전'},
        {until:Infinity,text:'🚪 남쪽 출구 · 04:10까지 탈출'}
      ]
    },
    6:{
      id:6,name:'후문',implemented:true,nextStageId:null,
      clear:{kind:'gateFinal',seconds:120,deadline:270},
      world:{minX:-50,maxX:50,minZ:-20,maxZ:24},
      start:{x:0,z:-15},
      map:{
        kind:'gate',
        exit:{x:0,z:21,label:'🎓 캠퍼스 밖 · 횡단보도 너머'},
        gate:{x:0,z:4,halfWidth:9},
        crosswalk:{minX:-9,maxX:9,minZ:7,maxZ:19},
        median:{z:13,gapHalfWidth:10},
        professorSpawn:{x:0,z:9,label:'교수'},
        requirements:[
          {id:'credits',x:-36,z:-7,hold:1.2,label:'졸업학점 확인',color:0x6bdbe8},
          {id:'cert',x:36,z:-7,hold:1.2,label:'졸업인증 확인',color:0xf4c56c},
          {id:'signature',x:0,z:-4,hold:1.5,label:'최종서명',color:0xa9e8a7}
        ],
        trees:[[-46,-11],[-40,-11],[-30,-11],[30,-11],[40,-11],[46,-11]],
        benches:[[-43,-4,0],[43,-4,0]],
        breakables:[]
      },
      encounters:{
        maxEnemies:60,initialEnemies:6,
        caps:[{until:40,count:12},{until:75,count:15},{until:Infinity,count:17}],
        waveBonus:5,waveSeconds:6.5,wavePack:{default:4,tank:2},
        waveCycle:['fast','ranged','mixed','tank'],
        waveLabels:{fast:'⏰ 후문 지각 러시',ranged:'🌙 도로 밤샘 학생',tank:'📚 최종시험 학생',mixed:'🎒 후문 학생 물결'},
        spawnInterval:{wave:.55,early:.88,late:.72,lateFrom:75,first:.3},
        randomTypes:[{from:70,below:.14,type:'tank'},{from:50,below:.39,type:'ranged'},{from:30,below:.58,type:'fast'}],
        events:[
          {id:'lateRush',at:30,kind:'wave',enemy:'fast',toast:'⏰ 후문 지각 러시!'},
          {id:'night',at:50,kind:'wave',enemy:'ranged',toast:'🌙 긴 도로 밤샘 학생 합류!'},
          {id:'exam',at:70,kind:'wave',enemy:'tank',toast:'📚 최종시험 학생 압박!'},
          {id:'graduate',at:80,kind:'graduate',toast:'🎓 대학원생 등장 · 졸업요건을 마무리하자!'}
        ]
      },
      phases:[
        {until:90,text:'후문 · 졸업요건 확인'},
        {until:120,text:'✨ 후문 · 최종 진화 준비'},
        {until:270,text:'👨‍🏫 교수 최종심사'},
        {until:Infinity,text:'🎓 횡단보도를 건너 캠퍼스 밖으로'}
      ]
    }
  };
  root.InduckSurvivalStages=Object.freeze({
    catalog:stages,
    get(id){return stages[Number(id)]||null},
    isImplemented(id){return !!stages[Number(id)]?.implemented},
    getCap(stage,seconds,waveActive){
      const tier=stage.encounters.caps.find(item=>seconds<item.until);
      return Math.min(stage.encounters.maxEnemies,(tier?.count||0)+(waveActive?stage.encounters.waveBonus:0));
    },
    getRandomEnemy(stage,seconds,roll){
      return stage.encounters.randomTypes.find(item=>seconds>=item.from&&roll<item.below)?.type||'normal';
    },
    getPhase(stage,seconds){
      const phase=stage.phases.find(item=>seconds<item.until);
      if(phase?.kind==='countdown')return `⏳ ${stage.name} 클리어까지 ${Math.max(0,Math.ceil(stage.clear.seconds-seconds))}초`;
      return phase?.text||'';
    },
    isClear(stage,seconds){return stage.clear?.kind==='survive'&&seconds>=stage.clear.seconds}
  });
})(window);
