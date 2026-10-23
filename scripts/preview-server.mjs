// Isolated local review fixture. Never connects to production Firebase.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
let revision = 1;
let school = { data: { '체험 학급': Array.from({ length: 26 }, (_, i) => ({ no:i+1,name:`학생${String(i+1).padStart(2,'0')}`,gender:i%2?'여':'남',score:i%9,attendance:true,isReferee:i<3,gagaDrawn:false,customAvatar:`images/avatars/v2/${i%2?'girl':'boy'}_${String(i+1).padStart(2,'0')}.webp` })) }, scores:{},records:{},stamps:{},hiddenClasses:[] };
const clients = new Set();
const notify = () => { for(const client of clients) client.write(`data: ${JSON.stringify({school,revision})}\n\n`); };
http.createServer(async(req,res)=>{
    const url = new URL(req.url,'http://localhost');
    if(url.pathname==='/__events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});clients.add(res);notify();req.on('close',()=>clients.delete(res));return;}
    if(url.pathname==='/__state'){
        if(req.method==='POST'){
            let body='';for await(const part of req)body+=part;const update=JSON.parse(body);
            if(update.revision!==revision){res.writeHead(409);res.end();return;}
            school=update.school;revision++;notify();
        }
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({school,revision}));return;
    }
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    if(file==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');res.end("export const auth={},db={},provider={};");return;}
    const absolute=path.resolve(root,'.'+file);
    if(!absolute.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try {
        let content=await fs.readFile(absolute);
        if(file==='/app.js'||file==='/console.js') content=Buffer.from(content.toString().replace(/https:\/\/www\.gstatic\.com\/firebasejs\/11\.6\.1\/firebase-(auth|firestore)\.js/g,'/test/fixtures/firebase.js'));
        res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg'})[path.extname(file)]||'application/octet-stream');res.end(content);
    }catch {res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1',()=>console.log('Isolated preview: http://127.0.0.1:4173 (sample data only)'));
