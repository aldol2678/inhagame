// Presentation only: no curriculum, progress store, Auth, RPC or learning engine.
export const LEARNING_LAUNCHER_RELEASE = Object.freeze({enabled:false});
export function createLearningLauncher({enabled=LEARNING_LAUNCHER_RELEASE.enabled,doc=globalThis.document,onReturn=()=>{}}={}) {
  let host=null,disposed=false;
  function unmount(){host?.replaceChildren();host=null;}
  return Object.freeze({
    available:()=>!disposed&&enabled===true,
    mount(target){
      if(disposed||enabled!==true)return false;
      unmount();host=target;
      const card=doc.createElement('section');card.className='smartphone-learning-launcher';
      const title=doc.createElement('h2');title.textContent='인덕캠퍼스';
      const description=doc.createElement('p');description.textContent='영어 학습과 복습을 독립 학습 사이트에서 이어가세요.';
      const link=doc.createElement('a');link.href='/learn/';link.target='_blank';link.rel='noopener noreferrer';link.textContent='웹 학습 시작';
      const note=doc.createElement('p');note.textContent='새 탭에서 열립니다. 학습을 마치면 이 게임 탭으로 돌아오세요. 같은 탭으로 이동하면 게임을 다시 불러와야 할 수 있어요.';
      const back=doc.createElement('button');back.type='button';back.textContent='게임으로 돌아가기';back.addEventListener('click',onReturn);
      card.append(title,description,link,note,back);host.replaceChildren(card);return true;
    },
    unmount,setAccount:unmount,dispose(){unmount();disposed=true;}
  });
}
