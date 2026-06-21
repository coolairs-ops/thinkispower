/**
 * appData 客户端注入（模板产物用）。与 cloudecode.injectAppDataClient 同契约，
 * 独立一份避免 app-runtime ↔ cloudecode 循环依赖。指向 /api/app/<pid>/，含 evaluate(形态B)。
 */
export function injectAppData(html: string, projectId: string): string {
  const safeId = projectId.replace(/[^a-zA-Z0-9-]/g, '');
  const js = `<script>(function(){var BASE='/api/app/${safeId}/';
function toQuery(o){o=o||{};var p=[];if(o.page)p.push('page='+encodeURIComponent(o.page));if(o.pageSize)p.push('pageSize='+encodeURIComponent(o.pageSize));if(o.sort)p.push('sort='+encodeURIComponent(o.sort));var f=o.filters||{};for(var k in f){if(Object.prototype.hasOwnProperty.call(f,k))p.push(encodeURIComponent(k)+'='+encodeURIComponent(f[k]));}return p.length?('?'+p.join('&')):'';}
async function req(m,p,b){var res=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json'},body:b!=null?JSON.stringify(b):undefined});var j=await res.json().catch(function(){return {};});if(!res.ok){throw new Error((j&&j.error&&j.error.message)||res.statusText);}return j;}
window.appData={
list:function(r,o){return req('GET',r+toQuery(o)).then(function(x){return {items:x.data||[],total:x.total||0,page:x.page||1,pageSize:x.pageSize||0};}).catch(function(){return {items:[],total:0,page:1,pageSize:0};});},
get:function(r,id){return req('GET',r+'/'+encodeURIComponent(id)).then(function(x){return x.data;});},
create:function(r,d){return req('POST',r,d).then(function(x){return x.data;});},
update:function(r,id,d){return req('PATCH',r+'/'+encodeURIComponent(id),d).then(function(x){return x.data;});},
remove:function(r,id){return req('DELETE',r+'/'+encodeURIComponent(id)).then(function(){return true;});},
evaluate:function(r,id){return req('GET','_evaluate/'+encodeURIComponent(r)+'/'+encodeURIComponent(id)).then(function(x){return x&&x.ruleEngineEnabled?x:null;}).catch(function(){return null;});},
knowledge:function(){return req('GET','_knowledge').catch(function(){return {sources:[],evidences:[],facts:[],trace:[]};});},
ask:function(q){return req('POST','_qa',{question:q}).then(function(x){return (x&&x.answer)||'';}).catch(function(){return '';});}
};})();</script>`;
  if (html.includes('</head>')) return html.replace('</head>', js + '</head>');
  return html.replace('<body>', '<body>' + js);
}
