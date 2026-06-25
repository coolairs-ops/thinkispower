/**
 * appData 客户端注入（模板产物用）。与 cloudecode.injectAppDataClient 同契约，
 * 独立一份避免 app-runtime ↔ cloudecode 循环依赖。指向 /api/app/<pid>/，含 evaluate(形态B)。
 */
export function injectAppData(html: string, projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9-]/g, '');
  const js = `<script>(function(){var BASE='/api/app/${safeId}/';
var SKEY='tip_app_sess_${safeId}';
function sess(){try{return (typeof localStorage!=='undefined'&&localStorage.getItem(SKEY))||'';}catch(e){return '';}}
function headers(){var h={'Content-Type':'application/json'};var s=sess();if(s)h['x-app-session']=s;return h;}
function toQuery(o){o=o||{};var p=[];if(o.page)p.push('page='+encodeURIComponent(o.page));if(o.pageSize)p.push('pageSize='+encodeURIComponent(o.pageSize));if(o.sort)p.push('sort='+encodeURIComponent(o.sort));var f=o.filters||{};for(var k in f){if(Object.prototype.hasOwnProperty.call(f,k))p.push(encodeURIComponent(k)+'='+encodeURIComponent(f[k]));}return p.length?('?'+p.join('&')):'';}
async function req(m,p,b){var res=await fetch(BASE+p,{method:m,headers:headers(),body:b!=null?JSON.stringify(b):undefined});var j=await res.json().catch(function(){return {};});if(res.status===401){try{window.dispatchEvent(new CustomEvent('tip:auth-required'));}catch(e){}var er=new Error((j&&j.message)||'需要登录');er.code=401;throw er;}if(!res.ok){throw new Error((j&&j.error&&j.error.message)||res.statusText);}return j;}
window.appData={
list:function(r,o){return req('GET',r+toQuery(o)).then(function(x){return {items:x.data||[],total:x.total||0,page:x.page||1,pageSize:x.pageSize||0};}).catch(function(){return {items:[],total:0,page:1,pageSize:0};});},
get:function(r,id){return req('GET',r+'/'+encodeURIComponent(id)).then(function(x){return x.data;});},
create:function(r,d){return req('POST',r,d).then(function(x){return x.data;});},
update:function(r,id,d){return req('PATCH',r+'/'+encodeURIComponent(id),d).then(function(x){return x.data;});},
remove:function(r,id){return req('DELETE',r+'/'+encodeURIComponent(id)).then(function(){return true;});},
evaluate:function(r,id){return req('GET','_evaluate/'+encodeURIComponent(r)+'/'+encodeURIComponent(id)).then(function(x){return x&&x.ruleEngineEnabled?x:null;}).catch(function(){return null;});},
knowledge:function(){return req('GET','_knowledge').catch(function(){return {sources:[],evidences:[],facts:[],trace:[]};});},
ask:function(q){return req('POST','_qa',{question:q}).then(function(x){return (x&&x.answer)||'';}).catch(function(){return '';});},
login:function(u,pw){return req('POST','_login',{username:u,password:pw}).then(function(x){try{localStorage.setItem(SKEY,x.session);}catch(e){}return x;});},
logout:function(){return req('POST','_logout').catch(function(){return null;}).then(function(){try{localStorage.removeItem(SKEY);}catch(e){}return true;});},
isLoggedIn:function(){return !!sess();}
};
var GATE='<div id="tip-auth" style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:100000;font-family:system-ui">'
+'<div style="background:#fff;border-radius:12px;padding:24px;width:300px;box-shadow:0 12px 40px rgba(0,0,0,.2);color:#111">'
+'<div style="font-weight:600;font-size:16px;margin-bottom:14px">登录</div>'
+'<input id="tip-au-u" placeholder="用户名" autocomplete="username" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #d1d5db;border-radius:8px">'
+'<input id="tip-au-p" type="password" placeholder="密码" autocomplete="current-password" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px;border:1px solid #d1d5db;border-radius:8px">'
+'<button id="tip-au-btn" style="width:100%;padding:9px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer">登录</button>'
+'<div id="tip-au-msg" style="margin-top:8px;font-size:12px;color:#ef4444;min-height:14px"></div></div></div>';
function mountGate(){
  if(!document.body||document.getElementById('tip-auth'))return;
  var t=document.createElement('div');t.innerHTML=GATE;document.body.appendChild(t.firstChild);
  var ov=document.getElementById('tip-auth'),btn=document.getElementById('tip-au-btn'),msg=document.getElementById('tip-au-msg');
  function show(){ov.style.display='flex';}
  btn.addEventListener('click',function(){msg.textContent='登录中…';window.appData.login(document.getElementById('tip-au-u').value,document.getElementById('tip-au-p').value).then(function(){ov.style.display='none';location.reload();}).catch(function(e){msg.textContent='登录失败：'+((e&&e.message)||e);});});
  window.addEventListener('tip:auth-required',show);
  if(!window.appData.isLoggedIn())show();
}
if(document.readyState!=='loading')mountGate();else document.addEventListener('DOMContentLoaded',mountGate);
})();</script>`;
  if (html.includes('</head>')) return html.replace('</head>', js + '</head>');
  return html.replace('<body>', '<body>' + js);
}
