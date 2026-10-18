import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}

function gamesFrom(data){
if(data.schemaVersion!==1||!Array.isArray(data.games))throw Error("Catalog version");
const allowed={"classic":"duck.inhagame.app","induckup":"induckup.inhagame.app","survival":"survival.inhagame.app","induck-grow":"grow.inhagame.app"};
const seen=new Set();
return data.games.filter(g=>g.id!=="campus").map(g=>{
 if(!g||!/^[a-z0-9-]+$/.test(g.id)||seen.has(g.id))throw Error("Duplicate or unsafe ID");
 seen.add(g.id);
 if(!g.title||g.title.length>60||!g.description||g.description.length>160||!Number.isInteger(g.sortOrder))throw Error("Invalid copy");
 if(!g.platform||!["아케이드","액션","시뮬레이션","퍼즐","전략","RPG","기타"].includes(g.platform.genre)||typeof g.platform.label!=="string"||g.platform.label.length>30||g.platform.coverImage!=="/assets/hub/"+g.id+"-concept.svg")throw Error("Invalid cover/genre");
 if(!["playable","planned"].includes(g.status))throw Error("Invalid status");
 if(g.status==="playable" && (g.playUrl!=="https://"+allowed[g.id]+"/"))throw Error("Unapproved play URL");
 if(g.status==="planned" && g.playUrl!=null)throw Error("Planned game has play URL");
 return g;
}).sort((a,b)=>a.sortOrder-b.sortOrder);
}

function head(title,desc,path,ld){
let absolute="https://inhagame.app"+path,icon="https://inhagame.app/campus/icons/icon-512.png";
return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f2ec"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"><meta name="robots" content="max-image-preview:large">
<link rel="canonical" href="${absolute}">
<meta property="og:type" content="website"><meta property="og:site_name" content="INHA WORLD">
<meta property="og:locale" content="ko_KR"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${absolute}">
<meta property="og:image" content="${icon}"><meta property="og:image:alt" content="인하월드 앱 아이콘">
<meta property="og:image:width" content="512"><meta property="og:image:height" content="512">
<meta name="twitter:card" content="summary">
<link rel="icon" type="image/png" sizes="32x32" href="/campus/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/campus/icons/icon-192.png">
<link rel="stylesheet" href="/arcade/arcade.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g,"\\u003c")}</script>`;
}

function wrap(meta,inner){
return `<!doctype html><html lang="ko"><head>${meta}</head><body><a class="skip" href="#main">본문으로 이동</a>
<header class="header"><div class="container head-inner"><a class="brand" href="/">INHA WORLD <small>인덕 아케이드</small></a>
<nav aria-label="주 메뉴"><a href="/arcade/">전체 게임</a><a href="/campus/">캠퍼스</a><a href="/updates.html">소식</a><a href="/support.html">도움말</a></nav></div></header>
<main id="main" class="container">${inner}</main><footer><div class="container"><a href="/">인하월드 홈</a><a href="/privacy.html">개인정보처리방침</a><a href="/terms.html">이용약관</a><p>INHA WORLD는 인하대학교가 공식적으로 제작·운영·후원하는 서비스가 아닌 학생 창작 프로젝트입니다.</p></div></footer>
</body></html>\n`;
}

function collection(gs){
const title="인덕 아케이드 | 인하월드 게임 모음 · INHA WORLD",desc="인하월드의 웹게임을 한곳에서 만나보세요. 인하오리 Classic, 인덕업, 인덕 서바이벌, 인덕이 키우기 등 게임 소개와 플레이 링크를 제공합니다.";
const ld={"@context":"https://schema.org","@type":"CollectionPage",name:"인덕 아케이드",url:"https://inhagame.app/arcade/",mainEntity:{"@type":"ItemList",itemListElement:gs.filter(g=>g.status==="playable").map((g,i)=>({"@type":"ListItem",position:i+1,name:g.title,url:"https://inhagame.app/arcade/"+g.id+"/"}))}};
let content=`<section class="hero"><span class="eyebrow">INDUCK ARCADE · GAME COLLECTION</span><h1>게임의 세계는<br><em>계속 확장됩니다.</em></h1><p>인하월드에서 제작한 웹게임을 한곳에서 찾아보세요. 각 게임의 플레이 기록과 저장 방식은 독립적으로 유지됩니다.</p><a class="primary" href="#games">게임 둘러보기 →</a></section><section id="games" class="listing"><div class="section-head"><h2>전체 게임</h2><span>${gs.filter(g=>g.status==="playable").length}개 플레이 가능</span></div><div class="cards">`;
for(const g of gs){const ready=g.status==="playable",url=ready?"/arcade/"+g.id+"/":null;
content+=`<article class="card"><img src="${esc(g.platform.coverImage)}" alt="${esc(g.title)} 콘셉트 일러스트" loading="lazy" width="800" height="600"><div class="card-body"><span class="eyebrow">${esc(g.platform.genre)} · ${esc(g.platform.label)}</span><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p>${ready?`<a href="${url}">게임 소개 보기 →</a>`:"<span>준비 중</span>"}</div></article>`;}
content+=`</div></section>`;
return wrap(head(title,desc,"/arcade/",ld),content);
}

function detail(g){
const title=g.title+" | 인덕 아케이드 · INHA WORLD";
const desc=g.description+" 인하월드 인덕 아케이드에서 게임을 소개하고 플레이 링크를 제공합니다.";
const path="/arcade/"+g.id+"/";
const ld={"@context":"https://schema.org","@type":"VideoGame",name:g.title,description:g.description,genre:g.platform.genre,gamePlatform:"웹 브라우저",url:"https://inhagame.app"+path};
const body=`<nav class="breadcrumbs" aria-label="현재 위치"><a href="/">인하월드</a> / <a href="/arcade/">인덕 아케이드</a> / <span aria-current="page">${esc(g.title)}</span></nav>
<article class="detail"><div class="detail-art"><img src="${esc(g.platform.coverImage)}" alt="${esc(g.title)} 콘셉트 일러스트" width="800" height="600"><p>실제 게임 화면이 아닌 콘셉트 일러스트입니다.</p></div>
<div><span class="eyebrow">${esc(g.platform.genre)} · ${esc(g.platform.label)}</span><h1>${esc(g.title)}</h1><p class="lead">${esc(g.description)}</p><a class="primary" href="${esc(g.playUrl)}" rel="noopener noreferrer">게임 플레이 ↗</a><p class="notice">게임마다 저장 방식과 플레이 기록이 다를 수 있습니다.</p><a class="back" href="/arcade/">← 다른 게임 살펴보기</a></div></article>`;
return wrap(head(title,desc,path,ld),body);
}

function sitemap(gs){
const paths=["/","/campus/","/support.html","/privacy.html","/terms.html","/updates.html","/arcade/",...gs.filter(g=>g.status==="playable").map(g=>"/arcade/"+g.id+"/")];
return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(p=>`  <url><loc>https://inhagame.app${p}</loc></url>`).join("\n")}\n</urlset>\n`;
}

function generate(data){
const gs=gamesFrom(data),pages={"arcade/index.html":collection(gs),"sitemap.xml":sitemap(gs)};
for(const g of gs){if(g.status==="playable")pages["arcade/"+g.id+"/index.html"]=detail(g);}
return pages;
}
const data=JSON.parse(readFileSync(join(root,'data/game-catalog.json'),'utf8'));
const check=process.argv.includes('--check');
for(const [path,html] of Object.entries(generate(data))){
 const target=join(root,path);
 if(check){if(!existsSync(target)||readFileSync(target,'utf8')!==html)throw Error('Generated file is stale: '+path);}
 else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,html,'utf8');}
}
