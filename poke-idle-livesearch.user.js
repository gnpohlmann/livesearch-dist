// ==UserScript==
// @name         Poke Idle - LiveSearch
// @namespace    poke-idle-market
// @version      0.4.75
// @description  LiveSearch by k4f
// @match        https://poke.idleworld.online/play*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      pokeapi.co
// @connect      raw.githubusercontent.com
// @connect      www.pokeidlemarket.com.br
// @updateURL    https://raw.githubusercontent.com/gnpohlmann/livesearch-dist/main/poke-idle-livesearch.user.js
// @downloadURL  https://raw.githubusercontent.com/gnpohlmann/livesearch-dist/main/poke-idle-livesearch.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- config ---------- */
  const PW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const VERSION = '0.4.75';
  const API = '/api/game/market';
  const POLL_POKEMON_MS = 8000;
  const POLL_ITEMS_MS = 20000;
  const MAX_HITS = 40;
  const CATEGORIES = ['Items', 'Stones', 'Poke Balls', 'Diamonds'];
  const CATEGORY_LABELS = { Diamonds: 'Diamantes' };
  const catLabel = (c) => CATEGORY_LABELS[c] || c || '';
  const NPCS = [
    { key: 'shop', label: 'Loja', title: 'Loja', idx: 79, re: /abrir loja$/i, win: /\bloja\b|\bshop\b/i },
    { key: 'depot', label: 'Depot', title: 'Depósito', idx: 86, re: /abrir dep[oó]sito/i, win: /dep[oó]sito|\bdepot\b/i },
    { key: 'flint', label: 'Stones', title: 'Stone Researcher', idx: 81, re: /stone researcher/i, win: /stone researcher/i },
    { key: 'tm', label: 'TMs', title: 'TM Researcher', idx: 82, re: /tm researcher/i, win: /tm researcher/i },
    { key: 'held', label: 'Held', title: 'Held Machine', idx: 83, re: /held machine/i, win: /held machine/i },
    { key: 'trader', label: 'Trader', title: 'Pokemaniac Trader', idx: 80, re: /pokemaniac/i, win: /pokemaniac|trader/i }
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

  /* ---------- gravador (p/ capturar ações ainda desconhecidas do jogo) ---------- */
  const netCap = { on: false, log: [] };

  function capPush(o) {
    if (!netCap.on) return;

    netCap.log.push({ t: new Date().toISOString().slice(11, 19), ...o });

    if (netCap.log.length > 120) netCap.log.shift();

    try {
      const b = $('npc-cap-n');

      if (b) {
        b.textContent = netCap.log.length;
        b.parentElement.disabled = false;
      }
    } catch (e) {}
  }

  const cut = (v, n) => {
    v = typeof v === 'string' ? v : v == null ? '' : (() => {
      try {
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    })();

    return v.length > n ? v.slice(0, n) + '…(+' + (v.length - n) + ')' : v;
  };

  async function capCopy() {
    const txt = JSON.stringify({ v: '0.4.63', log: netCap.log }, null, 1);

    try {
      await navigator.clipboard.writeText(txt);
    } catch (e) {
      const ta = document.createElement('textarea');

      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }

    toast('Gravação copiada (' + netCap.log.length + ' registros). Cole aqui no chat.');
  }

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

  const capSeen = new WeakSet();
  const wsSt = { sock: null, pokes: null, fam: null, waits: [], seen: new WeakSet() };

  function wsIn(ev, v) {
    try {
      const tg = ev.target || ev.currentTarget;

      if ((!wsSt.sock || wsSt.sock.readyState !== 1) && tg && typeof tg.send === 'function' && 'readyState' in tg && !/livesearch/i.test(String(tg.url || ''))) wsSt.sock = tg;
    } catch (e) {}

    if (typeof v !== 'string' || wsSt.seen.has(ev)) return;
    if (!(v.startsWith('{"type":"pokes"') || v.startsWith('{"type":"family"') || v.startsWith('{"type":"error"') || v.startsWith('{"type":"toast"') || v.startsWith('{"type":"family-'))) return;

    wsSt.seen.add(ev);

    let j;

    try {
      j = JSON.parse(v);
    } catch (e) {
      return;
    }

    if (j.type === 'pokes' && Array.isArray(j.list)) wsSt.pokes = j.list;
    if (j.type === 'family') wsSt.fam = j;

    wsSt.waits = wsSt.waits.filter((w) => {
      if (w.types.includes(j.type)) {
        w.res(j);
        return false;
      }

      return true;
    });

    try {
      if (
        (j.type === 'pokes' || j.type === 'family') &&
        ((npcSt.key === 'depot' && npcSt.depotTab && npcSt.depotTab !== 'items') ||
          (npcSt.key === 'shop' && npcSt.shopTab === 'sell' && npcSt.shopSellKind === 'poke'))
      ) {
        clearTimeout(wsSt.rt);
        wsSt.rt = setTimeout(npcRender, 30);
      }
    } catch (e) {}
  }

  function wsSend(obj, waitTypes, ms = 5000) {
    const sk = wsSt.sock;

    if (!sk || sk.readyState !== 1) return Promise.reject(new Error('conexão do jogo não encontrada (aguarde uns segundos)'));

    const p = waitTypes
      ? new Promise((res, rej) => {
          const w = { types: waitTypes, res };

          wsSt.waits.push(w);
          setTimeout(() => {
            if (wsSt.waits.includes(w)) {
              wsSt.waits = wsSt.waits.filter((x) => x !== w);
              rej(new Error('o jogo não respondeu'));
            }
          }, ms);
        })
      : Promise.resolve(null);

    sk.send(JSON.stringify(obj));

    return p;
  }

  try {
    const WSP = PW.WebSocket && PW.WebSocket.prototype;
    const _send = WSP && WSP.send;

    if (_send) {
      WSP.send = function (d) {
        try {
          if (!/localhost|livesearch/i.test(String(this.url || ''))) wsSt.sock = this;
        } catch (e) {}

        try {
          if (typeof d === 'string' && /^\{"type":"[^"]*(held|trader|pokemaniac)[^"]*"/i.test(d)) {
            store.set(/held/i.test(d.slice(0, 40)) ? 'learnHeldWs' : 'learnTraderWs', d);
            log('ação aprendida (ws):', d);
          }
        } catch (e) {}

        try {
          if (netCap.on && typeof d === 'string' && !/^\{"type":"(ping|pong|move|pos)"/.test(d)) capPush({ kind: 'ws>', data: cut(d, 3000) });
        } catch (e) {}

        return _send.apply(this, arguments);
      };
    }
  } catch (e) {}

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
            wsIn(this, v);
          } catch (e) {}

          try {
            if (netCap.on && typeof v === 'string' && !capSeen.has(this)) {
              capSeen.add(this);

              if (!/^\{"type":"(inventory|tick|pong|ping|pos|move|players?)"/.test(v)) capPush({ kind: 'ws<', data: cut(v, 4000) });
            }
          } catch (e) {}

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

  const lcache = store.get('mkSeenById', {}) || {};
  let goneLog = store.get('mkGone', []) || [];
  let lcT = null;

  const lcSave = () => {
    clearTimeout(lcT);
    lcT = setTimeout(() => {
      const ks = Object.keys(lcache);

      if (ks.length > 3000) {
        ks.sort((a, b) => lcache[a].t - lcache[b].t)
          .slice(0, ks.length - 3000)
          .forEach((k) => delete lcache[k]);
      }

      if (goneLog.length > 800) goneLog = goneLog.slice(-800);

      store.set('mkSeenById', lcache);
      store.set('mkGone', goneLog);
    }, 1500);
  };

  function lcPut(l) {
    if (!l || l.kind !== 'pokemon' || !l.id || l.speciesId == null) return;

    const o = lcache[l.id];
    const now = Date.now();

    lcache[l.id] = {
      id: l.id,
      sid: +l.speciesId,
      name: l.name,
      lv: l.level,
      iv: l.ivTotal,
      q: l.quality != null ? Number(l.quality) : null,
      sh: !!l.shiny,
      p: l.price,
      cur: l.currency,
      off: !!l.offerOnly,
      t0: o ? o.t0 : now,
      t: now
    };
  }

  // varre todas as páginas de uma espécie; o que sumiu desde a última vez vira "saída"
  const spScanP = {};

  function speciesScan(sid) {
    sid = +sid;

    if (spScanP[sid] && Date.now() - spScanP[sid].t < 20000) return spScanP[sid].p;

    const p = (async () => {
      const t0 = Date.now();
      const cur = new Map();
      let complete = false;

      for (let page = 1; page <= 10; page++) {
        const d = await api('?browse=pokemon&page=' + page + '&sort=recent&speciesId=' + sid, 15000);
        const L = ((d && d.listings) || []).filter((l) => l && l.kind === 'pokemon');
        let added = 0;

        L.forEach((l) => {
          if (!cur.has(l.id)) {
            cur.set(l.id, l);
            added++;
          }
        });

        if (!L.length || !added) {
          complete = true;
          break;
        }
      }

      rememberListings([...cur.values()]);

      if (complete) {
        Object.values(lcache).forEach((o) => {
          if (o.sid === sid && !cur.has(o.id) && o.t < t0) {
            goneLog.push({ ...o, gone: t0 });
            delete lcache[o.id];
          }
        });

        lcSave();
      }

      return [...cur.values()];
    })();

    spScanP[sid] = { t: Date.now(), p };
    p.catch(() => delete spScanP[sid]);

    return p;
  }

  function rememberListings(list) {
    let n = 0;

    (list || []).forEach((l) => {
      try {
        lcPut(l);
      } catch (e) {}

      if (!l || l.kind !== 'pokemon' || !l.name) return;

      seenL[seenKey(l.name, l.price, l.currency)] = { ...l, _t: Date.now() };
      n++;
    });

    if (!n) return;

    lcSave();

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
        const u0 = String((input && input.url) || input || '');

        const m0 = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

        if (m0 === 'POST' && /\/api\/game\/(held-machine|pokemaniac-trader)/.test(u0)) {
          const b0 = typeof (init && init.body) === 'string' ? init.body : '';
          const isHeld = u0.includes('held-machine');

          if (isHeld || !/"speciesId"/.test(b0)) {
            store.set(isHeld ? 'learnHeld' : 'learnTrader', { url: u0.replace(location.origin, ''), body: b0 });
            log('ação aprendida:', isHeld ? 'Held' : 'Trader', u0, b0);
          }
        }

        if (netCap.on && u0.includes('/api/') && !u0.includes('/api/game/market') && !u0.includes('creatures.json')) {
          const rec = { kind: 'http', method: (init && init.method) || (input && input.method) || 'GET', url: u0.replace(location.origin, ''), body: cut(init && init.body, 3000) };

          capPush(rec);
          res
            .then((r) => r.clone().text())
            .then((t) => {
              rec.resp = cut(t, 6000);
            })
            .catch(() => {});
        }
      } catch (e) {}

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

  function speciesIdsOf(a) {
    if (Array.isArray(a.species) && a.species.length) return a.species.map((x) => +x.speciesId);

    return a.speciesId ? [+a.speciesId] : [];
  }

  function queryOf(a) {
    if (a.kind === 'pokemon') {
      let q = '?browse=pokemon&page=1&sort=recent';

      const ids = speciesIdsOf(a);

      if (ids.length === 1) q += '&speciesId=' + ids[0];
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
      const ids = speciesIdsOf(a);

      if (ids.length && !ids.includes(+l.speciesId)) return false;
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

    autoBuyHit(a, hit);
  }

  let cpopDone = null;
  let cpopFinish = null;

  function confirmPop(anchor, detail) {
    if (cpopDone) cpopDone(false);
    if (cpopFinish) cpopFinish(false);

    let el = $('mtal-cpop');

    if (!el) {
      el = document.createElement('div');
      el.id = 'mtal-cpop';
      document.body.appendChild(el);
    }

    el.innerHTML = `
      <button type="button" class="cp-x" title="Cancelar">✕</button>
      <b>Confirmar compra?</b>
      ${detail ? `<small>${esc(detail)}</small>` : ''}
      <button type="button" class="cp-ok">Confirmar</button>
      <i class="cp-arrow"></i>`;
    el.style.display = 'flex';
    el.style.visibility = 'hidden';

    const card = (anchor && anchor.closest('.mtal-hit, .mkc, .mkc-row, .mkc-cell')) || anchor;
    const panel = anchor && anchor.closest('#mtal-panel');
    const cr = card.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const gap = 10;
    let side = 'r';
    let x;

    if (panel) {
      const pr = panel.getBoundingClientRect();

      x = pr.right + gap;

      if (x + w > innerWidth - 8) {
        x = pr.left - gap - w;
        side = 'l';
      }
    } else {
      x = cr.right + gap;

      if (x + w > innerWidth - 8) {
        x = cr.left - gap - w;
        side = 'l';
      }
    }

    const cy = cr.top + cr.height / 2;
    const y = Math.max(8, Math.min(innerHeight - hgt - 8, cy - hgt / 2));

    el.style.left = Math.max(8, x) + 'px';
    el.style.top = y + 'px';
    el.className = side;
    el.querySelector('.cp-arrow').style.top = Math.max(12, Math.min(hgt - 12, cy - y)) + 'px';
    el.style.visibility = '';
    card.classList.add('mtal-confirming');

    return new Promise((res) => {
      const close = () => {
        el.style.display = 'none';
        card.classList.remove('mtal-confirming');
      };
      const done = (v) => {
        cpopDone = null;
        document.removeEventListener('mousedown', outside, true);
        document.removeEventListener('keydown', key, true);

        if (!v) {
          close();
          return res(false);
        }

        const ok = el.querySelector('.cp-ok');

        ok.disabled = true;
        ok.textContent = 'Comprando…';
        el.querySelector('.cp-x').style.display = 'none';

        cpopFinish = (bought) => {
          cpopFinish = null;

          if (!bought) return close();

          ok.classList.add('done');
          ok.textContent = 'Comprado ✓';
          setTimeout(() => {
            if (!cpopDone && !cpopFinish) close();
          }, 1000);
        };

        res(true);
      };
      const outside = (e) => {
        if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) done(false);
      };
      const key = (e) => {
        if (e.key === 'Escape') done(false);
        else if (e.key === 'Enter') {
          e.preventDefault();
          done(true);
        }
      };

      cpopDone = done;
      el.querySelector('.cp-ok').onclick = () => done(true);
      el.querySelector('.cp-x').onclick = () => done(false);
      setTimeout(() => {
        document.addEventListener('mousedown', outside, true);
        document.addEventListener('keydown', key, true);
      }, 0);
      el.querySelector('.cp-ok').focus();
    });
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
      !(await confirmPop(btn, h.name + ' · ' + priceTxt))
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

      recordPurchase(h, res, 'Comprado: ');

      if (cpopFinish) cpopFinish(true);
    } catch (e) {
      if (cpopFinish) cpopFinish(false);

      toast(
        'Erro ao comprar: ' +
          ((e && e.message) || e)
      );

      btn.disabled = false;
      btn.textContent =
        original;
    }
  }

  function recordPurchase(h, res, label) {
    const hid = h.hid;

    setTimeout(renderPurchasedCount, 0);

    toast(
      label +
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
  }

  async function autoBuyHit(a, h) {
    if (!a.autoBuy || !state.on || !h.buyable || h.autoBuying) return;
    if (a.maxPrice == null || !a.currency || h.currency !== a.currency || !(h.price <= a.maxPrice)) return;

    const left = a.maxBuy ? a.maxBuy - (a.boughtCount || 0) : Infinity;

    if (left <= 0) return;

    h.autoBuying = true;

    const qty = h.kind === 'pokemon' ? 1 : Math.max(1, Math.min(h.quantity || 1, left));

    a.boughtCount = (a.boughtCount || 0) + qty;

    try {
      const res = await buyListing(h.id, qty);

      recordPurchase(h, res || {}, '⚡ Auto-compra: ');
      save();
      renderList();

      if (a.maxBuy && a.boughtCount >= a.maxBuy) toast('⚡ ' + a.name + ': quantidade máxima atingida (' + fmt(a.maxBuy) + ').');
      log('AUTO-COMPRA', a.name, '→', h.name, qty);
    } catch (e) {
      a.boughtCount = Math.max(0, (a.boughtCount || 0) - qty);
      h.autoBuying = false;
      toast('Auto-compra falhou (' + h.name + '): ' + ((e && e.message) || e));
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
              lvl: pick(s, ['learnLevel', 'level', 'lvl']),
              cat: pick(s, ['category', 'damageClass', 'damage_class', 'moveClass', 'class', 'attackType', 'kind'])
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
        h.inventory && h.kind === 'pokemon' && h.invRef
          ? `<div class="d-mkc"><div class="mkc-grid">${mkPokeCard(h, '')}</div></div>`
          : rich
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
          h.price && h.kind !== 'pokemon'
            ? `<div class="mtal-d-npc">Valor no NPC: $ ${esc(fmt(h.price))}</div>`
            : ''
        }
      </div>
      ${h.kind === 'pokemon' ? '<div id="mtal-d-cmp" class="cmp"></div>' : ''}`
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
        ${
          h.npcAction.steps
            ? `<div class="mtal-d-steps">${h.npcAction.steps
                .map((k) => `<button type="button" data-step="${k}">+${k >= 1000 ? k / 1000 + 'k' : k}</button>`)
                .join('')}<button type="button" data-step="0" title="Voltar para 1">↺</button></div>`
            : ''
        }

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

      document.querySelectorAll('#mtal-details [data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = +b.dataset.step;
          const cur = qv();
          let n = !k ? 1 : cur <= 1 ? k : cur + k;

          if (A.max) n = Math.min(n, A.max);

          q.value = fmt(n);
          total();
        })
      );

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

      if (h.kind === 'pokemon' && $('mtal-d-cmp')) cmpInit(h);
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

    if (detailsAnchor === 'mtal-mk') {
      d.style.boxSizing = 'border-box';
      d.style.maxHeight = 'none';
      d.style.height = r.height + 'px';
      d.style.top = r.top + 'px';

      return;
    }

    d.style.boxSizing = '';
    d.style.maxHeight = '';
    d.style.height = '';
    d.style.top = Math.max(0, Math.min(r.top, window.innerHeight - d.offsetHeight)) + 'px';
  }

  const cmpM = () => {
    const m = store.get('cmpMargin', null) || {};

    return { iv: m.iv != null ? m.iv : 5, q: m.q != null ? m.q : 0.05 };
  };

  const agoTxt = (t) => {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));

    return s < 60 ? 'agora' : s < 3600 ? 'há ' + Math.round(s / 60) + ' min' : s < 86400 ? 'há ' + Math.round(s / 3600) + ' h' : 'há ' + Math.round(s / 86400) + ' d';
  };

  const priceTxt2 = (p, cur) => (cur === 'DIAMONDS' || cur === 'DIAMOND' ? '💎 ' : '$ ') + fmt(p);

  /* ---------- saídas do PokeIdle Market (pokeidlemarket.com.br) ---------- */
  const extCache = new Map();

  function extHistory(name, ivMin, qMin) {
    const url =
      'https://www.pokeidlemarket.com.br/api/market/history?category=Pokemon&currency=All&search=' +
      encodeURIComponent(name) +
      (ivMin != null ? '&minIv=' + Math.max(0, Math.floor(ivMin)) : '') +
      (qMin != null ? '&minQuality=' + Math.max(0, qMin).toFixed(2) : '') +
      '&period=7d&sortBy=endedAt&sortOrder=desc&limit=30';
    const c = extCache.get(url);

    if (c && Date.now() - c.t < 60000) return c.p;

    const p = new Promise((res, rej) => {
      if (typeof GM_xmlhttpRequest !== 'function') return rej(new Error('sem permissão de rede'));

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { accept: 'application/json' },
        timeout: 15000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) {
            let msg = 'HTTP ' + r.status;

            try {
              const j = JSON.parse(r.responseText);

              if (j && j.error) msg = j.error;
            } catch (e) {}

            log('PokeIdle Market erro:', url, r.status, r.responseText && r.responseText.slice(0, 300));

            return rej(new Error('PokeIdle Market: ' + msg));
          }

          try {
            const j = JSON.parse(r.responseText);

            log('PokeIdle Market:', url, j);
            res(extParse(j));
          } catch (e) {
            rej(new Error('PokeIdle Market: resposta inesperada'));
          }
        },
        onerror: () => rej(new Error('PokeIdle Market indisponível')),
        ontimeout: () => rej(new Error('PokeIdle Market não respondeu'))
      });
    });

    extCache.set(url, { t: Date.now(), p });
    p.catch(() => extCache.delete(url));

    return p;
  }

  function extParse(d) {
    const findArr = (o, depth) => {
      if (Array.isArray(o)) return o;
      if (!o || typeof o !== 'object' || depth > 3) return null;

      for (const k of ['items', 'history', 'data', 'results', 'rows', 'listings', 'records', 'entries']) {
        const a = o[k] && findArr(o[k], depth + 1);

        if (a) return a;
      }

      for (const k in o) {
        const v = o[k];

        if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
      }

      return null;
    };

    const arr = findArr(d, 0) || [];
    const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const ts = (v) => {
      if (v == null) return null;
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;

      const t = Date.parse(v);

      return Number.isFinite(t) ? t : null;
    };

    const out = arr
      .map((it) => {
        if (!it || typeof it !== 'object') return null;

        const x = { ...(it.pokemon || {}), ...(it.listing || {}), ...(it.item || {}), ...it };
        const name = pick(x, ['name', 'itemName', 'pokemonName', 'title']) || '';
        const lvM = /Lv\.?\s*(\d+)/i.exec(name);
        const cur = String(pick(x, ['currency', 'cur', 'priceCurrency']) || 'GOLD');

        return {
          name,
          iv: num(pick(x, ['ivTotal', 'iv', 'iv_total', 'totalIv', 'ivSum'])),
          q: num(pick(x, ['quality', 'q', 'qualityMult'])),
          lv: num(pick(x, ['level', 'lvl'])) || (lvM ? +lvM[1] : null),
          sh: !!pick(x, ['shiny', 'isShiny']),
          p: num(pick(x, ['price', 'unitPrice', 'lastPrice', 'value', 'amount'])),
          cur: /dia/i.test(cur) ? 'DIAMONDS' : 'GOLD',
          off: false,
          gone: ts(pick(x, ['endedAt', 'soldAt', 'ended_at', 'removedAt', 'closedAt', 'at', 'updatedAt'])) || Date.now(),
          relisted: !!pick(x, ['relisted', 'relistedAfter', 'wasRelisted', 'relistedLater', 'isRelisted']),
          ext: true
        };
      })
      .filter((o) => o && o.p != null);

    if (!out.length && arr.length) log('PokeIdle Market: formato não reconhecido', arr[0]);

    return out;
  }

  function cmpInit(h) {
    const box = $('mtal-d-cmp');
    const r = h.raw || {};
    const sid = +r.speciesId;
    const forHid = h.hid;

    if (!sid) {
      box.innerHTML = '';
      return;
    }

    const base = { iv: h.ivTotal != null ? +h.ivTotal : null, q: h.quality != null ? +h.quality : null, sh: !!h.shiny };
    let live = null;
    let err = '';
    let ext = null;
    let extErr = '';

    const loadExt = () => {
      const m = cmpM();

      ext = null;
      extErr = '';
      extHistory(stripLv(h.name), base.iv != null ? base.iv - m.iv : null, base.q != null ? base.q - m.q : null)
        .then((L) => {
          ext = L;
          draw();
        })
        .catch((e) => {
          extErr = String((e && e.message) || e);
          ext = [];
          draw();
        });
    };

    const match = (o) => {
      const m = cmpM();

      if (!!o.sh !== base.sh) return false;
      if (base.iv != null && o.iv != null && Math.abs(o.iv - base.iv) > m.iv) return false;
      if (base.q != null && o.q != null && Math.abs(o.q - base.q) > m.q + 1e-9) return false;

      return true;
    };

    const minOf = (arr, dia) => {
      const ps = arr.filter((x) => !x.off && x.p != null && isDia(x.cur) === dia).map((x) => x.p);

      return ps.length ? Math.min(...ps) : null;
    };
    const lastOf = (arr, dia) => {
      const x = arr.find((y) => !y.off && y.p != null && isDia(y.cur) === dia);

      return x ? x.p : null;
    };
    const both = (g, dm) =>
      `<div class="cmp-cur"><b>${g != null ? '$ ' + fmt(g) : '<i>$ —</i>'}</b><b class="dia">${dm != null ? '💎 ' + fmt(dm) : '<i>💎 —</i>'}</b></div>`;

    const isDia = (c) => c === 'DIAMONDS' || c === 'DIAMOND';
    const row = (o, when) => `<div class="cmp-row" data-cmpp="${o.off ? '' : esc(o.p)}" data-cmpc="${isDia(o.cur) ? 'DIAMONDS' : 'GOLD'}" title="${o.off ? '' : 'Usar este preço e moeda'}">
        <span class="cmp-iv">IV <b>${o.iv != null ? esc(o.iv) : '-'}</b></span>
        <span class="cmp-q" style="color:${RARITY_COLOR[String(qualityTier(o.q) || '').toLowerCase()] || '#9aa0b8'}">×${o.q != null ? Number(o.q).toFixed(2) : '-'}</span>
        <span class="cmp-lv">Nv ${esc(o.lv || 1)}</span>
        <span class="cmp-rt">${when ? `<span class="cmp-when">${when}</span>` : ''}<b class="cmp-p">${o.off ? 'oferta' : esc(priceTxt2(o.p, o.cur))}</b></span>
      </div>`;

    const draw = () => {
      if (detailsHid !== forHid || !$('mtal-d-cmp')) return;

      const m = cmpM();
      const mineIds = new Set((sl.mine || []).map((x) => x.id));
      const selling = (live || [])
        .map((l) => ({ id: l.id, iv: l.ivTotal, q: l.quality != null ? +l.quality : null, lv: l.level, sh: !!l.shiny, p: l.price, cur: l.currency, off: !!l.offerOnly }))
        .filter((o) => !mineIds.has(o.id) && match(o))
        .sort((a, b) => (a.off ? 1 : 0) - (b.off ? 1 : 0) || a.p - b.p);
      const nmBase = stripLv(h.name).toLowerCase();
      const extOk = (ext || []).filter((o) => (!o.name || stripLv(o.name).toLowerCase() === nmBase) && match(o));
      const gone = extOk.slice().sort((a, b) => b.gone - a.gone);
      const src = ext ? 'PokeIdle Market · 7 dias' : 'buscando…';
      const q = (base.q != null ? '&minQuality=' + Math.max(0, base.q - m.q).toFixed(2) : '') + (base.iv != null ? '&minIv=' + Math.max(0, base.iv - m.iv) : '');
      const extUrl = 'https://www.pokeidlemarket.com.br/history?category=Pokemon&currency=All&search=' + encodeURIComponent(stripLv(h.name)) + q;
      const nm = stripLv(h.name).toLowerCase();

      box.innerHTML = `
        <div class="cmp-head">
          <b>📈 Mercado — parecidos</b>
          <span class="cmp-m">IV ± <input type="text" data-cmpm="iv" value="${m.iv}" inputmode="numeric"> · × ± <input type="text" data-cmpm="q" value="${m.q}" inputmode="decimal"></span>
        </div>
        <div class="cmp-ref">Base: IV ${base.iv != null ? base.iv : '-'}${base.iv != null ? ' (' + (base.iv - m.iv) + '–' + (base.iv + m.iv) + ')' : ''} · ×${base.q != null ? base.q.toFixed(2) : '-'}${
          base.q != null ? ' (' + (base.q - m.q).toFixed(2) + '–' + (base.q + m.q).toFixed(2) + ')' : ''
        }${base.sh ? ' · ✨ shiny' : ''}</div>

        <div class="cmp-sum">
          <div><span>À venda agora</span>${live ? both(minOf(selling, false), minOf(selling, true)) : `<small>${err ? '⚠ ' + esc(err) : 'buscando…'}</small>`}</div>
          <div><span>Última saída</span>${both(lastOf(gone, false), lastOf(gone, true))}</div>
        </div>
        <a class="cmp-ext" href="${esc(extUrl)}" target="_blank" rel="noopener">🔗 Ver saídas no PokeIdle Market</a>

        <div class="cmp-sec">À venda agora (${selling.length})</div>
        <div class="cmp-list">${selling.slice(0, 8).map((o) => row(o, '')).join('') || `<div class="cmp-empty">${live ? 'Nenhum parecido à venda.' : err ? '⚠ ' + esc(err) : 'Buscando anúncios…'}</div>`}</div>

        <div class="cmp-sec">Últimas saídas (${gone.length}) <small>${esc(src)}</small></div>
        <div class="cmp-list">${
          gone.slice(0, 12).map((o) => row(o, agoTxt(o.gone) + (o.relisted ? ' · 🔁' : ''))).join('') ||
          `<div class="cmp-empty">${
            !ext ? 'Buscando no PokeIdle Market…' : extErr ? '⚠ ' + esc(extErr) : (ext || []).length ? 'Nenhuma saída parecida nos últimos 7 dias.' : 'Nenhuma saída nos últimos 7 dias.'
          }</div>`
        }</div>
        <div class="cmp-note">Clique numa linha para usar o preço.</div>`;
    };

    draw();
    loadExt();

    speciesScan(sid)
      .then((L) => {
        live = L;
        draw();
      })
      .catch((e) => {
        err = String((e && e.message) || e);
        live = [];
        draw();
      });

    box.onclick = (e) => {
      const rw = e.target.closest('[data-cmpp]');

      if (rw && rw.dataset.cmpp && $('mtal-d-sprice')) {
        const sc = $('mtal-d-scur');

        if (sc && rw.dataset.cmpc && sc.value !== rw.dataset.cmpc) {
          sc.value = rw.dataset.cmpc;
          sc.dispatchEvent(new Event('change', { bubbles: true }));
        }

        $('mtal-d-sprice').value = fmt(+rw.dataset.cmpp);
        $('mtal-d-sprice').focus();
      }
    };

    box.oninput = (e) => {
      const k = e.target.dataset && e.target.dataset.cmpm;

      if (!k) return;

      const v = parseFloat(String(e.target.value).replace(',', '.'));

      if (!Number.isFinite(v) || v < 0) return;

      const m = cmpM();

      m[k] = v;
      store.set('cmpMargin', m);
      clearTimeout(box._t);
      box._t = setTimeout(() => {
        loadExt();
        draw();

        const el = box.querySelector('[data-cmpm="' + k + '"]');

        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 400);
    };
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

    if (a.kind === 'pokemon') rememberListings(list);

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
    #mtal-panel-head{flex:none;max-height:calc(72vh - 30px);overflow-y:auto;scrollbar-width:thin;position:sticky;top:0;z-index:2;background:#12141f;padding:10px 10px 0 10px;box-shadow:0 6px 10px -6px rgba(0,0,0,.65)}
    #mtal-panel-head::-webkit-scrollbar{width:3px}
    #mtal-cpop{position:fixed;z-index:2147483647;display:none;flex-direction:column;align-items:stretch;gap:6px;width:190px;box-sizing:border-box;padding:12px 12px 12px;background:#12141f;color:#e8e3d0;border:1px solid #3a4060;border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.6);font:12px/1.35 Inter,sans-serif}
    #mtal-cpop b{padding-right:18px;font-size:13px;color:#f2ead0}
    #mtal-cpop small{font-size:11px;color:#9aa0b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #mtal-cpop button{font:inherit;cursor:pointer}
    #mtal-cpop .cp-ok{margin-top:4px;height:30px;background:#e8eaf2;border:1px solid #e8eaf2;border-radius:6px;color:#12141f;font-weight:700}
    #mtal-cpop .cp-ok:hover{background:#fff}
    #mtal-cpop .cp-ok:disabled{cursor:default;opacity:.8}
    #mtal-cpop .cp-ok.done,#mtal-cpop .cp-ok.done:hover{opacity:1;background:#2ecc71;border-color:#2ecc71;color:#fff}
    #mtal-cpop .cp-x{position:absolute;top:8px;right:8px;width:20px;height:20px;padding:0;display:grid;place-items:center;background:transparent;border:none;border-radius:50%;color:#7c829c;font-size:10px}
    #mtal-cpop .cp-x:hover{background:#262b3f;color:#fff}
    #mtal-cpop .cp-arrow{position:absolute;width:10px;height:10px;margin-top:-5px;background:#12141f;border:1px solid #3a4060;transform:rotate(45deg)}
    #mtal-cpop.r .cp-arrow{left:-6px;border-top:none;border-right:none}
    #mtal-cpop.l .cp-arrow{right:-6px;border-bottom:none;border-left:none}
    .mtal-confirming{outline:1px solid #e8eaf2;outline-offset:-1px}
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
    #mtal-panel .mtal-tabn{margin-left:2px;font-size:10.5px;font-weight:600;color:#9aa0b8}
    #mtal-panel .mtal-autorow{display:flex;align-items:center;gap:12px}
    #mtal-panel .mtal-autorow .mtal-maxbuy{display:flex;flex-direction:row!important;align-items:center;gap:8px;margin-left:auto}
    #mtal-panel .mtal-autorow .mtal-maxbuy span{white-space:nowrap}
    #mtal-panel #mtal-form .mtal-autorow input#f-maxbuy{width:90px}
    #mtal-panel .mtal-autorow.off .mtal-maxbuy{opacity:.4;pointer-events:none}
    #mtal-panel .mtal-autoc{margin-left:4px;padding:1px 6px;border-radius:999px;background:#1f2436;border:1px solid #3a4060;color:#c7cbe0;font-size:9.5px;font-weight:700;vertical-align:1px}
    #mtal-panel .mtal-autoc.full{background:#1d3325;border-color:#2e7d4f;color:#61f6a4}
    #mtal-panel .mtal-autob{margin-left:6px;padding:1px 6px;border-radius:999px;background:#2a2410;border:1px solid #6b5a1f;color:#f0c14b;font-size:9.5px;font-weight:700;vertical-align:1px}
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
      border:1px solid #232840;
      background:#1a1e30;
      margin-bottom:6px;
      border-radius:8px;
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
    #mtal-panel .lsp-atk.F{color:#ff9f43}
    #mtal-panel .lsp-atk.E{color:#7aa2ff}
    #mtal-panel .mtal-hit.lsp.myth{background:linear-gradient(90deg,rgba(214,48,64,.26),rgba(214,48,64,.08) 55%,#1a1e30);border-color:rgba(235,80,95,.55);box-shadow:inset 0 0 18px rgba(214,48,64,.12)}
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
    #mtal-form .mtal-fspecies{position:relative;display:flex;flex-direction:column;gap:5px}
    #mtal-form .mtal-fspecies > span{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-form .mtal-chipbox{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-height:32px;box-sizing:border-box;padding:4px 6px;background:#0d0f18;border:1px solid #2c3148;border-radius:6px;cursor:text}
    #mtal-form .mtal-chipbox:focus-within{border-color:#e8eaf2}
    #mtal-form #f-chips{display:contents}
    #mtal-form .mtal-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 4px 0 9px;background:#262b3f;border:1px solid #3a4060;border-radius:999px;font-size:11.5px;color:#f2ead0;white-space:nowrap}
    #mtal-panel #mtal-form .mtal-chip button{width:16px;height:16px;padding:0;display:grid;place-items:center;background:transparent;border:none;border-radius:50%;color:#9aa0b8;font-size:9px;line-height:1}
    #mtal-panel #mtal-form .mtal-chip button:hover{background:#ff6b6b;color:#fff}
    #mtal-form .mtal-chipbox input[type=text]{flex:1;min-width:120px;width:auto;height:22px;padding:0 4px;background:transparent;border:none}
    #mtal-form .mtal-ac{position:absolute;left:0;right:0;top:100%;z-index:5;margin-top:4px;max-height:220px;overflow:auto;background:#1a1e30;border:1px solid #3a4060;border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,.5)}
    #mtal-form .mtal-ac-opt{display:flex;justify-content:space-between;padding:7px 10px;font-size:12px;color:#e8e3d0;cursor:pointer}
    #mtal-form .mtal-ac-opt small{color:#7c829c}
    #mtal-form .mtal-ac-opt.on,#mtal-form .mtal-ac-opt:hover{background:#e8eaf2;color:#12141f}
    #mtal-form .mtal-ac-opt.on small,#mtal-form .mtal-ac-opt:hover small{color:#4a4f66}
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
    #mtal-mk .hs-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
    #mtal-mk .hs-stat{display:flex;flex-direction:column;gap:2px;padding:10px 14px;background:#1a1e30;border:1px solid #232840;border-radius:10px}
    #mtal-mk .hs-stat span{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7c829c}
    #mtal-mk .hs-stat b{font-size:18px;color:#f2ead0}
    #mtal-mk .hs-stat small{font-size:11px;color:#9aa0b8}
    #mtal-mk .pos{color:#61f6a4!important}
    #mtal-mk .neg{color:#ff8a8a!important}
    #mtal-mk .hs-ctl{position:sticky;top:0;z-index:1;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 0 10px;background:#12141f}
    #mtal-mk .hs-ctl .mk-seg button{padding:5px 12px}
    #mtal-mk #hs-q{flex:1;min-width:160px;height:30px;padding:0 10px;background:#0d0f18;border:1px solid #2c3148;border-radius:6px;color:#e8e3d0;font-size:12px}
    #mtal-mk #hs-q:focus{outline:none;border-color:#e8eaf2}
    #mtal-mk .hs-day{display:flex;align-items:baseline;gap:8px;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #232840}
    #mtal-mk .hs-day span{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#c7cbe0}
    #mtal-mk .hs-day small{font-size:10.5px;color:#7c829c}
    #mtal-mk #hs-list{display:flex;flex-direction:column;gap:6px}
    #mtal-mk .hs-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto 130px;align-items:center;gap:12px;padding:6px 12px 6px 8px;background:#1a1e30;border:1px solid #232840;border-radius:8px;cursor:pointer}
    #mtal-mk .hs-row:hover{border-color:#4a4f66}
    #mtal-mk .hs-row.on{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .hs-th{width:40px;height:40px;display:grid;place-items:center}
    #mtal-mk .hs-th img{max-width:40px;max-height:40px}
    #mtal-mk .hs-name{font-size:12.5px;font-weight:600;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-mk .hs-sub{font-size:11px;color:#9aa0b8}
    #mtal-mk .hs-tag{padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;white-space:nowrap}
    #mtal-mk .hs-tag.buy{background:#1d2a45;color:#7aa2ff}
    #mtal-mk .hs-tag.sell{background:#1d3325;color:#61f6a4}
    #mtal-mk .hs-right{display:flex;flex-direction:column;align-items:flex-end}
    #mtal-mk .hs-right b{font-size:13px;white-space:nowrap}
    #mtal-mk .hs-right small{font-size:10.5px;color:#7c829c}
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
    #mtal-details .d-mkc .mkc-bar{padding:8px 10px;text-transform:none;letter-spacing:0;font-size:11px;font-weight:600}
    #mtal-details .d-mkc .mkc-sort{margin-left:6px;padding:3px 10px;font-size:11px}
    #mtal-details .d-mkc .mkc-barin{display:flex;align-items:center;justify-content:space-between;gap:10px}
    #mtal-details .d-mkc .mkc-views{display:flex}
    #mtal-details .d-mkc .mkc-views button{width:30px;height:26px;padding:0;font-size:13px;border-radius:0}
    #mtal-details .d-mkc .mkc-views button:first-child{border-radius:6px 0 0 6px}
    #mtal-details .d-mkc .mkc-views button:last-child{border-radius:0 6px 6px 0;border-left:none}
    #mtal-details .d-mkc .mkc-views button.on{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-details .d-mkc .mkc-gridrow td{padding:10px;border-bottom:none;background:transparent!important}
    #mtal-details .d-mkc .mkc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
    #mtal-details .d-mkc .mkc-grid .mkc{height:100%;box-sizing:border-box;grid-template-columns:64px minmax(0,1fr);grid-template-areas:"sp id" "grade grade" "stats stats" "side side";align-content:start;gap:12px}
    #mtal-details .d-mkc .mkc-grid .mkc-name{white-space:normal}
    #mtal-details .d-mkc .mkc-grid .mkc-grade{padding-top:12px;border-top:1px solid #232840}
    #mtal-details .d-mkc .mkc-grid .mkc-stats{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:none;grid-auto-flow:row;gap:8px 14px;padding-top:10px;border-top:1px solid #232840}
    #mtal-details .d-mkc .mkc-grid .mkc-side{flex-direction:row;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #232840}
    #mtal-details .d-mkc .mkc-cell:hover .mkc{border-color:#4a4f66}
    #mtal-details .d-mkc .mkc-list{display:flex;flex-direction:column;gap:10px}
    #mtal-details .d-mkc .mkc-cell.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-details .d-mkc .mkc-sort.on{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-details .d-mkc .mkc-row td{padding:5px 10px;border-bottom:none;background:transparent!important}
    #mtal-details .d-mkc .mkc-row:first-child td{padding-top:10px}
    #mtal-details .d-mkc .mkc-row:last-child td{padding-bottom:10px}
    #mtal-details .d-mkc .mkc{display:grid;grid-template-columns:64px 200px 150px minmax(240px,420px) minmax(0,1fr) 120px;grid-template-areas:"sp id grade stats . side";align-items:center;gap:18px;padding:10px 12px;background:#1a1e30;border:1px solid #232840;border-radius:10px;white-space:normal;cursor:pointer}
    #mtal-details .d-mkc .mkc-row:hover .mkc{border-color:#4a4f66}
    #mtal-details .d-mkc .mkc-row.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-details .d-mkc .mkc-sp{grid-area:sp;align-self:center;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:20px}
    #mtal-details .d-mkc .mkc-sp img{max-width:100%;max-height:100%;image-rendering:pixelated}
    #mtal-details .d-mkc .mkc-id{grid-area:id;min-width:0}
    #mtal-details .d-mkc .mkc-name{font-size:14px;font-weight:700;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-details .d-mkc .mkc-name small{font-size:11px;font-weight:600;color:#7c829c}
    #mtal-details .d-mkc .mkc-types{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
    #mtal-details .d-mkc .mkc-q{margin-top:5px;font-size:11.5px;font-weight:600}
    #mtal-details .d-mkc .rp-type{display:inline-flex;align-items:center;justify-content:center;height:17px;padding:0 7px;box-sizing:border-box;border-radius:999px;font-size:9px;font-weight:800;line-height:1;letter-spacing:.04em;text-transform:uppercase;text-box:trim-both cap alphabetic}
    #mtal-details .d-mkc .mkc-grade{grid-area:grade;display:flex;align-items:center;gap:10px}
    #mtal-details .d-mkc .rp-ring{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:conic-gradient(var(--c) var(--d),#2c3148 0)}
    #mtal-details .d-mkc .rp-ring b{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#1a1e30;font-size:11px;color:var(--c)}
    #mtal-details .d-mkc .mkc-cls{font-size:12px;font-weight:700}
    #mtal-details .d-mkc .mkc-kv{font-size:10.5px;color:#7c829c;white-space:nowrap}
    #mtal-details .d-mkc .mkc-kv b{font-size:11.5px}
    #mtal-details .d-mkc .rp-ivt{color:#55e6d3}
    #mtal-details .d-mkc .rp-pow{color:#f0c14b}
    #mtal-details .d-mkc .mkc-stats{grid-area:stats;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,auto);grid-auto-flow:column;gap:8px 16px}
    #mtal-details .d-mkc .mkc-stats.est{opacity:.55}
    #mtal-details .d-mkc .mkc-stat>div{display:flex;align-items:baseline;justify-content:space-between;font-size:10px;color:#7c829c}
    #mtal-details .d-mkc .mkc-stat b{font-size:10px;letter-spacing:.04em;color:var(--c)}
    #mtal-details .d-mkc .mkc-stat em{font-style:normal;font-size:11.5px;font-weight:700;color:#55e6d3}
    #mtal-details .d-mkc .mkc-stat i{display:block;height:4px;margin-top:3px;background:#2c3148;border-radius:2px;overflow:hidden}
    #mtal-details .d-mkc .mkc-stat u{display:block;height:100%;background:var(--c);border-radius:2px}
    #mtal-details .d-mkc .mkc-side{grid-area:side;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
    #mtal-details .d-mkc .mkc-side .mk-acts{display:flex;gap:4px;width:auto}
    #mtal-details .d-mkc .mkc-side .mk-acts button{width:auto;margin-left:0;padding:0 16px;font-size:12px;font-weight:600}
    #mtal-details .d-mkc .mkc-side .mk-price{font-size:13px;text-align:right;white-space:nowrap}
    #mtal-details .d-mkc{margin-bottom:4px}
    #mtal-details .d-mkc .mkc-grid{grid-template-columns:1fr}
    #mtal-details .d-mkc .mkc{cursor:default}
    #mtal-details .d-mkc .mkc-side{display:none}
    #mtal-details .d-mkc .mkc-grid .mkc-stats{border-bottom:none}
    .cmp{margin-top:14px;padding-top:12px;border-top:1px solid #232840}
    .cmp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .cmp-head b{font-size:12.5px;color:#f2ead0}
    .cmp-m{font-size:11px;color:#9aa0b8}
    .cmp-m input{width:38px;height:22px;padding:0 5px;background:#0d0f18;border:1px solid #2c3148;border-radius:5px;color:#e8e3d0;font-size:11px;text-align:center}
    .cmp-m input:focus{outline:none;border-color:#e8eaf2}
    .cmp-ref{margin-top:4px;font-size:10.5px;color:#7c829c}
    .cmp-sum{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
    .cmp-sum > div{display:flex;flex-direction:column;padding:8px 10px;background:#1a1e30;border:1px solid #232840;border-radius:8px}
    .cmp-sum span{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    .cmp-sum b{font-size:15px;color:#f0d78c}
    .cmp-cur{display:flex;flex-direction:column;gap:1px;margin-top:2px}
    .cmp-cur b{font-size:14px}
    .cmp-cur b.dia{color:#55d6f0}
    .cmp-cur i{font-style:normal;color:#4a4f66}
    .cmp-ext{display:block;margin-top:8px;padding:6px 8px;border:1px solid #2c3148;border-radius:6px;text-align:center;font-size:11px;color:#c7cbe0;text-decoration:none}
    .cmp-ext:hover{border-color:#e8eaf2;color:#fff}
    .cmp-sum small{font-size:10px;color:#7c829c}
    .cmp-sec{margin:12px 0 5px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9aa0b8}
    .cmp-sec small{margin-left:4px;font-weight:500;letter-spacing:0;text-transform:none;color:#7c829c}
    .cmp-list{display:flex;flex-direction:column;gap:4px}
    .cmp-row{display:grid;grid-template-columns:62px 48px 44px minmax(0,1fr);align-items:center;gap:6px;padding:5px 8px;background:#161927;border:1px solid #232840;border-radius:6px;font-size:11px;color:#c7cbe0;cursor:pointer}
    .cmp-row:hover{border-color:#e8eaf2}
    .cmp-row[data-cmpp=""]{cursor:default}
    .cmp-iv b{color:#55e6d3}
    .cmp-rt{display:flex;flex-direction:column;align-items:flex-end;justify-self:end;line-height:1.25}
    .cmp-when{color:#7c829c;font-size:10px;text-align:right;white-space:nowrap}
    .cmp-p{color:#f0d78c;white-space:nowrap}
    .cmp-empty{padding:8px;font-size:11px;color:#7c829c;text-align:center;line-height:1.4}
    .cmp-note{margin-top:8px;font-size:10px;color:#7c829c}
    .mtal-d-sellrow{display:flex;gap:6px;margin:4px 0 8px}
    .mtal-d-sellrow input,.mtal-d-sellrow select{background:#0d0f18;color:#e8e3d0;border:1px solid #4a4f66;border-radius:6px;padding:7px 9px;font-size:13px}
    .mtal-d-sellrow input{flex:1;min-width:0}
    #mtal-details #mtal-d-sgo{width:100%;padding:10px;background:#2c4a2c;border-color:#3f6b3f}
    #mtal-details #mtal-d-sgo:hover{border-color:#b5934f}
    .mtal-d-npc{margin-top:8px;color:#7c829c;font-size:11px;text-align:center}
    .mtal-d-qty{margin-top:12px}
    .mtal-d-steps{display:flex;gap:6px;margin-top:6px}
    .mtal-d-steps button{flex:1;height:26px;padding:0;font-size:11.5px;font-weight:600}
    .mtal-d-steps button[data-step="0"]{flex:none;width:32px}
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
    #mtal-mk .npc-subtabs{margin:0 0 10px}
    #mtal-mk .npc-toprow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    #mtal-mk .npc-toprow .npc-tabs{margin:0}
    #mtal-mk .npc-pf{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-bottom:10px;padding:8px 10px;background:#171a28;border:1px solid #2c3148;border-radius:8px;font-size:11.5px;color:#9aa0b8}
    #mtal-mk .npc-pf input[type=text]{width:46px;height:26px;padding:0 6px;background:#0d0f18;border:1px solid #2c3148;border-radius:6px;color:#e8e3d0;font-size:11.5px}
    #mtal-mk .npc-pf select{height:26px;background:#0d0f18;border:1px solid #2c3148;border-radius:6px;color:#e8e3d0;font-size:11.5px}
    #mtal-mk .npc-pf input:focus,#mtal-mk .npc-pf select:focus{outline:none;border-color:#e8eaf2}
    #mtal-mk .npc-pf .mk-chips{padding:0}
    #mtal-mk .npc-views{display:inline-flex;margin-right:4px}
    #mtal-mk .npc-views button{width:30px;height:26px;padding:0;border-radius:0;border-left:none}
    #mtal-mk .npc-views button:first-child{border-radius:6px 0 0 6px;border-left:1px solid #3a4060}
    #mtal-mk .npc-views button:last-child{border-radius:0 6px 6px 0}
    #mtal-mk .npc-views button.on{background:#e8eaf2;border-color:#e8eaf2;color:#12141f}
    #mtal-mk .npc-stack{display:flex;flex-direction:column;gap:16px}
    #mtal-mk .npc-stack .npc-list{container-type:inline-size;display:block;max-height:none}
    #mtal-mk .npc-pkc .mkc{cursor:default}
    #mtal-mk .npc-pkc .mkc-side .mk-price{min-height:14px}
    @container (max-width: 880px){
      #mtal-mk .npc-pkc .mkc{grid-template-columns:64px minmax(0,1fr) 150px 110px;grid-template-areas:"sp id grade side" "sp stats stats stats";gap:8px 16px}
      #mtal-mk .npc-pkc .mkc-stats{padding-top:8px;border-top:1px solid #232840}
    }
    @container (max-width: 560px){
      #mtal-mk .npc-pkc .mkc{grid-template-columns:64px minmax(0,1fr) 110px;grid-template-areas:"sp id side" "grade grade grade" "stats stats stats"}
    }
    #mtal-mk .npc-stack .mkc-grid .npc-pkc .mkc{height:100%;box-sizing:border-box;grid-template-columns:64px minmax(0,1fr);grid-template-areas:"sp id" "grade grade" "stats stats" "side side";align-content:start;gap:12px}
    #mtal-mk .npc-stack .mkc-grid .mkc-stats{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:none;grid-auto-flow:row;gap:8px 14px;padding-top:10px;border-top:1px solid #232840}
    #mtal-mk .npc-stack .mkc-grid .mkc-side{flex-direction:row;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px solid #232840}
    #mtal-mk .npc-pksel{cursor:pointer}
    #mtal-mk .npc-pksel .mkc{cursor:pointer}
    #mtal-mk .npc-pksel:hover .mkc{border-color:#4a4f66}
    #mtal-mk .npc-pksel.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .npc-pkchk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#c7cbe0;cursor:pointer}
    #mtal-mk .held-offers{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:8px}
    #mtal-mk .held-offer{display:flex;flex-direction:column;align-items:center;gap:10px;padding:14px;background:#1a1e30;border:1px solid #2c3148;border-radius:10px}
    #mtal-mk .held-tier{padding:2px 12px;border:1px solid #4a4f66;border-radius:999px;font-size:11px;font-weight:700;color:#e8e3d0}
    #mtal-mk .held-cost{display:flex;align-items:center;gap:6px;font-size:16px;color:#f2ead0}
    #mtal-mk .held-cost img{width:20px;height:20px}
    #mtal-mk .held-offer button{width:100%;height:34px}
    #mtal-mk .tr-ok{color:#61f6a4}
    #mtal-mk .tr-no{color:#ff6b6b}
    #mtal-mk .npc-pval{margin-left:auto;color:#f0d78c;font-size:12px;white-space:nowrap}
    #mtal-mk .npc-prow .npc-ri img{image-rendering:pixelated}
    #mtal-mk .npc-tag{margin-left:4px;padding:0 5px;border-radius:999px;background:#262b3f;color:#9aa0b8;font-size:9.5px;font-weight:600}
    #mtal-mk .npc-cap{margin-top:8px;padding:14px 16px;background:#171a28;border:1px dashed #3a4060;border-radius:10px;color:#c7cbe0;font-size:12px}
    #mtal-mk .npc-cap b{color:#f2ead0}
    #mtal-mk .npc-cap p{margin:6px 0}
    #mtal-mk .npc-cap ol{margin:6px 0 12px;padding-left:18px;line-height:1.7}
    #mtal-mk .npc-cap-btns{display:flex;gap:8px;flex-wrap:wrap}
    #mtal-mk .npc-cap-btns button{height:30px;padding:0 12px}
    #mtal-mk .npc-cap-btns button.rec{background:#4a1d24;border-color:#ff6b6b;color:#ffb3b3}
    #mtal-mk .npc-block{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;padding:8px 10px;background:#171a28;border:1px solid #2c3148;border-radius:8px}
    #mtal-mk .npc-block-h{margin-right:4px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-mk .npc-bchip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 4px 0 9px;background:#2a1d22;border:1px solid #5a2f38;border-radius:999px;font-size:11.5px;color:#f2ead0;white-space:nowrap}
    #mtal-mk .npc-bchip button{width:16px;height:16px;padding:0;display:grid;place-items:center;background:transparent;border:none;border-radius:50%;color:#9aa0b8;font-size:9px;line-height:1}
    #mtal-mk .npc-bchip button:hover{background:#ff6b6b;border:none;color:#fff}
    #mtal-mk #npc-block-in{flex:1;min-width:150px;height:24px;padding:0 8px;background:#0d0f18;border:1px solid #2c3148;border-radius:6px;color:#e8e3d0;font-size:11.5px}
    #mtal-mk #npc-block-in:focus{outline:none;border-color:#e8eaf2}
    #mtal-mk .npc-blk{flex:none;width:26px;height:26px;padding:0;margin-left:auto;background:transparent;border-color:transparent;opacity:.35;font-size:12px}
    #mtal-mk .npc-row:hover .npc-blk{opacity:.8}
    #mtal-mk .npc-blk:hover{opacity:1;border-color:#5a2f38}
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
              <div class="full mtal-fspecies">
                <span>Espécies</span>
                <div class="mtal-chipbox" id="f-chipbox">
                  <div id="f-chips"></div>
                  <input type="text" id="f-species" autocomplete="off" placeholder="Qualquer espécie — digite para buscar">
                </div>
                <div class="mtal-ac" id="f-ac" hidden></div>
              </div>

              <datalist id="mtal-species"></datalist>

              <label>
                <span>IV total mín</span>
                <input type="number" id="f-iv" min="0" max="192" placeholder="sem mínimo">
              </label>

              <label>
                <span>Qualidade mín</span>
                <input type="text" id="f-q" inputmode="numeric" autocomplete="off" placeholder="ex.: 1.77">
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
              <input type="text" id="f-price" inputmode="decimal" autocomplete="off" placeholder="sem limite">
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

            <div class="full mtal-autorow" id="f-auto-row">
              <label class="mtal-sw" title="Compra sozinho o anúncio que bater com este filtro (exige preço máximo e moeda)">
                <input type="checkbox" id="f-auto">
                <i></i>
                Comprar automático ⚡
              </label>

              <label class="mtal-maxbuy" title="Para de comprar sozinho ao chegar nesta quantidade (vazio = sem limite)">
                <span>Qtd. máxima</span>
                <input type="text" id="f-maxbuy" inputmode="numeric" autocomplete="off" placeholder="sem limite">
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
            Comprados <span id="mtal-pcount" class="mtal-tabn"></span>
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
        <div class="hs-stats" id="hs-stats"></div>

        <div class="hs-ctl">
          <div class="mk-seg" id="hs-seg">
            <button type="button" data-hs="all" class="on">Tudo</button>
            <button type="button" data-hs="buy">Compras</button>
            <button type="button" data-hs="sell">Vendas</button>
          </div>

          <div class="mk-seg" id="hs-kind">
            <button type="button" data-hk="" class="on">Todos</button>
            <button type="button" data-hk="poke">Pokémon</button>
            <button type="button" data-hk="item">Itens</button>
          </div>

          <input type="text" id="hs-q" placeholder="Buscar no histórico…" autocomplete="off">
        </div>

        <div id="hs-list"></div>
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

  const RP_SPECIAL_TYPES = new Set(['fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark']);

  function rpAtkKind(v) {
    const ms = rpMoves(v.c).filter((m) => +m.power > 0);

    if (!ms.length) return null;

    const un = ms.filter((m) => m.lvl == null || !Number.isFinite(+v.level) || +m.lvl <= +v.level);
    const best = (un.length ? un : ms).reduce((a, b) => (+b.power > +a.power ? b : a));
    const c = String(best.cat || '').toLowerCase();
    let kind = /phys|f[ií]s/.test(c) ? 'F' : /spec|esp/.test(c) ? 'E' : null;
    const inferred = !kind;

    if (!kind) kind = RP_SPECIAL_TYPES.has(String(best.type || '').toLowerCase()) ? 'E' : 'F';

    return { kind, move: best, inferred };
  }

  function lsPokeCard(h, time, purchased) {
    const v = rpInit(h);
    const R = rpCompute(v);
    const r = h.raw || {};
    let types = typesOf(r);

    if (!types.length && v.c) types = [v.c.type1, v.c.type2].filter(Boolean);

    const rar = rarityOf(h);
    const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#e0b95a';
    const cls = R.cls || [0, '-', '#6b7089', ''];
    const est = R.est && v.level < 15;
    const atk = rpAtkKind(v);
    const myth = /^(m[ií]tic|mythic)/i.test(String(rar || ''));

    return `<div class="mtal-hit lsp${myth ? ' myth' : ''}" data-hid="${h.hid}">
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
          <div class="lsp-kv"${atk ? ` title="Golpe mais forte: ${esc(atk.move.name)} (${esc(atk.move.power)})${atk.inferred ? ' · categoria estimada pelo tipo' : ''}"` : ''}>Ataque <b class="lsp-atk ${atk ? atk.kind : ''}">${atk ? (atk.kind === 'E' ? 'Especial' : 'Físico') : '-'}</b></div>
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
        ${purchased
          ? `<button type="button" class="mtal-view mtal-view-p${h.hid === detailsHid ? ' active' : ''}" data-hid="${h.hid}" title="Detalhes">${EYE_SVG}</button>
        <button type="button" class="mtal-mkt" data-hid="${h.hid}" title="Abrir no Market">⚖️</button>`
          : `<button type="button" class="mtal-view${h.hid === detailsHid ? ' active' : ''}" data-hid="${h.hid}" title="Detalhes">${EYE_SVG}</button>
        ${h.buyable ? `<button type="button" class="mtal-buy" data-hid="${h.hid}" title="Comprar">🛒</button>` : ''}`}
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
  function renderPurchasedCount() {
    const el = $('mtal-pcount');

    if (el) el.textContent = state.purchased.length ? '(' + state.purchased.length + ')' : '';
  }

  function renderPurchased() {
    renderPurchasedCount();

    const t = (ms) =>
      new Date(ms).toLocaleTimeString(
        'pt-BR'
      );

    if (!rpCre && state.purchased.some((h) => h.kind === 'pokemon')) {
      rpLoadCreatures().then((ok) => {
        if (ok) renderPurchased();
      });
    }

    $('mtal-purchased').innerHTML =
      state.purchased.length
        ? state.purchased
            .map(
              (h) => h.kind === 'pokemon' ? lsPokeCard(h, t(h.purchasedAt || h.t), true) : `
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
                  ${esc(a.name)}${a.autoBuy ? ` <span class="mtal-autob" title="Compra automática">⚡ auto</span> <span class="mtal-autoc${a.maxBuy && (a.boughtCount || 0) >= a.maxBuy ? ' full' : ''}" title="Comprados automaticamente${a.maxBuy ? ' / máximo' : ''}">🛒 ${fmt(a.boughtCount || 0)}${a.maxBuy ? '/' + fmt(a.maxBuy) : ''}</span>` : ''}
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

  function priceFmt(v) {
    v = String(v || '').replace(/[^\d,]/g, '');

    const i = v.indexOf(',');
    let int = (i >= 0 ? v.slice(0, i) : v).replace(/^0+(?=\d)/, '');
    const dec = i >= 0 ? v.slice(i + 1).replace(/,/g, '').slice(0, 2) : null;

    int = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    return dec != null ? (int || '0') + ',' + dec : int;
  }

  function priceParse(v) {
    const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.'));

    return Number.isFinite(n) ? n : null;
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
      const nm = Array.isArray(a.species) && a.species.length > 2
        ? a.species.slice(0, 2).map((x) => x.name).join(', ') + ' +' + (a.species.length - 2)
        : a.speciesName;

      bits.push(
        nm ||
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

  let formSpecies = [];
  let acIdx = 0;

  function renderChips() {
    $('f-chips').innerHTML = formSpecies
      .map((x, i) => `<span class="mtal-chip">${esc(x.name)}<button type="button" data-rm="${i}" title="Remover">✕</button></span>`)
      .join('');
    $('f-species').placeholder = formSpecies.length ? 'Adicionar outra…' : 'Qualquer espécie — digite para buscar';
  }

  function addSpecies(sp) {
    if (!sp || formSpecies.some((x) => +x.speciesId === +sp.speciesId)) return;

    formSpecies.push({ speciesId: +sp.speciesId, name: sp.name });
    renderChips();
  }

  function acMatches(txt) {
    txt = String(txt || '').trim().toLowerCase();

    if (!txt) return [];

    const list = (species || []).filter((x) => !formSpecies.some((y) => +y.speciesId === +x.speciesId));
    const starts = list.filter((x) => x.name.toLowerCase().startsWith(txt));
    const inc = list.filter((x) => !x.name.toLowerCase().startsWith(txt) && x.name.toLowerCase().includes(txt));
    const out = starts.concat(inc).slice(0, 8);

    if (!out.length && /^\d+$/.test(txt)) out.push({ speciesId: +txt, name: '#' + txt });

    return out;
  }

  function acHide() {
    $('f-ac').hidden = true;
    $('f-ac').innerHTML = '';
  }

  function acRender() {
    const m = acMatches($('f-species').value);

    if (!m.length) return acHide();

    acIdx = Math.min(acIdx, m.length - 1);
    $('f-ac').innerHTML = m
      .map((x, i) => `<div class="mtal-ac-opt${i === acIdx ? ' on' : ''}" data-i="${i}">${esc(x.name)}<small>#${esc(x.speciesId)}</small></div>`)
      .join('');
    $('f-ac').hidden = false;
  }

  function acPick(i) {
    const m = acMatches($('f-species').value);

    if (!m[i]) return;

    addSpecies(m[i]);
    $('f-species').value = '';
    acHide();
    $('f-species').focus();
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

    formSpecies = !isPoke
      ? []
      : Array.isArray(a.species) && a.species.length
        ? a.species.map((x) => ({ speciesId: +x.speciesId, name: x.name }))
        : a.speciesId
          ? [{ speciesId: +a.speciesId, name: a.speciesName || '#' + a.speciesId }]
          : [];

    $('f-species').value = '';
    renderChips();
    acHide();

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

    $('f-auto').checked = !!(a && a.autoBuy);
    $('f-maxbuy').value = a && a.maxBuy ? priceFmt(String(a.maxBuy)) : '';
    $('f-auto-row').classList.toggle('off', !$('f-auto').checked);

    $('f-price').value =
      a &&
      a.maxPrice != null
        ? priceFmt(String(a.maxPrice).replace('.', ','))
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

  $('f-auto').addEventListener('change', () => $('f-auto-row').classList.toggle('off', !$('f-auto').checked));

  $('f-maxbuy').addEventListener('input', (e) => {
    e.target.value = priceFmt(e.target.value.replace(/,/g, ''));
  });

  $('f-price').addEventListener('input', (e) => {
    const el = e.target;
    const before = el.value.slice(0, el.selectionStart).replace(/[^\d,]/g, '').length;

    el.value = priceFmt(el.value);

    let pos = 0;

    for (let n = 0; pos < el.value.length && n < before; pos++) {
      if (/[\d,]/.test(el.value[pos])) n++;
    }

    try {
      el.setSelectionRange(pos, pos);
    } catch (err) {}
  });

  $('f-q').addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 3);

    e.target.value = d.length > 1 ? d[0] + '.' + d.slice(1) : d;
  });

  $('f-species').addEventListener('input', () => {
    acIdx = 0;
    if (!species) loadSpecies();
    acRender();
  });

  $('f-species').addEventListener('keydown', (e) => {
    const open = !$('f-ac').hidden;
    const n = $('f-ac').children.length;

    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      acIdx = (acIdx + 1) % n;
      acRender();
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      acIdx = (acIdx - 1 + n) % n;
      acRender();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (open) {
        e.preventDefault();
        acPick(acIdx);
      }
    } else if (e.key === 'Escape') {
      acHide();
    } else if (e.key === 'Backspace' && !e.target.value && formSpecies.length) {
      formSpecies.pop();
      renderChips();
    }
  });

  $('f-species').addEventListener('blur', () => setTimeout(acHide, 150));
  $('f-ac').addEventListener('mousedown', (e) => {
    const o = e.target.closest('[data-i]');

    if (o) {
      e.preventDefault();
      acPick(+o.dataset.i);
    }
  });
  $('f-chipbox').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');

    if (b) {
      formSpecies.splice(+b.dataset.rm, 1);
      renderChips();
    }

    $('f-species').focus();
  });

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
            priceParse($('f-price').value),

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

        a.autoBuy = $('f-auto').checked;
        a.maxBuy = Math.floor(priceParse($('f-maxbuy').value) || 0) || null;
        a.boughtCount = old && old.maxBuy === a.maxBuy ? old.boughtCount || 0 : 0;

        if (a.autoBuy && (a.maxPrice == null || !a.currency)) {
          return toast('Comprar automático: defina o preço máximo e a moeda.');
        }

        if (
          kind ===
          'pokemon'
        ) {
          const txt = $('f-species').value;

          if (txt.trim()) {
            const sp = resolveSpecies(txt) || acMatches(txt)[0];

            if (!sp) {
              return toast('Espécie não encontrada: escolha uma da lista.');
            }

            addSpecies(sp);
          }

          a.species = formSpecies.slice();
          a.speciesId = formSpecies.length === 1 ? formSpecies[0].speciesId : null;
          a.speciesName = formSpecies.map((x) => x.name).join(', ');

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

    if (!f && !wsSt.pokes) return [];

    const arr = (f && hookNodes(f)
      .map((h) => (h.queue ? h.queue.lastRenderedState : h.memoizedState))
      .find(
        (v) =>
          Array.isArray(v) &&
          v[0] &&
          typeof v[0] === 'object' &&
          'id' in v[0] &&
          'speciesId' in v[0] &&
          'team' in v[0]
      )) || wsSt.pokes;

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

  function slNotListed(c) {
    const mine = sl.mine || [];

    if (sl.kind === 'pokemon') {
      if (c.listed || c.onMarket || c.inMarket || c.forSale || c.isListed) return false;

      return !mine.some((l) => l.capturedId != null && String(l.capturedId) === String(c.id));
    }

    return !mine.some((l) => l.kind !== 'pokemon' && !l.capturedId && l.refId != null && String(l.refId) === String(c.refId));
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
    let cards = slList().filter((c) => slNotListed(c) && (!q || String(c.name).toLowerCase().includes(q)));

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
              <div class="mk-price">${pokeOriginHtml(c)}</div>
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

  // de onde veio o Pokémon: comprado no mercado (com preço) ou capturado
  function pokeOrigin(p) {
    const id = String(p.id);

    const bought = state.purchased.find((h) => h.kind === 'pokemon' && h.raw && String(h.raw.capturedId) === id);

    if (bought) return { bought: true, price: bought.price, cur: bought.currency };

    for (const x of sl.history || []) {
      if (!x.bought) continue;

      const k = seenL[seenKey(x.name, x.price, x.currency)];

      if (k && k.capturedId != null && String(k.capturedId) === id) return { bought: true, price: x.price, cur: x.currency };
    }

    const base = String(p.name || '').toLowerCase();
    const same = (sl.pokes || []).filter((q) => String(q.name || '').toLowerCase() === base && q.level === p.level);
    const cand = (sl.history || []).filter(
      (x) => x.bought && stripLv(x.name || '').toLowerCase() === base && levelOf(x) === p.level && !(seenL[seenKey(x.name, x.price, x.currency)] || {}).capturedId
    );

    if (cand.length && same.length === 1) return { bought: true, price: cand[0].price, cur: cand[0].currency };

    return { bought: false };
  }

  function pokeOriginHtml(p) {
    const o = pokeOrigin(p);

    if (!o.bought) return '<span class="mk-dim">🎯 Capturado</span>';

    const dia = o.cur === 'DIAMONDS' || o.cur === 'DIAMOND';

    return `<span class="mk-dim">Comprado</span> ${dia ? '💎' : '$'} ${fmt(o.price || 0)}`;
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

  const hsSt = { mode: 'all', kind: '', q: '' };

  function hsRender() {
    const isPoke = (x) => !(sl.catalog || []).some((c) => c.name === x.name) && /Lv\.?\s*\d+/i.test(x.name || '');
    const all = sl.history || [];
    const list = all.filter((x) => {
      if (hsSt.mode === 'buy' && !x.bought) return false;
      if (hsSt.mode === 'sell' && x.bought) return false;
      if (hsSt.kind === 'poke' && !isPoke(x)) return false;
      if (hsSt.kind === 'item' && isPoke(x)) return false;
      if (hsSt.q && !String(x.name || '').toLowerCase().includes(hsSt.q)) return false;

      return true;
    });

    const tot = (arr, cur) => arr.filter((x) => (x.currency || 'GOLD') === cur).reduce((a, x) => a + (x.price || 0) * (isPoke(x) ? 1 : 1), 0);
    const buys = all.filter((x) => x.bought);
    const sells = all.filter((x) => !x.bought);
    const money = (g, dm) => [g ? '$ ' + fmt(g) : '', dm ? '💎 ' + fmt(dm) : ''].filter(Boolean).join(' · ') || '-';
    const bal = tot(sells, 'GOLD') - tot(buys, 'GOLD');
    const balD = tot(sells, 'DIAMONDS') - tot(buys, 'DIAMONDS');

    $('hs-stats').innerHTML = `
      <div class="hs-stat"><span>Compras</span><b>${buys.length}</b><small>${money(tot(buys, 'GOLD'), tot(buys, 'DIAMONDS'))}</small></div>
      <div class="hs-stat"><span>Vendas</span><b>${sells.length}</b><small>${money(tot(sells, 'GOLD'), tot(sells, 'DIAMONDS'))}</small></div>
      <div class="hs-stat"><span>Saldo</span><b class="${bal >= 0 ? 'pos' : 'neg'}">${bal >= 0 ? '+' : '−'}$ ${fmt(Math.abs(bal))}</b><small>${balD ? (balD >= 0 ? '+' : '−') + '💎 ' + fmt(Math.abs(balD)) : 'vendas − compras'}</small></div>`;

    if (!list.length) {
      $('hs-list').innerHTML = `<div class="mk-empty">${sl.loading ? 'Carregando…' : sl.err ? '⚠ ' + esc(sl.err) : all.length ? 'Nada com esses filtros.' : 'Sem histórico ainda.'}</div>`;

      return;
    }

    const dayOf = (x) => {
      if (!x.at) return 'Sem data';

      const d = new Date(x.at);
      const t = new Date();
      const y = new Date(Date.now() - 86400000);
      const same = (a, b) => a.toDateString() === b.toDateString();

      return same(d, t) ? 'Hoje' : same(d, y) ? 'Ontem' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    };

    const pseudo = [];
    let lastDay = null;
    let html = '';

    list.forEach((x) => {
      const day = dayOf(x);

      if (day !== lastDay) {
        const dayItems = list.filter((y) => dayOf(y) === day);

        html += `<div class="hs-day"><span>${esc(day)}</span><small>${dayItems.length} ${dayItems.length === 1 ? 'transação' : 'transações'}</small></div>`;
        lastDay = day;
      }

      const h = hsHit(x);

      pseudo.push(h);

      const rar = h.kind === 'pokemon' && h.quality != null ? qualityTier(h.quality) : null;
      const rc = (rar && RARITY_COLOR[String(rar).toLowerCase()]) || '#9aa0b8';
      const sub =
        h.kind === 'pokemon'
          ? [h.ivTotal != null ? 'IV ' + h.ivTotal + '/192' : '', rar ? `<span style="color:${rc}">${esc(rar)} ×${Number(h.quality).toFixed(2)}</span>` : '']
              .filter(Boolean)
              .join(' · ') || 'Pokémon'
          : esc(catLabel(h.category) || 'Item') + (x.amount > 1 ? ' · ' + fmt(x.amount) + '×' : '');

      html += `<div class="hs-row" data-hi="${all.indexOf(x)}">
        <div class="mtal-hit-thumb hs-th" data-hid="${h.hid}">${thumbHtml(h)}</div>
        <div class="hs-main">
          <div class="hs-name">${esc(x.name || '-')}${h.shiny ? ' ✨' : ''}</div>
          <div class="hs-sub">${sub}</div>
        </div>
        <span class="hs-tag ${x.bought ? 'buy' : 'sell'}">${x.bought ? 'Compra' : 'Venda'}${x.offer ? ' · oferta' : ''}</span>
        <div class="hs-right">
          <b class="${x.bought ? 'neg' : 'pos'}">${x.bought ? '−' : '+'}${esc(priceTxt2(x.price || 0, x.currency))}</b>
          <small>${x.at ? esc(new Date(x.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) : ''}</small>
        </div>
      </div>`;
    });

    $('hs-list').innerHTML = html;
    pseudo.forEach(ensureSprite);
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

  const gameWins = () =>
    [...document.querySelectorAll('.win-window, [class*="window"]')].filter(
      (el) =>
        el.getClientRects().length &&
        !el.closest('#mtal-mk,#mtal-panel,#mtal-details,#mtal-cpop') &&
        !(el.parentElement && el.parentElement.closest('.win-window, [class*="window"]'))
    );

  async function tryNpcIdx(n, i, strict) {
    const f = findGameFiber();
    const st = f && stateAt(hookNodes(f), i, 'boolean');

    if (!st) return false;

    if (st.cur) {
      st.set(false);
      await sleep(60);
    }

    const before = new Set(gameWins());

    st.set(true);
    await sleep(300);

    const fresh = gameWins().filter((el) => !before.has(el));

    if ((!strict && !fresh.length) || fresh.some((el) => n.win.test(String(el.textContent || '').slice(0, 120)))) return true;

    st.set(false);
    await sleep(60);

    return false;
  }

  async function openNpc(key) {
    const n = NPCS.find((x) => x.key === key);
    const f = n && findGameFiber();

    if (!f) return toast('Jogo ainda carregando.');

    mkClose();

    const first = npcIdx[n.key] != null ? npcIdx[n.key] : n.idx;

    if (await tryNpcIdx(n, first)) return;

    // índice errado (o jogo mudou): procura a janela certa perto do índice padrão
    const others = new Set(NPCS.filter((x) => x.key !== n.key).map((x) => npcIdx[x.key]).filter((x) => x != null));
    const hs = hookNodes(findGameFiber());
    const cands = [];

    for (let d = 1; d <= 40; d++) {
      [n.idx + d, n.idx - d].forEach((i) => {
        if (i >= 0 && i < hs.length && i !== first && !others.has(i)) {
          const st = stateAt(hs, i, 'boolean');

          if (st && !st.cur) cands.push(i);
        }
      });
    }

    for (const i of cands) {
      if (await tryNpcIdx(n, i, true)) {
        npcIdx[n.key] = i;
        store.set('npcIdx', npcIdx);
        log('NPC reaprendido:', n.title, i);

        return;
      }
    }

    toast('Não consegui abrir ' + n.title + '. Abra 1x pelo NPC no jogo para eu aprender.');
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
    const tr = e.target.closest('[data-hi]');

    if (!tr) return;

    const x = sl.history[+tr.dataset.hi];

    if (!x) return;

    document.querySelectorAll('#hs-list [data-hi]').forEach((r) => r.classList.toggle('on', r === tr));
    showDetails(hsHit(x), 'mtal-mk');
  };

  $('hs-list').addEventListener('click', hsClick);

  $('hs-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hs]');

    if (!b) return;

    hsSt.mode = b.dataset.hs;
    document.querySelectorAll('#hs-seg button').forEach((x) => x.classList.toggle('on', x === b));
    hsRender();
  });

  $('hs-kind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hk]');

    if (!b) return;

    hsSt.kind = b.dataset.hk;
    document.querySelectorAll('#hs-kind button').forEach((x) => x.classList.toggle('on', x === b));
    hsRender();
  });

  $('hs-q').addEventListener('input', (e) => {
    hsSt.q = e.target.value.trim().toLowerCase();
    hsRender();
  });

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

  const SELL_BLOCK_DEFAULT = ['Strange Pheromone', 'Bronze Boss Token', 'Rare Pokemon Picture'];

  const sellBlock = () => {
    const v = store.get('sellBlock', null);

    return Array.isArray(v) ? v : SELL_BLOCK_DEFAULT.slice();
  };

  const isBlocked = (name) => sellBlock().some((b) => b.toLowerCase() === String(name || '').trim().toLowerCase());

  function setSellBlock(list) {
    store.set('sellBlock', list);
    npcRender();
  }

  function npcBlockBar() {
    const list = sellBlock();

    return `<div class="npc-block">
      <span class="npc-block-h">🚫 Nunca vender</span>
      ${list.map((b) => `<span class="npc-bchip">${esc(b)}<button type="button" data-unblk="${esc(b)}" title="Liberar para venda">✕</button></span>`).join('')}
      <input type="text" id="npc-block-in" autocomplete="off" placeholder="+ adicionar item (Enter)">
    </div>`;
  }

  function npcRow(icon, name, sub, click, o = {}) {
    const fq = ($('npc-filter').value || '').trim().toLowerCase();

    if (fq && !String(name).toLowerCase().includes(fq)) return '';

    const i = npcSt.cards.length;

    npcSt.cards.push(click || null);

    return `<div class="npc-row${o.checked ? ' on' : ''}" data-nc="${i}">
      ${o.check != null ? `<input type="checkbox" class="npc-chk" data-sid="${esc(o.check)}"${o.set ? ` data-set="${o.set}"` : ''}${o.checked ? ' checked' : ''}>` : ''}
      <div class="npc-ri">${icon ? `<img src="${esc(icon)}" onerror="this.parentElement.textContent='❔'">` : '❔'}</div>
      <div class="npc-rn"><b>${esc(name)}</b><span class="mk-dim">${sub}</span></div>
      ${
        o.arrow
          ? `<button type="button" class="npc-arrow" data-mv="${esc(o.id)}" data-dir="${o.arrow}" title="${o.arrow === 'store' ? 'Guardar no depósito' : 'Retirar para a mochila'}">${o.arrow === 'store' ? '→' : '←'}</button>`
          : ''
      }
      ${
        o.famArrow
          ? `<button type="button" class="npc-arrow" data-fmv="${esc(o.famId)}" data-fdir="${o.famArrow}" title="${o.famArrow === 'deposit' ? 'Guardar na família' : 'Retirar da família'}">${o.famArrow === 'deposit' ? '→' : '←'}</button>`
          : ''
      }
      ${o.block ? `<button type="button" class="npc-blk" data-blk="${esc(name)}" title="Nunca vender este item">🚫</button>` : ''}
    </div>`;
  }

  async function depotMove(id, dir) {
    const r = await gamePost('/api/game/depot/move', { itemId: id, dir });

    npcSt.data.depot = r;

    const a = depotToOwned(r);

    if (a) setOwned(a);

    return r;
  }

  const npcCapBox = (what) => `<div class="npc-cap">
      <b>Esta parte ainda não foi mapeada.</b>
      <p>Preciso ver como o jogo faz essa ação. É rápido:</p>
      <ol>
        <li>Clique em <b>Gravar</b>.</li>
        <li>Clique em <b>Abrir no jogo</b> e ${what}.</li>
        <li>Volte aqui, clique em <b>Copiar gravação</b> e cole no chat.</li>
      </ol>
      <div class="npc-cap-btns">
        <button type="button" data-cap="rec" class="${netCap.on ? 'rec' : ''}">${netCap.on ? '■ Parar' : '● Gravar'}</button>
        <button type="button" data-cap="game">Abrir no jogo</button>
        <button type="button" data-cap="copy"${netCap.log.length ? '' : ' disabled'}>Copiar gravação (<span id="npc-cap-n">${netCap.log.length}</span>)</button>
      </div>
    </div>`;

  function allPokes() {
    if (wsSt.pokes) return wsSt.pokes;

    const f = findGameFiber();

    if (!f) return [];

    return (
      hookNodes(f)
        .map((h) => (h.queue ? h.queue.lastRenderedState : h.memoizedState))
        .find((v) => Array.isArray(v) && v[0] && typeof v[0] === 'object' && 'id' in v[0] && 'speciesId' in v[0] && 'team' in v[0]) || []
    );
  }

  const pokeIcon = (p) => {
    try {
      const sp = rpSprite({ kind: 'pokemon', name: p.name, shiny: !!p.shiny, raw: { speciesId: p.speciesId } }, null);

      return sp ? sp.still : '';
    } catch (e) {
      return '';
    }
  };

  const pokeSub = (p) =>
    'Nv ' + fmt(p.level || 1) + (p.ivTotal != null ? ' · IV ' + p.ivTotal : '') + (p.quality != null ? ' · ×' + Number(p.quality).toFixed(2) : '') + (p.shiny ? ' · ✨' : '');

  function pokeRow(p, dir, kind, o = {}) {
    const fq = ($('npc-filter').value || '').trim().toLowerCase();

    if (fq && !String(p.name).toLowerCase().includes(fq)) return '';

    const tag = p.leader ? ' <span class="npc-tag">líder</span>' : p.team ? ' <span class="npc-tag">time</span>' : '';

    if (kind === 'sell') {
      return `<div class="npc-row npc-prow${o.check ? ' on' : ''}" data-psel="${esc(p.id)}">
      <input type="checkbox" class="npc-chk" data-sid="${esc(p.id)}" data-set="poke"${o.check ? ' checked' : ''}>
      <div class="npc-ri">${pokeIcon(p) ? `<img src="${esc(pokeIcon(p))}" onerror="this.parentElement.textContent='❔'">` : '❔'}</div>
      <div class="npc-rn"><b>${esc(p.name)}${tag}</b><span class="mk-dim">${esc(pokeSub(p))}</span></div>
      <b class="npc-pval">$ ${fmt(p.sellValue || 0)}</b>
    </div>`;
    }

    return `<div class="npc-row npc-prow">
      <div class="npc-ri">${pokeIcon(p) ? `<img src="${esc(pokeIcon(p))}" onerror="this.parentElement.textContent='❔'">` : '❔'}</div>
      <div class="npc-rn"><b>${esc(p.name)}${tag}</b><span class="mk-dim">${esc(pokeSub(p))}</span></div>
      <button type="button" class="npc-arrow" data-pmv="${esc(p.id)}" data-pdir="${dir}" data-pk="${kind}" title="${dir === 'store' || dir === 'deposit' ? 'Guardar' : 'Retirar'}">${dir === 'store' || dir === 'deposit' ? '→' : '←'}</button>
    </div>`;
  }

  function pokeHit(p) {
    const types = [p.type1, p.type2].filter(Boolean);

    return {
      hid: ++hitSeq,
      t: Date.now(),
      alert: 'Depot',
      inventory: true,
      kind: 'pokemon',
      name: p.name + ' Lv.' + (p.level || 1),
      price: p.sellValue || 0,
      currency: 'GOLD',
      offerOnly: false,
      shiny: !!p.shiny,
      ivTotal: p.ivTotal,
      quality: p.quality != null ? Number(p.quality) : null,
      raw: { ...p, stats: p.stats || p.growth, type1: types[0], type2: types[1] },
      buyable: false
    };
  }

  function pokeCards(list, dir, kind, sel) {
    const v = npcPview();

    if (v === 'rows') return list.map((p) => pokeRow(p, dir, kind)).join('');

    const fq = ($('npc-filter').value || '').trim().toLowerCase();
    const out = fq ? list.filter((p) => String(p.name).toLowerCase().includes(fq)) : list;

    if (!out.length) return '';

    if (!rpCre && !npcSt.creAsked) {
      npcSt.creAsked = true;
      rpLoadCreatures().then((ok) => ok && npcRender());
    }

    const label = { store: 'Guardar →', withdraw: '← Retirar', deposit: 'Guardar →' }[dir] || dir;

    return `<div class="${v === 'grid' ? 'mkc-grid' : 'mkc-list'}">${out
      .map((p) => {
        const h = pokeHit(p);

        if (!rpSprite(h, rpCreature(h))) npcSt.pseudo.push(h);

        const tag = p.leader ? '<span class="npc-tag">líder</span>' : p.team ? '<span class="npc-tag">time</span>' : '';

        if (kind === 'sell') {
          const on = sel && sel.has(p.id);

          return `<div class="npc-pkc npc-pksel${on ? ' on' : ''}" data-psel="${esc(p.id)}">${mkPokeCard(
            h,
            `<div class="mkc-side">
              <div class="mk-price">$ ${fmt(p.sellValue || 0)}</div>
              <div class="mk-acts"><label class="npc-pkchk"><input type="checkbox" class="npc-chk" data-sid="${esc(p.id)}" data-set="poke"${on ? ' checked' : ''}> Vender</label></div>
            </div>`
          )}</div>`;
        }

        return `<div class="npc-pkc">${mkPokeCard(
          h,
          `<div class="mkc-side">
            <div class="mk-price">${tag}</div>
            <div class="mk-acts"><button type="button" data-pmv="${esc(p.id)}" data-pdir="${dir}" data-pk="${kind}">${label}</button></div>
          </div>`
        )}</div>`;
      })
      .join('')}</div>`;
  }

  function famItemHit(x, dir) {
    return () =>
      npcHit({
        name: x.name,
        category: x.category,
        quantity: x.quantity,
        price: x.npcPrice || 0,
        priceLabel: 'Valor no NPC',
        raw: { icon: iconUrl(x.icon) },
        npcAction: {
          label: dir === 'deposit' ? '👪 Guardar na família' : '🎒 Retirar da família',
          needQty: true,
          max: x.quantity,
          run: async (q) => {
            await famItem(x, dir, q);
            hideDetails();
          }
        }
      });
  }

  async function famItem(x, dir, q) {
    const id = x.itemId != null ? x.itemId : x.id;

    await wsSend({ type: 'family-action', action: 'item', dir, itemId: id, quantity: q }, ['family']);
    toast((dir === 'deposit' ? 'Guardado na família: ' : 'Retirado da família: ') + fmt(q) + '× ' + x.name);
    npcLoad('depot');
  }

  const npcPf = () => npcSt.pf || (npcSt.pf = { iv1: '', iv2: '', lv1: '', lv2: '', q: '', shiny: false, rar: [], sort: 'name' });

  const npcPview = () => npcSt.pview || (npcSt.pview = store.get('npcPview', 'list'));

  function npcPokeFilterBar(views) {
    const f = npcPf();
    const v = npcPview();

    return `<div class="npc-pf">
      ${
        views
          ? `<span class="mkc-views npc-views">${[
              ['rows', '≡', 'Compacto'],
              ['list', '☰', 'Horizontal'],
              ['grid', '▦', 'Cards']
            ]
              .map(([k, i, t]) => `<button type="button" data-pview="${k}" class="${v === k ? 'on' : ''}" title="${t}">${i}</button>`)
              .join('')}</span>`
          : ''
      }
      <span class="mk-f">IV <input type="text" data-pf="iv1" value="${esc(f.iv1)}" placeholder="mín" inputmode="numeric"> – <input type="text" data-pf="iv2" value="${esc(f.iv2)}" placeholder="máx" inputmode="numeric"></span>
      <span class="mk-f">Nv <input type="text" data-pf="lv1" value="${esc(f.lv1)}" placeholder="mín" inputmode="numeric"> – <input type="text" data-pf="lv2" value="${esc(f.lv2)}" placeholder="máx" inputmode="numeric"></span>
      <span class="mk-f">× ≥ <input type="text" data-pf="q" value="${esc(f.q)}" placeholder="1.40" inputmode="decimal"></span>
      <label class="mk-chk"><input type="checkbox" data-pf="shiny"${f.shiny ? ' checked' : ''}> ✨ Shiny</label>
      <span class="mk-f">Ordenar
        <select data-pf="sort">
          ${[['name', 'Nome'], ['lvl', 'Nível ↓'], ['iv', 'IV ↓'], ['q', 'Qualidade ↓']]
            .map(([v, l]) => `<option value="${v}"${f.sort === v ? ' selected' : ''}>${l}</option>`)
            .join('')}
        </select>
      </span>
      <div class="mk-chips">
        ${QUALITY_TIERS.slice()
          .reverse()
          .map(([, l]) => {
            const c = RARITY_COLOR[l.toLowerCase()] || '#c7cbe0';

            return `<button type="button" class="mk-chip${f.rar.includes(l) ? ' on' : ''}" data-pfr="${esc(l)}" style="color:${c}">${esc(l)}</button>`;
          })
          .join('')}
      </div>
    </div>`;
  }

  function npcPokeFilter(list) {
    const f = npcPf();
    const n = (v, int) => {
      const x = parseFloat(String(v || '').replace(',', '.'));

      return Number.isFinite(x) ? (int ? Math.floor(x) : x) : null;
    };
    const iv1 = n(f.iv1, 1);
    const iv2 = n(f.iv2, 1);
    const lv1 = n(f.lv1, 1);
    const lv2 = n(f.lv2, 1);
    const qm = n(f.q);
    const num = (v) => (v == null ? -1 : Number(v));

    return list
      .filter((p) => {
        const iv = p.ivTotal;
        const q = p.quality != null ? Number(p.quality) : null;

        if (iv1 != null && !(iv >= iv1)) return false;
        if (iv2 != null && !(iv <= iv2)) return false;
        if (lv1 != null && !(p.level >= lv1)) return false;
        if (lv2 != null && !(p.level <= lv2)) return false;
        if (qm != null && !(q >= qm)) return false;
        if (f.shiny && !p.shiny) return false;
        if (f.rar.length && !f.rar.includes(qualityTier(q))) return false;

        return true;
      })
      .sort((a, b) =>
        f.sort === 'lvl'
          ? b.level - a.level
          : f.sort === 'iv'
            ? num(b.ivTotal) - num(a.ivTotal)
            : f.sort === 'q'
              ? num(b.quality) - num(a.quality)
              : String(a.name).localeCompare(String(b.name)) || b.level - a.level
      );
  }

  function askPokes() {
    if (npcSt.pokesAsked) return;

    npcSt.pokesAsked = true;
    wsSend({ type: 'pokes-get' }, ['pokes']).catch(() => {});
  }

  function shopPokeSell() {
    askPokes();

    const all = allPokes();

    if (!all.length) return '<div class="mk-empty">Carregando seus Pokémon…</div>';

    const list = npcPokeFilter(all.filter((p) => !p.team && p.sellValue > 0));
    const sel = npcSt.pokeSel || (npcSt.pokeSel = new Set());

    [...sel].forEach((id) => {
      if (!all.some((p) => p.id === id && !p.team)) sel.delete(id);
    });

    npcSt.pokeList = list;

    const chosen = all.filter((p) => sel.has(p.id));
    const tot = chosen.reduce((a, p) => a + (p.sellValue || 0), 0);
    const allOn = list.length > 0 && list.every((p) => sel.has(p.id));

    return (
      npcPokeFilterBar(true) +
      `<div class="npc-bar">
        <button type="button" data-pselall="1">${allOn ? 'Desmarcar todos' : 'Selecionar todos'}</button>
        <span class="mk-dim">${chosen.length} selecionados · ${list.length} na lista</span>
        <span style="flex:1"></span>
        <button type="button" data-psell="1" class="npc-primary"${chosen.length ? '' : ' disabled'}>💰 Vender selecionados · $ ${fmt(tot)}</button>
      </div>
      <div class="npc-list">${
        (npcPview() === 'rows'
          ? list.map((p) => pokeRow(p, null, 'sell', { check: sel.has(p.id) })).join('')
          : pokeCards(list, 'sell', 'sell', sel)) ||
        '<div class="mk-empty">Nenhum Pokémon para vender (os do time ficam de fora).</div>'
      }</div>
      <div class="mk-dim npc-note">Pokémon do time não aparecem aqui. Clique na linha para marcar.</div>`
    );
  }

  function depotExtra(tab, inv) {
    const need = (msg) => `<div class="mk-empty">${msg}</div>`;

    if (tab === 'poke') {
      const all = allPokes();

      if (!all.length) {
        wsSend({ type: 'inv-get' }).catch(() => {});

        return need('Carregando seus Pokémon… (se não aparecer, abra o jogo 1x e volte)');
      }

      askPokes();

      const team = npcPokeFilter(all.filter((p) => p.team));
      const box = npcPokeFilter(all.filter((p) => !p.team));

      return npcPokeFilterBar(true) + `<div class="${npcPview() === 'rows' ? 'npc-cols' : 'npc-stack'}">
          <div class="mk-sec">
            <div class="mk-sec-h">⚔ Time (${team.length})</div>
            <div class="npc-list">${pokeCards(team, 'store', 'own') || need('Time vazio.')}</div>
          </div>
          <div class="mk-sec">
            <div class="mk-sec-h">📦 Depósito (${box.length})</div>
            <div class="npc-list">${pokeCards(box, 'withdraw', 'own') || need('Nenhum Pokémon no depósito.')}</div>
          </div>
        </div>`;
    }

    const F = wsSt.fam;

    if (!npcSt.famAsked) {
      npcSt.famAsked = true;
      wsSend({ type: 'family-get' }, ['family']).catch((e) => {
        npcSt.famErr = e.message;
        npcRender();
      });
    }

    if (!F) return need(npcSt.famErr ? '⚠ ' + esc(npcSt.famErr) : 'Carregando família…');
    if (!F.family) return need('Você não está em uma família.');

    const fd = F.depot || {};
    const fam = F.family;
    const head = `<div class="npc-bar"><b>👪 ${esc(fam.name || 'Família')}</b><span class="mk-dim">Movimentos: ${fmt(fam.movesUsed || 0)}/${fmt(fam.movesCap || 0)}</span>${
      fam.frozen ? '<span class="mk-dim" style="color:#ff6b6b">congelada</span>' : ''
    }</div>`;

    if (tab === 'fitems') {
      const L = inv
        .map((x) =>
          npcRow(iconUrl(x.icon), x.name, fmt(x.quantity) + '×', famItemHit(x, 'deposit'), { famArrow: 'deposit', famId: x.id })
        )
        .join('');
      const R = (fd.items || [])
        .map((x) =>
          npcRow(iconUrl(x.icon), x.name, fmt(x.quantity) + '×', famItemHit(x, 'withdraw'), { famArrow: 'withdraw', famId: x.itemId })
        )
        .join('');

      npcSt.famInv = inv;

      return (
        head +
        `<div class="npc-cols">
          <div class="mk-sec">
            <div class="mk-sec-h">🎒 Mochila (${inv.length})</div>
            <div class="npc-list">${L || need('Mochila vazia.')}</div>
          </div>
          <div class="mk-sec">
            <div class="mk-sec-h">👪 Família (${(fd.items || []).length})</div>
            <div class="npc-list">${R || need('Nada guardado na família.')}</div>
          </div>
        </div>
        <div class="mk-dim npc-note">A seta move o stack inteiro. Clique no item para mover só uma parte.</div>`
      );
    }

    askPokes();

    const mine = npcPokeFilter(allPokes());
    const fpokes = npcPokeFilter(fd.pokes || []);

    return (
      head +
      npcPokeFilterBar(true) +
      `<div class="${npcPview() === 'rows' ? 'npc-cols' : 'npc-stack'}">
        <div class="mk-sec">
          <div class="mk-sec-h">⚔ Meus Pokémon (${mine.length})</div>
          <div class="npc-list">${pokeCards(mine, 'deposit', 'fam') || need('Nenhum Pokémon.')}</div>
        </div>
        <div class="mk-sec">
          <div class="mk-sec-h">👪 Família (${fpokes.length})</div>
          <div class="npc-list">${pokeCards(fpokes, 'withdraw', 'fam') || need('Nenhum Pokémon na família.')}</div>
        </div>
      </div>`
    );
  }

  // repete uma ação aprendida trocando o valor antigo pelo novo (ex.: "basic" -> "premium")
  function adaptTpl(str, keys, target) {
    if (!str) return null;

    if (str.includes('"' + target + '"')) return str;

    for (const k of keys) {
      if (k !== target && str.includes('"' + k + '"')) return str.split('"' + k + '"').join('"' + target + '"');
    }

    return null;
  }

  async function heldTrade(d, o) {
    const keys = (d.offers || []).map((x) => x.key);
    const http = store.get('learnHeld', null);
    const ws = store.get('learnHeldWs', null);
    const body = http && adaptTpl(http.body || '{}', keys, o.key);
    const wmsg = !body && ws && adaptTpl(ws, keys, o.key);

    if (!body && !wmsg) {
      netCap.on = true;
      netCap.log = [];
      toast('Faça 1 troca na janela do jogo para eu aprender — depois os botões daqui funcionam sozinhos.');
      openNpc('held');

      return;
    }

    const r = body
      ? await gamePost(http.url, JSON.parse(body))
      : await wsSend(JSON.parse(wmsg), ['held', 'held-result', 'held-machine', 'inventory', 'toast', 'error'], 6000);
    const got = r && (r.item || r.held || r.reward || r.won || r.result);

    toast('Troca feita' + (got ? ': ' + (got.name || got) + (got.tierLabel ? ' ' + got.tierLabel : '') : '!'));
    npcLoad('held');
  }

  async function traderItemBuy(d, x, q) {
    if (x.speciesId != null) return gamePost('/api/game/pokemaniac-trader/buy', { speciesId: x.speciesId });

    const id = x.itemId != null ? x.itemId : x.id;
    const lt = store.get('learnTrader', null);

    if (lt && lt.body) {
      let b;

      try {
        b = JSON.parse(lt.body);
      } catch (e) {
        b = {};
      }

      ['itemId', 'id', 'packId', 'offerId', 'key'].forEach((k) => {
        if (k in b) b[k] = x[k] != null ? x[k] : id;
      });

      ['qty', 'quantity', 'amount'].forEach((k) => {
        if (k in b) b[k] = q || 1;
      });

      return gamePost(lt.url, b);
    }

    return gamePost('/api/game/pokemaniac-trader/buy', { itemId: id, qty: q || 1 });
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
              steps: [1000, 5000, 10000],
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
        `<div class="npc-toprow">
          <div class="mk-seg npc-tabs">
            <button type="button" data-st="buy" class="${npcSt.shopTab === 'buy' ? 'on' : ''}">Comprar</button>
            <button type="button" data-st="sell" class="${npcSt.shopTab === 'sell' ? 'on' : ''}">Vender</button>
          </div>
          ${
            npcSt.shopTab === 'sell'
              ? `<div class="mk-seg npc-tabs">
              <button type="button" data-ssk="items" class="${npcSt.shopSellKind !== 'poke' ? 'on' : ''}">Itens</button>
              <button type="button" data-ssk="poke" class="${npcSt.shopSellKind === 'poke' ? 'on' : ''}">Pokémon</button>
            </div>`
              : ''
          }
        </div>` +
        (npcSt.shopTab === 'sell' && npcSt.shopSellKind === 'poke'
          ? shopPokeSell()
          : npcSt.shopTab === 'buy'
          ? npcSec('Poké Balls', (d.balls || []).map((x) => sell(x, true)).join('')) +
            npcSec('Itens', (d.items || []).map((x) => sell(x, false)).join(''))
          : (() => {
              const locked = npcSt.data.locked || new Set();
              const list = inv.filter((x) => x.npcPrice > 0 && !locked.has(x.id) && !isBlocked(x.name));
              const sel = npcSt.sellSel || (npcSt.sellSel = new Set());

              [...sel].forEach((id) => {
                if (!list.some((x) => x.id === id)) sel.delete(id);
              });

              npcSt.sellList = list;

              const chosen = list.filter((x) => sel.has(x.id));
              const tot = chosen.reduce((acc, x) => acc + x.quantity * x.npcPrice, 0);
              const allOn = list.length > 0 && chosen.length === list.length;

              return npcBlockBar() + `<div class="npc-bar">
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
                        { check: x.id, checked: sel.has(x.id), block: true }
                      )
                    )
                    .join('') || '<div class="mk-empty">Nada vendável na mochila.</div>'
                }</div>
                <div class="mk-dim npc-note">Itens travados no jogo e os da lista "Nunca vender" ficam de fora. Clique no item para vender só uma parte.</div>`;
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
        body = tabs + depotExtra(tab, inv);
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

      const stoneHit = (x) => (() =>
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
              }))();
      const stones = (d.stones || []).filter((x) => x.quantity > 0);
      const ssel = npcSt.stoneSel || (npcSt.stoneSel = new Set());

      [...ssel].forEach((id) => {
        if (!stones.some((x) => String(x.id) === id)) ssel.delete(id);
      });

      npcSt.stoneList = stones;

      const schosen = stones.filter((x) => ssel.has(String(x.id)));
      const stot = schosen.reduce((acc, x) => acc + x.quantity * x.unitPrice, 0);
      const sAll = stones.length > 0 && schosen.length === stones.length;

      body =
        `<div class="npc-bar">
          <button type="button" data-sselall="1">${sAll ? 'Desmarcar todas' : 'Selecionar todas'}</button>
          <span class="mk-dim">${schosen.length} de ${stones.length} selecionadas</span>
          <span style="flex:1"></span>
          <button type="button" data-ssell="1" class="npc-primary"${schosen.length ? '' : ' disabled'}>💰 Vender selecionadas · $ ${fmt(stot)}</button>
        </div>
        <div class="npc-list">${
          stones
            .map((x) =>
              npcRow(
                iconUrl(x.icon),
                x.name,
                fmt(x.quantity) + '× · $ ' + fmt(x.unitPrice) + '/un = $ ' + fmt(x.quantity * x.unitPrice),
                () => stoneHit(x),
                { check: String(x.id), set: 'stone', checked: ssel.has(String(x.id)) }
              )
            )
            .join('') || '<div class="mk-empty">Você não tem stones para vender.</div>'
        }</div>
        <div class="mk-dim npc-note">Marque várias e venda tudo de uma vez. Clique na stone para vender só uma parte.</div>`;
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

      const learned = !!(store.get('learnHeld', null) || store.get('learnHeldWs', null));

      npcSt.heldData = d;

      body =
        `<div class="held-offers">${(d.offers || [])
          .map(
            (o, i) => `<div class="held-offer">
              <div class="held-tier">Tier ${esc((o.tiers || []).join('–'))}</div>
              <div class="held-cost">${d.tokenIcon ? `<img src="${esc(iconUrl(d.tokenIcon))}">` : '🪙'} <b>${fmt(o.cost)}</b> <span class="mk-dim">${esc(d.tokenName || 'tokens')}</span></div>
              <button type="button" class="npc-primary" data-held="${i}"${(d.tokenQty || 0) < o.cost ? ' disabled title="Tokens insuficientes"' : ''}>Trocar</button>
            </div>`
          )
          .join('')}</div>
        <div class="mk-dim npc-note">Cada troca sorteia 1 held entre as famílias abaixo.${
          learned ? '' : ' A 1ª troca precisa ser feita na janela do jogo (o botão abre ela) para eu aprender a ação.'
        }</div>` +
        (d.offers || [])
          .map((o) =>
            npcSec(
              'Tier ' + esc((o.tiers || []).join('–')) + ' · ' + fmt(o.cost) + ' ' + esc(d.tokenName || ''),
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

      const ownedQty = (st) => {
        const id = st.itemId != null ? st.itemId : st.id;
        const nm = String(st.name || '').toLowerCase();
        const inv = (ownedCache && ownedCache.list) || [];
        const hit = inv.find((y) => (id != null && y.itemId === id) || (nm && String(y.name || '').toLowerCase() === nm));

        return st.have != null ? st.have : st.owned != null ? st.owned : hit ? hit.quantity : null;
      };

      const reqHtml = (x) => {
        const parts = [];

        if (x.needsEevee) parts.push(`<span class="${x.hasEevee || d.hasEevee ? 'tr-ok' : 'tr-no'}">Eevee ${x.hasEevee || d.hasEevee ? '✓' : '✗'}</span>`);

        (x.stones || []).forEach((st) => {
          if (typeof st !== 'object') return parts.push(esc(st));

          const need = st.qty || st.quantity || st.need || 1;
          const have = ownedQty(st);
          const ok = have == null ? null : have >= need;

          parts.push(`<span class="${ok == null ? '' : ok ? 'tr-ok' : 'tr-no'}">${fmt(need)}× ${esc(st.name || st.id)}${have != null ? ' (' + fmt(have) + ')' : ''}</span>`);
        });

        return parts.join(' · ');
      };

      const offerCard = (x) =>
        npcCard(
              '',
              x.name,
              (x.isTrade ? (reqHtml(x) || 'Troca') : '$ ' + fmt(x.price)) +
                (x.needsEevee && !x.isTrade ? ' · precisa Eevee' : '') +
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
            );

      const offers = d.offers || [];
      const isItem = (x) => x.speciesId == null;
      const buy = offers.filter((x) => !isItem(x) && !x.isTrade);
      const trades = offers.filter((x) => !isItem(x) && x.isTrade);
      const extraItems = offers.filter(isItem);

      Object.keys(d).forEach((k) => {
        if (k !== 'offers' && Array.isArray(d[k])) {
          d[k].forEach((y) => {
            if (y && typeof y === 'object' && y.name && y.speciesId == null) extraItems.push(y);
          });
        }
      });

      const itemCard = (x) =>
        npcCard(iconUrl(x.icon || x.iconUrl || ''), x.name, (x.price != null ? '$ ' + fmt(x.price) : '') + (x.canBuy === false ? ' · <span style="color:#c0392b">indisponível</span>' : ''), () =>
          npcHit({
            name: x.name,
            category: 'Items',
            price: x.price || 0,
            raw: { icon: iconUrl(x.icon || x.iconUrl || '') },
            npcAction:
              x.canBuy === false
                ? null
                : {
                    label: '🛒 Comprar',
                    needQty: true,
                    max: x.max || x.stock || null,
                    unit: x.price || 0,
                    confirm: (q) => 'Comprar ' + q + '× ' + x.name + (x.price ? ' por $ ' + fmt(q * x.price) : '') + '?',
                    run: async (q) => {
                      const r = await traderItemBuy(d, x, q);

                      toast('Comprado: ' + ((r && r.name) || x.name) + (r && r.goldSpent ? ' · -$ ' + fmt(r.goldSpent) : ''));
                      hideDetails();
                      npcLoad('trader');
                    }
                  }
          })
        );

      body =
        npcSec('Comprar Pokémon', buy.map(offerCard).join(''), 'Nada à venda.') +
        (extraItems.length ? npcSec('Itens', extraItems.map(itemCard).join('')) : '') +
        npcSec('Evoluções / Trocas', trades.map(offerCard).join(''), 'Sem trocas.');
    }

    $('npc-info').textContent = info;
    $('npc-body').innerHTML = body;

    npcSt.pseudo.forEach(ensureSprite);
  }

  $('npc-filter').addEventListener('input', () => npcRender());

  let pfT = null;

  $('npc-body').addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.pf;

    if (!k || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;

    npcPf()[k] = e.target.value;
    clearTimeout(pfT);
    pfT = setTimeout(() => {
      const pos = e.target.selectionStart;

      npcRender();

      const el = document.querySelector('#npc-body [data-pf="' + k + '"]');

      if (el) {
        el.focus();

        try {
          el.setSelectionRange(pos, pos);
        } catch (err) {}
      }
    }, 300);
  });

  $('npc-body').addEventListener('change', (e) => {
    const pk = e.target.dataset && e.target.dataset.pf;

    if (pk && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) {
      npcPf()[pk] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      npcRender();

      return;
    }

    if (e.target.id === 'npc-cat') {
      npcSt.depotCat = e.target.value;
      npcRender();

      return;
    }

    const c = e.target.closest('.npc-chk');

    if (!c) return;

    const stone = c.dataset.set === 'stone' || c.dataset.set === 'poke';
    const sel =
      c.dataset.set === 'poke'
        ? npcSt.pokeSel || (npcSt.pokeSel = new Set())
        : stone
          ? npcSt.stoneSel || (npcSt.stoneSel = new Set())
          : npcSt.sellSel || (npcSt.sellSel = new Set());
    const id = stone ? c.dataset.sid : +c.dataset.sid;

    if (c.checked) {
      sel.add(id);
    } else {
      sel.delete(id);
    }

    npcRender();
  });

  $('npc-body').addEventListener('keydown', (e) => {
    if (e.target.id !== 'npc-block-in' || e.key !== 'Enter') return;

    const v = e.target.value.trim();

    if (!v) return;

    const inv = (npcSt.data.depot && npcSt.data.depot.inventory) || [];
    const m = inv.find((x) => String(x.name).toLowerCase() === v.toLowerCase()) || inv.find((x) => String(x.name).toLowerCase().includes(v.toLowerCase()));
    const name = m ? m.name : v;

    if (!isBlocked(name)) setSellBlock(sellBlock().concat(name));

    setTimeout(() => $('npc-block-in') && $('npc-block-in').focus(), 0);
  });

  $('npc-body').addEventListener('click', (e) => {
    if (e.target.closest('.npc-chk')) return;

    const hb = e.target.closest('[data-held]');

    if (hb) {
      const d = npcSt.heldData;
      const o = d && (d.offers || [])[+hb.dataset.held];

      if (!o) return;
      if (!confirm('Trocar ' + o.cost + ' ' + (d.tokenName || 'tokens') + ' por 1 held Tier ' + (o.tiers || []).join('–') + '?')) return;

      hb.disabled = true;
      heldTrade(d, o)
        .catch((err) => toast('Erro: ' + ((err && err.message) || err)))
        .finally(() => (hb.disabled = false));

      return;
    }

    const pvw = e.target.closest('[data-pview]');

    if (pvw) {
      npcSt.pview = pvw.dataset.pview;
      store.set('npcPview', npcSt.pview);
      npcRender();

      return;
    }

    const pfr = e.target.closest('[data-pfr]');

    if (pfr) {
      const f = npcPf();
      const r = pfr.dataset.pfr;

      f.rar = f.rar.includes(r) ? f.rar.filter((x) => x !== r) : f.rar.concat(r);
      npcRender();

      return;
    }

    if (e.target.closest('[data-pselall]')) {
      const list = npcSt.pokeList || [];
      const sel = npcSt.pokeSel || (npcSt.pokeSel = new Set());

      if (list.length && list.every((p) => sel.has(p.id))) list.forEach((p) => sel.delete(p.id));
      else list.forEach((p) => sel.add(p.id));

      npcRender();

      return;
    }

    const psell = e.target.closest('[data-psell]');

    if (psell) {
      const sel = npcSt.pokeSel || new Set();
      const chosen = allPokes().filter((p) => sel.has(p.id) && !p.team);
      const tot = chosen.reduce((a, p) => a + (p.sellValue || 0), 0);

      if (!chosen.length) return;
      if (!confirm('Vender ' + chosen.length + ' Pokémon por $ ' + fmt(tot) + '?\n\n' + chosen.map((p) => p.name + ' Nv ' + p.level + (p.ivTotal != null ? ' · IV ' + p.ivTotal : '')).join('\n'))) return;

      psell.disabled = true;

      gamePost('/api/game/pokemon/sell', { pokeIds: chosen.map((p) => p.id) })
        .then((r) => toast('Vendido: ' + chosen.length + ' Pokémon · +$ ' + fmt((r && (r.goldGained || r.gold || r.total)) || tot)))
        .catch((err) => toast('Erro: ' + ((err && err.message) || err)))
        .finally(() => {
          sel.clear();
          npcSt.pokesAsked = false;
          wsSend({ type: 'pokes-get' }, ['pokes'])
            .catch(() => {})
            .finally(() => npcLoad('shop'));
        });

      return;
    }

    const psel = e.target.closest('[data-psel]');

    if (psel) {
      const sel = npcSt.pokeSel || (npcSt.pokeSel = new Set());
      const id = psel.dataset.psel;

      if (sel.has(id)) sel.delete(id);
      else sel.add(id);

      npcRender();

      return;
    }

    const pmv = e.target.closest('[data-pmv]');

    if (pmv) {
      const id = pmv.dataset.pmv;
      const dir = pmv.dataset.pdir;
      const fam = pmv.dataset.pk === 'fam';

      pmv.disabled = true;

      const msg = fam
        ? { type: 'family-action', action: 'poke', dir, capturedId: id }
        : { type: dir === 'store' ? 'poke-store' : 'poke-withdraw', pokeId: id };

      wsSend(msg, fam ? ['family'] : ['pokes'])
        .then(() => {
          hideDetails();
          npcRender();
        })
        .catch((err) => {
          toast('Erro: ' + ((err && err.message) || err));
          pmv.disabled = false;
        });

      return;
    }

    const fmv = e.target.closest('[data-fmv]');

    if (fmv) {
      const dir = fmv.dataset.fdir;
      const id = fmv.dataset.fmv;
      const src = dir === 'deposit' ? npcSt.famInv || [] : ((wsSt.fam && wsSt.fam.depot) || {}).items || [];
      const x = src.find((y) => String(y.itemId != null ? y.itemId : y.id) === id);

      if (!x) return;

      fmv.disabled = true;
      famItem(x, dir, x.quantity).catch((err) => {
        toast('Erro: ' + ((err && err.message) || err));
        fmv.disabled = false;
      });

      return;
    }

    const cap = e.target.closest('[data-cap]');

    if (cap) {
      const k = cap.dataset.cap;

      if (k === 'rec') {
        netCap.on = !netCap.on;

        if (netCap.on) netCap.log = [];

        toast(netCap.on ? '● Gravando ações do jogo…' : '■ Gravação parada (' + netCap.log.length + ' registros).');
        npcRender();
      } else if (k === 'game') {
        if (!netCap.on) {
          netCap.on = true;
          netCap.log = [];
          npcRender();
        }

        $('npc-game').click();
      } else if (k === 'copy') {
        capCopy();
      }

      return;
    }

    const ssk = e.target.closest('[data-ssk]');

    if (ssk) {
      npcSt.shopSellKind = ssk.dataset.ssk;
      npcSt.pokesAsked = false;
      hideDetails();
      npcRender();

      return;
    }

    const blk = e.target.closest('[data-blk]');

    if (blk) {
      if (!isBlocked(blk.dataset.blk)) setSellBlock(sellBlock().concat(blk.dataset.blk));
      toast('🚫 ' + blk.dataset.blk + ': não será mais vendido.');

      return;
    }

    const unb = e.target.closest('[data-unblk]');

    if (unb) {
      setSellBlock(sellBlock().filter((b) => b.toLowerCase() !== unb.dataset.unblk.toLowerCase()));

      return;
    }

    const sl2 = npcSt.stoneList || [];
    const ssel = npcSt.stoneSel || (npcSt.stoneSel = new Set());

    if (e.target.closest('[data-sselall]')) {
      if (sl2.length && sl2.every((x) => ssel.has(String(x.id)))) ssel.clear();
      else sl2.forEach((x) => ssel.add(String(x.id)));

      npcRender();

      return;
    }

    const sb = e.target.closest('[data-ssell]');

    if (sb) {
      const chosen = sl2.filter((x) => ssel.has(String(x.id)));
      const tot = chosen.reduce((acc, x) => acc + x.quantity * x.unitPrice, 0);

      if (!chosen.length) return;
      if (!confirm('Vender ' + chosen.length + ' stones por $ ' + fmt(tot) + '?\n\n' + chosen.map((x) => fmt(x.quantity) + '× ' + x.name).join('\n'))) return;

      sb.disabled = true;

      (async () => {
        let gold = 0;
        let n = 0;

        for (const x of chosen) {
          try {
            const r = await gamePost('/api/game/flint/sell', { itemId: x.id, qty: x.quantity });

            gold += (r && r.goldGained) || 0;
            n += (r && r.sold) || x.quantity;
          } catch (err) {
            toast('Parou em ' + x.name + ': ' + ((err && err.message) || err));
            break;
          }
        }

        toast('Vendido: ' + fmt(n) + ' stones · +$ ' + fmt(gold));
        ssel.clear();
        hideDetails();
        npcLoad('flint');
      })();

      return;
    }

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
      npcSt.famAsked = false;
      npcSt.famErr = '';
      npcSt.pokesAsked = false;
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
