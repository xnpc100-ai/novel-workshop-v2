/* ============================================================
   SqAI 小说仿写工坊 2.0 — 真实仿写引擎 engine.js
   · 实体替换系统（人名/地名/门派/朝代/武器全换）
   · 真·文件解析(txt/docx) · 真·章节拆分 · 真·AI调用
   · 真·逐章仿写 · 真·进度 · 真·TXT/DOCX下载
   ============================================================ */
(function(){
  'use strict';

  // ---------- 全局状态 ----------
  var STATE = {
    fileName: '',
    rawText: '',
    chapters: [],      // [{title, body}]
    entityMap: {},     // {original: replacement} per chapter
    results: [],       // 仿写后的正文
    enResults: [],     // 英文翻译
    running: false,
    abort: false,
    doneChapters: 0
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

  // ---------- 端点解析 ----------
  function getUserKey(){
    var el = document.getElementById('apiKeyInput');
    if(!el) return '';
    var v = (el.value||'').trim();
    if(!v || /\*|encrypted|★|☆/.test(v)) return '';
    return v;
  }
  function getUserEndpoint(){
    var el = document.getElementById('apiUrlInput');
    return el ? (el.value||'').trim() : '';
  }

  var SF_MAP = {
    'deepseek-chat':'deepseek-chat',
    'deepseek-reasoner':'deepseek-reasoner',
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
  var SF_MODELS = {'deepseek-v3':1,'deepseek-r1':1,'qwen72b':1,'qwen14b':1,'qwen32b':1,'glm4':1,'glm4-plus':1,'yi-large':1,'internlm':1};
  function resolveEndpoint(){
    var userKey = getUserKey();
    var userUrl = getUserEndpoint();
    var sel = document.querySelectorAll('#modelGrid .model-card.selected, .model-card.selected');
    var models = [];
    sel.forEach(function(c){ if(c.dataset.model) models.push(c.dataset.model); });
    var first = models[0] || 'deepseek-chat';
    if(userUrl && userKey){
      var mid = SF_MAP[first] || first;
      return { url: userUrl.replace(/\/$/,'') + (userUrl.indexOf('/chat/completions')>-1?'':'/chat/completions'), model: mid, key: userKey, label: first+'（自定义端点）' };
    }
    if(SF_MODELS[first]){
      if(userKey){
        return { url:'https://api.siliconflow.cn/v1/chat/completions', model: SF_MAP[first], key:userKey, label: first+'（硅基流动）' };
      }
      return { url:'https://api.deepseek.com/chat/completions', model:'deepseek-chat', key: builtinKey(), label:'deepseek-chat（回落）', notice:'⚠ '+first+' 需自备硅基流动Key，当前回落到内置DeepSeek通道' };
    }
    if(first === 'deepseek-chat' || first === 'deepseek-reasoner' || !SF_MAP[first]){
      var m = (first==='deepseek-reasoner') ? 'deepseek-reasoner' : 'deepseek-chat';
      return { url:'https://api.deepseek.com/chat/completions', model:m, key: userKey || builtinKey(), label: m+'（内置通道）' };
    }
    if(userKey){
      return { url:'https://api.siliconflow.cn/v1/chat/completions', model: SF_MAP[first]||first, key:userKey, label: first+'（硅基流动）' };
    }
    return { url:'https://api.deepseek.com/chat/completions', model:'deepseek-chat', key: builtinKey(), label:'deepseek-chat（智能回落）' };
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
      polish: !!(document.getElementById('polishToggle') && document.getElementById('polishToggle').checked),
      replaceEntities: true  // 强制开启实体替换
    };
  }

  // ================================================================
  //  第一阶段：提取实体
  // ================================================================
  var EXTRACT_SYS = '你是一位细心的网络小说文本分析师。请从用户提供的原文章节中，穷举提取所有需要替换的专有名词。\n'+
    '请按以下8个类别逐一列出，每类一行，格式：类型：【实体1】【实体2】【…】\n'+
    '如果某类没有发现，输出：类型：无\n'+
    '8个类别（严格按此顺序）：\n'+
    '1. 人名（主角/配角/反派/师父/长老等所有人名，包括复姓、单名、绰号）\n'+
    '2. 门派/宗门/教派/组织名（仙门/武林门派/王朝/帝国/家族/商会等）\n'+
    '3. 地名/山河/城郡/秘境（山名/水名/城镇/皇城/宫殿名/秘境/遗迹等）\n'+
    '4. 朝代/纪元/大劫/位面名（皇朝名/年号/纪元名/位面/界域名）\n'+
    '5. 功法/秘术/绝招名（修仙功法/武功秘籍/异能名称等）\n'+
    '6. 法宝/神兵/灵宠名（武器/灵兽/坐骑/丹药/灵材等）\n'+
    '7. 等级/境界/势力名（大境界名/势力名/国家名/王国名）\n'+
    '8. 其他专有名词（特殊道具/重要事件名/绰号/尊称等）\n'+
    '【重要】只输出分析结果，不要任何解释。每类格式严格为：类型：【…】（中间无换行）';

  function extractEntities(ep, chapterText){
    return callAPI(ep, EXTRACT_SYS, '【待分析原文章节】\n' + chapterText.slice(0, 3000), 0.3, 1500);
  }

  // ================================================================
  //  第二阶段：生成替换名（保持类型/风格/音韵一致）
  // ================================================================
  function buildReplacePrompt(extractedText, chapterText){
    return [
      '【任务】根据提取的实体清单，为每个实体生成全新替换名。',
      '',
      '【替换规则】',
      '- 替换名必须与原文风格、朝代背景、文化气质完全一致',
      '- 人名：同姓氏起源（唐/宋/明/玄幻古风），换不同的姓和名；复姓换复姓；主角名换主角级响亮名',
      '- 门派名：换不同的创始典故意象，但字数相同（3字派→3字派，4宗门→4宗门）',
      '- 地名：同类地理属性（山/水/城/郡），换不同自然意象',
      '- 朝代：换不同的国号或纪元名（等长替换）',
      '- 功法：同修炼体系，换不同意象（剑气→刀气）',
      '- 法宝：换不同神话意象，同品类替换',
      '- 等级境界：保持修炼体系不变，只换名称',
      '',
      '【输入原文摘要（供参考风格）】',
      chapterText.slice(0, 800),
      '',
      '【提取的实体列表】',
      extractedText,
      '',
      '【输出格式（严格按此）】',
      '每一行一个替换对，格式：原文名 → 新名',
      '示例：萧无极 → 叶玄清    青云宗 → 天璇派    大周 → 北燕',
      '不要加任何解释，只输出替换对。'
    ].join('\n');
  }

  function generateReplacements(ep, extractedText, chapterText){
    return callAPI(ep,
      '你是资深网络小说作家，擅长为小说生成各类替换名称。',
      buildReplacePrompt(extractedText, chapterText),
      0.5, 2000
    );
  }

  // ================================================================
  //  第三阶段：执行替换 + 仿写（一个系统 prompt 全搞定）
  // ================================================================
  function buildSystem(cfg, entityPairs, chapterText){
    var pairStr = entityPairs.length > 0
      ? '【本章替换对照表】（原文→新名，严格全文替换后再仿写）\n' + entityPairs.join('\n') + '\n'
      : '';

    var L = [
      '你是资深网络小说作家，有十年连载经验，文风老练、有烟火气。',
      '',
      '【核心任务：两步走】',
      '第一步：全文实体替换 —— 根据下方的替换对照表，将原文中的所有旧名称替换为对应的新名称，替换要彻底、一致、不遗漏。',
      '第二步：深度仿写重写 —— 借鉴替换后原文的故事内核与精彩点，重写全部文字表达，句式、用词、描写角度与原文不同。',
      '',
      pairStr,
      '【替换要求】',
      '- 替换对照表中的每一对必须全部替换，不得遗漏任何一处',
      '- 替换时注意上下文：人名/地名可能在句中不同位置（句首/句中/句尾），都要替换',
      '- 替换后检查：确认原文中的每个旧名称都已被新名称替换',
      '',
      '【仿写要求】',
      '- '+cfg.modeText,
      '- 剧情走向保留度约 '+cfg.plot+'%；人物设定保留度约 '+cfg.char+'%；爽点与情绪节奏保留度约 '+cfg.cool+'%；逻辑严谨度约 '+cfg.logic+'%',
      '- 文风相似度约 '+cfg.style+'%，创意发散度约 '+cfg.creative+'%',
      '- 本章目标字数约 '+cfg.chapWords+' 字（可±15%），分段合理，对话与描写穿插自然',
      '【去AI化·必须做到】',
      '- 严禁AI腔与套话：禁止"仿佛/宛如/犹如"高频比喻堆砌；禁止排比三连与口号式金句；禁止"不得不说/总而言之/由此可见"等总结词；禁止告知式心理描写（他感受到…她意识到…）；禁止流水账；禁止刻意煽情的通套句',
      '- 多用具体感官细节（气味、温度、声音、触感）与动作、对话推动剧情',
      '- 角色要有独有的口头禅、小动作、说话节奏',
      '- 视角与时态全程统一；长句短句交错，句式不雷同'
    ];
    if(cfg.instruct) L.push('- 额外精修要求：'+cfg.instruct);
    if(cfg.styleReq) L.push('- 指定文风：'+cfg.styleReq);
    if(cfg.forbidden) L.push('- 严禁使用：'+cfg.forbidden);
    L.push('');
    L.push('【输出格式】只输出仿写后的小说正文，不要任何解释、标题标签或markdown符号。');
    return L.join('\n');
  }

  // ---------- 解析替换结果字符串 → [{old, new}] ----------
  function parseEntityPairs(raw){
    var pairs = [];
    var lines = raw.split('\n');
    for(var i=0;i<lines.length;i++){
      var line = lines[i].trim();
      if(!line) continue;
      // 格式：原文名 → 新名
      var idx = line.indexOf('→');
      if(idx === -1) idx = line.indexOf('->');
      if(idx === -1) idx = line.indexOf('＝');
      if(idx === -1) continue;
      var oldName = line.slice(0, idx).replace(/[#*【】\[\]「」『』""''\s]/g, '').trim();
      var newName = line.slice(idx+1).replace(/[#*【】\[\]「」『』""''\s]/g, '').trim();
      if(oldName && newName && oldName !== newName && oldName.length >= 1 && newName.length >= 1){
        pairs.push({old: oldName, new: newName});
      }
    }
    return pairs;
  }

  // ---------- 对文本执行批量替换 ----------
  function applyReplacements(text, pairs){
    // 从长到短排序，避免短名替换后破坏长名（如"萧"不应单独替换"萧无极"后产生的"萧"）
    var sorted = pairs.slice().sort(function(a,b){ return b.old.length - a.old.length; });
    for(var i=0;i<sorted.length;i++){
      var p = sorted[i];
      if(p.old.length < 2) continue; // 避免单字替换造成语义混乱
      // 全词边界替换
      var re = new RegExp(p.old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      text = text.replace(re, p.new);
    }
    return text;
  }

  // ---------- 二遍降AI率润色 ----------
  var POLISH_SYS = '你是资深文字润色编辑，专门消灭AI写作痕迹。请对用户提供的网络小说正文做"二遍降AI率润色"：\n'+
    '- 不改变剧情、人物、对话内容与世界观，只优化文字表达。\n'+
    '- 消除AI腔：改写套路化排比与空洞总结句；把"他感受到/她意识到"类告知式心理描写改为动作/对话呈现；减少"仿佛/宛如/犹如"高频比喻；去掉刻意煽情通套句。\n'+
    '- 增强口语感与生活化细节，节奏有顿挫，长短句交错。\n'+
    '- 只输出润色后的正文，不要任何解释。';

  // ---------- API 调用（3次重试） ----------
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
          if(tryN <= 1) throw new Error('HTTP 429：服务器限速');
          log('  ⏳ HTTP 429，第'+(4-tryN)+'次重试（15秒后）…');
          return sleep(15000).then(function(){ return attempt(tryN-1); });
        }
        if(!resp.ok){ return resp.text().then(function(t){ throw new Error('HTTP'+resp.status+':'+t.slice(0,200)); }); }
        return resp.json();
      }).then(function(d){
        var c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if(!c) throw new Error('接口返回为空');
        return c.trim();
      }).catch(function(e){
        var isNet = e.message && /fetch|network|timeout|enospc|ECONNREFUSED/i.test(e.message);
        if(isNet && tryN > 1){
          log('  ⏳ 网络错误，第'+(4-tryN)+'次重试（5秒后）');
          return sleep(5000).then(function(){ return attempt(tryN-1); });
        }
        throw e;
      });
    }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    return attempt(3);
  }

  // ---------- 章节拆分 ----------
  function splitChapters(text){
    text = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    var re = /^[\t 　]*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷篇][^\n]{0,30})\s*$/gm;
    var idx = [], m;
    while((m = re.exec(text)) !== null){ idx.push({pos:m.index, title:m[1].trim(), end:re.lastIndex}); }
    var chs = [];
    if(idx.length === 0){
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
    ['progressContainer','progressBar','progressText','statusLog'].forEach(function(id){
      var el = document.getElementById(id); if(el) el.style.display='block';
    });
    var upload = document.getElementById('uploadZone') || (document.getElementById('fileInput') && document.getElementById('fileInput').closest('.upload-section'));
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
    var styleDef = '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="1a1a2e"/></w:rPr></w:style>';
    zip.folder('word').file('document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+styleDef+'</w:styles>'+
      '<w:body>'+paras+'<w:sectPr/></w:body></w:document>');
    return zip.generateAsync({type:'blob'});
  }

  // ================================================================
  //  主流程：开始仿写（含实体替换三阶段）
  // ================================================================
  function startWriting(){
    if(window.isNovelActivated && !window.isNovelActivated()){ if(window.showActivationModal) window.showActivationModal(); return; }
    if(STATE.running){ log('任务进行中，请稍候…','err'); return; }
    if(!STATE.chapters.length){ log('请先上传原文文件（TXT / DOCX）','err'); if(window.novelToast) window.novelToast('请先上传原文文件'); return; }

    var cfg = readCfg();
    var ep = resolveEndpoint();
    STATE.running = true; STATE.abort = false; STATE.results = []; STATE.enResults = [];
    STATE.entityMap = {}; STATE.doneChapters = 0;

    var maxCh = Math.max(1, Math.min(STATE.chapters.length, Math.round(cfg.targetWords / cfg.chapWords)));
    var chs = STATE.chapters.slice(0, maxCh);

    showExecArea();
    var logbox = document.getElementById('statusLog') || document.getElementById('outputLog') || document.getElementById('execLog');
    if(logbox) logbox.innerHTML = '';
    setProgress(2, '准备中…');
    if(ep.notice) log(ep.notice, 'err');
    log('通道：'+ep.label+'（已启用【实体替换系统】）','ok');
    log('原文共 '+STATE.chapters.length+' 章，本次仿写前 '+chs.length+' 章');

    var startBtn = document.getElementById('startWriteBtn');
    if(startBtn){ startBtn.disabled = true; startBtn.textContent = '⏳ 仿写中…'; }

    var temp = 0.6 + cfg.creative/250;
    var i = 0;

    function next(){
      if(STATE.abort){ finish(true); return; }
      if(i >= chs.length){ finish(false); return; }
      var ch = chs[i];
      var frac = i / chs.length;
      setProgress(Math.round(4 + frac*88), '第'+(i+1)+'/'+chs.length+'章：'+ch.title);
      log('▶ 第'+(i+1)+'章 '+ch.title+'（原文 '+ch.body.length+' 字）');

      // ========== 第一阶段：提取实体 ==========
      log('  🔍 阶段1/3：提取专有名词…');
      extractEntities(ep, ch.body)
        .then(function(extracted){
          log('  📋 实体提取完成：'+ extracted.slice(0,120).replace(/\n/g,' │ '));
          return extracted;
        })
        // ========== 第二阶段：生成替换名 ==========
        .then(function(extracted){
          log('  🔄 阶段2/3：生成全新替换名…');
          return generateReplacements(ep, extracted, ch.body)
            .then(function(replaceRaw){
              var pairs = parseEntityPairs(replaceRaw);
              STATE.entityMap[ch.title] = pairs;
              if(pairs.length > 0){
                var sample = pairs.slice(0,6).map(function(p){ return p.old+'→'+p.new; }).join('、');
                log('  ✅ 替换表生成完成（'+pairs.length+'对）：'+sample+'…','ok');
              } else {
                log('  ℹ️ 未发现明显专有名词，跳过替换，直接仿写','ok');
              }
              return pairs;
            });
        })
        // ========== 第三阶段：替换 + 仿写 ==========
        .then(function(pairs){
          log('  ✍️ 阶段3/3：替换+仿写重写…');
          var textForRewrite = pairs.length > 0 ? applyReplacements(ch.body, pairs) : ch.body;
          var userMsg = '【原文章节：'+ch.title+'】\n\n' + textForRewrite.slice(0, 6000);
          var sysPrompt = buildSystem(cfg, pairs.map(function(p){ return p.old+' → '+p.new; }), ch.body);
          return callAPI(ep, sysPrompt, userMsg, temp, 8000)
            .then(function(text){ return {text: text, pairs: pairs}; });
        })
        // ========== 二遍降AI润色（可选） ==========
        .then(function(result){
          if(!cfg.polish) return result;
          log('  ↳ 二遍降AI润色中…');
          return callAPI(ep, POLISH_SYS, '【待润色正文】\n'+result.text.slice(0,6000), 0.7, 8000)
            .then(function(p){
              log('  ↳ 润色完成','ok');
              return {text: p, pairs: result.pairs};
            })
            .catch(function(e){
              log('  ↳ 润色失败，保留原稿','err');
              return result;
            });
        })
        // ========== 存储结果 ==========
        .then(function(result){
          STATE.results.push(result.text);
          STATE.doneChapters = STATE.results.length;
          var pairInfo = result.pairs.length > 0
            ? '，替换了'+result.pairs.length+'个专有名词'
            : '';
          log('✔ '+ch.title+' 完成，生成 '+result.text.length+' 字'+pairInfo,'ok');
          return result;
        })
        // ========== 英文翻译（可选） ==========
        .then(function(result){
          if(!cfg.translate) return;
          log('  ↳ 翻译英文中…');
          return callAPI(ep, '你是专业中英文小说翻译，只输出地道流畅的美式英文译文。', result.text.slice(0,6000), 0.5, 8000)
            .then(function(en){ STATE.enResults.push(en); log('  ↳ 英文翻译完成','ok'); })
            .catch(function(e){ STATE.enResults.push('[翻译失败]'); log('  ↳ 翻译失败','err'); });
        })
        .then(function(){ i++; setTimeout(next, 300); })
        .catch(function(e){
          log('✘ '+ch.title+' 失败：'+e.message,'err');
          STATE.results.push('【仿写失败：'+e.message+'】\n\n原文：\n'+ch.body);
          if(cfg.translate) STATE.enResults.push('');
          i++; setTimeout(next, 500);
        });
    }

    function finish(aborted){
      STATE.running = false;
      if(startBtn){ startBtn.disabled = false; startBtn.textContent = '🚀 开始仿写'; }
      if(aborted){ setProgress(0,'已停止'); log('任务已停止','err'); return; }
      setProgress(100, '✅ 全部完成');
      log('🎉 仿写完成！共 '+STATE.results.length+' 章（已启用实体替换），可下载成品','ok');
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
    var prev = document.getElementById('resultPreview');
    if(prev){
      prev.textContent = (STATE.chapters[0].title + '\n\n' + STATE.results[0]).slice(0, 1200) + '\n\n……';
      prev.style.display = 'block';
    }
  }
  function safeName(){ var f = STATE.fileName || ''; f = f.replace(/\.[^.]+$/,'') || '仿写作品'; return f.replace(/[\\/:*?"<>|]/g,''); }
  function downloadTxt(){
    if(!STATE.results.length){ log('暂无内容','err'); return; }
    var txt = buildTxt(STATE.chapters, STATE.results);
    download(new Blob([txt],{type:'text/plain;charset=utf-8'}), safeName()+'_仿写.txt');
    log('已下载TXT','ok');
  }
  function downloadDocx(){
    if(!STATE.results.length){ log('暂无内容','err'); return; }
    if(!window.JSZip){ log('DOCX组件未加载','err'); return downloadTxt(); }
    makeDocx(STATE.chapters, STATE.results).then(function(blob){
      if(!blob){ log('DOCX生成失败','err'); return downloadTxt(); }
      download(blob, safeName()+'_仿写.docx'); log('已下载DOCX','ok');
    }).catch(function(e){ console.error(e); log('DOCX生成失败','err'); downloadTxt(); });
  }
  function downloadEn(){
    if(!STATE.enResults || !STATE.enResults.length){ log('无英文内容','err'); return; }
    var txt = buildTxt(STATE.chapters, STATE.enResults);
    download(new Blob([txt],{type:'text/plain;charset=utf-8'}), safeName()+'_EN.txt');
    log('已下载英文TXT','ok');
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
      if(info) info.textContent = '📄 '+file.name+'｜'+STATE.chapters.length+'章｜约'+totalChars.toLocaleString()+'字';
      log('解析完成：'+STATE.chapters.length+'章，约'+totalChars+'字','ok');
      var an = document.getElementById('analysisResult') || document.getElementById('fileAnalysis');
      if(an){
        an.style.display='block';
        an.innerHTML = '<div style="color:var(--gold);font-weight:700;margin-bottom:6px;">📊 原文分析</div>'+
          '<div style="font-size:13px;color:var(--text-secondary);line-height:1.8;">'+
          '文件名：'+file.name+'<br>识别章节：'+STATE.chapters.length+'章<br>总字数：约'+totalChars.toLocaleString()+'字<br>'+
          '首章：'+(STATE.chapters[0]?STATE.chapters[0].title:'—')+'<br>'+
          '实体替换：自动开启（人名/地名/门派/朝代/功法/法宝等全部替换）<br>'+
          '状态：<span style="color:var(--accent-green)">✓ 就绪，可开始仿写</span></div>';
      }
    }).catch(function(e){
      if(info) info.textContent = '❌ 解析失败：'+e.message;
      log('解析失败：'+e.message,'err');
    });
  }

  // ---------- 文件读取 ----------
  function readFile(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(e){
        var data = new Uint8Array(e.target.result);
        var isDocx = file.name.toLowerCase().endsWith('.docx');
        if(isDocx){
          try {
            var JSZipInst = window.JSZip;
            if(!JSZipInst){ reject(new Error('JSZip未加载，请刷新页面后重试')); return; }
            JSZipInst.loadAsync(data).then(function(zip){
              var docXml = zip.file('word/document.xml');
              if(!docXml){ reject(new Error('DOCX格式错误：未找到word/document.xml')); return; }
              docXml.async('string').then(function(xml){
                var div = document.createElement('div');
                div.innerHTML = xml;
                var text = div.textContent.replace(/\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
                resolve(text);
              });
            }).catch(function(err){ reject(new Error('DOCX解析失败：'+err.message)); });
          }catch(err){ reject(new Error('DOCX处理异常')); }
        } else {
          // TXT：尝试UTF-8，失败则试GBK
          var txt = new TextDecoder('utf-8').decode(data);
          if(txt.replace(/[\u0000-\u001F\u0080-\u009F]/g,'').length < 20){
            txt = new TextDecoder('gbk').decode(data);
          }
          resolve(txt);
        }
      };
      reader.onerror = function(){ reject(new Error('文件读取失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  // ---------- 导出 API ----------
  window.startWriting = startWriting;
  window.stopWriting = stopWriting;
  window.handleFileSelect = handleFileSelect;
  window.downloadTxt = downloadTxt;
  window.downloadDocx = downloadDocx;
  window.downloadEn = downloadEn;
  window.downloadFile = function(type){
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
})();
