/**
 * 终端用户登录门浮层（适配器②·A 架构，P1b）。
 *
 * 自包含的一段 <script>，与 appData 客户端同层注入——**生成的业务 HTML 一行不改**：
 *   - 首次进入若依应用且未登录 → 自动弹登录框；
 *   - 使用中 session 过期（appData 在 401 时发 `tip:auth-required` 事件）→ 再弹；
 *   - 提交 → 调 `window.appData.login(u,p)`（平台换本人 token 存服务端、回 session）→ 成功后 reload，
 *     页面以本人身份重新拉数据（data_scope 生效）。
 *
 * 只对若依后端的应用注入（serve 层按 backendRuntime 决定）；路 B 公开应用不注入、行为不变。
 * 无框架、内联样式，避免依赖业务页的 CSS/JS。
 */
export function buildLoginGateScript(appName = '应用'): string {
  return `<script>/* tip-login-gate: 终端用户登录门（若依后端·A 架构） */
(function(){
  if(window.__tipLoginGate)return; window.__tipLoginGate=1;
  var APP=${JSON.stringify(appName)};
  var shown=false;
  function show(){
    if(shown||!window.appData||!window.appData.login)return; shown=true;
    var ov=document.createElement('div'); ov.id='tip-login-ov';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif';
    // 用 div+按钮点击，不用 <form> 提交——预览 iframe 的 sandbox 常缺 allow-forms 会拦截表单提交导致"点了没反应"。
    ov.innerHTML='<div id="tip-login-card" style="background:#fff;padding:28px 26px;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.25);width:320px;max-width:90vw">'
      +'<div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:4px">登录 '+APP+'</div>'
      +'<div style="font-size:13px;color:#64748b;margin-bottom:18px">请用业务账号登录后查看数据</div>'
      +'<input id="tip-u" placeholder="用户名" autocomplete="username" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:10px;font-size:14px">'
      +'<input id="tip-p" type="password" placeholder="密码" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:6px;font-size:14px">'
      +'<div id="tip-err" style="color:#dc2626;font-size:12px;min-height:16px;margin-bottom:8px"></div>'
      +'<button type="button" id="tip-sub" style="width:100%;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:15px;cursor:pointer">登录</button>'
      +'</div>';
    document.body.appendChild(ov);
    var err=ov.querySelector('#tip-err'),sub=ov.querySelector('#tip-sub'),iu=ov.querySelector('#tip-u'),ip=ov.querySelector('#tip-p');
    function doLogin(){
      var u=(iu.value||'').trim(),p=ip.value||'';
      if(!u||!p){err.textContent='请输入用户名和密码';return;}
      sub.disabled=true;sub.textContent='登录中…';err.textContent='';
      window.appData.login(u,p).then(function(){location.reload();}).catch(function(e){sub.disabled=false;sub.textContent='登录';err.textContent=(e&&e.message)||'登录失败';});
    }
    sub.addEventListener('click',doLogin);
    function onEnter(e){if(e.key==='Enter'){e.preventDefault();doLogin();}}
    iu.addEventListener('keydown',onEnter);ip.addEventListener('keydown',onEnter);
    setTimeout(function(){iu.focus();},50);
  }
  window.addEventListener('tip:auth-required',show);
  function boot(){ if(!window.appData||!window.appData.isLoggedIn||!window.appData.isLoggedIn())show(); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
</script>`;
}

/** 把登录门注入 HTML（放 </body> 前，确保 document.body 已在、appData 已定义于 <head>）。 */
export function injectLoginGate(html: string, appName = '应用'): string {
  const js = buildLoginGateScript(appName);
  if (html.includes('</body>')) return html.replace('</body>', js + '\n</body>');
  return html + js;
}
