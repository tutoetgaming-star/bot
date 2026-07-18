// ==UserScript==
// @name         All Claimer — V4 - Thrill game
// @namespace    waggerbot
// @version      4.2.1
// @description  WaggerBot — claim auto Shuffle, Stake et Thrill + jeux Originaux Thrill
// @match        https://shuffle.com/*
// @match        https://shuffle.bet/*
// @match        https://stake.com/*
// @match        https://stake.bet/*
// @match        https://stake.us/*
// @match        https://*.stake.com/*
// @match        https://*.stake.bet/*
// @match        https://*.stake.us/*
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
// @connect      stake.us
// @connect      thrill.com
// @connect      originals-instant-api.thrill-games.com
// @connect      api.binance.com
// @connect      api.coingecko.com
// @connect      challenges.cloudflare.com
// @connect      static.geetest.com
// @connect      gcaptcha4.geetest.com
// @require      https://cdn.ably.com/lib/ably.min-1.js
// @grant        GM_openInTab
// @grant        GM_getTab
// @grant        window.close
// @connect      stakecodeclaimerbot.com
// @connect      *
// @run-at       document-start
// @noframes
// ==/UserScript==
(function () {
  "use strict";

  const PLATFORM = (function detectPlatform() {
    const host = location.hostname.toLowerCase();
    if (/^shuffle\.(com|bet)$/.test(host)) return "shuffle";
    if (/(^|\.)stake\.(com|bet|us)$/.test(host) || /stake/i.test(host)) {
      if (!/stake-engine|platform-stake|stakecodeclaimer|stakecommunity/i.test(host)) return "stake";
    }
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
  const _0x51d8f0 = "https://stakecodeclaimerbot.com";
  const _0x5ab6f7 = window.location.origin + "/_api/graphql";
  const _0x39ed19 = location.hostname.endsWith(".us");
  let _0x2df668 = "anon";
  try {
    _0x2df668 = (localStorage.getItem("sc-last-username") || "anon").toLowerCase();
  } catch (_0x2ecfc8) {}
  (function _0x4db73f() {
    try {
      const _0x5f28e9 = GM_getValue;
      const _0x194a2 = GM_setValue;
      const _0x5917ce = typeof GM_deleteValue === "function" ? GM_deleteValue : null;
      const _0x3d81da = _0x1a814e => location.hostname + "::" + _0x2df668 + "::" + _0x1a814e;
      GM_getValue = (_0x2c6d14, _0x377adb) => _0x5f28e9(_0x3d81da(_0x2c6d14), _0x377adb);
      GM_setValue = (_0x12bf72, _0x3d6392) => _0x194a2(_0x3d81da(_0x12bf72), _0x3d6392);
      if (_0x5917ce) {
        GM_deleteValue = _0xedbecc => _0x5917ce(_0x3d81da(_0xedbecc));
      }
    } catch (_0x1f0cf8) {
      console.warn("[storage] per-account namespacing unavailable, using shared storage:", _0x1f0cf8 && _0x1f0cf8.message);
    }
  })();
  function _0x7b2981(_0x3df893) {
    return String(_0x3df893).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function _0x2826f7(_0x19b0ed) {
    const _0x4b740e = _0x19b0ed.getUTCDate();
    const _0x47a885 = _0x19b0ed.getUTCMonth() + 1;
    const _0x8fade0 = String(_0x19b0ed.getUTCFullYear()).slice(-2);
    const _0x4f4696 = String(_0x19b0ed.getUTCHours()).padStart(2, "0");
    const _0x240a7c = String(_0x19b0ed.getUTCMinutes()).padStart(2, "0");
    return _0x4b740e + "/" + _0x47a885 + "/" + _0x8fade0 + " " + _0x4f4696 + ":" + _0x240a7c;
  }
  let _0x167b9f = GM_getValue("codeHistory", []);
  const _0x3cc3c0 = new Set(_0x167b9f.map(_0x5348bf => _0x5348bf.code.toLowerCase()));
  let _0x583afd = {};
  const _0x375432 = {};
  function _0x47ac9c(_0x5e25bc) {
    if (_0x5e25bc && _0x5e25bc.code && _0x5e25bc.type) {
      _0x375432[String(_0x5e25bc.code).toLowerCase()] = String(_0x5e25bc.type).toLowerCase();
    }
  }
  function _0x25bd25(_0x544967) {
    const _0x2b2b89 = _0x375432[String(_0x544967).toLowerCase()];
    const _0x53c8ed = _0x2b2b89 === "bonus" ? true : _0x2b2b89 === "drop" ? false : _0x2dc13a(_0x544967);
    if (_0x53c8ed) {
      return _0x288214;
    } else {
      return _0x1f023c;
    }
  }
  let _0x3ff73e = {};
  let _0x389dfa = {};
  for (const _0x9bd0 of _0x167b9f) {
    if (_0x9bd0.claimed !== null && _0x9bd0.claimed !== undefined) {
      _0x583afd[_0x9bd0.code] = _0x9bd0.processedAt || _0x9bd0.timestamp || Date.now();
      _0x3ff73e[_0x9bd0.code] = _0x9bd0.claimed ? "success" : "rejected";
    }
  }
  let _0x33815b = null;
  let _0x2e4b70 = null;
  let _0x52bbe3 = false;
  let _0x3cf78c = null;
  let _0x31caad = null;
  let _0x483d64 = null;
  let _0x5995ed = false;
  let _0x1ab406 = false;
  let _0x58ad5a = {};
  let _0x1f023c = GM_getValue("dropClaimEnabled", true);
  let _0x288214 = GM_getValue("bonusClaimEnabled", true);
  let _0x231efb = GM_getValue("autoVaultEnabled", false);
  let _0xf1fa9f = GM_getValue("toastNotificationsEnabled", true);
  let _0x393820 = GM_getValue("soundNotificationsEnabled", false);
  let _0x38e0b7 = GM_getValue("notificationDuration", "auto");
  let _0x5f6006 = GM_getValue("autoPageRefresh", "off");
  let _0x48f0fd = null;
  function _0x4a689f(_0x5a9469) {
    return _0x5a9469;
  }
  function _0x260273(_0x343404, _0x574fe7) {
    const _0x350a95 = _0x4a689f(_0x343404);
    return GM_getValue(_0x350a95, _0x574fe7);
  }
  function _0x94ab69(_0x1e7942, _0x2532e3) {
    const _0x18cd23 = _0x4a689f(_0x1e7942);
    GM_setValue(_0x18cd23, _0x2532e3);
  }
  let _0x1489d5 = false;
  let _0x58dba1 = null;
  let _0x58c2aa = null;
  let _0x241708 = null;
  let _0x534092 = false;
  let _0x5a3e62 = _0x39ed19 ? "SWEEPS" : "USDT";
  let _0x5716ea = false;
  let _0x413128 = GM_getValue("reloadClaimHistory", []);
  let _0x316b10 = [];
  let _0x1e2bb6 = false;
  let _0x299fd0 = null;
  let _0x39548e = false;
  let _0x18678e = false;
  let _0x1f89fb = 0;
  function _0x16710e() {
    if (!_0x2e4b70) {
      return;
    }
    _0x1489d5 = _0x260273("autoReloadEnabled", false);
    _0x58dba1 = _0x260273("reloadInfo", null);
    _0x5a3e62 = _0x260273("reloadCurrency", _0x39ed19 ? "SWEEPS" : "USDT");
    if (_0x39ed19 && !_0x5f1d48.some(_0xae3d38 => _0xae3d38.code === _0x5a3e62)) {
      _0x5a3e62 = "SWEEPS";
      _0x94ab69("reloadCurrency", "SWEEPS");
    }
    _0x5716ea = _0x260273("reloadAutoVault", false);
  }
  const _0x198002 = [];
  const _0x320778 = 180000;
  const _0x512752 = 60000;
  const _0x4020a8 = 5;
  const _0x3e497b = 25000;
  const _0x3b083f = () => 3;
  let _0x19d2c8 = [];
  let _0x3454ba = null;
  let _0x381be1 = null;
  let _0x3ab09f = false;
  let _0x1a48fd = false;
  let _0x8029c5 = 0;
  function _0x20a9bd() {
    const _0x6434d = Date.now() - _0x320778;
    while (_0x198002.length > 1 && _0x198002[0].ts < _0x6434d) {
      _0x198002.shift();
    }
    if (_0x198002.length === 1 && _0x198002[0].ts < _0x6434d) {
      queueMicrotask(_0x5eebe8);
    }
  }
  (function _0x5e90ed() {
    function _0x29164a() {
      const _0x1736a1 = (typeof unsafeWindow !== "undefined" ? unsafeWindow.turnstile : null) || window.turnstile;
      if (_0x1736a1?.render) {
        _0x3c165d();
        return;
      }
      if (!document.querySelector("script[src*=\"turnstile\"]")) {
        const _0xccb188 = document.createElement("script");
        _0xccb188.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        _0xccb188.async = true;
        _0xccb188.onload = () => setTimeout(_0x3c165d, 50);
        (document.head || document.documentElement).appendChild(_0xccb188);
      } else {
        setTimeout(_0x29164a, 100);
      }
    }
    if (document.body) {
      _0x29164a();
    } else {
      document.addEventListener("DOMContentLoaded", _0x29164a, {
        once: true
      });
    }
    document.addEventListener("visibilitychange", () => {
      _0x20a9bd();
      _0x1a48fd = false;
      _0x8029c5 = 0;
      if (document.hidden) {
        queueMicrotask(_0x5eebe8);
      } else {
        const _0x55c2d7 = _0x198002.length > 0 ? Date.now() - _0x198002[0].ts : Infinity;
        if (_0x198002.length < _0x3b083f() || _0x19d2c8.length > 0 || _0x55c2d7 > _0x512752) {
          queueMicrotask(_0x5eebe8);
        }
      }
    });
    let _0x35c13b = null;
    async function _0x3cf22f() {
      if (!("wakeLock" in navigator)) {
        return;
      }
      try {
        _0x35c13b = await navigator.wakeLock.request("screen");
        _0x35c13b.addEventListener("release", () => {
          _0x35c13b = null;
          setTimeout(_0x3cf22f, 2000);
        });
      } catch (_0x56c853) {}
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _0x3cf22f, {
        once: true
      });
    } else {
      _0x3cf22f();
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !_0x35c13b) {
        _0x3cf22f();
      }
    });
    try {
      const _0x5d3c2d = "let t=0;setInterval(()=>postMessage(++t),250)";
      const _0xe91783 = new Worker(URL.createObjectURL(new Blob([_0x5d3c2d], {
        type: "text/javascript"
      })));
      let _0xce7e5d = 0;
      _0xe91783.onmessage = () => {
        _0xce7e5d++;
        if (_0x1a48fd && _0x8029c5 && Date.now() - _0x8029c5 > 12000) {
          _0x1a48fd = false;
          _0x8029c5 = 0;
        }
        const _0x2ffe35 = _0x198002.length > 0 ? Date.now() - _0x198002[0].ts : Infinity;
        if ((_0x198002.length < _0x3b083f() || _0x19d2c8.length > 0 || _0x2ffe35 > _0x512752) && !_0x1a48fd) {
          queueMicrotask(_0x5eebe8);
        }
        if (_0xce7e5d % 120 === 0) {
          if (typeof _0x3817cf === "function") {
            _0x3817cf();
          }
          _0x384e2f();
        }
      };
      _0xe91783.onerror = () => {};
    } catch (_0x39d49c) {
      setInterval(() => {
        if (_0x1a48fd && _0x8029c5 && Date.now() - _0x8029c5 > 12000) {
          _0x1a48fd = false;
          _0x8029c5 = 0;
        }
        const _0x1b157d = _0x198002.length > 0 ? Date.now() - _0x198002[0].ts : Infinity;
        if ((_0x198002.length < _0x3b083f() || _0x19d2c8.length > 0 || _0x1b157d > _0x512752) && !_0x1a48fd) {
          queueMicrotask(_0x5eebe8);
        }
      }, 500);
    }
    let _0x4186f7 = null;
    function _0x1e94e3() {
      if (_0x4186f7) {
        return;
      }
      try {
        _0x4186f7 = new (window.AudioContext || window.webkitAudioContext)();
        const _0x1bd424 = _0x4186f7.createGain();
        _0x1bd424.gain.value = 0.00001;
        _0x1bd424.connect(_0x4186f7.destination);
        const _0x4fd731 = _0x4186f7.createOscillator();
        _0x4fd731.connect(_0x1bd424);
        _0x4fd731.start();
        _0x4186f7.onstatechange = () => {
          if (_0x4186f7 && _0x4186f7.state === "suspended") {
            _0x4186f7.resume().catch(() => {});
          }
        };
      } catch (_0x43fa70) {}
    }
    function _0x384e2f() {
      if (!_0x4186f7) {
        _0x1e94e3();
        return;
      }
      if (_0x4186f7.state === "suspended") {
        _0x4186f7.resume().catch(() => {
          try {
            _0x4186f7.close();
          } catch (_0x426005) {}
          _0x4186f7 = null;
          _0x1e94e3();
        });
      }
    }
    _0x1e94e3();
    const _0x5c8a82 = ["click", "keydown", "touchstart", "mousedown"];
    function _0x4eff56() {
      _0x1e94e3();
      _0x384e2f();
      _0x5c8a82.forEach(_0x5f0e5e => document.removeEventListener(_0x5f0e5e, _0x4eff56, true));
    }
    const _0x4d6a33 = {
      once: true,
      capture: true
    };
    _0x5c8a82.forEach(_0x16c675 => document.addEventListener(_0x16c675, _0x4eff56, _0x4d6a33));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        _0x384e2f();
      }
    });
    window.addEventListener("focus", _0x384e2f);
  })();
  const _0xfe1780 = "mutation ClaimConditionBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) { claimConditionBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) { bonusCode { id code } amount currency } }";
  const _0x347f22 = "mutation ClaimBonusCode($code: String!, $currency: CurrencyEnum!, $turnstileToken: String!) { claimBonusCode(code: $code, currency: $currency, turnstileToken: $turnstileToken) { bonusCode { id code } amount currency redeemed } }";
  const _0x6ff156 = "query DailyBonusMeta { user { id dailyBonus { id active lastClaim amounts { currency amount } } } }";
  const _0x1d2097 = "mutation ClaimDailyBonus($turnstileToken: String!) { claimDailyBonus(turnstileToken: $turnstileToken) { ... on ClaimDailyBonusResponse { amount currency __typename } ... on Error { message __typename } __typename } }";
  const _0xc15190 = ["boostweekly", "premonth", "monthly", "postmonthly"];
  function _0x2dc13a(_0x89f7ac) {
    const _0x521b81 = (_0x89f7ac || "").toLowerCase();
    return _0xc15190.some(_0x365ad1 => _0x521b81.startsWith(_0x365ad1));
  }
  const _0x3edb4e = {
    "Content-Type": "application/json",
    "x-language": "en",
    "x-operation-name": "ClaimConditionBonusCode",
    "x-operation-type": "mutation"
  };
  let _0x49c655 = null;
  let _0x58fd7a = 0;
  const _0x6a6f22 = {
    "Content-Type": "application/json",
    "x-access-token": "",
    "x-language": "en",
    "x-operation-name": "ClaimConditionBonusCode",
    "x-operation-type": "mutation"
  };
  let _0x59b274 = (GM_getValue("selectedCurrency", _0x39ed19 ? "SWEEPS" : "USDT") || (_0x39ed19 ? "sweeps" : "usdt")).toLowerCase();
  function _0x4de61f() {
    const _0x5ba55b = Date.now();
    if (_0x49c655 && _0x5ba55b - _0x58fd7a < 120000) {
      return _0x49c655;
    }
    const _0x1a5b22 = _0x42dcf3();
    if (_0x1a5b22) {
      _0x49c655 = _0x1a5b22;
      _0x58fd7a = _0x5ba55b;
      _0x6a6f22["x-access-token"] = _0x1a5b22;
    }
    return _0x1a5b22;
  }
  const _0x2e37f7 = "{\"operationName\":\"ClaimConditionBonusCode\",\"variables\":{\"code\":\"";
  const _0x336e50 = "\",\"currency\":\"";
  const _0x5dcf68 = "\",\"turnstileToken\":\"";
  const _0x5bab6d = "\"},\"query\":\"" + _0xfe1780.replace(/"/g, "\\\"") + "\"}";
  let _0x4fd09d = false;
  const _0x418ba4 = "{\"query\":\"{__typename}\"}";
  const _0x291f63 = {
    "Content-Type": "application/json"
  };
  function _0xeebc94() {
    if (_0x4fd09d) {
      return;
    }
    _0x4fd09d = true;
    const _0x5be0ba = {
      method: "POST",
      headers: _0x291f63,
      body: _0x418ba4,
      credentials: "include",
      keepalive: true
    };
    const _0x278708 = () => fetch(_0x5ab6f7, _0x5be0ba).catch(() => {});
    _0x278708();
    setInterval(_0x278708, 8000);
  }
  const _0x408cc3 = {
    bonusCodeInactive: "Code limit reached",
    notFound: "Invalid code",
    bonusCodeAlreadyClaimed: "Already claimed",
    bonusCodeExpired: "Code expired",
    bonusCodeNotEligible: "Not eligible",
    bonusCodeWagerNotMet: "Wager not met",
    rateLimited: "Rate limited",
    unauthorized: "Not logged in"
  };
  const _0x230f3e = [];
  let _0x16864d = false;
  let _0xb91545 = GM_getValue("selectedCurrency", _0x39ed19 ? "SWEEPS" : "BTC");
  const _0x173fc4 = [{
    code: "BTC",
    name: "Bitcoin"
  }, {
    code: "ETH",
    name: "Ethereum"
  }, {
    code: "LTC",
    name: "Litecoin"
  }, {
    code: "USDT",
    name: "Tether"
  }, {
    code: "SOL",
    name: "Solana"
  }, {
    code: "DOGE",
    name: "Dogecoin"
  }, {
    code: "BCH",
    name: "Bitcoin Cash"
  }, {
    code: "XRP",
    name: "Ripple"
  }, {
    code: "TRX",
    name: "Tron"
  }, {
    code: "EOS",
    name: "EOS"
  }, {
    code: "BNB",
    name: "BNB"
  }, {
    code: "USDC",
    name: "USD Coin"
  }, {
    code: "APE",
    name: "ApeCoin"
  }, {
    code: "BUSD",
    name: "Binance USD"
  }, {
    code: "CRO",
    name: "Cronos"
  }, {
    code: "DAI",
    name: "Dai"
  }, {
    code: "LINK",
    name: "Chainlink"
  }, {
    code: "SAND",
    name: "The Sandbox"
  }, {
    code: "SHIB",
    name: "Shiba Inu"
  }, {
    code: "UNI",
    name: "Uniswap"
  }, {
    code: "POL",
    name: "Polygon"
  }, {
    code: "TRUMP",
    name: "TRUMP"
  }];
  const _0x5f1d48 = [{
    code: "SWEEPS",
    name: "Sweepstakes Coins"
  }, {
    code: "GOLD",
    name: "Gold Coins"
  }];
  const _0x217ef5 = _0x39ed19 ? _0x5f1d48 : _0x173fc4;
  if (_0x39ed19 && !_0x5f1d48.some(_0x36d7a5 => _0x36d7a5.code === _0xb91545)) {
    _0xb91545 = "SWEEPS";
    _0x59b274 = "sweeps";
    GM_setValue("selectedCurrency", "SWEEPS");
  }
  function _0x1a6472(_0x5e433e) {
    return "https://mediumrare.imgix.net/currencies/" + _0x5e433e.toLowerCase() + ".svg";
  }
  function _0x1f11de(_0x3bc31d) {
    var _0xdc03c9 = _0x3bc31d + "=";
    var _0x3db05a = decodeURIComponent(document.cookie);
    var _0x1cf1a4 = _0x3db05a.split(";");
    for (var _0x2225ed = 0; _0x2225ed < _0x1cf1a4.length; _0x2225ed++) {
      var _0x5598fa = _0x1cf1a4[_0x2225ed];
      while (_0x5598fa.charAt(0) == " ") {
        _0x5598fa = _0x5598fa.substring(1);
      }
      if (_0x5598fa.indexOf(_0xdc03c9) == 0) {
        return _0x5598fa.substring(_0xdc03c9.length, _0x5598fa.length);
      }
    }
    return "";
  }
  function _0x42dcf3() {
    const _0x2911b4 = _0x1f11de("session");
    if (_0x2911b4) {
      return _0x2911b4.replace(/"/g, "");
    }
    return null;
  }
  function _0x9a6dca() {
    const _0x1556ae = _0x217ef5.find(_0x3fb1bc => _0x3fb1bc.code === _0xb91545);
    if (!_0x1556ae) {
      return;
    }
    const _0x113177 = document.getElementById("settings-currency-btn");
    if (_0x113177) {
      _0x113177.innerHTML = "\n                <span class=\"settings-currency-label\">" + _0x1556ae.code + "</span>\n                <svg width=\"10\" height=\"6\" viewBox=\"0 0 10 6\" fill=\"none\" style=\"opacity:0.4;\"><path d=\"M1 1L5 5L9 1\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>\n            ";
    }
  }
  function _0x287efd(_0x5e95b4) {
    _0xb91545 = _0x5e95b4;
    _0x59b274 = _0x5e95b4.toLowerCase();
    GM_setValue("selectedCurrency", _0x5e95b4);
    _0x9a6dca();
    const _0x2e90e6 = document.getElementById("settings-currency-dropdown");
    if (_0x2e90e6) {
      _0x2e90e6.style.display = "none";
    }
  }
  function _0x1fde84() {
    if (_0x167b9f.length > 50) {
      _0x167b9f = _0x167b9f.slice(0, 50);
    }
    GM_setValue("codeHistory", _0x167b9f);
  }
  function _0x5a71de() {
    if (confirm("Clear all history?")) {
      _0x167b9f = [];
      _0x3cc3c0.clear();
      _0x583afd = {};
      _0x3ff73e = {};
      _0x413128 = [];
      GM_setValue("codeHistory", []);
      GM_setValue("reloadClaimHistory", []);
      GM_setValue("clearTimestamp", Date.now().toString());
      if (_0x39ed19) {
        _0x316b10 = [];
        _0x94ab69("dailyBonusClaimHistory", []);
      }
      _0x51d4fb();
      _0x5adf8d();
    }
  }
  let _0x4fd78a = null;
  function _0xf5b3f2() {
    if (_0x4fd78a) {
      return;
    }
    _0x4fd78a = document.createElement("div");
    _0x4fd78a.id = "stake-toast-container";
    _0x4fd78a.style.cssText = "\n            position: fixed;\n            top: 56px;\n            left: 20px;\n            z-index: 999999;\n            display: flex;\n            flex-direction: column;\n            gap: 10px;\n            pointer-events: none;\n        ";
    document.body.appendChild(_0x4fd78a);
  }
  function _0x3865d4(_0x4019b5, _0x165234 = "info", _0x7784e9 = 3000) {
    if (!_0xf1fa9f) {
      return;
    }
    if (_0x38e0b7 !== "auto") {
      _0x7784e9 = parseInt(_0x38e0b7);
    }
    _0xf5b3f2();
    const _0x497436 = {
      info: "📢",
      success: "✅",
      error: "❌",
      warning: "⚠️",
      redeeming: "⏳",
      claimed: "💰"
    };
    const _0x4b366f = {
      info: {
        bg: "rgba(30, 30, 30, 0.95)",
        border: "#555"
      },
      success: {
        bg: "rgba(28, 12, 48, 0.96)",
        border: "#a855f7"
      },
      error: {
        bg: "rgba(40, 20, 20, 0.95)",
        border: "#f44336"
      },
      warning: {
        bg: "rgba(40, 35, 20, 0.95)",
        border: "#ff9800"
      },
      redeeming: {
        bg: "rgba(24, 14, 42, 0.96)",
        border: "#c084fc"
      },
      claimed: {
        bg: "rgba(28, 12, 48, 0.96)",
        border: "#d946ef"
      }
    };
    const _0x11e7bc = document.createElement("div");
    _0x11e7bc.style.cssText = "\n            background: " + (_0x4b366f[_0x165234]?.bg || _0x4b366f.info.bg) + ";\n            border: 1px solid " + (_0x4b366f[_0x165234]?.border || _0x4b366f.info.border) + ";\n            border-left: 4px solid " + (_0x4b366f[_0x165234]?.border || _0x4b366f.info.border) + ";\n            color: white;\n            padding: 12px 16px;\n            border-radius: 8px;\n            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;\n            font-size: 13px;\n            display: flex;\n            align-items: center;\n            gap: 10px;\n            max-width: 320px;\n            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);\n            transform: translateX(-120%);\n            transition: transform 0.3s ease-out, opacity 0.3s ease-out;\n            pointer-events: auto;\n            backdrop-filter: blur(10px);\n        ";
    _0x11e7bc.innerHTML = "\n            <span style=\"font-size: 18px;\">" + (_0x497436[_0x165234] || _0x497436.info) + "</span>\n            <span style=\"flex: 1; line-height: 1.4;\">" + _0x4019b5 + "</span>\n        ";
    _0x4fd78a.appendChild(_0x11e7bc);
    requestAnimationFrame(() => {
      _0x11e7bc.style.transform = "translateX(0)";
    });
    setTimeout(() => {
      _0x11e7bc.style.transform = "translateX(-120%)";
      _0x11e7bc.style.opacity = "0";
      setTimeout(() => {
        if (_0x11e7bc.parentNode) {
          _0x11e7bc.parentNode.removeChild(_0x11e7bc);
        }
      }, 300);
    }, _0x7784e9);
    return _0x11e7bc;
  }
  function _0x4ec196() {
    _0x1f023c = !_0x1f023c;
    GM_setValue("dropClaimEnabled", _0x1f023c);
    _0x5dbd00("drop-claim-toggle", _0x1f023c);
    _0x3865d4(_0x1f023c ? "Code claiming enabled" : "Code claiming disabled", _0x1f023c ? "success" : "info", 2000);
  }
  function _0x548333() {
    _0x288214 = !_0x288214;
    GM_setValue("bonusClaimEnabled", _0x288214);
    _0x5dbd00("bonus-claim-toggle", _0x288214);
    _0x3865d4(_0x288214 ? "Bonus code claiming enabled" : "Bonus code claiming disabled", _0x288214 ? "success" : "info", 2000);
  }
  function _0x25789a() {
    _0x231efb = !_0x231efb;
    GM_setValue("autoVaultEnabled", _0x231efb);
    _0x5dbd00("bonus-vault-toggle", _0x231efb);
    _0x3865d4(_0x231efb ? "Bonus Auto-Vault enabled" : "Bonus Auto-Vault disabled", _0x231efb ? "success" : "info", 2000);
  }
  function _0x5dbd00(_0x578c87, _0x229c7b) {
    const _0x190568 = document.getElementById(_0x578c87);
    if (!_0x190568) {
      return;
    }
    _0x190568.style.background = _0x229c7b ? "linear-gradient(135deg,#7c3aed,#d946ef)" : "rgba(255,255,255,0.1)";
    const _0x54a016 = _0x190568.querySelector(".toggle-slider");
    if (_0x54a016) {
      _0x54a016.style.transform = _0x229c7b ? "translateX(20px)" : "translateX(2px)";
    }
  }
  function _0x1b7b7c() {
    _0x1489d5 = !_0x1489d5;
    _0x94ab69("autoReloadEnabled", _0x1489d5);
    _0x222439();
    _0x5dbd00("reload-auto-claim-toggle", _0x1489d5);
    _0x51d4fb();
    _0x3865d4(_0x1489d5 ? "Auto-Reload enabled" : "No active reloads", _0x1489d5 ? "success" : "info", 2000);
    if (_0x1489d5) {
      _0x39c422();
    } else {
      _0x26023f();
    }
  }
  function _0x3820bd() {
    _0x5716ea = !_0x5716ea;
    _0x94ab69("reloadAutoVault", _0x5716ea);
    _0x5dbd00("reload-auto-vault-toggle", _0x5716ea);
    _0x222439();
    _0x51d4fb();
    _0x3865d4(_0x5716ea ? "Reload Auto-Vault enabled" : "Reload Auto-Vault off", _0x5716ea ? "success" : "info", 2000);
  }
  function _0x2268db(_0x24ba26) {
    _0x5a3e62 = _0x24ba26;
    _0x94ab69("reloadCurrency", _0x24ba26);
    _0x222439();
    const _0xc55f6b = document.getElementById("reload-currency-dropdown");
    if (_0xc55f6b) {
      _0xc55f6b.style.display = "none";
    }
    if (_0x1489d5) {
      _0x58dba1 = null;
      _0x94ab69("reloadInfo", null);
      _0x4aed91();
    }
    _0x3865d4("Reload currency: " + _0x7b2981(_0x24ba26), "info", 2000);
  }
  function _0x2fd4a6() {
    if (!_0x58dba1 || !_0x58dba1.id) {
      return {
        totalClaims: 0,
        totalValue: 0,
        nextClaim: null,
        expiry: null,
        remaining: 0,
        isExpired: false
      };
    }
    const _0x168980 = Date.now();
    const _0x144490 = new Date(_0x58dba1.lastClaim).getTime();
    const _0x470120 = new Date(_0x58dba1.expireAt).getTime();
    const _0x141607 = _0x58dba1.claimInterval;
    const _0x726756 = _0x58dba1.value || 0;
    const _0x3a766d = _0x168980 >= _0x470120;
    const _0x178d40 = _0x144490 + _0x141607;
    let _0xf2de25 = 0;
    if (!_0x3a766d) {
      if (_0x168980 >= _0x178d40) {
        _0xf2de25 = Math.floor((_0x470120 - _0x168980) / _0x141607) + 1;
      } else {
        _0xf2de25 = Math.floor((_0x470120 - _0x178d40) / _0x141607) + 1;
      }
      _0xf2de25 = Math.max(0, _0xf2de25);
    }
    const _0x544894 = _0xf2de25 * _0x726756;
    const _0x3f3724 = Math.max(0, _0x178d40 - _0x168980);
    const _0x25ae1f = {
      totalClaims: _0xf2de25,
      totalValue: _0x544894,
      claimValue: _0x726756,
      nextClaim: _0x3f3724,
      expiry: _0x470120,
      interval: _0x141607,
      isExpired: _0x3a766d,
      isReady: !_0x3a766d && _0x168980 >= _0x178d40 && _0x168980 < _0x470120
    };
    return _0x25ae1f;
  }
  function _0x3bb97b(_0x5069eb) {
    if (_0x5069eb <= 0) {
      return "Ready!";
    }
    const _0x128367 = Math.floor(_0x5069eb / 3600000);
    const _0x12c34e = Math.floor(_0x5069eb % 3600000 / 60000);
    const _0x1e14b7 = Math.floor(_0x5069eb % 60000 / 1000);
    if (_0x128367 > 0) {
      return _0x128367 + "h " + _0x12c34e + "m " + _0x1e14b7 + "s";
    }
    if (_0x12c34e > 0) {
      return _0x12c34e + "m " + _0x1e14b7 + "s";
    }
    return _0x1e14b7 + "s";
  }
  function _0x222439() {
    const _0x321288 = _0x2fd4a6();
    _0x5dbd00("reload-auto-claim-toggle", _0x1489d5);
    _0x5dbd00("reload-auto-vault-toggle", _0x5716ea);
    const _0x563dc7 = document.getElementById("reload-currency-btn");
    if (_0x563dc7) {
      _0x563dc7.innerHTML = "\n                <span>" + _0x5a3e62 + "</span>\n                <svg width=\"10\" height=\"6\" viewBox=\"0 0 10 6\" fill=\"none\" style=\"opacity:0.4;\"><path d=\"M1 1L5 5L9 1\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>\n            ";
    }
  }
  function _0x590018() {
    if (_0x241708) {
      return;
    }
    _0x222439();
    _0x241708 = setInterval(() => {
      if (_0x58dba1 && _0x58dba1.id) {
        const _0x4d19ee = _0x2fd4a6();
        if (_0x4d19ee.isExpired) {
          _0x51d4fb();
          return;
        }
        const _0x4edd4b = document.getElementById("reload-next-claim");
        if (_0x4edd4b) {
          _0x4edd4b.style.color = _0x4d19ee.isReady ? "#a855f7" : "#fff";
          _0x4edd4b.textContent = _0x4d19ee.isReady ? "💰 Ready!" : _0x3bb97b(_0x4d19ee.nextClaim);
        }
      }
    }, 1000);
  }
  function _0x1b4c97() {
    if (_0x241708) {
      clearInterval(_0x241708);
      _0x241708 = null;
    }
  }
  async function _0x39c422() {
    await _0x4aed91();
  }
  function _0x26023f() {
    if (_0x58c2aa) {
      clearTimeout(_0x58c2aa);
      _0x58c2aa = null;
    }
    _0x1b4c97();
  }
  let _0x26781d = null;
  let _0x33d574 = 0;
  function _0x4aa3de(_0x214264, _0x3a0885 = false) {
    const _0x54313d = Date.now();
    if (_0x214264 === _0x26781d && _0x54313d - _0x33d574 < 2000) {
      return;
    }
    _0x26781d = _0x214264;
    _0x33d574 = _0x54313d;
    _0x1489d5 = false;
    _0x94ab69("autoReloadEnabled", false);
    _0x58dba1 = null;
    _0x94ab69("reloadInfo", null);
    _0x26023f();
    try {
      _0x222439();
      if (!_0x3a0885) {
        _0x3865d4("⚠️ " + _0x214264, "warning", 3000);
      }
    } catch (_0x5a31de) {}
  }
  async function _0x4aed91(_0x119bf4 = false) {
    const _0x2c7cd5 = _0x42dcf3();
    if (!_0x2c7cd5) {
      return false;
    }
    try {
      const _0xb1294e = _0x5a3e62.toLowerCase();
      const _0x306b68 = {
        currency: _0xb1294e,
        includeEligibleCurrencies: false
      };
      const _0x1e889f = {
        query: "query ClaimReloadMeta($currency: CurrencyEnum!, $includeEligibleCurrencies: Boolean = false) {\n  user {\n    id\n    reload: faucet {\n      id\n      amount(currency: $currency)\n      active\n      claimInterval\n      lastClaim\n      expireAt\n      value\n    }\n    reloadEligibleCurrencies @include(if: $includeEligibleCurrencies)\n  }\n}",
        variables: _0x306b68
      };
      const _0x23a3b8 = _0x1e889f;
      const _0x111297 = {
        "Content-Type": "application/json",
        "x-access-token": _0x2c7cd5,
        "x-language": "en",
        "x-operation-name": "ClaimReloadMeta"
      };
      const _0x343247 = await fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0x111297,
        credentials: "include",
        body: JSON.stringify(_0x23a3b8)
      });
      const _0x26eeba = await _0x343247.json();
      if (!_0x26eeba.data?.user?.reload || !_0x26eeba.data.user.reload.id) {
        _0x4aa3de("No reload available", _0x119bf4);
        return false;
      }
      _0x58dba1 = _0x26eeba.data.user.reload;
      _0x94ab69("reloadInfo", _0x58dba1);
      _0x222439();
      _0x544d28();
      _0x590018();
      return true;
    } catch (_0x410d1d) {
      return false;
    }
  }
  function _0x544d28() {
    if (!_0x1489d5 || !_0x58dba1 || !_0x58dba1.id) {
      return;
    }
    if (_0x58c2aa) {
      clearTimeout(_0x58c2aa);
      _0x58c2aa = null;
    }
    const _0x4a2cc9 = Date.now();
    const _0x37c45f = new Date(_0x58dba1.expireAt).getTime();
    if (_0x4a2cc9 >= _0x37c45f) {
      _0x4aa3de("Reload expired");
      return;
    }
    const _0x534811 = new Date(_0x58dba1.lastClaim).getTime();
    const _0x33cdb4 = _0x58dba1.claimInterval;
    const _0x494d2f = _0x4a2cc9 - _0x534811;
    const _0x85a130 = _0x534811 + _0x33cdb4;
    const _0x34ea1f = 2147483647;
    if (_0x494d2f >= _0x33cdb4) {
      _0x5f10fd();
    } else {
      const _0x111b83 = _0x85a130 - _0x4a2cc9;
      const _0x395f38 = Math.min(_0x111b83, _0x34ea1f);
      const _0xdca51a = Math.floor(_0x111b83 / 3600000);
      const _0x4a70b5 = Math.floor(_0x111b83 % 3600000 / 60000);
      const _0x19c02b = Math.floor(_0x111b83 % 60000 / 1000);
      _0x58c2aa = setTimeout(() => {
        if (_0x1489d5) {
          _0x5f10fd();
        }
      }, _0x395f38);
    }
  }
  async function _0x5f10fd() {
    if (_0x534092) {
      return;
    }
    _0x534092 = true;
    const _0x50674e = _0x42dcf3();
    if (!_0x50674e) {
      _0x534092 = false;
      return;
    }
    try {
      _0x3865d4("🔄 Claiming reload...", "info", 2000);
      _0x222439();
      let _0x145f68 = _0x2edac7() || (await _0x5ca42d());
      if (!_0x145f68) {
        _0x3865d4("❌ Verification failed - retrying in 30s", "error", 3000);
        _0x534092 = false;
        setTimeout(() => _0x544d28(), 30000);
        return;
      }
      const _0x1a1a74 = _0x5a3e62.toLowerCase();
      const _0x5d90d5 = {
        currency: _0x1a1a74,
        turnstileToken: _0x145f68
      };
      const _0x34df9d = {
        query: "mutation ClaimFaucet($currency: CurrencyEnum!, $turnstileToken: String!) {\n  claimReload: claimFaucet(currency: $currency, turnstileToken: $turnstileToken) {\n    reload: faucet {\n      user {\n        id\n        reload: faucet {\n          id\n          amount(currency: $currency)\n          active\n          claimInterval\n          lastClaim\n          expireAt\n          value\n        }\n      }\n    }\n  }\n}",
        variables: _0x5d90d5
      };
      const _0x3b558b = _0x34df9d;
      const _0x51c9b0 = {
        "Content-Type": "application/json",
        "x-access-token": _0x50674e,
        "x-language": "en",
        "x-operation-name": "ClaimFaucet"
      };
      const _0xb1b088 = await fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0x51c9b0,
        credentials: "include",
        body: JSON.stringify(_0x3b558b)
      });
      const _0x3e6785 = await _0xb1b088.json();
      if (_0x3e6785.errors) {
        const _0x1c1841 = _0x3e6785.errors[0]?.message || "Unknown error";
        if (_0x1c1841.toLowerCase().includes("captcha") || _0x1c1841.toLowerCase().includes("turnstile") || _0x1c1841.toLowerCase().includes("verification")) {
          _0x3865d4("🔄 Verification failed, retrying...", "info", 2000);
          const _0x3584e1 = await _0x5ca42d();
          if (_0x3584e1) {
            _0x534092 = false;
            setTimeout(() => _0x5f10fd(), 1000);
            return;
          }
        }
        _0x3865d4("❌ " + _0x1c1841, "error", 4000);
        _0x413128.unshift({
          time: Date.now(),
          amount: _0x58dba1?.amount || "?",
          usd: _0x58dba1?.value || "?",
          currency: _0x5a3e62.toUpperCase(),
          status: "failed",
          reason: _0x1c1841
        });
        if (_0x413128.length > 50) {
          _0x413128 = _0x413128.slice(0, 50);
        }
        GM_setValue("reloadClaimHistory", _0x413128);
        if (_0x1c1841.includes("expired") || _0x1c1841.includes("not eligible")) {
          _0x4aa3de("Reload no longer available");
        } else {
          setTimeout(() => _0x544d28(), 60000);
        }
      } else if (_0x3e6785.data?.claimReload) {
        const _0x518f4f = _0x58dba1?.value || "?";
        const _0x1c8510 = _0x58dba1?.amount;
        _0x3865d4("💰 Claimed $" + _0x518f4f + " " + _0x1a1a74.toUpperCase() + "!", "claimed", 4000);
        _0x413128.unshift({
          time: Date.now(),
          amount: _0x1c8510 || "?",
          usd: _0x518f4f || "?",
          currency: _0x1a1a74.toUpperCase(),
          status: "claimed"
        });
        if (_0x413128.length > 50) {
          _0x413128 = _0x413128.slice(0, 50);
        }
        GM_setValue("reloadClaimHistory", _0x413128);
        if (_0x5716ea && _0x1c8510) {
          setTimeout(() => _0x447c64(_0x1c8510, _0x1a1a74, true), 1000);
        }
        await _0x4aed91();
      }
    } catch (_0x3927c4) {
      _0x3865d4("❌ Error: " + _0x3927c4.message, "error", 3000);
      setTimeout(() => _0x544d28(), 60000);
    } finally {
      _0x534092 = false;
      _0x5727d1();
    }
  }
  async function _0xbf4c5c() {
    const _0x19bea5 = _0x42dcf3();
    if (!_0x19bea5) {
      return {
        available: false,
        nextAt: 0
      };
    }
    try {
      const _0xa7b034 = {
        "Content-Type": "application/json",
        "x-access-token": _0x19bea5,
        "x-language": "en",
        "x-operation-name": "DailyBonusMeta"
      };
      const _0x5d4ad3 = {
        query: _0x6ff156
      };
      const _0x5b41b6 = await fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0xa7b034,
        credentials: "include",
        body: JSON.stringify(_0x5d4ad3)
      });
      const _0x57466d = await _0x5b41b6.json();
      const _0x10b07b = _0x57466d?.data?.user?.dailyBonus;
      if (!_0x10b07b || !_0x10b07b.active) {
        _0x18678e = false;
        _0x1f89fb = 0;
        return {
          available: false,
          nextAt: 0
        };
      }
      const _0x515fae = _0x10b07b.lastClaim ? new Date(_0x10b07b.lastClaim).getTime() : 0;
      const _0x5711be = _0x515fae ? _0x515fae + 86400000 : 0;
      const _0x2bda32 = !_0x5711be || _0x5711be <= Date.now();
      _0x18678e = _0x2bda32;
      _0x1f89fb = _0x2bda32 ? 0 : _0x5711be;
      const _0x4d56fa = {
        available: _0x2bda32,
        nextAt: _0x5711be
      };
      return _0x4d56fa;
    } catch (_0x2f4c28) {
      return {
        available: false,
        nextAt: 0
      };
    }
  }
  async function _0x4f0da2() {
    if (_0x39548e || !_0x1e2bb6) {
      return;
    }
    const _0x4b2cd9 = _0x42dcf3();
    if (!_0x4b2cd9) {
      return;
    }
    _0x39548e = true;
    _0x1f8a18();
    _0x3865d4("⏳ Claiming daily bonus...", "redeeming", 3000);
    try {
      const _0x15e4cc = _0x2edac7() || (await _0x5ca42d());
      if (!_0x15e4cc) {
        _0x3865d4("❌ No Turnstile token for daily bonus", "error", 3000);
        _0x4c3cd4(Date.now() + 300000);
        return;
      }
      const _0x85b56e = {
        "Content-Type": "application/json",
        "x-access-token": _0x4b2cd9,
        "x-language": "en",
        "x-operation-name": "ClaimDailyBonus",
        "x-operation-type": "mutation"
      };
      const _0x2082c8 = {
        turnstileToken: _0x15e4cc
      };
      const _0x1d7b9a = {
        operationName: "ClaimDailyBonus",
        variables: _0x2082c8,
        query: _0x1d2097
      };
      const _0x5bba45 = await fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0x85b56e,
        credentials: "include",
        body: JSON.stringify(_0x1d7b9a)
      });
      const _0x479df7 = await _0x5bba45.json();
      const _0x519dd4 = _0x479df7?.data?.claimDailyBonus;
      if (_0x519dd4?.__typename === "ClaimDailyBonusResponse" || _0x519dd4?.amount && !_0x519dd4?.message) {
        const _0x455977 = _0x519dd4.amount || "?";
        const _0x47aa6 = (_0x519dd4.currency || "SWEEPS").toUpperCase();
        _0x3865d4("💰 Daily bonus: " + _0x455977 + " " + _0x47aa6 + "!", "claimed", 5000);
        _0x18678e = false;
        const _0x5ce58d = Date.now();
        _0x94ab69("lastDailyBonusClaim", _0x5ce58d);
        const _0x548da9 = {
          time: _0x5ce58d,
          amount: _0x455977,
          currency: _0x47aa6,
          status: "claimed"
        };
        _0x316b10.unshift(_0x548da9);
        if (_0x316b10.length > 50) {
          _0x316b10 = _0x316b10.slice(0, 50);
        }
        _0x94ab69("dailyBonusClaimHistory", _0x316b10);
        _0x4c3cd4(_0x5ce58d + 86400000);
      } else {
        const _0x260d9f = _0x479df7?.errors?.[0]?.message || _0x519dd4?.message || "Already claimed";
        const _0x51ecbf = _0x260d9f.toLowerCase().includes("already") || _0x260d9f.toLowerCase().includes("claimed");
        _0x3865d4("⚠️ Daily bonus: " + _0x260d9f, "warning", 4000);
        const _0x56e496 = Date.now();
        _0x316b10.unshift({
          time: _0x56e496,
          amount: "?",
          currency: _0x5a3e62.toUpperCase(),
          status: "failed",
          reason: _0x260d9f
        });
        if (_0x316b10.length > 50) {
          _0x316b10 = _0x316b10.slice(0, 50);
        }
        _0x94ab69("dailyBonusClaimHistory", _0x316b10);
        if (_0x51ecbf) {
          _0xbf4c5c().then(({
            nextAt: _0x18e7f6
          }) => {
            _0x4c3cd4(_0x18e7f6 || _0x56e496 + 86400000);
          });
        } else {
          _0x4c3cd4(Date.now() + 600000);
        }
      }
    } catch (_0x547f8c) {
      _0x3865d4("❌ Daily bonus error", "error", 3000);
      _0x4c3cd4(Date.now() + 600000);
    } finally {
      _0x39548e = false;
      _0x1f8a18();
      _0x51d4fb();
      _0x5727d1();
    }
  }
  function _0x4c3cd4(_0x4f633c) {
    if (_0x299fd0) {
      clearTimeout(_0x299fd0);
      _0x299fd0 = null;
    }
    if (!_0x1e2bb6) {
      return;
    }
    _0x1f89fb = _0x4f633c;
    const _0xbaa135 = Math.max(0, _0x4f633c - Date.now());
    _0x299fd0 = setTimeout(async () => {
      _0x299fd0 = null;
      if (!_0x1e2bb6) {
        return;
      }
      const {
        available: _0x5c30d1,
        nextAt: _0x39115f
      } = await _0xbf4c5c();
      _0x1f8a18();
      if (_0x5c30d1) {
        _0x4f0da2();
      } else if (_0x39115f && _0x39115f > Date.now()) {
        _0x4c3cd4(_0x39115f);
      } else {
        _0x4c3cd4(Date.now() + 300000);
      }
    }, _0xbaa135);
    _0x1f8a18();
  }
  async function _0x35cae2() {
    const {
      available: _0x2d7033,
      nextAt: _0x40c626
    } = await _0xbf4c5c();
    _0x1f8a18();
    if (_0x2d7033) {
      _0x4f0da2();
    } else if (_0x40c626) {
      _0x4c3cd4(_0x40c626);
    } else {
      _0x4c3cd4(Date.now() + 600000);
    }
  }
  function _0x4d5033() {
    if (_0x299fd0) {
      clearTimeout(_0x299fd0);
      _0x299fd0 = null;
    }
  }
  function _0x1f8a18() {
    _0x5adf8d();
    _0x5dbd00("daily-bonus-toggle", _0x1e2bb6);
    const _0x1b211f = document.getElementById("daily-bonus-status");
    if (!_0x1b211f) {
      return;
    }
    if (!_0x1e2bb6) {
      _0x1b211f.textContent = "Disabled";
      _0x1b211f.style.color = "rgba(255,255,255,0.3)";
    } else if (_0x39548e) {
      _0x1b211f.textContent = "Claiming...";
      _0x1b211f.style.color = "#2196F3";
    } else if (_0x18678e) {
      _0x1b211f.textContent = "💰 Ready!";
      _0x1b211f.style.color = "#a855f7";
    } else {
      const _0x384769 = _0x1f89fb ? _0x1f89fb - Date.now() : 0;
      if (_0x384769 > 0) {
        const _0x3ce57e = Math.floor(_0x384769 / 3600000);
        const _0x45b10a = Math.floor(_0x384769 % 3600000 / 60000);
        _0x1b211f.textContent = "Next in " + _0x3ce57e + "h " + _0x45b10a + "m";
        _0x1b211f.style.color = "rgba(255,255,255,0.5)";
      } else {
        _0x1b211f.textContent = "Checking...";
        _0x1b211f.style.color = "rgba(255,255,255,0.5)";
      }
    }
  }
  function _0x1ec317() {
    _0x1e2bb6 = !_0x1e2bb6;
    _0x94ab69("dailyBonusEnabled", _0x1e2bb6);
    _0x1f8a18();
    _0x3865d4(_0x1e2bb6 ? "Daily bonus auto-claim on" : "Daily bonus auto-claim off", _0x1e2bb6 ? "success" : "info", 2000);
    if (_0x1e2bb6) {
      _0x35cae2();
    } else {
      _0x4d5033();
    }
  }
  function _0x9c60d2() {
    if (!_0x2e4b70 || !_0x39ed19) {
      return;
    }
    _0x1e2bb6 = _0x260273("dailyBonusEnabled", false);
    _0x316b10 = _0x260273("dailyBonusClaimHistory", []);
    if (_0x1e2bb6) {
      _0x35cae2();
    }
  }
  function _0xf9af80() {
    const _0x447722 = document.getElementById("stake-claim-ready");
    if (!_0x447722) {
      return;
    }
    const _0x3b0061 = _0x198002.length > 0;
    _0x447722.style.background = _0x3b0061 ? "rgba(168,85,247,0.1)" : "rgba(244,67,54,0.1)";
    _0x447722.style.borderColor = _0x3b0061 ? "rgba(168,85,247,0.3)" : "rgba(244,67,54,0.25)";
    _0x447722.style.color = _0x3b0061 ? "#a855f7" : "#f44336";
    _0x447722.innerHTML = "\n            <span style=\"width:7px;height:7px;background:" + (_0x3b0061 ? "#a855f7" : "#f44336") + ";border-radius:50%;" + (_0x3b0061 ? "box-shadow:0 0 7px rgba(168,85,247,0.7);" : "box-shadow:0 0 6px rgba(244,67,54,0.5);") + "display:inline-block;\"></span>\n            " + (_0x3b0061 ? "Ready" : "Not Ready") + "\n        ";
  }
  async function _0x447c64(_0x557625, _0x4b8d8c, _0x4fdf50 = false) {
    if (!_0x4fdf50 && !_0x231efb) {
      return;
    }
    if (_0x39ed19) {
      return;
    }
    const _0x2e3ea5 = _0x42dcf3();
    if (!_0x2e3ea5) {
      return;
    }
    const _0x154ea2 = parseFloat(_0x557625);
    if (isNaN(_0x154ea2) || _0x154ea2 <= 0) {
      return;
    }
    const _0x51eb63 = _0x4b8d8c.toLowerCase();
    _0x3865d4("<b>Vaulting...</b><br>" + _0x154ea2 + " " + _0x4b8d8c.toUpperCase(), "info", 2000);
    const _0x50161b = {
      currency: _0x51eb63,
      amount: _0x154ea2
    };
    const _0x1ef8c2 = {
      query: "mutation CreateVaultDeposit($currency: CurrencyEnum!, $amount: Float!) {\n  createVaultDeposit(currency: $currency, amount: $amount) {\n    id\n    amount\n    currency\n    __typename\n  }\n}",
      variables: _0x50161b
    };
    const _0x1f7c4d = _0x1ef8c2;
    try {
      const _0x43935d = {
        "Content-Type": "application/json",
        "x-access-token": _0x2e3ea5,
        "x-language": "en",
        "x-operation-name": "CreateVaultDeposit",
        "x-operation-type": "query"
      };
      const _0x2ebbe6 = await fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0x43935d,
        credentials: "include",
        body: JSON.stringify(_0x1f7c4d)
      });
      const _0x1704fc = await _0x2ebbe6.json();
      if (_0x1704fc.errors) {
        const _0x37ba4f = _0x1704fc.errors[0]?.message || "Unknown error";
        _0x3865d4("<b>Vault Failed</b><br>" + _0x37ba4f, "error", 3000);
      } else if (_0x1704fc.data?.createVaultDeposit) {
        const _0x33db3c = _0x1704fc.data.createVaultDeposit;
        _0x3865d4("<b>Vaulted!</b><br>" + _0x33db3c.amount + " " + _0x33db3c.currency.toUpperCase(), "success", 3000);
      }
    } catch (_0x6e246) {
      _0x3865d4("<b>Vault Error</b><br>" + _0x6e246.message, "error", 3000);
    }
  }
  let _0x1189b0 = false;
  const _0x110afa = {
    UI_UPDATE: 0,
    AUTO_CLICK: 0,
    USERNAME_CHECK: 2000,
    CONNECT_RETRY: 50,
    HEARTBEAT: 10000
  };
  let _0x74aa2d = null;
  let _0x29badd = false;
  let _0x50aed2 = false;
  let _0xcba344 = 0;
  let _0x24de01 = null;
  const _0x32ff66 = 200;
  let _0xd349b3 = null;
  let _0x303345 = null;
  let _0x414fba = 0;
  let _0x266100 = GM_getValue("autoWsReconnect", true);
  let _0x2bafd6 = null;
  let _0x342236 = null;
  let _0x2bddde = null;
  let _0x2a27c7 = false;
  let _0x1e3c67 = false;
  const TG_CHANNEL_URL = "https://t.me/s/stakecodedropsgoofy";
  const TG_POLL_MS = 2500;
  const _tgSeenCodes = new Set();
  let _tgPollTimer = null;
  let _tgFirstLoad = true;
  let _tgPolling = false;
  function _tgDecodeHtml(_0xtext) {
    return String(_0xtext || "").replace(/&#036;/g, "$").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").trim();
  }
  function _tgParseCodes(_0xhtml) {
    const _0xout = [];
    const _0xwraps = String(_0xhtml || "").match(/<div class="tgme_widget_message_wrap[\s\S]*?(?=<div class="tgme_widget_message_wrap|$)/g) || [];
    for (const _0xblock of _0xwraps) {
      if (!/<b>Code:<\/b>/i.test(_0xblock)) {
        continue;
      }
      const _0xcode = (_0xblock.match(/<b>Code:<\/b>\s*<code>([^<]+)<\/code>/i) || [])[1];
      if (!_0xcode) {
        continue;
      }
      const _0xvalueRaw = (_0xblock.match(/<b>Value:<\/b>\s*(?:&#036;|\$)?\s*([\d.,]+)/i) || [])[1];
      const _0xwagerRaw = (_0xblock.match(/<b>Wager:<\/b>\s*([^<\n]+)/i) || [])[1];
      const _0xlimitRaw = (_0xblock.match(/<b>Limit:<\/b>\s*([^<\n]+)/i) || [])[1];
      const _0xdatetime = (_0xblock.match(/datetime="([^"]+)"/) || [])[1];
      const _0xts = _0xdatetime ? new Date(_0xdatetime).getTime() : Date.now();
      _0xout.push({
        code: _0xcode.trim(),
        timestamp: Number.isFinite(_0xts) ? _0xts : Date.now(),
        amount: _0xvalueRaw ? "$" + _0xvalueRaw : "N/A",
        value: _0xvalueRaw || null,
        wager: _tgDecodeHtml(_0xwagerRaw) || "Unknown",
        deadline: "N/A",
        limit: _tgDecodeHtml(_0xlimitRaw) || "-",
        source: "telegram",
        type: "drop"
      });
    }
    return _0xout;
  }
  function _tgPollOnce() {
    if (typeof GM_xmlhttpRequest !== "function") {
      return;
    }
    GM_xmlhttpRequest({
      method: "GET",
      url: TG_CHANNEL_URL + "?_=" + Date.now(),
      anonymous: true,
      headers: {
        "Cache-Control": "no-cache"
      },
      onload: function (_0xres) {
        if (_0xres.status < 200 || _0xres.status >= 300) {
          return;
        }
        const _0xparsed = _tgParseCodes(_0xres.responseText).sort((_0xa, _0xb) => _0xa.timestamp - _0xb.timestamp);
        const _0xfresh = [];
        for (const _0xitem of _0xparsed) {
          const _0xkey = String(_0xitem.code).toLowerCase();
          if (_tgSeenCodes.has(_0xkey)) {
            continue;
          }
          _tgSeenCodes.add(_0xkey);
          if (!_tgFirstLoad) {
            _0xfresh.push(_0xitem);
          }
        }
        _0x29badd = true;
        _0x415306();
        if (_tgFirstLoad) {
          _tgFirstLoad = false;
          if (_0xparsed.length) {
            _0x252d80(_0xparsed, false);
          }
          return;
        }
        for (const _0xitem of _0xfresh) {
          _0x47ac9c(_0xitem);
          if (_0xitem.timestamp > _0x414fba) {
            _0x414fba = _0xitem.timestamp;
          }
          if (_0x25bd25(_0xitem.code) && !_0x583afd[_0xitem.code]) {
            _0x5acaad(_0xitem.code);
          }
        }
        if (_0xfresh.length) {
          queueMicrotask(() => _0x252d80(_0xfresh, true));
        }
      }
    });
  }
  function startTelegramCodeFeed() {
    if (_tgPolling) {
      return;
    }
    _tgPolling = true;
    _tgPollOnce();
    _tgPollTimer = setInterval(_tgPollOnce, TG_POLL_MS);
    _0x29badd = true;
    try {
      _0x415306();
    } catch (_0xe) {}
  }
  function _0x45a687() {
    try {
      if (_0x2bafd6) {
        _0x2bafd6.close();
      }
    } catch (_0x40eff4) {}
    _0x2bafd6 = null;
  }
  function _0x42bf2a() {
    _0x2a27c7 = true;
    if (_0x342236) {
      clearInterval(_0x342236);
      _0x342236 = null;
    }
    _0x45a687();
  }
  const _0x3d677d = _0x39ed19 ? "codes-us" : "codes-com";
  const _0x271549 = _0x39ed19 ? "us" : "com";
  function _0x2e1fc1() {
    const _0x201581 = _0x2bafd6.channels.get(_0x3d677d);
    _0x201581.subscribe("new_code", _0x4708a8 => {
      const _0x18565c = _0x4708a8.data;
      if (!_0x18565c || !_0x18565c.code) {
        return;
      }
      if (_0x18565c.domain && _0x18565c.domain !== _0x271549) {
        return;
      }
      const _0x6e6eda = _0x18565c.code;
      _0x47ac9c(_0x18565c);
      if (_0x6e6eda && _0x25bd25(_0x6e6eda) && !_0x583afd[_0x6e6eda]) {
        _0x5acaad(_0x6e6eda);
      }
      if (_0x18565c.timestamp > _0x414fba) {
        _0x414fba = _0x18565c.timestamp;
      }
      queueMicrotask(() => _0x252d80([_0x18565c], true));
    });
    _0x201581.on(_0xb9ae12 => {
      if (_0xb9ae12.current === "failed" || _0xb9ae12.current === "suspended") {
        setTimeout(() => {
          try {
            _0x201581.attach();
          } catch (_0x407cef) {}
        }, 3000);
      }
    });
  }
  function _0x5bca74() {
    if (_0x2bafd6) {
      return;
    }
    if (typeof Ably === "undefined") {
      return;
    }
    if (!_0x3cf78c || _0x2a27c7) {
      return;
    }
    try {
      const _0x1a04a8 = {
        Authorization: "Bearer " + _0x3cf78c
      };
      const _0x2516cd = {
        authUrl: _0x51d8f0 + "/api/ably-token",
        authMethod: "POST",
        authHeaders: _0x1a04a8,
        autoConnect: true,
        disconnectedRetryTimeout: 2000,
        suspendedRetryTimeout: 8000
      };
      _0x2bafd6 = new Ably.Realtime(_0x2516cd);
      if (!_0x1e3c67) {
        _0x1e3c67 = true;
        window.addEventListener("beforeunload", () => {
          try {
            if (_0x2bafd6) {
              _0x2bafd6.close();
            }
          } catch (_0x1c669b) {}
        });
      }
      _0x2e1fc1();
      _0x2bafd6.connection.on("connected", () => {
        console.log("⚡ [ABLY] Connected — edge delivery active");
      });
      _0x2bafd6.connection.on("disconnected", () => {
        console.warn("⚠️ [ABLY] Disconnected — retrying in 2 s...");
      });
      _0x2bafd6.connection.on("suspended", () => {
        console.warn("⚠️ [ABLY] Suspended — forcing reconnect");
        try {
          _0x2bafd6.connection.connect();
        } catch (_0x33b0eb) {}
      });
      _0x2bafd6.connection.on("failed", () => {
        console.warn("⚠️ [ABLY] Fatal — rebuilding client in 5 s");
        _0x45a687();
        setTimeout(_0x5bca74, 5000);
      });
      if (_0x342236) {
        clearInterval(_0x342236);
      }
      _0x342236 = setInterval(() => {
        if (!_0x2bafd6) {
          _0x5bca74();
          return;
        }
        const _0x3f3de9 = _0x2bafd6.connection.state;
        if (_0x3f3de9 === "failed") {
          _0x45a687();
          _0x5bca74();
        } else if (_0x3f3de9 !== "connected" && _0x3f3de9 !== "connecting") {
          try {
            _0x2bafd6.connection.connect();
          } catch (_0x44051b) {}
        }
      }, 15000);
      if (_0x2bddde) {
        document.removeEventListener("visibilitychange", _0x2bddde);
      }
      _0x2bddde = () => {
        if (document.hidden || !_0x2bafd6) {
          return;
        }
        const _0x427789 = _0x2bafd6.connection.state;
        if (_0x427789 !== "connected" && _0x427789 !== "connecting") {
          try {
            _0x2bafd6.connection.connect();
          } catch (_0x516901) {}
        }
      };
      document.addEventListener("visibilitychange", _0x2bddde);
    } catch (_0x3039c7) {
      console.warn("⚠️ [ABLY] Init error:", _0x3039c7.message);
      _0x45a687();
      setTimeout(_0x5bca74, 5000);
    }
  }
  function _0x142ed3() {
    const _0x3e3431 = new URL(_0x51d8f0);
    const _0x12489e = _0x3e3431.protocol === "https:" ? "wss:" : "ws:";
    return _0x12489e + "//" + _0x3e3431.host + "/ws";
  }
  function _0xab7d88() {
    if (!_0x52bbe3 || !_0x3cf78c) {
      return;
    }
    if (_0x50aed2) {
      return;
    }
    if (_0x74aa2d && (_0x74aa2d.readyState === WebSocket.OPEN || _0x74aa2d.readyState === WebSocket.CONNECTING)) {
      return;
    }
    _0x50aed2 = true;
    if (_0x24de01) {
      clearTimeout(_0x24de01);
      _0x24de01 = null;
    }
    const _0x3da62b = _0x142ed3();
    try {
      _0x74aa2d = new WebSocket(_0x3da62b);
      _0x74aa2d.onopen = () => {
        _0x50aed2 = false;
        const _0x56668a = {
          type: "auth",
          token: _0x3cf78c
        };
        _0x74aa2d.send(JSON.stringify(_0x56668a));
      };
      _0x74aa2d.onmessage = _0x262115 => {
        try {
          const _0x8b181a = JSON.parse(_0x262115.data);
          if (_0x8b181a.type === "new_code" && _0x8b181a.code) {
            const _0x225b48 = _0x8b181a.code.code;
            _0x47ac9c(_0x8b181a.code);
            if (_0x225b48 && _0x25bd25(_0x225b48) && !_0x583afd[_0x225b48]) {
              _0x5acaad(_0x225b48);
            }
            if (_0x8b181a.code.timestamp > _0x414fba) {
              _0x414fba = _0x8b181a.code.timestamp;
            }
            queueMicrotask(() => _0x252d80([_0x8b181a.code], true));
            return;
          }
          _0x3f7ed0(_0x8b181a);
        } catch (_0x4f0bba) {}
      };
      _0x74aa2d.onclose = () => {
        _0x29badd = false;
        _0x50aed2 = false;
        _0x428a76();
        _0x415306();
        if (_0x52bbe3) {
          _0x41dd1e();
          if (_0x266100) {
            const _0x3ff2e9 = _0x32ff66 * Math.pow(1.5, Math.min(_0xcba344, 10));
            const _0x5d85e5 = Math.random() * 2000;
            _0xcba344++;
            _0x24de01 = setTimeout(_0xab7d88, _0x3ff2e9 + _0x5d85e5);
          }
        }
      };
      _0x74aa2d.onerror = () => {
        _0x50aed2 = false;
      };
    } catch (_0x2c052c) {
      _0x50aed2 = false;
      if (_0x266100) {
        _0x24de01 = setTimeout(_0xab7d88, _0x32ff66);
      }
    }
  }
  function _0x415306() {
    const _0x3fe11c = document.getElementById("ws-status-dot");
    const _0x3f9e22 = document.getElementById("ws-status-label");
    if (!_0x3fe11c || !_0x3f9e22) {
      return;
    }
    if (_0x29badd) {
      _0x3fe11c.style.background = "#c084fc";
      _0x3fe11c.style.boxShadow = "0 0 8px rgba(192,132,252,0.7)";
      _0x3fe11c.classList.add("scc-pulse");
      _0x3f9e22.textContent = _tgPolling ? "TG" : "WS";
      _0x3f9e22.style.color = "#c084fc";
    } else if (_0x50aed2) {
      _0x3fe11c.style.background = "#fbbf24";
      _0x3fe11c.style.boxShadow = "0 0 5px rgba(251,191,36,0.45)";
      _0x3fe11c.classList.remove("scc-pulse");
      _0x3f9e22.textContent = _tgPolling ? "TG" : "WS";
      _0x3f9e22.style.color = "#fbbf24";
    } else {
      _0x3fe11c.style.background = "#f87171";
      _0x3fe11c.style.boxShadow = "none";
      _0x3fe11c.classList.remove("scc-pulse");
      _0x3f9e22.textContent = _tgPolling ? "TG" : "WS";
      _0x3f9e22.style.color = "#f87171";
    }
    const _0x2ff6db = document.getElementById("ws-auto-toggle");
    if (_0x2ff6db) {
      _0x2ff6db.style.background = _0x266100 ? "linear-gradient(135deg,#7c3aed,#d946ef)" : "rgba(255,255,255,0.12)";
      const _0x4b9c90 = _0x2ff6db.firstElementChild;
      if (_0x4b9c90) {
        _0x4b9c90.style.left = _0x266100 ? "auto" : "2px";
        _0x4b9c90.style.right = _0x266100 ? "2px" : "auto";
      }
    }
  }
  function _0x3f7ed0(_0x427bda) {
    switch (_0x427bda.type) {
      case "auth_success":
        _0x29badd = true;
        _0x50aed2 = false;
        _0xcba344 = 0;
        _0x5c87b4();
        _0x415306();
        _0x2a27c7 = false;
        _0x5bca74();
        if (_0x427bda.turboMode !== undefined) {
          _0x1189b0 = _0x427bda.turboMode;
        }
        if (_0x427bda.recentCodes && Array.isArray(_0x427bda.recentCodes)) {
          _0x252d80(_0x427bda.recentCodes);
          for (const _0x3559ce of _0x427bda.recentCodes) {
            if (_0x3559ce.timestamp > _0x414fba) {
              _0x414fba = _0x3559ce.timestamp;
            }
          }
        }
        if (_0x3052d3) {
          clearInterval(_0x3052d3);
          _0x3052d3 = null;
          _0x73ec5a = false;
        }
        _0x5cc1a7();
        _0x32da29();
        if (_0x1489d5) {
          _0x39c422();
        }
        break;
      case "auth_error":
        _0x29badd = false;
        _0x50aed2 = false;
        _0x415306();
        if (_0x74aa2d) {
          try {
            _0x74aa2d.close();
          } catch (_0x1aa24e) {}
        }
        if (_0x427bda.reason === "subscription_expired") {
          // License bypass: ignore subscription expiry from server
          break;
        } else if (_0x427bda.reason === "already_connected") {
          _0x4756f7 = true;
          _0x2ff120("⚠️ Already connected in another tab. Close it first.");
          if (window._wsWorker) {
            window._wsWorker.postMessage({
              type: "disconnect"
            });
          }
          _0x5c87b4();
          _0x42bf2a();
        } else {
          if (window._wsWorker) {
            window._wsWorker.postMessage({
              type: "disconnect"
            });
          }
          if (_0x52bbe3) {
            _0x41dd1e();
          }
        }
        break;
      case "new_code":
        break;
      case "turbo_state":
        _0x1189b0 = _0x427bda.enabled;
        break;
      case "code_update":
        if (_0x427bda.code) {
          const _0x300099 = _0x167b9f.find(_0x4b4074 => _0x4b4074.code === _0x427bda.code.code);
          if (_0x300099) {
            _0x300099.amount = _0x427bda.code.value || _0x300099.amount;
            _0x300099.limit = _0x427bda.code.limit || _0x300099.limit;
            _0x300099.wager = _0x427bda.code.wagerRequirement || _0x300099.wager;
            _0x300099.deadline = _0x427bda.code.timeline || _0x300099.deadline;
            _0x1fde84();
            _0x51d4fb();
          }
        }
        break;
      case "pong":
        break;
      case "subscription_expired":
        // License bypass: ignore subscription expiry from server
        break;
    }
  }
  function _0x252d80(_0xe5ad6a, _0x2624ae = false) {
    const _0x3950ca = parseInt(GM_getValue("clearTimestamp", "0"));
    let _0x4cc127 = false;
    for (const _0x2ee252 of _0xe5ad6a) {
      if (_0x2ee252.timestamp < _0x3950ca) {
        continue;
      }
      _0x47ac9c(_0x2ee252);
      const _0x39080f = _0x2ee252.code.toLowerCase();
      if (_0x3cc3c0.has(_0x39080f)) {
        continue;
      }
      _0x3cc3c0.add(_0x39080f);
      if (_0x167b9f.some(_0x15106f => _0x15106f.code === _0x2ee252.code)) {
        continue;
      }
      const _0x30fa0a = {
        code: _0x2ee252.code,
        timestamp: _0x2ee252.timestamp,
        amount: _0x2ee252.amount || _0x2ee252.value || "N/A",
        wager: _0x2ee252.wagerRequirement || _0x2ee252.wager || "Unknown",
        deadline: _0x2ee252.timeline || _0x2ee252.deadline || "N/A",
        limit: _0x2ee252.limit || "-",
        source: _0x2ee252.source || "telegram",
        claimed: null,
        rejectionReason: null
      };
      const _0x3c9dcc = _0x30fa0a;
      _0x167b9f.unshift(_0x3c9dcc);
      _0x4cc127 = true;
      if (_0x2624ae && _0x25bd25(_0x2ee252.code)) {
        _0x3865d4("<b>Waggerbot!</b> " + _0x7b2981(_0x2ee252.code), "redeeming", 1500);
      }
    }
    if (_0x4cc127) {
      setTimeout(() => {
        _0x1fde84();
        _0x51d4fb();
      }, 0);
    }
  }
  function _0x5cc1a7() {
    if (_0xd349b3) {
      return;
    }
    _0xd349b3 = setInterval(() => {
      if (_0x74aa2d && _0x74aa2d.readyState === WebSocket.OPEN) {
        const _0x10a36b = {
          type: "ping",
          username: _0x2e4b70
        };
        _0x74aa2d.send(JSON.stringify(_0x10a36b));
      }
    }, 6000);
  }
  function _0x428a76() {
    if (_0xd349b3) {
      clearInterval(_0xd349b3);
      _0xd349b3 = null;
    }
  }
  function _0x406d6b() {
    _0x428a76();
    if (_0x24de01) {
      clearTimeout(_0x24de01);
      _0x24de01 = null;
    }
    if (_0x74aa2d) {
      _0x74aa2d.close();
      _0x74aa2d = null;
    }
    _0x29badd = false;
    _0x50aed2 = false;
    _0xcba344 = 0;
    _0x415306();
  }
  function _0xa7c162() {
    if (_0x3052d3) {
      clearInterval(_0x3052d3);
      _0x3052d3 = null;
      _0x73ec5a = false;
    }
  }
  function _0x41dd1e() {
    if (_0x303345 || _0x29badd) {
      return;
    }
    _0x412573();
    _0x303345 = setInterval(_0x412573, 1000);
  }
  function _0x5c87b4() {
    if (_0x303345) {
      clearInterval(_0x303345);
      _0x303345 = null;
    }
  }
  async function _0x412573() {
    if (!_0x52bbe3 || !_0x3cf78c) {
      return;
    }
    try {
      const _0x396d19 = _0x414fba > 0 ? _0x51d8f0 + "/api/codes?since=" + _0x414fba : _0x51d8f0 + "/api/codes";
      const _0x38a00e = {
        Authorization: "Bearer " + _0x3cf78c
      };
      const _0x1dce10 = {
        headers: _0x38a00e
      };
      const _0x28dc67 = await fetch(_0x396d19, _0x1dce10);
      if (!_0x28dc67.ok) {
        return;
      }
      const _0x2a1976 = await _0x28dc67.json();
      if (_0x2a1976.length > 0) {
        for (const _0x3819fc of _0x2a1976) {
          if (_0x3819fc.timestamp > _0x414fba) {
            _0x414fba = _0x3819fc.timestamp;
          }
        }
        _0x252d80(_0x2a1976, true);
      }
    } catch (_0x53e4c9) {}
  }
  function _0x1dba99(_0x4d2249, _0x428597, _0x274692 = null) {
    if (_0x3ff73e[_0x4d2249]) {
      delete _0x389dfa[_0x4d2249];
      return false;
    }
    _0x3ff73e[_0x4d2249] = _0x428597 ? "success" : "rejected";
    const _0x2ddacc = typeof _0x583afd[_0x4d2249] === "number" ? _0x583afd[_0x4d2249] : null;
    _0x583afd[_0x4d2249] = Date.now();
    delete _0x389dfa[_0x4d2249];
    const _0x5bb0e4 = Date.now();
    let _0x196834 = null;
    const _0x346ab7 = _0x167b9f.findIndex(_0x24df97 => _0x24df97.code === _0x4d2249 && _0x24df97.claimed == null);
    const _0x6ac148 = _0x167b9f.findIndex(_0x1fcf33 => _0x1fcf33.code === _0x4d2249 && _0x1fcf33.claimed != null);
    const _0x3c3569 = !_0x428597 && /^(invalid code|code not found)$/i.test((_0x274692 || "").trim());
    if (_0x3c3569) {
      if (_0x346ab7 >= 0) {
        _0x196834 = _0x167b9f[_0x346ab7].value;
        _0x167b9f.splice(_0x346ab7, 1);
      }
    } else if (_0x346ab7 >= 0 && _0x6ac148 < 0) {
      _0x196834 = _0x167b9f[_0x346ab7].value;
      _0x167b9f[_0x346ab7].claimed = _0x428597;
      _0x167b9f[_0x346ab7].processedAt = _0x5bb0e4;
      _0x167b9f[_0x346ab7].rejectionReason = _0x274692;
      if (_0x2ddacc) {
        _0x167b9f[_0x346ab7].claimStartedAt = _0x2ddacc;
      }
    } else {
      const _0x49e48a = _0x167b9f[_0x6ac148] || _0x167b9f[_0x346ab7] || {};
      _0x196834 = _0x49e48a.value;
      const _0x2a4772 = {
        code: _0x4d2249,
        timestamp: _0x2ddacc || _0x5bb0e4,
        claimStartedAt: _0x2ddacc || _0x5bb0e4,
        receivedAt: _0x5bb0e4,
        amount: _0x49e48a.amount || null,
        value: _0x49e48a.value || null,
        deadline: _0x49e48a.deadline || null,
        limit: _0x49e48a.limit || null,
        source: _0x49e48a.source || "manual",
        claimed: _0x428597,
        processedAt: _0x5bb0e4,
        rejectionReason: _0x274692
      };
      _0x167b9f.unshift(_0x2a4772);
      if (_0x167b9f.length > 50) {
        _0x167b9f.length = 50;
      }
    }
    _0x1fde84();
    _0x51d4fb();
    _0x5adf8d();
    if (_0x428597) {
      const _0x77d01e = _0x167b9f.find(_0x439c05 => _0x439c05.code === _0x4d2249 && _0x439c05.claimed === true);
      const _0x1e5510 = _0x77d01e?.amount ? " - " + _0x7b2981(_0x77d01e.amount) : "";
      _0x3865d4("<b>CLAIMED!</b><br>" + _0x7b2981(_0x4d2249) + _0x1e5510, "claimed", 4000);
    } else {
      _0x3865d4("<b>REJECTED</b><br>" + _0x7b2981(_0x4d2249) + ": " + _0x7b2981(_0x274692), "error", 4000);
    }
    _0x421cf6(_0x4d2249, _0x428597, _0x274692, _0x196834);
    return true;
  }
  let _0x19bedb = null;
  let _0x30f16f = null;
  let _0x1a13c0 = 0;
  const _0x372b1e = 30000;
  async function _0x3c1d3d() {
    try {
      const _0x2520fe = Date.now();
      if (_0x30f16f && _0x2520fe - _0x1a13c0 < _0x372b1e) {
        return _0x30f16f;
      }
      const _0x315a4b = _0x42dcf3();
      if (_0x315a4b) {
        try {
          const _0x399b70 = new AbortController();
          const _0x250fee = setTimeout(() => _0x399b70.abort(), 5000);
          const _0x1833d3 = {
            "Content-Type": "application/json",
            "x-access-token": _0x315a4b
          };
          const _0x3c055b = await fetch(_0x5ab6f7, {
            method: "POST",
            headers: _0x1833d3,
            credentials: "include",
            signal: _0x399b70.signal,
            body: JSON.stringify({
              query: "{ user { name } }"
            })
          });
          clearTimeout(_0x250fee);
          if (_0x3c055b.ok) {
            const _0x3cdbfa = await _0x3c055b.json();
            if (_0x3cdbfa?.data?.user?.name) {
              const _0x11b214 = _0x3cdbfa.data.user.name.toLowerCase();
              _0x30f16f = _0x11b214;
              _0x1a13c0 = _0x2520fe;
              if (_0x11b214 !== _0x19bedb) {
                _0x19bedb = _0x11b214;
              }
              return _0x11b214;
            }
          }
        } catch (_0x47d190) {
          if (_0x47d190.name !== "AbortError") {}
        }
      }
      const _0x313500 = localStorage.getItem("sc-last-username");
      if (_0x313500) {
        const _0x3968aa = _0x313500.toLowerCase();
        if (_0x3968aa !== _0x19bedb) {
          _0x19bedb = _0x3968aa;
        }
        return _0x3968aa;
      }
      const _0x5c7171 = document.querySelector("[data-testid=\"user-menu\"], .user-menu, .profile-menu");
      if (_0x5c7171) {
        const _0x5ac602 = _0x5c7171.querySelector(".username, [class*=\"username\"]");
        if (_0x5ac602 && _0x5ac602.textContent) {
          const _0x15f5ca = _0x5ac602.textContent.trim().toLowerCase();
          if (_0x15f5ca !== _0x19bedb) {
            _0x19bedb = _0x15f5ca;
          }
          return _0x15f5ca;
        }
      }
      const _0x47fb61 = Object.keys(localStorage).find(_0x3e6f3a => _0x3e6f3a.includes("ph_") && _0x3e6f3a.endsWith("_posthog"));
      if (_0x47fb61) {
        const _0x380100 = JSON.parse(localStorage.getItem(_0x47fb61));
        const _0x1b88f8 = _0x380100?.$stored_person_properties?.username;
        if (_0x1b88f8) {
          const _0x443c07 = _0x1b88f8.toLowerCase();
          if (_0x443c07 !== _0x19bedb) {
            _0x19bedb = _0x443c07;
          }
          return _0x443c07;
        }
      }
      _0x30f16f = null;
      return null;
    } catch (_0xd1f829) {
      return null;
    }
  }
  let _0x2b56b7 = null;
  let _0x5539a0 = 0;
  let _0x144b66 = false;
  let _0x529d0e = 0;
  const _0x206e2d = 15000;
  let _0x5de896 = 0;
  let _0x4756f7 = false;
  async function _0xd52aff() {
    if (_0x4756f7) {
      return;
    }
    if (_0x144b66 && Date.now() - _0x529d0e > _0x206e2d) {
      _0x144b66 = false;
    }
    if (_0x144b66) {
      return;
    }
    if (_0x52bbe3) {
      return;
    }
    const _0x333cec = await _0x3c1d3d();
    if (!_0x333cec) {
      _0x5539a0++;
      if (_0x52bbe3) {
        _0x52bbe3 = false;
        _0x2e4b70 = null;
        _0x3cf78c = null;
        _0x406d6b();
        _0x5adf8d();
      } else {
        const _0xa80eb3 = document.getElementById("stake-status");
        if (_0xa80eb3 && _0x5539a0 <= 10) {
          _0xa80eb3.textContent = "🔍 Detecting account...";
        } else if (_0xa80eb3) {
          _0xa80eb3.textContent = "⚠️ Login to Stake to connect";
          _0xa80eb3.style.background = "rgba(255,152,0,0.2)";
          _0xa80eb3.style.borderColor = "#ff9800";
          _0xa80eb3.style.color = "#ff9800";
        }
      }
      return;
    }
    _0x5539a0 = 0;
    if (_0x333cec !== _0x2b56b7) {
      _0x2b56b7 = _0x333cec;
      if (_0x52bbe3 && _0x2e4b70 !== _0x333cec) {
        _0x52bbe3 = false;
        _0x3cf78c = null;
        _0x406d6b();
      }
      _0x4756f7 = false;
      _0x5de896 = 0;
    }
    if (!_0x52bbe3) {
      await _0x5c77db(_0x333cec);
    }
  }
  async function _0x5c77db(_0x472547) {
    if (_0x144b66 || _0x52bbe3) {
      return;
    }
    if (_0x4756f7) {
      return;
    }
    _0x144b66 = true;
    _0x529d0e = Date.now();
    const _0xda2c66 = _0x51d8f0 + "/api/connect";
    try {
      const _0x39c4db = {
        stakeUsername: _0x472547
      };
      const _0x581aca = await fetch(_0xda2c66, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(_0x39c4db)
      });
      if (!_0x581aca.ok) {
        let _0x5a248d = {};
        try {
          _0x5a248d = await _0x581aca.json();
        } catch (_0xe607d7) {}
        if (_0x581aca.status === 404 || _0x581aca.status === 403) {
          // License bypass: unlock local features without server subscription
          _0x2e4b70 = _0x472547;
          _0x2df668 = (_0x472547 || _0x2df668 || "anon").toLowerCase();
          try {
            localStorage.setItem("sc-last-username", _0x2df668);
          } catch (_0xc18c0) {}
          _0x3cf78c = "bypass";
          _0x31caad = "bypass";
          _0x52bbe3 = true;
          _0x33815b = Date.now();
          _0x483d64 = "2099-12-31T23:59:59.000Z";
          _0x5995ed = false;
          _0x1ab406 = false;
          _0x5de896 = 0;
          _0x4756f7 = false;
          _0x4de61f();
          _0xeebc94();
          _0x32da29();
          if (!window._tokenKeepAlive) {
            window._tokenKeepAlive = setInterval(() => {
              _0x20a9bd();
              _0x4de61f();
            }, 15000);
          }
          _0x16710e();
          _0x9c60d2();
          _0x5adf8d();
          startTelegramCodeFeed();
          _0x144b66 = false;
          return;
        } else if (_0x581aca.status >= 500) {
          _0x2ff120("❌ Server error - retrying...");
          _0x144b66 = false;
          _0x5de896++;
          const _0x5608c8 = Math.min(30000, _0x110afa.CONNECT_RETRY * Math.pow(2, _0x5de896));
          setTimeout(() => _0xd52aff(), _0x5608c8);
          return;
        } else {
          throw new Error("HTTP " + _0x581aca.status);
        }
      }
      const _0x286a22 = await _0x581aca.json();
      if (_0x286a22.success) {
        _0x2e4b70 = _0x472547;
        _0x2df668 = (_0x472547 || _0x2df668 || "anon").toLowerCase();
        try {
          localStorage.setItem("sc-last-username", _0x2df668);
        } catch (_0xc18c0) {}
        _0x3cf78c = _0x286a22.accessToken;
        _0x31caad = _0x286a22.refreshToken;
        _0x52bbe3 = true;
        _0x33815b = Date.now();
        _0x483d64 = "2099-12-31T23:59:59.000Z";
        _0x5995ed = !!_0x286a22.telegramLinked;
        _0x1ab406 = !!_0x286a22.telegramNotifyEnabled;
        _0x5de896 = 0;
        _0x4756f7 = false;
        _0x4de61f();
        _0xeebc94();
        _0x32da29();
        if (!window._tokenKeepAlive) {
          window._tokenKeepAlive = setInterval(() => {
            _0x20a9bd();
            _0x4de61f();
          }, 15000);
        }
        _0x16710e();
        _0x9c60d2();
        _0x5adf8d();
        startTelegramCodeFeed();
        _0x144b66 = false;
      } else {
        // License bypass on soft failure
        _0x2e4b70 = _0x472547;
        _0x2df668 = (_0x472547 || _0x2df668 || "anon").toLowerCase();
        try {
          localStorage.setItem("sc-last-username", _0x2df668);
        } catch (_0xc18c0) {}
        _0x3cf78c = "bypass";
        _0x31caad = "bypass";
        _0x52bbe3 = true;
        _0x33815b = Date.now();
        _0x483d64 = "2099-12-31T23:59:59.000Z";
        _0x5995ed = false;
        _0x1ab406 = false;
        _0x5de896 = 0;
        _0x4756f7 = false;
        _0x4de61f();
        _0xeebc94();
        _0x32da29();
        _0x16710e();
        _0x9c60d2();
        _0x5adf8d();
        startTelegramCodeFeed();
        _0x144b66 = false;
      }
    } catch (_0x1563ef) {
      _0x144b66 = false;
      _0x5de896++;
      if (_0x5de896 <= 5) {
        const _0x31fa17 = Math.min(60000, _0x110afa.CONNECT_RETRY * Math.pow(2, _0x5de896));
        _0x2ff120("❌ Network error - retry " + _0x5de896 + "/5");
        setTimeout(() => _0xd52aff(), _0x31fa17);
      } else {
        _0x2ff120("❌ Connection failed - refresh page to retry");
        _0x4756f7 = true;
      }
    }
  }
  function _0x44edc0() {
    if (_0x1ab406) {
      _0x1ab406 = false;
      _0x12d53c();
      const _0x19bf2b = {
        "Content-Type": "application/json",
        Authorization: "Bearer " + _0x3cf78c
      };
      GM_xmlhttpRequest({
        method: "POST",
        url: _0x51d8f0 + "/api/telegram/disable-alerts",
        headers: _0x19bf2b,
        onload: function (_0x140182) {
          try {
            const _0x2aaedf = JSON.parse(_0x140182.responseText);
            if (_0x2aaedf.success) {
              _0x3865d4("DM Alerts disabled", "info", 2000);
            }
          } catch (_0x94bb59) {}
        }
      });
    } else {
      _0x3865d4("Testing Telegram connection...", "info", 2000);
      const _0x3567bd = {
        "Content-Type": "application/json",
        Authorization: "Bearer " + _0x3cf78c
      };
      GM_xmlhttpRequest({
        method: "POST",
        url: _0x51d8f0 + "/api/telegram/enable-alerts",
        headers: _0x3567bd,
        onload: function (_0x7e0a09) {
          try {
            const _0x42fd58 = JSON.parse(_0x7e0a09.responseText);
            if (_0x42fd58.success) {
              _0x1ab406 = true;
              _0x5995ed = true;
              _0x12d53c();
              _0x3865d4("DM Alerts enabled! Check Telegram.", "success", 3000);
            } else {
              alert(_0x42fd58.error || "Telegram alerts unavailable");
            }
          } catch (_0x57b29a) {
            alert("Telegram alerts unavailable");
          }
        },
        onerror: function () {
          alert("Telegram alerts unavailable");
        }
      });
    }
  }
  function _0x12d53c() {
    const _0x450e1e = document.getElementById("dashboard-telegram-toggle");
    if (!_0x450e1e) {
      return;
    }
    _0x450e1e.style.cursor = !_0x5995ed ? "not-allowed" : "pointer";
    _0x450e1e.style.opacity = !_0x5995ed ? "0.5" : "1";
    _0x5dbd00("dashboard-telegram-toggle", _0x1ab406);
  }
  function _0x421cf6(_0x38406b, _0x15c045, _0x4ebaec, _0xc569fc) {
    if (!_0x3cf78c) {
      return;
    }
    try {
      const _0x791dee = _0x51d8f0 + "/api/claim-result";
      const _0x4b0e0e = _0x375432[String(_0x38406b).toLowerCase()];
      const _0x18fd39 = {
        code: _0x38406b,
        success: _0x15c045,
        reason: _0x4ebaec || null,
        value: _0xc569fc || null,
        stakeUsername: _0x2e4b70 || null,
        bonus: _0x4b0e0e === "bonus" ? true : _0x4b0e0e === "drop" ? false : _0x2dc13a(_0x38406b),
        source: "auto"
      };
      const _0x78b7d = {
        "Content-Type": "application/json",
        Authorization: "Bearer " + _0x3cf78c
      };
      GM_xmlhttpRequest({
        method: "POST",
        url: _0x791dee,
        headers: _0x78b7d,
        data: JSON.stringify(_0x18fd39),
        onload: function (_0x2615c5) {
          try {
            const _0x31393a = JSON.parse(_0x2615c5.responseText);
            if (_0x31393a.success) {} else {}
          } catch (_0x37f50b) {}
        },
        onerror: function (_0x25fc2d) {},
        ontimeout: function () {}
      });
    } catch (_0x1d8bf1) {}
  }
  function _0x16668a() {
    if (document.getElementById("stake-header")) return;
    if (!document.getElementById("wb-font")) {
      const _0xfont = document.createElement("link");
      _0xfont.id = "wb-font";
      _0xfont.rel = "stylesheet";
      _0xfont.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap";
      (document.head || document.documentElement).appendChild(_0xfont);
    }
    const _0x57e6f9 = GM_getValue("headerVisible", true);
    let _0x472067 = "Detection…";
    if (_0x52bbe3) _0x472067 = (_0x2e4b70 || "Connecté") + " · prêt";
    const _0x1712ca = _0x2fd4a6();
    let _0x3aed8c = (_0x1489d5 && _0x58dba1 && _0x58dba1.id)
      ? '<div id="stake-reload-info">Reload · $' + (_0x58dba1.value || 0).toFixed(2) + ' · ' + _0x1712ca.totalClaims + '</div>'
      : '<div id="stake-reload-info" style="opacity:0.45">Reload off</div>';
    const _0xdailyHtml = _0x39ed19 ? '<div id="stake-daily-bonus-info">Daily</div>' : '';
    const _0xtog = (on) => 'background:' + (on ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'rgba(255,255,255,0.1)');
    const _0xknob = (on) => 'transform:' + (on ? 'translateX(20px)' : 'translateX(2px)');
    const _0xdur = ({ auto: 'Auto', '2000': '2s', '3000': '3s', '5000': '5s', '10000': '10s' }[_0x38e0b7] || 'Auto');
    const _0xref = ({ off: 'Off', '1800000': '30m', '3600000': '1h', '7200000': '2h', '21600000': '6h', '43200000': '12h', '86400000': '24h' }[_0x5f6006] || 'Off');
    const _0xhtml = `
<div id="stake-header" class="wb-float-host" style="display:${_0x57e6f9 ? 'block' : 'none'}">
  <button type="button" class="wb-burger" id="stake-panel-btn" aria-label="Menu WaggerBot" title="Menu"><span></span><span></span><span></span></button>
  <button id="stake-settings-btn" type="button" style="display:none" aria-hidden="true"></button>
  <button id="stake-minimize-btn" type="button" style="display:none" aria-hidden="true"></button>
  <div id="stake-claim-ready" style="display:none"></div>
  <a id="buy-sub-btn" href="#" style="display:none"></a>
</div>
<button id="stake-show-btn" class="wb-show" type="button" style="display:${_0x57e6f9 ? 'none' : 'flex'}"><span class="wb-logo-sm">W</span> WaggerBot</button>
<div id="stake-panel" class="wb-drawer" style="display:none">
  <div class="wb-panel-head">
    <div class="wb-panel-head-top">
      <div class="wb-brand">
        <div class="wb-logo">W</div>
        <div>
          <div class="wb-title">WaggerBot · Stake</div>
          <div class="wb-sub"><span id="wb-live-dot" class="${_0x52bbe3 ? 'on' : ''}"></span><span id="stake-status">${_0x472067}</span></div>
        </div>
      </div>
      <div class="wb-head-meta">
        <span id="wb-stat-badge" class="wb-stat-badge">—</span>
        <span class="wb-user-pill" id="stake-username">${_0x2e4b70 || '…'}</span>
        <button id="stake-panel-close" type="button" class="wb-icon-x" title="Fermer">✕</button>
      </div>
    </div>
    <div class="wb-claim-box">
      <input id="manual-code-input-inline" type="text" placeholder="Code" autocomplete="off" spellcheck="false" maxlength="30">
      <button id="manual-claim-btn-inline" type="button">Claim</button>
    </div>
    <div class="wb-status-row">
      <div id="scc-live-ws" class="wb-feed" style="display:${_0x52bbe3 ? 'flex' : 'none'}" title="Reconnect auto">
        <div id="stake-searching" class="wb-feed-live"><span class="scc-pulse wb-dot"></span><span>LIVE</span></div>
        <div id="ws-indicator" class="wb-feed-ws"><span id="ws-status-dot" class="wb-dot-sm"></span><span id="ws-status-label">TG</span></div>
        <span class="wb-feed-label">Auto</span>
        <div id="ws-auto-toggle" class="wb-switch" style="background:${_0x266100 ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : 'rgba(255,255,255,0.12)'}"><div class="wb-switch-knob" style="${_0x266100 ? 'right:2px;left:auto' : 'left:2px'}"></div></div>
      </div>
      ${_0x3aed8c}
      ${_0xdailyHtml}
      <a href="https://t.me/stakecodedropsgoofy" target="_blank" class="wb-tg-link">Telegram</a>
    </div>
  </div>
  <div class="wb-tabs">
    <button id="history-tab-codes" class="history-tab active" type="button">Codes</button>
    <button id="history-tab-reloads" class="history-tab" type="button">Reloads</button>
    ${_0x39ed19 ? '<button id="history-tab-daily" class="history-tab" type="button">Daily</button>' : ''}
    <button id="wb-open-settings" class="history-tab" type="button">Réglages</button>
  </div>
  <div id="history-codes-content" style="flex:1;overflow:auto;display:block">
    <div class="wb-drawer-hint">Canal · <a href="https://t.me/stakecodedropsgoofy" target="_blank">@stakecodedropsgoofy</a><button id="stake-reset-btn" type="button" class="wb-link-btn">Vider</button></div>
    <table id="history-codes-table" class="wb-table"><thead><tr><th>Heure</th><th>Vitesse</th><th>Code</th><th>Montant</th><th>Statut</th><th>Raison</th></tr></thead><tbody id="history-codes-tbody"></tbody></table>
  </div>
  <div id="history-reloads-content" style="flex:1;overflow:hidden;display:none"><div class="wb-split"><div id="reload-status-panel" class="wb-side"></div><div class="wb-side-main"><table class="wb-table"><thead><tr><th>Heure</th><th>Valeur</th><th>Crypto</th><th>Statut</th><th>Raison</th></tr></thead><tbody id="history-reloads-tbody"></tbody></table></div></div></div>
  ${_0x39ed19 ? '<div id="history-daily-content" style="flex:1;overflow-y:auto;display:none"><table class="wb-table"><thead><tr><th>Heure</th><th>Montant</th><th>Devise</th><th>Statut</th><th>Raison</th></tr></thead><tbody id="history-daily-tbody"></tbody></table></div>' : ''}
</div>
<div id="settings-modal" class="wb-modal" style="display:none">
  <div class="settings-overlay wb-overlay"></div>
  <div class="settings-container wb-sheet wb-sheet-sm">
    <div class="wb-sheet-head"><div class="wb-sheet-title"><span class="wb-rail"></span><div><div class="wb-h1">Réglages</div><div class="wb-h2">Contrôles WaggerBot</div></div></div><button id="settings-modal-close" type="button">✕</button></div>
    <div class="settings-tab-bar wb-seg">
      <button class="settings-tab active" data-tab="claims" type="button">Claims</button>
      <button class="settings-tab" data-tab="notifications" type="button">Alertes</button>
      <button class="settings-tab" data-tab="automation" type="button">Auto</button>
    </div>
    <div class="settings-content wb-settings-body">
      <div id="settings-tab-claims" class="settings-tab-content" style="display:block">
        <div class="wb-section-label">Codes</div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Claim drops</b><span>Auto-claim des drops</span></div><div id="drop-claim-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0x1f023c)}"><div class="toggle-slider" style="${_0xknob(_0x1f023c)}"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Claim bonus</b><span>Auto-claim des bonus</span></div><div id="bonus-claim-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0x288214)}"><div class="toggle-slider" style="${_0xknob(_0x288214)}"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Devise</b><span>Devise des récompenses</span></div><div id="settings-currency-picker" style="position:relative"><button id="settings-currency-btn" class="wb-select" type="button"><span class="settings-currency-label">${_0xb91545}</span> ▾</button><div id="settings-currency-dropdown" class="wb-menu" style="display:none"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Auto-vault</b><span>Envoyer au vault</span></div><div id="bonus-vault-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0x231efb)}"><div class="toggle-slider" style="${_0xknob(_0x231efb)}"></div></div></div>
        <div class="wb-section-label" style="margin-top:18px">Reloads</div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Auto-claim</b><span>Claim auto des reloads</span></div><div id="reload-auto-claim-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0x1489d5)}"><div class="toggle-slider" style="${_0xknob(_0x1489d5)}"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Devise reload</b><span>Devise des reloads</span></div><div style="position:relative"><button id="reload-currency-btn" class="wb-select" type="button"><span>${_0x5a3e62}</span> ▾</button><div id="reload-currency-dropdown" class="wb-menu" style="display:none"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Auto-vault reload</b><span>Vault des reloads</span></div><div id="reload-auto-vault-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0x5716ea)}"><div class="toggle-slider" style="${_0xknob(_0x5716ea)}"></div></div></div>
        ${_0x39ed19 ? '<div class="wb-section-label" style="margin-top:18px">Daily</div><div class="settings-row wb-row"><div class="wb-row-copy"><b>Auto daily</b><span id="daily-bonus-status">' + (_0x1e2bb6 ? 'Activé' : 'Désactivé') + '</span></div><div id="daily-bonus-toggle" class="scc-toggle wb-toggle" style="' + _0xtog(_0x1e2bb6) + '"><div class="toggle-slider" style="' + _0xknob(_0x1e2bb6) + '"></div></div></div>' : ''}
      </div>
      <div id="settings-tab-notifications" class="settings-tab-content" style="display:none">
        <div class="wb-section-label">Notifications</div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Toasts</b><span>Alertes à l'écran</span></div><div id="toast-notifications-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0xf1fa9f)}"><div class="toggle-slider" style="${_0xknob(_0xf1fa9f)}"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Son</b><span>Alerte sonore</span></div><div id="sound-notifications-toggle" class="scc-toggle wb-toggle" style="${_0xtog(_0x393820)}"><div class="toggle-slider" style="${_0xknob(_0x393820)}"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Durée</b><span>Affichage des toasts</span></div><div style="position:relative"><button id="notification-duration-btn" class="wb-select" type="button"><span>${_0xdur}</span> ▾</button><div id="notification-duration-dropdown" class="wb-menu" style="display:none"></div></div></div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Telegram DM</b><span>${!_0x5995ed ? "Lier Telegram d'abord" : _0x1ab406 ? 'Alertes actives' : 'Alertes codes via DM'}</span></div><div id="dashboard-telegram-toggle" class="scc-toggle wb-toggle" style="cursor:${!_0x5995ed ? 'not-allowed' : 'pointer'};opacity:${!_0x5995ed ? '0.4' : '1'};${_0xtog(_0x1ab406)}"><div class="toggle-slider" style="${_0xknob(_0x1ab406)}"></div></div></div>
      </div>
      <div id="settings-tab-automation" class="settings-tab-content" style="display:none">
        <div class="wb-section-label">Automatisation</div>
        <div class="settings-row wb-row"><div class="wb-row-copy"><b>Rafraîchir la page</b><span>Intervalle de refresh</span></div><div style="position:relative"><button id="auto-refresh-btn" class="wb-select" type="button"><span>${_0xref}</span> ▾</button><div id="auto-refresh-dropdown" class="wb-menu" style="display:none"></div></div></div>
        <div class="wb-note">Garde la session active. Un seul onglet par compte claim les codes.</div>
      </div>
    </div>
  </div>
</div>
<style>
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');

.wb-float-host {
  position: fixed; top: 14px; right: 14px; z-index: 999999;
  padding: 0; margin: 0; background: none; border: none;
  display: block; width: auto; height: auto;
}
.wb-burger {
  width: 44px; height: 44px; border-radius: 12px;
  border: 1px solid rgba(168,85,247,.18);
  background: linear-gradient(180deg,#0d0b14 0%,#07060b 100%);
  cursor: pointer; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 5px;
  box-shadow: 0 4px 24px rgba(0,0,0,.55); padding: 0;
}
.wb-burger:hover { border-color: rgba(168,85,247,.45); box-shadow: 0 4px 28px rgba(168,85,247,.25); }
.wb-burger span { display: block; width: 18px; height: 2px; border-radius: 1px; background: #c084fc; transition: transform .25s, opacity .25s; }
.wb-burger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.wb-burger.open span:nth-child(2) { opacity: 0; }
.wb-burger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

.wb-show {
  position: fixed; top: 14px; right: 14px; z-index: 999999;
  align-items: center; gap: 8px;
  background: linear-gradient(180deg,#0d0b14,#07060b);
  border: 1px solid rgba(168,85,247,.35); color: #e9d5ff;
  padding: 8px 14px; border-radius: 12px; cursor: pointer;
  font-family: 'Space Grotesk', sans-serif; font-size: 12px; font-weight: 700;
  box-shadow: 0 10px 30px rgba(0,0,0,.45);
}
.wb-logo-sm {
  width: 20px; height: 20px; border-radius: 6px; display: inline-flex;
  align-items: center; justify-content: center; font-weight: 800; font-size: 11px; color: #fff;
  background: linear-gradient(135deg,#7c3aed,#a855f7);
}

.wb-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 100vw;
  z-index: 999998; display: flex; flex-direction: column;
  font-family: 'Space Grotesk', system-ui, sans-serif; color: #ece8f4;
  background: #07060b; border-left: 1px solid rgba(168,85,247,.18);
  box-shadow: -8px 0 40px rgba(0,0,0,.5);
  --wb-surface: #110f18; --wb-surface2: #1a1724; --wb-border: rgba(168,85,247,.18);
  --wb-purple: #a855f7; --wb-purple2: #c084fc; --wb-muted: #8b849c;
  --wb-green: #4ade80; --wb-red: #f87171; --wb-amber: #fbbf24;
}
.wb-panel-head {
  padding: 16px; border-bottom: 1px solid var(--wb-border);
  background: var(--wb-surface); display: flex; flex-direction: column; gap: 12px; flex-shrink: 0;
}
.wb-panel-head-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.wb-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.wb-logo {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  background: linear-gradient(135deg,#7c3aed,#a855f7 50%,#c084fc);
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 16px; color: #fff;
  box-shadow: 0 0 20px rgba(168,85,247,.45);
}
.wb-title {
  font-weight: 700; font-size: 16px; letter-spacing: -.02em;
  background: linear-gradient(90deg,#fff,#c084fc);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.wb-sub { font-size: 11px; color: var(--wb-muted); margin-top: 2px; line-height: 1.35; }
#wb-live-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #4b5563;
  display: inline-block; margin-right: 6px; vertical-align: middle;
}
#wb-live-dot.on { background: var(--wb-green); box-shadow: 0 0 10px rgba(74,222,128,.7); animation: wb-pulse 2s infinite; }
@keyframes wb-pulse { 0%,100%{opacity:1}50%{opacity:.5} }
.wb-head-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.wb-stat-badge {
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px;
  background: rgba(168,85,247,.12); border: 1px solid var(--wb-border); color: var(--wb-purple2);
}
.wb-user-pill {
  font-size: 11px; padding: 5px 12px; border-radius: 20px;
  background: var(--wb-surface2); border: 1px solid var(--wb-border); color: #c4b5d8;
  max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wb-icon-x {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--wb-border);
  background: var(--wb-surface2); color: var(--wb-muted); cursor: pointer;
}
.wb-icon-x:hover { color: #fff; border-color: rgba(168,85,247,.4); }

.wb-claim-box {
  display: flex; align-items: center; gap: 6px;
  background: var(--wb-surface2); border: 1px solid var(--wb-border);
  border-radius: 10px; padding: 4px 4px 4px 12px; width: 100%; box-sizing: border-box;
}
#manual-code-input-inline {
  flex: 1; min-width: 0; border: none; background: transparent; color: #fff;
  font: 600 13px 'JetBrains Mono', monospace; text-transform: uppercase; outline: none;
}
#manual-code-input-inline::placeholder { color: #5c5470; text-transform: none; font-weight: 500; }
.wb-btn { padding: 8px 14px; border-radius: 8px; border: none; font: 600 12px 'Space Grotesk', sans-serif; cursor: pointer; }
.wb-btn-primary { background: linear-gradient(135deg,#7c3aed,#a855f7); color: #fff; box-shadow: 0 4px 16px rgba(168,85,247,.35); }
.wb-btn-sm { padding: 6px 10px; font-size: 11px; }
#manual-claim-btn-inline {
  padding: 7px 14px; border: none; cursor: pointer; border-radius: 8px;
  background: linear-gradient(135deg,#7c3aed,#a855f7); color: #fff;
  font: 700 11px 'Space Grotesk', sans-serif; letter-spacing: .4px;
}

.wb-status-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wb-feed {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 8px; border-radius: 8px;
  background: rgba(255,255,255,.03); border: 1px solid rgba(192,132,252,.16);
  cursor: pointer; user-select: none; font-size: 9px; font-weight: 700;
}
.wb-feed-live { display: flex; align-items: center; gap: 5px; color: #d8b4fe; }
.wb-feed-ws { display: flex; align-items: center; gap: 4px; }
.wb-feed-label { color: rgba(255,255,255,.28); font-size: 8.5px; }
.wb-dot, .wb-dot-sm { border-radius: 50%; display: inline-block; }
.wb-dot { width: 7px; height: 7px; background: #c084fc; box-shadow: 0 0 10px rgba(192,132,252,.9); }
.wb-dot-sm { width: 5px; height: 5px; }
.wb-switch { width: 24px; height: 13px; border-radius: 3px; position: relative; background: rgba(255,255,255,.12); }
.wb-switch-knob {
  width: 9px; height: 9px; border-radius: 2px; background: #fff;
  position: absolute; top: 2px; left: 2px; box-shadow: 0 1px 3px rgba(0,0,0,.45);
}
#stake-reload-info, #stake-daily-bonus-info {
  padding: 4px 9px; border-radius: 8px; font-size: 10px; font-weight: 600;
  background: rgba(168,85,247,.08); border: 1px solid rgba(192,132,252,.2); color: rgba(255,255,255,.65);
}
.wb-tg-link {
  font-size: 10px; font-weight: 700; color: var(--wb-purple2); text-decoration: none;
  padding: 4px 8px; border-radius: 8px; border: 1px solid var(--wb-border);
}
.wb-tg-link:hover { background: rgba(168,85,247,.12); }

.wb-tabs {
  display: flex; gap: 4px; padding: 0 12px;
  border-bottom: 1px solid var(--wb-border); background: var(--wb-surface); flex-shrink: 0;
}
.history-tab, .wb-tab-btn {
  flex: 1; padding: 12px 6px; background: transparent; border: none;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  color: var(--wb-muted); font: 600 12px 'Space Grotesk', sans-serif; cursor: pointer;
}
.history-tab:hover { color: #d8cce8; }
.history-tab.active {
  color: var(--wb-purple2) !important;
  border-bottom-color: var(--wb-purple) !important;
  background: transparent !important; border-color: transparent !important;
  border-bottom: 2px solid var(--wb-purple) !important;
}
.wb-drawer-hint {
  padding: 10px 14px 0; font-size: 11px; color: var(--wb-muted);
  display: flex; justify-content: space-between; align-items: center;
}
.wb-drawer-hint a { color: var(--wb-purple2); text-decoration: none; }
.wb-link-btn {
  background: none; border: none; color: #f87171; font: 600 11px 'Space Grotesk', sans-serif; cursor: pointer;
}

.wb-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.wb-table th {
  padding: 10px 10px; text-align: left; color: rgba(216,180,254,.4);
  font-weight: 700; font-size: 9.5px; text-transform: uppercase; letter-spacing: .8px;
  border-bottom: 1px solid rgba(255,255,255,.05); background: rgba(255,255,255,.02);
  position: sticky; top: 0; z-index: 1;
}
.wb-split { display: flex; height: 100%; }
.wb-side { width: 200px; min-width: 180px; border-right: 1px solid rgba(255,255,255,.05); overflow-y: auto; padding: 12px; background: rgba(0,0,0,.2); }
.wb-side-main { flex: 1; overflow-y: auto; }

.wb-modal { position: fixed; inset: 0; z-index: 1000000; font-family: 'Space Grotesk', sans-serif; color: #efe7ff; }
.wb-overlay { position: absolute; inset: 0; background: rgba(6,2,14,.72); backdrop-filter: blur(4px); }
.wb-sheet {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 460px; max-width: 96vw; height: 560px; max-height: 88vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(155deg, #1b0f30 0%, #11081f 55%, #090412 100%);
  border: 1px solid rgba(192,132,252,.22); border-radius: 12px;
  box-shadow: 0 40px 80px rgba(0,0,0,.65);
}
.wb-sheet-sm { width: 460px; height: 560px; }
.wb-sheet-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.06);
}
.wb-sheet-title { display: flex; align-items: center; gap: 12px; }
.wb-rail { width: 3px; height: 28px; border-radius: 2px; background: linear-gradient(180deg,#7c3aed,#d946ef); }
.wb-h1 { font-size: 16px; font-weight: 800; color: #fff; }
.wb-h2 { font-size: 10px; color: rgba(232,201,255,.4); letter-spacing: .6px; text-transform: uppercase; margin-top: 2px; }
#settings-modal-close {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  color: rgba(255,255,255,.5); border-radius: 8px; cursor: pointer;
}
.wb-seg { display: flex; gap: 4px; padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.05); }
.settings-tab {
  flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: rgba(255,255,255,.35); font-size: 12px; font-weight: 600; cursor: pointer;
}
.settings-tab.active {
  background: linear-gradient(135deg, rgba(124,58,237,.25), rgba(168,85,247,.18)) !important;
  color: #e9d5ff !important; border-color: rgba(192,132,252,.35) !important;
}
.wb-settings-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
.wb-section-label {
  font-size: 10px; font-weight: 700; color: rgba(216,180,254,.4);
  text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 10px;
}
.wb-row {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 52px; padding: 0 14px; margin-bottom: 6px;
  background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.05); border-radius: 10px;
}
.wb-row-copy { display: flex; flex-direction: column; gap: 2px; }
.wb-row-copy b { font-size: 12px; color: rgba(255,255,255,.92); font-weight: 600; }
.wb-row-copy span { font-size: 10px; color: rgba(255,255,255,.32); }
.wb-toggle { cursor: pointer; width: 40px; height: 22px; border-radius: 6px; position: relative; }
.wb-toggle .toggle-slider {
  width: 18px; height: 18px; background: #fff; border-radius: 4px;
  position: absolute; top: 2px; left: 0; box-shadow: 0 1px 3px rgba(0,0,0,.35); transition: transform .2s;
}
.wb-select {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  background: rgba(255,255,255,.04); border: 1px solid rgba(192,132,252,.18);
  border-radius: 8px; cursor: pointer; color: rgba(255,255,255,.85); font-size: 12px; font-weight: 600; min-width: 78px;
}
.wb-menu {
  position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 1000002;
  background: #160b28; border: 1px solid rgba(192,132,252,.25); border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6); min-width: 150px; max-height: 260px; overflow-y: auto; padding: 4px;
}
.wb-note {
  margin-top: 10px; padding: 12px 14px; border-radius: 8px;
  background: rgba(168,85,247,.06); border: 1px solid rgba(192,132,252,.15);
  font-size: 10px; color: rgba(255,255,255,.4); line-height: 1.55;
}

.scc-pulse { animation: scc-pulse 2s ease-in-out infinite; }
@keyframes scc-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(.78)} }
.scc-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; font-size: 10px; font-weight: 700; }
.scc-badge-claimed { background: rgba(74,222,128,.12); color: #4ade80; border: 1px solid rgba(74,222,128,.28); }
.scc-badge-rejected { background: rgba(239,68,68,.1); color: #f87171; border: 1px solid rgba(239,68,68,.2); }
.scc-badge-pending { background: rgba(234,179,8,.1); color: #fbbf24; border: 1px solid rgba(234,179,8,.2); }
.scc-badge-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.scc-badge-claimed .scc-badge-dot { background: #4ade80; }
.scc-badge-rejected .scc-badge-dot { background: #f87171; }
.scc-badge-pending .scc-badge-dot { background: #fbbf24; animation: scc-pulse 1.8s ease-in-out infinite; }
.scc-tr { border-bottom: 1px solid rgba(255,255,255,.03); }
.scc-tr:hover { background: rgba(168,85,247,.05) !important; }
.scc-td { padding: 9px 8px; font-size: 11px; vertical-align: middle; }
.scc-td-first { padding-left: 12px; }
.scc-td-mono { font-family: 'JetBrains Mono', monospace; font-size: 10px; }
.scc-td-dim { color: rgba(255,255,255,.38); }
.scc-td-dimmer { color: rgba(255,255,255,.28); }
.scc-td-code {
  font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 11px; color: #f3e8ff;
  background: rgba(168,85,247,.1); border: 1px solid rgba(192,132,252,.2); border-radius: 4px; padding: 3px 8px;
}
.scc-td-green { color: #4ade80; font-weight: 700; }
.scc-td-reason { color: rgba(255,255,255,.28); max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.scc-toggle:hover { filter: brightness(1.12); }

#stake-panel *::-webkit-scrollbar, #settings-modal *::-webkit-scrollbar { width: 4px; }
#stake-panel *::-webkit-scrollbar-thumb, #settings-modal *::-webkit-scrollbar-thumb { background: rgba(192,132,252,.25); border-radius: 4px; }

@media (max-width: 700px) {
  .wb-drawer { width: 100vw; }
  .wb-side { display: none; }
}
</style>`;
    document.body.insertAdjacentHTML("beforeend", _0xhtml);
    document.documentElement.classList.remove("stake-header-active", "stake-header-hidden");
    document.getElementById("stake-panel-btn").onclick = _0x3b0c1c;
    document.getElementById("stake-panel-close").onclick = _0x3b0c1c;
    document.getElementById("stake-reset-btn").onclick = _0x5a71de;
    document.getElementById("stake-minimize-btn").onclick = _0x2d9803;
    document.getElementById("stake-show-btn").onclick = _0x2d9803;
    const _0x438b0f = document.getElementById("dashboard-telegram-toggle");
    if (_0x438b0f) {
      _0x438b0f.onclick = _0x44edc0;
    }
    const _0x1d29e1 = document.getElementById("drop-claim-toggle");
    if (_0x1d29e1) {
      _0x1d29e1.onclick = _0x4ec196;
    }
    const _0x1044d6 = document.getElementById("bonus-claim-toggle");
    if (_0x1044d6) {
      _0x1044d6.onclick = _0x548333;
    }
    const _0x3907ca = document.getElementById("bonus-vault-toggle");
    if (_0x3907ca) {
      _0x3907ca.onclick = _0x25789a;
    }
    const _0x47738e = document.getElementById("toast-notifications-toggle");
    if (_0x47738e) {
      _0x47738e.onclick = () => {
        _0xf1fa9f = !_0xf1fa9f;
        GM_setValue("toastNotificationsEnabled", _0xf1fa9f);
        _0x5dbd00("toast-notifications-toggle", _0xf1fa9f);
        _0x3865d4(_0xf1fa9f ? "Toasts activés" : "Toasts désactivés", _0xf1fa9f ? "success" : "info", 2000);
      };
    }
    const _0x32d3db = document.getElementById("sound-notifications-toggle");
    if (_0x32d3db) {
      _0x32d3db.onclick = () => {
        _0x393820 = !_0x393820;
        GM_setValue("soundNotificationsEnabled", _0x393820);
        _0x5dbd00("sound-notifications-toggle", _0x393820);
        _0x3865d4(_0x393820 ? "Son activé" : "Son désactivé", _0x393820 ? "success" : "info", 2000);
      };
    }
    const _0x24d56f = document.getElementById("notification-duration-btn");
    const _0x2bff22 = document.getElementById("notification-duration-dropdown");
    if (_0x24d56f && _0x2bff22) {
      _0x24d56f.onclick = _0x50eeda => {
        _0x50eeda.stopPropagation();
        const _0x29a26b = {
          auto: "Automatique",
          "2000": "2 secondes",
          "3000": "3 secondes",
          "5000": "5 secondes",
          "10000": "10 secondes"
        };
        if (_0x2bff22.style.display === "none") {
          _0x2bff22.innerHTML = Object.entries(_0x29a26b).map(([_0x181e42, _0x4c713d]) => "\n                        <div class=\"notif-duration-option\" data-value=\"" + _0x181e42 + "\" style=\"display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; transition: all 0.15s; border-radius: 8px; margin: 1px 0; " + (_0x181e42 === _0x38e0b7 ? "background: rgba(168,85,247,0.1);" : "") + "\">\n                            <div style=\"font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.85);\">" + _0x4c713d + "</div>\n                            " + (_0x181e42 === _0x38e0b7 ? "<svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M2 7L5.5 10.5L12 3.5\" stroke=\"#a855f7\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" : "") + "\n                        </div>\n                    ").join("");
          _0x2bff22.querySelectorAll(".notif-duration-option").forEach(_0x40ea9c => {
            _0x40ea9c.onmouseenter = () => _0x40ea9c.style.background = _0x40ea9c.dataset.value === _0x38e0b7 ? "rgba(168,85,247,0.13)" : "rgba(255,255,255,0.06)";
            _0x40ea9c.onmouseleave = () => _0x40ea9c.style.background = _0x40ea9c.dataset.value === _0x38e0b7 ? "rgba(168,85,247,0.1)" : "";
            _0x40ea9c.onclick = _0x59874f => {
              _0x59874f.stopPropagation();
              _0x38e0b7 = _0x40ea9c.dataset.value;
              GM_setValue("notificationDuration", _0x38e0b7);
              const _0x111000 = _0x29a26b[_0x38e0b7] || "Automatic";
              _0x24d56f.innerHTML = "<span>" + _0x111000 + "</span><svg width=\"10\" height=\"6\" viewBox=\"0 0 10 6\" fill=\"none\" style=\"opacity:0.4;\"><path d=\"M1 1L5 5L9 1\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
              _0x2bff22.style.display = "none";
              _0x3865d4("Durée toast : " + _0x111000, "info", 2000);
            };
          });
          _0x2bff22.style.display = "block";
        } else {
          _0x2bff22.style.display = "none";
        }
      };
    }
    const _0x757e96 = document.getElementById("auto-refresh-btn");
    const _0x4e3515 = document.getElementById("auto-refresh-dropdown");
    if (_0x757e96 && _0x4e3515) {
      _0x757e96.onclick = _0x291b68 => {
        _0x291b68.stopPropagation();
        const _0x33e88f = {
          off: "OFF",
          "1800000": "30 min",
          "3600000": "1 hr",
          "7200000": "2 hr",
          "21600000": "6 hr",
          "43200000": "12 hr",
          "86400000": "24 hr"
        };
        if (_0x4e3515.style.display === "none") {
          _0x4e3515.innerHTML = Object.entries(_0x33e88f).map(([_0x4b2f01, _0x3696dd]) => "\n                        <div class=\"auto-refresh-option\" data-value=\"" + _0x4b2f01 + "\" style=\"display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; transition: all 0.15s; border-radius: 8px; margin: 1px 0; " + (_0x4b2f01 === _0x5f6006 ? "background: rgba(168,85,247,0.1);" : "") + "\">\n                            <div style=\"font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.85);\">" + _0x3696dd + "</div>\n                            " + (_0x4b2f01 === _0x5f6006 ? "<svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M2 7L5.5 10.5L12 3.5\" stroke=\"#a855f7\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" : "") + "\n                        </div>\n                    ").join("");
          _0x4e3515.querySelectorAll(".auto-refresh-option").forEach(_0x1145a4 => {
            _0x1145a4.onmouseenter = () => _0x1145a4.style.background = _0x1145a4.dataset.value === _0x5f6006 ? "rgba(168,85,247,0.13)" : "rgba(255,255,255,0.06)";
            _0x1145a4.onmouseleave = () => _0x1145a4.style.background = _0x1145a4.dataset.value === _0x5f6006 ? "rgba(168,85,247,0.1)" : "";
            _0x1145a4.onclick = _0x548df6 => {
              _0x548df6.stopPropagation();
              _0x5f6006 = _0x1145a4.dataset.value;
              GM_setValue("autoPageRefresh", _0x5f6006);
              const _0x4d55b0 = _0x33e88f[_0x5f6006] || "OFF";
              _0x757e96.innerHTML = "<span>" + _0x4d55b0 + "</span><svg width=\"10\" height=\"6\" viewBox=\"0 0 10 6\" fill=\"none\" style=\"opacity:0.4;\"><path d=\"M1 1L5 5L9 1\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";
              _0x4e3515.style.display = "none";
              if (_0x48f0fd) {
                clearInterval(_0x48f0fd);
              }
              if (_0x5f6006 !== "off") {
                _0x48f0fd = setInterval(() => {
                  window.location.reload();
                }, parseInt(_0x5f6006));
              }
              _0x3865d4("Refresh auto : " + _0x4d55b0, "info", 2000);
            };
          });
          _0x4e3515.style.display = "block";
        } else {
          _0x4e3515.style.display = "none";
        }
      };
    }
    const _0x54f447 = document.getElementById("manual-claim-btn-inline");
    const _0x1fa2c1 = document.getElementById("manual-code-input-inline");
    if (_0x54f447) {
      _0x54f447.onclick = _0x246321;
    }
    if (_0x1fa2c1) {
      _0x1fa2c1.addEventListener("keypress", function (_0x3fc1e7) {
        if (_0x3fc1e7.key === "Enter") {
          _0x3fc1e7.preventDefault();
          _0x246321();
        }
      });
    }
    const _0x24b698 = ["codes", "reloads"].concat(_0x39ed19 ? ["daily"] : []);
    const _0x7655d5 = {
      codes: "block",
      reloads: "flex",
      daily: "block"
    };
    function _0x1783af(_0x17a141) {
      _0x24b698.forEach(_0x5e767d => {
        const _0xfed682 = document.getElementById("history-tab-" + _0x5e767d);
        const _0x555870 = document.getElementById("history-" + (_0x5e767d === "codes" ? "codes" : _0x5e767d === "reloads" ? "reloads" : "daily") + "-content");
        if (!_0xfed682) {
          return;
        }
        const _0x701910 = _0x5e767d === _0x17a141;
        _0xfed682.classList.toggle("active", _0x701910);
        _0xfed682.style.borderBottomColor = "";
        _0xfed682.style.color = "";
        if (_0x555870) {
          _0x555870.style.display = _0x701910 ? _0x7655d5[_0x5e767d] : "none";
        }
      });
      if (_0x17a141 === "reloads" || _0x17a141 === "daily") {
        _0x51d4fb();
      }
    }
    document.getElementById("history-tab-codes").onclick = () => _0x1783af("codes");
    document.getElementById("history-tab-reloads").onclick = () => _0x1783af("reloads");
    if (_0x39ed19) {
      const _0x45be8f = document.getElementById("history-tab-daily");
      if (_0x45be8f) {
        _0x45be8f.onclick = () => _0x1783af("daily");
      }
    }
    document.getElementById("stake-settings-btn").onclick = _0x1f023d;
    document.getElementById("settings-modal-close").onclick = () => {
      document.getElementById("settings-modal").style.display = "none";
    };
    document.querySelector(".settings-overlay").onclick = () => {
      document.getElementById("settings-modal").style.display = "none";
    };
    const _0xsetTabBtn = document.getElementById("wb-open-settings");
    if (_0xsetTabBtn) _0xsetTabBtn.onclick = _0x1f023d;
    const _0xburger = document.getElementById("stake-panel-btn");
    const _0xsyncBurger = () => {
      const p = document.getElementById("stake-panel");
      if (_0xburger && p) _0xburger.classList.toggle("open", p.style.display !== "none");
    };
    _0xsyncBurger();
    const _0x3df14a = document.getElementById("scc-live-ws");
    if (_0x3df14a) {
      _0x3df14a.onclick = () => {
        _0x266100 = !_0x266100;
        GM_setValue("autoWsReconnect", _0x266100);
        const _0x52ec59 = document.getElementById("ws-auto-toggle");
        if (_0x52ec59) {
          _0x52ec59.style.background = _0x266100 ? "#a855f7" : "rgba(255,255,255,0.12)";
          _0x52ec59.firstElementChild.style.left = _0x266100 ? "auto" : "2px";
          _0x52ec59.firstElementChild.style.right = _0x266100 ? "2px" : "auto";
        }
        if (window._wsWorker) {
          const _0x224674 = {
            type: "setAutoReconnect",
            enabled: _0x266100
          };
          window._wsWorker.postMessage(_0x224674);
        }
        if (_0x266100 && !_0x29badd && _0x52bbe3) {
          _0xcba344 = 0;
          _0xab7d88();
        }
        _0x3865d4("Reconnect auto : " + (_0x266100 ? "ON" : "OFF"), "info", 1500);
      };
    }
    document.querySelectorAll(".settings-tab").forEach(_0x1c72e6 => {
      _0x1c72e6.onclick = () => {
        document.querySelectorAll(".settings-tab").forEach(_0x572c76 => {
          _0x572c76.classList.remove("active");
          _0x572c76.style.background = "";
          _0x572c76.style.color = "";
          _0x572c76.style.borderColor = "";
        });
        _0x1c72e6.classList.add("active");
        _0x1c72e6.style.background = "";
        _0x1c72e6.style.color = "";
        _0x1c72e6.style.borderColor = "";
        document.querySelectorAll(".settings-tab-content").forEach(_0x1161a1 => _0x1161a1.style.display = "none");
        const _0x32df15 = document.getElementById("settings-tab-" + _0x1c72e6.dataset.tab);
        if (_0x32df15) {
          _0x32df15.style.display = "block";
        }
      };
    });
    const _0x38dd3c = document.getElementById("reload-auto-claim-toggle");
    if (_0x38dd3c) {
      _0x38dd3c.onclick = _0x1b7b7c;
    }
    const _0x354b75 = document.getElementById("reload-auto-vault-toggle");
    if (_0x354b75) {
      _0x354b75.onclick = _0x3820bd;
    }
    if (_0x39ed19) {
      const _0xb0682c = document.getElementById("daily-bonus-toggle");
      if (_0xb0682c) {
        _0xb0682c.onclick = _0x1ec317;
      }
    }
    const _0x374ae1 = document.getElementById("reload-currency-btn");
    const _0x447618 = document.getElementById("reload-currency-dropdown");
    if (_0x374ae1 && _0x447618) {
      _0x374ae1.onclick = _0xddc931 => {
        _0xddc931.stopPropagation();
        if (_0x447618.style.display === "none") {
          _0x447618.innerHTML = _0x217ef5.map(_0x545202 => "\n                        <div class=\"reload-currency-option\" data-code=\"" + _0x545202.code + "\" style=\"display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; transition: all 0.15s; border-radius: 8px; margin: 1px 0; " + (_0x545202.code === _0x5a3e62 ? "background: rgba(168,85,247,0.1);" : "") + "\">\n                            <div>\n                                <span style=\"font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.85);\">" + _0x545202.code + "</span>\n                                <span style=\"font-size: 10px; color: rgba(255,255,255,0.3); margin-left: 6px;\">" + _0x545202.name + "</span>\n                            </div>\n                            " + (_0x545202.code === _0x5a3e62 ? "<svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M2 7L5.5 10.5L12 3.5\" stroke=\"#a855f7\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" : "") + "\n                        </div>\n                    ").join("");
          _0x447618.querySelectorAll(".reload-currency-option").forEach(_0x46e3e6 => {
            _0x46e3e6.onmouseenter = () => _0x46e3e6.style.background = _0x46e3e6.dataset.code === _0x5a3e62 ? "rgba(168,85,247,0.13)" : "rgba(255,255,255,0.06)";
            _0x46e3e6.onmouseleave = () => _0x46e3e6.style.background = _0x46e3e6.dataset.code === _0x5a3e62 ? "rgba(168,85,247,0.1)" : "";
            _0x46e3e6.onclick = _0x2b56df => {
              _0x2b56df.stopPropagation();
              _0x2268db(_0x46e3e6.dataset.code);
            };
          });
          _0x447618.style.display = "block";
        } else {
          _0x447618.style.display = "none";
        }
      };
    }
    const _0x11bf69 = document.getElementById("settings-currency-btn");
    const _0x4198c8 = document.getElementById("settings-currency-dropdown");
    if (_0x11bf69 && _0x4198c8) {
      _0x11bf69.onclick = _0x458e8e => {
        _0x458e8e.stopPropagation();
        if (_0x4198c8.style.display === "none") {
          _0x4198c8.innerHTML = _0x217ef5.map(_0x1033f8 => "\n                        <div class=\"settings-currency-option\" data-code=\"" + _0x1033f8.code + "\" style=\"display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; transition: all 0.15s; border-radius: 8px; margin: 1px 0; " + (_0x1033f8.code === _0xb91545 ? "background: rgba(168,85,247,0.1);" : "") + "\">\n                            <div>\n                                <span style=\"font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.85);\">" + _0x1033f8.code + "</span>\n                                <span style=\"font-size: 10px; color: rgba(255,255,255,0.3); margin-left: 6px;\">" + _0x1033f8.name + "</span>\n                            </div>\n                            " + (_0x1033f8.code === _0xb91545 ? "<svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" fill=\"none\"><path d=\"M2 7L5.5 10.5L12 3.5\" stroke=\"#a855f7\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>" : "") + "\n                        </div>\n                    ").join("");
          _0x4198c8.querySelectorAll(".settings-currency-option").forEach(_0x39d2c2 => {
            _0x39d2c2.onmouseenter = () => _0x39d2c2.style.background = _0x39d2c2.dataset.code === _0xb91545 ? "rgba(168,85,247,0.13)" : "rgba(255,255,255,0.06)";
            _0x39d2c2.onmouseleave = () => _0x39d2c2.style.background = _0x39d2c2.dataset.code === _0xb91545 ? "rgba(168,85,247,0.1)" : "";
            _0x39d2c2.onclick = _0x4db67d => {
              _0x4db67d.stopPropagation();
              _0x287efd(_0x39d2c2.dataset.code);
            };
          });
          _0x4198c8.style.display = "block";
        } else {
          _0x4198c8.style.display = "none";
        }
      };
    }
    document.addEventListener("click", () => {
      const _0x377004 = document.getElementById("reload-currency-dropdown");
      if (_0x377004) {
        _0x377004.style.display = "none";
      }
      const _0x1afb3f = document.getElementById("settings-currency-dropdown");
      if (_0x1afb3f) {
        _0x1afb3f.style.display = "none";
      }
      const _0x2932a9 = document.getElementById("notification-duration-dropdown");
      if (_0x2932a9) {
        _0x2932a9.style.display = "none";
      }
      const _0x4743c6 = document.getElementById("auto-refresh-dropdown");
      if (_0x4743c6) {
        _0x4743c6.style.display = "none";
      }
    });
    if (_0x5f6006 !== "off") {
      _0x48f0fd = setInterval(() => {
        window.location.reload();
      }, parseInt(_0x5f6006));
    }
    _0x51d4fb();
  }
  async function _0x246321() {
    const _0x22fd52 = document.getElementById("manual-code-input-inline");
    const _0xa874b6 = document.getElementById("manual-claim-btn-inline");
    if (!_0x22fd52) {
      return;
    }
    const _0x34cb08 = _0x22fd52.value.trim();
    if (!_0x34cb08) {
      _0x22fd52.style.borderColor = "#ff4444";
      _0x22fd52.placeholder = "Entre un code !";
      setTimeout(() => {
        _0x22fd52.style.borderColor = "";
        _0x22fd52.placeholder = "Code";
      }, 2000);
      return;
    }
    _0x3865d4("<b>Claim en cours…</b><br>Code: " + _0x7b2981(_0x34cb08), "redeeming", 2000);
    if (_0xa874b6) {
      _0xa874b6.textContent = "Captcha…";
      _0xa874b6.style.opacity = "0.7";
    }
    if (!_0x167b9f.find(_0xa6abd2 => _0xa6abd2.code === _0x34cb08)) {
      _0x167b9f.unshift({
        code: _0x34cb08,
        timestamp: Date.now(),
        source: "manual",
        claimed: null,
        rejectionReason: null
      });
      _0x1fde84();
      _0x51d4fb();
    }
    if (_0x198002.length === 0) {
      _0x3865d4("Récupération captcha…", "info", 1500);
      await _0x5ca42d().catch(() => {});
    }
    if (_0xa874b6) {
      _0xa874b6.textContent = "Claim…";
    }
    _0x3865d4("<b>Envoi du claim…</b><br>Code: " + _0x7b2981(_0x34cb08), "redeeming", 1500);
    _0x197a3d(_0x34cb08);
    _0x22fd52.value = "";
    setTimeout(() => {
      if (_0xa874b6) {
        _0xa874b6.textContent = "Claim";
        _0xa874b6.style.opacity = "1";
      }
    }, 2000);
  }

  function _0x3b0c1c() {
    const _0x222283 = document.getElementById("stake-panel");
    const _0x2ba03f = document.getElementById("settings-modal");
    const _0xburger = document.getElementById("stake-panel-btn");
    if (!_0x222283) return;
    if (_0x222283.style.display === "none") {
      _0x222283.style.display = "flex";
      if (_0x2ba03f) _0x2ba03f.style.display = "none";
      if (_0xburger) _0xburger.classList.add("open");
      _0x51d4fb();
      _0xupdateStatBadge();
    } else {
      _0x222283.style.display = "none";
      if (_0xburger) _0xburger.classList.remove("open");
    }
  }
  function _0x1f023d() {
    const _0x2a57b8 = document.getElementById("settings-modal");
    const _0x9b7251 = document.getElementById("stake-panel");
    const _0xburger = document.getElementById("stake-panel-btn");
    if (_0x2a57b8.style.display === "none") {
      _0x2a57b8.style.display = "block";
      if (_0x9b7251) {
        _0x9b7251.style.display = "none";
      }
      if (_0xburger) _0xburger.classList.remove("open");
      _0x222439();
      _0x590018();
    } else {
      _0x2a57b8.style.display = "none";
    }
  }
  function _0x5ebe8e() {
    _0x1f023d();
  }
  function _0x2d9803() {
    const _0x34c819 = document.getElementById("stake-header");
    const _0x25f708 = document.getElementById("stake-show-btn");
    const _0x3be017 = document.getElementById("stake-panel");
    const _0x2ec102 = document.getElementById("settings-modal");
    const _0xburger = document.getElementById("stake-panel-btn");
    if (!_0x34c819) return;
    if (_0x34c819.style.display === "none") {
      _0x34c819.style.display = "block";
      if (_0x25f708) _0x25f708.style.display = "none";
      GM_setValue("headerVisible", true);
    } else {
      _0x34c819.style.display = "none";
      if (_0x25f708) _0x25f708.style.display = "flex";
      if (_0x3be017) _0x3be017.style.display = "none";
      if (_0x2ec102) _0x2ec102.style.display = "none";
      if (_0xburger) _0xburger.classList.remove("open");
      GM_setValue("headerVisible", false);
    }
  }
  function _0xupdateStatBadge() {
    const el = document.getElementById("wb-stat-badge");
    if (!el) return;
    const ok = _0x167b9f.filter(c => c.claimed).length;
    const total = _0x167b9f.length;
    let usd = 0;
    for (const c of _0x167b9f) {
      if (!c.claimed) continue;
      const n = parseFloat(String(c.value || c.amount || "").replace(/[^0-9.]/g, ""));
      if (!isNaN(n)) usd += n;
    }
    el.textContent = ok + "/" + total + " · $" + usd.toFixed(2);
  }
  function _0x51d4fb() {
    const _0x2bf7b6 = document.getElementById("stake-panel");
    if (_0x2bf7b6 && _0x2bf7b6.style.display === "none") {
      return;
    }
    const _0x163866 = document.getElementById("history-codes-tbody");
    if (_0x163866) {
      if (_0x167b9f.length === 0) {
        _0x163866.innerHTML = "<tr><td colspan=\"6\" style=\"text-align:center;padding:52px 20px;\">\n                    <div style=\"font-size:28px;margin-bottom:10px;opacity:0.25;\">📭</div>\n                    <div style=\"font-size:13px;font-weight:600;color:rgba(255,255,255,0.3);margin-bottom:4px;\">Aucun code</div>\n                    <div style=\"font-size:11px;color:rgba(255,255,255,0.18);\">Les codes apparaissent ici dès qu'un drop est détecté</div>\n                </td></tr>";
      } else {
        const _0x37a5d1 = _0x37d7c9 => {
          if (!_0x37d7c9 || _0x37d7c9 === "-") {
            return "-";
          }
          const _0x291995 = String(_0x37d7c9).replace(/[^0-9.]/g, "");
          const _0x1ffdf0 = parseFloat(_0x291995);
          if (isNaN(_0x1ffdf0)) {
            return _0x7b2981(_0x37d7c9);
          }
          const _0x1a4874 = String(_0x37d7c9).startsWith("$") ? "$" : "";
          return _0x1a4874 + _0x1ffdf0.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          });
        };
        _0x163866.innerHTML = _0x167b9f.slice(0, 50).map(_0x40bf5e => {
          let _0x1bb93c = "-";
          if (_0x40bf5e.timestamp) {
            const _0x33046e = new Date(_0x40bf5e.timestamp);
            const _0x355517 = _0x33046e.getMilliseconds().toString().padStart(3, "0");
            const _0xaa4fe2 = _0x33046e.toLocaleDateString("en-GB").replace(/\//g, "-");
            const _0x2a99ae = _0x33046e.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false
            }) + "." + _0x355517;
            _0x1bb93c = "<span style=\"color:rgba(255,255,255,0.25);font-size:9px;\">" + _0xaa4fe2 + "</span> " + _0x2a99ae;
          }
          let _0x65b5a0 = "-";
          if (_0x40bf5e.processedAt) {
            const _0x20bc83 = _0x40bf5e.claimStartedAt || _0x40bf5e.timestamp;
            if (_0x20bc83) {
              const _0x288f75 = new Date(_0x40bf5e.processedAt).getTime() - new Date(_0x20bc83).getTime();
              _0x65b5a0 = _0x288f75 >= 0 ? _0x288f75 + "ms" : "-";
            }
          }
          let _0x48b4d8;
          if (_0x40bf5e.claimed) {
            _0x48b4d8 = "<span class=\"scc-badge scc-badge-claimed\"><span class=\"scc-badge-dot\"></span>OK</span>";
          } else if (_0x40bf5e.rejectionReason) {
            _0x48b4d8 = "<span class=\"scc-badge scc-badge-rejected\"><span class=\"scc-badge-dot\"></span>Refusé</span>";
          } else {
            _0x48b4d8 = "<span class=\"scc-badge scc-badge-pending\"><span class=\"scc-badge-dot\"></span>En cours</span>";
          }
          const _0x59e2b5 = _0x7b2981(_0x40bf5e.rejectionReason || "-");
          const _0x4e74a4 = _0x37a5d1(_0x40bf5e.value || _0x40bf5e.amount || "-");
          const _0x2c5fdf = _0x7b2981(_0x40bf5e.code);
          return "<tr class=\"scc-tr\">\n                        <td class=\"scc-td scc-td-first scc-td-mono scc-td-dim\" style=\"white-space:nowrap;\">" + _0x1bb93c + "</td>\n                        <td class=\"scc-td scc-td-mono scc-td-dimmer\" style=\"white-space:nowrap;\">" + _0x65b5a0 + "</td>\n                        <td class=\"scc-td\"><span class=\"scc-td-code\">" + _0x2c5fdf + "</span></td>\n                        <td class=\"scc-td scc-td-green\">" + (_0x4e74a4 !== "-" ? "$" + _0x4e74a4.replace(/^\$/, "") : "-") + "</td>\n                        <td class=\"scc-td\">" + _0x48b4d8 + "</td>\n                        <td class=\"scc-td scc-td-reason\" title=\"" + _0x59e2b5 + "\">" + _0x59e2b5 + "</td>\n                    </tr>";
        }).join("");
      }
    }
    const _0x311401 = document.getElementById("reload-status-panel");
    if (_0x311401) {
      const _0x49f56b = _0x2fd4a6();
      const _0x5ecbae = _0x413128.filter(_0x4f2053 => _0x4f2053.status === "claimed");
      const _0x1b264d = _0x413128.filter(_0x3b3337 => _0x3b3337.status !== "claimed");
      const _0x55f5d7 = _0x5ecbae.length;
      const _0x1fc31f = _0x5ecbae.reduce((_0x54d48a, _0x53ddd7) => _0x54d48a + (parseFloat(_0x53ddd7.usd) || 0), 0);
      const _0x4a74d9 = _0x5ecbae.filter(_0x5dbd2a => new Date(_0x5dbd2a.time).toDateString() === new Date().toDateString());
      const _0x3bd02a = _0x4a74d9.reduce((_0x5a878e, _0x26b08d) => _0x5a878e + (parseFloat(_0x26b08d.usd) || 0), 0);
      const _0xa3506f = _0x413128.length > 0 ? Math.round(_0x55f5d7 / _0x413128.length * 100) : 0;
      const _0x4e8af1 = _0x55f5d7 > 0 ? _0x1fc31f / _0x55f5d7 : 0;
      const _0x34657f = _0x58dba1?.lastClaim ? new Date(_0x58dba1.lastClaim) : null;
      const _0x30e056 = _0x34657f ? _0x34657f.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      }) : "Never";
      const _0x5ea532 = _0xa3506f >= 90 ? "#a855f7" : _0xa3506f >= 70 ? "#fbbf24" : "#f87171";
      let _0x5884fb = "";
      if (!_0x58dba1 || !_0x58dba1.id) {
        _0x5884fb = "\n                    <div style=\"text-align: center; padding: 18px 8px 14px;\">\n                        <div style=\"width: 36px; height: 36px; margin: 0 auto 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;\">🔄</div>\n                        <div style=\"font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.5); margin-bottom: 4px;\">No Reload</div>\n                        <div style=\"font-size: 10px; color: rgba(255,255,255,0.25); line-height: 1.4;\">Enable auto-claim in<br>settings to check</div>\n                    </div>\n                ";
      } else if (_0x49f56b.isExpired) {
        const _0x581b95 = new Date(_0x49f56b.expiry);
        const _0x2ded15 = _0x581b95.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        });
        if (_0x1489d5) {
          _0x1489d5 = false;
          _0x94ab69("autoReloadEnabled", false);
          _0x26023f();
          _0x5dbd00("reload-auto-claim-toggle", false);
        }
        _0x5884fb = "\n                    <div style=\"text-align: center; padding: 14px 8px 12px;\">\n                        <div style=\"width: 36px; height: 36px; margin: 0 auto 10px; background: rgba(244,67,54,0.08); border: 1px solid rgba(244,67,54,0.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;\">⏰</div>\n                        <div style=\"font-size: 12px; font-weight: 700; color: #f44336; margin-bottom: 4px;\">Expired</div>\n                        <div style=\"font-size: 10px; color: rgba(255,255,255,0.35);\">" + _0x2ded15 + "</div>\n                        <div style=\"font-size: 9px; color: rgba(255,255,255,0.2); margin-top: 6px;\">Toggle auto-claim to refresh</div>\n                    </div>\n                ";
      } else {
        const _0x2bf2e2 = new Date(_0x49f56b.expiry);
        const _0xce31d = _0x2bf2e2.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        });
        const _0x485873 = _0x1489d5 ? "#a855f7" : "#ffc107";
        const _0x5312f1 = _0x1489d5 ? "Active" : "Paused";
        _0x5884fb = "\n                    <div style=\"text-align: center; padding: 10px 0 8px;\">\n                        <div style=\"display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; background: " + (_0x1489d5 ? "rgba(168,85,247,0.1)" : "rgba(255,193,7,0.1)") + "; border: 1px solid " + (_0x1489d5 ? "rgba(139,92,246,0.2)" : "rgba(255,193,7,0.2)") + "; margin-bottom: 10px;\">\n                            <span style=\"width: 5px; height: 5px; border-radius: 50%; background: " + _0x485873 + ";\" class=\"" + (_0x1489d5 ? "scc-pulse" : "") + "\"></span>\n                            <span style=\"font-size: 10px; font-weight: 600; color: " + _0x485873 + ";\">" + _0x5312f1 + "</span>\n                        </div>\n                    </div>\n                    <div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;\">\n                        <div style=\"background: rgba(139,92,246,0.06); border: 1px solid rgba(168,85,247,0.1); border-radius: 8px; padding: 10px 8px; text-align: center;\">\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;\">Per Claim</div>\n                            <div style=\"font-size: 17px; font-weight: 700; color: #a855f7;\">$" + _0x49f56b.claimValue.toFixed(2) + "</div>\n                        </div>\n                        <div style=\"background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 10px 8px; text-align: center;\">\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;\">Left</div>\n                            <div style=\"font-size: 17px; font-weight: 700; color: rgba(255,255,255,0.85);\">" + _0x49f56b.totalClaims + "</div>\n                        </div>\n                    </div>\n                    <div style=\"background: rgba(139,92,246,0.04); border: 1px solid rgba(168,85,247,0.1); border-radius: 8px; padding: 10px; text-align: center; margin-bottom: 6px;\">\n                        <div style=\"font-size: 8px; color: rgba(139,92,246,0.6); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;\">Potential</div>\n                        <div style=\"font-size: 20px; font-weight: 700; color: #a855f7;\">$" + _0x49f56b.totalValue.toFixed(2) + "</div>\n                    </div>\n                    <div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;\">\n                        <div style=\"background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 7px; padding: 8px 6px;\">\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px;\">Next Claim</div>\n                            <div id=\"reload-next-claim\" style=\"font-size: 12px; font-weight: 600; color: " + (_0x49f56b.isReady ? "#a855f7" : "rgba(255,255,255,0.8)") + ";\">" + (_0x49f56b.isReady ? "Ready!" : _0x3bb97b(_0x49f56b.nextClaim)) + "</div>\n                        </div>\n                        <div style=\"background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 7px; padding: 8px 6px;\">\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px;\">Every</div>\n                            <div style=\"font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.7);\">" + Math.floor(_0x49f56b.interval / 3600000) + "h " + Math.floor(_0x49f56b.interval % 3600000 / 60000) + "m</div>\n                        </div>\n                    </div>\n                    <div style=\"background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 7px; padding: 7px 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;\">\n                        <span style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px;\">Expires</span>\n                        <span style=\"font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.5);\">" + _0xce31d + "</span>\n                    </div>\n                    <div style=\"border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px;\">\n                        <div style=\"font-size: 8px; font-weight: 700; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;\">Earned</div>\n                        <div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;\">\n                            <div style=\"background: rgba(139,92,246,0.05); border: 1px solid rgba(168,85,247,0.1); border-radius: 7px; padding: 7px; text-align: center;\">\n                                <div style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;\">Total</div>\n                                <div style=\"font-size: 13px; font-weight: 700; color: #a855f7;\">$" + _0x1fc31f.toFixed(2) + "</div>\n                                <div style=\"font-size: 8px; color: rgba(255,255,255,0.2); margin-top: 1px;\">" + _0x55f5d7 + " claims</div>\n                            </div>\n                            <div style=\"background: rgba(139,92,246,0.05); border: 1px solid rgba(168,85,247,0.1); border-radius: 7px; padding: 7px; text-align: center;\">\n                                <div style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;\">Today</div>\n                                <div style=\"font-size: 13px; font-weight: 700; color: #a855f7;\">$" + _0x3bd02a.toFixed(2) + "</div>\n                                <div style=\"font-size: 8px; color: rgba(255,255,255,0.2); margin-top: 1px;\">" + _0x4a74d9.length + " claims</div>\n                            </div>\n                        </div>\n                        <div style=\"display: flex; gap: 5px;\">\n                            <div style=\"flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 5px; text-align: center;\">\n                                <div style=\"font-size: 7px; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px;\">Avg</div>\n                                <div style=\"font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6);\">$" + _0x4e8af1.toFixed(2) + "</div>\n                            </div>\n                            <div style=\"flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 5px; text-align: center;\">\n                                <div style=\"font-size: 7px; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px;\">Rate</div>\n                                <div style=\"font-size: 10px; font-weight: 600; color: " + _0x5ea532 + ";\">" + _0xa3506f + "%</div>\n                            </div>\n                            <div style=\"flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 5px; text-align: center;\">\n                                <div style=\"font-size: 7px; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px;\">Failed</div>\n                                <div style=\"font-size: 10px; font-weight: 600; color: " + (_0x1b264d.length > 0 ? "#f44336" : "rgba(255,255,255,0.4)") + ";\">" + _0x1b264d.length + "</div>\n                            </div>\n                        </div>\n                    </div>\n                ";
      }
      const _0x7e0846 = _0x58dba1 && _0x58dba1.id && !_0x49f56b.isExpired;
      _0x311401.innerHTML = "\n                " + _0x5884fb + "\n                " + (!_0x7e0846 && _0x413128.length > 0 ? "\n                <div style=\"margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05);\">\n                    <div style=\"font-size: 8px; font-weight: 700; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;\">Earnings</div>\n                    <div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;\">\n                        <div style=\"background: rgba(139,92,246,0.05); border: 1px solid rgba(168,85,247,0.1); border-radius: 7px; padding: 7px; text-align: center;\">\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;\">Total</div>\n                            <div style=\"font-size: 13px; font-weight: 700; color: #a855f7;\">$" + _0x1fc31f.toFixed(2) + "</div>\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.2); margin-top: 1px;\">" + _0x55f5d7 + " claims</div>\n                        </div>\n                        <div style=\"background: rgba(139,92,246,0.05); border: 1px solid rgba(168,85,247,0.1); border-radius: 7px; padding: 7px; text-align: center;\">\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.25); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 2px;\">Today</div>\n                            <div style=\"font-size: 13px; font-weight: 700; color: #a855f7;\">$" + _0x3bd02a.toFixed(2) + "</div>\n                            <div style=\"font-size: 8px; color: rgba(255,255,255,0.2); margin-top: 1px;\">" + _0x4a74d9.length + " claims</div>\n                        </div>\n                    </div>\n                    <div style=\"display: flex; gap: 5px;\">\n                        <div style=\"flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 5px; text-align: center;\">\n                            <div style=\"font-size: 7px; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px;\">Avg</div>\n                            <div style=\"font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.6);\">$" + _0x4e8af1.toFixed(2) + "</div>\n                        </div>\n                        <div style=\"flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 5px; text-align: center;\">\n                            <div style=\"font-size: 7px; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px;\">Rate</div>\n                            <div style=\"font-size: 10px; font-weight: 600; color: " + _0x5ea532 + ";\">" + _0xa3506f + "%</div>\n                        </div>\n                        <div style=\"flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 6px; padding: 5px; text-align: center;\">\n                            <div style=\"font-size: 7px; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 1px;\">Failed</div>\n                            <div style=\"font-size: 10px; font-weight: 600; color: " + (_0x1b264d.length > 0 ? "#f44336" : "rgba(255,255,255,0.4)") + ";\">" + _0x1b264d.length + "</div>\n                        </div>\n                    </div>\n                </div>\n                " : "") + "\n                <div style=\"margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05);\">\n                    <div style=\"font-size: 8px; font-weight: 700; color: rgba(255,255,255,0.2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;\">Controls</div>\n                    <div style=\"display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.03);\">\n                        <span style=\"color: rgba(255,255,255,0.45); font-size: 11px;\">Auto-Claim</span>\n                        <span id=\"reload-quick-status\" style=\"padding: 3px 12px; border-radius: 10px; font-size: 10px; font-weight: 700; background: " + (_0x1489d5 ? "#a855f7" : "rgba(255,255,255,0.08)") + "; color: " + (_0x1489d5 ? "#fff" : "rgba(255,255,255,0.4)") + "; cursor: pointer; transition: all 0.2s;\">" + (_0x1489d5 ? "ON" : "OFF") + "</span>\n                    </div>\n                    <div style=\"display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.03);\">\n                        <span style=\"color: rgba(255,255,255,0.45); font-size: 11px;\">Currency</span>\n                        <span style=\"padding: 3px 12px; border-radius: 10px; font-size: 10px; font-weight: 600; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6);\">" + _0x5a3e62 + "</span>\n                    </div>\n                    <div style=\"display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.03);\">\n                        <span style=\"color: rgba(255,255,255,0.45); font-size: 11px;\">Auto-Vault</span>\n                        <span id=\"reload-vault-quick-status\" style=\"padding: 3px 12px; border-radius: 10px; font-size: 10px; font-weight: 700; background: " + (_0x5716ea ? "#a855f7" : "rgba(255,255,255,0.08)") + "; color: " + (_0x5716ea ? "#fff" : "rgba(255,255,255,0.4)") + "; cursor: pointer; transition: all 0.2s;\">" + (_0x5716ea ? "ON" : "OFF") + "</span>\n                    </div>\n                    <div style=\"display: flex; justify-content: space-between; align-items: center; padding: 5px 0;\">\n                        <span style=\"color: rgba(255,255,255,0.45); font-size: 11px;\">Last Claim</span>\n                        <span style=\"font-size: 9px; font-weight: 500; color: rgba(255,255,255,0.35);\">" + _0x30e056 + "</span>\n                    </div>\n                </div>\n            ";
      const _0xe45c1b = document.getElementById("reload-quick-status");
      if (_0xe45c1b) {
        _0xe45c1b.onclick = _0x1b7b7c;
      }
      const _0x599e40 = document.getElementById("reload-vault-quick-status");
      if (_0x599e40) {
        _0x599e40.onclick = _0x3820bd;
      }
    }
    const _0x2f66b0 = document.getElementById("history-reloads-tbody");
    if (_0x2f66b0) {
      if (_0x413128.length === 0) {
        _0x2f66b0.innerHTML = "<tr><td colspan=\"5\" style=\"text-align: center; padding: 40px; opacity: 0.5; font-size: 11px;\">Aucun historique reload</td></tr>";
      } else {
        _0x2f66b0.innerHTML = _0x413128.map(_0x1ae25c => {
          const _0x2fdcc9 = new Date(_0x1ae25c.time);
          const _0x3f9e25 = _0x2fdcc9.getMilliseconds().toString().padStart(3, "0");
          const _0x3cebe2 = _0x2fdcc9.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
          }) + "." + _0x3f9e25;
          const _0x6f235d = _0x2fdcc9.toLocaleDateString("en-GB").replace(/\//g, "-");
          const _0x4a4c92 = _0x1ae25c.status === "claimed" ? "<span style=\"color: #a855f7; font-weight: 600;\">Claimed</span>" : "<span style=\"color: #f44336; font-weight: 600;\">Failed</span>";
          const _0x12d8b1 = _0x1ae25c.reason || "-";
          return "<tr style=\"border-bottom: 1px solid rgba(255,255,255,0.03);\" onmouseover=\"this.style.background='rgba(255,255,255,0.02)'\" onmouseout=\"this.style.background='transparent'\">\n                        <td style=\"padding: 8px 14px; color: rgba(255,255,255,0.4); font-size: 11px; font-family: 'SF Mono','Fira Code',monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\"><span style=\"color:rgba(255,255,255,0.25);font-size:9px;\">" + _0x6f235d + "</span> " + _0x3cebe2 + "</td>\n                        <td style=\"padding: 8px 10px; color: #a855f7; font-weight: 600; font-size: 11px; white-space: nowrap;\">$" + (_0x1ae25c.usd || "?") + "</td>\n                        <td style=\"padding: 8px 10px; color: rgba(255,255,255,0.6); font-size: 11px; font-weight: 600; white-space: nowrap;\">" + (_0x1ae25c.amount || "?") + " " + (_0x1ae25c.currency || "") + "</td>\n                        <td style=\"padding: 8px 10px; font-size: 11px; white-space: nowrap;\">" + _0x4a4c92 + "</td>\n                        <td style=\"padding: 8px 14px; color: rgba(255,255,255,0.3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\" title=\"" + _0x12d8b1 + "\">" + _0x12d8b1 + "</td>\n                    </tr>";
        }).join("");
      }
    }
    if (_0x39ed19) {
      const _0x345df7 = document.getElementById("history-daily-tbody");
      if (_0x345df7) {
        if (_0x316b10.length === 0) {
          _0x345df7.innerHTML = "<tr><td colspan=\"5\" style=\"text-align: center; padding: 40px; opacity: 0.5; font-size: 11px;\">No daily bonus history yet</td></tr>";
        } else {
          _0x345df7.innerHTML = _0x316b10.map(_0x35c45a => {
            const _0x5d06f6 = new Date(_0x35c45a.time);
            const _0x5d83cb = _0x5d06f6.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false
            });
            const _0x5c74b3 = _0x5d06f6.toLocaleDateString("en-GB").replace(/\//g, "-");
            const _0x3381c3 = _0x35c45a.status === "claimed" ? "<span style=\"color: #a855f7; font-weight: 600;\">Claimed</span>" : "<span style=\"color: #f44336; font-weight: 600;\">Failed</span>";
            const _0x57f6f6 = _0x7b2981(_0x35c45a.reason || "-");
            return "<tr style=\"border-bottom: 1px solid rgba(255,255,255,0.03);\" onmouseover=\"this.style.background='rgba(255,255,255,0.02)'\" onmouseout=\"this.style.background='transparent'\">\n                            <td style=\"padding: 8px 14px; color: rgba(255,255,255,0.4); font-size: 11px; font-family: 'SF Mono','Fira Code',monospace; white-space: nowrap;\"><span style=\"color:rgba(255,255,255,0.25);font-size:9px;\">" + _0x5c74b3 + "</span> " + _0x5d83cb + "</td>\n                            <td style=\"padding: 8px 10px; color: #a855f7; font-weight: 600; font-size: 11px; white-space: nowrap;\">" + (_0x35c45a.amount || "?") + "</td>\n                            <td style=\"padding: 8px 10px; color: rgba(255,255,255,0.6); font-size: 11px; font-weight: 600; white-space: nowrap;\">" + (_0x35c45a.currency || "") + "</td>\n                            <td style=\"padding: 8px 10px; font-size: 11px; white-space: nowrap;\">" + _0x3381c3 + "</td>\n                            <td style=\"padding: 8px 14px; color: rgba(255,255,255,0.3); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\" title=\"" + _0x57f6f6 + "\">" + _0x57f6f6 + "</td>\n                        </tr>";
          }).join("");
        }
      }
    }
  }
  function _0x5adf8d() {
    const _0x22e9db = document.getElementById("stake-header");
    const _0x4ad10a = document.getElementById("stake-show-btn");
    if (!_0x22e9db) {
      if (_0x4ad10a) {
        _0x4ad10a.remove();
      }
      _0x16668a();
      return;
    }
    const _0x3bd7fb = document.getElementById("stake-status");
    if (_0x3bd7fb) {
      if (_0x52bbe3 && _0x483d64) {
        const _0x5741ba = new Date(_0x483d64);
        _0x3bd7fb.style.cssText = "";
        _0x3bd7fb.textContent = (_0x2e4b70 || "Connecté") + " · prêt";
        const _0xdot = document.getElementById("wb-live-dot");
        if (_0xdot) _0xdot.classList.add("on");
      } else if (_0x52bbe3) {
        _0x3bd7fb.style.cssText = "";
        _0x3bd7fb.textContent = (_0x2e4b70 || "Connecté") + " · prêt";
        const _0xdot2 = document.getElementById("wb-live-dot");
        if (_0xdot2) _0xdot2.classList.add("on");
      } else {
        _0x3bd7fb.style.cssText = "";
        _0x3bd7fb.textContent = "Detection…";
        const _0xdot3 = document.getElementById("wb-live-dot");
        if (_0xdot3) _0xdot3.classList.remove("on");
      }
      _0xupdateStatBadge();
    }
    const _0x5e41e8 = document.getElementById("stake-username");
    if (_0x5e41e8) {
      _0x5e41e8.textContent = _0x2e4b70 || "…";
    }
    const _0x4ea865 = document.getElementById("stake-searching");
    if (_0x4ea865) {
      _0x4ea865.style.display = _0x52bbe3 ? "flex" : "none";
    }
    const _0x4d59cc = document.getElementById("scc-live-ws");
    if (_0x4d59cc) {
      _0x4d59cc.style.display = _0x52bbe3 ? "flex" : "none";
    }
    _0x415306();
    const _0x24a1ed = document.getElementById("stake-reload-info");
    if (_0x24a1ed) {
      if (_0x1489d5 && _0x58dba1 && _0x58dba1.id) {
        const _0xaa1649 = _0x2fd4a6();
        _0x24a1ed.style.background = "rgba(168,85,247,0.07)";
        _0x24a1ed.style.borderColor = "rgba(168,85,247,0.18)";
        _0x24a1ed.style.color = "rgba(255,255,255,0.65)";
        _0x24a1ed.innerHTML = "🔄 <span style=\"color:#a855f7;font-weight:700;\">On</span><span style=\"opacity:0.3;margin:0 2px;\">·</span>$" + (_0x58dba1.value || 0).toFixed(2) + "<span style=\"opacity:0.3;margin:0 2px;\">·</span>" + _0xaa1649.totalClaims + " left";
      } else {
        _0x24a1ed.style.background = "rgba(255,255,255,0.03)";
        _0x24a1ed.style.borderColor = "rgba(255,255,255,0.07)";
        _0x24a1ed.style.color = "rgba(255,255,255,0.25)";
        _0x24a1ed.innerHTML = "🔄 No reloads";
      }
    }
    if (_0x39ed19) {
      const _0x40fb9d = document.getElementById("stake-daily-bonus-info");
      if (_0x40fb9d) {
        if (!_0x1e2bb6) {
          _0x40fb9d.style.background = "rgba(255,255,255,0.03)";
          _0x40fb9d.style.borderColor = "rgba(255,255,255,0.07)";
          _0x40fb9d.style.color = "rgba(255,255,255,0.25)";
          _0x40fb9d.innerHTML = "💰 Daily";
        } else if (_0x39548e) {
          _0x40fb9d.style.background = "rgba(33,150,243,0.08)";
          _0x40fb9d.style.borderColor = "rgba(33,150,243,0.22)";
          _0x40fb9d.style.color = "#2196F3";
          _0x40fb9d.innerHTML = "💰 <span style=\"color:#2196F3;font-weight:700;\">Claiming…</span>";
        } else if (_0x18678e) {
          _0x40fb9d.style.background = "rgba(168,85,247,0.07)";
          _0x40fb9d.style.borderColor = "rgba(168,85,247,0.18)";
          _0x40fb9d.style.color = "rgba(255,255,255,0.65)";
          _0x40fb9d.innerHTML = "💰 <span style=\"color:#a855f7;font-weight:700;\">Ready!</span>";
        } else if (_0x1f89fb > Date.now()) {
          const _0x2fdb69 = _0x1f89fb - Date.now();
          const _0x14d2c1 = Math.floor(_0x2fdb69 / 3600000);
          const _0x479ca9 = Math.floor(_0x2fdb69 % 3600000 / 60000);
          _0x40fb9d.style.background = "rgba(168,85,247,0.04)";
          _0x40fb9d.style.borderColor = "rgba(168,85,247,0.1)";
          _0x40fb9d.style.color = "rgba(255,255,255,0.45)";
          _0x40fb9d.innerHTML = "💰 <span style=\"color:rgba(255,255,255,0.55);\">" + _0x14d2c1 + "h " + _0x479ca9 + "m</span>";
        } else {
          _0x40fb9d.style.background = "rgba(168,85,247,0.04)";
          _0x40fb9d.style.borderColor = "rgba(168,85,247,0.1)";
          _0x40fb9d.style.color = "rgba(255,255,255,0.4)";
          _0x40fb9d.innerHTML = "💰 <span style=\"color:#a855f7;font-weight:700;\">On</span>";
        }
      }
    }
  }
  function _0x2ff120(_0x3b03df) {
    const _0x52e528 = document.getElementById("stake-status");
    if (_0x52e528) {
      _0x52e528.textContent = _0x3b03df;
    }
  }
  let _0x3264de = {};
  let _0xa67165 = false;
  function _0x22afe9(_0x2f2807) {
    _0x1a48fd = false;
    _0x8029c5 = 0;
    if (!_0x2f2807) {
      queueMicrotask(_0x5eebe8);
      return;
    }
    const _0x4df94d = {
      t: _0x2f2807,
      ts: Date.now()
    };
    while (_0x19d2c8.length > 0) {
      const _0x33c68e = _0x19d2c8.shift();
      clearTimeout(_0x33c68e.timer);
      _0x33c68e.cb(_0x2f2807);
      queueMicrotask(_0x5eebe8);
      return;
    }
    _0x20a9bd();
    if (_0x198002.length < _0x4020a8) {
      _0x198002.push(_0x4df94d);
      _0xf9af80();
      if (_0x198002.length < _0x3b083f()) {
        queueMicrotask(_0x5eebe8);
        return;
      }
      const _0x3169c7 = Date.now() - _0x198002[0].ts;
      if (_0x3169c7 > _0x512752 && _0x198002.length < _0x4020a8) {
        queueMicrotask(_0x5eebe8);
      }
    }
  }
  function _0x5eebe8() {
    _0x20a9bd();
    if (_0x1a48fd && _0x8029c5 && Date.now() - _0x8029c5 > 12000) {
      _0x1a48fd = false;
      _0x8029c5 = 0;
    }
    if (!_0x3ab09f || _0x3454ba === null || _0x1a48fd) {
      if (!_0x3ab09f) {
        _0xa15c5c();
      }
      return;
    }
    const _0x5a370b = _0x198002.length < _0x3b083f();
    const _0x2a8c85 = _0x198002.length > 0 ? Date.now() - _0x198002[0].ts : Infinity;
    const _0x355049 = _0x2a8c85 > _0x512752 && _0x198002.length < _0x4020a8;
    if (!_0x5a370b && !_0x355049 && _0x19d2c8.length === 0) {
      return;
    }
    _0x1a48fd = true;
    _0x8029c5 = Date.now();
    try {
      _0x381be1.reset(_0x3454ba);
    } catch (_0x47b07a) {
      _0x1a48fd = false;
      _0x8029c5 = 0;
      setTimeout(_0x5eebe8, 2000);
    }
  }
  function _0x3c165d() {
    if (_0x3ab09f) {
      return;
    }
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", _0x3c165d, {
        once: true
      });
      return;
    }
    const _0x333211 = (typeof unsafeWindow !== "undefined" ? unsafeWindow.turnstile : null) || window.turnstile;
    if (!_0x333211?.render) {
      setTimeout(_0x3c165d, 100);
      return;
    }
    _0x381be1 = _0x333211;
    const _0x8ee782 = document.createElement("div");
    _0x8ee782.style.cssText = "position:fixed;bottom:-9999px;left:-9999px;visibility:hidden;pointer-events:none;z-index:-9999;";
    document.body.appendChild(_0x8ee782);
    _0x3454ba = _0x333211.render(_0x8ee782, {
      sitekey: "0x4AAAAAAAGD4gMGOTFnvupz",
      theme: "auto",
      size: "invisible",
      appearance: "interaction-only",
      retry: "auto",
      "refresh-expired": "auto",
      "refresh-timeout": "auto",
      callback: _0x22afe9,
      "expired-callback": () => {
        _0x1a48fd = false;
        _0x8029c5 = 0;
        queueMicrotask(_0x5eebe8);
      },
      "error-callback": () => {
        _0x1a48fd = false;
        _0x8029c5 = 0;
        setTimeout(_0x5eebe8, 2000);
      }
    });
    _0x3ab09f = true;
  }
  function _0xa15c5c() {
    if (_0x3ab09f) {
      _0x5eebe8();
      return;
    }
    const _0x2373f7 = (typeof unsafeWindow !== "undefined" ? unsafeWindow.turnstile : null) || window.turnstile;
    if (_0x2373f7?.render) {
      _0x3c165d();
      return;
    }
    if (!document.querySelector("script[src*=\"turnstile\"]")) {
      const _0xef9f0b = document.createElement("script");
      _0xef9f0b.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      _0xef9f0b.async = true;
      _0xef9f0b.onload = () => setTimeout(_0x3c165d, 50);
      (document.head || document.documentElement).appendChild(_0xef9f0b);
    } else {
      setTimeout(_0xa15c5c, 100);
    }
  }
  function _0x5727d1() {
    _0x20a9bd();
    _0x1a48fd = false;
    _0x8029c5 = 0;
    queueMicrotask(_0x5eebe8);
  }
  setInterval(() => {
    _0x20a9bd();
    if (_0x1a48fd && _0x8029c5 && Date.now() - _0x8029c5 > 12000) {
      _0x1a48fd = false;
      _0x8029c5 = 0;
    }
    const _0x28a90f = _0x198002.length > 0 ? Date.now() - _0x198002[0].ts : Infinity;
    if (_0x198002.length < _0x3b083f() || _0x19d2c8.length > 0 || _0x28a90f > _0x512752) {
      _0x1a48fd = false;
      _0x8029c5 = 0;
      queueMicrotask(_0x5eebe8);
    }
  }, 30000);
  const _0xb40a54 = 30000;
  function _0x3817cf() {
    const _0x28c295 = Date.now();
    let _0xbf60ae = false;
    _0x167b9f.forEach(_0xfb7474 => {
      const _0x464954 = _0x583afd[_0xfb7474.code];
      if (_0xfb7474.claimed == null && _0x464954 && _0x28c295 - _0x464954 > _0xb40a54) {
        _0xfb7474.claimed = false;
        _0xfb7474.rejectionReason = "Claim timed out";
        _0xfb7474.processedAt = _0x28c295;
        delete _0x389dfa[_0xfb7474.code];
        _0x3ff73e[_0xfb7474.code] = "rejected";
        _0xbf60ae = true;
      }
    });
    if (_0xbf60ae) {
      _0x1fde84();
      _0x51d4fb();
    }
  }
  setInterval(_0x3817cf, 15000);
  function _0x5c6cca() {
    _0x20a9bd();
    _0x1a48fd = false;
    _0x8029c5 = 0;
    if (_0x19d2c8.length > 0) {
      queueMicrotask(_0x5eebe8);
    }
    _0x3817cf();
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      _0x5c6cca();
    }
  });
  document.addEventListener("resume", _0x5c6cca);
  window.addEventListener("focus", _0x5c6cca);
  function _0x2edac7() {
    _0x20a9bd();
    const _0x1dd191 = _0x198002.shift() ?? null;
    if (_0x1dd191) {
      _0xf9af80();
      return _0x1dd191.t;
    }
    return null;
  }
  function _0x5ca42d() {
    const _0x159480 = _0x2edac7();
    if (_0x159480) {
      return Promise.resolve(_0x159480);
    }
    _0xa15c5c();
    return new Promise(_0x22a323 => {
      const _0x89fb85 = setTimeout(() => {
        const _0x4ac82e = _0x19d2c8.findIndex(_0x158042 => _0x158042.cb === _0x301bd5);
        if (_0x4ac82e >= 0) {
          _0x19d2c8.splice(_0x4ac82e, 1);
        }
        _0x22a323(null);
      }, _0x3e497b);
      const _0x301bd5 = _0x1eb737 => {
        clearTimeout(_0x89fb85);
        _0x22a323(_0x1eb737);
      };
      const _0x49e4a5 = {
        cb: _0x301bd5,
        timer: _0x89fb85
      };
      _0x19d2c8.push(_0x49e4a5);
      queueMicrotask(_0x5eebe8);
    });
  }
  function _0x32da29() {
    _0xa15c5c();
    queueMicrotask(_0x5eebe8);
    return _0x5ca42d();
  }
  function _0x14953d() {
    return _0x5ca42d();
  }
  function _0x4db41f() {
    return _0x5ca42d();
  }
  function _0x195688() {
    _0x20a9bd();
    return _0x198002[0]?.t ?? null;
  }
  const _0x330fbe = {
    method: "POST",
    headers: _0x6a6f22,
    credentials: "include",
    body: "",
    priority: "high"
  };
  const _0x33400e = _0x330fbe;
  function _0x5acaad(_0x315ac1, _0x33c56f = false) {
    if (!_0x33c56f && _0x583afd[_0x315ac1]) {
      return false;
    }
    let _0x1b3298 = _0x2edac7();
    if (!_0x1b3298) {
      if (!_0x33c56f) {
        _0x583afd[_0x315ac1] = Date.now();
        _0x5ca42d().then(_0x5b06f1 => {
          if (_0x5b06f1) {
            _0x5acaad(_0x315ac1, true);
          } else {
            _0x1dba99(_0x315ac1, false, "Turnstile unavailable");
          }
        });
      } else {
        _0x1dba99(_0x315ac1, false, "Turnstile unavailable");
      }
      return false;
    }
    _0x4de61f();
    if (!_0x49c655) {
      _0x583afd[_0x315ac1] = Date.now();
      _0x1dba99(_0x315ac1, false, "Not logged in to Stake");
      return false;
    }
    _0x583afd[_0x315ac1] = Date.now();
    const _0x31edb8 = _0x375432[String(_0x315ac1).toLowerCase()];
    const _0x2fd8d8 = _0x31edb8 === "bonus" ? true : _0x31edb8 === "drop" ? false : _0x2dc13a(_0x315ac1);
    let _0x5350f3;
    const _0x5be5c3 = performance.now();
    if (_0x2fd8d8) {
      const _0x2c96c2 = {
        "Content-Type": "application/json",
        "x-access-token": _0x49c655,
        "x-language": "en",
        "x-operation-name": "ClaimBonusCode",
        "x-operation-type": "query"
      };
      const _0x2a3bce = {
        code: _0x315ac1,
        currency: _0x59b274,
        turnstileToken: _0x1b3298
      };
      const _0x44f95a = {
        operationName: "ClaimBonusCode",
        variables: _0x2a3bce,
        query: _0x347f22
      };
      _0x5350f3 = fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0x2c96c2,
        credentials: "include",
        priority: "high",
        body: JSON.stringify(_0x44f95a)
      });
    } else {
      _0x33400e.body = _0x2e37f7 + _0x315ac1 + _0x336e50 + _0x59b274 + _0x5dcf68 + _0x1b3298 + _0x5bab6d;
      _0x5350f3 = fetch(_0x5ab6f7, _0x33400e);
    }
    _0x5350f3.then(_0x1f2b81 => _0x1f2b81.json()).then(_0x236de1 => {
      const _0x3cd9ed = performance.now() - _0x5be5c3;
      const _0x2eefdf = _0x2fd8d8 ? "claimBonusCode" : "claimConditionBonusCode";
      if (_0x236de1.data?.[_0x2eefdf]) {
        const _0x5e4596 = _0x236de1.data[_0x2eefdf];
        const _0x1a25fb = _0x167b9f.findIndex(_0x52f1e1 => _0x52f1e1.code === _0x315ac1);
        if (_0x1a25fb >= 0) {
          _0x167b9f[_0x1a25fb].amount = _0x5e4596.amount + " " + _0x5e4596.currency.toUpperCase();
        }
        _0x1dba99(_0x315ac1, true);
        _0x3865d4("<b>CLAIMED!</b> " + _0x7b2981(_0x5e4596.amount) + " " + _0x7b2981(_0x5e4596.currency.toUpperCase()) + " <span style=\"opacity:0.6;font-size:11px\">" + _0x3cd9ed.toFixed(0) + "ms</span>", "claimed", 4000);
        if (_0x231efb && _0x5e4596.amount && _0x5e4596.currency) {
          _0x447c64(_0x5e4596.amount, _0x5e4596.currency);
        }
      } else if (_0x236de1.errors) {
        const _0x2db6ef = _0x236de1.errors[0]?.errorType || "";
        const _0x5cf45b = _0x236de1.errors[0]?.message || "Unknown";
        const _0x4a0061 = _0x408cc3[_0x2db6ef] || _0x5cf45b;
        const _0x53fa69 = _0x2db6ef === "invalidTurnstile" || _0x5cf45b.toLowerCase().includes("captcha") || _0x5cf45b.toLowerCase().includes("turnstile");
        if (!_0x33c56f && _0x53fa69) {
          _0x5ca42d().then(_0x479b16 => {
            if (_0x479b16) {
              _0x5acaad(_0x315ac1, true);
            } else {
              _0x1dba99(_0x315ac1, false, _0x4a0061);
            }
          });
        } else {
          _0x1dba99(_0x315ac1, false, _0x4a0061);
        }
      } else {
        _0x1dba99(_0x315ac1, false, "Unexpected response");
      }
    }).catch(_0xc621d9 => _0x1dba99(_0x315ac1, false, _0xc621d9.message));
    queueMicrotask(() => {
      _0x5727d1();
      _0xf9af80();
    });
    return true;
  }
  function _0x2a5054(_0x4fd800) {
    if (_0x230f3e.includes(_0x4fd800)) {
      return;
    }
    _0x230f3e.push(_0x4fd800);
    _0x99e9a2();
  }
  async function _0x99e9a2() {
    if (_0x16864d || _0x230f3e.length === 0) {
      return;
    }
    _0x16864d = true;
    while (_0x230f3e.length > 0) {
      const _0x21d7d5 = _0x230f3e.shift();
      await _0x393e1a(_0x21d7d5);
      await new Promise(_0x15bf0e => setTimeout(_0x15bf0e, 100));
    }
    _0x16864d = false;
  }
  async function _0x393e1a(_0x333b77) {
    const _0x166834 = performance.now();
    if (_0x583afd[_0x333b77]) {
      return;
    }
    _0x583afd[_0x333b77] = Date.now();
    const _0x2c6256 = _0x42dcf3();
    if (!_0x2c6256) {
      return;
    }
    const _0x3b5fe7 = _0x2edac7() || (await _0x5ca42d());
    if (!_0x3b5fe7) {
      return;
    }
    const _0x4849dd = (_0xb91545 || "usdt").toLowerCase();
    const _0x77da29 = _0x375432[String(_0x333b77).toLowerCase()];
    const _0x47e1a7 = _0x77da29 === "bonus" ? true : _0x77da29 === "drop" ? false : _0x2dc13a(_0x333b77);
    const _0x3b0da0 = _0x47e1a7 ? "ClaimBonusCode" : "ClaimConditionBonusCode";
    const _0xab228c = _0x47e1a7 ? _0x347f22 : _0xfe1780;
    const _0x56ba48 = _0x47e1a7 ? "claimBonusCode" : "claimConditionBonusCode";
    const _0x45ea9e = _0x47e1a7 ? "query" : "mutation";
    try {
      const _0x26bf89 = {
        "Content-Type": "application/json",
        "x-access-token": _0x2c6256,
        "x-language": "en",
        "x-operation-name": _0x3b0da0,
        "x-operation-type": _0x45ea9e
      };
      const _0x2ec3d3 = {
        code: _0x333b77,
        currency: _0x4849dd,
        turnstileToken: _0x3b5fe7
      };
      const _0x26c51d = {
        operationName: _0x3b0da0,
        variables: _0x2ec3d3,
        query: _0xab228c
      };
      const _0x57d8e9 = await fetch(_0x5ab6f7, {
        method: "POST",
        headers: _0x26bf89,
        credentials: "include",
        body: JSON.stringify(_0x26c51d)
      });
      const _0x26f745 = await _0x57d8e9.json();
      if (_0x26f745.data?.[_0x56ba48]) {
        const _0x53c254 = _0x26f745.data[_0x56ba48];
        _0x1dba99(_0x333b77, true);
        if (_0x231efb && _0x53c254.amount && _0x53c254.currency) {
          _0x447c64(_0x53c254.amount, _0x53c254.currency);
        }
      } else if (_0x26f745.errors) {
        const _0x2ab9da = _0x26f745.errors[0]?.errorType || "";
        const _0xa9623d = _0x26f745.errors[0]?.message || "Unknown";
        const _0x30fc34 = _0x408cc3[_0x2ab9da] || _0xa9623d;
        _0x1dba99(_0x333b77, false, _0x30fc34);
      }
    } catch (_0x1883a9) {
      _0x1dba99(_0x333b77, false, _0x1883a9.message);
    } finally {
      queueMicrotask(() => {
        _0x5727d1();
        _0xf9af80();
      });
    }
  }
  function _0x54c6c4(_0xc985ca) {
    _0x2a5054(_0xc985ca);
  }
  async function _0x197a3d(_0x2ca569, _0x2f1836 = false) {
    if (!_0x2f1836) {
      delete _0x583afd[_0x2ca569];
      delete _0x3ff73e[_0x2ca569];
      delete _0x389dfa[_0x2ca569];
    }
    _0x583afd[_0x2ca569] = Date.now();
    _0x2ff120("⚡ Redeeming " + _0x2ca569 + "...");
    const _0x2b297f = _0x42dcf3();
    if (!_0x2b297f) {
      _0x2ff120("❌ Not logged into Stake");
      _0x1dba99(_0x2ca569, false, "Stake session token not found");
      return;
    }
    const _0x3f97ce = _0x2edac7() || (await _0x5ca42d());
    if (!_0x3f97ce) {
      _0x1dba99(_0x2ca569, false, "Turnstile unavailable");
      return;
    }
    const _0x31c376 = (_0xb91545 || "usdt").toLowerCase();
    const _0x58773a = _0x375432[String(_0x2ca569).toLowerCase()];
    const _0x168b65 = _0x58773a === "bonus" ? true : _0x58773a === "drop" ? false : _0x2dc13a(_0x2ca569);
    const _0x151e43 = _0x168b65 ? "ClaimBonusCode" : "ClaimConditionBonusCode";
    const _0x1d70cb = _0x168b65 ? _0x347f22 : _0xfe1780;
    const _0xf4a98a = _0x168b65 ? "query" : "mutation";
    const _0x12c3c3 = {
      "Content-Type": "application/json",
      "x-access-token": _0x2b297f,
      "x-language": "en",
      "x-operation-name": _0x151e43,
      "x-operation-type": _0xf4a98a
    };
    const _0x3417fd = {
      code: _0x2ca569,
      currency: _0x31c376,
      turnstileToken: _0x3f97ce || ""
    };
    const _0x506666 = {
      operationName: _0x151e43,
      variables: _0x3417fd,
      query: _0x1d70cb
    };
    fetch(_0x5ab6f7, {
      method: "POST",
      headers: _0x12c3c3,
      credentials: "include",
      body: JSON.stringify(_0x506666)
    }).then(_0x490a47 => {
      if (!_0x490a47.ok) {
        throw new Error("HTTP " + _0x490a47.status + ": " + _0x490a47.statusText);
      }
      return _0x490a47.json();
    }).then(_0x41ebe6 => {
      if (_0x41ebe6.errors) {
        const _0x5d625f = _0x41ebe6.errors[0]?.errorType || "";
        const _0x3f5618 = _0x41ebe6.errors[0]?.message || "Unknown error";
        const _0x268323 = _0x408cc3[_0x5d625f] || _0x3f5618;
        const _0x7ef71 = _0x5d625f === "invalidTurnstile" || _0x3f5618.toLowerCase().includes("turnstile") || _0x3f5618.toLowerCase().includes("captcha");
        if (!_0x2f1836 && _0x7ef71) {
          _0x5ca42d().then(_0x408f3a => {
            if (_0x408f3a) {
              _0x197a3d(_0x2ca569, true);
            } else {
              _0x1dba99(_0x2ca569, false, _0x268323);
              queueMicrotask(() => {
                _0x5727d1();
                _0xf9af80();
              });
            }
          });
          return;
        }
        _0x2ff120("❌ Rejected: " + _0x2ca569);
        _0x1dba99(_0x2ca569, false, _0x268323);
      } else if (_0x41ebe6.data?.claimConditionBonusCode || _0x41ebe6.data?.claimBonusCode) {
        const _0x375899 = _0x41ebe6.data.claimConditionBonusCode || _0x41ebe6.data.claimBonusCode;
        const _0x3e9281 = _0x375899.amount && _0x375899.currency ? _0x375899.amount + " " + _0x375899.currency.toUpperCase() : "Unknown";
        _0x2ff120("✅ Claimed: " + _0x2ca569 + " - " + _0x3e9281);
        const _0x2f4bca = _0x167b9f.findIndex(_0x29a849 => _0x29a849.code === _0x2ca569);
        if (_0x2f4bca >= 0) {
          _0x167b9f[_0x2f4bca].amount = _0x3e9281;
        }
        _0x1dba99(_0x2ca569, true, null);
        if (_0x231efb && _0x375899.amount && _0x375899.currency) {
          _0x447c64(_0x375899.amount, _0x375899.currency);
        }
      } else {
        _0x2ff120("❌ Failed: " + _0x2ca569);
        _0x1dba99(_0x2ca569, false, "Unexpected response");
      }
    }).catch(_0x3cc561 => {
      _0x2ff120("❌ Network error");
      _0x1dba99(_0x2ca569, false, "Network error: " + _0x3cc561.message);
    }).finally(() => {
      queueMicrotask(() => {
        _0x5727d1();
        _0xf9af80();
      });
    });
  }
  let _0x3052d3 = null;
  let _0x73ec5a = false;
  window.testDiceWithApiKey = async function (_0x498263) {
    const _0x433e7f = _0x42dcf3();
    const _0x3dbcf4 = {
      name: "Session token (normal)",
      token: _0x433e7f
    };
    const _0xb30e30 = {
      name: "API key as token",
      token: _0x498263
    };
    const _0x1daf51 = [_0x3dbcf4, _0xb30e30];
    for (const _0x56091f of _0x1daf51) {
      if (!_0x56091f.token) {
        continue;
      }
      try {
        const _0x467b1b = {
          accept: "*/*",
          "content-type": "application/json",
          "x-access-token": _0x56091f.token
        };
        const _0x4b2330 = await fetch(window.location.origin + "/_api/casino/dice/roll", {
          method: "POST",
          headers: _0x467b1b,
          credentials: "include",
          body: JSON.stringify({
            target: 50.5,
            condition: "above",
            identifier: "test-" + Date.now(),
            amount: 0.00001,
            currency: "usdt"
          })
        });
        const _0x10122d = await _0x4b2330.json();
        if (_0x10122d.errors) {} else if (_0x10122d.result || _0x10122d.state) {} else {}
      } catch (_0x161306) {}
    }
  };
  function _0x26046c() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _0x3f45fe);
    } else {
      _0x3f45fe();
    }
  }
  function _0x3f45fe() {
    setTimeout(() => {
      _0x16668a();
      setTimeout(() => {
        _0xd52aff();
      }, 2000);
      let _0x5d851d = setInterval(() => {
        if (_0x52bbe3) {
          clearInterval(_0x5d851d);
          _0x5d851d = null;
          return;
        }
        _0xd52aff();
      }, 5000);
      _0xa15c5c();
      setTimeout(() => {
        try {
          _0x4aed91(true).catch(_0x3f2da2 => {});
        } catch (_0xfc81f3) {}
      }, 4000);
      let _0x1975a7 = 0;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          _0x1975a7 = Date.now();
        } else {
          const _0x272dc8 = Date.now() - _0x1975a7;
          if (_0x52bbe3) {
            _0x412573();
            if (_0x272dc8 > 2000) {
              _0x20a9bd();
              if (_0x198002.length < _0x3b083f()) {
                _0x1a48fd = false;
                queueMicrotask(_0x5eebe8);
              }
            }
            if (!_0x29badd && !_0x50aed2) {
              _0xcba344 = 0;
              _0xab7d88();
            }
          } else {
            _0x5539a0 = 0;
            _0x144b66 = false;
            _0xd52aff();
          }
        }
      });
      (function _0x2d50a4() {
        if (navigator.locks) {
          navigator.locks.request("stake_claimer_alive", {
            mode: "exclusive"
          }, () => {
            return new Promise(() => {});
          });
        }
        try {
          const _0x252132 = new (window.AudioContext || window.webkitAudioContext)();
          const _0x56b12e = _0x252132.createOscillator();
          const _0xc4c217 = _0x252132.createGain();
          _0xc4c217.gain.value = 0.00001;
          _0x56b12e.connect(_0xc4c217);
          _0xc4c217.connect(_0x252132.destination);
          _0x56b12e.start();
          const _0x90693c = () => {
            if (_0x252132.state === "suspended") {
              _0x252132.resume();
            }
          };
          document.addEventListener("click", _0x90693c, {
            once: true
          });
          document.addEventListener("keydown", _0x90693c, {
            once: true
          });
        } catch (_0x2b5a51) {}
        try {
          const _0x307d0a = new Blob(["setInterval(()=>postMessage(1),1000)"], {
            type: "application/javascript"
          });
          const _0x435666 = new Worker(URL.createObjectURL(_0x307d0a));
          _0x435666.onmessage = () => {};
        } catch (_0x2b9662) {}
      })();
      try {
        const _0x300faf = "\n                    let ws = null;\n                    let wsUrl = null;\n                    let authToken = null;\n                    let username = null;\n                    let heartbeatInterval = null;\n                    let reloadTimerId = null;\n                    let pollingTimerId = null;\n                    let tokenRefreshTimerId = null;\n                    let reconnectAttempts = 0;\n                    let shouldReconnect = true;\n                    let autoReconnect = true;\n                    \n                    function connect() {\n                        if (!wsUrl || !authToken) return;\n                        if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;\n                        \n                        postMessage({ type: 'status', status: 'connecting' });\n                        \n                        try {\n                            ws = new WebSocket(wsUrl);\n                            \n                            ws.onopen = () => {\n                                postMessage({ type: 'status', status: 'connected' });\n                                reconnectAttempts = 0;\n                                ws.send(JSON.stringify({ type: 'auth', token: authToken }));\n                            };\n                            \n                            ws.onmessage = (e) => {\n                                try {\n                                    const msg = JSON.parse(e.data);\n                                    if ((msg.type === 'auth_error' && (msg.reason === 'subscription_expired' || msg.reason === 'already_connected')) || msg.type === 'subscription_expired') {\n                                        shouldReconnect = false;\n                                    }\n                                    postMessage({ type: 'message', data: msg });\n                                } catch (err) {}\n                            };\n                            \n                            ws.onclose = () => {\n                                postMessage({ type: 'status', status: 'disconnected' });\n                                stopHeartbeat();\n                                if (shouldReconnect && autoReconnect) {\n                                    reconnectAttempts++;\n                                    const delay = Math.min(200 * Math.pow(1.5, reconnectAttempts), 10000);\n                                    setTimeout(connect, delay);\n                                }\n                            };\n                            \n                            ws.onerror = () => {\n                                postMessage({ type: 'status', status: 'error' });\n                            };\n                        } catch (e) {\n                            setTimeout(connect, 1000);\n                        }\n                    }\n                    \n                    function startHeartbeat() {\n                        stopHeartbeat();\n                        heartbeatInterval = setInterval(() => {\n                            if (ws && ws.readyState === 1) {\n                                ws.send(JSON.stringify({ type: 'ping', username: username }));\n                            }\n                        }, 5000); // 5s heartbeat - worker not throttled!\n                    }\n                    \n                    function stopHeartbeat() {\n                        if (heartbeatInterval) {\n                            clearInterval(heartbeatInterval);\n                            heartbeatInterval = null;\n                        }\n                    }\n                    \n                    self.onmessage = (e) => {\n                        const msg = e.data;\n                        switch (msg.type) {\n                            case 'connect':\n                                wsUrl = msg.wsUrl;\n                                authToken = msg.token;\n                                username = msg.username;\n                                shouldReconnect = true;\n                                reconnectAttempts = 0;\n                                connect();\n                                break;\n                            case 'disconnect':\n                                shouldReconnect = false;\n                                stopHeartbeat();\n                                if (ws) ws.close();\n                                break;\n                            case 'updateToken':\n                                authToken = msg.token;\n                                break;\n                            case 'startHeartbeat':\n                                startHeartbeat();\n                                break;\n                            case 'setAutoReconnect':\n                                autoReconnect = msg.enabled;\n                                break;\n                            case 'scheduleReload':\n                                if (reloadTimerId) clearTimeout(reloadTimerId);\n                                reloadTimerId = setTimeout(() => {\n                                    reloadTimerId = null;\n                                    postMessage({ type: 'reloadNow' });\n                                }, msg.delay);\n                                break;\n                            case 'cancelReload':\n                                if (reloadTimerId) { clearTimeout(reloadTimerId); reloadTimerId = null; }\n                                break;\n                            case 'startPolling':\n                                if (pollingTimerId) clearInterval(pollingTimerId);\n                                postMessage({ type: 'pollNow' });\n                                pollingTimerId = setInterval(() => {\n                                    postMessage({ type: 'pollNow' });\n                                }, msg.interval || 1000);\n                                break;\n                            case 'stopPolling':\n                                if (pollingTimerId) { clearInterval(pollingTimerId); pollingTimerId = null; }\n                                break;\n                            case 'scheduleTokenRefresh':\n                                if (tokenRefreshTimerId) clearTimeout(tokenRefreshTimerId);\n                                tokenRefreshTimerId = setTimeout(() => {\n                                    tokenRefreshTimerId = null;\n                                    postMessage({ type: 'refreshToken' });\n                                }, msg.delay || 120000);\n                                break;\n                            case 'cancelTokenRefresh':\n                                if (tokenRefreshTimerId) { clearTimeout(tokenRefreshTimerId); tokenRefreshTimerId = null; }\n                                break;\n                        }\n                    };\n                    \n                    let tick = 0;\n                    setInterval(() => {\n                        tick += 60;\n                        postMessage({ type: 'keepalive', seconds: tick });\n                    }, 60000);\n                ";
        const _0x122f7a = new Blob([_0x300faf], {
          type: "application/javascript"
        });
        const _0xbb67ec = URL.createObjectURL(_0x122f7a);
        window._wsWorker = new Worker(_0xbb67ec);
        window._wsWorker.onmessage = _0x1329c6 => {
          const _0x2a52ff = _0x1329c6.data;
          switch (_0x2a52ff.type) {
            case "status":
              if (_0x2a52ff.status === "connected") {} else if (_0x2a52ff.status === "connecting") {
                _0x50aed2 = true;
                _0x415306();
              } else if (_0x2a52ff.status === "disconnected") {
                _0x29badd = false;
                _0x50aed2 = false;
                _0x415306();
                if (_0x52bbe3) {
                  _0x41dd1e();
                }
              } else if (_0x2a52ff.status === "error") {
                _0x50aed2 = false;
                _0x415306();
              }
              break;
            case "message":
              if (_0x2a52ff.data.type === "new_code" && _0x2a52ff.data.code) {
                const _0x375d85 = _0x2a52ff.data.code.code;
                if (_0x375d85 && _0x25bd25(_0x375d85) && !_0x583afd[_0x375d85]) {
                  _0x5acaad(_0x375d85);
                }
                if (_0x2a52ff.data.code.timestamp > _0x414fba) {
                  _0x414fba = _0x2a52ff.data.code.timestamp;
                }
                queueMicrotask(() => _0x252d80([_0x2a52ff.data.code], true));
              } else {
                _0x3f7ed0(_0x2a52ff.data);
              }
              break;
            case "reloadNow":
              if (_0x1489d5) {
                _0x5f10fd();
              }
              break;
            case "pollNow":
              _0x412573();
              break;
            case "refreshToken":
              _0x32da29().then(() => {
                if (window._wsWorker) {
                  window._wsWorker.postMessage({
                    type: "scheduleTokenRefresh",
                    delay: 120000
                  });
                }
              });
              break;
            case "keepalive":
              break;
          }
        };
        window._originalConnectWebSocket = _0xab7d88;
        _0xab7d88 = function () {
          if (!_0x52bbe3 || !_0x3cf78c) {
            return;
          }
          const _0x47311c = _0x142ed3();
          _0x50aed2 = true;
          _0x415306();
          const _0x2a5299 = {
            type: "connect",
            wsUrl: _0x47311c,
            token: _0x3cf78c,
            username: _0x2e4b70
          };
          window._wsWorker.postMessage(_0x2a5299);
        };
        window._originalDisconnectWebSocket = _0x406d6b;
        _0x406d6b = function () {
          window._wsWorker.postMessage({
            type: "disconnect"
          });
          _0x29badd = false;
          _0x50aed2 = false;
          _0x415306();
        };
        window._originalStartWsHeartbeat = _0x5cc1a7;
        _0x5cc1a7 = function () {
          window._wsWorker.postMessage({
            type: "startHeartbeat"
          });
        };
        window._originalStopWsHeartbeat = _0x428a76;
        _0x428a76 = function () {};
        const _0x5bbe95 = {
          type: "setAutoReconnect",
          enabled: _0x266100
        };
        window._wsWorker.postMessage(_0x5bbe95);
        const _0xdbef50 = _0x544d28;
        _0x544d28 = function () {
          if (!_0x1489d5 || !_0x58dba1 || !_0x58dba1.id) {
            return;
          }
          const _0x216027 = Date.now();
          const _0x1f22ad = new Date(_0x58dba1.expireAt).getTime();
          if (_0x216027 >= _0x1f22ad) {
            _0x4aa3de("Reload expired");
            return;
          }
          const _0x6d803 = new Date(_0x58dba1.lastClaim).getTime();
          const _0x1bfe57 = _0x58dba1.claimInterval;
          const _0xa0f563 = _0x216027 - _0x6d803;
          if (_0xa0f563 >= _0x1bfe57) {
            _0x5f10fd();
          } else {
            const _0x361ddf = _0x6d803 + _0x1bfe57 - _0x216027;
            const _0x12d726 = Math.min(_0x361ddf, 2147483647);
            try {
              if (_0x58c2aa) {
                clearTimeout(_0x58c2aa);
                _0x58c2aa = null;
              }
              const _0x2afa37 = {
                type: "scheduleReload",
                delay: _0x12d726
              };
              window._wsWorker.postMessage(_0x2afa37);
            } catch (_0x232c48) {
              _0xdbef50();
            }
          }
        };
        const _0x32d7b2 = _0x26023f;
        _0x26023f = function () {
          if (_0x58c2aa) {
            clearTimeout(_0x58c2aa);
            _0x58c2aa = null;
          }
          try {
            window._wsWorker.postMessage({
              type: "cancelReload"
            });
          } catch (_0x20eba4) {}
          _0x1b4c97();
        };
        const _0x5662fd = _0x41dd1e;
        const _0xfd5f61 = _0x5c87b4;
        _0x41dd1e = function () {
          if (_0x29badd) {
            return;
          }
          try {
            window._wsWorker.postMessage({
              type: "startPolling",
              interval: 1000
            });
          } catch (_0x55d8fc) {
            _0x5662fd();
          }
        };
        _0x5c87b4 = function () {
          if (_0x303345) {
            clearInterval(_0x303345);
            _0x303345 = null;
          }
          try {
            window._wsWorker.postMessage({
              type: "stopPolling"
            });
          } catch (_0x5bb004) {}
        };
        window._wsWorker.postMessage({
          type: "scheduleTokenRefresh",
          delay: 120000
        });
      } catch (_0x1ca54b) {}
    }, 100);
  }
  _0x26046c();
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

          const ORIGINALS_API = "https://originals-instant-api.thrill-games.com";
          const KENO_NUMBERS = 40;
          const KENO_RISK_PROFILES = ["Classic", "Low", "Medium", "High"];
          const DICE_HOUSE_EDGE = 1; // RTP 99%
          const ORIGINALS_GAMES = {
            keno: { product: "thrill-keno", slug: "thrill-keno" },
            dice: { product: "thrill-dice", slug: "thrill-dice" },
            limbo: { product: "thrill-limbo", slug: "thrill-limbo" }
          };

          const state = {
            bearerToken: null,
            userId: null,
            playerToken: null,
            playerTokens: {},
            browserSession: null,
            exchangeRate: null,
            exchangeRateAt: 0,
            exchangeRateCurrency: null,
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
            activeOriginal: "keno",
            keno: {
              spots: [],
              playing: false,
              autoRunning: false,
              history: [],
              lastResult: null,
            },
            dice: {
              playing: false,
              autoRunning: false,
              history: [],
              lastResult: null,
            },
            limbo: {
              playing: false,
              autoRunning: false,
              history: [],
              lastResult: null,
            },
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
            kenoStake: parseFloat(storage.get("thr_keno_stake", "0.1")) || 0.1,
            kenoRisk: storage.get("thr_keno_risk", "Classic"),
            kenoSpots: storage.getJSON("thr_keno_spots", [10, 11, 18, 19]),
            kenoAutoCount: parseInt(storage.get("thr_keno_auto_count", "10"), 10) || 10,
            kenoAutoDelayMs: Math.max(0, parseInt(storage.get("thr_keno_auto_delay", "0"), 10) || 0),
            kenoPlayoutMs: Math.max(0, parseInt(storage.get("thr_keno_playout", "0"), 10) || 0),
            kenoSpeed: storage.get("thr_keno_speed", "instant"),
            kenoHistory: storage.getJSON("thr_keno_history", []),
            kenoCurrency: storage.get("thr_keno_currency", "") || "",
            diceMode: storage.get("thr_dice_mode", "Under") || "Under",
            diceTarget: parseFloat(storage.get("thr_dice_target", "97.99")) || 97.99,
            diceMult: parseFloat(storage.get("thr_dice_mult", "1.0102")) || 1.0102,
            diceHistory: storage.getJSON("thr_dice_history", []),
            limboMult: parseFloat(storage.get("thr_limbo_mult", "2")) || 2,
            limboHistory: storage.getJSON("thr_limbo_history", []),
            activeOriginal: storage.get("thr_active_original", "keno") || "keno",
            playerToken: storage.get("thr_player_token", "") || "",
            playerTokens: storage.getJSON("thr_player_tokens", {}) || {},
            browserSession: storage.get("thr_browser_session", "") || "",
            exchangeRate: parseFloat(storage.get("thr_fx_rate", "0")) || 0,
          };

          state.activeOriginal = ["dice", "limbo"].includes(config.activeOriginal) ? config.activeOriginal : "keno";
          {
            const fromUrl = detectOriginalFromLocation();
            if (fromUrl) state.activeOriginal = fromUrl;
          }
          if (config.playerTokens && typeof config.playerTokens === "object") {
            state.playerTokens = Object.assign({}, config.playerTokens);
          }
          if (Array.isArray(config.kenoSpots)) state.keno.spots = config.kenoSpots.slice();
          if (Array.isArray(config.kenoHistory) && config.kenoHistory.length) {
            state.keno.history = config.kenoHistory.slice(0, 200);
            state.keno.lastResult = state.keno.history[0] || null;
          }
          if (Array.isArray(config.diceHistory) && config.diceHistory.length) {
            state.dice.history = config.diceHistory.slice(0, 200);
            state.dice.lastResult = state.dice.history[0] || null;
          }
          if (Array.isArray(config.limboHistory) && config.limboHistory.length) {
            state.limbo.history = config.limboHistory.slice(0, 200);
            state.limbo.lastResult = state.limbo.history[0] || null;
          }
          if (!config.kenoCurrency) {
            // Par défaut : devise du dernier coup, sinon claim, sinon SOL
            const lastCur = state.keno.lastResult && state.keno.lastResult.currency;
            config.kenoCurrency = String(lastCur || config.currency || "SOL").toUpperCase();
          } else {
            config.kenoCurrency = String(config.kenoCurrency).toUpperCase();
          }
          if (config.playerToken) state.playerToken = config.playerToken;
          if (config.browserSession) state.browserSession = config.browserSession;
          // Associer le token legacy au jeu de la page courante
          if (state.playerToken && state.activeOriginal) {
            const prod = originalsProductForGame(state.activeOriginal);
            if (prod && !(state.playerTokens && state.playerTokens[prod])) {
              if (!state.playerTokens) state.playerTokens = {};
              state.playerTokens[prod] = state.playerToken;
              config.playerTokens = Object.assign({}, state.playerTokens);
            }
          }
          // Ne pas réutiliser un vieux taux persisté (souvent invalide côté API)
          if (config.exchangeRate > 0 && !(config.exchangeRate === 1 && String(config.kenoCurrency).toUpperCase() !== "EUR")) {
            state.exchangeRate = config.exchangeRate;
            state.exchangeRateAt = 0; // forcer refresh avant le 1er bet
            state.exchangeRateCurrency = String(config.kenoCurrency || "").toUpperCase();
          } else {
            state.exchangeRate = null;
            state.exchangeRateAt = 0;
            state.exchangeRateCurrency = null;
            config.exchangeRate = 0;
          }

          function getKenoCurrency() {
            const sniffed = String(config.kenoCurrency || "").toUpperCase();
            if (sniffed && CURRENCIES.includes(sniffed)) return sniffed;
            const claim = String(config.currency || "SOL").toUpperCase();
            return (CURRENCIES.includes(claim) ? claim : "SOL");
          }

          function setKenoCurrency(cur, opts) {
            const next = String(cur || "").toUpperCase().trim();
            if (!next || !CURRENCIES.includes(next)) return false;
            if (getKenoCurrency() === next && config.kenoCurrency === next) return true;
            const prev = String(config.kenoCurrency || "").toUpperCase();
            config.kenoCurrency = next;
            if (!opts || opts.clearFx !== false) {
              if (prev && prev !== next) clearExchangeRate();
            }
            persistConfig();
            log("Keno currency auto:", next);
            if ((!opts || !opts.silent) && document.getElementById("wb-games") && state.activeTab === "games") {
              try { renderGamesPanel(); } catch {}
            }
            return true;
          }

          function detectThrillWalletCurrency() {
            const keysHint = /currency|wallet|balance|selected|active|asset|chip/i;
            const tryObj = (obj, depth) => {
              if (!obj || depth > 6) return null;
              if (typeof obj === "string") {
                const s = obj.toUpperCase();
                if (CURRENCIES.includes(s)) return s;
                return null;
              }
              if (typeof obj !== "object") return null;
              const preferred = [
                obj.activeCurrency, obj.selectedCurrency, obj.walletCurrency,
                obj.walletCurrencyIsoCode, obj.currencyIsoCode, obj.currencyCode,
                obj.currency, obj.currentCurrency, obj.selectedWalletCurrency,
                obj.playCurrency, obj.bettingCurrency
              ];
              for (const v of preferred) {
                if (typeof v === "string" && CURRENCIES.includes(v.toUpperCase())) return v.toUpperCase();
                if (v && typeof v === "object") {
                  const nested = v.code || v.iso || v.symbol || v.currency;
                  if (typeof nested === "string" && CURRENCIES.includes(nested.toUpperCase())) {
                    return nested.toUpperCase();
                  }
                }
              }
              if (Array.isArray(obj)) {
                for (const item of obj) {
                  const f = tryObj(item, depth + 1);
                  if (f) return f;
                }
              } else {
                for (const k of Object.keys(obj)) {
                  if (!keysHint.test(k) && depth > 2) continue;
                  const f = tryObj(obj[k], depth + 1);
                  if (f) return f;
                }
              }
              return null;
            };
            try {
              const stores = [];
              try { if (WIN.localStorage) stores.push(WIN.localStorage); } catch {}
              try { if (WIN.sessionStorage) stores.push(WIN.sessionStorage); } catch {}
              for (const store of stores) {
                for (let i = 0; i < store.length; i++) {
                  const key = store.key(i);
                  const raw = store.getItem(key);
                  if (!raw || raw.length > 400000) continue;
                  if (!keysHint.test(key) && raw.indexOf("Currency") < 0 && raw.indexOf("currency") < 0 && raw.indexOf("wallet") < 0) continue;
                  try {
                    const found = tryObj(JSON.parse(raw), 0);
                    if (found) return found;
                  } catch {}
                  if (typeof raw === "string" && CURRENCIES.includes(raw.toUpperCase())) return raw.toUpperCase();
                }
              }
            } catch {}
            return null;
          }

          function syncKenoCurrencyFromSite() {
            const detected = detectThrillWalletCurrency();
            if (detected) setKenoCurrency(detected, { clearFx: true, silent: true });
            return detected || getKenoCurrency();
          }

          async function resolveKenoCurrencyForBet() {
            // 1) wallet actif Thrill
            const detected = detectThrillWalletCurrency();
            if (detected) {
              setKenoCurrency(detected, { clearFx: true, silent: true });
              return detected;
            }
            // 2) dernière crypto snifflée sur un bet officiel
            if (config.kenoCurrency && CURRENCIES.includes(String(config.kenoCurrency).toUpperCase())) {
              return String(config.kenoCurrency).toUpperCase();
            }
            // 3) devise de claim
            const claim = String(config.currency || "SOL").toUpperCase();
            setKenoCurrency(claim, { clearFx: false, silent: true });
            return claim;
          }

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
            storage.set("thr_keno_stake", String(config.kenoStake));
            storage.set("thr_keno_risk", config.kenoRisk);
            storage.setJSON("thr_keno_spots", state.keno.spots);
            storage.set("thr_keno_auto_count", String(config.kenoAutoCount));
            storage.set("thr_keno_auto_delay", String(config.kenoAutoDelayMs));
            storage.set("thr_keno_playout", String(config.kenoPlayoutMs));
            storage.set("thr_keno_speed", config.kenoSpeed || "instant");
            storage.setJSON("thr_keno_history", state.keno.history.slice(0, 200));
            storage.set("thr_keno_currency", getKenoCurrency());
            storage.set("thr_dice_mode", config.diceMode || "Under");
            storage.set("thr_dice_target", String(config.diceTarget));
            storage.set("thr_dice_mult", String(config.diceMult));
            storage.setJSON("thr_dice_history", state.dice.history.slice(0, 200));
            storage.set("thr_limbo_mult", String(config.limboMult));
            storage.setJSON("thr_limbo_history", state.limbo.history.slice(0, 200));
            storage.set("thr_active_original", state.activeOriginal || "keno");
            storage.set("thr_player_token", state.playerToken || config.playerToken || "");
            storage.setJSON("thr_player_tokens", state.playerTokens || {});
            storage.set("thr_browser_session", state.browserSession || config.browserSession || "");
            if (state.exchangeRate > 0) storage.set("thr_fx_rate", String(state.exchangeRate));
          }
          // --- Logging / UI helpers --------------------------------------------------

          function log(...args) {
            console.log("[WaggerBot Thrill]", ...args);
          }

          function setStatus(msg, opts) {
            state.lastStatus = msg;
            const el = document.getElementById("wb-status");
            if (el) el.textContent = msg;
            if (!opts || !opts.quiet) log(msg);
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

          function detectOriginalFromLocation() {
            const p = String(WIN.location.pathname || "");
            if (/\/casino\/play\/thrill-dice\b/i.test(p)) return "dice";
            if (/\/casino\/play\/thrill-limbo\b/i.test(p)) return "limbo";
            if (/\/casino\/play\/thrill-keno\b/i.test(p)) return "keno";
            return null;
          }

          function originalsProductForGame(game) {
            const g = ORIGINALS_GAMES[game] || ORIGINALS_GAMES.keno;
            return g.product;
          }

          function originalsGameFromProductOrUrl(productOrUrl) {
            const s = String(productOrUrl || "").toLowerCase();
            if (s.includes("limbo")) return "limbo";
            if (s.includes("dice")) return "dice";
            if (s.includes("keno")) return "keno";
            return null;
          }

          function originalsGameUrl(game) {
            const g = ORIGINALS_GAMES[game] || ORIGINALS_GAMES.keno;
            const href = String(WIN.location.href || "");
            const lang = (href.match(/thrill\.com\/([a-z]{2})\//i) || [])[1] || "fr";
            return "https://thrill.com/" + lang + "/casino/play/" + g.slug;
          }

          function isOnOriginalsGamePage(game) {
            const g = ORIGINALS_GAMES[game];
            if (!g) return false;
            return new RegExp("/casino/play/" + g.slug + "\\b", "i").test(String(WIN.location.pathname || ""));
          }

          function getPlayerTokenForProduct(product) {
            const map = state.playerTokens || {};
            if (product && map[product]) return map[product];
            // Ancien storage (1 seul token) : ok tant qu'on n'a pas encore de map par jeu
            if (product && Object.keys(map).length === 0) {
              return state.playerToken || config.playerToken || "";
            }
            if (!product) return state.playerToken || config.playerToken || "";
            return "";
          }

          function activatePlayerTokenForGame(game) {
            const product = originalsProductForGame(game);
            const tok = getPlayerTokenForProduct(product);
            if (tok) {
              state.playerToken = tok;
              config.playerToken = tok;
            }
            return tok;
          }

          function selectOriginalGame(game, opts) {
            opts = opts || {};
            const g = ["keno", "dice", "limbo"].includes(game) ? game : "keno";
            state.activeOriginal = g;
            activatePlayerTokenForGame(g);
            persistConfig();
            renderGamesPanel();
            // Le x-player-token Thrill est lié à la page du jeu — y aller si besoin
            if (opts.navigate !== false && !isOnOriginalsGamePage(g)) {
              const url = originalsGameUrl(g);
              toast("Ouverture " + g.charAt(0).toUpperCase() + g.slice(1) + " sur Thrill…", "info");
              setTimeout(() => { try { WIN.location.assign(url); } catch { WIN.location.href = url; } }, 120);
              return true;
            }
            return false;
          }

          function applyPlayerToken(token, meta) {
            if (!token || typeof token !== "string") return false;
            const t = token.trim();
            if (t.length < 8 || t.length > 80) return false;
            if (!/^[0-9a-fA-F-]{8,}$/.test(t) && !/^[A-Za-z0-9_-]{8,}$/.test(t)) return false;
            const product = meta && meta.product ? String(meta.product) : "";
            if (!state.playerTokens) state.playerTokens = {};
            if (product) {
              state.playerTokens[product] = t;
              config.playerTokens = Object.assign({}, state.playerTokens);
            }
            // Si on sniffe le jeu de la page courante, synchroniser l'onglet bot
            const gameFromProduct = originalsGameFromProductOrUrl(product);
            const gameFromUrl = detectOriginalFromLocation();
            const game = gameFromProduct || gameFromUrl;
            if (game && meta && meta.syncTab) {
              state.activeOriginal = game;
            }
            if (state.playerToken === t && (!product || state.playerTokens[product] === t)) {
              return true;
            }
            state.playerToken = t;
            config.playerToken = t;
            persistConfig();
            log("Player token OK" + (product ? " · " + product : ""));
            return true;
          }

          function applyBrowserSession(sess) {
            if (!sess || typeof sess !== "string") return false;
            const s = sess.trim();
            if (s.length < 4 || s.length > 64) return false;
            if (state.browserSession === s) return true;
            state.browserSession = s;
            config.browserSession = s;
            persistConfig();
            return true;
          }

          function applyExchangeRate(rate, meta) {
            const n = Number(rate);
            if (!Number.isFinite(n) || n <= 0) return false;
            const cur = String((meta && meta.currency) || getKenoCurrency()).toUpperCase();
            // 1.0 n'est valide que si la devise wallet est EUR
            if (n === 1 && cur !== "EUR") return false;
            state.exchangeRate = n;
            state.exchangeRateAt = Date.now();
            state.exchangeRateCurrency = cur;
            config.exchangeRate = n;
            persistConfig();
            log("FX rate OK:", n, cur);
            return true;
          }

          function clearExchangeRate() {
            state.exchangeRate = null;
            state.exchangeRateAt = 0;
            state.exchangeRateCurrency = null;
            config.exchangeRate = 0;
            try { storage.set("thr_fx_rate", "0"); } catch {}
          }

          function getFreshExchangeRate(maxAgeMs) {
            const cur = getKenoCurrency();
            const n = Number(state.exchangeRate || config.exchangeRate || 0);
            if (!Number.isFinite(n) || n <= 0) return 0;
            if (n === 1 && cur !== "EUR") return 0;
            if (state.exchangeRateCurrency && state.exchangeRateCurrency !== cur) return 0;
            const age = Date.now() - (state.exchangeRateAt || 0);
            const maxAge = maxAgeMs != null ? maxAgeMs : 60000;
            if (!state.exchangeRateAt || age > maxAge) return 0;
            return n;
          }

          function ensureBrowserSession() {
            if (state.browserSession) return state.browserSession;
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            let s = "";
            for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
            applyBrowserSession(s);
            return state.browserSession;
          }

          function extractGameHeaders(headers, url) {
            if (!headers) return;
            const get = (name) => {
              if (typeof headers.get === "function") return headers.get(name);
              if (typeof headers === "object") {
                return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
              }
              return null;
            };
            const product = String(get("x-product-name") || get("X-Product-Name") || "").trim()
              || (originalsGameFromProductOrUrl(url) ? ORIGINALS_GAMES[originalsGameFromProductOrUrl(url)].product : "");
            const pt = get("x-player-token") || get("X-Player-Token");
            if (pt) applyPlayerToken(String(pt), { product, syncTab: true });
            const bs = get("x-browser-session") || get("X-Browser-Session");
            if (bs) applyBrowserSession(String(bs));
            const game = originalsGameFromProductOrUrl(product || url);
            if (game) {
              // Mémoriser le jeu snifflé sans écraser un onglet choisi à l'instant
              if (!state._originalPickAt || Date.now() - state._originalPickAt > 2500) {
                state.activeOriginal = game;
              }
            }
          }

          function extractGameBodyHints(body) {
            if (!body) return;
            try {
              const obj = typeof body === "string" ? JSON.parse(body) : body;
              if (obj && typeof obj === "object") {
                if (obj.walletCurrencyIsoCode) {
                  setKenoCurrency(obj.walletCurrencyIsoCode, { clearFx: false, silent: true });
                }
                if (obj.anchorToWalletExchangeRate != null) {
                  applyExchangeRate(obj.anchorToWalletExchangeRate, {
                    currency: obj.walletCurrencyIsoCode || getKenoCurrency()
                  });
                }
                if (Array.isArray(obj.spots) && obj.spots.length) {
                  state.keno.spots = obj.spots.map(Number).filter(n => n >= 1 && n <= KENO_NUMBERS);
                }
                if (obj.gameMode === "Under" || obj.gameMode === "Over") {
                  config.diceMode = obj.gameMode;
                  if (Array.isArray(obj.coverage) && obj.coverage[0]) {
                    const c0 = obj.coverage[0];
                    config.diceTarget = obj.gameMode === "Over"
                      ? clampDiceTarget("Over", c0.fromValue)
                      : clampDiceTarget("Under", c0.toValue);
                  }
                }
                if (obj.payoutMultiplier != null && !obj.coverage && !obj.spots) {
                  const pm = Number(obj.payoutMultiplier);
                  if (pm >= 1.01) config.limboMult = clampLimboMult(pm);
                }
              }
            } catch {}
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
              if (!e.data) return;
              if (e.data.type === "thr-token" && e.data.token) applyAuthToken(e.data.token);
              if (e.data.type === "thr-player-token" && e.data.token) {
                applyPlayerToken(e.data.token, { product: e.data.product || "", syncTab: !!e.data.product });
              }
              if (e.data.type === "thr-browser-session" && e.data.session) applyBrowserSession(e.data.session);
              if (e.data.type === "thr-fx-rate" && e.data.rate != null) applyExchangeRate(e.data.rate);
            });

            const patchCode = `
              (function () {
                if (window.__thrPageSniffer) return;
                window.__thrPageSniffer = true;
                function send(t) { try { window.postMessage({ type: "thr-token", token: t }, "*"); } catch (e) {} }
                function sendPlayer(t, product) { try { window.postMessage({ type: "thr-player-token", token: t, product: product || "" }, "*"); } catch (e) {} }
                function sendSession(s) { try { window.postMessage({ type: "thr-browser-session", session: s }, "*"); } catch (e) {} }
                function sendFx(r) { try { window.postMessage({ type: "thr-fx-rate", rate: r }, "*"); } catch (e) {} }
                function productFrom(u, h) {
                  try {
                    var pn = h && ((typeof h.get === "function") ? (h.get("x-product-name") || h.get("X-Product-Name")) : (h["x-product-name"] || h["X-Product-Name"]));
                    if (pn) return String(pn);
                  } catch (e0) {}
                  u = String(u || "").toLowerCase();
                  if (u.indexOf("limbo") !== -1) return "thrill-limbo";
                  if (u.indexOf("dice") !== -1) return "thrill-dice";
                  if (u.indexOf("keno") !== -1) return "thrill-keno";
                  return "";
                }
                function fromHeaders(h, u) {
                  if (!h) return;
                  var names = ["authorization", "Authorization", "x-access-token", "X-Access-Token"];
                  for (var i = 0; i < names.length; i++) {
                    var a = (typeof h.get === "function") ? h.get(names[i]) : h[names[i]];
                    if (!a) continue;
                    a = String(a);
                    if (a.indexOf("Bearer ") === 0) a = a.slice(7);
                    if (a.indexOf("eyJ") === 0) { send(a); return; }
                  }
                  var prod = productFrom(u, h);
                  var pt = (typeof h.get === "function") ? (h.get("x-player-token") || h.get("X-Player-Token")) : (h["x-player-token"] || h["X-Player-Token"]);
                  if (pt) sendPlayer(String(pt), prod);
                  var bs = (typeof h.get === "function") ? (h.get("x-browser-session") || h.get("X-Browser-Session")) : (h["x-browser-session"] || h["X-Browser-Session"]);
                  if (bs) sendSession(String(bs));
                }
                function fromBody(b) {
                  try {
                    var o = typeof b === "string" ? JSON.parse(b) : b;
                    if (o && o.anchorToWalletExchangeRate != null) sendFx(o.anchorToWalletExchangeRate);
                  } catch (e) {}
                }
                var f = window.fetch;
                if (f) {
                  window.fetch = function (input, init) {
                    var u = "";
                    try {
                      u = typeof input === "string" ? input : (input && input.url) || "";
                      if (u.indexOf("/api/") !== -1 || u.indexOf("originals-instant-api") !== -1 || u.indexOf("thrill-games.com") !== -1) {
                        if (input && input.headers) fromHeaders(input.headers, u);
                        fromHeaders(init && init.headers, u);
                        if (init && init.body) fromBody(init.body);
                      }
                    } catch (e) {}
                    return f.apply(this, arguments).then(function (res) {
                      try {
                        if (u && (u.indexOf("/api/") !== -1 || u.indexOf("originals-instant-api") !== -1 || u.indexOf("thrill-games.com") !== -1 || /rate|currency|wallet|exchange/i.test(u))) {
                          res.clone().text().then(function (txt) {
                            try {
                              var o = txt ? JSON.parse(txt) : null;
                              if (!o) return;
                              if (o.anchorToWalletExchangeRate != null) sendFx(o.anchorToWalletExchangeRate);
                              else if (o.data && o.data.anchorToWalletExchangeRate != null) sendFx(o.data.anchorToWalletExchangeRate);
                              else if (o.exchangeRate != null) sendFx(o.exchangeRate);
                            } catch (e2) {}
                          });
                        }
                      } catch (e3) {}
                      return res;
                    });
                  };
                }
                var xo = XMLHttpRequest.prototype.open;
                var xs = XMLHttpRequest.prototype.setRequestHeader;
                var xsend = XMLHttpRequest.prototype.send;
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
                    if (nl === "x-product-name") this._thrProduct = String(v || "");
                    if (nl === "x-player-token") sendPlayer(String(v), this._thrProduct || productFrom(this._thrU, null));
                    if (nl === "x-browser-session") sendSession(String(v));
                  } catch (e) {}
                  return xs.apply(this, arguments);
                };
                XMLHttpRequest.prototype.send = function (body) {
                  try {
                    if (this._thrU && (this._thrU.indexOf("originals-instant-api") !== -1 || this._thrU.indexOf("thrill-games.com") !== -1)) fromBody(body);
                  } catch (e) {}
                  return xsend.apply(this, arguments);
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
                window.addEventListener("message", function (e) {
                  if (!e.data || e.data.type !== "thr-game-req") return;
                  var payload = { type: "thr-game-res", reqId: e.data.reqId };
                  var headers = {
                    "content-type": "application/json",
                    "accept": "application/json",
                    "x-product-name": e.data.productName || "thrill-keno",
                    "x-browser-session": e.data.browserSession || "",
                    "referer": "https://thrill.com/"
                  };
                  if (e.data.playerToken) headers["x-player-token"] = e.data.playerToken;
                  fetch(e.data.url, {
                    method: "POST",
                    credentials: "include",
                    headers: headers,
                    body: JSON.stringify(e.data.body || {})
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
                window.addEventListener("message", function (e) {
                  if (!e.data || e.data.type !== "thr-fx-req") return;
                  var payload = { type: "thr-fx-res", reqId: e.data.reqId };
                  var wallet = String(e.data.walletCurrency || "SOL").toUpperCase();
                  function digRate(obj, depth) {
                    if (!obj || depth > 8) return null;
                    if (typeof obj === "number" && obj > 0) return null;
                    if (typeof obj !== "object") return null;
                    if (obj.anchorToWalletExchangeRate != null) {
                      var r0 = Number(obj.anchorToWalletExchangeRate);
                      if (r0 > 0) return r0;
                    }
                    if (obj.exchangeRate != null) {
                      var r1 = Number(obj.exchangeRate);
                      if (r1 > 0) return r1;
                    }
                    if (obj.rates && typeof obj.rates === "object") {
                      if (obj.rates[wallet] != null) {
                        var r2 = Number(obj.rates[wallet]);
                        if (r2 > 0) return r2;
                      }
                    }
                    if (Array.isArray(obj)) {
                      for (var i = 0; i < obj.length; i++) {
                        var f = digRate(obj[i], depth + 1);
                        if (f) return f;
                      }
                    } else {
                      var keys = Object.keys(obj);
                      for (var k = 0; k < keys.length; k++) {
                        var f2 = digRate(obj[keys[k]], depth + 1);
                        if (f2) return f2;
                      }
                    }
                    return null;
                  }
                  function scanStorage() {
                    try {
                      var stores = [window.localStorage, window.sessionStorage];
                      for (var s = 0; s < stores.length; s++) {
                        var store = stores[s];
                        if (!store) continue;
                        for (var i = 0; i < store.length; i++) {
                          var key = store.key(i);
                          var raw = store.getItem(key);
                          if (!raw || raw.length > 500000) continue;
                          if (!/rate|fx|exchange|currency|wallet|price/i.test(key) && raw.indexOf("ExchangeRate") < 0 && raw.indexOf("exchangeRate") < 0) continue;
                          try {
                            var found = digRate(JSON.parse(raw), 0);
                            if (found) return found;
                          } catch (err) {}
                        }
                      }
                    } catch (err) {}
                    return null;
                  }
                  var urls = (e.data.urls || []).slice();
                  function tryNext() {
                    if (!urls.length) {
                      var fromStore = scanStorage();
                      if (fromStore) payload.rate = fromStore;
                      else payload.error = "no rate";
                      window.postMessage(payload, "*");
                      return;
                    }
                    var url = urls.shift();
                    fetch(url, { method: "GET", credentials: "include", headers: { accept: "application/json" } })
                      .then(function (res) { return res.text().then(function (txt) { return { status: res.status, txt: txt }; }); })
                      .then(function (r) {
                        try {
                          var data = r.txt ? JSON.parse(r.txt) : {};
                          var found = digRate(data, 0);
                          if (found) {
                            payload.rate = found;
                            window.postMessage(payload, "*");
                            return;
                          }
                        } catch (err) {}
                        tryNext();
                      })
                      .catch(function () { tryNext(); });
                  }
                  tryNext();
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
                if (isThrillApiUrl(url) || /originals-instant-api|thrill-games\.com/i.test(url)) {
                  if (input?.headers) {
                    extractAuthFromHeaders(input.headers);
                    extractGameHeaders(input.headers, url);
                  }
                  extractAuthFromHeaders(init?.headers);
                  extractGameHeaders(init?.headers, url);
                  if (init?.body) extractGameBodyHints(init.body);
                }
              } catch {}
              return origFetch(input, init);
            };

            const origOpen = WIN.XMLHttpRequest.prototype.open;
            const origSetHeader = WIN.XMLHttpRequest.prototype.setRequestHeader;
            const origSend = WIN.XMLHttpRequest.prototype.send;
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
                if (nl === "x-product-name") this._thrProduct = String(value || "");
                if (nl === "x-player-token") {
                  const prod = this._thrProduct || (originalsGameFromProductOrUrl(this._thrUrl)
                    ? ORIGINALS_GAMES[originalsGameFromProductOrUrl(this._thrUrl)].product : "");
                  applyPlayerToken(String(value), { product: prod, syncTab: true });
                }
                if (nl === "x-browser-session") applyBrowserSession(String(value));
              } catch {}
              return origSetHeader.apply(this, arguments);
            };
            WIN.XMLHttpRequest.prototype.send = function (body) {
              try {
                if (this._thrUrl && /originals-instant-api|thrill-games\.com/i.test(this._thrUrl)) {
                  extractGameBodyHints(body);
                }
              } catch {}
              return origSend.apply(this, arguments);
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
            return thrillOrigin() + "/fr/casino/play/";
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

          // --- Originaux (Keno) -------------------------------------------------------

          function postGameViaPage(url, productName, body) {
            return new Promise((resolve, reject) => {
              const reqId = state.tabId + "_game_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
              const timeout = setTimeout(() => {
                WIN.removeEventListener("message", onMsg);
                reject(new Error("Timeout jeu"));
              }, 25000);

              function onMsg(e) {
                if (!e.data || e.data.type !== "thr-game-res" || e.data.reqId !== reqId) return;
                clearTimeout(timeout);
                WIN.removeEventListener("message", onMsg);
                if (e.data.error) reject(new Error(e.data.error));
                else resolve(e.data.result);
              }

              WIN.addEventListener("message", onMsg);
              WIN.postMessage({
                type: "thr-game-req",
                reqId,
                url,
                productName,
                playerToken: getPlayerTokenForProduct(productName),
                browserSession: ensureBrowserSession(),
                body
              }, "*");
            });
          }

          function postGameDirect(url, productName, body) {
            return new Promise((resolve, reject) => {
              GM_xmlhttpRequest({
                method: "POST",
                url,
                headers: {
                  "content-type": "application/json",
                  accept: "application/json",
                  "x-player-token": getPlayerTokenForProduct(productName),
                  "x-product-name": productName,
                  "x-browser-session": ensureBrowserSession(),
                  referer: "https://thrill.com/",
                  origin: "https://thrill.com"
                },
                data: JSON.stringify(body),
                timeout: 12000,
                onload(res) {
                  let data = {};
                  try { data = res.responseText ? JSON.parse(res.responseText) : {}; } catch {}
                  resolve({ status: res.status, data });
                },
                onerror() { reject(new Error("Réseau GM_xhr")); },
                ontimeout() { reject(new Error("Timeout GM_xhr")); }
              });
            });
          }

          async function postGameBet(path, productName, body, opts) {
            const url = ORIGINALS_API + path;
            const preferDirect = opts && opts.preferDirect;
            if (preferDirect) {
              try {
                return await postGameDirect(url, productName, body);
              } catch (err) {
                log("Jeu GM échoué, fallback page:", err.message);
                return await postGameViaPage(url, productName, body);
              }
            }
            try {
              return await postGameViaPage(url, productName, body);
            } catch (err) {
              log("Jeu page-context échoué, fallback GM:", err.message);
              return await postGameDirect(url, productName, body);
            }
          }

          function buildKenoPayload(rate) {
            const stake = Math.max(0, Number(config.kenoStake) || 0);
            const fx = Number(rate);
            const cur = getKenoCurrency();
            if (!Number.isFinite(fx) || fx <= 0) {
              throw new Error("Taux FX invalide");
            }
            if (fx === 1 && cur !== "EUR") {
              throw new Error("Taux FX invalide (1.0)");
            }
            const spots = state.keno.spots.slice().sort((a, b) => a - b);

            // Mise en crypto wallet (auto) — système qui marchait
            const walletStake = +Number(stake).toFixed(12);
            const anchorStake = +(walletStake / fx).toFixed(12);

            return {
              inputInAnchorCurrency: false,
              walletCurrencyIsoCode: cur,
              anchorCurrencyIsoCode: "EUR",
              anchorToWalletExchangeRate: fx,
              walletNetStakeAmount: walletStake,
              anchorNetStakeAmount: anchorStake,
              riskProfile: config.kenoRisk || "Classic",
              spots,
              playoutTimeMilliseconds: Math.max(0, Number(config.kenoPlayoutMs) || 0)
            };
          }

          function gmGetJson(url) {
            return new Promise((resolve, reject) => {
              GM_xmlhttpRequest({
                method: "GET",
                url,
                headers: { accept: "application/json" },
                timeout: 10000,
                onload(res) {
                  if (res.status < 200 || res.status >= 300) {
                    reject(new Error("HTTP " + res.status));
                    return;
                  }
                  try {
                    resolve(JSON.parse(res.responseText || "{}"));
                  } catch (err) {
                    reject(err);
                  }
                },
                onerror() { reject(new Error("réseau")); },
                ontimeout() { reject(new Error("timeout")); }
              });
            });
          }

          async function fetchMarketExchangeRate(walletCurrency) {
            const cur = String(walletCurrency || getKenoCurrency() || "SOL").toUpperCase();
            if (cur === "EUR") return 1;

            // Prix EUR → anchorToWallet = combien de wallet pour 1 EUR
            const binanceDirect = {
              SOL: "SOLEUR", BTC: "BTCEUR", ETH: "ETHEUR", LTC: "LTCEUR",
              XRP: "XRPEUR", DOGE: "DOGEEUR", TRX: "TRXEUR", BNB: "BNBEUR",
              ADA: "ADAEUR", LINK: "LINKEUR", MATIC: "MATICEUR", DOT: "DOTEUR"
            };

            try {
              if (binanceDirect[cur]) {
                const j = await gmGetJson("https://api.binance.com/api/v3/ticker/price?symbol=" + binanceDirect[cur]);
                const price = Number(j.price);
                if (price > 0) return 1 / price;
              } else if (cur === "USDT" || cur === "USDC") {
                const eurUsdt = await gmGetJson("https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT");
                const eurPerUsdt = Number(eurUsdt.price); // USDT per 1 EUR? Actually EURUSDT = how many USDT for 1 EUR
                // EURUSDT price = USDT needed to buy 1 EUR, so wallet(USDT) per EUR = price
                if (eurPerUsdt > 0) {
                  if (cur === "USDT") return eurPerUsdt;
                  // USDC ≈ USDT
                  try {
                    const usdc = await gmGetJson("https://api.binance.com/api/v3/ticker/price?symbol=USDCUSDT");
                    const usdcPerUsdt = Number(usdc.price);
                    if (usdcPerUsdt > 0) return eurPerUsdt / usdcPerUsdt;
                  } catch {}
                  return eurPerUsdt;
                }
              } else {
                // fallback via USDT pair + EURUSDT
                const pair = cur + "USDT";
                const [coin, eur] = await Promise.all([
                  gmGetJson("https://api.binance.com/api/v3/ticker/price?symbol=" + pair),
                  gmGetJson("https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT")
                ]);
                const coinUsdt = Number(coin.price);
                const eurUsdt = Number(eur.price); // USDT per EUR
                if (coinUsdt > 0 && eurUsdt > 0) {
                  // coin per EUR = eurUsdt / coinUsdt
                  return eurUsdt / coinUsdt;
                }
              }
            } catch (err) {
              log("Binance FX fail:", err.message);
            }

            // CoinGecko fallback
            const geckoIds = {
              SOL: "solana", BTC: "bitcoin", ETH: "ethereum", USDT: "tether",
              USDC: "usd-coin", LTC: "litecoin", XRP: "ripple", TRX: "tron", DOGE: "dogecoin"
            };
            const id = geckoIds[cur];
            if (!id) return 0;
            try {
              const j = await gmGetJson(
                "https://api.coingecko.com/api/v3/simple/price?ids=" + encodeURIComponent(id) + "&vs_currencies=eur"
              );
              const price = Number(j?.[id]?.eur);
              if (price > 0) return 1 / price;
            } catch (err) {
              log("CoinGecko FX fail:", err.message);
            }
            return 0;
          }

          function fetchExchangeRateViaPage(walletCurrency) {
            return new Promise((resolve) => {
              const reqId = state.tabId + "_fx_" + Date.now();
              const timeout = setTimeout(() => {
                WIN.removeEventListener("message", onMsg);
                resolve(0);
              }, 8000);

              function onMsg(e) {
                if (!e.data || e.data.type !== "thr-fx-res" || e.data.reqId !== reqId) return;
                clearTimeout(timeout);
                WIN.removeEventListener("message", onMsg);
                const rate = Number(e.data.rate);
                resolve(Number.isFinite(rate) && rate > 0 ? rate : 0);
              }

              const origin = thrillOrigin();
              const cur = encodeURIComponent(walletCurrency || getKenoCurrency() || "SOL");
              WIN.addEventListener("message", onMsg);
              WIN.postMessage({
                type: "thr-fx-req",
                reqId,
                walletCurrency: walletCurrency || getKenoCurrency(),
                urls: [
                  origin + "/api/currency/v1/rates",
                  origin + "/api/currency/v1/exchange-rates",
                  origin + "/api/wallet/v1/exchange-rates",
                  origin + "/api/wallet/v2/exchange-rates",
                  origin + "/api/wallet/v1/rates?anchor=EUR&wallet=" + cur,
                  origin + "/api/finance/v1/exchange-rates",
                  ORIGINALS_API + "/v1/exchange-rate?anchorCurrencyIsoCode=EUR&walletCurrencyIsoCode=" + cur,
                  ORIGINALS_API + "/v1/exchange-rates",
                  ORIGINALS_API + "/v1/keno/config",
                  ORIGINALS_API + "/v1/configuration"
                ]
              }, "*");
            });
          }

          async function ensureExchangeRate(force, maxAgeMs) {
            if (!force) {
              const fresh = getFreshExchangeRate(maxAgeMs);
              if (fresh > 0) return fresh;
            }

            // 1) Taux marché (Binance / CoinGecko) — même source que Thrill en pratique
            try {
              const market = await fetchMarketExchangeRate(getKenoCurrency());
              if (market > 0 && applyExchangeRate(market, { currency: getKenoCurrency() })) {
                log("FX marché OK:", market);
                return market;
              }
            } catch (err) {
              log("FX marché erreur:", err.message);
            }

            // 2) Sniff / APIs page Thrill
            const fromPage = await fetchExchangeRateViaPage(getKenoCurrency());
            if (fromPage > 0 && applyExchangeRate(fromPage, { currency: getKenoCurrency() })) {
              return fromPage;
            }

            const fallback = Number(state.exchangeRate || 0);
            if (fallback > 0 && !(fallback === 1 && getKenoCurrency() !== "EUR")) {
              if (!state.exchangeRateAt) state.exchangeRateAt = Date.now();
              return fallback;
            }
            throw new Error("Taux FX introuvable (Binance/CoinGecko) — réessaie dans 1s");
          }

          function applyKenoSpeedPreset(preset) {
            const map = {
              instant: { delay: 0, playout: 0 },
              fast: { delay: 30, playout: 10 },
              normal: { delay: 150, playout: 25 }
            };
            const p = map[preset] || map.instant;
            config.kenoSpeed = preset in map ? preset : "instant";
            config.kenoAutoDelayMs = p.delay;
            config.kenoPlayoutMs = p.playout;
            persistConfig();
            renderGamesPanel();
          }

          function updateKenoLiveResult(r, i, total) {
            const live = document.getElementById("wb-keno-live");
            if (live) {
              const sign = (r.profit || 0) >= 0 ? "+" : "";
              live.textContent = (total ? i + "/" + total + " · " : "") +
                "x" + r.mult + " · " + r.hitCount + " hits · " +
                sign + formatKenoAmt(r.profit) + " " + (r.currency || getKenoCurrency());
            }
            const statsBox = document.getElementById("wb-keno-stats");
            if (statsBox) statsBox.innerHTML = renderKenoStatsHtml(computeKenoStats());
            const histBox = document.getElementById("wb-keno-hist");
            if (histBox && state.keno.history.length) {
              const empty = histBox.querySelector(".wb-empty");
              if (empty) empty.remove();
              histBox.insertBefore(buildKenoHistRow(state.keno.history[0]), histBox.firstChild);
              while (histBox.children.length > 30) histBox.removeChild(histBox.lastChild);
            }
          }

          function renderKenoStatsHtml(s) {
            const pnlCls = s.profit > 0 ? "ok" : (s.profit < 0 ? "err" : "");
            return `
              <div class="wb-keno-stat"><span class="k">Spins</span><span class="v">${s.spins}</span></div>
              <div class="wb-keno-stat"><span class="k">Wins</span><span class="v" style="color:var(--wb-green)">${s.wins}</span></div>
              <div class="wb-keno-stat"><span class="k">Winrate</span><span class="v">${s.winRate}%</span></div>
              <div class="wb-keno-stat"><span class="k">Best</span><span class="v">x${formatKenoAmt(s.bestMult, 2)}</span></div>
              <div class="wb-keno-stat"><span class="k">Misés</span><span class="v">${formatKenoAmt(s.wagered)} ${s.currency}</span></div>
              <div class="wb-keno-stat"><span class="k">Retours</span><span class="v">${formatKenoAmt(s.returned)} ${s.currency}</span></div>
              <div class="wb-keno-stat wide ${pnlCls}"><span class="k">Profit</span><span class="v">${s.profit >= 0 ? "+" : ""}${formatKenoAmt(s.profit)} ${s.currency}</span></div>
            `;
          }

          function buildKenoHistRow(h) {
            const profit = Number(h.profit) || 0;
            const cls = profit > 0 ? "ok" : (profit < 0 ? "err" : "");
            const cur = h.currency || getKenoCurrency();
            const el = document.createElement("div");
            el.className = "wb-keno-hist " + cls;
            el.innerHTML = `
              <div class="wb-keno-hist-top">
                <span>x${h.mult} · ${h.hitCount} hit</span>
                <span class="pnl">${profit >= 0 ? "+" : ""}${formatKenoAmt(profit)} ${cur}</span>
              </div>
              <div class="wb-keno-hist-meta">mise ${formatKenoAmt(h.stake)} · retour ${formatKenoAmt(h.wonWallet != null ? h.wonWallet : (h.mult || 0) * (h.stake || 0))} · ${formatKenoTime(h.ts)}</div>
            `;
            return el;
          }

          function summarizeKenoResult(data, betInfo) {
            const d = data?.data || data || {};
            const mult = Number(d.wonMultiplier) || 0;
            const wonWallet = d.wonWalletGrossAmount != null ? Number(d.wonWalletGrossAmount) : null;
            const wonAnchor = d.wonAnchorGrossAmount != null ? Number(d.wonAnchorGrossAmount) : null;
            const result = Array.isArray(d.result) ? d.result : [];
            const hits = state.keno.spots.filter(s => result.includes(s));
            const stakeWallet = Number(betInfo?.walletStake != null ? betInfo.walletStake : config.kenoStake) || 0;
            const payout = wonWallet != null ? wonWallet : mult * stakeWallet;
            const profit = payout - stakeWallet;
            return {
              roundId: d.roundId || "",
              result,
              hits,
              hitCount: hits.length,
              mult,
              wonWallet: payout,
              wonAnchor,
              stake: stakeWallet,
              profit,
              currency: getKenoCurrency(),
              risk: config.kenoRisk || "Classic",
              spots: state.keno.spots.slice(),
              ts: Date.now()
            };
          }

          function pushKenoHistory(summary, opts) {
            state.keno.lastResult = summary;
            state.keno.history.unshift(summary);
            if (state.keno.history.length > 200) state.keno.history.length = 200;
            if (!opts || opts.persist !== false) persistConfig();
          }

          function computeKenoStats(list) {
            const rows = list || state.keno.history || [];
            const cur = getKenoCurrency();
            const scoped = rows.filter(h => !h.currency || h.currency === cur);
            let wagered = 0, returned = 0, wins = 0, bestMult = 0;
            for (const h of scoped) {
              const stake = Number(h.stake) || 0;
              const payout = h.wonWallet != null ? Number(h.wonWallet) : (Number(h.mult) || 0) * stake;
              const profit = h.profit != null ? Number(h.profit) : payout - stake;
              wagered += stake;
              returned += payout;
              if (profit > 0) wins++;
              if ((Number(h.mult) || 0) > bestMult) bestMult = Number(h.mult) || 0;
            }
            const spins = scoped.length;
            const profit = returned - wagered;
            return {
              spins,
              wins,
              losses: Math.max(0, spins - wins),
              winRate: spins ? Math.round(wins / spins * 100) : 0,
              wagered,
              returned,
              profit,
              bestMult,
              currency: cur
            };
          }

          function formatKenoAmt(n, digits) {
            const d = digits != null ? digits : 6;
            const v = Number(n) || 0;
            const abs = Math.abs(v);
            if (abs >= 1000) return v.toFixed(2);
            if (abs >= 1) return v.toFixed(4);
            return v.toFixed(d);
          }

          function formatKenoTime(ts) {
            if (!ts) return "—";
            return new Date(ts).toLocaleString("fr-FR", {
              day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"
            });
          }

          async function playKenoOnce(opts) {
            opts = opts || {};
            activatePlayerTokenForGame("keno");
            if (!getPlayerTokenForProduct("thrill-keno")) {
              if (!isOnOriginalsGamePage("keno")) {
                selectOriginalGame("keno", { navigate: true });
                throw new Error("Ouverture Keno pour sync token — reclique Jouer ensuite");
              }
              throw new Error("Token joueur manquant — ouvre Keno une fois sur thrill.com");
            }
            if (!state.keno.spots.length) throw new Error("Sélectionne au moins 1 numéro");

            if (!opts.fast) await resolveKenoCurrencyForBet();
            let rate = await ensureExchangeRate(!!opts.forceFx, opts.fast ? 300000 : 60000);
            let body = buildKenoPayload(rate);
            let { status, data } = await postGameBet("/v1/keno/bet", "thrill-keno", body, {
              preferDirect: !!opts.fast
            });

            const msg = String(data?.message || data?.error || data?.responseCode || "");
            const invalidFx = /exchange rate is invalid/i.test(msg) || /invalid.*exchange/i.test(msg);
            if (invalidFx) {
              clearExchangeRate();
              rate = await ensureExchangeRate(true);
              body = buildKenoPayload(rate);
              ({ status, data } = await postGameBet("/v1/keno/bet", "thrill-keno", body, {
                preferDirect: !!opts.fast
              }));
            }

            if (status >= 400 || (data && data.responseCode && data.responseCode !== "OK")) {
              const errMsg = data?.message || data?.error || data?.responseCode || ("HTTP " + status);
              if (/exchange rate is invalid/i.test(String(errMsg))) {
                clearExchangeRate();
                throw new Error("Taux FX rejeté par Thrill — nouvel essai au prochain spin");
              }
              if (/insufficient|not enough|balance|fonds|pas assez|argent/i.test(String(errMsg))) {
                throw new Error("Solde " + getKenoCurrency() + " insuffisant (mise " +
                  (body.walletNetStakeAmount || "?") + " " + getKenoCurrency() + " ≈ " +
                  (body.anchorNetStakeAmount || "?") + " EUR)");
              }
              throw new Error(String(errMsg));
            }
            const summary = summarizeKenoResult(data, {
              walletStake: Number(body.walletNetStakeAmount) || 0,
              anchorStake: Number(body.anchorNetStakeAmount) || 0
            });
            pushKenoHistory(summary, { persist: !opts.deferPersist });
            return summary;
          }

          async function runKenoAuto() {
            if (state.keno.autoRunning) {
              state.keno.autoRunning = false;
              renderKenoPanel();
              return;
            }
            const count = Math.max(1, Math.min(500, config.kenoAutoCount || 10));
            state.keno.autoRunning = true;
            renderKenoPanel();
            let wins = 0;
            let pnl = 0;
            const t0 = Date.now();
            try {
              await resolveKenoCurrencyForBet();
              await ensureExchangeRate(true);
            } catch (err) {
              state.keno.autoRunning = false;
              toast("Keno: " + err.message, "error");
              renderKenoPanel();
              return;
            }
            for (let i = 0; i < count && state.keno.autoRunning; i++) {
              try {
                const r = await playKenoOnce({ fast: true, deferPersist: true });
                if ((r.profit || 0) > 0) wins++;
                pnl += r.profit || 0;
                setStatus("Keno " + (i + 1) + "/" + count + " · x" + r.mult + " · " + r.hitCount + " hits", { quiet: true });
                updateKenoLiveResult(r, i + 1, count);
                if ((i + 1) % 15 === 0) persistConfig();
              } catch (err) {
                toast("Keno: " + err.message, "error");
                state.keno.autoRunning = false;
                break;
              }
              if (i < count - 1 && state.keno.autoRunning) {
                const delay = Math.max(0, Number(config.kenoAutoDelayMs) || 0);
                if (delay > 0) await new Promise(r => setTimeout(r, delay));
              }
            }
            persistConfig();
            state.keno.autoRunning = false;
            const sec = ((Date.now() - t0) / 1000).toFixed(1);
            toast("Auto Keno · " + wins + " wins · PnL " + pnl.toFixed(6) + " " + getKenoCurrency() + " · " + sec + "s", wins ? "success" : "info");
            setStatus("Keno auto terminé · " + sec + "s");
            renderKenoPanel();
          }

          function toggleKenoSpot(n) {
            n = Number(n);
            const idx = state.keno.spots.indexOf(n);
            if (idx >= 0) state.keno.spots.splice(idx, 1);
            else {
              if (state.keno.spots.length >= 10) {
                toast("Max 10 numéros", "warning");
                return;
              }
              state.keno.spots.push(n);
            }
            state.keno.spots.sort((a, b) => a - b);
            persistConfig();
            renderKenoPanel();
          }

          function randomKenoSpots(count) {
            count = Math.max(1, Math.min(10, count || 4));
            const pool = Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1);
            const picks = [];
            while (picks.length < count && pool.length) {
              const i = Math.floor(Math.random() * pool.length);
              picks.push(pool.splice(i, 1)[0]);
            }
            state.keno.spots = picks.sort((a, b) => a - b);
            persistConfig();
            renderKenoPanel();
          }

          function renderKenoPanel() {
            const box = document.getElementById("wb-games");
            if (!box) return;
            const last = state.keno.lastResult;
            const drawn = last ? new Set(last.result) : null;
            const picked = new Set(state.keno.spots);
            const stats = computeKenoStats();
            const kenoCur = getKenoCurrency();
            const cells = Array.from({ length: KENO_NUMBERS }, (_, i) => {
              const n = i + 1;
              let cls = "wb-keno-cell";
              if (picked.has(n)) cls += " pick";
              if (drawn && drawn.has(n)) cls += picked.has(n) ? " hit" : " drawn";
              return `<button type="button" class="${cls}" data-n="${n}">${n}</button>`;
            }).join("");

            const histRows = state.keno.history.slice(0, 30).map(h => {
              const profit = Number(h.profit) || 0;
              const cls = profit > 0 ? "ok" : (profit < 0 ? "err" : "");
              const cur = h.currency || kenoCur;
              const payout = h.wonWallet != null ? h.wonWallet : (Number(h.mult) || 0) * (Number(h.stake) || 0);
              return `<div class="wb-keno-hist ${cls}">
                <div class="wb-keno-hist-top">
                  <span>x${h.mult} · ${h.hitCount} hit</span>
                  <span class="pnl">${profit >= 0 ? "+" : ""}${formatKenoAmt(profit)} ${cur}</span>
                </div>
                <div class="wb-keno-hist-meta">mise ${formatKenoAmt(h.stake)} · retour ${formatKenoAmt(payout)} · ${formatKenoTime(h.ts)}</div>
              </div>`;
            }).join("");

            const lastLine = last
              ? `Dernier · x${last.mult} · ${last.hitCount} hits · ${(last.profit || 0) >= 0 ? "+" : ""}${formatKenoAmt(last.profit)} ${last.currency || kenoCur}`
              : "En attente d'un spin…";

            box.innerHTML = `
              ${gamesNavHtml()}
              <div class="wb-games-head">
                <div>
                  <div class="wb-section-title" style="margin:0 0 4px">Keno</div>
                  <div style="font-size:11px;color:var(--wb-muted)">Crypto auto · ${kenoCur}</div>
                </div>
              </div>
              <div class="wb-keno-grid">${cells}</div>
              <div class="wb-keno-toolbar">
                <button type="button" class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-keno-rand4">Random 4</button>
                <button type="button" class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-keno-rand8">Random 8</button>
                <button type="button" class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-keno-clear">Vider</button>
                <span style="font-size:11px;color:var(--wb-muted);margin-left:auto">${state.keno.spots.length}/10</span>
              </div>
              <div class="wb-keno-controls">
                <label>Mise (valeur $)
                  <input id="wb-keno-stake" type="number" min="0" step="any" value="${config.kenoStake}"/>
                </label>
                <label>Risque
                  <select id="wb-keno-risk">${KENO_RISK_PROFILES.map(r => `<option value="${r}"${r === config.kenoRisk ? " selected" : ""}>${r}</option>`).join("")}</select>
                </label>
                <label>Auto ×
                  <input id="wb-keno-auto-count" type="number" min="1" max="500" value="${config.kenoAutoCount}"/>
                </label>
                <label>Vitesse
                  <select id="wb-keno-speed">
                    <option value="instant"${config.kenoSpeed === "instant" ? " selected" : ""}>Instant (0 ms)</option>
                    <option value="fast"${config.kenoSpeed === "fast" ? " selected" : ""}>Rapide (30 ms)</option>
                    <option value="normal"${config.kenoSpeed === "normal" ? " selected" : ""}>Normal (150 ms)</option>
                    <option value="custom"${config.kenoSpeed === "custom" ? " selected" : ""}>Perso</option>
                  </select>
                </label>
                <label>Delay ms
                  <input id="wb-keno-auto-delay" type="number" min="0" max="5000" value="${config.kenoAutoDelayMs}"/>
                </label>
                <label>Playout ms
                  <input id="wb-keno-playout" type="number" min="0" max="2000" value="${config.kenoPlayoutMs}"/>
                </label>
              </div>
              <div class="wb-actions" style="margin-top:10px">
                <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-keno-play" ${state.keno.playing || state.keno.autoRunning ? "disabled" : ""}>Jouer</button>
                <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-keno-auto">${state.keno.autoRunning ? "Stop auto" : "Auto play"}</button>
              </div>
              <div class="wb-keno-last" id="wb-keno-live">${lastLine}</div>
              <div class="wb-section-title">Bilan session </div>
              <div class="wb-keno-stats" id="wb-keno-stats">${renderKenoStatsHtml(stats)}</div>
              <div class="wb-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span>Historique gains</span>
                <button type="button" class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-keno-clear-hist" style="color:var(--wb-red)">Vider</button>
              </div>
              <div class="wb-keno-hist-list" id="wb-keno-hist">${histRows || '<div class="wb-empty" style="padding:12px">Aucun coup encore</div>'}</div>
            `;

            bindGamesNav(box);
            box.querySelectorAll(".wb-keno-cell").forEach(btn => {
              btn.onclick = () => toggleKenoSpot(btn.dataset.n);
            });
            const stakeEl = document.getElementById("wb-keno-stake");
            if (stakeEl) stakeEl.onchange = e => {
              config.kenoStake = Math.max(0, parseFloat(e.target.value) || 0);
              persistConfig();
            };
            const riskEl = document.getElementById("wb-keno-risk");
            if (riskEl) riskEl.onchange = e => { config.kenoRisk = e.target.value; persistConfig(); };
            const ac = document.getElementById("wb-keno-auto-count");
            if (ac) ac.onchange = e => {
              config.kenoAutoCount = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 10));
              e.target.value = config.kenoAutoCount;
              persistConfig();
            };
            const speedEl = document.getElementById("wb-keno-speed");
            if (speedEl) speedEl.onchange = e => {
              if (e.target.value === "custom") {
                config.kenoSpeed = "custom";
                persistConfig();
              } else {
                applyKenoSpeedPreset(e.target.value);
              }
            };
            const ad = document.getElementById("wb-keno-auto-delay");
            if (ad) ad.onchange = e => {
              config.kenoAutoDelayMs = Math.max(0, Math.min(5000, parseInt(e.target.value, 10) || 0));
              e.target.value = config.kenoAutoDelayMs;
              config.kenoSpeed = "custom";
              persistConfig();
            };
            const pl = document.getElementById("wb-keno-playout");
            if (pl) pl.onchange = e => {
              config.kenoPlayoutMs = Math.max(0, Math.min(2000, parseInt(e.target.value, 10) || 0));
              e.target.value = config.kenoPlayoutMs;
              config.kenoSpeed = "custom";
              persistConfig();
            };
            document.getElementById("wb-keno-rand4").onclick = () => randomKenoSpots(4);
            document.getElementById("wb-keno-rand8").onclick = () => randomKenoSpots(8);
            document.getElementById("wb-keno-clear").onclick = () => {
              state.keno.spots = [];
              persistConfig();
              renderKenoPanel();
            };
            const clearHist = document.getElementById("wb-keno-clear-hist");
            if (clearHist) clearHist.onclick = () => {
              if (!confirm("Vider l'historique Keno et le bilan ?")) return;
              state.keno.history = [];
              state.keno.lastResult = null;
              persistConfig();
              renderKenoPanel();
            };
            document.getElementById("wb-keno-play").onclick = async () => {
              if (state.keno.playing || state.keno.autoRunning) return;
              state.keno.playing = true;
              renderKenoPanel();
              try {
                const r = await playKenoOnce();
                toast("Keno x" + r.mult + " · " + ((r.profit || 0) >= 0 ? "+" : "") + formatKenoAmt(r.profit) + " " + getKenoCurrency(), r.profit > 0 ? "success" : "info");
                setStatus("Keno x" + r.mult);
              } catch (err) {
                toast("Keno: " + err.message, "error");
              }
              state.keno.playing = false;
              renderKenoPanel();
            };
            document.getElementById("wb-keno-auto").onclick = () => runKenoAuto();
          }

          // --- Originaux (Dice) ------------------------------------------------------

          function gamesNavHtml() {
            const g = state.activeOriginal === "dice" ? "dice"
              : (state.activeOriginal === "limbo" ? "limbo" : "keno");
            return `<div class="wb-game-nav">
              <button type="button" class="wb-game-nav-btn${g === "keno" ? " active" : ""}" data-game="keno">Keno</button>
              <button type="button" class="wb-game-nav-btn${g === "dice" ? " active" : ""}" data-game="dice">Dice</button>
              <button type="button" class="wb-game-nav-btn${g === "limbo" ? " active" : ""}" data-game="limbo">Limbo</button>
            </div>`;
          }

          function bindGamesNav(root) {
            if (!root) return;
            root.querySelectorAll("[data-game]").forEach(btn => {
              btn.onclick = () => {
                const g = btn.dataset.game;
                const game = g === "dice" || g === "limbo" ? g : "keno";
                state._originalPickAt = Date.now();
                selectOriginalGame(game, { navigate: true });
              };
            });
          }

          function renderGamesPanel() {
            if (state.activeOriginal === "dice") renderDicePanel();
            else if (state.activeOriginal === "limbo") renderLimboPanel();
            else renderKenoPanel();
          }

          function clampDiceTarget(mode, raw) {
            let t = Number(raw);
            if (!Number.isFinite(t)) t = mode === "Under" ? 97.99 : 2;
            // Under 0.00 → chance 0.01% → multi max 9900 (pas 4950)
            if (mode === "Under") t = Math.min(98.02, Math.max(0, t));
            else t = Math.min(100, Math.max(1.98, t));
            return Math.round(t * 100) / 100;
          }

          function truncDiceMult(n) {
            return Math.floor(Number(n) * 10000 + 1e-8) / 10000;
          }

          // Thrill : plage inclusive → chance = (to - from) + 0.01
          // Under 97.99 → 98.00% → x1.0102 | Under 0 → 0.01% → x9900
          function diceWinChance(mode, target) {
            const t = clampDiceTarget(mode, target);
            if (mode === "Over") return Math.round((100 - t + 0.01) * 100) / 100;
            return Math.round((t + 0.01) * 100) / 100;
          }

          function calcDicePayoutMultiplier(mode, target) {
            const chanceCents = Math.round(diceWinChance(mode, target) * 100);
            if (chanceCents <= 0) return 1;
            // 99 / (cents/100) = 9900/cents — évite les 4949.9999 float
            return Math.floor((9900 / chanceCents) * 10000 + 1e-8) / 10000;
          }

          // Inverse : chance = 99 / multi → seuil, puis ajuster pour multi réel ≥ cible
          function thresholdFromMultiplier(mode, mult) {
            const desired = Math.max(1.01, Math.min(9900, Number(mult) || 1.01));
            const desiredTrunc = truncDiceMult(desired);
            const chance = (100 - DICE_HOUSE_EDGE) / desired;
            if (mode === "Under") {
              let t = clampDiceTarget("Under", Math.round((chance - 0.01) * 100) / 100);
              for (let i = 0; i < 50 && calcDicePayoutMultiplier("Under", t) < desiredTrunc && t > 0; i++) {
                t = clampDiceTarget("Under", t - 0.01);
              }
              return t;
            }
            let t = clampDiceTarget("Over", Math.round((100 - chance + 0.01) * 100) / 100);
            for (let i = 0; i < 50 && calcDicePayoutMultiplier("Over", t) < desiredTrunc && t < 100; i++) {
              t = clampDiceTarget("Over", t + 0.01);
            }
            return t;
          }

          function applyDiceMultiplier(mult, mode) {
            const m = mode || (config.diceMode === "Over" ? "Over" : "Under");
            config.diceMode = m;
            config.diceMult = truncDiceMult(Math.max(1.01, Math.min(9900, Number(mult) || 1.01)));
            config.diceTarget = thresholdFromMultiplier(m, config.diceMult);
            // Aligner le multi affiché sur celui réellement envoyé à Thrill
            config.diceMult = calcDicePayoutMultiplier(m, config.diceTarget);
            persistConfig();
          }

          function buildDiceCoverage(mode, target) {
            const t = clampDiceTarget(mode, target);
            if (mode === "Over") return [{ fromValue: t, toValue: 100 }];
            return [{ fromValue: 0, toValue: t }];
          }

          function buildDicePayload(rate) {
            const stake = Math.max(0, Number(config.kenoStake) || 0);
            const fx = Number(rate);
            const cur = getKenoCurrency();
            if (!Number.isFinite(fx) || fx <= 0) throw new Error("Taux FX invalide");
            if (fx === 1 && cur !== "EUR") throw new Error("Taux FX invalide (1.0)");

            const mode = config.diceMode === "Over" ? "Over" : "Under";
            if (!config.diceMult || config.diceMult < 1.01) config.diceMult = 1.01;
            const target = thresholdFromMultiplier(mode, config.diceMult);
            config.diceTarget = target;
            const payoutMultiplier = calcDicePayoutMultiplier(mode, target);
            config.diceMult = payoutMultiplier;

            // Même logique crypto auto que Keno (qui marche)
            const walletStake = +Number(stake).toFixed(12);
            const anchorStake = +(walletStake / fx).toFixed(12);

            return {
              inputInAnchorCurrency: false,
              walletCurrencyIsoCode: cur,
              anchorCurrencyIsoCode: "EUR",
              anchorToWalletExchangeRate: fx,
              walletNetStakeAmount: walletStake,
              anchorNetStakeAmount: anchorStake,
              coverage: buildDiceCoverage(mode, target),
              payoutMultiplier,
              gameMode: mode,
              playoutTimeMilliseconds: Math.max(0, Number(config.kenoPlayoutMs) || 0)
            };
          }

          function summarizeDiceResult(data, betInfo) {
            const d = data?.data || data || {};
            const mult = Number(d.wonMultiplier) || 0;
            const wonWallet = d.wonWalletGrossAmount != null ? Number(d.wonWalletGrossAmount) : null;
            const result = d.result != null ? Number(d.result) : null;
            const stakeWallet = Number(betInfo?.walletStake != null ? betInfo.walletStake : config.kenoStake) || 0;
            const payout = wonWallet != null ? wonWallet : mult * stakeWallet;
            const profit = payout - stakeWallet;
            return {
              roundId: d.roundId || "",
              result,
              mult,
              wonWallet: payout,
              stake: stakeWallet,
              profit,
              currency: getKenoCurrency(),
              mode: betInfo?.mode || config.diceMode,
              target: betInfo?.target != null ? betInfo.target : config.diceTarget,
              ts: Date.now()
            };
          }

          function pushDiceHistory(summary, opts) {
            state.dice.lastResult = summary;
            state.dice.history.unshift(summary);
            if (state.dice.history.length > 200) state.dice.history.length = 200;
            if (!opts || opts.persist !== false) persistConfig();
          }

          function computeDiceStats(list) {
            const rows = list || state.dice.history || [];
            const cur = getKenoCurrency();
            const scoped = rows.filter(h => !h.currency || h.currency === cur);
            let wagered = 0, returned = 0, wins = 0, bestMult = 0;
            for (const h of scoped) {
              const stake = Number(h.stake) || 0;
              const payout = h.wonWallet != null ? Number(h.wonWallet) : (Number(h.mult) || 0) * stake;
              const profit = h.profit != null ? Number(h.profit) : payout - stake;
              wagered += stake;
              returned += payout;
              if (profit > 0) wins++;
              if ((Number(h.mult) || 0) > bestMult) bestMult = Number(h.mult) || 0;
            }
            const spins = scoped.length;
            return {
              spins,
              wins,
              losses: Math.max(0, spins - wins),
              winRate: spins ? Math.round(wins / spins * 100) : 0,
              wagered,
              returned,
              profit: returned - wagered,
              bestMult,
              currency: cur
            };
          }

          function renderDiceStatsHtml(s) {
            const pnlCls = s.profit > 0 ? "ok" : (s.profit < 0 ? "err" : "");
            return `
              <div class="wb-keno-stat"><span class="k">Spins</span><span class="v">${s.spins}</span></div>
              <div class="wb-keno-stat"><span class="k">Wins</span><span class="v" style="color:var(--wb-green)">${s.wins}</span></div>
              <div class="wb-keno-stat"><span class="k">Winrate</span><span class="v">${s.winRate}%</span></div>
              <div class="wb-keno-stat"><span class="k">Best</span><span class="v">x${formatKenoAmt(s.bestMult, 4)}</span></div>
              <div class="wb-keno-stat"><span class="k">Misés</span><span class="v">${formatKenoAmt(s.wagered)} ${s.currency}</span></div>
              <div class="wb-keno-stat"><span class="k">Retours</span><span class="v">${formatKenoAmt(s.returned)} ${s.currency}</span></div>
              <div class="wb-keno-stat wide ${pnlCls}"><span class="k">Profit</span><span class="v">${s.profit >= 0 ? "+" : ""}${formatKenoAmt(s.profit)} ${s.currency}</span></div>
            `;
          }

          function updateDiceLiveResult(r, i, total) {
            const live = document.getElementById("wb-dice-live");
            if (live) {
              const sign = (r.profit || 0) >= 0 ? "+" : "";
              live.textContent = (total ? i + "/" + total + " · " : "") +
                "roll " + (r.result != null ? r.result : "?") + " · x" + r.mult + " · " +
                sign + formatKenoAmt(r.profit) + " " + (r.currency || getKenoCurrency());
            }
            // Stats / hist seulement tous les 3 spins en auto (moins de DOM)
            const refreshHeavy = !total || i === total || i % 3 === 0;
            if (refreshHeavy) {
              const statsBox = document.getElementById("wb-dice-stats");
              if (statsBox) statsBox.innerHTML = renderDiceStatsHtml(computeDiceStats());
              const histBox = document.getElementById("wb-dice-hist");
              if (histBox && state.dice.history.length) {
                const empty = histBox.querySelector(".wb-empty");
                if (empty) empty.remove();
                const h = state.dice.history[0];
                const profit = Number(h.profit) || 0;
                const cls = profit > 0 ? "ok" : (profit < 0 ? "err" : "");
                const row = document.createElement("div");
                row.className = "wb-keno-hist " + cls;
                row.innerHTML = `
                  <div class="wb-keno-hist-top">
                    <span>${h.mode || "Under"} ${h.target} · roll ${h.result} · x${h.mult}</span>
                    <span class="pnl">${profit >= 0 ? "+" : ""}${formatKenoAmt(profit)} ${h.currency || getKenoCurrency()}</span>
                  </div>
                  <div class="wb-keno-hist-meta">mise ${formatKenoAmt(h.stake)} · ${formatKenoTime(h.ts)}</div>
                `;
                histBox.insertBefore(row, histBox.firstChild);
                while (histBox.children.length > 30) histBox.removeChild(histBox.lastChild);
              }
            }
          }

          async function playDiceOnce(opts) {
            opts = opts || {};
            activatePlayerTokenForGame("dice");
            if (!getPlayerTokenForProduct("thrill-dice")) {
              if (!isOnOriginalsGamePage("dice")) {
                selectOriginalGame("dice", { navigate: true });
                throw new Error("Ouverture Dice pour sync token — reclique Jouer ensuite");
              }
              throw new Error("Token joueur manquant — ouvre Dice une fois sur thrill.com");
            }
            if (!opts.fast) await resolveKenoCurrencyForBet();
            // En auto: cache FX jusqu'à 5 min — évite Binance à chaque spin
            let rate = await ensureExchangeRate(!!opts.forceFx, opts.fast ? 300000 : 60000);
            let body = buildDicePayload(rate);
            let { status, data } = await postGameBet("/v1/dice/bet", "thrill-dice", body, {
              preferDirect: !!opts.fast
            });

            const msg = String(data?.message || data?.error || data?.responseCode || "");
            const invalidFx = /exchange rate is invalid/i.test(msg) || /invalid.*exchange/i.test(msg);
            if (invalidFx) {
              clearExchangeRate();
              rate = await ensureExchangeRate(true);
              body = buildDicePayload(rate);
              ({ status, data } = await postGameBet("/v1/dice/bet", "thrill-dice", body, {
                preferDirect: !!opts.fast
              }));
            }

            if (status >= 400 || (data && data.responseCode && data.responseCode !== "OK")) {
              const errMsg = data?.message || data?.error || data?.responseCode || ("HTTP " + status);
              if (/exchange rate is invalid/i.test(String(errMsg))) {
                clearExchangeRate();
                throw new Error("Taux FX rejeté par Thrill — nouvel essai au prochain spin");
              }
              if (/insufficient|not enough|balance|fonds|pas assez|argent/i.test(String(errMsg))) {
                throw new Error("Solde " + getKenoCurrency() + " insuffisant (mise " +
                  (body.walletNetStakeAmount || "?") + " " + getKenoCurrency() + ")");
              }
              throw new Error(String(errMsg));
            }

            const summary = summarizeDiceResult(data, {
              walletStake: Number(body.walletNetStakeAmount) || 0,
              mode: body.gameMode,
              target: body.coverage && body.coverage[0]
                ? (body.gameMode === "Over" ? body.coverage[0].fromValue : body.coverage[0].toValue)
                : config.diceTarget
            });
            pushDiceHistory(summary, { persist: !opts.deferPersist });
            return summary;
          }

          async function runDiceAuto() {
            if (state.dice.autoRunning) {
              state.dice.autoRunning = false;
              renderDicePanel();
              return;
            }
            const count = Math.max(1, Math.min(500, config.kenoAutoCount || 10));
            state.dice.autoRunning = true;
            renderDicePanel();
            let wins = 0;
            let pnl = 0;
            const t0 = Date.now();
            try {
              await resolveKenoCurrencyForBet();
              await ensureExchangeRate(true);
            } catch (err) {
              state.dice.autoRunning = false;
              toast("Dice: " + err.message, "error");
              renderDicePanel();
              return;
            }
            for (let i = 0; i < count && state.dice.autoRunning; i++) {
              try {
                const r = await playDiceOnce({ fast: true, deferPersist: true });
                if ((r.profit || 0) > 0) wins++;
                pnl += r.profit || 0;
                setStatus("Dice " + (i + 1) + "/" + count + " · " + r.result + " · x" + r.mult, { quiet: true });
                updateDiceLiveResult(r, i + 1, count);
                if ((i + 1) % 15 === 0) persistConfig();
              } catch (err) {
                toast("Dice: " + err.message, "error");
                state.dice.autoRunning = false;
                break;
              }
              if (i < count - 1 && state.dice.autoRunning) {
                const delay = Math.max(0, Number(config.kenoAutoDelayMs) || 0);
                if (delay > 0) await new Promise(r => setTimeout(r, delay));
              }
            }
            persistConfig();
            state.dice.autoRunning = false;
            const sec = ((Date.now() - t0) / 1000).toFixed(1);
            toast("Auto Dice · " + wins + " wins · PnL " + pnl.toFixed(6) + " " + getKenoCurrency() + " · " + sec + "s", wins ? "success" : "info");
            setStatus("Dice auto terminé · " + sec + "s");
            renderDicePanel();
          }

          function renderDicePanel() {
            const box = document.getElementById("wb-games");
            if (!box) return;
            const cur = getKenoCurrency();
            const mode = config.diceMode === "Over" ? "Over" : "Under";
            // Toujours dériver le seuil depuis le multi cible
            if (!config.diceMult || config.diceMult < 1.01) config.diceMult = 1.01;
            config.diceTarget = thresholdFromMultiplier(mode, config.diceMult);
            const target = config.diceTarget;
            const mult = calcDicePayoutMultiplier(mode, target);
            config.diceMult = mult;
            const chance = diceWinChance(mode, target);
            const stats = computeDiceStats();
            const last = state.dice.lastResult;

            const histRows = state.dice.history.slice(0, 30).map(h => {
              const profit = Number(h.profit) || 0;
              const cls = profit > 0 ? "ok" : (profit < 0 ? "err" : "");
              return `<div class="wb-keno-hist ${cls}">
                <div class="wb-keno-hist-top">
                  <span>${h.mode || "Under"} x${h.mult} · roll ${h.result}</span>
                  <span class="pnl">${profit >= 0 ? "+" : ""}${formatKenoAmt(profit)} ${h.currency || cur}</span>
                </div>
                <div class="wb-keno-hist-meta">mise ${formatKenoAmt(h.stake)} · ${formatKenoTime(h.ts)}</div>
              </div>`;
            }).join("");

            const lastLine = last
              ? `Dernier · roll ${last.result} · x${last.mult} · ${(last.profit || 0) >= 0 ? "+" : ""}${formatKenoAmt(last.profit)} ${last.currency || cur}`
              : "En attente d'un roll…";

            box.innerHTML = `
              ${gamesNavHtml()}
              <div class="wb-games-head">
                <div>
                  <div class="wb-section-title" style="margin:0 0 4px">Dice</div>
                  <div style="font-size:11px;color:var(--wb-muted)">Crypto auto · ${cur} · ${mode} ${target} · win ~${chance.toFixed(2)}%</div>
                </div>
              </div>
              <div class="wb-keno-controls">
                <label>Mode
                  <select id="wb-dice-mode">
                    <option value="Under"${mode === "Under" ? " selected" : ""}>Under</option>
                    <option value="Over"${mode === "Over" ? " selected" : ""}>Over</option>
                  </select>
                </label>
                <label>Multi cible
                  <input id="wb-dice-mult" type="number" min="1.01" max="9900" step="0.01" value="${mult}"/>
                </label>
                <label>Mise (${cur})
                  <input id="wb-dice-stake" type="number" min="0" step="any" value="${config.kenoStake}"/>
                </label>
                <label>Auto ×
                  <input id="wb-dice-auto-count" type="number" min="1" max="500" value="${config.kenoAutoCount}"/>
                </label>
                <label>Vitesse
                  <select id="wb-dice-speed">
                    <option value="instant"${config.kenoSpeed === "instant" ? " selected" : ""}>Instant (0 ms)</option>
                    <option value="fast"${config.kenoSpeed === "fast" ? " selected" : ""}>Rapide (30 ms)</option>
                    <option value="normal"${config.kenoSpeed === "normal" ? " selected" : ""}>Normal (150 ms)</option>
                    <option value="custom"${config.kenoSpeed === "custom" ? " selected" : ""}>Perso</option>
                  </select>
                </label>
                <label>Delay ms
                  <input id="wb-dice-auto-delay" type="number" min="0" max="5000" value="${config.kenoAutoDelayMs}"/>
                </label>
              </div>
              <div class="wb-actions" style="margin-top:10px">
                <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-dice-play" ${state.dice.playing || state.dice.autoRunning ? "disabled" : ""}>Jouer</button>
                <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-dice-auto">${state.dice.autoRunning ? "Stop auto" : "Auto play"}</button>
              </div>
              <div class="wb-keno-last" id="wb-dice-live">${lastLine}</div>
              <div class="wb-section-title">Bilan (${cur})</div>
              <div class="wb-keno-stats" id="wb-dice-stats">${renderDiceStatsHtml(stats)}</div>
              <div class="wb-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span>Historique gains</span>
                <button type="button" class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-dice-clear-hist" style="color:var(--wb-red)">Vider</button>
              </div>
              <div class="wb-keno-hist-list" id="wb-dice-hist">${histRows || '<div class="wb-empty" style="padding:12px">Aucun roll encore</div>'}</div>
            `;

            bindGamesNav(box);

            const modeEl = document.getElementById("wb-dice-mode");
            if (modeEl) modeEl.onchange = e => {
              applyDiceMultiplier(config.diceMult || mult, e.target.value === "Over" ? "Over" : "Under");
              renderDicePanel();
            };
            const multEl = document.getElementById("wb-dice-mult");
            if (multEl) multEl.onchange = e => {
              applyDiceMultiplier(e.target.value, mode);
              renderDicePanel();
            };
            const stakeEl = document.getElementById("wb-dice-stake");
            if (stakeEl) stakeEl.onchange = e => {
              config.kenoStake = Math.max(0, parseFloat(e.target.value) || 0);
              persistConfig();
            };
            const ac = document.getElementById("wb-dice-auto-count");
            if (ac) ac.onchange = e => {
              config.kenoAutoCount = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 10));
              e.target.value = config.kenoAutoCount;
              persistConfig();
            };
            const speedEl = document.getElementById("wb-dice-speed");
            if (speedEl) speedEl.onchange = e => {
              if (e.target.value === "custom") {
                config.kenoSpeed = "custom";
                persistConfig();
              } else {
                applyKenoSpeedPreset(e.target.value);
              }
            };
            const ad = document.getElementById("wb-dice-auto-delay");
            if (ad) ad.onchange = e => {
              config.kenoAutoDelayMs = Math.max(0, Math.min(5000, parseInt(e.target.value, 10) || 0));
              e.target.value = config.kenoAutoDelayMs;
              config.kenoSpeed = "custom";
              persistConfig();
            };
            document.getElementById("wb-dice-clear-hist").onclick = () => {
              if (!confirm("Vider l'historique Dice et le bilan ?")) return;
              state.dice.history = [];
              state.dice.lastResult = null;
              persistConfig();
              renderDicePanel();
            };
            document.getElementById("wb-dice-play").onclick = async () => {
              if (state.dice.playing || state.dice.autoRunning) return;
              state.dice.playing = true;
              renderDicePanel();
              try {
                const r = await playDiceOnce();
                toast("Dice " + r.result + " · x" + r.mult + " · " + ((r.profit || 0) >= 0 ? "+" : "") + formatKenoAmt(r.profit) + " " + getKenoCurrency(), r.profit > 0 ? "success" : "info");
                setStatus("Dice " + r.result + " · x" + r.mult);
              } catch (err) {
                toast("Dice: " + err.message, "error");
              }
              state.dice.playing = false;
              renderDicePanel();
            };
            document.getElementById("wb-dice-auto").onclick = () => runDiceAuto();
          }

          // --- Originaux (Limbo) -----------------------------------------------------

          function clampLimboMult(raw) {
            let m = Number(raw);
            if (!Number.isFinite(m) || m < 1.01) m = 1.01;
            if (m > 1000000) m = 1000000;
            // 2 décimales (comme le résultat Limbo Thrill)
            return Math.round(m * 100) / 100;
          }

          function buildLimboPayload(rate) {
            const stake = Math.max(0, Number(config.kenoStake) || 0);
            const fx = Number(rate);
            const cur = getKenoCurrency();
            if (!Number.isFinite(fx) || fx <= 0) throw new Error("Taux FX invalide");
            if (fx === 1 && cur !== "EUR") throw new Error("Taux FX invalide (1.0)");

            const payoutMultiplier = clampLimboMult(config.limboMult || 2);
            config.limboMult = payoutMultiplier;

            const walletStake = +Number(stake).toFixed(12);
            const anchorStake = +(walletStake / fx).toFixed(12);

            return {
              inputInAnchorCurrency: false,
              walletCurrencyIsoCode: cur,
              anchorCurrencyIsoCode: "EUR",
              anchorToWalletExchangeRate: fx,
              walletNetStakeAmount: walletStake,
              anchorNetStakeAmount: anchorStake,
              payoutMultiplier,
              playoutTimeMilliseconds: Math.max(0, Number(config.kenoPlayoutMs) || 0)
            };
          }

          function summarizeLimboResult(data, betInfo) {
            const d = data?.data || data || {};
            const mult = Number(d.wonMultiplier) || 0;
            const wonWallet = d.wonWalletGrossAmount != null ? Number(d.wonWalletGrossAmount) : null;
            const result = d.result != null ? Number(d.result) : null;
            const stakeWallet = Number(betInfo?.walletStake != null ? betInfo.walletStake : config.kenoStake) || 0;
            const target = betInfo?.target != null ? betInfo.target : config.limboMult;
            const payout = wonWallet != null ? wonWallet : mult * stakeWallet;
            const profit = payout - stakeWallet;
            return {
              roundId: d.roundId || "",
              result,
              mult,
              target,
              wonWallet: payout,
              stake: stakeWallet,
              profit,
              currency: getKenoCurrency(),
              ts: Date.now()
            };
          }

          function pushLimboHistory(summary, opts) {
            state.limbo.lastResult = summary;
            state.limbo.history.unshift(summary);
            if (state.limbo.history.length > 200) state.limbo.history.length = 200;
            if (!opts || opts.persist !== false) persistConfig();
          }

          function computeLimboStats(list) {
            const rows = list || state.limbo.history || [];
            const cur = getKenoCurrency();
            const scoped = rows.filter(h => !h.currency || h.currency === cur);
            let wagered = 0, returned = 0, wins = 0, bestMult = 0;
            for (const h of scoped) {
              const stake = Number(h.stake) || 0;
              const payout = h.wonWallet != null ? Number(h.wonWallet) : (Number(h.mult) || 0) * stake;
              const profit = h.profit != null ? Number(h.profit) : payout - stake;
              wagered += stake;
              returned += payout;
              if (profit > 0) wins++;
              if ((Number(h.mult) || 0) > bestMult) bestMult = Number(h.mult) || 0;
            }
            const spins = scoped.length;
            return {
              spins,
              wins,
              losses: Math.max(0, spins - wins),
              winRate: spins ? Math.round(wins / spins * 100) : 0,
              wagered,
              returned,
              profit: returned - wagered,
              bestMult,
              currency: cur
            };
          }

          function renderLimboStatsHtml(s) {
            const pnlCls = s.profit > 0 ? "ok" : (s.profit < 0 ? "err" : "");
            return `
              <div class="wb-keno-stat"><span class="k">Spins</span><span class="v">${s.spins}</span></div>
              <div class="wb-keno-stat"><span class="k">Wins</span><span class="v" style="color:var(--wb-green)">${s.wins}</span></div>
              <div class="wb-keno-stat"><span class="k">Winrate</span><span class="v">${s.winRate}%</span></div>
              <div class="wb-keno-stat"><span class="k">Best</span><span class="v">x${formatKenoAmt(s.bestMult, 2)}</span></div>
              <div class="wb-keno-stat"><span class="k">Misés</span><span class="v">${formatKenoAmt(s.wagered)} ${s.currency}</span></div>
              <div class="wb-keno-stat"><span class="k">Retours</span><span class="v">${formatKenoAmt(s.returned)} ${s.currency}</span></div>
              <div class="wb-keno-stat wide ${pnlCls}"><span class="k">Profit</span><span class="v">${s.profit >= 0 ? "+" : ""}${formatKenoAmt(s.profit)} ${s.currency}</span></div>
            `;
          }

          function updateLimboLiveResult(r, i, total) {
            const live = document.getElementById("wb-limbo-live");
            if (live) {
              const sign = (r.profit || 0) >= 0 ? "+" : "";
              live.textContent = (total ? i + "/" + total + " · " : "") +
                "result " + (r.result != null ? r.result : "?") + " · cible x" + r.target + " · " +
                sign + formatKenoAmt(r.profit) + " " + (r.currency || getKenoCurrency());
            }
            const refreshHeavy = !total || i === total || i % 3 === 0;
            if (refreshHeavy) {
              const statsBox = document.getElementById("wb-limbo-stats");
              if (statsBox) statsBox.innerHTML = renderLimboStatsHtml(computeLimboStats());
              const histBox = document.getElementById("wb-limbo-hist");
              if (histBox && state.limbo.history.length) {
                const empty = histBox.querySelector(".wb-empty");
                if (empty) empty.remove();
                const h = state.limbo.history[0];
                const profit = Number(h.profit) || 0;
                const cls = profit > 0 ? "ok" : (profit < 0 ? "err" : "");
                const row = document.createElement("div");
                row.className = "wb-keno-hist " + cls;
                row.innerHTML = `
                  <div class="wb-keno-hist-top">
                    <span>x${h.target} · result ${h.result} · win x${h.mult}</span>
                    <span class="pnl">${profit >= 0 ? "+" : ""}${formatKenoAmt(profit)} ${h.currency || getKenoCurrency()}</span>
                  </div>
                  <div class="wb-keno-hist-meta">mise ${formatKenoAmt(h.stake)} · ${formatKenoTime(h.ts)}</div>
                `;
                histBox.insertBefore(row, histBox.firstChild);
                while (histBox.children.length > 30) histBox.removeChild(histBox.lastChild);
              }
            }
          }

          async function playLimboOnce(opts) {
            opts = opts || {};
            activatePlayerTokenForGame("limbo");
            if (!getPlayerTokenForProduct("thrill-limbo")) {
              if (!isOnOriginalsGamePage("limbo")) {
                selectOriginalGame("limbo", { navigate: true });
                throw new Error("Ouverture Limbo pour sync token — reclique Jouer ensuite");
              }
              throw new Error("Token joueur manquant — ouvre Limbo une fois sur thrill.com");
            }
            if (!opts.fast) await resolveKenoCurrencyForBet();
            let rate = await ensureExchangeRate(!!opts.forceFx, opts.fast ? 300000 : 60000);
            let body = buildLimboPayload(rate);
            let { status, data } = await postGameBet("/v1/limbo/bet", "thrill-limbo", body, {
              preferDirect: !!opts.fast
            });

            const msg = String(data?.message || data?.error || data?.responseCode || "");
            const invalidFx = /exchange rate is invalid/i.test(msg) || /invalid.*exchange/i.test(msg);
            if (invalidFx) {
              clearExchangeRate();
              rate = await ensureExchangeRate(true);
              body = buildLimboPayload(rate);
              ({ status, data } = await postGameBet("/v1/limbo/bet", "thrill-limbo", body, {
                preferDirect: !!opts.fast
              }));
            }

            if (status >= 400 || (data && data.responseCode && data.responseCode !== "OK")) {
              const errMsg = data?.message || data?.error || data?.responseCode || ("HTTP " + status);
              if (/exchange rate is invalid/i.test(String(errMsg))) {
                clearExchangeRate();
                throw new Error("Taux FX rejeté par Thrill — nouvel essai au prochain spin");
              }
              if (/insufficient|not enough|balance|fonds|pas assez|argent/i.test(String(errMsg))) {
                throw new Error("Solde " + getKenoCurrency() + " insuffisant (mise " +
                  (body.walletNetStakeAmount || "?") + " " + getKenoCurrency() + ")");
              }
              throw new Error(String(errMsg));
            }

            const summary = summarizeLimboResult(data, {
              walletStake: Number(body.walletNetStakeAmount) || 0,
              target: body.payoutMultiplier
            });
            pushLimboHistory(summary, { persist: !opts.deferPersist });
            return summary;
          }

          async function runLimboAuto() {
            if (state.limbo.autoRunning) {
              state.limbo.autoRunning = false;
              renderLimboPanel();
              return;
            }
            const count = Math.max(1, Math.min(500, config.kenoAutoCount || 10));
            state.limbo.autoRunning = true;
            renderLimboPanel();
            let wins = 0;
            let pnl = 0;
            const t0 = Date.now();
            try {
              await resolveKenoCurrencyForBet();
              await ensureExchangeRate(true);
            } catch (err) {
              state.limbo.autoRunning = false;
              toast("Limbo: " + err.message, "error");
              renderLimboPanel();
              return;
            }
            for (let i = 0; i < count && state.limbo.autoRunning; i++) {
              try {
                const r = await playLimboOnce({ fast: true, deferPersist: true });
                if ((r.profit || 0) > 0) wins++;
                pnl += r.profit || 0;
                setStatus("Limbo " + (i + 1) + "/" + count + " · " + r.result + " · x" + r.target, { quiet: true });
                updateLimboLiveResult(r, i + 1, count);
                if ((i + 1) % 15 === 0) persistConfig();
              } catch (err) {
                toast("Limbo: " + err.message, "error");
                state.limbo.autoRunning = false;
                break;
              }
              if (i < count - 1 && state.limbo.autoRunning) {
                const delay = Math.max(0, Number(config.kenoAutoDelayMs) || 0);
                if (delay > 0) await new Promise(r => setTimeout(r, delay));
              }
            }
            persistConfig();
            state.limbo.autoRunning = false;
            const sec = ((Date.now() - t0) / 1000).toFixed(1);
            toast("Auto Limbo · " + wins + " wins · PnL " + pnl.toFixed(6) + " " + getKenoCurrency() + " · " + sec + "s", wins ? "success" : "info");
            setStatus("Limbo auto terminé · " + sec + "s");
            renderLimboPanel();
          }

          function renderLimboPanel() {
            const box = document.getElementById("wb-games");
            if (!box) return;
            const cur = getKenoCurrency();
            const mult = clampLimboMult(config.limboMult || 2);
            config.limboMult = mult;
            const chance = (100 - DICE_HOUSE_EDGE) / mult; // % win approx RTP 99%
            const stats = computeLimboStats();
            const last = state.limbo.lastResult;

            const histRows = state.limbo.history.slice(0, 30).map(h => {
              const profit = Number(h.profit) || 0;
              const cls = profit > 0 ? "ok" : (profit < 0 ? "err" : "");
              return `<div class="wb-keno-hist ${cls}">
                <div class="wb-keno-hist-top">
                  <span>x${h.target} · result ${h.result} · win x${h.mult}</span>
                  <span class="pnl">${profit >= 0 ? "+" : ""}${formatKenoAmt(profit)} ${h.currency || cur}</span>
                </div>
                <div class="wb-keno-hist-meta">mise ${formatKenoAmt(h.stake)} · ${formatKenoTime(h.ts)}</div>
              </div>`;
            }).join("");

            const lastLine = last
              ? `Dernier · result ${last.result} · cible x${last.target} · ${(last.profit || 0) >= 0 ? "+" : ""}${formatKenoAmt(last.profit)} ${last.currency || cur}`
              : "En attente d'un spin…";

            box.innerHTML = `
              ${gamesNavHtml()}
              <div class="wb-games-head">
                <div>
                  <div class="wb-section-title" style="margin:0 0 4px">Limbo</div>
                  <div style="font-size:11px;color:var(--wb-muted)">Crypto auto · ${cur} · cible x${mult} · win ~${chance.toFixed(2)}%</div>
                </div>
              </div>
              <div class="wb-keno-controls">
                <label>Multi cible
                  <input id="wb-limbo-mult" type="number" min="1.01" max="1000000" step="0.01" value="${mult}"/>
                </label>
                <label>Mise (${cur})
                  <input id="wb-limbo-stake" type="number" min="0" step="any" value="${config.kenoStake}"/>
                </label>
                <label>Auto ×
                  <input id="wb-limbo-auto-count" type="number" min="1" max="500" value="${config.kenoAutoCount}"/>
                </label>
                <label>Vitesse
                  <select id="wb-limbo-speed">
                    <option value="instant"${config.kenoSpeed === "instant" ? " selected" : ""}>Instant (0 ms)</option>
                    <option value="fast"${config.kenoSpeed === "fast" ? " selected" : ""}>Rapide (30 ms)</option>
                    <option value="normal"${config.kenoSpeed === "normal" ? " selected" : ""}>Normal (150 ms)</option>
                    <option value="custom"${config.kenoSpeed === "custom" ? " selected" : ""}>Perso</option>
                  </select>
                </label>
                <label>Delay ms
                  <input id="wb-limbo-auto-delay" type="number" min="0" max="5000" value="${config.kenoAutoDelayMs}"/>
                </label>
              </div>
              <div class="wb-actions" style="margin-top:10px">
                <button class="wb-btn wb-btn-primary wb-btn-sm" id="wb-limbo-play" ${state.limbo.playing || state.limbo.autoRunning ? "disabled" : ""}>Jouer</button>
                <button class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-limbo-auto">${state.limbo.autoRunning ? "Stop auto" : "Auto play"}</button>
              </div>
              <div class="wb-keno-last" id="wb-limbo-live">${lastLine}</div>
              <div class="wb-section-title">Bilan (${cur})</div>
              <div class="wb-keno-stats" id="wb-limbo-stats">${renderLimboStatsHtml(stats)}</div>
              <div class="wb-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span>Historique gains</span>
                <button type="button" class="wb-btn wb-btn-ghost wb-btn-sm" id="wb-limbo-clear-hist" style="color:var(--wb-red)">Vider</button>
              </div>
              <div class="wb-keno-hist-list" id="wb-limbo-hist">${histRows || '<div class="wb-empty" style="padding:12px">Aucun spin encore</div>'}</div>
            `;

            bindGamesNav(box);

            const multEl = document.getElementById("wb-limbo-mult");
            if (multEl) multEl.onchange = e => {
              config.limboMult = clampLimboMult(e.target.value);
              e.target.value = config.limboMult;
              persistConfig();
              renderLimboPanel();
            };
            const stakeEl = document.getElementById("wb-limbo-stake");
            if (stakeEl) stakeEl.onchange = e => {
              config.kenoStake = Math.max(0, parseFloat(e.target.value) || 0);
              persistConfig();
            };
            const ac = document.getElementById("wb-limbo-auto-count");
            if (ac) ac.onchange = e => {
              config.kenoAutoCount = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 10));
              e.target.value = config.kenoAutoCount;
              persistConfig();
            };
            const speedEl = document.getElementById("wb-limbo-speed");
            if (speedEl) speedEl.onchange = e => {
              if (e.target.value === "custom") {
                config.kenoSpeed = "custom";
                persistConfig();
              } else {
                applyKenoSpeedPreset(e.target.value);
              }
            };
            const ad = document.getElementById("wb-limbo-auto-delay");
            if (ad) ad.onchange = e => {
              config.kenoAutoDelayMs = Math.max(0, Math.min(5000, parseInt(e.target.value, 10) || 0));
              e.target.value = config.kenoAutoDelayMs;
              config.kenoSpeed = "custom";
              persistConfig();
            };
            document.getElementById("wb-limbo-clear-hist").onclick = () => {
              if (!confirm("Vider l'historique Limbo et le bilan ?")) return;
              state.limbo.history = [];
              state.limbo.lastResult = null;
              persistConfig();
              renderLimboPanel();
            };
            document.getElementById("wb-limbo-play").onclick = async () => {
              if (state.limbo.playing || state.limbo.autoRunning) return;
              state.limbo.playing = true;
              renderLimboPanel();
              try {
                const r = await playLimboOnce();
                toast("Limbo " + r.result + " · x" + r.target + " · " + ((r.profit || 0) >= 0 ? "+" : "") + formatKenoAmt(r.profit) + " " + getKenoCurrency(), r.profit > 0 ? "success" : "info");
                setStatus("Limbo " + r.result + " · x" + r.target);
              } catch (err) {
                toast("Limbo: " + err.message, "error");
              }
              state.limbo.playing = false;
              renderLimboPanel();
            };
            document.getElementById("wb-limbo-auto").onclick = () => runLimboAuto();
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
            if (tab === "games") {
              syncKenoCurrencyFromSite();
              renderGamesPanel();
              ensureExchangeRate(false).then(() => renderGamesPanel()).catch(() => {});
            }
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
              .wb-btn:disabled{opacity:.45;cursor:not-allowed;transform:none!important}
              #wb-games{padding:12px 14px 20px}
              .wb-game-nav{display:flex;gap:6px;margin-bottom:12px}
              .wb-game-nav-btn{flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--wb-border);background:var(--wb-surface);color:var(--wb-muted);font:600 12px 'Space Grotesk',sans-serif;cursor:pointer}
              .wb-game-nav-btn.active{color:#fff;border-color:rgba(168,85,247,.55);background:rgba(168,85,247,.18)}
              .wb-games-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
              .wb-keno-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:5px;margin-bottom:10px}
              .wb-keno-cell{aspect-ratio:1;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:var(--wb-surface);color:#c4b5d8;font:600 11px 'JetBrains Mono',monospace;cursor:pointer;padding:0}
              .wb-keno-cell:hover{border-color:rgba(168,85,247,.4)}
              .wb-keno-cell.pick{background:rgba(168,85,247,.22);border-color:rgba(168,85,247,.55);color:#fff}
              .wb-keno-cell.drawn{border-color:rgba(251,191,36,.45);color:var(--wb-amber)}
              .wb-keno-cell.hit{background:rgba(74,222,128,.2);border-color:rgba(74,222,128,.55);color:var(--wb-green)}
              .wb-keno-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px}
              .wb-keno-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px}
              .wb-keno-controls label{display:flex;flex-direction:column;gap:4px;font-size:10px;color:var(--wb-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
              .wb-keno-controls input,.wb-keno-controls select{padding:7px 8px;border-radius:8px;border:1px solid var(--wb-border);background:var(--wb-surface2);color:#fff;font-size:12px}
              .wb-keno-last{margin-top:12px;padding:10px 12px;border-radius:10px;background:var(--wb-surface);border:1px solid var(--wb-border);font-size:11px;line-height:1.45;color:#d8cce8;word-break:break-word}
              .wb-keno-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:4px}
              .wb-keno-stat{padding:10px;border-radius:10px;background:var(--wb-surface);border:1px solid rgba(255,255,255,.05);display:flex;flex-direction:column;gap:4px}
              .wb-keno-stat.wide{grid-column:1/-1}
              .wb-keno-stat .k{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--wb-muted)}
              .wb-keno-stat .v{font:600 13px 'JetBrains Mono',monospace;color:#fff}
              .wb-keno-stat.ok .v{color:var(--wb-green)}
              .wb-keno-stat.err .v{color:var(--wb-red)}
              .wb-keno-hist-list{display:flex;flex-direction:column;gap:4px;max-height:280px;overflow:auto}
              .wb-keno-hist{padding:8px 10px;border-radius:8px;background:var(--wb-surface);border:1px solid rgba(255,255,255,.04);font:500 11px 'JetBrains Mono',monospace;color:var(--wb-muted)}
              .wb-keno-hist-top{display:flex;justify-content:space-between;gap:8px;color:#d8cce8}
              .wb-keno-hist-meta{margin-top:4px;font-size:10px;opacity:.75}
              .wb-keno-hist .pnl{font-weight:700}
              .wb-keno-hist.ok{border-color:rgba(74,222,128,.2)}
              .wb-keno-hist.ok .pnl{color:var(--wb-green)}
              .wb-keno-hist.err{border-color:rgba(248,113,113,.2)}
              .wb-keno-hist.err .pnl{color:var(--wb-red)}
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
                <button class="wb-tab" data-tab="games">Jeux</button>
                <button class="wb-tab" data-tab="stats">Stats</button>
                <button class="wb-tab" data-tab="settings">Réglages</button>
              </div>
              <div id="wb-panel-history" class="wb-tab-panel active">
                <div style="padding:10px 16px 0;font-size:11px;color:var(--wb-muted)">Sources · ${tgSourceLinks}</div>
                <div id="wb-codes"></div>
              </div>
              <div id="wb-panel-games" class="wb-tab-panel">
                <div id="wb-games"></div>
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
            document.getElementById("wb-currency").onchange = e => {
              config.currency = e.target.value;
              persistConfig();
            };
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
            renderGamesPanel();
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
