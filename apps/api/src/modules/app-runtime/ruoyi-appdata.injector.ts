/**
 * 若依版 appData 注入器（适配器②）。
 *
 * 思想动力生成的前端（文字生成 / 截图复刻 都产 daisyUI HTML）统一用平台注入的全局 `appData`
 * （list/get/create/update/remove）读写数据，**不写死后端 URL**（见 cloudecode injectAppDataClient 路B 版）。
 * 本注入器产一个**同接口、背后调若依**的 appData，于是"好看的定制前端"能跑在"若依真数据 + RBAC/数据权限"上——
 * 前端 HTML 一行不改，只换 appData 实现（按项目 backendRuntime 在路B / 若依间切）。
 *
 * 鉴权：脚本读全局 `window.__RUOYI_TOKEN__`（由 serve 层服务端登录若依后注入），**不把账号密码放进浏览器**。
 *   - 私有化交付：画像页随若依前端走、用若依会话 token；
 *   - 售前演示：思想动力 serve 时注入短时 token。
 * 资源名 → 若依端点：默认 `/system/<resource>`（若依 codegen 去 demo_ 前缀后的业务名）；可用 resourceMap 覆盖。
 */
export interface RuoyiAppDataOptions {
  /** 若依实例地址；同源托管（画像页在若依里）时可留空走相对路径 */
  baseUrl?: string;
  clientId: string;
  /** 资源名 → 若依业务路径覆盖（如 {member:'member', 'demoMember':'member'}）；缺省 `/system/<resource>` */
  resourceMap?: Record<string, string>;
}

/** 生成若依版 appData 的 <script>（与路B 版同接口；list→{items,total}，写操作失败抛错）。 */
export function buildRuoyiAppDataScript(opts: RuoyiAppDataOptions): string {
  const base = (opts.baseUrl || '').replace(/\/$/, '');
  const cid = opts.clientId || '';
  const map = JSON.stringify(opts.resourceMap || {});
  return `<script>/* appData: 若依后端数据接口客户端 (适配器②) */
(function(){
  var BASE=${JSON.stringify(base)}, CID=${JSON.stringify(cid)}, MAP=${map};
  function ep(resource){return BASE+'/system/'+(MAP[resource]||resource);}
  function headers(){var h={'Content-Type':'application/json'};var t=window.__RUOYI_TOKEN__;if(t)h['Authorization']='Bearer '+t;if(CID)h['clientid']=CID;return h;}
  function toQuery(o){o=o||{};var p=[];p.push('pageNum='+encodeURIComponent(o.page||1));p.push('pageSize='+encodeURIComponent(o.pageSize||10));var f=o.filters||{};for(var k in f){if(Object.prototype.hasOwnProperty.call(f,k))p.push(encodeURIComponent(k)+'='+encodeURIComponent(f[k]));}return '?'+p.join('&');}
  async function req(method,url,body){var res=await fetch(url,{method:method,headers:headers(),body:body!=null?JSON.stringify(body):undefined});var json=await res.json().catch(function(){return {};});if(!res.ok||(json&&json.code&&json.code!==200)){throw new Error((json&&json.msg)||res.statusText||('HTTP '+res.status));}return json;}
  window.appData={
    list:function(resource,opts){return req('GET',ep(resource)+'/list'+toQuery(opts)).then(function(r){return {items:r.rows||[],total:r.total||0,page:(opts&&opts.page)||1,pageSize:(opts&&opts.pageSize)||10};}).catch(function(){return {items:[],total:0,page:1,pageSize:10};});},
    get:function(resource,id){return req('GET',ep(resource)+'/'+encodeURIComponent(id)).then(function(r){return r.data;});},
    create:function(resource,data){return req('POST',ep(resource),data).then(function(r){return r.data!=null?r.data:true;});},
    update:function(resource,id,data){var b={};for(var k in data){if(Object.prototype.hasOwnProperty.call(data,k))b[k]=data[k];}b.id=id;return req('PUT',ep(resource),b).then(function(){return true;});},
    remove:function(resource,id){return req('DELETE',ep(resource)+'/'+encodeURIComponent(id)).then(function(){return true;});}
  };
})();
</script>`;
}

/** 去掉已注入的 appData 脚本（路B 或若依）与 token 脚本，避免重复注入（serve 时换实现用）。 */
export function stripAppData(html: string): string {
  return html
    .replace(/<script>\/\* appData:[\s\S]*?<\/script>/g, '')
    .replace(/<script>window\.__RUOYI_TOKEN__=[\s\S]*?<\/script>/g, '');
}

/** 把若依版 appData（+可选 token）注入 HTML 的 <head>，覆盖任何已存在的路B appData。 */
export function injectRuoyiAppData(html: string, opts: RuoyiAppDataOptions & { token?: string }): string {
  const tokenScript = opts.token
    ? `<script>window.__RUOYI_TOKEN__=${JSON.stringify(opts.token)};</script>\n`
    : '';
  const js = tokenScript + buildRuoyiAppDataScript(opts);
  if (html.includes('</head>')) return html.replace('</head>', js + '\n</head>');
  const bodyOpen = html.match(/<body[^>]*>/);
  if (bodyOpen) return html.replace(bodyOpen[0], bodyOpen[0] + '\n' + js);
  return js + html;
}
