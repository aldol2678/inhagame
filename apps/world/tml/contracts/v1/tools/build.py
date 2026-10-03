"""Build specification artifacts and authored test expectations; no production imports."""
import json,copy,hashlib,base64,sys,re,datetime,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tml-freeze-oracle-deps'))
import rfc8785
ROOT=Path(__file__).resolve().parents[1]
OLD=json.loads((ROOT/'provenance/previous-corpus.json').read_text())
SHA='68c76093236e70426a645d4aa5a18b00a4ee1deb'
def write(name,x):
 (ROOT/name).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def obj(p,optional=()):return {'type':'object','properties':p,'required':[k for k in p if k not in optional],'additionalProperties':False}
def arr(x):return {'type':'array','items':x}
def en(*x):return {'enum':list(x)}
def const(x):return {'const':x}
def ref(n):return {'$ref':'urn:tml:v1:core#/$defs/'+n}
S={'type':'string'};B={'type':'boolean'};N={'type':'null'}
D={}
D['Id']={'type':'string','pattern':'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'}
D['Digest']={'type':'string','pattern':'^sha256:[0-9a-f]{64}$'}
D['I64']={'type':'string','pattern':'^(0|-?[1-9][0-9]*)$','maxLength':20,'description':'MUST additionally check signed 64-bit range exactly.'}
D['U64']={'type':'string','pattern':'^(0|[1-9][0-9]*)$','maxLength':20,'description':'MUST additionally check unsigned 64-bit range exactly.'}
D['Time']={'type':'string','pattern':'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{6}Z$','description':'Gregorian year 0001..9999, seconds 00..59, exact microseconds; semantic calendar validation required.'}
D['Principal']=obj({'kind':en('account','service'),'id':ref('Id')})
D['Namespace']=obj({'tenantId':ref('Id'),'worldId':ref('Id'),'principal':ref('Principal')})
D['Scope']=obj({**D['Namespace']['properties'],'executionId':ref('Id'),'sessionId':ref('Id')},['sessionId'])
D['EntityRef']=obj({'type':ref('Id'),'id':ref('Id')})
D['Ref']=obj({'id':ref('Id'),'digest':ref('Digest')})
D['ProfileRef']=obj({'id':ref('Id'),'revision':ref('Digest')})
D['SnapshotRef']=obj({'source':ref('Id'),'stream':ref('Id'),'epoch':ref('Id'),'revision':ref('U64')})
values=[]
for tag,val in [('string',S),('boolean',B),('integer',ref('I64')),('number',{'type':'number'}),('time',ref('Time')),('ref',ref('Id')),('list',arr(ref('Value'))),('object',{'type':'object','additionalProperties':ref('Value')})]:values.append(obj({'type':const(tag),'value':val}))
values.append(obj({'type':const('null')}));D['Value']={'oneOf':values}
D['Expr']={'oneOf':[obj({'op':en('eq','ne','gt','gte','lt','lte'),'subject':ref('EntityRef'),'predicate':ref('Id'),'value':ref('Value')}),obj({'op':const('exists'),'subject':ref('EntityRef'),'predicate':ref('Id')}),obj({'op':en('and','or'),'args':{**arr(ref('Expr')),'minItems':1}}),obj({'op':const('not'),'arg':ref('Expr')}),obj({'op':const('true')})]}
D['Reward']=obj({'id':ref('Id'),'version':ref('U64')})
D['Request']=obj({'version':const('1.0'),'profile':ref('ProfileRef'),'scope':ref('Scope'),'capability':ref('Id'),'args':{'type':'object','additionalProperties':ref('Value')},'target':ref('EntityRef'),'preconditions':arr(ref('Ref')),'expectedReward':ref('Reward'),'idempotencyKey':ref('Id')},['expectedReward'])
D['FingerprintPayload']=obj({**{k:v for k,v in D['Request']['properties'].items() if k!='idempotencyKey'},'scope':obj({**D['Namespace']['properties'],'sessionId':ref('Id')},['sessionId'])},['expectedReward'])
def record(name,p,optional=()):
 return obj({'schema':const('tml.'+name),'version':const('1.0'),'id':ref('Id'),'profile':ref('ProfileRef'),**p},optional)
D['Execution']=record('execution',{'request':ref('Request'),'requestFingerprint':ref('Digest'),'status':en('ACCEPTED','EXECUTING','SUCCEEDED','FAILED'),'startedAt':ref('Time'),'completedAt':ref('Time'),'receipts':arr(ref('Ref')),'failureCode':ref('Id')},['startedAt','completedAt','failureCode'])
D['Handle']=obj({'id':ref('Id'),'generation':ref('U64')})
D['Locator']={'oneOf':[obj({'by':const('EXECUTION'),'namespace':ref('Namespace'),'executionId':ref('Id')}),obj({'by':const('IDEMPOTENCY'),'namespace':ref('Namespace'),'capability':ref('Id'),'idempotencyKey':ref('Id')})]}
D['Knowledge']={'oneOf':[obj({'kind':const('NOT_STARTED')}),obj({'kind':const('KNOWN'),'execution':ref('Execution'),'receiptRead':en('NOT_REQUESTED','AVAILABLE','UNAVAILABLE')}),obj({'kind':const('UNKNOWN'),'lastObserved':ref('Execution'),'reason':ref('Id')},['lastObserved']),obj({'kind':const('RECOVERABLE'),'lastObserved':ref('Execution'),'locator':ref('Locator'),'reason':ref('Id')},['lastObserved'])]}
entry={'entryId':ref('Id'),'ledger':en('wallet','exp','inventory'),'target':ref('EntityRef'),'effect':en('ADD','REMOVE'),'requested':ref('I64'),'applied':ref('I64'),'after':ref('SnapshotRef')}
D['LedgerEntry']={'oneOf':[obj({**entry,'outcome':const('APPLIED'),'transactionId':ref('Id')}),obj({**entry,'outcome':const('SKIPPED'),'applied':const('0'),'reason':ref('Id')})]}
D['ExpectedEffect']=obj({**{k:v for k,v in entry.items() if k!='after'},'allowedOutcome':en('APPLIED','SKIPPED')})
D['Receipt']=record('receipt',{'scope':ref('Scope'),'source':ref('Id'),'transactionId':ref('Id'),'requestFingerprint':ref('Digest'),'capability':ref('Id'),'target':ref('EntityRef'),'reward':ref('Reward'),'committedAt':ref('Time'),'entries':arr(ref('LedgerEntry')),'postState':arr(ref('Ref'))},['reward'])
D['Fact']=record('fact',{'scope':ref('Scope'),'subject':ref('EntityRef'),'predicate':ref('Id'),'value':ref('Value'),'source':ref('Id'),'snapshot':ref('SnapshotRef'),'observationId':ref('Id')})
D['Query']=obj({'subject':ref('EntityRef'),'predicates':arr(ref('Id'))})
D['Observation']=record('observation',{'scope':ref('Scope'),'source':ref('Id'),'snapshot':ref('SnapshotRef'),'observedAt':ref('Time'),'query':ref('Query'),'facts':arr(ref('Ref'))})
D['ClaimBody']={'oneOf':[obj({'kind':const('STATE'),'expr':ref('Expr'),'snapshotRequirement':obj({'mode':en('EXACT','AT_LEAST'),'snapshot':ref('SnapshotRef')})}),obj({'kind':const('SETTLEMENT'),'expectedExecution':obj({'requestFingerprint':ref('Digest'),'capability':ref('Id'),'target':ref('EntityRef')}),'expectedReward':ref('Reward'),'expectedEffects':arr(ref('ExpectedEffect')),'effectSet':const('EXACT')}),obj({'kind':const('PROJECTION_APPLIED'),'receipt':ref('Ref'),'entryIds':{**arr(ref('Id')),'minItems':1}})]}
D['Claim']=record('claim',{'scope':ref('Scope'),'body':ref('ClaimBody')})
D['Evidence']=record('evidence',{'scope':ref('Scope'),'claim':ref('Ref'),'frame':obj({'phase':en('PRE','POST','RECOVERY'),'snapshots':arr(ref('SnapshotRef'))}),'observations':arr(ref('Ref')),'facts':arr(ref('Ref')),'receipts':arr(ref('Ref'))})
D['VerificationResult']=record('verification',{'scope':ref('Scope'),'claim':ref('Ref'),'evidence':ref('Ref'),'status':en('SATISFIED','UNSATISFIED','UNKNOWN','CONFLICT','INVALID','ERROR'),'reason':ref('Id'),'checkedAt':ref('Time')})
D['Template']=obj({'schema':const('tml.claim-template'),'version':const('1.0'),'id':ref('Id'),'expr':ref('Expr')})
D['Record']={'oneOf':[ref(n) for n in ['Fact','Observation','Claim','Evidence','Receipt','VerificationResult']]}
for spec in D.values():
 if 'pattern' in spec:spec['pattern']=spec['pattern'].replace('$','(?![\\s\\S])')
D['Execution']['allOf']=[{'if':{'properties':{'status':{'enum':['SUCCEEDED','FAILED']}}},'then':{'required':['completedAt']},'else':{'properties':{'receipts':{'maxItems':0}},'not':{'anyOf':[{'required':['completedAt']},{'required':['failureCode']}]}}},{'if':{'properties':{'status':{'const':'EXECUTING'}}},'then':{'required':['startedAt']}},{'if':{'properties':{'status':{'const':'SUCCEEDED'}}},'then':{'required':['startedAt'],'properties':{'receipts':{'minItems':1,'maxItems':1}},'not':{'required':['failureCode']}}},{'if':{'properties':{'status':{'const':'FAILED'}}},'then':{'required':['failureCode'],'properties':{'receipts':{'maxItems':0}}}}]
core={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:tml:v1:core','$defs':D,'oneOf':[ref('Record'),ref('Execution'),ref('Template')]};write('schemas/core.schema.json',core)
bundle=obj({'version':const('1.0'),'scope':ref('Scope'),'profile':ref('ProfileRef'),'root':obj({'claim':ref('Ref'),'evidence':ref('Ref')}),'records':arr(ref('Record'))})
bundle.update({'$schema':core['$schema'],'$id':'urn:tml:v1:bundle'});write('schemas/evaluation-bundle.schema.json',bundle)
profiledef=obj({'sources':arr(obj({'id':ref('Id'),'roles':arr(en('SNAPSHOT_READER','TRANSACTION_AUTHORITY','EVALUATOR','ARTIFACT_AUTHOR'))})), 'predicates':arr(obj({'id':ref('Id'),'valueType':en('string','boolean','integer','number','null','time','ref','list','object'),'sources':arr(ref('Id'))})), 'capabilities':arr(obj({'id':ref('Id'),'source':ref('Id'),'targetType':ref('Id'),'rewardRequired':B,'allowedOutcomes':arr(en('APPLIED','SKIPPED'))})), 'rewards':arr(obj({'capability':ref('Id'),'reward':ref('Reward'),'effects':arr(ref('ExpectedEffect'))})), 'preconditions':arr(ref('Template')), 'streams':arr(obj({'source':ref('Id'),'stream':ref('Id'),'target':ref('EntityRef'),'includesPriorEffects':B}))})
profile=obj({'schema':const('tml.profile'),'version':const('1.0'),'id':ref('Id'),'revision':ref('Digest'),'definition':profiledef});profile.update({'$id':'urn:tml:v1:profile','$schema':core['$schema']});write('schemas/profile.schema.json',profile)
# Normative reason registry. Rank is stable ASCII lexicographic order within a stage.
reasons={}
def reasons_add(layer,result,codes):
 for code in codes.split():reasons[code]={'code':code,'layer':layer,'result':result}
reasons_add(1,'INVALID','INVALID_JSON INVALID_UNICODE DUPLICATE_KEY SCHEMA_VIOLATION INTEGER_RANGE INTEGER_ENCODING NUMBER_RANGE NONFINITE_NUMBER NUMBER_UNDERFLOW TIME_ENCODING TIME_PRECISION_UNSUPPORTED LIMIT_EXCEEDED SCOPE_MISMATCH HASH_MISMATCH PROFILE_MISMATCH SNAPSHOT_MISMATCH DUPLICATE_ENTRY DUPLICATE_SET_MEMBER DUPLICATE_RECORD REFERENCE_MISMATCH OPERAND_TYPE')
reasons_add(2,'INVALID','REQUEST_MISMATCH EXECUTION_BINDING_MISMATCH IDEMPOTENCY_CONFLICT RECEIPT_INTEGRITY AUTHORIZATION_DENIED')
reasons_add(2,'UNKNOWN','UNTRUSTED_PROVENANCE')
reasons_add(3,'CONFLICT','RECEIPT_CONFLICT AUTHORITATIVE_FACT_CONFLICT')
reasons_add(4,'UNKNOWN','SNAPSHOT_INCOMPARABLE STALE_SNAPSHOT RECEIPT_MISSING AUTHORITATIVE_FACT_MISSING OBSERVATION_MISSING EXECUTION_BINDING_MISSING READ_UNAVAILABLE')
reasons_add(5,'UNSATISFIED','REWARD_VERSION_MISMATCH REWARD_ID_MISMATCH EFFECT_SET_MISMATCH EFFECT_MISMATCH')
reasons_add(5,'SATISFIED','SETTLEMENT_MATCH PROJECTION_APPLIED AUTHORITATIVE_FACT_PRESENT EXPLICIT_TRUE')
reasons_add(5,'EITHER','AUTHORITATIVE_COMPARISON')
reasons_add('primitive','VALID','VALID_VALUE NORMALIZED FINGERPRINT_COMPUTED TIME_CONVERTED ARITHMETIC_OK SCHEMA_VALID IDENTITY_DISTINCT IDENTITY_EQUAL')
reasons_add('fault','ERROR','INTERNAL_ERROR INTEGER_OVERFLOW')
reasons_add('execution','KNOWN','EXECUTION_OBSERVED IDEMPOTENT_REPLAY RECEIPT_UNAVAILABLE')
reasons_add('execution','RECOVERABLE','RESPONSE_LOST WORKER_CRASH')
reasons_add('execution','UNKNOWN','EXECUTION_UNRESOLVED RETENTION_EXPIRED')
reasons_add('execution','ACCEPTED','EXECUTION_ACCEPTED')
reasons_add('execution','VALID','RECOVERY_PRESERVED')
reasons_add('consumption','VALID','VERIFICATION_ADMITTED')
reasons_add('bridge','INVALID','HANDLE_EXPIRED HANDLE_GENERATION_MISMATCH')
for op in ['AND','OR']:
 for status in ['SATISFIED','UNSATISFIED','UNKNOWN','CONFLICT']:reasons_add(6,status,op+'_'+status)
for status in ['SATISFIED','UNSATISFIED']:reasons_add(6,status,'NOT_'+status)
# Legacy P4 codes remain listed for legacy use, not silently mapped into v1.
reasons_add('legacy-p4','UNKNOWN','AUTHORITY_RULE_MISSING INVALID_EXPRESSION UNSUPPORTED_EXPRESSION')
reasons_add(4,'UNKNOWN','CLAIM_MISSING EVIDENCE_MISSING')
for i,k in enumerate(sorted(reasons)):
 reasons[k]['tieRank']=i
 reasons[k]['substage']=0
 reasons[k]['description']=k.replace('_',' ').lower()+'. See CONTRACT sections 3-11 for the normative condition.'
order={1:[['LIMIT_EXCEEDED'],['INVALID_JSON','INVALID_UNICODE','DUPLICATE_KEY','NONFINITE_NUMBER','NUMBER_UNDERFLOW'],['SCHEMA_VIOLATION','INTEGER_RANGE','INTEGER_ENCODING','NUMBER_RANGE','TIME_ENCODING','TIME_PRECISION_UNSUPPORTED'],['DUPLICATE_ENTRY','DUPLICATE_SET_MEMBER','DUPLICATE_RECORD'],['SCOPE_MISMATCH'],['PROFILE_MISMATCH'],['HASH_MISMATCH'],['REFERENCE_MISMATCH'],['SNAPSHOT_MISMATCH'],['OPERAND_TYPE']],2:[['AUTHORIZATION_DENIED'],['RECEIPT_INTEGRITY'],['REQUEST_MISMATCH'],['EXECUTION_BINDING_MISMATCH','IDEMPOTENCY_CONFLICT'],['UNTRUSTED_PROVENANCE']],4:[['CLAIM_MISSING','EVIDENCE_MISSING'],['RECEIPT_MISSING','OBSERVATION_MISSING','EXECUTION_BINDING_MISSING','AUTHORITATIVE_FACT_MISSING','READ_UNAVAILABLE'],['SNAPSHOT_INCOMPARABLE'],['STALE_SNAPSHOT']],5:[['REWARD_ID_MISMATCH'],['REWARD_VERSION_MISMATCH'],['EFFECT_SET_MISMATCH'],['EFFECT_MISMATCH'],['SETTLEMENT_MATCH','PROJECTION_APPLIED','AUTHORITATIVE_FACT_PRESENT','EXPLICIT_TRUE','AUTHORITATIVE_COMPARISON']]}
for stage,groups in order.items():
 for sub,group in enumerate(groups):
  for k in group:reasons[k]['substage']=sub

write('reason-registry.json',{'version':'1.0','selection':'Lowest stage then declared substage; INVALID before UNKNOWN markers; then ASCII code and canonical record-id/JSON-Pointer. Dependent substages stop when prerequisite shape/decoding fails. Internal failure prevents a trustworthy stage result and yields ERROR. Atomic conflict and unknown are composed per expression, not global vetoes.','reasons':list(reasons.values())})
# Registered verification reasons are closed; domain failure/skip reasons remain opaque Ids.
D['ReasonCode']=en(*[k for k in sorted(reasons) if reasons[k]['layer']!='legacy-p4'])
D['VerificationResult']['properties']['reason']=ref('ReasonCode')
D['VerificationResult']['allOf']=[{'if':{'properties':{'status':{'const':status}}},'then':{'properties':{'reason':en(*[code for code,r in reasons.items() if r['layer']!='legacy-p4' and (r['result']==status or (r['result']=='EITHER' and status in ['SATISFIED','UNSATISFIED']))])}}} for status in ['SATISFIED','UNSATISFIED','UNKNOWN','CONFLICT','INVALID','ERROR']]
D['Execution']['allOf'].append({'if':{'properties':{'status':{'const':'ACCEPTED'}}},'then':{'not':{'required':['startedAt']}}})
write('schemas/core.schema.json',core)
# Structural set registry is machine readable and the only source of array normalization.
sets=[]
def st(schema,path,key,dup=None):sets.append({'schema':schema,'path':path,'sortKey':key,'duplicateKey':dup or key,'comparison':'ASCII tuple; revision components exact U64 numeric','duplicateReason':'DUPLICATE_ENTRY' if path.endswith('entries') or path.endswith('expectedEffects') else 'DUPLICATE_SET_MEMBER'})
for s,p in [('tml.receipt','/postState'),('tml.evidence','/observations'),('tml.evidence','/facts'),('tml.evidence','/receipts'),('tml.observation','/facts'),('tml.execution','/receipts'),('request','/preconditions'),('fingerprint','/preconditions')]:st(s,p,['id'])
st('tml.receipt','/entries',['entryId']);st('tml.claim','/body/expectedEffects',['entryId']);st('tml.claim','/body/entryIds',['$']);st('tml.observation','/query/predicates',['$']);st('tml.evidence','/frame/snapshots',['source','stream','epoch','revision']);st('bundle','/records',['id'])
for path,key in [('/definition/sources',['id']),('/definition/sources/*/roles',['$']),('/definition/predicates',['id']),('/definition/predicates/*/sources',['$']),('/definition/capabilities',['id']),('/definition/capabilities/*/allowedOutcomes',['$']),('/definition/rewards',['capability','reward.id','reward.version']),('/definition/rewards/*/effects',['entryId']),('/definition/preconditions',['id']),('/definition/streams',['source','stream'])]:st('tml.profile',path,key)
write('structural-sets.json',{'version':'1.0','sets':sets,'ordered':['TypedValue.list.value','Expr.args','all arrays not explicitly registered']})

def at(o,path):
 for k in path.split('.'):o=o[k]
 return o

def normalize(v,kind=None):
 v=copy.deepcopy(v)
 def walk(x):
  if isinstance(x,float) and x==0:return 0
  if isinstance(x,list):return [walk(z) for z in x]
  if not isinstance(x,dict):return x
  return {k:walk(z) for k,z in x.items()}
 v=walk(v)
 def apply_path(o,parts,rule):
  if not parts:
   def key(x):return tuple(int(at(x,k)) if k in ['revision','reward.version'] else (x if k=='$' else at(x,k)) for k in rule['sortKey'])
   if isinstance(o,list):o.sort(key=key)
   return
  k,*tail=parts
  if k=='*':
   for x in o:apply_path(x,tail,rule)
  elif isinstance(o,dict) and k in o:apply_path(o[k],tail,rule)
 def recurse(o,k=None):
  if isinstance(o,list):
   for z in o:recurse(z)
  elif isinstance(o,dict):
   for z in o.values():recurse(z)
   typ=k or o.get('schema')
   if not typ and set(['scope','idempotencyKey','args']).issubset(o):typ='request'
   for rule in sets:
    if rule['schema']==typ:apply_path(o,rule['path'].strip('/').split('/'),rule)
 recurse(v,kind)
 return v

def canonical(v):return rfc8785.dumps(v).decode()
def digest(v,domain='TML1/record'):return 'sha256:'+hashlib.sha256((domain+'\n'+canonical(v)).encode()).hexdigest()
def rr(x):return {'id':x['id'],'digest':digest(normalize(x))}
def fp_payload(q):return normalize({k:( {a:b for a,b in v.items() if a!='executionId'} if k=='scope' else v) for k,v in q.items() if k!='idempotencyKey'},'fingerprint')
def fp(q):return digest(fp_payload(q),'TML1/request')
# Deterministic complete synthetic records. Never infer production schema from these fixtures.
base=copy.deepcopy(OLD['fixtures']['base']);scope=base['request']['scope'];T='2026-10-03T03:00:00.000001Z'
def effect(e):return {k:v for k,v in e.items() if k in ['entryId','ledger','target','effect','requested','applied']}|{'allowedOutcome':e['outcome']}
prof={'schema':'tml.profile','version':'1.0','id':'inha.world.v1.fixture','definition':{
 'sources':[{'id':'server.quest','roles':['SNAPSHOT_READER']},{'id':'server.reward','roles':['TRANSACTION_AUTHORITY']},{'id':'server.wallet','roles':['SNAPSHOT_READER']},{'id':'server.progression','roles':['SNAPSHOT_READER']},{'id':'host.evaluator','roles':['EVALUATOR']},{'id':'worldforge','roles':['ARTIFACT_AUTHOR']}],
 'predicates':[{'id':'quest.stage','valueType':'integer','sources':['server.quest']},{'id':'quest.optional','valueType':'null','sources':['server.quest']},{'id':'wallet.balance','valueType':'integer','sources':['server.wallet']},{'id':'exp.total','valueType':'integer','sources':['server.progression']}],
 'capabilities':[{'id':'world.quest.advance','source':'server.reward','targetType':'quest','rewardRequired':True,'allowedOutcomes':['APPLIED','SKIPPED']}],
 'rewards':[{'capability':'world.quest.advance','reward':base['receipt']['reward'],'effects':[effect(e) for e in base['receipt']['entries']]}],
 'preconditions':[{'schema':'tml.claim-template','version':'1.0','id':'template:stage8','expr':{'op':'eq','subject':base['request']['target'],'predicate':'quest.stage','value':{'type':'integer','value':'8'}}},{'schema':'tml.claim-template','version':'1.0','id':'template:present','expr':{'op':'exists','subject':base['request']['target'],'predicate':'quest.stage'}}],
 'streams':[{'source':e['after']['source'],'stream':e['after']['stream'],'target':e['target'],'includesPriorEffects':True} for e in base['receipt']['entries']]+[{'source':'server.quest','stream':'quest:main2:A','target':base['request']['target'],'includesPriorEffects':False}]}}
prof=normalize(prof);prof['revision']=digest(prof,'TML1/profile');pref={'id':prof['id'],'revision':prof['revision']}
q=base['request'];q['profile']=pref
receipt=base['receipt'];receipt['profile']=pref;receipt['requestFingerprint']=fp(q)
claim=base['claim'];claim['profile']=pref;claim['body']['expectedExecution']={'requestFingerprint':fp(q),'capability':q['capability'],'target':q['target']}
def hdr(typ,id):return {'schema':'tml.'+typ,'version':'1.0','id':id,'profile':copy.deepcopy(pref),'scope':copy.deepcopy(scope)}
def evidence_for(c,records,snaps=[]):return hdr('evidence','evidence:1')|{'claim':rr(c),'frame':{'phase':'POST','snapshots':snaps},'observations':[rr(r) for r in records if r['schema']=='tml.observation'],'facts':[rr(r) for r in records if r['schema']=='tml.fact'],'receipts':[rr(r) for r in records if r['schema']=='tml.receipt']}
def bundle(c,rs,snaps=[]):
 ev=evidence_for(c,rs,snaps)
 return {'version':'1.0','scope':copy.deepcopy(c['scope']),'profile':copy.deepcopy(c['profile']),'root':{'claim':rr(c),'evidence':rr(ev)},'records':[copy.deepcopy(c),ev,*copy.deepcopy(rs)]}
def adm(r):
 d={'record':rr(r),'scope':r['scope'],'source':r.get('source','host.evaluator'),'role':'SNAPSHOT_READER','binding':{}}
 if r['schema'] in ['tml.fact','tml.observation']:d['binding']={'kind':'SNAPSHOT','snapshot':r['snapshot']}
 elif r['schema']=='tml.receipt':
  d['role']='TRANSACTION_AUTHORITY';d['binding']={'kind':'TRANSACTION','executionId':r['scope']['executionId'],'requestFingerprint':r['requestFingerprint'],'transactionId':r['transactionId'],'completeEffects':True,'children':[{'entryId':e['entryId'],'transactionId':e['transactionId'],'after':e['after']} for e in r['entries'] if e['outcome']=='APPLIED' and 'transactionId' in e]}
 else:d['role']='EVALUATOR';d['binding']={'kind':'VERIFICATION','claim':r['claim'],'evidence':r['evidence']}
 return d

def host(b):
 rs=[r for r in b['records'] if r['schema'] in ['tml.fact','tml.observation','tml.receipt','tml.verification']]
 return {'expectedScope':copy.deepcopy(b['scope']),'profile':copy.deepcopy(prof),'admissions':[adm(r) for r in rs], 'executions':[{'request':copy.deepcopy(q),'requestFingerprint':fp(q),'receipts':[{'source':r['source'],'transactionId':r['transactionId'],'record':rr(r)} for r in rs if r['schema']=='tml.receipt']}], 'readFailures':[], 'fault':None,'checkedAt':T}

def state(values=['8'],revisions=['10'],predicate='quest.stage',op='eq',minimum='10',mode='EXACT'):
 target=q['target'];ss=[];rs=[]
 for i,val in enumerate(values):
  sn={'source':'server.quest','stream':'quest:main2:A','epoch':'epoch:1','revision':revisions[min(i,len(revisions)-1)]};ss.append(sn)
  f=hdr('fact','fact:'+str(i))|{'subject':target,'predicate':predicate,'value':val if isinstance(val,dict) else {'type':'integer','value':val},'source':sn['source'],'snapshot':sn,'observationId':'observation:'+str(i)}
  o=hdr('observation','observation:'+str(i))|{'source':sn['source'],'snapshot':sn,'observedAt':T,'query':{'subject':target,'predicates':[predicate]},'facts':[rr(f)]};rs += [f,o]
 sn={'source':'server.quest','stream':'quest:main2:A','epoch':'epoch:1','revision':minimum}
 ex={'op':op,'subject':target,'predicate':predicate}
 if op!='exists':ex['value']={'type':'integer','value':'8'}
 c=hdr('claim','claim:state')|{'body':{'kind':'STATE','expr':ex,'snapshotRequirement':{'mode':mode,'snapshot':sn}}}
 return bundle(c,rs,list({canonical(z):z for z in ss}.values()))

def projection(rev='43',epoch='epoch:1',multi=False):
 es=receipt['entries'] if multi else receipt['entries'][:1];rs=[copy.deepcopy(receipt)];snaps=[]
 for i,e in enumerate(es):
  sn=copy.deepcopy(e['after']);sn['revision']=rev if i==0 else sn['revision'];sn['epoch']=epoch if i==0 else sn['epoch'];snaps.append(sn)
  f=hdr('fact','projection:fact:'+str(i))|{'subject':e['target'],'predicate':'wallet.balance' if i==0 else 'exp.total','value':{'type':'integer','value':'230' if i==0 else '100'},'source':sn['source'],'snapshot':sn,'observationId':'projection:observation:'+str(i)}
  o=hdr('observation',f['observationId'])|{'source':sn['source'],'snapshot':sn,'observedAt':T,'query':{'subject':e['target'],'predicates':[f['predicate']]},'facts':[rr(f)]};rs.extend([f,o])
 c=hdr('claim','claim:projection')|{'body':{'kind':'PROJECTION_APPLIED','receipt':rr(receipt),'entryIds':[e['entryId'] for e in es]}}
 return bundle(c,rs,snaps)

def rebuild(b):
 # Builder convenience only; serialized corpus always contains fully materialized values.
 rs=b['records'];by={r['id']:r for r in rs};c=by[b['root']['claim']['id']];ev=by[b['root']['evidence']['id']]
 for r in rs:
  if r['schema']=='tml.observation':r['facts']=[rr(by[x['id']]) if x['id'] in by else x for x in r['facts']]
 if c['body']['kind']=='PROJECTION_APPLIED':
  z=c['body']['receipt'];c['body']['receipt']=rr(by[z['id']]) if z['id'] in by else z
 ev['claim']=rr(c)
 for name in ['observations','facts','receipts']:ev[name]=[rr(by[x['id']]) if x['id'] in by else x for x in ev[name]]
 b['root']={'claim':rr(c),'evidence':rr(ev)}
 return b

def rec(b,typ):return next(r for r in b['records'] if r['schema']=='tml.'+typ)
def mutation(b,fun):fun(b);return rebuild(b)

# Host fixture schema: opaque admissions are furnished by the test harness, never submitted to runtime as authority.
snapbind=obj({'kind':const('SNAPSHOT'),'snapshot':ref('SnapshotRef')})
txbind=obj({'kind':const('TRANSACTION'),'executionId':ref('Id'),'requestFingerprint':ref('Digest'),'transactionId':ref('Id'),'completeEffects':B,'children':arr(obj({'entryId':ref('Id'),'transactionId':ref('Id'),'after':ref('SnapshotRef')}))})
vrbind=obj({'kind':const('VERIFICATION'),'claim':ref('Ref'),'evidence':ref('Ref')})
admission=obj({'record':ref('Ref'),'scope':ref('Scope'),'source':ref('Id'),'role':en('SNAPSHOT_READER','TRANSACTION_AUTHORITY','EVALUATOR','ARTIFACT_AUTHOR'),'binding':{'oneOf':[snapbind,txbind,vrbind]}})
hostschema=obj({'expectedScope':ref('Scope'),'profile':{'$ref':'urn:tml:v1:profile'},'admissions':arr(admission),'executions':arr(obj({'request':ref('Request'),'requestFingerprint':ref('Digest'),'receipts':arr(obj({'source':ref('Id'),'transactionId':ref('Id'),'record':ref('Ref')}))})),'readFailures':arr(obj({'record':ref('Ref'),'reason':const('READ_UNAVAILABLE')})),'fault':{'oneOf':[N,obj({'stage':en(1,2,3,4,5,6),'reason':const('INTERNAL_ERROR')})]},'checkedAt':ref('Time')})
hostschema.update({'$id':'urn:tml:v1:host-fixture','$schema':core['$schema']});write('schemas/host-fixture.schema.json',hostschema)

cases=[];manifest={}
def oracle(n,domain):
 text=canonical(n);h=digest(n,domain);key=domain+':'+h
 manifest[key]={'domain':domain,'canonicalUtf8':text,'canonicalBytesBase64':base64.b64encode(text.encode()).decode(),'sha256':h}
 return text,h

def add(id,layer,data,result,reason,*,h=None,raw=None,normalized='AUTO',domain='TML1/vector',effects=None):
 assert reason in reasons,reason
 if normalized=='AUTO':normalized=None if result=='INVALID' else normalize(data,'bundle' if layer=='evaluation' else None)
 text=dg=None
 if normalized is not None:text,dg=oracle(normalized,domain)
 cases.append({'id':id,'layer':layer,'input':{'wireBytesBase64':base64.b64encode(raw).decode() if raw is not None else None,'structuredInput':data if raw is None else None,'hostFixture':h},'expected':{'normalized':normalized,'canonicalUtf8':text,'digest':dg,'result':result,'reason':reason,'effects':effects}})

def evcase(id,b,result,reason,h=None):add(id,'evaluation',b,result,reason,h=host(b) if h is None else h)

for old in OLD['cases']:
 id=old['id'];cat=old['category'];inp=old['input'];ex=old['expected'];result=ex.get('status','VALID');reason=ex.get('reason')
 if cat in ['canonical','decode']:
  raw=inp['rawJson'].encode();val=json.loads(inp['rawJson']) if cat=='canonical' else None
  add(id,'value',None,result,reason or 'VALID_VALUE',raw=raw,normalized=normalize(val) if cat=='canonical' else None);continue
 if cat=='typed-comparison':add(id,'comparison',inp,result,reason or ('OPERAND_TYPE' if result=='INVALID' else 'AUTHORITATIVE_COMPARISON'));continue
 if cat=='logic':
  reason=inp['op'].upper()+'_'+result
  if inp['op']=='not' and result in ['UNKNOWN','CONFLICT']:reason='AUTHORITATIVE_FACT_MISSING' if result=='UNKNOWN' else 'AUTHORITATIVE_FACT_CONFLICT'
  add(id,'logic',{'op':inp['op'],'children':[{'status':s,'reason':('AUTHORITATIVE_FACT_MISSING' if s=='UNKNOWN' else 'AUTHORITATIVE_FACT_CONFLICT' if s=='CONFLICT' else 'AUTHORITATIVE_COMPARISON')} for s in inp['children']]},result,reason);continue
 if id.startswith('S') or id=='X08-immutable-receipt':
  b=bundle(claim,[receipt]);h=None
  if id.startswith('S02'):rec(b,'receipt')['scope']['principal']['id']='account:B'
  if id.startswith('S03'):rec(b,'receipt')['scope']['worldId']='world:other'
  if id.startswith('S04'):rec(b,'receipt')['scope']['executionId']='execution:2'
  if id.startswith('S05'):rec(b,'receipt')['reward']['version']='2'
  if id.startswith('S06'):rec(b,'receipt')['entries'][0]['applied']='100'
  if id.startswith('S07'):b['records']=[r for r in b['records'] if r['schema']!='tml.receipt']
  if id.startswith('S09'):b=projection('41')
  if id.startswith('S10'):b=projection()
  if id.startswith('S11'):b=projection(epoch='epoch:2');result='UNKNOWN';reason='SNAPSHOT_INCOMPARABLE'
  if id.startswith('S12'):rec(b,'receipt')['entries'].append(copy.deepcopy(receipt['entries'][0]))
  if id.startswith('S13'):rec(b,'receipt')['requestFingerprint']='sha256:'+'0'*64
  if id.startswith('S15'):
   e=copy.deepcopy(receipt['entries'][0]);e['entryId']='grant:extra';e['transactionId']='transaction:extra';rec(b,'receipt')['entries'].append(e)
  if id.startswith('X08'):
   r=copy.deepcopy(receipt);r['id']='receipt:conflict';r['entries'][0]['applied']='179';b=bundle(claim,[receipt,r])
  rebuild(b);h=host(b)
  if id.startswith('S08'):h['admissions']=[];reason='UNTRUSTED_PROVENANCE'
  evcase(id,b,result,reason or ('PROJECTION_APPLIED' if cat=='projection' else 'SETTLEMENT_MATCH'),h)
  if id.startswith('S14'):cases[-1]['input']['hostFixture']['checkedAt']=T # transport replay deliberately excluded from runtime payload
  continue
 if cat=='evidence':
  if id.startswith('F10'):add(id,'arithmetic',{'op':'add','left':inp['left'],'right':inp['right']},result,reason);continue
  b=state();h=None
  if id.startswith('F01'):rec(b,'fact')['scope']['principal']['id']='account:B'
  if id.startswith('F02'):b=state(['8','9'],['10','11'])
  if id.startswith('F03'):b=state(['8','9'])
  if id.startswith('F04'):b=state([],op='exists')
  if id.startswith('F05'):b=state([{'type':'null'}],predicate='quest.optional',op='exists')
  if id.startswith('F06'):rec(b,'fact')['value']['value']=10
  if id.startswith('F08'):b=state(minimum='11',mode='AT_LEAST')
  if id.startswith('F09'):
   c=rec(b,'claim');x=copy.deepcopy(c['body']['expr']);c['body']['expr']={'op':'or','args':[x,copy.deepcopy(x)]};c['body']['expr']['args'][1]['value']={'type':'string','value':123}
  rebuild(b);h=host(b)
  if id.startswith('F11'):
   f=rec(b,'fact');h['readFailures']=[{'record':rr(f),'reason':'READ_UNAVAILABLE'}];h['admissions']=[a for a in h['admissions'] if a['record']['id']!=f['id']];b['records'].remove(f)
  if id.startswith('F12'):h['fault']={'stage':5,'reason':'INTERNAL_ERROR'}
  evcase(id,b,result,reason or ('AUTHORITATIVE_FACT_PRESENT' if id.startswith('F05') else 'AUTHORITATIVE_COMPARISON'),h);continue
 if cat=='bridge':
  data={'handle':{'id':'handle:1','generation':'2'},'requestScope':copy.deepcopy(scope),'table':[{'id':'handle:1','generation':'2','scope':copy.deepcopy(scope),'released':False}]}
  if id.startswith('B01'):data['table'][0]['released']=True
  if id.startswith('B02'):data['handle']['generation']='1'
  if id.startswith('B03'):data['requestScope']['principal']['id']='account:B'
  add(id,'bridge',data,result,reason);continue
 # Remaining X cases: complete deterministic execution store, transport and request.
 data={'action':'LOOKUP','request':copy.deepcopy(q),'locator':{'by':'EXECUTION','namespace':{k:scope[k] for k in ['tenantId','worldId','principal']},'executionId':scope['executionId']},'store':{'executions':[{'schema':'tml.execution','version':'1.0','id':scope['executionId'],'profile':pref,'request':copy.deepcopy(q),'requestFingerprint':fp(q),'status':'SUCCEEDED','startedAt':T,'completedAt':T,'receipts':[rr(receipt)]}],'tombstones':[],'writerAccepting':True,'recoverySupported':True},'transport':{'executionRead':'AVAILABLE','receiptRead':'AVAILABLE','responseLost':False},'caller':{'submitted':True,'lastObserved':None},'activeProfile':pref}
 effects={'newMutationCalls':0,'canonicalExecutionId':scope['executionId']}
 if id.startswith('X01'):data['transport']['executionRead']='UNAVAILABLE';data['transport']['responseLost']=True;result='RECOVERABLE'
 if id.startswith('X02'):result='KNOWN';reason='EXECUTION_OBSERVED'
 if id.startswith('X03'):data['action']='SUBMIT';data['request']['scope']['executionId']='execution:other';result='KNOWN';reason='IDEMPOTENT_REPLAY'
 if id.startswith('X04'):data['action']='SUBMIT';data['request']['args']['event']['value']='different'
 if id.startswith('X05'):data['store']['executions']=[];effects['canonicalExecutionId']=None
 if id.startswith('X06'):data['request']['profile']['revision']='sha256:'+'f'*64 # repaired alias below
 if id.startswith('X07'):
  data['store']['executions']=[];data['store']['tombstones']=[{'namespace':data['locator']['namespace'],'capability':q['capability'],'idempotencyKey':q['idempotencyKey'],'executionId':scope['executionId'],'requestFingerprint':fp(q)}];effects['canonicalExecutionId']=None
 # Avoid shared profile dict mutation in fixture generation.
 if id.startswith('X06'):data['activeProfile']=copy.deepcopy(pref);data['activeProfile']['revision']=prof['revision'];data['store']['executions'][0]['profile']=data['activeProfile']
 add(id,'execution',data,result,reason or 'EXECUTION_OBSERVED',effects=effects)
# All prior vector IDs are preserved.
assert len(cases)==112
# Critical additions: expectations are authored here, not obtained from an evaluator.
for field,value in [('tenantId','tenant:other'),('sessionId','session:other')]:
 b=state();rec(b,'fact')['scope'][field]=value;rebuild(b);evcase('A-scope-'+field,b,'INVALID','SCOPE_MISMATCH')
b=state();rec(b,'observation')['scope']['executionId']='execution:other';rebuild(b);evcase('A-observation-execution',b,'INVALID','SCOPE_MISMATCH')
for change,label in [('stream','stream'),('epoch','epoch')]:
 b=state(['8','8']);r=next(r for r in b['records'] if r['id']=='fact:1');r['snapshot'][change]='different';o=next(r for r in b['records'] if r['id']=='observation:1');o['snapshot']=copy.deepcopy(r['snapshot']);rec(b,'evidence')['frame']['snapshots']=[rec(b,'fact')['snapshot'],r['snapshot']];rebuild(b);evcase('A-state-mixed-'+label,b,'INVALID','SNAPSHOT_MISMATCH')
evcase('A-exact-replay',state(minimum='10'),'SATISFIED','AUTHORITATIVE_COMPARISON')
evcase('A-at-least-satisfied',state(revisions=['11'],minimum='10',mode='AT_LEAST'),'SATISFIED','AUTHORITATIVE_COMPARISON')
evcase('A-exact-different-revision',state(revisions=['11'],minimum='10'),'UNKNOWN','STALE_SNAPSHOT')
evcase('A-multistream-projection',projection(multi=True),'SATISFIED','PROJECTION_APPLIED')
b=state(['8','9'],minimum='11',mode='AT_LEAST');evcase('A-stale-and-conflict',b,'CONFLICT','AUTHORITATIVE_FACT_CONFLICT')
b=state();rec(b,'fact')['value']['value']=10;rebuild(b);h=host(b);h['fault']={'stage':5,'reason':'INTERNAL_ERROR'};evcase('A-malformed-before-evaluator-fault',b,'INVALID','SCHEMA_VIOLATION',h)
b=state();h=host(b);h['fault']={'stage':1,'reason':'INTERNAL_ERROR'};evcase('A-validator-internal-failure',b,'ERROR','INTERNAL_ERROR',h)
b=bundle(claim,[receipt]);h=host(b);rec(b,'receipt')['entries'].pop();rebuild(b);evcase('A-deleted-effect-rehashed-unadmitted',b,'UNKNOWN','UNTRUSTED_PROVENANCE',h)
b=bundle(claim,[receipt]);rec(b,'receipt')['entries'].pop();rebuild(b);evcase('A-complete-but-missing-effect',b,'UNSATISFIED','EFFECT_SET_MISMATCH')
b=bundle(claim,[receipt]);h=host(b);rec(b,'receipt')['transactionId']='transaction:forged';rebuild(b);evcase('A-transaction-rehashed-unadmitted',b,'UNKNOWN','UNTRUSTED_PROVENANCE',h)
b=bundle(claim,[receipt]);rec(b,'receipt')['transactionId']='transaction:forged';rebuild(b);h=host(b);h['executions'][0]['receipts'][0]['transactionId']='transaction:original';evcase('A-transaction-not-bound',b,'INVALID','EXECUTION_BINDING_MISMATCH',h)
b=bundle(claim,[receipt]);h=host(b);h['executions'][0]['request']['scope']['executionId']='execution:original';evcase('A-transaction-repackaged',b,'INVALID','EXECUTION_BINDING_MISMATCH',h)
b=bundle(claim,[receipt]);h=host(b);h['admissions'][0]['binding']['children'].pop();evcase('A-child-relation-missing',b,'INVALID','RECEIPT_INTEGRITY',h)
b=bundle(claim,[receipt]);h=host(b);h['admissions'][0]['binding']['completeEffects']=False;evcase('A-partial-commit-dto',b,'INVALID','RECEIPT_INTEGRITY',h)
b=bundle(claim,[receipt]);del rec(b,'receipt')['entries'][0]['transactionId'];rebuild(b);evcase('A-applied-child-field-missing',b,'INVALID','SCHEMA_VIOLATION')
b=bundle(claim,[receipt]);e=rec(b,'receipt')['entries'][0];e.update({'outcome':'SKIPPED','applied':'0','reason':'CAP_REACHED'});rebuild(b);evcase('A-skipped-has-child',b,'INVALID','SCHEMA_VIOLATION')
b=bundle(claim,[receipt]);e=rec(b,'receipt')['entries'][0];e.update({'outcome':'SKIPPED','applied':'0','reason':'CAP_REACHED'});del e['transactionId'];rebuild(b);evcase('A-skipped-not-expected',b,'UNSATISFIED','EFFECT_MISMATCH')
b=bundle(claim,[]);rec(b,'evidence')['receipts']=[rr(receipt)];rec(b,'evidence')['scope']['principal']['id']='account:B';rebuild(b);evcase('A-scope-and-missing-receipt',b,'INVALID','SCOPE_MISMATCH')
b=state();rec(b,'fact')['source']='server.wallet';rebuild(b);evcase('A-fact-source-snapshot-mismatch',b,'INVALID','REFERENCE_MISMATCH')
b=state();rec(b,'observation')['query']['predicates']=['wallet.balance'];rebuild(b);evcase('A-fact-outside-query',b,'INVALID','REFERENCE_MISMATCH')
b=state();rec(b,'fact')['observationId']='observation:other';rebuild(b);evcase('A-observation-backlink',b,'INVALID','REFERENCE_MISMATCH')
b=state();rec(b,'fact')['value']['value']='9';evcase('A-fact-hash-mismatch',b,'INVALID','HASH_MISMATCH')
b=state();h=host(b);h['admissions']=[];evcase('A-source-names-only',b,'UNKNOWN','UNTRUSTED_PROVENANCE',h)
b=state();h=host(b)
for a in h['admissions']:a['role']='ARTIFACT_AUTHOR';a['source']='worldforge'
evcase('A-worldforge-runtime-admission',b,'UNKNOWN','UNTRUSTED_PROVENANCE',h)
# Fingerprint payload intentionally excludes only named fields; transport is separate.
for label,change in [('baseline',lambda z:None),('principal',lambda z:z['scope']['principal'].update(id='account:B')),('world',lambda z:z['scope'].update(worldId='world:other')),('tenant',lambda z:z['scope'].update(tenantId='tenant:other')),('target',lambda z:z['target'].update(id='quest:other')),('reward',lambda z:z['expectedReward'].update(version='2')),('profile',lambda z:z['profile'].update(revision='sha256:'+'f'*64)),('execution-excluded',lambda z:z['scope'].update(executionId='execution:other')),('key-excluded',lambda z:z.update(idempotencyKey='idem:other')),('session',lambda z:z['scope'].update(sessionId='session:1')),('credential-excluded',lambda z:None)]:
 z=copy.deepcopy(q);change(z);data={'request':z,'transport':{'credential':'credential:other' if label=='credential-excluded' else 'credential:test','timestamp':'transport:ignored'}}
 add('A-fingerprint-'+label,'fingerprint',data,'VALID','FINGERPRINT_COMPUTED',normalized=fp_payload(z),domain='TML1/request',effects={'equalsBaseline':label in ['baseline','execution-excluded','key-excluded','credential-excluded']})
z=copy.deepcopy(q);z['scope']['sessionId']=None;add('A-optional-null','schema',{'definition':'Request','value':z},'INVALID','SCHEMA_VIOLATION')
z=copy.deepcopy(q);z['unknown']=True;add('A-unknown-field','schema',{'definition':'Request','value':z},'INVALID','SCHEMA_VIOLATION')
for typ,val,valid,reason in [('I64','-9223372036854775808',True,'SCHEMA_VALID'),('I64','9223372036854775807',True,'SCHEMA_VALID'),('I64','-9223372036854775809',False,'INTEGER_RANGE'),('U64','18446744073709551615',True,'SCHEMA_VALID'),('U64','18446744073709551616',False,'INTEGER_RANGE'),('U64','-1',False,'INTEGER_ENCODING'),('U64','00',False,'INTEGER_ENCODING'),('U64','-0',False,'INTEGER_ENCODING')]:
 add('A-'+typ+'-'+val.replace('-','minus'),'schema',{'definition':typ,'value':val},'VALID' if valid else 'INVALID',reason)
for op,l,r,res,rsn in [('sub','-9223372036854775808','1','ERROR','INTEGER_OVERFLOW'),('add','9007199254740992','1','VALID','ARITHMETIC_OK')]:add('A-arithmetic-'+op,'arithmetic',{'op':op,'left':l,'right':r},res,rsn,effects={'value':str(int(l)+int(r)) if res=='VALID' else None})
for label,raw,result,reason,norm in [('zero','-0.0','VALID','VALID_VALUE',{'type':'number','value':0}),('underflow-negative','-1e-400','INVALID','NUMBER_UNDERFLOW',None),('max-safe','9007199254740991','VALID','VALID_VALUE',{'type':'number','value':9007199254740991}),('tie-even','1.00000000000000011102230246251565404236316680908203125','VALID','VALID_VALUE',{'type':'number','value':1})]:add('A-number-'+label,'value',None,result,reason,raw=('{"type":"number","value":'+raw+'}').encode(),normalized=norm)
add('A-invalid-utf8','value',None,'INVALID','INVALID_UNICODE',raw=b'{"type":"string","value":"\xff"}',normalized=None)
for label,t,res,norm in [('offset','2026-10-03T12:00:00.000001+09:00','VALID',T),('nano-exact','2026-10-03T03:00:00.000001000Z','VALID',T),('nano-loss','2026-10-03T03:00:00.000001001Z','INVALID',None),('millisecond','2026-10-03T03:00:00.001Z','VALID','2026-10-03T03:00:00.001000Z')]:add('A-time-adapter-'+label,'time-adapter',{'text':t},res,'TIME_CONVERTED' if res=='VALID' else 'TIME_PRECISION_UNSUPPORTED',normalized=norm)
# Identity domains, no implicit global uniqueness.
for kind in ['EXECUTION','IDEMPOTENCY','RECORD','TRANSACTION','SNAPSHOT']:
 left={'scope':copy.deepcopy(scope),'capability':q['capability'],'idempotencyKey':q['idempotencyKey'],'recordId':'record:1','source':'server.reward','transactionId':'tx:1','stream':'stream:1','epoch':'epoch:1'};right=copy.deepcopy(left);right['scope']['tenantId']='tenant:other'
 add('A-identity-tenant-'+kind,'identity',{'kind':kind,'left':left,'right':right},'VALID','IDENTITY_DISTINCT',effects={'equal':False})
for label,field,value in [('execution-ignores-capability','capability','other'),('transaction-ignores-execution','scope.executionId','execution:other'),('snapshot-epoch','epoch','epoch:2')]:
 left={'scope':copy.deepcopy(scope),'capability':q['capability'],'idempotencyKey':q['idempotencyKey'],'recordId':'record:1','source':'server.reward','transactionId':'tx:1','stream':'stream:1','epoch':'epoch:1'};right=copy.deepcopy(left)
 if '.' in field:right['scope']['executionId']=value
 else:right[field]=value
 equal=label!='snapshot-epoch';add('A-identity-'+label,'identity',{'kind':'EXECUTION' if label.startswith('execution') else 'TRANSACTION' if label.startswith('transaction') else 'SNAPSHOT','left':left,'right':right},'VALID','IDENTITY_EQUAL' if equal else 'IDENTITY_DISTINCT',effects={'equal':equal})
# Recovery A-E are concrete stores, not symbolic outcomes.
original=copy.deepcopy(next(c for c in cases if c['id']=='X02-recovery')['input']['structuredInput'])
for label in ['A','B','C','D','E','alias','independent-key','execution-collision']:
 data=copy.deepcopy(original);result='KNOWN';reason='EXECUTION_OBSERVED';effects={'newMutationCalls':0,'canonicalExecutionId':scope['executionId']}
 if label=='A':data['action']='LEGACY_RECONNECT';data['store']['writerAccepting']=False;data['transport']['responseLost']=True;reason='RECOVERY_PRESERVED';result='VALID'
 if label=='B':
  e=data['store']['executions'][0];e['status']='ACCEPTED';e['receipts']=[];e.pop('startedAt');e.pop('completedAt');data['transport']['executionRead']='UNAVAILABLE';result='RECOVERABLE';reason='WORKER_CRASH'
 if label=='C':data['caller']['lastObserved']=copy.deepcopy(data['store']['executions'][0]);data['transport']['receiptRead']='UNAVAILABLE';reason='RECEIPT_UNAVAILABLE'
 if label=='D':
  data=copy.deepcopy(next(c for c in cases if c['id']=='X07-retention-expired')['input']['structuredInput']);data['action']='SUBMIT';result='UNKNOWN';reason='RETENTION_EXPIRED';effects['canonicalExecutionId']=None
 if label=='E':data['store']['writerAccepting']=False;data['store']['recoverySupported']=True;result='VALID';reason='RECOVERY_PRESERVED';data['action']='RETIRE'
 if label=='alias':data['request']['scope']['executionId']='execution:other';data['locator']={'by':'IDEMPOTENCY','namespace':data['locator']['namespace'],'capability':q['capability'],'idempotencyKey':q['idempotencyKey']}
 if label=='independent-key':data['action']='SUBMIT';data['request']['scope']['executionId']='execution:other';data['request']['idempotencyKey']='idem:other';result='ACCEPTED';reason='EXECUTION_ACCEPTED';effects['canonicalExecutionId']='execution:other'
 if label=='execution-collision':data['action']='SUBMIT';data['request']['capability']='capability:other';result='INVALID';reason='EXECUTION_BINDING_MISMATCH'
 add('A-recovery-'+label,'execution',data,result,reason,effects=effects)
# Verification consumption is a separate host boundary, not an alternate TML evaluator.
b=state();vr=hdr('verification','verification:1')|{'claim':b['root']['claim'],'evidence':b['root']['evidence'],'status':'SATISFIED','reason':'AUTHORITATIVE_COMPARISON','checkedAt':T}
h=host(b);add('A-forged-verification','consumption',vr,'UNKNOWN','UNTRUSTED_PROVENANCE',h=h)
# Every registered structural set gets explicit permutation inputs, including nested profile arrays.
normal_samples={'tml.receipt':copy.deepcopy(receipt),'tml.claim':copy.deepcopy(claim),'tml.evidence':rec(projection(multi=True),'evidence'),'tml.observation':rec(state(),'observation'),'request':copy.deepcopy(q),'fingerprint':fp_payload(q),'bundle':projection(multi=True),'tml.profile':copy.deepcopy(prof),'tml.execution':copy.deepcopy(original['store']['executions'][0])}
normal_samples['tml.receipt']['postState']=[{'id':'fact:z','digest':'sha256:'+'f'*64},{'id':'fact:a','digest':'sha256:'+'a'*64}]
normal_samples['tml.claim']['body']['expectedEffects']=copy.deepcopy(claim['body']['expectedEffects'])
normal_samples['request']['preconditions']=[rr(z) for z in prof['definition']['preconditions']];normal_samples['fingerprint']=fp_payload(normal_samples['request'])
normal_samples['tml.observation']['facts']=[{'id':'fact:z','digest':'sha256:'+'f'*64},{'id':'fact:a','digest':'sha256:'+'a'*64}];normal_samples['tml.observation']['query']['predicates']=['quest.stage','quest.optional']
normal_samples['tml.execution']['receipts']=[rr(receipt),{'id':'receipt:2','digest':'sha256:'+'f'*64}]
# Extra profile records make every profile set have two distinct keys.
pp=normal_samples['tml.profile']['definition'];pp['sources'][0]['roles']=['SNAPSHOT_READER','ARTIFACT_AUTHOR'];pp['predicates'][0]['sources']=['server.quest','server.wallet'];pp['capabilities'].append({**copy.deepcopy(pp['capabilities'][0]),'id':'world.quest.other'});pp['rewards'].append({**copy.deepcopy(pp['rewards'][0]),'reward':{'id':'reward:other','version':'2'}})
for ix,rule in enumerate(sets):
 v=copy.deepcopy(normal_samples[rule['schema']])
 if rule['path']=='/body/entryIds':v=rec(projection(multi=True),'claim')
 def reverse_at(o,parts):
  if not parts:
   if len(o)<2: # isolated normalization fixtures may contain unresolved, schema-valid refs
    if o and isinstance(o[0],dict) and set(o[0])=={'id','digest'}:o.append({'id':'zz:ref','digest':'sha256:'+'f'*64})
   o.reverse();return
  k,*rest=parts
  if k=='*':
   for z in o:reverse_at(z,rest)
  elif k in o:reverse_at(o[k],rest)
 reverse_at(v,rule['path'].strip('/').split('/'))
 add('A-set-permutation-'+str(ix+1).zfill(2),'normalization',{'kind':rule['schema'],'value':v},'VALID','NORMALIZED',normalized=normalize(v,rule['schema']))
# Wire limits: complete raw bytes, no generator directives or counts masquerading as records.
small=state()
wire=canonical(normalize(small,'bundle')).encode();pad=1048576-len(wire)
for extra in [0,1]:add('A-bundle-bytes-'+str(1048576+extra),'limits',None,'VALID' if extra==0 else 'INVALID','SCHEMA_VALID' if extra==0 else 'LIMIT_EXCEEDED',raw=wire+b' '*(pad+extra),normalized=normalize(small,'bundle') if not extra else None)
for count in [4096,4097]:
 # limit-only layer does not perform closure validation; all records are schema-valid, fully materialized.
 b=copy.deepcopy(small);r=rec(b,'fact');b['records']=[{**copy.deepcopy(r),'id':'limit:'+str(i)} for i in range(count)]
 add('A-bundle-record-count-'+str(count),'limits',b,'VALID' if count==4096 else 'INVALID','SCHEMA_VALID' if count==4096 else 'LIMIT_EXCEEDED',normalized=None) # per-record-count limit subtest, canonical deliberately not applicable
for depth in [32,33]:
 v={'type':'null'}
 for _ in range(depth):v={'type':'list','value':[v]}
 add('A-value-depth-'+str(depth),'limits',{'value':v},'VALID' if depth==32 else 'INVALID','SCHEMA_VALID' if depth==32 else 'LIMIT_EXCEEDED',normalized=normalize({'value':v}) if depth==32 else None)
# Actual compound Evidence preserves P4 OR(SATISFIED, CONFLICT).
b=state(['8','9']);extra_bundle=state([{'type':'null'}],predicate='quest.optional',op='exists')
f=rec(extra_bundle,'fact');o=rec(extra_bundle,'observation');f['id']='fact:null';f['observationId']='observation:null';o['id']='observation:null';o['facts']=[rr(f)]
b['records'] += [f,o];ev=rec(b,'evidence');ev['facts'].append(rr(f));ev['observations'].append(rr(o))
c=rec(b,'claim');oldexpr=c['body']['expr'];c['body']['expr']={'op':'or','args':[{'op':'exists','subject':q['target'],'predicate':'quest.optional'},oldexpr]};rebuild(b)
evcase('A-or-satisfied-conflict-evidence',b,'SATISFIED','OR_SATISFIED')
# Explicit scope-free precondition refs and generic arrays cannot silently become sets.
add('A-semantic-list-ordered','normalization',{'kind':'value','value':{'type':'list','value':[{'type':'integer','value':'2'},{'type':'integer','value':'1'}]}},'VALID','NORMALIZED',normalized={'type':'list','value':[{'type':'integer','value':'2'},{'type':'integer','value':'1'}]})
# State transition vectors carry complete before/after records, never a runner-generated execution.
for before,after,ok in [('ACCEPTED','EXECUTING',True),('ACCEPTED','FAILED',True),('EXECUTING','SUCCEEDED',True),('EXECUTING','FAILED',True),('SUCCEEDED','EXECUTING',False),('FAILED','EXECUTING',False),('ACCEPTED','SUCCEEDED',False)]:
 def execution_state(status):
  z=copy.deepcopy(original['store']['executions'][0]);z['status']=status
  if status not in ['SUCCEEDED','FAILED']:z.pop('completedAt',None)
  if status=='ACCEPTED':z.pop('startedAt',None)
  if status!='SUCCEEDED':z['receipts']=[]
  if status=='FAILED':z['failureCode']='COMMAND_REJECTED'
  return z
 data={'before':execution_state(before),'after':execution_state(after),'commitProven':after=='SUCCEEDED','noCommitProven':after=='FAILED','workerFenced':True}
 add('A-transition-'+before+'-'+after,'transition',data,'VALID' if ok else 'INVALID','SCHEMA_VALID' if ok else 'EXECUTION_BINDING_MISMATCH',effects={'authorityState':after if ok else before})
# Invalid authority lifecycle values have no place in the durable execution schema.
for status in ['NOT_STARTED','UNKNOWN','RECOVERABLE']:
 z=copy.deepcopy(original['store']['executions'][0]);z['status']=status;add('A-authority-forbids-'+status,'schema',{'definition':'Execution','value':z},'INVALID','SCHEMA_VIOLATION')

b=state();rec(b,'fact')['scope']['principal']['id']='account:B';evcase('A-scope-before-hash',b,'INVALID','SCOPE_MISMATCH')
b=bundle(claim,[receipt]);rec(b,'receipt')['reward']['version']='2';rec(b,'receipt')['entries'].pop();rebuild(b);evcase('A-reward-before-effect-set',b,'UNSATISFIED','REWARD_VERSION_MISMATCH')
b=state();orphan=copy.deepcopy(rec(b,'fact'));orphan['id']='fact:unreachable';b['records'].append(orphan);evcase('A-extra-unreachable-fact',b,'INVALID','REFERENCE_MISMATCH')
b=state();o=rec(b,'observation');b['records'].remove(o);h=host(b);evcase('A-missing-observation',b,'UNKNOWN','OBSERVATION_MISSING',h)
# Fixed profile explicitly permits a skipped grant, while the receipt remains atomic.
b=bundle(claim,[receipt]);r=rec(b,'receipt');entry=r['entries'][0];entry.update(outcome='SKIPPED',applied='0',reason='CAP_REACHED');entry.pop('transactionId')
cb=rec(b,'claim')['body'];cb['expectedEffects'][0].update(applied='0',allowedOutcome='SKIPPED')
p2=copy.deepcopy(prof);p2['definition']['rewards'][0]['effects'][0].update(applied='0',allowedOutcome='SKIPPED');p2['revision']=digest(normalize({k:v for k,v in p2.items() if k!='revision'}),'TML1/profile');pin={'id':p2['id'],'revision':p2['revision']}
q2=copy.deepcopy(q);q2['profile']=pin;fp2=fp(q2);b['profile']=pin
for item in b['records']:item['profile']=pin
r['requestFingerprint']=fp2;cb['expectedExecution']['requestFingerprint']=fp2;rebuild(b);h=host(b);h['profile']=p2;h['executions'][0]['request']=q2;h['executions'][0]['requestFingerprint']=fp2
evcase('A-profile-permitted-skipped',b,'SATISFIED','SETTLEMENT_MATCH',h)

add('A-id-trailing-newline','schema',{'definition':'Id','value':'execution:1\n'},'INVALID','SCHEMA_VIOLATION')
# Atomically stable stored request, even if the reader is down, remains terminal.
for case in cases:
 if case['layer']=='execution':
  data=case['input']['structuredInput'];ef=case['expected']['effects'];result=case['expected']['result']
  row=next((e for e in data['store']['executions'] if e['id']==ef['canonicalExecutionId']),None)
  ef['authorityState']='ACCEPTED' if result=='ACCEPTED' else row['status'] if row else None
  ef['callerKnowledge']='KNOWN' if result in ['KNOWN','ACCEPTED'] else result if result in ['UNKNOWN','RECOVERABLE'] else None
  ef['receiptRead']=data['transport']['receiptRead'] if result=='KNOWN' else 'NOT_REQUESTED' if result=='ACCEPTED' else None

add('A-duplicate-before-overflow','value',None,'INVALID','DUPLICATE_KEY',raw=b'{"type":"number","value":1e309,"value":0}',normalized=None)
add('A-syntax-before-duplicate','value',None,'INVALID','INVALID_JSON',raw=b'{"a":1,"a":2} garbage',normalized=None)
b=state();h=host(b)
for a in h['admissions']:a['role']='ARTIFACT_AUTHOR'
evcase('A-source-author-role-only',b,'UNKNOWN','UNTRUSTED_PROVENANCE',h)
h=host(b);h['admissions'].append(adm(vr));add('A-admitted-verification','consumption',vr,'VALID','VERIFICATION_ADMITTED',h=h)
h=host(b);a=adm(vr);a['role']='ARTIFACT_AUTHOR';h['admissions'].append(a);add('A-author-signed-verification','consumption',vr,'UNKNOWN','UNTRUSTED_PROVENANCE',h=h)
r2=copy.deepcopy(receipt);r2['id']='receipt:second-parent';r2['transactionId']='transaction:second-parent'
b=bundle(claim,[receipt,r2]);evcase('A-two-parent-commits-one-execution',b,'CONFLICT','RECEIPT_CONFLICT')
# Include all canonical source records/profile/request payloads in the oracle manifest.
for c in cases:
 inp=c['input']['structuredInput']
 if c['layer']=='consumption':oracle(normalize(inp),'TML1/record')
 if c['layer']=='evaluation':
  for r in inp['records']:oracle(normalize(r),'TML1/record')
 if c['input']['hostFixture'] and 'profile' in c['input']['hostFixture']:
  p=c['input']['hostFixture']['profile'];oracle(normalize({k:v for k,v in p.items() if k!='revision'}),'TML1/profile')
  for template in p['definition']['preconditions']:oracle(normalize(template),'TML1/record')
write('conformance-corpus.json',{'schema':'tml.conformance-corpus','version':'1.0','baselineCommit':SHA,'cases':cases})
write('canonical-digest-manifest.json',{'schema':'tml.oracle-manifest','version':'1.0','algorithm':'SHA-256(UTF8(domain + LF) || canonical bytes)','note':'Includes canonical encoding oracles for negative fixtures; digest validity is neither schema validity nor admission.','entries':list(manifest.values())})
# Corpus format is separate from runtime optional-field rules.
nullable=lambda x:{'anyOf':[x,N]}
vec=obj({'id':S,'layer':en(*sorted({c['layer'] for c in cases})),'input':obj({'wireBytesBase64':nullable(S),'structuredInput':{},'hostFixture':nullable({'$ref':'urn:tml:v1:host-fixture'})}),'expected':obj({'normalized':{},'canonicalUtf8':nullable(S),'digest':nullable(ref('Digest')),'result':S,'reason':en(*sorted(reasons)),'effects':nullable({'type':'object'})})})
vec['properties']['input']['oneOf']=[{'properties':{'wireBytesBase64':{'type':'string'},'structuredInput':{'type':'null'}}},{'properties':{'wireBytesBase64':{'type':'null'},'structuredInput':{'not':{'type':'null'}}}}]
cs=obj({'schema':const('tml.conformance-corpus'),'version':const('1.0'),'baselineCommit':{'type':'string','pattern':'^[0-9a-f]{40}$'},'cases':arr(vec)});cs.update({'$id':'urn:tml:v1:corpus','$schema':core['$schema']});write('schemas/conformance.schema.json',cs)
write('fixtures-profile.json',prof)
write('build-summary.json',{'baselineCommit':SHA,'legacyIdsPreserved':len(set(c['id'] for c in cases)&set(c['id'] for c in OLD['cases'])),'caseCount':len(cases),'manifestEntries':len(manifest),'sets':len(sets)})
print(json.dumps({'cases':len(cases),'manifest':len(manifest),'sets':len(sets)}))
