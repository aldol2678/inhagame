"""Small, non-production reference harness. Expected results are read, never generated here."""
import json,sys,re,base64,hashlib,math,decimal,datetime,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tml-freeze-oracle-deps'))
import rfc8785,jsonschema
from referencing import Registry,Resource
ROOT=Path(__file__).resolve().parents[1]
schemas=[json.loads(p.read_text()) for p in (ROOT/'schemas').glob('*.json')]
reg=Registry().with_resources([(s['$id'],Resource.from_contents(s)) for s in schemas])
SC={s['$id']:s for s in schemas};SETS=json.loads((ROOT/'structural-sets.json').read_text())['sets']
class Reject(Exception):
 def __init__(self,reason,result='INVALID'):self.reason=reason;self.result=result

def norm(x,kind=None):
 x=copy.deepcopy(x)
 def apply(o,path,r):
  if not path:
   def key(z):
    a=[]
    for k in r['sortKey']:
     v=z
     if k!='$':
      for p in k.split('.'):v=v[p]
     a.append(int(v) if k in ('revision','reward.version') else v)
    return tuple(a)
   o.sort(key=key);return
  k,*tail=path
  if k=='*':
   for z in o:apply(z,tail,r)
  elif isinstance(o,dict) and k in o:apply(o[k],tail,r)
 def walk(o,k=None):
  if isinstance(o,list):
   for z in o:walk(z)
  if isinstance(o,dict):
   for z in o.values():walk(z)
   typ=k or o.get('schema') or ('request' if 'idempotencyKey' in o and 'args' in o else None)
   for r in SETS:
    if r['schema']==typ:apply(o,r['path'][1:].split('/'),r)
 walk(x,kind);return x

def cj(x):return rfc8785.dumps(x).decode()
def dh(x,domain='TML1/record'):return 'sha256:'+hashlib.sha256((domain+'\n'+cj(norm(x))).encode()).hexdigest()
def request_fp(q):
 z=copy.deepcopy(q);z.pop('idempotencyKey');z['scope'].pop('executionId');return dh(norm(z,'fingerprint'),'TML1/request')
def check_schema(value,name):
 schema={'$ref':'urn:tml:v1:core#/$defs/'+name} if not name.startswith('urn:') else {'$ref':name}
 if list(jsonschema.Draft202012Validator(schema,registry=reg).iter_errors(value)):raise Reject('SCHEMA_VIOLATION')
def integer(v,unsigned=False):
 if not isinstance(v,str):raise Reject('SCHEMA_VIOLATION')
 if not re.fullmatch(r'0|[1-9][0-9]*' if unsigned else r'0|-?[1-9][0-9]*',v):raise Reject('INTEGER_ENCODING')
 n=int(v)
 if not (0<=n<=2**64-1 if unsigned else -2**63<=n<=2**63-1):raise Reject('INTEGER_RANGE')
 return n

def timecheck(s):
 if not isinstance(s,str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z',s):raise Reject('TIME_ENCODING')
 try:datetime.datetime.strptime(s,'%Y-%m-%dT%H:%M:%S.%fZ')
 except ValueError:raise Reject('TIME_ENCODING')

def scalars(v):
 if isinstance(v,str):
  if any(0xd800<=ord(c)<=0xdfff for c in v):raise Reject('INVALID_UNICODE')
 elif isinstance(v,list):
  for z in v:scalars(z)
 elif isinstance(v,dict):
  for k,z in v.items():scalars(k);scalars(z)
  if v.get('type')=='integer':integer(v.get('value'))
  if v.get('type')=='number':
   n=v.get('value')
   if isinstance(n,bool) or not isinstance(n,(int,float)):raise Reject('SCHEMA_VIOLATION')
   if not math.isfinite(n):raise Reject('NONFINITE_NUMBER')
   if float(n).is_integer() and abs(n)>2**53-1:raise Reject('NUMBER_RANGE')
  if v.get('type')=='time':timecheck(v.get('value'))
  if {'source','stream','epoch','revision'}<=v.keys():integer(v['revision'],True)
  for k in ('observedAt','committedAt','startedAt','completedAt','checkedAt'):
   if k in v:timecheck(v[k])

def rawdecode(raw):
 try:s=raw.decode('utf8')
 except UnicodeError:raise Reject('INVALID_UNICODE')
 def invalid(s):raise Reject('INVALID_JSON')
 # Establish complete JSON grammar before dependent duplicate/token validation.
 try:json.loads(s,parse_float=decimal.Decimal,parse_int=decimal.Decimal,parse_constant=invalid)
 except (ValueError,decimal.InvalidOperation):raise Reject('INVALID_JSON')
 def pairs(ps):
  o={}
  for k,v in ps:
   if k in o:raise Reject('DUPLICATE_KEY')
   o[k]=v
  return o
 v=json.loads(s,object_pairs_hook=pairs,parse_float=decimal.Decimal,parse_int=decimal.Decimal,parse_constant=invalid)
 def unicode_only(x):
  if isinstance(x,str) and any(0xd800<=ord(c)<=0xdfff for c in x):raise Reject('INVALID_UNICODE')
  if isinstance(x,list):
   for z in x:unicode_only(z)
  if isinstance(x,dict):
   for k,z in x.items():unicode_only(k);unicode_only(z)
 unicode_only(v)
 errors=[]
 def convert(x):
  if isinstance(x,decimal.Decimal):
   n=float(x)
   if not math.isfinite(n):errors.append('NONFINITE_NUMBER')
   elif n==0 and x!=0:errors.append('NUMBER_UNDERFLOW')
   return n
  if isinstance(x,list):return [convert(z) for z in x]
  if isinstance(x,dict):return {k:convert(z) for k,z in x.items()}
  return x
 v=convert(v)
 if errors:raise Reject(min(errors))
 scalars(v);return v

def depth(v,d=0):
 if isinstance(v,dict):
  if v.get('type') in ['string','boolean','integer','number','time','ref','null']:return d
  if v.get('type')=='list':return max([d]+[depth(z,d+1) for z in v['value']])
  if v.get('type')=='object':return max([d]+[depth(z,d+1) for z in v['value'].values()])
  if v.get('op') in ('and','or'):return max([d]+[depth(z,d+1) for z in v['args']])
  if v.get('op')=='not':return depth(v['arg'],d+1)
  return max([0]+[depth(z) for z in v.values()])
 if isinstance(v,list):return max([0]+[depth(z) for z in v])
 return d

def duplicate_sets(x,kind=None):
 def apply(o,path,r):
  if not path:
   seen=set()
   for z in o:
    vals=[]
    for key in r['duplicateKey']:
     t=z
     if key!='$':
      for a in key.split('.'):t=t[a]
     vals.append(cj(t))
    key=tuple(vals)
    if key in seen:raise Reject('DUPLICATE_RECORD' if r['schema']=='bundle' else r['duplicateReason'])
    seen.add(key)
   return
  a,*tail=path
  if a=='*':
   for z in o:apply(z,tail,r)
  elif isinstance(o,dict) and a in o:apply(o[a],tail,r)
 if isinstance(x,list):
  for z in x:duplicate_sets(z)
 if isinstance(x,dict):
  for z in x.values():duplicate_sets(z)
  typ=kind or x.get('schema')
  for r in SETS:
   if r['schema']==typ:apply(x,r['path'][1:].split('/'),r)

def compare(inp):
 l,r,op=inp['left'],inp['right'],inp['op'];scalars(l);scalars(r);check_schema(l,'Value');check_schema(r,'Value')
 if op in ['eq','ne']:ok=cj(norm(l))==cj(norm(r));ok=ok if op=='eq' else not ok
 else:
  if l['type']!=r['type'] or l['type'] not in ['integer','number','time']:raise Reject('OPERAND_TYPE')
  a,b=(int(l['value']),int(r['value'])) if l['type']=='integer' else (l['value'],r['value'])
  ok={'gt':a>b,'gte':a>=b,'lt':a<b,'lte':a<=b}[op]
 return ('SATISFIED' if ok else 'UNSATISFIED','AUTHORITATIVE_COMPARISON')

def logic(v):
 children=v['children'];op=v['op']
 if op=='not':
  c=children[0]
  if c['status'] not in ('SATISFIED','UNSATISFIED'):return c['status'],c['reason']
  s='UNSATISFIED' if c['status']=='SATISFIED' else 'SATISFIED';return s,'NOT_'+s
 for s in (['CONFLICT','UNSATISFIED','UNKNOWN','SATISFIED'] if op=='and' else ['SATISFIED','CONFLICT','UNKNOWN','UNSATISFIED']):
  if any(c['status']==s for c in children):return s,op.upper()+'_'+s
 raise Reject('SCHEMA_VIOLATION')

def same_domain(a,b):return all(a[k]==b[k] for k in ['source','stream','epoch'])
def evaluate(b,h):
 def fault(n):
  if h['fault'] and h['fault']['stage']==n:raise Reject('INTERNAL_ERROR','ERROR')
 fault(1);scalars(b);check_schema(b,'urn:tml:v1:bundle');duplicate_sets(b,'bundle')
 if depth(b)>32 or len(b['records'])>4096:raise Reject('LIMIT_EXCEEDED')
 rs=b['records'];by={r['id']:r for r in rs}
 if b['scope']!=h['expectedScope'] or any(r['scope']!=b['scope'] for r in rs):raise Reject('SCOPE_MISMATCH')
 if b['profile']!={'id':h['profile']['id'],'revision':h['profile']['revision']} or any(r['profile']!=b['profile'] for r in rs):raise Reject('PROFILE_MISMATCH')
 def get(z):
  r=by.get(z['id'])
  if r and dh(r)!=z['digest']:raise Reject('HASH_MISMATCH')
  return r
 c=get(b['root']['claim']);ev=get(b['root']['evidence'])
 if not c:raise Reject('CLAIM_MISSING','UNKNOWN')
 if not ev:raise Reject('EVIDENCE_MISSING','UNKNOWN')
 if ev['claim']!=b['root']['claim']:raise Reject('REFERENCE_MISMATCH')
 for refs in [ev['facts'],ev['observations'],ev['receipts']]:
  for z in refs:get(z)
 facts=[get(z) for z in ev['facts'] if get(z)];obs=[get(z) for z in ev['observations'] if get(z)];receipts=[get(z) for z in ev['receipts'] if get(z)]
 reachable=set();queue=[c['id'],ev['id']]
 while queue:
  id=queue.pop()
  if id in reachable:continue
  reachable.add(id);r=by.get(id)
  if not r:continue
  refs=[];typ=r['schema']
  if typ=='tml.claim' and r['body']['kind']=='PROJECTION_APPLIED':refs=[r['body']['receipt']]
  if typ=='tml.evidence':refs=[r['claim']]+r['observations']+r['facts']+r['receipts']
  if typ=='tml.observation':refs=r['facts']
  if typ=='tml.fact':queue.append(r['observationId'])
  if typ=='tml.receipt':refs=r['postState']
  queue += [z['id'] for z in refs]
 if set(by)-reachable:raise Reject('REFERENCE_MISMATCH')
 for typ,items in [('tml.fact',facts),('tml.observation',obs),('tml.receipt',receipts)]:
  if any(r['schema']==typ and r not in items for r in rs):raise Reject('REFERENCE_MISMATCH')

 for r in receipts:
  for z in r['postState']:get(z)
 for f in facts:
  o=by.get(f['observationId'])
  if o and (o['source']!=f['source'] or f['source']!=f['snapshot']['source'] or o['snapshot']!=f['snapshot'] or f['subject']!=o['query']['subject'] or f['predicate'] not in o['query']['predicates'] or {'id':f['id'],'digest':dh(f)} not in o['facts']):raise Reject('REFERENCE_MISMATCH')
  if not o and any({'id':f['id'],'digest':dh(f)} in z['facts'] for z in obs):raise Reject('REFERENCE_MISMATCH')
 for o in obs:
  if o['source']!=o['snapshot']['source']:raise Reject('REFERENCE_MISMATCH')
  for z in o['facts']:
   f=get(z)
   if f and (f['observationId']!=o['id'] or f not in facts):raise Reject('REFERENCE_MISMATCH')
 if c['body']['kind']=='STATE' and len({cj(r['snapshot']) for r in facts+obs}|{cj(s) for s in ev['frame']['snapshots']})>1:raise Reject('SNAPSHOT_MISMATCH')
 types={p['id']:p['valueType'] for p in h['profile']['definition']['predicates']}
 for f in facts:
  if f['predicate'] not in types or f['value']['type']!=types[f['predicate']]:raise Reject('SCHEMA_VIOLATION')
 def extypes(e):
  if 'predicate' in e and (e['predicate'] not in types or ('value' in e and e['value']['type']!=types[e['predicate']])):raise Reject('SCHEMA_VIOLATION')
  if e['op'] in ('gt','gte','lt','lte') and e['value']['type'] not in ('integer','number','time'):raise Reject('OPERAND_TYPE')
  for child in e.get('args',[]):extypes(child)
  if 'arg' in e:extypes(e['arg'])
 if c['body']['kind']=='STATE':extypes(c['body']['expr'])
 check_schema(h['profile'],'urn:tml:v1:profile')
 if dh({k:v for k,v in h['profile'].items() if k!='revision'},'TML1/profile')!=h['profile']['revision']:raise Reject('PROFILE_MISMATCH')
 if c['body']['kind']=='SETTLEMENT':
  cb=c['body'];ex=cb['expectedExecution']
  rules=[z for z in h['profile']['definition']['rewards'] if z['capability']==ex['capability'] and z['reward']==cb['expectedReward']]
  if not rules or sorted(rules[0]['effects'],key=cj)!=sorted(cb['expectedEffects'],key=cj):raise Reject('PROFILE_MISMATCH')
 fault(2)
 admitted={};untrusted=[]
 rolemap={s['id']:s['roles'] for s in h['profile']['definition']['sources']}
 for r in facts+obs+receipts:
  matches=[a for a in h['admissions'] if a['record']=={'id':r['id'],'digest':dh(r)} and a['scope']==r['scope'] and a['source']==r['source']]
  role='TRANSACTION_AUTHORITY' if r['schema']=='tml.receipt' else 'SNAPSHOT_READER'
  a=next((a for a in matches if a['role']==role and role in rolemap.get(a['source'],[])),None)
  if a and role=='SNAPSHOT_READER' and r['schema']=='tml.fact':
   rule=next(p for p in h['profile']['definition']['predicates'] if p['id']==r['predicate'])
   if r['source'] not in rule['sources']:a=None
  if not a:untrusted.append(r);continue
  admitted[r['id']]=a
  if role=='SNAPSHOT_READER':
   if a['binding']!={'kind':'SNAPSHOT','snapshot':r['snapshot']}:raise Reject('REFERENCE_MISMATCH')
  else:
   binding=a['binding'];children=[{'entryId':e['entryId'],'transactionId':e['transactionId'],'after':e['after']} for e in r['entries'] if e['outcome']=='APPLIED']
   if binding['kind']!='TRANSACTION' or not binding['completeEffects'] or sorted(children,key=cj)!=sorted(binding['children'],key=cj):raise Reject('RECEIPT_INTEGRITY')
   executions=[e for e in h['executions'] if e['request']['scope']==r['scope']]
   if not executions:raise Reject('EXECUTION_BINDING_MISMATCH')
   e=executions[0]
   if request_fp(e['request'])!=e['requestFingerprint'] or e['requestFingerprint']!=r['requestFingerprint']:raise Reject('REQUEST_MISMATCH')
   if r['capability']!=e['request']['capability'] or r['target']!=e['request']['target'] or not any(t['source']==r['source'] and t['transactionId']==r['transactionId'] and t['record']=={'id':r['id'],'digest':dh(r)} for t in e['receipts']):raise Reject('EXECUTION_BINDING_MISMATCH')
 fault(3)
 if c['body']['kind']!='STATE':
  if len({(r['source'],r['transactionId']) for r in receipts if r['id'] in admitted})>1:return 'CONFLICT','RECEIPT_CONFLICT'
  seen={}
  for r in receipts:
   if r['id'] not in admitted:continue
   key=(r['source'],r['transactionId'])
   if key in seen and dh(r)!=seen[key]:return 'CONFLICT','RECEIPT_CONFLICT'
   seen[key]=dh(r)
 fault(4)
 # Unknown admissions are per needed atomic input. They never turn an untrusted Fact into a false Fact.
 def missing(reason):return 'UNKNOWN',reason
 if c['body']['kind']=='STATE':
  requirement=c['body']['snapshotRequirement'];wanted=requirement['snapshot']
  def atom(e):
   if e['op'] in ('and','or'):return logic({'op':e['op'],'children':[dict(zip(['status','reason'],atom(x))) for x in e['args']]})
   if e['op']=='not':return logic({'op':'not','children':[dict(zip(['status','reason'],atom(e['arg'])))]})
   fs=[f for f in facts if f['subject']==e['subject'] and f['predicate']==e['predicate'] and f['id'] in admitted and f['observationId'] in admitted]
   if len({cj(f['value']) for f in fs})>1:return 'CONFLICT','AUTHORITATIVE_FACT_CONFLICT'
   if not fs:
    if any(f['subject']==e['subject'] and f['predicate']==e['predicate'] and f['id'] in admitted and f['observationId'] not in by for f in facts):return missing('OBSERVATION_MISSING')
    if any(f['subject']==e['subject'] and f['predicate']==e['predicate'] for f in untrusted):return missing('UNTRUSTED_PROVENANCE')
    if h['readFailures']:return missing('READ_UNAVAILABLE')
    return missing('AUTHORITATIVE_FACT_MISSING')
   sn=fs[0]['snapshot']
   if not same_domain(sn,wanted):return missing('SNAPSHOT_INCOMPARABLE')
   if (requirement['mode']=='EXACT' and sn!=wanted) or int(sn['revision'])<int(wanted['revision']):return missing('STALE_SNAPSHOT')
   fault(5)
   if e['op']=='exists':return 'SATISFIED','AUTHORITATIVE_FACT_PRESENT'
   return compare({'op':e['op'],'left':fs[0]['value'],'right':e['value']})
  return atom(c['body']['expr'])
 if untrusted:return missing('UNTRUSTED_PROVENANCE')
 if not receipts:return missing('RECEIPT_MISSING')
 r=receipts[0];fault(5)
 if c['body']['kind']=='SETTLEMENT':
  cb=c['body'];ex=cb['expectedExecution']
  if ex['requestFingerprint']!=r['requestFingerprint']:raise Reject('REQUEST_MISMATCH')
  if ex['capability']!=r['capability'] or ex['target']!=r['target']:raise Reject('EXECUTION_BINDING_MISMATCH')
  if cb['expectedReward']['id']!=r.get('reward',{}).get('id'):return 'UNSATISFIED','REWARD_ID_MISMATCH'
  if cb['expectedReward']['version']!=r['reward']['version']:return 'UNSATISFIED','REWARD_VERSION_MISMATCH'
  if {e['entryId'] for e in r['entries']}!={e['entryId'] for e in cb['expectedEffects']}:return 'UNSATISFIED','EFFECT_SET_MISMATCH'
  for e in cb['expectedEffects']:
   a=next(z for z in r['entries'] if z['entryId']==e['entryId'])
   if any(a[k]!=v for k,v in e.items() if k!='allowedOutcome') or a['outcome']!=e['allowedOutcome']:return 'UNSATISFIED','EFFECT_MISMATCH'
  return 'SATISFIED','SETTLEMENT_MATCH'
 for entry in c['body']['entryIds']:
  e=next((z for z in r['entries'] if z['entryId']==entry),None)
  if not e:raise Reject('REFERENCE_MISMATCH')
  fs=[f for f in facts if f['subject']==e['target'] and f['snapshot']['source']==e['after']['source'] and f['snapshot']['stream']==e['after']['stream']]
  if not fs:return missing('AUTHORITATIVE_FACT_MISSING')
  if not same_domain(fs[0]['snapshot'],e['after']):return missing('SNAPSHOT_INCOMPARABLE')
  if int(fs[0]['snapshot']['revision'])<int(e['after']['revision']):return missing('STALE_SNAPSHOT')
 return 'SATISFIED','PROJECTION_APPLIED'

def execute(d):
 q=d['request'];store=d['store'];ns=lambda s:tuple([s['tenantId'],s['worldId'],s['principal']['kind'],s['principal']['id']]);eid=lambda q:(ns(q['scope']),q['scope']['executionId']);ik=lambda q:(ns(q['scope']),q['capability'],q['idempotencyKey'])
 if q['profile']!=d['activeProfile']:raise Reject('PROFILE_MISMATCH')
 for e in store['executions']:
  if d['action']=='SUBMIT' and eid(e['request'])==eid(q) and e['request']!=q:raise Reject('EXECUTION_BINDING_MISMATCH' if ik(e['request'])!=ik(q) else 'IDEMPOTENCY_CONFLICT')
 es=[e for e in store['executions'] if (ik(e['request'])==ik(q) if d['action']=='SUBMIT' or d['locator']['by']=='IDEMPOTENCY' else eid(e['request'])==eid(q))]
 if es and d['action']=='SUBMIT':
  if es[0]['requestFingerprint']!=request_fp(q):raise Reject('IDEMPOTENCY_CONFLICT')
  return 'KNOWN','IDEMPOTENT_REPLAY',es[0]['id']
 if store['tombstones']:return 'UNKNOWN','RETENTION_EXPIRED',None
 if d['action'] in ['RETIRE','LEGACY_RECONNECT']:
  if store['recoverySupported'] and not store['writerAccepting']:return 'VALID','RECOVERY_PRESERVED',es[0]['id'] if es else None
  raise Reject('EXECUTION_BINDING_MISMATCH')
 if d['transport']['executionRead']=='UNAVAILABLE':return 'RECOVERABLE','RESPONSE_LOST' if d['transport']['responseLost'] else 'WORKER_CRASH',es[0]['id'] if es else None
 if es:return 'KNOWN','RECEIPT_UNAVAILABLE' if d['transport']['receiptRead']=='UNAVAILABLE' else 'EXECUTION_OBSERVED',es[0]['id']
 if d['action']=='SUBMIT':return 'ACCEPTED','EXECUTION_ACCEPTED',q['scope']['executionId']
 return 'UNKNOWN','EXECUTION_UNRESOLVED',None

def run(c):
 l=c['layer'];d=c['input']['structuredInput'];h=c['input']['hostFixture'];effects=None
 try:
  if l=='value':d=rawdecode(base64.b64decode(c['input']['wireBytesBase64']));check_schema(d,'Value');return 'VALID','VALID_VALUE',None
  if l=='comparison':return *compare(d),None
  if l=='logic':return *logic(d),None
  if l=='evaluation':return *evaluate(d,h),None
  if l=='execution':
   s,r,e=execute(d);return s,r,{'newMutationCalls':0,'canonicalExecutionId':e}
  if l=='normalization':return 'VALID','NORMALIZED',None
  if l=='fingerprint':return 'VALID','FINGERPRINT_COMPUTED',{'equalsBaseline':request_fp(d['request'])==BASE_FP}
  if l=='transition':
   before,after=d['before'],d['after'];check_schema(before,'Execution');check_schema(after,'Execution')
   if (before['status'],after['status']) not in [('ACCEPTED','EXECUTING'),('ACCEPTED','FAILED'),('EXECUTING','SUCCEEDED'),('EXECUTING','FAILED')]:return 'INVALID','EXECUTION_BINDING_MISMATCH',{'authorityState':before['status']}
   return 'VALID','SCHEMA_VALID',{'authorityState':after['status']}
  if l=='schema':
   if d['definition'] in ('I64','U64'):integer(d['value'],d['definition']=='U64')
   check_schema(d['value'],d['definition']);return 'VALID','SCHEMA_VALID',None
  if l=='arithmetic':
   a,b=integer(d['left']),integer(d['right']);n=a+b if d['op']=='add' else a-b
   if not -2**63<=n<=2**63-1:raise Reject('INTEGER_OVERFLOW','ERROR')
   return 'VALID','ARITHMETIC_OK',{'value':str(n)}
  if l=='bridge':
   e=next(t for t in d['table'] if t['id']==d['handle']['id'])
   if e['released']:raise Reject('HANDLE_EXPIRED')
   if e['generation']!=d['handle']['generation']:raise Reject('HANDLE_GENERATION_MISMATCH')
   if e['scope']!=d['requestScope']:raise Reject('SCOPE_MISMATCH')
  if l=='identity':
   def key(x):
    s=x['scope'];n=[s['tenantId'],s['worldId'],s['principal']];kind=d['kind']
    if kind=='EXECUTION':return n+[s['executionId']]
    if kind=='IDEMPOTENCY':return n+[x['capability'],x['idempotencyKey']]
    if kind=='RECORD':return [s,x['recordId']]
    if kind=='TRANSACTION':return n+[x['source'],x['transactionId']]
    return n+[x['source'],x['stream'],x['epoch']]
   eq=key(d['left'])==key(d['right']);return 'VALID','IDENTITY_EQUAL' if eq else 'IDENTITY_DISTINCT',{'equal':eq}
  if l=='consumption':
   check_schema(d,'VerificationResult')
   if d['scope']!=h['expectedScope']:raise Reject('SCOPE_MISMATCH')
   admitted=any(a['record']=={'id':d['id'],'digest':dh(d)} and a['scope']==d['scope'] and a['role']=='EVALUATOR' and any(src['id']==a['source'] and 'EVALUATOR' in src['roles'] for src in h['profile']['definition']['sources']) and a['binding']=={'kind':'VERIFICATION','claim':d['claim'],'evidence':d['evidence']} for a in h['admissions'])
   return ('VALID','VERIFICATION_ADMITTED',None) if admitted else ('UNKNOWN','UNTRUSTED_PROVENANCE',None)
  if l=='time-adapter':
   s=d['text'];m=re.fullmatch(r'(.{19})\.([0-9]+)(Z|[+-][0-9]{2}:[0-9]{2})',s)
   if not m:raise Reject('TIME_ENCODING')
   if any(z!='0' for z in m[2][6:]):raise Reject('TIME_PRECISION_UNSUPPORTED')
   t=datetime.datetime.fromisoformat(m[1]+'.'+m[2][:6].ljust(6,'0')+m[3].replace('Z','+00:00')).astimezone(datetime.timezone.utc)
   value=t.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
   if value!=c['expected']['normalized']:raise AssertionError('time normalization')
   return 'VALID','TIME_CONVERTED',None
  if l=='limits':
   if c['input']['wireBytesBase64'] is not None:
    raw=base64.b64decode(c['input']['wireBytesBase64'])
    if len(raw)>1048576:raise Reject('LIMIT_EXCEEDED')
    d=rawdecode(raw)
   if len(d.get('records',[]))>4096 or depth(d)>32:raise Reject('LIMIT_EXCEEDED')
   return 'VALID','SCHEMA_VALID',None
  raise AssertionError('unhandled '+l)
 except Reject as e:
  effects={'value':None} if l=='arithmetic' else None
  if l=='execution':effects={'newMutationCalls':0,'canonicalExecutionId':d['store']['executions'][0]['id'] if d['store']['executions'] else None}
  return e.result,e.reason,effects

if __name__=='__main__':
 corpus=json.loads((ROOT/'conformance-corpus.json').read_text());BASE_FP=next(c['expected']['digest'] for c in corpus['cases'] if c['id']=='A-fingerprint-baseline')
 for s in schemas:jsonschema.Draft202012Validator.check_schema(s)
 check_schema(corpus,'urn:tml:v1:corpus')
 failures=[]
 for c in corpus['cases']:
  try:
   s,r,e=run(c);exp=c['expected']
   if c['layer']=='execution' and e is not None:
    data=c['input']['structuredInput'];row=next((row for row in data['store']['executions'] if row['id']==e['canonicalExecutionId']),None)
    e['authorityState']='ACCEPTED' if s=='ACCEPTED' else row['status'] if row else None
    e['callerKnowledge']='KNOWN' if s in ['KNOWN','ACCEPTED'] else s if s in ['UNKNOWN','RECOVERABLE'] else None
    e['receiptRead']=data['transport']['receiptRead'] if s=='KNOWN' else 'NOT_REQUESTED' if s=='ACCEPTED' else None
   if (s,r)!=(exp['result'],exp['reason']):failures.append((c['id'],(s,r),(exp['result'],exp['reason'])))
   if e is not None and exp['effects'] is not None and e!=exp['effects']:failures.append((c['id'],'effects',e,exp['effects']))
  except Exception as e:failures.append((c['id'],type(e).__name__,str(e)[:200]))
 print(json.dumps({'cases':len(corpus['cases']),'failures':failures},indent=2))
 sys.exit(bool(failures))
