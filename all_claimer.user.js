// ==UserScript==
// @name         All Claimer — V4
// @namespace    waggerbot
// @version      4.0.0
// @description  WaggerBot — claim auto Shuffle, Stake et Thrill (sans licence)
// @match        https://shuffle.com/*
// @match        https://shuffle.bet/*
// @match        https://stake.com/*
// @match        https://stake.bet/*
// @match        https://thrill.com/*
// @updateURL    https://raw.githubusercontent.com/tutoetgaming-star/bot/main/all_claimer.user.js
// @downloadURL  https://raw.githubusercontent.com/tutoetgaming-star/bot/main/all_claimer.user.js
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      t.me
// @connect      telegram.me
// @connect      telegram.org
// @connect      shuffle.com
// @connect      shuffle.bet
// @connect      stake.com
// @connect      stake.bet
// @connect      thrill.com
// @connect      challenges.cloudflare.com
// @connect      static.geetest.com
// @connect      gcaptcha4.geetest.com
// @run-at       document-start
// @noframes
// ==/UserScript==
(function () {
  "use strict";

  const PLATFORM = (function detectPlatform() {
    const host = location.hostname.toLowerCase();
    if (/^shuffle\.(com|bet)$/.test(host)) return "shuffle";
    if (/^stake\.(com|bet)$/.test(host)) return "stake";
    if (host === "thrill.com") return "thrill";
    return null;
  })();

  if (!PLATFORM) return;
  if (PLATFORM === "shuffle") {
    (function () {
      "use strict";

          const WIN = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        
          function shuffleOrigin() {
            const origin = WIN.location.origin;
            if (/^https:\/\/shuffle\.(com|bet)$/i.test(origin)) return origin;
            return "https://shuffle.com";
          }
        
          function graphqlUrl() {
            return shuffleOrigin() + "/main-api/graphql/api/graphql";
          }
        
          const GEETEST_CAPTCHA_ID = "b3d286a8bdd3cc048538b57984f36d7f";
          const TELEGRAM_CHANNEL = "shufflecodesdrops";
          const TELEGRAM_BASES = ["https://telegram.me/s/", "https://t.me/s/"];
        
          const CURRENCIES = ["USDT", "BTC", "ETH", "USDC", "SHFL", "SOL", "LTC", "XRP", "TRX", "DOGE"];
        
          const state = {
            bearerToken: null,
            userId: null,
            geetestLoaded: false,
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
            watchdogTimer: null,
            vipTimer: null,
            vipClaimRunning: false,
          };
        
          const VIP_BONUS = {
            instantRakeback: {
              label: "Rakeback instantane",
              claimOp: "ClaimRakebacks",
              claimField: "instantRakebackClaim",
              hasCurrency: false,
              alwaysTry: true,
              arrayResult: true,
              claimQuery: "mutation ClaimRakebacks { instantRakebackClaim { currency amount __typename } }"
            },
            rakeback: {
              label: "Daily rakeback",
              claimOp: "VipRewardsClaimDailyRakeback",
              claimField: "vipRewardsClaimDailyRakeback",
              getOp: "GetVipDailyRakeback",
              getField: "vipDailyRakeback",
              hasCurrency: false,
              claimQuery: "mutation VipRewardsClaimDailyRakeback { vipRewardsClaimDailyRakeback { __typename } }"
            },
            weekly: {
              label: "Weekly bonus",
              claimOp: "VipRewardsClaimWeeklyBonus",
              claimField: "vipRewardsClaimWeeklyBonus",
              getOp: "GetVipWeeklyBonus",
              getField: "vipWeeklyBonus",
              hasCurrency: true,
              claimQuery: "mutation VipRewardsClaimWeeklyBonus($currency: Currency!) { vipRewardsClaimWeeklyBonus(currency: $currency) { claimedAmount { currency amount } nextClaimDate __typename } }"
            },
            monthly: {
              label: "Monthly bonus",
              claimOp: "VipRewardsClaimMonthlyBonus",
              claimField: "vipRewardsClaimMonthlyBonus",
              getOp: "GetVipMonthlyBonus",
              getField: "vipMonthlyBonus",
              hasCurrency: true,
              claimQuery: "mutation VipRewardsClaimMonthlyBonus($currency: Currency!) { vipRewardsClaimMonthlyBonus(currency: $currency) { claimedAmount { currency amount } nextClaimDate __typename } }"
            }
          };
        
          const VIP_SIMPLE_TYPES = ["instantRakeback", "rakeback", "weekly", "monthly"];
          const VIP_AUTO_KEYS = {
            instantRakeback: "autoVipInstantRakeback",
            rakeback: "autoVipRakeback",
            weekly: "autoVipWeekly",
            monthly: "autoVipMonthly"
          };
        
          const GET_VIP_BONUS_QUERY = "query GetVipBonus { vipBonus { id type currency bonusAmountUsd cadence occurrence cancelledAt createdAt endAt expiryPerOccurrence firstOccurrenceActivationPeriod reasonType bonusClaims { id currency amount occurrenceIndex createdAt } } }";
          const VIP_RELOAD_CLAIM_QUERY = "mutation VipReloadClaimBonus($data: ClaimVipBonusInput!) { vipReloadClaimBonus(data: $data) { id __typename } }";
        
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
            currency: storage.get("sac_currency", "USDT"),
            pollIntervalMs: parseInt(storage.get("sac_poll_interval", "20"), 10) * 1000,
            soundEnabled: storage.get("sac_sound", true),
            notifyEnabled: storage.get("sac_notify", true),
            autoClaimEnabled: storage.get("sac_auto_claim", true),
            claimDelayMs: parseInt(storage.get("sac_claim_delay", "0"), 10) * 1000,
            lastMessageId: parseInt(storage.get("sac_last_msg_id", "0"), 10) || 0,
            seenCodes: storage.getJSON("sac_seen_codes", {}),
            codeHistory: storage.getJSON("sac_code_history", []),
            autoVipInstantRakeback: storage.get("sac_vip_instant_rakeback", false),
            autoVipRakeback: storage.get("sac_vip_rakeback", false),
            autoVipWeekly: storage.get("sac_vip_weekly", false),
            autoVipMonthly: storage.get("sac_vip_monthly", false),
            autoVipReload: storage.get("sac_vip_reload", false),
            vipCheckIntervalMs: parseInt(storage.get("sac_vip_interval", "5"), 10) * 60 * 1000,
          };
        
          function persistConfig() {
            storage.set("sac_currency", config.currency);
            storage.set("sac_poll_interval", String(config.pollIntervalMs / 1000));
            storage.set("sac_sound", config.soundEnabled);
            storage.set("sac_notify", config.notifyEnabled);
            storage.set("sac_auto_claim", config.autoClaimEnabled);
            storage.set("sac_claim_delay", String(config.claimDelayMs / 1000));
            storage.set("sac_last_msg_id", String(config.lastMessageId));
            storage.setJSON("sac_seen_codes", config.seenCodes);
            storage.setJSON("sac_code_history", state.codes);
            storage.set("sac_vip_instant_rakeback", config.autoVipInstantRakeback);
            storage.set("sac_vip_rakeback", config.autoVipRakeback);
            storage.set("sac_vip_weekly", config.autoVipWeekly);
            storage.set("sac_vip_monthly", config.autoVipMonthly);
            storage.set("sac_vip_reload", config.autoVipReload);
            storage.set("sac_vip_interval", String(config.vipCheckIntervalMs / 60000));
          }
          // --- Logging / UI helpers --------------------------------------------------
        
          function log(...args) {
            console.log("[WaggerBot]", ...args);
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
        
          // --- Telegram parser -------------------------------------------------------
        
          function parseTelegramMessage(text) {
            if (!text || !/Code:/i.test(text)) return null;
            const codeMatch = text.match(/Code:\s*`?([A-Z0-9]{4,20})`?/i);
            if (!codeMatch) return null;
            const code = codeMatch[1].toUpperCase();
            const valueMatch = text.match(/Value:\s*\$?([\d.,]+)/i);
            const claimsMatch = text.match(/Claims:\s*([^\n]+)/i);
            const wagerMatch = text.match(/Wager:\s*\$?([\d.,]+)/i);
            const timeMatch = text.match(/Time:\s*(.+?)(?:\n|$)/i);
            const typeMatch = text.match(/(VIP|Boost|Stream)/i);
            return {
              code,
              value: valueMatch ? "$" + valueMatch[1] : "N/A",
              claims: claimsMatch ? claimsMatch[1].trim() : "-",
              wager: wagerMatch ? "$" + wagerMatch[1] : "Unknown",
              deadline: timeMatch ? timeMatch[1].trim() : "N/A",
              type: typeMatch ? typeMatch[1] : "Code",
              source: "telegram:" + TELEGRAM_CHANNEL,
              timestamp: Date.now()
            };
          }
        
          function parseTelegramHtml(html) {
            const results = [];
            const blocks = html.split(/(?=data-post="shufflecodesdrops\/)/);
            for (const block of blocks) {
              const idMatch = block.match(/data-post="shufflecodesdrops\/(\d+)"/);
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
              const parsed = parseTelegramMessage(text);
              if (parsed) {
                parsed.messageId = messageId;
                results.push(parsed);
              }
            }
            return results.sort((a, b) => a.messageId - b.messageId);
          }
        
          function telegramPageUrl(base, beforeId) {
            const url = base + TELEGRAM_CHANNEL;
            return beforeId ? url + "?before=" + beforeId : url;
          }
      
          function gmGetTelegramPage(url) {
            return new Promise((resolve, reject) => {
              GM_xmlhttpRequest({
                method: "GET",
                url,
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9"
                },
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
      
          async function fetchTelegramPage(beforeId) {
            let lastErr = null;
            for (const base of TELEGRAM_BASES) {
              try {
                return await gmGetTelegramPage(telegramPageUrl(base, beforeId));
              } catch (err) {
                lastErr = err;
              }
            }
            throw lastErr || new Error("Telegram inaccessible (telegram.me / t.me)");
          }
        
          function classifyClaimError(msg) {
            const m = String(msg || "").toUpperCase();
            if (/PROMO_CODE_CLAIMED|ALREADY.?CLAIMED|ALREADY.?REDEEMED|ALREADY_REDEEMED/.test(m)) {
              return { kind: "already", label: "Déjà réclamé (par vous ou épuisé)" };
            }
            if (/EXPIRED|NOT.?FOUND|INVALID|DOES.?NOT.?EXIST/.test(m)) {
              return { kind: "dead", label: "Code expiré ou invalide" };
            }
            if (/WAGER|DEPOSIT|VIP|LEVEL|REQUIREMENT/.test(m)) {
              return { kind: "wager", label: msg };
            }
            return { kind: "error", label: msg };
          }
        
          async function fetchTelegramMessages() {
            const html = await fetchTelegramPage();
            return parseTelegramHtml(html);
          }
        
          function upsertCodeRecord(entry, source) {
            let rec = state.codes.find(c => c.code === entry.code);
            if (rec) {
              if (entry.value && entry.value !== "N/A") rec.value = entry.value;
              if (entry.wager) rec.wager = entry.wager;
              if (entry.type) rec.type = entry.type;
              if (entry.claims) rec.claims = entry.claims;
              return rec;
            }
            rec = {
              code: entry.code,
              value: entry.value || "N/A",
              claims: entry.claims || "-",
              wager: entry.wager || "-",
              deadline: entry.deadline || "-",
              type: entry.type || "Code",
              timestamp: entry.timestamp || Date.now(),
              messageId: entry.messageId || null,
              source: source || "telegram",
              claimed: false,
              rejectionReason: null
            };
            state.codes.unshift(rec);
            if (state.codes.length > 200) state.codes.length = 200;
            return rec;
          }
        
          /** Importe les codes visibles sur Telegram. claimMode: false | "latest" | "all" */
          async function syncFromTelegram(claimMode) {
            setStatus("Sync Telegram…");
            try {
              const messages = await fetchTelegramMessages();
              if (!messages.length) {
                toast("Aucun code trouvé sur Telegram", "error");
                return;
              }
              const maxId = Math.max(...messages.map(m => m.messageId));
              let imported = 0;
              for (const msg of messages) {
                if (!config.seenCodes[msg.code]) {
                  config.seenCodes[msg.code] = msg.messageId;
                  imported++;
                }
                upsertCodeRecord(msg, "telegram");
              }
              config.lastMessageId = Math.max(config.lastMessageId, maxId);
              state.lastTelegramPoll = Date.now();
              persistConfig();
              refreshDashboard();
        
              if (claimMode === "latest") {
                const latest = messages[messages.length - 1];
                upsertCodeRecord(latest, "telegram");
                toast("?? Simu auto ? " + latest.code);
                enqueueClaim(latest.code);
              } else if (claimMode === "all") {
                const toClaim = messages.filter(m => !config.seenCodes[m.code + "_ok"] && !config.seenCodes[m.code + "_dead"]);
                toast("?? Auto ? " + toClaim.length + " code(s) en file");
                toClaim.forEach(m => enqueueClaim(m.code));
              }
        
              setStatus("TG sync · " + messages.length + " codes · id #" + config.lastMessageId);
              toast("?? " + imported + " nouveau(x) importé(s) depuis Telegram", "info");
            } catch (err) {
              setStatus("Erreur Telegram: " + err.message);
              toast("Telegram: " + err.message, "error");
            }
          }
        
          function resetTelegramWatch() {
            config.lastMessageId = 0;
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
        
              const maxId = Math.max(...messages.map(m => m.messageId));
              const autoLabel = config.autoClaimEnabled ? "AUTO ON" : "AUTO OFF";
        
              if (!config.lastMessageId) {
                config.lastMessageId = maxId;
                for (const msg of messages) config.seenCodes[msg.code] = msg.messageId;
                for (const msg of messages) upsertCodeRecord(msg, "telegram");
                persistConfig();
                refreshDashboard();
                setStatus(autoLabel + " · Init msg #" + maxId + " · en attente de nouveaux codes");
                return;
              }
        
              let newCount = 0;
              for (const msg of messages) {
                if (msg.messageId <= config.lastMessageId) continue;
                if (config.seenCodes[msg.code] && config.seenCodes[msg.code] >= msg.messageId) continue;
                config.seenCodes[msg.code] = msg.messageId;
                config.lastMessageId = Math.max(config.lastMessageId, msg.messageId);
                newCount++;
                onNewCode(msg);
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
            notify("Nouveau code Shuffle!", entry.code + " · " + entry.value);
            toast("?? Nouveau: " + entry.code + " · " + entry.value);
            if (config.autoClaimEnabled) {
              enqueueClaim(entry.code);
            }
          }
        
          // --- Shuffle auth (doit intercepter le fetch de la page) -------------------
        
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
        
          function scanStorageForToken() {
            const stores = [];
            try { if (WIN.localStorage) stores.push(WIN.localStorage); } catch {}
            try { if (WIN.sessionStorage) stores.push(WIN.sessionStorage); } catch {}
            for (const store of stores) {
              try {
                const persist = store.getItem("persist:root");
                if (persist) {
                  let t = findJwtDeep(persist);
                  if (!t) {
                    try { t = findJwtDeep(decodeURIComponent(persist)); } catch {}
                  }
                  if (t && applyAuthToken(t)) return true;
                }
              } catch {}
              try {
                for (let i = 0; i < store.length; i++) {
                  const key = store.key(i);
                  const raw = store.getItem(key);
                  if (!raw) continue;
                  if (raw.startsWith("eyJ") && raw.length > 100 && applyAuthToken(raw)) return true;
                  if (raw.includes("eyJ")) {
                    try {
                      const t = findJwtDeep(JSON.parse(raw));
                      if (t && applyAuthToken(t)) return true;
                    } catch {}
                  }
                }
              } catch {}
            }
            return false;
          }
        
          function findJwtInFiber(node, depth = 0) {
            if (!node || depth > 200) return null;
            let s = node.memoizedState;
            while (s) {
              const val = s.memoizedState;
              if (typeof val === "string" && val.startsWith("eyJ")) return val;
              if (val && typeof val === "object") {
                for (const k of ["token", "accessToken", "authToken", "jwt"]) {
                  if (typeof val[k] === "string" && val[k].startsWith("eyJ")) return val[k];
                }
              }
              s = s.next;
            }
            return findJwtInFiber(node.child, depth + 1) || findJwtInFiber(node.sibling, depth + 1);
          }
        
          function scanReactFiberForToken() {
            try {
              const root = WIN.document.querySelector("#__next");
              const fiberKey = root && Object.keys(root).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
              if (!fiberKey) return false;
              const jwt = findJwtInFiber(root[fiberKey]);
              return jwt ? applyAuthToken(jwt) : false;
            } catch {
              return false;
            }
          }
        
          function extractAuthFromHeaders(headers) {
            if (!headers) return;
            let auth = null;
            if (typeof headers.get === "function") {
              auth = headers.get("authorization") || headers.get("Authorization");
            } else if (typeof headers === "object") {
              auth = headers.authorization || headers.Authorization;
            }
            if (auth && auth.startsWith("Bearer eyJ")) applyAuthToken(auth.slice(7));
          }
        
          function installTokenSniffer() {
            if (WIN.__sacSnifferInstalled) return;
            WIN.__sacSnifferInstalled = true;
        
            WIN.addEventListener("message", e => {
              if (e.data && e.data.type === "sac-token" && e.data.token) applyAuthToken(e.data.token);
            });
        
            const patchCode = `
              (function () {
                if (window.__sacPageSniffer) return;
                window.__sacPageSniffer = true;
                function send(t) { try { window.postMessage({ type: "sac-token", token: t }, "*"); } catch (e) {} }
                function fromHeaders(h) {
                  if (!h) return;
                  var a = (typeof h.get === "function") ? (h.get("authorization") || h.get("Authorization")) : (h.authorization || h.Authorization);
                  if (a && a.indexOf("Bearer eyJ") === 0) send(a.slice(7));
                }
                var f = window.fetch;
                if (f) {
                  window.fetch = function (input, init) {
                    try {
                      var u = typeof input === "string" ? input : (input && input.url) || "";
                      if (u.indexOf("graphql") !== -1) fromHeaders(init && init.headers);
                    } catch (e) {}
                    return f.apply(this, arguments);
                  };
                }
                var xo = XMLHttpRequest.prototype.open;
                var xs = XMLHttpRequest.prototype.setRequestHeader;
                XMLHttpRequest.prototype.open = function (m, u) { this._sacU = String(u || ""); return xo.apply(this, arguments); };
                XMLHttpRequest.prototype.setRequestHeader = function (n, v) {
                  try {
                    if (String(n).toLowerCase() === "authorization" && String(v).indexOf("Bearer eyJ") === 0 && this._sacU && this._sacU.indexOf("graphql") !== -1) send(String(v).slice(7));
                  } catch (e) {}
                  return xs.apply(this, arguments);
                };
              })();
            `;
        
            function inject() {
              try {
                const el = document.createElement("script");
                el.textContent = patchCode;
                (document.head || document.documentElement).appendChild(el);
                el.remove();
              } catch (e) {
                log("Injection page échouée:", e.message);
              }
            }
            if (document.head) inject();
            else document.addEventListener("DOMContentLoaded", inject, { once: true });
        
            const origFetch = WIN.fetch.bind(WIN);
            WIN.fetch = function (input, init) {
              try {
                const url = typeof input === "string" ? input : input?.url || "";
                if (url.includes("graphql")) extractAuthFromHeaders(init?.headers);
              } catch {}
              return origFetch(input, init);
            };
        
            const origOpen = WIN.XMLHttpRequest.prototype.open;
            const origSetHeader = WIN.XMLHttpRequest.prototype.setRequestHeader;
            WIN.XMLHttpRequest.prototype.open = function (method, url) {
              this._sacUrl = String(url || "");
              return origOpen.apply(this, arguments);
            };
            WIN.XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
              try {
                if (String(name).toLowerCase() === "authorization" && String(value).startsWith("Bearer eyJ")) {
                  if (this._sacUrl && this._sacUrl.includes("graphql")) applyAuthToken(String(value).slice(7));
                }
              } catch {}
              return origSetHeader.apply(this, arguments);
            };
        
            log("Intercepteur fetch/XHR installé");
          }
        
          function getUsername() {
            try {
              const ls = WIN.localStorage;
              const key = Object.keys(ls).find(k => k.includes("ph_phc_") && k.endsWith("_posthog"));
              if (!key) return null;
              const data = JSON.parse(ls.getItem(key));
              return data?.$stored_person_properties?.username?.toLowerCase() || null;
            } catch {
              return null;
            }
          }
        
          async function captureShuffleToken() {
            installTokenSniffer();
            if (state.bearerToken) return;
            if (scanStorageForToken()) return;
            if (scanReactFiberForToken()) return;
        
            await new Promise((resolve, reject) => {
              const start = Date.now();
              const iv = setInterval(() => {
                if (state.bearerToken) {
                  clearInterval(iv);
                  resolve();
                  return;
                }
                if (scanStorageForToken() || scanReactFiberForToken()) {
                  clearInterval(iv);
                  resolve();
                  return;
                }
                if (Date.now() - start > 30000) {
                  clearInterval(iv);
                  reject(new Error("Token introuvable — rechargez Shuffle (F5) en étant connecté, puis recliquez Claim"));
                }
              }, 400);
            });
          }
        
          async function gql(operationName, variables, query) {
            if (!state.bearerToken) await captureShuffleToken();
            const origin = shuffleOrigin();
            const headers = {
              "content-type": "application/json",
              "x-apollo-operation-name": operationName,
              origin,
              referer: origin + "/"
            };
            if (state.bearerToken) headers.authorization = "Bearer " + state.bearerToken;
            if (state.userId) headers["x-user-id"] = String(state.userId);
        
            const body = JSON.stringify({
              operationName,
              variables,
              extensions: { clientLibrary: { name: "@apollo/client", version: "4.1.6" } },
              query
            });
        
            let res;
            try {
              res = await WIN.fetch(graphqlUrl(), {
                method: "POST",
                credentials: "include",
                headers,
                body
              });
            } catch (err) {
              throw new Error("Réseau (" + origin + ") — " + (err.message || "fetch impossible"));
            }
            if (!res.ok) throw new Error("HTTP " + res.status + " sur " + origin);
            return res.json();
          }
        
          // --- Geetest ---------------------------------------------------------------
        
          async function loadGeetest() {
            if (state.geetestLoaded && WIN.initGeetest4) return;
            await new Promise((resolve, reject) => {
              const s = WIN.document.createElement("script");
              s.src = "https://static.geetest.com/v4/gt4.js";
              s.onload = () => { state.geetestLoaded = true; resolve(); };
              s.onerror = () => reject(new Error("Geetest SDK"));
              WIN.document.head.appendChild(s);
            });
            await new Promise(r => setTimeout(r, 400));
          }
        
          function purgeGeetest() {
            WIN.document.querySelectorAll('script[src*="geetest"], iframe[src*="geetest"], div[class*="geetest"]').forEach(el => {
              try { el.remove(); } catch {}
            });
            try {
              Object.keys(WIN.localStorage).forEach(k => {
                if (/geetest|gt_/i.test(k)) WIN.localStorage.removeItem(k);
              });
            } catch {}
            try { delete WIN.initGeetest4; } catch {}
            state.geetestLoaded = false;
          }
        
          function normalizeGeetestValidate(v) {
            if (!v?.lot_number || !v?.captcha_output || !v?.pass_token || v?.gen_time == null) return null;
            return {
              lot_number: String(v.lot_number),
              captcha_output: String(v.captcha_output),
              pass_token: String(v.pass_token),
              gen_time: String(v.gen_time)
            };
          }
        
          function solveGeetest(nonce) {
            return new Promise((resolve, reject) => {
              let done = false;
              const finish = (fn) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                observer.disconnect();
                try { captchaObj?.destroy(); } catch {}
                try { container.remove(); } catch {}
                fn();
              };
        
              const observer = new MutationObserver(mutations => {
                for (const m of mutations) {
                  for (const node of m.addedNodes) {
                    if (node.tagName !== "SCRIPT" || !node.src?.includes("gcaptcha4.geetest.com/verify")) continue;
                    const cbName = new URL(node.src).searchParams.get("callback");
                    if (!cbName) continue;
                    const orig = WIN[cbName];
                    WIN[cbName] = function (data) {
                      const seccode = normalizeGeetestValidate(data?.data?.seccode);
                      if (seccode) {
                        finish(() => resolve(seccode));
                      }
                      // "continue" = puzzle visuel — on laisse l'UI Geetest ouverte, onSuccess résoudra
                      return orig?.apply(this, arguments);
                    };
                  }
                }
              });
              observer.observe(WIN.document, { childList: true, subtree: true });
        
              const container = WIN.document.createElement("div");
              container.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;min-width:300px;";
              WIN.document.body.appendChild(container);
        
              let captchaObj = null;
              const timer = setTimeout(() => finish(() => reject(new Error("Captcha timeout"))), 20000);
        
              WIN.initGeetest4({
                captchaId: GEETEST_CAPTCHA_ID,
                userInfo: nonce,
                product: "bind",
                language: "en"
              }, obj => {
                captchaObj = obj;
                obj.appendTo(container);
                obj.showCaptcha();
                obj.onSuccess(() => {
                  if (done) return;
                  const v = normalizeGeetestValidate(obj.getValidate());
                  if (!v) {
                    finish(() => reject(new Error("Captcha incomplet — réessayez")));
                    return;
                  }
                  finish(() => resolve(v));
                });
                obj.onError(err => finish(() => reject(new Error("Geetest: " + JSON.stringify(err)))));
              });
            });
          }
        
          async function hmacSign(userId, payload) {
            if (!userId) throw new Error("userId manquant — rechargez la page (F5)");
            const key = await crypto.subtle.importKey(
              "raw",
              new TextEncoder().encode(String(userId)),
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"]
            );
            const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
            return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
          }
        
          // --- Claim engine ----------------------------------------------------------
        
          function enqueueClaim(code) {
            code = code.toUpperCase().trim();
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
            code = code.toUpperCase().trim();
            if (state.claiming.has(code)) return;
            state.claiming.add(code);
            setStatus("Claim " + code + "…");
            const idx = state.codes.findIndex(c => c.code === code);
            if (idx === -1) {
              upsertCodeRecord({
                code, value: "Manual", claims: "-", wager: "-", deadline: "-", type: "Manual"
              }, "manual");
            }
            try {
              if (!state.bearerToken) await captureShuffleToken();
              if (!state.userId) throw new Error("Session invalide — rechargez Shuffle (F5)");
        
              let lastCaptchaError = null;
              for (let attempt = 1; attempt <= 2; attempt++) {
                if (attempt > 1) {
                  purgeGeetest();
                  await new Promise(r => setTimeout(r, 1500));
                  setStatus("Claim " + code + " — retry captcha…");
                }
        
                await loadGeetest();
                const nonceRes = await gql("GetGeetestNonce", {}, "mutation GetGeetestNonce { geetestNonce }");
                if (nonceRes.errors) throw new Error(nonceRes.errors[0].message);
                const nonce = nonceRes.data.geetestNonce;
        
                let geetest;
                try {
                  geetest = await solveGeetest(nonce);
                } catch (e) {
                  purgeGeetest();
                  throw e;
                }
        
                const token = await hmacSign(state.userId, code + "-" + geetest.captcha_output);
                const redeemRes = await gql(
                  "RedeemPromoCode",
                  {
                    data: {
                      codeSlug: code,
                      currency: config.currency,
                      token,
                      geetest: {
                        lot_number: geetest.lot_number,
                        captcha_output: geetest.captcha_output,
                        pass_token: geetest.pass_token,
                        gen_time: geetest.gen_time
                      }
                    }
                  },
                  "mutation RedeemPromoCode($data: PromotionCodeInput!) { redeemPromotionCode(data: $data) { id currency createdAt afterBalance usdRedeemValue __typename } }"
                );
        
                if (redeemRes.errors) {
                  const msg = redeemRes.errors[0].message;
                  const info = classifyClaimError(msg);
                  if (/CAPTCHA/i.test(msg)) {
                    purgeGeetest();
                    lastCaptchaError = msg;
                    if (attempt < 2) continue;
                  }
                  if (info.kind === "already" || info.kind === "dead") {
                    config.seenCodes[code + "_dead"] = Date.now();
                    markClaimResult(code, false, info.label, null, info.kind);
                    toast("?? " + code + " — " + info.label, "warning");
                  } else {
                    markClaimResult(code, false, info.label, null, "error");
                    toast("? " + code + ": " + info.label, "error");
                    notify("Échec claim", code + " — " + info.label);
                  }
                  return;
                }
        
                const val = redeemRes.data?.redeemPromotionCode?.usdRedeemValue;
                const amountUsd = val ? parseFloat(val) : 0;
                markClaimResult(code, true, null, val ? "$" + val : null);
                config.seenCodes[code + "_ok"] = Date.now();
                toast("? " + code + " réclamé!" + (val ? " · $" + val : ""), "success");
                notify("Code réclamé!", code + (val ? " · $" + val : ""));
                return;
              }
        
              if (lastCaptchaError) {
                markClaimResult(code, false, lastCaptchaError);
                toast("? " + code + ": " + lastCaptchaError, "error");
                notify("Échec claim", code + " — " + lastCaptchaError);
              }
            } catch (err) {
              markClaimResult(code, false, err.message);
              toast("? " + code + ": " + err.message, "error");
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
        
          // --- VIP Bonuses -----------------------------------------------------------
        
          function anyVipAutoEnabled() {
            return config.autoVipInstantRakeback || config.autoVipRakeback || config.autoVipWeekly || config.autoVipMonthly || config.autoVipReload;
          }
        
          function setVipStatus(msg) {
            const el = document.getElementById("wb-vip-status");
            if (el) el.textContent = msg;
            log("[VIP]", msg);
          }
        
          function isVipUnavailableError(msg) {
            return /no_\w*(bonus|balance)\w*|already.?claimed|not.?available|nothing.?to.?claim|rien.?a.?reclamer/i.test(String(msg || ""));
          }
        
          async function getVipBonusSchedule(type) {
            const def = VIP_BONUS[type];
            if (!def) return null;
            const query = "query " + def.getOp + " { " + def.getField + " { nextClaimDate } }";
            const res = await gql(def.getOp, {}, query);
            if (!res?.data) return null;
            const info = res.data[def.getField];
            if (info && typeof info === "object") return info;
            for (const key of Object.keys(res.data)) {
              const val = res.data[key];
              if (val && typeof val === "object" && "nextClaimDate" in val) return val;
            }
            return null;
          }
        
          async function isVipBonusReady(type) {
            const def = VIP_BONUS[type];
            if (def?.alwaysTry) return true;
            const info = await getVipBonusSchedule(type);
            if (!info) return true;
            if (!info.nextClaimDate) return true;
            return new Date(info.nextClaimDate).getTime() <= Date.now();
          }
        
          function parseReloadBonuses(rawList) {
            const now = Date.now();
            return rawList.filter(b => !b.cancelledAt && new Date(b.endAt).getTime() > now).map(b => {
              const created = new Date(b.createdAt).getTime();
              const cadenceMs = b.cadence * 1000;
              const elapsed = now - created;
              let unlocked = Math.floor(elapsed / cadenceMs) + 1;
              if (unlocked > b.occurrence) unlocked = b.occurrence;
              const claimed = {};
              (b.bonusClaims || []).forEach(c => { claimed[c.occurrenceIndex] = true; });
              const unclaimedReady = [];
              for (let i = 1; i <= unlocked; i++) {
                if (!claimed[i]) unclaimedReady.push(i);
              }
              let nextIdx = null;
              for (let i = unlocked + 1; i <= b.occurrence; i++) {
                if (!claimed[i]) { nextIdx = i; break; }
              }
              const nextClaimDate = nextIdx ? new Date(created + (nextIdx - 1) * cadenceMs).toISOString() : null;
              return {
                id: b.id,
                reasonType: b.reasonType || b.type,
                bonusAmountUsd: b.bonusAmountUsd,
                unclaimedReady,
                claimable: unclaimedReady.length > 0,
                nextClaimDate
              };
            });
          }
        
          async function fetchReloadBonuses() {
            const res = await gql("GetVipBonus", {}, GET_VIP_BONUS_QUERY);
            if (!res?.data || !Array.isArray(res.data.vipBonus)) return [];
            return parseReloadBonuses(res.data.vipBonus);
          }
        
          async function solveCaptchaBundle() {
            if (!state.bearerToken) await captureShuffleToken();
            await loadGeetest();
            const nonceRes = await gql("GetGeetestNonce", {}, "mutation GetGeetestNonce { geetestNonce }");
            if (nonceRes.errors) throw new Error(nonceRes.errors[0].message);
            try {
              return await solveGeetest(nonceRes.data.geetestNonce);
            } catch (e) {
              purgeGeetest();
              throw e;
            }
          }
        
          async function claimVipSimple(type) {
            const def = VIP_BONUS[type];
            const variables = def.hasCurrency ? { currency: config.currency } : {};
            const res = await gql(def.claimOp, variables, def.claimQuery);
            if (res.errors) throw new Error(res.errors[0].message);
            const data = res.data?.[def.claimField];
        
            if (def.arrayResult) {
              if (!Array.isArray(data) || !data.length) throw new Error("Rien a reclamer");
              const summary = data.map(a => a.amount + " " + a.currency).join(", ");
              return { label: def.label, amount: summary, currency: null, amounts: data };
            }
        
            if (!data) throw new Error("Reponse vide");
            const amt = data.claimedAmount;
            return {
              label: def.label,
              amount: amt?.amount,
              currency: amt?.currency || config.currency,
              nextClaimDate: data.nextClaimDate || null
            };
          }
        
          async function claimVipReloadOnce(bonusId) {
            const geetest = await solveCaptchaBundle();
            const token = await hmacSign(state.userId, bonusId + "-" + geetest.captcha_output);
            const res = await gql("VipReloadClaimBonus", {
              data: {
                bonusId,
                geetest: {
                  lot_number: geetest.lot_number,
                  captcha_output: geetest.captcha_output,
                  pass_token: geetest.pass_token,
                  gen_time: geetest.gen_time
                },
                token,
                currency: config.currency
              }
            }, VIP_RELOAD_CLAIM_QUERY);
            if (res.errors) throw new Error(res.errors[0].message);
            const claims = res.data?.vipReloadClaimBonus;
            if (!claims || (Array.isArray(claims) && !claims.length)) throw new Error("Reload non reclame");
            return { label: "VIP reload", bonusId };
          }
        
          async function claimVipReloadAll() {
            const bonuses = (await fetchReloadBonuses()).filter(b => b.claimable);
            if (!bonuses.length) return [];
            const results = [];
            for (const bonus of bonuses) {
              for (let i = 0; i < bonus.unclaimedReady.length; i++) {
                try {
                  const r = await claimVipReloadOnce(bonus.id);
                  results.push({ ok: true, ...r, reasonType: bonus.reasonType });
                  if (i < bonus.unclaimedReady.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                  }
                } catch (err) {
                  results.push({ ok: false, reasonType: bonus.reasonType, error: err.message });
                  if (isVipUnavailableError(err.message)) break;
                }
              }
            }
            return results;
          }
        
          async function runVipBonusChecks(manual) {
            if (state.vipClaimRunning) return;
            if (!manual && !anyVipAutoEnabled()) return;
            if (!state.isMaster && !manual) return;
            if (!state.bearerToken) {
              try { await captureShuffleToken(); } catch { return; }
            }
        
            state.vipClaimRunning = true;
            const claimed = [];
        
            try {
              for (const type of VIP_SIMPLE_TYPES) {
                const autoKey = VIP_AUTO_KEYS[type];
                if (!manual && !config[autoKey]) continue;
                if (!manual && !(await isVipBonusReady(type))) continue;
                setVipStatus("Claim " + VIP_BONUS[type].label + "…");
                try {
                  const r = await claimVipSimple(type);
                  const txt = r.currency ? r.amount + " " + r.currency : (r.amount || "OK");
                  claimed.push(VIP_BONUS[type].label + ": " + txt);
                  toast("VIP " + VIP_BONUS[type].label + " — " + txt, "success");
                  notify("Bonus VIP", VIP_BONUS[type].label + " — " + txt);
                  playAlert();
                } catch (err) {
                  if (!isVipUnavailableError(err.message)) {
                    claimed.push(VIP_BONUS[type].label + ": " + err.message);
                    log("VIP", type, err.message);
                  }
                }
              }
        
              if (manual || config.autoVipReload) {
                setVipStatus("Verification VIP reload…");
                const reloadResults = await claimVipReloadAll();
                reloadResults.forEach(r => {
                  if (r.ok) {
                    claimed.push("Reload " + (r.reasonType || "") + ": OK");
                    toast("VIP reload reclame", "success");
                    notify("Bonus VIP", "Reload reclame");
                    playAlert();
                  } else if (!isVipUnavailableError(r.error)) {
                    claimed.push("Reload: " + r.error);
                  }
                });
              }
        
              setVipStatus(claimed.length ? claimed.join(" · ") : "Aucun bonus VIP disponible");
            } catch (err) {
              setVipStatus("Erreur VIP: " + err.message);
            } finally {
              state.vipClaimRunning = false;
            }
          }
        
          function startVipPolling() {
            if (state.vipTimer) clearInterval(state.vipTimer);
            if (!anyVipAutoEnabled()) return;
            runVipBonusChecks(false);
            state.vipTimer = setInterval(() => runVipBonusChecks(false), config.vipCheckIntervalMs);
          }
        
          // --- Master tab (un seul onglet poll) -------------------------------------
        
          function electMasterTab() {
            const masterId = storage.get("sac_master_tab", "");
            const lastBeat = parseInt(storage.get("sac_master_beat", "0"), 10);
            const now = Date.now();
            if (!masterId || now - lastBeat > 10000) {
              storage.set("sac_master_tab", state.tabId);
              storage.set("sac_master_beat", String(now));
              state.isMaster = true;
            } else if (masterId === state.tabId) {
              state.isMaster = true;
            }
            if (state.isMaster) {
              setInterval(() => storage.set("sac_master_beat", String(Date.now())), 3000);
            }
            window.addEventListener("beforeunload", () => {
              if (storage.get("sac_master_tab", "") === state.tabId) {
                GM_deleteValue("sac_master_tab");
                GM_deleteValue("sac_master_beat");
              }
            });
          }
        
          // --- Keep-alive (onglet en veille) -----------------------------------------
        
          function startKeepAlive() {
            document.addEventListener("visibilitychange", () => {
              if (!document.hidden) pollTelegram();
            });
            window.addEventListener("focus", () => pollTelegram());
            window.addEventListener("online", () => setTimeout(pollTelegram, 2000));
            if (navigator.locks) {
              navigator.locks.request("sac_keep_alive", { mode: "shared" }, () => new Promise(() => {}));
            }
            state.watchdogTimer = setInterval(() => {
              if (state.isMaster) pollTelegram();
              if (!state.bearerToken) captureShuffleToken().catch(() => {});
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
        
          // --- UI --------------------------------------------------------------------
        
          function renderUI() {
            if (document.getElementById("wb-root")) return;
            state.activeTab = state.activeTab || "history";
        
            const style = document.createElement("style");
            style.textContent = `
              @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
              #wb-root{font-family:'Space Grotesk',system-ui,sans-serif;color:#ece8f4;--wb-bg:#07060b;--wb-surface:#110f18;--wb-surface2:#1a1724;--wb-border:rgba(168,85,247,.18);--wb-purple:#a855f7;--wb-purple2:#c084fc;--wb-green:#4ade80;--wb-red:#f87171;--wb-amber:#fbbf24;--wb-muted:#8b849c}
              #wb-header{position:fixed;top:14px;right:14px;z-index:999999;padding:0;margin:0;background:none;border:none;box-shadow:none;height:auto;width:auto;display:block}
              .wb-burger{width:44px;height:44px;border-radius:12px;border:1px solid var(--wb-border);background:linear-gradient(180deg,#0d0b14 0%,#07060b 100%);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;box-shadow:0 4px 24px rgba(0,0,0,.55);padding:0}
              .wb-burger:hover{border-color:rgba(168,85,247,.45);box-shadow:0 4px 28px rgba(168,85,247,.25)}
              .wb-burger span{display:block;width:18px;height:2px;border-radius:1px;background:#c084fc;transition:transform .25s,opacity .25s}
              .wb-burger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
              .wb-burger.open span:nth-child(2){opacity:0}
              .wb-burger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
              .wb-panel-head{padding:16px;border-bottom:1px solid var(--wb-border);background:var(--wb-surface);display:flex;flex-direction:column;gap:12px}
              .wb-panel-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
              .wb-brand{display:flex;align-items:center;gap:12px;min-width:0}
              .wb-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a855f7 50%,#c084fc);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;box-shadow:0 0 20px rgba(168,85,247,.45);flex-shrink:0}
              .wb-title{font-weight:700;font-size:16px;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
              .wb-sub{font-size:11px;color:var(--wb-muted);margin-top:1px}
              #wb-live-dot{width:8px;height:8px;border-radius:50%;background:#4b5563;display:inline-block;margin-right:6px;vertical-align:middle}
              #wb-live-dot.on{background:var(--wb-green);box-shadow:0 0 10px rgba(74,222,128,.7);animation:wb-pulse 2s infinite}
              @keyframes wb-pulse{0%,100%{opacity:1}50%{opacity:.5}}
              #wb-stat-badge{font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(168,85,247,.12);border:1px solid var(--wb-border);color:var(--wb-purple2)}
              .wb-user-pill{font-size:11px;padding:5px 12px;border-radius:20px;background:var(--wb-surface2);border:1px solid var(--wb-border);color:#c4b5d8;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              .wb-claim-box{display:flex;align-items:center;gap:6px;background:var(--wb-surface2);border:1px solid var(--wb-border);border-radius:10px;padding:4px 4px 4px 12px;width:100%;box-sizing:border-box}
              .wb-claim-box input{flex:1;min-width:0;width:auto;border:none;background:transparent;color:#fff;font:600 13px 'JetBrains Mono',monospace;text-transform:uppercase;outline:none}
              .wb-claim-box input::placeholder{color:#5c5470;text-transform:none;font-weight:500}
              .wb-btn{padding:8px 14px;border-radius:8px;border:none;font:600 12px 'Space Grotesk',sans-serif;cursor:pointer;transition:transform .15s,box-shadow .15s}
              .wb-btn:hover{transform:translateY(-1px)}
              .wb-btn-primary{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;box-shadow:0 4px 16px rgba(168,85,247,.35)}
              .wb-btn-ghost{background:var(--wb-surface2);color:#d8cce8;border:1px solid var(--wb-border)}
              .wb-btn-sm{padding:6px 10px;font-size:11px}
              #wb-panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;background:var(--wb-bg);border-left:1px solid var(--wb-border);z-index:999998;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:-8px 0 40px rgba(0,0,0,.5)}
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
              <button type="button" class="wb-burger" id="wb-toggle-panel" aria-label="Menu WaggerBot" title="Menu">
                <span></span><span></span><span></span>
              </button>
            `;
        
            const panel = document.createElement("div");
            panel.id = "wb-panel";
            panel.innerHTML = `
              <div class="wb-panel-head">
                <div class="wb-panel-head-top">
                  <div class="wb-brand">
                    <div class="wb-logo">W</div>
                    <div>
                      <div class="wb-title">WaggerBot · Shuffle</div>
                      <div class="wb-sub"><span id="wb-live-dot" class="on"></span><span id="wb-status">${state.lastStatus}</span></div>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <span id="wb-stat-badge" class="wb-stat-badge">0 claim · $0.00</span>
                    <span class="wb-user-pill" id="wb-user">${state.username || "…"}</span>
                  </div>
                </div>
                <div class="wb-claim-box">
                  <input id="wb-manual-input" placeholder="Code" maxlength="20" autocomplete="off" spellcheck="false"/>
                  <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-manual-claim">Claim</button>
                </div>
              </div>
              <div class="wb-tabs">
                <button class="wb-tab active" data-tab="history">Historique</button>
                <button class="wb-tab" data-tab="stats">Statistiques</button>
                <button class="wb-tab" data-tab="settings">Réglages</button>
              </div>
              <div id="wb-panel-history" class="wb-tab-panel active">
                <div style="padding:10px 16px 0;font-size:11px;color:var(--wb-muted)">Mon canal · <a href="https://t.me/waggerbot_officiel" target="_blank" style="color:var(--wb-purple2);text-decoration:none">Wagger Bot</a></div>
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
                    <label class="wb-setting-check"><input type="checkbox" id="wb-sound" ${config.soundEnabled ? "checked" : ""}/> Son alerte</label>
                  </div>
                  <div class="wb-section-title" style="margin-top:4px">Bonus VIP auto-claim</div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-vip-instant-rakeback" ${config.autoVipInstantRakeback ? "checked" : ""}/> Rakeback instantane</label>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-vip-rakeback" ${config.autoVipRakeback ? "checked" : ""}/> Daily rakeback</label>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-vip-weekly" ${config.autoVipWeekly ? "checked" : ""}/> Weekly bonus</label>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-vip-monthly" ${config.autoVipMonthly ? "checked" : ""}/> Monthly bonus</label>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-vip-reload" ${config.autoVipReload ? "checked" : ""}/> VIP reload</label>
                  </div>
                  <div class="wb-setting-row">
                    <label>Intervalle check VIP</label>
                    <span><input id="wb-vip-interval" type="number" min="1" max="60" value="${config.vipCheckIntervalMs / 60000}" style="width:52px"/> min</span>
                  </div>
                  <div id="wb-vip-status" style="font-size:11px;color:var(--wb-muted);margin:8px 0;line-height:1.5">—</div>
                  <div class="wb-actions">
                    <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-vip-claim-now">Claim bonus VIP</button>
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
        
            const burgerBtn = document.getElementById("wb-toggle-panel");
            burgerBtn.onclick = () => {
              const open = panel.classList.toggle("open");
              burgerBtn.classList.toggle("open", open);
            };
            document.querySelectorAll(".wb-tab").forEach(btn => {
              btn.onclick = () => switchTab(btn.dataset.tab);
            });
            document.getElementById("wb-manual-claim").onclick = () => {
              const v = document.getElementById("wb-manual-input").value.trim().toUpperCase();
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
            const bindVipToggle = (id, key) => {
              document.getElementById(id).onchange = e => {
                config[key] = e.target.checked;
                persistConfig();
                startVipPolling();
              };
            };
            bindVipToggle("wb-vip-instant-rakeback", "autoVipInstantRakeback");
            bindVipToggle("wb-vip-rakeback", "autoVipRakeback");
            bindVipToggle("wb-vip-weekly", "autoVipWeekly");
            bindVipToggle("wb-vip-monthly", "autoVipMonthly");
            bindVipToggle("wb-vip-reload", "autoVipReload");
            document.getElementById("wb-vip-interval").onchange = e => {
              config.vipCheckIntervalMs = Math.max(1, parseInt(e.target.value, 10) || 5) * 60000;
              persistConfig();
              startVipPolling();
            };
            document.getElementById("wb-vip-claim-now").onclick = () => runVipBonusChecks(true);
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
                  <span class="wb-type-tag">${c.type || "Code"}</span>
                  <div class="time">${formatTime(c.claimedAt)}</div>
                </div>
                <span class="amt">${c.value || "—"}</span>
              </div>
            `).join("");
        
            box.innerHTML = `
              <div class="wb-stat-grid">
<div class="wb-stat-card wide">
                  <div class="label">Total gagné (SESSIONS)</div>
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
              box.innerHTML = '<div class="wb-empty">En attente de codes depuis<br><strong>@shufflecodesdrops</strong></div>';
              return;
            }
            box.innerHTML = state.codes.map(c => {
              let cls = "";
              let status = "? En attente de claim";
              if (c.claimed) {
                cls = "ok";
                status = "? Réclamé" + (c.value && c.value !== "N/A" && c.value !== "Manual" ? " · " + c.value : "");
              } else if (c.rejectionReason) {
                cls = c.resultKind === "already" || c.resultKind === "dead" ? "warn" : "err";
                status = (c.resultKind === "already" ? "?? " : "? ") + c.rejectionReason;
              }
              return `<div class="wb-code-card ${cls}">
                <div><span class="code">${c.code}</span><span class="wb-type-tag">${c.type || "Code"}</span></div>
                <div class="meta">${c.value !== "Manual" ? c.value + " · " : ""}${c.wager !== "-" && c.wager !== "Unknown" ? c.wager + " wager · " : ""}${c.claims !== "-" ? c.claims : ""}</div>
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
              await captureShuffleToken();
              setStatus("Connecté · poll Telegram actif");
            } catch {
              setStatus("Pas de token Shuffle — F5 puis Claim");
            }
      
            startKeepAlive();
            if (state.isMaster) {
              startPolling();
              startVipPolling();
            }
          }
      
          init().catch(err => log("Init error", err));
    })();
  }

  if (PLATFORM === "stake") {
    (function () {
      "use strict";

          const WIN = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      
          function stakeOrigin() {
            const origin = WIN.location.origin;
            if (/^https:\/\/stake\.(com|bet)$/i.test(origin)) return origin;
            return "https://stake.com";
          }
        
          function graphqlUrl() {
            return stakeOrigin() + "/_api/graphql";
          }
        
          const TURNSTILE_SITE_KEY_DEFAULT = "0x4AAAAAAAGD4gMGOTFnvupz";
          let turnstileSiteKey = TURNSTILE_SITE_KEY_DEFAULT;
          const TELEGRAM_CHANNEL = "AntebotStakeCodes";
          const TELEGRAM_BASES = ["https://telegram.me/s/", "https://t.me/s/"];
          const SESSION_RE = /(?:^|; )session=([^;]*)/;
        
          const CURRENCIES = ["btc", "eth", "ltc", "usdt", "doge", "sol", "xrp", "trx", "bnb", "usdc"];
        
          const BONUS_CODE_INFO_QUERY = `query BonusCodeInformation($code: String!, $couponType: CouponType!) {
            bonusCodeInformation(code: $code, couponType: $couponType) {
              availabilityStatus
              bonusValue
              cryptoMultiplier
            }
          }`;
        
          const CLAIM_BONUS_QUERY = `mutation ClaimBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) {
            claimBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) {
              bonusCode { id code }
              amount
              currency
              redeemed
            }
          }`;
        
          const USER_QUERY = `query UserMeta { user { id name } }`;
        
          const state = {
            sessionToken: null,
            username: null,
            turnstileReady: false,
            claiming: new Set(),
            claimQueue: [],
            queueRunning: false,
            codes: [],
            lastTelegramPoll: 0,
            lastStatus: "Initialisation…",
            tabId: Math.random().toString(36).slice(2, 10) + "_" + Date.now(),
            isMaster: false,
            pollTimer: null,
            watchdogTimer: null,
            turnstile: null,
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
            currency: storage.get("stk_currency", "usdt"),
            pollIntervalMs: parseInt(storage.get("stk_poll_interval", "20"), 10) * 1000,
            soundEnabled: storage.get("stk_sound", true),
            notifyEnabled: storage.get("stk_notify", true),
            autoClaimEnabled: storage.get("stk_auto_claim", true),
            claimDelayMs: parseInt(storage.get("stk_claim_delay", "0"), 10) * 1000,
            lastMessageId: parseInt(storage.get("stk_last_msg_id", "0"), 10) || 0,
            seenCodes: storage.getJSON("stk_seen_codes", {}),
            codeHistory: storage.getJSON("stk_code_history", []),
          };
        
          function persistConfig() {
            storage.set("stk_currency", config.currency);
            storage.set("stk_poll_interval", String(config.pollIntervalMs / 1000));
            storage.set("stk_sound", config.soundEnabled);
            storage.set("stk_notify", config.notifyEnabled);
            storage.set("stk_auto_claim", config.autoClaimEnabled);
            storage.set("stk_claim_delay", String(config.claimDelayMs / 1000));
            storage.set("stk_last_msg_id", String(config.lastMessageId));
            storage.setJSON("stk_seen_codes", config.seenCodes);
            storage.setJSON("stk_code_history", state.codes);
          }
          // --- Logging / UI helpers --------------------------------------------------
        
          function log(...args) {
            console.log("[WaggerBot]", ...args);
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
        
          // --- Telegram parser -------------------------------------------------------
        
          function parseTelegramMessage(text) {
            if (!text) return null;
        
            const statsMatch = text.match(/CLAIMS:\s*([\d,]+)\s*-\s*WAGER:\s*\$?([\d,]+)\$?\s*-\s*AMOUNT:\s*\$?([\d.,]+)\$?/i);
            if (statsMatch) {
              return {
                kind: "stats",
                claims: statsMatch[1].replace(/,/g, ""),
                wager: "$" + statsMatch[2].replace(/,/g, ""),
                value: "$" + statsMatch[3].replace(/,/g, ""),
                timestamp: Date.now()
              };
            }
        
            const tickMatch = text.match(/`([a-zA-Z0-9_-]{3,40})`/);
            const plainCode = tickMatch ? tickMatch[1] : (/^[a-zA-Z0-9_-]{3,40}$/.test(text.trim()) ? text.trim() : null);
            if (plainCode) {
              const code = plainCode.toLowerCase();
              if (/^CLAIMS:/i.test(code)) return null;
              return {
                kind: "code",
                code,
                value: "N/A",
                claims: "-",
                wager: "-",
                deadline: "N/A",
                type: code.startsWith("stakecom") ? "Drop" : "Code",
                source: "telegram:" + TELEGRAM_CHANNEL,
                timestamp: Date.now()
              };
            }
        
            const legacyMatch = text.match(/Code:\s*`?([A-Za-z0-9_-]{3,40})`?/i);
            if (legacyMatch) {
              const code = legacyMatch[1].toLowerCase();
              const valueMatch = text.match(/(?:AMOUNT|Value):\s*\$?([\d.,]+)/i);
              const claimsMatch = text.match(/Claims:\s*([^\n]+)/i);
              const wagerMatch = text.match(/Wager:\s*\$?([\d.,]+)/i);
              return {
                kind: "code",
                code,
                value: valueMatch ? "$" + valueMatch[1] : "N/A",
                claims: claimsMatch ? claimsMatch[1].trim() : "-",
                wager: wagerMatch ? "$" + wagerMatch[1] : "-",
                deadline: "N/A",
                type: "Code",
                source: "telegram:" + TELEGRAM_CHANNEL,
                timestamp: Date.now()
              };
            }
        
            return null;
          }
        
          function parseTelegramHtml(html) {
            const results = [];
            const channelEsc = TELEGRAM_CHANNEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const blocks = html.split(new RegExp("(?=data-post=\"" + channelEsc + "/)"));
            for (const block of blocks) {
              const idMatch = block.match(new RegExp("data-post=\"" + channelEsc + "/(\\d+)\""));
              if (!idMatch) continue;
              const messageId = parseInt(idMatch[1], 10);
              const textMatch = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
              if (!textMatch) continue;
              const text = textMatch[1]
                .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, "")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
                .trim();
              const parsed = parseTelegramMessage(text);
              if (parsed) {
                parsed.messageId = messageId;
                results.push(parsed);
              }
            }
            return results.sort((a, b) => a.messageId - b.messageId);
          }
        
          function mergeTelegramMessages(messages) {
            const merged = [];
            let lastCode = null;
            for (const msg of messages) {
              if (msg.kind === "stats") {
                if (lastCode) {
                  lastCode.claims = msg.claims;
                  lastCode.wager = msg.wager;
                  if (msg.value && msg.value !== "N/A") lastCode.value = msg.value;
                }
                continue;
              }
              if (msg.kind === "code") {
                const entry = { ...msg };
                delete entry.kind;
                merged.push(entry);
                lastCode = entry;
              }
            }
            return merged;
          }
        
          function telegramPageUrl(base, beforeId) {
            const url = base + TELEGRAM_CHANNEL;
            return beforeId ? url + "?before=" + beforeId : url;
          }
      
          function gmGetTelegramPage(url) {
            return new Promise((resolve, reject) => {
              GM_xmlhttpRequest({
                method: "GET",
                url,
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9"
                },
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
      
          async function fetchTelegramPage(beforeId) {
            let lastErr = null;
            for (const base of TELEGRAM_BASES) {
              try {
                return await gmGetTelegramPage(telegramPageUrl(base, beforeId));
              } catch (err) {
                lastErr = err;
              }
            }
            throw lastErr || new Error("Telegram inaccessible (telegram.me / t.me)");
          }
        
          function classifyClaimError(msg) {
            const m = String(msg || "").toUpperCase();
            if (/ALREADY.?CLAIMED|BONUSCODEALREADYCLAIMED|ALREADY_REDEEMED/.test(m)) {
              return { kind: "already", label: "Déjà réclamé (par vous)" };
            }
            if (/FULLY.?CLAIMED|BONUSCODEFULLYCLAIMED|LIMIT/.test(m)) {
              return { kind: "dead", label: "Code épuisé (limite atteinte)" };
            }
            if (/NOT.?FOUND|INACTIVE|INVALID|BONUSCODENOTFOUND|BONUSCODEINACTIVE|DOES.?NOT.?EXIST/.test(m)) {
              return { kind: "dead", label: "Code expiré ou invalide" };
            }
            if (/WAGER|DEPOSIT|VIP|LEVEL|REQUIREMENT|ELIGIB/.test(m)) {
              return { kind: "wager", label: msg };
            }
            if (/RATE.?LIMIT|429|TOO.?MANY/.test(m)) {
              return { kind: "rate", label: "Rate limit — réessayez plus tard" };
            }
            return { kind: "error", label: msg };
          }
        
          async function fetchTelegramMessages() {
            const html = await fetchTelegramPage();
            return mergeTelegramMessages(parseTelegramHtml(html));
          }
        
          function upsertCodeRecord(entry, source) {
            let rec = state.codes.find(c => c.code === entry.code);
            if (rec) {
              if (entry.value && entry.value !== "N/A") rec.value = entry.value;
              if (entry.wager && entry.wager !== "-") rec.wager = entry.wager;
              if (entry.type) rec.type = entry.type;
              if (entry.claims && entry.claims !== "-") rec.claims = entry.claims;
              return rec;
            }
            rec = {
              code: entry.code,
              value: entry.value || "N/A",
              claims: entry.claims || "-",
              wager: entry.wager || "-",
              deadline: entry.deadline || "-",
              type: entry.type || "Code",
              timestamp: entry.timestamp || Date.now(),
              messageId: entry.messageId || null,
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
              const maxId = Math.max(...messages.map(m => m.messageId));
              let imported = 0;
              for (const msg of messages) {
                if (!config.seenCodes[msg.code]) {
                  config.seenCodes[msg.code] = msg.messageId;
                  imported++;
                }
                upsertCodeRecord(msg, "telegram");
              }
              config.lastMessageId = Math.max(config.lastMessageId, maxId);
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
        
              setStatus("TG sync · " + messages.length + " codes · id #" + config.lastMessageId);
              toast(imported + " nouveau(x) importé(s) depuis Telegram", "info");
            } catch (err) {
              setStatus("Erreur Telegram: " + err.message);
              toast("Telegram: " + err.message, "error");
            }
          }
        
          function resetTelegramWatch() {
            config.lastMessageId = 0;
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
        
              const maxId = Math.max(...messages.map(m => m.messageId));
              const autoLabel = config.autoClaimEnabled ? "AUTO ON" : "AUTO OFF";
        
              if (!config.lastMessageId) {
                config.lastMessageId = maxId;
                const latest = messages[messages.length - 1];
                for (const msg of messages) {
                  config.seenCodes[msg.code] = msg.messageId;
                  const rec = upsertCodeRecord(msg, "telegram");
                  rec.historical = msg !== latest;
                }
                persistConfig();
                refreshDashboard();
                if (config.autoClaimEnabled && latest) {
                  enqueueClaim(latest.code);
                  setStatus(autoLabel + " · Init #" + maxId + " · claim " + latest.code);
                } else {
                  setStatus(autoLabel + " · Init #" + maxId + " · historique importé");
                }
                return;
              }
        
              let newCount = 0;
              for (const msg of messages) {
                if (msg.messageId <= config.lastMessageId) continue;
                if (config.seenCodes[msg.code] && config.seenCodes[msg.code] >= msg.messageId) continue;
                config.seenCodes[msg.code] = msg.messageId;
                config.lastMessageId = Math.max(config.lastMessageId, msg.messageId);
                newCount++;
                onNewCode(msg);
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
            notify("Nouveau code Stake!", entry.code + " · " + entry.value);
            toast("Nouveau: " + entry.code + " · " + entry.value);
            if (config.autoClaimEnabled) {
              enqueueClaim(entry.code);
            }
          }
        
          // --- Stake auth ------------------------------------------------------------
        
          function getSessionToken() {
            const m = WIN.document.cookie.match(SESSION_RE);
            const token = m ? decodeURIComponent(m[1]).replace(/"/g, "") : null;
            if (token) state.sessionToken = token;
            return token;
          }
        
          function getLocale() {
            const m = WIN.document.cookie.match(/(?:^|; )locale=([^;]*)/);
            return m ? decodeURIComponent(m[1]).replace(/"/g, "") : "en";
          }
        
          function ensureSession() {
            const token = getSessionToken();
            if (!token) {
              throw new Error("Session introuvable — connectez-vous sur Stake (F5), puis recliquez Claim");
            }
            return token;
          }
        
          async function fetchUsername() {
            try {
              ensureSession();
              const res = await gql("UserMeta", {}, USER_QUERY, "query");
              const name = res?.data?.user?.name;
              if (name) {
                state.username = name;
                const el = document.getElementById("wb-user");
                if (el) el.textContent = name;
              }
            } catch {}
          }
        
          async function gql(operationName, variables, query, opType = "query") {
            ensureSession();
            const origin = stakeOrigin();
            const headers = {
              accept: "*/*",
              "content-type": "application/json",
              "x-access-token": state.sessionToken,
              "x-language": getLocale(),
              "x-operation-name": operationName,
              "x-operation-type": opType,
              origin,
              referer: origin + "/"
            };
        
            const body = JSON.stringify({
              operationName,
              variables: variables || {},
              query
            });
        
            let res;
            try {
              res = await WIN.fetch(graphqlUrl(), {
                method: "POST",
                credentials: "include",
                headers,
                body
              });
            } catch (err) {
              throw new Error("Réseau (" + origin + ") — " + (err.message || "fetch impossible"));
            }
        
            if (res.status === 429) {
              const retryAfter = res.headers.get("retry-after") || "60";
              throw new Error("Rate limit — attendez " + retryAfter + "s");
            }
        
            const text = await res.text();
            if (!res.ok) {
              if (text.includes("<!DOCTYPE")) throw new Error("Cloudflare a bloqué la requête");
              throw new Error("HTTP " + res.status + " sur " + origin);
            }
        
            try {
              return JSON.parse(text);
            } catch {
              throw new Error("Réponse invalide du serveur");
            }
          }
        
          // --- Turnstile -------------------------------------------------------------
        
          function setTurnstileSiteKey(key) {
            if (!key || typeof key !== "string" || !key.startsWith("0x4AAAA")) return false;
            if (key === turnstileSiteKey) return true;
            turnstileSiteKey = key;
            storage.set("stk_turnstile_key", key);
            log("Turnstile sitekey:", key);
            return true;
          }
        
          function discoverTurnstileSiteKey() {
            const saved = storage.get("stk_turnstile_key", "");
            if (saved && saved.startsWith("0x4AAAA")) turnstileSiteKey = saved;
        
            const re = /0x4AAAAAAA[A-Za-z0-9_-]{10,}/g;
            const sources = [];
            try {
              document.querySelectorAll("[data-sitekey]").forEach(el => {
                const k = el.getAttribute("data-sitekey");
                if (k) sources.push(k);
              });
            } catch {}
            try {
              const html = WIN.document.documentElement?.innerHTML || "";
              const found = html.match(re);
              if (found) sources.push(...found);
            } catch {}
            try {
              for (const s of WIN.document.scripts) {
                const txt = s.textContent || s.innerHTML || "";
                const found = txt.match(re);
                if (found) sources.push(...found);
              }
            } catch {}
        
            const counts = {};
            for (const k of sources) counts[k] = (counts[k] || 0) + 1;
            const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            if (best) setTurnstileSiteKey(best);
            return turnstileSiteKey;
          }
        
          function installTurnstileSniffer() {
            if (WIN.__wbTsSnifferInstalled) return;
            WIN.__wbTsSnifferInstalled = true;
        
            WIN.addEventListener("message", e => {
              if (e.data?.type === "wb-turnstile-key" && e.data.sitekey) {
                setTurnstileSiteKey(e.data.sitekey);
              }
            });
        
            const patch = `
              (function () {
                if (window.__wbTsPageSniffer) return;
                window.__wbTsPageSniffer = true;
                function send(k) { try { window.postMessage({ type: "wb-turnstile-key", sitekey: k }, "*"); } catch (e) {} }
                function hook() {
                  if (!window.turnstile || window.turnstile.__wbHooked) return;
                  var orig = window.turnstile.render;
                  window.turnstile.render = function (el, opts) {
                    if (opts && opts.sitekey) send(opts.sitekey);
                    return orig.apply(this, arguments);
                  };
                  window.turnstile.__wbHooked = true;
                }
                var iv = setInterval(hook, 400);
                setTimeout(function () { clearInterval(iv); }, 120000);
              })();
            `;
            function inject() {
              try {
                const el = document.createElement("script");
                el.textContent = patch;
                (document.head || document.documentElement).appendChild(el);
                el.remove();
              } catch (e) {
                log("Sniffer Turnstile:", e.message);
              }
            }
            if (document.head) inject();
            else document.addEventListener("DOMContentLoaded", inject, { once: true });
          }
        
          function isTurnstileRetryable(err) {
            return /(?:300|600)\d{3}|timeout|indisponible/i.test(String(err?.message || err || ""));
          }
        
          class TurnstileManager {
            constructor() {
              this.cache = [];
              this.maxCache = 1;
              this.tokenTTL = 3 * 60 * 1000;
              this.generatingCount = 0;
              this.maxConcurrent = 1;
              this._maintenance = null;
            }
        
            async init() {
              installTurnstileSniffer();
              discoverTurnstileSiteKey();
              await this._loadScript();
              state.turnstileReady = true;
              log("Turnstile prêt · key:", turnstileSiteKey);
            }
        
            _loadScript() {
              return new Promise((resolve, reject) => {
                if (WIN.turnstile?.render) {
                  resolve();
                  return;
                }
                const existing = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
                if (existing) {
                  existing.addEventListener("load", () => resolve(), { once: true });
                  existing.addEventListener("error", () => reject(new Error("Turnstile SDK")), { once: true });
                  if (WIN.turnstile?.render) resolve();
                  return;
                }
                const s = document.createElement("script");
                s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
                s.async = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error("Turnstile SDK"));
                (document.head || document.documentElement).appendChild(s);
              });
            }
        
            _fill() {
              if (this.generatingCount > 0 || this.cache.length >= this.maxCache) return;
              this._genCached().catch(() => {});
            }
        
            async _genCached() {
              try {
                const token = await this._createToken();
                this.cache.push({ token, ts: Date.now() });
                log("Token Turnstile en cache");
              } catch (e) {
                log("Cache Turnstile échoué:", e.message);
              }
            }
        
            _createToken(attempt = 1) {
              this.generatingCount++;
              discoverTurnstileSiteKey();
        
              return new Promise((resolve, reject) => {
                let widgetId;
                let cleaned = false;
                const container = document.createElement("div");
                container.className = "wb-turnstile-host";
                container.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483645;min-width:300px;min-height:65px;";
        
                const cleanup = (delay = 0) => {
                  if (cleaned) return;
                  cleaned = true;
                  this.generatingCount = Math.max(0, this.generatingCount - 1);
                  if (widgetId !== undefined) {
                    try { WIN.turnstile.remove(widgetId); } catch {}
                  }
                  setTimeout(() => {
                    try { container.remove(); } catch {}
                  }, delay);
                };
        
                const fail = (err) => {
                  cleanup(300);
                  reject(err instanceof Error ? err : new Error(String(err)));
                };
        
                const finish = (token) => {
                  cleanup(200);
                  resolve(token);
                };
        
                try {
                  document.body.appendChild(container);
        
                  widgetId = WIN.turnstile.render(container, {
                    sitekey: turnstileSiteKey,
                    size: attempt > 1 ? "normal" : "invisible",
                    theme: "dark",
                    action: "claim_bonus_code",
                    retry: "auto",
                    "refresh-expired": "auto",
                    callback: finish,
                    "error-callback": (code) => fail(new Error("Turnstile: " + code)),
                    "timeout-callback": () => fail(new Error("Turnstile timeout"))
                  });
        
                  const run = () => {
                    try {
                      WIN.turnstile.execute(container);
                    } catch (e) {
                      try { WIN.turnstile.execute(widgetId); } catch (e2) {
                        fail(e2);
                      }
                    }
                  };
        
                  if (attempt > 1) {
                    setTimeout(run, 300);
                  } else {
                    run();
                  }
                } catch (e) {
                  cleanup(0);
                  this.generatingCount = Math.max(0, this.generatingCount - 1);
                  reject(e);
                }
              });
            }
        
            _cleanExpired() {
              const now = Date.now();
              this.cache = this.cache.filter(e => now - e.ts < this.tokenTTL);
            }
        
            reset() {
              this.cache = [];
              this.generatingCount = 0;
            }
        
            async getToken() {
              this._cleanExpired();
              discoverTurnstileSiteKey();
        
              if (this.cache.length > 0) {
                const entry = this.cache.shift();
                return entry.token;
              }
        
              let lastErr;
              for (let i = 1; i <= 4; i++) {
                try {
                  return await Promise.race([
                    this._createToken(i),
                    new Promise((_, r) => setTimeout(() => r(new Error("Turnstile timeout")), 45000))
                  ]);
                } catch (e) {
                  lastErr = e;
                  log("Turnstile tentative " + i + "/4:", e.message);
                  if (!isTurnstileRetryable(e) && i >= 2) break;
                  discoverTurnstileSiteKey();
                  await new Promise(r => setTimeout(r, 800 * i));
                }
              }
              throw lastErr || new Error("Turnstile indisponible");
            }
          }
        
          async function initTurnstile() {
            if (state.turnstile) return;
            state.turnstile = new TurnstileManager();
            await state.turnstile.init();
          }
        
          function claimPendingCodes() {
            const pending = state.codes.filter(c => !c.claimed && !c.rejectionReason);
            if (!pending.length) {
              toast("Aucun code en attente", "info");
              return;
            }
            toast(pending.length + " code(s) en file de claim", "info");
            pending.forEach(c => {
              c.historical = false;
              enqueueClaim(c.code);
            });
            persistConfig();
            refreshDashboard();
          }
        
          function markHistoricalCodes() {
            const withId = state.codes.filter(c => c.messageId);
            if (!withId.length) return;
            const latestId = Math.max(...withId.map(c => c.messageId));
            let changed = false;
            for (const c of state.codes) {
              if (!c.claimed && !c.rejectionReason && c.messageId && c.messageId < latestId && !c.historical) {
                c.historical = true;
                changed = true;
              }
            }
            if (changed) persistConfig();
          }
        
          // --- Claim engine ----------------------------------------------------------
        
          function enqueueClaim(code) {
            code = code.toLowerCase().trim();
            if (!code || state.claiming.has(code)) return;
            if (config.seenCodes[code + "_ok"] || config.seenCodes[code + "_dead"]) return;
            const rec = state.codes.find(c => c.code === code);
            if (rec) rec.historical = false;
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
        
          async function checkBonusCode(code) {
            const res = await gql(
              "BonusCodeInformation",
              { code, couponType: "drop" },
              BONUS_CODE_INFO_QUERY,
              "query"
            );
            if (res.errors?.length) {
              const msg = res.errors[0].message || "Erreur";
              const errType = res.errors[0].errorType || "";
              if (/notFound|cannot be found/i.test(errType + msg)) {
                return { ok: false, kind: "dead", label: "Code introuvable" };
              }
              return { ok: false, kind: "error", label: msg };
            }
        
            const info = res.data?.bonusCodeInformation;
            if (!info) return { ok: true };
        
            const status = info.availabilityStatus;
            const bonusValue = info.bonusValue;
        
            if (status === "bonusCodeAvailable" || status === "available") {
              return { ok: true, value: bonusValue ? "$" + bonusValue : null };
            }
            if (status === "bonusCodeAlreadyClaimed" || status === "alreadyClaimed") {
              return { ok: false, kind: "already", label: "Déjà réclamé par vous" };
            }
            if (status === "bonusCodeFullyClaimed" || status === "fullyClaimed") {
              return { ok: false, kind: "dead", label: "Code épuisé" };
            }
            if (status === "bonusCodeInactive" || status === "inactive" || status === "bonusCodeNotFound" || status === "notFound") {
              return { ok: false, kind: "dead", label: "Code invalide ou expiré" };
            }
        
            return { ok: true, value: bonusValue ? "$" + bonusValue : null };
          }
        
          async function claimCode(code) {
            code = code.toLowerCase().trim();
            if (state.claiming.has(code)) return;
            state.claiming.add(code);
            setStatus("Claim " + code + "…");
        
            if (!state.codes.find(c => c.code === code)) {
              upsertCodeRecord({
                code, value: "Manual", claims: "-", wager: "-", deadline: "-", type: "Manual"
              }, "manual");
            }
        
            try {
              ensureSession();
              await initTurnstile();
        
              setStatus("Vérification " + code + "…");
              const check = await checkBonusCode(code);
              if (!check.ok) {
                if (check.kind === "already" || check.kind === "dead") {
                  config.seenCodes[code + "_dead"] = Date.now();
                }
                markClaimResult(code, false, check.label, null, check.kind);
                toast(code + " — " + check.label, check.kind === "already" || check.kind === "dead" ? "warning" : "error");
                return;
              }
        
              if (check.value) {
                const rec = state.codes.find(c => c.code === code);
                if (rec && rec.value === "N/A") rec.value = check.value;
              }
        
              setStatus("Captcha " + code + "…");
              let turnstileToken;
              try {
                turnstileToken = await state.turnstile.getToken();
              } catch (tsErr) {
                if (state.turnstile) state.turnstile.reset();
                await new Promise(r => setTimeout(r, 1200));
                turnstileToken = await state.turnstile.getToken();
              }
        
              setStatus("Claim " + code + "…");
              const redeemRes = await gql(
                "ClaimBonusCode",
                { code, currency: config.currency, turnstileToken },
                CLAIM_BONUS_QUERY,
                "mutation"
              );
        
              if (redeemRes.errors?.length) {
                const msg = redeemRes.errors[0].message;
                const info = classifyClaimError(msg);
                if (info.kind === "already" || info.kind === "dead") {
                  config.seenCodes[code + "_dead"] = Date.now();
                  markClaimResult(code, false, info.label, null, info.kind);
                  toast(code + " — " + info.label, "warning");
                } else {
                  markClaimResult(code, false, info.label, null, "error");
                  toast(code + ": " + info.label, "error");
                  notify("Échec claim", code + " — " + info.label);
                }
              } else {
                const data = redeemRes.data?.claimBonusCode;
                const val = data?.amount ? data.amount + " " + (data.currency || config.currency) : null;
                markClaimResult(code, true, null, val);
                config.seenCodes[code + "_ok"] = Date.now();
                const amountUsd = data?.amount ? parseFloat(data.amount) : parseDollarValue(val);
                toast(code + " réclamé!" + (val ? " · " + val : ""), "success");
                notify("Code réclamé!", code + (val ? " · " + val : ""));
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
            const masterId = storage.get("stk_master_tab", "");
            const lastBeat = parseInt(storage.get("stk_master_beat", "0"), 10);
            const now = Date.now();
            if (!masterId || now - lastBeat > 10000) {
              storage.set("stk_master_tab", state.tabId);
              storage.set("stk_master_beat", String(now));
              state.isMaster = true;
            } else if (masterId === state.tabId) {
              state.isMaster = true;
            }
            if (state.isMaster) {
              setInterval(() => storage.set("stk_master_beat", String(Date.now())), 3000);
            }
            window.addEventListener("beforeunload", () => {
              if (storage.get("stk_master_tab", "") === state.tabId) {
                GM_deleteValue("stk_master_tab");
                GM_deleteValue("stk_master_beat");
              }
            });
          }
        
          function refreshMasterTab() {
            const masterId = storage.get("stk_master_tab", "");
            const lastBeat = parseInt(storage.get("stk_master_beat", "0"), 10);
            const now = Date.now();
            const wasMaster = state.isMaster;
            if (!masterId || now - lastBeat > 10000) {
              storage.set("stk_master_tab", state.tabId);
              storage.set("stk_master_beat", String(now));
              state.isMaster = true;
            } else {
              state.isMaster = masterId === state.tabId;
            }
            if (!wasMaster && state.isMaster && !state.pollTimer) {
              startPolling();
            }
          }
        
          function startKeepAlive() {
            document.addEventListener("visibilitychange", () => {
              if (!document.hidden) pollTelegram();
            });
            window.addEventListener("focus", () => pollTelegram());
            window.addEventListener("online", () => setTimeout(pollTelegram, 2000));
            if (navigator.locks) {
              navigator.locks.request("stk_keep_alive", { mode: "shared" }, () => new Promise(() => {}));
            }
            state.watchdogTimer = setInterval(() => {
              refreshMasterTab();
              if (state.isMaster) pollTelegram();
              getSessionToken();
              discoverTurnstileSiteKey();
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
            const pending = codes.filter(c => !c.claimed && !c.rejectionReason && !c.historical);
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
        
          // --- UI --------------------------------------------------------------------
        
          function renderUI() {
            if (document.getElementById("wb-root")) return;
            state.activeTab = state.activeTab || "history";
        
            const style = document.createElement("style");
            style.textContent = `
              @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
              #wb-root{font-family:'Space Grotesk',system-ui,sans-serif;color:#ece8f4;--wb-bg:#07060b;--wb-surface:#110f18;--wb-surface2:#1a1724;--wb-border:rgba(168,85,247,.18);--wb-purple:#a855f7;--wb-purple2:#c084fc;--wb-green:#4ade80;--wb-red:#f87171;--wb-amber:#fbbf24;--wb-muted:#8b849c}
              #wb-header{position:fixed;top:14px;right:14px;z-index:999999;padding:0;margin:0;background:none;border:none;box-shadow:none;height:auto;width:auto;display:block}
              .wb-burger{width:44px;height:44px;border-radius:12px;border:1px solid var(--wb-border);background:linear-gradient(180deg,#0d0b14 0%,#07060b 100%);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;box-shadow:0 4px 24px rgba(0,0,0,.55);padding:0}
              .wb-burger:hover{border-color:rgba(168,85,247,.45);box-shadow:0 4px 28px rgba(168,85,247,.25)}
              .wb-burger span{display:block;width:18px;height:2px;border-radius:1px;background:#c084fc;transition:transform .25s,opacity .25s}
              .wb-burger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
              .wb-burger.open span:nth-child(2){opacity:0}
              .wb-burger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
              .wb-panel-head{padding:16px;border-bottom:1px solid var(--wb-border);background:var(--wb-surface);display:flex;flex-direction:column;gap:12px}
              .wb-panel-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
              .wb-brand{display:flex;align-items:center;gap:12px;min-width:0}
              .wb-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a855f7 50%,#c084fc);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;box-shadow:0 0 20px rgba(168,85,247,.45);flex-shrink:0}
              .wb-title{font-weight:700;font-size:16px;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
              .wb-sub{font-size:11px;color:var(--wb-muted);margin-top:1px}
              #wb-live-dot{width:8px;height:8px;border-radius:50%;background:#4b5563;display:inline-block;margin-right:6px;vertical-align:middle}
              #wb-live-dot.on{background:var(--wb-green);box-shadow:0 0 10px rgba(74,222,128,.7);animation:wb-pulse 2s infinite}
              @keyframes wb-pulse{0%,100%{opacity:1}50%{opacity:.5}}
              #wb-stat-badge{font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(168,85,247,.12);border:1px solid var(--wb-border);color:var(--wb-purple2)}
              .wb-user-pill{font-size:11px;padding:5px 12px;border-radius:20px;background:var(--wb-surface2);border:1px solid var(--wb-border);color:#c4b5d8;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              .wb-claim-box{display:flex;align-items:center;gap:6px;background:var(--wb-surface2);border:1px solid var(--wb-border);border-radius:10px;padding:4px 4px 4px 12px;width:100%;box-sizing:border-box}
              .wb-claim-box input{flex:1;min-width:0;width:auto;border:none;background:transparent;color:#fff;font:600 13px 'JetBrains Mono',monospace;text-transform:lowercase;outline:none}
              .wb-claim-box input::placeholder{color:#5c5470;text-transform:none;font-weight:500}
              .wb-btn{padding:8px 14px;border-radius:8px;border:none;font:600 12px 'Space Grotesk',sans-serif;cursor:pointer;transition:transform .15s,box-shadow .15s}
              .wb-btn:hover{transform:translateY(-1px)}
              .wb-btn-primary{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;box-shadow:0 4px 16px rgba(168,85,247,.35)}
              .wb-btn-ghost{background:var(--wb-surface2);color:#d8cce8;border:1px solid var(--wb-border)}
              .wb-btn-sm{padding:6px 10px;font-size:11px}
              #wb-panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;background:var(--wb-bg);border-left:1px solid var(--wb-border);z-index:999998;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:-8px 0 40px rgba(0,0,0,.5)}
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
              <button type="button" class="wb-burger" id="wb-toggle-panel" aria-label="Menu WaggerBot" title="Menu">
                <span></span><span></span><span></span>
              </button>
            `;
        
            const panel = document.createElement("div");
            panel.id = "wb-panel";
            panel.innerHTML = `
              <div class="wb-panel-head">
                <div class="wb-panel-head-top">
                  <div class="wb-brand">
                    <div class="wb-logo">W</div>
                    <div>
                      <div class="wb-title">WaggerBot · Stake</div>
                      <div class="wb-sub"><span id="wb-live-dot"></span><span id="wb-status">${state.lastStatus}</span></div>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <span id="wb-stat-badge" class="wb-stat-badge">0 claim · $0.00</span>
                    <span class="wb-user-pill" id="wb-user">${state.username || "…"}</span>
                  </div>
                </div>
                <div class="wb-claim-box">
                  <input id="wb-manual-input" placeholder="Code" maxlength="40" autocomplete="off" spellcheck="false"/>
                  <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-manual-claim">Claim</button>
                </div>
              </div>
              <div class="wb-tabs">
                <button class="wb-tab active" data-tab="history">Historique</button>
                <button class="wb-tab" data-tab="stats">Statistiques</button>
                <button class="wb-tab" data-tab="settings">Réglages</button>
              </div>
              <div id="wb-panel-history" class="wb-tab-panel active">
                <div style="padding:10px 16px 0;font-size:11px;color:var(--wb-muted)">@<a href="https://t.me/${TELEGRAM_CHANNEL}" target="_blank" style="color:var(--wb-purple2);text-decoration:none">${TELEGRAM_CHANNEL}</a></div>
                <div id="wb-codes"></div>
              </div>
              <div id="wb-panel-stats" class="wb-tab-panel">
                <div id="wb-stats"></div>
              </div>
              <div id="wb-panel-settings" class="wb-tab-panel">
                <div id="wb-settings">
                  <div class="wb-setting-row">
                    <label>Devise de claim</label>
                    <select id="wb-currency">${CURRENCIES.map(c => `<option value="${c}"${c === config.currency ? " selected" : ""}>${c.toUpperCase()}</option>`).join("")}</select>
                  </div>
                  <div class="wb-setting-row">
                    <label>Intervalle Telegram</label>
                    <span><input id="wb-poll" type="number" min="10" max="120" value="${config.pollIntervalMs / 1000}" style="width:52px"/> sec</span>
                  </div>
                  <div class="wb-setting-row">
                    <label>Délai entre claims</label>
                    <span><input id="wb-claim-delay" type="number" min="0" max="60" value="${config.claimDelayMs / 1000}" style="width:52px"/> sec</span>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-auto" ${config.autoClaimEnabled ? "checked" : ""}/> Auto-claim activé</label>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-notify" ${config.notifyEnabled ? "checked" : ""}/> Notifications</label>
                  </div>
                  <div class="wb-setting-row">
                    <label class="wb-setting-check"><input type="checkbox" id="wb-sound" ${config.soundEnabled ? "checked" : ""}/> Son alerte</label>
                  </div>
                  <div class="wb-actions">
                    <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-claim-pending">Claim en attente</button>
                    <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-poll-now">Poll Telegram</button>
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
        
            const burgerBtn = document.getElementById("wb-toggle-panel");
            burgerBtn.onclick = () => {
              const open = panel.classList.toggle("open");
              burgerBtn.classList.toggle("open", open);
            };
            document.querySelectorAll(".wb-tab").forEach(btn => {
              btn.onclick = () => switchTab(btn.dataset.tab);
            });
            document.getElementById("wb-manual-claim").onclick = () => {
              const v = document.getElementById("wb-manual-input").value.trim().toLowerCase();
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
            document.getElementById("wb-claim-delay").onchange = e => {
              config.claimDelayMs = Math.max(0, parseInt(e.target.value, 10) || 0) * 1000;
              persistConfig();
            };
            document.getElementById("wb-auto").onchange = e => { config.autoClaimEnabled = e.target.checked; persistConfig(); updateHeaderStats(); };
            document.getElementById("wb-notify").onchange = e => { config.notifyEnabled = e.target.checked; persistConfig(); };
            document.getElementById("wb-sound").onchange = e => { config.soundEnabled = e.target.checked; persistConfig(); };
            document.getElementById("wb-claim-pending").onclick = () => claimPendingCodes();
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
                  <span class="wb-type-tag">${c.type || "Code"}</span>
                  <div class="time">${formatTime(c.claimedAt)}</div>
                </div>
                <span class="amt">${c.value || "—"}</span>
              </div>
            `).join("");
        
            box.innerHTML = `
              <div class="wb-stat-grid">
<div class="wb-stat-card wide">
                  <div class="label">Total gagné (local)</div>
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
              box.innerHTML = '<div class="wb-empty">En attente de codes depuis<br><strong>@' + TELEGRAM_CHANNEL + '</strong></div>';
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
              } else if (c.historical) {
                status = "Historique (non tenté)";
              }
              return `<div class="wb-code-card ${cls}">
                <div><span class="code">${c.code}</span><span class="wb-type-tag">${c.type || "Code"}</span></div>
                <div class="meta">${c.value !== "Manual" && c.value !== "N/A" ? c.value + " · " : ""}${c.wager !== "-" ? c.wager + " wager · " : ""}${c.claims !== "-" ? c.claims + " claims" : ""}</div>
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
            installTurnstileSniffer();
            state.codes = config.codeHistory || [];
            markHistoricalCodes();
            electMasterTab();
            getSessionToken();
        
            await waitForBody();
            renderUI();
            try {
              ensureSession();
              setStatus("Connecté · poll Telegram actif");
              fetchUsername();
              initTurnstile().catch(err => log("Turnstile init:", err.message));
            } catch {
              setStatus("Pas de session — connectez-vous sur Stake (F5)");
            }
      
            startKeepAlive();
            if (state.isMaster) {
              startPolling();
            }
          }
      
          init().catch(err => log("Init error", err));
    })();
  }

  if (PLATFORM === "thrill") {
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
            watchdogTimer: null,
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
            codeHistory: storage.getJSON("thr_code_history", []),
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
              const url = "https://telegram.me/s/" + channel + (beforeId ? "?before=" + beforeId : "");
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
              #wb-header{position:fixed;top:14px;right:14px;z-index:999999;padding:0;margin:0;background:none;border:none;box-shadow:none;height:auto;width:auto;display:block}
              .wb-burger{width:44px;height:44px;border-radius:12px;border:1px solid var(--wb-border);background:linear-gradient(180deg,#0d0b14 0%,#07060b 100%);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;box-shadow:0 4px 24px rgba(0,0,0,.55);padding:0}
              .wb-burger:hover{border-color:rgba(168,85,247,.45);box-shadow:0 4px 28px rgba(168,85,247,.25)}
              .wb-burger span{display:block;width:18px;height:2px;border-radius:1px;background:#c084fc;transition:transform .25s,opacity .25s}
              .wb-burger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
              .wb-burger.open span:nth-child(2){opacity:0}
              .wb-burger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
              .wb-panel-head{padding:16px;border-bottom:1px solid var(--wb-border);background:var(--wb-surface);display:flex;flex-direction:column;gap:12px}
              .wb-panel-head-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
              .wb-brand{display:flex;align-items:center;gap:12px;min-width:0}
              .wb-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#a855f7 50%,#c084fc);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;box-shadow:0 0 20px rgba(168,85,247,.45);flex-shrink:0}
              .wb-title{font-weight:700;font-size:16px;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
              .wb-sub{font-size:11px;color:var(--wb-muted);margin-top:1px}
              #wb-live-dot{width:8px;height:8px;border-radius:50%;background:#4b5563;display:inline-block;margin-right:6px;vertical-align:middle}
              #wb-live-dot.on{background:var(--wb-green);box-shadow:0 0 10px rgba(74,222,128,.7);animation:wb-pulse 2s infinite}
              @keyframes wb-pulse{0%,100%{opacity:1}50%{opacity:.5}}
              #wb-stat-badge{font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(168,85,247,.12);border:1px solid var(--wb-border);color:var(--wb-purple2)}
              .wb-user-pill{font-size:11px;padding:5px 12px;border-radius:20px;background:var(--wb-surface2);border:1px solid var(--wb-border);color:#c4b5d8;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              .wb-claim-box{display:flex;align-items:center;gap:6px;background:var(--wb-surface2);border:1px solid var(--wb-border);border-radius:10px;padding:4px 4px 4px 12px;width:100%;box-sizing:border-box}
              .wb-claim-box input{flex:1;min-width:0;width:auto;border:none;background:transparent;color:#fff;font:600 13px 'JetBrains Mono',monospace;text-transform:uppercase;outline:none}
              .wb-claim-box input::placeholder{color:#5c5470;text-transform:none;font-weight:500}
              .wb-btn{padding:8px 14px;border-radius:8px;border:none;font:600 12px 'Space Grotesk',sans-serif;cursor:pointer;transition:transform .15s,box-shadow .15s}
              .wb-btn:hover{transform:translateY(-1px)}
              .wb-btn-primary{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;box-shadow:0 4px 16px rgba(168,85,247,.35)}
              .wb-btn-ghost{background:var(--wb-surface2);color:#d8cce8;border:1px solid var(--wb-border)}
              .wb-btn-sm{padding:6px 10px;font-size:11px}
              #wb-panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;background:var(--wb-bg);border-left:1px solid var(--wb-border);z-index:999998;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .28s cubic-bezier(.4,0,.2,1);box-shadow:-8px 0 40px rgba(0,0,0,.5)}
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
              <button type="button" class="wb-burger" id="wb-toggle-panel" aria-label="Menu WaggerBot" title="Menu">
                <span></span><span></span><span></span>
              </button>
            `;
        
            const panel = document.createElement("div");
            panel.id = "wb-panel";
            panel.innerHTML = `
              <div class="wb-panel-head">
                <div class="wb-panel-head-top">
                  <div class="wb-brand">
                    <div class="wb-logo">W</div>
                    <div>
                      <div class="wb-title">WaggerBot · Thrill</div>
                      <div class="wb-sub"><span id="wb-live-dot"></span><span id="wb-status">${state.lastStatus}</span></div>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                    <span id="wb-stat-badge" class="wb-stat-badge">0 claim · $0.00</span>
                    <span class="wb-user-pill" id="wb-user">${state.username || "…"}</span>
                  </div>
                </div>
                <div class="wb-claim-box">
                  <input id="wb-manual-input" placeholder="Code" maxlength="30" autocomplete="off" spellcheck="false"/>
                  <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-manual-claim">Claim</button>
                </div>
              </div>
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
        
            const burgerBtn = document.getElementById("wb-toggle-panel");
            burgerBtn.onclick = () => {
              const open = panel.classList.toggle("open");
              burgerBtn.classList.toggle("open", open);
            };
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
                  <div class="label">Total gagné (local)</div>
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
              setStatus("connecté sur thrill.com requis pour Claim");
            }
      
            startKeepAlive();
            if (state.isMaster) {
              startPolling();
            }
          }
      
          init().catch(err => log("Init error", err));
    })();
  }

})();
