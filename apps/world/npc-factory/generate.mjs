import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DISTRIBUTION, FORBIDDEN_CAPABILITIES, PERIODS} from './vocabulary.mjs';
import {validateBatch} from './validate.mjs';

// Fictional population profiles; no real student, faculty, or employee data is used.
const surnames = ['가', '나', '도', '라', '마', '바', '서', '우', '이', '주', '차', '하'];
const given = ['나율', '도윤', '라온', '민서', '보민', '서안', '수현', '유담', '이든', '지안', '태린', '하람'];
const names = surnames.flatMap(s => given.map(g => s + g));
const interests = ['reading', 'photography', 'music', 'coffee', 'sketching', 'walking', 'film', 'plants', 'design', 'coding', 'languages', 'birdwatching', 'cooking', 'cycling', 'architecture'];
const traits = ['curious', 'calm', 'cheerful', 'thoughtful', 'patient', 'wry', 'practical', 'gentle', 'focused', 'playful', 'cautious', 'generous'];
const departments = ['humanities', 'social_sciences', 'engineering', 'natural_sciences', 'arts'];
const tags = ['observant', 'reserved', 'outgoing', 'reader', 'photographer', 'coffee_fan', 'club_goer', 'helpful', 'commuter', 'music_fan', 'routine_oriented', 'slow_paced'];
const locationPools = {
  morning: ['inkyung_spawn', 'inkyung_bench_east', 'inkyung_bench_west', 'inkyung_walkway', 'inkyung_waterfront', 'inkyung_photo_point', 'transit_to_main_hall', 'transit_to_building', 'transit_to_student_center', 'off_zone'],
  class_time: ['transit_to_building', 'transit_to_main_hall', 'inkyung_walkway', 'inkyung_bench_east', 'inkyung_bench_west', 'inkyung_waterfront', 'inkyung_spawn', 'off_zone', 'transit_to_student_center', 'inkyung_photo_point'],
  lunch: ['inkyung_bench_east', 'inkyung_bench_west', 'inkyung_walkway', 'inkyung_waterfront', 'inkyung_photo_point', 'inkyung_spawn', 'transit_to_student_center', 'transit_to_main_hall', 'transit_to_building', 'off_zone'],
  evening: ['off_zone', 'off_zone', 'inkyung_walkway', 'inkyung_bench_east', 'inkyung_bench_west', 'inkyung_waterfront', 'transit_to_main_hall', 'transit_to_student_center', 'transit_to_building', 'inkyung_photo_point']
};
const activities = {
  inkyung_spawn: ['idle', 'wait', 'use_phone'], inkyung_bench_east: ['sit', 'read', 'use_phone'], inkyung_bench_west: ['sit', 'read', 'drink_coffee'],
  inkyung_walkway: ['walk', 'listen_to_music', 'talk_with_friend'], inkyung_waterfront: ['walk', 'read', 'drink_coffee'],
  inkyung_photo_point: ['take_photo', 'wait', 'use_phone'], transit_to_main_hall: ['walk_to_class', 'walk', 'leave_zone'],
  transit_to_student_center: ['walk', 'walk_to_club', 'leave_zone'], transit_to_building: ['walk_to_class', 'walk', 'leave_zone'],
  off_zone: ['leave_zone']
};
const locationLines = {
  inkyung_spawn: ['인경호 입구가 오늘은 차분하네요.', '인경호 쪽에서 잠깐 숨을 고르고 있어요.', '입구에서 사람 흐름을 보고 있어요.'],
  inkyung_bench_east: ['동쪽 벤치가 잠시 쉬기 좋네요.', '이 벤치에 앉으면 생각이 정리돼요.', '동쪽 벤치에는 바람이 가볍게 와요.'],
  inkyung_bench_west: ['서쪽 벤치에서 쉬어 가고 있어요.', '이 벤치가 오늘은 조용하네요.', '서쪽 벤치에 잠깐 앉았어요.'],
  inkyung_walkway: ['산책로를 따라 천천히 걷고 있어요.', '이 길은 걸음 속도를 늦추게 해요.', '산책로 쪽으로 발길이 가네요.'],
  inkyung_waterfront: ['호수 물가를 보니 마음이 가라앉아요.', '인경호 물가에 잠깐 머물렀어요.', '호수 옆 공기가 시원하네요.'],
  inkyung_photo_point: ['사진 포인트에서 구도를 살펴봐요.', '여기 사진 포인트는 빛이 재미있어요.', '사진 한 장 찍고 지나갈까 해요.'],
  transit_to_main_hall: ['본관 쪽으로 이동하는 길이에요.', '본관 방향으로 걸어가고 있어요.', '이제 본관 쪽으로 이동해요.'],
  transit_to_student_center: ['학생회관 쪽으로 이동 중이에요.', '학생회관 방향으로 걸음을 옮겨요.', '이제 학생회관 쪽으로 이동해요.'],
  transit_to_building: ['건물 쪽으로 이동하는 중이에요.', '다음 건물로 걸어가고 있어요.', '건물 방향으로 발길을 돌려요.'],
  off_zone: ['이제 이 구역 밖으로 나가요.', '잠깐 자리를 떠났어요. 나중에 봐요.', '오늘은 이만 떠나요. 나중에 만나요.']
};
const activityLines = {
  idle: ['잠깐 가만히 서서 쉬어요.', '여기서 조금 멈춰 있을게요.'], walk: ['걸으면서 생각을 정리해요.', '천천히 걷는 중이에요.'],
  sit: ['잠깐 앉아 쉬어야겠어요.', '앉아서 숨을 고르고 있어요.'], drink_coffee: ['커피를 한 모금 마시고 있어요.', '커피가 아직 따뜻하네요.'],
  use_phone: ['휴대폰으로 메모를 확인해요.', '휴대폰 화면을 잠깐 보고 있어요.'], read: ['읽던 글의 다음 문장이 궁금해요.', '짧은 글을 읽는 중이에요.'],
  talk_with_friend: ['친구와 짧게 이야기를 나눠요.', '친구 말을 듣고 있어요.'], take_photo: ['지금 사진 한 장 찍어 볼게요.', '사진 구도를 조금 바꿔 봐요.'],
  listen_to_music: ['음악 한 곡을 듣고 있어요.', '이어폰으로 조용히 음악을 들어요.'], eat_snack: ['간식을 조금 먹고 있어요.', '작은 간식으로 기운을 내요.'],
  wait: ['잠깐 기다리는 중이에요.', '조금만 더 기다려 볼게요.'], walk_to_class: ['수업 쪽으로 발걸음을 옮겨요.', '수업에 맞춰 걸어가는 중이에요.'],
  walk_to_club: ['동아리 쪽으로 걸어가요.', '동아리 모임 장소로 이동해요.'], leave_zone: ['이제 이 구역을 떠나요.', '다음에 또 들를게요.']
};
const interestLines = {
  reading: '읽던 글 한 줄이 자꾸 떠올라요.', photography: '빛이 바뀌는 순간이 눈에 들어와요.', music: '아까 들은 멜로디가 맴돌아요.',
  coffee: '커피 향이 아직 남아 있네요.', sketching: '작은 풍경을 스케치하고 싶어요.', walking: '걷다 보면 생각이 정돈돼요.',
  film: '어제 본 영화 장면을 다시 생각해요.', plants: '길가의 잎 모양이 눈에 들어와요.', design: '모양과 색 배치를 살펴보게 돼요.',
  coding: '막혔던 코드 흐름이 문득 풀릴 것 같아요.', languages: '새로 배운 표현을 머릿속으로 되뇌어요.',
  birdwatching: '새소리가 들리면 잠깐 귀를 기울여요.', cooking: '오늘 먹을 간단한 음식을 떠올려요.',
  cycling: '자전거 타기 좋은 바람이네요.', architecture: '건물의 선을 따라 시선이 가요.'
};
const timeLines = {
  morning: ['아침에는 천천히 시작하는 편이에요.', '아침 공기가 아직 차분하네요.', '아침에는 잠깐 여유를 두고 싶어요.'],
  class_time: ['수업 시간이라 주변 발걸음이 달라졌네요.', '수업 시간에는 흐름을 따라 움직여요.', '수업 시간에는 조금 조용해져요.'],
  lunch: ['점심 무렵에는 잠깐 쉬어 가요.', '점심 시간이 되니 숨을 돌리게 돼요.', '점심에는 걸음이 느려지네요.'],
  evening: ['저녁에는 하루를 천천히 접어요.', '저녁 공기가 조금 달라졌어요.', '저녁에는 말수가 줄어드는 편이에요.']
};

function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; }; }
function pick(items, random) { return items[Math.floor(random() * items.length)]; }
function shuffle(items, random) { const copy = [...items]; for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; }
function uniquePick(items, n, random) { return shuffle(items, random).slice(0, n); }
function id(i) { return `INKYUNG-NPC-${String(i + 1).padStart(3, '0')}`; }

export function generateBatch(letter) {
  if (!['A', 'B', 'C'].includes(letter)) throw new Error('Batch must be A, B, or C');
  const random = rng({A: 0x491a72, B: 0x8db347, C: 0xc06ee1}[letter]);
  const types = shuffle(Object.entries(DISTRIBUTION).flatMap(([type, count]) => Array(count).fill(type)), random);
  const nameStart = {A: 0, B: 48, C: 96}[letter];
  const batchNames = shuffle(names.slice(nameStart, nameStart + 20), random);
  const slotsByPeriod = Object.fromEntries(PERIODS.map(period => [period, shuffle([...locationPools[period], ...locationPools[period]], random)]));
  const npcs = types.map((archetype, i) => {
    const chosenInterests = uniquePick(interests, 2 + (i % 4 === 0 ? 1 : 0), random);
    const chosenTraits = uniquePick(traits, 2 + (i % 5 === 0 ? 1 : 0), random);
    const energy = Math.round((0.25 + random() * 0.65) * 100) / 100;
    const profile = {
      npc_id: id(i), archetype,
      identity: {name: batchNames[i], age_band: ['student', 'club_member'].includes(archetype) ? pick(['early_20s', 'mid_20s'], random) : pick(['late_20s', '30s', '40s', '50s_plus'], random), department_type: archetype === 'staff' ? 'administration' : archetype === 'shop_worker' ? 'campus_service' : pick(departments, random), year_level: ['student', 'club_member'].includes(archetype) ? 1 + Math.floor(random() * 4) : null},
      personality: {traits: chosenTraits, social_energy: energy, talkativeness: Math.round((0.2 + random() * 0.7) * 100) / 100, routine_preference: Math.round((0.2 + random() * 0.7) * 100) / 100},
      speech: {tone: energy > 0.72 ? pick(['warm', 'lighthearted', 'casual_polite'], random) : pick(['reserved', 'crisp', 'casual_polite', 'warm'], random), tempo: energy > 0.72 ? pick(['normal', 'quick'], random) : pick(['slow', 'normal'], random), quirks: uniquePick(['short_sentences', 'soft_questions', 'dry_humor', 'precise_words', 'gentle_pauses'], i % 3 === 0 ? 1 : 0, random)},
      interests: chosenInterests, home_zone: 'C04_INKYUNG', schedule: {}, relationships: [], dialogue_hooks: {},
      behavior_tags: uniquePick(tags, 2, random), constraints: Object.fromEntries(FORBIDDEN_CAPABILITIES.map(key => [key, false]))
    };
    for (const period of PERIODS) {
      const location = slotsByPeriod[period][i];
      const activity = pick(activities[location], random);
      const social_mode = energy > 0.65 && i % 5 === 0 && !['off_zone'].includes(location) ? 'high' : energy < 0.4 || location === 'off_zone' ? 'low' : 'medium';
      profile.schedule[period] = {location, activity, social_mode};
      const first = `${pick(locationLines[location], random)} ${pick(activityLines[activity], random)}`;
      const second = `${pick(timeLines[period], random)} ${interestLines[chosenInterests[(PERIODS.indexOf(period) + i) % chosenInterests.length]]}`;
      profile.dialogue_hooks[period] = [first, second];
    }
    return profile;
  });
  // Relationship choices are made afresh within each batch. Persistent mutation is forbidden.
  function pair(a, b, type) { npcs[a].relationships.push({target_id: id(b), type}); npcs[b].relationships.push({target_id: id(a), type}); }
  const students = npcs.map((n, i) => [n, i]).filter(([n]) => n.archetype === 'student').map(([, i]) => i);
  const club = npcs.map((n, i) => [n, i]).filter(([n]) => n.archetype === 'club_member').map(([, i]) => i);
  const shops = npcs.map((n, i) => [n, i]).filter(([n]) => n.archetype === 'shop_worker').map(([, i]) => i);
  pair(students[0], students[1], 'friend'); pair(club[0], club[1], 'clubmate'); pair(shops[0], shops[1], 'coworker');
  npcs[students[2]].relationships.push({target_id: id(club[2]), type: 'acquaintance'});
  return {batch_id: `INKYUNG-20-${letter}`, schema_version: '0.1', zone: 'C04_INKYUNG', npc_count: 20, npcs};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  for (const letter of ['A', 'B', 'C']) {
    const start = performance.now();
    const batch = generateBatch(letter);
    const rawPath = path.join(root, 'data', 'raw', `INKYUNG-20-${letter}.json`);
    const validPath = path.join(root, 'data', 'validated', `INKYUNG-20-${letter}.json`);
    fs.mkdirSync(path.dirname(rawPath), {recursive: true}); fs.mkdirSync(path.dirname(validPath), {recursive: true});
    fs.writeFileSync(rawPath, JSON.stringify(batch, null, 2) + '\n', {flag: 'wx'});
    const result = validateBatch(JSON.parse(fs.readFileSync(rawPath, 'utf8')));
    if (result.status !== 'PASS') { console.error(`${letter}: RAW FAIL\n${result.errors.join('\n')}`); process.exitCode = 1; continue; }
    fs.copyFileSync(rawPath, validPath, fs.constants.COPYFILE_EXCL);
    console.log(`${letter}: RAW PASS → VALIDATED PASS; ${batch.npcs.length} NPC; ${Math.round(performance.now() - start)} ms; no repairs`);
  }
}
