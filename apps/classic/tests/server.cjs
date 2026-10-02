const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
// Only the static app, never repository metadata, test artifacts or credentials.
const FILES=['index.html','badge-system.js','secret-run.js','secret-session.css','classic.css',
  'js/dom.js','js/online.js','js/game.js','js/boot.js','assets/annyongi.png','assets/indeoki.png'];
const TYPES={'.js':'text/javascript','.css':'text/css','.png':'image/png','.html':'text/html; charset=utf-8'};
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
  if(!FILES.includes(name)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',TYPES[path.extname(name)]);
  res.end(fs.readFileSync(path.join(root,name)));
}).listen(4173,'127.0.0.1',()=>console.log('Inha preview http://127.0.0.1:4173'));
