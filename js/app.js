(() => {
  'use strict';

  // ───────── データ準備 ─────────
  const DATA = window.HISTORY_DATA;
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
    q.to = p.died ?? (p.born != null ? p.born + 60 : p.fl + 30);
    q.text = norm([p.name, p.sub, ...q.alias, p.region, p.era, p.cat, p.desc, ...q.keys].join(' '));
    q.rc = p.region === '西洋' ? 'west' : 'japan';
    q.eraIdx = ERAS[p.region].indexOf(p.era);
    return q;
  });
  const BY_ID = new Map(PEOPLE.map(p => [p.id, p]));

  // ───────── 小道具 ─────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const sample = (a, n) => shuffle([...a]).slice(0, n);
  const fy = y => (y < 0 ? `前${-y}` : String(y));
  const lifeOf = p => p.life || `${p.born != null ? fy(p.born) : '?'}–${p.died != null ? fy(p.died) : '?'}`;
  const centuryOf = y => Math.max(1, Math.floor((y - 1) / 100) + 1);
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const view = $('#view');
  const dlg = $('#detail');

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

  // ───────── 保存（このブラウザの localStorage） ─────────
  const KEY = 'jinmei-jiten-v1';
  const blank = () => ({ prog: {}, fav: [], notes: {}, days: [], pref: {} });
  let S = load();
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') return Object.assign(blank(), s);
    } catch (e) { /* 保存できない環境でも動かす */ }
    return blank();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

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

  // ───────── 詳細ダイアログ ─────────
  function contemporaries(p, region, n) {
    return PEOPLE
      .filter(q => q !== p && q.region === region && q.from < p.to && q.to > p.from)
      .sort((a, b) => Math.abs(a.y - p.y) - Math.abs(b.y - p.y))
      .slice(0, n)
      .sort((a, b) => a.y - b.y);
  }
  function openDetail(id) {
    const p = BY_ID.get(id);
    if (!p) return;
    const r = S.prog[id];
    const other = p.region === '西洋' ? '日本' : '西洋';
    const peersOther = contemporaries(p, other, 8);
    const peersSame = contemporaries(p, p.region, 8);
    dlg.innerHTML = `
      <article class="detail">
        <button class="close" data-close aria-label="閉じる">×</button>
        <div class="badges">${regionBadge(p)}<span class="badge">${esc(p.era)}</span><span class="badge">${esc(p.cat)}</span></div>
        <h2>${esc(p.name)}</h2>
        <p class="sub">${esc(p.sub)}${p.alias.length ? `　別名：${p.alias.map(esc).join('、')}` : ''}</p>
        <p class="life">${esc(lifeOf(p))}</p>
        <p class="desc">${esc(p.desc)}</p>
        <div class="chips">${p.keys.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>

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
      save();
    });
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    const f = e.target.closest('[data-fav]');
    if (f) {
      const id = f.dataset.fav;
      S.fav = isFav(id) ? S.fav.filter(x => x !== id) : [...S.fav, id];
      save();
      openDetail(id);
    }
  });
  dlg.addEventListener('close', () => { if (current === 'dict') updateList(); if (current === 'stats') renderStats(); });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open]');
    if (t) { e.preventDefault(); openDetail(t.dataset.open); }
  });

  // ───────── 辞典 ─────────
  const dict = { q: '', region: '', era: '', cat: '', fav: false, sort: 'year' };
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
        <input type="search" id="q" placeholder="人名・よみ・キーワードで検索（例：ルター、しんらん、十字軍）" value="${esc(dict.q)}" aria-label="検索">
        <div class="row" style="margin-top:10px">
          <label class="f">地域<select name="region"><option value="">西洋と日本</option>${REGIONS.map(r => `<option${r === dict.region ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
          <label class="f">時代<select name="era">${eraOptions(dict.region, dict.era)}</select></label>
          <label class="f">分野<select name="cat"><option value="">すべての分野</option>${CATS.map(c => `<option${c === dict.cat ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="f">並び順<select name="sort">
            <option value="year"${dict.sort === 'year' ? ' selected' : ''}>年代順</option>
            <option value="kana"${dict.sort === 'kana' ? ' selected' : ''}>五十音順</option>
            <option value="weak"${dict.sort === 'weak' ? ' selected' : ''}>苦手な順</option>
          </select></label>
          <label class="check"><input type="checkbox" name="fav"${dict.fav ? ' checked' : ''}> ★のみ</label>
        </div>
      </section>
      <p class="count" id="count"></p>
      <div class="grid" id="list"></div>`;

    const f = $('#dictf');
    $('#q').addEventListener('input', e => { dict.q = e.target.value; updateList(); });
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
    const words = norm(dict.q).split(/\s+/).filter(Boolean);
    let res = PEOPLE.filter(p =>
      (!dict.region || p.region === dict.region) &&
      (!dict.era || p.era === dict.era) &&
      (!dict.cat || p.cat === dict.cat) &&
      (!dict.fav || isFav(p.id)) &&
      words.every(w => p.text.includes(w)));
    if (dict.sort === 'kana') {
      const k = p => (p.region === '日本' ? p.sub : toHira(p.name));
      res.sort((a, b) => k(a).localeCompare(k(b), 'ja'));
    } else if (dict.sort === 'weak') {
      const score = p => { const r = S.prog[p.id]; return r ? (r.w - r.c) * 10 - r.b : -100; };
      res.sort((a, b) => score(b) - score(a) || a.y - b.y);
    } else {
      res.sort((a, b) => a.y - b.y);
    }
    $('#count').textContent = `${res.length}人 / 全${PEOPLE.length}人`;
    list.innerHTML = res.length ? res.map(p => `
      <button class="pcard ${p.rc}" data-open="${esc(p.id)}">
        ${isFav(p.id) ? '<span class="star">★</span>' : ''}
        <span class="nm">${esc(p.name)}</span>
        <span class="sb">${esc(p.sub)}</span>
        <span class="mt">${regionBadge(p)}<span class="badge">${esc(p.era)}</span><span>${esc(lifeOf(p))}</span></span>
        <span class="lv lv${level(p.id)}" title="${LEVELS[level(p.id)]}">${LEVELS[level(p.id)]}</span>
      </button>`).join('') : '<p class="empty">該当する人物がいません。</p>';
  }

  // ───────── 年表 ─────────
  const tl = { cat: '' };
  function renderTimeline() {
    view.innerHTML = `
      <section class="panel">
        <h2>西洋と日本の比較年表</h2>
        <p class="lead">生まれた世紀ごとに、西洋と日本の人物を並べています。「同じころ、向こうでは誰が？」をつかむのに使ってください。</p>
        <div class="row"><label class="f" style="max-width:240px">分野<select id="tlcat"><option value="">すべての分野</option>${CATS.map(c => `<option${c === tl.cat ? ' selected' : ''}>${c}</option>`).join('')}</select></label></div>
      </section>
      <div class="tl" id="tl"></div>`;
    $('#tlcat').addEventListener('change', e => { tl.cat = e.target.value; drawTimeline(); });
    drawTimeline();
  }
  function drawTimeline() {
    const ps = PEOPLE.filter(p => !tl.cat || p.cat === tl.cat).sort((a, b) => a.y - b.y);
    const groups = new Map();
    ps.forEach(p => { const c = centuryOf(p.y); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(p); });
    const cs = [...groups.keys()];
    let html = '<div class="h">世紀</div><div class="h west">西洋</div><div class="h japan">日本</div>';
    if (cs.length) {
      for (let c = Math.min(...cs); c <= Math.max(...cs); c++) {
        const g = groups.get(c) || [];
        const col = r => g.filter(p => p.region === r).map(p => personChip(p)).join('');
        html += `<div class="c">${c}</div><div class="col west">${col('西洋')}</div><div class="col japan">${col('日本')}</div>`;
      }
    }
    $('#tl').innerHTML = html;
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
        <p class="lead">学習記録はこのブラウザにだけ保存されています。別の端末で続けたいときは、書き出したファイルを読み込んでください。</p>
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
        if (!confirm('現在の学習記録を、読み込んだファイルの内容で置き換えます。よろしいですか？')) return;
        S = Object.assign(blank(), obj);
        save();
        toast('読み込みました');
        renderStats();
      } catch (err) {
        alert('このファイルは読み込めませんでした。書き出した JSON ファイルを選んでください。');
      }
    });
    $('#reset').addEventListener('click', () => {
      if (!confirm('学習記録・お気に入り・メモをすべて消去します。元に戻せません。よろしいですか？')) return;
      S = blank();
      save();
      toast('リセットしました');
      renderStats();
    });
  }

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

  // ───────── ルーティング ─────────
  const ROUTES = { dict: renderDict, timeline: renderTimeline, cards: renderCards, quiz: renderQuiz, stats: renderStats };
  let current = 'dict';
  function route() {
    const r = (location.hash.match(/^#\/(\w+)/) || [])[1];
    current = ROUTES[r] ? r : 'dict';
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.r === current));
    if (dlg.open) dlg.close();
    ROUTES[current]();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
