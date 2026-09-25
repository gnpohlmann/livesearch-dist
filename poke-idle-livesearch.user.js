// ==UserScript==
// @name         Poke Idle - LiveSearch
// @namespace    poke-idle-market
// @version      0.4.57
// @description  LiveSearch by k4f
// @match        https://poke.idleworld.online/play*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      pokeapi.co
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/gnpohlmann/livesearch-dist/main/poke-idle-livesearch.user.js
// @downloadURL  https://raw.githubusercontent.com/gnpohlmann/livesearch-dist/main/poke-idle-livesearch.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- config ---------- */
  const PW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const VERSION = '0.4.57';
  const API = '/api/game/market';
  const POLL_POKEMON_MS = 8000;
  const POLL_ITEMS_MS = 20000;
  const MAX_HITS = 40;
  const CATEGORIES = ['Items', 'Stones', 'Poke Balls', 'Diamonds'];
  const CATEGORY_LABELS = { Diamonds: 'Diamantes' };
  const catLabel = (c) => CATEGORY_LABELS[c] || c || '';
  const NPCS = [
    { key: 'shop', label: 'Loja', title: 'Loja', idx: 79, re: /abrir loja$/i },
    { key: 'depot', label: 'Depot', title: 'Depósito', idx: 86, re: /abrir dep[oó]sito/i },
    { key: 'flint', label: 'Stones', title: 'Stone Researcher', idx: 81, re: /stone researcher/i },
    { key: 'tm', label: 'TMs', title: 'TM Researcher', idx: 82, re: /tm researcher/i },
    { key: 'held', label: 'Held', title: 'Held Machine', idx: 83, re: /held machine/i },
    { key: 'trader', label: 'Trader', title: 'Pokemaniac Trader', idx: 80, re: /pokemaniac/i }
  ];
  const MK_CAT_ICON = { all: '▦', Items: '🎒', Stones: '💎', 'Poke Balls': '🔴', Diamonds: '💠', pokemon: '🐾' };
  const MK_CATS = [['all', 'Todos'], ['Items', 'Itens'], ['Stones', 'Stones'], ['Poke Balls', 'Poké Balls'], ['Diamonds', 'Diamantes'], ['pokemon', 'Pokémon']];
  const DEBUG = true;

  const log = (...a) => DEBUG && console.log('%c[Alertas]', 'color:#e0b95a;font-weight:bold', ...a);
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  const CURRENCY_LABELS = { GOLD: 'Dólares', DIAMONDS: 'Diamantes', DIAMOND: 'Diamantes', Diamonds: 'Diamantes' };
  const curLabel = (c) => CURRENCY_LABELS[c] || c || '';
  const ago = (t) => {
    if (!t) return '-';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? s + 's' : Math.round(s / 60) + 'min';
  };

  /* ---------- armazenamento ---------- */
  const store = {
    get(k, d) {
      try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (e) {}
      try {
        const v = localStorage.getItem('mtal_' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try { if (typeof GM_setValue === 'function') return GM_setValue(k, v); } catch (e) {}
      try { localStorage.setItem('mtal_' + k, JSON.stringify(v)); } catch (e) {}
    },
  };

  const MAX_PURCHASED = 60;

  const state = {
    alerts: store.get('alerts', []) || [],
    purchased: store.get('purchased', []) || [],
    muted: !!store.get('muted', false),
    on: store.get('on', true) !== false,
    notifyOS: store.get('notifyOS', true) !== false,
    soundId: store.get('soundId', 'chime'),
    fabHidden: !!store.get('fabHidden', false),
    panelPos: store.get('panelPos', null),
  };

  const save = () => {
    store.set('alerts', state.alerts);
    store.set('purchased', state.purchased);
    store.set('muted', state.muted);
    store.set('on', state.on);
    store.set('notifyOS', state.notifyOS);
    store.set('soundId', state.soundId);
    store.set('fabHidden', state.fabHidden);
    store.set('panelPos', state.panelPos);
  };

  const runtime = new Map();

  const rtOf = (id) => {
    let r = runtime.get(id);
    if (!r) {
      r = { seen: null, next: 0, err: '', fail: 0, last: 0 };
      runtime.set(id, r);
    }
    return r;
  };

  const hits = [];
  let hitSeq = 0;
  const knownCurrencies = new Set(['GOLD']);
  let species = null;
  let unseen = 0;
  let panelOpen = false;
  let activeTab = 'hits';
  let detailsHid = null;
  let detailsAnchor = 'mtal-panel';

  /* ---------- inventário (itens) ---------- */
  let ownedCache = store.get('ownedItems', null);

  const isOwnedArr = (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v[0] &&
    typeof v[0] === 'object' &&
    'itemId' in v[0] &&
    'quantity' in v[0] &&
    Object.keys(v[0]).length <= 4;

  function findOwnedIn(v, depth) {
    if (isOwnedArr(v)) return v;
    if (!v || typeof v !== 'object' || depth > 3) return null;

    for (const k in v) {
      const r = findOwnedIn(v[k], depth + 1);

      if (r) return r;
    }

    return null;
  }

  const depotToOwned = (d) =>
    d && Array.isArray(d.inventory)
      ? d.inventory.map((x) => ({
          itemId: x.id,
          quantity: x.quantity,
          name: x.name,
          icon: x.icon,
          category: x.category,
          npcPrice: x.npcPrice
        }))
      : null;

  function setOwned(list) {
    const prev = new Map(((ownedCache && ownedCache.list) || []).map((x) => [x.itemId, x]));

    const next = list.map((x) => {
      const p = prev.get(x.itemId) || {};

      return {
        itemId: x.itemId,
        quantity: x.quantity,
        name: x.name || p.name,
        icon: x.icon || p.icon,
        category: x.category || p.category,
        npcPrice: x.npcPrice != null ? x.npcPrice : p.npcPrice
      };
    });

    if (ownedCache && JSON.stringify(ownedCache.list) === JSON.stringify(next)) {
      ownedCache.t = Date.now();
      return;
    }

    ownedCache = { t: Date.now(), list: next };
    store.set('ownedItems', ownedCache);

    try {
      slRenderOwned();
    } catch (e) {}
  }

  try {
    const ME = PW.MessageEvent;
    const dDesc = Object.getOwnPropertyDescriptor(ME.prototype, 'data');

    if (dDesc && dDesc.get) {
      Object.defineProperty(ME.prototype, 'data', {
        configurable: true,
        enumerable: dDesc.enumerable,
        get() {
          const v = dDesc.get.call(this);

          try {
            if (typeof v === 'string' && v.startsWith('{"type":"inventory"')) {
              const j = JSON.parse(v);

              if (Array.isArray(j.items)) setOwned(j.items);
            }
          } catch (e) {}

          return v;
        }
      });
    }
  } catch (e) {
    log('não consegui observar o websocket:', e);
  }

  /* ---------- memória de anúncios (p/ histórico) ---------- */
  const SEEN_MAX = 400;
  const seenL = store.get('seenListings', {}) || {};
  const seenKey = (name, price, cur) => [name, price, cur].join('|');

  function rememberListings(list) {
    let n = 0;

    (list || []).forEach((l) => {
      if (!l || l.kind !== 'pokemon' || !l.name) return;

      seenL[seenKey(l.name, l.price, l.currency)] = { ...l, _t: Date.now() };
      n++;
    });

    if (!n) return;

    const ks = Object.keys(seenL);

    if (ks.length > SEEN_MAX) {
      ks.sort((a, b) => seenL[a]._t - seenL[b]._t)
        .slice(0, ks.length - SEEN_MAX)
        .forEach((k) => delete seenL[k]);
    }

    store.set('seenListings', seenL);
  }

  /* ---------- sessão ---------- */
  let captured = null;

  const pickAuth = (input, init) => {
    const h = (init && init.headers) || (input && input.headers);
    if (!h) return null;

    if (typeof h.get === 'function') return h.get('authorization');

    if (Array.isArray(h)) {
      const p = h.find((x) => String(x[0]).toLowerCase() === 'authorization');
      return p ? p[1] : null;
    }

    for (const k in h) {
      if (k.toLowerCase() === 'authorization') return h[k];
    }

    return null;
  };

  try {
    const _fetch = PW.fetch;

    PW.fetch = function (input, init) {
      try {
        const a = pickAuth(input, init);

        if (a) {
          const first = !captured;
          captured = a;

          if (first) {
            runtime.forEach((r) => {
              r.next = 0;
              r.fail = 0;
            });
          }
        }
      } catch (e) {}

      const res = _fetch.apply(this, arguments);

      try {
        const u = String((input && input.url) || input || '');

        if (u.includes('/api/game/')) {
          res
            .then((r) => r.clone().json())
            .then((d) => {
              try {
                walletScan(d, 0);
                walletRender();
              } catch (e) {}
            })
            .catch(() => {});
        }

        if (u.includes('/api/game/depot')) {
          res
            .then((r) => r.clone().json())
            .then((d) => {
              const a = depotToOwned(d);

              if (a) setOwned(a);
            })
            .catch(() => {});
        }

        if (u.includes('/api/game/market') && u.includes('browse=pokemon')) {
          res
            .then((r) => r.clone().json())
            .then((d) => rememberListings(d && d.listings))
            .catch(() => {});
        }

        if (u.includes('/api/game') && !u.includes('/api/game/market')) {
          res
            .then((r) => r.clone().json())
            .then((d) => {
              const a = findOwnedIn(d, 0);

              if (a) setOwned(a);
            })
            .catch(() => {});
        }
      } catch (e) {}

      return res;
    };
  } catch (e) {
    log('não consegui observar o fetch:', e);
  }

  function storageAuth() {
    const m = captured && /^(\S+)\s/.exec(captured);
    const scheme = m ? m[1] : 'Bearer';
    const jwt = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

    for (const st of [PW.localStorage, PW.sessionStorage]) {
      try {
        for (let i = 0; i < st.length; i++) {
          const key = st.key(i);
          const raw = st.getItem(key);

          if (!raw) continue;

          if (jwt.test(raw) && /access|token|auth/i.test(key)) {
            return scheme + ' ' + raw;
          }

          if (raw[0] === '{') {
            try {
              const j = JSON.parse(raw);
              const t = j && (
                j.accessToken ||
                (j.state && j.state.accessToken) ||
                (j.tokens && j.tokens.accessToken)
              );

              if (typeof t === 'string' && jwt.test(t)) {
                return scheme + ' ' + t;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    return null;
  }

  /* ---------- API ---------- */
  const cache = new Map();

  function getAuths() {
    return [...new Set([storageAuth(), captured].filter(Boolean))];
  }

  function api(query, ttl = 0) {
    const url = API + query;
    const c = cache.get(url);

    if (c && Date.now() - c.t < ttl) {
      return c.p;
    }

    const p = (async () => {
      const auths = getAuths();

      if (!auths.length) {
        throw new Error('sem sessão: abra o Market 1x');
      }

      let status = 0;

      for (const a of auths) {
        const r = await PW.fetch(url, {
          headers: {
            authorization: a
          }
        });

        status = r.status;

        if (r.status === 401 || r.status === 403) {
          continue;
        }

        if (!r.ok) {
          throw new Error('HTTP ' + r.status);
        }

        return r.json();
      }

      throw new Error('sessão expirada (' + status + '): abra o Market 1x');
    })();

    cache.set(url, {
      t: Date.now(),
      p
    });

    p.catch(() => cache.delete(url));

    return p;
  }

  async function mkAction(body) {
    const auths = getAuths();

    if (!auths.length) {
      throw new Error('sem sessão: abra o Market 1x');
    }

    let status = 0;
    let lastErr = null;

    for (const a of auths) {
      let r;

      try {
        r = await PW.fetch(API + '/action', {
          method: 'POST',
          headers: {
            authorization: a,
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        });
      } catch (e) {
        lastErr = e;
        continue;
      }

      status = r.status;

      if (r.status === 401 || r.status === 403) {
        continue;
      }

      const data = await r.json().catch(() => null);

      if (!r.ok || !data || data.ok === false) {
        throw new Error(
          (data && (data.error || data.message)) ||
          'HTTP ' + r.status
        );
      }

      return data;
    }

    if (lastErr) throw lastErr;

    throw new Error(
      'sessão expirada (' + status + '): abra o Market 1x'
    );
  }

  async function gameGet(path) {
    const auths = getAuths();

    if (!auths.length) throw new Error('sem sessão');

    let status = 0;

    for (const a of auths) {
      const r = await PW.fetch(path, { headers: { authorization: a } });

      status = r.status;

      if (r.status === 401 || r.status === 403) continue;
      if (!r.ok) throw new Error('HTTP ' + r.status);

      return r.json();
    }

    throw new Error('sessão expirada (' + status + ')');
  }

  function buyListing(id, quantity) {
    return mkAction({
      action: 'buy',
      id,
      quantity
    });
  }

  function queryOf(a) {
    if (a.kind === 'pokemon') {
      let q = '?browse=pokemon&page=1&sort=recent';

      if (a.speciesId) q += '&speciesId=' + a.speciesId;
      if (a.ivMin) q += '&ivMin=' + a.ivMin;
      if (a.qMin) q += '&qMin=' + a.qMin;

      return q;
    }

    return '?category=' + encodeURIComponent(a.category);
  }

  /* ---------- filtros ---------- */
  const priceOk = (a, l) => {
    if (a.maxPrice == null) return true;
    if (l.offerOnly) return false;
    if (a.currency && l.currency !== a.currency) return false;

    return l.price <= a.maxPrice;
  };

  function matches(a, l) {
    if (a.kind === 'pokemon') {
      if (a.speciesId && l.speciesId !== a.speciesId) return false;
      if (a.ivMin && !(l.ivTotal >= a.ivMin)) return false;
      if (a.qMin && !(l.quality >= a.qMin)) return false;
      if (a.shinyOnly && !l.shiny) return false;

      return priceOk(a, l);
    }

    if (
      a.text &&
      !String(l.name || '')
        .toLowerCase()
        .includes(a.text.toLowerCase())
    ) {
      return false;
    }

    if (a.belowNpc && !l.belowNpc) return false;

    return priceOk(a, l);
  }

  function describe(l) {
    if (l.kind === 'pokemon') {
      const price = l.offerOnly
        ? 'só ofertas'
        : fmt(l.price) + ' ' + curLabel(l.currency);

      return (
        l.name +
        (l.shiny ? ' ✨' : '') +
        ' · IV ' +
        l.ivTotal +
        '/192 · ×' +
        Number(l.quality).toFixed(2) +
        ' · ' +
        price
      );
    }

    return (
      l.name +
      ' · ' +
      l.quantity +
      '× · ' +
      fmt(l.price) +
      '/un ' +
      curLabel(l.currency) +
      (l.belowNpc ? ' · abaixo do NPC' : '')
    );
  }

  const currencyIcon = (c) =>
    c === 'GOLD'
      ? '$'
      : /diamond/i.test(String(c || ''))
        ? '💎'
        : '';

  const hitDesc = (h) => {
    if (h.kind !== 'pokemon') {
      return esc(
        h.name +
          ' · ' +
          h.quantity +
          '×'
      );
    }

    const r = h.raw || {};
    const lvl = pick(r, ['level', 'lvl', 'nivel']);
    const title =
      /Lv\.?\s*\d+/i.test(h.name || '') || lvl == null
        ? h.name
        : h.name + ' Lv. ' + lvl;

    const rarity =
      pick(r, ['rarity', 'raridade', 'tier', 'rarityName', 'rarityTier', 'grade', 'rank']) ||
      qualityTier(h.quality);

    const rColor =
      (rarity && RARITY_COLOR[String(rarity).toLowerCase()]) || '#e0b95a';

    const q =
      (rarity ? esc(rarity) + ' ' : '') +
      (h.quality != null ? '×' + Number(h.quality).toFixed(2) : '');

    return (
      `<div class="mtal-hit-name">${esc(title)}</div>` +
      `<div class="mtal-hit-sub">IV <span style="color:#f2ead0">${esc(h.ivTotal)}</span>/192` +
      (q ? ` · <span style="color:${rColor}">${q}</span>` : '') +
      (h.shiny ? ' ✨' : '') +
      `</div>`
    );
  };

  const hitPrice = (h) =>
    h.offerOnly
      ? 'Apenas ofertas'
      : [
          currencyIcon(h.currency),
          fmt(h.price),
          curLabel(h.currency)
        ]
          .filter(Boolean)
          .join(' ');

  /* ---------- notificações ---------- */
  const SOUND_PRESETS = {
    chime: {
      label: 'Carrilhão',
      tones: [
        [880, 0],
        [1320, 0.13]
      ]
    },

    coin: {
      label: 'Moeda',
      tones: [
        [988, 0],
        [1319, 0.08],
        [1568, 0.16]
      ]
    },

    soft: {
      label: 'Suave',
      tones: [[660, 0]]
    },

    alert: {
      label: 'Alerta',
      tones: [
        [660, 0],
        [440, 0.12],
        [660, 0.24]
      ]
    },

    blip: {
      label: 'Blip duplo',
      tones: [
        [1046, 0],
        [1046, 0.1]
      ]
    }
  };

  let ac = null;

  const MYTHIC_SOUND = {
    tones: [
      [523, 0],
      [659, 0.1],
      [784, 0.2],
      [1047, 0.3],
      [1319, 0.44],
      [1568, 0.58],
      [2093, 0.74]
    ]
  };

  function beep(force, special) {
    if (state.muted && !force) return;

    try {
      const AC = PW.AudioContext || PW.webkitAudioContext;

      ac = ac || new AC();

      if (ac.state === 'suspended') {
        ac.resume();
      }

      const preset =
        special ||
        SOUND_PRESETS[state.soundId] ||
        SOUND_PRESETS.chime;

      preset.tones.forEach(([f, d]) => {
        const o = ac.createOscillator();
        const g = ac.createGain();

        o.type = 'sine';
        o.frequency.value = f;

        g.gain.setValueAtTime(
          0.0001,
          ac.currentTime + d
        );

        g.gain.exponentialRampToValueAtTime(
          0.25,
          ac.currentTime + d + 0.02
        );

        g.gain.exponentialRampToValueAtTime(
          0.0001,
          ac.currentTime + d + 0.24
        );

        o.connect(g);
        g.connect(ac.destination);

        o.start(ac.currentTime + d);
        o.stop(ac.currentTime + d + 0.26);
      });
    } catch (e) {}
  }

  /* ---------- Market ---------- */
  const marketOpen = () =>
    !!document.querySelector('.mkt2-window');

  const marketRoot = () =>
    document.querySelector('.mkt2-window');

  const SEL_ROOT = '.game-root';
  const SEL_MKT_BTN = 'button.npc-plate-btn';
  const MKT_BTN_TEXT = 'abrir market';

  const norm = (s) =>
    (s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const waitFor = async (cond, ms) => {
    const t0 = Date.now();

    while (Date.now() - t0 < ms) {
      if (cond()) return true;
      await sleep(50);
    }

    return cond();
  };

  const findMarketBtn = () =>
    [...document.querySelectorAll(SEL_MKT_BTN)].find(
      (b) => norm(b.textContent) === MKT_BTN_TEXT
    ) || null;

  const fiberOfEl = (el) => {
    const k = Object.keys(el).find((k) =>
      k.startsWith('__reactFiber$')
    );

    return k ? el[k] : null;
  };

  function hookNodes(f) {
    const list = [];
    let h = f.memoizedState;

    while (
      h &&
      typeof h === 'object' &&
      'next' in h &&
      list.length < 300
    ) {
      list.push(h);
      h = h.next;
    }

    return list;
  }

  const isGameFiber = (f) => {
    const p = f.memoizedProps;

    return (
      p &&
      typeof p === 'object' &&
      'trainerName' in p &&
      'starterId' in p &&
      hookNodes(f).length > 50
    );
  };

  function findGameFiber() {
    const root = document.querySelector(SEL_ROOT);
    const start = root && fiberOfEl(root);

    if (!start) return null;

    let top = start;

    for (let f = start; f; f = f.return) {
      if (isGameFiber(f)) return f;
      top = f;
    }

    const stack = [top];
    let n = 0;

    while (stack.length && n++ < 200000) {
      const f = stack.pop();

      if (isGameFiber(f)) return f;

      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }

    return null;
  }

  const stateAt = (hs, i, type) => {
    const q = hs[i] && hs[i].queue;

    if (
      !q ||
      typeof q.dispatch !== 'function' ||
      typeof q.lastRenderedState !== type
    ) {
      return null;
    }

    return {
      set: q.dispatch,
      cur: q.lastRenderedState
    };
  };

  const DEFAULT_MKT_PATCH = { 87: true };

  const getMktPatch = () => {
    const p = store.get('marketPatch', null);

    return p && typeof p === 'object' && Object.keys(p).length ? p : DEFAULT_MKT_PATCH;
  };

  function learnMarketHook() {
    if (store.get('marketPatchManual', false)) return;

    const snap = () => {
      const f = findGameFiber();
      const out = new Map();

      if (f) {
        hookNodes(f).forEach((h, i) => {
          const q = h.queue;
          const v = q && q.lastRenderedState;

          if (
            q &&
            typeof q.dispatch === 'function' &&
            (typeof v === 'boolean' || typeof v === 'string')
          ) {
            out.set(i, v);
          }
        });
      }

      return out;
    };

    const before = snap();

    waitFor(marketOpen, 2500).then((ok) => {
      if (!ok) return;

      const after = snap();
      const patch = {};

      after.forEach((v, i) => {
        if (
          before.has(i) &&
          before.get(i) !== v &&
          (typeof v === 'string' || v === true)
        ) {
          patch[i] = v;
        }
      });

      if (!Object.keys(patch).length) return;

      store.set('marketPatch', patch);

      log('Market aprendido:', patch);
    });
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!e.target || !e.target.closest) return;

      const b = e.target.closest(
        SEL_MKT_BTN
      );

      if (
        b &&
        norm(b.textContent) ===
          MKT_BTN_TEXT
      ) {
        learnMarketHook();
      }
    },
    true
  );

  async function openMarket() {
    if (marketOpen()) return;

    const btn = findMarketBtn();

    if (btn) {
      btn.click();

      if (
        await waitFor(
          marketOpen,
          2500
        )
      ) {
        return;
      }
    }

    const patch = getMktPatch();
    const f = patch && findGameFiber();

    if (f) {
      const hs = hookNodes(f);
      const applied = [];

      try {
        const entries = Object.entries(patch).sort(
          (a, b) => (typeof a[1] === 'string' ? 0 : 1) - (typeof b[1] === 'string' ? 0 : 1)
        );

        for (const [i, v] of entries) {
          const st = stateAt(hs, +i, typeof v);

          if (!st) continue;

          applied.push([st, st.cur]);
          st.set(v);
        }

        if (
          applied.length &&
          await waitFor(
            marketOpen,
            2500
          )
        ) {
          return;
        }

        applied.forEach(([st, prev]) => st.set(prev));
      } catch (e) {
        log(
          'abrir market falhou:',
          e
        );
      }
    }

    toast(
      patch
        ? 'O jogo não abriu o Market aqui — fora da cidade ele não fica disponível.'
        : 'Não consegui abrir o Market automaticamente. Clique 1x em "Abrir Market" no NPC da cidade pra eu aprender.'
    );
  }

  const SIDE_LABEL = {
    Items: 'Itens',
    Stones: 'Stones',
    'Poke Balls': 'Poké Balls',
    Diamonds: 'Diamonds'
  };

  function clickByText(
    root,
    selector,
    labelSelector,
    text
  ) {
    const els = [
      ...root.querySelectorAll(selector)
    ];

    const el = els.find((b) => {
      const t = labelSelector
        ? b.querySelector(labelSelector)
        : b;

      return (
        t &&
        t.textContent.trim() === text
      );
    });

    if (el) {
      el.click();
      return true;
    }

    return false;
  }

  function setInputValue(
    input,
    value
  ) {
    if (!input) return false;

    const setter =
      Object.getOwnPropertyDescriptor(
        PW.HTMLInputElement.prototype,
        'value'
      ).set;

    setter.call(input, value);

    input.dispatchEvent(
      new Event('input', {
        bubbles: true
      })
    );

    return true;
  }

  function setSelectValue(
    root,
    selector,
    value
  ) {
    const sel =
      root.querySelector(selector);

    if (!sel) return false;

    const setter =
      Object.getOwnPropertyDescriptor(
        PW.HTMLSelectElement.prototype,
        'value'
      ).set;

    setter.call(sel, value);

    sel.dispatchEvent(
      new Event('change', {
        bubbles: true
      })
    );

    return true;
  }

  const stripLv = (name) =>
    String(name || '')
      .replace(
        /\s*Lv\.?\s*\d+\s*$/i,
        ''
      )
      .trim();

  const EYE_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  function findCardByHit(
    root,
    h
  ) {
    const cards = [
      ...root.querySelectorAll(
        '.mkt2-card'
      )
    ];

    const wantName =
      stripLv(h.name)
        .toLowerCase();

    return cards.find((card) => {
      const nameEl =
        card.querySelector(
          '.mkt2-card-name'
        );

      const name = nameEl
        ? nameEl.textContent
            .trim()
            .toLowerCase()
        : '';

      if (
        wantName &&
        !name.includes(wantName)
      ) {
        return false;
      }

      if (h.price != null) {
        const priceEl =
          card.querySelector(
            '.mkt2-price'
          );

        const digits = priceEl
          ? priceEl.textContent.replace(
              /[^\d]/g,
              ''
            )
          : '';

        if (
          digits &&
          Number(digits) !==
            Math.round(h.price)
        ) {
          return false;
        }
      }

      return true;
    });
  }

  function findSpeciesTile(
    root,
    name
  ) {
    const want = String(name || '')
      .trim()
      .toLowerCase();

    if (!want) return null;

    return [
      ...root.querySelectorAll(
        '.mkt2-sp-card'
      )
    ].find((btn) => {
      const nameEl =
        btn.querySelector(
          '.mkt2-sp-name'
        );

      return (
        nameEl &&
        nameEl.textContent
          .trim()
          .toLowerCase() ===
          want
      );
    });
  }

  const findAllSpeciesTile = (
    root
  ) =>
    root.querySelector(
      '.mkt2-sp-card.mkt2-sp-all'
    );

  async function tryNavigateToListing(
    h
  ) {
    await openMarket();

    const root = marketRoot();

    if (!root) return;

    clickByText(
      root,
      '.mkt2-tab',
      '.mkt2-tab-label',
      'Comprar'
    );

    await sleep(80);

    if (
      h.kind === 'pokemon' &&
      root.querySelector('.mkt2-card')
    ) {
      clickByText(
        root,
        '.mkt2-side-btn',
        '.mkt2-side-label',
        SIDE_LABEL.Items
      );

      await sleep(150);
    }

    const sideLabel =
      h.kind === 'pokemon'
        ? 'Pokémon'
        : SIDE_LABEL[h.category];

    if (sideLabel) {
      clickByText(
        root,
        '.mkt2-side-btn',
        '.mkt2-side-label',
        sideLabel
      );
    }

    await sleep(150);

    let usedSpeciesTile = false;

    if (h.kind === 'pokemon') {
      const species =
        stripLv(h.name);

      let tile = null;

      for (let i = 0; i < 20; i++) {
        if (
          root.querySelector(
            '.mkt2-card'
          )
        ) {
          break;
        }

        tile =
          findSpeciesTile(
            root,
            species
          );

        if (tile) break;

        await sleep(120);
      }

      if (tile) {
        tile.click();
        usedSpeciesTile = true;
      } else if (
        !root.querySelector(
          '.mkt2-card'
        )
      ) {
        const allTile =
          findAllSpeciesTile(root);

        if (allTile) {
          allTile.click();
        }
      }

      await sleep(250);
    }

    setSelectValue(
      root,
      '.mkt2-select:not(.mkt2-select--sm)',
      'recent'
    );

    if (!usedSpeciesTile) {
      const term =
        h.kind === 'pokemon'
          ? stripLv(h.name)
          : h.name || '';

      if (term) {
        setInputValue(
          root.querySelector(
            '.mkt2-search input'
          ),
          term
        );
      }
    }

    let card = null;

    for (
      let i = 0;
      i < 20 && !card;
      i++
    ) {
      await sleep(150);
      card = findCardByHit(
        root,
        h
      );
    }

    if (card) {
      card.scrollIntoView({
        block: 'center',
        behavior: 'instant'
      });

      card.click();
    } else {
      toast(
        'Cheguei na lista de ' +
          (h.name || sideLabel) +
          ' mas não achei o card exato — pode já ter sido vendido ou estar em outra página.'
      );
    }
  }

  function osNotify(
    title,
    body
  ) {
    if (!state.notifyOS) return;

    try {
      if (
        PW.Notification &&
        PW.Notification.permission ===
          'granted'
      ) {
        const n =
          new PW.Notification(
            title,
            { body }
          );

        n.onclick = () => {
          PW.focus();
          openMarket();
          n.close();
        };
      }
    } catch (e) {}
  }

  function notify(a, l) {
    const text = describe(l);

    const hit = {
      hid: ++hitSeq,
      t: Date.now(),
      alert: a.name,
      text,
      id: l.id || (Array.isArray(l.ids) && l.ids[0]) || null,
      kind: a.kind,
      category:
        a.kind === 'items'
          ? a.category
          : null,
      name: l.name,
      price: l.price,
      currency: l.currency,
      offerOnly: !!l.offerOnly,
      shiny: !!l.shiny,
      ivTotal: l.ivTotal,
      quality: l.quality,
      quantity: l.quantity,
      belowNpc: !!l.belowNpc,
      raw: l,
      buyable:
        !l.offerOnly &&
        !!(l.id || (Array.isArray(l.ids) && l.ids[0]))
    };

    hits.unshift(hit);

    if (hits.length > MAX_HITS) {
      hits.length = MAX_HITS;
    }

    if (!panelOpen) {
      unseen++;
    }

    const mythic = hit.kind === 'pokemon' && /^(m[ií]tic|mythic)/i.test(String(rarityOf(hit) || ''));

    beep(false, mythic ? MYTHIC_SOUND : null);

    osNotify(
      (mythic ? '✨ MÍTICO · ' : 'Poke Idle · ') + a.name,
      text
    );

    renderHits();
    renderBadge();

    log(
      'ACHADO',
      a.name,
      '→',
      text
    );
  }

  async function handleBuyClick(
    hid,
    btn,
    qtyIn
  ) {
    const h =
      hits.find(
        (x) => x.hid === hid
      ) ||
      mk.rows.find(
        (x) => x.hid === hid
      );

    if (!h) return;

    const priceTxt =
      h.offerOnly
        ? '(apenas oferta)'
        : fmt(h.price) +
          ' ' +
          curLabel(h.currency);

    let qty = 1;

    if (h.kind !== 'pokemon' && qtyIn != null) {
      const max = h.quantity || 1;

      qty = Math.floor(Number(qtyIn));

      if (!(qty >= 1 && qty <= max)) {
        toast('Quantidade inválida (máx ' + fmt(max) + ').');
        return;
      }

      if (
        !confirm(
          'Comprar ' +
            qty +
            '× ' +
            h.name +
            ' por ' +
            fmt(h.price * qty) +
            ' ' +
            curLabel(h.currency) +
            ' (' +
            priceTxt +
            '/un)?'
        )
      ) {
        return;
      }
    } else if (h.kind !== 'pokemon') {
      const max = h.quantity || 1;

      const v = prompt(
        'Quantidade de ' +
          h.name +
          ' (máx ' +
          max +
          ') · ' +
          priceTxt +
          '/un',
        '1'
      );

      if (v == null) return;

      qty = Math.floor(Number(v));

      if (!(qty >= 1 && qty <= max)) {
        toast('Quantidade inválida.');
        return;
      }
    } else if (
      !confirm(
        'Comprar ' +
          h.name +
          ' por ' +
          priceTxt +
          '?'
      )
    ) {
      return;
    }

    btn.disabled = true;

    const original =
      btn.textContent;

    btn.textContent =
      'Comprando…';

    try {
      const res =
        await buyListing(
          h.id,
          qty
        );

      toast(
        'Comprado: ' +
          (res.name || h.name) +
          (res.total != null
            ? ' · saldo: ' +
              fmt(res.total) +
              ' ' +
              curLabel(res.currency)
            : '')
      );

      const idx =
        hits.findIndex(
          (x) => x.hid === hid
        );

      if (idx >= 0) {
        hits.splice(idx, 1);
      }

      const mi =
        mk.rows.findIndex(
          (x) => x.hid === hid
        );

      if (mi >= 0) {
        mk.rows.splice(mi, 1);
        mkRender();
      }

      rememberListings([h.raw]);

      state.purchased.unshift({
        ...h,
        purchasedAt: Date.now()
      });

      if (
        state.purchased.length >
        MAX_PURCHASED
      ) {
        state.purchased.length =
          MAX_PURCHASED;
      }

      save();
      renderHits();

      if (
        activeTab ===
        'purchased'
      ) {
        renderPurchased();
      }
    } catch (e) {
      toast(
        'Erro ao comprar: ' +
          ((e && e.message) || e)
      );

      btn.disabled = false;
      btn.textContent =
        original;
    }
  }

  /* ---------- detalhes ---------- */
  const RARITY_COLOR = {
    comum: '#9aa0b8',
    incomum: '#5fc76d',
    raro: '#4fa3f7',
    épico: '#b06df0',
    epico: '#b06df0',
    lendária: '#f0a63a',
    lendaria: '#f0a63a',
    mítico: '#ff5f6d',
    mitico: '#ff5f6d',
    mítica: '#ff5f6d',
    mitica: '#ff5f6d'
  };

  const TYPE_COLOR = {
    fogo: '#f08030',
    fire: '#f08030',
    água: '#6890f0',
    agua: '#6890f0',
    water: '#6890f0',
    elétrico: '#f8d030',
    eletrico: '#f8d030',
    electric: '#f8d030',
    planta: '#78c850',
    grass: '#78c850',
    gelo: '#98d8d8',
    ice: '#98d8d8',
    lutador: '#c03028',
    fighting: '#c03028',
    venenoso: '#a040a0',
    poison: '#a040a0',
    terra: '#e0c068',
    ground: '#e0c068',
    voador: '#a890f0',
    flying: '#a890f0',
    psíquico: '#f85888',
    psiquico: '#f85888',
    psychic: '#f85888',
    inseto: '#a8b820',
    bug: '#a8b820',
    pedra: '#b8a038',
    rock: '#b8a038',
    fantasma: '#705898',
    ghost: '#705898',
    dragão: '#7038f8',
    dragao: '#7038f8',
    dragon: '#7038f8',
    sombrio: '#705848',
    dark: '#705848',
    metálico: '#b8b8d0',
    metalico: '#b8b8d0',
    steel: '#b8b8d0',
    fada: '#ee99ac',
    fairy: '#ee99ac',
    normal: '#a8a878'
  };

  const cap = (s) =>
    String(s)
      .charAt(0)
      .toUpperCase() +
    String(s)
      .slice(1)
      .toLowerCase();

  const pick = (
    obj,
    keys
  ) => {
    for (const k of keys) {
      if (
        obj &&
        obj[k] != null &&
        obj[k] !== ''
      ) {
        return obj[k];
      }
    }

    return null;
  };

  const QUALITY_TIERS = [
    [1.85, 'Mítica'],
    [1.60, 'Lendária'],
    [1.40, 'Épico'],
    [1.20, 'Raro'],
    [1.00, 'Incomum'],
    [0, 'Comum']
  ];

  const qualityTier = (q) => {
    if (q == null) return null;

    for (
      const [min, label]
      of QUALITY_TIERS
    ) {
      if (q >= min) {
        return label;
      }
    }

    return null;
  };

  function gmGetJson(url) {
    return new Promise(
      (resolve, reject) => {
        if (
          typeof GM_xmlhttpRequest ===
          'function'
        ) {
          GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload: (res) => {
              try {
                resolve(
                  JSON.parse(
                    res.responseText
                  )
                );
              } catch (e) {
                reject(e);
              }
            },
            onerror: reject
          });
        } else {
          PW.fetch(url)
            .then((r) => r.json())
            .then(resolve)
            .catch(reject);
        }
      }
    );
  }

  const spriteCache =
    new Map();

  function fetchSprite(name) {
    const key =
      String(name || '')
        .trim()
        .toLowerCase();

    if (!key) {
      return Promise.resolve(null);
    }

    if (
      spriteCache.has(key)
    ) {
      return Promise.resolve(
        spriteCache.get(key)
      );
    }

    return gmGetJson(
      'https://pokeapi.co/api/v2/pokemon/' +
        encodeURIComponent(key)
    )
      .then((data) => {
        const url =
          data &&
          data.sprites &&
          (
            (
              data.sprites.other &&
              data.sprites.other[
                'official-artwork'
              ] &&
              data.sprites.other[
                'official-artwork'
              ].front_default
            ) ||
            data.sprites.front_default
          );

        spriteCache.set(
          key,
          url || null
        );

        return url || null;
      })
      .catch(() => {
        spriteCache.set(
          key,
          null
        );

        return null;
      });
  }

  function itemImage(h) {
    const r = h.raw || {};

    const v = pick(r, [
      'image',
      'sprite',
      'icon',
      'img',
      'imageUrl',
      'imageURL',
      'spriteUrl',
      'thumbnail',
      'avatar'
    ]);

    if (h.kind === 'pokemon') return v;

    if (v) {
      return /^(\/|https?:|data:)/i.test(String(v))
        ? v
        : '/assets/items/' + v;
    }

    if (!h.name) return v;

    return (
      '/assets/items/' +
      String(h.name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') +
      '.gif'
    );
  }

  function thumbHtml(h) {
    if (
      h.kind === 'pokemon'
    ) {
      const key =
        stripLv(h.name)
          .trim()
          .toLowerCase();

      if (
        !spriteCache.has(key)
      ) {
        return '⏳';
      }

      const url =
        spriteCache.get(key);

      return url
        ? `<img src="${esc(url)}">`
        : '❔';
    }

    const img =
      itemImage(h);

    return img
      ? `<img src="${esc(img)}" onerror="this.parentElement.textContent='❔'">`
      : '❔';
  }

  function ensureSprite(h) {
    if (
      h.kind !== 'pokemon'
    ) {
      return;
    }

    const key =
      stripLv(h.name)
        .trim()
        .toLowerCase();

    if (
      spriteCache.has(key)
    ) {
      return;
    }

    fetchSprite(
      stripLv(h.name)
    ).then((url) => {
      document
        .querySelectorAll(
          '.mtal-hit-thumb[data-hid="' +
            h.hid +
            '"]'
        )
        .forEach((el) => {
          el.innerHTML = url
            ? `<img src="${esc(url)}">`
            : '❔';
        });
    });
  }

  const statBlock = (
    label,
    val
  ) =>
    val == null
      ? ''
      : `
    <div class="mtal-d-stat">
      <span>${esc(label)}</span>
      <b>${esc(val)}</b>
    </div>`;

  /* ---------- card rico do Pokémon (Achados) ---------- */
  const RP_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'vel'];
  const RP_EXP = { hp: 0.95, atk: 0.8, def: 0.8, spa: 0.8, spd: 0.8, vel: 0.95 };
  const RP_LABEL = { hp: 'HP', atk: 'ATK', def: 'DEF', spa: 'SPA', spd: 'SPD', vel: 'VEL' };
  const RP_COLOR = { hp: '#4caf50', atk: '#ff9800', def: '#ffd54a', spa: '#2196f3', spd: '#26c6da', vel: '#ec5f9a' };
  const RP_STAT_KEYS = {
    hp: ['hp'],
    atk: ['atk', 'attack'],
    def: ['def', 'defense'],
    spa: ['spAtk', 'specialAttack', 'sp_atk'],
    spd: ['spDef', 'specialDefense', 'sp_def'],
    vel: ['speed', 'vel', 'spe']
  };
  const RP_BASE_KEYS = { hp: 'baseHp', atk: 'baseAtk', def: 'baseDef', spa: 'baseSpAtk', spd: 'baseSpDef', vel: 'baseSpeed' };
  const RP_TYPE_PT = {
    normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico', grass: 'Planta', ice: 'Gelo',
    fighting: 'Lutador', poison: 'Veneno', ground: 'Terra', flying: 'Voador', psychic: 'Psíquico', bug: 'Inseto',
    rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio', steel: 'Aço', fairy: 'Fada'
  };
  const RP_CLASS = [
    [95, 'Excepcional', '#61f6a4', 'Um exemplar extremamente próximo do potencial máximo.'],
    [85, 'Excelente', '#54e7d2', 'Ótimos atributos e excelente eficiência geral.'],
    [72, 'Muito bom', '#5ed7b9', 'Um Pokémon forte e acima da média.'],
    [58, 'Bom', '#69b7ff', 'Bom equilíbrio de atributos para uso geral.'],
    [42, 'Mediano', '#f1c644', 'Possui atributos equilibrados, mas pode melhorar.'],
    [25, 'Abaixo da média', '#f39a4b', 'Alguns atributos importantes estão abaixo do ideal.'],
    [0, 'Fraco', '#f05a62', 'Baixo potencial geral em comparação ao máximo possível.']
  ];

  let rpCre = null;
  let rpCreP = null;

  function rpLoadCreatures() {
    if (rpCre) return Promise.resolve(rpCre);

    if (!rpCreP) {
      rpCreP = PW.fetch('/game/creatures.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const arr = (d && (d.creatures || (Array.isArray(d) ? d : null))) || [];
          const byId = new Map();
          const byName = new Map();

          arr.forEach((c) => {
            if (!c) return;
            if (c.pokeId != null) byId.set(+c.pokeId, c);
            if (c.name) byName.set(String(c.name).toLowerCase().trim(), c);
          });

          rpCre = { byId, byName };

          return rpCre;
        })
        .catch(() => {
          rpCreP = null;

          return null;
        });
    }

    return rpCreP;
  }

  function rpCreature(h) {
    const r = h.raw || {};
    const sid = +r.speciesId;
    let c = rpCre ? (sid && rpCre.byId.get(sid)) || rpCre.byName.get(stripLv(h.name).toLowerCase()) : null;

    if (!c && sid) {
      try {
        c = slDexMap().get(sid) || null;
      } catch (e) {
        c = null;
      }
    }

    return c || null;
  }

  function rpMoves(c) {
    if (!c) return [];

    const arr = [c.moves, c.attacks, c.skills, c.spells].find((a) => Array.isArray(a) && a.length) || [];

    return arr
      .map((s) => {
        if (typeof s === 'string') return { name: s };
        if (!s || typeof s !== 'object') return null;

        const name = s.name || s.moveName || s.move || s.id;

        return name
          ? {
              name: String(name),
              power: pick(s, ['power', 'basePower', 'damage', 'dmg']),
              type: pick(s, ['type', 'element']),
              lvl: pick(s, ['learnLevel', 'level', 'lvl'])
            }
          : null;
      })
      .filter(Boolean);
  }

  function rpSprite(h, c) {
    const r = h.raw || {};
    let id = +(c && c.captureBase) || +r.speciesId || +(c && c.pokeId) || 0;

    if (id >= 13000 && id < 14000) id -= 13000;
    if (!id || id > 1025) return null;

    const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
    const sh = h.shiny ? 'shiny/' : '';

    return {
      anim: base + '/versions/generation-v/black-white/animated/' + sh + id + '.gif',
      still: base + '/' + sh + id + '.png'
    };
  }

  const rpTextOn = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);

    return l > 140 ? '#15171f' : '#fff';
  };

  const rpTypeBadge = (t, pt) => {
    const k = String(t).toLowerCase();
    const bg = TYPE_COLOR[k] || '#6b7089';

    return `<span class="rp-type" style="background:${bg};color:${rpTextOn(bg)}">${esc(pt ? RP_TYPE_PT[k] || cap(k) : k)}</span>`;
  };

  function rpInit(h) {
    const r = h.raw || {};
    const stats = r.stats || r;
    const growth = r.growth || r.ivs || null;
    const c = rpCreature(h);
    const cur = {};
    const base = {};
    const g = {};

    RP_KEYS.forEach((k) => {
      const cv = pick(stats, RP_STAT_KEYS[k]);
      const bv = c ? c[RP_BASE_KEYS[k]] : null;
      const gv = growth && typeof growth === 'object' ? pick(growth, RP_STAT_KEYS[k]) : null;

      cur[k] = cv != null ? Number(cv) : null;
      base[k] = bv != null ? Number(bv) : null;
      g[k] = gv != null ? Number(gv) : null;
    });

    const lvl = Number(levelOf({ ...r, name: h.name })) || 1;

    return {
      c,
      cur,
      base,
      growth: RP_KEYS.every((k) => Number.isFinite(g[k])) ? g : null,
      edited: false,
      level: lvl,
      lvl0: lvl,
      q: Number(h.quality) || 1,
      ivObs: h.ivTotal != null ? Number(h.ivTotal) : null
    };
  }

  function rpCompute(v) {
    const est = !(v.growth && !v.edited);
    const ivs = {};
    let sum = 0;
    let ok = true;

    RP_KEYS.forEach((k) => {
      let iv = null;

      if (!est) {
        iv = v.growth[k];
      } else if ([v.cur[k], v.base[k], v.level, v.q].every(Number.isFinite) && v.level > 0 && v.q > 0) {
        const f = (v.level / 100) * Math.pow(v.q, RP_EXP[k]);

        iv = Math.min(32, Math.max(0, (v.cur[k] / f - v.base[k]) / 2));
      } else {
        ok = false;
      }

      ivs[k] = iv;
      sum += iv || 0;
    });

    const useObs = Number.isFinite(v.ivObs) && v.ivObs > 0 && v.level === v.lvl0;
    const ivTotal = useObs ? v.ivObs : ok ? Math.ceil(sum) : null;
    const pct = useObs ? (v.ivObs / 192) * 100 : ok ? (sum / 192) * 100 : null;
    let power = null;

    if (ok && Number.isFinite(v.level) && Number.isFinite(v.q) && RP_KEYS.every((k) => Number.isFinite(v.base[k]))) {
      power =
        RP_KEYS.reduce(
          (t, k) =>
            t + Math.round((v.base[k] + 2 * (Math.round(ivs[k] * 10) / 10)) * (v.level / 100) * Math.pow(v.q, RP_EXP[k])),
          0
        ) * v.q;
    }

    return { ivs, ivTotal, pct, power, est, ok, cls: pct != null ? RP_CLASS.find((x) => pct >= x[0]) : null };
  }

  function rpHtml(h, v) {
    const r = h.raw || {};
    const c = v.c;
    let types = typesOf(r);

    if (!types.length && c) types = [c.type1, c.type2].filter(Boolean);

    const sp = rpSprite(h, c);
    const who = pick(r, ['sellerName', 'ownerName', 'seller', 'owner', 'familyName']);
    const rar = rarityOf(h);
    const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';
    const moves = rpMoves(c);
    const num = (x) => (x == null || !Number.isFinite(x) ? '' : String(x));

    return `
      <div class="rp" data-rp-root>
        <div class="rp-top">
          <div class="rp-sprite mtal-hit-thumb" data-hid="${h.hid}">${
            sp
              ? `<img src="${esc(sp.anim)}" data-fb="${esc(sp.still)}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.parentElement.textContent='❔'}">`
              : thumbHtml(h)
          }</div>

          <div class="rp-id">
            <div class="rp-name">${esc(stripLv(h.name))}${h.shiny ? ' ✨' : ''}${
              typeof who === 'string' ? `<small>${esc(who)}</small>` : ''
            }</div>
            <div class="rp-types">${types.map((t) => rpTypeBadge(t, true)).join('')}</div>
          </div>
        </div>

        <div class="rp-boxes">
          <div class="rp-box"><span>Nível</span><b>${esc(num(v.level) || '-')}</b></div>
          <div class="rp-box"><span>Qualidade</span><b style="color:${rc}">${esc(Number.isFinite(v.q) ? v.q.toFixed(2) : '-')}</b></div>
          <div class="rp-box"><span>IV total</span><b class="rp-ivt" data-rp="ivt"></b></div>
          <div class="rp-box"><span>Poder est.</span><b class="rp-pow" data-rp="pow"></b></div>
        </div>

        <div class="rp-grade">
          <div class="rp-ring" data-rp="ring"><b data-rp="pct"></b></div>
          <div><strong data-rp="cls"></strong><p data-rp="desc"></p></div>
        </div>

        <div class="rp-sec rp-static">
          <span>Atributos e IV por stat</span>
          <span class="rp-dim">(<span data-rp="pct2"></span>${
            rar ? ` · <span style="color:${rc}">${esc(rar)}${h.quality != null ? ' ×' + Number(h.quality).toFixed(2) : ''}</span>` : ''
          })</span>
        </div>

        <div class="rp-stats">
          ${RP_KEYS.map(
            (k) => `<div class="rp-stat" style="--c:${RP_COLOR[k]}">
            <div class="rp-stat-h"><b>${RP_LABEL[k]}</b><span><em data-rp="iv-${k}"></em>/32</span></div>
            <div class="rp-bar"><i data-rp="bar-${k}"></i></div>
          </div>`
          ).join('')}
        </div>

        <div class="rp-warn" data-rp="warn"></div>

        <div class="rp-sec${store.get('rpMovesOpen', false) ? ' open' : ''}" data-rp-toggle="moves">
          <span>⚔ Golpes</span> <span class="rp-dim">(${moves.filter((m) => !(m.lvl != null && Number.isFinite(v.level) && +m.lvl > v.level)).length}/${moves.length} liberados)</span>
          <i>▾</i>
        </div>

        <div class="rp-moves${store.get('rpMovesOpen', false) ? ' open' : ''}">
          ${
            moves
              .map(
                (m) => `<div class="rp-move${m.lvl != null && Number.isFinite(v.level) && +m.lvl > v.level ? ' locked' : ''}"${
                  m.lvl != null && Number.isFinite(v.level) && +m.lvl > v.level ? ` title="Libera no Nv ${esc(m.lvl)}"` : ''
                }>
            ${m.type ? rpTypeBadge(m.type, false) : ''}
            <b>${esc(m.name)}</b>
            ${m.lvl != null ? `<small>${Number.isFinite(v.level) && +m.lvl > v.level ? '🔒 ' : ''}Nv ${esc(m.lvl)}</small>` : ''}
            ${m.power != null ? `<em>${esc(m.power)}</em>` : ''}
          </div>`
              )
              .join('') || `<div class="rp-dim">${rpCre ? 'Sem golpes cadastrados.' : 'Carregando…'}</div>`
          }
        </div>
      </div>
    `;
  }

  function rpApply(root, v) {
    const R = rpCompute(v);
    const q = (k) => root.querySelector('[data-rp="' + k + '"]');
    const cls = R.cls || [0, '-', '#6b7089', ''];

    q('ivt').innerHTML = R.ivTotal != null ? esc(R.ivTotal) + '<small>/192</small>' : '-';
    q('pow').textContent = R.power != null ? fmt(Math.round(R.power)) : '-';

    const ring = q('ring');

    ring.style.setProperty('--c', cls[2]);
    ring.style.setProperty('--d', (R.pct != null ? Math.min(100, R.pct) * 3.6 : 0) + 'deg');

    q('pct').textContent = R.pct != null ? Math.round(R.pct) + '%' : '-';
    q('cls').textContent = cls[1];
    q('cls').style.color = cls[2];
    q('desc').textContent = cls[3];
    q('pct2').textContent = R.pct != null ? R.pct.toFixed(1) + '%' : '-';

    RP_KEYS.forEach((k) => {
      const iv = R.ivs[k];

      q('iv-' + k).textContent = iv == null ? '-' : Number.isInteger(iv) ? String(iv) : iv.toFixed(1);
      q('bar-' + k).style.width = (iv == null ? 0 : Math.min(100, (iv / 32) * 100)) + '%';
    });

    q('warn').textContent = !R.est
      ? ''
      : !R.ok
        ? 'Faltam valores base/atuais para estimar os IVs por stat.'
        : v.level < 15
          ? 'Nv abaixo de 15: os IVs por stat são estimativas imprecisas.'
          : '';
  }

  function rpBind(root, v) {
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-rp-toggle]');

      if (!t) return;

      const key = t.dataset.rpToggle;
      const box = root.querySelector('.rp-moves');
      const open = !box.classList.contains('open');

      box.classList.toggle('open', open);
      root.querySelectorAll('.rp-sec[data-rp-toggle="' + key + '"]').forEach((x) => x.classList.toggle('open', open));
      store.set('rpMovesOpen', open);
      positionDetails();
    });
  }

  function renderDetails(h) {
    detailsHid = h.hid;

    const rich = h.kind === 'pokemon' && (hits.includes(h) || state.purchased.includes(h) || mk.rows.includes(h));
    const rv = rich ? rpInit(h) : null;

    $('mtal-details').classList.toggle('mtal-rich', rich);

    const r = h.raw || {};
    const stats =
      r.stats || r;

    const level = pick(
      r,
      [
        'level',
        'lvl',
        'nivel'
      ]
    );

    const rarity =
      pick(r, [
        'rarity',
        'raridade',
        'tier',
        'rarityName',
        'rarityTier',
        'grade',
        'rank'
      ]) ||
      qualityTier(
        h.quality
      );

    const power = pick(
      r,
      [
        'power',
        'poder',
        'pwr',
        'battlePower',
        'cp'
      ]
    );

    let types =
      r.types ||
      r.tipos ||
      r.elementTypes ||
      r.elements ||
      [
        pick(r, [
          'type1',
          'tipo1'
        ]),
        pick(r, [
          'type2',
          'tipo2'
        ])
      ].filter(Boolean) ||
      (r.type
        ? [r.type]
        : []);

    if (
      Array.isArray(types)
    ) {
      types = types
        .map((t) =>
          t &&
          typeof t === 'object'
            ? (
                t.name ||
                t.label ||
                t.type
              )
            : t
        )
        .filter(Boolean);
    }

    const img = itemImage(h);

    const hp = pick(
      stats,
      ['hp']
    );

    const atk = pick(
      stats,
      [
        'atk',
        'attack',
        'ataque'
      ]
    );

    const def = pick(
      stats,
      [
        'def',
        'defense',
        'defesa'
      ]
    );

    const spAtk = pick(
      stats,
      [
        'spAtk',
        'spAtaque',
        'atqEsp',
        'sp_atk',
        'specialAttack'
      ]
    );

    const spDef = pick(
      stats,
      [
        'spDef',
        'spDefesa',
        'defEsp',
        'sp_def',
        'specialDefense'
      ]
    );

    const spd = pick(
      stats,
      [
        'speed',
        'spd',
        'velocidade',
        'veloc'
      ]
    );

    const hasStats = [
      hp,
      atk,
      def,
      spAtk,
      spDef,
      spd
    ].some(
      (v) => v != null
    );

    const rColor =
      rarity
        ? (
            RARITY_COLOR[
              String(
                rarity
              ).toLowerCase()
            ] ||
            '#e0b95a'
          )
        : null;

    const isPurchased =
      !!h.purchasedAt;

    const priceTxt =
      h.offerOnly
        ? 'Apenas ofertas'
        : fmt(h.price) +
          ' ' +
          curLabel(
            h.currency
          );

    const rawTxt = (() => {
      try {
        return JSON.stringify(
          h.raw,
          null,
          2
        );
      } catch (e) {
        return String(
          h.raw
        );
      }
    })();

    const pokeBlock =
      h.kind === 'pokemon'
        ? `
      ${
        level != null
          ? `<div class="mtal-d-row"><span>⚡ Nível</span><span>${esc(level)}</span></div>`
          : ''
      }

      ${
        h.ivTotal != null
          ? `<div class="mtal-d-row"><span>IV</span><span>${esc(h.ivTotal)}/192</span></div>`
          : ''
      }

      ${
        rarity != null
          ? `<div class="mtal-d-row"><span>Raridade</span><span style="color:${rColor}">${esc(rarity)}${
              h.quality != null
                ? ' ×' +
                  Number(
                    h.quality
                  ).toFixed(2)
                : ''
            }</span></div>`
          : ''
      }

      ${
        power != null
          ? `<div class="mtal-d-row"><span>Poder</span><span>⚡ ${esc(power)}</span></div>`
          : ''
      }

      ${
        types.length
          ? `<div class="mtal-d-row"><span>Tipos</span><span>${types
              .map(
                (t) =>
                  `<span style="color:${
                    TYPE_COLOR[
                      String(
                        t
                      ).toLowerCase()
                    ] ||
                    '#c7cbe0'
                  }">${esc(
                    cap(t)
                  )}</span>`
              )
              .join(' e ')}</span></div>`
          : ''
      }

      ${
        hasStats
          ? `
        <div class="mtal-d-sec">Atributos</div>
        <div class="mtal-d-stats">
          ${statBlock(
            'HP',
            hp
          )}
          ${statBlock(
            'Atq',
            atk
          )}
          ${statBlock(
            'Def',
            def
          )}
          ${statBlock(
            'Atq. Esp',
            spAtk
          )}
          ${statBlock(
            'Def. Esp',
            spDef
          )}
          ${statBlock(
            'Veloc.',
            spd
          )}
        </div>`
          : ''
      }
    `
        : `
      ${
        h.category
          ? `<div class="mtal-d-row"><span>Categoria</span><span>${esc(
              catLabel(
                h.category
              )
            )}</span></div>`
          : ''
      }

      ${
        h.quantity != null
          ? `<div class="mtal-d-row"><span>${h.inventory ? 'Você tem' : 'Quantidade'}</span><span>${esc(
              fmt(h.quantity)
            )}</span></div>`
          : ''
      }

      ${
        h.inventory || h.at || h.npcAction
          ? ''
          : `<div class="mtal-d-row">
        <span>Abaixo do NPC</span>
        <span>${
          h.belowNpc
            ? 'Sim'
            : 'Não'
        }</span>
      </div>`
      }
    `;

    $('mtal-d-body').innerHTML = `
      ${
        rich
          ? rpHtml(h, rv)
          : `      <div id="mtal-d-img">
        ${
          img
            ? `<img src="${esc(img)}" onerror="this.parentElement.textContent='❔'">`
            : '❔'
        }
      </div>

      <div id="mtal-d-name">
        ${esc(h.name || '-')}
      </div>

      <div class="mtal-d-badges">
        <span class="mtal-badge">
          ${esc(
            h.kind === 'pokemon'
              ? 'Pokémon'
              : (
                  catLabel(
                    h.category
                  ) ||
                  'Item'
                )
          )}
        </span>

        ${
          h.shiny
            ? '<span class="mtal-badge" style="color:#f0d78c">✨ Shiny</span>'
            : ''
        }
      </div>

      ${pokeBlock}
`
      }

      ${
        h.at
          ? `<div class="mtal-d-row"><span>Data</span><span>${esc(new Date(h.at).toLocaleString('pt-BR'))}</span></div>`
          : ''
      }

      ${
        h.inventory
          ? `<div id="mtal-d-price" class="mtal-d-sell">
        ${
          h.kind === 'pokemon'
            ? ''
            : `<span>Quantidade</span>

        <div class="mtal-d-sellrow">
          <input type="text" id="mtal-d-sqty" value="1" inputmode="numeric">
          <button type="button" id="mtal-d-smax">máx</button>
        </div>`
        }

        <span>${h.kind === 'pokemon' ? 'Anunciar por' : 'Preço por unidade'}</span>

        <div class="mtal-d-sellrow">
          <input type="text" id="mtal-d-sprice" placeholder="0" inputmode="numeric">

          <select id="mtal-d-scur">
            <option value="GOLD">$ Dólares</option>
            <option value="DIAMONDS">💎 Diamantes</option>
          </select>
        </div>

        <button type="button" id="mtal-d-sgo">$ Anunciar</button>

        ${
          h.price
            ? `<div class="mtal-d-npc">Valor no NPC: $ ${esc(fmt(h.price))}</div>`
            : ''
        }
      </div>`
          : `<div id="mtal-d-price">
        <span>${
          isPurchased
            ? h.sold
              ? 'Vendido por'
              : 'Comprado por'
            : h.priceLabel || 'Preço unitário'
        }</span>

        <b>
          ${currencyIcon(
            h.currency
          )}
          ${esc(priceTxt)}
        </b>
      </div>`
      }

      ${
        h.npcAction
          ? `<div class="mtal-d-qty">
        ${
          h.npcAction.needQty
            ? `<span>Quantidade</span>

        <div class="mtal-d-sellrow">
          <input type="text" id="mtal-d-nqty" value="1" inputmode="numeric">
          ${h.npcAction.max ? '<button type="button" id="mtal-d-nmax">máx</button>' : ''}
        </div>

        <div class="mtal-d-npc" id="mtal-d-ntotal" style="text-align:left;color:#f0d78c;font-weight:600;margin-top:0"></div>`
            : ''
        }
        ${h.npcAction.note ? `<div class="mtal-d-npc">${esc(h.npcAction.note)}</div>` : ''}
      </div>

      <div id="mtal-d-actions">
        <button type="button" id="mtal-d-npcgo">${esc(h.npcAction.label)}</button>
      </div>`
          : ''
      }

      ${
        isPurchased || h.inventory || !h.buyable
          ? ''
          : `${
              h.kind === 'pokemon'
                ? ''
                : `<div class="mtal-d-qty">
        <span>Quantidade</span>

        <div class="mtal-d-sellrow">
          <input type="text" id="mtal-d-bqty" value="1" inputmode="numeric">
          <button type="button" id="mtal-d-bmax">máx</button>
        </div>

        <div class="mtal-d-npc" id="mtal-d-btotal"></div>
      </div>`
            }

      <div id="mtal-d-actions">
        <button type="button" id="mtal-d-buy">${h.currency === 'DIAMONDS' ? '💎' : '$'} Comprar Agora</button>
      </div>`
      }
    `;

    if (rich) {
      const root = $('mtal-d-body').querySelector('[data-rp-root]');

      rpBind(root, rv);
      rpApply(root, rv);

      if (!root.querySelector('.rp-sprite img')) ensureSprite(h);

      if (!rpCre) {
        rpLoadCreatures().then((ok) => {
          if (ok && detailsHid === h.hid && $('mtal-details').style.display === 'block') {
            renderDetails(h);
            positionDetails();
          }
        });
      }
    }

    if (
      !isPurchased &&
      h.buyable
    ) {
      const bq = $('mtal-d-bqty');

      if (bq) {
        const total = () => {
          const q = Math.floor(Number(String(bq.value).replace(/[.\s]/g, '')) || 0);

          $('mtal-d-btotal').textContent =
            q > 0 && !h.offerOnly
              ? 'Total: ' + [currencyIcon(h.currency), fmt(h.price * q), curLabel(h.currency)].filter(Boolean).join(' ')
              : '';
        };

        total();

        bq.addEventListener('input', total);

        $('mtal-d-bmax').addEventListener('click', () => {
          bq.value = h.quantity || 1;
          total();
        });
      }

      $('mtal-d-buy').addEventListener(
        'click',
        () =>
          handleBuyClick(
            h.hid,
            $('mtal-d-buy'),
            bq ? String(bq.value).replace(/[.\s]/g, '') : null
          )
      );
    }

    if (h.npcAction) {
      const A = h.npcAction;
      const q = $('mtal-d-nqty');
      const btn = $('mtal-d-npcgo');
      const qv = () => (q ? Math.floor(Number(String(q.value).replace(/[.\s]/g, '')) || 0) : 1);

      const total = () => {
        if (q && A.unit != null) {
          $('mtal-d-ntotal').textContent = qv() > 0 ? 'Total: $ ' + fmt(qv() * A.unit) : '';
        }
      };

      total();

      if (q) q.addEventListener('input', total);

      if ($('mtal-d-nmax')) {
        $('mtal-d-nmax').addEventListener('click', () => {
          q.value = A.max;
          total();
        });
      }

      btn.addEventListener('click', async () => {
        const n = qv();

        if (A.needQty && !(n >= 1 && (!A.max || n <= A.max))) return toast('Quantidade inválida.');
        if (A.confirm && !confirm(A.confirm(n))) return;

        btn.disabled = true;

        try {
          await A.run(n);
        } catch (e) {
          toast('Erro: ' + ((e && e.message) || e));
        }

        btn.disabled = false;
      });

      if (q) setTimeout(() => q.focus(), 0);
    }

    if (h.inventory) {
      const sp = $('mtal-d-sprice');
      const sc = $('mtal-d-scur');
      const btn = $('mtal-d-sgo');

      sc.value = sl.lastCur;

      const go = () =>
        slSell(
          h.invRef,
          h.kind === 'pokemon' ? 'pokemon' : 'item',
          mkNum('mtal-d-sprice', true),
          sc.value,
          h.kind === 'pokemon' ? 1 : Math.floor(mkNum('mtal-d-sqty', true) || 0),
          btn
        );

      const btnLabel = () => {
        btn.textContent = (sc.value === 'DIAMONDS' ? '💎' : '$') + ' Anunciar';
      };

      btnLabel();

      btn.addEventListener('click', go);
      sc.addEventListener('change', () => {
        sl.lastCur = sc.value;
        btnLabel();
      });
      sp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });

      if ($('mtal-d-smax')) {
        $('mtal-d-smax').addEventListener('click', () => ($('mtal-d-sqty').value = h.invRef.owned));
      }

      setTimeout(() => sp.focus(), 0);
    }


    if (
      !rich &&
      !img &&
      h.kind === 'pokemon'
    ) {
      const forHid =
        h.hid;

      fetchSprite(
        stripLv(h.name)
      ).then((url) => {
        if (
          !url ||
          detailsHid !== forHid
        ) {
          return;
        }

        const box =
          $('mtal-d-img');

        if (box) {
          box.innerHTML =
            `<img src="${esc(url)}" onerror="this.parentElement.textContent='❔'">`;
        }
      });
    }
  }

  function positionDetails() {
    const d = $('mtal-details');
    const p = $(detailsAnchor);

    if (!d || !p || d.style.display !== 'block' || getComputedStyle(p).display === 'none') return;

    const r = p.getBoundingClientRect();
    let left = r.right + 10;

    if (left + d.offsetWidth > window.innerWidth) {
      left = Math.max(0, r.right - d.offsetWidth - 10);
    }

    d.style.left = left + 'px';
    d.style.bottom = 'auto';
    d.style.top = Math.max(0, Math.min(r.top, window.innerHeight - d.offsetHeight)) + 'px';
  }

  function showDetails(h, anchor) {
    detailsAnchor = anchor || 'mtal-panel';

    renderDetails(h);

    $('mtal-details')
      .style.display =
      'block';

    positionDetails();

    renderHits();
    renderPurchased();
  }

  function hideDetails() {
    $('mtal-details')
      .style.display =
      'none';

    detailsHid = null;

    renderHits();
    renderPurchased();
  }

  /* ---------- polling ---------- */
  async function poll(a) {
    const rt = rtOf(a.id);

    const base =
      a.kind === 'pokemon'
        ? POLL_POKEMON_MS
        : POLL_ITEMS_MS;

    const data = await api(
      queryOf(a),
      base * 0.6
    );

    const list =
      (data &&
        data.listings) ||
      [];

    const entries = [];

    for (const l of list) {
      if (l.currency) {
        knownCurrencies.add(
          l.currency
        );
      }

      const own =
        a.kind !== 'pokemon' &&
        Array.isArray(l.ids) &&
        l.ids.length
          ? l.ids
          : [l.id];

      for (
        const id of own
      ) {
        entries.push({
          id,
          l
        });
      }
    }

    if (!rt.seen) {
      rt.seen =
        new Set(
          entries.map(
            (e) => e.id
          )
        );

      rt.err = '';
      rt.last = Date.now();

      return;
    }

    const notified =
      new Set();

    let fresh = 0;

    for (
      const { id, l }
      of entries
    ) {
      if (
        rt.seen.has(id)
      ) {
        continue;
      }

      rt.seen.add(id);
      fresh++;

      if (
        notified.has(l)
      ) {
        continue;
      }

      if (
        matches(a, l)
      ) {
        notified.add(l);
        notify(a, l);
      }
    }

    if (
      rt.seen.size >
      entries.length * 5 +
        1000
    ) {
      rt.seen =
        new Set(
          entries.map(
            (e) => e.id
          )
        );
    }

    const overflow =
      a.kind === 'pokemon' &&
      list.length > 0 &&
      fresh >= list.length;

    rt.err = overflow
      ? 'muitos anúncios novos entre consultas: refine o filtro'
      : '';

    rt.last =
      Date.now();
  }

  function readOwnedFromMarket() {
    const win = document.querySelector('.mkt2-window');

    if (!win) return;

    let f = fiberOfEl(win);

    for (let i = 0; f && i < 40; i++, f = f.return) {
      if (typeof f.type === 'string') continue;

      for (const h of hookNodes(f)) {
        const v = h.queue ? h.queue.lastRenderedState : h.memoizedState;

        if (isOwnedArr(v)) {
          setOwned(v);
          return;
        }
      }
    }
  }

  async function tick() {
    try {
      readOwnedFromMarket();

      if (marketOpen()) {
        walletFromGameMarket();
        walletRender();
      }
    } catch (e) {}

    try {
      if (state.on) {
        const now =
          Date.now();

        for (
          const [k, v]
          of cache
        ) {
          if (
            now - v.t >
            60000
          ) {
            cache.delete(k);
          }
        }

        for (
          const a of state.alerts
        ) {
          if (!a.enabled)
            continue;

          const rt =
            rtOf(a.id);

          if (
            Date.now() <
            rt.next
          ) {
            continue;
          }

          const base =
            a.kind === 'pokemon'
              ? POLL_POKEMON_MS
              : POLL_ITEMS_MS;

          try {
            await poll(a);

            rt.fail = 0;

            rt.next =
              Date.now() +
              base *
                (0.85 +
                  Math.random() *
                    0.3);
          } catch (e) {
            rt.fail++;

            rt.err =
              String(
                (e &&
                  e.message) ||
                  e
              );

            rt.next =
              Date.now() +
              Math.min(
                120000,
                base *
                  Math.pow(
                    2,
                    rt.fail
                  )
              );

            log(
              'erro em',
              a.name,
              '→',
              rt.err
            );
          }

          renderList();
        }
      }
    } catch (e) {
      log('tick:', e);
    }

    setTimeout(
      tick,
      1000
    );
  }

  /* ---------- UI ---------- */
  function toast(
    msg,
    tag
  ) {
    log(msg);

    if (tag) {
      const prev =
        document.querySelector(
          '.mtal-toast[data-tag="' +
            tag +
            '"]'
        );

      if (prev) {
        prev.remove();
      }
    }

    const d =
      document.createElement(
        'div'
      );

    d.className =
      'mtal-toast';

    if (tag) {
      d.dataset.tag =
        tag;
    }

    d.textContent = msg;

    d.style.cssText =
      `background:#1a1a2e;color:#f0d78c;border:1px solid #c9a44a;padding:8px 12px;border-radius:8px;font:12px Inter,sans-serif;max-width:300px;`;

    $('mtal-toast-slot')
      .appendChild(d);

    setTimeout(
      () => d.remove(),
      4500
    );
  }

  const style =
    document.createElement(
      'style'
    );

  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    #mtal-fab-row,#mtal-fab-row *,#mtal-panel,#mtal-panel *,#mtal-details,#mtal-details *,#mtal-mk,#mtal-mk *{font-family:Inter,sans-serif!important}
    #mtal-fab-row{position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:8px}
    #mtal-fab{background:#252a3d;color:#e8e3d0;border:1px solid #4a4f66;border-radius:8px;padding:8px 12px;font:bold 13px Inter,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5)}
    #mtal-fab:hover{border-color:#b5934f}
    #mtal-toast-slot{display:flex;flex-direction:column;gap:6px;pointer-events:none}
    #mtal-toast-slot .mtal-toast{pointer-events:auto}
    #mtal-badge{background:#12141f;color:#f0d78c;border:1px solid #4a4f66;border-radius:6px;padding:4px 8px;margin-left:4px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;line-height:1}

    #mtal-panel{position:fixed;left:16px;bottom:64px;width:620px;max-height:72vh;overflow:hidden;z-index:2147483646;background:#12141f;color:#e8e3d0;border:1px solid #c9a44a;border-radius:10px;font:12px/1.4 Inter,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);display:none;padding:0}
    #mtal-panel[style*="display: block"]{display:flex!important;flex-direction:column}
    #mtal-panel-head{flex:none;position:sticky;top:0;z-index:2;background:#12141f;padding:10px 10px 0 10px;box-shadow:0 6px 10px -6px rgba(0,0,0,.65)}
    #mtal-panel-body{flex:1;min-height:0;overflow-y:auto;padding:0 10px 10px 10px;scrollbar-width:thin}
    #mtal-panel-body::-webkit-scrollbar{width:3px}
    #mtal-footer{flex:none;text-align:center;padding:6px 10px;font-size:10px;letter-spacing:.03em;color:#9aa0b8;border-top:1px solid #232840;background:#12141f}
    #mtal-upd{margin-left:6px;padding:1px 7px;border-radius:999px;background:#2c4a2c;border:1px solid #3f6b3f;color:#b6e08a;text-decoration:none;font-weight:700}
    #mtal-upd:hover{border-color:#b5934f;color:#f0d78c}

    #mtal-panel .mtal-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
    #mtal-panel .mtal-head b{flex:1;min-width:0;color:#e0b95a;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-drag-handle{cursor:grab;user-select:none}
    #mtal-drag-handle:active{cursor:grabbing}
    #mtal-panel .mtal-head button{height:26px;padding:0 8px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;line-height:1}

    #mtal-panel .mtal-sound-group{display:flex;align-items:stretch;flex:none}
    #mtal-panel .mtal-sound-group #mtal-mute{border-radius:6px 0 0 6px;padding:0 6px}
    #mtal-panel #mtal-sound{width:auto;max-width:66px;height:26px;padding:0 4px;font-size:10.5px;line-height:24px;box-sizing:border-box;background:#252a3d;color:#e8e3d0;border:1px solid #4a4f66;border-left:none;border-radius:0 6px 6px 0}
    #mtal-panel #mtal-sound:hover{border-color:#b5934f}

    #mtal-panel .mtal-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;font:12px Inter,sans-serif;color:#e8e3d0}
    #mtal-panel .mtal-toggle input{position:absolute;opacity:0;width:0;height:0}
    #mtal-panel .mtal-toggle-track{width:32px;height:18px;background:#2c3148;border:1px solid #4a4f66;border-radius:999px;position:relative;transition:background .15s,border-color .15s;flex:none}
    #mtal-panel .mtal-toggle-thumb{position:absolute;top:1px;left:1px;width:14px;height:14px;background:#9aa0b8;border-radius:50%;transition:transform .15s,background .15s}
    #mtal-panel .mtal-toggle input:checked + .mtal-toggle-track{background:#7a611f;border-color:#c9a44a}
    #mtal-panel .mtal-toggle input:checked + .mtal-toggle-track .mtal-toggle-thumb{transform:translateX(14px);background:#f0d78c}

    #mtal-panel .mtal-alerts-bar{display:flex;align-items:center;gap:8px;margin:2px 0 6px}
    #mtal-panel #mtal-alerts-toggle{background:none;border:none;padding:2px 0;color:#e0b95a;font:bold 12px Inter,sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px}
    #mtal-panel #mtal-alerts-toggle:hover{border-color:transparent;color:#f0d78c}
    #mtal-panel .mtal-alerts-count{color:#9aa0b8;font-weight:normal;font-size:11px}
    #mtal-panel #mtal-new{background:none;border:none;padding:2px 0;color:#e0b95a;font:bold 12px Inter,sans-serif}
    #mtal-panel #mtal-new:hover{border-color:transparent;color:#f0d78c}

    #mtal-panel button{background:#252a3d;color:#e8e3d0;border:1px solid #4a4f66;border-radius:6px;padding:4px 8px;cursor:pointer;font:12px Inter,sans-serif}
    #mtal-panel button:hover{border-color:#b5934f}
    #mtal-panel .mtal-h{margin:10px 0 4px;color:#e0b95a;font-weight:bold}

    #mtal-panel .mtal-row.off .mtal-row-body{opacity:.55}
    #mtal-panel .mtal-dot{display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;vertical-align:1px;background:#7c829c}
    #mtal-panel .mtal-dot.ok{background:#61f6a4}
    #mtal-panel .mtal-dot.err{background:#f39a4b}
    #mtal-panel .mtal-ib{width:28px;height:28px;padding:0;background:transparent;border-color:transparent;color:#9aa0b8;font-size:13px}
    #mtal-panel .mtal-ib:hover{border-color:#4a4f66;color:#fff}
    #mtal-panel .mtal-ib.del:hover{color:#ff6b6b}
    #mtal-panel .mtal-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #2c3148;border-radius:8px;margin-bottom:8px}
    #mtal-panel .mtal-row-check{flex:none;width:15px;height:15px}
    #mtal-panel .mtal-row-body{flex:1;min-width:0}
    #mtal-panel .mtal-row-body b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mtal-panel .mtal-row-actions{display:flex;align-items:center;gap:2px;flex:none}
    #mtal-panel .mtal-sub{color:#9aa0b8;font-size:11px;margin-top:4px}
    #mtal-panel .mtal-x{cursor:pointer;color:#c0392b;font-size:14px;line-height:1}
    #mtal-panel .mtal-e{cursor:pointer;color:#e0b95a;font-size:14px;line-height:1}

    /* ---------- ACHADOS / COMPRADOS ---------- */
    #mtal-panel .mtal-hit{
      display:grid;
      grid-template-columns:58px minmax(0,1fr) auto;
      align-items:center;
      gap:10px;
      padding:10px;
      border-left:3px solid #e0b95a;
      background:#1a1e30;
      margin-bottom:6px;
      border-radius:0 6px 6px 0;
      min-height:108px
    }

    #mtal-panel .mtal-hit-thumb-wrap{
      width:58px;
      min-width:0;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:flex-start;
      gap:4px;
      align-self:stretch
    }

    #mtal-panel .mtal-hit-thumb{
      flex:none;
      width:55px;
      height:55px;
      border-radius:8px;
      overflow:hidden;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:20px
    }

    #mtal-panel .mtal-hit-thumb img{
      width:100%;
      height:100%;
      object-fit:contain;
      image-rendering:pixelated
    }

    #mtal-panel .mtal-hit-alert{
      width:100%;
      font-size:10px;
      font-weight:bold;
      color:#e0b95a;
      text-align:center;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap
    }

    #mtal-panel .mtal-hit-date{
      width:100%;
      font-size:10px;
      color:#9aa0b8;
      text-align:center;
      white-space:nowrap
    }

    #mtal-panel .mtal-hit-actions button{
      cursor:pointer
    }

    #mtal-panel .mtal-hit-main{
      min-width:0
    }

    #mtal-panel .mtal-hit-top{
      display:none
    }

    #mtal-panel .mtal-hit-desc{
      font-size:12px;
      margin-top:0
    }

    #mtal-panel .mtal-hit-name{
      font-size:14px;
      font-weight:bold;
      color:#f2ead0
    }

    #mtal-panel .mtal-hit-sub{
      margin-top:2px;
      color:#9aa0b8
    }

    #mtal-panel .mtal-hit-lv{
      font-size:11px;
      font-weight:600;
      color:#7c829c
    }

    #mtal-panel .mtal-hit-types{
      display:flex;
      flex-wrap:wrap;
      gap:4px;
      margin-top:4px
    }

    #mtal-panel .rp-type{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      height:17px;
      padding:0 7px;
      box-sizing:border-box;
      border-radius:999px;
      font-size:9px;
      font-weight:800;
      line-height:1;
      letter-spacing:.04em;
      text-transform:uppercase
    }

    #mtal-panel .mtal-hit-ivbar{
      max-width:140px;
      height:var(--mtal-bar,4px);
      margin-top:5px;
      background:#2c3148;
      border-radius:2px;
      overflow:hidden;
      will-change:transform
    }

    #mtal-panel .mtal-hit-ivbar i{
      display:block;
      height:100%;
      border-radius:2px
    }

    #mtal-panel .mtal-hit-price{
      font-size:12px;
      font-weight:bold;
      color:#f0d78c;
      margin-top:3px
    }

    #mtal-panel .mtal-t{
      color:#9aa0b8;
      font-size:11px
    }

    #mtal-panel .mtal-emptycard{display:flex;flex-direction:column;align-items:center;gap:6px;margin:4px 0;padding:28px 20px;text-align:center;background:#171a28;border:1px dashed #2c3148;border-radius:10px}
    #mtal-panel .mtal-emptycard .ic{display:grid;place-items:center;width:44px;height:44px;margin-bottom:4px;border-radius:50%;background:#1f2436;font-size:20px}
    #mtal-panel .mtal-emptycard b{font-size:13px;color:#f2ead0}
    #mtal-panel .mtal-emptycard p{margin:0;max-width:300px;font-size:11.5px;color:#9aa0b8}
    #mtal-panel .mtal-emptycard small{margin-top:6px;font-size:11px;color:#7c829c}
    #mtal-panel .mtal-emptycard button{margin-top:8px;height:30px;padding:0 16px}
    #mtal-panel .mtal-empty{
      color:#7c829c;
      padding:4px 2px
    }

    #mtal-panel .mtal-hit-actions{
      display:flex;
      align-items:center;
      gap:6px;
      flex:none
    }

    #mtal-panel .mtal-hit.lsp{grid-template-columns:52px 120px minmax(0,1fr) 36px;gap:10px;min-height:0;padding:10px 12px}
    #mtal-panel .lsp-block{justify-self:center;display:flex;align-items:center;gap:14px}
    #mtal-panel .lsp-block .lsp-grade{width:124px}
    #mtal-panel .lsp-block .lsp-stats{width:156px}
    #mtal-panel .lsp-sp{display:flex;flex-direction:column;align-items:center;gap:4px}
    #mtal-panel .lsp-sp .mtal-hit-thumb{width:52px;height:52px}
    #mtal-panel .lsp-id{min-width:0}
    #mtal-panel .lsp-id .mtal-hit-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-panel .lsp-q{margin-top:4px;font-size:11px;font-weight:600}
    #mtal-panel .lsp-id .mtal-hit-price{margin-top:4px}
    #mtal-panel .lsp-grade{display:flex;align-items:center;gap:8px;min-width:0}
    #mtal-panel .lsp-grade>div:last-child{min-width:0}
    #mtal-panel .lsp-ring{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:conic-gradient(var(--c) var(--d),#2c3148 0)}
    #mtal-panel .lsp-ring b{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;background:#1a1e30;font-size:10px;color:var(--c)}
    #mtal-panel .lsp-cls{font-size:11.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-panel .lsp-kv{font-size:10px;color:#7c829c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-panel .lsp-kv b{font-size:11px}
    #mtal-panel .lsp-ivt{color:#55e6d3}
    #mtal-panel .lsp-pow{color:#f0c14b}
    #mtal-panel .lsp-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,auto);grid-auto-flow:column;gap:7px 8px}
    #mtal-panel .lsp-stats.est{opacity:.55}
    #mtal-panel .lsp-stat>div{display:flex;align-items:baseline;justify-content:space-between;gap:4px}
    #mtal-panel .lsp-stat b{font-size:9px;letter-spacing:.04em;color:var(--c)}
    #mtal-panel .lsp-stat em{font-style:normal;font-size:10.5px;font-weight:700;color:#55e6d3}
    #mtal-panel .lsp-stat i{display:block;height:3px;margin-top:3px;background:#2c3148;border-radius:2px;overflow:hidden}
    #mtal-panel .lsp-stat u{display:block;height:100%;background:var(--c);border-radius:2px}
    #mtal-panel .lsp-acts{flex-direction:column}

    #mtal-panel .mtal-hit-actions button{
      font-size:18px;
      line-height:1;
      width:36px;
      height:36px;
      padding:0;
      border-radius:8px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      box-sizing:border-box
    }

    #mtal-panel .mtal-buy:hover{
      background:#3d3420
    }

    #mtal-panel .mtal-buy:disabled{
      opacity:.6;
      cursor:default
    }

    #mtal-panel .mtal-view svg{
      display:block
    }

    #mtal-panel .mtal-view.active{
      color:#c9a44a
    }

    #mtal-panel .mtal-tabs{
      display:flex;
      align-items:center;
      gap:14px;
      margin:10px 0 4px
    }

    #mtal-panel .mtal-tab{
      background:none;
      border:none;
      padding:4px 0;
      color:#7c829c;
      font:bold 12px Inter,sans-serif;
      cursor:pointer
    }

    #mtal-panel .mtal-tab:hover{
      border-color:transparent;
      color:#e0b95a
    }

    #mtal-panel .mtal-tab.active{
      color:#e0b95a
    }

    #mtal-panel #mtal-clear{
      background:none;
      border:none;
      padding:2px 0;
      color:#9aa0b8
    }

    #mtal-panel #mtal-clear:hover{
      border-color:transparent;
      color:#e0b95a
    }

    #mtal-form{margin:4px 0 10px;padding:12px 14px 14px;background:#171a28;border:1px solid #2c3148;border-radius:10px}
    #mtal-form [hidden]{display:none!important}
    #mtal-form .mtal-fhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    #mtal-form .mtal-fhead b{font-size:13px;color:#f2ead0}
    #mtal-panel #mtal-form #f-x{width:26px;height:26px;padding:0;background:transparent;border-color:transparent;color:#9aa0b8}
    #mtal-panel #mtal-form #f-x:hover{border-color:#4a4f66;color:#fff}
    #mtal-form .mtal-fgrid,#mtal-form .mtal-fsub{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
    #mtal-form .mtal-fsub{grid-column:1/-1}
    #mtal-form .full{grid-column:1/-1}
    #mtal-form label{display:flex;flex-direction:column;gap:5px;margin:0}
    #mtal-form label > span{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-form input[type=text],#mtal-form input[type=number],#mtal-form select{width:100%;height:32px;box-sizing:border-box;margin:0;padding:0 10px;background:#0d0f18;color:#e8e3d0;border:1px solid #2c3148;border-radius:6px;font-size:12px}
    #mtal-form input:focus,#mtal-form select:focus{outline:none;border-color:#e8eaf2}
    #mtal-form .mtal-fhint{margin-top:10px;font-size:10.5px;color:#7c829c}
    #mtal-form .mtal-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
    #mtal-form .mtal-form-actions button{height:32px;padding:0 16px}
    #mtal-panel .mtal-primary{background:#e8eaf2;border-color:#e8eaf2;color:#12141f;font-weight:700}
    #mtal-panel .mtal-primary:hover{background:#fff;border-color:#fff}
    #mtal-panel .mtal-sw{display:flex;flex-direction:row!important;align-items:center;gap:8px;color:#c7cbe0;font-size:12px;cursor:pointer;user-select:none}
    #mtal-panel .mtal-sw input{position:absolute;opacity:0;width:0;height:0}
    #mtal-panel .mtal-sw i{position:relative;flex:none;width:30px;height:16px;background:#2c3148;border-radius:999px;transition:background .15s}
    #mtal-panel .mtal-sw i::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;background:#9aa0b8;border-radius:50%;transition:transform .15s,background .15s}
    #mtal-panel .mtal-sw input:checked + i{background:#e8eaf2}
    #mtal-panel .mtal-sw input:checked + i::after{transform:translateX(14px);background:#12141f}

    #mtal-details{
      position:fixed;
      left:396px;
      bottom:64px;
      width:300px;
      max-height:80vh;
      overflow:auto;
      z-index:2147483646;
      background:#12141f;
      color:#e8e3d0;
      border:1px solid #c9a44a;
      border-radius:10px;
      font:12px/1.4 Inter,sans-serif;
      box-shadow:0 6px 24px rgba(0,0,0,.6);
      display:none;
      padding:10px;
      scrollbar-width:thin
    }

    #mtal-details::-webkit-scrollbar{
      width:3px
    }

    #mtal-details .mtal-d-head{
      display:flex;
      align-items:center;
      gap:8px;
      margin-bottom:8px
    }

    #mtal-details .mtal-d-head b{
      flex:1;
      color:#e0b95a;
      font-size:11px;
      letter-spacing:.06em;
      text-transform:uppercase
    }

    #mtal-details button{
      background:#252a3d;
      color:#e8e3d0;
      border:1px solid #4a4f66;
      border-radius:6px;
      padding:4px 8px;
      cursor:pointer;
      font:12px Inter,sans-serif
    }

    #mtal-details button:hover{
      border-color:#b5934f
    }

    #mtal-d-img{
      height:110px;
      border-radius:8px;
      margin-bottom:10px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:42px;
      background:radial-gradient(circle at 50% 30%,#2b2f52,#0d0f18 75%);
      border:1px solid #2c3148
    }

    #mtal-d-img img{
      max-height:90%;
      max-width:90%;
      image-rendering:pixelated
    }

    #mtal-d-name{
      text-align:center;
      font-size:15px;
      font-weight:bold;
      color:#f2ead0
    }

    .mtal-d-badges{
      display:flex;
      justify-content:center;
      flex-wrap:wrap;
      gap:6px;
      margin:6px 0 10px
    }

    .mtal-badge{
      display:inline-block;
      padding:2px 9px;
      border-radius:10px;
      font-size:10.5px;
      font-weight:bold;
      background:#2c3148;
      color:#c7cbe0
    }

    .mtal-d-row{
      display:flex;
      justify-content:space-between;
      gap:8px;
      padding:5px 2px;
      border-bottom:1px solid #232840
    }

    .mtal-d-row span:first-child{
      color:#9aa0b8
    }

    .mtal-d-row span:last-child{
      font-weight:bold
    }

    .mtal-d-sec{
      margin-top:12px;
      color:#9aa0b8;
      font-size:10.5px;
      text-transform:uppercase;
      letter-spacing:.06em
    }

    .mtal-d-stats{
      display:grid;
      grid-template-columns:1fr 1fr 1fr;
      gap:8px;
      margin-top:8px;
      margin-bottom:4px
    }

    .mtal-d-stat{
      background:#1a1e30;
      border:1px solid #232840;
      border-radius:6px;
      padding:8px 6px;
      text-align:center
    }

    .mtal-d-stat span{
      display:block;
      color:#7c829c;
      font-size:10px;
      margin-bottom:3px
    }

    .mtal-d-stat b{
      font-size:13px
    }

    #mtal-d-price{
      margin:12px 0;
      text-align:center;
      background:#1a1e30;
      border-radius:8px;
      padding:10px
    }

    #mtal-d-price span{
      display:block;
      color:#9aa0b8;
      font-size:10.5px;
      text-transform:uppercase;
      letter-spacing:.05em;
      margin-bottom:4px
    }

    #mtal-d-price b{
      color:#f0d78c;
      font-size:16px
    }

    #mtal-d-actions{
      display:flex;
      gap:8px;
      margin-top:10px
    }

    #mtal-d-actions button{
      padding:12px 8px;
      display:flex;
      align-items:center;
      justify-content:center;
      text-align:center
    }

    #mtal-d-market{
      flex:0 0 56px;
      font-size:17px
    }

    #mtal-d-buy{
      flex:1;
      background:#2c4a2c;
      border-color:#3f6b3f
    }

    #mtal-d-buy:hover{
      border-color:#b5934f
    }

    #mtal-d-buy:disabled{
      opacity:.6;
      cursor:default
    }

    .mtal-d-raw{
      margin-top:10px;
      color:#7c829c
    }

    .mtal-d-raw pre{
      white-space:pre-wrap;
      word-break:break-all;
      font-size:10px;
      max-height:220px;
      overflow:auto;
      background:#0d0f18;
      padding:6px;
      border-radius:6px
    }

    #mtal-mk{position:fixed;left:16px;top:4vh;width:min(1480px,calc(100vw - 440px));min-width:760px;height:92vh;z-index:2147483646;background:#12141f;color:#e8e3d0;border:1px solid #c9a44a;border-radius:10px;font:12px/1.4 Inter,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden}
    #mtal-mk [hidden]{display:none!important}
    #mtal-mk button{background:#252a3d;color:#e8e3d0;border:1px solid #4a4f66;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
    #mtal-mk button:hover{border-color:#e8eaf2}
    #mtal-mk button:disabled{opacity:.6;cursor:default}
    #mtal-mk .mk-head{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid #232840}
    #mtal-mk .mk-head b{color:#e0b95a;font-size:14px}
    #mtal-mk .mk-cats{display:flex;gap:4px}
    #mtal-mk .mk-cat.active{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk .mk-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 12px 8px}
    #mtal-mk .mk-f{display:inline-flex;align-items:center;gap:5px;color:#9aa0b8}
    #mtal-mk label.mk-f{cursor:pointer}
    #mtal-mk input[type=text],#mtal-mk select{background:#0d0f18;color:#e8e3d0;border:1px solid #4a4f66;border-radius:6px;padding:5px 7px;font-size:12px;width:56px;box-sizing:border-box}
    #mtal-mk #mk-q{width:200px}
    #mtal-mk #mk-pmax{width:96px}
    #mtal-mk select{width:auto}
    #mtal-mk .mk-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px}
    #mtal-mk .mk-chip{padding:3px 11px;border-radius:999px;background:transparent;font-size:11px;font-weight:600;opacity:.5}
    #mtal-mk .mk-chip.on{opacity:1;background:#1a1e30}
    #mtal-mk .mk-body{flex:1;min-height:0;display:grid;grid-template-columns:150px 230px minmax(0,1fr);border-top:1px solid #232840}
    #mtal-mk .mk-side{display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid #232840;overflow:auto}
    #mtal-mk .mk-side .mk-cat{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;background:transparent;border:none;border-radius:6px;text-align:left;font-weight:600;color:#9aa0b8;box-shadow:none}
    #mtal-mk .mk-wallet{margin-top:auto;display:flex;flex-direction:column;gap:4px;padding:10px;border-top:1px solid #232840;font-size:11.5px;color:#9aa0b8}
    #mtal-mk .mk-wallet b{color:#f2ead0;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-mk .mk-wallet em{font-style:normal;font-weight:700;color:#f0d78c}
    #mtal-mk .mk-side .mk-cat i{width:18px;font-style:normal;font-size:13px;text-align:center;opacity:.8}
    #mtal-mk .mk-side .mk-cat:hover{background:#1a1e30;color:#e8e3d0}
    #mtal-mk .mk-side .mk-cat.active{background:#262b3f;color:#fff;box-shadow:inset 3px 0 0 #e8eaf2}
    #mtal-mk .mk-side .mk-cat.active i{opacity:1}
    #mtal-mk .mk-fcol{display:flex;flex-direction:column;padding:0;border-right:1px solid #232840;overflow:auto;scrollbar-width:thin}
    #mtal-mk .mk-fhead{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px}
    #mtal-mk .mk-link{padding:0;background:none;border:none;color:#9aa0b8;font-size:11px;text-decoration:underline;text-underline-offset:2px}
    #mtal-mk .mk-link:hover{color:#fff}
    #mtal-mk .mk-fgroup{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-top:1px solid #232840}
    #mtal-mk .mk-flabel{margin-top:6px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7c829c}
    #mtal-mk .mk-flabel:first-child{margin-top:0}
    #mtal-mk .mk-fcol input[type=text],#mtal-mk .mk-fcol select{height:30px;padding:0 9px;background:#0d0f18;border:1px solid #2c3148;border-radius:6px;color:#e8e3d0;font-size:12px}
    #mtal-mk .mk-fcol input[type=text]:focus,#mtal-mk .mk-fcol select:focus{outline:none;border-color:#e8eaf2}
    #mtal-mk .mk-search,#mtal-mk .mk-prefix{position:relative}
    #mtal-mk .mk-search i,#mtal-mk .mk-prefix b{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-style:normal;font-size:12px;font-weight:600;color:#7c829c;pointer-events:none}
    #mtal-mk .mk-search input[type=text]{padding-left:26px}
    #mtal-mk .mk-prefix input[type=text]{padding-left:28px}
    #mtal-mk .mk-switch{display:flex;align-items:center;gap:8px;margin-top:6px;color:#c7cbe0;font-size:12px;cursor:pointer;user-select:none}
    #mtal-mk .mk-switch input{position:absolute;opacity:0;width:0;height:0}
    #mtal-mk .mk-switch i{position:relative;flex:none;width:30px;height:16px;background:#2c3148;border-radius:999px;transition:background .15s}
    #mtal-mk .mk-switch i::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;background:#9aa0b8;border-radius:50%;transition:transform .15s,background .15s}
    #mtal-mk .mk-switch input:checked + i{background:#e8eaf2}
    #mtal-mk .mk-switch input:checked + i::after{transform:translateX(14px);background:#12141f}
    #mtal-mk .mk-fh{color:#e0b95a;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    #mtal-mk .mk-fl{display:flex;flex-direction:column;gap:5px;color:#9aa0b8;font-size:11px}
    #mtal-mk .mk-fcol input[type=text],#mtal-mk .mk-fcol select{width:100%}
    #mtal-mk .mk-range{display:flex;align-items:center;gap:6px}
    #mtal-mk .mk-range input[type=text]{flex:1;min-width:0}
    #mtal-mk .mk-range i{font-style:normal;color:#7c829c}
    #mtal-mk .mk-chk{display:flex;align-items:center;gap:6px;color:#c7cbe0;cursor:pointer}
    #mtal-mk .mk-fcol .mk-chips{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0}
    #mtal-mk .mk-fcol .mk-chip{padding:5px 0;border:1px solid #2c3148;border-radius:6px;opacity:.75}
    #mtal-mk .mk-fcol .mk-chip:hover{opacity:1;border-color:#4a4f66}
    #mtal-mk .mk-fcol .mk-chip.on{opacity:1;border-color:currentColor;background:color-mix(in srgb,currentColor 14%,transparent)}
    #mtal-mk .mk-res{display:flex;flex-direction:column;min-width:0;min-height:0}
    #mtal-mk .mk-table-wrap{flex:1;min-height:0;overflow:auto;scrollbar-width:thin}
    #mtal-mk table{width:100%;border-collapse:collapse}
    #mtal-mk thead th{position:sticky;top:0;z-index:1;background:#171a28;color:#9aa0b8;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:8px 10px;border-bottom:1px solid #2c3148;white-space:nowrap;user-select:none}
    #mtal-mk thead th.r{text-align:right}
    #mtal-mk th.mk-sortable{cursor:pointer}
    #mtal-mk th.mk-sortable:hover,#mtal-mk th.on{color:#e0b95a}
    #mtal-mk tbody td{padding:6px 10px;border-bottom:1px solid #1d2133;vertical-align:middle;white-space:nowrap}
    #mtal-mk tbody tr:hover td{background:#1a1e30}
    #mtal-mk .mk-img{width:44px;padding:4px 6px}
    #mtal-mk .mk-thumb{width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:16px}
    #mtal-mk .mk-thumb img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
    #mtal-mk .mk-name{font-weight:600;color:#f2ead0;font-size:13px}
    #mtal-mk .mk-iv b{color:#f2ead0}
    #mtal-mk .mk-iv span{color:#7c829c}
    #mtal-mk .mk-iv i{display:block;width:70px;height:3px;background:#2c3148;border-radius:2px;margin-top:3px;overflow:hidden}
    #mtal-mk .mk-iv em{display:block;height:100%;background:#c9a44a}
    #mtal-mk .mk-price{color:#f0d78c;font-weight:700;text-align:right}
    #mtal-mk .mk-acts{text-align:right;width:1%}
    #mtal-mk .mk-acts button{width:30px;height:30px;padding:0;margin-left:4px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;vertical-align:middle}
    #mtal-mk .mk-acts svg{display:block}
    #mtal-mk .mkc-bar{padding:8px 10px;text-transform:none;letter-spacing:0;font-size:11px;font-weight:600}
    #mtal-mk .mkc-sort{margin-left:6px;padding:3px 10px;font-size:11px}
    #mtal-mk .mkc-barin{display:flex;align-items:center;justify-content:space-between;gap:10px}
    #mtal-mk .mkc-views{display:flex}
    #mtal-mk .mkc-views button{width:30px;height:26px;padding:0;font-size:13px;border-radius:0}
    #mtal-mk .mkc-views button:first-child{border-radius:6px 0 0 6px}
    #mtal-mk .mkc-views button:last-child{border-radius:0 6px 6px 0;border-left:none}
    #mtal-mk .mkc-views button.on{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk .mkc-gridrow td{padding:10px;border-bottom:none;background:transparent!important}
    #mtal-mk .mkc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
    #mtal-mk .mkc-grid .mkc{height:100%;box-sizing:border-box;grid-template-columns:64px minmax(0,1fr);grid-template-areas:"sp id" "grade grade" "stats stats" "side side";align-content:start;gap:12px}
    #mtal-mk .mkc-grid .mkc-name{white-space:normal}
    #mtal-mk .mkc-grid .mkc-grade{padding-top:12px;border-top:1px solid #232840}
    #mtal-mk .mkc-grid .mkc-stats{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:none;grid-auto-flow:row;gap:8px 14px;padding-top:10px;border-top:1px solid #232840}
    #mtal-mk .mkc-grid .mkc-side{flex-direction:row;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #232840}
    #mtal-mk .mkc-cell:hover .mkc{border-color:#4a4f66}
    #mtal-mk #mk-sell{container-type:inline-size}
    #mtal-mk .mkc-list{display:flex;flex-direction:column;gap:10px}
    #mtal-mk .sl-pk{cursor:pointer}
    #mtal-mk .sl-pk:hover .mkc{border-color:#4a4f66}
    #mtal-mk .sl-pk.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .mkc-cell.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .mkc-sort.on{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk .mkc-row td{padding:5px 10px;border-bottom:none;background:transparent!important}
    #mtal-mk .mkc-row:first-child td{padding-top:10px}
    #mtal-mk .mkc-row:last-child td{padding-bottom:10px}
    #mtal-mk table.mkc-table{table-layout:fixed}
    #mtal-mk .mkc{display:grid;grid-template-columns:64px 200px 150px minmax(240px,420px) minmax(0,1fr) 120px;grid-template-areas:"sp id grade stats . side";align-items:center;gap:18px;padding:10px 12px;background:#1a1e30;border:1px solid #232840;border-radius:10px;white-space:normal;cursor:pointer}
    #mtal-mk .mkc-row:hover .mkc{border-color:#4a4f66}
    #mtal-mk .mkc-row.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .mkc-sp{grid-area:sp;align-self:center;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:20px}
    #mtal-mk .mkc-sp img{max-width:100%;max-height:100%;image-rendering:pixelated}
    #mtal-mk .mkc-id{grid-area:id;min-width:0}
    #mtal-mk .mkc-name{font-size:14px;font-weight:700;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-mk .mkc-name small{font-size:11px;font-weight:600;color:#7c829c}
    #mtal-mk .mkc-types{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    #mtal-mk .mkc-q{margin-top:5px;font-size:11.5px;font-weight:600}
    #mtal-mk .rp-type{display:inline-flex;align-items:center;justify-content:center;height:17px;padding:0 7px;box-sizing:border-box;border-radius:999px;font-size:9px;font-weight:800;line-height:1;letter-spacing:.04em;text-transform:uppercase;text-box:trim-both cap alphabetic}
    #mtal-mk .mkc-grade{grid-area:grade;display:flex;align-items:center;gap:10px}
    #mtal-mk .rp-ring{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:conic-gradient(var(--c) var(--d),#2c3148 0)}
    #mtal-mk .rp-ring b{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#1a1e30;font-size:11px;color:var(--c)}
    #mtal-mk .mkc-cls{font-size:12px;font-weight:700}
    #mtal-mk .mkc-kv{font-size:10.5px;color:#7c829c;white-space:nowrap}
    #mtal-mk .mkc-kv b{font-size:11.5px}
    #mtal-mk .rp-ivt{color:#55e6d3}
    #mtal-mk .rp-pow{color:#f0c14b}
    #mtal-mk .mkc-stats{grid-area:stats;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,auto);grid-auto-flow:column;gap:8px 16px}
    #mtal-mk .mkc-stats.est{opacity:.55}
    #mtal-mk .mkc-stat>div{display:flex;align-items:baseline;justify-content:space-between;font-size:10px;color:#7c829c}
    #mtal-mk .mkc-stat b{font-size:10px;letter-spacing:.04em;color:var(--c)}
    #mtal-mk .mkc-stat em{font-style:normal;font-size:11.5px;font-weight:700;color:#55e6d3}
    #mtal-mk .mkc-stat i{display:block;height:4px;margin-top:3px;background:#2c3148;border-radius:2px;overflow:hidden}
    #mtal-mk .mkc-stat u{display:block;height:100%;background:var(--c);border-radius:2px}
    #mtal-mk .mk-res{container-type:inline-size}
    @container (max-width: 880px){
      #mtal-mk .mkc{grid-template-columns:64px minmax(0,1fr) 150px 110px;grid-template-areas:"sp id grade side" "sp stats stats stats";gap:8px 16px}
      #mtal-mk .mkc-stats{grid-template-columns:repeat(3,minmax(0,1fr));padding-top:8px;border-top:1px solid #232840}
    }
    #mtal-mk .mkc-side{grid-area:side;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
    #mtal-mk .mkc-side .mk-acts{display:flex;gap:4px;width:auto}
    #mtal-mk .mkc-side .mk-acts button{width:auto;margin-left:0;padding:0 16px;font-size:12px;font-weight:600}
    #mtal-mk .mkc-side .mk-price{font-size:13px;text-align:right;white-space:nowrap}
    #mtal-mk .mk-empty{text-align:center;color:#7c829c;padding:30px}
    #mtal-mk .mk-foot{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #232840;color:#9aa0b8}
    #mtal-mk:not([data-mode="buy"]) .mk-buyv,#mtal-mk:not([data-mode="sell"]) .mk-sellv,#mtal-mk:not([data-mode="hist"]) .mk-histv{display:none!important}
    #mtal-mk #mk-hist{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;scrollbar-width:thin}
    #mtal-mk .hist-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    #mtal-mk .mk-seg{display:flex}
    #mtal-mk .mk-seg button{border-radius:0}
    #mtal-mk .mk-seg button:first-child{border-radius:6px 0 0 6px}
    #mtal-mk .mk-seg button:last-child{border-radius:0 6px 6px 0;border-left:none}
    #mtal-mk .mk-seg button.on{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk #sl-filter{width:180px}
    #mtal-mk .sl-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));grid-auto-rows:max-content;align-content:start;gap:8px;margin:10px 0;overflow:auto;padding:2px;scrollbar-width:thin}
    #mtal-mk .sl-grid .mk-empty{grid-column:1/-1}
    #mtal-mk .sl-card{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;background:#1a1e30;border:1px solid #2c3148;border-radius:8px;min-width:0}
    #mtal-mk .sl-card.on{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .sl-thumb{width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:16px}
    #mtal-mk .sl-thumb img{max-width:100%;max-height:100%;image-rendering:pixelated}
    #mtal-mk .sl-cname{font-size:11px;font-weight:600;color:#f2ead0;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mtal-mk .sl-bar{padding:10px;background:#171a28;border:1px solid #2c3148;border-radius:8px}
    #mtal-mk .sl-pf{margin-top:8px}
    #mtal-mk #sl-rar{padding:0}
    #mtal-mk .sl-grid.list{display:block}
    #mtal-mk .sl-row,#mtal-mk .mtal-mkrow{cursor:pointer}
    #mtal-mk .mtal-mkrow.on td{background:#1e2336}
    #mtal-mk .sl-row.on td{background:#1e2336}
    #mtal-mk .sl-table{width:100%}
    #mtal-mk .mk-coll{cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#171a28;border:1px solid #2c3148;border-radius:8px;transition:border-color .15s,color .15s}
    #mtal-mk .mk-coll:hover{color:#fff;border-color:#e8eaf2}
    #mtal-mk .mk-coll::after{content:'clique para expandir/recolher';margin-left:auto;font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:#7c829c}
    #mtal-d-price.mtal-d-sell{text-align:left}
    .mtal-d-sellrow{display:flex;gap:6px;margin:4px 0 8px}
    .mtal-d-sellrow input,.mtal-d-sellrow select{background:#0d0f18;color:#e8e3d0;border:1px solid #4a4f66;border-radius:6px;padding:7px 9px;font-size:13px}
    .mtal-d-sellrow input{flex:1;min-width:0}
    #mtal-details #mtal-d-sgo{width:100%;padding:10px;background:#2c4a2c;border-color:#3f6b3f}
    #mtal-details #mtal-d-sgo:hover{border-color:#b5934f}
    .mtal-d-npc{margin-top:8px;color:#7c829c;font-size:11px;text-align:center}
    .mtal-d-qty{margin-top:12px}
    .mtal-d-qty > span{display:block;color:#9aa0b8;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
    #mtal-d-btotal{margin-top:0;text-align:left;color:#f0d78c;font-weight:600}
    #mtal-details #mtal-d-buy,#mtal-details #mtal-d-npcgo{flex:1}
    #mtal-details #mtal-d-npcgo{background:#2c4a2c;border-color:#3f6b3f}
    #mtal-details #mtal-d-npcgo:hover{border-color:#b5934f}
    #mtal-details.mtal-rich{width:400px}
    #mtal-details.mtal-rich #mtal-d-price{border:1px solid #232840}
    #mtal-details .rp-top{display:flex;align-items:center;gap:12px;margin-bottom:10px}
    #mtal-details .rp-sprite{flex:none;width:68px;height:68px;display:flex;align-items:center;justify-content:center;font-size:22px}
    #mtal-details .rp-sprite img{max-width:100%;max-height:100%;image-rendering:pixelated}
    #mtal-details .rp-id{min-width:0}
    #mtal-details .rp-name{display:flex;align-items:baseline;gap:8px;font-size:17px;font-weight:700;color:#f2ead0}
    #mtal-details .rp-name small{font-size:11px;font-weight:400;color:#7c829c}
    #mtal-details .rp-types{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    #mtal-details .rp-type{display:inline-flex;align-items:center;justify-content:center;height:20px;padding:0 10px;box-sizing:border-box;border-radius:999px;font-size:10px;font-weight:800;line-height:1;letter-spacing:.04em;text-transform:uppercase}
    #mtal-details .rp-boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
    #mtal-details .rp-box{display:flex;flex-direction:column;gap:5px;min-width:0;padding:8px;background:#1a1e30;border:1px solid #232840;border-radius:8px}
    #mtal-details .rp-box > span{font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-details .rp-box b{font-size:15px}
    #mtal-details .rp-box small{font-size:11px;font-weight:400;color:#7c829c}
    #mtal-details .rp-ivt{color:#55e6d3}
    #mtal-details .rp-pow{color:#f0c14b}
    #mtal-details .rp-grade{display:flex;align-items:center;gap:12px;margin-top:8px;padding:10px;background:#1a1e30;border:1px solid #232840;border-radius:8px}
    #mtal-details .rp-ring{flex:none;display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:conic-gradient(var(--c) var(--d),#2c3148 0)}
    #mtal-details .rp-ring b{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#1a1e30;font-size:12px;color:var(--c)}
    #mtal-details .rp-grade strong{font-size:14px}
    #mtal-details .rp-grade p{margin:2px 0 0;font-size:11px;color:#9aa0b8}
    #mtal-details .rp-sec>span{display:block;line-height:1;text-box:trim-both cap alphabetic}
    #mtal-details .rp-sec{display:flex;align-items:center;gap:6px;margin:12px 0 6px;padding:11px 10px;background:#171a28;border:1px solid #2c3148;border-radius:8px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c7cbe0;cursor:pointer;user-select:none}
    #mtal-details .rp-sec:hover{color:#f0d78c;border-color:#b5934f}
    #mtal-details .rp-sec i{margin-left:auto;font-style:normal;transition:transform .15s}
    #mtal-details .rp-sec.open i{transform:rotate(180deg)}
    #mtal-details .rp-title{display:flex;align-items:center;gap:6px;margin:12px 0 6px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#c7cbe0}
    #mtal-details .rp-dim{font-weight:400;text-transform:none;letter-spacing:0;color:#7c829c}
    #mtal-details .rp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
    #mtal-details .rp-stat{padding:7px 8px;background:#1a1e30;border:1px solid #232840;border-radius:8px}
    #mtal-details .rp-stat-h{display:flex;align-items:baseline;justify-content:space-between}
    #mtal-details .rp-stat-h b{font-size:10.5px;letter-spacing:.04em;color:var(--c)}
    #mtal-details .rp-stat-h span{font-size:10px;color:#7c829c}
    #mtal-details .rp-stat-h em{font-style:normal;font-size:12.5px;font-weight:700;color:#55e6d3}
    #mtal-details .rp-bar{height:5px;margin-top:5px;background:#2c3148;border-radius:3px;overflow:hidden}
    #mtal-details .rp-bar i{display:block;height:100%;background:var(--c);border-radius:3px;transition:width .15s}
    #mtal-details .rp-sec.rp-static{cursor:default}
    #mtal-details .rp-sec.rp-static:hover{color:#c7cbe0;border-color:#2c3148}
    #mtal-details .rp-move.locked{opacity:.4;filter:grayscale(.8)}
    #mtal-details .rp-warn{margin-top:6px;font-size:10.5px;color:#f39a4b}
    #mtal-details .rp-warn:empty{display:none}
    #mtal-details .rp-moves{display:none;flex-direction:column;gap:5px}
    #mtal-details .rp-moves.open{display:flex}
    #mtal-details .rp-move{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#1a1e30;border:1px solid #232840;border-radius:8px}
    #mtal-details .rp-move .rp-type{height:17px;padding:0 8px;font-size:9px}
    #mtal-panel .rp-type,#mtal-details .rp-type{text-box:trim-both cap alphabetic}
    #mtal-details .rp-move b{font-size:12px;color:#f2ead0}
    #mtal-details .rp-move small{font-size:10.5px;color:#7c829c}
    #mtal-details .rp-move em{margin-left:auto;font-style:normal;font-weight:700;color:#ff9f43}
    #mtal-details .rp-foot{display:flex;justify-content:space-between;gap:8px;margin-top:10px;font-size:10.5px;color:#7c829c}
    #mtal-details .rp-foot b{color:#f0d78c}
    #mtal-mk .mk-modes{display:flex;gap:4px;padding-right:12px;border-right:1px solid #2c3148}
    #mtal-mk .mk-mode.active{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk .mk-npcs{display:flex;flex-wrap:wrap;gap:4px}
    #mtal-mk .mk-npc{padding:5px 9px;color:#c7cbe0}
    #mtal-mk .mk-npc.active{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk:not([data-mode^="npc"]) .mk-npcv{display:none!important}
    #mtal-mk #mk-npc{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;scrollbar-width:thin}
    #mtal-mk .npc-head{display:flex;align-items:center;gap:12px;margin-top:12px}
    #mtal-mk .npc-head b{color:#e0b95a;font-size:14px}
    #mtal-mk .npc-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    #mtal-mk #mk-npc .sl-grid{overflow:visible;margin:6px 0 0}
    #mtal-mk .sl-card.npc-ro{cursor:default}
    #mtal-mk .npc-note{margin-top:10px}
    #mtal-mk #npc-filter{width:180px}
    #mtal-mk .npc-tabs{margin-top:12px}
    #mtal-mk .npc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
    #mtal-mk .npc-list{display:flex;flex-direction:column;gap:6px;margin-top:6px}
    #mtal-mk .npc-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#1a1e30;border:1px solid #2c3148;border-radius:8px;cursor:pointer}
    #mtal-mk .npc-row:hover{border-color:#4a4f66}
    #mtal-mk .npc-row.on{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .npc-ri{width:36px;height:36px;flex:none;display:flex;align-items:center;justify-content:center}
    #mtal-mk .npc-ri img{max-width:100%;max-height:100%;image-rendering:pixelated}
    #mtal-mk .npc-rn{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    #mtal-mk .npc-rn b{color:#f2ead0;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mtal-mk .npc-arrow{flex:none;width:36px;height:30px;padding:0;font-size:16px;color:#f0d78c}
    #mtal-mk .npc-chk{flex:none;width:16px;height:16px;cursor:pointer}
    #mtal-mk .npc-foot{display:flex;align-items:center;margin-top:12px}
    #mtal-mk .npc-slots{padding:6px 10px;border:1px solid #4a4f66;border-radius:6px;color:#c7cbe0;font-weight:600}
    #mtal-mk .npc-primary{background:#6b5520;border-color:#c9a44a;color:#f8e7b0;padding:8px 16px;font-weight:700}
    #mtal-mk .npc-primary:disabled{opacity:.5;cursor:default}
    #mtal-mk .npc-bulk{display:flex;align-items:center;gap:12px;margin-top:12px}
    #mtal-mk .npc-bulk button{background:#2c4a2c;border-color:#3f6b3f;padding:8px 14px;font-weight:600}
    #mtal-mk .npc-bulk button:hover{border-color:#e8eaf2}
    #mtal-mk #mk-sell{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;padding:0 12px 12px}
    #mtal-mk #mk-sell .sl-anun{flex:1;min-height:0;display:flex;flex-direction:column}
    #mtal-mk #mk-sell .sl-anun .mk-form,#mtal-mk #mk-sell .sl-anun .sl-bar{flex:none}
    #mtal-mk #mk-sell .sl-minesec{flex:none;border-top:1px solid #232840;padding-top:10px}
    #mtal-mk #mk-sell .sl-minesec .mk-sec-h{margin-bottom:0}
    #mtal-mk #sl-mine-wrap{max-height:38vh;overflow:auto;margin-top:8px;scrollbar-width:thin}
    #mtal-mk .mk-sec{margin-top:14px}
    #mtal-mk .mk-sec-h{color:#e0b95a;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
    #mtal-mk .mk-form{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;color:#9aa0b8}
    #mtal-mk .mk-dim{color:#7c829c;font-size:11px}
    #mtal-mk .mk-tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:700}
    #mtal-mk .mk-tag.buy{background:#1f2f45;color:#8fc1ff}
    #mtal-mk .mk-tag.sold{background:#2c3a22;color:#b6e08a}
  `;

  document.head.appendChild(
    style
  );

  const root =
    document.createElement(
      'div'
    );

  root.innerHTML = `
    <div id="mtal-fab-row">
      <button
        id="mtal-fab"
        title="LiveSearch"
      >
        🔔 Alertas
        <span
          id="mtal-badge"
          hidden
        ></span>
      </button>

      <div id="mtal-toast-slot"></div>
    </div>

    <div id="mtal-panel">
      <div id="mtal-panel-head">
        <div class="mtal-head">
          <b
            id="mtal-drag-handle"
            title="Arraste para mover a janela"
          >
            LiveSearch
          </b>

          <label
            class="mtal-toggle"
            title="Ativar/desativar alertas (Alt+F)"
          >
            <input
              type="checkbox"
              id="mtal-on"
            >

            <span class="mtal-toggle-track">
              <span class="mtal-toggle-thumb"></span>
            </span>

            ativo
          </label>

          <div class="mtal-sound-group">
            <button
              id="mtal-mute"
              title="Som"
            >
              🔊
            </button>

            <select
              id="mtal-sound"
              title="Som do alerta"
            ></select>
          </div>

          <button
            id="mtal-mkopen"
            title="Mercado"
          >
            🏪
          </button>

          <button
            id="mtal-osnotify"
            title="Notificação do Windows/navegador"
          >
            🔔
          </button>

          <button
            id="mtal-close"
          >
            ✕
          </button>
        </div>

        <div class="mtal-alerts-bar">
          <button
            type="button"
            id="mtal-alerts-toggle"
            title="Mostrar/ocultar alertas criados"
          >
            <span id="mtal-alerts-caret">
              ▾
            </span>

            Alertas

            <span
              id="mtal-alerts-count"
              class="mtal-alerts-count"
            ></span>
          </button>

          <span style="flex:1"></span>

          <button
            type="button"
            id="mtal-new"
          >
            ＋ Criar alerta
          </button>
        </div>

        <div id="mtal-list"></div>

        <div id="mtal-form" hidden>
          <div class="mtal-fhead">
            <b id="f-title">Novo alerta</b>
            <button type="button" id="f-x" title="Fechar">✕</button>
          </div>

          <div class="mtal-fgrid">
            <label class="full">
              <span>Tipo</span>
              <select id="f-kind">
                <option value="pokemon">Pokémon</option>
                <option value="items">Item / Stone / Ball / Diamantes</option>
              </select>
            </label>

            <div id="f-poke" class="mtal-fsub">
              <label class="full">
                <span>Espécie</span>
                <input type="text" id="f-species" list="mtal-species" placeholder="Qualquer espécie">
              </label>

              <datalist id="mtal-species"></datalist>

              <label>
                <span>IV total mín</span>
                <input type="number" id="f-iv" min="0" max="192" placeholder="sem mínimo">
              </label>

              <label>
                <span>Qualidade mín</span>
                <input type="number" id="f-q" step="0.01" min="0" placeholder="sem mínimo">
              </label>
            </div>

            <div id="f-item" class="mtal-fsub" hidden>
              <label>
                <span>Categoria</span>
                <select id="f-cat">
                  ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(catLabel(c))}</option>`).join('')}
                </select>
              </label>

              <label>
                <span>Nome contém</span>
                <input type="text" id="f-text" placeholder="ex.: pheromone">
              </label>

              <label class="mtal-sw full">
                <input type="checkbox" id="f-npc">
                <i></i>
                Só abaixo do preço do NPC
              </label>
            </div>

            <label>
              <span>Preço máximo</span>
              <input type="number" id="f-price" min="0" placeholder="sem limite">
            </label>

            <label>
              <span>Moeda</span>
              <select id="f-cur"></select>
            </label>

            <div id="f-shiny-row" class="full">
              <label class="mtal-sw">
                <input type="checkbox" id="f-shiny">
                <i></i>
                Só shiny ✨
              </label>
            </div>
          </div>

          <div class="mtal-fhint">Campos vazios = sem limite. Com a moeda "qualquer", o preço compara só o número.</div>

          <div class="mtal-form-actions">
            <button type="button" id="f-cancel">Cancelar</button>
            <button type="button" id="f-save" class="mtal-primary">Salvar alerta</button>
          </div>
        </div>

        <div class="mtal-tabs">
          <button
            type="button"
            class="mtal-tab active"
            data-tab="hits"
          >
            Achados
          </button>

          <button
            type="button"
            class="mtal-tab"
            data-tab="purchased"
          >
            Comprados
          </button>

          <span style="flex:1"></span>

          <button
            id="mtal-clear"
            title="Limpar a lista atual"
          >
            Limpar
          </button>
        </div>
      </div>

      <div id="mtal-panel-body">
        <div id="mtal-hits"></div>
        <div
          id="mtal-purchased"
          hidden
        ></div>
      </div>

      <div id="mtal-footer">
        <span id="mtal-ver">Version ${VERSION}</span>
        <a id="mtal-upd" hidden target="_blank" rel="noopener"></a>
      </div>
    </div>

    <div id="mtal-mk" data-mode="buy">
      <div class="mk-head">
        <b>🏪 Mercado</b>

        <div class="mk-modes">
          <button type="button" class="mk-mode active" data-mode="buy">Comprar</button>
          <button type="button" class="mk-mode" data-mode="sell">Vender</button>
          <button type="button" class="mk-mode" data-mode="hist">Histórico</button>
        </div>

        <div class="mk-npcs">
          ${NPCS.map(
            (n) =>
              `<button type="button" class="mk-npc" data-npc="${esc(n.key)}" title="Abrir ${esc(n.title)}">${esc(n.label)}</button>`
          ).join('')}
        </div>

        <span style="flex:1"></span>

        <button type="button" id="mk-refresh" title="Atualizar">↻</button>
        <button type="button" id="mk-close" title="Fechar (Esc)">✕</button>
      </div>

      <div class="mk-body mk-buyv">
        <nav class="mk-side">
          ${MK_CATS.map(
            ([v, l]) =>
              `<button type="button" class="mk-cat" data-cat="${esc(v)}"><i>${MK_CAT_ICON[v] || ''}</i><span>${esc(l)}</span></button>`
          ).join('')}

          <div class="mk-wallet" id="mk-wallet">
            <b id="mk-nick">-</b>
            <span>$ <em id="mk-gold">-</em></span>
            <span>💎 <em id="mk-dia">-</em></span>
          </div>
        </nav>

        <aside class="mk-fcol" id="mk-filters">
          <div class="mk-fhead">
            <span class="mk-fh">Filtros</span>
            <button type="button" id="mk-clear" class="mk-link">Limpar</button>
          </div>

          <div class="mk-fgroup">
            <div class="mk-search">
              <i>⌕</i>
              <input type="text" id="mk-q" autocomplete="off">
            </div>
          </div>

          <div class="mk-fgroup mk-poke">
            <div class="mk-flabel">IV total</div>
            <div class="mk-range">
              <input type="text" id="mk-iv1" placeholder="mín" inputmode="numeric">
              <i>–</i>
              <input type="text" id="mk-iv2" placeholder="máx" inputmode="numeric">
            </div>

            <div class="mk-flabel">Nível</div>
            <div class="mk-range">
              <input type="text" id="mk-lv1" placeholder="mín" inputmode="numeric">
              <i>–</i>
              <input type="text" id="mk-lv2" placeholder="máx" inputmode="numeric">
            </div>

            <div class="mk-flabel">Qualidade mínima</div>
            <div class="mk-prefix"><b>×</b><input type="text" id="mk-qmin" placeholder="1.40" inputmode="decimal"></div>
          </div>

          <div class="mk-fgroup mk-poke">
            <div class="mk-flabel">Tipo</div>
            <select id="mk-type">
              <option value="">Todos os tipos</option>
              ${Object.entries(RP_TYPE_PT)
                .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`)
                .join('')}
            </select>

            <div class="mk-flabel">Raridade</div>
            <div class="mk-chips" id="mk-chips">
              ${QUALITY_TIERS.slice()
                .reverse()
                .map(([, l]) => {
                  const c = RARITY_COLOR[l.toLowerCase()] || '#c7cbe0';

                  return `<button type="button" class="mk-chip" data-r="${esc(l)}" style="color:${c}">${esc(l)}</button>`;
                })
                .join('')}
            </div>

            <label class="mk-switch">
              <input type="checkbox" id="mk-shiny">
              <i></i>
              Só shiny ✨
            </label>
          </div>

          <div class="mk-fgroup mk-item">
            <label class="mk-switch">
              <input type="checkbox" id="mk-npc">
              <i></i>
              Abaixo do preço do NPC
            </label>
          </div>

          <div class="mk-fgroup">
            <div class="mk-flabel">Preço máximo</div>
            <select id="mk-cur">
              <option value="">Todas as moedas</option>
              <option value="GOLD">$ Dólares</option>
              <option value="DIAMONDS">💎 Diamantes</option>
            </select>

            <div class="mk-prefix" id="mk-pg-wrap"><b>$</b><input type="text" id="mk-pmax-g" placeholder="sem limite" inputmode="numeric"></div>
            <div class="mk-prefix" id="mk-pd-wrap"><b>💎</b><input type="text" id="mk-pmax-d" placeholder="sem limite" inputmode="numeric"></div>
          </div>
        </aside>

        <section class="mk-res">
          <div class="mk-table-wrap">
            <table>
              <thead id="mk-thead"></thead>
              <tbody id="mk-tbody"></tbody>
            </table>
          </div>

          <div class="mk-foot">
            <span id="mk-count"></span>
            <span style="flex:1"></span>
            <button type="button" id="mk-more">Carregar mais</button>
          </div>
        </section>
      </div>

      <div id="mk-sell" class="mk-sellv">
        <div class="mk-sec sl-anun">
          <div class="mk-sec-h">Anunciar</div>

          <div class="mk-form">
            <div class="mk-seg" id="sl-kinds">
              <button type="button" class="on" data-kind="item">Itens</button>
              <button type="button" data-kind="pokemon">Pokémon</button>
            </div>

            <input type="text" id="sl-filter" placeholder="Filtrar por nome…" autocomplete="off">

            <div class="mk-seg" id="sl-views">
              <button type="button" data-view="grid" title="Grade">▦</button>
              <button type="button" data-view="list" title="Lista">☰</button>
            </div>

            <span id="sl-hint" class="mk-dim"></span>
          </div>

          <div class="mk-form sl-pf" id="sl-pf" hidden>
            <span class="mk-f">
              IV
              <input type="text" id="sl-iv1" placeholder="mín" inputmode="numeric">
              –
              <input type="text" id="sl-iv2" placeholder="máx" inputmode="numeric">
            </span>

            <span class="mk-f">
              Nv
              <input type="text" id="sl-lv1" placeholder="mín" inputmode="numeric">
              –
              <input type="text" id="sl-lv2" placeholder="máx" inputmode="numeric">
            </span>

            <span class="mk-f">
              × ≥
              <input type="text" id="sl-qmin" placeholder="1.40" inputmode="decimal">
            </span>

            <label class="mk-chk">
              <input type="checkbox" id="sl-shiny">
              ✨ Shiny
            </label>

            <span class="mk-f">
              Ordenar
              <select id="sl-sort">
                <option value="name">Nome</option>
                <option value="lvl">Nível ↓</option>
                <option value="iv">IV ↓</option>
                <option value="q">Qualidade ↓</option>
              </select>
            </span>

            <div class="mk-chips" id="sl-rar">
              ${QUALITY_TIERS.slice()
                .reverse()
                .map(([, l]) => {
                  const c = RARITY_COLOR[l.toLowerCase()] || '#c7cbe0';

                  return `<button type="button" class="mk-chip" data-r="${esc(l)}" style="color:${c};border-color:${c}">${esc(l)}</button>`;
                })
                .join('')}
            </div>
          </div>

          <div class="sl-grid" id="sl-grid"></div>

        </div>

        <div class="mk-sec sl-minesec">
          <div class="mk-sec-h mk-coll" id="sl-mine-h">
            <span id="sl-mine-caret">▾</span>
            Meus anúncios
            <span id="sl-mine-n" class="mk-dim"></span>
          </div>

          <div id="sl-mine-wrap">
            <table>
              <tbody id="sl-mine"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="mk-npc" class="mk-npcv">
        <div class="npc-head">
          <b id="npc-title"></b>
          <span id="npc-info" class="mk-dim"></span>
          <span style="flex:1"></span>
          <input type="text" id="npc-filter" placeholder="Filtrar por nome…" autocomplete="off">
          <button type="button" id="npc-game" title="Abrir a janela original do jogo">Abrir no jogo</button>
        </div>

        <div id="npc-body"></div>
      </div>

      <div id="mk-hist" class="mk-histv">
        <div class="hist-cols">
          <div class="mk-sec">
            <div class="mk-sec-h">Compras <span id="hs-buy-n" class="mk-dim"></span></div>

            <table>
              <tbody id="hs-buy"></tbody>
            </table>
          </div>

          <div class="mk-sec">
            <div class="mk-sec-h">Vendas <span id="hs-sell-n" class="mk-dim"></span></div>

            <table>
              <tbody id="hs-sell"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div id="mtal-details">
      <div class="mtal-d-head">
        <b>
          ◆ Detalhes do Anúncio
        </b>

        <button id="mtal-d-close">
          ✕
        </button>
      </div>

      <div id="mtal-d-body"></div>
    </div>
  `;

  document.body.appendChild(
    root
  );

  function renderBadge() {
    const b =
      $('mtal-badge');

    b.hidden =
      unseen <= 0;

    b.textContent =
      unseen;
  }

  /* ---------- ACHADOS ---------- */
  function hitMiniThumb(h) {
    if (h.kind !== 'pokemon') return null;

    const sp = rpSprite(h, rpCreature(h));

    return sp
      ? `<img src="${esc(sp.anim)}" data-fb="${esc(sp.still)}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.parentElement.textContent='❔'}">`
      : null;
  }

  function hitMiniDesc(h) {
    const r = h.raw || {};
    const c = rpCreature(h);
    let types = typesOf(r);

    if (!types.length && c) types = [c.type1, c.type2].filter(Boolean);

    const lvl = levelOf({ ...r, name: h.name });
    const rar = rarityOf(h);
    const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';
    const pct = h.ivTotal != null ? (Number(h.ivTotal) / 192) * 100 : null;
    const cls = pct != null ? RP_CLASS.find((x) => pct >= x[0]) : null;

    return (
      `<div class="mtal-hit-name">${esc(stripLv(h.name))}${h.shiny ? ' ✨' : ''}${
        lvl != null ? ` <span class="mtal-hit-lv">Nv ${esc(lvl)}</span>` : ''
      }</div>` +
      (types.length ? `<div class="mtal-hit-types">${types.map((t) => rpTypeBadge(t, true)).join('')}</div>` : '') +
      `<div class="mtal-hit-sub">IV <span style="color:#f2ead0">${esc(h.ivTotal != null ? h.ivTotal : '-')}</span>/192` +
      (rar ? ` · <span style="color:${rc}">${esc(rar)}${h.quality != null ? ' ×' + Number(h.quality).toFixed(2) : ''}</span>` : '') +
      `</div>` +
      (cls
        ? `<div class="mtal-hit-ivbar" title="${Math.round(pct)}% · ${esc(cls[1])}"><i style="width:${Math.min(100, pct)}%;background:${cls[2]}"></i></div>`
        : '')
    );
  }

  function lsPokeCard(h, time) {
    const v = rpInit(h);
    const R = rpCompute(v);
    const r = h.raw || {};
    let types = typesOf(r);

    if (!types.length && v.c) types = [v.c.type1, v.c.type2].filter(Boolean);

    const rar = rarityOf(h);
    const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';
    const cls = R.cls || [0, '-', '#6b7089', ''];
    const est = R.est && v.level < 15;

    return `<div class="mtal-hit lsp" data-hid="${h.hid}">
      <div class="lsp-sp">
        <div class="mtal-hit-thumb" data-hid="${h.hid}">${hitMiniThumb(h) || thumbHtml(h)}</div>
        <div class="mtal-hit-date">${time}</div>
      </div>

      <div class="lsp-id">
        <div class="mtal-hit-name">${esc(stripLv(h.name))}${h.shiny ? ' ✨' : ''} <span class="mtal-hit-lv">Nv ${esc(v.level)}</span></div>
        ${types.length ? `<div class="mtal-hit-types">${types.map((t) => rpTypeBadge(t, true)).join('')}</div>` : ''}
        ${rar ? `<div class="lsp-q" style="color:${rc}">${esc(rar)}${h.quality != null ? ' ×' + Number(h.quality).toFixed(2) : ''}</div>` : ''}
        <div class="mtal-hit-price">${esc(h.offerOnly ? 'Apenas ofertas' : [currencyIcon(h.currency), fmt(h.price)].filter(Boolean).join(' '))}</div>
      </div>

      <div class="lsp-block">
      <div class="lsp-grade">
        <div class="lsp-ring" style="--c:${cls[2]};--d:${R.pct != null ? Math.min(100, R.pct) * 3.6 : 0}deg"><b>${R.pct != null ? Math.round(R.pct) + '%' : '-'}</b></div>
        <div>
          <div class="lsp-cls" style="color:${cls[2]}" title="${esc(cls[1])}">${esc(cls[1])}</div>
          <div class="lsp-kv">IV <b class="lsp-ivt">${R.ivTotal != null ? esc(R.ivTotal) : '-'}</b>/192</div>
          <div class="lsp-kv">Poder est. <b class="lsp-pow">${R.power != null ? fmt(Math.round(R.power)) : '-'}</b></div>
        </div>
      </div>

      <div class="lsp-stats${est ? ' est' : ''}"${est ? ' title="Estimativa imprecisa (Nv abaixo de 15)"' : ''}>
        ${['hp', 'def', 'spd', 'atk', 'spa', 'vel'].map((k) => {
          const iv = R.ivs[k];

          return `<div class="lsp-stat" style="--c:${RP_COLOR[k]}">
            <div><b>${RP_LABEL[k]}</b><em>${iv == null ? '-' : Number.isInteger(iv) ? iv : iv.toFixed(1)}</em></div>
            <i><u style="width:${iv == null ? 0 : Math.min(100, (iv / 32) * 100)}%"></u></i>
          </div>`;
        }).join('')}
      </div>
      </div>

      <div class="mtal-hit-actions lsp-acts">
        <button type="button" class="mtal-view${h.hid === detailsHid ? ' active' : ''}" data-hid="${h.hid}" title="Detalhes">${EYE_SVG}</button>
        ${h.buyable ? `<button type="button" class="mtal-buy" data-hid="${h.hid}" title="Comprar">🛒</button>` : ''}
      </div>
    </div>`;
  }

  function renderHits() {
    if (!rpCre && hits.some((h) => h.kind === 'pokemon')) {
      rpLoadCreatures().then((ok) => {
        if (ok) renderHits();
      });
    }

    const t = (ms) =>
      new Date(ms).toLocaleTimeString(
        'pt-BR'
      );

    $('mtal-hits').innerHTML =
      hits.length
        ? hits
            .map(
              (h) => h.kind === 'pokemon' ? lsPokeCard(h, t(h.t)) : `
        <div
          class="mtal-hit"
          data-hid="${h.hid}"
        >
          <div class="mtal-hit-thumb-wrap">
            <div
              class="mtal-hit-thumb"
              data-hid="${h.hid}"
            >
              ${hitMiniThumb(h) || thumbHtml(h)}
            </div>

            <div
              class="mtal-hit-alert"
              title="${esc(h.alert)}"
            >
              ${esc(h.kind === 'pokemon' ? 'Pokémon' : catLabel(h.category) || 'Item')}
            </div>

            <div class="mtal-hit-date">
              ${t(h.t)}
            </div>
          </div>

          <div class="mtal-hit-main">
            <div class="mtal-hit-desc">
              ${h.kind === 'pokemon' ? hitMiniDesc(h) : hitDesc(h)}
            </div>

            <div class="mtal-hit-price">
              ${esc(hitPrice(h))}
            </div>
          </div>

          <div class="mtal-hit-actions">
            <button
              type="button"
              class="mtal-view${
                h.hid === detailsHid
                  ? ' active'
                  : ''
              }"
              data-hid="${h.hid}"
              title="Detalhes"
            >
              ${EYE_SVG}
            </button>

            ${
              h.buyable
                ? `<button
                    type="button"
                    class="mtal-buy"
                    data-hid="${h.hid}"
                    title="Comprar"
                  >
                    🛒
                  </button>`
                : ''
            }
          </div>
        </div>
      `
            )
            .join('')
        : `
          <div class="mtal-emptycard">
            <div class="ic">🔔</div>
            <b>Nenhum achado ainda</b>
            <p>Quando um anúncio novo bater com um dos seus alertas, ele aparece aqui.</p>
            ${
              !state.on
                ? '<small>A LiveSearch está desligada. Ative no topo para voltar a monitorar.</small>'
                : state.alerts.some((a) => a.enabled)
                  ? `<small><span class="mtal-dot ok"></span>Monitorando ${state.alerts.filter((a) => a.enabled).length} alerta(s)…</small>`
                  : '<button type="button" class="mtal-primary" data-empty-new>Criar alerta</button>'
            }
          </div>
        `;

    hits.filter((h) => !hitMiniThumb(h)).forEach(
      ensureSprite
    );
  }

  /* ---------- COMPRADOS ---------- */
  function renderPurchased() {
    const t = (ms) =>
      new Date(ms).toLocaleTimeString(
        'pt-BR'
      );

    $('mtal-purchased').innerHTML =
      state.purchased.length
        ? state.purchased
            .map(
              (h) => `
        <div
          class="mtal-hit"
          data-hid="${h.hid}"
        >
          <div class="mtal-hit-thumb-wrap">
            <div
              class="mtal-hit-thumb"
              data-hid="${h.hid}"
            >
              ${thumbHtml(h)}
            </div>

            <div
              class="mtal-hit-alert"
              title="${esc(h.alert)}"
            >
              ${esc(h.kind === 'pokemon' ? 'Pokémon' : catLabel(h.category) || 'Item')}
            </div>

            <div class="mtal-hit-date">
              ${t(
                h.purchasedAt ||
                  h.t
              )}
            </div>
          </div>

          <div class="mtal-hit-main">
            <div class="mtal-hit-desc">
              ${hitDesc(h)}
            </div>

            <div class="mtal-hit-price">
              ${esc(hitPrice(h))}
            </div>
          </div>

          <div class="mtal-hit-actions">
            <button
              type="button"
              class="mtal-mkt"
              data-hid="${h.hid}"
              title="Abrir no Market"
            >
              ⚖️
            </button>

            <button
              type="button"
              class="mtal-view mtal-view-p${
                h.hid === detailsHid
                  ? ' active'
                  : ''
              }"
              data-hid="${h.hid}"
              title="Detalhes"
            >
              ${EYE_SVG}
            </button>
          </div>
        </div>
      `
            )
            .join('')
        : `
          <div class="mtal-empty">
            Nenhuma compra ainda.
          </div>
        `;

    state.purchased.forEach(
      ensureSprite
    );
  }

  function renderList() {
    const el =
      $('mtal-list');

    const total =
      state.alerts.length;

    const activeCount =
      state.alerts.filter(
        (a) => a.enabled
      ).length;

    $('mtal-alerts-count')
      .textContent =
      '(' +
      activeCount +
      '/' +
      total +
      ' ativos)';

    if (!total) {
      el.innerHTML = `
        <div class="mtal-empty">
          Nenhum alerta ainda. Use “＋ Criar alerta”.
        </div>
      `;

      return;
    }

    el.innerHTML =
      state.alerts
        .map((a) => {
          const rt =
            rtOf(a.id);

          const status =
            !a.enabled
              ? 'pausado'
              : rt.err
                ? '⚠ ' +
                  esc(
                    rt.err
                  )
                : rt.seen
                  ? 'ok · consultado há ' +
                    ago(
                      rt.last
                    )
                  : 'iniciando…';

          const st = !a.enabled || !state.on ? 'off' : rt.err ? 'err' : 'ok';

          return `
            <div class="mtal-row${st === 'off' ? ' off' : ''}">
              <label class="mtal-sw" title="Ativar/pausar este alerta">
                <input type="checkbox" data-t="${a.id}"${a.enabled ? ' checked' : ''}>
                <i></i>
              </label>

              <div class="mtal-row-body">
                <b>
                  ${esc(a.name)}
                </b>

                <div class="mtal-sub">
                  <span class="mtal-dot ${st}"></span>${!state.on && a.enabled ? 'pausado (LiveSearch desligado)' : status}
                </div>
              </div>

              <div class="mtal-row-actions">
                <button type="button" class="mtal-ib" data-e="${a.id}" title="Editar">✎</button>
                <button type="button" class="mtal-ib del" data-d="${a.id}" title="Excluir">✕</button>
              </div>
            </div>
          `;
        })
        .join('');
  }

  async function loadSpecies() {
    try {
      const d =
        await api(
          '?browse=species',
          10 * 60 * 1000
        );

      species =
        (d &&
          d.species) ||
        [];

      $('mtal-species')
        .innerHTML =
        species
          .map(
            (s) =>
              `<option value="${esc(
                s.name
              )}"></option>`
          )
          .join('');
    } catch (e) {
      log(
        'espécies:',
        e.message
      );
    }
  }

  function resolveSpecies(
    txt
  ) {
    txt =
      txt
        .trim()
        .toLowerCase();

    if (!txt) return null;

    const found =
      (species || []).find(
        (s) =>
          s.name.toLowerCase() ===
          txt
      );

    if (found) {
      return found;
    }

    if (
      /^\d+$/.test(txt)
    ) {
      return {
        speciesId: +txt,
        name: '#' + txt
      };
    }

    return undefined;
  }

  const num = (id) => {
    const v =
      parseFloat(
        String(
          $(id).value
        ).replace(',', '.')
      );

    return Number.isFinite(v) &&
      v > 0
      ? v
      : null;
  };

  function autoName(a) {
    const bits = [];

    if (
      a.kind === 'pokemon'
    ) {
      bits.push(
        a.speciesName ||
          'Pokémon'
      );

      if (a.ivMin) {
        bits.push(
          'IV≥' +
            a.ivMin
        );
      }

      if (a.qMin) {
        bits.push(
          '×≥' +
            a.qMin
        );
      }

      if (
        a.shinyOnly
      ) {
        bits.push('✨');
      }
    } else {
      bits.push(
        a.text ||
          catLabel(
            a.category
          )
      );

      if (
        a.belowNpc
      ) {
        bits.push(
          '<NPC'
        );
      }
    }

    if (
      a.maxPrice != null
    ) {
      bits.push(
        '≤' +
          fmt(
            a.maxPrice
          ) +
          ' ' +
          curLabel(
            a.currency
          )
      );
    }

    return bits.join(
      ' '
    );
  }

  let editingId = null;

  function openForm(a) {
    editingId =
      a
        ? a.id
        : null;

    $('mtal-form').hidden =
      false;

    $('f-title')
      .textContent =
      a
        ? 'Editando: ' +
          a.name
        : 'Novo alerta';

    $('f-save')
      .textContent =
      a
        ? 'Salvar alterações'
        : 'Salvar alerta';

    const curs =
      new Set(
        knownCurrencies
      );

    if (
      a &&
      a.currency
    ) {
      curs.add(
        a.currency
      );
    }

    $('f-cur')
      .innerHTML =
      '<option value="">qualquer</option>' +
      [...curs]
        .map(
          (c) =>
            `<option value="${esc(
              c
            )}">${esc(
              curLabel(c)
            )}</option>`
        )
        .join('');

    const kind =
      a
        ? a.kind
        : 'pokemon';

    $('f-kind').value =
      kind;

    $('f-poke').hidden =
      kind !==
      'pokemon';

    $('f-item').hidden =
      kind ===
      'pokemon';

    $('f-shiny-row')
      .hidden =
      kind !==
      'pokemon';

    const isPoke =
      !!a &&
      a.kind ===
        'pokemon';

    const isItem =
      !!a &&
      a.kind ===
        'items';

    $('f-species')
      .value =
      isPoke &&
      a.speciesId
        ? String(
            a.speciesName ||
              ''
          )[0] === '#'
          ? String(
              a.speciesId
            )
          : a.speciesName
        : '';

    $('f-iv').value =
      isPoke &&
      a.ivMin
        ? a.ivMin
        : '';

    $('f-q').value =
      isPoke &&
      a.qMin
        ? a.qMin
        : '';

    $('f-shiny')
      .checked =
      isPoke &&
      !!a.shinyOnly;

    $('f-cat').value =
      isItem
        ? a.category
        : CATEGORIES[0];

    $('f-text').value =
      isItem
        ? a.text || ''
        : '';

    $('f-npc')
      .checked =
      isItem &&
      !!a.belowNpc;

    $('f-price').value =
      a &&
      a.maxPrice != null
        ? a.maxPrice
        : '';

    $('f-cur').value =
      a &&
      a.currency
        ? a.currency
        : '';

    if (!species) {
      loadSpecies();
    }

    $('mtal-form')
      .scrollIntoView({
        block: 'nearest'
      });
  }

  $('mtal-fab')
    .addEventListener(
      'click',
      () => {
        panelOpen =
          !panelOpen;

        $('mtal-panel')
          .style.display =
          panelOpen
            ? 'block'
            : 'none';

        if (panelOpen) {
          unseen = 0;
          renderBadge();
          renderList();
        }
      }
    );

  $('mtal-close')
    .addEventListener(
      'click',
      () => {
        panelOpen = false;

        $('mtal-panel')
          .style.display =
          'none';

        hideDetails();
      }
    );

  /* ---------- arrastar ---------- */
  (function enableDrag() {
    const handle =
      $('mtal-drag-handle');

    const panel =
      $('mtal-panel');

    let dragging = false;
    let offX = 0;
    let offY = 0;

    function applyPos(
      left,
      top
    ) {
      const maxX =
        Math.max(
          0,
          window.innerWidth -
            panel.offsetWidth
        );

      const maxY =
        Math.max(
          0,
          window.innerHeight -
            panel.offsetHeight
        );

      left = Math.min(
        Math.max(
          0,
          left
        ),
        maxX
      );

      top = Math.min(
        Math.max(
          0,
          top
        ),
        maxY
      );

      panel.style.left =
        left + 'px';

      panel.style.top =
        top + 'px';

      panel.style.bottom =
        'auto';

      positionDetails();

      return {
        left,
        top
      };
    }

    if (
      state.panelPos &&
      Number.isFinite(
        state.panelPos.left
      ) &&
      Number.isFinite(
        state.panelPos.top
      )
    ) {
      applyPos(
        state.panelPos.left,
        state.panelPos.top
      );
    }

    handle.addEventListener(
      'mousedown',
      (e) => {
        dragging = true;

        const r =
          panel.getBoundingClientRect();

        applyPos(
          r.left,
          r.top
        );

        offX =
          e.clientX -
          r.left;

        offY =
          e.clientY -
          r.top;

        document.body.style.userSelect =
          'none';

        e.preventDefault();
      }
    );

    document.addEventListener(
      'mousemove',
      (e) => {
        if (!dragging) return;

        applyPos(
          e.clientX -
            offX,
          e.clientY -
            offY
        );
      }
    );

    document.addEventListener(
      'mouseup',
      () => {
        if (!dragging) return;

        dragging = false;

        document.body.style.userSelect =
          '';

        const r =
          panel.getBoundingClientRect();

        state.panelPos = {
          left: r.left,
          top: r.top
        };

        save();
      }
    );
  })();

  new ResizeObserver(positionDetails).observe($('mtal-panel'));

  /* ---------- aviso de versão nova ---------- */
  const UPDATE_URL = 'https://raw.githubusercontent.com/gnpohlmann/livesearch-dist/main/poke-idle-livesearch.user.js';

  const verNewer = (a, b) => {
    const x = String(a).split('.').map(Number);
    const y = String(b).split('.').map(Number);

    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }

    return false;
  };

  function checkUpdate() {
    if (typeof GM_xmlhttpRequest !== 'function') return;

    GM_xmlhttpRequest({
      method: 'GET',
      url: UPDATE_URL + '?t=' + Date.now(),
      onload: (res) => {
        const m = /@version\s+([\d.]+)/.exec((res && res.responseText) || '');
        const a = $('mtal-upd');

        if (!m || !a) return;

        a.hidden = !verNewer(m[1], VERSION);
        a.href = UPDATE_URL;
        a.title = 'Clique para instalar a versão ' + m[1];
        a.textContent = '⬆ ' + m[1] + ' disponível';
      }
    });
  }

  checkUpdate();
  setInterval(checkUpdate, 30 * 60 * 1000);

  const setBarPx = () => {
    const dpr = PW.devicePixelRatio || 1;

    document.documentElement.style.setProperty('--mtal-bar', Math.max(1, Math.round(4 * dpr)) / dpr + 'px');
  };

  setBarPx();
  window.addEventListener('resize', setBarPx);
  new ResizeObserver(positionDetails).observe($('mtal-mk'));
  window.addEventListener('resize', positionDetails);

  /* ---------- ativar/desativar ---------- */
  function setOn(v) {
    state.on = v;

    $('mtal-on')
      .checked = v;

    save();
    renderList();
    renderHits();

    toast(
      v
        ? 'Alertas ativados'
        : 'Alertas pausados',
      'onoff'
    );
  }

  function setFabHidden(
    hidden
  ) {
    state.fabHidden =
      hidden;

    save();

    $('mtal-fab')
      .style.display =
      hidden
        ? 'none'
        : '';

    if (hidden) {
      panelOpen = false;

      $('mtal-panel')
        .style.display =
        'none';
    }
  }

  $('mtal-on')
    .checked =
    state.on;

  $('mtal-fab')
    .style.display =
    state.fabHidden
      ? 'none'
      : '';

  $('mtal-on')
    .addEventListener(
      'change',
      (e) =>
        setOn(
          e.target.checked
        )
    );

  document.addEventListener(
    'keydown',
    (e) => {
      if (
        !e.altKey ||
        e.ctrlKey ||
        e.metaKey
      ) {
        return;
      }

      if (
        e.code ===
        'KeyF'
      ) {
        e.preventDefault();

        const v =
          !state.on;

        setOn(v);
        setFabHidden(
          !v
        );

        toast(
          v
            ? 'Botão de alertas: visível'
            : 'Botão de alertas: oculto (Alt+F pra trazer de volta)',
          'fab'
        );
      }
    }
  );

  $('mtal-mute')
    .textContent =
    state.muted
      ? '🔇'
      : '🔊';

  $('mtal-mute')
    .addEventListener(
      'click',
      () => {
        state.muted =
          !state.muted;

        $('mtal-mute')
          .textContent =
          state.muted
            ? '🔇'
            : '🔊';

        save();

        if (!state.muted) {
          beep();
        }
      }
    );

  $('mtal-sound')
    .innerHTML =
    Object.entries(
      SOUND_PRESETS
    )
      .map(
        ([id, p]) =>
          `<option value="${esc(
            id
          )}">${esc(
            p.label
          )}</option>`
      )
      .join('');

  $('mtal-sound')
    .value =
    SOUND_PRESETS[
      state.soundId
    ]
      ? state.soundId
      : 'chime';

  $('mtal-sound')
    .addEventListener(
      'change',
      (e) => {
        state.soundId =
          e.target.value;

        save();

        beep(true);
      }
    );

  $('mtal-osnotify')
    .title =
    'Notificação do Windows/navegador';

  $('mtal-osnotify')
    .textContent =
    state.notifyOS
      ? '🔔'
      : '🔕';

  $('mtal-osnotify')
    .addEventListener(
      'click',
      () => {
        state.notifyOS =
          !state.notifyOS;

        $('mtal-osnotify')
          .textContent =
          state.notifyOS
            ? '🔔'
            : '🔕';

        save();

        if (
          state.notifyOS
        ) {
          try {
            if (
              PW.Notification &&
              PW.Notification
                .permission ===
                'default'
            ) {
              PW.Notification
                .requestPermission();
            }
          } catch (e) {}
        }
      }
    );

  $('mtal-d-close')
    .addEventListener(
      'click',
      hideDetails
    );

  $('mtal-new')
    .addEventListener(
      'click',
      () => openForm()
    );

  $('mtal-alerts-toggle')
    .addEventListener(
      'click',
      () => {
        const collapsed =
          ($('mtal-list')
            .hidden =
            !$('mtal-list')
              .hidden);

        $('mtal-alerts-caret')
          .textContent =
          collapsed
            ? '▸'
            : '▾';

        store.set(
          'alertsCollapsed',
          collapsed
        );
      }
    );

  if (
    store.get(
      'alertsCollapsed',
      false
    )
  ) {
    $('mtal-list')
      .hidden = true;

    $('mtal-alerts-caret')
      .textContent =
      '▸';
  }

  $('f-cancel')
    .addEventListener(
      'click',
      () => {
        editingId = null;

        $('mtal-form')
          .hidden = true;
      }
    );

  $('f-x').addEventListener('click', () => $('f-cancel').click());

  $('f-kind')
    .addEventListener(
      'change',
      (e) => {
        $('f-poke')
          .hidden =
          e.target.value !==
          'pokemon';

        $('f-item')
          .hidden =
          e.target.value ===
          'pokemon';

        $('f-shiny-row')
          .hidden =
          e.target.value !==
          'pokemon';
      }
    );

  $('mtal-hits')
    .addEventListener(
      'click',
      (e) => {
        if (e.target.closest('[data-empty-new]')) return openForm();

        const buyBtn =
          e.target.closest(
            '.mtal-buy'
          );

        if (buyBtn) {
          handleBuyClick(
            +buyBtn.dataset
              .hid,
            buyBtn
          );

          return;
        }

        const viewBtn =
          e.target.closest(
            '.mtal-view'
          );

        if (viewBtn) {
          const h =
            hits.find(
              (x) =>
                x.hid ===
                +viewBtn.dataset
                  .hid
            );

          if (h) {
            showDetails(h);
          }
        }
      }
    );

  $('mtal-purchased')
    .addEventListener(
      'click',
      (e) => {
        const mktBtn =
          e.target.closest(
            '.mtal-mkt'
          );

        if (mktBtn) {
          const h =
            state.purchased.find(
              (x) =>
                x.hid ===
                +mktBtn.dataset
                  .hid
            );

          if (h) {
            tryNavigateToListing(h);
          }

          return;
        }

        const viewBtn =
          e.target.closest(
            '.mtal-view'
          );

        if (viewBtn) {
          const h =
            state.purchased.find(
              (x) =>
                x.hid ===
                +viewBtn.dataset
                  .hid
            );

          if (h) {
            showDetails(h);
          }
        }
      }
    );

  document
    .querySelectorAll(
      '.mtal-tab'
    )
    .forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          activeTab =
            btn.dataset.tab;

          document
            .querySelectorAll(
              '.mtal-tab'
            )
            .forEach(
              (b) =>
                b.classList.toggle(
                  'active',
                  b === btn
                )
            );

          $('mtal-hits')
            .hidden =
            activeTab !==
            'hits';

          $('mtal-purchased')
            .hidden =
            activeTab !==
            'purchased';

          $('mtal-clear')
            .title =
            activeTab ===
            'hits'
              ? 'Limpar a lista de achados'
              : 'Limpar o histórico de compras';

          if (
            activeTab ===
            'purchased'
          ) {
            renderPurchased();
          }
        }
      );
    });

  $('mtal-clear')
    .addEventListener(
      'click',
      () => {
        if (
          activeTab ===
          'purchased'
        ) {
          state.purchased
            .length = 0;

          save();
          renderPurchased();

          return;
        }

        hits.length = 0;
        unseen = 0;

        renderHits();
        renderBadge();
      }
    );

  $('mtal-list')
    .addEventListener(
      'change',
      (e) => {
        const id =
          e.target.dataset &&
          e.target.dataset.t;

        const a =
          id &&
          state.alerts.find(
            (x) =>
              x.id === id
          );

        if (!a) return;

        a.enabled =
          e.target.checked;

        if (a.enabled) {
          const rt =
            rtOf(a.id);

          rt.seen = null;
          rt.next = 0;
        }

        save();
        renderList();
      }
    );

  $('mtal-list')
    .addEventListener(
      'click',
      (e) => {
        const act = e.target.closest && e.target.closest('[data-e],[data-d]');
        const ds = (act && act.dataset) || {};

        if (ds.e) {
          const target =
            state.alerts.find(
              (x) =>
                x.id === ds.e
            );

          if (target) {
            openForm(
              target
            );
          }

          return;
        }

        const id = ds.d;

        if (!id) return;

        state.alerts =
          state.alerts.filter(
            (x) =>
              x.id !== id
          );

        runtime.delete(id);

        save();
        renderList();
      }
    );

  $('f-save')
    .addEventListener(
      'click',
      () => {
        const kind =
          $('f-kind')
            .value;

        const old =
          editingId &&
          state.alerts.find(
            (x) =>
              x.id ===
              editingId
          );

        const a = {
          id: old
            ? old.id
            : 'a' +
              Date.now()
                .toString(36),

          kind,

          enabled: old
            ? old.enabled
            : true,

          maxPrice:
            num('f-price'),

          currency:
            null
        };

        if (
          a.maxPrice !=
          null
        ) {
          a.currency =
            $('f-cur').value ||
            null;
        }

        if (
          kind ===
          'pokemon'
        ) {
          const txt =
            $('f-species')
              .value;

          const sp =
            resolveSpecies(
              txt
            );

          if (
            txt.trim() &&
            !sp
          ) {
            return toast(
              'Espécie não encontrada: escolha uma da lista.'
            );
          }

          a.speciesId =
            sp
              ? sp.speciesId
              : null;

          a.speciesName =
            sp
              ? sp.name
              : '';

          a.ivMin =
            num('f-iv');

          a.qMin =
            num('f-q');

          a.shinyOnly =
            $('f-shiny')
              .checked;
        } else {
          a.category =
            $('f-cat').value;

          a.text =
            $('f-text')
              .value
              .trim();

          a.belowNpc =
            $('f-npc')
              .checked;
        }

        a.name =
          autoName(a);

        if (old) {
          state.alerts[
            state.alerts.indexOf(
              old
            )
          ] = a;
        } else {
          state.alerts.push(
            a
          );
        }

        save();

        const rt =
          rtOf(a.id);

        rt.seen = null;
        rt.next = 0;
        rt.err = '';

        editingId = null;

        $('mtal-form')
          .hidden = true;

        renderList();

        try {
          if (
            PW.Notification &&
            PW.Notification
              .permission ===
              'default'
          ) {
            PW.Notification
              .requestPermission();
          }
        } catch (e) {}

        toast(
          (
            old
              ? 'Alerta atualizado: '
              : 'Alerta criado: '
          ) +
            a.name
        );
      }
    );

  /* ---------- MERCADO ---------- */
  const mk = {
    cat: 'all',
    rows: [],
    page: 1,
    done: false,
    loading: false,
    req: 0,
    key: '',
    err: '',
    sort: { k: null, dir: -1 },
    rar: new Set(),
    mode: 'buy',
    view: store.get('mkView', 'list')
  };

  const mkNum = (id, int) => {
    let s = String($(id).value || '').trim();

    if (!s) return null;

    s = int
      ? s.replace(/[.\s]/g, '').replace(',', '.')
      : s.replace(',', '.');

    const v = parseFloat(s);

    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  const qNum = (id) => {
    const s = String($(id).value || '').trim().replace(',', '.');

    if (!s) return null;

    const v = /^\d{2,}$/.test(s) ? Number(s) / Math.pow(10, s.length - 1) : parseFloat(s);

    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  const qFormat = (e) => {
    const el = e.target;

    if (!el || !['sl-qmin', 'mk-qmin'].includes(el.id)) return;

    const v = String(el.value).trim();

    if (/^\d{2,}$/.test(v)) el.value = v[0] + '.' + v.slice(1);
  };

  document.addEventListener('input', qFormat, true);

  const levelOf = (l) => {
    const v = pick(l, ['level', 'lvl', 'nivel']);

    if (v != null) return Number(v);

    const m = /Lv\.?\s*(\d+)/i.exec(l.name || '');

    return m ? +m[1] : null;
  };

  const rarityOf = (h) =>
    pick(h.raw || {}, ['rarity', 'raridade', 'tier', 'rarityName', 'rarityTier', 'grade', 'rank']) ||
    qualityTier(h.quality);

  const typesOf = (r) => {
    const t =
      r.types ||
      r.tipos ||
      r.elementTypes ||
      r.elements ||
      [r.type1 || r.tipo1, r.type2 || r.tipo2].filter(Boolean);

    return (Array.isArray(t) ? t : [t])
      .map((x) => (x && typeof x === 'object' ? x.name || x.label || x.type : x))
      .filter(Boolean);
  };

  function mkFilters() {
    const text = $('mk-q').value.trim();
    const sp = mk.cat === 'pokemon' && text ? resolveSpecies(text) : null;

    return {
      text: text.toLowerCase(),
      speciesId: sp ? sp.speciesId : null,
      ivMin: mkNum('mk-iv1', true),
      ivMax: mkNum('mk-iv2', true),
      lvMin: mkNum('mk-lv1', true),
      lvMax: mkNum('mk-lv2', true),
      qMin: qNum('mk-qmin'),
      shiny: $('mk-shiny').checked,
      npc: $('mk-npc').checked,
      cur: $('mk-cur').value,
      type: $('mk-type').value,
      pmaxG: mkNum('mk-pmax-g', true),
      pmaxD: mkNum('mk-pmax-d', true)
    };
  }

  const mkServerKey = (f) =>
    [mk.cat, f.speciesId, f.ivMin, f.qMin].join('|');

  function mkHit(l) {
    const poke = l.kind === 'pokemon' || mk.cat === 'pokemon';
    const id = l.id || (Array.isArray(l.ids) && l.ids[0]) || null;

    return {
      hid: ++hitSeq,
      t: Date.now(),
      alert: 'Mercado',
      id,
      kind: poke ? 'pokemon' : 'items',
      category: poke ? null : l.category || mk.cat,
      name: l.name,
      price: l.price,
      currency: l.currency,
      offerOnly: !!l.offerOnly,
      shiny: !!l.shiny,
      ivTotal: l.ivTotal,
      quality: l.quality,
      quantity: l.quantity,
      belowNpc: !!l.belowNpc,
      lvl: levelOf(l),
      raw: l,
      buyable: !l.offerOnly && !!id
    };
  }

  async function mkLoad(reset) {
    const f = mkFilters();

    if (reset) {
      mk.rows = [];
      mk.page = 1;
      mk.done = false;
      mk.key = mkServerKey(f);
    } else if (mk.loading || mk.done) {
      return;
    }

    const req = ++mk.req;
    const cat = mk.cat;

    mk.loading = true;
    mk.err = '';
    mkRender();

    try {
      let list;

      if (cat === 'all') {
        const qs = CATEGORIES.map((c) => '?category=' + encodeURIComponent(c)).concat([
          '?browse=pokemon&page=1&sort=recent'
        ]);

        const res = await Promise.all(qs.map((q) => api(q).catch(() => null)));

        if (req !== mk.req) return;

        list = res.flatMap((d) => (d && d.listings) || []);
      } else {
        let q;

        if (cat === 'pokemon') {
          q = '?browse=pokemon&page=' + mk.page + '&sort=recent';

          if (f.speciesId) q += '&speciesId=' + f.speciesId;
          if (f.ivMin) q += '&ivMin=' + f.ivMin;
          if (f.qMin) q += '&qMin=' + f.qMin;
        } else {
          q = '?category=' + encodeURIComponent(cat);
        }

        const data = await api(q);

        if (req !== mk.req) return;

        list = (data && data.listings) || [];
      }

      rememberListings(list);

      const seen = new Set(mk.rows.map((h) => h.id));
      let added = 0;

      list.forEach((l) => {
        if (l.currency) knownCurrencies.add(l.currency);

        const h = mkHit(l);

        if (h.id != null && seen.has(h.id)) return;

        seen.add(h.id);
        mk.rows.push(h);
        added++;
      });

      if (cat !== 'pokemon' || !added) {
        mk.done = true;
      } else {
        mk.page++;
      }
    } catch (e) {
      if (req === mk.req) mk.err = String((e && e.message) || e);
    } finally {
      if (req === mk.req) {
        mk.loading = false;
        mkRender();
        mkAutoMore();
      }
    }
  }

  function mkClientFiltered() {
    const f = mkFilters();

    return !!(
      (f.text && !f.speciesId) ||
      f.ivMax != null ||
      f.lvMin != null ||
      f.lvMax != null ||
      f.shiny ||
      mk.rar.size ||
      f.type ||
      f.cur ||
      f.pmaxG != null ||
      f.pmaxD != null
    );
  }

  let mkAutoT = null;

  function mkAutoMore() {
    clearTimeout(mkAutoT);

    if (mk.cat !== 'pokemon' || mk.done || mk.loading || !mkClientFiltered()) return;
    if (mkVisible().length >= 60 || mk.page > 80) return;

    mkAutoT = setTimeout(() => mkLoad(false), 200);
  }

  function mkVisible() {
    const f = mkFilters();

    const out = mk.rows.filter((h) => {
      if (f.text && !f.speciesId && !String(h.name || '').toLowerCase().includes(f.text)) return false;

      if (h.kind === 'pokemon') {
        if (f.ivMin != null && !(h.ivTotal >= f.ivMin)) return false;
        if (f.ivMax != null && !(h.ivTotal <= f.ivMax)) return false;
        if (f.lvMin != null && !(h.lvl >= f.lvMin)) return false;
        if (f.lvMax != null && !(h.lvl <= f.lvMax)) return false;
        if (f.qMin != null && !(h.quality >= f.qMin)) return false;
        if (f.shiny && !h.shiny) return false;
        if (mk.rar.size && !mk.rar.has(rarityOf(h))) return false;
        if (f.type && !typesOf(h.raw || {}).some((t) => String(t).toLowerCase() === f.type)) return false;
      } else if (f.npc && !h.belowNpc) {
        return false;
      }

      if (f.cur && h.currency !== f.cur) return false;
      const lim = h.currency === 'DIAMONDS' ? f.pmaxD : h.currency === 'GOLD' ? f.pmaxG : null;

      if ((f.pmaxG != null || f.pmaxD != null) && h.offerOnly) return false;
      if (lim != null && !(h.price <= lim)) return false;

      return true;
    });

    const k = mk.sort.k;

    if (k) {
      const val = {
        price: (h) => (h.offerOnly ? Number.MAX_VALUE : h.price),
        iv: (h) => h.ivTotal,
        lvl: (h) => h.lvl,
        q: (h) => h.quality,
        qty: (h) => h.quantity
      }[k];

      out.sort((a, b) => {
        if (k === 'price' && a.currency !== b.currency) {
          return String(a.currency).localeCompare(String(b.currency));
        }

        const va = val(a) == null ? -Number.MAX_VALUE : val(a);
        const vb = val(b) == null ? -Number.MAX_VALUE : val(b);

        return (va - vb) * mk.sort.dir;
      });
    }

    return out;
  }

  function mkPokeCard(h, side) {
    const v = rpInit(h);
    const R = rpCompute(v);
    const r = h.raw || {};
    let types = typesOf(r);

    if (!types.length && v.c) types = [v.c.type1, v.c.type2].filter(Boolean);

    const sp = rpSprite(h, v.c);
    const rar = rarityOf(h);
    const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';
    const cls = R.cls || [0, '-', '#6b7089', ''];
    const est = R.est && v.level < 15;

    return `<div class="mkc">
      <div class="mkc-sp mtal-hit-thumb" data-hid="${h.hid}">${
        sp
          ? `<img src="${esc(sp.anim)}" data-fb="${esc(sp.still)}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.parentElement.textContent='❔'}">`
          : thumbHtml(h)
      }</div>

      <div class="mkc-id">
        <div class="mkc-name">${esc(stripLv(h.name))}${h.shiny ? ' ✨' : ''} <small>Nv ${esc(v.level)}</small></div>
        <div class="mkc-types">${types.map((t) => rpTypeBadge(t, true)).join('')}</div>
        ${rar ? `<div class="mkc-q" style="color:${rc}">${esc(rar)}${h.quality != null ? ' ×' + Number(h.quality).toFixed(2) : ''}</div>` : ''}
      </div>

      <div class="mkc-grade">
        <div class="rp-ring" style="--c:${cls[2]};--d:${R.pct != null ? Math.min(100, R.pct) * 3.6 : 0}deg"><b>${R.pct != null ? Math.round(R.pct) + '%' : '-'}</b></div>
        <div>
          <div class="mkc-cls" style="color:${cls[2]}">${esc(cls[1])}</div>
          <div class="mkc-kv">IV <b class="rp-ivt">${R.ivTotal != null ? esc(R.ivTotal) : '-'}</b>/192</div>
          <div class="mkc-kv">Poder est. <b class="rp-pow">${R.power != null ? fmt(Math.round(R.power)) : '-'}</b></div>
        </div>
      </div>

      <div class="mkc-stats${est ? ' est' : ''}"${est ? ' title="Estimativa imprecisa (Nv abaixo de 15)"' : ''}>
        ${['hp', 'def', 'spd', 'atk', 'spa', 'vel'].map((k) => {
          const iv = R.ivs[k];

          return `<div class="mkc-stat" style="--c:${RP_COLOR[k]}">
            <div><b>${RP_LABEL[k]}</b><span><em>${iv == null ? '-' : Number.isInteger(iv) ? iv : iv.toFixed(1)}</em>/32</span></div>
            <i><u style="width:${iv == null ? 0 : Math.min(100, (iv / 32) * 100)}%"></u></i>
          </div>`;
        }).join('')}
      </div>

      ${side != null ? side : `      <div class="mkc-side">
        <div class="mk-price">${esc(h.offerOnly ? 'Apenas ofertas' : [currencyIcon(h.currency), fmt(h.price)].filter(Boolean).join(' '))}</div>
        <div class="mk-acts">
          ${h.buyable ? `<button type="button" class="mk-buy" data-hid="${h.hid}" title="Comprar">Comprar</button>` : ''}
        </div>
      </div>`}
    </div>`;
  }

  function mkRender() {
    const poke = mk.cat === 'pokemon';

    document.querySelectorAll('#mtal-mk .mk-cat').forEach((b) =>
      b.classList.toggle('active', b.dataset.cat === mk.cat)
    );
    document.querySelectorAll('#mtal-mk .mk-poke').forEach((el) => (el.hidden = !poke));
    document.querySelectorAll('#mtal-mk .mk-item').forEach((el) => (el.hidden = poke || mk.cat === 'all'));

    $('mk-q').placeholder = poke ? 'Espécie ou nome…' : 'Nome do item…';

    if (poke) {
      $('mk-q').setAttribute('list', 'mtal-species');
    } else {
      $('mk-q').removeAttribute('list');
    }

    const curSel = $('mk-cur').value;

    $('mk-pg-wrap').hidden = curSel === 'DIAMONDS';
    $('mk-pd-wrap').hidden = curSel === 'GOLD';

    const th = (label, k, cls) =>
      `<th class="${cls || ''}${k ? ' mk-sortable' : ''}${k && mk.sort.k === k ? ' on' : ''}"${k ? ` data-sort="${k}"` : ''}>${label}${
        k && mk.sort.k === k ? (mk.sort.dir > 0 ? ' ▲' : ' ▼') : ''
      }</th>`;

    const sb = (label, k) =>
      `<button type="button" class="mkc-sort${mk.sort.k === k ? ' on' : ''}" data-sort="${k}">${label}${
        mk.sort.k === k ? (mk.sort.dir > 0 ? ' ▲' : ' ▼') : ''
      }</button>`;

    if (poke && !rpCre) {
      rpLoadCreatures().then((ok) => {
        if (ok && mk.cat === 'pokemon') mkRender();
      });
    }

    $('mk-thead').innerHTML =
      '<tr>' +
      (poke
        ? `<th colspan="8" class="mkc-bar"><div class="mkc-barin"><span>Ordenar: ${sb('Nível', 'lvl')}${sb('IV', 'iv')}${sb('Raridade', 'q')}${sb('Preço', 'price')}</span><span class="mkc-views"><button type="button" data-view="list" class="${mk.view === 'list' ? 'on' : ''}" title="Lista">☰</button><button type="button" data-view="grid" class="${mk.view === 'grid' ? 'on' : ''}" title="Grade">▦</button></span></div></th>`
        : mk.cat === 'all'
          ? th('') + th('Anúncio') + th('Categoria') + th('Qtd', 'qty') + th('Preço', 'price', 'r') + th('')
          : th('') + th('Item') + th('Qtd', 'qty') + th('Preço/un', 'price', 'r') + th('')) +
      '</tr>';

    const rows = mkVisible();

    $('mk-tbody').parentElement.classList.toggle('mkc-table', poke);

    $('mk-tbody').innerHTML =
      rows
        .map((h) => {
          const img = `<td class="mk-img"><div class="mtal-hit-thumb mk-thumb" data-hid="${h.hid}">${thumbHtml(h)}</div></td>`;
          const price = `<td class="mk-price">${esc(hitPrice(h))}</td>`;
          const acts = `<td class="mk-acts">
            <button type="button" class="mk-mkt" data-hid="${h.hid}" title="Abrir no Market">⚖️</button>
            ${h.buyable ? `<button type="button" class="mk-buy" data-hid="${h.hid}" title="Comprar">🛒</button>` : ''}
          </td>`;

          if (mk.cat === 'all') {
            let sub = '';

            if (h.kind === 'pokemon') {
              const rar = rarityOf(h);
              const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';

              sub =
                `<div class="mk-dim">IV <b style="color:#f2ead0">${esc(h.ivTotal)}</b>/192` +
                (rar ? ` · <span style="color:${rc}">${esc(rar)} ×${Number(h.quality).toFixed(2)}</span>` : '') +
                `</div>`;
            }

            return `<tr class="mtal-mkrow" data-hid="${h.hid}">${img}
              <td><div class="mk-name">${esc(h.name || '-')}${h.shiny ? ' ✨' : ''}</div>${sub}</td>
              <td>${esc(h.kind === 'pokemon' ? 'Pokémon' : catLabel(h.category) || 'Item')}</td>
              <td>${h.quantity != null ? fmt(h.quantity) : '-'}</td>
              ${price}${acts}</tr>`;
          }

          if (h.kind === 'pokemon') {
            return `<tr class="mtal-mkrow mkc-row" data-hid="${h.hid}"><td colspan="8">${mkPokeCard(h)}</td></tr>`;
          }

          if (h.kind === 'pokemon') {
            const rar = rarityOf(h);
            const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';
            const iv = Number(h.ivTotal) || 0;
            const types = typesOf(h.raw || {})
              .map((t) => `<span style="color:${TYPE_COLOR[String(t).toLowerCase()] || '#c7cbe0'}">${esc(cap(t))}</span>`)
              .join(' / ');

            return `<tr class="mtal-mkrow" data-hid="${h.hid}">${img}
              <td class="mk-name">${esc(stripLv(h.name))}${h.shiny ? ' ✨' : ''}</td>
              <td>${h.lvl != null ? esc(h.lvl) : '-'}</td>
              <td class="mk-iv"><b>${esc(iv)}</b><span>/192</span><i><em style="width:${Math.min(100, (iv / 192) * 100)}%"></em></i></td>
              <td style="color:${rc}">${esc(rar || '-')}${h.quality != null ? ' ×' + Number(h.quality).toFixed(2) : ''}</td>
              <td>${types || '-'}</td>
              ${price}${acts}</tr>`;
          }

          return `<tr class="mtal-mkrow" data-hid="${h.hid}">${img}
            <td class="mk-name">${esc(h.name || '-')}</td>
            <td>${h.quantity != null ? fmt(h.quantity) : '-'}</td>
            ${price}${acts}</tr>`;
        })
        .join('') ||
      `<tr><td colspan="8" class="mk-empty">${
        mk.loading ? 'Carregando…' : mk.err ? '⚠ ' + esc(mk.err) : 'Nenhum anúncio com esses filtros.'
      }</td></tr>`;

    if (poke && mk.view === 'grid' && rows.length) {
      $('mk-tbody').innerHTML = `<tr class="mkc-gridrow"><td colspan="8"><div class="mkc-grid">${rows
        .map((h) => `<div class="mtal-mkrow mkc-cell" data-hid="${h.hid}">${mkPokeCard(h)}</div>`)
        .join('')}</div></td></tr>`;
    }

    rows.filter((h) => !(h.kind === 'pokemon' && mk.cat !== 'all' && rpSprite(h, rpCreature(h)))).forEach(ensureSprite);

    $('mk-count').textContent =
      rows.length +
      ' de ' +
      mk.rows.length +
      ' carregados' +
      (mk.loading && mk.rows.length ? (mkClientFiltered() ? ' · buscando em mais páginas…' : ' · carregando…') : '');

    $('mk-more').hidden = !poke || mk.done;
    $('mk-more').disabled = mk.loading;
  }

  const wallet = { gold: null, dia: null };

  function walletScan(d, depth) {
    if (!d || typeof d !== 'object' || depth > 3) return;

    for (const k in d) {
      const v = d[k];

      if (typeof v === 'number' && Number.isFinite(v)) {
        if (/^(my)?(gold|dollars?|money)$/i.test(k)) wallet.gold = v;
        else if (/^(my)?diamonds?$/i.test(k)) wallet.dia = v;
      } else if (v && typeof v === 'object' && !Array.isArray(v) && (!v.constructor || v.constructor.name === 'Object')) {
        walletScan(v, depth + 1);
      }
    }
  }

  function walletFromGame() {
    const f = findGameFiber();

    if (!f) return;

    const p = f.memoizedProps || {};

    if (p.trainerName) $('mk-nick').textContent = p.trainerName;

    hookNodes(f).forEach((h) => {
      const v = h.queue ? h.queue.lastRenderedState : h.memoizedState;

      if (v && typeof v === 'object' && !Array.isArray(v) && !(v.constructor && v.constructor.name !== 'Object')) walletScan(v, 1);
    });
  }

  function walletRender() {
    if ($('mk-gold')) $('mk-gold').textContent = wallet.gold != null ? fmt(wallet.gold) : '-';
    if ($('mk-dia')) $('mk-dia').textContent = wallet.dia != null ? fmt(wallet.dia) : '-';
  }

  function walletFromGameMarket() {
    const win = marketRoot();

    if (!win) return;

    const m = /([\d.,]+)\s*dollars?[^\d]*([\d.,]+)?/i.exec(win.textContent.replace(/\s+/g, ' '));

    if (!m) return;

    const n = (x) => Number(String(x).replace(/[.,\s]/g, ''));

    wallet.gold = n(m[1]);

    if (m[2] != null) wallet.dia = n(m[2]);
  }

  async function walletRefresh() {
    try {
      walletFromGame();
      walletFromGameMarket();
    } catch (e) {}

    try {
      walletScan(await gameGet('/api/game/shop'), 0);
    } catch (e) {}

    walletRender();
  }

  function mkOpen() {
    $('mtal-mk').style.display = 'flex';

    walletRefresh();

    if (!species) loadSpecies();

    if (!mk.rows.length && !mk.loading) {
      mkLoad(true);
    } else {
      mkRender();
    }
  }

  function mkClose() {
    $('mtal-mk').style.display = 'none';

    if (detailsAnchor === 'mtal-mk') hideDetails();
  }

  $('mtal-mkopen').addEventListener('click', mkOpen);
  $('mk-close').addEventListener('click', mkClose);
  $('mk-refresh').addEventListener('click', () => {
    if (mk.mode === 'buy') return mkLoad(true);
    if (mk.mode.startsWith('npc:')) return npcLoad(mk.mode.slice(4));

    slLoad();

    if (mk.mode === 'sell' && sl.kind === 'item') slEnsureOwned(true);
  });
  $('mk-more').addEventListener('click', () => mkLoad(false));

  document.querySelectorAll('#mtal-mk .mk-cat').forEach((b) =>
    b.addEventListener('click', () => {
      if (mk.cat === b.dataset.cat) return;

      mk.cat = b.dataset.cat;
      mk.sort = { k: null, dir: -1 };
      $('mk-q').value = '';
      mkLoad(true);
    })
  );

  $('mk-chips').addEventListener('click', (e) => {
    const c = e.target.closest('.mk-chip');

    if (!c) return;

    const r = c.dataset.r;

    if (mk.rar.has(r)) {
      mk.rar.delete(r);
    } else {
      mk.rar.add(r);
    }

    c.classList.toggle('on', mk.rar.has(r));
    mkRender();
    mkAutoMore();
  });

  let mkTimer = null;

  const mkOnFilter = () => {
    clearTimeout(mkTimer);

    mkTimer = setTimeout(() => {
      if (mkServerKey(mkFilters()) !== mk.key) {
        mkLoad(true);
      } else {
        mkRender();
        mkAutoMore();
      }
    }, 350);
  };

  $('mk-filters').addEventListener('input', mkOnFilter);
  $('mk-filters').addEventListener('change', mkOnFilter);

  $('mk-clear').addEventListener('click', () => {
    $('mk-filters').querySelectorAll('input').forEach((i) => {
      if (i.type === 'checkbox') {
        i.checked = false;
      } else {
        i.value = '';
      }
    });

    $('mk-cur').value = '';
    $('mk-type').value = '';
    mk.rar.clear();
    document.querySelectorAll('#mtal-mk .mk-chip').forEach((c) => c.classList.remove('on'));
    mkOnFilter();
  });

  $('mk-thead').addEventListener('click', (e) => {
    const vb = e.target.closest('[data-view]');

    if (vb) {
      mk.view = vb.dataset.view;
      store.set('mkView', mk.view);
      mkRender();

      return;
    }

    const t = e.target.closest('[data-sort]');

    if (!t) return;

    const k = t.dataset.sort;

    mk.sort =
      mk.sort.k === k
        ? { k, dir: -mk.sort.dir }
        : { k, dir: k === 'price' ? 1 : -1 };

    mkRender();
  });

  $('mk-tbody').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-hid]');
    const tr = e.target.closest('.mtal-mkrow[data-hid]');

    if (!b && !tr) return;

    const h = mk.rows.find((x) => x.hid === +(b || tr).dataset.hid);

    if (!h) return;

    document.querySelectorAll('#mk-tbody .mtal-mkrow[data-hid]').forEach((r) => r.classList.toggle('on', r === tr));

    if (!b) {
      showDetails(h, 'mtal-mk');
    } else if (b.classList.contains('mk-buy')) {
      handleBuyClick(h.hid, b);
    } else if (b.classList.contains('mk-mkt')) {
      mkClose();
      tryNavigateToListing(h);
    } else {
      showDetails(h, 'mtal-mk');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('mtal-mk').style.display === 'flex') mkClose();
  });

  /* ---------- VENDAS / HISTÓRICO ---------- */
  const sl = {
    mine: [],
    hits: [],
    history: [],
    catalog: null,
    owned: null,
    pokes: [],
    kind: 'item',
    sel: null,
    view: store.get('slView', 'grid'),
    lastCur: 'GOLD',
    rar: new Set(),
    loading: false,
    loaded: false,
    err: ''
  };

  let slDex = null;

  function slDexMap() {
    if (slDex && slDex.size) return slDex;

    const f = findGameFiber();

    if (!f) return new Map();

    const arr = hookNodes(f)
      .map((h) => (h.queue ? h.queue.lastRenderedState : h.memoizedState))
      .find((v) => Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'pokeId' in v[0] && 'baseHp' in v[0]);

    slDex = new Map((arr || []).map((d) => [d.pokeId, d]));

    return slDex;
  }

  const sumObj = (o) =>
    o && typeof o === 'object'
      ? Object.values(o).reduce((a, v) => a + (Number(v) || 0), 0)
      : null;

  function slHit(l) {
    return {
      hid: ++hitSeq,
      t: Date.now(),
      alert: 'Meus anúncios',
      id: l.id,
      kind: l.kind === 'pokemon' ? 'pokemon' : 'items',
      category: l.kind === 'pokemon' ? null : l.category,
      name: l.name,
      price: l.price,
      currency: l.currency,
      offerOnly: !!l.offerOnly,
      shiny: !!l.shiny,
      ivTotal: l.ivTotal,
      quality: l.quality,
      quantity: l.quantity,
      belowNpc: false,
      lvl: levelOf(l),
      raw: l,
      buyable: false
    };
  }

  function slOwnedItems() {
    if (!ownedCache) return null;

    const byId = new Map((sl.catalog || []).filter((c) => c.kind === 'item').map((c) => [c.refId, c]));

    return ownedCache.list
      .filter((x) => x.quantity > 0)
      .map((x) => {
        const c =
          byId.get(x.itemId) ||
          (x.name
            ? { kind: 'item', refId: x.itemId, name: x.name, icon: x.icon, category: x.category, label: x.name }
            : null);

        return c ? { ...c, owned: x.quantity, npcPrice: x.npcPrice, title: c.label } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function slMyPokes() {
    const f = findGameFiber();

    if (!f) return [];

    const arr = hookNodes(f)
      .map((h) => (h.queue ? h.queue.lastRenderedState : h.memoizedState))
      .find(
        (v) =>
          Array.isArray(v) &&
          v[0] &&
          typeof v[0] === 'object' &&
          'id' in v[0] &&
          'speciesId' in v[0] &&
          'team' in v[0]
      );

    const dex = slDexMap();

    return (arr || [])
      .filter((p) => !p.team)
      .map((p) => {
        const d = dex.get(p.speciesId) || {};
        const iv = p.ivTotal != null ? p.ivTotal : sumObj(p.growth) != null ? sumObj(p.growth) : sumObj(p.ivs);

        return {
          ...p,
          _iv: iv,
          _q: p.quality != null ? Number(p.quality) : null,
          _types: [p.type1 || d.type1, p.type2 || d.type2].filter(Boolean)
        };
      });
  }

  function slPokeFilter(list) {
    const n = (id, int) => mkNum(id, int);
    const iv1 = n('sl-iv1', true);
    const iv2 = n('sl-iv2', true);
    const lv1 = n('sl-lv1', true);
    const lv2 = n('sl-lv2', true);
    const qm = qNum('sl-qmin');
    const shiny = $('sl-shiny').checked;

    const out = list.filter((p) => {
      if (iv1 != null && !(p._iv >= iv1)) return false;
      if (iv2 != null && !(p._iv <= iv2)) return false;
      if (lv1 != null && !(p.level >= lv1)) return false;
      if (lv2 != null && !(p.level <= lv2)) return false;
      if (qm != null && !(p._q >= qm)) return false;
      if (shiny && !p.shiny) return false;
      if (sl.rar.size && !sl.rar.has(qualityTier(p._q))) return false;

      return true;
    });

    const by = $('sl-sort').value;
    const num = (v) => (v == null ? -1 : v);

    return out.sort((a, b) =>
      by === 'lvl'
        ? b.level - a.level
        : by === 'iv'
          ? num(b._iv) - num(a._iv)
          : by === 'q'
            ? num(b._q) - num(a._q)
            : String(a.name).localeCompare(String(b.name)) || b.level - a.level
    );
  }

  function slInvHit(p) {
    return {
      hid: ++hitSeq,
      t: Date.now(),
      alert: 'Inventário',
      inventory: true,
      kind: 'pokemon',
      name: p.name + ' Lv.' + p.level,
      price: p.sellValue || 0,
      currency: 'GOLD',
      offerOnly: false,
      shiny: !!p.shiny,
      ivTotal: p._iv,
      quality: p._q,
      raw: { ...p, stats: p.stats || p.growth, type1: p._types[0], type2: p._types[1] },
      buyable: false
    };
  }

  const slKey = (c) => (sl.kind === 'pokemon' ? String(c.id) : String(c.refId));

  const slList = () => (sl.kind === 'pokemon' ? sl.pokes : sl.owned || []);

  const slSelected = () => (sl.sel ? slList().find((c) => slKey(c) === sl.sel) || null : null);

  function slInvItemHit(c) {
    return {
      hid: ++hitSeq,
      t: Date.now(),
      alert: 'Inventário',
      inventory: true,
      invRef: c,
      kind: 'items',
      category: c.category,
      name: c.title,
      quantity: c.owned,
      price: c.npcPrice || 0,
      currency: 'GOLD',
      offerOnly: false,
      raw: { icon: c.icon, refId: c.refId, name: c.name },
      buyable: false
    };
  }

  async function slSell(c, kind, price, cur, qty, btn) {
    if (!c) return;
    if (!(price > 0)) return toast('Preço inválido.');

    let body;
    let msg;

    if (kind === 'pokemon') {
      msg = c.name + ' Lv.' + c.level + (c.shiny ? ' ✨' : '');

      if (!confirm('Anunciar ' + msg + ' por ' + fmt(price) + ' ' + curLabel(cur) + '?')) return;

      body = { action: 'sell-pokemon', capturedId: c.id, price, currency: cur };
    } else {
      if (!(qty >= 1)) return toast('Quantidade inválida.');
      if (qty > c.owned) return toast('Você só tem ' + fmt(c.owned) + '× ' + c.name + '.');

      msg = qty + '× ' + c.name;

      if (!confirm('Anunciar ' + msg + ' por ' + fmt(price) + ' ' + curLabel(cur) + '/un?')) return;

      body = { action: 'sell', kind: c.kind, refId: c.refId, quantity: qty, price, currency: cur };
    }

    if (btn) btn.disabled = true;

    try {
      await mkAction(body);

      toast('Anunciado: ' + msg);

      if (body.action === 'sell') {
        const own = ownedCache && ownedCache.list.find((x) => x.itemId === c.refId);

        if (own) {
          own.quantity -= body.quantity;
          store.set('ownedItems', ownedCache);
        }
      }

      sl.sel = null;
      sl.lastCur = cur;

      if (detailsAnchor === 'mtal-mk') hideDetails();
    } catch (e) {
      toast('Erro ao anunciar: ' + ((e && e.message) || e));
    }

    if (btn) btn.disabled = false;

    slLoad();

    if (body.action === 'sell-pokemon') setTimeout(slRenderOwned, 1500);
  }

  function slRenderOwned() {
    const grid = $('sl-grid');

    if (!grid) return;

    const poke = sl.kind === 'pokemon';

    if (poke) {
      sl.pokes = slMyPokes();
    } else {
      sl.owned = slOwnedItems();
    }

    $('sl-pf').hidden = !poke;

    document.querySelectorAll('#sl-views button').forEach((b) =>
      b.classList.toggle('on', b.dataset.view === sl.view)
    );

    const q = ($('sl-filter').value || '').trim().toLowerCase();
    let cards = slList().filter((c) => !q || String(c.name).toLowerCase().includes(q));

    if (poke) cards = slPokeFilter(cards);

    const pseudo = [];
    const list = sl.view === 'list';

    const thumb = (c) => {
      const h = poke
        ? { hid: ++hitSeq, kind: 'pokemon', name: c.name, raw: {} }
        : { hid: ++hitSeq, kind: 'items', name: c.name, raw: { icon: c.icon } };

      pseudo.push(h);

      return `<div class="mtal-hit-thumb ${list ? 'mk-thumb' : 'sl-thumb'}" data-hid="${h.hid}">${thumbHtml(h)}</div>`;
    };

    const rarCell = (c) => {
      const r = qualityTier(c._q);
      const rc = (r && RARITY_COLOR[String(r).toLowerCase()]) || '#9aa0b8';

      return r ? `<span style="color:${rc}">${esc(r)} ×${Number(c._q).toFixed(2)}</span>` : '-';
    };

    const types = (c) =>
      c._types
        .map((t) => `<span style="color:${TYPE_COLOR[String(t).toLowerCase()] || '#c7cbe0'}">${esc(cap(t))}</span>`)
        .join(' / ') || '-';

    grid.classList.toggle('list', list || poke);

    let html;

    if (poke && cards.length) {
      html = `<div class="${list ? 'mkc-list' : 'mkc-grid'}">${cards
        .map((c) => {
          const key = slKey(c);
          const h = { ...slInvHit(c), invRef: c };

          if (!rpSprite(h, rpCreature(h))) pseudo.push(h);

          return `<div class="sl-pk${key === sl.sel ? ' on' : ''}" data-key="${esc(key)}">${mkPokeCard(
            h,
            `<div class="mkc-side">
              <div class="mk-price">${c.sellValue != null ? '<span class="mk-dim">NPC</span> $ ' + fmt(c.sellValue) : ''}</div>
              <div class="mk-acts"><button type="button">Anunciar</button></div>
            </div>`
          )}</div>`;
        })
        .join('')}</div>`;

      if (!rpCre) {
        rpLoadCreatures().then((ok) => {
          if (ok && sl.kind === 'pokemon') slRenderOwned();
        });
      }
    } else if (!cards.length) {
      html = `<div class="mk-empty">${
        poke
          ? sl.pokes.length
            ? 'Nenhum Pokémon com esses filtros.'
            : 'Nenhum Pokémon fora do time.'
          : !ownedCache
            ? 'Lendo inventário…'
            : !sl.catalog
              ? 'Carregando…'
              : 'Nenhum item vendável.'
      }</div>`;
    } else if (list) {
      html =
        `<table class="sl-table"><thead><tr>` +
        (poke
          ? '<th></th><th>Pokémon</th><th>Nv</th><th>IV</th><th>Raridade</th><th>Tipos</th><th class="r">NPC</th>'
          : '<th></th><th>Item</th><th>Qtd</th>') +
        `</tr></thead><tbody>` +
        cards
          .map((c) => {
            const key = slKey(c);
            const on = key === sl.sel ? ' on' : '';

            return poke
              ? `<tr class="sl-row${on}" data-key="${esc(key)}">
                  <td class="mk-img">${thumb(c)}</td>
                  <td class="mk-name">${esc(c.name)}${c.shiny ? ' ✨' : ''}</td>
                  <td>${esc(c.level)}</td>
                  <td>${c._iv != null ? `<b style="color:#f2ead0">${esc(c._iv)}</b><span class="mk-dim">/192</span>` : '-'}</td>
                  <td>${rarCell(c)}</td>
                  <td>${types(c)}</td>
                  <td class="mk-price">${c.sellValue != null ? '$ ' + fmt(c.sellValue) : '-'}</td>
                </tr>`
              : `<tr class="sl-row${on}" data-key="${esc(key)}">
                  <td class="mk-img">${thumb(c)}</td>
                  <td class="mk-name">${esc(c.title)}</td>
                  <td>${fmt(c.owned)}×</td>
                </tr>`;
          })
          .join('') +
        `</tbody></table>`;
    } else {
      html = cards
        .map((c) => {
          const key = slKey(c);
          const sub = poke
            ? 'Lv.' + esc(c.level) + (c._iv != null ? ` · IV <b style="color:#f2ead0">${esc(c._iv)}</b>/192` : '')
            : fmt(c.owned) + '×';

          return `<button type="button" class="sl-card${key === sl.sel ? ' on' : ''}" data-key="${esc(key)}" title="${esc(poke ? c.name : c.title)}">
            ${thumb(c)}
            <div class="sl-cname">${esc(poke ? c.name : c.title)}${c.shiny ? ' ✨' : ''}</div>
            <div class="mk-dim">${sub}</div>
            ${poke && c._q != null ? `<div class="mk-dim">${rarCell(c)}</div>` : ''}
          </button>`;
        })
        .join('');
    }

    grid.innerHTML = html;

    pseudo.forEach(ensureSprite);

    $('sl-hint').textContent = !poke && ownedCache ? 'Inventário lido há ' + ago(ownedCache.t) + '.' : '';
  }

  function hsPokeData(x) {
    const known = seenL[seenKey(x.name, x.price, x.currency)];

    if (known) return known;

    if (!x.bought) return null;

    const base = stripLv(x.name).toLowerCase();
    const lv = levelOf(x);
    const cand = slMyPokes().filter((p) => String(p.name).toLowerCase() === base && p.level === lv);

    if (cand.length !== 1) return null;

    const p = cand[0];

    return {
      ...p,
      ivTotal: p._iv,
      quality: p._q,
      stats: p.stats || p.growth,
      type1: p._types[0],
      type2: p._types[1]
    };
  }

  function hsHit(x) {
    const cat = (sl.catalog || []).find((c) => c.name === x.name);
    const poke = !cat && /Lv\.?\s*\d+/i.test(x.name || '');
    const pd = poke ? hsPokeData(x) : null;

    return {
      hid: ++hitSeq,
      t: Date.now(),
      alert: 'Histórico',
      purchasedAt: x.at ? Date.parse(x.at) : Date.now(),
      at: x.at,
      sold: !x.bought,
      kind: poke ? 'pokemon' : 'items',
      category: cat ? cat.category : null,
      name: x.name,
      price: x.price,
      currency: x.currency,
      offerOnly: false,
      quantity: poke ? null : x.amount,
      shiny: !!(pd && pd.shiny),
      ivTotal: pd ? pd.ivTotal : null,
      quality: pd ? pd.quality : null,
      raw: poke
        ? { ...(pd || {}), level: pd && pd.level != null ? pd.level : levelOf(x) }
        : { icon: cat ? cat.icon : '' },
      buyable: false
    };
  }

  function hsRender() {
    const row = (x) => `<tr class="sl-row" data-hi="${sl.history.indexOf(x)}">
      <td class="mk-dim">${x.at ? esc(new Date(x.at).toLocaleString('pt-BR')) : '-'}</td>
      <td class="mk-name">${esc(x.name || '-')}</td>
      <td>${x.amount != null ? fmt(x.amount) + '×' : '-'}</td>
      <td class="mk-price">${esc(hitPrice({ price: x.price, currency: x.currency }))}${
        x.offer ? ' <span class="mk-dim">(oferta)</span>' : ''
      }</td>
    </tr>`;

    const empty = (t) => `<tr><td colspan="4" class="mk-empty">${sl.loading ? 'Carregando…' : sl.err ? '⚠ ' + esc(sl.err) : t}</td></tr>`;

    const bought = sl.history.filter((x) => x.bought);
    const sold = sl.history.filter((x) => !x.bought);

    $('hs-buy-n').textContent = '(' + bought.length + ')';
    $('hs-sell-n').textContent = '(' + sold.length + ')';
    $('hs-buy').innerHTML = bought.map(row).join('') || empty('Nenhuma compra.');
    $('hs-sell').innerHTML = sold.map(row).join('') || empty('Nenhuma venda.');
  }

  function slRender() {
    slRenderOwned();

    $('sl-mine-n').textContent = '(' + sl.mine.length + ')';

    const mineOpen = store.get('slMineOpen', true) && (sl.mine.length > 0 || sl.loading || !!sl.err);

    $('sl-mine-wrap').hidden = !mineOpen;
    $('sl-mine-caret').textContent = mineOpen ? '▾' : '▸';

    sl.hits = sl.mine.map(slHit);

    $('sl-mine').innerHTML =
      sl.hits
        .map((h) => {
          let sub = catLabel(h.category) || 'Item';

          if (h.kind === 'pokemon') {
            const rar = rarityOf(h);
            const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';

            sub =
              `IV <b style="color:#f2ead0">${esc(h.ivTotal)}</b>/192` +
              (rar ? ` · <span style="color:${rc}">${esc(rar)} ×${Number(h.quality).toFixed(2)}</span>` : '');
          }

          return `<tr class="sl-row" data-mh="${h.hid}">
            <td class="mk-img"><div class="mtal-hit-thumb mk-thumb" data-hid="${h.hid}">${thumbHtml(h)}</div></td>
            <td><div class="mk-name">${esc(h.name || '-')}${h.shiny ? ' ✨' : ''}</div><div class="mk-dim">${sub}</div></td>
            <td>${h.quantity != null ? fmt(h.quantity) + '×' : '-'}</td>
            <td class="mk-price">${esc(hitPrice(h))}${h.kind === 'pokemon' ? '' : ' <span class="mk-dim">/un</span>'}</td>
            <td class="mk-dim">${h.raw.at ? esc(new Date(h.raw.at).toLocaleString('pt-BR')) : '-'}</td>
            <td class="mk-acts">
              <button type="button" data-act="reprice" data-hid="${h.hid}" title="Alterar preço">✎</button>
              <button type="button" data-act="cancel" data-hid="${h.hid}" title="Cancelar anúncio">✕</button>
            </td>
          </tr>`;
        })
        .join('') ||
      `<tr><td colspan="6" class="mk-empty">${
        sl.loading ? 'Carregando…' : sl.err ? '⚠ ' + esc(sl.err) : 'Nenhum anúncio ativo.'
      }</td></tr>`;

    sl.hits.forEach(ensureSprite);

    hsRender();
  }

  async function slLoad() {
    if (sl.loading) return;

    sl.loading = true;
    sl.err = '';
    slRender();

    try {
      const d = await api('?category=Pokemon');

      sl.mine = (d && d.mine) || [];
      rememberListings(sl.mine);
      sl.history = (d && d.history) || [];

      if (!sl.catalog && d && d.catalog) {
        const all = [...(d.catalog.items || []), ...(d.catalog.balls || [])];
        const cnt = {};

        all.forEach((c) => (cnt[c.name] = (cnt[c.name] || 0) + 1));

        sl.catalog = all.map((c) => ({
          ...c,
          label: cnt[c.name] > 1 ? c.name + ' #' + c.refId : c.name
        }));
      }

      sl.loaded = true;
    } catch (e) {
      sl.err = String((e && e.message) || e);
    }

    sl.loading = false;
    slRender();
  }

  /* ---------- NPCs ---------- */
  const npcIdx = store.get('npcIdx', {}) || {};

  const boolSnap = () => {
    const f = findGameFiber();
    const m = new Map();

    if (f) {
      hookNodes(f).forEach((h, i) => {
        const st = stateAt([h], 0, 'boolean');

        if (st) m.set(i, st.cur);
      });
    }

    return m;
  };

  document.addEventListener(
    'click',
    (e) => {
      const b = e.target.closest && e.target.closest('button');

      if (!b || b.closest('#mtal-mk,#mtal-panel,#mtal-details,#mtal-fab-row')) return;

      const n = NPCS.find((x) => x.re.test(b.textContent.trim()));

      if (!n) return;

      const before = boolSnap();

      setTimeout(() => {
        const after = boolSnap();
        const c = [...after.keys()].filter((i) => before.get(i) === false && after.get(i) === true);

        if (c.length === 1 && npcIdx[n.key] !== c[0]) {
          npcIdx[n.key] = c[0];
          store.set('npcIdx', npcIdx);
          log('NPC aprendido:', n.title, c[0]);
        }
      }, 700);
    },
    true
  );

  async function openNpc(key) {
    const n = NPCS.find((x) => x.key === key);
    const f = n && findGameFiber();

    if (!f) return toast('Jogo ainda carregando.');

    const st = stateAt(hookNodes(f), npcIdx[n.key] != null ? npcIdx[n.key] : n.idx, 'boolean');

    if (!st) return toast('Não consegui abrir ' + n.title + '. Abra 1x pelo NPC para eu aprender.');

    mkClose();

    if (st.cur) {
      st.set(false);
      await sleep(60);
    }

    st.set(true);
  }

  document.querySelectorAll('#mtal-mk .mk-npc').forEach((b) =>
    b.addEventListener('click', () => mkSetMode('npc:' + b.dataset.npc))
  );

  let silentReading = null;

  function silentOwnedRead() {
    if (silentReading) return silentReading;

    silentReading = (async () => {
      const t0 = ownedCache ? ownedCache.t : 0;
      const got = () => {
        readOwnedFromMarket();

        return !!ownedCache && ownedCache.t !== t0;
      };

      if (marketOpen()) return got() || (await waitFor(got, 1500));

      const f = findGameFiber();

      if (!f) return false;

      const hs = hookNodes(f);
      const applied = [];
      const hide = document.createElement('style');

      hide.textContent = '.mkt2-window{opacity:0!important;pointer-events:none!important}';
      document.head.appendChild(hide);

      try {
        const entries = Object.entries(getMktPatch()).sort(
          (a, b) => (typeof a[1] === 'string' ? 0 : 1) - (typeof b[1] === 'string' ? 0 : 1)
        );

        for (const [i, v] of entries) {
          const st = stateAt(hs, +i, typeof v);

          if (!st) continue;

          applied.push([st, st.cur]);
          st.set(v);
        }

        if (!applied.length || !(await waitFor(marketOpen, 2500))) return false;

        if (await waitFor(got, 1200)) return true;

        const root = marketRoot();

        if (root) clickByText(root, '.mkt2-tab', '.mkt2-tab-label', 'Anunciar');

        return await waitFor(got, 2500);
      } catch (e) {
        log('leitura do inventário falhou:', e);

        return false;
      } finally {
        applied.forEach(([st, prev]) => st.set(prev));
        setTimeout(() => hide.remove(), 400);
      }
    })().finally(() => {
      silentReading = null;
    });

    return silentReading;
  }

  async function slEnsureOwned(force) {
    if (!force && ownedCache && Date.now() - ownedCache.t < 60000) return;

    const hint = $('sl-hint');

    if (hint && sl.kind === 'item') hint.textContent = 'Lendo inventário…';

    let ok = false;

    try {
      const a = depotToOwned(await gameGet('/api/game/depot'));

      if (a) {
        setOwned(a);
        ok = true;
      }
    } catch (e) {
      log('depot:', e.message);
    }

    if (!ok) ok = await silentOwnedRead();

    if (!ok && !ownedCache) toast('Não consegui ler o inventário agora. Tente o ↻.');

    slRenderOwned();
  }

  function mkSetMode(m) {
    if (mk.mode !== m && detailsAnchor === 'mtal-mk') hideDetails();

    mk.mode = m;

    $('mtal-mk').dataset.mode = m;

    document.querySelectorAll('#mtal-mk .mk-mode').forEach((b) =>
      b.classList.toggle('active', b.dataset.mode === m)
    );

    document.querySelectorAll('#mtal-mk .mk-npc').forEach((b) =>
      b.classList.toggle('active', m === 'npc:' + b.dataset.npc)
    );

    if (m.startsWith('npc:')) {
      npcSt.key = m.slice(4);
      npcRender();
      npcLoad(npcSt.key);

      return;
    }

    if (m !== 'buy') {
      if (!sl.loaded && !sl.loading) {
        slLoad();
      } else {
        slRender();
      }
    }

    if (m === 'sell' && sl.kind === 'item') slEnsureOwned();
  }

  document.querySelectorAll('#mtal-mk .mk-mode').forEach((b) =>
    b.addEventListener('click', () => mkSetMode(b.dataset.mode))
  );

  document.querySelectorAll('#sl-kinds button').forEach((b) =>
    b.addEventListener('click', () => {
      sl.kind = b.dataset.kind;
      sl.sel = null;

      if (detailsAnchor === 'mtal-mk') hideDetails();

      document.querySelectorAll('#sl-kinds button').forEach((x) => x.classList.toggle('on', x === b));

      slRenderOwned();

      if (sl.kind === 'item') slEnsureOwned();
    })
  );

  $('sl-mine-h').addEventListener('click', () => {
    store.set('slMineOpen', !store.get('slMineOpen', true));
    slRender();
  });

  $('sl-filter').addEventListener('input', slRenderOwned);
  $('sl-pf').addEventListener('input', slRenderOwned);
  $('sl-pf').addEventListener('change', slRenderOwned);

  $('sl-rar').addEventListener('click', (e) => {
    const c = e.target.closest('.mk-chip');

    if (!c) return;

    const r = c.dataset.r;

    if (sl.rar.has(r)) {
      sl.rar.delete(r);
    } else {
      sl.rar.add(r);
    }

    c.classList.toggle('on', sl.rar.has(r));
    slRenderOwned();
  });

  document.querySelectorAll('#sl-views button').forEach((b) =>
    b.addEventListener('click', () => {
      sl.view = b.dataset.view;
      store.set('slView', sl.view);
      slRenderOwned();
    })
  );

  $('sl-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');

    if (!b) return;

    sl.sel = b.dataset.key;

    document.querySelectorAll('#sl-grid [data-key]').forEach((x) => x.classList.toggle('on', x === b));

    const c = slSelected();

    if (c) showDetails(sl.kind === 'pokemon' ? { ...slInvHit(c), invRef: c } : slInvItemHit(c), 'mtal-mk');
  });

  const hsClick = (e) => {
    const tr = e.target.closest('tr[data-hi]');

    if (!tr) return;

    const x = sl.history[+tr.dataset.hi];

    if (!x) return;

    document.querySelectorAll('#mk-hist tr[data-hi]').forEach((r) => r.classList.toggle('on', r === tr));
    showDetails(hsHit(x), 'mtal-mk');
  };

  $('hs-buy').addEventListener('click', hsClick);
  $('hs-sell').addEventListener('click', hsClick);

  $('sl-mine').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-hid]');

    if (!b) {
      const tr = e.target.closest('tr[data-mh]');
      const hm = tr && sl.hits.find((x) => x.hid === +tr.dataset.mh);

      if (hm) {
        document.querySelectorAll('#sl-mine tr[data-mh]').forEach((r) => r.classList.toggle('on', r === tr));
        showDetails(hm, 'mtal-mk');
      }

      return;
    }

    const h = sl.hits.find((x) => x.hid === +b.dataset.hid);

    if (!h) return;

    const l = h.raw;

    try {
      if (b.dataset.act === 'cancel') {
        if (!confirm('Cancelar o anúncio de ' + h.name + '?')) return;

        b.disabled = true;

        await mkAction({ action: 'cancel', id: l.id });

        toast('Anúncio cancelado: ' + h.name);
      } else {
        const v = prompt(
          'Novo preço de ' + h.name + ' (' + curLabel(l.currency) + (h.kind === 'pokemon' ? '' : '/un') + ')',
          String(l.price)
        );

        if (v == null) return;

        const p = parseFloat(String(v).replace(/[.\s]/g, '').replace(',', '.'));

        if (!(p > 0)) return toast('Preço inválido.');

        b.disabled = true;

        await mkAction({ action: 'cancel', id: l.id });

        await mkAction(
          h.kind === 'pokemon'
            ? { action: 'sell-pokemon', capturedId: l.capturedId, price: p, currency: l.currency }
            : { action: 'sell', kind: l.kind, refId: l.refId, quantity: l.quantity, price: p, currency: l.currency }
        );

        toast('Preço atualizado: ' + h.name + ' → ' + fmt(p) + ' ' + curLabel(l.currency));
      }
    } catch (err) {
      toast('Erro: ' + ((err && err.message) || err));
    }

    slLoad();
  });

  /* ---------- NPCs dentro do Mercado ---------- */
  const NPC_API = {
    shop: '/api/game/shop',
    depot: '/api/game/depot',
    flint: '/api/game/flint',
    tm: '/api/game/tm-researcher',
    held: '/api/game/held-machine',
    trader: '/api/game/pokemaniac-trader'
  };

  const npcSt = { key: null, data: {}, cards: [], loading: false, err: '', shopTab: 'buy' };

  const DEPOT_CAT = { stone: 'Stones', heal: 'Cura', revive: 'Reviver', loot: 'Loot', ball: 'Poké Balls', key: 'Chaves', held: 'Held Items', tm: 'TMs', token: 'Tokens', berry: 'Berries' };

  const iconUrl = (v) => (!v ? '' : /^(\/|https?:|data:)/i.test(String(v)) ? v : '/assets/items/' + v);

  async function gamePost(path, body) {
    const auths = getAuths();

    if (!auths.length) throw new Error('sem sessão');

    let status = 0;

    for (const a of auths) {
      const r = await PW.fetch(path, {
        method: 'POST',
        headers: { authorization: a, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });

      status = r.status;

      if (r.status === 401 || r.status === 403) continue;

      const data = await r.json().catch(() => null);

      if (!r.ok || !data || data.ok === false) {
        throw new Error((data && (data.error || data.message)) || 'HTTP ' + r.status);
      }

      return data;
    }

    throw new Error('sessão expirada (' + status + ')');
  }

  async function npcLoad(key) {
    npcSt.loading = true;
    npcSt.err = '';
    npcRender();

    try {
      const d = await gameGet(NPC_API[key]);

      npcSt.data[key] = d;

      if (key === 'shop') {
        npcSt.data.depot = await gameGet(NPC_API.depot);

        try {
          const lk = await gameGet('/api/game/item/lock');

          npcSt.data.locked = new Set(
            ((lk && lk.locked) || []).map((x) => (x && typeof x === 'object' ? x.itemId || x.id : x))
          );
        } catch (e) {
          npcSt.data.locked = new Set();
        }

        const a = depotToOwned(npcSt.data.depot);

        if (a) setOwned(a);
      }

      if (key === 'depot') {
        const a = depotToOwned(d);

        if (a) setOwned(a);
      }
    } catch (e) {
      npcSt.err = String((e && e.message) || e);
    }

    npcSt.loading = false;

    if (npcSt.key === key) npcRender();
  }

  function npcCard(icon, name, sub, click, pokeName) {
    const fq = ($('npc-filter').value || '').trim().toLowerCase();

    if (fq && !String(name).toLowerCase().includes(fq)) return '';

    const i = npcSt.cards.length;
    let thumb;

    if (pokeName) {
      const h = { hid: ++hitSeq, kind: 'pokemon', name: pokeName, raw: {} };

      npcSt.pseudo.push(h);
      thumb = `<div class="mtal-hit-thumb sl-thumb" data-hid="${h.hid}">${thumbHtml(h)}</div>`;
    } else {
      thumb = `<div class="sl-thumb">${
        icon ? `<img src="${esc(icon)}" onerror="this.parentElement.textContent='❔'">` : '❔'
      }</div>`;
    }

    npcSt.cards.push(click || null);

    return `<${click ? 'button type="button"' : 'div'} class="sl-card${click ? '' : ' npc-ro'}" data-nc="${i}">
      ${thumb}
      <div class="sl-cname" title="${esc(name)}">${esc(name)}</div>
      <div class="mk-dim">${sub}</div>
    </${click ? 'button' : 'div'}>`;
  }

  function npcRow(icon, name, sub, click, o = {}) {
    const fq = ($('npc-filter').value || '').trim().toLowerCase();

    if (fq && !String(name).toLowerCase().includes(fq)) return '';

    const i = npcSt.cards.length;

    npcSt.cards.push(click || null);

    return `<div class="npc-row${o.checked ? ' on' : ''}" data-nc="${i}">
      ${o.check != null ? `<input type="checkbox" class="npc-chk" data-sid="${esc(o.check)}"${o.checked ? ' checked' : ''}>` : ''}
      <div class="npc-ri">${icon ? `<img src="${esc(icon)}" onerror="this.parentElement.textContent='❔'">` : '❔'}</div>
      <div class="npc-rn"><b>${esc(name)}</b><span class="mk-dim">${sub}</span></div>
      ${
        o.arrow
          ? `<button type="button" class="npc-arrow" data-mv="${esc(o.id)}" data-dir="${o.arrow}" title="${o.arrow === 'store' ? 'Guardar no depósito' : 'Retirar para a mochila'}">${o.arrow === 'store' ? '→' : '←'}</button>`
          : ''
      }
    </div>`;
  }

  async function depotMove(id, dir) {
    const r = await gamePost('/api/game/depot/move', { itemId: id, dir });

    npcSt.data.depot = r;

    const a = depotToOwned(r);

    if (a) setOwned(a);

    return r;
  }

  const npcSec = (title, cards, empty) =>
    `<div class="mk-sec"><div class="mk-sec-h">${title}</div><div class="sl-grid">${
      cards || `<div class="mk-empty">${empty || 'Nada aqui.'}</div>`
    }</div></div>`;

  const npcHit = (o) => ({
    hid: ++hitSeq,
    t: Date.now(),
    alert: 'NPC',
    kind: 'items',
    offerOnly: false,
    buyable: false,
    currency: 'GOLD',
    ...o
  });

  function npcRender() {
    const key = npcSt.key;
    const n = NPCS.find((x) => x.key === key);

    if (!n) return;

    const d = npcSt.data[key];

    npcSt.cards = [];
    npcSt.pseudo = [];

    $('npc-title').textContent = n.title;

    let info = '';
    let body = '';
    const ro = '<div class="mk-dim npc-note">As ações deste NPC ainda não foram capturadas. Use "Abrir no jogo" para trocar/criar.</div>';

    if (!d) {
      body = `<div class="mk-empty">${npcSt.loading ? 'Carregando…' : npcSt.err ? '⚠ ' + esc(npcSt.err) : ''}</div>`;
    } else if (key === 'shop') {
      info = 'Saldo: $ ' + fmt(d.gold);

      const sell = (x, isBall) =>
        npcCard(iconUrl(x.iconUrl || x.icon), x.name, '$ ' + fmt(x.priceGold), () =>
          npcHit({
            name: x.name,
            category: isBall ? 'Poke Balls' : 'Items',
            price: x.priceGold,
            raw: { icon: iconUrl(x.iconUrl || x.icon) },
            npcAction: {
              label: '🛒 Comprar',
              needQty: true,
              unit: x.priceGold,
              confirm: (q) => 'Comprar ' + q + '× ' + x.name + ' por $ ' + fmt(q * x.priceGold) + '?',
              run: async (q) => {
                const r = await gamePost('/api/game/shop/buy', isBall ? { ballId: x.id, qty: q } : { itemId: x.id, qty: q });

                toast('Comprado: ' + (r.bought || q) + '× ' + x.name);

                if (r.gold != null) d.gold = r.gold;

                npcRender();
              }
            }
          })
        );

      const inv = (npcSt.data.depot && npcSt.data.depot.inventory) || [];

      const sellHit = (x) =>
          npcHit({
            name: x.name,
            category: x.category,
            quantity: x.quantity,
            price: x.npcPrice || 0,
            priceLabel: 'O NPC paga por unidade',
            raw: { icon: iconUrl(x.icon) },
            npcAction: {
              label: '💰 Vender',
              needQty: true,
              max: x.quantity,
              unit: x.npcPrice || 0,
              confirm: (q) => 'Vender ' + q + '× ' + x.name + ' por $ ' + fmt(q * (x.npcPrice || 0)) + '?',
              run: async (q) => {
                const r = await gamePost('/api/game/shop/sell', { items: [{ itemId: x.id, qty: q }] });

                toast('Vendido: ' + fmt(r.soldCount || q) + '× ' + x.name + (r.goldGained ? ' · +$ ' + fmt(r.goldGained) : ''));
                hideDetails();
                npcLoad('shop');
              }
            }
          });

      body =
        `<div class="mk-seg npc-tabs">
          <button type="button" data-st="buy" class="${npcSt.shopTab === 'buy' ? 'on' : ''}">Comprar</button>
          <button type="button" data-st="sell" class="${npcSt.shopTab === 'sell' ? 'on' : ''}">Vender</button>
        </div>` +
        (npcSt.shopTab === 'buy'
          ? npcSec('Poké Balls', (d.balls || []).map((x) => sell(x, true)).join('')) +
            npcSec('Itens', (d.items || []).map((x) => sell(x, false)).join(''))
          : (() => {
              const locked = npcSt.data.locked || new Set();
              const list = inv.filter((x) => x.npcPrice > 0 && !locked.has(x.id));
              const sel = npcSt.sellSel || (npcSt.sellSel = new Set());

              [...sel].forEach((id) => {
                if (!list.some((x) => x.id === id)) sel.delete(id);
              });

              npcSt.sellList = list;

              const chosen = list.filter((x) => sel.has(x.id));
              const tot = chosen.reduce((acc, x) => acc + x.quantity * x.npcPrice, 0);
              const allOn = list.length > 0 && chosen.length === list.length;

              return `<div class="npc-bar">
                  <button type="button" data-selall="1">${allOn ? 'Desmarcar todos' : 'Selecionar todos'}</button>
                  <button type="button" data-selloot="1">Só loot</button>
                  <span class="mk-dim">${chosen.length} de ${list.length} selecionados</span>
                  <span style="flex:1"></span>
                  <button type="button" data-sellsel="1" class="npc-primary"${chosen.length ? '' : ' disabled'}>💰 Vender selecionados · $ ${fmt(tot)}</button>
                </div>
                <div class="npc-list">${
                  list
                    .map((x) =>
                      npcRow(
                        iconUrl(x.icon),
                        x.name,
                        fmt(x.quantity) + '× · $ ' + fmt(x.npcPrice) + '/un = $ ' + fmt(x.quantity * x.npcPrice),
                        () => sellHit(x),
                        { check: x.id, checked: sel.has(x.id) }
                      )
                    )
                    .join('') || '<div class="mk-empty">Nada vendável na mochila.</div>'
                }</div>
                <div class="mk-dim npc-note">Itens travados no jogo ficam de fora. Clique no item para vender só uma parte.</div>`;
            })());
    } else if (key === 'depot') {
      const inv = d.inventory || [];
      const dep = d.depot || [];
      const cats = [...new Set(inv.concat(dep).map((x) => x.category).filter(Boolean))].sort();
      const cat = npcSt.depotCat || '';
      const tab = npcSt.depotTab || 'items';
      const byCat = (x) => !cat || x.category === cat;

      const tabs = `<div class="mk-seg npc-tabs">${[
        ['items', '🎒 Itens'],
        ['poke', '⚔ Pokémon'],
        ['fitems', '👪 Família: Itens'],
        ['fpoke', '👪 Família: Pokémon']
      ]
        .map(([k, l]) => `<button type="button" data-dt="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`)
        .join('')}</div>`;

      const hitOf = (x, inInv) => () =>
        npcHit({
          name: x.name,
          category: x.category,
          quantity: x.quantity,
          price: x.npcPrice || 0,
          priceLabel: 'Valor no NPC',
          raw: { icon: iconUrl(x.icon) },
          npcAction: {
            label: inInv ? '📦 Guardar no depósito' : '🎒 Retirar para a mochila',
            note: 'Move o stack inteiro (' + fmt(x.quantity) + '×).',
            run: async () => {
              await depotMove(x.id, inInv ? 'store' : 'withdraw');

              toast((inInv ? 'Guardado: ' : 'Retirado: ') + x.name);
              hideDetails();
              npcRender();
            }
          }
        });

      const row = (x, inInv) =>
        npcRow(iconUrl(x.icon), x.name, fmt(x.quantity) + '×' + (x.npcPrice ? ' · $ ' + fmt(x.npcPrice) : ''), hitOf(x, inInv), {
          arrow: inInv ? 'store' : 'withdraw',
          id: x.id
        });

      if (tab !== 'items') {
        body =
          tabs +
          '<div class="mk-empty">Esta aba ainda não foi capturada. Use "Abrir no jogo" por enquanto.</div>';
      } else {
        const L = inv.filter(byCat).map((x) => row(x, true)).join('');
        const R = dep.filter(byCat).map((x) => row(x, false)).join('');

        body =
          tabs +
          `<div class="npc-bar">
            <select id="npc-cat">
              <option value="">Todas as categorias</option>
              ${cats.map((c) => `<option value="${esc(c)}"${c === cat ? ' selected' : ''}>${esc(DEPOT_CAT[c] || cap(c))}</option>`).join('')}
            </select>
          </div>
          <div class="npc-cols">
            <div class="mk-sec">
              <div class="mk-sec-h">🎒 Mochila (${inv.length})</div>
              <div class="npc-list">${L || '<div class="mk-empty">Nada na mochila (confira os filtros).</div>'}</div>
            </div>
            <div class="mk-sec">
              <div class="mk-sec-h">📦 Depósito (${dep.length})</div>
              <div class="npc-list">${R || '<div class="mk-empty">Nada no depósito (confira os filtros).</div>'}</div>
            </div>
          </div>
          <div class="npc-foot">
            <span class="npc-slots">📦 ${dep.length}/${d.maxSlots} slots</span>
            <span style="flex:1"></span>
            <button type="button" data-storeall="1" class="npc-primary"${inv.length ? '' : ' disabled'}>Guardar tudo</button>
          </div>`;
      }
    } else if (key === 'flint') {
      info = 'Saldo: $ ' + fmt(d.gold) + ' · Gemstones: ' + fmt(d.gemQty || 0);

      body = npcSec(
        'Suas stones',
        (d.stones || [])
          .map((x) =>
            npcCard(iconUrl(x.icon), x.name, fmt(x.quantity) + '× · $ ' + fmt(x.unitPrice), () =>
              npcHit({
                name: x.name,
                category: 'Stones',
                quantity: x.quantity,
                price: x.unitPrice,
                priceLabel: 'Ele paga por unidade',
                raw: { icon: iconUrl(x.icon) },
                npcAction: {
                  label: '💰 Vender',
                  needQty: true,
                  max: x.quantity,
                  unit: x.unitPrice,
                  confirm: (q) => 'Vender ' + q + '× ' + x.name + ' por $ ' + fmt(q * x.unitPrice) + '?',
                  run: async (q) => {
                    const r = await gamePost('/api/game/flint/sell', { itemId: x.id, qty: q });

                    toast('Vendido: ' + (r.sold || q) + '× ' + (r.item || x.name) + ' · +$ ' + fmt(r.goldGained || 0));
                    hideDetails();
                    npcLoad('flint');
                  }
                }
              })
            )
          )
          .join(''),
        'Você não tem stones para vender.'
      );
    } else if (key === 'tm') {
      info =
        'Custo: ' + fmt(d.cost) + ' peças · ' +
        fmt(d.pieceQty || 0) + '× ' + (d.pieceName || '') + ' · ' +
        fmt(d.aoePieceQty || 0) + '× ' + (d.aoePieceName || '');

      body =
        ro +
        npcSec(
          'TM Disks',
          (d.catalog || [])
            .map((x) =>
              npcCard(
                iconUrl(x.icon),
                x.name,
                `<span style="color:${TYPE_COLOR[String(x.type).toLowerCase()] || '#c7cbe0'}">${esc(x.move || cap(x.type))}</span>`
              )
            )
            .join('') + (d.aoeDisk ? npcCard(iconUrl(d.aoeDisk.icon), d.aoeDisk.name, 'AoE') : '')
        );
    } else if (key === 'held') {
      info = fmt(d.tokenQty || 0) + '× ' + (d.tokenName || 'token');

      body =
        ro +
        (d.offers || [])
          .map((o) =>
            npcSec(
              esc(cap(o.key)) + ' · ' + fmt(o.cost) + ' ' + esc(d.tokenName || '') + ' · tiers ' + esc((o.tiers || []).join('/')),
              (o.pool || []).map((x) => npcCard(iconUrl(x.icon), x.name + ' ' + (x.tierLabel || ''), 'Tier ' + esc(x.tier))).join('')
            )
          )
          .join('');
    } else if (key === 'trader') {
      info = 'Saldo: $ ' + fmt(d.gold) + ' · Time ' + d.teamCount + '/' + d.maxTeam;

      const req = (x) =>
        [
          x.needsEevee ? 'precisa de Eevee' : '',
          (x.stones || []).length
            ? 'precisa: ' + x.stones.map((st) => (typeof st === 'object' ? (st.qty || st.quantity || 1) + '× ' + (st.name || st.id) : st)).join(', ')
            : ''
        ]
          .filter(Boolean)
          .join(' · ');

      body = npcSec(
        'Ofertas',
        (d.offers || [])
          .map((x) =>
            npcCard(
              '',
              x.name,
              (x.isTrade ? 'Troca' : '$ ' + fmt(x.price)) +
                (x.needsEevee ? ' · precisa Eevee' : '') +
                (x.canBuy === false ? ' · <span style="color:#c0392b">indisponível</span>' : ''),
              () =>
                npcHit({
                  kind: 'pokemon',
                  name: x.name,
                  price: x.isTrade ? 0 : x.price,
                  priceLabel: x.isTrade ? 'Troca' : 'Preço',
                  raw: { level: 1 },
                  npcAction:
                    x.canBuy === false
                      ? null
                      : {
                          label: x.isTrade ? '🔁 Trocar' : '🛒 Comprar',
                          note: [req(x), 'O Pokémon comprado vai para o depósito.'].filter(Boolean).join(' · '),
                          confirm: () =>
                            (x.isTrade ? 'Trocar por ' : 'Comprar ') + x.name + (x.isTrade ? '?' : ' por $ ' + fmt(x.price) + '?'),
                          run: async () => {
                            const r = await gamePost('/api/game/pokemaniac-trader/buy', { speciesId: x.speciesId });

                            toast(
                              (r.isTrade ? 'Trocado: ' : 'Comprado: ') +
                                (r.name || x.name) +
                                (r.level ? ' Lv.' + r.level : '') +
                                (r.goldSpent ? ' · -$ ' + fmt(r.goldSpent) : '') +
                                (r.toDepot ? ' · foi para o depósito' : '')
                            );
                            hideDetails();
                            npcLoad('trader');
                          }
                        }
                }),
              x.name
            )
          )
          .join(''),
        'Sem ofertas.'
      );
    }

    $('npc-info').textContent = info;
    $('npc-body').innerHTML = body;

    npcSt.pseudo.forEach(ensureSprite);
  }

  $('npc-filter').addEventListener('input', () => npcRender());

  $('npc-body').addEventListener('change', (e) => {
    if (e.target.id === 'npc-cat') {
      npcSt.depotCat = e.target.value;
      npcRender();

      return;
    }

    const c = e.target.closest('.npc-chk');

    if (!c) return;

    const sel = npcSt.sellSel || (npcSt.sellSel = new Set());
    const id = +c.dataset.sid;

    if (c.checked) {
      sel.add(id);
    } else {
      sel.delete(id);
    }

    npcRender();
  });

  $('npc-body').addEventListener('click', (e) => {
    if (e.target.closest('.npc-chk')) return;

    const mvb = e.target.closest('[data-mv]');

    if (mvb) {
      mvb.disabled = true;

      depotMove(+mvb.dataset.mv, mvb.dataset.dir)
        .then(() => {
          hideDetails();
          npcRender();
        })
        .catch((err) => {
          toast('Erro: ' + ((err && err.message) || err));
          mvb.disabled = false;
        });

      return;
    }

    if (e.target.closest('[data-storeall]')) {
      const inv = ((npcSt.data.depot && npcSt.data.depot.inventory) || []).slice();

      if (!inv.length || !confirm('Guardar todos os ' + inv.length + ' itens da mochila no depósito?')) return;

      e.target.closest('[data-storeall]').disabled = true;

      (async () => {
        let n = 0;

        for (const x of inv) {
          try {
            await depotMove(x.id, 'store');
            n++;
          } catch (err) {
            toast('Parou em ' + x.name + ': ' + ((err && err.message) || err));
            break;
          }
        }

        toast('Guardado' + (n === 1 ? ': 1 item.' : 's: ' + n + ' itens.'));
        hideDetails();
        npcRender();
      })();

      return;
    }

    if (e.target.closest('[data-dt]')) {
      npcSt.depotTab = e.target.closest('[data-dt]').dataset.dt;
      hideDetails();
      npcRender();

      return;
    }

    const list = npcSt.sellList || [];
    const sel = npcSt.sellSel || (npcSt.sellSel = new Set());

    if (e.target.closest('[data-selall]')) {
      if (list.length && list.every((x) => sel.has(x.id))) {
        sel.clear();
      } else {
        list.forEach((x) => sel.add(x.id));
      }

      npcRender();

      return;
    }

    if (e.target.closest('[data-selloot]')) {
      sel.clear();
      list.filter((x) => x.category === 'loot').forEach((x) => sel.add(x.id));
      npcRender();

      return;
    }

    const ss = e.target.closest('[data-sellsel]');

    if (ss) {
      const chosen = list.filter((x) => sel.has(x.id));
      const tot = chosen.reduce((acc, x) => acc + x.quantity * x.npcPrice, 0);

      if (!chosen.length) return;
      if (!confirm('Vender ' + chosen.length + ' tipos por $ ' + fmt(tot) + '?\n\n' + chosen.map((x) => fmt(x.quantity) + '× ' + x.name).join('\n'))) return;

      ss.disabled = true;

      gamePost('/api/game/shop/sell', { items: chosen.map((x) => ({ itemId: x.id, qty: x.quantity })) })
        .then((r) => toast('Vendido: ' + fmt(r.soldCount || 0) + ' itens · +$ ' + fmt(r.goldGained || 0)))
        .catch((err) => toast('Erro: ' + ((err && err.message) || err)))
        .finally(() => {
          sel.clear();
          hideDetails();
          npcLoad('shop');
        });

      return;
    }

    const t = e.target.closest('[data-st]');

    if (t) {
      npcSt.shopTab = t.dataset.st;
      hideDetails();
      npcRender();

      return;
    }

    const c = e.target.closest('[data-nc]');

    if (!c) return;

    const make = npcSt.cards[+c.dataset.nc];

    if (!make) return;

    document.querySelectorAll('#npc-body [data-nc]').forEach((x) => x.classList.toggle('on', x === c));
    showDetails(make(), 'mtal-mk');
  });

  $('npc-game').addEventListener('click', () => {
    if (npcSt.key) openNpc(npcSt.key);
  });

  renderList();
  renderHits();
  renderPurchased();
  renderBadge();

  setInterval(
    () => {
      if (panelOpen) {
        renderList();
      }
    },
    5000
  );

  setTimeout(
    tick,
    1500
  );

  PW.MarketAlerts = {
    state,
    api,
    poll,
    runtime,
    hits,
    buyListing,
    setMarketPatch(p) {
      store.set('marketPatch', p || null);
      store.set('marketPatchManual', !!p);
      log('patch do Market salvo:', p || null);
    }
  };

  log(
    'pronto. Alertas salvos:',
    state.alerts.length
  );
})();
