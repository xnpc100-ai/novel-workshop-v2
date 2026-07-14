/* ============================================================
   SqAI 菱形AI 小说仿写工坊 2.0 — 共享脚本
   卡密列表 · 激活校验 · 状态管理 · 弹窗
   ============================================================ */
(function(){
  'use strict';

  // ---- 内置卡密列表（有效期 2026-08-01）----
  var VALID_CARDS = [
    "XSGC846821648326","XSGC876987863001","XSGC368195359752","XSGC720747505985",
    "XSGC964193190457","XSGC918388928759","XSGC306981976111","XSGC266324828024",
    "XSGC402775789362","XSGC375222195728","XSGC702034457224","XSGC495303359045",
    "XSGC577672918699","XSGC944767186645","XSGC323407388928","XSGC853371980340",
    "XSGC969688494928","XSGC964027466218","XSGC931613355298","XSGC297874690706",
    "XSGC694751550015","XSGC761796023529","XSGC854866883878","XSGC243829739669",
    "XSGC242665633541","XSGC668247687588","XSGC334304745954","XSGC649278702253",
    "XSGC327593739259","XSGC835522648879","XSGC435332754308","XSGC963046706676",
    "XSGC803019609922","XSGC771916700820","XSGC956960206435","XSGC740428807897",
    "XSGC963683334852","XSGC744967748348","XSGC662761043859","XSGC548244246277",
    "XSGC706030078583","XSGC418010741671","XSGC936811509421","XSGC901816368893",
    "XSGC638877781220","XSGC770719161871","XSGC968220265435","XSGC234283592885",
    "XSGC680121186870","XSGC661945397716","XSGC964579184722","XSGC267801440594",
    "XSGC450571926124","XSGC601419158127","XSGC578856941735","XSGC968994752937",
    "XSGC803950033973","XSGC501035017657","XSGC824499743260","XSGC700012835667",
    "XSGC553180780519","XSGC455072999896","XSGC550830295620","XSGC417371104379",
    "XSGC874808097549","XSGC418811557137","XSGC311235738513","XSGC961354801153",
    "XSGC271282397006","XSGC442922940708","XSGC945438716849","XSGC492596742331"
  ];
  var CARD_EXPIRE = "2026-08-01";          // 卡密统一有效期
  var REMEMBER_DAYS = 7;                     // 记住激活状态天数
  var STORE_KEY = "sqai_novel_activation";  // localStorage key
  var WECHAT_ID = "xnpc01";

  // ---- 激活状态读取 ----
  function getActivation(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw) return null;
      var data = JSON.parse(raw);
      var now = Date.now();
      // 卡密自身有效期
      if(new Date(CARD_EXPIRE + "T23:59:59").getTime() < now) return null;
      // 记住状态过期（仅 remember=true 时检查 expireAt）
      if(data.remember && data.expireAt && data.expireAt < now) return null;
      // 不记住时（remember=false）：expireAt 为 null，视为当前浏览器会话有效
      // ——只要 localStorage 数据存在且未过期，就在当前 tab 内保持激活
      return data;
    }catch(e){ return null; }
  }

  function isActivated(){ return !!getActivation(); }

  function setActivation(code, remember){
    // 复用已有 session ID，避免每次激活刷新覆盖导致 getActivation 的 session 检查失效
    var prev = null;
    try{ prev = JSON.parse(localStorage.getItem(STORE_KEY)||'{}'); }catch(e){}
    var sid = (prev && prev.session) ? prev.session : ("s_" + Math.random().toString(36).slice(2) + Date.now());
    var data = {
      code: code,
      cardExpire: CARD_EXPIRE,
      activatedAt: Date.now(),
      remember: !!remember,
      expireAt: remember ? Date.now() + REMEMBER_DAYS*86400000 : null,
      session: sid
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    sessionStorage.setItem(STORE_KEY+"_s", sid);
  }

  function clearActivation(){
    localStorage.removeItem(STORE_KEY);
    sessionStorage.removeItem(STORE_KEY+"_s");
  }

  // ---- 校验卡密 ----
  function validateCard(code){
    code = (code||"").trim().toUpperCase();
    if(!code) return {ok:false,msg:"请输入激活密码"};
    if(!/^XSGC\d{12}$/.test(code)) return {ok:false,msg:"激活码格式不正确（应为 XSGC + 12 位数字）"};
    if(VALID_CARDS.indexOf(code) === -1) return {ok:false,msg:"激活码无效或不存在，请核对后重试"};
    if(new Date(CARD_EXPIRE + "T23:59:59").getTime() < Date.now())
      return {ok:false,msg:"该批次激活码已过有效期（"+CARD_EXPIRE+"）"};
    return {ok:true,msg:"激活成功！有效期至 "+CARD_EXPIRE};
  }

  // ---- Toast ----
  function toast(msg){
    var t = document.getElementById("globalToast");
    if(!t){
      t = document.createElement("div");
      t.id = "globalToast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove("show"); }, 2200);
  }

  // ---- 更新导航状态徽章 ----
  function refreshNavBadge(){
    var badge = document.getElementById("navStatusBadge");
    if(!badge) return;
    if(isActivated()){
      badge.textContent = "✓ 已激活";
      badge.className = "status-badge status-active";
      badge.onclick = null;
    }else{
      badge.textContent = "立即激活";
      badge.className = "status-badge status-inactive";
      badge.onclick = function(){ showActivationModal(); };
    }
  }

  // ---- 激活弹窗控制 ----
  function showActivationModal(){
    var m = document.getElementById("activationModal");
    if(m){ m.classList.add("show");
      var inp = document.getElementById("activationCode");
      if(inp) setTimeout(function(){ inp.focus(); }, 100);
    }
  }
  function hideActivationModal(){
    var m = document.getElementById("activationModal");
    if(m) m.classList.remove("show");
  }

  // ---- 微信付款弹窗 ----
  function showWechatPaymentModal(){
    var m = document.getElementById("wechatModal");
    if(m) m.classList.add("show");
  }
  function hideWechatPaymentModal(){
    var m = document.getElementById("wechatModal");
    if(m) m.classList.remove("show");
  }

  // ---- 处理激活 ----
  function handleActivation(){
    var codeEl = document.getElementById("activationCode");
    var errEl = document.getElementById("activationError");
    var okEl = document.getElementById("activationSuccess");
    var agreeEl = document.getElementById("agreeTerms");
    var rememberEl = document.getElementById("rememberActivation");
    if(errEl) errEl.textContent = "";
    if(okEl) okEl.textContent = "";

    if(agreeEl && !agreeEl.checked){
      if(errEl) errEl.textContent = "请先阅读并同意《用户协议与免责声明》";
      return;
    }
    var res = validateCard(codeEl ? codeEl.value : "");
    if(!res.ok){
      if(errEl) errEl.textContent = res.msg;
      return;
    }
    setActivation((codeEl.value||"").trim().toUpperCase(), rememberEl ? rememberEl.checked : true);
    if(okEl) okEl.textContent = res.msg;
    refreshNavBadge();
    toast("🎉 激活成功，全部高阶功能已解锁！");
    setTimeout(function(){
      hideActivationModal();
      var lock = document.getElementById("lockOverlay");
      if(lock) lock.classList.remove("show");
      // 触发页面自定义激活后逻辑（page2 用 NovelModule.onActivated 覆盖）
      if(typeof window.onActivated === "function") window.onActivated();
      if(window._postActivationHandlers){
        window._postActivationHandlers.forEach(function(fn){ try{ fn(); }catch(e){} });
      }
    }, 900);
  }

  // ---- 复制微信号 ----
  function copyWechat(){
    var text = WECHAT_ID;
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ toast("已复制客服微信：" + text); })
        .catch(function(){ fallbackCopy(text); });
    }else{ fallbackCopy(text); }
  }
  function fallbackCopy(text){
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); toast("已复制客服微信：" + text); }
    catch(e){ toast("请手动复制微信号：" + text); }
    document.body.removeChild(ta);
  }

  // ---- page2/page3 未激活拦截 ----
  function guardPage(){
    var lock = document.getElementById("lockOverlay");
    if(!lock) return;
    if(!isActivated()) lock.classList.add("show");
    else lock.classList.remove("show");
  }

  // ---- 导航"立即激活"点击：原地打开激活弹窗（不再跳首页）----
  function checkAndRedirect(){
    if(isActivated()){ toast("您已激活，可直接使用全部功能"); return; }
    // 始终在当前页原地弹窗激活，避免被打断跳走
    showActivationModal();
  }

  // ---- 初始化 ----
  function init(){
    refreshNavBadge();
    guardPage();
    // 点击遮罩关闭弹窗
    ["activationModal","wechatModal"].forEach(function(id){
      var m = document.getElementById(id);
      if(m){
        m.addEventListener("click", function(e){
          if(e.target === m){
            if(id==="activationModal") hideActivationModal();
            else hideWechatPaymentModal();
          }
        });
      }
    });
    // 回车提交激活
    var inp = document.getElementById("activationCode");
    if(inp){
      inp.addEventListener("keydown", function(e){ if(e.key==="Enter") handleActivation(); });
    }
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ---- 暴露到全局 ----
  window.showActivationModal = showActivationModal;
  window.hideActivationModal = hideActivationModal;
  window.showWechatPaymentModal = showWechatPaymentModal;
  window.hideWechatPaymentModal = hideWechatPaymentModal;
  window.handleActivation = handleActivation;
  window.copyWechat = copyWechat;
  window.copyWechatFromDetail = copyWechat;
  window.checkAndRedirect = checkAndRedirect;
  window.isNovelActivated = isActivated;
  window.clearNovelActivation = clearActivation;
  window.novelToast = toast;
  window.NOVEL_WECHAT = WECHAT_ID;
  // 跨页激活后回调注册器（比直接覆盖 window.onActivated 更安全）
  window._postActivationHandlers = window._postActivationHandlers || [];
})();
