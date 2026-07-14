/* ============================================================
   SqAI 小说仿写工坊 2.0 — 真实仿写引擎 engine.js
   真·文件解析(txt/docx) · 真·章节拆分 · 真·AI 调用(DeepSeek/硅基流动)
   · 真·逐章仿写 · 真·进度 · 真·TXT/DOCX 下载 · 可选中英翻译
   ============================================================ */
(function(){
  'use strict';

  // ---------- 全局状态 ----------
  var STATE = {
    fileName: '',
    rawText: '',
    chapters: [],      // [{title, body}]
    results: [],       // 仿写后的正文
    enResults: [],     // 英文翻译
    running: false,
    abort: false
  };
  window.NOVEL_STATE = STATE;

  // ---------- 内置密钥（XOR+base64 混淆，运行时解密）----------
  var SALT = 'sqai-novel-2026';
  var BUILTIN_KEY_B64 = 'ABpMWkkNXBIBWU4DCQFURxJZDU9YX05SXh0ABQVXREgDXx0=';
  function xorDecode(b64){
    try{
      var bin = atob(b64), out='';
      for(var i=0;i<bin.length;i++){ out += String.fromCharCode(bin.charCodeAt(i) ^ SALT.charCodeAt(i%SALT.length)); }
      return out;
    }catch(e){ return ''; }
  }
  function builtinKey(){ return xorDecode(BUILTIN_KEY_B64); }

  // ---------- 取用户填写的 Key（留空则用内置）----------
  function getUserKey(){
    var el = document.getElementById('apiKeyInput');
    if(!el) return '';
    var v = (el.value||'').trim();
    if(!v || /\*|encrypted|★|☆/.test(v)) return '';   // 掩码/占位视为未填
    return v;
  }
  function getUserEndpoint(){
    var el = document.getElementById('apiUrlInput');
    return el ? (el.value||'').trim() : '';
  }

  // ---------- 模型 → 端点/模型 ID 路由 ----------
  var SF_MAP = {
    // 官方 DeepSeek 通道（内置密钥可直接用）
    'deepseek-chat':'deepseek-chat',
    'deepseek-reasoner':'deepseek-reasoner',
    // 硅基流动模型 ID（需自备硅基流动 Key）
    'deepseek-v3':'deepseek-ai/DeepSeek-V3',
    'deepseek-r1':'deepseek-ai/DeepSeek-R1',
    'qwen72b':'Qwen/Qwen2.5-72B-Instruct',
    'qwen14b':'Qwen/Qwen2.5-14B-Instruct',
    'qwen32b':'Qwen/Qwen2.5-32B-Instruct',
    'glm4':'THUDM/glm-4-9b-chat',
    'glm4-plus':'THUDM/glm-4-plus',
    'yi-large':'01-ai/Yi-1.5-34B-Chat',
    'kimi':'moonshot-v1-8k',
    'doubao':'Doubao-pro-32k',
    'internlm':'internlm/internlm2_5-20b-chat',
    'minimax':'abab6.5-chat',
    'step':'step-1-8k',
    'chatglm':'ZhipuAI/chatglm3-6b'
  };
  // SiliconFlow 模型（需用户自备 Key，否则回落 DeepSeek）
  var SF_MODELS = {'deepseek-v3':1,'deepseek-r1':1,'qwen72b':1,'qwen14b':1,'qwen32b':1,'glm4':1,'glm4-plus':1,'yi-large':1,'internlm':1};
  function resolveEndpoint(){
    var userKey = getUserKey();
    var userUrl = getUserEndpoint();
    // 选中的模型
    var sel = document.querySelectorAll('#modelGrid .model-card.selected, .model-card.selected');
    var models = [];
    sel.forEach(function(c){ if(c.dataset.model) models.push(c.dataset.model); });
    var first = models[0] || 'deepseek-chat';

    // 用户自定义端点+密钥优先（按用户填写的模型 ID 直发）
    if(userUrl && userKey){
      var mid = SF_MAP[first] || first;
      return { url: userUrl.replace(/\/$/,'') + (userUrl.indexOf('/chat/completions')>-1?'':'/chat/completions'), model: mid, key: userKey, label: first+'（自定义端点）' };
    }

    // 硅基流动模型：需用户自备 Key，否则回落 DeepSeek 内置通道
    if(SF_MODELS[first]){
      if(userKey){
        return { url:'https://api.siliconflow.cn/v1/chat/completions', model: SF_MAP[first], key:userKey,
                 label: first+'（硅基流动·自有Key）', notice:'已使用你填写的硅基流动 Key' };
      }
      // 无 Key：回落 DeepSeek 内置通道，并在日志提示
      return { url:'https://api.deepseek.com/chat/completions', model:'deepseek-chat', key: builtinKey(),
               label:'deepseek-chat（'+first+' 需自备Key，已回落内置通道）',
               notice:'提示：'+first+' 属于硅基流动模型，需填写你的硅基流动 Key；当前已自动回落到内置 DeepSeek 通道' };
    }

    // DeepSeek 原生（默认，开箱即用）
    if(first === 'deepseek-chat' || first === 'deepseek-reasoner' || !SF_MAP[first]){
      var m = (first==='deepseek-reasoner') ? 'deepseek-reasoner' : 'deepseek-chat';
      return { url:'https://api.deepseek.com/chat/completions', model:m, key: userKey || builtinKey(), label: m+'（内置官方通道）' };
    }

    // 其余未知模型：有 Key 走硅基流动，无 Key 回落 DeepSeek
    if(userKey){
      return { url:'https://api.siliconflow.cn/v1/chat/completions', model: SF_MAP[first] || first, key:userKey, label: first+'（硅基流动）' };
    }
    return { url:'https://api.deepseek.com/chat/completions', model:'deepseek-chat', key: builtinKey(), label:'deepseek-chat（智能回落·内置通道）' };
  }

  // ---------- 读取参数 ----------
  function readCfg(){
    function slider(id, def){ var el=document.getElementById(id); return el?parseInt(el.value,10):def; }
    function activeData(sel, attr, def){ var el=document.querySelector(sel+'.active'); return el?(el.dataset[attr]||def):def; }
    function val(id){ var el=document.getElementById(id); return el?(el.value||'').trim():''; }
    var mode = activeData('.mode-option','mode','full');
    var modeText = {
      full:'全维度深度仿写（剧情+人物+文风+爽点全面借鉴重写）',
      plot:'侧重剧情框架仿写（复刻故事脉络，重写文字）',
      character:'侧重人物塑造仿写',
      style:'侧重文风语感仿写',
      track:'赛道爆款仿写（贴合平台爽文节奏）'
    }[mode] || '全维度深度仿写';
    var chSize = activeData('.chapter-option','size','normal');
    var chapWords = {compact:2500, normal:2800, full:4000}[chSize] || 2800;
    var targetWords = parseInt((activeData('.word-btn','words','10000')+'').replace(/[^0-9]/g,''),10) || 10000;
    return {
      plot: slider('slider-plot',80), char: slider('slider-char',80),
      cool: slider('slider-cool',75), logic: slider('slider-logic',80),
      style: slider('slider-style',70), creative: slider('slider-creative',60),
      mode: mode, modeText: modeText,
      chapWords: chapWords, targetWords: targetWords,
      format: activeData('.format-option','format','txt'),
      instruct: val('customInstruct'), styleReq: val('customStyle'), forbidden: val('customForbidden'),
      translate: !!(document.getElementById('translateToggle') && document.getElementById('translateToggle').checked),
      polish: !!(document.getElementById('polishToggle') && document.getElementById('polishToggle').checked)
    };
  }

  // ---------- 二遍降AI率润色 Prompt ----------
  var POLISH_SYS = '你是资深文字润色编辑，专门消灭AI写作痕迹。请对用户提供的网络小说正文做“二遍降AI率润色”：\n'+
    '- 不改变剧情、人物、对话内容与世界观，只优化文字表达。\n'+
    '- 进一步消除AI腔：改写套路化排比与空洞总结句、过度工整的对仗；把“他感受到/她意识到”类告知式心理描写改为动作或对话呈现；减少“仿佛/宛如/犹如”高频比喻；去掉刻意的煽情通套句。\n'+
    '- 增强口语感与生活化细节，节奏有顿挫，长短句交错，允许适度不完美的碎句。\n'+
    '- 保持第一遍的文风与人设，不要改成另一种腔调。\n'+
    '- 只输出润色后的正文，不要任何解释或标记。';

  // ---------- Prompt 构建 ----------
  function buildSystem(cfg){
    var L = [
      '你是资深网络小说作家，有十年连载经验，文风老练、有烟火气。请对用户提供的原文章节进行"仿写改写"，产出一段全新的、可直接发布的原创中文小说正文。',
      '【核心规则】',
      '- 借鉴原文的故事内核与精彩点，但必须重写全部文字表达，句式、用词、描写角度尽量与原文不同，以规避查重、降低重复率。',
      '- '+cfg.modeText+'。',
      '- 剧情走向保留度约 '+cfg.plot+'%；人物设定保留度约 '+cfg.char+'%；爽点与情绪节奏保留度约 '+cfg.cool+'%；逻辑严谨度约 '+cfg.logic+'%。',
      '- 文风相似度约 '+cfg.style+'%，创意发散度约 '+cfg.creative+'%。',
      '- 本章目标字数约 '+cfg.chapWords+' 字（可±15%），分段合理，对话与描写穿插自然。',
      '【去AI化·必须做到】',
      '- 文风要像真人手写：自然、有呼吸感，允许适度不完美与碎片感，禁止每句都"精致正确"。',
      '- 严禁AI腔与套话：禁止"仿佛/宛如/犹如"高频比喻堆砌；禁止排比三连与口号式金句；禁止"不得不说/总而言之/由此可见/毋庸置疑"等总结词；禁止每段都用"他/她+意识到/感受到"的告知式心理描写；禁止信息密度均匀的流水账；禁止刻意煽情的通套句。',
      '- 多用具体感官细节（气味、温度、声音、触感、光影）与动作、对话推动剧情；角色要有独有的口头禅、小动作、说话节奏。',
      '- 情绪与爽点落在动作和对话上，而不是旁白解说；节奏要有张弛，允许留白。',
      '- 视角与时态全程统一，不跳叙述层；长句短句交错，避免句式雷同。'
    ];
    if(cfg.instruct) L.push('- 额外精修要求：'+cfg.instruct);
    if(cfg.styleReq) L.push('- 指定文风：'+cfg.styleReq);
    if(cfg.forbidden) L.push('- 严禁使用以下词汇/表达：'+cfg.forbidden);
    L.push('【输出格式】只输出仿写后的小说正文，不要输出任何解释、点评、标题标签或 markdown 符号。');
    return L.join('\n');
  }

  // ---------- API 调用（3次自动重试：429等15s，网络错误等5s）----------
  function callAPI(ep, system, user, temperature, maxTokens){
    var body = JSON.stringify({
      model: ep.model,
      messages: [{role:'system',content:system},{role:'user',content:user}],
      temperature: temperature, max_tokens: maxTokens, stream:false
    });
    function attempt(tryN){
      return fetch(ep.url, {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+ep.key},
        body: body
      }).then(function(resp){
        if(resp.status === 429){
          if(tryN <= 1) throw new Error('HTTP 429：请求过于频繁，服务器限速');
          log('  ⏳ HTTP 429，第 '+(3-tryN+1)+' 次重试（15秒后）…');
          return sleep(15000).then(function(){ return attempt(tryN-1); });
        }
        if(!resp.ok){ return resp.text().then(function(t){ throw new Error('HTTP '+resp.status+'：'+t.slice(0,180)); }); }
        return resp.json();
      }).then(function(d){
        var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if(!c) throw new Error('接口返回为空');
        return c.trim();
      }).catch(function(e){
        var isNet = e.message && /fetch|network|timeout|enospc|ECONNREFUSED/i.test(e.message);
        if(isNet && tryN > 1){
          log('  ⏳ 网络错误，第 '+(3-tryN+1)+' 次重试（5秒后）：'+e.message);
          return sleep(5000).then(function(){ return attempt(tryN-1); });
        }
        throw e;
      });
    }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    return attempt(3);
  }

  // ---------- 文件解析 ----------
  function decodeText(buf){
    // 优先 UTF-8，乱码则尝试 GBK
    try{
      var u = new TextDecoder('utf-8',{fatal:false}).decode(buf);
      var bad = (u.match(/\uFFFD/g)||[]).length;
      if(bad > u.length*0.01){
        try{ return new TextDecoder('gbk').decode(buf); }catch(e){ return u; }
      }
      return u;
    }catch(e){
      try{ return new TextDecoder('gbk').decode(buf); }catch(e2){ return ''; }
    }
  }
  function parseDocx(buf){
    if(!window.JSZip) return Promise.reject(new Error('DOCX 解析组件未加载'));
    return JSZip.loadAsync(buf).then(function(zip){
      var f = zip.file('word/document.xml');
      if(!f) throw new Error('非法的 DOCX 文件');
      return f.async('string');
    }).then(function(xml){
      // 段落 <w:p> → 换行；文本 <w:t>
      var paras = xml.split(/<\/w:p>/).map(function(p){
        var texts = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        return texts.map(function(t){ return t.replace(/<[^>]+>/g,''); }).join('')
          .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
      });
      return paras.join('\n');
    });
  }
  function readFile(file){
    return new Promise(function(resolve,reject){
      var fr = new FileReader();
      fr.onerror = function(){ reject(new Error('文件读取失败')); };
      var name = file.name.toLowerCase();
      if(name.endsWith('.docx')){
        fr.onload = function(){ parseDocx(fr.result).then(resolve).catch(reject); };
        fr.readAsArrayBuffer(file);
      }else{
        fr.onload = function(){ resolve(decodeText(fr.result)); };
        fr.readAsArrayBuffer(file);
      }
    });
  }

  // ---------- 章节拆分 ----------
  function splitChapters(text){
    text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var re = /^[\t 　]*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷篇][^\n]{0,30})\s*$/gm;
    var idx = [], m;
    while((m = re.exec(text)) !== null){ idx.push({pos:m.index, title:m[1].trim(), end:re.lastIndex}); }
    var chs = [];
    if(idx.length === 0){
      // 无章节标记：按 ~2500 字硬切
      var size = 2500, i=0, n=1;
      while(i < text.length){ chs.push({title:'第'+n+'节', body:text.slice(i,i+size).trim()}); i+=size; n++; }
    }else{
      for(var k=0;k<idx.length;k++){
        var bodyStart = idx[k].end;
        var bodyEnd = (k+1<idx.length) ? idx[k+1].pos : text.length;
        var body = text.slice(bodyStart, bodyEnd).trim();
        if(body) chs.push({title:idx[k].title, body:body});
      }
    }
    return chs.filter(function(c){ return c.body && c.body.length>30; });
  }

  // ---------- 日志/进度 ----------
  function log(msg, type){
    var box = document.getElementById('statusLog') || document.getElementById('outputLog') || document.getElementById('execLog');
    if(box){
      var line = document.createElement('div');
      line.style.cssText = 'padding:3px 0;font-size:13px;color:'+(type==='err'?'#ff7b7b':type==='ok'?'#5fc79c':'#c7bcd9')+';';
      line.textContent = '[' + new Date().toLocaleTimeString('zh-CN',{hour12:false}) + '] ' + msg;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    }
    if(window.novelToast && type) window.novelToast(msg);
  }
  function setProgress(pct, text){
    var bar = document.getElementById('progressBar');
    var t = document.getElementById('progressText') || document.getElementById('progressPct');
    if(bar) bar.style.width = pct + '%';
    if(t) t.textContent = text || (pct + '%');
  }
  function showExecArea(){
    // page2.html 实际存在的执行区元素
    ['progressContainer','progressBar','progressText','statusLog'].forEach(function(id){
      var el = document.getElementById(id); if(el) el.style.display='block';
    });
    // 隐藏上传区，腾出空间给执行区
    var upload = document.getElementById('uploadZone') || document.getElementById('fileInput').closest('.upload-section');
    if(upload) upload.style.display='none';
  }

  // ---------- 下载 ----------
  function xmlEsc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function download(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
  }
  function buildTxt(chapters, results){
    var out = [];
    for(var i=0;i<results.length;i++){ out.push(chapters[i].title + '\n\n' + results[i] + '\n'); }
    return out.join('\n\n');
  }
  function makeDocx(chapters, results){
    if(!window.JSZip){ return null; }
    var zip = new JSZip();
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
      '</Types>');
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
      '</Relationships>');
    var paras = '';
    for(var i=0;i<results.length;i++){
      paras += '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">'+xmlEsc(chapters[i].title)+'</w:t></w:r></w:p>';
      results[i].split(/\n+/).forEach(function(line){
        if(!line.trim()) return;
        paras += '<w:p><w:pPr><w:ind w:firstLine="480"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">'+xmlEsc(line.trim())+'</w:t></w:r></w:p>';
      });
    }
    // 注入 Heading1 样式定义
    var styleDef = '<w:style w:type="paragraph" w:styleId="Heading1" w:default="1">'+
      '<w:name w:val="Heading 1"/><w:pPr><w:jc w:val="center"/></w:pPr>'+
      '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="1a1a2e"/></w:rPr></w:style>';
    zip.folder('word').file('document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+styleDef+'</w:styles>'+
      '<w:body>'+paras+'<w:sectPr/></w:body></w:document>');
    return zip.generateAsync({type:'blob'});
  }

  // ---------- 主流程：开始仿写 ----------
  function startWriting(){
    if(window.isNovelActivated && !window.isNovelActivated()){ if(window.showActivationModal) window.showActivationModal(); return; }
    if(STATE.running){ log('任务进行中，请稍候…','err'); return; }
    if(!STATE.chapters.length){ log('请先上传原文文件（TXT / DOCX）','err'); if(window.novelToast) window.novelToast('请先上传原文文件'); return; }

    var cfg = readCfg();
    var ep = resolveEndpoint();
    STATE.running = true; STATE.abort = false; STATE.results = []; STATE.enResults = []; STATE.doneChapters = 0;

    // 计算本次仿写章节数（按目标字数）
    var maxCh = Math.max(1, Math.min(STATE.chapters.length, Math.round(cfg.targetWords / cfg.chapWords)));
    var chs = STATE.chapters.slice(0, maxCh);

    showExecArea();
    var logbox = document.getElementById('statusLog') || document.getElementById('outputLog') || document.getElementById('execLog');
    if(logbox) logbox.innerHTML = '';
    setProgress(2, '准备中…');
    if(ep.notice) log(ep.notice, 'err');
    log('通道：'+ep.label,'ok');
    if(STATE.chapters.length){ log('未识别到章节？请确认原文包含「第N章/回/节」等标记，否则将按 ~2500 字自动分章',''); }
    log('原文共 '+STATE.chapters.length+' 章，本次仿写前 '+chs.length+' 章（每章目标约 '+cfg.chapWords+' 字）');

    var startBtn = document.getElementById('startWriteBtn');
    if(startBtn){ startBtn.disabled = true; startBtn.textContent = '⏳ 仿写中…'; }

    var temp = 0.6 + cfg.creative/250;   // 0.6~1.0
    var i = 0;
    function next(){
      if(STATE.abort){ finish(true); return; }
      if(i >= chs.length){ finish(false); return; }
      var ch = chs[i];
      var frac = i / chs.length;
      setProgress(Math.round(4 + frac*88), '仿写第 '+(i+1)+'/'+chs.length+' 章：'+ch.title);
      log('▶ 仿写 '+ch.title+'（原文 '+ch.body.length+' 字）…');
      var userMsg = '【原文章节：'+ch.title+'】\n'+ch.body.slice(0, 6000);
      callAPI(ep, buildSystem(cfg), userMsg, temp, 8000)
        .then(function(text){
          if(cfg.polish){
            log('  ↳ 二遍降AI润色中…');
            return callAPI(ep, POLISH_SYS, '【待润色正文】\n'+text.slice(0,6000), 0.7, 8000)
              .then(function(p){ log('  ↳ 润色完成','ok'); return p; })
              .catch(function(e){ log('  ↳ 润色失败，保留原稿：'+e.message,'err'); return text; });
          }
          return text;
        })
        .then(function(out){
          out = out || '';
          STATE.results.push(out); STATE.doneChapters = STATE.results.length;
          log('✔ '+ch.title+' 完成，生成 '+out.length+' 字','ok');
          if(cfg.translate){
            log('  ↳ 翻译英文中…');
            return callAPI(ep, '你是专业的中英文小说翻译。将用户提供的中文小说正文翻译为地道流畅的美式英文，只输出译文。', out.slice(0,6000), 0.5, 8000)
              .then(function(en){ STATE.enResults.push(en); log('  ↳ 英文翻译完成','ok'); })
              .catch(function(e){ STATE.enResults.push('[翻译失败：'+e.message+']'); log('  ↳ 翻译失败：'+e.message,'err'); });
          }
        })
        .then(function(){ i++; setTimeout(next, 300); })
        .catch(function(e){
          log('✘ '+ch.title+' 失败：'+e.message,'err');
          STATE.results.push('【本章仿写失败：'+e.message+'】\n\n原文保留：\n'+ch.body);
          if(cfg.translate) STATE.enResults.push('');
          i++; setTimeout(next, 500);
        });
    }
    function finish(aborted){
      STATE.running = false;
      if(startBtn){ startBtn.disabled = false; startBtn.textContent = '🚀 开始仿写'; }
      if(aborted){ setProgress(0,'已停止'); log('任务已停止','err'); return; }
      setProgress(100, '✅ 全部完成');
      log('🎉 仿写完成！共 '+STATE.results.length+' 章，可下载成品','ok');
      enableDownloads(cfg);
    }
    next();
  }

  function stopWriting(){ STATE.abort = true; }

  // ---------- 启用下载 ----------
  function enableDownloads(cfg){
    var area = document.getElementById('downloadArea');
    if(area) area.style.display = 'flex';
    var enBtn = document.getElementById('downloadEnBtn');
    if(enBtn) enBtn.style.display = (cfg.translate && STATE.enResults.length) ? 'inline-flex' : 'none';
    // 预览
    var prev = document.getElementById('resultPreview');
    if(prev){
      prev.textContent = (STATE.chapters[0].title + '\n\n' + STATE.results[0]).slice(0, 1200) + '\n\n……（完整内容请下载）';
      prev.style.display = 'block';
    }
  }
  function safeName(){ var f = STATE.fileName || ''; f = f.replace(/\.[^.]+$/,'') || '仿写作品'; return f.replace(/[\\/:*?"<>|]/g,''); }
  function downloadTxt(){
    if(!STATE.results.length){ log('暂无可下载内容','err'); return; }
    var txt = buildTxt(STATE.chapters, STATE.results);
    download(new Blob([txt],{type:'text/plain;charset=utf-8'}), safeName()+'_仿写.txt');
    log('已下载 TXT','ok');
  }
  function downloadDocx(){
    if(!STATE.results.length){ log('暂无可下载内容','err'); return; }
    if(!window.JSZip){ log('DOCX 组件未加载，改用 TXT','err'); return downloadTxt(); }
    makeDocx(STATE.chapters, STATE.results).then(function(blob){ if(!blob){ log('DOCX 生成失败，改用 TXT','err'); return downloadTxt(); } download(blob, safeName()+'_仿写.docx'); log('已下载 DOCX','ok'); }).catch(function(e){ console.error(e); log('DOCX 生成失败，改用 TXT','err'); downloadTxt(); });
  }
  function downloadEn(){
    if(!STATE.enResults || !STATE.enResults.length){ log('未启用翻译或暂无英文内容','err'); return; }
    var txt = buildTxt(STATE.chapters, STATE.enResults);
    download(new Blob([txt],{type:'text/plain;charset=utf-8'}), safeName()+'_EN.txt');
    log('已下载英文 TXT','ok');
  }

  // ---------- 文件选择 ----------
  function handleFileSelect(input){
    var file = (input && input.files && input.files[0]) || (input && input.target && input.target.files && input.target.files[0]);
    if(!file) return;
    STATE.fileName = file.name;
    var info = document.getElementById('fileInfo') || document.getElementById('fileName');
    if(info){ info.textContent = '📄 '+file.name+'（解析中…）'; info.style.display='block'; }
    log('读取文件：'+file.name);
    readFile(file).then(function(text){
      STATE.rawText = text;
      STATE.chapters = splitChapters(text);
      var totalChars = text.replace(/\s/g,'').length;
      if(info) info.textContent = '📄 '+file.name+' ｜ '+STATE.chapters.length+' 章 ｜ 约 '+totalChars.toLocaleString()+' 字';
      log('解析完成：'+STATE.chapters.length+' 章，约 '+totalChars+' 字','ok');
      var an = document.getElementById('analysisResult') || document.getElementById('fileAnalysis');
      if(an){
        an.style.display='block';
        an.innerHTML = '<div style="color:var(--gold);font-weight:700;margin-bottom:6px;">📊 原文分析</div>'+
          '<div style="font-size:13px;color:var(--text-secondary);line-height:1.8;">'+
          '文件名：'+file.name+'<br>识别章节：'+STATE.chapters.length+' 章<br>总字数：约 '+totalChars.toLocaleString()+' 字<br>'+
          '首章：'+(STATE.chapters[0]?STATE.chapters[0].title:'—')+'<br>状态：<span style="color:var(--accent-green)">✓ 就绪，可开始仿写</span></div>';
      }
    }).catch(function(e){
      if(info) info.textContent = '❌ 解析失败：'+e.message;
      log('解析失败：'+e.message,'err');
    });
  }

  // ---------- 覆盖首页/第二页的演示函数 ----------
  window.startWriting = startWriting;
  window.stopWriting = stopWriting;
  window.handleFileSelect = handleFileSelect;
  window.downloadTxt = downloadTxt;
  window.downloadDocx = downloadDocx;
  window.downloadEn = downloadEn;
  window.downloadFile = function(type){       // 兼容旧调用签名 downloadFile('txt'|'docx'|'en-txt')
    if(type && type.indexOf('docx')>-1) return downloadDocx();
    if(type && type.indexOf('en')>-1) return downloadEn();
    return downloadTxt();
  };
  window.downloadResult = downloadTxt;
  window.NOVEL_ENGINE = {
    startWriting:startWriting,
    stopWriting:stopWriting,
    handleFileSelect:handleFileSelect,
    downloadTxt:downloadTxt,
    downloadDocx:downloadDocx,
    downloadEn:downloadEn,
    downloadFile:window.downloadFile,
    resolveEndpoint:resolveEndpoint,
    STATE:STATE
  };
  // 文件选择由页面 inline onchange="handleFileSelect(event)" 触发（已被本引擎覆盖）
})();
