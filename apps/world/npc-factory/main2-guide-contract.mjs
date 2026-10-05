import { BACK_GATE_FRAME } from '../src/back-gate-layout.js';

const guidePosition = BACK_GATE_FRAME.at(5.15, 2.35);

export const MAIN2_GUIDE_NPC = Object.freeze({
  id: 'main2_back_gate_guide_001',
  name: '후문 안내 학생',
  role: '인하대 학생 · 길찾기 안내',
  position: Object.freeze({ x: guidePosition.x, z: guidePosition.z }),
  interactionRadius: 2.2,
  releaseRadius: 4.2
});

export const MAIN2_GUIDE_APPEARANCE = Object.freeze({
  outfit_color: '#476b7f',
  accent_color: '#efc85a',
  skin_tone: 1,
  hair_color: '#2c2623',
  hair_style: 'short',
  outfit_style: 'jacket',
  accessory: 'backpack',
  presentation: 'male',
  height: 0.99
});

export const MAIN2_GUIDE_COPY = Object.freeze({
  signedOut: '로그인하면 길찾기 연습을 시작할 수 있어요.',
  locked: '정문에서 시작한 첫 캠퍼스 탐방을 먼저 마치고 와 주세요. 끝나면 여기서 길찾기를 같이 연습해요.',
  ready: '첫 탐방을 마쳤군요. 이번에는 지도를 이용해 5호관까지 가 볼까요? 목적지 설정과 자동이동을 한 번 연습해 봐요.',
  started: '좋아요. 지도를 열고 5호관을 목적지로 설정해 보세요.',
  complete: '이제 캠퍼스 길은 익숙해졌겠네요. 다음에는 원하는 곳을 직접 찍고 이동해 봐요.'
});
