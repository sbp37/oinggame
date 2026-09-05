import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const ROOT = new URL('file:///home/user/oinggame/');
const DAY=86400000, NOW=Date.now();
const SCORES = process.argv[2] ? process.argv[2].split(',').map(Number) : [1984079,119448,90794,60999,59372];
const NICKS = ['제이1','제제','레레','하비','이에멍'];
const rows = SCORES.map((score,i)=>({id:NICKS[i]||('유저'+i),score,ts:NOW-i*DAY}));
const FS=`
const ROWS=${JSON.stringify(rows)};
const toRow=(r)=>({nickname:r.id,score:r.score,ts:r.ts,uid:'u_'+r.id});
function rowsFor(p){if(p==='rankings'||/^weekly_rankings\\/[^/]+\\/scores$/.test(p))return ROWS.map(r=>({id:r.id,data:{score:r.score,ts:r.ts,uid:'u_'+r.id}}));return[];}
function cacheDoc(p){if(p==='public_rank_cache/all')return{version:1,complete:true,kind:'all',weekId:null,updatedAt:Date.now(),rows:ROWS.map(toRow)};
 if(/^public_rank_cache\\/week_/.test(p))return{version:1,complete:true,kind:'week',weekId:p.split('week_')[1],updatedAt:Date.now(),rows:ROWS.map(toRow)};return null;}
export const getFirestore=()=>({});export const collection=(db,...p)=>({__path:p.join('/'),__ord:null,__lim:0});
export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
export const query=(c,...m)=>{const q={...c};m.forEach(x=>{if(x&&x.__ord)q.__ord=x.__ord;if(x&&x.__lim)q.__lim=x.__lim;});return q;};
export const orderBy=(f,d)=>({__ord:[f,d||'asc']});export const limit=(n)=>({__lim:n});export const where=()=>({});
export const getDocs=async(q)=>{let rows=rowsFor(q.__path);if(q.__ord){const[f,d]=q.__ord;rows=rows.filter(r=>r.data[f]!==undefined).slice().sort((a,b)=>{const A=a.data[f],B=b.data[f];return (A<B?-1:A>B?1:0)*(d==='desc'?-1:1);});}
 if(q.__lim)rows=rows.slice(0,q.__lim);const docs=rows.map(r=>({id:r.id,exists:()=>true,data:()=>r.data}));return{docs,size:docs.length,empty:!docs.length,forEach:(fn)=>docs.forEach(fn)};};
export const getDoc=async(ref)=>{const c=cacheDoc(ref.__path);if(c)return{id:ref.id,exists:()=>true,data:()=>c};const parts=String(ref.__path).split('/');const hit=rowsFor(parts.slice(0,-1).join('/')).find(r=>r.id===parts[parts.length-1]);return{id:ref.id,exists:()=>!!hit,data:()=>hit?hit.data:{}};};
export const setDoc=async()=>{};export const updateDoc=async()=>{};export const deleteDoc=async()=>{};export const addDoc=async()=>({id:'x'});
export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});
export const serverTimestamp=()=>Date.now();export const increment=(n)=>n;export const arrayUnion=(...a)=>a;export const arrayRemove=(...a)=>a;
export const onSnapshot=()=>()=>{};export const documentId=()=>'__name__';export const startAfter=()=>({});
export const Timestamp={now:()=>({toMillis:()=>Date.now()}),fromMillis:(m)=>({toMillis:()=>m})};`;
const STUBS={'firebase-app.js':`export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
 'firebase-firestore.js':FS,
 'firebase-auth.js':`const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
 'firebase-functions.js':`export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
 'firebase-analytics.js':`export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`};
const server=createServer(async(req,res)=>{const name=decodeURIComponent((req.url||'/').split('?')[0].replace(/^\//,''))||'index.html';
 try{const b=await readFile(new URL(name,ROOT));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end('x')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
for (const w of [320,360,375,390,412]) {
  const ctx=await b.newContext({viewport:{width:w,height:880},deviceScaleFactor:2});
  await ctx.route('https://www.gstatic.com/firebasejs/**',r=>{const f=r.request().url().split('/').pop();r.fulfill({status:200,contentType:'text/javascript',body:STUBS[f]||'export default {};'})});
  await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/,r=>r.abort());
  const p=await ctx.newPage();
  await p.addInitScript(()=>{localStorage.setItem('oeing_nickname_v1','오잉이')});
  await p.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>document.getElementById('tabRank').click());
  await p.waitForTimeout(2800);
  await p.evaluate(()=>document.fonts&&document.fonts.ready);
  await p.waitForTimeout(400);
  const out=await p.evaluate(()=>{
    const g=(sel)=>[...document.querySelectorAll(sel)].map(el=>({
      t:el.textContent.trim(), px:Math.round(parseFloat(getComputedStyle(el).fontSize)*10)/10,
      clip: el.scrollWidth>el.clientWidth+1, cw: el.clientWidth, sw: el.scrollWidth }));
    const rowNick=document.querySelector('#rankList .rank-identity .rank-nick');
    return { score:g('#podiumWrap .podium-score'), nick:g('#podiumWrap .podium-nick-text'),
      listNick: rowNick?Math.round(parseFloat(getComputedStyle(rowNick).fontSize)*10)/10:null };
  });
  const bad=[...out.score,...out.nick].filter(x=>x.clip);
  console.log(`${w}px | 1위점수 ${out.score[1].t} ${out.score[1].px}px (칸 ${out.score[1].cw}px, 필요 ${out.score[1].sw}px)`
    +` | 시상대닉 ${out.nick.map(n=>n.px).join('/')}px | 목록닉 ${out.listNick}px | ${bad.length?'잘림: '+bad.map(x=>x.t).join(','):'잘림 없음'}`);
  if(w===390) await p.screenshot({path:'/tmp/claude-0/-home-user-oing/506fc574-c1c3-5ec2-b9d7-88932592944c/scratchpad/podium-390.png',clip:{x:0,y:0,width:390,height:820}});
  await ctx.close();
}
await b.close(); await new Promise(r=>server.close(r));
