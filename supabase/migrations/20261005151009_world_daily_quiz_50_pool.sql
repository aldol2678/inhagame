-- INHA WORLD Daily Quiz: expand the ACTIVE pool from 16 to 50.
-- Adds 24 introductory department questions, 8 general-knowledge questions,
-- and 2 INHA history questions. Existing 16 gameplay/campus questions stay unchanged.

insert into private.world_daily_quiz_questions
  (position, category, question_id, prompt, options, correct_index, status, version)
values
  (17, 'major', 'quiz.campus.major_mechanical_newton', '[기계공학과] 뉴턴의 제2법칙에서 질량 m인 물체에 가속도 a가 생길 때 힘 F는?', '["F = ma","F = m/a","F = a/m","F = mv"]'::jsonb, 0, 'ACTIVE', 1),
  (18, 'major', 'quiz.campus.major_aerospace_lift', '[항공우주공학과] 비행기 날개가 비행 중 위쪽으로 받는 대표적인 공기역학적 힘은?', '["항력","양력","추력","중력"]'::jsonb, 1, 'ACTIVE', 1),
  (19, 'major', 'quiz.campus.major_ship_buoyancy', '[조선해양공학과] 배가 물에 뜨는 현상을 가장 직접적으로 설명하는 힘은?', '["마찰력","탄성력","부력","구심력"]'::jsonb, 2, 'ACTIVE', 1),
  (20, 'major', 'quiz.campus.major_industrial_bottleneck', '[산업경영공학과] 생산 공정에서 전체 처리속도를 가장 크게 제한하는 단계를 무엇이라 할까?', '["표준공정","병목공정","유휴공정","병렬공정"]'::jsonb, 1, 'ACTIVE', 1),
  (21, 'major', 'quiz.campus.major_chemical_distillation', '[화학공학과] 액체 혼합물을 끓는점 차이를 이용해 분리하는 대표 공정은?', '["여과","증류","흡착","침전"]'::jsonb, 1, 'ACTIVE', 1),
  (22, 'major', 'quiz.campus.major_polymer_monomer', '[고분자공학과] 고분자를 이루는 반복 구조의 출발 단위가 되는 작은 분자를 무엇이라 할까?', '["단량체","전해질","촉매","결정립"]'::jsonb, 0, 'ACTIVE', 1),
  (23, 'major', 'quiz.campus.major_materials_properties', '[신소재공학과] 재료의 구조·조성과 기계적·전기적 성질의 관계를 다루는 분야에 가장 가까운 것은?', '["재료과학","천문학","언어학","생태학"]'::jsonb, 0, 'ACTIVE', 1),
  (24, 'major', 'quiz.campus.major_civil_structure', '[사회인프라공학과] 교량이나 건물이 하중을 받아도 안전한지 계산하는 기초 분야는?', '["구조역학","광학","열역학","유전학"]'::jsonb, 0, 'ACTIVE', 1),
  (25, 'major', 'quiz.campus.major_environment_bod', '[환경공학과] 물의 유기물 오염 정도를 간접적으로 나타내는 대표 수질 지표 BOD는 무엇의 약자일까?', '["생물화학적 산소요구량","기압 변화량","염분 농도","부유물 총질량"]'::jsonb, 0, 'ACTIVE', 1),
  (26, 'major', 'quiz.campus.major_geoinfo_gnss', '[공간정보공학과] 인공위성 신호를 이용해 지구상의 위치를 계산하는 위성항법 체계의 일반 명칭은?', '["GNSS","HTTP","OLED","CAD"]'::jsonb, 0, 'ACTIVE', 1),
  (27, 'major', 'quiz.campus.major_archeng_concrete', '[건축학부·건축공학 영역] 철근콘크리트에서 철근이 주로 보완하는 콘크리트의 약점은?', '["낮은 압축강도","낮은 인장강도","높은 밀도","높은 내화성"]'::jsonb, 1, 'ACTIVE', 1),
  (28, 'major', 'quiz.campus.major_arch_plan', '[건축학부·건축학 영역] 건물을 수평으로 잘라 위에서 내려다본 공간 배치 도면은?', '["입면도","단면도","배치도","평면도"]'::jsonb, 3, 'ACTIVE', 1),
  (29, 'major', 'quiz.campus.major_electrical_ohm', '[전기전자공학부] 전압 V, 전류 I, 저항 R의 관계를 나타내는 옴의 법칙은?', '["V = IR","V = I/R","V = R/I","V = I + R"]'::jsonb, 0, 'ACTIVE', 1),
  (30, 'major', 'quiz.campus.major_semiconductor_doping', '[반도체시스템공학과] 순수 반도체에 소량의 불순물을 넣어 전기적 특성을 조절하는 과정은?', '["도핑","증류","소결","도금"]'::jsonb, 0, 'ACTIVE', 1),
  (31, 'major', 'quiz.campus.major_battery_secondary', '[이차전지융합학과] 충전하여 여러 번 반복 사용하도록 설계된 전지를 무엇이라 할까?', '["일차전지","이차전지","연료전지","태양전지"]'::jsonb, 1, 'ACTIVE', 1),
  (32, 'major', 'quiz.campus.major_math_derivative', '[수학과] 함수의 한 점에서 순간적인 변화율을 나타내는 개념은?', '["적분","미분계수","행렬식","공약수"]'::jsonb, 1, 'ACTIVE', 1),
  (33, 'major', 'quiz.campus.major_statistics_median', '[통계학과] 극단적으로 큰 값 하나가 추가될 때 평균보다 일반적으로 덜 민감한 대표값은?', '["분산","표준편차","중앙값","최댓값"]'::jsonb, 2, 'ACTIVE', 1),
  (34, 'major', 'quiz.campus.major_physics_force_unit', '[물리학과] 국제단위계(SI)에서 힘의 단위는?', '["줄","와트","파스칼","뉴턴"]'::jsonb, 3, 'ACTIVE', 1),
  (35, 'major', 'quiz.campus.major_chemistry_ph', '[화학과] 25℃ 부근의 수용액에서 pH가 7보다 작은 용액은 일반적으로 어떤 성질을 띨까?', '["산성","중성","염기성","항상 포화 상태"]'::jsonb, 0, 'ACTIVE', 1),
  (36, 'major', 'quiz.campus.major_ocean_tide', '[해양과학과] 지구의 조석 현상에 가장 큰 영향을 주는 천체는?', '["달","화성","금성","목성"]'::jsonb, 0, 'ACTIVE', 1),
  (37, 'major', 'quiz.campus.major_cs_algorithm', '[컴퓨터공학과] 어떤 문제를 해결하기 위한 명확하고 유한한 절차를 무엇이라 할까?', '["알고리즘","컴파일러","데이터베이스","프로토콜"]'::jsonb, 0, 'ACTIVE', 1),
  (38, 'major', 'quiz.campus.major_ai_supervised', '[인공지능공학과] 입력과 정답 라벨이 함께 주어진 데이터로 학습하는 방식은?', '["지도학습","비지도학습","무작위 탐색","압축"]'::jsonb, 0, 'ACTIVE', 1),
  (39, 'major', 'quiz.campus.major_data_overfit', '[데이터사이언스학과] 학습 데이터에서는 성능이 높지만 새로운 데이터에서는 성능이 크게 떨어지는 현상은?', '["정규화","과적합","샘플링","시각화"]'::jsonb, 1, 'ACTIVE', 1),
  (40, 'major', 'quiz.campus.major_ccm_osmu', '[문화콘텐츠문화경영학과] 하나의 원천 콘텐츠를 영화·게임·굿즈 등 여러 형태로 확장 활용하는 전략은?', '["OSMU","FIFO","HTTP","RGB"]'::jsonb, 0, 'ACTIVE', 1),
  (41, 'general', 'quiz.campus.general_binary_digits', '컴퓨터에서 사용하는 2진법의 기본 숫자 두 개는?', '["0과 1","1과 2","2와 3","8과 9"]'::jsonb, 0, 'ACTIVE', 1),
  (42, 'general', 'quiz.campus.general_dna_bases', 'DNA를 구성하는 네 종류의 염기로 옳은 조합은?', '["A·T·G·C","A·U·G·C","A·T·X·Y","G·C·Na·Cl"]'::jsonb, 0, 'ACTIVE', 1),
  (43, 'general', 'quiz.campus.general_hangul_king', '훈민정음 창제를 주도한 조선의 왕은?', '["태조","세종","정조","고종"]'::jsonb, 1, 'ACTIVE', 1),
  (44, 'general', 'quiz.campus.general_equator_latitude', '적도의 위도는 몇 도일까?', '["0도","23.5도","45도","90도"]'::jsonb, 0, 'ACTIVE', 1),
  (45, 'general', 'quiz.campus.general_water_formula', '물의 화학식은?', '["CO₂","O₂","H₂O","NaCl"]'::jsonb, 2, 'ACTIVE', 1),
  (46, 'general', 'quiz.campus.general_red_planet', '태양계에서 흔히 ‘붉은 행성’이라 불리는 행성은?', '["수성","금성","화성","토성"]'::jsonb, 2, 'ACTIVE', 1),
  (47, 'general', 'quiz.campus.general_light_speed', '진공에서 빛의 속도에 가장 가까운 값은?', '["초속 약 300 km","초속 약 3,000 km","초속 약 30,000 km","초속 약 300,000 km"]'::jsonb, 3, 'ACTIVE', 1),
  (48, 'general', 'quiz.campus.general_photosynthesis', '식물이 광합성을 통해 빛에너지를 화학에너지로 저장할 때 주로 만들어 내는 유기물은?', '["포도당","질소","철","염화나트륨"]'::jsonb, 0, 'ACTIVE', 1),
  (49, 'inha', 'quiz.campus.inha_name_origin', '‘인하’라는 교명은 어떤 두 지명의 이름에서 유래했을까?', '["인천과 하와이","인천과 하노이","인제와 하와이","인천과 하얼빈"]'::jsonb, 0, 'ACTIVE', 1),
  (50, 'inha', 'quiz.campus.inha_opened_year', '인하대학교의 전신인 인하공과대학이 개교한 해는?', '["1945년","1950년","1954년","1960년"]'::jsonb, 2, 'ACTIVE', 1);

do $$
declare
  v_total bigint;
  v_active bigint;
  v_major bigint;
  v_general bigint;
  v_inha bigint;
begin
  select count(*),
         count(*) filter (where status = 'ACTIVE'),
         count(*) filter (where category = 'major'),
         count(*) filter (where category = 'general'),
         count(*) filter (where category = 'inha')
    into v_total, v_active, v_major, v_general, v_inha
    from private.world_daily_quiz_questions;

  if v_total <> 50 or v_active <> 50 or v_major <> 24 or v_general <> 8 or v_inha <> 2 then
    raise exception 'DAILY_QUIZ_50_POOL_POSTCONDITION_FAILED total=% active=% major=% general=% inha=%',
      v_total, v_active, v_major, v_general, v_inha;
  end if;

  if (select count(distinct position) from private.world_daily_quiz_questions) <> 50
     or (select min(position) from private.world_daily_quiz_questions) <> 1
     or (select max(position) from private.world_daily_quiz_questions) <> 50 then
    raise exception 'DAILY_QUIZ_50_POOL_POSITION_POSTCONDITION_FAILED';
  end if;
end
$$;
