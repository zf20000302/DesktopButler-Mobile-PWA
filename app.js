
"use strict";

const STORAGE_KEY = "desktopbutler.mobile.v02";
const SESSION_KEY = "desktopbutler.mobile.supabase.session";
const CATALOG_KEY = "desktopbutler.mobile.catalog.v02";
const SUPA = window.DESKTOPBUTLER_SUPABASE || {};
let cloudSession = null;
let cloudSaveTimer = null;
let cloudReady = false;
const REVIEW_DAYS = [1, 3, 7, 14, 30, 60, 90];

const MODULES = {
  word: {name:"單字", icon:"Aa", defaultCount:8, sec:80},
  listening_review:{name:"聽力文章", icon:"◉", defaultCount:1, sec:260},
  listen_repeat:{name:"Listen & Repeat", icon:"↻", defaultCount:3, sec:75},
  listening_sentence:{name:"聽力句子", icon:"♫", defaultCount:3, sec:80},
  academic_discussion:{name:"Academic", icon:"✎", defaultCount:2, sec:260},
  email:{name:"Email", icon:"✉", defaultCount:1, sec:360},
  speaking_reason:{name:"口說理由", icon:"◌", defaultCount:2, sec:150},
  speaking_interview:{name:"Interview1", icon:"◎", defaultCount:1, sec:180},
  academic_real:{name:"Academic 真題", icon:"A+", defaultCount:1, sec:540},
  email_real:{name:"Email 真題", icon:"E+", defaultCount:1, sec:540},
};

let DB = null;
let installPrompt = null;
let runtime = {session:null, index:0, startedAt:null, timer:null, special:null};

function today(){
  return new Date().toISOString().slice(0,10);
}
function nowISO(){ return new Date().toISOString(); }

function initialState(){
  return {
    version:2,
    updatedAt: nowISO(),
    memory:{},
    cycles:{},
    today:{date:today(), completed:{}},
    stats:{totalSeconds:0, byModule:{}},
    settings:{reviewRatio:0.4, commuteMinutes:10},
  };
}
function loadState(){
  try{
    const x = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return x && x.version ? x : initialState();
  }catch(e){ return initialState(); }
}
let state = loadState();

function ensureToday(){
  if(state.today?.date !== today()){
    state.today = {date:today(), completed:{}};
    saveState();
  }
}
function saveState(){
  state.updatedAt = nowISO();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if(cloudReady && cloudSession?.access_token){
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer=setTimeout(()=>pushCloudState().catch(()=>{}),650);
  }
}

function loadSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||"null");}catch(e){return null;}
}
function saveSession(s){
  cloudSession=s;
  if(s) localStorage.setItem(SESSION_KEY,JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}
function authHeaders(token=null){
  const h={"apikey":SUPA.publishableKey,"Content-Type":"application/json"};
  if(token) h["Authorization"]="Bearer "+token;
  return h;
}
async function supaFetch(path,{method="GET",body=null,token=null,headers={}}={}){
  const resp=await fetch(SUPA.url+path,{
    method,
    headers:{...authHeaders(token),...headers},
    body:body===null?undefined:JSON.stringify(body)
  });
  const raw=await resp.text();
  let data=null;
  if(raw){try{data=JSON.parse(raw)}catch{data=raw}}
  if(!resp.ok) throw new Error(typeof data==="string"?data:(data?.msg||data?.message||JSON.stringify(data)));
  return data;
}
async function refreshSession(){
  if(!cloudSession?.refresh_token) return false;
  try{
    const s=await supaFetch("/auth/v1/token?grant_type=refresh_token",{
      method:"POST",body:{refresh_token:cloudSession.refresh_token}
    });
    saveSession(s); return true;
  }catch(e){ return false; }
}
async function validToken(){
  if(!cloudSession?.access_token) return false;
  const exp=(cloudSession.expires_at||0)*1000;
  if(exp && exp-Date.now()<60000) await refreshSession();
  return !!cloudSession?.access_token;
}
async function signIn(email,password){
  const s=await supaFetch("/auth/v1/token?grant_type=password",{method:"POST",body:{email,password}});
  saveSession(s); return s;
}
async function signUp(email,password){
  const s=await supaFetch("/auth/v1/signup",{method:"POST",body:{email,password}});
  if(s?.access_token) saveSession(s);
  return s;
}
async function logout(){
  try{
    if(cloudSession?.access_token) await supaFetch("/auth/v1/logout",{method:"POST",token:cloudSession.access_token});
  }catch(e){}
  saveSession(null);
  cloudReady=false;
  DB=null;
  localStorage.removeItem(CATALOG_KEY);
  authView("已登出");
}
async function cloudUser(){
  if(!(await validToken())) return null;
  return await supaFetch("/auth/v1/user",{token:cloudSession.access_token});
}
async function pullCatalog(){
  if(!(await validToken())) return null;
  const user=await cloudUser();
  const rows=await supaFetch(`/rest/v1/practice_catalog?user_id=eq.${encodeURIComponent(user.id)}&select=catalog,updated_at`,{
    token:cloudSession.access_token
  });
  const catalog=rows?.[0]?.catalog||null;
  if(catalog){
    localStorage.setItem(CATALOG_KEY,JSON.stringify(catalog));
    DB=catalog;
  }
  return catalog;
}
async function pullCloudState(){
  if(!(await validToken())) return;
  const user=await cloudUser();
  const rows=await supaFetch(`/rest/v1/app_state?user_id=eq.${encodeURIComponent(user.id)}&select=state,updated_at`,{
    token:cloudSession.access_token
  });
  const cloud=rows?.[0]?.state;
  if(cloud){
    const localTime=new Date(state.updatedAt||0).getTime();
    const cloudTime=new Date(cloud.updatedAt||0).getTime();
    if(cloudTime>localTime){
      state=cloud;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    }else if(localTime>cloudTime){
      await pushCloudState();
    }
  }else{
    await pushCloudState();
  }
}
async function pushCloudState(){
  if(!(await validToken())) return;
  const user=await cloudUser();
  await supaFetch("/rest/v1/app_state?on_conflict=user_id",{
    method:"POST",
    token:cloudSession.access_token,
    headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
    body:[{user_id:user.id,state,updated_at:nowISO()}]
  });
}
function cachedCatalog(){
  try{return JSON.parse(localStorage.getItem(CATALOG_KEY)||"null")}catch(e){return null}
}
function authView(message=""){
  setTitle("登入");
  setNav("");
  const view=document.querySelector("#view");
  view.innerHTML=`
    <div class="stack">
      <section class="card hero">
        <div class="eyebrow">DESKTOP BUTLER CLOUD</div>
        <h2>登入小管家</h2>
        <p class="small-text muted">登入後，手機題庫與練習進度會存到你的 Supabase 帳號。</p>
        ${message?`<div class="content-box small-text">${esc(message)}</div>`:""}
        <div class="type-area" style="margin-top:12px">
          <input id="auth-email" type="email" placeholder="Email" autocomplete="email">
          <input id="auth-password" type="password" placeholder="Password" autocomplete="current-password">
          <button class="btn block" onclick="doLogin()">登入</button>
          <button class="btn secondary block" onclick="doSignup()">第一次使用：建立帳號</button>
        </div>
      </section>
    </div>`;
}
window.doLogin=async function(){
  const email=document.querySelector("#auth-email").value.trim();
  const password=document.querySelector("#auth-password").value;
  try{
    await signIn(email,password);
    await startCloudApp();
  }catch(e){ authView("登入失敗："+e.message); }
}
window.doSignup=async function(){
  const email=document.querySelector("#auth-email").value.trim();
  const password=document.querySelector("#auth-password").value;
  try{
    const s=await signUp(email,password);
    if(s?.access_token) await startCloudApp();
    else authView("帳號已建立。若 Supabase 有開啟 Email confirmation，請先到信箱完成驗證，再回來登入。");
  }catch(e){ authView("建立帳號失敗："+e.message); }
}
async function startCloudApp(){
  let catalog=null;
  try{
    catalog=await pullCatalog();
  }catch(e){
    catalog=cachedCatalog();
  }
  if(!catalog){
    authView("登入成功，但 Supabase 尚未有題庫。請先在電腦執行 upload_catalog_to_supabase.bat。");
    return;
  }
  DB=catalog;
  try{ await pullCloudState(); }catch(e){}
  cloudReady=true;
  renderRoute();
}

function toast(text){
  const el=document.querySelector("#toast");
  el.textContent=text; el.classList.add("show");
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove("show"),1800);
}
function esc(s=""){
  return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function nl(s=""){ return esc(s).replace(/\n/g,"<br>"); }

function moduleItems(module){ return DB.modules[module] || []; }
function itemId(item){ return item.id || item.key || item.word || item.code || item.email_id || JSON.stringify(item).slice(0,100); }

function memFor(module){ state.memory[module] ||= {}; return state.memory[module]; }
function cycleFor(module){
  state.cycles[module] ||= {round:1, seen:[]};
  return state.cycles[module];
}
function completedToday(module){
  ensureToday();
  return state.today.completed[module] || [];
}
function isDue(module,id){
  const m=memFor(module)[id];
  return !!(m?.nextReview && new Date(m.nextReview) <= new Date());
}
function dueCount(module){
  return moduleItems(module).filter(x=>isDue(module,itemId(x))).length;
}
function cycleStatus(module){
  const items=moduleItems(module);
  const c=cycleFor(module);
  const valid=new Set(items.map(itemId));
  const seen=(c.seen||[]).filter(x=>valid.has(x));
  return {round:c.round, done:seen.length, total:items.length};
}

function addDays(days){
  const d=new Date(); d.setDate(d.getDate()+days); return d.toISOString();
}
function markComplete(module,item,rating="normal",seconds=0,{sameDayOnly=false}={}){
  ensureToday();
  const id=itemId(item);
  const mem=memFor(module);
  const old=mem[id] || {reviewCount:0,stage:-1};

  let stage=old.stage ?? -1;
  if(!sameDayOnly){
    if(rating==="hard") stage=0;
    else if(rating==="easy") stage=stage<0 ? 2 : Math.min(REVIEW_DAYS.length-1, stage+2);
    else stage=stage<0 ? 0 : Math.min(REVIEW_DAYS.length-1, stage+1);
  }

  mem[id]={
    reviewCount:(old.reviewCount||0)+1,
    stage,
    lastReviewed:nowISO(),
    nextReview:sameDayOnly ? old.nextReview : addDays(REVIEW_DAYS[Math.max(0,stage)]),
    rating:sameDayOnly ? old.rating : rating,
  };

  if(!sameDayOnly){
    const c=cycleFor(module);
    if(!c.seen.includes(id)) c.seen.push(id);
    const validCount=moduleItems(module).length;
    if(validCount>0 && c.seen.length>=validCount){
      c.round += 1; c.seen=[];
    }
  }

  state.today.completed[module] ||= [];
  if(!state.today.completed[module].includes(id)) state.today.completed[module].push(id);

  state.stats.totalSeconds=(state.stats.totalSeconds||0)+seconds;
  state.stats.byModule[module]=(state.stats.byModule[module]||0)+seconds;
  saveState();
}

function normalizedEnglish(s=""){
  return s.toLowerCase()
    .replace(/[’‘]/g,"'")
    .replace(/[“”]/g,'"')
    .replace(/\s+/g," ")
    .trim();
}
function speak(text){
  if(!text) return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang="en-US"; u.rate=.92;
  speechSynthesis.speak(u);
}
function fmtTime(sec){
  sec=Math.max(0,Math.round(sec));
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
function formatMinutes(sec){
  const m=Math.round(sec/60);
  return m<60 ? `${m} min` : `${Math.floor(m/60)}h ${m%60}m`;
}

function pickMixed(module,count){
  const items=moduleItems(module);
  if(!items.length) return [];
  const c=cycleFor(module);
  const seenSet=new Set(c.seen||[]);
  const due=items.filter(x=>isDue(module,itemId(x)));
  const unseen=items.filter(x=>!seenSet.has(itemId(x)));
  const old=items.filter(x=>seenSet.has(itemId(x)) && !isDue(module,itemId(x)));

  due.sort((a,b)=>{
    const ma=memFor(module)[itemId(a)]?.nextReview||"";
    const mb=memFor(module)[itemId(b)]?.nextReview||"";
    return ma.localeCompare(mb);
  });
  unseen.sort(()=>Math.random()-.5);
  old.sort((a,b)=>{
    const ma=memFor(module)[itemId(a)]?.lastReviewed||"";
    const mb=memFor(module)[itemId(b)]?.lastReviewed||"";
    return ma.localeCompare(mb);
  });

  const reviewSlots=Math.min(due.length, Math.round(count*(state.settings.reviewRatio||.4)));
  const chosenDue=due.slice(0,reviewSlots);
  const chosenNew=unseen.slice(0,Math.max(0,count-chosenDue.length));
  let chosen=[...chosenNew,...chosenDue];

  if(chosen.length<count){
    const ids=new Set(chosen.map(itemId));
    for(const x of [...due.slice(reviewSlots),...old]){
      if(!ids.has(itemId(x))){ chosen.push(x); ids.add(itemId(x)); }
      if(chosen.length>=count) break;
    }
  }

  // 穿插複習，不把 due 全放前面
  const d=chosen.filter(x=>isDue(module,itemId(x)));
  const n=chosen.filter(x=>!isDue(module,itemId(x)));
  const result=[];
  while(n.length || d.length){
    if(n.length) result.push(n.shift());
    if(n.length && result.length%3!==0) result.push(n.shift());
    if(d.length) result.push(d.shift());
  }
  return result.slice(0,count);
}

function buildSession(module,count){
  return pickMixed(module,count).map(item=>({module,item,isReview:isDue(module,itemId(item))}));
}
function buildTodayReview(module=null){
  ensureToday();
  const modules=module?[module]:Object.keys(MODULES);
  const steps=[];
  for(const m of modules){
    const ids=new Set(completedToday(m));
    for(const item of moduleItems(m)){
      if(ids.has(itemId(item))) steps.push({module:m,item,isReview:true,sameDay:true});
    }
  }
  return steps;
}

function setTitle(text){ document.querySelector("#page-title").textContent=text; }
function setNav(route){
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.route===route));
}
function route(route){
  if(runtime.timer){ clearInterval(runtime.timer); runtime.timer=null; }
  runtime.session=null; runtime.special=null;
  location.hash=route;
}
function currentRoute(){ return (location.hash||"#home").slice(1).split("?")[0]; }

function homeView(){
  setTitle("今天"); setNav("home"); ensureToday();
  const totalDone=Object.values(state.today.completed||{}).reduce((a,x)=>a+x.length,0);
  const totalDue=Object.keys(MODULES).reduce((a,m)=>a+dueCount(m),0);
  const todaySec=Object.keys(state.today.completed||{}).reduce((sum,m)=>{
    // stats currently cumulative; v0.1 presents total practice time as an approximate current-device statistic.
    return sum;
  },0);

  const cards=Object.entries(MODULES).slice(0,6).map(([m,def])=>{
    const cs=cycleStatus(m);
    return `<div class="card compact module-card">
      <div class="row">
        <div class="module-icon">${def.icon}</div>
        <div>
          <h3>${def.name}</h3>
          <div class="meta">
            <span class="pill">第 ${cs.round} 輪 ${cs.done}/${cs.total}</span>
            <span class="pill review">到期 ${dueCount(m)}</span>
          </div>
        </div>
      </div>
      <button class="btn soft small" onclick="startModule('${m}')">開始</button>
    </div>`;
  }).join("");

  document.querySelector("#view").innerHTML=`
    <div class="stack">
      <section class="card hero">
        <div class="row between">
          <div>
            <div class="tiny muted">TODAY</div>
            <h2>今天先完成一小段</h2>
          </div>
          <span class="pill">${today()}</span>
        </div>
        <div class="grid-2" style="margin:16px 0">
          <div><div class="metric">${totalDone}</div><div class="metric-label">今日完成題目</div></div>
          <div><div class="metric">${totalDue}</div><div class="metric-label">到期複習</div></div>
        </div>
        <button class="btn block" onclick="goCommute(10)">開始 10 分鐘通勤練習</button>
      </section>

      <div class="section-title"><h2>快速練習</h2><button class="ghost small" onclick="route('practice')">全部</button></div>
      <div class="stack">${cards}</div>

      <section class="card">
        <div class="row between">
          <div><h3>當日複習</h3><div class="tiny muted">重新跑今天已完成的內容，不改下次複習日期。</div></div>
          <button class="btn secondary small" onclick="startTodayReview()">複習今日全部</button>
        </div>
      </section>

      <section class="card">
        <div class="row between">
          <div>
            <h3>Cloud Sync v0.2</h3>
            <p class="small-text muted">題庫與進度已接 Supabase；離線時使用本機快取，連網後繼續同步。</p>
          </div>
          <button class="ghost small" onclick="logout()">登出</button>
        </div>
      </section>
    </div>`;
}

function practiceView(){
  setTitle("集中練習"); setNav("practice"); ensureToday();
  const cards=Object.entries(MODULES).map(([m,def])=>{
    const cs=cycleStatus(m), todayN=completedToday(m).length;
    return `<section class="card module-card">
      <div class="row">
        <div class="module-icon">${def.icon}</div>
        <div>
          <h3>${def.name}</h3>
          <div class="tiny muted">今日 ${todayN} 題</div>
          <div class="meta">
            <span class="pill">第 ${cs.round} 輪 ${cs.done}/${cs.total}</span>
            <span class="pill review">到期 ${dueCount(m)}</span>
          </div>
        </div>
      </div>
      <button class="btn small" onclick="startModule('${m}')">單獨練習</button>
    </section>`;
  }).join("");
  document.querySelector("#view").innerHTML=`<div class="stack">${cards}</div>`;
}

function commuteView(){
  setTitle("通勤模式"); setNav("commute");
  const mins=state.settings.commuteMinutes||10;
  const checks=Object.entries(MODULES).map(([m,d],i)=>{
    const checked=["word","listening_sentence","listen_repeat","speaking_reason","speaking_interview"].includes(m)?"checked":"";
    return `<label class="check-item"><input type="checkbox" data-commute-module="${m}" ${checked}><span>${d.name}</span></label>`;
  }).join("");
  document.querySelector("#view").innerHTML=`
    <div class="stack">
      <section class="card hero">
        <h2>今天通勤想練多久？</h2>
        <p class="small-text muted">會先安排到期複習，再補今天還沒碰過的內容。</p>
        <div class="segment">
          ${[5,10,20].map(x=>`<button class="btn secondary ${mins===x?"active":""}" onclick="setCommuteMinutes(${x})">${x} 分</button>`).join("")}
        </div>
      </section>
      <section class="card">
        <h3>想練的內容</h3>
        <div class="check-grid" style="margin-top:12px">${checks}</div>
      </section>
      <button class="btn block" onclick="startCommute()">開始這次 Session</button>
    </div>`;
}

function progressView(){
  setTitle("進度"); setNav("progress");
  const cards=Object.entries(MODULES).map(([m,d])=>{
    const cs=cycleStatus(m);
    const pct=cs.total?Math.round(cs.done/cs.total*100):0;
    const sec=state.stats.byModule[m]||0;
    return `<section class="card">
      <div class="row between"><div><h3>${d.name}</h3><div class="tiny muted">第 ${cs.round} 輪</div></div><span class="pill review">到期 ${dueCount(m)}</span></div>
      <div class="row between small-text" style="margin:13px 0 7px"><span>${cs.done} / ${cs.total}</span><strong>${pct}%</strong></div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <div class="tiny muted" style="margin-top:9px">本機累積練習時間：${formatMinutes(sec)}</div>
    </section>`;
  }).join("");
  document.querySelector("#view").innerHTML=`
    <div class="stack">
      ${cards}
      <section class="card">
        <div class="row between">
          <div><h3>同步資料</h3><div class="tiny muted">本機快取 + Supabase 雲端同步</div></div>
          <button class="btn danger small" onclick="resetProgress()">清除進度</button>
        </div>
      </section>
    </div>`;
}

function setCommuteMinutes(x){
  state.settings.commuteMinutes=x; saveState(); commuteView();
}
function goCommute(x){ state.settings.commuteMinutes=x; saveState(); route("commute"); }

function startCommute(){
  const mins=state.settings.commuteMinutes||10;
  const selected=[...document.querySelectorAll("[data-commute-module]:checked")].map(x=>x.dataset.commuteModule);
  if(!selected.length){ toast("至少選一個練習模組"); return; }

  let budget=mins*60, steps=[], loops=0;
  const cursors={};
  while(budget>25 && loops<100){
    loops++;
    let added=false;
    for(const m of selected){
      const est=MODULES[m].sec;
      if(budget<Math.min(est,60)) continue;
      cursors[m] ||= pickMixed(m, Math.max(4, Math.ceil(mins*60/Math.max(est,60))));
      const item=cursors[m].shift();
      if(item){
        steps.push({module:m,item,isReview:isDue(m,itemId(item))});
        budget-=est; added=true;
      }
      if(budget<=25) break;
    }
    if(!added) break;
  }
  if(!steps.length){ toast("目前沒有可練內容"); return; }
  startSession(steps,`通勤 ${mins} 分鐘`);
}

function startModule(module){
  const count=MODULES[module].defaultCount;
  const steps=buildSession(module,count);
  if(!steps.length){ toast("這個模組目前沒有題目"); return; }
  startSession(steps,MODULES[module].name);
}
function startTodayReview(module=null){
  const steps=buildTodayReview(module);
  if(!steps.length){ toast("今天還沒有已完成題目"); return; }
  startSession(steps,module?`${MODULES[module].name}｜當日複習`:"當日複習");
}

function startSession(steps,title){
  runtime.session={steps,title}; runtime.index=0; runtime.special=null;
  renderCurrentItem();
}
function currentStep(){ return runtime.session?.steps[runtime.index]; }
function startTimer(){
  runtime.startedAt=Date.now();
  clearInterval(runtime.timer);
  runtime.timer=setInterval(()=>{
    const el=document.querySelector("#item-timer");
    if(el) el.textContent=fmtTime((Date.now()-runtime.startedAt)/1000);
  },1000);
}
function secondsElapsed(){ return runtime.startedAt?Math.round((Date.now()-runtime.startedAt)/1000):0; }

function renderCurrentItem(){
  const step=currentStep();
  if(!step){ renderSessionDone(); return; }
  setTitle(runtime.session.title); setNav("");
  runtime.special=null; startTimer();

  const def=MODULES[step.module];
  document.querySelector("#view").innerHTML=`
    <div class="practice-shell">
      <section class="card practice-header">
        <div>
          <div class="tiny muted">${runtime.index+1} / ${runtime.session.steps.length}</div>
          <h2>${def.name}</h2>
          <span class="pill ${step.isReview?"review":"new"}">${step.sameDay?"當日複習":step.isReview?"到期複習":"本輪內容"}</span>
        </div>
        <div id="item-timer" class="timer">00:00</div>
      </section>
      <div id="practice-body"></div>
      <button class="btn secondary block" onclick="leaveSession()">稍後繼續</button>
    </div>`;
  renderModuleItem(step);
}

function renderModuleItem(step){
  const {module,item}=step;
  const body=document.querySelector("#practice-body");
  if(module==="word") return renderWord(body,item);
  if(module==="listening_review") return renderListening(body,item,true);
  if(module==="listen_repeat") return renderRepeat(body,item);
  if(module==="listening_sentence") return renderListeningSentence(body,item);
  if(module==="academic_discussion") return renderAcademic(body,item);
  if(module==="email") return renderEmail(body,item);
  if(module==="speaking_reason") return renderSpeakingReason(body,item);
  if(module==="speaking_interview") return renderInterview(body,item);
  if(module==="academic_real" || module==="email_real") return renderRealWriting(body,item,module);
  body.innerHTML=`<div class="card empty">尚未支援此題型</div>`;
}

function typeToggleHTML(en,zh){
  return `<details>
    <summary>✍ 加做打字</summary>
    <div class="type-area" style="margin-top:10px">
      <label class="tiny muted">中文（不檢查）</label>
      <textarea data-zh placeholder="可自行打一遍中文">${""}</textarea>
      <label class="tiny muted">英文（會檢查）</label>
      <textarea data-en placeholder="把英文完整打一遍"></textarea>
      <button class="btn soft" onclick='checkEnglish(${JSON.stringify(en)})'>檢查英文</button>
    </div>
  </details>`;
}
window.checkEnglish=function(expected){
  const el=document.querySelector("[data-en]");
  if(!el) return;
  if(normalizedEnglish(el.value)===normalizedEnglish(expected)){
    toast("英文正確");
  }else toast("英文還不一致");
};

function completeButton(label="完成這題"){
  return `<button class="btn block" onclick="finishForRating()">${label}</button>`;
}

function renderWord(body,item){
  body.innerHTML=`<div class="stack">
    <section class="card">
      <div class="tiny muted">${esc(item.category||"")}</div>
      <div class="row between" style="margin-top:5px">
        <div><div style="font-size:30px;font-weight:850">${esc(item.word)}</div><div class="muted">${esc(item.pos||"")}</div></div>
        <button class="btn soft small" onclick='speak(${JSON.stringify(item.word)})'>🔊 單字</button>
      </div>
      <p class="zh">${nl(item.chinese||"")}</p>
    </section>
    ${item.phrases?`<section class="content-box"><div class="label">片語</div><div>${nl(item.phrases)}</div></section>`:""}
    <section class="content-box">
      <div class="label">例句</div>
      <div class="en">${nl(item.example_en||"")}</div>
      <div class="zh" style="margin-top:8px">${nl(item.example_zh||"")}</div>
      <button class="btn soft small" style="margin-top:10px" onclick='speak(${JSON.stringify(item.example_en||"")})'>🔊 例句</button>
      ${typeToggleHTML(item.example_en||"",item.example_zh||"")}
    </section>
    ${completeButton()}
  </div>`;
}

function renderListening(body,item,isArticle=false){
  body.innerHTML=`<div class="stack">
    <section class="card big-center">
      <div class="muted">先只用耳朵理解</div>
      <button class="btn" style="margin-top:14px" onclick='speak(${JSON.stringify(item.english||"")})'>▶ 播放英文</button>
    </section>
    <section id="listen-answer" class="card hidden">
      <div class="label tiny muted">ENGLISH</div><p class="en">${nl(item.english||"")}</p>
      <div class="label tiny muted">中文</div><p class="zh">${nl(item.chinese||"")}</p>
    </section>
    <button class="btn secondary block" onclick="document.querySelector('#listen-answer').classList.remove('hidden')">顯示答案</button>
    ${completeButton()}
  </div>`;
}
function renderRepeat(body,item){
  body.innerHTML=`<div class="stack">
    <section class="card">
      <div class="en">${nl(item.english||"")}</div>
      <div class="zh" style="margin-top:10px">${nl(item.chinese||"")}</div>
      <button class="btn soft small" onclick='speak(${JSON.stringify(item.english||"")})'>🔊 播放</button>
    </section>
    ${item.chunks?`<section class="content-box"><div class="label">Chunks</div>${nl(item.chunks)}</section>`:""}
    ${completeButton("跟讀完成")}
  </div>`;
}
function renderListeningSentence(body,item){
  body.innerHTML=`<div class="stack">
    <section class="card big-center">
      <button class="btn" onclick='speak(${JSON.stringify(item.english||"")})'>▶ 播放句子</button>
    </section>
    <section class="card">
      <p class="en">${nl(item.english||"")}</p>
      <p class="zh">${nl(item.chinese||"")}</p>
      ${item.phrase?`<div class="content-box"><div class="label">重點片語</div><strong>${nl(item.phrase)}</strong><div class="zh">${nl(item.phrase_zh||"")}</div></div>`:""}
    </section>
    ${completeButton()}
  </div>`;
}

function renderAcademic(body,item){
  const integrated=[item.reason_en,item.example_en].filter(Boolean).join(" ");
  body.innerHTML=`<div class="stack">
    <section class="card">
      <div class="tiny muted">${esc(item.code||"")}</div>
      <h3>${esc(item.topic_en||"Academic Discussion")}</h3>
      <div class="zh">${esc(item.topic_zh||"")}</div>
    </section>
    <section class="content-box"><div class="label">Reason</div><div class="en">${nl(item.reason_en||"")}</div><div class="zh">${nl(item.reason_zh||"")}</div></section>
    <section class="content-box"><div class="label">Example</div><div class="en">${nl(item.example_en||"")}</div><div class="zh">${nl(item.example_zh||"")}</div></section>
    <section class="card">
      <div class="label tiny muted">整合輸出</div>
      <p class="en">${nl(integrated)}</p>
      <button class="btn soft small" onclick='speak(${JSON.stringify(integrated)})'>🔊 播放整段</button>
      ${typeToggleHTML(integrated,[item.reason_zh,item.example_zh].filter(Boolean).join(" "))}
    </section>
    ${completeButton()}
  </div>`;
}

function renderEmail(body,item){
  const steps=(item.steps||[]).map((s,i)=>`<div class="sentence">
    <div class="tiny muted">STEP ${i+1} · ${esc(s.function_en||"")}</div>
    <div class="en">${nl(s.reason_en||s.requirement_en||"")}</div>
    <div class="zh">${nl(s.reason_zh||s.requirement_zh||"")}</div>
    ${s.example_en?`<div style="margin-top:8px"><strong>Example</strong><div class="en">${nl(s.example_en)}</div><div class="zh">${nl(s.example_zh||"")}</div></div>`:""}
  </div>`).join("");
  body.innerHTML=`<div class="stack">
    <section class="card"><div class="tiny muted">${esc(item.email_id||"")}</div><h3>${esc(item.category||"Email")}</h3><p class="en">${nl(item.scenario_en||"")}</p><p class="zh">${nl(item.scenario_zh||"")}</p></section>
    <div class="sentence-list">${steps}</div>
    ${completeButton()}
  </div>`;
}

function sentenceAudioBlock(en,zh,label){
  return `<div class="sentence">
    <div class="row between"><strong>${esc(label)}</strong><button class="btn soft small" onclick='speak(${JSON.stringify(en||"")})'>🔊</button></div>
    <div class="en">${nl(en||"")}</div><div class="zh">${nl(zh||"")}</div>
  </div>`;
}
function renderSpeakingReason(body,item){
  const reasons=(item.reasons||[]).map((r,i)=>sentenceAudioBlock(r[0],r[1],`Reason ${i+1}`)).join("");
  const ex=item.example_en?sentenceAudioBlock(item.example_en,item.example_zh,"Example"):"";
  body.innerHTML=`<div class="stack">
    <section class="card"><div class="tiny muted">${esc(item.category_en||"")}</div><h3>${esc(item.reason_title_en||"")}</h3><div class="zh">${esc(item.reason_title_zh||"")}</div></section>
    <div class="sentence-list">${reasons}${ex}</div>
    ${typeToggleHTML([...(item.reasons||[]).map(r=>r[0]),item.example_en].filter(Boolean).join(" "),[...(item.reasons||[]).map(r=>r[1]),item.example_zh].filter(Boolean).join(" "))}
    ${completeButton("朗讀完成")}
  </div>`;
}
function renderInterview(body,item){
  const sentences=(item.answer_sentences||[]).map((r,i)=>sentenceAudioBlock(r[0],r[1],`Sentence ${i+1}`)).join("");
  body.innerHTML=`<div class="stack">
    <section class="card">
      <div class="tiny muted">${esc(item.topic_en||"Interview1")}</div>
      <p class="en"><strong>${nl(item.question_en||"")}</strong></p><p class="zh">${nl(item.question_zh||"")}</p>
      <button class="btn soft small" onclick='speak(${JSON.stringify(item.question_en||"")})'>🔊 題目</button>
    </section>
    <div class="sentence-list">${sentences||sentenceAudioBlock(item.answer_en,item.answer_zh,"Model Answer")}</div>
    ${completeButton("朗讀完成")}
  </div>`;
}

function renderRealWriting(body,item,module){
  runtime.special={stage:"intro", sentenceIndex:0, item, module};
  renderRealWritingStage(body);
}
function renderRealWritingStage(body){
  const s=runtime.special, item=s.item;
  if(s.stage==="intro"){
    body.innerHTML=`<div class="stack">
      <section class="card"><div class="tiny muted">題目</div><p class="en">${nl(item.question||"")}</p></section>
      <section class="content-box"><div class="label">英文範本</div><div class="en">${nl(item.sample_en||"")}</div></section>
      <section class="content-box"><div class="label">中文範本</div><div class="zh">${nl(item.sample_zh||"")}</div></section>
      <button class="btn block" onclick="realStartSentences()">開始逐句練習</button>
    </div>`;
  }else if(s.stage==="sentences"){
    const pair=(item.sentences||[])[s.sentenceIndex];
    if(!pair){ s.stage="full"; return renderRealWritingStage(body); }
    body.innerHTML=`<div class="stack">
      <section class="card"><div class="tiny muted">Sentence ${s.sentenceIndex+1} / ${(item.sentences||[]).length}</div><div class="en">${nl(pair[0])}</div><div class="zh">${nl(pair[1]||"")}</div><button class="btn soft small" onclick='speak(${JSON.stringify(pair[0])})'>🔊</button></section>
      ${typeToggleHTML(pair[0],pair[1]||"")}
      <button class="btn block" onclick="realNextSentence()">下一句</button>
    </div>`;
  }else{
    body.innerHTML=`<div class="stack">
      <section class="content-box"><div class="label">看中文，完整寫出英文</div><div class="zh">${nl(item.sample_zh||"")}</div></section>
      <textarea id="full-output" style="min-height:180px" placeholder="在這裡寫完整英文"></textarea>
      <details><summary>需要提示時顯示英文範本</summary><div class="content-box en" style="margin-top:9px">${nl(item.sample_en||"")}</div></details>
      ${completeButton("完成整篇")}
    </div>`;
  }
}
window.realStartSentences=function(){ runtime.special.stage="sentences"; runtime.special.sentenceIndex=0; renderRealWritingStage(document.querySelector("#practice-body")); };
window.realNextSentence=function(){ runtime.special.sentenceIndex++; renderRealWritingStage(document.querySelector("#practice-body")); };

window.finishForRating=function(){
  clearInterval(runtime.timer);
  const step=currentStep(), sec=secondsElapsed();
  document.querySelector("#practice-body").innerHTML=`<section class="card">
    <div class="big-center">
      <div class="tiny muted">本題用時</div><div class="metric" style="margin:7px">${fmtTime(sec)}</div>
      <h2>這題現在記得多熟？</h2>
    </div>
    <div class="rating-grid">
      <button class="btn danger" onclick="commitRating('hard',${sec})">😣 不熟 · 明天再出現</button>
      <button class="btn warn" onclick="commitRating('normal',${sec})">🙂 普通 · 正常間隔</button>
      <button class="btn good" onclick="commitRating('easy',${sec})">✓ 熟悉 · 拉長間隔</button>
    </div>
  </section>`;
};
window.commitRating=function(rating,sec){
  const step=currentStep();
  markComplete(step.module,step.item,rating,sec,{sameDayOnly:!!step.sameDay});
  runtime.index++; renderCurrentItem();
};

function renderSessionDone(){
  clearInterval(runtime.timer);
  document.querySelector("#view").innerHTML=`<section class="card big-center">
    <div style="font-size:44px">✓</div><h2>本次練習完成</h2>
    <p class="muted">進度與間隔複習已保存在這支手機。</p>
    <button class="btn" onclick="route('home')">回到今天</button>
  </section>`;
}
window.leaveSession=function(){ route("home"); };

function resetProgress(){
  if(confirm("確定要清除這支手機上的所有練習進度嗎？")){
    state=initialState(); saveState(); progressView(); toast("已清除");
  }
}

function renderRoute(){
  const r=currentRoute();
  if(r==="practice") practiceView();
  else if(r==="commute") commuteView();
  else if(r==="progress") progressView();
  else homeView();
}

document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>route(b.dataset.route)));
window.addEventListener("hashchange",renderRoute);

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault(); installPrompt=e;
  document.querySelector("#install-btn").classList.remove("hidden");
});
document.querySelector("#install-btn").addEventListener("click",async()=>{
  if(!installPrompt) return;
  installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt=null; document.querySelector("#install-btn").classList.add("hidden");
});

async function boot(){
  ensureToday();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  cloudSession=loadSession();

  if(!navigator.onLine && cachedCatalog() && cloudSession?.access_token){
    DB=cachedCatalog();
    cloudReady=false;
    renderRoute();
    toast("離線模式");
    return;
  }

  if(!cloudSession?.access_token){
    authView();
    return;
  }

  await startCloudApp();
}
boot().catch(err=>{
  const cached=cachedCatalog();
  if(cached && cloudSession?.access_token){
    DB=cached;
    renderRoute();
    toast("雲端連線失敗，已切換離線模式");
  }else{
    authView("載入失敗："+err.message);
  }
});
