/* 小白超白的空间 v4 · 3D 星球展厅 */
(function () {
  'use strict';

  var DATA = window.SITE_DATA;
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function escapeHtml(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
  function numberLabel(n){ if(n==null)return '0'; var s=String(n); if(/万/.test(s))return s; var v=parseFloat(s); if(!isFinite(v))return s; if(v>=10000)return (v/10000).toFixed(1).replace(/\.0$/,'')+'万'; return s; }
  function parseCount(s){ var str=String(s==null?'0':s).replace(/,/g,''); var v=parseFloat(str); if(/万/.test(str))v*=10000; return isFinite(v)?v:0; }

  var CATEGORY_META = {}; DATA.categories.forEach(function(c){ CATEGORY_META[c.key]=c; });
  function icon(name,cls){ return window.xbIcon ? window.xbIcon(name,cls) : ''; }
  var CATEGORY_ICONS = { '娃娃开箱':'package', '测评分享':'shopping-bag', 'GBC':'guitar', 'chiikawa':'rabbit', '日常':'heart' };
  function categoryIcon(key){ return CATEGORY_ICONS[key]||'sparkles'; }
  function categoryOf(item){ return CATEGORY_META[item.category]||CATEGORY_META['日常']; }
  function platformOf(item){ return item.url && item.url.indexOf('bilibili')>=0 ? 'bili':'xhs'; }

  var currentView = 'about';
  var switchLock = false;
  var allItems = DATA.xhs.items.map(function(item){ return {item:item, kind:'xhs', platform:'小红书'}; }).concat(DATA.bili.items.map(function(item){ return {item:item, kind:'bili', platform:'B站'}; }));

  /* ---------- 视图 HTML ---------- */
  function viewShell(inner){ return '<div class="view-card"><div class="view-scroll">'+inner+'</div></div>'; }

  function aboutHtml(){
    var meta=DATA.meta;
    var stats=[
      ['B站粉丝',DATA.stats.bili.fans,'users'], ['B站播放',DATA.stats.bili.plays,'play'],
      ['B站获赞',DATA.stats.bili.likes,'thumbs-up'], ['小红书粉丝',DATA.stats.xhs.followers,'heart']
    ];
    return viewShell(
      '<div class="about-view">'+
      '<div class="about-avatar"><img src="'+escapeHtml(meta.avatar)+'" alt="'+escapeHtml(meta.name)+'"></div>'+
      '<div>'+
        '<p class="eyebrow">'+icon('sparkles')+' 你好呀，这里是</p>'+
        '<h1 class="hero-name">'+escapeHtml(meta.name)+'</h1>'+
        '<p class="hero-sub">XIAOBAI\'S SPACE · 小白超白的空间</p>'+
        '<p class="hero-bio">小白的二次元日常～ 喜欢粉色的小可爱们！！！</p>'+
        '<div class="hero-stats">'+stats.map(function(s){return '<div class="stat-chip">'+icon(s[2])+'<b>'+escapeHtml(s[1])+'</b><span>'+escapeHtml(s[0])+'</span></div>';}).join('')+'</div>'+
        '<div class="hero-actions">'+
          '<a class="btn btn-primary" href="'+escapeHtml(meta.biliUrl)+'" target="_blank" rel="noopener noreferrer">'+icon('tv')+' 去B站看小白</a>'+
          '<a class="btn btn-ghost" href="'+escapeHtml(meta.xhsUrl)+'" target="_blank" rel="noopener noreferrer">'+icon('book-heart')+' 小红书主页</a>'+
        '</div>'+
        '<p class="hero-sign">'+escapeHtml(meta.sign)+' · '+icon('map-pin')+escapeHtml(meta.ip)+'</p>'+
      '</div></div>'
    );
  }

  function workCardHtml(item,kind,index){
    var cat=categoryOf(item), isBili=kind==='bili';
    var delay=Math.min(0.32,0.03+((index||0)%10)*0.035);
    var meta=isBili ? icon('play')+numberLabel(item.play)+' · '+icon('message-circle')+numberLabel(item.danmu) : icon('thumbs-up')+numberLabel(item.likes);
    var overlay=isBili ? '<div class="play-overlay"><i>'+icon('play')+'</i></div>' : '';
    return '<article class="work-card" style="--d:'+delay.toFixed(3)+'s" data-id="'+escapeHtml(item.id)+'" data-cat="'+escapeHtml(item.category)+'" role="button" tabindex="0" aria-label="查看：'+escapeHtml(item.title)+'">'+
      '<div class="work-card-media '+(isBili?'card-16':'card-43')+'">'+
      '<img loading="lazy" src="'+escapeHtml(item.cover)+'" alt="">'+
      '<span class="media-badge">'+(isBili?icon('tv')+' B站':icon('book-heart')+' 小红书')+'</span>'+overlay+'</div>'+
      '<div class="work-card-body"><h3>'+escapeHtml(item.title)+'</h3>'+
      '<div class="work-card-meta"><span class="meta-pill">'+icon(categoryIcon(item.category))+' '+escapeHtml(item.category)+'</span><span>'+meta+'</span>'+
      (isBili&&item.date?'<span>'+icon('calendar')+escapeHtml(item.date)+'</span>':'')+'</div></div></article>';
  }

  function featuredHtml(){
    var xhsTop=DATA.xhs.items.slice().sort(function(a,b){return parseCount(b.likes)-parseCount(a.likes);}).slice(0,3);
    var biliTop=DATA.bili.items.slice().sort(function(a,b){return parseCount(b.play)-parseCount(a.play);}).slice(0,3);
    var featured=[], seen={};
    for(var i=0;i<3;i++){ [xhsTop[i],biliTop[i]].forEach(function(item){ if(item&&!seen[item.id]){ seen[item.id]=true; featured.push({item:item,kind:platformOf(item)}); } }); }
    return viewShell('<div class="section-head"><span class="section-kicker">FEATURED</span><h2>'+icon('sparkles')+' 精选焦点</h2><p>先看几件小白最受欢迎的作品</p></div>'+
      '<div class="featured-scroller" id="featured-scroller">'+featured.map(function(entry,index){return workCardHtml(entry.item,entry.kind,index);}).join('')+'</div>');
  }

  function xhsHtml(){
    return viewShell('<div class="section-head"><span class="section-kicker">XIAOHONGSHU ISLAND</span><h2>'+icon('book-heart')+' 小红书岛</h2><p>32 件真实作品 · 开箱 / 测评 / GBC / chiikawa</p></div>'+
      '<div class="filters" id="xhs-filters"></div><div class="masonry" id="xhs-grid"></div>');
  }
  function biliHtml(){
    return viewShell('<div class="section-head"><span class="section-kicker">BILIBILI VIDEO WALL</span><h2>'+icon('clapperboard')+' B站视频墙</h2><p>42 支视频 · 播放 / 弹幕 / 日期全部真实</p></div>'+
      '<div class="filters" id="bili-filters"></div><div class="bili-grid" id="bili-grid"></div>');
  }
  function followHtml(){
    var meta=DATA.meta;
    return viewShell('<div class="section-head"><span class="section-kicker">FOLLOW XIAOBAI</span><h2>'+icon('heart')+' 关注小白</h2><p>日常、开箱、GBC、chiikawa…都在这里更新</p></div>'+
      '<div class="follow-cards" id="follow-cards">'+
      '<a class="follow-card" href="'+escapeHtml(meta.biliUrl)+'" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="'+escapeHtml(meta.biliAvatar)+'" alt="B站头像"><div><b>'+icon('tv')+' 小白超白的-</b><span>B站 · 粉丝 '+escapeHtml(DATA.stats.bili.fans)+' · 获赞 '+escapeHtml(DATA.stats.bili.likes)+'<br>播放 '+escapeHtml(DATA.stats.bili.plays)+' · 视频 '+escapeHtml(DATA.stats.bili.videos)+'</span><em>去B站关注 '+icon('external-link')+'</em></div></a>'+
      '<a class="follow-card" href="'+escapeHtml(meta.xhsUrl)+'" target="_blank" rel="noopener noreferrer"><img loading="lazy" src="'+escapeHtml(meta.avatar)+'" alt="小红书头像"><div><b>'+icon('book-heart')+' 小白超白的</b><span>小红书 · 粉丝 '+escapeHtml(DATA.stats.xhs.followers)+' · 获赞与收藏 '+escapeHtml(DATA.stats.xhs.likesAndCollects)+'<br>小红书号 '+escapeHtml(DATA.stats.xhs.redId)+'</span><em>去小红书关注 '+icon('external-link')+'</em></div></a>'+
      '</div>');
  }

  /* ---------- 卡片绑定与筛选 ---------- */
  function findItem(id){ var entry=allItems.filter(function(e){return e.item.id===id;})[0]; return entry||null; }
  function bindCard(card){
    card.addEventListener('click',function(){ var f=findItem(card.getAttribute('data-id')); if(f)openDetail(f.item,f.kind); });
    card.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();card.click();} });
    card.addEventListener('pointermove',function(e){ var r=card.getBoundingClientRect(),px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height; card.style.setProperty('--ry',((px-.5)*12).toFixed(2)+'deg'); card.style.setProperty('--rx',((.5-py)*10).toFixed(2)+'deg'); card.style.setProperty('--gx',(px*100).toFixed(1)+'%'); card.style.setProperty('--gy',(py*100).toFixed(1)+'%'); });
    card.addEventListener('pointerleave',function(){ card.style.setProperty('--rx','0deg'); card.style.setProperty('--ry','0deg'); });
  }
  function bindCards(root){ $$('#'+root+' .work-card').forEach(bindCard); }

  function buildFilters(containerId,items,gridId){
    var counts={}; items.forEach(function(item){counts[item.category]=(counts[item.category]||0)+1;});
    var cats=[{key:'全部'}].concat(DATA.categories.filter(function(c){return counts[c.key]>0;}));
    var box=$('#'+containerId); box.innerHTML=cats.map(function(c){return '<button class="filter-chip" data-cat="'+escapeHtml(c.key)+'">'+icon(c.key==='全部'?'sparkles':categoryIcon(c.key))+' '+escapeHtml(c.key)+' · '+(c.key==='全部'?items.length:counts[c.key])+'</button>';}).join('');
    $$('#'+containerId+' .filter-chip').forEach(function(chip){ chip.addEventListener('click',function(){ $$('#'+containerId+' .filter-chip').forEach(function(c){c.classList.remove('active');}); chip.classList.add('active'); var cat=chip.getAttribute('data-cat'); $$('#'+gridId+' .work-card').forEach(function(card){ card.style.display=(cat==='全部'||card.getAttribute('data-cat')===cat)?'':'none'; }); }); });
    var first=box.querySelector('.filter-chip'); if(first)first.classList.add('active');
  }

  /* ---------- 渲染 / 切换 ---------- */
  function renderView(view, animate){
    currentView=view;
    var html;
    if(view==='featured')html=featuredHtml(); else if(view==='xhs')html=xhsHtml(); else if(view==='bili')html=biliHtml(); else if(view==='follow')html=followHtml(); else html=aboutHtml();
    var panel=$('#view-panel'); panel.classList.remove('leaving','entering'); panel.innerHTML=html;
    if(view==='featured')bindCards('featured-scroller');
    if(view==='xhs'){ var g=$('#xhs-grid'); g.innerHTML=DATA.xhs.items.map(function(item,index){return workCardHtml(item,'xhs',index);}).join(''); bindCards('xhs-grid'); buildFilters('xhs-filters',DATA.xhs.items,'xhs-grid'); }
    if(view==='bili'){ var b=$('#bili-grid'); b.innerHTML=DATA.bili.items.map(function(item,index){return workCardHtml(item,'bili',index);}).join(''); bindCards('bili-grid'); buildFilters('bili-filters',DATA.bili.items,'bili-grid'); }
    if(animate){ panel.classList.add('entering'); setTimeout(function(){panel.classList.remove('entering');},600); }
  }

  function switchView(view, fromWorld){
    if(switchLock||view===currentView){ if(view===currentView)updateNav(view); return; }
    switchLock=true; var panel=$('#view-panel'); panel.classList.add('leaving');
    setTimeout(function(){ renderView(view,true); updateNav(view); switchLock=false; },300);
    if(!fromWorld&&window.XBW_BG&&window.XBW_BG.goTo)window.XBW_BG.goTo(view);
  }

  function updateNav(view){ $$('.nav-links a,[data-view]').forEach(function(el){ el.classList.toggle('active',el.getAttribute('data-view')===view); }); }

  /* ---------- 搜索 ---------- */
  function searchItems(q){ q=String(q||'').trim().toLowerCase(); if(!q)return []; return allItems.filter(function(entry){var it=entry.item;return (it.title||'').toLowerCase().indexOf(q)>=0||(it.category||'').toLowerCase().indexOf(q)>=0;}).slice(0,18); }
  function renderSearchResults(q){ var list=$('#search-results'),results=searchItems(q); if(!results.length){list.innerHTML='<li class="search-empty">没找到对应作品，换个关键词试试：开箱 / GBC / chiikawa</li>';return;} list.innerHTML=results.map(function(entry){var cat=categoryOf(entry.item);var meta=entry.kind==='bili'?icon('play')+numberLabel(entry.item.play)+' · '+icon('message-circle')+numberLabel(entry.item.danmu):icon('thumbs-up')+numberLabel(entry.item.likes);return '<li data-id="'+escapeHtml(entry.item.id)+'"><img loading="lazy" src="'+escapeHtml(entry.item.cover)+'" alt=""><div class="search-result-main"><b>'+escapeHtml(entry.item.title)+'</b><span>'+entry.platform+' · '+icon(categoryIcon(entry.item.category))+' '+escapeHtml(entry.item.category)+' · '+meta+'</span></div></li>';}).join(''); $$('#search-results li[data-id]').forEach(function(li){li.addEventListener('click',function(){var f=findItem(li.getAttribute('data-id'));closeSearch();if(f)openDetail(f.item,f.kind);});}); }
  function openSearch(){ $('#search-panel').classList.add('open'); $('#search-panel').setAttribute('aria-hidden','false'); document.body.classList.add('no-scroll'); setTimeout(function(){$('#search-input').focus();},60); renderSearchResults($('#search-input').value); }
  function closeSearch(){ $('#search-panel').classList.remove('open'); $('#search-panel').setAttribute('aria-hidden','true'); document.body.classList.remove('no-scroll'); }

  /* ---------- 详情 ---------- */
  function openDetail(item,kind){ if(!item)return; var cat=categoryOf(item); $('#detail-cover').src=item.cover||''; $('#detail-cover').alt=item.title||'作品封面'; $('#detail-cat').innerHTML=icon(categoryIcon(item.category))+' '+escapeHtml(item.category); $('#detail-type').textContent=kind==='bili'?'BILIBILI VIDEO':'XIAOHONGSHU POST'; $('#detail-title').textContent=item.title||'小白作品'; $('#detail-stats').innerHTML=kind==='bili' ? '<span class="detail-stat">'+icon('play')+' 播放 '+escapeHtml(numberLabel(item.play))+'</span><span class="detail-stat">'+icon('message-circle')+' 弹幕 '+escapeHtml(numberLabel(item.danmu))+'</span>'+(item.date?'<span class="detail-stat">'+icon('calendar')+' '+escapeHtml(item.date)+'</span>':'') : '<span class="detail-stat">'+icon('thumbs-up')+' 点赞 '+escapeHtml(numberLabel(item.likes))+'</span><span class="detail-stat">'+icon('book-heart')+' 小红书号 '+escapeHtml(DATA.stats.xhs.redId)+'</span>'; var link=$('#detail-link'); if(item.url){link.href=item.url;link.classList.remove('disabled');link.innerHTML=icon('external-link')+' 打开原作品';}else{link.href='#';link.classList.add('disabled');link.innerHTML='暂未开放原链接 '+icon('external-link');} $('#detail-modal').classList.add('open'); $('#detail-modal').setAttribute('aria-hidden','false'); document.body.classList.add('no-scroll'); }
  function closeDetail(){ $('#detail-modal').classList.remove('open'); $('#detail-modal').setAttribute('aria-hidden','true'); if(!$('#search-panel').classList.contains('open'))document.body.classList.remove('no-scroll'); }

  /* ---------- 主题 / 音乐 ---------- */
  function toggleTheme(){ var isDark=document.documentElement.getAttribute('data-theme')==='dark', next=isDark?'day':'night'; document.documentElement.setAttribute('data-theme',isDark?'':'dark'); $('#theme-btn').innerHTML=isDark?icon('moon'):icon('sun'); if(window.XBW_BG&&window.XBW_BG.setTheme)window.XBW_BG.setTheme(next); }
  var MusicBox={ ctx:null,master:null,playing:false,timer:null,nextTime:0,step:0,melody:[72,74,76,79,81,79,76,74,72,74,76,81,79,76,74,72,67,69,71,74,76,79,81,79,76,74,72,74,76,79,74,72],
    ensure:function(){ if(this.ctx)return; try{var AC=window.AudioContext||window.webkitAudioContext;this.ctx=new AC();this.master=this.ctx.createGain();this.master.gain.value=.14;this.master.connect(this.ctx.destination);}catch(e){this.ctx=null;} },
    note:function(freq,t,dur,vol){ if(!this.ctx||!this.master)return; var osc=this.ctx.createOscillator(),osc2=this.ctx.createOscillator(),g=this.ctx.createGain(); osc.type='sine';osc2.type='triangle';osc.frequency.value=freq;osc2.frequency.value=freq*2;g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+dur);osc.connect(g);osc2.connect(g);var g2=this.ctx.createGain();g2.gain.value=.22;g.connect(g2);g2.connect(this.master);osc.start(t);osc2.start(t);osc.stop(t+dur+.05);osc2.stop(t+dur+.05); },
    schedule:function(){ while(this.nextTime<this.ctx.currentTime+.35){ var midi=this.melody[this.step%this.melody.length],freq=440*Math.pow(2,(midi-69)/12),dur=this.step%4===3?.42:.28; this.note(freq,this.nextTime,dur,this.step%2===0?.5:.3); if(this.step%2===0)this.note(midi-12,this.nextTime,dur,.14); this.nextTime+=.24; this.step++; } },
    start:function(){ this.ensure(); if(!this.ctx)return false; if(this.ctx.state==='suspended')this.ctx.resume(); this.playing=true; this.nextTime=this.ctx.currentTime+.06; this.timer=setInterval(this.schedule.bind(this),90); return true; },
    stop:function(){ this.playing=false; if(this.timer)clearInterval(this.timer); this.timer=null; } };
  function toggleMusic(){ var btn=$('#music-btn'); if(!MusicBox.playing){ if(MusicBox.start()){btn.classList.add('playing');btn.innerHTML=icon('music');} } else { MusicBox.stop();btn.classList.remove('playing');btn.innerHTML=icon('music'); } }

  /* ---------- 光点 / 背景装饰 ---------- */
  function buildBackground(){
    var iconNames=['heart','sparkles','star','rabbit','guitar','shopping-bag','package','camera'];
    var floatHtml=''; for(var i=0;i<18;i++){ floatHtml+='<span class="floaty" style="left:'+((i*53)%100)+'%;top:'+((i*37+11)%100)+'%;animation-delay:'+(-(i%9)*1.7)+'s">'+icon(iconNames[i%iconNames.length])+'</span>'; }
    $('#floaties').innerHTML=floatHtml;
    var sparkHtml=''; for(var j=0;j<30;j++){ sparkHtml+='<span class="sparkle" style="left:'+((j*67)%100)+'%;top:'+((j*43+7)%100)+'%;animation-delay:'+(-(j%8)*.6)+'s"></span>'; }
    $('#sparkles').innerHTML=sparkHtml;
  }
  var fxParticles=[], fxCtx=null, fxCanvas=null;
  function setupFxCanvas(){
    fxCanvas=$('#fx-canvas'); if(!fxCanvas)return; fxCtx=fxCanvas.getContext('2d');
    function resize(){ var dpr=Math.min(window.devicePixelRatio||1,2); fxCanvas.width=Math.floor(window.innerWidth*dpr); fxCanvas.height=Math.floor(window.innerHeight*dpr); fxCanvas.style.width=window.innerWidth+'px'; fxCanvas.style.height=window.innerHeight+'px'; fxCtx.setTransform(dpr,0,0,dpr,0,0); }
    resize(); window.addEventListener('resize',resize);
    function spawn(x,y,count,burst){ for(var i=0;i<count;i++){ var a=Math.random()*Math.PI*2,sp=burst?1.2+Math.random()*3.6:.25+Math.random()*.8; fxParticles.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,decay:burst?.016+Math.random()*.02:.03+Math.random()*.025,size:burst?1.5+Math.random()*3:.8+Math.random()*1.8,hue:burst?320+Math.random()*40:330+Math.random()*25}); if(fxParticles.length>180)fxParticles.splice(0,fxParticles.length-180); } }
    window.addEventListener('pointermove',function(e){ if(Math.random()>.45)spawn(e.clientX,e.clientY,1,false); },{passive:true});
    window.addEventListener('pointerdown',function(e){ spawn(e.clientX,e.clientY,14,true); },{passive:true});
    (function draw(){ if(!fxCtx)return; fxCtx.clearRect(0,0,window.innerWidth,window.innerHeight); fxParticles.forEach(function(p){ p.x+=p.vx;p.y+=p.vy;p.vx*=.975;p.vy*=.975;p.life-=p.decay; if(p.life<=0)return; fxCtx.beginPath(); fxCtx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2); fxCtx.fillStyle='hsla('+p.hue+',95%,80%,'+(p.life*.7).toFixed(3)+')'; fxCtx.shadowColor='rgba(255,255,255,.75)'; fxCtx.shadowBlur=8; fxCtx.fill(); }); fxParticles=fxParticles.filter(function(p){return p.life>0;}); requestAnimationFrame(draw); })();
  }

  /* ---------- UI ---------- */
  function bindUI(){
    $$('[data-view]').forEach(function(el){ el.addEventListener('click',function(e){ e.preventDefault(); var view=el.getAttribute('data-view'); closeSearch(); closeDetail(); switchView(view); }); });
    $('#search-btn').addEventListener('click',function(){ $('#search-panel').classList.contains('open')?closeSearch():openSearch(); });
    $('#search-close').addEventListener('click',closeSearch);
    $('#search-input').addEventListener('input',function(){renderSearchResults(this.value);});
    $('#search-input').addEventListener('keydown',function(e){if(e.key==='Escape')closeSearch();});
    $$('#search-hints button').forEach(function(btn){ btn.addEventListener('click',function(){ $('#search-input').value=btn.getAttribute('data-q'); renderSearchResults(btn.getAttribute('data-q')); $('#search-input').focus(); }); });
    $('#theme-btn').addEventListener('click',toggleTheme);
    $('#music-btn').addEventListener('click',toggleMusic);
    $('#pulse-btn').addEventListener('click',function(){ if(window.XBW_BG&&window.XBW_BG.pulse)window.XBW_BG.pulse(); });
    $$('[data-close-detail]').forEach(function(el){el.addEventListener('click',closeDetail);});
    $('#detail-link').addEventListener('click',function(e){if(this.classList.contains('disabled'))e.preventDefault();});
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){closeSearch();closeDetail();}
      if(e.key==='/'||(e.ctrlKey&&e.key.toLowerCase()==='k')){e.preventDefault();$('#search-panel').classList.contains('open')?closeSearch():openSearch();}
      if(e.key.toLowerCase()==='b'&&!/input|textarea/i.test(document.activeElement.tagName)){ if(window.XBW_BG&&window.XBW_BG.pulse)window.XBW_BG.pulse(); }
    });
    document.addEventListener('xwb:view',function(e){ if(e.detail&&e.detail.view)switchView(e.detail.view, true); });
    document.addEventListener('visibilitychange',function(){ if(document.hidden&&MusicBox.playing){MusicBox.stop();$('#music-btn').classList.remove('playing');$('#music-btn').innerHTML=icon('music');} });
  }

  /* ---------- 启动 ---------- */
  function start(){
    if(!DATA)return;
    buildBackground();
    bindUI();
    setupFxCanvas();
    var bg=window.XBW_BG;
    if(bg&&bg.supported){
      document.addEventListener('xwb:boom',function(){ renderView('about',true); updateNav('about'); },{once:true});
      bg.start();
      setTimeout(function(){ if(!$('#view-panel').innerHTML)renderView('about',true); },1600);
    } else {
      renderView('about',true); updateNav('about');
    }
  }

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',start);}else{start();}
})();