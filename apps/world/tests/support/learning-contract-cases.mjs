// One synthetic vector matrix is executed by both Node and real PostgreSQL RPCs.
import {emptyProgress} from '../../src/learning/learning-progress.js';
export function learningContractCases(){
 const rows=[];
 const add=(name,valid,change)=>{const p=emptyProgress();change(p);rows.push({name,valid,progress:p});};
 add('numeric v1',true,()=>{});add('string v1',false,p=>p.version='1');add('v2',false,p=>p.version=2);
 for(const d of ['2024-02-29','2000-02-29','0001-01-01','9999-12-31'])add(`real day ${d}`,true,p=>p.learningHistory[d]={answered:1,correct:1});
 for(const d of ['2025-02-29','1900-02-29','2026-04-31','2026-13-01','0000-01-01','2026-1-01'])add(`bad day ${d}`,false,p=>p.learningHistory[d]={answered:1,correct:1});
 for(const n of [-1,.5,1000001,9007199254740992,'1',null])add(`bad counter ${n}`,false,p=>p.learningHistory['2026-10-19']={answered:n,correct:0});
 for(const n of [0,100,40.5,99.123456])add(`valid score ${n}`,true,p=>p.skillScores[0]=n);
 for(const n of [-1,101,'40',null,40.1234567])add(`bad score ${n}`,false,p=>p.languageSkills.zh=n);
 add('counter max',true,p=>p.learningHistory['2026-10-19']={answered:1000000,correct:1000000});
 add('correct exceeds answered',false,p=>p.learningHistory['2026-10-19']={answered:1,correct:2});
 for(const f of ['answer','coins','induckCoin','campusXp','exp','rank','unknown'])add(`unknown ${f}`,false,p=>p[f]=1);
 add('extra score',false,p=>p.skillScores.push(40));add('missing map',false,p=>delete p.speech);
 add('wrong boolean',false,p=>p.wrong['qv:test.synthetic@1']=1);
 const mastery={level:1,errors:0,streak:1,intervalDays:1,correctDays:1,lastCorrectDay:'2024-02-29',dueDate:null,needsRecheck:false};
 add('full mastery',true,p=>p.masteries['qv:test.synthetic@1']={...mastery});
 for(const [field,value] of [['lastCorrectDay','2023-02-29'],['dueDate','2026-04-31'],['level',3],['intervalDays',0],['intervalDays',15],['needsRecheck',1],['answer','forbidden']])add(`mastery ${field}:${value}`,false,p=>p.masteries['qv:test.synthetic@1']={...mastery,[field]:value});
 add('valid boss/speech',true,p=>{p.bosses[0]={count:1,best:5,passed:true,lastDate:'2024-02-29'};p.speech['qv:test.synthetic@1']={mic:1,typed:1,lastDay:null};});
 add('bad boss date',false,p=>p.bosses[0]={count:1,best:5,passed:true,lastDate:'2026-02-30'});
 add('oversized structural payload',false,p=>{for(let i=0;i<1000;i++)p.masteries[`qv:test.synthetic.${i}@1`]={...mastery};});
 return rows;
}
