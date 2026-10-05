// 演示用：模拟 chrome.storage 和 B 站接口，数据全部虚构。
(() => {
  const now = Math.floor(Date.now() / 1000);
  const H = 3600;

  // ---------- 头像 / 封面（纯 SVG 生成） ----------
  const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const face = (ch, a, b) => svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><text x="40" y="52" font-size="34" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${ch}</text></svg>`);

  const COVERS = {
    esports: (t) => `<rect width="200" height="112" fill="#1d2440"/><path d="M0 112 L90 0 H130 L40 112Z" fill="#ff8a3d" opacity=".9"/><path d="M60 112 L150 0 H170 L80 112Z" fill="#ffd166" opacity=".8"/><circle cx="160" cy="70" r="26" fill="none" stroke="#fff" stroke-width="5" opacity=".9"/><text x="14" y="30" font-size="18" font-weight="800" fill="#fff" font-family="Arial">${t}</text>`,
    music: (t) => `<rect width="200" height="112" fill="#f4ede4"/><circle cx="140" cy="56" r="44" fill="#2b2b2b"/><circle cx="140" cy="56" r="30" fill="none" stroke="#555" stroke-width="2"/><circle cx="140" cy="56" r="12" fill="#ff6f91"/><text x="16" y="62" font-size="20" font-style="italic" fill="#3b3b3b" font-family="Georgia">${t}</text>`,
    tech: (t) => `<rect width="200" height="112" fill="#0f3d3e"/><g stroke="#3fd0c9" stroke-width="1" opacity=".35">${Array.from({ length: 10 }, (_, i) => `<path d="M${i * 22} 0V112M0 ${i * 14}H200"/>`).join('')}</g><rect x="112" y="24" width="64" height="64" rx="10" fill="#3fd0c9"/><rect x="128" y="40" width="32" height="32" rx="4" fill="#0f3d3e"/><text x="16" y="66" font-size="20" font-weight="700" fill="#e8fffd" font-family="Arial">${t}</text>`,
    food: (t) => `<rect width="200" height="112" fill="#ffb347"/><circle cx="130" cy="60" r="40" fill="#fff4e0"/><circle cx="130" cy="60" r="28" fill="#e85d3f"/><circle cx="120" cy="52" r="6" fill="#ffd166"/><circle cx="140" cy="66" r="5" fill="#7bc96f"/><text x="14" y="34" font-size="18" font-weight="800" fill="#5a2d0c" font-family="Arial">${t}</text>`,
    game: (t) => `<rect width="200" height="112" fill="#6c5ce7"/>${Array.from({ length: 14 }, (_, i) => `<rect x="${(i * 37) % 190}" y="${(i * 53) % 100}" width="12" height="12" fill="#a29bfe" opacity=".7"/>`).join('')}<rect x="20" y="70" width="160" height="20" fill="#55efc4"/><text x="16" y="44" font-size="20" font-weight="800" fill="#fff" font-family="Courier New">${t}</text>`,
    cat: (t) => `<rect width="200" height="112" fill="#ffe9b3"/><circle cx="120" cy="66" r="30" fill="#f4a259"/><path d="M96 46 L100 26 L112 40Z M144 46 L140 26 L128 40Z" fill="#f4a259"/><circle cx="110" cy="64" r="3" fill="#333"/><circle cx="130" cy="64" r="3" fill="#333"/><text x="14" y="34" font-size="18" font-weight="800" fill="#8a5a00" font-family="Arial">${t}</text>`,
    science: (t) => `<rect width="200" height="112" fill="#12355b"/><circle cx="140" cy="56" r="34" fill="#4ea8de"/><path d="M106 56 Q140 30 174 56 Q140 82 106 56Z" fill="#7bdff2" opacity=".6"/><circle cx="60" cy="24" r="2" fill="#fff"/><circle cx="30" cy="80" r="2" fill="#fff"/><text x="14" y="64" font-size="18" font-weight="700" fill="#fff" font-family="Arial">${t}</text>`,
    outdoor: (t) => `<rect width="200" height="112" fill="#bde0fe"/><path d="M0 112 L60 40 L100 90 L140 30 L200 112Z" fill="#52796f"/><path d="M140 30 L152 46 L128 46Z" fill="#fff"/><circle cx="40" cy="26" r="12" fill="#ffd166"/><text x="14" y="104" font-size="16" font-weight="700" fill="#fff" font-family="Arial">${t}</text>`,
  };
  const cover = (kind, t) => svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 112">${COVERS[kind](t)}</svg>`);

  // ---------- UP 主与关注分组 ----------
  const UPS = {
    1: { name: '赛事回放君', face: face('赛', '#ff8a3d', '#ff5e62'), tags: [-10, 11] },
    2: { name: 'OW战术板', face: face('O', '#3a7bd5', '#00d2ff'), tags: [11] },
    3: { name: '夜航电台', face: face('夜', '#8e54e9', '#4776e6'), tags: [-10, 12] },
    4: { name: '循环歌单屋', face: face('循', '#ff6f91', '#ff9671'), tags: [12] },
    5: { name: '鲸落Studio', face: face('鲸', '#2193b0', '#6dd5ed'), tags: [12] },
    6: { name: '硬核拆机', face: face('拆', '#11998e', '#38ef7d'), tags: [13] },
    7: { name: '代码与咖啡', face: face('码', '#614385', '#516395'), tags: [13] },
    8: { name: '深夜食堂阿树', face: face('食', '#f7971e', '#ffd200'), tags: [] },
    9: { name: '像素旅人', face: face('像', '#6c5ce7', '#a29bfe'), tags: [] },
    10: { name: '一只橘猫', face: face('橘', '#f4a259', '#f6d365'), tags: [] },
    11: { name: '地理小课堂', face: face('地', '#1e3c72', '#2a5298'), tags: [] },
    12: { name: '周末徒步', face: face('徒', '#56ab2f', '#a8e063'), tags: [] },
  };
  const TAGS = [
    { tagid: -10, name: '特别关注' },
    { tagid: 11, name: '守望先锋' },
    { tagid: 12, name: '音乐' },
    { tagid: 13, name: '科技' },
    { tagid: 0, name: '默认分组' },
  ];

  // [mid, 小时前, 分区, 封面类型, 封面字, 时长, 标题]
  const VIDEOS = [
    [1, 0.07, '电子竞技', 'esports', 'FINAL', '42:18', '【赛事回放】东区决赛 第三图 关键团战全记录'],
    [4, 0.9, '音乐综合', 'music', 'Cloud', '28:05', '【循环歌单】雨夜适合单曲循环的十首歌'],
    [6, 1.6, '数码', 'tech', 'TEARDOWN', '15:40', '拆开一台十年前的旗舰手机，看看里面藏着什么'],
    [8, 2.3, '美食制作', 'food', '番茄', '09:12', '深夜十分钟：一碗番茄鸡蛋面的正确打开方式'],
    [2, 3.1, '电子竞技', 'esports', 'META', '18:33', '新赛季阵容思路：为什么双坦又回来了'],
    [3, 3.8, '音乐综合', 'music', 'Night', '1:02:47', '夜航电台 vol.48｜写给失眠的人'],
    [9, 4.5, '单机游戏', 'game', 'PIXEL', '23:51', '【独立游戏】这款像素游戏让我玩到凌晨三点'],
    [5, 5.2, '音乐综合', 'music', 'Ocean', '04:36', '原创｜《鲸落》钢琴版'],
    [10, 6.0, '喵星人', 'cat', 'MEOW', '02:58', '橘猫学会了开冰箱，我该怎么办'],
    [7, 7.4, '科学科普', 'tech', '</>', '31:20', '用三十分钟讲清楚浏览器插件是怎么工作的'],
    [1, 8.2, '电子竞技', 'esports', 'GROUP', '38:02', '【赛事回放】小组赛 D 组 胜者组对决'],
    [11, 9.6, '科学科普', 'science', 'EARTH', '12:44', '为什么地图上的格陵兰岛看起来那么大'],
    [12, 11.0, '户外', 'outdoor', 'HIKE', '19:08', '周末两天，走完一条无人知晓的山脊线'],
    [4, 12.5, '音乐综合', 'music', 'Lofi', '45:00', '【循环歌单】适合写代码时听的 Lo-fi'],
    [2, 14.0, '电子竞技', 'esports', 'TIPS', '08:27', '三个让你少死一半的站位小技巧'],
    [6, 15.5, '数码', 'tech', 'REVIEW', '21:16', '千元机横评：今年真正值得买的只有这两台'],
    [3, 17.2, '音乐综合', 'music', 'Live', '06:10', '电台现场｜一把吉他，一首老歌'],
    [8, 19.0, '美食制作', 'food', '早餐', '07:45', '五分钟早餐合集，懒人也能吃好'],
    [1, 20.4, '电子竞技', 'esports', 'RECAP', '16:55', '一周赛事速览：谁是本周 MVP'],
    [9, 22.6, '单机游戏', 'game', 'RETRO', '27:30', '重温二十年前的经典 RPG，结局依然让人破防'],
    // 一天以前
    [5, 27, '音乐综合', 'music', 'Rain', '03:52', '原创｜《雨停之前》'],
    [7, 31, '科学科普', 'tech', 'AI', '24:18', '一个人做独立开发的第一年'],
    [2, 36, '电子竞技', 'esports', 'PATCH', '11:03', '版本更新解读：这次改动影响有多大'],
    [10, 44, '喵星人', 'cat', 'NAP', '01:47', '猫咪午睡合集，治愈一整天'],
    [11, 52, '科学科普', 'science', 'MOON', '14:29', '月亮为什么总是同一面对着我们'],
    [1, 60, '电子竞技', 'esports', 'OPEN', '40:11', '【赛事回放】公开赛 半决赛'],
    [12, 70, '户外', 'outdoor', 'LAKE', '13:36', '在湖边搭帐篷，看了一整夜星星'],
    [4, 96, '音乐综合', 'music', 'Jazz', '52:10', '【循环歌单】周日下午的爵士'],
    [6, 120, '数码', 'tech', 'KEYS', '17:22', '自己组一把机械键盘要花多少钱'],
    [3, 150, '音乐综合', 'music', 'Dawn', '58:44', '夜航电台 vol.47｜天亮以前'],
  ];
  // 图文 / 直播动态（只在「全部」里出现）
  const OTHERS = [
    [7, 0.5, 'DRAW', '今天把插件发到 GitHub 了，欢迎来提 issue', 'tech', 'GITHUB'],
    [3, 2.0, 'LIVE', '夜航电台 直播中：听歌聊天', 'music', 'LIVE'],
    [10, 5.5, 'DRAW', '它又睡在键盘上了', 'cat', 'ZZZ'],
    [12, 10, 'WORD', '下周末准备去走一条新线路，有人一起吗？', null, null],
  ];

  const ZONES = {};
  const feed = [];
  VIDEOS.forEach(([mid, h, zone, kind, t, dur, title], i) => {
    const bvid = 'BVdemo' + String(i).padStart(4, '0');
    ZONES[bvid] = zone;
    feed.push({
      id_str: String(9000 + i), type: 'DYNAMIC_TYPE_AV',
      modules: {
        module_author: { mid, name: UPS[mid].name, face: UPS[mid].face, pub_ts: Math.floor(now - h * H) },
        module_dynamic: { desc: null, major: { type: 'MAJOR_TYPE_ARCHIVE', archive: { bvid, title, cover: cover(kind, t), duration_text: dur, jump_url: '#' + bvid } } },
      },
    });
  });
  OTHERS.forEach(([mid, h, type, text, kind, t], i) => {
    const author = { mid, name: UPS[mid].name, face: UPS[mid].face, pub_ts: Math.floor(now - h * H) };
    let major = null;
    if (type === 'LIVE') major = { live_rcmd: { content: JSON.stringify({ live_play_info: { title: text, cover: cover(kind, t), link: '#live' } }) } };
    else if (kind) major = { opus: { title: null, summary: { text }, pics: [{ url: cover(kind, t) }], jump_url: '#opus' } };
    feed.push({
      id_str: String(8000 + i), type: type === 'LIVE' ? 'DYNAMIC_TYPE_LIVE_RCMD' : 'DYNAMIC_TYPE_' + type,
      modules: { module_author: author, module_dynamic: { desc: { text }, major } },
    });
  });
  feed.sort((a, b) => b.modules.module_author.pub_ts - a.modules.module_author.pub_ts);

  window.DEMO_FEED = feed;

  // ---------- chrome.storage ----------
  const mem = {};
  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: {
      get: (k, cb) => setTimeout(() => cb({ [k]: mem[k] }), 0),
      set: obj => Object.assign(mem, JSON.parse(JSON.stringify(obj))),
    },
  };

  // ---------- 接口 ----------
  const SPEED = Number(new URLSearchParams(location.search).get('speed') || 1);
  const delay = ms => new Promise(r => setTimeout(r, ms / SPEED));
  const ok = data => new Response(JSON.stringify({ code: 0, message: '0', data }), { headers: { 'Content-Type': 'application/json' } });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.hostname !== 'api.bilibili.com') return realFetch(input, init);
    const q = url.searchParams;
    switch (url.pathname) {
      case '/x/polymer/web-dynamic/v1/feed/all': {
        await delay(380);
        const items = q.get('type') === 'video' ? feed.filter(f => f.type === 'DYNAMIC_TYPE_AV') : feed;
        const start = Number(q.get('offset') || 0);
        const page = items.slice(start, start + 8);
        return ok({ items: page, offset: String(start + 8), has_more: start + 8 < items.length });
      }
      case '/x/web-interface/nav':
        await delay(120);
        return ok({ isLogin: true, mid: 1 });
      case '/x/relation/tags':
        await delay(150);
        return ok(TAGS.map(t => ({ ...t, count: Object.values(UPS).filter(u => t.tagid === 0 ? !u.tags.length : u.tags.includes(t.tagid)).length })));
      case '/x/relation/tag': {
        await delay(150);
        const tagid = Number(q.get('tagid'));
        return ok(Object.entries(UPS).filter(([, u]) => u.tags.includes(tagid)).map(([mid, u]) => ({ mid: Number(mid), uname: u.name })));
      }
      case '/x/web-interface/view':
        await delay(90);
        return ok({ bvid: q.get('bvid'), tname: ZONES[q.get('bvid')] || '其他' });
      default:
        return new Response(JSON.stringify({ code: -404, message: '演示中未模拟' }));
    }
  };
})();
