(() => {
  'use strict';

  // ───────── データ準備 ─────────
  const DATA = window.HISTORY_DATA;
  const DETAILS = window.HISTORY_DETAILS || {};
  const EVENTS = (window.HISTORY_EVENTS || []).slice().sort((a, b) => a.y - b.y);
  const REGIONS = ['西洋', '日本'];
  const ERAS = DATA.eras;
  const CATS = DATA.categories;

  const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const norm = s => toHira(String(s).normalize('NFKC').toLowerCase());

  const PEOPLE = DATA.people.map(p => {
    const q = {
      ...p,
      id: p.name,
      alias: p.alias || [],
      keys: p.keys || [],
      y: p.born ?? (p.died != null ? p.died - 40 : p.fl),
    };
    q.from = p.born ?? (p.died != null ? p.died - 60 : p.fl - 30);
    // 没年がなく生年だけある人物は存命として扱う
    q.to = p.died ?? (p.born != null ? new Date().getFullYear() : p.fl + 30);
    q.detail = DETAILS[p.name] || p.detail || '';
    q.head = norm([p.name, p.sub, ...q.alias].join(' '));
    q.text = norm([p.name, p.sub, ...q.alias, p.region, p.era, p.cat, p.desc, ...q.keys, q.detail].join(' '));
    q.rc = p.region === '西洋' ? 'west' : 'japan';
    q.eraIdx = ERAS[p.region].indexOf(p.era);
    return q;
  });
  const BY_ID = new Map(PEOPLE.map(p => [p.id, p]));

  // 出来事は「地域:年」で識別する。解説と関連は event-details.js
  const EV_DETAILS = window.HISTORY_EVENT_DETAILS || {};
  const EV_MORE = window.HISTORY_EVENT_MORE || {};   // 背景とその後（event-more-*.js）
  const RC = { 西洋: 'west', 日本: 'japan', 中国: 'china' };
  EVENTS.forEach(e => {
    e.key = `${e.r}:${e.y}`;
    const x = EV_DETAILS[e.key] || {};
    e.d = x.d || '';
    e.more = EV_MORE[e.key] || '';
    e.see = x.see || [];
    e.ppl = x.ppl || [];
  });
  const EV_BY_KEY = new Map(EVENTS.map(e => [e.key, e]));
  // 文章に出てくる人名を探す（長い名前から順に照合し、照合済みの部分は消して短い名前の誤検出を防ぐ）
  const NAME_INDEX = PEOPLE
    .flatMap(p => [p.name, ...p.alias].filter(n => n.length >= 2).map(n => ({ n, p })))
    .sort((a, b) => b.n.length - a.n.length);
  // 辞典の人物名を含むが別人を指す語（先に消しておく）
  const NOT_NAMES = ['後白河'];
  function peopleIn(text) {
    let t = text;
    NOT_NAMES.forEach(w => { t = t.split(w).join('\u0000'); });
    const found = [];
    for (const { n, p } of NAME_INDEX) {
      if (!t.includes(n)) continue;
      if (!found.includes(p)) found.push(p);
      t = t.split(n).join('\u0000');
    }
    return found;
  }

  // ───────── 小道具 ─────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sample = (a, n) => shuffle([...a]).slice(0, n);
  const fy = y => (y < 0 ? `前${-y}` : String(y));
  const lifeOf = p => p.life || (p.born != null && p.died == null ? `${fy(p.born)}–` : `${p.born != null ? fy(p.born) : '?'}–${p.died != null ? fy(p.died) : '?'}`);
  const centuryOf = y => Math.max(1, Math.floor((y - 1) / 100) + 1);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const view = $('#view');
  const dlg = $('#detail');

  // 遠い場所へはすぐ移動し、近い場所へはなめらかに移動する
  function scrollToEl(el, block) {
    if (!el) return;
    const far = Math.abs(el.getBoundingClientRect().top - innerHeight / 2) > innerHeight * 3;
    el.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block });
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  // 説明文から本人の名前を伏せる（クイズ・カード用）
  function mask(text, p) {
    const parts = new Set([p.name, ...p.alias]);
    for (const s of [p.name, ...p.alias]) {
      s.split(/[・（）()\s]/).forEach(x => { if (x.length >= 2) parts.add(x); });
    }
    let out = esc(text);
    [...parts].sort((a, b) => b.length - a.length).forEach(w => { out = out.split(esc(w)).join('<b>＿＿</b>'); });
    return out;
  }

  // ───────── 保存（このブラウザの localStorage。ログイン中は sync.js が Firestore と同期） ─────────
  // 端末間で統合できるよう、項目ごとに更新時刻を持つ：
  //   prog[id].t / favT[id] = {on, t} / noteT[id] / resetAt（リセットした時刻。それ以前の記録は捨てる）
  const KEY = 'jinmei-jiten-v1';
  const blank = () => ({ prog: {}, fav: [], favT: {}, notes: {}, noteT: {}, days: [], pref: {}, resetAt: 0 });
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // 古い形式（時刻なし）のデータも読めるようにそろえる
  function normalize(s) {
    const o = Object.assign(blank(), s && typeof s === 'object' ? s : {});
    o.favT = { ...(o.favT || {}) };
    o.noteT = { ...(o.noteT || {}) };
    (o.fav || []).forEach(id => { if (!o.favT[id]) o.favT[id] = { on: true, t: 1 }; });
    Object.keys(o.notes || {}).forEach(id => { if (!o.noteT[id]) o.noteT[id] = 1; });
    o.fav = Object.keys(o.favT).filter(id => o.favT[id].on);
    return o;
  }
  // 2つの記録を統合する。項目ごとに新しい方を採用し、学習日は合併する
  function mergeStates(a, b) {
    a = normalize(a); b = normalize(b);
    const o = blank();
    o.resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
    o.pref = a.pref || {};
    const keys = (x, y) => [...new Set([...Object.keys(x), ...Object.keys(y)])];
    for (const id of keys(a.prog, b.prog)) {
      const ra = a.prog[id], rb = b.prog[id];
      const r = !ra ? rb : !rb ? ra : (rb.t > ra.t ? rb : ra);
      if (r && r.t > o.resetAt) o.prog[id] = r;
    }
    for (const id of keys(a.favT, b.favT)) {
      const fa = a.favT[id], fb = b.favT[id];
      const f = !fa ? fb : !fb ? fa : (fb.t > fa.t ? fb : fa);
      if (f && f.t > o.resetAt) o.favT[id] = f;
    }
    o.fav = Object.keys(o.favT).filter(id => o.favT[id].on);
    for (const id of keys(a.noteT, b.noteT)) {
      const ta = a.noteT[id] ?? -1, tb = b.noteT[id] ?? -1;
      const src = tb > ta ? b : a;
      const t = Math.max(ta, tb);
      if (t <= o.resetAt) continue;
      o.noteT[id] = t;
      if (src.notes[id]) o.notes[id] = src.notes[id];
    }
    const resetDay = o.resetAt ? dayKey(new Date(o.resetAt)) : '';
    o.days = [...new Set([...a.days, ...b.days])].filter(d => d >= resetDay).sort().slice(-400);
    return o;
  }
  let S = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') return normalize(s);
    } catch (e) { /* 保存できない環境でも動かす */ }
    return blank();
  }
  const saveListeners = [];
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
    saveListeners.forEach(f => { try { f(); } catch (e) { /* ignore */ } });
  }

  // ───────── 学習レベル（ライトナー方式：箱0〜5） ─────────
  const LEVELS = ['未学習', '苦手', '学習中', '定着', '習得'];
  function level(id) {
    const r = S.prog[id];
    if (!r || r.c + r.w === 0) return 0;
    if (r.b >= 5) return 4;
    if (r.b >= 3) return 3;
    if (r.b === 0 && r.w > 0) return 1;
    return 2;
  }
  const lvTag = id => { const l = level(id); return `<span class="lv lv${l}">${LEVELS[l]}</span>`; };
  function record(id, ok) {
    const r = S.prog[id] || (S.prog[id] = { b: 0, c: 0, w: 0, t: 0 });
    if (ok) { r.c++; r.b = Math.min(5, r.b + 1); } else { r.w++; r.b = Math.max(0, r.b - 2); }
    r.t = Date.now();
    const d = today();
    if (S.days[S.days.length - 1] !== d) { S.days.push(d); if (S.days.length > 400) S.days.shift(); }
    save();
  }
  // 苦手・未学習ほど出やすい重み付き抽選
  function pickWeighted(pool, n) {
    return pool
      .map(p => {
        const r = S.prog[p.id];
        const w = r ? Math.pow(6 - r.b, 1.6) * (r.w > r.c ? 1.5 : 1) : 4;
        return { p, k: Math.pow(Math.random(), 1 / w) };
      })
      .sort((a, b) => b.k - a.k)
      .slice(0, n)
      .map(x => x.p);
  }
  function streak() {
    const set = new Set(S.days);
    const d = new Date();
    const key = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (!set.has(key(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const isFav = id => S.fav.includes(id);

  // ───────── 範囲選択（カード・クイズ共通） ─────────
  function eraOptions(region, selected) {
    const opt = e => `<option value="${esc(e)}"${e === selected ? ' selected' : ''}>${esc(e)}</option>`;
    if (region) return `<option value="">すべての時代</option>${ERAS[region].map(opt).join('')}`;
    return `<option value="">すべての時代</option>${REGIONS.map(r => `<optgroup label="${r}">${ERAS[r].map(opt).join('')}</optgroup>`).join('')}`;
  }
  function rangeHTML(v = {}) {
    const sel = (val, cur) => (val === cur ? ' selected' : '');
    return `
      <div class="row range">
        <label class="f">地域<select name="region"><option value="">西洋と日本</option>${REGIONS.map(r => `<option${sel(r, v.region)}>${r}</option>`).join('')}</select></label>
        <label class="f">時代<select name="era">${eraOptions(v.region, v.era)}</select></label>
        <label class="f">分野<select name="cat"><option value="">すべての分野</option>${CATS.map(c => `<option${sel(c, v.cat)}>${c}</option>`).join('')}</select></label>
        <label class="f">対象<select name="scope">
          <option value="">すべて</option>
          <option value="weak"${sel('weak', v.scope)}>苦手・学習中</option>
          <option value="new"${sel('new', v.scope)}>未学習のみ</option>
          <option value="fav"${sel('fav', v.scope)}>お気に入り</option>
        </select></label>
      </div>`;
  }
  function readRange(el) {
    const g = n => $(`[name="${n}"]`, el)?.value || '';
    return { region: g('region'), era: g('era'), cat: g('cat'), scope: g('scope') };
  }
  function bindRange(el, onChange) {
    const region = $('[name="region"]', el);
    region.addEventListener('change', () => { $('[name="era"]', el).innerHTML = eraOptions(region.value, ''); });
    $$('select', el).forEach(s => s.addEventListener('change', onChange));
  }
  function filterRange(v) {
    return PEOPLE.filter(p => {
      if (v.region && p.region !== v.region) return false;
      if (v.era && p.era !== v.era) return false;
      if (v.cat && p.cat !== v.cat) return false;
      const l = level(p.id);
      if (v.scope === 'weak' && !(l === 1 || l === 2)) return false;
      if (v.scope === 'new' && l !== 0) return false;
      if (v.scope === 'fav' && !isFav(p.id)) return false;
      return true;
    });
  }

  const regionBadge = p => `<span class="badge ${p.rc}">${p.region}</span>`;
  const personChip = (p, withLife = true) =>
    `<button class="chip ${p.rc}" data-open="${esc(p.id)}">${esc(p.name)}${withLife ? `<small>${esc(lifeOf(p))}</small>` : ''}</button>`;

  // 出来事へのリンク（クリックで出来事の詳細を開く）
  const evItem = (e, showRegion = false) =>
    `<li class="ev ${RC[e.r]}"><button class="ev-link" data-ev="${esc(e.key)}"><b>${esc(e.l || fy(e.y))}</b>${showRegion ? `<span class="badge ${RC[e.r]}">${e.r}</span>` : ''}<span>${esc(e.t)}</span></button></li>`;
  const evList = (list, showRegion) => `<ul class="evlist">${list.map(e => evItem(e, showRegion)).join('')}</ul>`;

  // ───────── 詳細ダイアログ（人物・出来事の両方を表示。たどった順に「戻る」で戻れる） ─────────
  let dlgCur = null;
  const dlgHist = [];
  function navDlg(kind, key, isBack) {
    const same = dlgCur && dlgCur.kind === kind && dlgCur.key === key;
    if (!isBack && dlg.open && dlgCur && !same) dlgHist.push(dlgCur);
    dlgCur = { kind, key };
    return same;
  }
  const backBtn = () => (dlgHist.length ? '<button class="back" data-back>← 戻る</button>' : '');
  function showDlg(keepScroll) {
    if (!dlg.open) dlg.showModal();
    if (!keepScroll) dlg.scrollTop = 0;
  }
  function contemporaries(p, region, n) {
    return PEOPLE
      .filter(q => q !== p && q.region === region && q.from < p.to && q.to > p.from)
      .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))
      .slice(0, n)
      .sort((a, b) => a.y - b.y);
  }
  function openDetail(id, isBack) {
    const p = BY_ID.get(id);
    if (!p) return;
    const keepScroll = navDlg('p', id, isBack);
    const r = S.prog[id];
    const other = p.region === '西洋' ? '日本' : '西洋';
    const peersOther = contemporaries(p, other, 8);
    const peersSame = contemporaries(p, p.region, 8);
    const lifeEvents = EVENTS.filter(e => e.r === p.region && e.y >= (p.born ?? p.from) && e.y <= p.to);
    dlg.innerHTML = `
      <article class="detail">
        ${backBtn()}
        <button class="close" data-close aria-label="閉じる">×</button>
        <div class="badges">${regionBadge(p)}<span class="badge">${esc(p.era)}</span><span class="badge">${esc(p.cat)}</span></div>
        <h2>${esc(p.name)}</h2>
        <p class="sub">${esc(p.sub)}${p.alias.length ? `　別名：${p.alias.map(esc).join('、')}` : ''}</p>
        <p class="life">${esc(lifeOf(p))}</p>
        <p class="desc lead-desc">${esc(p.desc)}</p>
        <div class="chips">${p.keys.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>
        ${p.detail ? `<h3>くわしい解説</h3><p class="detail-text">${esc(p.detail)}</p>` : ''}
        ${lifeEvents.length ? `<h3>生きた時代の${p.region}の出来事</h3>${evList(lifeEvents)}` : ''}

        <h3>学習状況</h3>
        <div class="learn">
          ${lvTag(id)}
          <span>正解 ${r ? r.c : 0}回 ／ 不正解 ${r ? r.w : 0}回</span>
          <span class="sp"></span>
          <button class="btn" data-fav="${esc(id)}">${isFav(id) ? '★ お気に入り済み' : '☆ お気に入りに追加'}</button>
        </div>

        <h3>同じころの${other}</h3>
        <div class="chips">${peersOther.length ? peersOther.map(q => personChip(q)).join('') : '<span class="lead">収録人物の中にはいません</span>'}</div>
        <h3>同時代の${p.region}</h3>
        <div class="chips">${peersSame.length ? peersSame.map(q => personChip(q)).join('') : '<span class="lead">収録人物の中にはいません</span>'}</div>

        <h3>自分用メモ</h3>
        <textarea id="note" placeholder="覚え方や関連事項などを自由に書けます（自動保存）">${esc(S.notes[id] || '')}</textarea>
      </article>`;
    $('#note', dlg).addEventListener('input', e => {
      const v = e.target.value;
      if (v.trim()) S.notes[id] = v; else delete S.notes[id];
      S.noteT[id] = Date.now();
      save();
    });
    showDlg(keepScroll);
  }

  // 出来事の詳細
  function openEvent(key, isBack) {
    const e = EV_BY_KEY.get(key);
    if (!e) return;
    navDlg('e', key, isBack);
    const named = [...new Set([...e.ppl.map(n => BY_ID.get(n)).filter(Boolean), ...peopleIn(`${e.t} ${e.d} ${e.more}`)])].sort((a, b) => a.y - b.y);
    const see = e.see.map(k => EV_BY_KEY.get(k)).filter(Boolean).sort((a, b) => a.y - b.y);
    const sameRegion = EVENTS.filter(x => x.r === e.r);
    const i = sameRegion.indexOf(e);
    const before = sameRegion.slice(Math.max(0, i - 3), i);
    const after = sameRegion.slice(i + 1, i + 4);
    // ほかの地域の近い年の出来事（5年以内が少なければ30年以内まで広げる）
    const nearOthers = within => EVENTS
      .filter(x => x.r !== e.r && Math.abs(x.y - e.y) <= within && !see.includes(x))
      .sort((a, b) => Math.abs(a.y - e.y) - Math.abs(b.y - e.y));
    let world = nearOthers(5);
    if (world.length < 3) world = nearOthers(30).slice(0, 4);
    world = world.slice(0, 6).sort((a, b) => a.y - b.y);
    const living = PEOPLE
      .filter(p => p.region === e.r && !named.includes(p) && p.from <= e.y && e.y <= p.to)
      .sort((a, b) => a.y - b.y)
      .slice(0, 12);
    const when = e.l ? e.l.replace(/^(\d+)頃$/, '$1年頃') : `${fy(e.y)}年`;
    dlg.innerHTML = `
      <article class="detail ev-detail">
        ${backBtn()}
        <button class="close" data-close aria-label="閉じる">×</button>
        <div class="badges"><span class="badge ${RC[e.r]}">${e.r}</span><span class="badge">${centuryOf(e.y)}世紀</span><span class="badge">出来事</span></div>
        <p class="life">${esc(when)}</p>
        <h2>${esc(e.t)}</h2>
        ${e.d ? `<h3>くわしい解説</h3><p class="detail-text">${esc(e.d)}</p>` : ''}
        ${e.more ? `<h3>背景とその後</h3><p class="detail-text">${esc(e.more)}</p>` : ''}
        ${named.length ? `<h3>関係する人物</h3><div class="chips">${named.map(p => personChip(p)).join('')}</div>` : ''}
        ${see.length ? `<h3>つながりのある出来事</h3>${evList(see, true)}` : ''}
        <h3>${e.r}の前後の流れ</h3>
        <ul class="evlist flow">
          ${before.map(x => evItem(x)).join('')}
          <li class="ev ${RC[e.r]} now"><span class="ev-link"><b>${esc(e.l || fy(e.y))}</b><span>${esc(e.t)}</span></span></li>
          ${after.map(x => evItem(x)).join('')}
        </ul>
        ${world.length ? `<h3>同じころのほかの地域</h3>${evList(world, true)}` : ''}
        ${living.length ? `<h3>このころ生きていた${e.r}の人物</h3><div class="chips">${living.map(p => personChip(p)).join('')}</div>` : ''}
      </article>`;
    showDlg(false);
  }

  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-back]')) {
      const prev = dlgHist.pop();
      if (prev) (prev.kind === 'p' ? openDetail : openEvent)(prev.key, true);
      return;
    }
    const f = e.target.closest('[data-fav]');
    if (f) {
      const id = f.dataset.fav;
      const on = !isFav(id);
      S.favT[id] = { on, t: Date.now() };
      S.fav = on ? [...S.fav, id] : S.fav.filter(x => x !== id);
      save();
      openDetail(id);
    }
  });
  dlg.addEventListener('close', () => {
    dlgHist.length = 0;
    dlgCur = null;
    if (current === 'dict') updateList();
    if (current === 'stats') renderStats();
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open]');
    if (t) { e.preventDefault(); openDetail(t.dataset.open); return; }
    const ev = e.target.closest('[data-ev]');
    if (ev) { e.preventDefault(); openEvent(ev.dataset.ev); }
  });

  // ───────── 辞典 ─────────
  const dict = { region: '', era: '', cat: '', fav: false, sort: 'kana' };
  // 五十音の並べ替え用のよみ（日本の人物はよみがな、西洋はカタカナ名をひらがなにしたもの）
  const KANA_OVERRIDE = {
    'C・S・ルイス': 'しーえするいす', '教皇フランシスコ': 'きょうこうふらんしすこ', 'カール大帝': 'かーるたいてい',
    'ジョン王': 'じょんおう', 'ヴィクトリア女王': 'ゔぃくとりあじょおう', 'キング牧師': 'きんぐぼくし',
  };
  const KANA_ROWS = [
    ['あ', 'あいうえお'], ['か', 'かきくけこ'], ['さ', 'さしすせそ'], ['た', 'たちつてと'], ['な', 'なにぬねの'],
    ['は', 'はひふへほ'], ['ま', 'まみむめも'], ['や', 'やゆよ'], ['ら', 'らりるれろ'], ['わ', 'わをん'],
  ];
  const SMALL = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ' };
  PEOPLE.forEach(p => {
    p.kana = (KANA_OVERRIDE[p.name] || (p.region === '日本' ? p.sub : toHira(p.name))).replace(/[・\s（）()「」＝=]/g, '');
    const c0 = p.kana[0].normalize('NFD')[0];   // 濁点・半濁点を外す（が→か、ゔ→う）
    const c = SMALL[c0] || c0;
    p.row = (KANA_ROWS.find(([, s]) => s.includes(c)) || ['他'])[0];
  });
  function todayPerson() {
    const n = Math.floor(Date.now() / 86400000);
    return PEOPLE[(n * 7919) % PEOPLE.length];
  }
  function renderDict() {
    const tp = todayPerson();
    view.innerHTML = `
      <section class="panel today">
        <span class="tag">きょうの人物</span>
        <div><h2>${esc(tp.name)}</h2><span class="lead">${esc(tp.sub)}・${esc(lifeOf(tp))}</span></div>
        <div style="justify-self:end">${regionBadge(tp)} <span class="badge">${esc(tp.era)}</span></div>
        <div class="t-body"><p>${esc(tp.desc)}</p>
          <div class="btns"><button class="btn" data-open="${esc(tp.id)}">詳しく見る</button></div></div>
      </section>

      <section class="panel" id="dictf">
        <h2>人名事典</h2>
        <div class="row">
          <label class="f">地域<select name="region"><option value="">西洋と日本</option>${REGIONS.map(r => `<option${r === dict.region ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
          <label class="f">時代<select name="era">${eraOptions(dict.region, dict.era)}</select></label>
          <label class="f">分野<select name="cat"><option value="">すべての分野</option>${CATS.map(c => `<option${c === dict.cat ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="f">並び順<select name="sort">
            <option value="kana"${dict.sort === 'kana' ? ' selected' : ''}>五十音順</option>
            <option value="year"${dict.sort === 'year' ? ' selected' : ''}>年代順</option>
            <option value="weak"${dict.sort === 'weak' ? ' selected' : ''}>苦手な順</option>
          </select></label>
          <label class="check"><input type="checkbox" name="fav"${dict.fav ? ' checked' : ''}> ★のみ</label>
        </div>
      </section>
      <nav class="kana-idx" id="kanaIdx" aria-label="五十音の索引"></nav>
      <p class="count" id="count"></p>
      <div id="list"></div>`;

    const f = $('#dictf');
    $('#kanaIdx').addEventListener('click', e => {
      const b = e.target.closest('[data-row]');
      if (b) $(`#kana-${b.dataset.row}`)?.scrollIntoView({ block: 'start' });
    });
    $('[name="region"]', f).addEventListener('change', e => {
      dict.region = e.target.value; dict.era = '';
      $('[name="era"]', f).innerHTML = eraOptions(dict.region, '');
      updateList();
    });
    ['era', 'cat', 'sort'].forEach(n => $(`[name="${n}"]`, f).addEventListener('change', e => { dict[n] = e.target.value; updateList(); }));
    $('[name="fav"]', f).addEventListener('change', e => { dict.fav = e.target.checked; updateList(); });
    updateList();
  }
  function updateList() {
    const list = $('#list');
    if (!list) return;
    const res = PEOPLE.filter(p =>
      (!dict.region || p.region === dict.region) &&
      (!dict.era || p.era === dict.era) &&
      (!dict.cat || p.cat === dict.cat) &&
      (!dict.fav || isFav(p.id)));
    if (dict.sort === 'kana') {
      res.sort((a, b) => a.kana.localeCompare(b.kana, 'ja'));
    } else if (dict.sort === 'weak') {
      const score = p => { const r = S.prog[p.id]; return r ? (r.w - r.c) * 10 - r.b : -100; };
      res.sort((a, b) => score(b) - score(a) || a.y - b.y);
    } else {
      res.sort((a, b) => a.y - b.y);
    }
    $('#count').textContent = `${res.length}人 / 全${PEOPLE.length}人`;
    const card = p => `
      <button class="pcard ${p.rc}" data-open="${esc(p.id)}">
        ${isFav(p.id) ? '<span class="star">★</span>' : ''}
        <span class="nm">${esc(p.name)}</span>
        <span class="sb">${esc(p.sub)}</span>
        <span class="mt">${regionBadge(p)}<span class="badge">${esc(p.era)}</span><span>${esc(lifeOf(p))}</span></span>
        <span class="lv lv${level(p.id)}" title="${LEVELS[level(p.id)]}">${LEVELS[level(p.id)]}</span>
      </button>`;
    const idx = $('#kanaIdx');
    if (!res.length) {
      idx.hidden = true;
      list.innerHTML = '<p class="empty">該当する人物がいません。</p>';
      return;
    }
    if (dict.sort !== 'kana') {
      idx.hidden = true;
      list.innerHTML = `<div class="grid">${res.map(card).join('')}</div>`;
      return;
    }
    // 五十音順：行ごとの見出しと、押すとその行へ移動する索引
    const rows = [...KANA_ROWS.map(([r]) => r), '他'];
    const groups = rows.map(r => [r, res.filter(p => p.row === r)]).filter(([, ps]) => ps.length);
    const has = new Set(groups.map(([r]) => r));
    idx.hidden = false;
    idx.innerHTML = rows.filter(r => r !== '他' || has.has(r))
      .map(r => `<button data-row="${r}"${has.has(r) ? '' : ' disabled'}>${r}</button>`).join('');
    list.innerHTML = groups.map(([r, ps]) => `
      <section class="kana-sec">
        <h3 class="kana-h" id="kana-${r}">${r === '他' ? 'その他' : `${r}行`}<small>${ps.length}人</small></h3>
        <div class="grid">${ps.map(card).join('')}</div>
      </section>`).join('');
  }

  // ───────── 年表 ─────────
  // 年ごとに1行。出来事はその年、人物は生まれた年（不明なら没年・活躍年）の行に置く
  const tl = { cat: '', ev: true, ps: true, cn: false };
  const TL_COLS = { 西洋: 'west', 日本: 'japan', 中国: 'china' };
  function renderTimeline() {
    view.innerHTML = `
      <section class="panel">
        <h2>比較年表</h2>
        <p class="lead">年代順に、大きな出来事と人物（生まれた年）を地域ごとに並べています。出来事や人物を押すと、くわしい解説と、関係する人物・出来事が開きます。</p>
        <div class="row">
          <label class="f" style="max-width:220px">人物の分野<select id="tlcat"><option value="">すべての分野</option>${CATS.map(c => `<option${c === tl.cat ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="f" style="max-width:180px">年代へ移動<select id="tljump"></select></label>
        </div>
        <div class="row" style="margin-top:6px">
          <label class="check"><input type="checkbox" id="tlev"${tl.ev ? ' checked' : ''}> 出来事</label>
          <label class="check"><input type="checkbox" id="tlps"${tl.ps ? ' checked' : ''}> 人物（生年）</label>
          <label class="check"><input type="checkbox" id="tlcn"${tl.cn ? ' checked' : ''}> 中国の年表も表示</label>
        </div>
      </section>
      <div class="tl" id="tl"></div>`;
    $('#tlcat').addEventListener('change', e => { tl.cat = e.target.value; drawTimeline(); });
    $('#tlev').addEventListener('change', e => { tl.ev = e.target.checked; drawTimeline(); });
    $('#tlps').addEventListener('change', e => { tl.ps = e.target.checked; drawTimeline(); });
    $('#tlcn').addEventListener('change', e => { tl.cn = e.target.checked; drawTimeline(); });
    $('#tljump').addEventListener('change', e => {
      const row = $(`#tl [data-c="${e.target.value}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    drawTimeline();
  }
  // 人物を年表のどの年に置くか
  function tlYear(p) {
    if (p.born != null) return { y: p.born, mark: '生' };
    if (p.died != null) return { y: p.died, mark: '没' };
    return { y: p.fl, mark: '頃' };
  }
  function drawTimeline() {
    const regions = tl.cn ? ['西洋', '日本', '中国'] : ['西洋', '日本'];
    const rows = new Map();   // 年 → { 西洋: [], 日本: [], 中国: [] }
    const cell = y => { if (!rows.has(y)) rows.set(y, { 西洋: [], 日本: [], 中国: [] }); return rows.get(y); };
    if (tl.ev) {
      EVENTS.filter(e => regions.includes(e.r)).forEach(e => {
        cell(e.y)[e.r].push(`<button class="tl-ev" data-ev="${esc(e.key)}" title="くわしく見る">${e.l ? `<b>${esc(e.l)}</b>` : ''}${esc(e.t)}<span class="more">›</span></button>`);
      });
    }
    if (tl.ps) {
      PEOPLE.filter(p => !tl.cat || p.cat === tl.cat).forEach(p => {
        const { y, mark } = tlYear(p);
        cell(y)[p.region].push(`<button class="chip ${p.rc}" data-open="${esc(p.id)}"><span class="pt">${mark}</span>${esc(p.name)}<small>${esc(lifeOf(p))}</small></button>`);
      });
    }
    const years = [...rows.keys()].sort((a, b) => a - b);
    const el = $('#tl');
    el.style.setProperty('--cols', regions.length);
    let html = `<div class="h">年</div>${regions.map(r => `<div class="h ${TL_COLS[r]}">${r}</div>`).join('')}`;
    const seen = new Set();
    for (const y of years) {
      const c = centuryOf(y);
      const anchor = seen.has(c) ? '' : ` data-c="${c}"`;
      seen.add(c);
      const r = rows.get(y);
      html += `<div class="y"${anchor}>${fy(y)}</div>${regions.map(g => `<div class="col ${TL_COLS[g]}">${r[g].join('')}</div>`).join('')}`;
    }
    if (!years.length) html += `<div class="y"></div><div class="col" style="grid-column: span ${regions.length}"><p class="lead">表示する項目を選んでください。</p></div>`;
    el.innerHTML = html;
    $('#tljump').innerHTML = `<option value="">選んでください</option>${[...seen].map(c => `<option value="${c}">${c}世紀</option>`).join('')}`;
    markTlMatches();
  }

  // ───────── フラッシュカード ─────────
  let fc = null;
  function renderCards() { if (fc) drawCard(); else cardSetup(); }
  function cardSetup() {
    const pref = S.pref.cards || {};
    view.innerHTML = `
      <section class="panel" id="cs">
        <h2>フラッシュカード</h2>
        <p class="lead">カードをめくって確認し、「覚えた」「もう一度」で自己評価します。苦手な人物ほどよく出題されます。</p>
        ${rangeHTML(pref)}
        <div class="row" style="margin-top:10px">
          <label class="f">表に出すもの<select name="dir">
            <option value="name"${pref.dir === 'name' ? ' selected' : ''}>人名 → 説明を思い出す</option>
            <option value="desc"${pref.dir === 'desc' ? ' selected' : ''}>説明 → 人名を思い出す</option>
          </select></label>
          <label class="f">枚数<select name="n">${[10, 20, 30, 999].map(n => `<option value="${n}"${+pref.n === n ? ' selected' : ''}>${n === 999 ? 'すべて' : n + '枚'}</option>`).join('')}</select></label>
        </div>
        <p class="count" id="cscount"></p>
        <div class="btns"><button class="btn primary big" id="csgo">はじめる</button></div>
      </section>`;
    const el = $('#cs');
    const upd = () => {
      const n = filterRange(readRange(el)).length;
      $('#cscount').textContent = `対象：${n}人`;
      $('#csgo').disabled = n === 0;
    };
    bindRange(el, upd);
    upd();
    $('#csgo').addEventListener('click', () => {
      const v = readRange(el);
      const dir = $('[name="dir"]', el).value;
      const n = +$('[name="n"]', el).value;
      S.pref.cards = { ...v, dir, n };
      save();
      startCards(pickWeighted(filterRange(v), n), dir);
    });
  }
  function startCards(deck, dir = 'name') {
    fc = { deck, i: 0, on: false, dir, ok: [], ng: [] };
    if (current !== 'cards') location.hash = '#/cards'; else drawCard();
  }
  function drawCard() {
    if (fc.i >= fc.deck.length) return cardsDone();
    const p = fc.deck[fc.i];
    const badges = `<div class="badges">${regionBadge(p)}<span class="badge">${esc(p.era)}</span><span class="badge">${esc(p.cat)}</span></div>`;
    const nameSide = `${badges}<div class="big">${esc(p.name)}</div><div class="center">${esc(p.sub)}</div>`;
    const descSide = `<div class="center">${esc(lifeOf(p))}</div><div class="desc">${esc(p.desc)}</div><div class="chips">${p.keys.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>`;
    const front = fc.dir === 'name'
      ? `${nameSide}<div class="hint">タップしてめくる</div>`
      : `${badges}<div class="desc">${mask(p.desc, p)}</div><div class="hint">この人物は？　タップしてめくる</div>`;
    const back = fc.dir === 'name'
      ? descSide
      : `${nameSide}<div class="center">${esc(lifeOf(p))}</div>`;
    view.innerHTML = `
      <div class="studyhead"><span>${fc.i + 1} / ${fc.deck.length}</span><span>覚えた ${fc.ok.length}・もう一度 ${fc.ng.length}</span><button class="btn" id="fcquit">やめる</button></div>
      <div class="progress"><i style="width:${(fc.i / fc.deck.length) * 100}%"></i></div>
      <button class="flip${fc.on ? ' on' : ''}" id="flip" aria-label="カードをめくる">
        <div class="flip-inner"><div class="face front">${front}</div><div class="face back">${back}</div></div>
      </button>
      <div class="answer-btns">
        <button class="btn ng" id="fcng"${fc.on ? '' : ' disabled'}>もう一度</button>
        <button class="btn ok" id="fcok"${fc.on ? '' : ' disabled'}>覚えた</button>
      </div>
      <div class="btns" style="justify-content:center"><button class="btn" data-open="${esc(p.id)}">詳細</button></div>
      <p class="kbd">キーボード：スペースでめくる／→ 覚えた／← もう一度</p>`;
    $('#flip').addEventListener('click', flipCard);
    $('#fcok').addEventListener('click', () => answerCard(true));
    $('#fcng').addEventListener('click', () => answerCard(false));
    $('#fcquit').addEventListener('click', () => { fc = null; cardSetup(); });
  }
  function flipCard() {
    fc.on = !fc.on;
    $('#flip').classList.toggle('on', fc.on);
    $('#fcok').disabled = $('#fcng').disabled = !fc.on;
  }
  function answerCard(ok) {
    if (!fc.on) return;
    const p = fc.deck[fc.i];
    record(p.id, ok);
    (ok ? fc.ok : fc.ng).push(p);
    fc.i++;
    fc.on = false;
    drawCard();
  }
  function cardsDone() {
    const { ok, ng, dir } = fc;
    view.innerHTML = `
      <section class="panel" style="text-align:center">
        <h2>おつかれさまでした</h2>
        <p class="score-big">${ok.length}<small> / ${ok.length + ng.length} 枚 覚えた</small></p>
        ${ng.length ? `<h3 style="margin-top:16px;font-size:15px">もう一度見たい人物</h3><div class="chips" style="justify-content:center;margin-top:8px">${ng.map(p => personChip(p, false)).join('')}</div>` : '<p>全部覚えました！</p>'}
        <div class="btns" style="justify-content:center">
          ${ng.length ? '<button class="btn primary" id="again">「もう一度」だけ復習</button>' : ''}
          <button class="btn" id="newdeck">新しいカード</button>
          <a class="btn" href="#/quiz">クイズで確認</a>
        </div>
      </section>`;
    $('#again')?.addEventListener('click', () => startCards(shuffle([...ng]), dir));
    $('#newdeck').addEventListener('click', () => { fc = null; cardSetup(); });
  }

  // ───────── クイズ ─────────
  const MODES = {
    mix: 'ミックス',
    who: '説明から人物を当てる',
    what: '人物から関連事項を当てる',
    era: '活躍した時代を当てる',
    order: 'どちらが先に生まれた？',
  };
  let qz = null;
  function renderQuiz() { if (qz) drawQuestion(); else quizSetup(); }
  function quizSetup() {
    const pref = S.pref.quiz || {};
    view.innerHTML = `
      <section class="panel" id="qs">
        <h2>クイズ</h2>
        <p class="lead">4択で答えます。正解・不正解は学習記録に反映され、間違えた人物は次回以降に出やすくなります。</p>
        <div class="row">
          <label class="f">問題の種類<select name="mode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}"${pref.mode === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f">問題数<select name="n">${[5, 10, 20, 30].map(n => `<option value="${n}"${(+pref.n || 10) === n ? ' selected' : ''}>${n}問</option>`).join('')}</select></label>
        </div>
        <div style="margin-top:10px">${rangeHTML(pref)}</div>
        <p class="count" id="qscount"></p>
        <div class="btns"><button class="btn primary big" id="qsgo">スタート</button></div>
      </section>`;
    const el = $('#qs');
    const upd = () => {
      const n = filterRange(readRange(el)).length;
      $('#qscount').textContent = `出題範囲：${n}人`;
      $('#qsgo').disabled = n === 0;
    };
    bindRange(el, upd);
    upd();
    $('#qsgo').addEventListener('click', () => {
      const v = readRange(el);
      const mode = $('[name="mode"]', el).value;
      const n = +$('[name="n"]', el).value;
      S.pref.quiz = { ...v, mode, n };
      save();
      startQuiz(filterRange(v), mode, n);
    });
  }
  function startQuiz(pool, mode, n) {
    const usable = mode === 'order' ? pool.filter(p => p.born != null) : pool;
    const targets = pickWeighted(usable.length ? usable : pool, n);
    const qs = targets.map(p => makeQuestion(p, mode === 'mix' ? sample(['who', 'who', 'what', 'era', 'order'], 1)[0] : mode));
    qz = { qs, i: 0, score: 0, missed: [], pool, mode, n, answered: null };
    drawQuestion();
  }
  function distractors(p, k) {
    return sample(
      PEOPLE.filter(q => q !== p && q.region === p.region).sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y)).slice(0, 14),
      k);
  }
  function makeQuestion(p, type) {
    if (type === 'order') {
      const cands = PEOPLE.filter(q => q !== p && q.born != null && p.born != null && Math.abs(q.born - p.born) >= 15 && Math.abs(q.born - p.born) <= 300);
      if (!cands.length) type = 'who';
      else {
        const q = sample(cands, 1)[0];
        const first = p.born < q.born ? p : q;
        return {
          type, p, record: false,
          prompt: '先に生まれたのはどちら？',
          body: '',
          opts: shuffle([p, q]).map(x => ({ html: `${esc(x.name)}<span class="sb">${x.region}・${esc(x.sub)}</span>`, ok: x === first, who: x })),
          explain: [p, q].sort((a, b) => a.born - b.born).map(x => `${esc(x.name)}（${esc(lifeOf(x))}）`).join(' → '),
        };
      }
    }
    if (type === 'era') {
      const eras = ERAS[p.region];
      let lo = Math.max(0, p.eraIdx - 2);
      const hi = Math.min(eras.length, lo + 4);
      lo = Math.max(0, hi - 4);
      return {
        type, p, record: true,
        prompt: 'この人物が主に活躍した時代は？',
        body: `<div class="who">${esc(p.name)}</div><div class="lead">${esc(p.sub)}・${p.region}</div>`,
        opts: eras.slice(lo, hi).map(e => ({ html: esc(e), ok: e === p.era })),
      };
    }
    const others = distractors(p, 3);
    if (type === 'what') {
      return {
        type, p, record: true,
        prompt: 'この人物に最も関係の深いものは？',
        body: `<div class="who">${esc(p.name)}</div><div class="lead">${esc(p.sub)}・${p.region}</div>`,
        opts: shuffle([p, ...others]).map(x => ({ html: esc(x.keys.slice(0, 3).join('・')), ok: x === p, who: x })),
      };
    }
    return {
      type: 'who', p, record: true,
      prompt: 'この人物はだれ？',
      body: `<div class="badges" style="margin-bottom:6px">${regionBadge(p)}<span class="badge">${esc(p.cat)}</span></div>${mask(p.desc, p)}`,
      opts: shuffle([p, ...others]).map(x => ({ html: `${esc(x.name)}<span class="sb">${esc(x.sub)}</span>`, ok: x === p, who: x })),
    };
  }
  function drawQuestion() {
    if (qz.i >= qz.qs.length) return quizDone();
    const q = qz.qs[qz.i];
    view.innerHTML = `
      <div class="studyhead"><span>第${qz.i + 1}問 / ${qz.qs.length}</span><span>正解 ${qz.score}</span><button class="btn" id="qquit">やめる</button></div>
      <div class="progress"><i style="width:${(qz.i / qz.qs.length) * 100}%"></i></div>
      <section class="panel">
        <p class="q-prompt">${q.prompt}</p>
        ${q.body ? `<div class="q-body">${q.body}</div>` : ''}
        <div class="opts">${q.opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="n">${i + 1}</span><span>${o.html}</span></button>`).join('')}</div>
        <div id="fb"></div>
      </section>
      <p class="kbd">キーボード：数字キーで解答／Enterで次へ</p>`;
    qz.answered = null;
    $$('.opt').forEach(b => b.addEventListener('click', () => answerQuiz(+b.dataset.i)));
    $('#qquit').addEventListener('click', () => { qz = null; quizSetup(); });
  }
  function answerQuiz(i) {
    if (qz.answered != null) return;
    const q = qz.qs[qz.i];
    const o = q.opts[i];
    if (!o) return;
    qz.answered = i;
    const ok = o.ok;
    if (ok) qz.score++; else qz.missed.push(q.p);
    if (q.record) record(q.p.id, ok);
    $$('.opt').forEach((b, j) => {
      b.disabled = true;
      if (q.opts[j].ok) b.classList.add('correct');
      else if (j === i) b.classList.add('wrong');
    });
    const p = q.p;
    const mistakeNote = !ok && o.who && o.who !== p && q.type !== 'order'
      ? `<p>あなたの答え「${esc(o.who.name)}」は：${esc(o.who.desc.slice(0, 60))}…</p>` : '';
    $('#fb').innerHTML = `
      <div class="fb ${ok ? 'good' : 'bad'}">
        <div class="res">${ok ? '正解！' : '不正解'}</div>
        ${q.type === 'order' ? `<p>${q.explain}</p>` : `
          <p><strong>${esc(p.name)}</strong>（${esc(lifeOf(p))}・${p.region}／${esc(p.era)}）</p>
          <p>${esc(p.desc)}</p>${mistakeNote}`}
        <div class="btns">
          <button class="btn primary" id="qnext">${qz.i + 1 < qz.qs.length ? '次の問題へ' : '結果を見る'}</button>
          <button class="btn" data-open="${esc(p.id)}">詳細</button>
        </div>
      </div>`;
    $('#qnext').addEventListener('click', nextQuestion);
    $('#qnext').focus({ preventScroll: true });
    $('#fb').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function nextQuestion() { qz.i++; drawQuestion(); window.scrollTo(0, 0); }
  function quizDone() {
    const total = qz.qs.length;
    const pct = Math.round((qz.score / total) * 100);
    const msg = pct === 100 ? '満点です！' : pct >= 80 ? 'よくできました。' : pct >= 50 ? 'もう少し！間違えた人物を復習しましょう。' : 'カードで復習してから再挑戦しましょう。';
    const missed = [...new Set(qz.missed)];
    view.innerHTML = `
      <section class="panel" style="text-align:center">
        <h2>結果</h2>
        <p class="score-big">${qz.score}<small> / ${total}問（${pct}%）</small></p>
        <p>${msg}</p>
        ${missed.length ? `<h3 style="margin-top:16px;font-size:15px">間違えた人物</h3><div class="chips" style="justify-content:center;margin-top:8px">${missed.map(p => personChip(p, false)).join('')}</div>` : ''}
        <div class="btns" style="justify-content:center">
          <button class="btn primary" id="qagain">同じ条件でもう一度</button>
          ${missed.length ? '<button class="btn" id="qreview">間違えた人物をカードで復習</button>' : ''}
          <button class="btn" id="qnew">条件を変える</button>
        </div>
      </section>`;
    const { pool, mode, n } = qz;
    $('#qagain').addEventListener('click', () => startQuiz(filterRange(S.pref.quiz || {}).length ? filterRange(S.pref.quiz) : pool, mode, n));
    $('#qreview')?.addEventListener('click', () => { qz = null; startCards(missed, 'name'); });
    $('#qnew').addEventListener('click', () => { qz = null; quizSetup(); });
  }

  // ───────── 学習記録 ─────────
  function bar(ps) {
    const cnt = [0, 0, 0, 0, 0];
    ps.forEach(p => cnt[level(p.id)]++);
    const w = n => (ps.length ? (n / ps.length) * 100 : 0);
    return `<div class="bar"><i class="s4" style="width:${w(cnt[4])}%"></i><i class="s3" style="width:${w(cnt[3])}%"></i><i class="s2" style="width:${w(cnt[2])}%"></i><i class="s1" style="width:${w(cnt[1])}%"></i></div>
      <span class="num">${cnt[3] + cnt[4]}/${ps.length}</span>`;
  }
  function renderStats() {
    const ids = Object.keys(S.prog).filter(id => BY_ID.has(id));
    const studied = ids.filter(id => level(id) > 0).length;
    const mastered = PEOPLE.filter(p => level(p.id) >= 3).length;
    let c = 0, w = 0;
    ids.forEach(id => { c += S.prog[id].c; w += S.prog[id].w; });
    const acc = c + w ? Math.round((c / (c + w)) * 100) : 0;
    const weak = ids.map(id => BY_ID.get(id)).filter(p => S.prog[p.id].w > 0 && level(p.id) <= 2)
      .sort((a, b) => (S.prog[b.id].w - S.prog[b.id].c) - (S.prog[a.id].w - S.prog[a.id].c)).slice(0, 15);
    const favs = S.fav.map(id => BY_ID.get(id)).filter(Boolean);
    const noted = Object.keys(S.notes).map(id => BY_ID.get(id)).filter(Boolean);

    // 直近8週間の学習日
    const set = new Set(S.days);
    const cells = [];
    const d = new Date(); d.setDate(d.getDate() - 55);
    for (let i = 0; i < 56; i++) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cells.push(`<i class="${set.has(k) ? 'on' : ''}" title="${k}"></i>`);
      d.setDate(d.getDate() + 1);
    }

    view.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="k">収録人物</div><div class="v">${PEOPLE.length}<small> 人</small></div></div>
        <div class="kpi"><div class="k">学習した人物</div><div class="v">${studied}<small> 人</small></div></div>
        <div class="kpi"><div class="k">定着・習得</div><div class="v">${mastered}<small> 人</small></div></div>
        <div class="kpi"><div class="k">正答率</div><div class="v">${acc}<small> %（${c + w}回）</small></div></div>
        <div class="kpi"><div class="k">連続学習</div><div class="v">${streak()}<small> 日</small></div></div>
      </div>

      <section class="panel sync" id="syncPanel"></section>

      <section class="panel">
        <h2>時代別の定着度</h2>
        <div class="legend">${[4, 3, 2, 1, 0].map(l => `<span class="lv lv${l}">${LEVELS[l]}</span>`).join('')}</div>
        <div class="two">
          ${REGIONS.map(r => `<div><h3 style="font-size:15px;margin-bottom:8px;color:var(--${r === '西洋' ? 'west' : 'japan'})">${r}</h3>
            <div class="bars">${ERAS[r].map(e => `<div class="bar-row"><span>${e}</span>${bar(PEOPLE.filter(p => p.region === r && p.era === e))}</div>`).join('')}</div></div>`).join('')}
        </div>
      </section>

      <section class="panel">
        <h2>学習した日（直近8週間）</h2>
        <div class="cal">${cells.join('')}</div>
      </section>

      <div class="two">
        <section class="panel">
          <h2>苦手な人物</h2>
          ${weak.length ? `<div class="chips">${weak.map(p => personChip(p, false)).join('')}</div>
            <div class="btns"><button class="btn primary" id="weakcards">苦手をカードで復習</button></div>` : '<p class="lead">まだありません。クイズに挑戦してみましょう。</p>'}
        </section>
        <section class="panel">
          <h2>お気に入り・メモ</h2>
          ${favs.length ? `<div class="chips">${favs.map(p => personChip(p, false)).join('')}</div>` : '<p class="lead">人物の詳細画面で ☆ を押すと追加されます。</p>'}
          ${noted.length ? `<h3 style="font-size:13px;margin:12px 0 6px;color:var(--muted)">メモのある人物</h3><div class="chips">${noted.map(p => personChip(p, false)).join('')}</div>` : ''}
        </section>
      </div>

      <section class="panel">
        <h2>データの管理</h2>
        <p class="lead">ログインしていないときは、学習記録はこのブラウザにだけ保存されます。ファイルに書き出して保管したり、別の端末で読み込んで統合したりもできます。</p>
        <div class="btns">
          <button class="btn" id="exp">学習記録を書き出す</button>
          <label class="btn">学習記録を読み込む<input type="file" id="imp" accept="application/json,.json" hidden></label>
          <button class="btn" id="reset" style="color:var(--ng)">すべてリセット</button>
        </div>
      </section>`;

    $('#weakcards')?.addEventListener('click', () => startCards(weak, 'name'));
    $('#exp').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `jinmei-jiten-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#imp').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const obj = JSON.parse(await file.text());
        if (!obj || typeof obj.prog !== 'object') throw new Error('bad');
        if (!confirm('読み込んだファイルの学習記録を、現在の記録に統合します（同じ人物は新しい方の記録を残します）。よろしいですか？')) return;
        S = mergeStates(S, obj);
        save();
        toast('読み込みました');
        renderStats();
      } catch (err) {
        alert('このファイルは読み込めませんでした。書き出した JSON ファイルを選んでください。');
      }
    });
    $('#reset').addEventListener('click', () => {
      const synced = window.JinmeiSync && window.JinmeiSync.user;
      if (!confirm(`学習記録・お気に入り・メモをすべて消去します${synced ? '（同期しているほかの端末からも消えます）' : ''}。元に戻せません。よろしいですか？`)) return;
      S = blank();
      S.resetAt = Date.now();
      save();
      toast('リセットしました');
      renderStats();
    });
    renderSyncPanel();
  }

  // ───────── 端末間の同期（実際の通信は sync.js） ─────────
  function renderSyncPanel() {
    const el = $('#syncPanel');
    if (!el) return;
    const s = window.JinmeiSync || { state: 'loading' };
    const head = '<h2>☁️ 端末間の同期</h2>';
    if (s.state === 'unconfigured') {
      el.innerHTML = `${head}<p class="lead">同期の設定（js/firebase-config.js）がまだ入っていません。設定が入ると、Googleアカウントでログインして、パソコンとスマホなどで学習記録・お気に入り・メモを共有できます。</p>`;
      return;
    }
    if (s.state === 'loading') {
      el.innerHTML = `${head}<p class="lead">同期の準備をしています…</p>`;
      return;
    }
    const err = s.error ? `<p class="sync-err">⚠️ ${esc(s.error)}</p>` : '';
    if (!s.user) {
      el.innerHTML = `${head}
        <p class="lead">Googleアカウントでログインすると、学習記録・お気に入り・メモがほかの端末と自動的に共有されます。この端末の記録は、ログイン時にクラウドの記録と統合されます。</p>
        ${err}
        <div class="btns"><button class="btn primary" id="syncIn">Googleアカウントでログイン</button></div>`;
      $('#syncIn').addEventListener('click', () => s.signIn && s.signIn());
      return;
    }
    const label = { syncing: '同期しています…', synced: '同期済み', error: '同期できませんでした' }[s.state] || '';
    const when = s.lastSync ? `（${s.lastSync.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）` : '';
    el.innerHTML = `${head}
      <div class="sync-row">
        <span class="sync-dot ${esc(s.state)}"></span>
        <div class="sync-who"><strong>${esc(s.user.name || 'ログイン中')}</strong><span>${esc(s.user.email || '')}</span></div>
        <span class="sync-state">${label}${s.state === 'synced' ? when : ''}</span>
      </div>
      ${err}
      <p class="lead" style="margin-top:10px">同じGoogleアカウントでログインした端末どうしで、記録が自動的に共有されます。ログアウトしても、この端末の記録はそのまま残ります。</p>
      <div class="btns"><button class="btn" id="syncOut">ログアウト</button></div>`;
    $('#syncOut').addEventListener('click', () => s.signOut && s.signOut());
  }
  const syncChip = $('#syncChip');
  function updateSyncChip() {
    const s = window.JinmeiSync;
    if (!syncChip) return;
    const show = s && s.state !== 'unconfigured';
    syncChip.hidden = !show;
    if (!show) return;
    const st = s.user ? s.state : 'off';
    syncChip.className = `theme-btn sync-chip ${st}`;
    syncChip.title = { off: '同期していません（タップしてログイン）', syncing: '同期しています', synced: '同期済み', error: '同期できませんでした', loading: '同期の準備中' }[st] || '';
  }
  syncChip?.addEventListener('click', () => {
    location.hash = '#/stats';
    setTimeout(() => $('#syncPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  });
  window.addEventListener('jinmei-sync', () => { updateSyncChip(); renderSyncPanel(); });

  // sync.js から使う窓口
  window.JinmeiApp = {
    getState: () => S,
    merge: mergeStates,
    onSave: f => saveListeners.push(f),
    // クラウドの記録を統合する。変化があれば保存して画面を更新し true を返す
    applyRemote(remote) {
      const m = mergeStates(S, remote);
      if (JSON.stringify(m) === JSON.stringify(S)) return false;
      S = m;
      save();
      if (current === 'stats') renderStats();
      if (current === 'dict') updateList();
      return true;
    },
  };

  // ───────── 全文検索（画面上部。どのページからでも使える） ─────────
  // 人物：名前・よみ・別名・要約・キーワード・解説　／　出来事：題名・解説・背景とその後
  // 年表のページでは、結果を押すと年表上の位置へ移動し、「前へ／次へ」で年代順にたどれる。
  EVENTS.forEach(e => {
    e.head = norm(e.t);
    e.text = norm([e.t, e.l || '', e.r, e.d, e.more].join(' '));
  });
  const gq = $('#gq');
  const gsPanel = $('#gsPanel');
  const gsStep = $('#gsStep');
  let gs = { q: '', words: [], people: [], events: [] };
  let gsAll = false;      // 「すべて表示」
  let gsSeq = [];         // 年表でたどる順（年代順）
  let gsPos = -1;

  function searchAll(q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return { q, words, people: [], events: [] };
    const nameHit = h => (words.every(w => h.includes(w)) ? 0 : 1);
    const people = PEOPLE.filter(p => words.every(w => p.text.includes(w)))
      .sort((a, b) => nameHit(a.head) - nameHit(b.head) || a.y - b.y);
    const events = EVENTS.filter(e => words.every(w => e.text.includes(w)))
      .sort((a, b) => nameHit(a.head) - nameHit(b.head) || a.y - b.y);
    return { q, words, people, events };
  }
  // 一致した語に印を付ける（正規化で長さが変わる文字列は印なし）
  function hl(raw, words) {
    const n = norm(raw);
    if (n.length !== raw.length) return esc(raw);
    const on = new Array(raw.length).fill(false);
    words.forEach(w => {
      for (let k = n.indexOf(w); k >= 0; k = n.indexOf(w, k + 1)) for (let j = k; j < k + w.length; j++) on[j] = true;
    });
    let out = '';
    for (let j = 0; j < raw.length; j++) {
      if (on[j] && !on[j - 1]) out += '<mark>';
      out += esc(raw[j]);
      if (on[j] && !on[j + 1]) out += '</mark>';
    }
    return out;
  }
  // 一致した箇所の前後を切り出す
  function snip(fields, words, len = 76) {
    const raw = fields.find(f => f && words.some(w => norm(f).includes(w))) || fields.find(Boolean) || '';
    const n = norm(raw);
    const idx = words.map(w => n.indexOf(w)).filter(x => x >= 0);
    const i = idx.length ? Math.min(...idx) : 0;
    const start = Math.max(0, i - 22);
    const end = Math.min(raw.length, start + len);
    return `${start > 0 ? '…' : ''}${hl(raw.slice(start, end), words)}${end < raw.length ? '…' : ''}`;
  }

  function renderGsPanel() {
    const { words, people, events } = gs;
    if (!words.length) { gsPanel.hidden = true; return; }
    const onTl = current === 'timeline';
    const lim = gsAll ? Infinity : 8;
    const pItem = p => `
      <button class="gs-item" data-gs="p:${esc(p.id)}">
        <span class="gs-t">${hl(p.name, words)}<small>${esc(lifeOf(p))}</small>${regionBadge(p)}</span>
        <span class="gs-s">${snip([p.desc, p.keys.join('・'), p.detail, p.sub, p.alias.join('、')], words)}</span>
      </button>`;
    const eItem = e => `
      <button class="gs-item" data-gs="e:${esc(e.key)}">
        <span class="gs-t"><b class="gs-yr">${esc(e.l || fy(e.y))}</b>${hl(e.t, words)}<span class="badge ${RC[e.r]}">${e.r}</span></span>
        <span class="gs-s">${snip([e.d, e.more], words)}</span>
      </button>`;
    const more = !gsAll && (people.length > lim || events.length > lim);
    gsPanel.innerHTML = `
      <div class="gs-head">
        <span>人物 <b>${people.length}</b>件・出来事 <b>${events.length}</b>件</span>
        <span class="gs-hint">${onTl ? '押すと年表上の場所へ移動します（Enterで最初の場所へ）' : '押すと詳細が開きます'}</span>
      </div>
      ${people.length ? `<div class="gs-group">人物</div>${people.slice(0, lim).map(pItem).join('')}` : ''}
      ${events.length ? `<div class="gs-group">出来事</div>${events.slice(0, lim).map(eItem).join('')}` : ''}
      ${!people.length && !events.length ? '<p class="gs-empty">見つかりませんでした。言葉を短くしたり、ひらがなで入力したりしてみてください。</p>' : ''}
      ${more ? '<button class="gs-more" data-gsmore>すべての結果を表示</button>' : ''}`;
    gsPanel.hidden = false;
  }
  const closeGsPanel = () => { gsPanel.hidden = true; };

  // 年表上でたどる順番（人物は年表に置かれている年）
  function buildSeq() {
    return [
      ...gs.people.map(p => ({ kind: 'p', key: p.id, y: tlYear(p).y })),
      ...gs.events.map(e => ({ kind: 'e', key: e.key, y: e.y })),
    ].sort((a, b) => a.y - b.y || (a.kind === 'e' ? -1 : 1));
  }
  const tlSel = it => (it.kind === 'p' ? `#tl [data-open="${CSS.escape(it.key)}"]` : `#tl [data-ev="${CSS.escape(it.key)}"]`);
  // 年表の中で一致した項目すべてに印を付ける
  function markTlMatches() {
    $$('#tl .match').forEach(x => x.classList.remove('match'));
    if (current !== 'timeline' || !gs.words.length) return;
    buildSeq().forEach(it => $(tlSel(it))?.classList.add('match'));
  }
  // 年表上の位置へ移動（非表示の項目なら表示条件を戻してから）
  function jumpTl(it) {
    if (!it) return;
    let changed = false;
    if (it.kind === 'p') {
      const p = BY_ID.get(it.key);
      if (!tl.ps) { tl.ps = true; changed = true; }
      if (tl.cat && p.cat !== tl.cat) { tl.cat = ''; changed = true; }
    } else {
      const e = EV_BY_KEY.get(it.key);
      if (!tl.ev) { tl.ev = true; changed = true; }
      if (e.r === '中国' && !tl.cn) { tl.cn = true; changed = true; }
    }
    if (changed) renderTimeline();
    const el = $(tlSel(it));
    if (!el) return;
    $$('#tl .hit').forEach(x => x.classList.remove('hit'));
    el.classList.add('hit');
    scrollToEl(el, 'center');
  }
  function renderGsStep() {
    if (current !== 'timeline' || gsPos < 0 || !gsSeq.length) { gsStep.hidden = true; return; }
    gsStep.innerHTML = `
      <span class="gs-step-q">「${esc(gs.q)}」</span>
      <span class="gs-step-n">${gsPos + 1} / ${gsSeq.length}</span>
      <button data-step="-1" aria-label="前の該当箇所">◀ 前へ</button>
      <button data-step="1" aria-label="次の該当箇所">次へ ▶</button>
      <button data-step="x" aria-label="検索を終える">×</button>`;
    gsStep.hidden = false;
  }
  function gsGo(pos) {
    gsPos = (pos + gsSeq.length) % gsSeq.length;
    jumpTl(gsSeq[gsPos]);
    renderGsStep();
  }
  function activateGs(token) {
    const kind = token[0];
    const key = token.slice(2);
    closeGsPanel();
    gq.blur();
    if (current === 'timeline') {
      gsSeq = buildSeq();
      gsGo(Math.max(0, gsSeq.findIndex(x => x.kind === kind && x.key === key)));
    } else if (kind === 'p') openDetail(key);
    else openEvent(key);
  }
  function clearGs() {
    gq.value = '';
    gs = searchAll('');
    gsSeq = [];
    gsPos = -1;
    closeGsPanel();
    renderGsStep();
    markTlMatches();
    $$('#tl .hit').forEach(x => x.classList.remove('hit'));
  }

  gq.addEventListener('input', () => {
    gs = searchAll(gq.value);
    gsAll = false;
    gsSeq = [];
    gsPos = -1;
    renderGsStep();
    renderGsPanel();
    markTlMatches();
  });
  gq.addEventListener('focus', () => { if (gs.words.length) renderGsPanel(); });
  gq.addEventListener('keydown', e => {
    const items = $$('.gs-item', gsPanel);
    const cur = items.findIndex(x => x.classList.contains('sel'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items.forEach(x => x.classList.remove('sel'));
      items[next].classList.add('sel');
      items[next].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cur >= 0) activateGs(items[cur].dataset.gs);
      else if (current === 'timeline' && gs.words.length) {
        gsSeq = buildSeq();
        if (gsSeq.length) { closeGsPanel(); gq.blur(); gsGo(0); }
      } else if (items.length) activateGs(items[0].dataset.gs);
    } else if (e.key === 'Escape') {
      closeGsPanel();
      gq.blur();
    }
  });
  gsPanel.addEventListener('click', e => {
    if (e.target.closest('[data-gsmore]')) { gsAll = true; renderGsPanel(); gq.focus(); return; }
    const it = e.target.closest('[data-gs]');
    if (it) activateGs(it.dataset.gs);
  });
  gsStep.addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    if (b.dataset.step === 'x') clearGs();
    else gsGo(gsPos + Number(b.dataset.step));
  });
  document.addEventListener('click', e => { if (!e.target.closest('#gsearch')) closeGsPanel(); });
  // 「/」キーで検索欄へ
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !dlg.open && !e.target.closest?.('input, textarea, select')) { e.preventDefault(); gq.focus(); gq.select(); }
  });
  // 画面上部の高さ（年表の見出しの固定位置などに使う）
  const topBar = $('.top');
  const setTopH = () => document.documentElement.style.setProperty('--hdr', `${topBar.offsetHeight}px`);
  new ResizeObserver(setTopH).observe(topBar);
  setTopH();

  // ───────── キーボード操作 ─────────
  document.addEventListener('keydown', e => {
    if (dlg.open || e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (current === 'cards' && fc && fc.i < fc.deck.length) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipCard(); }
      else if (e.key === 'ArrowRight' && fc.on) answerCard(true);
      else if (e.key === 'ArrowLeft' && fc.on) answerCard(false);
    } else if (current === 'quiz' && qz && qz.i < qz.qs.length) {
      if (qz.answered == null && /^[1-4]$/.test(e.key)) answerQuiz(+e.key - 1);
      else if (qz.answered != null && e.key === 'Enter' && e.target.id !== 'qnext') { e.preventDefault(); nextQuestion(); }
    }
  });

  // ───────── 明るい／暗い表示の切り替え（初期は明るい表示） ─────────
  const themeBtn = $('#themeBtn');
  function setTheme(t) {
    if (t === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
    try { localStorage.setItem('jinmei-theme', t); } catch (e) { /* ignore */ }
  }
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  themeBtn.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  // ───────── ルーティング ─────────
  const ROUTES = { dict: renderDict, timeline: renderTimeline, cards: renderCards, quiz: renderQuiz, stats: renderStats };
  let current = 'dict';
  function route() {
    const r = (location.hash.match(/^#\/(\w+)/) || [])[1];
    current = ROUTES[r] ? r : 'dict';
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === current));
    if (dlg.open) dlg.close();
    closeGsPanel();
    gsPos = -1;
    renderGsStep();
    ROUTES[current]();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
