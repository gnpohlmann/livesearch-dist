// ==UserScript==
// @name         Poke Idle - LiveSearch
// @namespace    poke-idle-market
// @version      0.4.30
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
  const VERSION = '0.4.30';
  const API = '/api/game/market';
  const POLL_POKEMON_MS = 8000;
  const POLL_ITEMS_MS = 20000;
  const MAX_HITS = 40;
  const CATEGORIES = ['Items', 'Stones', 'Poke Balls', 'Diamonds'];
  const CATEGORY_LABELS = { Diamonds: 'Diamantes' };
  const catLabel = (c) => CATEGORY_LABELS[c] || c || '';
  const NPCS = [
    { key: 'shop', label: '🛒 Loja', title: 'Loja', idx: 79, re: /abrir loja$/i },
    { key: 'depot', label: '📦 Depot', title: 'Depósito', idx: 86, re: /abrir dep[oó]sito/i },
    { key: 'flint', label: '💎 Stones', title: 'Stone Researcher', idx: 81, re: /stone researcher/i },
    { key: 'tm', label: '💿 TMs', title: 'TM Researcher', idx: 82, re: /tm researcher/i },
    { key: 'held', label: '🎰 Held', title: 'Held Machine', idx: 83, re: /held machine/i },
    { key: 'trader', label: '🦖 Trader', title: 'Pokemaniac Trader', idx: 80, re: /pokemaniac/i }
  ];
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

  function beep(force) {
    if (state.muted && !force) return;

    try {
      const AC = PW.AudioContext || PW.webkitAudioContext;

      ac = ac || new AC();

      if (ac.state === 'suspended') {
        ac.resume();
      }

      const preset =
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

    beep();

    osNotify(
      'Poke Idle · ' + a.name,
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

  function renderDetails(h) {
    detailsHid = h.hid;

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
      <div id="mtal-d-img">
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
        <button type="button" id="mtal-d-buy">🛒 Comprar Agora</button>
      </div>`
      }

      <details class="mtal-d-raw">
        <summary>dados brutos (debug)</summary>
        <pre>${esc(
          rawTxt
        )}</pre>
      </details>
    `;

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
    d.style.top = 'auto';
    d.style.bottom = Math.max(0, window.innerHeight - r.bottom) + 'px';
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

    #mtal-panel{position:fixed;left:16px;bottom:64px;width:370px;max-height:72vh;overflow:hidden;z-index:2147483646;background:#12141f;color:#e8e3d0;border:1px solid #c9a44a;border-radius:10px;font:12px/1.4 Inter,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);display:none;padding:0}
    #mtal-panel[style*="display: block"]{display:flex!important;flex-direction:column}
    #mtal-panel-head{flex:none;position:sticky;top:0;z-index:2;background:#12141f;padding:10px 10px 0 10px;box-shadow:0 6px 10px -6px rgba(0,0,0,.65)}
    #mtal-panel-body{flex:1;min-height:0;overflow-y:auto;padding:0 10px 10px 10px;scrollbar-width:thin}
    #mtal-panel-body::-webkit-scrollbar{width:3px}
    #mtal-footer{flex:none;text-align:center;padding:6px 10px;font-size:10px;letter-spacing:.03em;color:#9aa0b8;border-top:1px solid #232840;background:#12141f}

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

    #mtal-panel .mtal-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #2c3148;border-radius:8px;margin-bottom:8px}
    #mtal-panel .mtal-row-check{flex:none;width:15px;height:15px}
    #mtal-panel .mtal-row-body{flex:1;min-width:0}
    #mtal-panel .mtal-row-body b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mtal-panel .mtal-row-actions{display:flex;align-items:center;gap:10px;flex:none}
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

    #mtal-form{
      border:1px dashed #4a4f66;
      border-radius:10px;
      padding:14px;
      margin-top:10px
    }

    #mtal-form label{
      display:block;
      margin:10px 0
    }

    #mtal-form label:first-of-type{
      margin-top:0
    }

    #mtal-form input[type=text],
    #mtal-form input[type=number],
    #mtal-form select{
      background:#0d0f18;
      color:#e8e3d0;
      border:1px solid #4a4f66;
      border-radius:6px;
      padding:7px 9px;
      width:160px;
      margin-top:5px
    }

    #mtal-form input[type=number]{
      width:100px
    }

    #mtal-form .mtal-form-actions{
      display:flex;
      gap:8px;
      margin-top:14px
    }

    #mtal-form .mtal-form-actions button{
      padding:8px 14px
    }

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

    #mtal-mk{position:fixed;left:16px;top:4vh;width:min(1240px,calc(100vw - 350px));min-width:760px;height:92vh;z-index:2147483646;background:#12141f;color:#e8e3d0;border:1px solid #c9a44a;border-radius:10px;font:12px/1.4 Inter,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden}
    #mtal-mk [hidden]{display:none!important}
    #mtal-mk button{background:#252a3d;color:#e8e3d0;border:1px solid #4a4f66;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
    #mtal-mk button:hover{border-color:#b5934f}
    #mtal-mk button:disabled{opacity:.6;cursor:default}
    #mtal-mk .mk-head{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid #232840}
    #mtal-mk .mk-head b{color:#e0b95a;font-size:14px}
    #mtal-mk .mk-cats{display:flex;gap:4px}
    #mtal-mk .mk-cat.active{background:#3d3420;border-color:#c9a44a;color:#f0d78c}
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
    #mtal-mk .mk-side{display:flex;flex-direction:column;gap:4px;padding:10px;border-right:1px solid #232840;overflow:auto}
    #mtal-mk .mk-side .mk-cat{text-align:left;padding:9px 12px;font-weight:600}
    #mtal-mk .mk-fcol{display:flex;flex-direction:column;gap:12px;padding:10px 12px;border-right:1px solid #232840;overflow:auto;scrollbar-width:thin}
    #mtal-mk .mk-fh{color:#e0b95a;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    #mtal-mk .mk-fl{display:flex;flex-direction:column;gap:5px;color:#9aa0b8;font-size:11px}
    #mtal-mk .mk-fcol input[type=text],#mtal-mk .mk-fcol select{width:100%}
    #mtal-mk .mk-range{display:flex;align-items:center;gap:6px}
    #mtal-mk .mk-range input[type=text]{flex:1;min-width:0}
    #mtal-mk .mk-range i{font-style:normal;color:#7c829c}
    #mtal-mk .mk-chk{display:flex;align-items:center;gap:6px;color:#c7cbe0;cursor:pointer}
    #mtal-mk .mk-fcol .mk-chips{padding:0}
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
    #mtal-mk .mk-empty{text-align:center;color:#7c829c;padding:30px}
    #mtal-mk .mk-foot{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #232840;color:#9aa0b8}
    #mtal-mk:not([data-mode="buy"]) .mk-buyv,#mtal-mk:not([data-mode="sell"]) .mk-sellv,#mtal-mk:not([data-mode="hist"]) .mk-histv{display:none!important}
    #mtal-mk #mk-hist{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;scrollbar-width:thin}
    #mtal-mk .hist-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    #mtal-mk .mk-seg{display:flex}
    #mtal-mk .mk-seg button{border-radius:0}
    #mtal-mk .mk-seg button:first-child{border-radius:6px 0 0 6px}
    #mtal-mk .mk-seg button:last-child{border-radius:0 6px 6px 0;border-left:none}
    #mtal-mk .mk-seg button.on{background:#3d3420;border-color:#c9a44a;color:#f0d78c}
    #mtal-mk #sl-filter{width:180px}
    #mtal-mk .sl-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));grid-auto-rows:max-content;align-content:start;gap:8px;margin:10px 0;overflow:auto;padding:2px;scrollbar-width:thin}
    #mtal-mk .sl-grid .mk-empty{grid-column:1/-1}
    #mtal-mk .sl-card{display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;background:#1a1e30;border:1px solid #2c3148;border-radius:8px;min-width:0}
    #mtal-mk .sl-card.on{border-color:#c9a44a;background:#2a2716}
    #mtal-mk .sl-thumb{width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:16px}
    #mtal-mk .sl-thumb img{max-width:100%;max-height:100%;image-rendering:pixelated}
    #mtal-mk .sl-cname{font-size:11px;font-weight:600;color:#f2ead0;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mtal-mk .sl-bar{padding:10px;background:#171a28;border:1px solid #2c3148;border-radius:8px}
    #mtal-mk .sl-pf{margin-top:8px}
    #mtal-mk #sl-rar{padding:0}
    #mtal-mk .sl-grid.list{display:block}
    #mtal-mk .sl-row,#mtal-mk .mtal-mkrow{cursor:pointer}
    #mtal-mk .mtal-mkrow.on td{background:#2a2716}
    #mtal-mk .sl-row.on td{background:#2a2716}
    #mtal-mk .sl-table{width:100%}
    #mtal-mk .mk-coll{cursor:pointer;user-select:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#171a28;border:1px solid #2c3148;border-radius:8px;transition:border-color .15s,color .15s}
    #mtal-mk .mk-coll:hover{color:#f0d78c;border-color:#b5934f}
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
    #mtal-details #mtal-d-buy{flex:1}
    #mtal-mk .mk-modes{display:flex;gap:4px;padding-right:12px;border-right:1px solid #2c3148}
    #mtal-mk .mk-mode.active{background:#3d3420;border-color:#c9a44a;color:#f0d78c}
    #mtal-mk .mk-npcs{display:flex;flex-wrap:wrap;gap:4px}
    #mtal-mk .mk-npc{padding:5px 9px;color:#c7cbe0}
    #mtal-mk .mk-npc.active{background:#3d3420;border-color:#c9a44a;color:#f0d78c}
    #mtal-mk:not([data-mode^="npc"]) .mk-npcv{display:none!important}
    #mtal-mk #mk-npc{flex:1;min-height:0;overflow:auto;padding:0 12px 12px;scrollbar-width:thin}
    #mtal-mk .npc-head{display:flex;align-items:center;gap:12px;margin-top:12px}
    #mtal-mk .npc-head b{color:#e0b95a;font-size:14px}
    #mtal-mk .npc-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    #mtal-mk #mk-npc .sl-grid{overflow:visible;margin:6px 0 0}
    #mtal-mk .sl-card.npc-ro{cursor:default}
    #mtal-mk .npc-note{margin-top:10px}
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

        <div
          id="mtal-form"
          hidden
        >
          <div
            class="mtal-h"
            id="f-title"
            style="margin-top:0"
          >
            Novo alerta
          </div>

          <label>
            Tipo

            <select id="f-kind">
              <option value="pokemon">
                Pokémon
              </option>

              <option value="items">
                Item / Stone / Ball / Diamonds
              </option>
            </select>
          </label>

          <div id="f-poke">
            <label>
              Espécie

              <input
                type="text"
                id="f-species"
                list="mtal-species"
                placeholder="qualquer"
              >
            </label>

            <datalist id="mtal-species"></datalist>

            <label>
              IV total mín

              <input
                type="number"
                id="f-iv"
                min="0"
                max="192"
                placeholder="sem mínimo"
              >
            </label>

            <label>
              Qualidade mín

              <input
                type="number"
                id="f-q"
                step="0.01"
                min="0"
                placeholder="sem mínimo"
              >
            </label>
          </div>

          <div id="f-item" hidden>
            <label>
              Categoria

              <select id="f-cat">
                ${CATEGORIES.map(
                  (c) =>
                    `<option value="${esc(c)}">${esc(
                      catLabel(c)
                    )}</option>`
                ).join('')}
              </select>
            </label>

            <label>
              Nome contém

              <input
                type="text"
                id="f-text"
                placeholder="ex.: pheromone"
              >
            </label>

            <label>
              <input
                type="checkbox"
                id="f-npc"
              >

              só abaixo do preço do NPC
            </label>
          </div>

          <label>
            Preço máx

            <input
              type="number"
              id="f-price"
              min="0"
              placeholder="sem limite"
            >

            <select
              id="f-cur"
              style="width:90px"
            ></select>
          </label>

          <div id="f-shiny-row">
            <label>
              <input
                type="checkbox"
                id="f-shiny"
              >

              só shiny
            </label>
          </div>

          <div
            class="mtal-sub"
            style="margin:0 0 6px"
          >
            Vazio = sem limite. Ao definir um preço,
            escolha a moeda: "qualquer" compara só o
            número, sem olhar a moeda.
          </div>

          <div class="mtal-form-actions">
            <button id="f-cancel">
              Cancelar
            </button>

            <button id="f-save">
              Salvar alerta
            </button>
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
        LiveSearch v${VERSION}
      </div>
    </div>

    <div id="mtal-mk" data-mode="buy">
      <div class="mk-head">
        <b>🏪 Mercado</b>

        <div class="mk-modes">
          <button type="button" class="mk-mode active" data-mode="buy">Comprar</button>
          <button type="button" class="mk-mode" data-mode="sell">Vendas</button>
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
              `<button type="button" class="mk-cat" data-cat="${esc(v)}">${esc(l)}</button>`
          ).join('')}
        </nav>

        <aside class="mk-fcol" id="mk-filters">
          <div class="mk-fh">Filtros</div>

          <label class="mk-fl">
            <span>Buscar</span>
            <input type="text" id="mk-q" autocomplete="off">
          </label>

          <div class="mk-fl mk-poke">
            <span>IV total</span>
            <div class="mk-range">
              <input type="text" id="mk-iv1" placeholder="mín" inputmode="numeric">
              <i>–</i>
              <input type="text" id="mk-iv2" placeholder="máx" inputmode="numeric">
            </div>
          </div>

          <div class="mk-fl mk-poke">
            <span>Nível</span>
            <div class="mk-range">
              <input type="text" id="mk-lv1" placeholder="mín" inputmode="numeric">
              <i>–</i>
              <input type="text" id="mk-lv2" placeholder="máx" inputmode="numeric">
            </div>
          </div>

          <label class="mk-fl mk-poke">
            <span>Qualidade mín (×)</span>
            <input type="text" id="mk-qmin" placeholder="1.40" inputmode="decimal">
          </label>

          <div class="mk-fl mk-poke">
            <span>Raridade</span>
            <div class="mk-chips" id="mk-chips">
              ${QUALITY_TIERS.slice()
                .reverse()
                .map(([, l]) => {
                  const c = RARITY_COLOR[l.toLowerCase()] || '#c7cbe0';

                  return `<button type="button" class="mk-chip" data-r="${esc(l)}" style="color:${c};border-color:${c}">${esc(l)}</button>`;
                })
                .join('')}
            </div>
          </div>

          <label class="mk-chk mk-poke">
            <input type="checkbox" id="mk-shiny">
            ✨ Só shiny
          </label>

          <label class="mk-chk mk-item">
            <input type="checkbox" id="mk-npc">
            Abaixo do NPC
          </label>

          <label class="mk-fl">
            <span>Moeda</span>
            <select id="mk-cur">
              <option value="">Todas moedas</option>
              <option value="GOLD">$ Dólares</option>
              <option value="DIAMONDS">💎 Diamantes</option>
            </select>
          </label>

          <label class="mk-fl" id="mk-pg-wrap">
            <span>Preço máx ($ Dólares)</span>
            <input type="text" id="mk-pmax-g" placeholder="sem limite" inputmode="numeric">
          </label>

          <label class="mk-fl" id="mk-pd-wrap">
            <span>Preço máx (💎 Diamantes)</span>
            <input type="text" id="mk-pmax-d" placeholder="sem limite" inputmode="numeric">
          </label>

          <button type="button" id="mk-clear">Limpar filtros</button>
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
  function renderHits() {
    const t = (ms) =>
      new Date(ms).toLocaleTimeString(
        'pt-BR'
      );

    $('mtal-hits').innerHTML =
      hits.length
        ? hits
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
              ${t(h.t)}
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
          <div class="mtal-empty">
            Nada ainda. Quando um anúncio novo
            bater com um alerta, ele aparece aqui.
          </div>
        `;

    hits.forEach(
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
          Nenhum alerta ainda. Crie o primeiro abaixo.
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

          return `
            <div class="mtal-row">
              <input
                type="checkbox"
                class="mtal-row-check"
                data-t="${a.id}"
                ${
                  a.enabled
                    ? 'checked'
                    : ''
                }
              >

              <div class="mtal-row-body">
                <b>
                  ${esc(a.name)}
                </b>

                <div class="mtal-sub">
                  ${status}
                </div>
              </div>

              <div class="mtal-row-actions">
                <span
                  class="mtal-e"
                  data-e="${a.id}"
                  title="Editar"
                >
                  ✎
                </span>

                <span
                  class="mtal-x"
                  data-d="${a.id}"
                  title="Excluir"
                >
                  ✕
                </span>
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
  new ResizeObserver(positionDetails).observe($('mtal-mk'));
  window.addEventListener('resize', positionDetails);

  /* ---------- ativar/desativar ---------- */
  function setOn(v) {
    state.on = v;

    $('mtal-on')
      .checked = v;

    save();

    if (!v) {
      panelOpen = false;

      $('mtal-panel')
        .style.display =
        'none';
    }

    toast(
      v
        ? 'LiveSearch: ativado'
        : 'LiveSearch: desativado',
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
        const ds =
          e.target.dataset ||
          {};

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
    mode: 'buy'
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
      }
    }
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

    $('mk-thead').innerHTML =
      '<tr>' +
      (poke
        ? th('') + th('Pokémon') + th('Nv', 'lvl') + th('IV', 'iv') + th('Raridade', 'q') + th('Tipos') + th('Preço', 'price', 'r') + th('')
        : mk.cat === 'all'
          ? th('') + th('Anúncio') + th('Categoria') + th('Qtd', 'qty') + th('Preço', 'price', 'r') + th('')
          : th('') + th('Item') + th('Qtd', 'qty') + th('Preço/un', 'price', 'r') + th('')) +
      '</tr>';

    const rows = mkVisible();

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

    rows.forEach(ensureSprite);

    $('mk-count').textContent =
      rows.length + ' de ' + mk.rows.length + ' carregados' + (mk.loading && mk.rows.length ? ' · carregando…' : '');

    $('mk-more').hidden = !poke || mk.done;
    $('mk-more').disabled = mk.loading;
  }

  function mkOpen() {
    $('mtal-mk').style.display = 'flex';

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
  });

  let mkTimer = null;

  const mkOnFilter = () => {
    clearTimeout(mkTimer);

    mkTimer = setTimeout(() => {
      if (mkServerKey(mkFilters()) !== mk.key) {
        mkLoad(true);
      } else {
        mkRender();
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
    mk.rar.clear();
    document.querySelectorAll('#mtal-mk .mk-chip').forEach((c) => c.classList.remove('on'));
    mkOnFilter();
  });

  $('mk-thead').addEventListener('click', (e) => {
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
    const tr = e.target.closest('tr[data-hid]');

    if (!b && !tr) return;

    const h = mk.rows.find((x) => x.hid === +(b || tr).dataset.hid);

    if (!h) return;

    document.querySelectorAll('#mk-tbody tr[data-hid]').forEach((r) => r.classList.toggle('on', r === tr));

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

    grid.classList.toggle('list', list);

    let html;

    if (!cards.length) {
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

  const npcSt = { key: null, data: {}, cards: [], loading: false, err: '' };

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

      body =
        npcSec('Poké Balls', (d.balls || []).map((x) => sell(x, true)).join('')) +
        npcSec('Itens', (d.items || []).map((x) => sell(x, false)).join(''));
    } else if (key === 'depot') {
      info = 'Depósito: ' + (d.depot || []).length + '/' + d.maxSlots + ' slots';

      const mv = (x, inInv) =>
        npcCard(iconUrl(x.icon), x.name, fmt(x.quantity) + '×', () =>
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
                const r = await gamePost('/api/game/depot/move', { itemId: x.id, dir: inInv ? 'store' : 'withdraw' });

                npcSt.data.depot = r;

                const a = depotToOwned(r);

                if (a) setOwned(a);

                toast((inInv ? 'Guardado: ' : 'Retirado: ') + x.name);
                hideDetails();
                npcRender();
              }
            }
          })
        );

      body =
        '<div class="npc-cols">' +
        npcSec('🎒 Mochila (' + (d.inventory || []).length + ')', (d.inventory || []).map((x) => mv(x, true)).join(''), 'Mochila vazia.') +
        npcSec('📦 Depósito (' + (d.depot || []).length + ')', (d.depot || []).map((x) => mv(x, false)).join(''), 'Depósito vazio.') +
        '</div>';
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

      body =
        ro +
        npcSec(
          'Ofertas',
          (d.offers || [])
            .map((x) =>
              npcCard(
                '',
                x.name,
                (x.isTrade ? 'Troca' : '$ ' + fmt(x.price)) +
                  (x.needsEevee ? ' · precisa Eevee' : '') +
                  (x.canBuy === false ? ' · <span style="color:#c0392b">indisponível</span>' : ''),
                null,
                x.name
              )
            )
            .join('')
        );
    }

    $('npc-info').textContent = info;
    $('npc-body').innerHTML = body;

    npcSt.pseudo.forEach(ensureSprite);
  }

  $('npc-body').addEventListener('click', (e) => {
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
