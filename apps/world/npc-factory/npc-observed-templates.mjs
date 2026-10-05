// Local presentation only. No generated social facts, quests or rewards.
const rows = [
  ['study_01','academic','library,classroom','{topic} 좀 할까요?','좋아요. 잠깐 정리해요.','그럼 여기서 시작해요.'],
  ['study_02','academic','library,classroom','{topic} 어디까지 했어요?','아직 정리하는 중이에요.','저도 차근차근 해볼게요.'],
  ['study_03','academic','library','여기 자리 괜찮아요?','네. 책 보기 편해요.','잠깐 읽다 가야겠어요.'],
  ['study_04','academic','classroom','수업 자료 챙겼어요?','네. 다시 확인하고 있어요.','저도 한번 볼게요.'],
  ['study_05','academic','*','{topic} 생각이 나네요.','할 일을 적어두면 어때요?','좋아요. 잊기 전에 적을게요.'],
  ['study_06','academic','library','책 찾으러 왔어요?','네. 천천히 둘러보려고요.','저도 같이 둘러볼게요.'],
  ['study_07','academic','classroom','강의실 확인했어요?','네. 들어가기 전에 쉬고 있어요.','저도 잠깐 쉬어야겠어요.'],
  ['study_08','academic','*','{topic} 먼저 할까요?','한 가지씩 하면 되겠죠.','그럼 작은 것부터 해요.'],
  ['study_09','academic','library','조금 쉬었다 할까요?','좋아요. 눈이 피곤하네요.','잠깐 먼 곳을 봐요.'],
  ['study_10','academic','*','{topic} 메모해 뒀어요?','아직이요. 지금 적을게요.','저도 같이 정리할게요.'],
  ['food_01','food','student,backgate','{meal} 뭐가 좋을까요?','따뜻한 음식이 좋겠어요.','메뉴부터 보고 골라요.'],
  ['food_02','food','student,backgate','메뉴 정했어요?','조금 더 둘러보려고요.','천천히 골라요.'],
  ['food_03','food','backgate','카페 잠깐 들를까요?','좋아요. 메뉴 보고 골라요.','저는 따뜻한 걸로 할게요.'],
  ['food_04','food','student','식당 쪽 가볼까요?','네. 자리부터 봐요.','좋아요. 같이 가요.'],
  ['food_05','food','*','출출하지 않아요?','조금요. 뭐 먹을까 생각 중이에요.','저도 메뉴 고민 중이에요.'],
  ['food_06','food','backgate','어느 쪽부터 볼까요?','가까운 가게부터 봐요.','좋아요. 메뉴도 읽어봐요.'],
  ['food_07','food','student,backgate','{meal} 천천히 먹을까요?','네. 서두르지 말아요.','좋아요. 잠깐 쉬어요.'],
  ['food_08','food','dorm','간식 생각나네요.','저도요. 조금만 먹을까요?','뭐가 있는지 봐요.'],
  ['plan_01','plan','*','이따 뭐 할 거예요?','{plan} 생각 중이에요.','저도 일정 좀 봐야겠어요.'],
  ['plan_02','plan','*','{time} 시간이 금방 가네요.','할 일이 하나씩 생기네요.','잠깐 일정 정리해요.'],
  ['plan_03','plan','backgate','바로 돌아갈 거예요?','조금 쉬었다 가려고요.','저도 잠깐 쉬어갈게요.'],
  ['plan_04','plan','dorm','들어가기 전에 뭐 할까요?','{plan} 어떨까요?','좋아요. 시간부터 봐요.'],
  ['plan_05','plan','*','다음 일정 확인했어요?','지금 확인하려고요.','저도 같이 볼게요.'],
  ['plan_06','plan','student','여기서 잠깐 기다릴까요?','네. 일정 확인하고 있어요.','천천히 확인해요.'],
  ['department_01','department','*','{department} 공부는 어때요?','조금씩 익숙해지고 있어요.','차근차근 하면 되겠죠.'],
  ['department_02','department','*','{department} 자료 보고 있어요?','네. 메모하면서 보고 있어요.','정리해두면 좋겠네요.'],
  ['department_03','department','classroom,library','전공 공부할 때 메모해요?','네. 모르는 걸 적어둬요.','저도 그렇게 해볼게요.'],
  ['department_04','department','*','{interest} 얘기도 해볼까요?','좋아요. 잠깐 쉬면서요.','그럼 잠깐 쉬어요.'],
  ['department_05','department','student','동아리 게시판 볼까요?','네. 뭐가 있는지 궁금해요.','같이 둘러봐요.'],
  ['department_06','department','classroom','수업 사이에 좀 쉬어요?','네. 다음 일정 확인하면서요.','저도 잠깐 쉬려고요.'],
  ['rest_01','rest','pond','여기 잠깐 서 있을까요?','좋아요. 물가 보면서 쉬어요.','천천히 쉬다 가요.'],
  ['rest_02','rest','*','잠깐 쉬어갈까요?','좋아요. 조금만 쉬어요.','저도 숨 좀 돌릴게요.'],
  ['rest_03','rest','pond','사진 찍기 괜찮겠죠?','구도부터 한번 봐요.','조금 더 둘러볼게요.'],
  ['rest_04','rest','*','{time}에는 뭐가 좋아요?','{plan} 괜찮을 것 같아요.','저도 생각해 볼게요.'],
  ['rest_05','rest','pond','산책 조금 더 할까요?','좋아요. 천천히 걸어요.','잠깐 쉬었다 가요.'],
  ['rest_06','rest','dorm','하루 정리하고 있어요?','네. 할 일을 적고 있어요.','저도 하나씩 적어볼게요.'],
  ['place_01','place','library','정석은 둘러볼 게 많네요.','책장부터 천천히 볼까요?','좋아요. 조용히 둘러봐요.'],
  ['place_02','place','pond','인경호는 잠깐 쉬기 좋네요.','네. 물가가 잘 보여요.','조금 더 보고 가요.'],
  ['place_03','place','dorm','생활관 들어가면 뭐 해요?','{topic} 정리하려고요.','저도 일정 정리해야겠어요.'],
  ['place_04','place','backgate','후문 쪽 더 둘러볼까요?','네. 골목마다 다르네요.','천천히 보고 가요.']
];

// Authored informal equivalents: no generic suffix replacement that breaks Korean grammar.
const casual = [
  ['{topic} 좀 할까?','좋아. 잠깐 정리하자.','그럼 여기서 시작하자.'],
  ['{topic} 어디까지 했어?','아직 정리하는 중이야.','나도 차근차근 해볼게.'],
  ['여기 자리 괜찮아?','응. 책 보기 편해.','잠깐 읽다 가야겠다.'],
  ['수업 자료 챙겼어?','응. 다시 확인하고 있어.','나도 한번 볼게.'],
  ['{topic} 생각나네.','할 일을 적어두면 어때?','좋아. 잊기 전에 적을게.'],
  ['책 찾으러 왔어?','응. 천천히 둘러보려고.','나도 같이 둘러볼게.'],
  ['강의실 확인했어?','응. 들어가기 전에 쉬고 있어.','나도 잠깐 쉬어야겠다.'],
  ['{topic} 먼저 할까?','한 가지씩 하면 되겠지.','그럼 작은 것부터 하자.'],
  ['조금 쉬었다 할까?','좋아. 눈이 피곤하네.','잠깐 먼 곳을 보자.'],
  ['{topic} 메모해 뒀어?','아직. 지금 적을게.','나도 같이 정리할게.'],
  ['{meal} 뭐가 좋을까?','따뜻한 음식이 좋겠어.','메뉴부터 보고 고르자.'],
  ['메뉴 정했어?','조금 더 둘러보려고.','천천히 골라.'],
  ['카페 잠깐 들를까?','좋아. 메뉴 보고 고르자.','난 따뜻한 걸로 할게.'],
  ['식당 쪽 가볼까?','응. 자리부터 보자.','좋아. 같이 가자.'],
  ['출출하지 않아?','조금. 뭐 먹을까 생각 중이야.','나도 메뉴 고민 중이야.'],
  ['어느 쪽부터 볼까?','가까운 가게부터 보자.','좋아. 메뉴도 읽어보자.'],
  ['{meal} 천천히 먹을까?','응. 서두르지 말자.','좋아. 잠깐 쉬자.'],
  ['간식 생각나네.','나도. 조금만 먹을까?','뭐가 있는지 보자.'],
  ['이따 뭐 할 거야?','{plan} 생각 중이야.','나도 일정 좀 봐야겠다.'],
  ['{time} 시간이 금방 가네.','할 일이 하나씩 생기네.','잠깐 일정 정리하자.'],
  ['바로 돌아갈 거야?','조금 쉬었다 가려고.','나도 잠깐 쉬어갈게.'],
  ['들어가기 전에 뭐 할까?','{plan} 어때?','좋아. 시간부터 보자.'],
  ['다음 일정 확인했어?','지금 확인하려고.','나도 같이 볼게.'],
  ['여기서 잠깐 기다릴까?','응. 일정 확인하고 있어.','천천히 확인해.'],
  ['{department} 공부는 어때?','조금씩 익숙해지고 있어.','차근차근 하면 되겠지.'],
  ['{department} 자료 보고 있어?','응. 메모하면서 보고 있어.','정리해두면 좋겠네.'],
  ['전공 공부할 때 메모해?','응. 모르는 걸 적어둬.','나도 그렇게 해볼게.'],
  ['{interest} 얘기도 해볼까?','좋아. 잠깐 쉬면서.','그럼 잠깐 쉬자.'],
  ['동아리 게시판 볼까?','응. 뭐가 있는지 궁금해.','같이 둘러보자.'],
  ['수업 사이에 좀 쉬어?','응. 다음 일정 확인하면서.','나도 잠깐 쉬려고.'],
  ['여기 잠깐 서 있을까?','좋아. 물가 보면서 쉬자.','천천히 쉬다 가자.'],
  ['잠깐 쉬어갈까?','좋아. 조금만 쉬자.','나도 숨 좀 돌릴게.'],
  ['사진 찍기 괜찮겠지?','구도부터 한번 보자.','조금 더 둘러볼게.'],
  ['{time}에는 뭐가 좋아?','{plan} 괜찮을 것 같아.','나도 생각해 볼게.'],
  ['산책 조금 더 할까?','좋아. 천천히 걷자.','잠깐 쉬었다 가자.'],
  ['하루 정리하고 있어?','응. 할 일을 적고 있어.','나도 하나씩 적어볼게.'],
  ['정석은 둘러볼 게 많네.','책장부터 천천히 볼까?','좋아. 조용히 둘러보자.'],
  ['인경호는 잠깐 쉬기 좋네.','응. 물가가 잘 보여.','조금 더 보고 가자.'],
  ['생활관 들어가면 뭐 해?','{topic} 정리하려고.','나도 일정 정리해야겠다.'],
  ['후문 쪽 더 둘러볼까?','응. 골목마다 다르네.','천천히 보고 가자.']
];
export const OBSERVED_TEMPLATES = Object.freeze(rows.map(([id, category, places, ...formal], i) =>
  Object.freeze({ conversation_id: id, category, places: places.split(','), formal, casual: casual[i] })));

const periods = {
  morning: { time: '아침', topic: '첫 수업 준비', meal: '아침', plan: '수업 준비' },
  lunch: { time: '점심', topic: '다음 수업 준비', meal: '점심', plan: '점심 먹기' },
  class_time: { time: '오후', topic: '강의 복습', meal: '간식', plan: '과제 정리' },
  evening: { time: '저녁', topic: '남은 과제', meal: '저녁', plan: '귀가 준비' },
  night: { time: '밤', topic: '내일 일정', meal: '간식', plan: '하루 마무리' }
};
const interests = { music: '음악', film: '영화', photography: '사진', coding: '코딩',
  gaming: '게임', reading: '독서', sports: '운동', travel: '여행', art: '미술' };
export function observedPlace(location = '') {
  if (/jungseok/.test(location)) return 'library';
  if (/student.center/.test(location)) return 'student';
  if (/back.(gate|market)/.test(location)) return 'backgate';
  if (/dorm/.test(location)) return 'dorm';
  if (/class_|building|main.hall/.test(location)) return 'classroom';
  if (/inkyung/.test(location)) return 'pond';
  return null;
}
export function renderObservedTemplate(template, members, { period, tone }) {
  const slots = { ...(periods[period] ?? periods.class_time),
    department: members[1].department || '전공',
    interest: interests[members[1].interests?.[0]] ?? '관심 있는 활동' };
  const lines = (tone === 'low' ? template.formal : template.casual).map((text, i) => ({
    npcId: members[i === 1 ? 1 : i === 2 && members.length === 3 ? 2 : 0].id,
    text: text.replace(/\{(\w+)\}/g, (_, key) => slots[key])
  }));
  // Familiarity is evidenced by the existing graph; it never invents shared history.
  if (tone === 'high') lines[0].text = `있잖아, ${lines[0].text}`;
  return lines;
}
