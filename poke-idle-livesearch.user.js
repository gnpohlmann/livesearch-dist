// ==UserScript==
// @name         Poke Idle - LiveSearch
// @namespace    poke-idle-market
// @version      0.7.2
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
  const VERSION = '0.7.2';
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
  const MK_CAT_ICON = { all: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>', Items: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M9 21v-5h6v5"/><path d="M10 6h4"/></svg>', Stones: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 3v18"/><path d="M5 7l7 4 7-4"/></svg>', 'Poke Balls': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h6"/><path d="M15 12h6"/><circle cx="12" cy="12" r="3"/></svg>', Diamonds: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5h12l3 5-9 10L3 10z"/><path d="M3 10h18"/><path d="M10 5l-2 5 4 10 4-10-2-5"/></svg>', pokemon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M8 16.5c0-2.5 2-4.5 4-4.5s4 2 4 4.5c0 1.6-1.3 2.5-2.8 2.1-.8-.2-1.6-.2-2.4 0C9.3 19 8 18.1 8 16.5z"/></svg>' };
  const MK_CATS = [['all', 'Todos'], ['Items', 'Itens'], ['Stones', 'Stones'], ['Poke Balls', 'Poké Balls'], ['Diamonds', 'Diamantes'], ['pokemon', 'Pokémon']];
  const DEBUG = true;

  const log = (...a) => DEBUG && console.log('%c[Alertas]', 'color:#e0b95a;font-weight:bold', ...a);
  const pip = { win: null, doc: null };
  const $ = (id) => document.getElementById(id) || (pip.doc ? pip.doc.getElementById(id) : null);
  const qa = (sel) => [...document.querySelectorAll(sel), ...(pip.doc ? pip.doc.querySelectorAll(sel) : [])];
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
  const wsSt = { sock: null, pokes: null, fam: null, waits: [], seen: new WeakSet(), wseen: new WeakSet(), kseen: new WeakSet(), mseen: new WeakSet(), onMsg: null, sends: [] };

  function wsIn(ev, v) {
    try {
      const tg = ev.target || ev.currentTarget;

      if ((!wsSt.sock || wsSt.sock.readyState !== 1) && tg && typeof tg.send === 'function' && 'readyState' in tg && !/livesearch/i.test(String(tg.url || ''))) wsSt.sock = tg;
    } catch (e) {}

    if (typeof v === 'string' && wsSt.onMsg && !wsSt.mseen.has(ev)) {
      wsSt.mseen.add(ev);

      try {
        wsSt.onMsg(v);
      } catch (e) {}
    }

    if (typeof v !== 'string' || wsSt.seen.has(ev)) return;

    try {
      if (v.startsWith('{"type":"field-kill"') && !wsSt.kseen.has(ev)) {
        wsSt.kseen.add(ev);
        dkKill(JSON.parse(v));
      }
    } catch (e) {}

    try {
      if (v.length < 300000 && /"(gold|dollars?|money|diamonds?)"\s*:/i.test(v) && !/^\{"type":"(field|chat)"/.test(v) && !wsSt.wseen.has(ev)) {
        wsSt.wseen.add(ev);

        const jw = JSON.parse(v);
        const g0 = wallet.gold;
        const d0 = wallet.dia;

        wallet.dia = null;
        walletScan(jw, 0);

        if (jw && jw.type === 'balls' && jw.counts) wsSt.ballCounts = jw.counts;

        if (wallet.dia == null) {
          wallet.dia = d0;
        } else {
          // aprende qual pedido do jogo traz os diamantes (só pedidos de leitura)
          const now = Date.now();
          const req = wsSt.sends
            .slice()
            .reverse()
            .find((x) => now - x.t < 2500 && /^\{"type":"[^"]*(get|open|info|load|sync|shop|list|wallet|balance)[^"]*"/i.test(x.d) && !/(buy|sell|use|trade|claim|spend|open-box|craft)/i.test(x.d));

          if (req && req.d !== store.get('diaWsReq', null)) {
            store.set('diaWsReq', req.d);
            log('diamantes: pedido aprendido', req.d);
          }
        }

        if (wallet.gold !== g0 || wallet.dia !== d0) walletRender();
      }

      if (v.startsWith('{"type":"family"')) {
        const me = ((JSON.parse(v).family || {}).members || []).find((m) => m.isMe);

        if (me && me.name && $('mk-nick') && ($('mk-nick').textContent === '-' || !$('mk-nick').textContent)) $('mk-nick').textContent = me.name;
      }
    } catch (e) {}
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
          if (typeof d === 'string' && d.length < 2000) {
            wsSt.sends.push({ t: Date.now(), d });

            if (wsSt.sends.length > 12) wsSt.sends.shift();
          }
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

        if (m0 === 'POST' && u0.includes('/api/game/daily-kill')) {
          const b0 = typeof (init && init.body) === 'string' ? init.body : '';
          const kind = /claim|resgat|collect|reward/i.test(u0 + b0) ? 'dkClaim' : /reroll/i.test(u0 + b0) ? 'dkReroll' : 'dkChoose';

          res
            .then((r) => {
              if (!r.ok) return;

              store.set(kind, { url: u0.replace(location.origin, ''), body: b0 });
              log('daily kill: ação aprendida', kind, u0, b0);
              setTimeout(() => {
                try {
                  dkLoad();
                } catch (e) {}
              }, 800);
            })
            .catch(() => {});
        }

        if (m0 === 'GET' && u0.includes('/api/game/daily-kill')) {
          res
            .then((r) => r.clone().json())
            .then((d) => {
              try {
                dkSet(d);
              } catch (e) {}
            })
            .catch(() => {});
        }

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
          const isGet = String((init && init.method) || 'GET').toUpperCase() === 'GET';

          res
            .then((r) => r.clone().json())
            .then((d) => {
              try {
                const d0 = wallet.dia;

                wallet.dia = null;
                walletScan(d, 0);

                if (wallet.dia == null) wallet.dia = d0;
                else if (isGet && !u.includes('/market')) store.set('diaSrc', u.replace(location.origin, ''));

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

      recordPurchase(h, res, 'Comprado: ', qty);

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

  function recordPurchase(h, res, label, qty) {
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
      quantity: h.kind !== 'pokemon' && qty ? qty : h.quantity,
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

      recordPurchase(h, res || {}, '⚡ Auto-compra: ', qty);
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
        (h.inventory && h.kind === 'pokemon' && h.invRef) || (h.mine && h.kind === 'pokemon')
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
        h.inventory || h.mine
          ? `<div id="mtal-d-price" class="mtal-d-sell">
        ${
          h.kind === 'pokemon' || h.mine
            ? ''
            : `<span>Quantidade</span>

        <div class="mtal-d-sellrow">
          <input type="text" id="mtal-d-sqty" value="1" inputmode="numeric">
          <button type="button" id="mtal-d-smax">máx</button>
        </div>`
        }

        <span>${h.mine ? 'Novo preço' + (h.kind === 'pokemon' ? '' : ' por unidade') + ' <small class="mk-dim">(atual: ' + esc(hitPrice(h)) + ')</small>' : h.kind === 'pokemon' ? 'Anunciar por' : 'Preço por unidade'}</span>

        <div class="mtal-d-sellrow">
          <input type="text" id="mtal-d-sprice" placeholder="0" inputmode="numeric" value="${h.mine && h.price ? esc(fmt(h.price)) : ''}">

          <select id="mtal-d-scur">
            <option value="GOLD">$ Dólares</option>
            <option value="DIAMONDS">💎 Diamantes</option>
          </select>
        </div>

        <div class="mtal-d-fee" id="mtal-d-fee"></div>

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
        isPurchased || h.inventory || h.mine || !h.buyable
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

      qa('#mtal-details [data-step]').forEach((b) =>
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

    if (h.kind === 'pokemon' && !h.inventory && !h.mine && detailsAnchor === 'mtal-mk' && mk.rows.includes(h) && (h.raw || {}).speciesId) {
      const dv = document.createElement('div');

      dv.id = 'mtal-d-cmp';
      dv.className = 'cmp';
      $('mtal-d-body').appendChild(dv);
      cmpInit(h);
    }

    if (h.inventory || h.mine) {
      const sp = $('mtal-d-sprice');
      const sc = $('mtal-d-scur');
      const btn = $('mtal-d-sgo');

      sc.value = h.mine ? (h.currency === 'DIAMONDS' || h.currency === 'DIAMOND' ? 'DIAMONDS' : 'GOLD') : sl.lastCur;

      const qtyNow = () => (h.mine ? h.quantity || 1 : h.kind === 'pokemon' ? 1 : Math.floor(mkNum('mtal-d-sqty', true) || 0));

      const go = () =>
        h.mine
          ? slReprice(h, mkNum('mtal-d-sprice', true), sc.value, btn)
          : slSell(
              h.invRef,
              h.kind === 'pokemon' ? 'pokemon' : 'item',
              mkNum('mtal-d-sprice', true),
              sc.value,
              qtyNow(),
              btn
            );

      const btnLabel = () => {
        btn.textContent = (sc.value === 'DIAMONDS' ? '💎' : '$') + (h.mine ? ' Atualizar anúncio' : ' Anunciar');
        feeRender(mkNum('mtal-d-sprice', true), sc.value, qtyNow());
      };

      btnLabel();

      btn.addEventListener('click', go);
      sp.addEventListener('input', btnLabel);

      if ($('mtal-d-sqty')) $('mtal-d-sqty').addEventListener('input', btnLabel);

      sc.addEventListener('change', () => {
        if (!h.mine) sl.lastCur = sc.value;
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

    if (d && pip.doc && d.ownerDocument === pip.doc) return;

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
      const xhr =
        typeof GM_xmlhttpRequest === 'function'
          ? GM_xmlhttpRequest
          : typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest.bind(GM)
            : null;

      if (!xhr) {
        // sem API de rede do gerenciador (ex.: PokeGrid): tenta direto
        fetch(url, { headers: { accept: 'application/json' }, mode: 'cors', credentials: 'omit' })
          .then(async (r) => {
            const j = await r.json().catch(() => null);

            if (!r.ok) throw new Error('PokeIdle Market: ' + ((j && j.error) || 'HTTP ' + r.status));

            log('PokeIdle Market (fetch):', url, j);
            res(extParse(j));
          })
          .catch((e) => rej(/PokeIdle/.test(String(e && e.message)) ? e : new Error('PokeIdle Market bloqueado neste app (use o Tampermonkey no navegador)')));

        return;
      }

      xhr({
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

      if (h.id) mineIds.add(h.id);
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


        <div class="cmp-sec">À venda agora (${selling.length})</div>
        <div class="cmp-list">${selling.slice(0, 8).map((o) => row(o, '')).join('') || `<div class="cmp-empty">${live ? 'Nenhum parecido à venda.' : err ? '⚠ ' + esc(err) : 'Buscando anúncios…'}</div>`}</div>

        <div class="cmp-sec">Últimas saídas (${gone.length}) <small>${esc(src)}</small></div>
        <div class="cmp-list">${
          gone.slice(0, 12).map((o) => row(o, agoTxt(o.gone) + (o.relisted ? ' · 🔁' : ''))).join('') ||
          `<div class="cmp-empty">${
            !ext ? 'Buscando no PokeIdle Market…' : extErr ? '⚠ ' + esc(extErr) : (ext || []).length ? 'Nenhuma saída parecida nos últimos 7 dias.' : 'Nenhuma saída nos últimos 7 dias.'
          }</div>`
        }</div>
        ${$('mtal-d-sprice') ? '<div class="cmp-note">Clique numa linha para usar o preço.</div>' : ''}`;
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
        $('mtal-d-sprice').dispatchEvent(new Event('input', { bubbles: true }));
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

    try {
      const dd = $('mtal-details');
      const target = pip.doc && detailsAnchor !== 'mtal-mk' ? pip.doc.body : document.body;

      if (dd && dd.ownerDocument !== target.ownerDocument) target.appendChild(dd);
    } catch (e) {}

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
    #mtal-fab,#mtal-fab-mk{box-sizing:border-box;height:44px;display:inline-flex;align-items:center;gap:6px;background:linear-gradient(180deg,#1b1f31,#12141f);color:#f2ead0;border:1px solid #3a4060;border-radius:12px;padding:0 14px;font:bold 13px Inter,sans-serif;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.55)}
    #mtal-fab:hover,#mtal-fab-mk:hover{border-color:#8b93b8}
    #mtal-fab-mk{width:44px;padding:0;justify-content:center;font-size:17px}
    #mtal-toast-slot{display:flex;flex-direction:column;gap:6px;pointer-events:none}
    #mtal-toast-slot .mtal-toast{pointer-events:auto}
    #mtal-badge{background:#12141f;color:#f0d78c;border:1px solid #4a4f66;border-radius:6px;padding:4px 8px;margin-left:4px;font-size:11px;display:inline-flex;align-items:center;justify-content:center;line-height:1}

    #mtal-panel{position:fixed;left:16px;bottom:64px;width:620px;max-height:72vh;overflow:hidden;z-index:2147483646;background:#12141f;color:#e8e3d0;border:1px solid #c9a44a;border-radius:10px;font:12px/1.4 Inter,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);display:none;padding:0}
    #mtal-panel[style*="display: block"]{display:flex!important;flex-direction:column}
    #mtal-panel-head{flex:none;max-height:calc(72vh - 30px);overflow-y:auto;scrollbar-width:thin;position:sticky;top:0;z-index:2;background:#12141f;padding:10px 10px 0 10px;box-shadow:0 6px 10px -6px rgba(0,0,0,.65)}
    #mtal-panel-head::-webkit-scrollbar{width:3px}
    #mtal-dk{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:2147483640;font:12px/1.35 Inter,sans-serif;color:#e8e3d0}
    #mtal-dk .dk-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:180px;box-sizing:border-box;padding:10px 12px 12px;background:linear-gradient(180deg,#1b1f31,#12141f);border:1px solid #3a4060;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.55);cursor:pointer;text-align:center}
    #mtal-dk .dk-card:hover{border-color:#8b93b8}
    #mtal-dk .dk-card.dk-q{border-color:#c9a44a;animation:dkPulse 2.2s ease-in-out infinite}
    #mtal-dk .dk-card.dk-full{border-color:#61f6a4}
    @keyframes dkPulse{0%,100%{box-shadow:0 10px 28px rgba(0,0,0,.55)}50%{box-shadow:0 0 0 5px rgba(240,215,140,.16),0 10px 28px rgba(0,0,0,.55)}}
    #mtal-dk .dk-hd{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:18px}
    #mtal-dk .dk-hd-r{display:flex;align-items:center;gap:4px}
    #mtal-dk .dk-star{font-style:normal;color:#f0c14b}
    #mtal-dk .dk-mbtn{margin-top:2px;padding:3px 10px;background:transparent;border:none;border-radius:6px;color:#7c829c;font:inherit;font-size:10px;cursor:pointer}
    #mtal-dk .dk-mbtn:hover{color:#e8eaf2;background:#1f2436}
    #mtal-dk .dk-min{width:20px;height:18px;padding:0;background:transparent;border:1px solid transparent;border-radius:5px;color:#7c829c;font-size:11px;cursor:pointer}
    #mtal-dk .dk-min:hover{border-color:#4a4f66;color:#fff}
    #mtal-dk .dk-tier{padding:1px 8px;border:1px solid #6b5a1f;border-radius:999px;background:#2a2410;color:#f0c14b;font-size:10px;font-weight:800;letter-spacing:.03em;white-space:nowrap}
    #mtal-dk .dk-sp{display:grid;place-items:center;width:80%;aspect-ratio:1/1.12;margin:2px 0 4px;border-radius:14px;background:radial-gradient(circle at 50% 40%,#232842,#0d0f18);border:1px solid #2c3148;overflow:hidden}
    #mtal-dk .dk-sp img{width:78%;height:auto;max-height:90%;object-fit:contain;image-rendering:pixelated}
    #mtal-dk .dk-qbox{border-color:#6b5a1f;background:radial-gradient(circle at 50% 40%,#3a3016,#12141f)}
    #mtal-dk .dk-qbox b{font-size:78px;line-height:1;color:#f0c14b;text-shadow:0 0 18px rgba(240,193,75,.45)}
    #mtal-dk .dk-num{font-size:9.5px;color:#7c829c}
    #mtal-dk .dk-name{font-size:12px;color:#f2ead0}
    #mtal-dk .dk-q .dk-name{font-size:11.5px}
    #mtal-dk .dk-hint{font-size:9.5px;color:#9aa0b8}
    #mtal-dk .dk-types{display:flex;gap:4px;justify-content:center}
    #mtal-dk .dk-xp{font-size:10.5px;font-weight:800;color:#f0c14b}
    #mtal-dk .dk-cnt{font-size:11px;color:#9aa0b8}
    #mtal-dk .dk-cnt em{font-style:normal;font-size:17px;font-weight:800;color:#55d6f0}
    #mtal-dk .dk-bar{width:100%;height:6px;background:#2c3148;border-radius:3px;overflow:hidden}
    #mtal-dk .dk-bar i{display:block;height:100%;background:linear-gradient(90deg,#55d6f0,#61f6a4);border-radius:3px}
    #mtal-dk .dk-rws{display:flex;flex-wrap:wrap;justify-content:center;gap:4px}
    #mtal-dk .dk-rwi{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;background:#1f2436;border:1px solid #2c3148;font-size:10.5px;color:#c7cbe0;white-space:nowrap}
    #mtal-dk .dk-rwi img{width:16px;height:16px;image-rendering:pixelated}
    #mtal-dk .dk-rwi b{color:#f2ead0}
    #mtal-dk .dk-btn{width:100%;margin-top:4px;padding:6px 0;border-radius:8px;background:#232840;border:1px solid #2c3148;color:#9aa0b8;font-size:11px;font-weight:700}
    #mtal-dk .dk-btn.go{background:#e8eaf2;border-color:#e8eaf2;color:#12141f;cursor:pointer}
    #mtal-dk .dk-full .dk-btn.go{background:#61f6a4;border-color:#61f6a4;color:#0d1a12}
    #mtal-dk .dk-btn.done{background:#1d3325;border-color:#2e7d4f;color:#61f6a4}
    #mtal-dk .dk-card.dk-mini{width:auto;min-width:0;max-width:280px;padding:7px 12px 7px 7px;gap:4px}
    #mtal-dk .dk-mini .dk-minfo{flex:0 1 auto;min-width:110px}
    #mtal-dk .dk-mini .dk-bar{width:100%;min-width:130px;height:4px;margin-top:2px}
    #mtal-dk .dk-rdy{color:#61f6a4}
    #mtal-dk .dk-mrow{display:flex;align-items:center;gap:10px;width:100%;text-align:left}
    #mtal-dk .dk-msp{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:#0d0f18;border:1px solid #2c3148;overflow:hidden}
    #mtal-dk .dk-msp img{max-width:38px;max-height:38px;image-rendering:pixelated}
    #mtal-dk .dk-msp b{font-size:24px;color:#f0c14b}
    #mtal-dk .dk-minfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    #mtal-dk .dk-minfo > b{font-size:12px;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-dk .dk-minfo span{font-size:10.5px;color:#9aa0b8}
    #mtal-dk .dk-minfo em{font-style:normal;font-weight:800;color:#55d6f0}
    #mtal-dk .dk-over{border-color:#2e7d4f}
    #mtal-dk .dk-ok{background:#1d3325;border-color:#2e7d4f;color:#61f6a4;font-size:20px;font-weight:800}
    #mtal-dk .dk-pick{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);width:min(760px,94vw);padding:14px;background:#12141f;border:1px solid #c9a44a;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.65)}
    #mtal-dk .dk-pick-h{display:flex;align-items:center;gap:10px;margin-bottom:10px}
    #mtal-dk .dk-pick-h > b{font-size:14px;color:#f2ead0}
    #mtal-dk .dk-dim{font-size:11px;color:#7c829c}
    #mtal-dk .dk-timer{color:#55d6f0}
    #mtal-dk .dk-x{margin-left:auto;width:26px;height:26px;padding:0;background:transparent;border:1px solid transparent;border-radius:6px;color:#9aa0b8;cursor:pointer}
    #mtal-dk .dk-x:hover{border-color:#4a4f66;color:#fff}
    #mtal-dk .dk-rw{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;padding:6px 10px;background:#171a28;border:1px solid #2c3148;border-radius:8px}
    #mtal-dk .dk-rw span{font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-dk .dk-rw em{padding:2px 8px;border-radius:999px;background:#1f2436;font-style:normal;font-size:11px}
    #mtal-dk .dk-rw em.xp{color:#f0c14b;font-weight:800}
    #mtal-dk .dk-opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    #mtal-dk .dk-opt{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 10px;background:#1a1e30;border:1px solid #2c3148;border-radius:10px;text-align:center}
    #mtal-dk .dk-opt.on{border-color:#e8eaf2;background:#1e2336}
    #mtal-dk .dk-opt.off{opacity:.5}
    #mtal-dk .dk-star{position:absolute;top:6px;right:8px;color:#f0c14b}
    #mtal-dk .dk-osp{display:grid;place-items:center;width:72px;height:72px;border-radius:10px;background:#12141f}
    #mtal-dk .dk-osp img{max-width:68px;max-height:68px;image-rendering:pixelated}
    #mtal-dk .dk-opt small{color:#7c829c;font-size:10px}
    #mtal-dk .dk-opt > b{font-size:13px;color:#f2ead0}
    #mtal-dk .dk-types{display:flex;gap:4px;justify-content:center}
    #mtal-dk .dk-type{padding:2px 8px;border-radius:999px;font-size:9px;font-weight:800;text-transform:uppercase}
    #mtal-dk .dk-oxp{color:#f0c14b;font-weight:700;font-size:11px}
    #mtal-dk .dk-ocnt{font-size:12px;color:#9aa0b8}
    #mtal-dk .dk-ocnt b{font-size:16px;color:#55d6f0}
    #mtal-dk .dk-obar{width:100%;height:5px;margin:4px 0 2px;background:#2c3148;border-radius:3px;overflow:hidden}
    #mtal-dk .dk-obar i{display:block;height:100%;background:linear-gradient(90deg,#55d6f0,#61f6a4);border-radius:3px}
    #mtal-dk .dk-ostate{font-size:10.5px;color:#7c829c}
    #mtal-dk .dk-go{width:100%;height:30px;margin-top:4px;background:#e8eaf2;border:1px solid #e8eaf2;border-radius:6px;color:#12141f;font-weight:700;cursor:pointer}
    #mtal-dk .dk-go:hover{background:#fff}
    #mtal-dk .dk-foot{margin-top:10px;text-align:center;font-size:10.5px;color:#7c829c}
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
    #mtal-footer{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 12px;font-size:10px;letter-spacing:.03em;color:#9aa0b8;border-top:1px solid #232840;background:#12141f}
    #mtal-footer .mtal-fw{display:flex;gap:12px;font-size:11px;letter-spacing:0}
    #mtal-footer .mtal-fw b{color:#f0d78c;font-weight:700}
    #mtal-footer .mtal-fw span:last-child b{color:#55d6f0}
    #mtal-footer .mtal-fv{display:flex;align-items:center}
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
    #mtal-panel .lsi .lsp-sp .mtal-hit-thumb img{max-width:40px;max-height:40px;image-rendering:pixelated}
    #mtal-panel .lsi .mtal-hit-name{white-space:normal;overflow:visible;text-overflow:clip;line-height:1.2;word-break:normal;overflow-wrap:anywhere}
    #mtal-panel .lsi-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
    #mtal-panel .lsi-cat{padding:1px 8px;border-radius:999px;background:#262b3f;color:#c7cbe0;font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
    #mtal-panel .lsi-npc{padding:1px 8px;border-radius:999px;background:#1d3325;color:#61f6a4;font-size:9.5px;font-weight:700}
    #mtal-panel .lsi-alert{margin-top:5px;font-size:10px;color:#7c829c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-panel .lsi-block{justify-self:stretch;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    #mtal-panel .lsi-box{display:flex;flex-direction:column;align-items:flex-start;min-width:0;padding:6px 8px;background:#161927;border:1px solid #232840;border-radius:8px}
    #mtal-panel .lsi-box span{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-panel .lsi-box b{max-width:100%;font-size:12.5px;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-panel .lsi-box b.gold{color:#f0d78c}
    #mtal-panel .lsi-box b.dia{color:#55d6f0}
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
    #mtal-mk .mk-side .mk-cat i{display:grid;place-items:center;flex:none;width:18px;height:18px;font-style:normal;opacity:.75}
    #mtal-mk .mk-side .mk-cat i svg{display:block}
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
    #mtal-mk .mk-fcol .mk-stonechips .mk-chip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:5px 4px}
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
    #mtal-mk .hs-dbal{margin-left:auto;display:flex;align-items:baseline;gap:6px;font-style:normal;font-size:12px}
    #mtal-mk .hs-dbal i{font-style:normal;color:#4a4f66}
    #mtal-mk #hs-list{container-type:inline-size}
    #mtal-mk .hs-pk{cursor:pointer}
    #mtal-mk .hs-pk:hover .mkc{border-color:#4a4f66}
    #mtal-mk .hs-pk.on .mkc{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .hs-pk .mkc-side{gap:4px}
    #mtal-mk #hs-list{display:flex;flex-direction:column;gap:6px}
    #mtal-mk .hs-row{display:grid;grid-template-columns:40px minmax(0,1fr) 150px;align-items:center;gap:12px;padding:6px 12px 6px 8px;background:#1a1e30;border:1px solid #232840;border-radius:8px;cursor:pointer}
    #mtal-mk .hs-row:hover{border-color:#4a4f66}
    #mtal-mk .hs-row.on{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .hs-th{width:40px;height:40px;display:grid;place-items:center}
    #mtal-mk .hs-th img{max-width:40px;max-height:40px}
    #mtal-mk .hs-name{font-size:12.5px;font-weight:600;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-mk .hs-sub{font-size:11px;color:#9aa0b8}
    #mtal-mk .hs-tag{padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;white-space:nowrap}
    #mtal-mk .hs-tag.buy{background:#1d2a45;color:#7aa2ff}
    #mtal-mk .hs-tag.sell{background:#1d3325;color:#61f6a4}
    #mtal-mk .hs-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
    #mtal-mk .hs-pk .mkc-side{align-items:flex-end}
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
    .mtal-d-fee{margin:6px 0 2px;font-size:11px;color:#c7cbe0}
    .mtal-d-fee b{color:#f0d78c}
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
    #mtal-mk .mki{display:grid;grid-template-columns:48px minmax(120px,200px) minmax(0,1fr) auto;grid-template-areas:"sp id boxes side";align-items:center;gap:14px;padding:10px 12px;background:#1a1e30;border:1px solid #232840;border-radius:10px;white-space:normal;cursor:pointer}
    #mtal-mk .mkc-row:hover .mki,#mtal-mk .sl-ik:hover .mki,#mtal-mk .hs-pk:hover .mki{border-color:#4a4f66}
    #mtal-mk .mkc-row.on .mki,#mtal-mk .sl-ik.on .mki,#mtal-mk .hs-pk.on .mki{border-color:#c7cbe0;background:#1e2336}
    #mtal-mk .mki-sp{width:44px;height:44px;display:grid;place-items:center}
    #mtal-mk .mki-sp img{max-width:40px;max-height:40px;image-rendering:pixelated}
    #mtal-mk .mki-id{min-width:0}
    #mtal-mk .mki-name{font-size:13px;font-weight:700;color:#f2ead0;line-height:1.2;overflow-wrap:anywhere}
    #mtal-mk .mki-tags{margin-top:4px}
    #mtal-mk .mki-npc{padding:1px 8px;border-radius:999px;background:#1d3325;color:#61f6a4;font-size:9.5px;font-weight:700}
    #mtal-mk .mki-sub{margin-top:4px;font-size:10.5px;color:#7c829c}
    #mtal-mk .mki-boxes{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}
    #mtal-mk .mki-box{display:flex;flex-direction:column;min-width:0;padding:6px 10px;background:#161927;border:1px solid #232840;border-radius:8px}
    #mtal-mk .mki-box span{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7c829c}
    #mtal-mk .mki-box b{font-size:12.5px;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #mtal-mk .mki-box b.gold{color:#f0d78c}
    #mtal-mk .mki-box b.dia{color:#55d6f0}
    #mtal-mk .mki .mkc-side{grid-area:auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
    #mtal-mk .mki-list{display:flex;flex-direction:column;gap:8px}
    #mtal-mk .mki-sp{grid-area:sp}
    #mtal-mk .mki-id{grid-area:id}
    #mtal-mk .mki-boxes{grid-area:boxes}
    #mtal-mk .mki > .mkc-side{grid-area:side;min-width:90px}
    @container (max-width: 720px){
      #mtal-mk .mki{grid-template-columns:44px minmax(0,1fr) auto;grid-template-areas:"sp id side" "boxes boxes boxes";gap:10px 12px}
      #mtal-mk .mki-boxes{grid-template-columns:repeat(3,minmax(0,1fr))}
    }
    #mtal-mk .sl-ik{cursor:pointer}
    #mtal-mk .npc-have{display:block;margin-top:2px;font-size:10.5px;color:#9aa0b8}
    #mtal-mk .npc-have b{color:#61f6a4}
    #mtal-mk .npc-have.zero b{color:#7c829c}
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

      <button
        id="mtal-fab-mk"
        title="Abrir o Mercado"
      >
        🏪
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
            id="mtal-pip"
            title="Destacar: abre o LiveSearch numa janela flutuante que fica por cima de tudo (pode ir para fora do navegador)"
          >
            ⧉
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
        <span class="mtal-fw"><span>$ <b id="mtal-fgold">-</b></span><span>💎 <b id="mtal-fdia">-</b></span></span>
        <span class="mtal-fv"><span id="mtal-ver">Version ${VERSION}</span><a id="mtal-upd" hidden target="_blank" rel="noopener"></a></span>
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

          <div class="mk-fgroup mk-stone" hidden>
            <div class="mk-flabel">Tipo de stone</div>
            <div class="mk-chips mk-stonechips" id="mk-stonechips"></div>
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

  function lsItemCard(h, time, purchased) {
    const r = h.raw || {};
    const qty = h.quantity != null ? h.quantity : 1;
    const dia = h.currency === 'DIAMONDS' || h.currency === 'DIAMOND';
    const cur = dia ? '💎' : '$';
    const npc = r.npcPrice != null ? r.npcPrice : null;
    const total = h.price != null ? h.price * qty : null;

    return `<div class="mtal-hit lsp lsi" data-hid="${h.hid}">
      <div class="lsp-sp">
        <div class="mtal-hit-thumb" data-hid="${h.hid}">${thumbHtml(h)}</div>
        <div class="mtal-hit-date">${time}</div>
      </div>

      <div class="lsp-id">
        <div class="mtal-hit-name" title="${esc(h.name || '')}">${esc(h.name || '-')}</div>
        ${h.belowNpc ? '<div class="lsi-tags"><span class="lsi-npc">abaixo do NPC</span></div>' : ''}
        ${npc != null ? `<div class="lsi-alert">NPC paga $ ${fmt(npc)}/un</div>` : ''}
      </div>

      <div class="lsp-block lsi-block">
        <div class="lsi-box"><span>Quantidade</span><b>${fmt(qty)}×</b></div>
        <div class="lsi-box"><span>Preço/un</span><b class="${dia ? 'dia' : 'gold'}">${h.offerOnly ? 'oferta' : cur + ' ' + fmt(h.price || 0)}</b></div>
        <div class="lsi-box"><span>${purchased ? 'Pago' : 'Total'}</span><b class="${dia ? 'dia' : 'gold'}">${h.offerOnly || total == null ? '-' : cur + ' ' + fmt(total)}</b></div>
      </div>

      <div class="mtal-hit-actions lsp-acts">
        <button type="button" class="mtal-view${purchased ? ' mtal-view-p' : ''}${h.hid === detailsHid ? ' active' : ''}" data-hid="${h.hid}" title="Detalhes">${EYE_SVG}</button>
        ${!purchased && h.buyable ? `<button type="button" class="mtal-buy" data-hid="${h.hid}" title="Comprar">🛒</button>` : ''}
      </div>
    </div>`;
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
          ? `<button type="button" class="mtal-view mtal-view-p${h.hid === detailsHid ? ' active' : ''}" data-hid="${h.hid}" title="Detalhes">${EYE_SVG}</button>`
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
              (h) => (h.kind === 'pokemon' ? lsPokeCard(h, t(h.t)) : lsItemCard(h, t(h.t)))
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
              (h) => (h.kind === 'pokemon' ? lsPokeCard(h, t(h.purchasedAt || h.t), true) : lsItemCard(h, t(h.purchasedAt || h.t), true))
            )
            .join('')
        : `
          <div class="mtal-emptycard">
            <div class="ic">🛒</div>
            <b>Nenhuma compra ainda</b>
            <p>Tudo o que você comprar pelo LiveSearch — no 🛒 dos achados ou pela compra automática ⚡ — fica guardado aqui.</p>
            ${hits.length ? `<button type="button" class="mtal-primary" data-goto-hits>Ver achados (${hits.length})</button>` : '<small>Crie um alerta e ative a compra automática para comprar sem precisar clicar.</small>'}
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

  async function pipOpen() {
    if (pip.win) {
      pip.win.close();
      return;
    }

    const api = PW.documentPictureInPicture || window.documentPictureInPicture;

    if (!api) return toast('Seu navegador não suporta janela flutuante (use Chrome, Edge ou Brave atualizados).');

    let w;

    try {
      w = await api.requestWindow({ width: 660, height: 820 });
    } catch (e) {
      return toast('Não consegui abrir a janela flutuante: ' + ((e && e.message) || e));
    }

    const panel = $('mtal-panel');
    const home = panel.parentNode;

    [...document.head.querySelectorAll('style, link[rel="stylesheet"]')].forEach((n) => w.document.head.appendChild(n.cloneNode(true)));

    const st = w.document.createElement('style');

    st.textContent = `
      html,body{margin:0;height:100%;background:#12141f}
      body.mtal-pipbody #mtal-panel{position:static!important;display:flex!important;flex-direction:column;width:auto!important;height:100vh!important;max-height:none!important;left:auto!important;top:auto!important;bottom:auto!important;border:none!important;border-radius:0!important;box-shadow:none!important}
      body.mtal-pipbody #mtal-panel-head{max-height:calc(100vh - 34px)!important}
      body.mtal-pipbody #mtal-drag-handle{cursor:default}
      body.mtal-pipbody #mtal-details{position:fixed!important;right:0!important;left:auto!important;top:0!important;bottom:0!important;height:auto!important;max-height:none!important;width:320px!important;border-radius:0!important}
      body.mtal-pipbody #mtal-pip{background:#e8eaf2;color:#12141f}`;
    w.document.head.appendChild(st);
    w.document.title = 'Poke Idle · LiveSearch';
    w.document.body.className = 'mtal-pipbody';
    w.document.body.appendChild(panel);
    panel.style.display = 'block';
    panelOpen = true;

    pip.win = w;
    pip.doc = w.document;
    pip.home = home;

    w.addEventListener('pagehide', () => {
      const d = $('mtal-details');

      pip.home.appendChild(panel);

      if (d && d.ownerDocument !== document) document.body.appendChild(d);

      pip.win = null;
      pip.doc = null;
      panel.style.display = panelOpen ? 'block' : 'none';
    });
  }

  $('mtal-pip').addEventListener('click', pipOpen);

  $('mtal-close')
    .addEventListener(
      'click',
      () => {
        panelOpen = false;

        if (pip.win) {
          pip.win.close();
        }

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
        if (e.target.closest('[data-goto-hits]')) {
          const tb = qa('.mtal-tab:not([data-tab="purchased"])')[0];

          if (tb) tb.click();

          return;
        }

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

          qa(
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
    stones: new Set(),
    mode: 'buy',
    view: store.get('mkView', 'list')
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#mk-stonechips [data-stone]');

    if (!b) return;

    const t = b.dataset.stone;

    if (mk.stones.has(t)) mk.stones.delete(t);
    else mk.stones.add(t);

    mkRender();
  });

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
    [mk.cat, f.speciesId, f.ivMin, mkSrvQ(f)].join('|');

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

  // qualidade mínima enviada ao servidor: a maior entre o campo "×" e a menor raridade marcada
  function mkSrvQ(f) {
    let q = f.qMin || 0;

    if (mk.rar.size) {
      const mins = QUALITY_TIERS.filter(([, l]) => mk.rar.has(l)).map(([t]) => t);

      if (mins.length) q = Math.max(q, Math.min(...mins));
    }

    return q > 0 ? q : null;
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
          if (mkSrvQ(f)) q += '&qMin=' + mkSrvQ(f);
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
    if (mkVisible().length >= 40 || mk.page > 120) return;

    mkAutoT = setTimeout(() => mkLoad(false), 200);
  }

  const stoneType = (n) => String(n || '').replace(/\s*stone\s*$/i, '').trim() || String(n || '');

  const STONE_COLOR = {
    thunder: 'electric', leaf: 'grass', heart: 'fairy', earth: 'ground', venom: 'poison', punch: 'fighting',
    cocoon: 'bug', crystal: 'dragon', enigma: 'psychic', metal: 'steel', feather: 'flying', darkness: 'dark', ancient: 'rock'
  };

  function mkStoneChips() {
    const el = $('mk-stonechips');

    if (!el) return;

    const types = [...new Set(mk.rows.filter((h) => h.kind !== 'pokemon').map((h) => stoneType(h.name)))].sort((a, b) => a.localeCompare(b));

    el.innerHTML =
      types
        .map((t) => {
          const k = t.toLowerCase();
          const c = TYPE_COLOR[k] || TYPE_COLOR[STONE_COLOR[k]] || '#c7cbe0';

          return `<button type="button" class="mk-chip${mk.stones.has(t) ? ' on' : ''}" data-stone="${esc(t)}" style="color:${c}">${esc(t)}</button>`;
        })
        .join('') || '<span class="mk-dim">Carregando…</span>';
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

      if (mk.cat === 'Stones' && mk.stones.size && !mk.stones.has(stoneType(h.name))) return false;

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

  // card horizontal de item no mercado (mesmo estilo do LiveSearch)
  function mkItemCard(h, boxes, side) {
    const r = h.raw || {};
    const npc = r.npcPrice != null ? r.npcPrice : null;

    return `<div class="mki">
      <div class="mki-sp mtal-hit-thumb" data-hid="${h.hid}">${thumbHtml(h)}</div>
      <div class="mki-id">
        <div class="mki-name">${esc(h.name || '-')}</div>
        ${h.belowNpc ? '<div class="mki-tags"><span class="mki-npc">abaixo do NPC</span></div>' : ''}
        ${npc != null ? `<div class="mki-sub">NPC paga $ ${fmt(npc)}/un</div>` : ''}
      </div>
      <div class="mki-boxes">${boxes
        .filter(Boolean)
        .map(([l, v, c]) => `<div class="mki-box"><span>${l}</span><b class="${c || ''}">${v}</b></div>`)
        .join('')}</div>
      ${side || ''}
    </div>`;
  }

  const mkCurTxt = (p, cur) => ((cur === 'DIAMONDS' || cur === 'DIAMOND') ? '💎 ' : '$ ') + fmt(p || 0);
  const mkCurCls = (cur) => (cur === 'DIAMONDS' || cur === 'DIAMOND' ? 'dia' : 'gold');

  function mkItemBuyCard(h) {
    const qty = h.quantity != null ? h.quantity : 1;

    return mkItemCard(
      h,
      [
        ['Quantidade', fmt(qty) + '×'],
        ['Preço/un', h.offerOnly ? 'oferta' : mkCurTxt(h.price, h.currency), mkCurCls(h.currency)],
        ['Total', h.offerOnly ? '-' : mkCurTxt((h.price || 0) * qty, h.currency), mkCurCls(h.currency)]
      ],
      `<div class="mkc-side"><div class="mk-acts">${h.buyable ? `<button type="button" class="mk-buy" data-hid="${h.hid}" title="Comprar">Comprar</button>` : ''}</div></div>`
    );
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
    document.querySelectorAll('#mtal-mk .mk-stone').forEach((el) => (el.hidden = mk.cat !== 'Stones'));

    if (mk.cat === 'Stones') mkStoneChips();

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
        : `<th colspan="8" class="mkc-bar"><div class="mkc-barin"><span>Ordenar: ${sb('Preço', 'price')}${sb('Quantidade', 'qty')}</span></div></th>`) +
      '</tr>';

    const rows = mkVisible();

    $('mk-tbody').parentElement.classList.toggle('mkc-table', true);

    $('mk-tbody').innerHTML =
      rows
        .map((h) => {
          const img = `<td class="mk-img"><div class="mtal-hit-thumb mk-thumb" data-hid="${h.hid}">${thumbHtml(h)}</div></td>`;
          const price = `<td class="mk-price">${esc(hitPrice(h))}</td>`;
          const acts = `<td class="mk-acts">
            ${h.buyable ? `<button type="button" class="mk-buy" data-hid="${h.hid}" title="Comprar">🛒</button>` : ''}
          </td>`;

          if (h.kind !== 'pokemon') {
            return `<tr class="mtal-mkrow mkc-row" data-hid="${h.hid}"><td colspan="8">${mkItemBuyCard(h)}</td></tr>`;
          }

          if (mk.cat === 'all') {
            return `<tr class="mtal-mkrow mkc-row" data-hid="${h.hid}"><td colspan="8">${mkPokeCard(h)}</td></tr>`;
          }

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

    rows.filter((h) => !(h.kind === 'pokemon' && rpSprite(h, rpCreature(h)))).forEach(ensureSprite);

    if (mk.cat === 'all' && !rpCre && rows.some((h) => h.kind === 'pokemon')) {
      rpLoadCreatures().then((ok) => ok && mk.cat === 'all' && mkRender());
    }

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
    if (wallet.dia != null) store.set('lastDia', wallet.dia);
    else if (store.get('lastDia', null) != null) wallet.dia = store.get('lastDia', null);

    if ($('mk-gold')) $('mk-gold').textContent = wallet.gold != null ? fmt(wallet.gold) : '-';
    if ($('mtal-fgold')) $('mtal-fgold').textContent = wallet.gold != null ? fmt(wallet.gold) : '-';
    if ($('mtal-fdia')) $('mtal-fdia').textContent = wallet.dia != null ? fmt(wallet.dia) : '-';
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

    const dw = store.get('diaWsReq', null);

    if (dw && wsSt.sock && wsSt.sock.readyState === 1) {
      try {
        wsSt.sock.send(dw);
      } catch (e) {}
    }

    const ds = store.get('diaSrc', null);

    if (ds) {
      try {
        const d0 = wallet.dia;

        wallet.dia = null;
        walletScan(await gameGet(ds), 0);

        if (wallet.dia == null) wallet.dia = d0;
      } catch (e) {}
    }

    try {
      const dd = await gameGet('/api/game/diamonds');

      if (dd && typeof dd.diamonds === 'number') wallet.dia = dd.diamonds;
    } catch (e) {}

    walletRender();
  }

  let walletT = null;

  setTimeout(() => {
    try {
      walletRefresh();
    } catch (e) {}
  }, 4000);
  setInterval(() => {
    try {
      if (panelOpen && $('mtal-mk').style.display !== 'flex') walletRefresh();
    } catch (e) {}
  }, 30000);

  function mkOpen() {
    $('mtal-mk').style.display = 'flex';

    walletRefresh();
    clearInterval(walletT);
    walletT = setInterval(() => {
      if ($('mtal-mk').style.display === 'none') return clearInterval(walletT);

      walletRefresh();
    }, 20000);

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
  $('mtal-fab-mk').addEventListener('click', mkOpen);
  $('mk-close').addEventListener('click', mkClose);
  $('mk-refresh').addEventListener('click', () => {
    if (mk.mode === 'buy') return mkLoad(true);
    if (mk.mode.startsWith('npc:')) return npcLoad(mk.mode.slice(4));

    slLoad();

    if (mk.mode === 'sell' && sl.kind === 'item') slEnsureOwned(true);
  });
  $('mk-more').addEventListener('click', () => mkLoad(false));

  document.querySelector('#mtal-mk .mk-table-wrap').addEventListener(
    'scroll',
    (e) => {
      const el = e.currentTarget;

      if (mk.cat === 'pokemon' && !mk.loading && !mk.done && el.scrollTop + el.clientHeight > el.scrollHeight - 300) mkLoad(false);
    },
    { passive: true }
  );

  document.querySelectorAll('#mtal-mk .mk-cat').forEach((b) =>
    b.addEventListener('click', () => {
      if (mk.cat === b.dataset.cat) return;

      mk.cat = b.dataset.cat;
      mk.stones.clear();
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

    if (mk.cat === 'pokemon' && mkServerKey(mkFilters()) !== mk.key) {
      mkLoad(true);
    } else {
      mkRender();
      mkAutoMore();
    }
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
    mk.stones.clear();
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
      mine: true,
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

  const feeInfo = () => store.get('mkFee', null);

  async function goldNow() {
    try {
      const d = await gameGet('/api/game/shop');

      return d && typeof d.gold === 'number' ? d.gold : null;
    } catch (e) {
      return null;
    }
  }

  function feeLearn(g0, g1, price, cur, qty) {
    if (g0 == null || g1 == null || cur !== 'GOLD') return;

    const paid = g0 - g1;
    const total = price * (qty || 1);

    if (!(paid > 0) || !(total > 0) || paid > total * 0.5) return;

    const rate = Math.round((paid / total) * 10000) / 10000;

    store.set('mkFee', { rate, t: Date.now(), paid, total });
    log('taxa de anúncio medida:', paid, 'de', total, '=', rate * 100 + '%');
  }

  function feeRender(price, cur, qty) {
    const el = $('mtal-d-fee');

    if (!el) return;

    const f = feeInfo();
    const total = (price || 0) * (qty || 1);

    if (!f) {
      el.innerHTML = '<span class="mk-dim">Taxa de anúncio: será medida no seu próximo anúncio em $.</span>';
      return;
    }

    const pct = (f.rate * 100).toFixed(f.rate * 100 % 1 ? 1 : 0) + '%';

    el.innerHTML = `Taxa de anúncio (${pct}): <b>${cur === 'DIAMONDS' ? '💎' : '$'} ${total > 0 ? fmt(Math.ceil(total * f.rate)) : '—'}</b>`;
  }

  // "editar" = cancelar e anunciar de novo com o novo preço
  async function slReprice(h, price, cur, btn) {
    const l = h.raw || {};

    if (!(price > 0)) return toast('Preço inválido.');
    if (!confirm('Atualizar ' + h.name + ' para ' + fmt(price) + ' ' + curLabel(cur) + (h.kind === 'pokemon' ? '' : '/un') + '?\n\nO anúncio atual será cancelado e criado de novo' + (feeInfo() ? ' (paga a taxa de novo).' : '.'))) return;

    if (btn) btn.disabled = true;

    const g0 = await goldNow();

    try {
      await mkAction({ action: 'cancel', id: l.id });
    } catch (e) {
      if (btn) btn.disabled = false;

      return toast('Erro ao cancelar: ' + ((e && e.message) || e));
    }

    let ok = false;
    let lastErr = null;

    for (let i = 0; i < 4 && !ok; i++) {
      await sleep(500 + i * 700);

      try {
        let body;

        if (h.kind === 'pokemon') {
          let cid = l.capturedId || l.pokeId || l.pokemonId;

          if (!cid) {
            try {
              await wsSend({ type: 'pokes-get' }, ['pokes'], 3000);
            } catch (e) {}

            const all = allPokes();
            const m = all.find(
              (p) =>
                +p.speciesId === +l.speciesId &&
                (l.level == null || p.level === l.level) &&
                (l.ivTotal == null || p.ivTotal === l.ivTotal) &&
                (l.quality == null || Math.abs(Number(p.quality) - Number(l.quality)) < 0.001) &&
                !p.team
            );

            cid = m && m.id;
          }

          if (!cid) throw new Error('não achei o Pokémon de volta no depósito');

          body = { action: 'sell-pokemon', capturedId: cid, price, currency: cur };
        } else {
          body = { action: 'sell', kind: l.kind, refId: l.refId, quantity: l.quantity || h.quantity || 1, price, currency: cur };
        }

        await mkAction(body);
        ok = true;
      } catch (e) {
        lastErr = e;
      }
    }

    if (ok) {
      feeLearn(g0, await goldNow(), price, cur, h.kind === 'pokemon' ? 1 : l.quantity || 1);
      toast('Anúncio atualizado: ' + h.name + ' → ' + fmt(price) + ' ' + curLabel(cur));

      if (detailsAnchor === 'mtal-mk') hideDetails();
    } else {
      toast('⚠ O anúncio foi cancelado, mas não consegui anunciar de novo: ' + ((lastErr && lastErr.message) || lastErr) + '. O item voltou para você.');
    }

    if (btn) btn.disabled = false;

    slLoad();
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

    const g0 = cur === 'GOLD' ? await goldNow() : null;

    try {
      await mkAction(body);

      toast('Anunciado: ' + msg);

      if (g0 != null) goldNow().then((g1) => feeLearn(g0, g1, price, cur, body.quantity || 1));

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
              <div class="mk-price"></div>
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
    } else if (list && !poke) {
      html = `<div class="mki-list">${cards
        .map((c) => {
          const key = slKey(c);
          const h = { hid: ++hitSeq, kind: 'items', name: c.title || c.name, raw: { icon: c.icon, npcPrice: c.npcPrice } };

          pseudo.push(h);

          return `<div class="sl-ik${key === sl.sel ? ' on' : ''}" data-key="${esc(key)}">${mkItemCard(
            h,
            [['Você tem', fmt(c.owned) + '×'], c.npcPrice != null ? ['NPC paga', '$ ' + fmt(c.npcPrice), 'gold'] : null, c.npcPrice != null ? ['Total NPC', '$ ' + fmt(c.npcPrice * c.owned), 'gold'] : null],
            '<div class="mkc-side"><div class="mk-acts"><button type="button">Anunciar</button></div></div>'
          )}</div>`;
        })
        .join('')}</div>`;
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
        const net = (cur) =>
          dayItems.filter((y) => (y.currency === 'DIAMONDS' || y.currency === 'DIAMOND' ? 'D' : 'G') === cur).reduce((a, y) => a + (y.bought ? -1 : 1) * (y.price || 0), 0);
        const sg = net('G');
        const sd = net('D');
        const hasD = dayItems.some((y) => y.currency === 'DIAMONDS' || y.currency === 'DIAMOND');
        const hasG = dayItems.some((y) => !(y.currency === 'DIAMONDS' || y.currency === 'DIAMOND'));
        const fm = (v, icon) => `<b class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${icon} ${fmt(Math.abs(v))}</b>`;

        html += `<div class="hs-day"><span>${esc(day)}</span><small>${dayItems.length} ${dayItems.length === 1 ? 'transação' : 'transações'}</small><em class="hs-dbal">${[
          hasG ? fm(sg, '$') : '',
          hasD ? fm(sd, '💎') : ''
        ]
          .filter(Boolean)
          .join('<i>·</i>')}</em></div>`;
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

      if (h.kind === 'pokemon') {
        html += `<div class="hs-pk" data-hi="${all.indexOf(x)}">${mkPokeCard(
          h,
          `<div class="mkc-side">
            <span class="hs-tag ${x.bought ? 'buy' : 'sell'}">${x.bought ? 'Compra' : 'Venda'}${x.offer ? ' · oferta' : ''}</span>
            <div class="mk-price ${x.bought ? 'neg' : 'pos'}">${x.bought ? '−' : '+'}${esc(priceTxt2(x.price || 0, x.currency))}</div>
            <small class="mk-dim">${x.at ? esc(new Date(x.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) : ''}</small>
          </div>`
        )}</div>`;

        return;
      }

      const qtyH = x.amount != null ? x.amount : 1;

      html += `<div class="hs-pk" data-hi="${all.indexOf(x)}">${mkItemCard(
        h,
        [
          ['Quantidade', fmt(qtyH) + '×'],
          ['Preço', mkCurTxt(x.price || 0, x.currency), mkCurCls(x.currency)]
        ],
        `<div class="mkc-side">
          <span class="hs-tag ${x.bought ? 'buy' : 'sell'}">${x.bought ? 'Compra' : 'Venda'}${x.offer ? ' · oferta' : ''}</span>
          <div class="mk-price ${x.bought ? 'neg' : 'pos'}">${x.bought ? '−' : '+'}${esc(priceTxt2(x.price || 0, x.currency))}</div>
          <small class="mk-dim">${x.at ? esc(new Date(x.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) : ''}</small>
        </div>`
      )}</div>`;


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

          if (h.kind === 'pokemon') {
            return `<tr class="mtal-mkrow mkc-row sl-row" data-mh="${h.hid}"><td colspan="6">${mkPokeCard(
              h,
              `<div class="mkc-side">
                <div class="mk-price">${esc(hitPrice(h))}</div>
                <div class="mk-acts">
                  <button type="button" data-act="reprice" data-hid="${h.hid}" title="Alterar preço">✎</button>
                  <button type="button" data-act="cancel" data-hid="${h.hid}" title="Cancelar anúncio">✕</button>
                </div>
              </div>`
            )}</td></tr>`;
          }

          if (h.kind !== 'pokemon') {
            const qty = h.quantity != null ? h.quantity : 1;

            return `<tr class="mtal-mkrow mkc-row sl-row" data-mh="${h.hid}"><td colspan="6">${mkItemCard(
              h,
              [
                ['Quantidade', fmt(qty) + '×'],
                ['Preço/un', mkCurTxt(h.price, h.currency), mkCurCls(h.currency)],
                ['Total', mkCurTxt((h.price || 0) * qty, h.currency), mkCurCls(h.currency)]
              ],
              `<div class="mkc-side">
                <small class="mk-dim">${h.raw.at ? esc(new Date(h.raw.at).toLocaleString('pt-BR')) : ''}</small>
                <div class="mk-acts">
                  <button type="button" data-act="reprice" data-hid="${h.hid}" title="Alterar preço">✎</button>
                  <button type="button" data-act="cancel" data-hid="${h.hid}" title="Cancelar anúncio">✕</button>
                </div>
              </div>`
            )}</td></tr>`;
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
        const tr = b.closest('tr[data-mh]');

        document.querySelectorAll('#sl-mine tr[data-mh]').forEach((r) => r.classList.toggle('on', r === tr));
        showDetails(h, 'mtal-mk');
        setTimeout(() => {
          const sp = $('mtal-d-sprice');

          if (sp) {
            sp.focus();
            sp.select();
          }
        }, 30);

        return;
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

        try {
          const mm = await api('?category=Pokemon');

          npcSt.data.mine = (mm && mm.mine) || [];
        } catch (e) {}

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

  function npcMine() {
    const m = npcSt.data.mine || sl.mine || [];

    return {
      items: new Set(m.filter((l) => l && l.kind !== 'pokemon' && !l.capturedId && l.refId != null).map((l) => String(l.refId))),
      pokes: new Set(m.filter((l) => l && l.capturedId != null).map((l) => String(l.capturedId)))
    };
  }

  const pokeListed = (p, M) => !!(p.listed || p.onMarket || p.inMarket || p.forSale || p.isListed || M.pokes.has(String(p.id)));

  function shopPokeSell() {
    askPokes();

    const all = allPokes();

    if (!all.length) return '<div class="mk-empty">Carregando seus Pokémon…</div>';

    const M = npcMine();
    const list = npcPokeFilter(all.filter((p) => !p.team && p.sellValue > 0 && !pokeListed(p, M)));
    const sel = npcSt.pokeSel || (npcSt.pokeSel = new Set());

    [...sel].forEach((id) => {
      if (!all.some((p) => p.id === id && !p.team && !pokeListed(p, M))) sel.delete(id);
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
      <div class="mk-dim npc-note">Pokémon do time e os anunciados no mercado não aparecem aqui. Clique na linha para marcar.</div>`
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

      const invShop = (npcSt.data.depot && npcSt.data.depot.inventory) || [];
      const haveOf = (x, isBall) => {
        if (isBall) {
          const c = wsSt.ballCounts;

          return c ? +(c[x.id] || c[String(x.id)] || 0) : null;
        }

        const it = invShop.find((y) => y.id === x.id) || ((ownedCache && ownedCache.list) || []).find((y) => y.itemId === x.id);

        return it ? it.quantity : npcSt.data.depot ? 0 : null;
      };
      const haveTxt = (x, isBall) => {
        const n = haveOf(x, isBall);

        return n == null ? '' : `<span class="npc-have${n ? '' : ' zero'}">Você tem <b>${fmt(n)}</b></span>`;
      };

      const sell = (x, isBall) =>
        npcCard(iconUrl(x.iconUrl || x.icon), x.name, '$ ' + fmt(x.priceGold) + haveTxt(x, isBall), () =>
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

                const got = +(r.bought || q);

                if (isBall) {
                  const c = wsSt.ballCounts;

                  if (c) c[x.id] = +(c[x.id] || c[String(x.id)] || 0) + got;
                } else if (npcSt.data.depot) {
                  const inv = npcSt.data.depot.inventory || (npcSt.data.depot.inventory = []);
                  const it = inv.find((y) => y.id === x.id);

                  if (it) it.quantity += got;
                  else inv.push({ id: x.id, name: x.name, quantity: got });
                }

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
              const listedI = npcMine().items;
              const list = inv.filter((x) => x.npcPrice > 0 && !locked.has(x.id) && !listedI.has(String(x.id)) && !isBlocked(x.name));
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
                <div class="mk-dim npc-note">Itens travados no jogo, anunciados no mercado e os da lista "Nunca vender" ficam de fora. Clique no item para vender só uma parte.</div>`;
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

  /* ---------- DAILY KILL (card fixo embaixo, no centro) — código do antigo script "Poke Idle - Daily Kill" ---------- */
  // Os ganchos de fetch/WebSocket do LiveSearch chamam estas três; elas repassam para o bloco abaixo.
  const DKX = {};
  const DK_LS_STORE = store;

  function dkLoad() {
    return DKX.load ? DKX.load() : undefined;
  }

  function dkSet(d) {
    if (DKX.set) DKX.set(d);
  }

  function dkKill(j) {
    if (DKX.kill) DKX.kill(j);
  }

  (() => {

    /* ---------- utilitários ---------- */
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Number(n).toLocaleString('pt-BR');
    const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
    const pick = (obj, keys) => {
      for (const k of keys) {
        if (obj && obj[k] != null && obj[k] !== '') return obj[k];
      }

      return null;
    };
    const iconUrl = (v) => (!v ? '' : /^(\/|https?:|data:)/i.test(String(v)) ? v : '/assets/items/' + v);
    const rpTextOn = (hex) => {
      const n = parseInt(String(hex).slice(1), 16);
      const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);

      return l > 140 ? '#15171f' : '#fff';
    };
    const log = (...a) => console.log('%\x63[DailyKill]', 'color:#e0b95a;font-weight:bold', ...a);

    // localStorage pode estar cheio: memória primeiro, grava quando der.
    const mem = new Map();
    const store = {
      get(k, d) {
        if (mem.has(k)) return mem.get(k);

        for (const S of [localStorage, sessionStorage]) {
          try {
            const v = S.getItem('dk_' + k);

            if (v != null) {
              const j = JSON.parse(v);

              mem.set(k, j);

              return j;
            }
          } catch (e) {}
        }

        return d;
      },
      set(k, v) {
        mem.set(k, v);

        const txt = JSON.stringify(v);

        for (const S of [localStorage, sessionStorage]) {
          try {
            S.setItem('dk_' + k, txt);

            return;
          } catch (e) {}
        }
      }
    };

    function toast(msg) {
      log(msg);

      const d = document.createElement('div');

      d.textContent = msg;
      d.style.cssText =
        'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:2147483647;background:#1a1a2e;color:#f0d78c;border:1px solid #c9a44a;padding:8px 12px;border-radius:8px;font:12px Inter,sans-serif;max-width:320px';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 4500);
    }

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

    const RP_TYPE_PT = {
      normal: 'Normal', fire: 'Fogo', water: 'Água', electric: 'Elétrico', grass: 'Planta', ice: 'Gelo',
      fighting: 'Lutador', poison: 'Veneno', ground: 'Terra', flying: 'Voador', psychic: 'Psíquico', bug: 'Inseto',
      rock: 'Pedra', ghost: 'Fantasma', dragon: 'Dragão', dark: 'Sombrio', steel: 'Aço', fairy: 'Fada'
    };

    /* ---------- API do jogo (token da sessão) ---------- */
    const tokens = () => {
      try {
        return JSON.parse(sessionStorage.getItem('pokeweb:tokens') || 'null');
      } catch (e) {
        return null;
      }
    };

    async function req(path, opt = {}) {
      const send = (t) =>
        NF(path, {
          ...opt,
          headers: { ...(opt.body ? { 'content-type': 'application/json' } : {}), ...(t ? { authorization: 'Bearer ' + t } : {}) }
        });
      let r = await send(tokens() && tokens().accessToken);

      if (r.status === 401 && tokens() && tokens().refreshToken) {
        const rr = await NF('/api/auth/refresh', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens().refreshToken })
        });

        if (rr.ok) {
          const j = await rr.json();

          if (j && j.accessToken) {
            sessionStorage.setItem('pokeweb:tokens', JSON.stringify(j));
            r = await send(j.accessToken);
          }
        }
      }

      const data = await r.json().catch(() => null);

      if (!r.ok || (data && data.ok === false)) throw new Error((data && (data.error || data.message)) || 'HTTP ' + r.status);

      return data;
    }

    const gameGet = (path) => req(path);
    const gamePost = (path, body) => req(path, { method: 'POST', body: JSON.stringify(body) });

    /* ---------- ganchos: dentro do LiveSearch, os ganchos de fetch/WebSocket do próprio LiveSearch
       chamam dkLoad/dkSet/dkKill (ligados abaixo em DKX); aqui só usamos o fetch da página ---------- */
    const NF = (...a) => PW.fetch(...a);

    /* ---------- estilos ---------- */
    const CSS = `
      #pdk-root{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483640;font:12px/1.35 Inter,sans-serif;color:#e8e3d0}
      #pdk-root .pdk-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:180px;box-sizing:border-box;padding:10px 12px 12px;background:linear-gradient(180deg,#1b1f31,#12141f);border:1px solid #3a4060;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.55);cursor:pointer;text-align:center}
      #pdk-root .pdk-card:hover{border-color:#8b93b8}
      #pdk-root .pdk-card.pdk-q{border-color:#c9a44a;animation:dkPulse 2.2s ease-in-out infinite}
      #pdk-root .pdk-card.pdk-full{border-color:#61f6a4}
      @keyframes dkPulse{0%,100%{box-shadow:0 10px 28px rgba(0,0,0,.55)}50%{box-shadow:0 0 0 5px rgba(240,215,140,.16),0 10px 28px rgba(0,0,0,.55)}}
      #pdk-root .pdk-hd{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:18px}
      #pdk-root .pdk-hd-r{display:flex;align-items:center;gap:4px}
      #pdk-root .pdk-star{font-style:normal;color:#f0c14b}
      #pdk-root .pdk-mbtn{margin-top:2px;padding:3px 10px;background:transparent;border:none;border-radius:6px;color:#7c829c;font:inherit;font-size:10px;cursor:pointer}
      #pdk-root .pdk-mbtn:hover{color:#e8eaf2;background:#1f2436}
      #pdk-root .pdk-min{width:20px;height:18px;padding:0;background:transparent;border:1px solid transparent;border-radius:5px;color:#7c829c;font-size:11px;cursor:pointer}
      #pdk-root .pdk-min:hover{border-color:#4a4f66;color:#fff}
      #pdk-root .pdk-tier{padding:1px 8px;border:1px solid #6b5a1f;border-radius:999px;background:#2a2410;color:#f0c14b;font-size:10px;font-weight:800;letter-spacing:.03em;white-space:nowrap}
      #pdk-root .pdk-sp{display:grid;place-items:center;width:80%;aspect-ratio:1/1.12;margin:2px 0 4px;border-radius:14px;background:radial-gradient(circle at 50% 40%,#232842,#0d0f18);border:1px solid #2c3148;overflow:hidden}
      #pdk-root .pdk-sp img{width:78%;height:auto;max-height:90%;object-fit:contain;image-rendering:pixelated}
      #pdk-root .pdk-qbox{border-color:#6b5a1f;background:radial-gradient(circle at 50% 40%,#3a3016,#12141f)}
      #pdk-root .pdk-qbox b{font-size:78px;line-height:1;color:#f0c14b;text-shadow:0 0 18px rgba(240,193,75,.45)}
      #pdk-root .pdk-num{font-size:9.5px;color:#7c829c}
      #pdk-root .pdk-name{font-size:12px;color:#f2ead0}
      #pdk-root .pdk-q .pdk-name{font-size:11.5px}
      #pdk-root .pdk-hint{font-size:9.5px;color:#9aa0b8}
      #pdk-root .pdk-types{display:flex;gap:4px;justify-content:center}
      #pdk-root .pdk-xp{font-size:10.5px;font-weight:800;color:#f0c14b}
      #pdk-root .pdk-cnt{font-size:11px;color:#9aa0b8}
      #pdk-root .pdk-cnt em{font-style:normal;font-size:17px;font-weight:800;color:#55d6f0}
      #pdk-root .pdk-bar{width:100%;height:6px;background:#2c3148;border-radius:3px;overflow:hidden}
      #pdk-root .pdk-bar i{display:block;height:100%;background:linear-gradient(90deg,#55d6f0,#61f6a4);border-radius:3px}
      #pdk-root .pdk-rws{display:flex;flex-wrap:wrap;justify-content:center;gap:4px}
      #pdk-root .pdk-rwi{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;background:#1f2436;border:1px solid #2c3148;font-size:10.5px;color:#c7cbe0;white-space:nowrap}
      #pdk-root .pdk-rwi img{width:16px;height:16px;image-rendering:pixelated}
      #pdk-root .pdk-rwi b{color:#f2ead0}
      #pdk-root .pdk-btn{width:100%;margin-top:4px;padding:6px 0;border-radius:8px;background:#232840;border:1px solid #2c3148;color:#9aa0b8;font-size:11px;font-weight:700}
      #pdk-root .pdk-btn.go{background:#e8eaf2;border-color:#e8eaf2;color:#12141f;cursor:pointer}
      #pdk-root .pdk-full .pdk-btn.go{background:#61f6a4;border-color:#61f6a4;color:#0d1a12}
      #pdk-root .pdk-btn.done{background:#1d3325;border-color:#2e7d4f;color:#61f6a4}
      #pdk-root .pdk-card.pdk-mini{width:auto;min-width:0;max-width:380px;padding:7px 12px 7px 7px;gap:4px}
      #pdk-root .pdk-mini .pdk-minfo{flex:0 1 auto;min-width:110px}
      #pdk-root .pdk-mini .pdk-bar{width:100%;min-width:130px;height:4px;margin-top:1px;background:#2e3550}
      #pdk-root .pdk-rdy{color:#61f6a4}
      #pdk-root .pdk-mrow{display:flex!important;flex-direction:row!important;align-items:center!important;gap:10px;width:100%;text-align:left}
      #pdk-root .pdk-msp{flex:none;display:grid;place-items:center;width:58px;height:58px;border-radius:12px;background:radial-gradient(circle at 50% 60%,#232842,#0d0f18);border:1px solid #2c3148;overflow:hidden}
      #pdk-root .pdk-msp img{max-width:56px;max-height:56px;image-rendering:pixelated}
      #pdk-root .pdk-tp{flex:none;align-self:center;width:40px;height:40px;padding:0;display:grid;place-items:center;border-radius:10px;border:1px solid #2c3148;background:#151827;color:#c7cbe0;cursor:pointer}
      #pdk-root,#pdk-root *{translate:none!important}
      #pdk-root .pdk-card,#pdk-root .pdk-card:hover,#pdk-root button,#pdk-root button:hover{transform:none!important;top:auto!important;margin-top:0}
      #pdk-root .pdk-mt{font-size:inherit;color:#7c829c}
      #pdk-root .pdk-mt b{font-weight:700;color:#c7cbe0;font-variant-numeric:tabular-nums}
      #pdk-root .pdk-tp:hover{border-color:#8b93b8;background:#1e2336;color:#fff}
      #pdk-root .pdk-tp.busy{opacity:.5;pointer-events:none}
      #pdk-root .pdk-msp b{font-size:24px;color:#f0c14b}
      #pdk-root .pdk-minfo{flex:1;min-width:0;align-self:center!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:4px;margin:0!important;padding:0!important;line-height:1.2}
      #pdk-root .pdk-minfo > *{margin:0!important}
      #pdk-root .pdk-minfo > b{font-size:12px;color:#f2ead0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #pdk-root .pdk-minfo span{font-size:10.5px;color:#9aa0b8;white-space:nowrap}
      #pdk-root .pdk-minfo em{font-style:normal;font-weight:800;color:#55d6f0}
      #pdk-root .pdk-over{border-color:#2e7d4f}
      #pdk-root .pdk-ok{background:#1d3325;border-color:#2e7d4f;color:#61f6a4;font-size:20px;font-weight:800}
      #pdk-root .pdk-pick{--bg:#0c141b;--row:#121e28;--row2:#172633;--line:#1b2b38;--tx:#e3eaf1;--dim:#768a9c;--xp:#9ec9ff;--ok:#57d38c;
        position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);width:min(720px,94vw);box-sizing:border-box;padding:0;overflow:hidden;
        background:var(--bg);color:var(--tx);border:1px solid #223444;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.6);font:12px/1.35 Inter,Barlow,system-ui,sans-serif}
      #pdk-root .pdk-pick *{box-sizing:border-box}
      #pdk-root .pdk-pick-h{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px;border-bottom:1px solid var(--line)}
      #pdk-root .pdk-pick-h > b{font-size:14px;font-weight:800;color:var(--tx)}
      #pdk-root .pdk-pick .pdk-tier{padding:2px 8px;border:none;border-radius:5px;background:var(--row2);color:var(--tx);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
      #pdk-root .pdk-dim{font-size:11px;color:var(--dim)}
      #pdk-root .pdk-timer{color:var(--tx);font-variant-numeric:tabular-nums}
      #pdk-root .pdk-x{margin-left:auto;width:26px;height:26px;padding:0;background:transparent;border:none;border-radius:6px;color:#b9c8d6;font-size:14px;cursor:pointer}
      #pdk-root .pdk-x:hover{background:var(--row2);color:#fff}

      #pdk-root .pdk-rw{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid var(--line)}
      #pdk-root .pdk-rw > span{margin-right:4px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
      #pdk-root .pdk-rw em{padding:3px 8px;border-radius:6px;background:var(--row);font-style:normal;font-size:11px}
      #pdk-root .pdk-rw em.xp{color:var(--xp);font-weight:700}
      #pdk-root .pdk-pick .pdk-rws{gap:6px}
      #pdk-root .pdk-pick .pdk-rwi{gap:6px;padding:3px 9px 3px 5px;border-radius:7px;background:var(--row);border:1px solid var(--line);font-size:11.5px;color:var(--tx)}
      #pdk-root .pdk-pick .pdk-rwi img{width:20px;height:20px}
      #pdk-root .pdk-pick .pdk-rwi b{color:var(--tx)}

      #pdk-root .pdk-opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px}
      #pdk-root .pdk-opt{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 0 12px;background:var(--row);border:1px solid var(--line);border-radius:10px;text-align:center;overflow:hidden;transition:border-color .12s}
      #pdk-root .pdk-opt:hover{border-color:#2c4658}
      #pdk-root .pdk-opt.on{border-color:var(--ok)}
      #pdk-root .pdk-opt.off{opacity:.45}
      #pdk-root .pdk-opt .pdk-star{position:absolute;top:8px;left:10px;color:var(--ok);font-style:normal}
      #pdk-root .pdk-eff{position:absolute;top:8px;right:8px;z-index:1;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:800;color:var(--dim);background:var(--row2)}
      #pdk-root .pdk-eff.good{color:#08210f;background:var(--ok)}
      #pdk-root .pdk-eff.bad{color:#fff;background:#ef6a6a}
      #pdk-root .pdk-osp{display:grid;place-items:center;width:100%;height:140px;background:radial-gradient(circle at 50% 60%,#18283a 0,transparent 70%)}
      #pdk-root .pdk-osp img{height:112px;width:auto;max-width:90%;object-fit:contain;image-rendering:pixelated}
      #pdk-root .pdk-oname{font-size:14px;font-weight:800;color:var(--tx);padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
      #pdk-root .pdk-pick .pdk-types{gap:4px}
      #pdk-root .pdk-pick .pdk-type{padding:1px 7px;border-radius:4px;font-size:9.5px;font-weight:700;text-transform:none}
      #pdk-root .pdk-ostats{display:grid;grid-template-columns:1fr 1fr;width:calc(100% - 20px);margin-top:4px;border-top:1px solid var(--line);padding-top:8px}
      #pdk-root .pdk-ostats div{display:flex;flex-direction:column;gap:1px}
      #pdk-root .pdk-ostats div + div{border-left:1px solid var(--line)}
      #pdk-root .pdk-ostats small{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
      #pdk-root .pdk-ostats b{font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--tx)}
      #pdk-root .pdk-ostats b.xp{color:var(--xp)}
      #pdk-root .pdk-obar{width:calc(100% - 20px);height:4px;margin:2px 0;background:var(--row2);border-radius:2px;overflow:hidden}
      #pdk-root .pdk-obar i{display:block;height:100%;background:var(--ok);border-radius:2px}
      #pdk-root .pdk-ostate{font-size:10.5px;color:var(--dim)}
      #pdk-root .pdk-go{width:calc(100% - 20px);height:30px;margin-top:4px;background:transparent;border:1px solid #2c4658;border-radius:7px;color:var(--tx);font:inherit;font-weight:700;cursor:pointer;transition:background .12s,border-color .12s}
      #pdk-root .pdk-go:hover{background:#e3eaf1;border-color:#e3eaf1;color:#0c141b}
      #pdk-root .pdk-go.arm,#pdk-root .pdk-rrbtn.arm{background:var(--ok);border-color:var(--ok);color:#08210f}

      #pdk-root .pdk-rr{display:flex;align-items:center;gap:12px;margin:0 14px 12px;padding:8px 10px 8px 12px;border:1px solid var(--line);border-radius:9px;background:var(--row)}
      #pdk-root .pdk-rr > div{flex:1;min-width:0}
      #pdk-root .pdk-rr b{font-size:12px;color:var(--tx)}
      #pdk-root .pdk-rr small{display:block;font-size:10.5px;color:var(--dim)}
      #pdk-root .pdk-rrhave{flex:none;font-size:10.5px;color:var(--dim)}
      #pdk-root .pdk-rrbtn{flex:none;height:28px;padding:0 10px;border-radius:7px;border:1px solid #2c4658;background:transparent;color:var(--tx);font:inherit;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px}
      #pdk-root .pdk-rrbtn:hover:not([disabled]){background:var(--row2)}
      #pdk-root .pdk-rrbtn[disabled]{opacity:.4;cursor:not-allowed}
      #pdk-root .pdk-rrbtn span{font-size:11px;color:var(--dim)}
      #pdk-root .pdk-foot{margin:0;padding:0 14px 12px;text-align:center;font-size:10.5px;color:#5c7082}
    `;

    const addCss = () => {
      const st = document.createElement('style');

      st.textContent = CSS + 'html.pdk-silent .map-window{visibility:hidden!important}';
      document.head.appendChild(st);
    };

    /* ---------- DAILY KILL ---------- */
    const dk = { raw: null, t: 0, open: false, busy: false };

    const dkNum = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

    // Formato real de /api/game/daily-kill:
    // { tierLabel, resetAt, options:[{xp,qty,name,speciesId,type1,type2,have,done}], pickedIdx, claimed,
    //   reward:{xp, items:[{name,qty,icon}]}, rerollCost, cards, rerolls, rerollMax, locked, minLevel }
    function dkParse(d) {
      if (!d || typeof d !== 'object' || !Array.isArray(d.options)) return null;

      const picked = Number.isInteger(d.pickedIdx) ? d.pickedIdx : -1;

      const opts = d.options.map((o, i) => ({
        i,
        sid: dkNum(o.speciesId),
        name: o.name || '#' + o.speciesId,
        types: [o.type1, o.type2].filter(Boolean),
        xp: dkNum(o.xp),
        kills: dkNum(o.have) || 0,
        need: dkNum(o.qty),
        done: !!o.done,
        chosen: i === picked,
        raw: o
      }));

      const ch = opts[picked] || null;
      const rw = d.reward || {};

      return {
        tier: d.tierLabel || d.tierKey || '',
        xp: dkNum(rw.xp) || null,
        done: !!(ch && ch.done),
        claimed: !!d.claimed,
        canClaim: !!(ch && ch.need && ch.kills >= ch.need && !d.claimed),
        reroll: d.resetAt,
        rewards: (Array.isArray(rw.items) ? rw.items : []).map((r) => ({ name: r.name || '', qty: dkNum(r.qty), icon: r.icon || '' })),
        rerollCost: dkNum(d.rerollCost),
        cards: dkNum(d.cards) || 0,
        locked: !!d.locked,
        minLevel: dkNum(d.minLevel),
        opts,
        chosen: ch
      };
    }

    function dkSet(d) {
      if (d && Array.isArray(d.options)) store.set('last', d);

      dk.raw = d;
      dk.t = Date.now();
      dk.st = dkParse(d);
      dkRender();
    }

    async function dkLoad() {
      try {
        dkSet(await gameGet('/api/game/daily-kill'));
      } catch (e) {
        dk.err = String((e && e.message) || e);
        dkRender();
      }
    }

    function dkKill(j) {
      const c = dk.st && dk.st.chosen;

      if (!c || !j || +j.speciesId !== c.sid) return;

      c.kills = (c.kills || 0) + 1;
      dkRender();

      if (c.need && c.kills >= c.need) setTimeout(dkLoad, 1500);
    }

    // nome → pokeId (para formas especiais, ex.: "Trickmaster Gengar" usa o sprite do Gengar)
    const baseIds = new Map();
    const typesById = new Map();

    NF('/game/creatures.json')
      .then((r) => r.json())
      .then((c) => {
        (c.creatures || c || []).forEach((x) => {
          if (!x) return;
          if (x.name) baseIds.set(String(x.name).toLowerCase(), +x.pokeId);
          if (x.pokeId != null) typesById.set(+x.pokeId, [x.type1, x.type2].filter(Boolean).map((t) => String(t).toLowerCase()));
        });
        loadLeader();
        dkRender();
      })
      .catch(() => {});

    /* ---------- efetividade contra o Pokémon que você está usando ---------- */
    const CHART = {
      normal: { rock: 0.5, ghost: 0, steel: 0.5 },
      fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
      water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
      electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
      grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
      ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
      fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
      poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
      ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
      flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
      psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
      bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
      rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
      ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
      dragon: { dragon: 2, steel: 0.5, fairy: 0 },
      dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
      steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
      fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
    };
    // escala usada no jogo (a mesma da coluna "Vant." da janela de Hunts)
    const effLabel = (m) => (m === 1.5 ? 1.75 : m === 2 ? 2.5 : m >= 4 ? 5.5 : m === 0.5 ? 0.33 : m);
    let leader = null;

    function effOf(def) {
      const atk = leader && leader.types;

      if (!atk || !atk.length || !def.length) return null;

      let best = null;

      atk.forEach((a) => {
        let m = 1;

        def.forEach((d) => {
          const v = CHART[a] && CHART[a][String(d).toLowerCase()];

          if (v !== undefined) m *= v;
        });

        if (best === null || m > best) best = m;
      });

      return best;
    }

    function gameCtx() {
      const el = document.querySelector('.phud-name') || document.querySelector('.phud');
      const fk = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? el[fk] : null;

      for (let i = 0; f && i < 40; i++, f = f.return) {
        const v = f.memoizedProps && f.memoizedProps.value;

        if (v && typeof v.subscribe === 'function' && typeof v.requestPokes === 'function') return v;
      }

      return null;
    }

    function loadLeader() {
      const ctx = gameCtx();

      if (!ctx) return;

      let done = false;
      let un = null;
      const fin = (list) => {
        if (done) return;

        done = true;

        try {
          un && un();
        } catch (e) {}

        const L = Array.isArray(list) ? list : [];
        const p = L.find((x) => x.leader) || L.filter((x) => x.team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))[0];

        if (!p) return;

        let types = [p.type1, p.type2].filter(Boolean).map((t) => String(t).toLowerCase());

        if (!types.length) types = typesById.get(+p.speciesId) || [];

        leader = { name: p.name || '', types };
        dkRender();
      };

      setTimeout(() => fin([]), 2500);
      un = ctx.subscribe('pokes', (m) => fin(m && m.list));
      ctx.requestPokes();
    }

    setInterval(loadLeader, 60000);

    const dkBaseId = (sid) => {
      const o = dk.st && dk.st.opts.find((x) => x.sid === +sid);
      const w = o ? String(o.name).toLowerCase().split(' ') : [];

      for (let i = 1; i < w.length; i++) {
        const id = baseIds.get(w.slice(i).join(' '));

        if (id > 0 && id <= 1025) return id;
      }

      return 0;
    };

    const dkSprite = (sid) => {
      let id = +sid || 0;

      if (id >= 13000 && id < 14000) id -= 13000;
      if (id > 1025) id = dkBaseId(sid);
      if (!id || id > 1025) return {};

      const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

      return { anim: base + '/versions/generation-v/black-white/animated/' + id + '.gif', still: base + '/' + id + '.png' };
    };

    const dkImg = (sid) => {
      const sp = dkSprite(sid);

      return sp.anim ? `<img src="${esc(sp.anim)}" data-fb="${esc(sp.still || '')}" onerror="if(this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=''}else{this.remove()}">` : '';
    };

    const dkBadge = (t) => {
      const k = String(t).toLowerCase();
      const bg = TYPE_COLOR[k] || '#6b7089';

      return `<span class="pdk-type" style="background:${bg};color:${rpTextOn(bg)}">${esc(RP_TYPE_PT[k] || cap(k))}</span>`;
    };

    function dkTimeLeft() {
      const r = dk.st && dk.st.reroll;
      const t = typeof r === 'number' ? (r < 1e12 ? r * 1000 : r) : r ? Date.parse(r) : NaN;

      if (!Number.isFinite(t)) return '';

      const s = Math.max(0, Math.round((t - Date.now()) / 1000));

      return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    const dkRewards = (st, small) =>
      st.rewards.length
        ? `<div class="pdk-rws${small ? ' sm' : ''}">${st.rewards
            .map(
              (r) =>
                `<span class="pdk-rwi" title="${esc(r.name)}">${r.icon ? `<img src="${esc(iconUrl(r.icon))}" onerror="this.remove()">` : ''}<b>×${fmt(r.qty || 1)}</b>${small ? '' : ' ' + esc(r.name)}</span>`
            )
            .join('')}</div>`
        : '';

    function dkRender() {
      let el = document.getElementById('pdk-root');

      if (!el) {
        el = document.createElement('div');
        el.id = 'pdk-root';
        document.body.appendChild(el);
        el.addEventListener('click', dkClick);
      }

      const st = dk.st;

      if (!st) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
      }

      el.style.display = '';

      const c = st.chosen;
      const need = c && c.need != null ? c.need : null;
      const kills = c ? c.kills || 0 : 0;
      const pct = need ? Math.min(100, (kills / need) * 100) : 0;
      const full = !!(c && need && kills >= need);
      const doneToday = !!(st.claimed || (st.done && !full));
      const mini = true;
      const xp = (c && c.xp) || st.xp;

      const head = `<div class="pdk-hd">
          ${st.tier ? `<span class="pdk-tier">${esc(st.tier)}</span>` : '<span></span>'}
          <span class="pdk-hd-r">${c ? '<i class="pdk-star">★</i>' : ''}</span>
        </div>`;

      let card;

      if (doneToday) {
        card = `<div class="pdk-card pdk-mini pdk-over" data-dk="open">
          <div class="pdk-mrow">
            <div class="pdk-msp pdk-ok">✓</div>
            <div class="pdk-minfo">
              <b>Daily Kill concluída</b>
              <span>${dkTimeLeft() ? 'libera em <em class="pdk-timer">' + dkTimeLeft() + '</em>' : 'volta amanhã'}</span>
            </div>
          </div>
        </div>`;
      } else if (mini) {
        const rr = dkTimeLeft() ? ` · <span class="pdk-mt">reroll <b class="pdk-timer">${dkTimeLeft()}</b></span>` : '';

        card = `<div class="pdk-card pdk-mini${c ? '' : ' pdk-q'}${full ? ' pdk-full' : ''}" data-dk="open" title="Daily Kill">
          <div class="pdk-mrow">
            <div class="pdk-msp">${c ? dkImg(c.sid) || '❔' : '<b>?</b>'}</div>
            <div class="pdk-minfo">
              <b>${c ? esc(c.name) : 'Daily Kill disponível'}</b>
              ${
                c
                  ? `<span><em>${fmt(kills)}</em> / ${need != null ? fmt(need) : '?'} kills${full && !st.claimed ? ' · <b class="pdk-rdy">pronto para resgatar</b>' : ''}${rr}</span><div class="pdk-bar"><i style="width:${pct}%"></i></div>`
                  : `<span>clique para escolher${rr}</span>`
              }
            </div>
            ${c && !full ? `<button type="button" class="pdk-tp" data-dk="tp" title="Ir para a hunt de ${esc(c.name)}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></button>` : ''}
          </div>
        </div>`;
      } else if (c) {
        card = `<div class="pdk-card${full ? ' pdk-full' : ''}" data-dk="open">
          ${head}
          <div class="pdk-sp">${dkImg(c.sid) || '❔'}</div>
          <small class="pdk-num">#${String(c.sid || '').padStart(3, '0')}</small>
          <b class="pdk-name">${esc(c.name)}</b>
          <div class="pdk-types">${c.types.map(dkBadge).join('')}</div>
          ${xp ? `<div class="pdk-xp">✦ ${fmt(xp)} XP</div>` : ''}
          <div class="pdk-cnt"><em>${fmt(kills)}</em> / ${need != null ? fmt(need) : '?'}</div>
          <div class="pdk-bar"><i style="width:${pct}%"></i></div>
          ${
            full && !st.claimed
              ? '<button type="button" class="pdk-btn go" data-dk="claim">Resgatar</button>'
              : st.claimed
                ? '<div class="pdk-btn done">Concluída ✓</div>'
                : `<div class="pdk-btn">Faltam ${need != null ? fmt(Math.max(0, need - kills)) : '?'}</div>`
          }
          <button type="button" class="pdk-mbtn" data-dk="mini">Minimizar</button>
        </div>`;
      } else {
        card = `<div class="pdk-card pdk-q" data-dk="open">
          ${head}
          <div class="pdk-sp pdk-qbox"><b>?</b></div>
          <b class="pdk-name">Daily Kill disponível</b>
          <small class="pdk-hint">${st.claimed ? 'Missão de hoje concluída ✓' : 'Clique para escolher o alvo de hoje'}</small>
          ${st.xp ? `<div class="pdk-xp">✦ ${fmt(st.xp)} XP</div>` : ''}
          <button type="button" class="pdk-mbtn" data-dk="mini">Minimizar</button>
        </div>`;
      }

      el.innerHTML = card + (dk.open ? dkPicker(st) : '');
    }

    function dkPicker(st) {
      const xpAll = st.xp || (st.chosen && st.chosen.xp);

      return `<div class="pdk-pick">
        <div class="pdk-pick-h">
          <b>Daily Kill</b>
          ${st.tier ? `<span class="pdk-tier">${esc(st.tier)}</span>` : ''}
          ${dkTimeLeft() ? `<span class="pdk-dim">reroll em <b class="pdk-timer">${dkTimeLeft()}</b></span>` : ''}
          <button type="button" class="pdk-x" data-dk="close" title="Fechar">✕</button>
        </div>
        <div class="pdk-rw"><span>Recompensa</span>${xpAll ? `<em class="xp">${fmt(xpAll)} XP</em>` : ''}${dkRewards(st, false) || '<em class="pdk-dim">—</em>'}</div>
        <div class="pdk-opts">${
          st.opts
            .map(
              (o) => `<div class="pdk-opt${o.chosen ? ' on' : ''}${st.chosen && !o.chosen ? ' off' : ''}">
              ${o.chosen ? '<span class="pdk-star">✓</span>' : ''}
              ${(() => {
                const e = effOf(o.types);

                return e == null ? '' : `<span class="pdk-eff ${e > 1 ? 'good' : e < 1 ? 'bad' : ''}" title="Vantagem do seu ${esc(leader.name)}">${effLabel(e)}x</span>`;
              })()}
              <div class="pdk-osp">${dkImg(o.sid) || '<b class="pdk-dim">?</b>'}</div>
              <b class="pdk-oname" title="${esc(o.name)}">${esc(o.name)}</b>
              <div class="pdk-types">${o.types.map(dkBadge).join('')}</div>
              <div class="pdk-ostats">
                <div><small>XP</small><b class="xp">${o.xp ? fmt(o.xp) : '—'}</b></div>
                <div><small>Kills</small><b>${fmt(o.kills || 0)} / ${o.need != null ? fmt(o.need) : '?'}</b></div>
              </div>
              ${
                st.chosen
                  ? o.chosen
                    ? `<div class="pdk-obar"><i style="width:${o.need ? Math.min(100, (o.kills / o.need) * 100) : 0}%"></i></div><span class="pdk-ostate">${
                        o.need && o.kills >= o.need ? 'completo!' : 'faltam ' + fmt(Math.max(0, (o.need || 0) - (o.kills || 0)))
                      }</span>`
                    : '<span class="pdk-ostate">não escolhida</span>'
                  : `<button type="button" class="pdk-go${dk.arm === 'choose:' + o.i ? ' arm' : ''}" data-dk="choose" data-i="${o.i}">${dk.arm === 'choose:' + o.i ? 'Confirmar?' : 'Escolher'}</button>`
              }
            </div>`
            )
            .join('') || '<div class="pdk-dim">Sem opções hoje.</div>'
        }</div>
        ${
          !st.chosen && st.rerollCost != null
            ? `<div class="pdk-rr">
                <div><b>Não gostou das opções?</b><small>Sorteia outros 3 — só antes de escolher.</small></div>
                <span class="pdk-rrhave">${fmt(st.cards)} na mochila</span>
                <button type="button" class="pdk-rrbtn${dk.arm === 'reroll' ? ' arm' : ''}" data-dk="reroll"${st.cards >= st.rerollCost ? '' : ' disabled'}>${dk.arm === 'reroll' ? 'Confirmar?' : 'Trocar os 3'} <span>×${fmt(st.rerollCost)}</span></button>
              </div>`
            : ''
        }
        <div class="pdk-foot">A escolha vale o dia inteiro.</div>
      </div>`;
    }

    async function dkAction(kind, o) {
      const lt = store.get(kind, null) || DK_LS_STORE.get(kind, null);
      let url;
      let body;

      if (lt) {
        url = lt.url;

        try {
          body = lt.body ? JSON.parse(lt.body) : {};
        } catch (e) {
          body = {};
        }

        if (o) {
          ['speciesId', 'pokeId', 'targetSpeciesId'].forEach((k) => k in body && (body[k] = o.sid));
          ['index', 'choice', 'idx', 'slot', 'option'].forEach((k) => k in body && (body[k] = o.i));
        }
      } else {
        url = '/api/game/daily-kill/' + (kind === 'dkClaim' ? 'claim' : kind === 'dkReroll' ? 'reroll' : 'pick');
        body = o ? { idx: o.i, index: o.i, speciesId: o.sid } : {};
      }

      return gamePost(url, body);
    }

    function dkClick(e) {
      const b = e.target.closest('[data-dk]');

      if (!b || dk.busy) return;

      const k = b.dataset.dk;

      e.stopPropagation();

      if (k === 'open') {
        dk.open = !dk.open;
        dkRender();

        if (dk.open) {
          dkLoad();
          loadLeader();
        }

        return;
      }

      if (k === 'tp') {
        const c = dk.st && dk.st.chosen;

        if (c) {
          b.classList.add('busy');
          goHunt(c).finally(() => b.classList.remove('busy'));
        }

        return;
      }

      if (k === 'close') {
        dk.open = false;
        dkRender();
        return;
      }

      if (k === 'mini') {
        const toMini = !store.get('dkMini', false);

        store.set('dkMini', toMini);

        if (toMini) dk.open = false;

        dkRender();
        return;
      }

      if (k === 'choose' || k === 'claim' || k === 'reroll') {
        const o = k === 'choose' ? (dk.st.opts || [])[+b.dataset.i] : null;
        const kind = k === 'choose' ? 'dkChoose' : k === 'claim' ? 'dkClaim' : 'dkReroll';

        // Escolher/Trocar: 1º clique vira "Confirmar?" no próprio botão (3s); 2º clique executa.
        if (k !== 'claim') {
          const armKey = k === 'choose' ? 'choose:' + b.dataset.i : 'reroll';

          if (dk.arm !== armKey) {
            dk.arm = armKey;
            clearTimeout(dk.armT);
            dk.armT = setTimeout(() => {
              dk.arm = null;
              dkRender();
            }, 3000);
            dkRender();

            return;
          }

          dk.arm = null;
          clearTimeout(dk.armT);
        }

        dk.busy = true;
        b.disabled = true;
        dkAction(kind, o)
          .then((r) => {
            toast(k === 'choose' ? 'Daily Kill: ' + (o && o.name) + ' escolhido!' : k === 'claim' ? 'Daily Kill resgatado!' : 'Daily Kill: novas opções sorteadas!');

            if (r && typeof r === 'object' && Array.isArray(r.options)) dkSet(r);
            else dkLoad();
          })
          .catch((err) =>
            toast(
              'Daily Kill: ' +
                ((err && err.message) || err) +
                (store.get(kind, null) || DK_LS_STORE.get(kind, null) ? '' : ' — faça isso 1x pela janela do jogo para eu aprender.')
            )
          )
          .finally(() => {
            dk.busy = false;
          });
      }
    }

    setInterval(dkLoad, 120000);
    setInterval(() => {
      const t = dkTimeLeft();

      document.querySelectorAll('#pdk-root .pdk-timer').forEach((el) => (el.textContent = t));
    }, 1000);

    /* ---------- ir para a hunt do alvo (pelo mapa do próprio jogo) ---------- */
    let markersP = null;

    const loadMarkers = () =>
      markersP ||
      (markersP = NF('/api/game/map-markers', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((j) => (j && j.hunts) || [])
        .catch(() => {
          markersP = null;

          return [];
        }));

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const mapOpen = () => {
      const w = document.querySelector('.map-window');

      return !!(w && w.getClientRects().length);
    };
    const waitFor = async (fn, ms) => {
      for (let t = 0; t < ms; t += 50) {
        const v = fn();

        if (v) return v;

        await sleep(50);
      }

      return null;
    };
    // Alt+clique: o script de Hunts deixa passar e o mapa original do jogo abre.
    const clickDockMap = () => {
      const b = document.querySelector('[data-guide="dock-map"]');

      if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
    };

    async function goHunt(c) {
      const hunts = await loadMarkers();
      const nm = String(c.name).toLowerCase();
      const look = c.raw && +c.raw.looktype;
      const h = hunts.find((x) => String(x.name).toLowerCase() === nm) || hunts.find((x) => look && +x.looktype === look && +x.level > 0);

      if (!h) {
        toast('Não achei a hunt de ' + c.name + ' no mapa.');

        return;
      }

      const sel = '[data-guide="hunt-' + String(h.slug).replace(/"/g, '') + '"]';
      const wasOpen = mapOpen();

      document.documentElement.classList.add('pdk-silent');

      try {
        if (!wasOpen) {
          clickDockMap();

          if (!(await waitFor(mapOpen, 2000))) throw new Error('mapa não abriu');
        }

        let mk = document.querySelector(sel);

        if (!mk) {
          const plates = [...document.querySelectorAll('.map-window .map-plate, .map-window .map-area')];
          const plate = plates[['kanto', 'outland', 'orre', 'nightmare'].indexOf(h.area)];

          if (plate && !plate.classList.contains('locked')) plate.click();

          mk = await waitFor(() => document.querySelector(sel), 2500);
        }

        if (!mk) throw new Error('hunt bloqueada ou fora do mapa');

        mk.click();
        await sleep(250);
      } catch (e) {
        toast('Não consegui ir para ' + h.name + ': ' + e.message);
      } finally {
        if (!wasOpen && mapOpen()) {
          const w = document.querySelector('.map-window');
          const x = [...w.querySelectorAll('button')].find((b) => /^[×✕x]$/i.test(b.textContent.trim()) || /close|fechar/i.test(b.className + ' ' + (b.title || '')));

          x ? x.click() : clickDockMap();
        }

        document.documentElement.classList.remove('pdk-silent');
      }
    }

    /* ---------- início ---------- */
    const boot = () => {
      addCss();

      // mostra na hora o último estado conhecido e busca o atual assim que a sessão existir
      const last = store.get('last', null);

      if (last) dkSet(last);

      const iv = setInterval(() => {
        if (!(tokens() && tokens().accessToken)) return;

        clearInterval(iv);
        dkLoad();
      }, 300);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    DKX.load = dkLoad;
    DKX.set = dkSet;
    DKX.kill = dkKill;

    PW.DailyKill = {
      dump() {
        gameGet('/api/game/daily-kill').then((d) => console.log(JSON.stringify(d, null, 1)));
      },
      state: () => dk
    };
  })();

  /* ---------- SUPRIMENTOS (à direita do card do Daily Kill): pokébolas, potions e revives ---------- */
  (() => {
    const st = document.createElement('style');

    st.textContent = `
      #hl-sup{position:fixed;bottom:16px;z-index:2147483640;display:none;align-items:center;gap:10px;box-sizing:border-box;min-height:44px;padding:8px 12px;
        background:linear-gradient(180deg,#1b1f31,#12141f);border:1px solid #3a4060;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.55);
        font:12px/1.2 Inter,sans-serif;color:#f2ead0;white-space:nowrap}
      #hl-sup.on{display:flex}
      #hl-sup .g{display:flex;align-items:center;gap:6px}
      #hl-sup .sep{width:1px;align-self:stretch;margin:2px 0;background:#2c3148}
      #hl-sup .c{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:34px}
      #hl-sup .c img{width:24px;height:24px;object-fit:contain;image-rendering:pixelated}
      #hl-sup .c img.idle{width:18px;height:18px;margin:3px 0}
      #hl-sup .c b{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
      #hl-sup .c.zero b{color:#ef6a6a}
      #hl-sup .c.low b{color:#f0c14b}
      #hl-sup .dim{color:#7c829c;font-size:11px}
    `;
    document.head.appendChild(st);

    const box = document.createElement('div');

    box.id = 'hl-sup';

    const S = Object.assign({ balls: [], heal: [], revive: [], ok: false }, store.get('supCache', {}) || {});

    const chip = (x) => {
      const n = x.n || 0;
      const cls = n <= 0 ? ' zero' : n < 50 ? ' low' : '';
      const idle = /idle/i.test(x.name + ' ' + x.icon) ? ' class="idle"' : '';

      return `<span class="c${cls}" title="${esc(x.name)}: ${fmt(n)}">${x.icon ? `<img${idle} src="${esc(x.icon)}" onerror="this.remove()">` : ''}<b>${fmt(n)}</b></span>`;
    };

    function paint() {
      if (!S.ok) {
        box.innerHTML = '<span class="dim">Carregando suprimentos…</span>';

        return;
      }

      const groups = [S.balls, S.heal.filter((x) => x.n > 0), S.revive].filter((g) => g.length);

      box.innerHTML = groups.map((g) => `<span class="g">${g.map(chip).join('')}</span>`).join('<span class="sep"></span>') || '<span class="dim">Sem suprimentos</span>';
    }

    async function load() {
      try {
        const [shop, balls, depot] = await Promise.all([
          gameGet('/api/game/shop').catch(() => null),
          gameGet('/api/game/balls').catch(() => null),
          gameGet('/api/game/depot').catch(() => null)
        ]);
        const counts = (balls && balls.counts) || wsSt.ballCounts || {};
        const inv = (depot && depot.inventory) || [];
        const qty = (id) => {
          const it = inv.find((y) => String(y.id ?? y.itemId) === String(id));

          return it ? +it.quantity || 0 : 0;
        };
        const icon = (x) => iconUrl(x.iconUrl || x.icon || '');
        const shopBalls = (shop && Array.isArray(shop.balls) ? shop.balls : []).map((b) => ({ id: b.id, name: b.name, icon: icon(b), n: +(counts[b.id] ?? counts[String(b.id)] ?? 0) }));
        const known = new Set(shopBalls.map((b) => String(b.id)));

        // bolas que não são vendidas na loja (ex.: Idle Ball) mas aparecem nas contagens
        Object.keys(counts).forEach((id) => {
          if (known.has(String(id)) || !(+counts[id] > 0)) return;

          const it = inv.find((y) => String(y.id ?? y.itemId) === String(id));

          shopBalls.push({ id, name: (it && it.name) || 'Idle Ball', icon: it && it.icon ? iconUrl(it.icon) : '/assets/markitems/idleball.png', n: +counts[id] });
        });

        const items = shop && Array.isArray(shop.items) ? shop.items : [];
        const isRev = (x) => /revive/i.test(x.category + ' ' + x.name);
        const isHeal = (x) => !isRev(x) && (/heal/i.test(x.category || '') || /potion/i.test(x.name || ''));

        S.balls = shopBalls;
        S.heal = items.filter(isHeal).map((x) => ({ id: x.id, name: x.name, icon: icon(x), n: qty(x.id) }));
        S.revive = items.filter(isRev).map((x) => ({ id: x.id, name: x.name, icon: icon(x) || '/assets/markitems/revive.png', n: qty(x.id) }));

        if (!S.revive.length) {
          const r = inv.find((y) => /revive/i.test(y.name || ''));

          S.revive = [{ name: 'Revive', icon: r && r.icon ? iconUrl(r.icon) : '/assets/markitems/revive.png', n: r ? +r.quantity || 0 : 0 }];
        }

        S.ok = true;
        store.set('supCache', { balls: S.balls, heal: S.heal, revive: S.revive, ok: true });
      } catch (e) {}

      paint();
    }

    // Tempo real: o jogo manda as contagens pelo WebSocket (bolas em "counts", itens com itemId/quantity).
    const setN = (list, id, n) => {
      const x = list.find((y) => String(y.id) === String(id));

      if (x && x.n !== n) {
        x.n = n;

        return true;
      }

      return false;
    };

    wsSt.onMsg = (v) => {
      if (v.length > 400000 || !/"(counts|quantity|qty)"/.test(v)) return;

      const j = JSON.parse(v);
      let ch = false;
      const counts = j && (j.counts || (j.balls && !Array.isArray(j.balls) && j.balls));

      if (counts && typeof counts === 'object') {
        Object.keys(counts).forEach((id) => {
          if (Number.isFinite(+counts[id])) ch = setN(S.balls, id, +counts[id]) || ch;
        });
      }

      const lists = [j.inventory, j.items, j.list, j.bag, j.consumables].filter(Array.isArray);

      lists.forEach((arr) =>
        arr.forEach((it) => {
          if (!it || typeof it !== 'object') return;

          const id = it.itemId ?? it.id;
          const n = Number(it.quantity ?? it.qty ?? it.count);

          if (id == null || !Number.isFinite(n)) return;

          ch = setN(S.heal, id, n) || ch;
          ch = setN(S.revive, id, n) || ch;
        })
      );

      const one = j.item && typeof j.item === 'object' ? j.item : j.itemId != null ? j : null;

      if (one) {
        const n = Number(one.quantity ?? one.qty ?? one.left ?? one.remaining);

        if (Number.isFinite(n)) {
          const id = one.itemId ?? one.id;

          ch = setN(S.heal, id, n) || setN(S.revive, id, n) || setN(S.balls, id, n) || ch;
        }
      }

      if (ch) {
        paint();
        store.set('supCache', { balls: S.balls, heal: S.heal, revive: S.revive, ok: true });
      }
    };

    function place() {
      if (!box.isConnected && document.body) {
        document.body.appendChild(box);
        paint();
      }

      const card = document.querySelector('#pdk-root .pdk-card');
      const r = card && card.getBoundingClientRect();

      if (!r || !r.width) return box.classList.remove('on');

      box.classList.add('on');
      box.style.left = Math.round(r.right + 12) + 'px';
      box.style.bottom = Math.round(innerHeight - r.bottom) + 'px';
      box.style.minHeight = Math.round(r.height) + 'px';
    }

    // carrega assim que a sessão existir (sem esperar tempo fixo); o cache já aparece na hora
    const iv = setInterval(() => {
      if (!getAuths().length) return;

      clearInterval(iv);
      load();
    }, 150);

    setInterval(load, 20000);
    setInterval(place, 250);
  })();

  PW.MarketAlerts = {
    dk() {
      gameGet('/api/game/daily-kill').then((d) => console.log(JSON.stringify(d, null, 1)));
      return 'buscando…';
    },
    gravar() {
      netCap.log = [];
      netCap.on = true;
      console.log('%c[LiveSearch] gravando… faça a ação no jogo e depois rode: MarketAlerts.parar()', 'color:#61f6a4');
    },
    parar() {
      netCap.on = false;

      const txt = JSON.stringify({ v: VERSION, log: netCap.log }, null, 1);

      console.log(txt);
      try {
        navigator.clipboard.writeText(txt).then(
          () => console.log('%c✅ copiado — cole no chat', 'color:#61f6a4'),
          () => console.log('%cSelecione o texto acima e copie (Ctrl+C).', 'color:#f0d78c')
        );
      } catch (e) {}

      return netCap.log.length + ' registros';
    },
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

  /* ==================== HUNTS + MENU + VISUAL (antigo 'Poke Idle - Hunts') ==================== */

  (() => {

    const AREAS = [
      ['kanto', 'Kanto'],
      ['outland', 'Outland'],
      ['orre', 'Orre'],
      ['nightmare', 'Nightmare']
    ];
    const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

    const TYPES = {
      normal: ['Normal', '#9fa19f'],
      fire: ['Fogo', '#e62829'],
      water: ['Água', '#2980ef'],
      electric: ['Elétrico', '#fac000'],
      grass: ['Planta', '#3fa129'],
      ice: ['Gelo', '#3dcef3'],
      fighting: ['Lutador', '#ff8000'],
      poison: ['Veneno', '#9141cb'],
      ground: ['Terra', '#915121'],
      flying: ['Voador', '#81b9ef'],
      psychic: ['Psíquico', '#ef4179'],
      bug: ['Inseto', '#91a119'],
      rock: ['Pedra', '#afa981'],
      ghost: ['Fantasma', '#704170'],
      dragon: ['Dragão', '#5060e1'],
      dark: ['Sombrio', '#624d4e'],
      steel: ['Aço', '#60a1b8'],
      fairy: ['Fada', '#ef70ef']
    };

    const CHART = {
      normal: { rock: 0.5, ghost: 0, steel: 0.5 },
      fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
      water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
      electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
      grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
      ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
      fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
      poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
      ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
      flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
      psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
      bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
      rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
      ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
      dragon: { dragon: 2, steel: 0.5, fairy: 0 },
      dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
      steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
      fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
    };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
    const short = (n) =>
      n >= 1e9
        ? (n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi'
        : n >= 1e6
        ? (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
        : fmt(n);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\[.*?\]|\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    // Preferências: memória primeiro; tenta gravar no localStorage e, se ele estiver
    // cheio (QuotaExceededError), no sessionStorage. Nunca quebra o script.
    const mem = new Map();
    const ls = {
      get(k, d) {
        if (mem.has(k)) return mem.get(k);

        for (const S of [localStorage, sessionStorage]) {
          try {
            const v = S.getItem('hl_' + k);

            if (v != null) {
              const j = JSON.parse(v);

              mem.set(k, j);

              return j;
            }
          } catch (e) {}
        }

        return d;
      },
      set(k, v) {
        mem.set(k, v);

        const txt = JSON.stringify(v);

        for (const S of [localStorage, sessionStorage]) {
          try {
            S.setItem('hl_' + k, txt);

            return;
          } catch (e) {}
        }
      }
    };

    const st = {
      area: ls.get('area', 'kanto'),
      sort: ls.get('sort', { k: 'level', d: 1 }),
      open: ls.get('open', true),
      caught: ls.get('caught', ''),
      favOnly: false,
      types: new Set(ls.get('types', [])),
      favs: new Set(ls.get('favs', [])),
      loot: new Set(),
      q: '',
      lo: null,
      hi: null,
      going: '',
      ver: 0
    };

    const data = {
      hunts: null,
      cre: null,
      items: new Map(),
      caughtIds: new Set(ls.get('caughtIds', [])),
      leader: null,
      lastSlug: ls.get('lastSlug', ''),
      ver: 0
    };

    /* ---------- WebSocket do jogo ---------- */

    // Dentro do LiveSearch: usa o WebSocket da página (PW) e, na falta, o socket que o LiveSearch já achou.
    let sock = null;
    const GAME_OUT = /"type":"(view|enter-hunt|leave-hunt|boosts-refresh|inv-get|family-get)"/;
    const WSP = PW.WebSocket.prototype;
    const oSend = WSP.send;

    WSP.send = function (d) {
      if (typeof d === 'string' && GAME_OUT.test(d)) {
        sock = this;

        if (d.includes('"enter-hunt"')) {
          try {
            const m = JSON.parse(d);

            if (m.slug) {
              data.lastSlug = m.slug;
              ls.set('lastSlug', m.slug);
              data.ver++;
            }
          } catch (e) {}
        }
      }

      return oSend.apply(this, arguments);
    };

    const wsOk = () => {
      if (!(sock && sock.readyState === 1) && wsSt.sock && wsSt.sock.readyState === 1) sock = wsSt.sock;

      return !!(sock && sock.readyState === 1);
    };

    const mapVisible = () => {
      const w = document.querySelector('.map-window');

      return !!(w && w.getClientRects().length);
    };

    async function waitFor(fn, ms) {
      for (let t = 0; t < ms; t += 50) {
        const v = fn();

        if (v) return v;

        await sleep(50);
      }

      return null;
    }

    async function viaNativeMap(slug, area) {
      const sel = '[data-guide="hunt-' + String(slug).replace(/"/g, '') + '"]';
      const wasOpen = mapVisible();

      document.documentElement.classList.add('hl-silent');

      try {
        if (!wasOpen) {
          nativeMap();

          if (!(await waitFor(mapVisible, 2000))) return false;
        }

        let mk = document.querySelector(sel);

        if (!mk) {
          const plates = [...document.querySelectorAll('.map-window .map-plate, .map-window .map-area')];
          const plate = plates[AREAS.findIndex(([k]) => k === area)];

          if (plate && !plate.classList.contains('locked')) plate.click();

          mk = await waitFor(() => document.querySelector(sel), 2500);
        }

        if (!mk) return false;

        mk.click();
        await sleep(250);

        return true;
      } finally {
        if (!wasOpen && mapVisible()) {
          const w = document.querySelector('.map-window');
          const x = [...w.querySelectorAll('button')].find((b) => /^[×✕x]$/i.test(b.textContent.trim()) || /close|fechar/i.test(b.className + ' ' + (b.title || '')));

          x ? x.click() : nativeMap();
        }

        document.documentElement.classList.remove('hl-silent');
      }
    }

    async function arrived(h) {
      return !!(await waitFor(() => hud().loc === norm(h.name), 4000));
    }

    async function travel(slug) {
      const h = data.hunts && data.hunts.find((x) => x.slug === slug);

      if (!h) return;

      const here = hereHunt(hud().loc);

      if (here && here.slug === slug) {
        toast('Você já está em ' + here.name + '.');

        return;
      }

      st.going = slug;
      st.ver++;
      render();

      let ok = (await viaNativeMap(slug, h.area)) && (await arrived(h));

      if (!ok && wsOk()) {
        sock.send(JSON.stringify({ type: 'leave-hunt' }));
        await sleep(450);
        sock.send(JSON.stringify({ type: 'enter-hunt', slug }));
        ok = await arrived(h);
      }

      if (!ok) toast('Não consegui viajar para ' + h.name + '.');

      st.going = '';
      st.ver++;
      render();
    }

    /* ---------- dados ---------- */

    const tokens = () => {
      try {
        return JSON.parse(sessionStorage.getItem('pokeweb:tokens') || 'null');
      } catch (e) {
        return null;
      }
    };

    async function authGet(url) {
      const send = (t) => fetch(url, { headers: t ? { Authorization: 'Bearer ' + t } : {} });
      let r = await send(tokens() && tokens().accessToken);

      if (r.status === 401 && tokens() && tokens().refreshToken) {
        const rr = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens().refreshToken })
        });

        if (rr.ok) {
          const j = await rr.json();

          if (j && j.accessToken) {
            sessionStorage.setItem('pokeweb:tokens', JSON.stringify(j));
            r = await send(j.accessToken);
          }
        }
      }

      if (!r.ok) throw new Error('HTTP ' + r.status);

      return r.json();
    }

    let staticP = null;

    function loadStatic() {
      if (staticP) return staticP;

      staticP = Promise.all([
        fetch('/api/game/map-markers', { credentials: 'same-origin' }).then((r) => r.json()),
        fetch('/game/creatures.json').then((r) => r.json()),
        fetch('/game/items.json')
          .then((r) => r.json())
          .catch(() => null)
      ])
        .then(([mm, cr, it]) => {
          const list = (cr && (cr.creatures || (Array.isArray(cr) ? cr : null))) || [];
          const byLook = new Map();
          const byName = new Map();
          const byId = new Map();

          list.forEach((c) => {
            if (!c) return;
            if (c.looktype != null && !byLook.has(+c.looktype)) byLook.set(+c.looktype, c);
            if (c.name) byName.set(norm(c.name), c);
            if (c.pokeId != null) byId.set(+c.pokeId, c);
          });

          data.cre = { byLook, byName, byId };

          const items = (it && (Array.isArray(it) ? it : it.items || Object.values(it))) || [];

          items.forEach((x) => {
            if (!x || !x.name) return;

            const ic = x.icon || x.image || x.sprite || x.img || '';

            if (ic) data.items.set(norm(x.name), /^(https?:)?\//.test(ic) ? ic : '/assets/items/' + String(ic).replace(/^\/+/, ''));
          });

          data.hunts = ((mm && mm.hunts) || []).map((m) => {
            const c = byLook.get(+m.looktype) || byName.get(norm(m.name)) || null;
            const bst = c ? ['baseHp', 'baseAtk', 'baseDef', 'baseSpAtk', 'baseSpDef', 'baseSpeed'].reduce((a, k) => a + (+c[k] || 0), 0) : 0;

            return {
              slug: m.slug,
              name: m.name,
              level: +m.level || 0,
              area: m.area,
              city: !(+m.level > 0),
              c,
              types: c ? [c.type1, c.type2].filter(Boolean).map((t) => String(t).toLowerCase()) : [],
              xp: c ? +c.experience || 0 : 0,
              total: bst,
              gold: c ? +(c.sellValue || c.priceNpc) || 0 : 0,
              pid: c ? spriteId(c, m.name) : 0,
              shiny: /shiny/i.test(m.name),
              loot: (c && Array.isArray(c.loot) ? c.loot : []).slice().sort((a, b) => (b.chance || 0) - (a.chance || 0))
            };
          });

          data.areaMin = {};

          AREAS.forEach(([a]) => {
            const lv = data.hunts.filter((h) => h.area === a && !h.city).map((h) => h.level);

            data.areaMin[a] = lv.length ? Math.min(...lv) : 0;
          });

          data.ver++;
          render();
        })
        .catch((e) => {
          staticP = null;
          console.warn('[Hunts] falha ao carregar dados', e);
        });

      return staticP;
    }

    function spriteId(c, name) {
      let id = +c.pokeId || 0;

      if (id >= 13000 && id < 14000) id -= 13000;
      if (id > 0 && id <= 1025) return id;

      const words = norm(name).split(' ');

      for (let i = 1; i < words.length; i++) {
        const b = data.cre.byName.get(words.slice(i).join(' '));

        if (b && +b.pokeId > 0 && +b.pokeId <= 1025) return +b.pokeId;
      }

      return 0;
    }

    async function loadCaught() {
      try {
        const d = await authGet('/api/game/pokedex');
        const ids = ((d && d.species) || []).filter((s) => s && s.caught).map((s) => +s.id);

        data.caughtIds = new Set(ids);
        ls.set('caughtIds', ids);
        data.ver++;
        render();
      } catch (e) {}
    }

    function gameCtx() {
      const el = document.querySelector('.phud-name') || document.querySelector('.phud');
      const fk = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? el[fk] : null;

      for (let i = 0; f && i < 40; i++, f = f.return) {
        const v = f.memoizedProps && f.memoizedProps.value;

        if (v && typeof v.subscribe === 'function' && typeof v.requestPokes === 'function') return v;
      }

      return null;
    }

    function loadLeader() {
      const ctx = gameCtx();

      if (!ctx) return;

      let done = false;
      let un = null;
      const fin = (list) => {
        if (done) return;

        done = true;

        try {
          un && un();
        } catch (e) {}

        const L = Array.isArray(list) ? list : [];

        if (L.length) {
          data.pokes = L;
          data.ver++;
        }
        const p = L.find((x) => x.leader) || L.filter((x) => x.team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))[0];

        if (!p) return;

        let types = [p.type1, p.type2]
          .concat(Array.isArray(p.types) ? p.types : [])
          .filter(Boolean)
          .map((t) => String(t).toLowerCase());

        const c = data.cre ? data.cre.byId.get(+p.speciesId) || data.cre.byName.get(norm(p.name)) : null;

        if (!types.length && c) types = [c.type1, c.type2].filter(Boolean).map((t) => String(t).toLowerCase());

        data.leader = {
          name: p.name || (c && c.name) || '',
          types: [...new Set(types)],
          level: +p.level || 0,
          pid: c ? spriteId(c, p.name || c.name) : 0,
          shiny: !!p.shiny
        };
        data.ver++;
        render();
      };

      setTimeout(() => fin([]), 2500);
      un = ctx.subscribe('pokes', (m) => fin(m && m.list));
      ctx.requestPokes();
    }

    function hud() {
      const t = document.querySelector('.phud-tloc');
      const txt = t ? t.textContent : '';
      let tl = 0;

      for (const s of ['.phud-tlevel', '.phud-level', '[data-guide="player-level"]']) {
        const el = document.querySelector(s);
        const m = el && /\d+/.exec(el.textContent);

        if (m) {
          tl = +m[0];
          break;
        }
      }

      if (!tl) {
        const m = /n[ií]vel\s*(\d+)/i.exec(txt);

        tl = m ? +m[1] : 0;
      }

      return { tl, loc: norm(txt.split('·').slice(1).join('·')) };
    }

    function hereHunt(loc) {
      if (!data.hunts || !loc) return null;

      const last = data.hunts.find((h) => h.slug === data.lastSlug);

      if (last && norm(last.name) === loc) return last;

      return data.hunts.find((h) => norm(h.name) === loc) || null;
    }

    function effOf(types) {
      const L = data.leader && data.leader.types;

      if (!L || !L.length || !types.length) return null;

      let best = null;

      L.forEach((a) => {
        let m = 1;

        types.forEach((d) => {
          const v = CHART[a] && CHART[a][d];

          if (v !== undefined) m *= v;
        });

        if (best === null || m > best) best = m;
      });

      return best;
    }

    const effLabel = (m) => (m === 1.5 ? 1.75 : m === 2 ? 2.5 : m >= 4 ? 5.5 : m === 0.5 ? 0.33 : m);

    /* ---------- estilos ---------- */

    const CSS = `
      #hl-win{--bg:#0c141b;--panel:#101a23;--row:#121e28;--row2:#172633;--line:#1b2b38;--tx:#e3eaf1;--dim:#768a9c;--gold:#f0c661;--ok:#57d38c;--bad:#ef6a6a;--r:14px;
        position:fixed;z-index:2147483600;width:min(920px,96vw);height:min(760px,88vh);display:none;flex-direction:column;
        background:var(--bg);color:var(--tx);border:1px solid #223444;border-radius:var(--r);box-shadow:0 24px 70px rgba(0,0,0,.6);
        font:13px/1.35 Inter,Barlow,system-ui,sans-serif;overflow:hidden}
      #hl-win.on{display:flex}
      #hl-win *{box-sizing:border-box}
      #hl-win button{font:inherit}
      #hl-win input{font:inherit;color:var(--tx)}

      .hl-top{display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:move;user-select:none}
      .hl-title{font-weight:800;font-size:15px;letter-spacing:.01em}
      .hl-areas{display:flex;gap:2px;padding:3px;background:#081017;border:1px solid var(--line);border-radius:10px}
      .hl-areas button{all:unset;cursor:pointer;padding:6px 12px;border-radius:7px;font-size:12px;font-weight:600;color:var(--dim);display:flex;align-items:center;gap:6px}
      .hl-areas button:hover{color:var(--tx)}
      .hl-areas button.on{background:var(--row2);color:var(--tx);box-shadow:inset 0 0 0 1px #2a4052}
      .hl-areas small{font-size:10px;color:var(--dim);font-weight:700}
      .hl-x{all:unset;cursor:pointer;margin-left:auto;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:18px}
      .hl-x:hover{background:var(--row2);color:var(--tx)}

      .hl-here{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line);background:linear-gradient(90deg,rgba(240,198,97,.08),transparent 70%)}
      .hl-here .hl-spr{width:44px;height:44px}
      .hl-side{display:flex;align-items:center;gap:10px;min-width:0}
      .hl-flip img{transform:scaleX(-1)}
      .hl-vs{flex:none;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;color:var(--gold);background:rgba(240,198,97,.1);box-shadow:inset 0 0 0 1px rgba(240,198,97,.3)}
      .hl-here .lbl{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
      .hl-here .nm{font-weight:700;font-size:14px}
      .hl-cities{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}

      .hl-tools{display:flex;align-items:center;gap:8px;padding:10px 14px 6px;flex-wrap:wrap}
      .hl-search{flex:1 1 220px;display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;background:var(--panel);border:1px solid var(--line);border-radius:9px}
      .hl-search:focus-within,.hl-lv:focus-within{border-color:#35526a}
      .hl-search svg{flex:none;color:var(--dim)}
      .hl-clear{all:unset;cursor:pointer;display:none;flex:none;width:20px;height:20px;border-radius:50%;align-items:center;justify-content:center;font-size:11px;color:var(--dim);background:var(--row2)}
      .hl-clear:hover{color:var(--tx);background:#22384a}
      .hl-search.has .hl-clear{display:flex}
      .hl-search input,.hl-lv input{all:unset;flex:1;min-width:0;height:100%}
      .hl-search input::placeholder,.hl-lv input::placeholder{color:#4f6273}
      .hl-lv{display:flex;align-items:center;gap:6px;height:34px;padding:0 10px;background:var(--panel);border:1px solid var(--line);border-radius:9px;color:var(--dim);font-size:12px}
      .hl-lv input{width:44px;text-align:center}
      .hl-chips{display:flex;gap:6px;flex-wrap:wrap}
      .hl-chip{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:14px;
        background:var(--panel);border:1px solid var(--line);color:var(--dim);font-size:12px;font-weight:600;white-space:nowrap}
      .hl-chip:hover{color:var(--tx);border-color:#2c4658}
      .hl-chip.on{color:#1b1406;background:var(--gold);border-color:var(--gold)}
      .hl-chip.here{color:var(--gold);border-color:rgba(240,198,97,.5)}

      .hl-types{display:flex;flex-wrap:wrap;gap:5px;padding:4px 14px 10px}
      .hl-tp{all:unset;cursor:pointer;flex:none;height:22px;padding:0 9px;border-radius:11px;font-size:11px;font-weight:700;color:var(--c);
        background:color-mix(in srgb,var(--c) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 40%,transparent)}
      .hl-tp:hover{background:color-mix(in srgb,var(--c) 22%,transparent)}
      .hl-tp.on{background:var(--c);color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.35);box-shadow:none}

      .hl-grid{display:grid;grid-template-columns:48px minmax(0,1fr) 56px 72px 88px 58px 56px 72px;align-items:center;column-gap:10px}
      .hl-head{padding:0 14px;height:30px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#0a1117;
        color:var(--dim);font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;overflow-y:hidden;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#253a4b transparent}
      .hl-head [data-sort]{cursor:pointer;text-align:right}
      .hl-head [data-sort]:hover{color:var(--tx)}
      .hl-head [data-sort].on{color:var(--gold)}
      .hl-head .l{text-align:left}

      .hl-body{flex:1;min-height:0;overflow-y:auto;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#253a4b transparent}
      .hl-sep{padding:7px 14px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);background:#0a1117;border-bottom:1px solid var(--line)}
      .hl-row{position:relative;padding:5px 14px;min-height:56px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .1s}
      .hl-row:hover{background:var(--row)}
      .hl-row:hover .hl-go{opacity:1}
      .hl-row.here{background:linear-gradient(90deg,rgba(240,198,97,.1),transparent 60%)}
      .hl-row.here::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--gold)}
      .hl-row.locked{cursor:default;opacity:.4}
      .hl-spr{width:48px;height:48px;display:flex;align-items:center;justify-content:center}
      .hl-spr img{max-width:100%;max-height:100%;image-rendering:pixelated}
      .hl-ph{width:28px;height:28px;border-radius:50%;background:var(--row2);display:flex;align-items:center;justify-content:center;color:var(--dim);font-weight:700}
      .hl-main{min-width:0;display:flex;flex-direction:column;gap:4px}
      .hl-name{display:flex;align-items:center;gap:7px;font-weight:700;font-size:14px;white-space:nowrap}
      .hl-name .t{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .hl-ball{flex:none;width:12px;height:12px;opacity:.22;filter:grayscale(1)}
      .hl-ball.on{opacity:1;filter:none}
      .hl-tag{flex:none;font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#1b1406;background:var(--gold);border-radius:4px;padding:2px 5px}
      .hl-go{flex:none;font-size:11px;font-weight:600;color:var(--gold);opacity:0;transition:opacity .1s}
      .hl-mini{display:flex;gap:4px;flex:none}
      .hl-mini span{font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px;color:#fff;background:var(--c);text-shadow:0 1px 1px rgba(0,0,0,.3)}
      .hl-num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
      .hl-num.dim{color:var(--dim)}
      .hl-num.xp{color:#9ec9ff}
      .hl-num.gold{color:var(--gold)}
      .hl-eff{justify-self:end;font-size:11px;font-weight:800;padding:3px 7px;border-radius:6px;color:var(--dim);background:var(--row2)}
      .hl-eff.good{color:#08210f;background:var(--ok)}
      .hl-eff.bad{color:#fff;background:var(--bad)}
      .hl-acts{display:flex;justify-content:flex-end;gap:2px}
      .hl-ib{all:unset;cursor:pointer;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:18px}
      .hl-ib:hover{background:var(--row2);color:var(--tx)}
      .hl-ib.fav.on{color:var(--gold)}
      .hl-ib.more.on{color:var(--tx);transform:rotate(180deg)}
      .hl-loot{display:flex;flex-direction:column;gap:6px;padding:8px 14px 12px 72px;background:#0a1117;border-bottom:1px solid var(--line)}
      .hl-dh{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin-top:4px}
      .hl-its{display:flex;flex-wrap:wrap;gap:6px}
      .hl-wk{display:flex;flex-direction:column;gap:6px}
      .hl-wk > div{display:flex;align-items:center;gap:8px}
      .hl-dimtxt{color:var(--dim);font-size:12px}
      .hl-pk b{margin-left:2px;padding:1px 5px;font-size:10px}
      .hl-pk.team{border-color:rgba(240,198,97,.45)}
      .hl-it{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px 0 6px;border-radius:7px;background:var(--row);border:1px solid var(--line);font-size:12px}
      .hl-it img{width:20px;height:20px;object-fit:contain;image-rendering:pixelated}
      .hl-it small{color:var(--dim);font-variant-numeric:tabular-nums}
      .hl-empty{padding:40px;text-align:center;color:var(--dim)}

      .hl-foot{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid var(--line);color:var(--dim);font-size:11.5px}

      html.hl-silent .map-window{visibility:hidden!important}
      #hl-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483601;background:#101a23;color:#e3eaf1;
        border:1px solid #2a4052;border-radius:10px;padding:10px 16px;font:13px Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5)}

      @media (max-width:640px){
        .hl-grid{grid-template-columns:40px minmax(0,1fr) 44px 70px 44px}
        .hl-grid > :nth-child(5),.hl-grid > :nth-child(6),.hl-grid > :nth-child(8){display:none}
        .hl-cities{display:none}
      }
    `;

    const BALL =
      '<svg class="hl-ball{on}" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#fff" stroke="#1b1b1b" stroke-width="1.4"/><path d="M1 8a7 7 0 0 1 14 0z" fill="#e3350d" stroke="#1b1b1b" stroke-width="1.4"/><path d="M1 8h14" stroke="#1b1b1b" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2" fill="#fff" stroke="#1b1b1b" stroke-width="1.4"/></svg>';

    /* ---------- janela ---------- */

    let win = null;

    function build() {
      if (win) return;

      const style = document.createElement('style');

      style.textContent = CSS;
      document.head.appendChild(style);

      win = document.createElement('div');
      win.id = 'hl-win';
      win.innerHTML = `
        <div class="hl-top" data-drag>
          <div class="hl-title">Hunts</div>
          <div class="hl-areas"></div>
          <button type="button" class="hl-x" data-close title="Fechar (Esc)">✕</button>
        </div>
        <div class="hl-here"></div>
        <div class="hl-tools">
          <label class="hl-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input type="text" data-in="q" placeholder="Buscar hunt ou loot…" autocomplete="off" spellcheck="false">
            <button type="button" class="hl-clear" data-clear-q title="Limpar busca">✕</button>
          </label>
          <div class="hl-lv">Nv <input type="text" inputmode="numeric" data-in="lo" placeholder="mín"> – <input type="text" inputmode="numeric" data-in="hi" placeholder="máx"></div>
          <div class="hl-chips"></div>
        </div>
        <div class="hl-types"></div>
        <div class="hl-head hl-grid"></div>
        <div class="hl-body"></div>
        <div class="hl-foot"><span class="hl-info"></span></div>`;
      document.body.appendChild(win);

      win.addEventListener('click', onClick);
      win.addEventListener('input', onInput);
      ['keydown', 'keyup', 'keypress'].forEach((t) =>
        win.addEventListener(t, (e) => {
          if (e.key === 'Escape' && t === 'keydown') close();

          e.stopPropagation();
        })
      );
      dragify(win.querySelector('[data-drag]'));
      place();
    }

    function place() {
      const p = ls.get('pos', null);
      const r = win.getBoundingClientRect();
      const W = r.width || Math.min(920, innerWidth * 0.96);
      const H = r.height || Math.min(760, innerHeight * 0.88);
      const x = p ? p.x : (innerWidth - W) / 2;
      const y = p ? p.y : (innerHeight - H) / 2;

      win.style.left = Math.max(0, Math.min(innerWidth - W, x)) + 'px';
      win.style.top = Math.max(0, Math.min(innerHeight - 60, y)) + 'px';
    }

    function dragify(h) {
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button,input')) return;

        const r = win.getBoundingClientRect();
        const ox = e.clientX - r.left;
        const oy = e.clientY - r.top;
        const mv = (ev) => {
          win.style.left = Math.max(0, Math.min(innerWidth - r.width, ev.clientX - ox)) + 'px';
          win.style.top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - oy)) + 'px';
        };
        const up = () => {
          removeEventListener('pointermove', mv);
          removeEventListener('pointerup', up);
          ls.set('pos', { x: parseFloat(win.style.left), y: parseFloat(win.style.top) });
        };

        addEventListener('pointermove', mv);
        addEventListener('pointerup', up);
      });
    }

    let timer = 0;

    function open() {
      build();
      win.classList.add('on');
      place();

      if (!data.hunts) loadStatic();

      loadLeader();
      loadCaught();
      lastSig = '';
      render();
      clearInterval(timer);
      timer = setInterval(render, 1500);
      setTimeout(() => win.querySelector('[data-in="q"]').focus(), 30);
    }

    function close() {
      if (!win) return;

      win.classList.remove('on');
      clearInterval(timer);
    }

    const isOpen = () => win && win.classList.contains('on');

    function toast(msg) {
      let t = document.getElementById('hl-toast');

      if (!t) {
        t = document.createElement('div');
        t.id = 'hl-toast';
        document.body.appendChild(t);
      }

      t.textContent = msg;
      t.hidden = false;
      clearTimeout(t._h);
      t._h = setTimeout(() => (t.hidden = true), 3500);
    }

    /* ---------- render ---------- */

    function sprite(h) {
      if (!h || !h.pid) return `<div class="hl-ph">${esc(((h && h.name) || '?')[0])}</div>`;

      const sh = h.shiny ? 'shiny/' : '';

      return `<img loading="lazy" src="${SPR}/versions/generation-v/black-white/animated/${sh}${h.pid}.gif" data-still="${SPR}/${sh}${h.pid}.png" alt="">`;
    }

    const typePills = (types) =>
      types.map((t) => `<span style="--c:${(TYPES[t] || ['', '#666'])[1]}">${esc((TYPES[t] || [t])[0])}</span>`).join('');

    // Tipos de ataque que acertam a hunt com vantagem (2x → 2.5x, 4x → 5.5x no jogo).
    function weakTypes(def) {
      const out = { 5.5: [], 2.5: [] };

      Object.keys(TYPES).forEach((a) => {
        let m = 1;

        def.forEach((d) => {
          const v = CHART[a] && CHART[a][d];

          if (v !== undefined) m *= v;
        });

        if (m >= 4) out[5.5].push(a);
        else if (m >= 2) out[2.5].push(a);
      });

      return out;
    }

    function myPokesVs(h) {
      if (!data.pokes || !data.cre || !h.types.length) return [];

      const best = new Map();

      data.pokes.forEach((p) => {
        const c = data.cre.byId.get(+p.speciesId) || data.cre.byName.get(norm(p.name));
        const types = c ? [c.type1, c.type2].filter(Boolean).map((t) => String(t).toLowerCase()) : [];
        let m = null;

        types.forEach((a) => {
          let x = 1;

          h.types.forEach((d) => {
            const v = CHART[a] && CHART[a][d];

            if (v !== undefined) x *= v;
          });

          if (m === null || x > m) m = x;
        });

        if (!(m >= 2)) return;

        const name = p.name || (c && c.name) || '?';
        const key = norm(name);
        const lv = +p.level || 0;
        const cur = best.get(key);

        if (!cur || lv > cur.lv) best.set(key, { name, lv, m, pid: c ? spriteId(c, name) : 0, shiny: !!p.shiny, team: !!p.team });
      });

      return [...best.values()].sort((a, b) => b.m - a.m || b.lv - a.lv).slice(0, 18);
    }

    function weakHtml(h) {
      if (!h.types.length) return '';

      const w = weakTypes(h.types);
      const pills = (arr) => `<span class="hl-mini">${typePills(arr)}</span>`;
      const mine = myPokesVs(h);

      return `<div class="hl-dh">Fraco contra</div>
        <div class="hl-wk">${
          w[5.5].length ? `<div><span class="hl-eff good">5.5x</span>${pills(w[5.5])}</div>` : ''
        }${w[2.5].length ? `<div><span class="hl-eff good">2.5x</span>${pills(w[2.5])}</div>` : ''}${
        !w[5.5].length && !w[2.5].length ? '<div class="hl-dimtxt">Nenhum tipo acerta com vantagem.</div>' : ''
      }</div>
        <div class="hl-dh">Seus Pokémon com vantagem</div>
        <div class="hl-its">${
          !data.pokes
            ? '<span class="hl-dimtxt">Carregando seus Pokémon…</span>'
            : mine
                .map(
                  (p) =>
                    `<span class="hl-it hl-pk${p.team ? ' team' : ''}" title="${p.team ? 'No time' : 'No depósito'}">${
                      p.pid ? `<img src="${SPR}/${p.shiny ? 'shiny/' : ''}${p.pid}.png" alt="">` : ''
                    }${esc(p.name)} <small>Nv ${p.lv}</small><b class="hl-eff good">${effLabel(p.m)}x</b></span>`
                )
                .join('') || '<span class="hl-dimtxt">Nenhum dos seus Pokémon tem vantagem aqui.</span>'
        }</div>`;
    }

    function rowHtml(h, ctx) {
      const locked = ctx.tl > 0 && h.level > ctx.tl;
      const caught = h.c && data.caughtIds.has(+h.c.pokeId);
      const e = effOf(h.types);
      const fav = st.favs.has(h.slug);
      const open = st.loot.has(h.slug);
      const here = ctx.here && ctx.here.slug === h.slug;
      const going = st.going === h.slug;

      const loot = open
        ? `<div class="hl-loot">${weakHtml(h)}<div class="hl-dh">Loot</div><div class="hl-its">${
            h.loot
              .map((l) => {
                const ic = data.items.get(norm(l.name));
                const pct =
                  l.chance > 0 ? (l.chance / 1000).toLocaleString('pt-BR', { maximumFractionDigits: l.chance < 1000 ? 2 : 1 }) + '%' : '';

                return `<span class="hl-it">${ic ? `<img src="${esc(ic)}" alt="">` : ''}${esc(l.name)}${pct ? ` <small>${pct}</small>` : ''}</span>`;
              })
              .join('') || '<span class="hl-it">Sem loot</span>'
          }</div></div>`
        : '';

      return `<div class="hl-row hl-grid${here ? ' here' : ''}${locked ? ' locked' : ''}" data-slug="${esc(h.slug)}" title="${
        locked ? 'Requer nível ' + h.level : 'Viajar para ' + esc(h.name)
      }">
          <div class="hl-spr">${sprite(h)}</div>
          <div class="hl-main">
            <div class="hl-name">${BALL.replace('{on}', caught ? ' on' : '')}<span class="t">${esc(h.name)}</span><span class="hl-mini">${typePills(h.types)}</span>${
        here ? '<span class="hl-tag">aqui</span>' : going ? '<span class="hl-go" style="opacity:1">Viajando…</span>' : locked ? '' : '<span class="hl-go">Viajar →</span>'
      }</div>
          </div>
          <div class="hl-num dim">${locked ? '🔒 ' : ''}${h.level}</div>
          <div class="hl-num xp">${h.xp ? fmt(h.xp) : '—'}</div>
          <div class="hl-num gold" title="${h.gold ? '$ ' + fmt(h.gold) : ''}">${h.gold ? '$ ' + short(h.gold) : '—'}</div>
          <div class="hl-num dim" title="Total de atributos base">${h.total || '—'}</div>
          <span class="hl-eff ${e == null ? '' : e > 1 ? 'good' : e < 1 ? 'bad' : ''}">${e == null ? '—' : effLabel(e) + 'x'}</span>
          <div class="hl-acts">
            <button type="button" class="hl-ib more${open ? ' on' : ''}" data-more title="Fraquezas e loot">▾</button>
            <button type="button" class="hl-ib fav${fav ? ' on' : ''}" data-fav title="Favorita">${fav ? '★' : '☆'}</button>
          </div>
        </div>${loot}`;
    }

    let lastSig = '';

    function render() {
      if (!isOpen()) return;

      const H = hud();
      const here = hereHunt(H.loc);
      const ctx = { tl: H.tl, here };
      const sig = [H.tl, here && here.slug, data.ver, st.ver, st.q, st.lo, st.hi, st.area].join('|');

      if (sig === lastSig) return;

      lastSig = sig;

      const q = (s) => win.querySelector(s);

      q('.hl-areas').innerHTML = AREAS.map(([k, label]) => {
        const min = data.areaMin ? data.areaMin[k] : 0;
        const lockd = H.tl && min > H.tl;

        return `<button type="button" data-area="${k}" class="${st.area === k ? 'on' : ''}">${label}${lockd ? ` <small>🔒 ${min}</small>` : ''}</button>`;
      }).join('');

      if (!data.hunts) {
        q('.hl-body').innerHTML = '<div class="hl-empty">Carregando hunts…</div>';

        return;
      }

      const inArea = data.hunts.filter((h) => h.area === st.area);
      const cities = inArea.filter((h) => h.city);

      const ld = data.leader;
      const lv = (n) => (n ? ' <span class="hl-num dim" style="font-size:12px">· Nv ' + n + '</span>' : '');

      q('.hl-here').innerHTML = `
        <div class="hl-side">
          <div class="hl-spr hl-flip">${ld && ld.name ? sprite(ld) : '<div class="hl-ph">?</div>'}</div>
          <div><div class="lbl">Seu Pokémon</div><div class="nm">${ld && ld.name ? esc(ld.name) + lv(ld.level) : '—'}</div></div>
        </div>
        <div class="hl-vs" title="${here && !here.city ? 'Caçando' : 'Na cidade'}">${
          here && !here.city
            ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4"/><path d="m7 17-3 3"/><path d="m3 19 2 2"/></svg>'
            : '<span style="font-size:18px">📍</span>'
        }</div>
        <div class="hl-side">
          <div class="hl-spr">${here && !here.city ? sprite(here) : '<div class="hl-ph">🏙</div>'}</div>
          <div><div class="lbl">${here && !here.city ? 'Caçando' : 'Você está em'}</div><div class="nm">${
        here ? esc(here.name) + (here.city ? '' : lv(here.level)) : esc(H.loc || '—')
      }</div></div>
          ${
            here && !here.city && effOf(here.types) != null
              ? (() => {
                  const e = effOf(here.types);

                  return `<span class="hl-eff ${e > 1 ? 'good' : e < 1 ? 'bad' : ''}" title="Vantagem do seu Pokémon">${effLabel(e)}x</span>`;
                })()
              : ''
          }
        </div>
        <div class="hl-cities">${cities
          .map((h) => `<button type="button" class="hl-chip${here && here.slug === h.slug ? ' here' : ''}" data-city="${esc(h.slug)}">🏙 ${esc(h.name)}</button>`)
          .join('')}</div>`;

      const capLbl = st.caught === 'yes' ? 'Capturados' : st.caught === 'no' ? 'Não capturados' : 'Captura';

      q('.hl-chips').innerHTML = `
        <button type="button" class="hl-chip${st.open ? ' on' : ''}" data-f="open" title="Só hunts até o seu nível">Acessíveis</button>
        <button type="button" class="hl-chip${st.favOnly ? ' on' : ''}" data-f="fav">★ Favoritas</button>
        <button type="button" class="hl-chip${st.caught ? ' on' : ''}" data-f="caught" title="Alterna: não capturados → capturados → todos">${BALL.replace('{on}', ' on')} ${capLbl}</button>`;

      let list = inArea.filter((h) => !h.city);
      const present = Object.keys(TYPES).filter((t) => list.some((h) => h.types.includes(t)));

      q('.hl-types').innerHTML =
        present
          .map((t) => `<button type="button" class="hl-tp${st.types.has(t) ? ' on' : ''}" data-type="${t}" style="--c:${TYPES[t][1]}">${TYPES[t][0]}</button>`)
          .join('') + (st.types.size ? '<button type="button" class="hl-chip" data-f="clear" style="height:22px">Limpar</button>' : '');

      const nq = norm(st.q);

      if (nq) list = list.filter((h) => norm(h.name).includes(nq) || h.loot.some((l) => norm(l.name).includes(nq)));
      if (st.lo != null) list = list.filter((h) => h.level >= st.lo);
      if (st.hi != null) list = list.filter((h) => h.level <= st.hi);
      if (st.open && H.tl) list = list.filter((h) => h.level <= H.tl);
      if (st.favOnly) list = list.filter((h) => st.favs.has(h.slug));
      if (st.types.size) list = list.filter((h) => h.types.some((t) => st.types.has(t)));
      if (st.caught) list = list.filter((h) => !!(h.c && data.caughtIds.has(+h.c.pokeId)) === (st.caught === 'yes'));

      const key = {
        name: (h) => h.name,
        level: (h) => h.level,
        xp: (h) => h.xp,
        gold: (h) => h.gold,
        total: (h) => h.total,
        eff: (h) => effOf(h.types) ?? -1
      }[st.sort.k];

      list.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        const r = typeof x === 'string' ? x.localeCompare(y) : x - y;

        return (r || a.level - b.level) * st.sort.d;
      });

      const col = (k, label, cls = '') =>
        `<div class="${cls}${st.sort.k === k ? ' on' : ''}" data-sort="${k}">${label}${st.sort.k === k ? (st.sort.d > 0 ? ' ↑' : ' ↓') : ''}</div>`;

      q('.hl-head').innerHTML = `<div></div>${col('name', 'Hunt', 'l')}${col('level', 'Nv')}${col('xp', 'XP')}${col('gold', 'Valor')}${col('total', 'Total')}${col('eff', 'Vant.')}<div></div>`;

      const favs = list.filter((h) => st.favs.has(h.slug));
      const rest = list.filter((h) => !st.favs.has(h.slug));
      const body = q('.hl-body');
      const keep = body.scrollTop;

      body.innerHTML = list.length
        ? (favs.length
            ? '<div class="hl-sep">★ Favoritas</div>' + favs.map((h) => rowHtml(h, ctx)).join('') + (rest.length ? '<div class="hl-sep">Todas</div>' : '')
            : '') + rest.map((h) => rowHtml(h, ctx)).join('')
        : '<div class="hl-empty">Nenhuma hunt com esses filtros.</div>';
      body.scrollTop = keep;

      win.querySelectorAll('.hl-spr img').forEach((img) => {
        img.onerror = () => {
          if (img.dataset.still && img.src !== img.dataset.still) img.src = img.dataset.still;
          else img.replaceWith(Object.assign(document.createElement('div'), { className: 'hl-ph', textContent: '?' }));
        };
      });

      const lead = data.leader && data.leader.types.length ? data.leader : null;

      q('.hl-info').innerHTML =
        `${list.length} hunts` +
        (H.tl ? ` · seu nível ${H.tl}` : '') +
        (lead ? ` · vantagem calculada para <b style="color:var(--tx)">${esc(lead.name)}</b> <span class="hl-mini" style="display:inline-flex;vertical-align:middle">${typePills(lead.types)}</span>` : '');
    }

    /* ---------- eventos ---------- */

    function onInput(e) {
      const k = e.target.dataset.in;

      if (!k) return;

      const v = e.target.value.trim();

      if (k === 'q') {
        st.q = v;
        win.querySelector('.hl-search').classList.toggle('has', v !== '');
      } else st[k] = v === '' || isNaN(+v) ? null : +v;

      render();
    }

    function onClick(e) {
      const t = e.target;
      const g = (s) => t.closest(s);

      if (g('[data-close]')) return close();

      if (g('[data-clear-q]')) {
        const inp = win.querySelector('[data-in="q"]');

        inp.value = '';
        st.q = '';
        win.querySelector('.hl-search').classList.remove('has');
        inp.focus();
        render();

        return;
      }

      const area = g('[data-area]');
      const f = g('[data-f]');
      const tp = g('[data-type]');
      const so = g('[data-sort]');
      const city = g('[data-city]');
      const row = g('.hl-row');

      if (area) {
        st.area = area.dataset.area;
        ls.set('area', st.area);
        win.querySelector('.hl-body').scrollTop = 0;
      } else if (f) {
        const k = f.dataset.f;

        if (k === 'open') ls.set('open', (st.open = !st.open));
        if (k === 'fav') st.favOnly = !st.favOnly;
        if (k === 'caught') ls.set('caught', (st.caught = st.caught === '' ? 'no' : st.caught === 'no' ? 'yes' : ''));
        if (k === 'clear') st.types.clear();

        ls.set('types', [...st.types]);
      } else if (tp) {
        const k = tp.dataset.type;

        st.types.has(k) ? st.types.delete(k) : st.types.add(k);
        ls.set('types', [...st.types]);
      } else if (so) {
        const k = so.dataset.sort;

        st.sort = st.sort.k === k ? { k, d: -st.sort.d } : { k, d: k === 'level' || k === 'name' ? 1 : -1 };
        ls.set('sort', st.sort);
      } else if (city) {
        travel(city.dataset.city);

        return;
      } else if (row) {
        const slug = row.dataset.slug;

        if (g('[data-fav]')) {
          st.favs.has(slug) ? st.favs.delete(slug) : st.favs.add(slug);
          ls.set('favs', [...st.favs]);
        } else if (g('[data-more]')) {
          st.loot.has(slug) ? st.loot.delete(slug) : st.loot.add(slug);
        } else {
          if (!row.classList.contains('locked')) travel(slug);

          return;
        }
      } else {
        return;
      }

      st.ver++;
      render();
    }

    /* ---------- botão Mapa do jogo ---------- */

    let passNative = false;

    function nativeMap() {
      const b = document.querySelector('[data-guide="dock-map"]');

      if (!b) return;

      passNative = true;
      b.click();
      passNative = false;
    }

    document.addEventListener(
      'click',
      (e) => {
        const b = e.target.closest && e.target.closest('[data-guide="dock-map"]');

        if (!b || passNative || e.altKey) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        isOpen() ? close() : open();
      },
      true
    );

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && isOpen()) close();
      },
      true
    );

    const boot = () => {
      loadStatic();
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
    /* ---------- menu compacto ---------- */

    (() => {
      const ICON_SIZE = 76;
      const GAP = 8;
      const COLS = 4;
      const PANEL_PAD = 14;
      const PANEL_WIDTH = COLS * ICON_SIZE + (COLS - 1) * GAP + PANEL_PAD * 2;

      // Limpeza defensiva: remove qualquer botão fantasma de versão antiga do script
      // que ainda esteja solto no DOM (id usado em tentativas anteriores).
      (function cleanupLegacyButton() {
        const legacy = document.getElementById('hlm-permanent-market');
        if (legacy) legacy.remove();
      })();

      const CSS = `
        .hlm-fab {
          position: fixed; right: 16px; bottom: 16px;
          width: 44px; height: 44px; border-radius: 12px; padding: 0; box-sizing: border-box;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(180deg, #1b1f31, #12141f); border: 1px solid #3a4060; color: #f2ead0;
          z-index: 99998; cursor: pointer; box-shadow: 0 10px 28px rgba(0,0,0,.55);
          transition: border-color .15s;
        }
        .hlm-fab:hover { border-color: #8b93b8; }
        .hlm-fab svg { width: 20px; height: 20px; display: block; }
        .market-cta { margin-right: 62px !important; bottom: 16px !important; }
        .hlm-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.6);
          z-index: 99999; display: none; align-items: flex-end;
          justify-content: flex-end; padding: 16px; box-sizing: border-box;
        }
        .hlm-overlay.open { display: flex; }
        .hlm-panel {
          background: #10131f; border: 1px solid #2a2f45; border-radius: 14px;
          width: ${PANEL_WIDTH}px; max-height: calc(100vh - 32px); overflow: hidden;
          display: flex; flex-direction: column;
          box-shadow: 0 8px 30px rgba(0,0,0,.6); box-sizing: border-box;
        }
        .hlm-head {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 10px 14px; border-bottom: 1px solid #2a2f45; background: #151a2a;
          flex-shrink: 0;
        }
        .hlm-head h3 {
          margin: 0; font-size: 13px; letter-spacing: .08em; text-transform: uppercase;
          color: #f4b942; font-weight: 700; white-space: nowrap;
        }
        .hlm-head-actions { display: flex; align-items: center; gap: 6px; }
        .hlm-edit-btn {
          background: #1e2438; border: 1px solid #2a2f45; color: #c7cbe0;
          font-size: 11px; font-weight: 600; border-radius: 6px; padding: 5px 9px;
          cursor: pointer; white-space: nowrap;
        }
        .hlm-edit-btn:hover { border-color: #f4b942; }
        .hlm-panel.editing .hlm-edit-btn { background: #f4b942; border-color: #f4b942; color: #10131f; }
        .hlm-close { background: none; border: none; color: #8a90ab; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 2px; }
        .hlm-close:hover { color: #fff; }
        .hlm-hint {
          display: none; padding: 6px 14px; font-size: 11px; color: #f4b942;
          background: #1a1d2e; border-bottom: 1px solid #2a2f45; flex-shrink: 0;
        }
        .hlm-panel.editing .hlm-hint { display: block; }
        .hlm-body { padding: ${PANEL_PAD}px; overflow-y: auto; overflow-x: hidden; box-sizing: border-box; position: relative; }
        .hlm-body::-webkit-scrollbar { width: 6px; }
        .hlm-body::-webkit-scrollbar-thumb { background: #2a2f45; border-radius: 3px; }
        .hlm-body::-webkit-scrollbar-track { background: transparent; }
        .hlm-row { display: grid; grid-template-columns: repeat(${COLS}, ${ICON_SIZE}px); gap: ${GAP}px; }
        .hlm-sep {
          display: flex; align-items: center; gap: 8px; color: #6b7190;
          font-size: 10px; text-transform: uppercase; letter-spacing: .08em; margin: 12px 0;
        }
        .hlm-sep::before, .hlm-sep::after { content: ''; flex: 1; height: 1px; background: #2a2f45; }
        .hlm-item {
          position: relative; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 5px; width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;
          background: #171c2c; border: 1px solid #2a2f45; border-radius: 10px; cursor: pointer;
          color: #c7cbe0; font-size: 10px; font-weight: 600; text-align: center;
          padding: 6px 4px; box-sizing: border-box; transition: border-color .12s, background .12s;
          user-select: none;
        }
        .hlm-item:hover, .hlm-item.hlm-hover { background: #1e2438; border-color: #3a4060; }
        .hlm-item.pinned { border-color: rgba(244,185,66,.6); background: rgba(244,185,66,.1); color: #f4d58a; }
        .hlm-item.pinned:hover, .hlm-item.pinned.hlm-hover { background: rgba(244,185,66,.10); border-color: #8a7a52; }
        .hlm-item img, .hlm-item svg { width: 30px; height: 30px; object-fit: contain; flex-shrink: 0; pointer-events: none; }
        .hlm-item span {
          line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; overflow: hidden; pointer-events: none;
        }
        .hlm-badge {
          position: absolute; top: -4px; right: -4px; background: #d33; color: #fff;
          border-radius: 10px; font-size: 9px; font-weight: 700; padding: 1px 5px;
          pointer-events: none; border: 1px solid #10131f;
        }
      `;

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const isPokeBtn = (btn) => {
        const t = (btn.getAttribute('title') || '').trim();
        const g = btn.getAttribute('data-guide') || '';

        return /^pok[eé]mons?$/i.test(t) || /^dock-pok(e|es|emon|emons)$/i.test(g);
      };

      // O botão "Pokémon" abre um submenu; acha a opção pelo texto.
      function findOpt(label) {
        const rx = new RegExp('^\\s*' + label + '\\s*$', 'i');
        const ok = (el) => !el.closest('.hlm-overlay') && rx.test(el.textContent);

        return (
          Array.from(document.querySelectorAll('button, [role="button"], a')).find(ok) ||
          Array.from(document.querySelectorAll('li, div')).find(el => el.children.length <= 2 && ok(el)) ||
          null
        );
      }

      async function openPokeSub(btn, label) {
        let opt = findOpt(label);

        if (!opt) {
          btn.click();

          for (let i = 0; i < 30 && !opt; i++) {
            await sleep(50);
            opt = findOpt(label);
          }
        }

        if (opt) opt.click();
      }

      // pega os itens do dock; o "Pokémon" vira "My Pokes" e "All Rare Pokes"
      function collectEntries(dock) {
        const entries = [];

        Array.from(dock.querySelectorAll('button.dock-btn')).forEach(btn => {
          const img = btn.querySelector('img');
          const svg = btn.querySelector('svg');
          const iconHtml = img ? `<img src="${img.src}" alt="">` : svg ? svg.outerHTML : '';
          const badgeText = btn.querySelector('.dock-badge')?.textContent || null;

          if (isPokeBtn(btn)) {
            entries.push({ guide: 'pokes-my', label: 'My Pokes', iconHtml, badgeText, trigger: () => openPokeSub(btn, 'My Pokes') });
            entries.push({ guide: 'pokes-rare', label: 'All Rare Pokes', iconHtml, badgeText: null, trigger: () => openPokeSub(btn, 'All Rare Pokes') });
            return;
          }

          entries.push({
            guide: btn.getAttribute('data-guide') || btn.getAttribute('title') || btn.textContent.trim(),
            label: /picture.?in.?picture/i.test(btn.getAttribute('title') || btn.textContent) ? 'Picture in Picture' : btn.getAttribute('title') || btn.textContent.trim(),
            iconHtml,
            badgeText,
            trigger: () => btn.click()
          });
        });

        return entries;
      }

      function build() {
        const dock = document.querySelector('.game-dock');
        if (!dock) return false;

        dock.style.position = 'fixed';
        dock.style.left = '-9999px';

        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        const fab = document.createElement('button');
        fab.className = 'hlm-fab';
        fab.type = 'button';
        fab.title = 'Menu';
        fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1.6"/><rect x="14" y="4" width="6" height="6" rx="1.6"/><rect x="4" y="14" width="6" height="6" rx="1.6"/><rect x="14" y="14" width="6" height="6" rx="1.6"/></svg>';

        const overlay = document.createElement('div');
        overlay.className = 'hlm-overlay';

        const panel = document.createElement('div');
        panel.className = 'hlm-panel';

        const head = document.createElement('div');
        head.className = 'hlm-head';
        const title = document.createElement('h3');
        title.textContent = 'Menu';
        const actions = document.createElement('div');
        actions.className = 'hlm-head-actions';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'hlm-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        actions.appendChild(closeBtn);
        head.appendChild(title);
        head.appendChild(actions);

        const body = document.createElement('div');
        body.className = 'hlm-body';
        const allRow = document.createElement('div');
        allRow.className = 'hlm-row hlm-all-row';
        body.appendChild(allRow);

        panel.appendChild(head);
        panel.appendChild(body);
        overlay.appendChild(panel);

        function render() {
          allRow.innerHTML = '';

          collectEntries(dock).forEach(entry => {
            const item = document.createElement('div');
            item.className = 'hlm-item';
            item.innerHTML = `${entry.iconHtml}<span>${entry.label}</span>`;

            if (entry.badgeText) {
              const b = document.createElement('span');
              b.className = 'hlm-badge';
              b.textContent = entry.badgeText;
              item.appendChild(b);
            }

            item.addEventListener('click', () => {
              entry.trigger();
              overlay.classList.remove('open');
            });

            allRow.appendChild(item);
          });
        }

        closeBtn.addEventListener('click', () => {
          overlay.classList.remove('open');
        });

        // sempre que o overlay abrir, re-renderiza
        fab.addEventListener('click', () => {
          const opening = !overlay.classList.contains('open');
          overlay.classList.toggle('open');
          if (opening) render();
        });

        render();

        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            overlay.classList.remove('open');
          }
        });

        document.body.appendChild(fab);
        document.body.appendChild(overlay);

        // Se o script antigo "PokeIdle - Menu Compacto" ainda estiver ativo, some com o botão dele.
        const killOld = () => document.querySelectorAll('.pi-fab, .pi-overlay').forEach((el) => el.remove());

        killOld();
        setInterval(killOld, 1000);

        return true;
      }

      const interval = setInterval(() => {
        if (build()) clearInterval(interval);
      }, 500);
    })();

    /* ---------- chat ---------- */

    (() => {
      // Chat acima do botão "Alertas" do LiveSearch.
      const st = document.createElement('style');

      st.textContent = '.chat-box,.chat-fab{left:16px!important;bottom:68px!important}';
      (document.head || document.documentElement).appendChild(st);

      // Começa minimizado (uma vez por carregamento; depois respeita o que você fizer).
      const iv = setInterval(() => {
        const min = document.querySelector('.chat-box .chat-min');

        if (!min) return;

        clearInterval(iv);
        min.click();
      }, 500);

      setTimeout(() => clearInterval(iv), 60000);

      // Largura inicial de 450px; depois o redimensionamento continua livre.
      const widened = new WeakSet();

      setInterval(() => {
        const box = document.querySelector('.chat-box');

        if (!box || widened.has(box) || !box.offsetWidth) return;

        widened.add(box);
        box.style.width = '450px';
      }, 500);
    })();

    /* ---------- auto-helper (só visual) ---------- */

    (() => {
      const st = document.createElement('style');

      st.textContent = `
        .ah-panel .ah-head{all:unset;box-sizing:border-box;cursor:pointer;user-select:none;-webkit-user-drag:none;position:relative;z-index:2147483641;display:inline-flex;align-items:center;gap:6px;height:44px;padding:0 14px;border-radius:12px;
          background:linear-gradient(180deg,#1b1f31,#12141f);border:1px solid #3a4060;color:#f2ead0;font:700 13px/1 Inter,Barlow,system-ui,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.55)}
        .ah-panel .ah-head:hover{border-color:#8b93b8}

        .ah-overlay{background:rgba(0,0,0,.3)!important;backdrop-filter:none!important}
        .ah-modal{--bg:#0c141b;--panel:#101a23;--row:#121e28;--row2:#172633;--line:#1b2b38;--tx:#e3eaf1;--dim:#768a9c;--on:#57d38c;
          width:280px!important;max-width:94vw!important;padding:0!important;background:var(--bg)!important;color:var(--tx)!important;
          border:1px solid #223444!important;border-radius:12px!important;box-shadow:0 18px 50px rgba(0,0,0,.55)!important;overflow:hidden!important;
          font:12px/1.3 Inter,Barlow,system-ui,sans-serif!important}
        .ah-modal *{font-family:inherit!important;box-sizing:border-box}

        .ah-modal .ah-modal-title{display:flex!important;align-items:center!important;justify-content:space-between!important;margin:0!important;
          padding:8px 8px 8px 12px!important;border-bottom:1px solid var(--line)!important;background:none!important}
        .ah-modal .ah-modal-title span{font-size:13px!important;font-weight:800!important;letter-spacing:.01em!important;text-transform:none!important;color:var(--tx)!important;font-variant:normal!important}
        .ah-modal .ah-modal-close{all:unset;cursor:pointer;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:13px}
        .ah-modal .ah-modal-close:hover{background:var(--row2);color:var(--tx)}

        .ah-modal .ah-body{display:flex!important;flex-direction:column!important;gap:6px!important;padding:8px!important;max-height:80vh;overflow-y:auto;
          scrollbar-width:thin;scrollbar-color:#253a4b transparent}

        .ah-modal .ah-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;
          margin:0!important;padding:7px 10px!important;border-radius:8px!important;background:var(--row)!important;border:1px solid var(--line)!important;
          box-shadow:none!important;cursor:pointer;transition:border-color .12s}
        .ah-modal .ah-row:hover{border-color:#2c4658!important}
        .ah-modal .ah-row:has(+ .ah-sub),.ah-modal .ah-row:has(+ .ah-warn){border-bottom-left-radius:0!important;border-bottom-right-radius:0!important}
        .ah-modal .ah-row .ah-label{order:1;flex:1;display:flex!important;align-items:center!important;gap:7px!important;font-size:12.5px!important;font-weight:700!important;color:var(--tx)!important;white-space:nowrap}
        .ah-modal .ah-label-ico{width:16px!important;height:16px!important;object-fit:contain;image-rendering:pixelated}
        .ah-modal .ah-row .ah-hint{display:none!important}
        .ah-modal .ah-row:not(.on) .ah-label{color:var(--dim)!important}

        .ah-modal .ah-row input[type=checkbox]{order:2;flex:none;-webkit-appearance:none;appearance:none;margin:0!important;position:relative;
          width:28px;height:16px;border-radius:8px;background:#22313e;border:none;cursor:pointer;transition:background .15s}
        .ah-modal .ah-row input[type=checkbox]::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#8093a4;transition:transform .15s,background .15s}
        .ah-modal .ah-row input[type=checkbox]:checked{background:var(--on)}
        .ah-modal .ah-row input[type=checkbox]:checked::after{transform:translateX(12px);background:#0c1f14}

        .ah-modal .ah-sub{margin:-6px 0 0!important;padding:7px 10px 8px!important;background:#0a1117!important;border:1px solid var(--line)!important;border-top:none!important;
          border-radius:0 0 8px 8px!important;display:flex!important;flex-direction:column!important;gap:6px!important;transition:opacity .15s}
        .ah-modal .ah-row:not(.on) + .ah-sub{opacity:.4}
        .ah-modal .ah-sub:not(.ah-row + .ah-sub){margin-top:0!important;border-top:1px solid var(--line)!important;border-radius:8px!important}

        .ah-modal .ah-field{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;margin:0!important;font-size:11px!important;color:var(--dim)!important}
        .ah-modal .ah-field-col{flex-direction:column!important;align-items:stretch!important;gap:5px!important}
        .ah-modal .ah-field > span{color:var(--dim)!important;font-size:10px!important;font-weight:700!important;letter-spacing:.06em!important;text-transform:uppercase!important;white-space:nowrap}
        .ah-modal .ah-field .ah-hint{font-size:10px!important;color:#5c7082!important;margin:0!important}

        .ah-modal .ah-sel,.ah-modal .ah-input{height:26px!important;padding:0 8px!important;border-radius:6px!important;background:var(--panel)!important;border:1px solid var(--line)!important;
          color:var(--tx)!important;font-size:11.5px!important;outline:none!important;box-shadow:none!important}
        .ah-modal .ah-sel{flex:1;max-width:160px;min-width:0;cursor:pointer}
        .ah-modal .ah-sel:focus,.ah-modal .ah-input:focus{border-color:#35526a!important}
        .ah-modal .ah-input::placeholder{color:#4f6273}

        .ah-modal .ah-balls{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:4px!important;margin:0!important}
        .ah-modal .cap-chip{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;height:44px;border-radius:7px;
          background:var(--row);border:1px solid var(--line);color:var(--dim);font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums}
        .ah-modal .cap-chip:hover{border-color:#2c4658;color:var(--tx)}
        .ah-modal .cap-chip.on{background:var(--row2);border-color:#4a6a82;color:var(--tx)}
        .ah-modal .cap-chip-ico{width:24px!important;height:24px!important;object-fit:contain;image-rendering:pixelated}
        .ah-modal .cap-chip-ico[src*="idleball"]{width:18px!important;height:18px!important;margin:3px 0!important}

        .ah-modal .ah-warn{margin:-6px 0 0!important;padding:5px 10px!important;border:1px solid var(--line)!important;border-top:none!important;border-radius:0 0 8px 8px!important;
          background:rgba(239,106,106,.08)!important;color:#f0a0a0!important;font-size:10.5px!important}
      `;
      (document.head || document.documentElement).appendChild(st);

      // Botão do Auto-Helper sempre à esquerda do card do Daily Kill, alinhado pela base.
      // Move só o botão com "translate", sem tirar ele do lugar no layout do jogo.
      const place = () => {
        const head = document.querySelector('.ah-panel .ah-head');

        if (!head) return;

        const tr = (head.style.translate || '').match(/-?[\d.]+/g);
        const cur = { x: tr ? +tr[0] || 0 : 0, y: tr ? +tr[1] || 0 : 0 };
        const r = head.getBoundingClientRect();
        const nat = { l: r.left - cur.x, r: r.right - cur.x, t: r.top - cur.y, b: r.bottom - cur.y };
        const dkEl = document.querySelector('#pdk-root .pdk-card, #mtal-dk .dk-card');
        const d = dkEl && dkEl.getBoundingClientRect();
        let want = { x: 0, y: 0 };

        if (d && d.width) {
          want = { x: Math.round(d.left - 12 - nat.r), y: Math.round(d.bottom - nat.b) };
        } else {
          want = { x: 0, y: Math.round(innerHeight - 16 - nat.b) };
        }

        // nunca fora da tela
        want.x = Math.max(-nat.l + 8, Math.min(innerWidth - 8 - nat.r, want.x));
        want.y = Math.max(-nat.t + 8, Math.min(innerHeight - 8 - nat.b, want.y));

        if (want.x !== cur.x || want.y !== cur.y) head.style.translate = want.x + 'px ' + want.y + 'px';
      };

      setInterval(place, 500);
      addEventListener('resize', place);
    })();

    /* ---------- hunt analyzer (só visual) ---------- */

    (() => {
      const st = document.createElement('style');

      st.textContent = `
        .ha-window.ha-window{--bg:#0c141b;--panel:#101a23;--row:#121e28;--row2:#172633;--line:#1b2b38;--tx:#e3eaf1;--dim:#768a9c;--ok:#57d38c;--bad:#ef6a6a;--xp:#9ec9ff;--gold:#e8c46a;
          width:320px!important;min-width:0!important;padding:0!important;background:var(--bg)!important;color:var(--tx)!important;
          border:1px solid #223444!important;border-radius:12px!important;box-shadow:0 18px 50px rgba(0,0,0,.55)!important;overflow:hidden!important;
          font:12px/1.3 Inter,Barlow,system-ui,sans-serif!important}
        .ha-window.ha-window *{font-family:inherit!important;box-sizing:border-box}
        .ha-window.ha-window::before,.ha-window.ha-window::after{display:none!important}

        .ha-window.ha-window .ha-hex-bg,.ha-window.ha-window .ha-hex-rail,.ha-window.ha-window .ha-hex-cap,.ha-window.ha-window .ha-gem{display:none!important}
        .ha-window.ha-window .ha-head{position:relative!important;display:flex!important;align-items:center!important;gap:6px!important;height:auto!important;min-height:0!important;
          margin:0!important;padding:8px 8px 8px 12px!important;background:none!important;border:none!important;border-bottom:1px solid var(--line)!important;box-shadow:none!important;cursor:move}
        .ha-window.ha-window .ha-title{flex:1 1 auto!important;min-width:0;position:static!important;transform:none!important;left:auto!important;right:auto!important;width:auto!important;
          justify-content:flex-start!important;text-align:left!important;display:flex!important;align-items:center!important;gap:7px!important;margin:0!important;padding:0!important;
          font-size:13px!important;font-weight:800!important;letter-spacing:.01em!important;text-transform:none!important;font-variant:normal!important;color:var(--tx)!important;text-shadow:none!important;background:none!important}
        .ha-window.ha-window .ha-title-txt{color:var(--tx)!important;background:none!important;-webkit-text-fill-color:currentColor!important;text-shadow:none!important}
        .ha-window.ha-window .ha-title-ico{width:14px!important;height:14px!important;margin:0!important;position:static!important}
        .ha-window.ha-window .ha-head{justify-content:flex-start!important;text-align:left!important}
        .ha-window.ha-window .ha-head .ha-title,.ha-window.ha-window .ha-head .ha-title-txt{margin:0!important;padding:0!important;left:auto!important;right:auto!important;transform:none!important}
        .ha-window.ha-window .ha-head button{position:static!important;transform:none!important;top:auto!important;margin:0!important;translate:none!important;box-shadow:none!important}
        .ha-window.ha-window .ha-clear,.ha-window.ha-window .ha-x,.ha-window.ha-window .ha-mode{all:unset;position:static!important;cursor:pointer;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;
          color:#b9c8d6;font-size:14px;filter:none;opacity:1;flex:none!important}
        .ha-window.ha-window .ha-head > button:first-of-type{margin-left:auto!important}
        .ha-window.ha-window .ha-x{font-size:18px}
        .ha-window.ha-window .ha-mode svg{width:16px;height:16px}
        .ha-window.ha-window .ha-mode{filter:none}
        .ha-window.ha-window .ha-mode svg{pointer-events:none}
        .ha-window.ha-window .ha-clear:hover,.ha-window.ha-window .ha-x:hover,.ha-window.ha-window .ha-mode:hover{background:var(--row2);color:var(--tx);opacity:1}
        .ha-window.ha-window .ha-clear:hover{filter:none}

        .ha-window.ha-window .ha-body{display:flex!important;flex-direction:column!important;gap:6px!important;padding:8px!important;background:none!important;max-height:none}
        .ha-window.ha-window .ha-sub{margin:0!important;padding:0 2px!important;text-align:left!important;font-size:10px!important;font-weight:700!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:var(--dim)!important}

        .ha-window.ha-window .ha-grid{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:4px!important;margin:0!important}
        .ha-window.ha-window .ha-card{min-width:0!important;display:flex!important;align-items:center!important;gap:8px!important;min-height:0!important;margin:0!important;padding:7px 8px!important;
          background:var(--row)!important;border:1px solid var(--line)!important;border-radius:8px!important;box-shadow:none!important}
        .ha-window.ha-window .ha-card-ico{flex:none;width:18px!important;height:18px!important;display:flex!important;align-items:center;justify-content:center;font-size:13px!important;
          background:none!important;border:none!important;box-shadow:none!important;margin:0!important;padding:0!important;opacity:.85}
        .ha-window.ha-window .ha-card-ico img,.ha-window.ha-window .ha-ball{width:16px!important;height:16px!important}
        .ha-window.ha-window .ha-card > div{min-width:0;overflow:hidden;display:flex;flex-direction:column}
        .ha-window.ha-window .ha-card b{font-size:13px!important;font-weight:700!important;color:var(--tx)!important;font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:none!important}
        .ha-window.ha-window .ha-card small{font-size:10px!important;color:var(--dim)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ha-window.ha-window .ha-xp b{color:var(--xp)!important}
        .ha-window.ha-window .ha-loot b{color:var(--ok)!important}
        .ha-window.ha-window .ha-supply b{color:var(--bad)!important}
        .ha-window.ha-window .ha-catch b{color:var(--gold)!important}

        .ha-window.ha-window .ha-balance{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;margin:0!important;padding:8px 10px!important;
          background:var(--row)!important;border:1px solid var(--line)!important;border-radius:8px!important;box-shadow:none!important}
        .ha-window.ha-window .ha-balance span{white-space:nowrap;font-size:10.5px!important;color:var(--dim)!important;font-weight:600!important}
        .ha-window.ha-window .ha-balance b{font-size:15px!important;font-weight:800!important;font-variant-numeric:tabular-nums;text-shadow:none!important}
        .ha-window.ha-window .ha-balance.pos b{color:var(--ok)!important}
        .ha-window.ha-window .ha-balance.neg b,.ha-window.ha-window .ha-balance:not(.pos) b{color:var(--bad)!important}
        .ha-window.ha-window .ha-balance.pos{background:linear-gradient(90deg,rgba(87,211,140,.08),transparent)!important}

        .ha-window.ha-window .ha-rates{display:flex!important;gap:4px!important;margin:0!important}
        .ha-window.ha-window .ha-rate{flex:1 1 auto;display:flex!important;align-items:center!important;justify-content:center!important;gap:4px;height:24px;padding:0 6px!important;margin:0!important;
          background:var(--row)!important;border:1px solid var(--line)!important;border-radius:6px!important;font-size:10.5px!important;font-weight:700!important;color:var(--dim)!important;
          white-space:nowrap;overflow:hidden;font-variant-numeric:tabular-nums;box-shadow:none!important}
        .ha-window.ha-window .ha-rate.pos{color:var(--ok)!important}
        .ha-window.ha-window .ha-rate.neg{color:var(--bad)!important}
        .ha-window.ha-window .ha-rate.xp{color:var(--xp)!important}

        .ha-window.ha-window .ha-market-toggle{display:flex!important;align-items:center!important;gap:8px!important;margin:0!important;padding:2px 2px!important;cursor:pointer;font-size:11px!important;color:var(--dim)!important}
        .ha-window.ha-window .ha-market-toggle input{-webkit-appearance:none;appearance:none;flex:none;margin:0!important;position:relative;width:26px;height:14px;border-radius:7px;background:#22313e;cursor:pointer;transition:background .15s}
        .ha-window.ha-window .ha-market-toggle input::after{content:'';position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#8093a4;transition:transform .15s,background .15s}
        .ha-window.ha-window .ha-market-toggle input:checked{background:var(--ok)}
        .ha-window.ha-window .ha-market-toggle input:checked::after{transform:translateX(12px);background:#0c1f14}

        .ha-window.ha-window .ha-drops-head{margin:4px 0 0!important;padding:0 2px!important;border:none!important;background:none!important;font-size:10px!important;font-weight:700!important;
          letter-spacing:.08em!important;text-transform:uppercase!important;color:var(--dim)!important;text-shadow:none!important}
        .ha-window.ha-window .ha-drops-head::before,.ha-window.ha-window .ha-drops-head::after{display:none!important}
        .ha-window.ha-window .ha-drops{display:flex!important;flex-direction:column!important;margin:0!important;padding:0!important;background:var(--row)!important;border:1px solid var(--line)!important;
          border-radius:8px!important;max-height:180px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#253a4b transparent;box-shadow:none!important}
        .ha-window.ha-window .ha-drop{display:grid!important;grid-template-columns:20px minmax(0,1fr) auto auto!important;align-items:center!important;gap:8px!important;margin:0!important;padding:5px 8px!important;
          border:none!important;border-bottom:1px solid var(--line)!important;background:none!important}
        .ha-window.ha-window .ha-drop:last-child{border-bottom:none!important}
        .ha-window.ha-window .ha-drop-ico{width:20px!important;height:20px!important;display:flex;align-items:center;justify-content:center;background:none!important;border:none!important}
        .ha-window.ha-window .ha-drop-ico img{max-width:20px!important;max-height:20px!important;image-rendering:pixelated}
        .ha-window.ha-window .ha-drop-name{font-size:11.5px!important;font-weight:600!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ha-window.ha-window .ha-drop-qty{font-size:11px!important;color:var(--dim)!important;font-variant-numeric:tabular-nums}
        .ha-window.ha-window .ha-drop-gold{min-width:52px;text-align:right;font-size:11.5px!important;font-weight:700!important;color:var(--ok)!important;font-variant-numeric:tabular-nums}

        .ha-window.ha-window .ha-clog-btn{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;height:28px;border-radius:7px;
          background:var(--row);border:1px solid var(--line);color:var(--tx);font-size:11.5px;font-weight:600;text-transform:none;letter-spacing:0}
        .ha-window.ha-window .ha-clog-btn:hover{background:var(--row2);border-color:#2c4658}
        .ha-window.ha-window .ha-note{margin:0!important;padding:0 2px!important;text-align:left!important;font-size:10px!important;color:#5c7082!important}

        /* ----- modo barra (topo da tela) ----- */
        .ha-window.ha-window.ha-bar{z-index:2147483001!important;inset:6px auto auto 50%!important;transform:translateX(-50%)!important;width:auto!important;max-width:96vw!important;height:34px!important;
          display:flex!important;flex-direction:row!important;align-items:stretch!important;overflow:visible!important;border-radius:10px!important}
        .ha-window.ha-window.ha-bar .ha-head{order:2;flex:none!important;width:auto!important;min-width:0!important;padding:0 4px!important;border:none!important;border-left:1px solid var(--line)!important;cursor:default}
        .ha-window.ha-window.ha-bar .ha-title{display:none!important}
        .ha-window.ha-window.ha-bar .ha-clear,.ha-window.ha-window.ha-bar .ha-x,.ha-window.ha-window.ha-bar .ha-mode{width:22px;height:22px;align-self:center}
        .ha-window.ha-window.ha-bar .win-grip{display:none!important}
        .ha-window.ha-window.ha-bar .ha-body{order:1;position:static!important;overflow:visible!important;max-height:none!important;flex-direction:row!important;align-items:center!important;gap:12px!important;padding:0 10px!important;white-space:nowrap}
        .ha-window.ha-window.ha-bar .ha-sub,.ha-window.ha-window.ha-bar .ha-market-toggle,.ha-window.ha-window.ha-bar .ha-note,.ha-window.ha-window.ha-bar .ha-clog-btn{display:none!important}
        .ha-window.ha-window.ha-bar .ha-grid{display:flex!important;gap:12px!important}
        .ha-window.ha-window.ha-bar .ha-card{padding:0!important;background:none!important;border:none!important;gap:5px!important}
        .ha-window.ha-window.ha-bar .ha-card small{display:none!important}
        .ha-window.ha-window.ha-bar .ha-card b{font-size:12px!important}
        .ha-window.ha-window.ha-bar .ha-card-ico{width:14px!important;height:14px!important;font-size:11px!important}
        .ha-window.ha-window.ha-bar .ha-card-ico img,.ha-window.ha-window.ha-bar .ha-ball{width:13px!important;height:13px!important}
        .ha-window.ha-window.ha-bar .ha-balance{padding:0 0 0 12px!important;background:none!important;border:none!important;border-left:1px solid var(--line)!important;border-radius:0!important;height:18px}
        .ha-window.ha-window.ha-bar .ha-balance span{display:none!important}
        .ha-window.ha-window.ha-bar .ha-balance b{font-size:13px!important}
        .ha-window.ha-window.ha-bar .ha-rates{gap:10px!important}
        .ha-window.ha-window.ha-bar .ha-rate{height:auto;padding:0!important;background:none!important;border:none!important;font-size:11px!important}
        .ha-window.ha-window.ha-bar .ha-drops-head{align-self:stretch;display:flex!important;align-items:center;margin:0!important;padding:0 0 0 12px!important;border-left:1px solid var(--line)!important;
          cursor:default;color:var(--tx)!important;font-size:0!important;letter-spacing:0!important}
        .ha-window.ha-window.ha-bar .ha-drops-head::before{content:'🎒 Drops'!important;display:inline!important;font-size:11px;font-weight:700;text-transform:none;letter-spacing:0;color:var(--tx)}
        .ha-window.ha-window.ha-bar .ha-drops{display:none!important;position:absolute!important;top:100%!important;right:0!important;left:auto!important;z-index:50!important;margin:4px 0 0!important;width:300px;max-height:320px;
          background:var(--bg)!important;border:1px solid #223444!important;box-shadow:0 14px 40px rgba(0,0,0,.55)!important}
        /* "Nenhum drop ainda": vira a mesma caixinha flutuante */
        .ha-window.ha-window.ha-bar .ha-drops-head + :not(.ha-drops){display:none!important;position:absolute!important;top:100%!important;right:0!important;left:auto!important;z-index:50!important;
          margin:4px 0 0!important;padding:10px 12px!important;width:260px;white-space:normal;background:var(--bg)!important;border:1px solid #223444!important;border-radius:8px!important;
          box-shadow:0 14px 40px rgba(0,0,0,.55)!important;color:var(--dim)!important;font-size:11.5px!important;text-align:left!important}
        .ha-window.ha-window.ha-bar .ha-drops::before{content:'';position:absolute;left:0;right:0;top:-8px;height:8px}
        .ha-window.ha-window.ha-bar .ha-drops{overflow-y:auto!important}
      `;
      (document.head || document.documentElement).appendChild(st);

      // Botão para alternar janela ↔ barra no topo (preferência salva).
      const KEY = 'haBar';
      const ICON_BAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M3 14h18M3 19h12"/></svg>';
      const ICON_WIN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/></svg>';
      const isBar = () => ls.get(KEY, '0') === '1';

      const sync = () => {
        const w = document.querySelector('.ha-window');

        if (!w) return;

        const head = w.querySelector('.ha-head');
        let btn = head && head.querySelector('.ha-mode');

        if (head && !btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ha-mode';
          btn.dataset.nodrag = 'true';
          head.insertBefore(btn, head.querySelector('.ha-clear') || head.querySelector('.ha-x'));
        }

        const bar = isBar();

        w.classList.toggle('ha-bar', bar);

        // Tooltips (title) em cada informação.
        const tip = (el, t) => {
          if (el && t && el.title !== t) el.title = t;
        };

        w.querySelectorAll('.ha-card').forEach((c) => {
          const sm = c.querySelector('small');

          tip(c, sm && sm.textContent.trim());
        });
        tip(w.querySelector('.ha-balance'), 'Saldo da sessão (Loot + Capturas − Supply)');
        w.querySelectorAll('.ha-rate').forEach((r) =>
          tip(r, r.classList.contains('xp') ? 'XP por hora' : /\$/.test(r.textContent) ? 'Saldo por hora' : 'Derrotados por hora')
        );

        if (btn && btn.dataset.m !== String(bar)) {
          btn.dataset.m = String(bar);
          btn.innerHTML = bar ? ICON_WIN : ICON_BAR;
          btn.title = bar ? 'Voltar para janela' : 'Modo barra no topo';
        }
      };

      // O clique é tratado no window (fase de captura), antes de qualquer listener do jogo,
      // porque o arrastar da janela do jogo consome o ponteiro no cabeçalho.
      const hit = (e) => e.target && e.target.closest && e.target.closest('.ha-window .ha-mode');

      window.addEventListener(
        'pointerdown',
        (e) => {
          if (!hit(e) || e.button !== 0) return;

          e.preventDefault();
          e.stopImmediatePropagation();
          ls.set(KEY, isBar() ? '0' : '1');
          sync();
        },
        true
      );

      ['mousedown', 'mouseup', 'pointerup', 'click'].forEach((t) =>
        window.addEventListener(
          t,
          (e) => {
            if (hit(e)) e.stopImmediatePropagation();
          },
          true
        )
      );

      setInterval(sync, 400);
    })();

    /* ---------- log de capturas (visual + sprites animados) ---------- */

    (() => {
      const st = document.createElement('style');

      st.textContent = `
        .clog-window.clog-window.clog-window{--bg:#0c141b;--panel:#101a23;--row:#121e28;--row2:#172633;--line:#1b2b38;--tx:#e3eaf1;--dim:#768a9c;--ok:#57d38c;--bad:#ef6a6a;
          width:560px!important;max-width:96vw!important;max-height:86vh!important;display:flex!important;flex-direction:column!important;padding:0!important;
          background:var(--bg)!important;color:var(--tx)!important;border:1px solid #223444!important;border-radius:12px!important;box-shadow:0 18px 50px rgba(0,0,0,.55)!important;
          overflow:hidden!important;font:12px/1.3 Inter,Barlow,system-ui,sans-serif!important}
        .clog-window.clog-window.clog-window *{font-family:inherit!important;box-sizing:border-box}
        .clog-window.clog-window.clog-window::before,.clog-window.clog-window.clog-window::after{display:none!important}

        .clog-window.clog-window.clog-window .clog-hex-bg,.clog-window.clog-window.clog-window .clog-hex-rail,.clog-window.clog-window.clog-window .clog-hex-cap,.clog-window.clog-window.clog-window .clog-gem{display:none!important}
        .clog-window.clog-window.clog-window .clog-title{position:relative!important;inset:auto!important;transform:none!important;display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:6px!important;
          width:auto!important;max-width:none!important;align-self:stretch!important;flex:none!important;overflow:visible!important;
          height:auto!important;min-height:40px!important;margin:0!important;padding:8px 8px 8px 12px!important;background:none!important;border:none!important;
          border-bottom:1px solid var(--line)!important;box-shadow:none!important;cursor:move}
        .clog-window.clog-window.clog-window .clog-titletxt{flex:1 1 auto!important;position:static!important;transform:none!important;display:flex!important;align-items:center!important;
          justify-content:flex-start!important;gap:7px!important;margin:0!important;padding:0!important;text-align:left!important;font-size:13px!important;font-weight:800!important;
          letter-spacing:.01em!important;text-transform:none!important;font-variant:normal!important;color:var(--tx)!important;text-shadow:none!important;background:none!important}
        .clog-window.clog-window.clog-window .clog-titletxt-t{color:var(--tx)!important;-webkit-text-fill-color:currentColor!important;background:none!important;text-shadow:none!important}
        .clog-window.clog-window.clog-window .clog-title-ico{width:14px!important;height:14px!important;margin:0!important}
        .clog-window.clog-window.clog-window .clog-x{all:unset;position:static!important;transform:none!important;flex:none;cursor:pointer;width:24px;height:24px;border-radius:6px;
          display:flex;align-items:center;justify-content:center;color:#b9c8d6;font-size:18px;margin:0 0 0 auto!important;inset:auto!important}
        .clog-window.clog-window.clog-window .clog-x:hover{background:var(--row2);color:var(--tx)}

        .clog-window.clog-window.clog-window .clog-head{position:static!important;inset:auto!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;margin:0!important;
          padding:8px 12px!important;background:none!important;border:none!important;border-bottom:1px solid var(--line)!important}
        .clog-window.clog-window.clog-window .clog-totals{display:flex!important;gap:12px!important;font-size:11px!important;color:var(--dim)!important;margin:0!important}
        .clog-window.clog-window.clog-window .clog-totals b{color:var(--tx)!important;font-weight:700!important;font-variant-numeric:tabular-nums}
        .clog-window.clog-window.clog-window .clog-t-shiny b{color:#f0c661!important}
        .clog-window.clog-window.clog-window .clog-tabs{display:flex!important;gap:2px!important;padding:3px!important;margin:0!important;background:#081017!important;border:1px solid var(--line)!important;border-radius:9px!important}
        .clog-window.clog-window.clog-window .clog-tab{all:unset;cursor:pointer;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;color:var(--dim)}
        .clog-window.clog-window.clog-window .clog-tab:hover{color:var(--tx)}
        .clog-window.clog-window.clog-window .clog-tab.on{background:var(--row2);color:var(--tx);box-shadow:inset 0 0 0 1px #2a4052}

        .clog-window.clog-window.clog-window .clog-list{flex:1;min-height:0;overflow-y:auto!important;margin:0!important;padding:0!important;background:none!important;border:none!important;
          display:block!important;scrollbar-width:thin;scrollbar-color:#253a4b transparent}
        .clog-window.clog-window.clog-window .clog-row{display:grid!important;grid-template-columns:44px minmax(0,1fr) minmax(0,1.5fr) 74px 78px!important;align-items:center!important;column-gap:8px!important;
          min-height:46px!important;margin:0!important;padding:2px 12px!important;background:none!important;border:none!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;box-shadow:none!important}
        .clog-window.clog-window.clog-window .clog-row:hover{background:var(--row)!important}
        .clog-window.clog-window.clog-window .clog-ico{width:44px!important;height:44px!important;display:flex!important;align-items:center!important;justify-content:center!important;background:none!important;border:none!important}
        .clog-window.clog-window.clog-window .clog-ico img{width:auto!important;height:auto!important;max-width:44px!important;max-height:44px!important;object-fit:contain!important;image-rendering:pixelated}
        .clog-window.clog-window.clog-window .clog-name{font-size:13px!important;font-weight:700!important;color:var(--tx)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .clog-window.clog-window.clog-window .clog-lvl{display:none!important}
        .clog-window.clog-window.clog-window .clog-meta{font-size:11px!important;color:var(--dim)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .clog-window.clog-window.clog-window .clog-meta b{font-weight:700!important}
        .clog-window.clog-window.clog-window .clog-ball{font-size:11px!important;color:var(--dim)!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .clog-window.clog-window.clog-window .clog-when{font-size:10.5px!important;color:#5c7082!important;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}

        .clog-window.clog-window.clog-window .clog-list ~ *{margin:0!important;padding:8px 12px!important;background:none!important;border:none!important;border-top:1px solid var(--line)!important;
          display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;font-size:10.5px!important;color:#5c7082!important}
        .clog-window.clog-window.clog-window .clog-list ~ * *{border:none!important}
        .clog-window.clog-window.clog-window .clog-list ~ * button{all:unset;cursor:pointer;flex:none;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;
          color:#f0a0a0;background:rgba(239,106,106,.08);border:1px solid rgba(239,106,106,.25)!important}
        .clog-window.clog-window.clog-window .clog-list ~ * button:hover{background:rgba(239,106,106,.16)}
        .clog-window.clog-window.clog-window .win-grip{border:none!important}
      `;
      (document.head || document.documentElement).appendChild(st);

      // Troca o ícone do jogo pelo sprite animado (o mesmo da janela de Hunts).
      setInterval(() => {
        if (!data.cre) return;

        document.querySelectorAll('.clog-window .clog-row').forEach((row) => {
          const img = row.querySelector('.clog-ico img');
          const nm = row.querySelector('.clog-name');

          if (!img || !nm) return;

          const name = nm.textContent.trim();

          if (img.dataset.hlName === name) return;

          img.dataset.hlName = name;

          const c = data.cre.byName.get(norm(name.replace(/^✨\s*/, '')));
          const pid = c ? spriteId(c, name) : 0;

          if (!pid) return;

          const cur = img.getAttribute('src') || '';
          const orig = cur.includes('PokeAPI') ? img.dataset.hlOrig : cur;
          const sh = /shiny|✨/i.test(name) || row.classList.contains('shiny') || /shiny/i.test(row.className) ? 'shiny/' : '';
          const still = SPR + '/' + sh + pid + '.png';

          img.dataset.hlOrig = orig;
          delete img.dataset.hlStill;
          img.onerror = () => {
            if (img.src !== still && !img.dataset.hlStill) {
              img.dataset.hlStill = '1';
              img.src = still;
            } else {
              img.onerror = null;
              img.src = orig;
            }
          };
          img.removeAttribute('width');
          img.removeAttribute('height');
          img.src = SPR + '/versions/generation-v/black-white/animated/' + sh + pid + '.gif';
        });
      }, 500);
    })();

    /* ---------- barra de capturas (abaixo da barra do Hunt Analyzer) ---------- */

    (() => {
      const Q_COLOR = {
        fraca: '#9aa6b3',
        comum: '#63d873',
        incomum: '#7fd4ff',
        rara: '#b06cff',
        epica: '#d985ff',
        lendaria: '#ff8c3c',
        mitica: '#ff6680',
        ancia: '#ff9800',
        divina: '#00bcd4'
      };
      const Q_STEPS = [
        [1.0, 'Fraca'],
        [1.1, 'Comum'],
        [1.3, 'Incomum'],
        [1.5, 'Rara'],
        [1.7, 'Épica'],
        [2.0, 'Lendária'],
        [3.0, 'Mítica'],
        [4.0, 'Anciã'],
        [Infinity, 'Divina']
      ];

      const st = document.createElement('style');

      st.textContent = `
        #hl-cbar{--bg:#0c141b;--line:#1b2b38;--tx:#e3eaf1;--dim:#768a9c;position:fixed;left:50%;transform:translateX(-50%);z-index:2147483000;display:none;align-items:center;gap:12px;
          height:26px;padding:0 4px 0 12px;background:var(--bg);color:var(--tx);border:1px solid #223444;border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.45);
          font:12px/1 Inter,Barlow,system-ui,sans-serif;white-space:nowrap;font-variant-numeric:tabular-nums}
        #hl-cbar.on{display:flex}
        /* caixinha de Drops da barra: desenhada fora da janela do jogo, acima de tudo (inclusive da barra de capturas) */
        #hl-dpop{position:fixed;z-index:2147483600;display:none;flex-direction:column;width:300px;max-height:320px;overflow-y:auto;
          background:#0c141b;border:1px solid #223444;border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,.55);color:#e3eaf1;
          font:12px/1.3 Inter,Barlow,system-ui,sans-serif;scrollbar-width:thin;scrollbar-color:#253a4b transparent}
        #hl-dpop.on{display:flex}
        #hl-dpop .ha-drop{display:grid;grid-template-columns:20px minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:5px 8px;border-bottom:1px solid #1b2b38}
        #hl-dpop .ha-drop:last-child{border-bottom:none}
        #hl-dpop .ha-drop-ico{width:20px;height:20px;display:flex;align-items:center;justify-content:center}
        #hl-dpop .ha-drop-ico img{max-width:20px;max-height:20px;image-rendering:pixelated}
        #hl-dpop .ha-drop-name{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #hl-dpop .ha-drop-qty{font-size:11px;color:#768a9c;font-variant-numeric:tabular-nums}
        #hl-dpop .ha-drop-gold{min-width:52px;text-align:right;font-size:11.5px;font-weight:700;color:#57d38c;font-variant-numeric:tabular-nums}
        #hl-dpop .dp-empty{padding:10px 12px;color:#768a9c;font-size:11.5px}
        #hl-cbar .i{display:flex;align-items:center;gap:5px;font-weight:700}
        #hl-cbar .i small{font-size:11px;font-weight:600;color:var(--dim)}
        #hl-cbar .sep{width:1px;height:16px;background:var(--line)}
        #hl-cbar .sh b{color:#f0c661}
        #hl-cbar .best b{font-weight:800}
        #hl-cbar .dim{color:var(--dim);font-weight:600}
        #hl-cbar .val{color:#57d38c;font-weight:700}
        #hl-cbar .clr{all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;height:20px;min-width:20px;padding:0 4px;border-radius:6px;
          color:#b9c8d6;font-size:12px;font-weight:700}
        #hl-cbar .clr:hover{background:#172633;color:#ef6a6a}
        #hl-cbar .clr.arm{background:rgba(239,106,106,.15);color:#ef6a6a;padding:0 8px;font-size:11px}
      `;
      (document.head || document.documentElement).appendChild(st);

      const bar = document.createElement('div');

      bar.id = 'hl-cbar';

      const qInfo = (r) => {
        const lbl = [r.qualityLabel, r.qualityName, r.tierName, r.rarityLabel, r.tier, r.rarity].find((x) => typeof x === 'string' && x.trim());
        const q = Number(r.quality ?? r.qualityMult ?? r.mult);
        const label = lbl || (Number.isFinite(q) ? Q_STEPS.find(([max]) => q < max)[1] : '');

        return { q: Number.isFinite(q) ? q : null, label, color: Q_COLOR[norm(label)] || '#e3eaf1' };
      };

      const ivOf = (r) => {
        for (const v of [r.ivTotal, r.totalIv, r.iv, r.growth, r.ivs]) {
          if (Number.isFinite(Number(v))) return Number(v);

          if (v && typeof v === 'object') {
            const t = Object.values(v).reduce((a, x) => a + (Number(x) || 0), 0);

            if (t > 0) return t;
          }
        }

        return null;
      };

      const nameOf = (r) => {
        const n = r.name || r.pokemonName || r.speciesName || (r.pokemon && r.pokemon.name) || (r.species && r.species.name);

        if (n) return n;

        const c = data.cre && data.cre.byId.get(+(r.speciesId ?? r.pokeId));

        return c ? c.name : '?';
      };

      let info = null;
      let armed = false;
      let armT = 0;
      let loading = false;
      let lastLoad = 0;

      async function load() {
        if (loading) return;

        loading = true;
        lastLoad = Date.now();

        try {
          const d = await authGet('/api/game/capture-log?filter=all');
          const rows = (Array.isArray(d) ? d : d && (d.rows || d.captures || d.list || d.items)) || [];
          const tt = (d && (d.totals || d.counts)) || {};
          const total = +(d.total ?? tt.total ?? tt.all ?? rows.length) || 0;
          const shiny = +(d.shinyCount ?? d.shiny ?? tt.shiny ?? rows.filter((r) => r && r.shiny).length) || 0;
          let best = null;

          rows.forEach((r) => {
            if (!r) return;

            const q = qInfo(r);
            const iv = ivOf(r);
            const score = [(q.q ?? Q_STEPS.findIndex(([, l]) => norm(l) === norm(q.label))) || 0, iv || 0];

            if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
              const c = data.cre && (data.cre.byId.get(+(r.speciesId ?? r.pokeId)) || data.cre.byName.get(norm(nameOf(r))));
              const val = Number(r.sellValue ?? r.value ?? r.price ?? r.npcPrice) || (c ? Number(c.sellValue || c.priceNpc) || 0 : 0);

              best = { score, q, iv, name: nameOf(r), shiny: !!r.shiny, val };
            }
          });

          info = { total, shiny, normal: +(d.normalCount ?? tt.normal ?? tt.normais ?? total - shiny) || 0, best };
        } catch (e) {
          info = info || null;
        }

        loading = false;
        paint();
      }

      function paint() {
        if (!info) {
          bar.innerHTML = '<span class="dim">Carregando capturas…</span>';

          return;
        }

        const b = info.best;

        bar.innerHTML = `
          <span class="i" title="Total de capturas"><small>Total</small> ${fmt(info.total)}</span>
          <span class="i sh" title="Capturas shiny">✨ <b>${fmt(info.shiny)}</b></span>
          <span class="i" title="Capturas normais"><small>Normais</small> ${fmt(info.normal)}</span>
          <span class="sep"></span>
          ${
            b
              ? `<span class="i best" title="Melhor captura (qualidade e depois IV)">🏆 <b style="color:${b.q.color}">${b.shiny ? '✨ ' : ''}${esc(b.name)}</b>
                  ${b.iv != null ? `<small>IV ${b.iv}/192</small>` : ''}
                  ${b.q.label ? `<b style="color:${b.q.color}">${esc(b.q.label)}${b.q.q != null ? ` <small>×${b.q.q.toFixed(2)}</small>` : ''}</b>` : ''}
                  ${b.val ? `<span class="val" title="Valor de venda">$ ${fmt(b.val)}</span>` : ''}</span>`
              : '<span class="dim">Nenhuma captura ainda</span>'
          }
          <span class="sep"></span>
          <button type="button" class="clr${armed ? ' arm' : ''}" title="Limpar histórico de capturas">${armed ? 'Confirmar?' : '🗑'}</button>`;
      }

      // Limpar histórico: mesmo comando que o botão "Limpar histórico" do jogo usa.
      async function clearLog() {
        try {
          await gamePost('/api/game/capture-log/clear', {});
          info = null;
          paint();
          setTimeout(load, 800);
        } catch (e) {
          toast('Não consegui limpar o histórico: ' + ((e && e.message) || e));
        }
      }

      bar.addEventListener('click', (e) => {
        if (!e.target.closest('.clr')) return;

        if (!armed) {
          armed = true;
          paint();
          clearTimeout(armT);
          armT = setTimeout(() => {
            armed = false;
            paint();
          }, 3000);

          return;
        }

        armed = false;
        clearTimeout(armT);
        paint();
        clearLog();
      });

      // Drops da barra: cópia do conteúdo do jogo num elemento próprio, por cima de tudo.
      const pop = document.createElement('div');
      let popT = 0;

      pop.id = 'hl-dpop';

      const fillPop = () => {
        const w = document.querySelector('.ha-window.ha-bar');
        const head = w && w.querySelector('.ha-drops-head');

        if (!head) return pop.classList.remove('on');

        const drops = w.querySelector('.ha-drops');
        const empty = !drops && head.nextElementSibling;

        pop.innerHTML = drops ? drops.innerHTML : `<div class="dp-empty">${esc((empty && empty.textContent.trim()) || 'Nenhum drop ainda.')}</div>`;

        const r = head.getBoundingClientRect();

        pop.style.top = Math.round(r.bottom + 4) + 'px';
        pop.style.left = Math.round(Math.max(8, Math.min(innerWidth - 308, r.right - 300))) + 'px';
      };

      const showPop = () => {
        clearTimeout(popT);

        if (!pop.isConnected) document.body.appendChild(pop);

        fillPop();
        pop.classList.add('on');
      };

      const hidePop = () => {
        clearTimeout(popT);
        popT = setTimeout(() => pop.classList.remove('on'), 150);
      };

      document.addEventListener('mouseover', (e) => {
        const t = e.target;

        if (!t.closest) return;

        if (t.closest('.ha-window.ha-bar .ha-drops-head') || t.closest('#hl-dpop')) showPop();
        else if (pop.classList.contains('on')) hidePop();
      });

      setInterval(() => {
        if (pop.classList.contains('on')) fillPop();
      }, 1000);

      setInterval(() => {
        const ha = document.querySelector('.ha-window.ha-bar');

        if (!bar.isConnected && document.body) document.body.appendChild(bar);

        if (!ha) {
          bar.classList.remove('on');

          return;
        }

        bar.style.top = Math.round(ha.getBoundingClientRect().bottom + 3) + 'px';

        if (!bar.classList.contains('on')) {
          bar.classList.add('on');
          paint();
        }

        if (Date.now() - lastLoad > 20000) load();
      }, 500);
    })();

    /* ---------- promo "Pacotes Fundadores" bloqueado ---------- */

    (() => {
      const st = document.createElement('style');

      st.textContent = '.promo-overlay{display:none!important}';
      (document.head || document.documentElement).appendChild(st);

      // Além de esconder, fecha pelo botão "Fechar" do próprio popup (o jogo não fica "preso" nele).
      setInterval(() => {
        const ov = document.querySelector('.promo-overlay');
        const b = ov && [...ov.querySelectorAll('button')].find((x) => /^\s*fechar\s*$/i.test(x.textContent));

        if (b) b.click();
      }, 1000);
    })();

    /* ---------- hunt analyzer sempre aberto ---------- */

    (() => {
      // Abre o Hunt Analyzer sozinho. Se você fechar pelo ×, respeita até recarregar a página.
      let userClosed = false;

      document.addEventListener(
        'click',
        (e) => {
          if (e.isTrusted && e.target.closest && e.target.closest('.ha-window .ha-x')) userClosed = true;
        },
        true
      );

      const opener = () =>
        document.querySelector('[data-guide*="analyzer" i], [data-guide*="analytics" i]') ||
        [...document.querySelectorAll('button, [role="button"]')].find(
          (b) => !b.closest('.ha-window, #hl-win, .hlm-overlay, #hl-cbar') && /hunt\s*analy[sz]er|analisador/i.test((b.title || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + b.textContent)
        );

      setInterval(() => {
        if (userClosed || document.querySelector('.ha-window')) return;

        const b = opener();

        if (b) b.click();
      }, 2000);
    })();
  })();
})();
