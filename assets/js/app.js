/* 小白大世界 v2 · 2.5D 单页滚动版
 * 顺序：先认识小白 → 精选 → 小红书岛 → B站视频墙 → 关注
 * 纯静态，数据内嵌在 data.js，双击 file:// 可用。
 */
(function () {
  'use strict';

  var DATA = window.SITE_DATA;
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function numberLabel(n) {
    if (n == null) return '0';
    var s = String(n);
    if (/万/.test(s)) return s;
    var v = parseFloat(s);
    if (!isFinite(v)) return s;
    if (v >= 10000) return (v / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return s;
  }

  function parseCount(s) {
    var str = String(s == null ? '0' : s).replace(/,/g, '');
    var v = parseFloat(str);
    if (/万/.test(str)) v *= 10000;
    return isFinite(v) ? v : 0;
  }

  var CATEGORY_META = {};
  DATA.categories.forEach(function (c) { CATEGORY_META[c.key] = c; });

  function icon(name, cls) {
    if (window.xbIcon) return window.xbIcon(name, cls);
    return '';
  }

  var CATEGORY_ICONS = {
    '娃娃开箱': 'package',
    '测评分享': 'shopping-bag',
    'GBC': 'guitar',
    'chiikawa': 'rabbit',
    '日常': 'heart'
  };

  function categoryIcon(key) {
    return CATEGORY_ICONS[key] || 'sparkles';
  }

  function categoryOf(item) {
    return CATEGORY_META[item.category] || CATEGORY_META['日常'];
  }

  function platformOf(item) {
    return item.url && item.url.indexOf('bilibili') >= 0 ? 'bili' : 'xhs';
  }

  /* ============================================================
   * 1. Hero：先介绍小白
   * ============================================================ */
  function buildHero() {
    var meta = DATA.meta;
    $('#hero-avatar').src = meta.avatar;
    $('#hero-avatar').alt = meta.name;
    $('#hero-bili').href = meta.biliUrl;
    $('#hero-xhs').href = meta.xhsUrl;
    $('#hero-sign').innerHTML = escapeHtml(meta.sign) + ' · ' + icon('map-pin') + escapeHtml(meta.ip);

    var stats = [
      ['B站粉丝', DATA.stats.bili.fans, 'users'],
      ['B站播放', DATA.stats.bili.plays, 'play'],
      ['B站获赞', DATA.stats.bili.likes, 'thumbs-up'],
      ['小红书粉丝', DATA.stats.xhs.followers, 'heart']
    ];
    $('#hero-stats').innerHTML = stats.map(function (s) {
      return '<div class="stat-chip">' + icon(s[2]) + '<b>' + escapeHtml(s[1]) + '</b><span>' + escapeHtml(s[0]) + '</span></div>';
    }).join('');
  }

  /* ============================================================
   * 2. 背景氛围
   * ============================================================ */
  function buildBackground() {
    var iconNames = ['heart', 'sparkles', 'star', 'rabbit', 'guitar', 'shopping-bag', 'package', 'camera'];
    var floatHtml = '';
    for (var i = 0; i < 18; i++) {
      var left = Math.round((i * 53) % 100);
      var top = Math.round((i * 37 + 11) % 100);
      var delay = -(i % 9) * 1.7;
      floatHtml += '<span class="floaty" style="left:' + left + '%;top:' + top + '%;animation-delay:' + delay + 's">' +
        icon(iconNames[i % iconNames.length]) + '</span>';
    }
    $('#floaties').innerHTML = floatHtml;

    var sparkHtml = '';
    for (var j = 0; j < 30; j++) {
      var l = Math.round((j * 67) % 100);
      var t = Math.round((j * 43 + 7) % 100);
      var d = -(j % 8) * 0.6;
      sparkHtml += '<span class="sparkle" style="left:' + l + '%;top:' + t + '%;animation-delay:' + d + 's"></span>';
    }
    $('#sparkles').innerHTML = sparkHtml;
  }

  /* ============================================================
   * 3. 作品卡片
   * ============================================================ */
  function workCardHtml(item, kind, index) {
    var cat = categoryOf(item);
    var isBili = kind === 'bili';
    var delay = Math.min(0.32, 0.03 + ((index || 0) % 10) * 0.035);
    var meta = isBili
      ? icon('play') + numberLabel(item.play) + ' · ' + icon('message-circle') + numberLabel(item.danmu)
      : icon('thumbs-up') + numberLabel(item.likes);
    var overlay = isBili ? '<div class="play-overlay"><i>' + icon('play') + '</i></div>' : '';
    return '<article class="work-card reveal" style="--d:' + delay.toFixed(3) + 's" data-id="' + escapeHtml(item.id) + '" data-cat="' + escapeHtml(item.category) + '" role="button" tabindex="0" aria-label="查看：' + escapeHtml(item.title) + '">' +
      '<div class="work-card-media ' + (isBili ? 'card-16' : 'card-43') + '">' +
      '<img loading="lazy" src="' + escapeHtml(item.cover) + '" alt="">' +
      '<span class="media-badge">' + (isBili ? icon('tv') + ' B站' : icon('book-heart') + ' 小红书') + '</span>' + overlay +
      '</div>' +
      '<div class="work-card-body">' +
      '<h3>' + escapeHtml(item.title) + '</h3>' +
      '<div class="work-card-meta">' +
      '<span class="meta-pill">' + icon(categoryIcon(item.category)) + ' ' + escapeHtml(item.category) + '</span>' +
      '<span>' + meta + '</span>' +
      (isBili && item.date ? '<span>' + icon('calendar') + escapeHtml(item.date) + '</span>' : '') +
      '</div>' +
      '</div></article>';
  }

  function bindCard(card) {
    card.addEventListener('click', function () {
      var id = card.getAttribute('data-id');
      var found = findItem(id);
      if (found) openDetail(found.item, found.kind);
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });
  }

  function renderCards(container, items, kind) {
    container.innerHTML = items.map(function (item, index) {
      return workCardHtml(item, kind, index);
    }).join('');
    $$('#' + container.id + ' .work-card').forEach(bindCard);
  }

  function findItem(id) {
    var entry = allItems.filter(function (e) { return e.item.id === id; })[0];
    return entry || null;
  }

  /* ============================================================
   * 4. 精选
   * ============================================================ */
  function buildFeatured() {
    var xhsTop = DATA.xhs.items.slice().sort(function (a, b) {
      return parseCount(b.likes) - parseCount(a.likes);
    }).slice(0, 3);
    var biliTop = DATA.bili.items.slice().sort(function (a, b) {
      return parseCount(b.play) - parseCount(a.play);
    }).slice(0, 3);

    var featured = [];
    var seen = {};
    for (var i = 0; i < 3; i++) {
      [xhsTop[i], biliTop[i]].forEach(function (item) {
        if (item && !seen[item.id]) {
          seen[item.id] = true;
          featured.push({ item: item, kind: platformOf(item) });
        }
      });
    }

    $('#featured-scroller').innerHTML = featured.map(function (entry, index) {
      return workCardHtml(entry.item, entry.kind, index);
    }).join('');
    $$('#featured-scroller .work-card').forEach(bindCard);
  }

  /* ============================================================
   * 5. 分区与筛选
   * ============================================================ */
  function buildFilters(containerId, items, gridId) {
    var counts = {};
    items.forEach(function (item) { counts[item.category] = (counts[item.category] || 0) + 1; });
    var cats = [{ key: '全部', icon: 'sparkles', color: '#ff7bac' }].concat(DATA.categories.filter(function (c) {
      return counts[c.key] > 0;
    }));
    var box = $('#' + containerId);
    box.innerHTML = cats.map(function (c) {
      return '<button class="filter-chip" data-cat="' + escapeHtml(c.key) + '">' +
        icon(c.key === '全部' ? 'sparkles' : categoryIcon(c.key)) + ' ' + escapeHtml(c.key) +
        (c.key === '全部' ? ' · ' + items.length : ' · ' + counts[c.key]) +
        '</button>';
    }).join('');

    $$('#' + containerId + ' .filter-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        $$('#' + containerId + ' .filter-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var cat = chip.getAttribute('data-cat');
        $$('#' + gridId + ' .work-card').forEach(function (card) {
          var show = cat === '全部' || card.getAttribute('data-cat') === cat;
          card.style.display = show ? '' : 'none';
        });
      });
    });

    // 默认激活“全部”
    var first = box.querySelector('.filter-chip');
    if (first) first.classList.add('active');
  }

  function buildXhs() {
    renderCards($('#xhs-grid'), DATA.xhs.items, 'xhs');
    buildFilters('xhs-filters', DATA.xhs.items, 'xhs-grid');
  }

  function buildBili() {
    renderCards($('#bili-grid'), DATA.bili.items, 'bili');
    buildFilters('bili-filters', DATA.bili.items, 'bili-grid');
  }

  /* ============================================================
   * 6. 关注
   * ============================================================ */
  function buildFollow() {
    var meta = DATA.meta;
    $('#follow-cards').innerHTML =
      '<a class="follow-card" href="' + escapeHtml(meta.biliUrl) + '" target="_blank" rel="noopener noreferrer">' +
      '<img loading="lazy" src="' + escapeHtml(meta.biliAvatar) + '" alt="B站头像">' +
      '<div><b>' + icon('tv') + ' 小白超白的-</b><span>B站 · 粉丝 ' + escapeHtml(DATA.stats.bili.fans) + ' · 获赞 ' + escapeHtml(DATA.stats.bili.likes) +
      '<br>播放 ' + escapeHtml(DATA.stats.bili.plays) + ' · 视频 ' + escapeHtml(DATA.stats.bili.videos) + '</span><em>去B站关注 ' + icon('external-link') + '</em></div></a>' +
      '<a class="follow-card" href="' + escapeHtml(meta.xhsUrl) + '" target="_blank" rel="noopener noreferrer">' +
      '<img loading="lazy" src="' + escapeHtml(meta.avatar) + '" alt="小红书头像">' +
      '<div><b>' + icon('book-heart') + ' 小白超白的</b><span>小红书 · 粉丝 ' + escapeHtml(DATA.stats.xhs.followers) + ' · 获赞与收藏 ' +
      escapeHtml(DATA.stats.xhs.likesAndCollects) + '<br>小红书号 ' + escapeHtml(DATA.stats.xhs.redId) + '</span><em>去小红书关注 ' + icon('external-link') + '</em></div></a>';
  }

  /* ============================================================
   * 7. 搜索
   * ============================================================ */
  var allItems = DATA.xhs.items.map(function (item) {
    return { item: item, kind: 'xhs', platform: '小红书' };
  }).concat(DATA.bili.items.map(function (item) {
    return { item: item, kind: 'bili', platform: 'B站' };
  }));

  function searchItems(q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    return allItems.filter(function (entry) {
      var item = entry.item;
      return (item.title || '').toLowerCase().indexOf(q) >= 0 ||
        (item.category || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 18);
  }

  function renderSearchResults(q) {
    var list = $('#search-results');
    var results = searchItems(q);
    if (!results.length) {
      list.innerHTML = '<li class="search-empty">没找到对应作品，换个关键词试试：开箱 / GBC / chiikawa</li>';
      return;
    }
    list.innerHTML = results.map(function (entry) {
      var cat = categoryOf(entry.item);
      var meta = entry.kind === 'bili'
        ? icon('play') + numberLabel(entry.item.play) + ' · ' + icon('message-circle') + numberLabel(entry.item.danmu)
        : icon('thumbs-up') + numberLabel(entry.item.likes);
      return '<li data-id="' + escapeHtml(entry.item.id) + '">' +
        '<img loading="lazy" src="' + escapeHtml(entry.item.cover) + '" alt="">' +
        '<div class="search-result-main"><b>' + escapeHtml(entry.item.title) + '</b>' +
        '<span>' + entry.platform + ' · ' + icon(categoryIcon(entry.item.category)) + ' ' + escapeHtml(entry.item.category) + ' · ' + meta + '</span></div></li>';
    }).join('');
    $$('#search-results li[data-id]').forEach(function (li) {
      li.addEventListener('click', function () {
        var entry = findItem(li.getAttribute('data-id'));
        closeSearch();
        if (entry) openDetail(entry.item, entry.kind);
      });
    });
  }

  function openSearch() {
    $('#search-panel').classList.add('open');
    $('#search-panel').setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
    setTimeout(function () { $('#search-input').focus(); }, 60);
    renderSearchResults($('#search-input').value);
  }

  function closeSearch() {
    $('#search-panel').classList.remove('open');
    $('#search-panel').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
  }

  /* ============================================================
   * 8. 详情弹层
   * ============================================================ */
  function openDetail(item, kind) {
    if (!item) return;
    var cat = categoryOf(item);
    $('#detail-cover').src = item.cover || '';
    $('#detail-cover').alt = item.title || '作品封面';
    $('#detail-cat').innerHTML = icon(categoryIcon(item.category)) + ' ' + escapeHtml(item.category);
    $('#detail-type').textContent = kind === 'bili' ? 'BILIBILI VIDEO' : 'XIAOHONGSHU POST';
    $('#detail-title').textContent = item.title || '小白作品';
    $('#detail-stats').innerHTML = kind === 'bili'
      ? '<span class="detail-stat">' + icon('play') + ' 播放 ' + escapeHtml(numberLabel(item.play)) + '</span>' +
        '<span class="detail-stat">' + icon('message-circle') + ' 弹幕 ' + escapeHtml(numberLabel(item.danmu)) + '</span>' +
        (item.date ? '<span class="detail-stat">' + icon('calendar') + ' ' + escapeHtml(item.date) + '</span>' : '')
      : '<span class="detail-stat">' + icon('thumbs-up') + ' 点赞 ' + escapeHtml(numberLabel(item.likes)) + '</span>' +
        '<span class="detail-stat">' + icon('book-heart') + ' 小红书号 ' + escapeHtml(DATA.stats.xhs.redId) + '</span>';
    var link = $('#detail-link');
    if (item.url) {
      link.href = item.url;
      link.classList.remove('disabled');
      link.innerHTML = icon('external-link') + ' 打开原作品';
    } else {
      link.href = '#';
      link.classList.add('disabled');
      link.innerHTML = '暂未开放原链接 ' + icon('external-link');
    }
    $('#detail-modal').classList.add('open');
    $('#detail-modal').setAttribute('aria-hidden', 'false');
    document.body.classList.add('no-scroll');
  }

  function closeDetail() {
    $('#detail-modal').classList.remove('open');
    $('#detail-modal').setAttribute('aria-hidden', 'true');
    if (!$('#search-panel').classList.contains('open')) {
      document.body.classList.remove('no-scroll');
    }
  }

  /* ============================================================
   * 9. 日夜主题
   * ============================================================ */
  function toggleTheme() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var next = isDark ? 'day' : 'night';
    document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
    $('#theme-btn').innerHTML = isDark ? icon('moon') : icon('sun');
    if (window.XBW_BG && window.XBW_BG.setTheme) window.XBW_BG.setTheme(next);
  }

  /* ============================================================
   * 10. 背景音乐（内置原创八音盒，默认关闭）
   * ============================================================ */
  var MusicBox = {
    ctx: null,
    master: null,
    playing: false,
    timer: null,
    nextTime: 0,
    step: 0,
    melody: [72, 74, 76, 79, 81, 79, 76, 74, 72, 74, 76, 81, 79, 76, 74, 72,
      67, 69, 71, 74, 76, 79, 81, 79, 76, 74, 72, 74, 76, 79, 74, 72],
    ensure: function () {
      if (this.ctx) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.14;
        this.master.connect(this.ctx.destination);
      } catch (e) {
        this.ctx = null;
      }
    },
    note: function (freq, t, dur, vol) {
      if (!this.ctx || !this.master) return;
      var osc = this.ctx.createOscillator();
      var osc2 = this.ctx.createOscillator();
      var g = this.ctx.createGain();
      osc.type = 'sine';
      osc2.type = 'triangle';
      osc.frequency.value = freq;
      osc2.frequency.value = freq * 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      osc2.connect(g);
      var g2 = this.ctx.createGain();
      g2.gain.value = 0.22;
      g.connect(g2);
      g2.connect(this.master);
      osc.start(t);
      osc2.start(t);
      osc.stop(t + dur + 0.05);
      osc2.stop(t + dur + 0.05);
    },
    schedule: function () {
      while (this.nextTime < this.ctx.currentTime + 0.35) {
        var midi = this.melody[this.step % this.melody.length];
        var freq = 440 * Math.pow(2, (midi - 69) / 12);
        var dur = this.step % 4 === 3 ? 0.42 : 0.28;
        this.note(freq, this.nextTime, dur, this.step % 2 === 0 ? 0.5 : 0.3);
        if (this.step % 2 === 0) this.note(midi - 12, this.nextTime, dur, 0.14);
        this.nextTime += 0.24;
        this.step++;
      }
    },
    start: function () {
      this.ensure();
      if (!this.ctx) return false;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this.nextTime = this.ctx.currentTime + 0.06;
      this.timer = setInterval(this.schedule.bind(this), 90);
      return true;
    },
    stop: function () {
      this.playing = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    }
  };

  function toggleMusic() {
    var btn = $('#music-btn');
    if (!MusicBox.playing) {
      if (MusicBox.start()) {
        btn.classList.add('playing');
        btn.innerHTML = icon('music');
      }
    } else {
      MusicBox.stop();
      btn.classList.remove('playing');
      btn.innerHTML = icon('music');
    }
  }

  /* ============================================================
   * 11. 滚动 / 入场 / 导航状态
   * ============================================================ */
  var sectionIds = ['about', 'featured', 'xhs', 'bili', 'follow'];

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    $('#topbar').classList.toggle('scrolled', y > 30);
    $('#back-top').classList.toggle('show', y > 700);

    var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    $('#scroll-progress-bar').style.width = Math.min(100, y / max * 100).toFixed(2) + '%';

    var current = 'about';
    for (var i = 0; i < sectionIds.length; i++) {
      var el = document.getElementById(sectionIds[i]);
      if (el && el.getBoundingClientRect().top <= 140) current = sectionIds[i];
    }
    $$('.nav-links a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }

  function buildObservers() {
    if ('IntersectionObserver' in window) {
      var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
      $$('.reveal').forEach(function (el) { revealObserver.observe(el); });
    } else {
      $$('.reveal').forEach(function (el) { el.classList.add('in'); });
    }
  }

  function bindUI() {
    $('#search-btn').addEventListener('click', function () {
      if ($('#search-panel').classList.contains('open')) closeSearch(); else openSearch();
    });
    $('#search-close').addEventListener('click', closeSearch);
    $('#search-input').addEventListener('input', function () { renderSearchResults(this.value); });
    $('#search-input').addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSearch(); });
    $$('#search-hints button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('#search-input').value = btn.getAttribute('data-q');
        renderSearchResults(btn.getAttribute('data-q'));
        $('#search-input').focus();
      });
    });
    $('#theme-btn').addEventListener('click', toggleTheme);
    $('#music-btn').addEventListener('click', toggleMusic);
    $$('[data-close-detail]').forEach(function (el) { el.addEventListener('click', closeDetail); });
    $('#detail-link').addEventListener('click', function (e) {
      if (this.classList.contains('disabled')) e.preventDefault();
    });
    $('#back-top').addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $$('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () { closeSearch(); closeDetail(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeSearch();
        closeDetail();
      }
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && MusicBox.playing) {
        MusicBox.stop();
        $('#music-btn').classList.remove('playing');
        $('#music-btn').innerHTML = icon('music');
      }
    });
  }

  /* ============================================================
   * 12. 启动
   * ============================================================ */
  function start() {
    if (!DATA) return;
    buildHero();
    buildBackground();
    buildFeatured();
    buildXhs();
    buildBili();
    buildFollow();
    bindUI();

    var bg = window.XBW_BG;
    if (bg && bg.supported) {
      document.body.classList.add('xwb-intro');
      var shown = false;
      function revealContent() {
        if (shown) return;
        shown = true;
        document.body.classList.remove('xwb-intro');
        document.body.classList.add('xwb-boomed');
        setTimeout(buildObservers, 80);
      }
      document.addEventListener('xwb:boom', revealContent, { once: true });
      bg.start();
      // 兜底：万一某些设备没触发爆炸事件，1.5 秒后仍显示内容
      setTimeout(revealContent, 1500);
    } else {
      buildObservers();
    }

    onScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
