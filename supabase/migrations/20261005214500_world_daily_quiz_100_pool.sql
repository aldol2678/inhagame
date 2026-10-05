-- INHA WORLD Daily Quiz: expand the 50-question pool to 100.
-- Adds coverage for every current playable department in public.departments
-- (excluding the sentinel "학과 미선택") and seven extra second questions.

insert into private.world_daily_quiz_questions
  (position, category, question_id, prompt, options, correct_index, status, version)
values
  (51, 'major', 'quiz.campus.major_energy_geothermal', '[에너지자원공학과] 지하의 열을 이용해 얻는 재생에너지는?', '["풍력에너지","태양에너지","지열에너지","조력에너지"]'::jsonb, 2, 'ACTIVE', 1),
  (52, 'major', 'quiz.campus.major_nutrition_macros', '[식품영양학과] 탄수화물·단백질·지방과 달리 에너지를 직접 내는 영양소가 아닌 것은?', '["탄수화물","단백질","지방","비타민"]'::jsonb, 3, 'ACTIVE', 1),
  (53, 'major', 'quiz.campus.major_business_breakeven', '[경영학과] 총수익과 총비용이 같아 이익이 0이 되는 지점을 무엇이라 할까?', '["시장점유점","손익분기점","할인율","회전율"]'::jsonb, 1, 'ACTIVE', 1),
  (54, 'major', 'quiz.campus.major_finance_diversification', '[파이낸스경영학과] 여러 종류의 자산에 나누어 투자하는 대표적인 목적은?', '["거래 횟수 극대화","세금 자동 면제","위험 분산","가격 고정"]'::jsonb, 2, 'ACTIVE', 1),
  (55, 'major', 'quiz.campus.major_logistics_scm', '[아태물류학부] 원재료 조달부터 생산·유통·고객 전달까지 흐름을 통합 관리하는 개념은?', '["SCM","CRM","GDP","BEP"]'::jsonb, 0, 'ACTIVE', 1),
  (56, 'major', 'quiz.campus.major_trade_comparative', '[국제통상학과] 국가 간 무역의 이익을 설명할 때 대표적으로 쓰이는 개념은?', '["비교우위","절대온도","한계효용 체감","규모의 불경제"]'::jsonb, 0, 'ACTIVE', 1),
  (57, 'major', 'quiz.campus.major_koreanedu_morpheme', '[국어교육과] 뜻을 가진 가장 작은 말의 단위를 무엇이라 할까?', '["음절","형태소","문장","담화"]'::jsonb, 1, 'ACTIVE', 1),
  (58, 'major', 'quiz.campus.major_englishedu_clt', '[영어교육과] 실제 의미 전달과 상호작용 능력을 중시하는 언어 교수 접근은?', '["문법번역식 교수법","의사소통 중심 교수법","암기 전용 교수법","무반응 교수법"]'::jsonb, 1, 'ACTIVE', 1),
  (59, 'major', 'quiz.campus.major_socialedu_separation', '[사회교육과] 국가 권력을 입법·행정·사법으로 나누어 상호 견제하게 하는 원리는?', '["권력분립","중상주의","직접민주주의","보호무역"]'::jsonb, 0, 'ACTIVE', 1),
  (60, 'major', 'quiz.campus.major_phe_overload', '[체육교육과] 체력 향상을 위해 평소보다 큰 운동 자극을 주는 훈련 원리는?', '["가역성의 원리","과부하의 원리","특이성의 원리","개별성의 원리"]'::jsonb, 1, 'ACTIVE', 1),
  (61, 'major', 'quiz.campus.major_education_formative', '[교육학과] 학습 도중 이해 정도를 확인하고 피드백을 주기 위해 실시하는 평가는?', '["진단평가","총괄평가","형성평가","선발평가"]'::jsonb, 2, 'ACTIVE', 1),
  (62, 'major', 'quiz.campus.major_mathedu_pythagorean', '[수학교육과] 직각삼각형에서 두 직각변 제곱의 합이 빗변 제곱과 같다는 정리는?', '["피타고라스 정리","중간값 정리","페르마 소정리","드모르간 법칙"]'::jsonb, 0, 'ACTIVE', 1),
  (63, 'major', 'quiz.campus.major_publicadmin_policy', '[행정학과] 공공문제를 해결하기 위해 정부가 선택하는 목표와 행동방침을 무엇이라 할까?', '["정책","회계","상표","물류"]'::jsonb, 0, 'ACTIVE', 1),
  (64, 'major', 'quiz.campus.major_politics_proportional', '[정치외교학과] 정당의 득표 비율에 따라 의석을 배분하는 대표 선거제도는?', '["다수대표제","비례대표제","추첨제","세습제"]'::jsonb, 1, 'ACTIVE', 1),
  (65, 'major', 'quiz.campus.major_media_agenda', '[미디어커뮤니케이션학과] 미디어가 어떤 이슈를 중요하게 다루면서 사람들이 중요하다고 생각할 의제에 영향을 준다는 이론은?', '["의제설정 이론","진화론","게임이론","색채이론"]'::jsonb, 0, 'ACTIVE', 1),
  (66, 'major', 'quiz.campus.major_economics_opportunity', '[경제학과] 어떤 선택을 하기 위해 포기한 차선의 대안 가치가 뜻하는 것은?', '["매몰비용","기회비용","고정비용","거래비용"]'::jsonb, 1, 'ACTIVE', 1),
  (67, 'major', 'quiz.campus.major_consumer_purchasingpower', '[소비자학과] 소득이 그대로인데 전반적인 물가가 오르면 일반적으로 실질 구매력은 어떻게 될까?', '["증가한다","변하지 않는다","감소한다","항상 두 배가 된다"]'::jsonb, 2, 'ACTIVE', 1),
  (68, 'major', 'quiz.campus.major_child_objectperm', '[아동심리학과] 눈앞에서 사라진 물체도 계속 존재한다고 이해하는 인지 개념은?', '["대상영속성","고전적 조건형성","확증편향","인지부조화"]'::jsonb, 0, 'ACTIVE', 1),
  (69, 'major', 'quiz.campus.major_socialwork_selfdetermination', '[사회복지학과] 사회복지 실천에서 당사자가 자신의 삶에 관한 선택에 참여할 권리를 존중하는 원칙은?', '["비밀보장","자기결정","표준화","시장균형"]'::jsonb, 1, 'ACTIVE', 1),
  (70, 'major', 'quiz.campus.major_korlit_omniscient', '[한국어문학과] 소설에서 서술자가 여러 인물의 생각과 사건을 폭넓게 알고 서술하는 시점은?', '["1인칭 주인공 시점","1인칭 관찰자 시점","전지적 작가 시점","카메라 시점"]'::jsonb, 2, 'ACTIVE', 1),
  (71, 'major', 'quiz.campus.major_history_primary', '[사학과] 연구하려는 시대에 직접 만들어진 문서·유물·기록을 일반적으로 무엇이라 할까?', '["1차 사료","2차 사료","가설","각주"]'::jsonb, 0, 'ACTIVE', 1),
  (72, 'major', 'quiz.campus.major_philosophy_deduction', '[철학과] 일반적인 원리나 전제로부터 개별적인 결론을 이끌어 내는 추론 방식은?', '["귀납","연역","유추","회상"]'::jsonb, 1, 'ACTIVE', 1),
  (73, 'major', 'quiz.campus.major_china_pinyin', '[중국학과] 중국 표준어 발음을 로마자로 표기하는 대표 체계는?', '["한어병음(Pinyin)","한글 맞춤법","가나","키릴 문자"]'::jsonb, 0, 'ACTIVE', 1),
  (74, 'major', 'quiz.campus.major_japan_katakana', '[일본언어문화학과] 현대 일본어에서 외래어 표기에 흔히 쓰이는 문자는?', '["히라가나","가타카나","한글","키릴 문자"]'::jsonb, 1, 'ACTIVE', 1),
  (75, 'major', 'quiz.campus.major_europe_renaissance', '[영미유럽인문융합학부] 유럽사에서 고대 그리스·로마 문화의 재발견과 인문주의 확산으로 잘 알려진 시대는?', '["르네상스","구석기시대","청동기시대","냉전"]'::jsonb, 0, 'ACTIVE', 1),
  (76, 'major', 'quiz.campus.major_premed_homeostasis', '[의예과] 체온·혈당처럼 몸의 내부 환경을 일정 범위로 유지하려는 성질은?', '["항상성","삼투압","변이","광합성"]'::jsonb, 0, 'ACTIVE', 1),
  (77, 'major', 'quiz.campus.major_nursing_vitals', '[간호학과] 체온·맥박·호흡·혈압을 묶어 부르는 기본 관찰 항목은?', '["활력징후","혈액형","반사검사","체질량지수"]'::jsonb, 0, 'ACTIVE', 1),
  (78, 'major', 'quiz.campus.major_art_perspective', '[조형예술학과] 멀리 있는 대상을 더 작게 표현해 화면에 깊이감을 주는 대표 기법은?', '["원근법","점묘법","콜라주","데칼코마니"]'::jsonb, 0, 'ACTIVE', 1),
  (79, 'major', 'quiz.campus.major_design_usercentered', '[디자인융합학과] 제품·서비스를 설계할 때 사용자의 요구와 경험을 중심에 두는 접근은?', '["사용자 중심 디자인","무작위 디자인","생산자 독점 디자인","비가시적 디자인"]'::jsonb, 0, 'ACTIVE', 1),
  (80, 'major', 'quiz.campus.major_sports_vo2max', '[스포츠과학과] 심폐 지구력과 유산소 운동능력을 평가할 때 널리 쓰이는 지표는?', '["체질량지수","최대산소섭취량","악력만","키"]'::jsonb, 1, 'ACTIVE', 1),
  (81, 'major', 'quiz.campus.major_film_miseenscene', '[연극영화학과] 화면 속 세트·조명·의상·배우 배치 등을 종합해 장면을 구성하는 개념은?', '["미장센","몽타주율","프레임레이트","샘플링"]'::jsonb, 0, 'ACTIVE', 1),
  (82, 'major', 'quiz.campus.major_fashion_warp', '[의류디자인학과] 직물에서 세로 방향으로 놓이는 실을 무엇이라 할까?', '["씨실","날실","봉제선","시접"]'::jsonb, 1, 'ACTIVE', 1),
  (83, 'major', 'quiz.campus.major_mobility_lidar', '[스마트모빌리티공학과] 레이저 빛을 쏘고 돌아오는 시간을 이용해 주변 거리를 측정하는 센서는?', '["LiDAR","마이크","GPS 안테나만","스피커"]'::jsonb, 0, 'ACTIVE', 1),
  (84, 'major', 'quiz.campus.major_designtech_additive', '[디자인테크놀로지학과] 3D 프린팅처럼 재료를 층층이 쌓아 형상을 만드는 제조 방식은?', '["절삭가공","적층제조","주조만","단조만"]'::jsonb, 1, 'ACTIVE', 1),
  (85, 'major', 'quiz.campus.major_ibt_exchange', '[IBT학과] 한 나라의 통화와 다른 나라 통화를 서로 교환하는 비율을 무엇이라 할까?', '["환율","이자율","실업률","출산율"]'::jsonb, 0, 'ACTIVE', 1),
  (86, 'major', 'quiz.campus.major_ise_systems', '[ISE학과] 복잡한 시스템을 요구사항부터 설계·통합·검증까지 전체 관점에서 다루는 공학 접근은?', '["시스템 엔지니어링","문헌비평","순수회계","색채심리"]'::jsonb, 0, 'ACTIVE', 1),
  (87, 'major', 'quiz.campus.major_klc_particle', '[KLC학과] 한국어에서 ‘은/는’, ‘이/가’, ‘을/를’처럼 문법적 관계를 나타내는 품사는?', '["조사","감탄사","관형사","수사"]'::jsonb, 0, 'ACTIVE', 1),
  (88, 'major', 'quiz.campus.major_liberal_convergence', '[자유전공학부] 둘 이상의 학문 분야 지식과 방법을 연결해 문제를 바라보는 접근은?', '["융합적 접근","단일 암기","무작위 추측","자료 배제"]'::jsonb, 0, 'ACTIVE', 1),
  (89, 'major', 'quiz.campus.major_mechatronics_actuator', '[메카트로닉스공학과] 제어기의 명령을 받아 실제 움직임이나 힘을 만들어 내는 장치는?', '["센서","액추에이터","저항기","라우터"]'::jsonb, 1, 'ACTIVE', 1),
  (90, 'major', 'quiz.campus.major_sw_api', '[소프트웨어융합공학과] 서로 다른 소프트웨어가 기능이나 데이터를 주고받도록 정한 인터페이스를 흔히 무엇이라 할까?', '["API","DPI","RPM","pH"]'::jsonb, 0, 'ACTIVE', 1),
  (91, 'major', 'quiz.campus.major_indmgmt_productivity', '[산업경영학과] 일반적으로 생산성은 산출량을 무엇으로 나눈 값으로 생각할 수 있을까?', '["투입량","가격","세율","재고일수"]'::jsonb, 0, 'ACTIVE', 1),
  (92, 'major', 'quiz.campus.major_invest_bondrate', '[금융투자학과] 다른 조건이 같을 때 시장금리가 오르면 기존 고정금리 채권의 가격은 일반적으로 어떻게 될까?', '["오른다","내린다","항상 그대로다","반드시 0원이 된다"]'::jsonb, 1, 'ACTIVE', 1),
  (93, 'major', 'quiz.campus.major_semindustry_wafer', '[반도체산업융합학과] 집적회로를 만들 때 여러 칩을 한꺼번에 형성하는 얇은 반도체 원판은?', '["웨이퍼","플라이휠","터빈","필라멘트"]'::jsonb, 0, 'ACTIVE', 1),
  (94, 'major', 'quiz.campus.major_mechanical_torque', '[기계공학과] 물체를 회전시키려는 힘의 효과를 나타내는 물리량은?', '["토크","밀도","전압","조도"]'::jsonb, 0, 'ACTIVE', 1),
  (95, 'major', 'quiz.campus.major_chemical_hexchanger', '[화학공학과] 서로 다른 온도의 유체 사이에서 열을 전달하도록 설계한 대표 장치는?', '["열교환기","증폭기","정류기","안테나"]'::jsonb, 0, 'ACTIVE', 1),
  (96, 'major', 'quiz.campus.major_electrical_power', '[전기전자공학부] 직류 회로에서 전압 V와 전류 I를 알 때 전력 P를 구하는 기본 관계는?', '["P = V + I","P = V/I","P = VI","P = I − V"]'::jsonb, 2, 'ACTIVE', 1),
  (97, 'major', 'quiz.campus.major_math_integral', '[수학과] 미분과 밀접한 역관계에 있으며 넓이·누적량 계산에 쓰이는 연산은?', '["적분","나눗셈","인수분해만","순열"]'::jsonb, 0, 'ACTIVE', 1),
  (98, 'major', 'quiz.campus.major_cs_stack', '[컴퓨터공학과] 가장 나중에 넣은 데이터가 가장 먼저 나오는 LIFO 구조는?', '["큐","스택","그래프","해시함수"]'::jsonb, 1, 'ACTIVE', 1),
  (99, 'major', 'quiz.campus.major_ai_reinforcement', '[인공지능공학과] 에이전트가 환경에서 행동하고 보상을 받으며 전략을 학습하는 방식은?', '["강화학습","정렬 알고리즘","압축","암호화"]'::jsonb, 0, 'ACTIVE', 1),
  (100, 'major', 'quiz.campus.major_ccm_ip', '[문화콘텐츠문화경영학과] 콘텐츠 산업에서 IP는 일반적으로 무엇을 뜻할까?', '["지식재산(Intellectual Property)","인터넷 프로토콜만","재고회전율","금리정책"]'::jsonb, 0, 'ACTIVE', 1);

do $$
declare
  v_total bigint;
  v_active bigint;
  v_major bigint;
begin
  select count(*),
         count(*) filter (where status = 'ACTIVE'),
         count(*) filter (where category = 'major')
    into v_total, v_active, v_major
    from private.world_daily_quiz_questions;

  if v_total <> 100 or v_active <> 100 or v_major <> 74 then
    raise exception 'DAILY_QUIZ_100_POOL_POSTCONDITION_FAILED total=% active=% major=%',
      v_total, v_active, v_major;
  end if;

  if (select count(distinct position) from private.world_daily_quiz_questions) <> 100
     or (select min(position) from private.world_daily_quiz_questions) <> 1
     or (select max(position) from private.world_daily_quiz_questions) <> 100 then
    raise exception 'DAILY_QUIZ_100_POOL_POSITION_POSTCONDITION_FAILED';
  end if;
end
$$;
