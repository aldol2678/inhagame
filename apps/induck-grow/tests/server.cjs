const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const app=path.join(__dirname,'..');
http.createServer((req,res)=>{
  if(req.url==='/account.js'){
    res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});
    res.end(fs.readFileSync(path.join(app,'account.js')));return;
  }
  if(req.url==='/'||req.url==='/index.html'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end(fs.readFileSync(path.join(app,'index.html')));return;
  }
  res.writeHead(404);res.end();
}).listen(4173,'127.0.0.1');
