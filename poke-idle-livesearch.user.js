// ==UserScript==
// @name         Poke Idle - LiveSearch
// @namespace    poke-idle-market
// @version      0.4.11
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
  const VERSION = '0.4.11';
  const API = '/api/game/market';
  const POLL_POKEMON_MS = 8000;
  const POLL_ITEMS_MS = 20000;
  const MAX_HITS = 40;
  const CATEGORIES = ['Items', 'Stones', 'Poke Balls', 'Diamonds'];
  const CATEGORY_LABELS = { Diamonds: 'Diamantes' };
  const catLabel = (c) => CATEGORY_LABELS[c] || c || '';
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

      return _fetch.apply(this, arguments);
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

  async function buyListing(id, quantity) {
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
          body: JSON.stringify({
            action: 'buy',
            id,
            quantity
          })
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
    btn
  ) {
    const h =
      hits.find(
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

    if (h.kind !== 'pokemon') {
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
          ? `<div class="mtal-d-row"><span>Quantidade</span><span>${esc(
              h.quantity
            )}</span></div>`
          : ''
      }

      <div class="mtal-d-row">
        <span>Abaixo do NPC</span>
        <span>${
          h.belowNpc
            ? 'Sim'
            : 'Não'
        }</span>
      </div>
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

      <div id="mtal-d-price">
        <span>${
          isPurchased
            ? 'Comprado por'
            : 'Preço unitário'
        }</span>

        <b>
          ${currencyIcon(
            h.currency
          )}
          ${esc(priceTxt)}
        </b>
      </div>

      ${
        isPurchased
          ? ''
          : `<div id="mtal-d-actions">
        <button
          type="button"
          id="mtal-d-market"
          title="Abrir no Market"
        >⚖️</button>

        ${
          h.buyable
            ? '<button type="button" id="mtal-d-buy">🛒 Comprar Agora</button>'
            : ''
        }
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
      $('mtal-d-buy').addEventListener(
        'click',
        () =>
          handleBuyClick(
            h.hid,
            $('mtal-d-buy')
          )
      );
    }

    if (!isPurchased) {
      $('mtal-d-market').addEventListener(
        'click',
        () =>
          tryNavigateToListing(h)
      );
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
    const p = $('mtal-panel');

    if (!d || d.style.display !== 'block' || p.style.display !== 'block') return;

    const r = p.getBoundingClientRect();

    d.style.left = (r.right + 10) + 'px';
    d.style.top = 'auto';
    d.style.bottom = Math.max(0, window.innerHeight - r.bottom) + 'px';
  }

  function showDetails(h) {
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

  async function tick() {
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
    #mtal-fab-row,#mtal-fab-row *,#mtal-panel,#mtal-panel *,#mtal-details,#mtal-details *{font-family:Inter,sans-serif!important}
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
