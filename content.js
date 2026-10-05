(() => {
  'use strict';

  const API = 'https://api.bilibili.com';
  const MODES = [['group', '关注分组'], ['zone', '分区'], ['up', 'UP主']];
  const RANGES = [[1, '1天'], [3, '3天'], [7, '7天']];
  const KINDS = [['video', '视频'], ['all', '全部']];
  const MAX_PAGES = { 1: 15, 3: 30, 7: 50 };
  const FEED_TTL = 5 * 60e3;
  const GROUP_TTL = 6 * 3600e3;
  const ZONE_CACHE_MAX = 3000;

  const state = {
    settings: { mode: 'group', days: 1, kind: 'video' },
    active: null,        // 选中的分组 key；null 表示显示 B 站原生列表
    feed: null,          // { key, at, items, truncated }
    groups: null,        // { at, names: {tagid: name}, byMid: {mid: [tagid]}, order: [tagid] }
    zones: {},           // bvid -> 分区名
    zonesLoaded: false,
    zoneFailed: new Set(),
    built: [],
    loading: '',
    progress: null,      // 0~1；null 表示进度未知
    error: '',
  };

  // ---------- utils ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fixUrl = u => !u ? '' : u.startsWith('//') ? 'https:' + u : u.replace(/^http:/, 'https:');
  const thumb = (u, w, h) => !u ? '' : /^data:|@/.test(u) ? fixUrl(u) : `${fixUrl(u)}@${w}w_${h}h_1c.webp`;

  const store = {
    get: k => new Promise(r => chrome.storage.local.get(k, v => r(v[k]))),
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
  };

  function relTime(ts) {
    const s = Date.now() / 1000 - ts;
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)}分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
    const d = new Date(ts * 1000);
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  async function api(path, params = {}) {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { credentials: 'include' });
    const json = await res.json();
    if (json.code !== 0) {
      if (json.code === -101) throw new Error('未登录 B 站');
      if (json.code === -352 || json.code === -412) throw new Error('请求被 B 站风控拦截，稍后再试');
      throw new Error(json.message || `接口错误 ${json.code}`);
    }
    return json.data;
  }

  // ---------- 数据 ----------
  function majorInfo(mj) {
    if (!mj) return {};
    if (mj.archive) {
      const a = mj.archive;
      return { title: a.title, cover: a.cover, url: fixUrl(a.jump_url), bvid: a.bvid, badge: a.duration_text };
    }
    if (mj.opus) return { title: mj.opus.title || mj.opus.summary?.text, cover: mj.opus.pics?.[0]?.url, url: fixUrl(mj.opus.jump_url) };
    if (mj.article) return { title: mj.article.title, cover: mj.article.covers?.[0], url: fixUrl(mj.article.jump_url) };
    if (mj.pgc) return { title: mj.pgc.title, cover: mj.pgc.cover, url: fixUrl(mj.pgc.jump_url) };
    if (mj.ugc_season) return { title: mj.ugc_season.title, cover: mj.ugc_season.cover, url: fixUrl(mj.ugc_season.jump_url) };
    if (mj.live_rcmd) {
      try {
        const l = JSON.parse(mj.live_rcmd.content).live_play_info;
        return { title: l.title, cover: l.cover, url: fixUrl(l.link), badge: '直播' };
      } catch { return {}; }
    }
    if (mj.live) return { title: mj.live.title, cover: mj.live.cover, url: fixUrl(mj.live.jump_url), badge: '直播' };
    if (mj.draw) return { cover: mj.draw.items?.[0]?.src };
    return {};
  }

  function parseItem(raw) {
    const m = raw.modules || {};
    const au = m.module_author;
    if (!au || !au.pub_ts) return null;
    const dyn = m.module_dynamic || {};
    const text = dyn.desc?.text || '';
    let info, title, url;
    if (raw.type === 'DYNAMIC_TYPE_FORWARD' && raw.orig) {
      const od = raw.orig.modules?.module_dynamic || {};
      info = majorInfo(od.major);
      title = `转发：${info.title || od.desc?.text || '动态'}`;
      url = `https://t.bilibili.com/${raw.id_str}`;
    } else {
      info = majorInfo(dyn.major);
      title = info.title || text || '分享了动态';
      url = info.url || `https://t.bilibili.com/${raw.id_str}`;
    }
    return {
      id: raw.id_str, type: raw.type, mid: String(au.mid), name: au.name, face: au.face,
      ts: Number(au.pub_ts), title, url, cover: info.cover, badge: info.badge, bvid: info.bvid || null,
    };
  }

  async function loadFeed(force) {
    const { days, kind } = state.settings;
    const key = `${days}-${kind}`;
    if (!force && state.feed?.key === key && Date.now() - state.feed.at < FEED_TTL) return;
    const cutoff = Date.now() / 1000 - days * 86400;
    const items = [];
    const seen = new Set();
    let offset = '', truncated = false;
    for (let page = 1; ; page++) {
      setLoading(`读取动态 第 ${page} 页…`);
      const d = await api('/x/polymer/web-dynamic/v1/feed/all', {
        type: kind, page, offset, timezone_offset: -480, features: 'itemOpusStyle',
      });
      let reachedOld = false;
      for (const raw of d.items || []) {
        const it = parseItem(raw);
        if (!it || seen.has(it.id)) continue;
        if (it.ts < cutoff) { reachedOld = true; continue; }
        seen.add(it.id);
        items.push(it);
      }
      if (reachedOld || !d.has_more) break;
      if (page >= MAX_PAGES[days]) { truncated = true; break; }
      offset = d.offset;
      await sleep(250);
    }
    items.sort((a, b) => b.ts - a.ts);
    state.feed = { key, at: Date.now(), items, truncated };
  }

  async function loadGroups(force) {
    if (!force && state.groups && Date.now() - state.groups.at < GROUP_TTL) return;
    if (!force && !state.groups) {
      const cached = await store.get('groups');
      if (cached && Date.now() - cached.at < GROUP_TTL) { state.groups = cached; return; }
    }
    setLoading('读取关注分组…');
    const nav = await api('/x/web-interface/nav');
    const tags = await api('/x/relation/tags');
    const names = {}, byMid = {};
    for (const t of tags || []) {
      names[t.tagid] = t.name;
      // 默认分组不用拉：不在任何其它分组里的 UP 就是默认分组
      if (t.tagid === 0 || !t.count) continue;
      for (let pn = 1; ; pn++) {
        setLoading(`读取分组「${t.name}」…`);
        const list = await api('/x/relation/tag', { mid: nav.mid, tagid: t.tagid, pn, ps: 50 });
        for (const u of list || []) (byMid[u.mid] ||= []).push(t.tagid);
        if (!list || list.length < 50 || pn * 50 >= t.count) break;
        await sleep(150);
      }
    }
    state.groups = { at: Date.now(), names, byMid, order: (tags || []).map(t => t.tagid) };
    store.set('groups', state.groups);
  }

  async function loadZones() {
    if (!state.zonesLoaded) {
      state.zones = (await store.get('zones')) || {};
      state.zonesLoaded = true;
    }
    const need = missingZones();
    if (!need.length) return;
    const total = need.length;
    let done = 0, fails = 0;
    const worker = async () => {
      while (need.length && fails < 5) {
        const bvid = need.shift();
        try {
          const v = await api('/x/web-interface/view', { bvid });
          state.zones[bvid] = v.tname || v.tname_v2 || '其他';
        } catch {
          fails++;
          state.zoneFailed.add(bvid);
        }
        setLoading(`获取视频分区 ${++done}/${total}`, done / total);
        await sleep(120);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const keys = Object.keys(state.zones);
    if (keys.length > ZONE_CACHE_MAX) {
      for (const k of keys.slice(0, keys.length - ZONE_CACHE_MAX)) delete state.zones[k];
    }
    store.set('zones', state.zones);
  }

  function missingZones() {
    const items = state.feed?.items || [];
    return [...new Set(items.map(i => i.bvid).filter(b => b && !state.zones[b] && !state.zoneFailed.has(b)))];
  }

  function needsLoad() {
    const { days, kind, mode } = state.settings;
    if (!state.feed || state.feed.key !== `${days}-${kind}` || Date.now() - state.feed.at > FEED_TTL) return true;
    if (mode === 'group' && (!state.groups || Date.now() - state.groups.at > GROUP_TTL)) return true;
    if (mode === 'zone' && (!state.zonesLoaded || missingZones().length)) return true;
    return false;
  }

  let running = null, rerun = false, rerunForce = false;
  function refresh(force = false) {
    if (running) { rerun = true; rerunForce ||= force; return running; }
    running = (async () => {
      state.error = '';
      try {
        await loadFeed(force);
        if (state.settings.mode === 'group') await loadGroups(force);
        if (state.settings.mode === 'zone') await loadZones();
      } catch (e) {
        state.error = e.message || String(e);
      }
    })().finally(() => {
      state.loading = '';
      running = null;
      if (rerun) {
        const f = rerunForce;
        rerun = rerunForce = false;
        refresh(f);
      } else {
        render();
      }
    });
    return running;
  }

  function setLoading(msg, progress = null) {
    state.loading = msg;
    state.progress = progress;
    render();
  }

  // ---------- 分组 ----------
  function typeLabel(type) {
    switch (type) {
      case 'DYNAMIC_TYPE_DRAW': case 'DYNAMIC_TYPE_WORD': return '图文动态';
      case 'DYNAMIC_TYPE_ARTICLE': return '专栏';
      case 'DYNAMIC_TYPE_LIVE_RCMD': case 'DYNAMIC_TYPE_LIVE': return '直播';
      case 'DYNAMIC_TYPE_FORWARD': return '转发';
      case 'DYNAMIC_TYPE_PGC': case 'DYNAMIC_TYPE_PGC_UNION': return '番剧影视';
      default: return '其他动态';
    }
  }

  function buildGroups() {
    const items = state.feed?.items || [];
    const { mode } = state.settings;
    if (mode === 'group' && !state.groups) return [];
    const map = new Map();
    const add = (key, label, it) => {
      let g = map.get(key);
      if (!g) map.set(key, g = { key, label, items: [] });
      g.items.push(it);
    };
    for (const it of items) {
      if (mode === 'up') {
        add('u' + it.mid, it.name, it);
      } else if (mode === 'zone') {
        const z = it.bvid ? (state.zones[it.bvid] || '未知分区') : typeLabel(it.type);
        add('z' + z, z, it);
      } else {
        const tags = state.groups.byMid[it.mid];
        if (tags?.length) for (const t of tags) add('g' + t, state.groups.names[t] ?? `分组${t}`, it);
        else add('g0', state.groups.names[0] || '默认分组', it);
      }
    }
    const arr = [...map.values()];
    if (mode === 'group') {
      const order = state.groups.order;
      const rank = k => { const i = order.indexOf(Number(k.slice(1))); return i < 0 ? 1e9 : i; };
      arr.sort((a, b) => rank(a.key) - rank(b.key));
    } else {
      arr.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label, 'zh'));
    }
    return arr;
  }

  // ---------- UI ----------
  const ICON = {
    refresh: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L21 10"/></svg>',
    video: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke-width="1.5"/></svg>',
    empty: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none"><rect x="10" y="16" width="44" height="32" rx="8" fill="currentColor" opacity=".12"/><rect x="18" y="25" width="18" height="4" rx="2" fill="currentColor" opacity=".35"/><rect x="18" y="33" width="28" height="4" rx="2" fill="currentColor" opacity=".2"/><circle cx="48" cy="18" r="6" fill="var(--brand_pink,#ff6699)" opacity=".85"/></svg>',
  };

  const bar = document.createElement('div');
  bar.className = 'bdg-bar';
  const list = document.createElement('div');
  list.className = 'bdg-list';
  let listKey = '';

  function renderBar(groups) {
    const { mode, days, kind } = state.settings;
    const tabs = MODES.map(([v, label]) =>
      `<button type="button" class="bdg-tab ${v === mode ? 'on' : ''}" data-set="mode" data-v="${v}">${label}</button>`).join('');
    const seg = RANGES.map(([v, label]) =>
      `<button type="button" class="${v === days ? 'on' : ''}" data-set="days" data-v="${v}">${label}</button>`).join('');

    let chips;
    if (groups.length) {
      chips = [`<button type="button" class="bdg-chip ${state.active ? '' : 'on'}" data-g=""><span>全部</span></button>`]
        .concat(groups.map(g => `<button type="button" class="bdg-chip ${g.key === state.active ? 'on' : ''}" data-g="${esc(g.key)}" title="${esc(g.label)}"><span>${esc(g.label)}</span><i>${g.items.length}</i></button>`))
        .join('');
    } else if (running) {
      chips = `<span class="bdg-wait">${esc(state.loading || '加载中…')}</span>`;
    } else {
      chips = `<span class="bdg-wait">最近 ${days} 天没有动态</span>`;
    }

    let note = '';
    if (state.error) note = `<div class="bdg-note err">${esc(state.error)}</div>`;
    else if (!running && state.feed?.truncated) note = `<div class="bdg-note">只加载了最近 ${state.feed.items.length} 条，更早的没有显示</div>`;

    const p = state.progress;
    const progress = running
      ? `<div class="bdg-progress ${p == null ? 'indet' : ''}"><i style="width:${p == null ? 30 : Math.round(p * 100)}%"></i></div>`
      : '';

    const old = bar.querySelector('.bdg-chips');
    const scrollTop = old ? old.scrollTop : 0;
    bar.innerHTML = `
      <div class="bdg-row">
        <div class="bdg-tabs">${tabs}</div>
        <div class="bdg-tools">
          <span class="bdg-seg">${seg}</span>
          <button type="button" class="bdg-toggle ${kind === 'video' ? 'on' : ''}" data-act="kind" title="只看投稿视频">${ICON.video}<span>仅视频</span></button>
          <button type="button" class="bdg-icon ${running ? 'spin' : ''}" data-act="refresh" title="重新加载">${ICON.refresh}</button>
        </div>
      </div>
      <div class="bdg-chips">${chips}</div>
      ${note}${progress}`;
    const el = bar.querySelector('.bdg-chips');
    el.scrollTop = scrollTop;
  }

  function itemHtml(it) {
    return `
      <div class="bdg-item">
        <a class="bdg-face" href="https://space.bilibili.com/${esc(it.mid)}" target="_blank" title="${esc(it.name)}">
          <img src="${esc(thumb(it.face, 80, 80))}" loading="lazy" alt="">
        </a>
        <a class="bdg-body" href="${esc(it.url)}" target="_blank">
          <div class="bdg-main">
            <div class="bdg-name">${esc(it.name)}</div>
            <div class="bdg-title">${esc(it.title)}</div>
            <div class="bdg-time">${relTime(it.ts)}</div>
          </div>
          ${it.cover ? `<div class="bdg-cover"><img src="${esc(thumb(it.cover, 200, 112))}" loading="lazy" alt="">${it.badge ? `<span>${esc(it.badge)}</span>` : ''}</div>` : ''}
        </a>
      </div>`;
  }

  function renderList(groups) {
    const box = bar.parentElement;
    if (box) box.classList.toggle('bdg-on', !!state.active);
    if (!state.active) { list.innerHTML = ''; listKey = ''; return; }

    const g = groups.find(x => x.key === state.active);
    let html, key;
    if (g) {
      key = `${state.active}|${state.feed?.at}|${g.items.length}`;
      html = g.items.map(itemHtml).join('');
    } else if (running) {
      key = 'skeleton';
      html = '<div class="bdg-item bdg-skel"><b class="f"></b><div class="bdg-main"><b></b><b></b><b class="s"></b></div><b class="c"></b></div>'.repeat(3);
    } else {
      key = 'empty';
      html = `<div class="bdg-empty">${ICON.empty}<div>这个分组最近 ${state.settings.days} 天没有动态</div></div>`;
    }
    if (key === listKey) return;
    const fresh = !listKey.startsWith(state.active + '|');
    listKey = key;
    list.innerHTML = html;
    if (fresh) {
      list.classList.remove('bdg-in');
      void list.offsetWidth;
      list.classList.add('bdg-in');
    }
  }

  function render() {
    if (!running) state.built = buildGroups();
    renderBar(state.built);
    renderList(state.built);
  }

  bar.addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.target.closest('button');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'refresh') {
      refresh(true);
      render();
      return;
    }
    if (act === 'kind' || btn.dataset.set) {
      const k = act === 'kind' ? 'kind' : btn.dataset.set;
      const v = act === 'kind' ? (state.settings.kind === 'video' ? 'all' : 'video')
        : k === 'days' ? Number(btn.dataset.v) : btn.dataset.v;
      if (state.settings[k] === v) return;
      state.settings[k] = v;
      if (k === 'mode') {
        state.active = null;
        const chipsEl = bar.querySelector('.bdg-chips');
        if (chipsEl) chipsEl.scrollTop = 0;
      }
      store.set('settings', state.settings);
      refresh();
      render();
      return;
    }
    if ('g' in btn.dataset) {
      const box = bar.parentElement;
      // 从原生列表切过来时记住弹窗高度，避免内容变少时弹窗缩到鼠标外面而被关掉
      if (!state.active && box) list.style.minHeight = `${box.clientHeight - bar.offsetHeight}px`;
      state.active = btn.dataset.g || null;
      render();
      if (box) box.scrollTop = 0;
    }
  });
  bar.addEventListener('mousedown', e => e.stopPropagation());

  // ---------- 挂载到顶栏动态弹窗 ----------
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const ours = el => !!el.closest('.bdg-bar, .bdg-list');

  function findPanel() {
    for (const sel of ['.dynamic-panel-popover', '.header-dynamic-popover', '.dynamic-popover']) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // 顶栏的「动态」入口，弹窗通常是它旁边的兄弟节点
    for (const a of document.querySelectorAll('a[href*="t.bilibili.com"]')) {
      const text = a.textContent.replace(/\s+/g, '');
      if (!text.includes('动态') || text.length > 8) continue;
      const wrap = a.closest('.v-popover-wrap') || a.parentElement;
      if (!wrap) continue;
      const pop = wrap.querySelector('.v-popover')
        || [...wrap.children].find(c => c !== a && !c.contains(a) && c.querySelector('img'));
      if (pop) return pop;
    }
    // 兜底：从弹窗里的「历史动态」分隔文字往上找
    const roots = document.querySelectorAll('#biliMainHeader, .bili-header, .international-header, header, body > [class*="popover"]');
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeValue.trim() !== '历史动态' || ours(n.parentElement)) continue;
        const pop = n.parentElement.closest('[class*="popover"], [class*="panel"]');
        if (pop) return pop;
      }
    }
    return null;
  }

  function findScrollBox(panel) {
    let best = null, bestH = -1;
    for (const el of [panel, ...panel.querySelectorAll('div, ul')]) {
      if (ours(el)) continue;
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.clientHeight > bestH) { best = el; bestH = el.clientHeight; }
    }
    return best || panel;
  }

  function mount() {
    if (bar.isConnected && list.isConnected && bar.parentElement === list.parentElement) return;
    const panel = findPanel();
    if (!panel) return;
    const box = findScrollBox(panel);
    box.prepend(bar);
    bar.after(list);
    render();
    if (visible(box) && needsLoad()) refresh();
  }

  let mountTimer = null;
  const scheduleMount = () => {
    if (mountTimer) return;
    mountTimer = setTimeout(() => { mountTimer = null; mount(); }, 300);
  };

  let hoverTimer = null;
  document.addEventListener('mouseover', () => {
    if (hoverTimer) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      mount();
      if (bar.isConnected && visible(bar) && !running && needsLoad()) refresh();
    }, 300);
  }, { passive: true });

  (async () => {
    const saved = await store.get('settings');
    if (saved) Object.assign(state.settings, saved);
    new MutationObserver(scheduleMount).observe(document.body, { childList: true, subtree: true });
    mount();
  })();
})();
