// ==UserScript==
// @name         WaggerBot — Thrill Auto Claimer
// @namespace    waggerbot
// @version      1.0.3
// @updateURL    https://raw.githubusercontent.com/tutoetgaming-star/bot/main/thrillclaimer.user.js
// @downloadURL  https://raw.githubusercontent.com/tutoetgaming-star/bot/main/thrillclaimer.user.js
// @description  WaggerBot — claim auto des cash drops Thrill via @thrilldrops et @Thrillcom
// @match        https://thrill.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      t.me
// @connect      thrill.com
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const WIN = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  function thrillOrigin() {
    const origin = WIN.location.origin;
    if (/^https:\/\/thrill\.com$/i.test(origin)) return origin;
    return "https://thrill.com";
  }

  function cashDropUrl() {
    return thrillOrigin() + "/api/reward/v2/players/self/cash-drops";
  }

  const TELEGRAM_CHANNELS = [
    { name: "thrilldrops", label: "@thrilldrops" },
    { name: "Thrillcom", label: "@Thrillcom" }
  ];

  const CURRENCIES = ["SOL", "BTC", "ETH", "USDT", "USDC", "LTC", "XRP", "TRX", "DOGE"];

  const state = {
    bearerToken: null,
    userId: null,
    claiming: new Set(),
    claimQueue: [],
    queueRunning: false,
    codes: [],
    lastTelegramPoll: 0,
    lastStatus: "Initialisation…",
    username: null,
    tabId: Math.random().toString(36).slice(2, 10) + "_" + Date.now(),
    isMaster: false,
    pollTimer: null,
    watchdogTimer: null
  };

  // --- Storage ---------------------------------------------------------------

  const storage = {
    get(key, fallback) {
      const v = GM_getValue(key, fallback);
      return v === undefined ? fallback : v;
    },
    set(key, value) {
      GM_setValue(key, value);
    },
    getJSON(key, fallback) {
      try {
        const raw = GM_getValue(key, null);
        if (raw == null) return fallback;
        return typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return fallback;
      }
    },
    setJSON(key, value) {
      GM_setValue(key, JSON.stringify(value));
    }
  };

  const config = {
    currency: storage.get("thr_currency", "SOL"),
    pollIntervalMs: parseInt(storage.get("thr_poll_interval", "20"), 10) * 1000,
    soundEnabled: storage.get("thr_sound", true),
    notifyEnabled: storage.get("thr_notify", true),
    autoClaimEnabled: storage.get("thr_auto_claim", true),
    claimDelayMs: parseInt(storage.get("thr_claim_delay", "0"), 10) * 1000,
    bulkClaimCount: parseInt(storage.get("thr_bulk_claim_count", "20"), 10),
    lastMessageIds: storage.getJSON("thr_last_msg_ids", { thrilldrops: 0, Thrillcom: 0 }),
    seenCodes: storage.getJSON("thr_seen_codes", {}),
    codeHistory: storage.getJSON("thr_code_history", [])
  };

  function persistConfig() {
    storage.set("thr_currency", config.currency);
    storage.set("thr_poll_interval", String(config.pollIntervalMs / 1000));
    storage.set("thr_sound", config.soundEnabled);
    storage.set("thr_notify", config.notifyEnabled);
    storage.set("thr_auto_claim", config.autoClaimEnabled);
    storage.set("thr_claim_delay", String(config.claimDelayMs / 1000));
    storage.set("thr_bulk_claim_count", String(config.bulkClaimCount));
    storage.setJSON("thr_last_msg_ids", config.lastMessageIds);
    storage.setJSON("thr_seen_codes", config.seenCodes);
    storage.setJSON("thr_code_history", state.codes);
  }

  // --- Logging / UI helpers --------------------------------------------------

  function log(...args) {
    console.log("[WaggerBot Thrill]", ...args);
  }

  function setStatus(msg) {
    state.lastStatus = msg;
    const el = document.getElementById("wb-status");
    if (el) el.textContent = msg;
    log(msg);
  }

  function playAlert() {
    if (!config.soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }

  function notify(title, text) {
    if (!config.notifyEnabled) return;
    try {
      GM_notification({ title, text, timeout: 5000 });
    } catch {}
  }

  function toast(message, type = "info") {
    let box = document.getElementById("wb-toast-container");
    if (!box) {
      box = document.createElement("div");
      box.id = "wb-toast-container";
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = "wb-toast " + type;
    t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), type === "error" ? 8000 : 5000);
  }

  // --- Code normalization (No spaces or symbols) -----------------------------

  function normalizeThrillCode(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // --- Telegram parser -------------------------------------------------------

  function parseTelegramMessage(text, channel) {
    if (!text || !/(?:^|\n)\s*Code\s*:/im.test(text)) return null;

    const codeMatch = text.match(/(?:^|\n)\s*Code\s*:\s*(.+?)(?:\n|$)/im);
    if (!codeMatch) return null;

    const rawCode = codeMatch[1].replace(/[<>]/g, "").trim();
    if (/^\(?\s*no\s+spaces?\s+or\s+symbols?\s*\)?$/i.test(rawCode)) return null;

    const code = normalizeThrillCode(rawCode);
    if (code.length < 4 || /^NOSPACESORSYMBOLS$/i.test(code)) return null;

    const valueMatch = text.match(/Value:\s*\$?([\d.,]+)/i);
    const claimsMatch = text.match(/Claims:\s*([^\n]+)/i);
    const wagerMatch = text.match(/(?:7-Day\s+)?Wager:\s*\$?([\d.,]+)/i);
    const lossMatch = text.match(/(?:7-Day\s+)?Loss:\s*\$?([\d.,]+)/i);
    const deadlineMatch = text.match(/Valid\s+(?:Until|till):\s*(.+?)(?:\n|$)/i);

    return {
      code,
      rawCode,
      value: valueMatch ? "$" + valueMatch[1] : "N/A",
      claims: claimsMatch ? claimsMatch[1].trim() : "-",
      wager: wagerMatch ? "$" + wagerMatch[1] : (lossMatch ? "$" + lossMatch[1] + " loss" : "-"),
      deadline: deadlineMatch ? deadlineMatch[1].trim() : "N/A",
      type: "Cash Drop",
      source: "telegram:" + channel,
      channel,
      timestamp: Date.now()
    };
  }

  function parseTelegramHtml(html, channel) {
    const results = [];
    const channelEsc = channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blocks = html.split(new RegExp('(?=data-post="' + channelEsc + '\\/)'));
    for (const block of blocks) {
      const idMatch = block.match(new RegExp('data-post="' + channelEsc + '\\/(\\d+)"'));
      if (!idMatch) continue;
      const messageId = parseInt(idMatch[1], 10);
      const textMatch = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (!textMatch) continue;
      const text = textMatch[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .trim();
      const parsed = parseTelegramMessage(text, channel);
      if (parsed) {
        parsed.messageId = messageId;
        results.push(parsed);
      }
    }
    return results.sort((a, b) => a.messageId - b.messageId);
  }

  function fetchTelegramPage(channel, beforeId) {
    return new Promise((resolve, reject) => {
      const url = "https://t.me/s/" + channel + (beforeId ? "?before=" + beforeId : "");
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
        onload(res) {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.responseText);
          } else {
            reject(new Error("Telegram HTTP " + res.status));
          }
        },
        onerror: () => reject(new Error("Telegram network error")),
        ontimeout: () => reject(new Error("Telegram timeout"))
      });
    });
  }

  async function fetchTelegramMessages() {
    const all = [];
    for (const ch of TELEGRAM_CHANNELS) {
      try {
        const html = await fetchTelegramPage(ch.name);
        all.push(...parseTelegramHtml(html, ch.name));
      } catch (err) {
        log("Erreur canal", ch.name, err.message);
      }
    }
    return all.sort((a, b) => a.messageId - b.messageId);
  }

  function classifyThrillError(data, status) {
    const code = String(data?.errorCode || "");
    const msg = String(data?.message || "");
    const combined = (code + " " + msg).toUpperCase();
    if (/LIMIT_ERROR|EXCEEDED|ALREADY|CLAIMED|USAGE/.test(combined)) {
      return { kind: "already", label: msg || "Code épuisé (limite atteinte)" };
    }
    if (/EXPIRED|NOT.?FOUND|INVALID|DOES.?NOT.?EXIST/.test(combined)) {
      return { kind: "dead", label: msg || "Code expiré ou invalide" };
    }
    if (/WAGER|DEPOSIT|REQUIREMENT|ELIGIB|LOSS/.test(combined)) {
      return { kind: "wager", label: msg || "Conditions de wager non remplies" };
    }
    if (/UNAUTHORIZED|AUTH|LOGIN|TOKEN|NOT.?LOGGED|FORBIDDEN/.test(combined) || status === 401 || status === 403) {
      return { kind: "auth", label: "Non connecté — ouvrez thrill.com connecté, F5, puis recliquez Claim" };
    }
    return { kind: "error", label: msg || "HTTP " + status };
  }

  function upsertCodeRecord(entry, source) {
    let rec = state.codes.find(c => c.code === entry.code);
    if (rec) {
      if (entry.value && entry.value !== "N/A") rec.value = entry.value;
      if (entry.wager) rec.wager = entry.wager;
      if (entry.claims) rec.claims = entry.claims;
      if (entry.channel) rec.channel = entry.channel;
      return rec;
    }
    rec = {
      code: entry.code,
      rawCode: entry.rawCode || entry.code,
      value: entry.value || "N/A",
      claims: entry.claims || "-",
      wager: entry.wager || "-",
      deadline: entry.deadline || "-",
      type: entry.type || "Cash Drop",
      timestamp: entry.timestamp || Date.now(),
      messageId: entry.messageId || null,
      channel: entry.channel || null,
      source: source || "telegram",
      claimed: false,
      rejectionReason: null
    };
    state.codes.unshift(rec);
    if (state.codes.length > 200) state.codes.length = 200;
    return rec;
  }

  async function syncFromTelegram(claimMode) {
    setStatus("Sync Telegram…");
    try {
      const messages = await fetchTelegramMessages();
      if (!messages.length) {
        toast("Aucun code trouvé sur Telegram", "error");
        return;
      }
      let imported = 0;
      for (const msg of messages) {
        if (!config.seenCodes[msg.code]) {
          config.seenCodes[msg.code] = msg.messageId;
          imported++;
        }
        if (msg.channel) {
          config.lastMessageIds[msg.channel] = Math.max(
            config.lastMessageIds[msg.channel] || 0,
            msg.messageId
          );
        }
        upsertCodeRecord(msg, "telegram");
      }
      state.lastTelegramPoll = Date.now();
      persistConfig();
      refreshDashboard();

      if (claimMode === "latest") {
        const latest = messages[messages.length - 1];
        upsertCodeRecord(latest, "telegram");
        toast("Simu auto → " + latest.code);
        enqueueClaim(latest.code);
      } else if (claimMode === "all") {
        const toClaim = messages.filter(m => !config.seenCodes[m.code + "_ok"] && !config.seenCodes[m.code + "_dead"]);
        toast("Auto → " + toClaim.length + " code(s) en file");
        toClaim.forEach(m => enqueueClaim(m.code));
      }

      setStatus("TG sync · " + messages.length + " codes");
      toast(imported + " nouveau(x) importé(s) depuis Telegram", "info");
    } catch (err) {
      setStatus("Erreur Telegram: " + err.message);
      toast("Telegram: " + err.message, "error");
    }
  }

  async function claimLastCodes(count) {
    count = Math.max(1, Math.min(100, parseInt(count, 10) || config.bulkClaimCount || 20));
    setStatus("Claim " + count + " derniers codes…");
    try {
      const messages = await fetchTelegramMessages();
      if (!messages.length) {
        toast("Aucun code trouvé sur Telegram", "error");
        setStatus("Aucun code Telegram");
        return;
      }

      for (const msg of messages) {
        if (msg.channel) {
          config.lastMessageIds[msg.channel] = Math.max(
            config.lastMessageIds[msg.channel] || 0,
            msg.messageId
          );
        }
        config.seenCodes[msg.code] = msg.messageId;
        upsertCodeRecord(msg, "telegram");
      }

      const sorted = messages.slice().sort((a, b) => b.messageId - a.messageId);
      const seen = new Set();
      const picked = [];
      for (const msg of sorted) {
        if (seen.has(msg.code)) continue;
        seen.add(msg.code);
        picked.push(msg);
        if (picked.length >= count) break;
      }

      let queued = 0;
      let skipped = 0;
      for (const msg of picked) {
        if (config.seenCodes[msg.code + "_ok"] || config.seenCodes[msg.code + "_dead"]) {
          skipped++;
          continue;
        }
        enqueueClaim(msg.code);
        queued++;
      }

      state.lastTelegramPoll = Date.now();
      persistConfig();
      refreshDashboard();
      toast(
        queued + " en file · " + skipped + " ignoré(s) · " + picked.length + " scannés",
        queued ? "success" : "info"
      );
      setStatus("Claim batch · " + queued + "/" + picked.length + " en file");
    } catch (err) {
      setStatus("Erreur claim batch: " + err.message);
      toast(err.message, "error");
    }
  }

  function resetTelegramWatch() {
    config.lastMessageIds = { thrilldrops: 0, Thrillcom: 0 };
    persistConfig();
    toast("Surveillance réinitialisée — prochain poll = nouveaux codes seulement");
    pollTelegram();
  }

  async function pollTelegram() {
    if (!state.isMaster) return;
    try {
      const messages = await fetchTelegramMessages();
      state.lastTelegramPoll = Date.now();
      if (!messages.length) {
        setStatus("Telegram: aucun message parsé");
        return;
      }

      const autoLabel = config.autoClaimEnabled ? "AUTO ON" : "AUTO OFF";
      let newCount = 0;
      let initialized = false;

      for (const ch of TELEGRAM_CHANNELS) {
        const chMsgs = messages.filter(m => m.channel === ch.name);
        if (!chMsgs.length) continue;
        const maxId = Math.max(...chMsgs.map(m => m.messageId));
        const lastId = config.lastMessageIds[ch.name] || 0;

        if (!lastId) {
          config.lastMessageIds[ch.name] = maxId;
          for (const msg of chMsgs) {
            config.seenCodes[msg.code] = msg.messageId;
            upsertCodeRecord(msg, "telegram");
          }
          initialized = true;
          continue;
        }

        for (const msg of chMsgs) {
          if (msg.messageId <= lastId) continue;
          if (config.seenCodes[msg.code] && config.seenCodes[msg.code] >= msg.messageId) continue;
          config.seenCodes[msg.code] = msg.messageId;
          config.lastMessageIds[ch.name] = Math.max(config.lastMessageIds[ch.name] || 0, msg.messageId);
          newCount++;
          onNewCode(msg);
        }
      }

      if (initialized && !newCount) {
        persistConfig();
        refreshDashboard();
        setStatus(autoLabel + " · Init · en attente de nouveaux codes");
        return;
      }

      if (newCount > 0) persistConfig();
      const t = new Date(state.lastTelegramPoll).toLocaleTimeString();
      setStatus(autoLabel + " · " + newCount + " nouveau(x) · poll " + t);
    } catch (err) {
      setStatus("Erreur Telegram: " + err.message);
    }
  }

  function onNewCode(entry) {
    const record = upsertCodeRecord(entry, "telegram");
    record.claimed = false;
    record.rejectionReason = null;
    persistConfig();
    refreshDashboard();
    playAlert();
    const chLabel = entry.channel ? "@" + entry.channel : "Telegram";
    notify("Nouveau cash drop Thrill!", entry.code + " · " + entry.value);
    toast("Nouveau (" + chLabel + "): " + entry.code + " · " + entry.value);
    if (config.autoClaimEnabled) {
      enqueueClaim(entry.code);
    }
  }

  // --- Thrill auth -----------------------------------------------------------

  function parseUserIdFromJwt(jwt) {
    try {
      const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(b64));
      return payload.userId || payload.sub || payload.id || payload.user_id || null;
    } catch {
      return null;
    }
  }

  function applyAuthToken(jwt) {
    if (!jwt || typeof jwt !== "string" || !jwt.startsWith("eyJ") || jwt.length < 100) return false;
    state.bearerToken = jwt;
    state.userId = parseUserIdFromJwt(jwt);
    log("Token OK · userId:", state.userId);
    return true;
  }

  function findJwtDeep(value, depth = 0) {
    if (depth > 6 || value == null) return null;
    if (typeof value === "string") {
      if (value.startsWith("eyJ") && value.length > 100) return value;
      if (value.includes("eyJ")) {
        try {
          const inner = findJwtDeep(JSON.parse(value), depth + 1);
          if (inner) return inner;
        } catch {}
      }
      return null;
    }
    if (typeof value === "object") {
      for (const k of Object.keys(value)) {
        const found = findJwtDeep(value[k], depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function scanCookiesForToken() {
    try {
      const parts = String(WIN.document?.cookie || "").split(";");
      for (const part of parts) {
        const eq = part.indexOf("=");
        if (eq < 0) continue;
        const val = decodeURIComponent(part.slice(eq + 1).trim());
        if (val.startsWith("eyJ") && val.length > 100 && applyAuthToken(val)) return true;
        if (val.includes("eyJ")) {
          try {
            const parsed = val.startsWith("{") || val.startsWith("[") ? JSON.parse(val) : val;
            const t = findJwtDeep(parsed);
            if (t && applyAuthToken(t)) return true;
          } catch {}
        }
      }
    } catch {}
    return false;
  }

  function scanStorageForToken() {
    const stores = [];
    try { if (WIN.localStorage) stores.push(WIN.localStorage); } catch {}
    try { if (WIN.sessionStorage) stores.push(WIN.sessionStorage); } catch {}
    for (const store of stores) {
      try {
        for (let i = 0; i < store.length; i++) {
          const key = store.key(i);
          const raw = store.getItem(key);
          if (!raw) continue;
          if (raw.startsWith("eyJ") && raw.length > 100 && applyAuthToken(raw)) return true;
          if (/token|auth|session|jwt|user/i.test(key) && raw.includes("eyJ")) {
            try {
              const t = findJwtDeep(JSON.parse(raw));
              if (t && applyAuthToken(t)) return true;
            } catch {}
          }
          if (raw.includes("eyJ")) {
            try {
              const t = findJwtDeep(JSON.parse(raw));
              if (t && applyAuthToken(t)) return true;
            } catch {}
            try {
              const t = findJwtDeep(decodeURIComponent(raw));
              if (t && applyAuthToken(t)) return true;
            } catch {}
          }
        }
      } catch {}
    }
    return false;
  }

  function scanForToken() {
    return scanStorageForToken() || scanCookiesForToken();
  }

  function extractAuthFromHeaders(headers) {
    if (!headers) return;
    const names = ["authorization", "Authorization", "x-access-token", "X-Access-Token"];
    for (const name of names) {
      let auth = null;
      if (typeof headers.get === "function") {
        auth = headers.get(name);
      } else if (typeof headers === "object") {
        auth = headers[name];
      }
      if (!auth) continue;
      let token = String(auth);
      if (token.startsWith("Bearer ")) token = token.slice(7);
      if (token.startsWith("eyJ") && applyAuthToken(token)) return;
    }
  }

  function isThrillApiUrl(url) {
    return String(url || "").includes("/api/");
  }

  function installTokenSniffer() {
    if (WIN.__thrSnifferInstalled) return;
    WIN.__thrSnifferInstalled = true;

    WIN.addEventListener("message", e => {
      if (e.data && e.data.type === "thr-token" && e.data.token) applyAuthToken(e.data.token);
    });

    const patchCode = `
      (function () {
        if (window.__thrPageSniffer) return;
        window.__thrPageSniffer = true;
        function send(t) { try { window.postMessage({ type: "thr-token", token: t }, "*"); } catch (e) {} }
        function fromHeaders(h) {
          if (!h) return;
          var names = ["authorization", "Authorization", "x-access-token", "X-Access-Token"];
          for (var i = 0; i < names.length; i++) {
            var a = (typeof h.get === "function") ? h.get(names[i]) : h[names[i]];
            if (!a) continue;
            a = String(a);
            if (a.indexOf("Bearer ") === 0) a = a.slice(7);
            if (a.indexOf("eyJ") === 0) { send(a); return; }
          }
        }
        var f = window.fetch;
        if (f) {
          window.fetch = function (input, init) {
            try {
              var u = typeof input === "string" ? input : (input && input.url) || "";
              if (u.indexOf("/api/") !== -1) {
                if (input && input.headers) fromHeaders(input.headers);
                fromHeaders(init && init.headers);
              }
            } catch (e) {}
            return f.apply(this, arguments);
          };
        }
        var xo = XMLHttpRequest.prototype.open;
        var xs = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.open = function (m, u) { this._thrU = String(u || ""); return xo.apply(this, arguments); };
        XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
          try {
            var nl = String(n).toLowerCase();
            if ((nl === "authorization" || nl === "x-access-token") && String(v).indexOf("eyJ") >= 0) {
              var t = String(v);
              if (t.indexOf("Bearer ") === 0) t = t.slice(7);
              var idx = t.indexOf("eyJ");
              if (idx >= 0 && this._thrU && this._thrU.indexOf("/api/") !== -1) send(t.slice(idx));
            }
          } catch (e) {}
          return xs.apply(this, arguments);
        };
      })();
    `;

    const claimBridgeCode = `
      (function () {
        if (window.__thrClaimBridge) return;
        window.__thrClaimBridge = true;
        window.addEventListener("message", function (e) {
          if (!e.data || e.data.type !== "thr-claim-req") return;
          var payload = { type: "thr-claim-res", reqId: e.data.reqId };
          var headers = { "content-type": "application/json", accept: "application/json" };
          if (e.data.token) headers.authorization = "Bearer " + e.data.token;
          fetch(e.data.url, {
            method: "POST",
            credentials: "include",
            headers: headers,
            body: JSON.stringify({ code: e.data.code, currency: e.data.currency })
          }).then(function (res) {
            return res.text().then(function (txt) {
              var data = {};
              try { data = txt ? JSON.parse(txt) : {}; } catch (err) {}
              payload.result = { status: res.status, data: data };
              window.postMessage(payload, "*");
            });
          }).catch(function (err) {
            payload.error = err && err.message ? err.message : "fetch failed";
            window.postMessage(payload, "*");
          });
        });
      })();
    `;

    function injectScript(code) {
      try {
        const el = document.createElement("script");
        el.textContent = code;
        (document.head || document.documentElement).appendChild(el);
        el.remove();
      } catch (e) {
        log("Injection page échouée:", e.message);
      }
    }

    function inject() {
      injectScript(patchCode);
      injectScript(claimBridgeCode);
    }
    if (document.head) inject();
    else document.addEventListener("DOMContentLoaded", inject, { once: true });

    const origFetch = WIN.fetch.bind(WIN);
    WIN.fetch = function (input, init) {
      try {
        const url = typeof input === "string" ? input : input?.url || "";
        if (isThrillApiUrl(url)) {
          if (input?.headers) extractAuthFromHeaders(input.headers);
          extractAuthFromHeaders(init?.headers);
        }
      } catch {}
      return origFetch(input, init);
    };

    const origOpen = WIN.XMLHttpRequest.prototype.open;
    const origSetHeader = WIN.XMLHttpRequest.prototype.setRequestHeader;
    WIN.XMLHttpRequest.prototype.open = function (method, url) {
      this._thrUrl = String(url || "");
      return origOpen.apply(this, arguments);
    };
    WIN.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        const nl = String(name).toLowerCase();
        if ((nl === "authorization" || nl === "x-access-token") && String(value).includes("eyJ")) {
          if (this._thrUrl && isThrillApiUrl(this._thrUrl)) {
            let token = String(value);
            if (token.startsWith("Bearer ")) token = token.slice(7);
            const idx = token.indexOf("eyJ");
            if (idx >= 0) applyAuthToken(token.slice(idx));
          }
        }
      } catch {}
      return origSetHeader.apply(this, arguments);
    };

    log("Intercepteur fetch/XHR installé");
  }

  function getUsername() {
    try {
      const ls = WIN.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i);
        const raw = ls.getItem(key);
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          const name = data?.username || data?.name || data?.user?.username || data?.user?.name;
          if (name) return String(name).toLowerCase();
        } catch {}
      }
    } catch {}
    return null;
  }

  async function ensureThrillSession() {
    installTokenSniffer();
    if (state.bearerToken) return true;
    scanForToken();
    if (state.bearerToken) return true;

    await new Promise((resolve) => {
      const start = Date.now();
      const iv = setInterval(() => {
        if (state.bearerToken || scanForToken()) {
          clearInterval(iv);
          resolve();
          return;
        }
        if (Date.now() - start > 2000) {
          clearInterval(iv);
          resolve();
        }
      }, 200);
    });

    return true;
  }

  async function captureThrillToken() {
    await ensureThrillSession();
    if (state.bearerToken) return;
    log("Pas de JWT en memoire — claim via cookies de session Thrill");
  }

  function thrillReferer() {
    const href = WIN.location.href || "";
    if (/^https:\/\/thrill\.com/i.test(href)) return href;
    return thrillOrigin() + "/fr/casino";
  }

  function postCashDropViaPage(code) {
    return new Promise((resolve, reject) => {
      const reqId = state.tabId + "_claim_" + Date.now();
      const timeout = setTimeout(() => {
        WIN.removeEventListener("message", onMsg);
        reject(new Error("Timeout claim"));
      }, 20000);

      function onMsg(e) {
        if (!e.data || e.data.type !== "thr-claim-res" || e.data.reqId !== reqId) return;
        clearTimeout(timeout);
        WIN.removeEventListener("message", onMsg);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.result);
      }

      WIN.addEventListener("message", onMsg);
      WIN.postMessage({
        type: "thr-claim-req",
        reqId,
        code,
        currency: config.currency,
        url: cashDropUrl(),
        token: state.bearerToken || null
      }, "*");
    });
  }

  async function postCashDropDirect(code) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      origin: thrillOrigin(),
      referer: thrillReferer()
    };
    if (state.bearerToken) headers.authorization = "Bearer " + state.bearerToken;

    const res = await WIN.fetch(cashDropUrl(), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ code, currency: config.currency })
    });

    let data = {};
    try {
      data = await res.json();
    } catch {}

    return { status: res.status, data };
  }

  async function postCashDrop(code) {
    await ensureThrillSession();

    try {
      return await postCashDropViaPage(code);
    } catch (err) {
      log("Claim page-context echoue, fallback direct:", err.message);
      try {
        return await postCashDropDirect(code);
      } catch (err2) {
        throw new Error("Réseau — " + (err2.message || "fetch impossible"));
      }
    }
  }

  // --- Claim engine ----------------------------------------------------------

  function enqueueClaim(code) {
    code = normalizeThrillCode(code);
    if (!code || state.claiming.has(code)) return;
    if (config.seenCodes[code + "_ok"] || config.seenCodes[code + "_dead"]) return;
    if (!state.claimQueue.includes(code)) {
      state.claimQueue.push(code);
      processQueue();
    }
  }

  async function processQueue() {
    if (state.queueRunning || state.claimQueue.length === 0) return;
    state.queueRunning = true;
    while (state.claimQueue.length > 0) {
      const code = state.claimQueue.shift();
      try {
        await claimCode(code);
      } catch (err) {
        log("Queue error", code, err.message);
      }
      if (config.claimDelayMs > 0) {
        await new Promise(r => setTimeout(r, config.claimDelayMs));
      }
    }
    state.queueRunning = false;
  }

  async function claimCode(code) {
    code = normalizeThrillCode(code);
    if (!code || state.claiming.has(code)) return;
    state.claiming.add(code);
    setStatus("Claim " + code + "…");

    if (!state.codes.find(c => c.code === code)) {
      upsertCodeRecord({
        code, value: "Manual", claims: "-", wager: "-", deadline: "-", type: "Manual"
      }, "manual");
    }

    try {
      const { status, data } = await postCashDrop(code);

      if (data.errorCode) {
        const info = classifyThrillError(data, status);
        if (info.kind === "already" || info.kind === "dead") {
          config.seenCodes[code + "_dead"] = Date.now();
          markClaimResult(code, false, info.label, null, info.kind);
          toast(code + " — " + info.label, "warning");
        } else {
          markClaimResult(code, false, info.label, null, info.kind);
          toast(code + ": " + info.label, "error");
          notify("Échec claim", code + " — " + info.label);
        }
      } else {
        const val = data.amount || data.usdAmount || data.value;
        const valStr = val != null ? "$" + val : null;
        markClaimResult(code, true, null, valStr);
        config.seenCodes[code + "_ok"] = Date.now();
        toast(code + " réclamé!" + (valStr ? " · " + valStr : ""), "success");
        notify("Cash drop réclamé!", code + (valStr ? " · " + valStr : ""));
      }
    } catch (err) {
      markClaimResult(code, false, err.message);
      toast(code + ": " + err.message, "error");
    } finally {
      state.claiming.delete(code);
      persistConfig();
      refreshDashboard();
      setStatus("Prêt · file: " + state.claimQueue.length);
    }
  }

  function markClaimResult(code, success, reason, value, kind) {
    const rec = state.codes.find(c => c.code === code);
    if (rec) {
      rec.claimed = success;
      rec.rejectionReason = success ? null : reason;
      rec.resultKind = kind || (success ? "ok" : "error");
      if (value) rec.value = value;
      if (success) rec.claimedAt = Date.now();
    }
    persistConfig();
  }

  // --- Master tab ------------------------------------------------------------

  function electMasterTab() {
    const masterId = storage.get("thr_master_tab", "");
    const lastBeat = parseInt(storage.get("thr_master_beat", "0"), 10);
    const now = Date.now();
    if (!masterId || now - lastBeat > 10000) {
      storage.set("thr_master_tab", state.tabId);
      storage.set("thr_master_beat", String(now));
      state.isMaster = true;
    } else if (masterId === state.tabId) {
      state.isMaster = true;
    }
    if (state.isMaster) {
      setInterval(() => storage.set("thr_master_beat", String(Date.now())), 3000);
    }
    window.addEventListener("beforeunload", () => {
      if (storage.get("thr_master_tab", "") === state.tabId) {
        GM_deleteValue("thr_master_tab");
        GM_deleteValue("thr_master_beat");
      }
    });
  }

  function startKeepAlive() {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) pollTelegram();
    });
    window.addEventListener("focus", () => pollTelegram());
    window.addEventListener("online", () => setTimeout(pollTelegram, 2000));
    if (navigator.locks) {
      navigator.locks.request("thr_keep_alive", { mode: "shared" }, () => new Promise(() => {}));
    }
    state.watchdogTimer = setInterval(() => {
      if (state.isMaster) pollTelegram();
      if (!state.bearerToken) captureThrillToken().catch(() => {});
    }, Math.max(config.pollIntervalMs, 15000));
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    pollTelegram();
    state.pollTimer = setInterval(pollTelegram, config.pollIntervalMs);
  }

  function parseDollarValue(str) {
    if (!str) return 0;
    const m = String(str).match(/\$?\s*([\d]+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1].replace(",", "")) : 0;
  }

  function computeStats() {
    const codes = state.codes;
    const claimed = codes.filter(c => c.claimed);
    const failed = codes.filter(c => c.rejectionReason && c.resultKind === "error");
    const already = codes.filter(c => c.resultKind === "already" || c.resultKind === "dead");
    const pending = codes.filter(c => !c.claimed && !c.rejectionReason);
    const attempted = codes.filter(c => c.claimed || c.rejectionReason);
    let totalWon = 0;
    claimed.forEach(c => { totalWon += parseDollarValue(c.value); });
    const successRate = attempted.length ? Math.round(claimed.length / attempted.length * 100) : 0;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const claimedToday = claimed.filter(c => c.claimedAt && c.claimedAt >= todayStart.getTime());
    const wonToday = claimedToday.reduce((s, c) => s + parseDollarValue(c.value), 0);
    return {
      total: codes.length,
      claimed: claimed.length,
      failed: failed.length,
      already: already.length,
      pending: pending.length,
      totalWon,
      wonToday,
      claimedToday: claimedToday.length,
      successRate,
      claimedList: claimed.slice().sort((a, b) => (b.claimedAt || 0) - (a.claimedAt || 0))
    };
  }

  function formatMoney(n) {
    return "$" + n.toFixed(2);
  }

  function formatTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll(".wb-tab").forEach(el => {
      el.classList.toggle("active", el.dataset.tab === tab);
    });
    document.querySelectorAll(".wb-tab-panel").forEach(el => {
      el.classList.toggle("active", el.id === "wb-panel-" + tab);
    });
  }

  function refreshDashboard() {
    renderCodeList();
    renderStats();
    updateHeaderStats();
  }

  function updateHeaderStats() {
    const s = computeStats();
    const badge = document.getElementById("wb-stat-badge");
    if (badge) badge.textContent = s.claimed + " claim · " + formatMoney(s.totalWon);
    const live = document.getElementById("wb-live-dot");
    if (live) live.classList.toggle("on", config.autoClaimEnabled && state.isMaster);
  }

  const tgSourceLinks = TELEGRAM_CHANNELS.map(ch =>
    '<a href="https://t.me/' + ch.name + '" target="_blank" style="color:var(--wb-purple2);text-decoration:none">' + ch.label + '</a>'
  ).join(" · ");

  // --- UI --------------------------------------------------------------------

  function renderUI() {
    if (document.getElementById("wb-root")) return;
    state.activeTab = state.activeTab || "history";

    const style = document.createElement("style");
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
      #wb-root{font-family:'Space Grotesk',system-ui,sans-serif;color:#ece8f4;--wb-bg:#07060b;--wb-surface:#110f18;--wb-surface2:#1a1724;--wb-border:rgba(168,85,247,.18);--wb-purple:#a855f7;--wb-purple2:#c084fc;--wb-green:#4ade80;--wb-red:#f87171;--wb-amber:#fbbf24;--wb-muted:#8b849c}
      #wb-header{position:fixed;top:0;left:0;right:0;z-index:999999;height:58px;background:linear-gradient(180deg,#0d0b14 0%,#07060b 100%);border-bottom:1px solid var(--wb-border);display:flex;align-items:center;justify-content:space-between;padding:0 20px;box-shadow:0 4px 32px rgba(0,0,0,.55),inset 0 1px 0 rgba(168,85,247,.08)}
      #wb-header .wb-brand{display:flex;align-items:center;gap:12px}
      #wb-header .wb-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a855f7 50%,#c084fc);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;box-shadow:0 0 20px rgba(168,85,247,.45)}
      #wb-header .wb-title{font-weight:700;font-size:16px;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      #wb-header .wb-sub{font-size:11px;color:var(--wb-muted);margin-top:1px}
      #wb-live-dot{width:8px;height:8px;border-radius:50%;background:#4b5563;display:inline-block;margin-right:6px;vertical-align:middle}
      #wb-live-dot.on{background:var(--wb-green);box-shadow:0 0 10px rgba(74,222,128,.7);animation:wb-pulse 2s infinite}
      @keyframes wb-pulse{0%,100%{opacity:1}50%{opacity:.5}}
      #wb-stat-badge{font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(168,85,247,.12);border:1px solid var(--wb-border);color:var(--wb-purple2)}
      .wb-user-pill{font-size:11px;padding:5px 12px;border-radius:20px;background:var(--wb-surface2);border:1px solid var(--wb-border);color:#c4b5d8;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wb-claim-box{display:flex;align-items:center;gap:6px;background:var(--wb-surface2);border:1px solid var(--wb-border);border-radius:10px;padding:4px 4px 4px 12px}
      .wb-claim-box input{width:130px;border:none;background:transparent;color:#fff;font:600 13px 'JetBrains Mono',monospace;text-transform:uppercase;outline:none}
      .wb-claim-box input::placeholder{color:#5c5470;text-transform:none;font-weight:500}
      .wb-btn{padding:8px 14px;border-radius:8px;border:none;font:600 12px 'Space Grotesk',sans-serif;cursor:pointer;transition:transform .15s,box-shadow .15s}
      .wb-btn:hover{transform:translateY(-1px)}
      .wb-btn-primary{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;box-shadow:0 4px 16px rgba(168,85,247,.35)}
      .wb-btn-ghost{background:var(--wb-surface2);color:#d8cce8;border:1px solid var(--wb-border)}
      .wb-btn-sm{padding:6px 10px;font-size:11px}
      #wb-panel{position:fixed;top:58px;right:0;bottom:0;width:400px;max-width:100vw;background:var(--wb-bg);border-left:1px solid var(--wb-border);z-index:999998;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:-8px 0 40px rgba(0,0,0,.5)}
      #wb-panel.open{transform:translateX(0)}
      .wb-tabs{display:flex;padding:0 12px;gap:4px;border-bottom:1px solid var(--wb-border);background:var(--wb-surface)}
      .wb-tab{flex:1;padding:12px 8px;border:none;background:transparent;color:var(--wb-muted);font:600 12px 'Space Grotesk',sans-serif;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .2s,border-color .2s}
      .wb-tab:hover{color:#d8cce8}
      .wb-tab.active{color:var(--wb-purple2);border-bottom-color:var(--wb-purple)}
      .wb-tab-panel{display:none;flex:1;overflow:auto;flex-direction:column}
      .wb-tab-panel.active{display:flex}
      #wb-codes{padding:12px;flex:1;overflow:auto}
      .wb-empty{padding:32px 16px;text-align:center;color:var(--wb-muted);font-size:13px;line-height:1.6}
      .wb-code-card{padding:14px;margin-bottom:8px;border-radius:12px;background:var(--wb-surface);border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden;transition:border-color .2s}
      .wb-code-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--wb-purple);opacity:.5}
      .wb-code-card.ok::before{background:var(--wb-green);opacity:1}
      .wb-code-card.warn::before{background:var(--wb-amber);opacity:1}
      .wb-code-card.err::before{background:var(--wb-red);opacity:1}
      .wb-code-card .code{font:600 15px 'JetBrains Mono',monospace;color:var(--wb-purple2);letter-spacing:.05em}
      .wb-code-card .meta{font-size:11px;color:var(--wb-muted);margin-top:6px;line-height:1.5}
      .wb-code-card .status{font-size:11px;font-weight:600;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.05)}
      .wb-code-card.ok .status{color:var(--wb-green)}
      .wb-code-card.warn .status{color:var(--wb-amber)}
      .wb-code-card.err .status{color:var(--wb-red)}
      .wb-type-tag{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,.15);color:var(--wb-purple2);margin-left:8px;vertical-align:middle}
      #wb-stats{padding:16px}
      .wb-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
      .wb-stat-card{padding:14px;border-radius:12px;background:var(--wb-surface);border:1px solid var(--wb-border)}
      .wb-stat-card.wide{grid-column:1/-1;background:linear-gradient(135deg,rgba(124,58,237,.15),rgba(168,85,247,.08));border-color:rgba(168,85,247,.3)}
      .wb-stat-card .label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--wb-muted)}
      .wb-stat-card .value{font-size:22px;font-weight:700;margin-top:4px;color:#fff}
      .wb-stat-card.wide .value{font-size:28px;background:linear-gradient(90deg,#fff,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      .wb-stat-card .sub{font-size:11px;color:var(--wb-muted);margin-top:2px}
      .wb-progress{height:6px;border-radius:3px;background:rgba(255,255,255,.06);margin-top:10px;overflow:hidden}
      .wb-progress-bar{height:100%;border-radius:3px;background:linear-gradient(90deg,#7c3aed,#4ade80);transition:width .4s}
      .wb-claimed-list{margin-top:8px}
      .wb-claimed-row{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:8px;background:var(--wb-surface);border:1px solid rgba(255,255,255,.04);margin-bottom:6px;font-size:12px}
      .wb-claimed-row .code{font-family:'JetBrains Mono',monospace;font-weight:600;color:var(--wb-green)}
      .wb-claimed-row .amt{font-weight:700;color:#fff}
      .wb-claimed-row .time{font-size:10px;color:var(--wb-muted)}
      .wb-section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--wb-muted);margin:16px 0 10px}
      #wb-settings{padding:16px;font-size:12px}
      .wb-setting-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)}
      .wb-setting-row label{color:#d8cce8;font-weight:500}
      .wb-setting-row select,.wb-setting-row input[type=number]{padding:6px 10px;border-radius:8px;border:1px solid var(--wb-border);background:var(--wb-surface2);color:#fff;font-size:12px}
      .wb-setting-check{display:flex;align-items:center;gap:8px;cursor:pointer}
      .wb-setting-check input{accent-color:var(--wb-purple);width:16px;height:16px}
      .wb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
      body.wb-pad{margin-top:58px!important}
      #wb-toast-container{position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;flex-direction:column;gap:8px;max-width:380px}
      .wb-toast{padding:14px 18px;border-radius:12px;background:#110f18;border:1px solid var(--wb-border);color:#ece8f4;font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.5);animation:wb-slide-in .3s ease}
      @keyframes wb-slide-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}
      .wb-toast.success{border-color:rgba(74,222,128,.4)}
      .wb-toast.error{border-color:rgba(248,113,113,.4)}
      .wb-toast.warning{border-color:rgba(251,191,36,.4)}
    `;
    document.documentElement.appendChild(style);

    const header = document.createElement("div");
    header.id = "wb-header";
    header.innerHTML = `
      <div class="wb-brand">
        <div class="wb-logo">T</div>
        <div>
          <div class="wb-title">WaggerBot · Thrill</div>
          <div class="wb-sub"><span id="wb-live-dot" class="on"></span><span id="wb-status">${state.lastStatus}</span></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <span id="wb-stat-badge" class="wb-stat-badge">0 claim · $0.00</span>
        <span class="wb-user-pill" id="wb-user">${state.username || "…"}</span>
        <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-toggle-panel">Dashboard</button>
        <div class="wb-claim-box">
          <input id="wb-manual-input" placeholder="Code" maxlength="30" autocomplete="off" spellcheck="false"/>
          <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-manual-claim">Claim</button>
        </div>
      </div>
    `;

    const panel = document.createElement("div");
    panel.id = "wb-panel";
    panel.innerHTML = `
      <div class="wb-tabs">
        <button class="wb-tab active" data-tab="history">Historique</button>
        <button class="wb-tab" data-tab="stats">Statistiques</button>
        <button class="wb-tab" data-tab="settings">Réglages</button>
      </div>
      <div id="wb-panel-history" class="wb-tab-panel active">
        <div style="padding:10px 16px 0;font-size:11px;color:var(--wb-muted)">Sources · ${tgSourceLinks}</div>
        <div id="wb-codes"></div>
      </div>
      <div id="wb-panel-stats" class="wb-tab-panel">
        <div id="wb-stats"></div>
      </div>
      <div id="wb-panel-settings" class="wb-tab-panel">
        <div id="wb-settings">
          <div class="wb-setting-row">
            <label>Devise de claim</label>
            <select id="wb-currency">${CURRENCIES.map(c => `<option value="${c}"${c === config.currency ? " selected" : ""}>${c}</option>`).join("")}</select>
          </div>
          <div class="wb-setting-row">
            <label>Intervalle Telegram</label>
            <span><input id="wb-poll" type="number" min="10" max="120" value="${config.pollIntervalMs / 1000}" style="width:52px"/> sec</span>
          </div>
          <div class="wb-setting-row">
            <label class="wb-setting-check"><input type="checkbox" id="wb-auto" ${config.autoClaimEnabled ? "checked" : ""}/> Auto-claim activé</label>
          </div>
          <div class="wb-setting-row">
            <label class="wb-setting-check"><input type="checkbox" id="wb-notify" ${config.notifyEnabled ? "checked" : ""}/> Notifications</label>
          </div>
          <div class="wb-setting-row">
            <label>Claim batch (derniers codes)</label>
            <span><input id="wb-bulk-count" type="number" min="1" max="100" value="${config.bulkClaimCount}" style="width:52px"/> codes</span>
          </div>
          <div class="wb-setting-row">
            <label class="wb-setting-check"><input type="checkbox" id="wb-sound" ${config.soundEnabled ? "checked" : ""}/> Son alerte</label>
          </div>
          <div class="wb-actions">
            <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-claim-last">Claim ${config.bulkClaimCount} derniers</button>
            <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-poll-now">Poll Telegram</button>
            <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-sim-auto">Simu auto</button>
            <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-sync-tg">Sync TG</button>
            <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-reset-watch">Réinit watch</button>
            <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-clear-history" style="color:var(--wb-red)">Vider historique</button>
          </div>
        </div>
      </div>
    `;

    const root = document.createElement("div");
    root.id = "wb-root";
    root.appendChild(header);
    root.appendChild(panel);
    document.body.appendChild(root);
    document.body.classList.add("wb-pad");

    document.getElementById("wb-toggle-panel").onclick = () => panel.classList.toggle("open");
    document.querySelectorAll(".wb-tab").forEach(btn => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });
    document.getElementById("wb-manual-claim").onclick = () => {
      const v = document.getElementById("wb-manual-input").value.trim();
      if (v) { enqueueClaim(v); document.getElementById("wb-manual-input").value = ""; }
    };
    document.getElementById("wb-manual-input").addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("wb-manual-claim").click();
    });
    document.getElementById("wb-currency").onchange = e => { config.currency = e.target.value; persistConfig(); };
    document.getElementById("wb-poll").onchange = e => {
      config.pollIntervalMs = Math.max(10, parseInt(e.target.value, 10) || 20) * 1000;
      persistConfig();
      startPolling();
    };
    document.getElementById("wb-auto").onchange = e => { config.autoClaimEnabled = e.target.checked; persistConfig(); updateHeaderStats(); };
    document.getElementById("wb-notify").onchange = e => { config.notifyEnabled = e.target.checked; persistConfig(); };
    document.getElementById("wb-sound").onchange = e => { config.soundEnabled = e.target.checked; persistConfig(); };
    document.getElementById("wb-bulk-count").onchange = e => {
      config.bulkClaimCount = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 20));
      e.target.value = config.bulkClaimCount;
      const btn = document.getElementById("wb-claim-last");
      if (btn) btn.textContent = "Claim " + config.bulkClaimCount + " derniers";
      persistConfig();
    };
    document.getElementById("wb-claim-last").onclick = () => claimLastCodes(config.bulkClaimCount);
    document.getElementById("wb-poll-now").onclick = () => pollTelegram();
    document.getElementById("wb-sim-auto").onclick = () => syncFromTelegram("latest");
    document.getElementById("wb-sync-tg").onclick = () => syncFromTelegram(false);
    document.getElementById("wb-reset-watch").onclick = () => resetTelegramWatch();
    document.getElementById("wb-clear-history").onclick = () => {
      if (confirm("Effacer tout l'historique et les stats ?")) {
        state.codes = [];
        persistConfig();
        refreshDashboard();
      }
    };

    refreshDashboard();
    panel.classList.add("open");
  }

  function renderStats() {
    const box = document.getElementById("wb-stats");
    if (!box) return;
    const s = computeStats();
    const claimedRows = s.claimedList.slice(0, 20).map(c => `
      <div class="wb-claimed-row">
        <div>
          <span class="code">${c.code}</span>
          <span class="wb-type-tag">${c.type || "Cash Drop"}</span>
          <div class="time">${formatTime(c.claimedAt)}</div>
        </div>
        <span class="amt">${c.value || "—"}</span>
      </div>
    `).join("");

    box.innerHTML = `
      <div class="wb-stat-grid">
        <div class="wb-stat-card wide">
          <div class="label">Total gagné</div>
          <div class="value">${formatMoney(s.totalWon)}</div>
          <div class="sub">Aujourd'hui : ${formatMoney(s.wonToday)} (${s.claimedToday} code${s.claimedToday > 1 ? "s" : ""})</div>
        </div>
        <div class="wb-stat-card">
          <div class="label">Réussis</div>
          <div class="value" style="color:var(--wb-green)">${s.claimed}</div>
          <div class="sub">codes claim</div>
        </div>
        <div class="wb-stat-card">
          <div class="label">Taux succès</div>
          <div class="value">${s.successRate}%</div>
          <div class="wb-progress"><div class="wb-progress-bar" style="width:${s.successRate}%"></div></div>
        </div>
        <div class="wb-stat-card">
          <div class="label">Déjà pris</div>
          <div class="value" style="color:var(--wb-amber)">${s.already}</div>
        </div>
        <div class="wb-stat-card">
          <div class="label">Échoués</div>
          <div class="value" style="color:var(--wb-red)">${s.failed}</div>
        </div>
        <div class="wb-stat-card">
          <div class="label">En attente</div>
          <div class="value">${s.pending}</div>
        </div>
        <div class="wb-stat-card">
          <div class="label">Total détectés</div>
          <div class="value">${s.total}</div>
        </div>
      </div>
      <div class="wb-section-title">Codes réclamés avec succès</div>
      <div class="wb-claimed-list">
        ${claimedRows || '<div class="wb-empty">Aucun claim réussi pour l\'instant</div>'}
      </div>
    `;
  }

  function renderCodeList() {
    const box = document.getElementById("wb-codes");
    if (!box) return;
    if (!state.codes.length) {
      box.innerHTML = '<div class="wb-empty">En attente de codes depuis<br><strong>@thrilldrops</strong> et <strong>@Thrillcom</strong></div>';
      return;
    }
    box.innerHTML = state.codes.map(c => {
      let cls = "";
      let status = "En attente de claim";
      if (c.claimed) {
        cls = "ok";
        status = "Réclamé" + (c.value && c.value !== "N/A" && c.value !== "Manual" ? " · " + c.value : "");
      } else if (c.rejectionReason) {
        cls = c.resultKind === "already" || c.resultKind === "dead" ? "warn" : "err";
        status = c.rejectionReason;
      }
      const ch = c.channel ? " · @" + c.channel : "";
      const raw = c.rawCode && c.rawCode !== c.code ? ' <span style="opacity:.5">(' + c.rawCode + ')</span>' : "";
      return `<div class="wb-code-card ${cls}">
        <div><span class="code">${c.code}</span>${raw}<span class="wb-type-tag">${c.type || "Cash Drop"}</span></div>
        <div class="meta">${c.value !== "Manual" ? c.value + " · " : ""}${c.wager !== "-" ? c.wager + " · " : ""}${c.claims !== "-" ? c.claims + " claims" : ""}${ch}</div>
        <div class="status">${status}</div>
      </div>`;
    }).join("");
  }

  // --- Bootstrap -------------------------------------------------------------

  function waitForBody() {
    return new Promise(resolve => {
      if (document.body) return resolve();
      const iv = setInterval(() => {
        if (document.body) { clearInterval(iv); resolve(); }
      }, 50);
    });
  }

  async function init() {
    installTokenSniffer();
    state.codes = config.codeHistory || [];
    electMasterTab();
    state.username = getUsername();

    await waitForBody();
    renderUI();
    if (state.username) {
      document.getElementById("wb-user").textContent = state.username;
    }

    try {
      await captureThrillToken();
      setStatus(
        state.bearerToken
          ? "JWT OK · poll Telegram actif"
          : "Session cookies · poll Telegram actif"
      );
    } catch {
      setStatus("Prêt · connecté sur thrill.com requis pour Claim");
    }

    startKeepAlive();
    if (state.isMaster) {
      startPolling();
    }
  }

  init().catch(err => log("Init error", err));
})();
