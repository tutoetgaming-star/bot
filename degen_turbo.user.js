// ==UserScript==
// @name         Degen Turbo — Originals
// @namespace    degen-turbo
// @version      1.10.4
// @updateURL    https://raw.githubusercontent.com/tutoetgaming-star/bot/main/degen_turbo.user.js
// @downloadURL  https://raw.githubusercontent.com/tutoetgaming-star/bot/main/degen_turbo.user.js
// @description  Auto-bet rapide sur les Originals Degen (Dice, Limbo, Plinko, Keno, Mines)
// @match        https://degen.com/*
// @match        https://www.degen.com/*
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @connect      api.degen.com
// @connect      api.coingecko.com
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const WIN = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const API = "https://api.degen.com/v1";
  const SCRIPT_VERSION = "1.10.4";
  const DEFAULT_DELAY = 55; // valeur par défaut du champ Délai (modifiable librement)
  const KENO_LIMITS = { keno_40: 40, keno_50: 50, keno_60: 60, keno_70: 70, keno_80: 80 };
  // Mines = start + reveal(s) + cashout : pas de pause interne, seul le Délai entre manches compte
  const KNOWN_ASSETS = ["USDT", "BTC", "ETH", "USDC", "TRX", "SOL", "LTC", "DOGE", "XRP"];
  const KNOWN_SET = new Set(KNOWN_ASSETS);
  const ASSET_PRICE_IDS = {
    BTC: "bitcoin",
    ETH: "ethereum",
    USDT: "tether",
    USDC: "usd-coin",
    TRX: "tron",
    SOL: "solana",
    LTC: "litecoin",
    DOGE: "dogecoin",
    XRP: "ripple"
  };
  const PRICE_TTL_MS = 60000;
  const HISTORY_MAX = 300;
  const BIG_WIN_MULT = 2;

  let lastBalanceData = null;
  let assetSyncTimer = null;
  let assetConfirmed = false;
  let assetPrices = {};
  let priceFetchedAt = 0;
  let priceRefreshTimer = null;

  const cfg = {
    game: GM_getValue("dg_game", "dice"),
    asset: GM_getValue("dg_asset", ""),
    betAmount: GM_getValue("dg_bet", "0.0001"),
    delayMs: parseInt(GM_getValue("dg_delay", String(DEFAULT_DELAY)), 10) || DEFAULT_DELAY,
    maxBets: parseInt(GM_getValue("dg_max", "0"), 10) || 0,
    diceType: GM_getValue("dg_dice_type", "ROLL_OVER"),
    diceTarget: parseFloat(GM_getValue("dg_dice_target", "50")) || 50,
    limboMult: parseFloat(GM_getValue("dg_limbo_mult", "2")) || 2,
    plinkoRisk: GM_getValue("dg_plinko_risk", "LOW"),
    plinkoRows: parseInt(GM_getValue("dg_plinko_rows", "8"), 10) || 8,
    kenoVariant: normalizeKenoVariant(GM_getValue("dg_keno_variant", "keno_40")),
    kenoRisk: GM_getValue("dg_keno_risk", "CLASSIC"),
    kenoNumbers: GM_getValue("dg_keno_numbers", ""),
    kenoRandom: GM_getValue("dg_keno_random", "0") === "1",
    kenoPickCount: parseInt(GM_getValue("dg_keno_pick_count", "4"), 10) || 4,
    minesCount: parseInt(GM_getValue("dg_mines_count", "3"), 10) || 3,
    minesReveals: parseInt(GM_getValue("dg_mines_reveals", "1"), 10) || 1,
    minesTiles: GM_getValue("dg_mines_tiles", ""),
    winMode: GM_getValue("dg_win_mode", "reset"),
    winPct: parseFloat(GM_getValue("dg_win_pct", "0")) || 0,
    lossMode: GM_getValue("dg_loss_mode", "reset"),
    lossPct: parseFloat(GM_getValue("dg_loss_pct", "0")) || 0,
    stopProfit: parseFloat(GM_getValue("dg_stop_profit", "0")) || 0,
    stopLoss: parseFloat(GM_getValue("dg_stop_loss", "0")) || 0
  };

  function normalizeKenoVariant(v) {
    const legacy = { keno_10: "keno_40", keno_20: "keno_50" };
    const next = legacy[v] || v;
    return KENO_LIMITS[next] ? next : "keno_40";
  }

  function validateKeno() {
    const max = KENO_LIMITS[cfg.kenoVariant] || 40;
    const manual = parseKenoNumbers();
    const useRandom = cfg.kenoRandom || manual.length === 0;
    if (useRandom) {
      const count = cfg.kenoPickCount || 4;
      if (count < 1 || count > max) return `Nb numéros aléatoires: entre 1 et ${max}`;
      return null;
    }
    if (!manual.length) return "Aucun numéro Keno valide";
    if (manual.length > max) return `Max ${max} numéros pour ${cfg.kenoVariant}`;
    const invalid = manual.filter((n) => n < 1 || n > max);
    if (invalid.length) return `Numéros hors plage 1-${max}`;
    if (manual.length !== new Set(manual).size) return "Numéros en double";
    return null;
  }

  function setAsset(asset) {
    if (!asset) return;
    const next = String(asset).toUpperCase();
    if (next === cfg.asset) return;
    cfg.asset = next;
    GM_setValue("dg_asset", next);
    refreshReadyStatus();
    updateStats();
  }

  function resolveAssetFromBalance(data) {
    if (!Array.isArray(data) || !data.length) return;
    lastBalanceData = data;
    const primary = data.find((x) => x.isPrimary === true);
    if (primary?.asset) {
      assetConfirmed = true;
      setAsset(primary.asset);
    }
    updateStats();
  }

  function syncAssetFromCache() {
    if (!lastBalanceData?.length) return false;
    const primary = lastBalanceData.find((x) => x.isPrimary === true);
    if (primary?.asset) {
      setAsset(primary.asset);
      return true;
    }
    return false;
  }

  function pickAssetHint() {
    const fromCache = lastBalanceData?.find((x) => x.isPrimary === true)?.asset;
    if (fromCache) return String(fromCache).toUpperCase();
    return null;
  }

  async function patchBalancePrimary(asset) {
    const res = await WIN.fetch(API + "/balance/primary", {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ asset })
    });
    const data = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(data)) return null;
    return data;
  }

  async function refreshPrimaryBalance() {
    const asset = pickAssetHint();
    if (!asset) return false;
    try {
      const data = await patchBalancePrimary(asset);
      if (data) {
        resolveAssetFromBalance(data);
        return !!cfg.asset;
      }
    } catch (e) {
      log("Balance refresh:", e.message);
    }
    return false;
  }

  async function ensureAsset() {
    return syncAssetFromCache();
  }

  async function autoDetectAsset() {
    return syncAssetFromCache();
  }

  let lastMinesGameId = GM_getValue("dg_mines_game_id", "") || null;
  let minesLock = Promise.resolve();

  function isValidGameId(id) {
    return typeof id === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  }

  function saveMinesState(game) {
    if (!isValidGameId(game?.id)) return;
    GM_setValue("dg_mines_state", JSON.stringify({
      id: game.id,
      status: game.status,
      revealedTiles: game.revealedTiles || []
    }));
  }

  function loadMinesState(gameId) {
    try {
      const s = JSON.parse(GM_getValue("dg_mines_state", "{}"));
      if (s?.id === gameId) return s;
    } catch (_) {}
    return null;
  }

  function clearMinesState() {
    GM_setValue("dg_mines_state", "");
  }

  function setLastMinesGameId(id) {
    const next = isValidGameId(id) ? id : null;
    lastMinesGameId = next;
    GM_setValue("dg_mines_game_id", next || "");
    if (!next) clearMinesState();
  }

  if (!isValidGameId(lastMinesGameId)) setLastMinesGameId(null);

  function captureMinesFromJson(data, url) {
    if (!data || typeof data !== "object") return;
    const path = url || "";
    if (isValidGameId(data.id)) {
      if (data.status === "ACTIVE" || /\/start|\/reveal/.test(path)) {
        setLastMinesGameId(data.id);
        saveMinesState(data);
      }
      if (/cashout/.test(path) && data.status === "COMPLETED") {
        setLastMinesGameId(null);
      }
    }
    if (isValidGameId(data.gameId)) setLastMinesGameId(data.gameId);
    if (data.game && isValidGameId(data.game.id)) setLastMinesGameId(data.game.id);
    if (Array.isArray(data)) {
      const active = data.find((g) => g?.status === "ACTIVE" && isValidGameId(g.id));
      if (active) setLastMinesGameId(active.id);
    }
  }

  function captureMinesFromRequest(body) {
    if (!body) return;
    try {
      const parsed = typeof body === "string" ? JSON.parse(body) : body;
      if (isValidGameId(parsed?.gameId)) setLastMinesGameId(parsed.gameId);
    } catch (_) {}
  }

  function installAssetHooks() {
    const origFetch = WIN.fetch;
    if (!origFetch._dgAssetHooked) {
      WIN.fetch = async function (input, init) {
        const url = typeof input === "string" ? input : input?.url || "";
        const isBalance = /\/balance\/primary/.test(url);
        const isMines = /\/games\/mines/.test(url);
        if (isMines && init?.body) captureMinesFromRequest(init.body);
        const res = await origFetch.apply(this, arguments);
        if (isBalance && res.ok) {
          try {
            const data = await res.clone().json();
            resolveAssetFromBalance(data);
          } catch (_) {}
        }
        if (isMines) {
          try {
            const data = await res.clone().json();
            captureMinesFromJson(data, url);
          } catch (_) {}
        }
        return res;
      };
      WIN.fetch._dgAssetHooked = true;
    }

    if (!XMLHttpRequest.prototype._dgAssetHooked) {
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this._dgUrl = String(url || "");
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        const url = this._dgUrl || "";
        if (/\/games\/mines/.test(url)) captureMinesFromRequest(body);
        this.addEventListener("load", function () {
          if (/\/balance\/primary/.test(this._dgUrl || "")) {
            if (this.status >= 200 && this.status < 300) {
              try {
                const data = JSON.parse(this.responseText);
                resolveAssetFromBalance(data);
              } catch (_) {}
            }
            return;
          }
          if (!/\/games\/mines/.test(this._dgUrl || "")) return;
          try {
            const data = JSON.parse(this.responseText);
            captureMinesFromJson(data, this._dgUrl);
          } catch (_) {}
        });
        return origSend.apply(this, arguments);
      };
      XMLHttpRequest.prototype._dgAssetHooked = true;
    }
  }
  installAssetHooks();

  const stats = { bets: 0, wins: 0, losses: 0, profit: 0 };
  let history = [];
  let historyFilter = "all";
  try {
    history = JSON.parse(GM_getValue("dg_history", "[]")) || [];
  } catch (_) {
    history = [];
  }
  let running = false;
  let abort = false;
  let baseBetAmount = cfg.betAmount;

  function startAssetSync() {
    const tick = () => autoDetectAsset().then(() => {
      if (!running) refreshReadyStatus();
    });
    tick();
    if (assetSyncTimer) clearInterval(assetSyncTimer);
    assetSyncTimer = setInterval(tick, 2000);
    WIN.addEventListener("load", () => setTimeout(tick, 1500));
  }

  function save() {
    GM_setValue("dg_game", cfg.game);
    GM_setValue("dg_bet", cfg.betAmount);
    GM_setValue("dg_delay", String(cfg.delayMs));
    GM_setValue("dg_max", String(cfg.maxBets));
    GM_setValue("dg_dice_type", cfg.diceType);
    GM_setValue("dg_dice_target", String(cfg.diceTarget));
    GM_setValue("dg_limbo_mult", String(cfg.limboMult));
    GM_setValue("dg_plinko_risk", cfg.plinkoRisk);
    GM_setValue("dg_plinko_rows", String(cfg.plinkoRows));
    GM_setValue("dg_keno_variant", cfg.kenoVariant);
    GM_setValue("dg_keno_risk", cfg.kenoRisk);
    GM_setValue("dg_keno_numbers", cfg.kenoNumbers);
    GM_setValue("dg_keno_random", cfg.kenoRandom ? "1" : "0");
    GM_setValue("dg_keno_pick_count", String(cfg.kenoPickCount));
    GM_setValue("dg_mines_count", String(cfg.minesCount));
    GM_setValue("dg_mines_reveals", String(cfg.minesReveals));
    GM_setValue("dg_mines_tiles", cfg.minesTiles);
    GM_setValue("dg_win_mode", cfg.winMode);
    GM_setValue("dg_win_pct", String(cfg.winPct));
    GM_setValue("dg_loss_mode", cfg.lossMode);
    GM_setValue("dg_loss_pct", String(cfg.lossPct));
    GM_setValue("dg_stop_profit", String(cfg.stopProfit));
    GM_setValue("dg_stop_loss", String(cfg.stopLoss));
  }

  function log(...args) {
    console.log("[DegenTurbo]", ...args);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function uuid() {
    return WIN.crypto.randomUUID();
  }

  function parseAmount(str) {
    if (str == null || str === "") return 0;
    const n = parseFloat(String(str).trim().replace(/\s/g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }

  function betDecimals(asset) {
    const a = String(asset || cfg.asset || "").toUpperCase();
    if (a === "USDT" || a === "USDC") return 4;
    if (a === "TRX" || a === "DOGE" || a === "XRP") return 6;
    return 8;
  }

  function formatBetAmount(amount) {
    const n = typeof amount === "number" ? amount : parseAmount(amount);
    if (!n || n <= 0) return "0";
    const dec = betDecimals(cfg.asset);
    const rounded = Math.round(n * 10 ** dec) / 10 ** dec;
    return rounded.toFixed(dec);
  }

  function clampDiceTarget(value) {
    const n = typeof value === "number" ? value : parseAmount(value);
    return Math.min(99.99, Math.max(0.01, Math.round(n * 100) / 100));
  }

  function clampLimboMult(value) {
    const n = typeof value === "number" ? value : parseAmount(value);
    return Math.min(1000000, Math.max(1.01, Math.round(n * 100) / 100));
  }

  function clampPlinkoRows(value) {
    const n = parseInt(value, 10) || 8;
    return Math.min(16, Math.max(8, n));
  }

  function betBody(extra) {
    const body = { ...extra };
    if (body.betAmount != null) body.betAmount = formatBetAmount(body.betAmount);
    if (cfg.asset) body.asset = cfg.asset;
    return body;
  }

  function formatApiError(data, res) {
    if (!data) return res?.statusText || "Erreur API";
    const m = data.message;
    if (typeof m === "string") return m;
    if (m && typeof m.message === "string") return m.message;
    if (m && Array.isArray(m.message)) return m.message.join(", ");
    if (Array.isArray(data.messages)) return data.messages.join(", ");
    if (typeof data.messages === "string") return data.messages;
    if (m && typeof m === "object") {
      return m.error || String(m.statusCode || "") || JSON.stringify(m);
    }
    try {
      return JSON.stringify(data);
    } catch (_) {
      return "Erreur API";
    }
  }

  function isNetworkError(e) {
    return e?.network || (!e?.status && /failed to fetch|networkerror|load failed/i.test(e?.message || ""));
  }

  function getRateLimitWaitMs(res) {
    const retryAfter = parseInt(res.headers?.get?.("retry-after"), 10);
    if (retryAfter > 0) return Math.min(retryAfter * 1000, 30000);
    const reset = parseInt(res.headers?.get?.("x-ratelimit-reset"), 10);
    // reset en ms (ex. 3004) ou secondes si petit entier
    if (reset > 0 && reset < 120) return reset * 1000;
    if (reset >= 120 && reset < 60000) return reset;
    return 3000;
  }

  async function api(path, body) {
    let res;
    try {
      res = await WIN.fetch(API + path, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      const err = new Error(e.message || "Réseau indisponible");
      err.network = true;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      log("API", path, res.status, data);
      const err = new Error(formatApiError(data, res));
      err.status = res.status;
      err.data = data;
      err.path = path;
      if (res.status === 429) err.rateLimitMs = getRateLimitWaitMs(res);
      throw err;
    }
    return data;
  }

  async function betDice() {
    return api("/games/dice/bet", betBody({
      gameSessionId: uuid(),
      betAmount: cfg.betAmount,
      betType: cfg.diceType,
      targetNumber: clampDiceTarget(cfg.diceTarget)
    }));
  }

  async function betLimbo() {
    return api("/games/limbo/bet", betBody({
      betAmount: cfg.betAmount,
      targetMultiplier: clampLimboMult(cfg.limboMult)
    }));
  }

  async function betPlinko() {
    return api("/games/plinko/bet", betBody({
      betAmount: cfg.betAmount,
      riskLevel: cfg.plinkoRisk,
      rowCount: clampPlinkoRows(cfg.plinkoRows)
    }));
  }

  function parseKenoNumbers() {
    return cfg.kenoNumbers
      .split(/[,\s]+/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
  }

  function pickRandomKenoNumbers(count, max) {
    const pool = [];
    for (let i = 1; i <= max; i++) pool.push(i);
    const n = Math.min(Math.max(1, count), max);
    const picked = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    return picked.sort((a, b) => a - b);
  }

  function getKenoSelectedNumbers() {
    const max = KENO_LIMITS[cfg.kenoVariant] || 40;
    const manual = parseKenoNumbers();
    const useRandom = cfg.kenoRandom || manual.length === 0;
    if (!useRandom) return manual;
    return pickRandomKenoNumbers(cfg.kenoPickCount || 4, max);
  }

  async function betKeno() {
    const selectedNumbers = getKenoSelectedNumbers();
    const data = await api("/games/keno/bet", betBody({
      betAmount: cfg.betAmount,
      variantId: cfg.kenoVariant,
      riskLevel: cfg.kenoRisk,
      selectedNumbers
    }));
    data.kenoDetail = selectedNumbers.join(",");
    return data;
  }

  const MINES_GRID = 25;

  function parseMinesTiles() {
    return parseMinesTilesFrom(cfg.minesTiles);
  }

  function pickMinesTile(revealed) {
    const taken = new Set(revealed);
    const free = [];
    for (let i = 0; i < MINES_GRID; i++) {
      if (!taken.has(i)) free.push(i);
    }
    if (free.length === 0) throw new Error("Grille Mines pleine");
    return free[Math.floor(Math.random() * free.length)];
  }

  function normalizeMinesResult(game, hitMine) {
    const payout = parseFloat(game.finalPayout || game.winAmount || 0) || 0;
    const bet = parseAmount(game.betAmount || cfg.betAmount);
    const mult = game.currentMultiplier || "1";
    const revealed = (game.revealedTiles || []).length;
    let status;
    if (hitMine || game.status === "LOST") status = "LOST";
    else if (game.status === "COMPLETED") status = payout >= bet ? "WON" : "COMPLETED";
    else if (payout > bet) status = "WON";
    else status = "LOST";
    return {
      betAmount: game.betAmount || cfg.betAmount,
      winAmount: String(payout),
      status,
      minesDetail: hitMine
        ? `mine! (×${mult})`
        : `${revealed} gem(s) ×${mult}`
    };
  }

  function minesStartPayload() {
    return {
      betAmount: formatBetAmount(cfg.betAmount),
      minesCount: cfg.minesCount,
      gameSessionId: uuid()
    };
  }

  function minesRevealPayload(gameId, tilePosition) {
    return {
      gameId,
      tilePosition: Number(tilePosition)
    };
  }

  function minesCashoutPayload(gameId) {
    return { gameId };
  }

  function isActiveMinesError(err) {
    const parts = [err?.message, err?.data?.message];
    try {
      parts.push(JSON.stringify(err?.data || ""));
    } catch (_) {}
    const text = parts.flat().join(" ").toLowerCase();
    return /active mines game|already have an active|partie mines active/.test(text);
  }

  function isInvalidUuidError(err) {
    try {
      return /invalid_uuid/.test(JSON.stringify(err?.data || err?.message || ""));
    } catch (_) {
      return false;
    }
  }

  async function cashoutMinesGame(gameId) {
    if (!isValidGameId(gameId)) return false;
    try {
      await api("/games/mines/cashout", minesCashoutPayload(gameId));
      setLastMinesGameId(null);
      return true;
    } catch (e) {
      log("Cashout échoué:", e.message, gameId);
      if (isInvalidUuidError(e)) setLastMinesGameId(null);
      return false;
    }
  }

  async function forceCloseActiveMines() {
    if (!isValidGameId(lastMinesGameId)) return false;
    return cashoutMinesGame(lastMinesGameId);
  }

  async function closeActiveMinesGame(quiet) {
    if (!quiet) setStatus("Cashout partie Mines…");
    const ok = await forceCloseActiveMines();
    if (ok && !quiet) setStatus("Partie Mines fermée");
    return ok;
  }

  async function playMinesRound(game, fixedTiles, reveals, skipReveals = 0) {
    for (let i = skipReveals; i < reveals; i++) {
      if (game.status !== "ACTIVE") break;

      const tile = fixedTiles[i] ?? pickMinesTile(game.revealedTiles || []);
      game = await api("/games/mines/reveal", minesRevealPayload(game.id, tile));
      saveMinesState(game);

      if (game.status !== "ACTIVE") {
        setLastMinesGameId(null);
        return normalizeMinesResult(game, true);
      }
    }

    if (game.status === "ACTIVE") {
      if (!isValidGameId(game.id)) throw new Error("Mines cashout sans gameId");
      game = await api("/games/mines/cashout", minesCashoutPayload(game.id));
      setLastMinesGameId(null);
    }

    return normalizeMinesResult(game, false);
  }

  async function finishMinesGame(gameId, fixedTiles, reveals) {
    if (!isValidGameId(gameId)) {
      throw new Error("Partie Mines active — clique 💰 ou cashout sur Degen");
    }

    const saved = loadMinesState(gameId);
    let game = saved
      ? { id: gameId, status: saved.status || "ACTIVE", revealedTiles: saved.revealedTiles || [] }
      : { id: gameId, status: "ACTIVE", revealedTiles: [] };

    const already = (game.revealedTiles || []).length;
    const skipReveals = Math.min(already, reveals);

    if (game.status === "ACTIVE" && skipReveals >= reveals) {
      game = await api("/games/mines/cashout", minesCashoutPayload(gameId));
      setLastMinesGameId(null);
      return normalizeMinesResult(game, false);
    }

    return playMinesRound(game, fixedTiles, reveals, skipReveals);
  }

  async function betMinesOnce() {
    const fixedTiles = parseMinesTiles();
    const reveals = Math.max(1, Math.min(cfg.minesReveals, MINES_GRID - cfg.minesCount));

    if (isValidGameId(lastMinesGameId)) {
      setStatus("Mines: finition partie en cours…");
      return finishMinesGame(lastMinesGameId, fixedTiles, reveals);
    }

    let game = null;
    try {
      game = await api("/games/mines/start", minesStartPayload());
      if (!isValidGameId(game?.id)) throw new Error("Mines: start sans gameId");
      setLastMinesGameId(game.id);
      saveMinesState(game);
      return await playMinesRound(game, fixedTiles, reveals);
    } catch (e) {
      if (e.status === 400 && isActiveMinesError(e)) {
        if (isValidGameId(lastMinesGameId)) {
          setStatus("Mines: partie active — finition…");
          return finishMinesGame(lastMinesGameId, fixedTiles, reveals);
        }
        throw new Error("Partie Mines active — clique 💰 ou cashout sur Degen");
      }
      if (isValidGameId(game?.id)) await cashoutMinesGame(game.id);
      throw e;
    }
  }

  async function betMines() {
    const run = minesLock.then(() => betMinesOnce());
    minesLock = run.catch(() => {});
    return run;
  }

  const betFns = {
    dice: betDice,
    limbo: betLimbo,
    plinko: betPlinko,
    keno: betKeno,
    mines: betMines
  };

  function formatAmt(n) {
    const v = parseFloat(n);
    if (isNaN(v)) return String(n);
    if (Math.abs(v) === 0) return "0";
    if (Math.abs(v) < 0.0001) return v.toFixed(8);
    if (Math.abs(v) < 1) return v.toFixed(6);
    return v.toFixed(4);
  }

  function balanceUsdRate(asset) {
    const a = String(asset || "").toUpperCase();
    const item = lastBalanceData?.find((x) => String(x.asset || "").toUpperCase() === a);
    if (!item) return null;
    const bal = parseFloat(item.balance ?? item.available ?? item.amount ?? item.walletBalance ?? 0);
    const usd = parseFloat(
      item.usdValue ?? item.usd ?? item.fiatValue ?? item.valueUsd ?? item.valueInUsd
        ?? item.fiatAmount ?? item.usdBalance ?? 0
    );
    if (bal > 0 && usd > 0) return usd / bal;
    return null;
  }

  function getCoingeckoUsdRate(asset) {
    const id = ASSET_PRICE_IDS[String(asset || "").toUpperCase()];
    const p = id && assetPrices[id];
    return p?.usd > 0 ? p.usd : null;
  }

  function getEurPerUsd() {
    const t = assetPrices.tether || assetPrices["usd-coin"];
    if (t?.usd > 0 && t?.eur > 0) return t.eur / t.usd;
    const b = assetPrices.bitcoin;
    if (b?.usd > 0 && b?.eur > 0) return b.eur / b.usd;
    return null;
  }

  function getUsdRate(asset) {
    return balanceUsdRate(asset) ?? getCoingeckoUsdRate(asset);
  }

  function cryptoToFiat(cryptoAmt, asset) {
    const usdRate = getUsdRate(asset);
    if (!usdRate) return null;
    const usd = cryptoAmt * usdRate;
    const eurPerUsd = getEurPerUsd();
    return { usd, eur: eurPerUsd ? usd * eurPerUsd : null };
  }

  function formatFiatValue(n, currency) {
    const v = parseFloat(n);
    if (isNaN(v)) return "—";
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : v > 0 ? "+" : "";
    const sym = currency === "eur" ? "€" : "$";
    if (abs === 0) return `${sym}0.00`;
    if (abs < 0.01) return `${sign}${sym}${abs.toFixed(4)}`;
    if (abs < 1) return `${sign}${sym}${abs.toFixed(3)}`;
    return `${sign}${sym}${abs.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatFiatPair(cryptoAmt, asset) {
    const fiat = cryptoToFiat(cryptoAmt, asset);
    if (!fiat) return "";
    const eurPart = fiat.eur != null ? ` · ${formatFiatValue(fiat.eur, "eur")}` : "";
    return `${formatFiatValue(fiat.usd, "usd")}${eurPart}`;
  }

  function sumHistoryFiat(items) {
    let usd = 0;
    let eur = 0;
    let hasUsd = false;
    let hasEur = false;
    for (const h of items) {
      const f = cryptoToFiat(h.profit, h.asset);
      if (!f) continue;
      usd += f.usd;
      hasUsd = true;
      if (f.eur != null) {
        eur += f.eur;
        hasEur = true;
      }
    }
    if (!hasUsd) return "";
    const eurPart = hasEur ? ` · ${formatFiatValue(eur, "eur")}` : "";
    return `${formatFiatValue(usd, "usd")}${eurPart}`;
  }

  async function refreshAssetPrices() {
    if (Date.now() - priceFetchedAt < PRICE_TTL_MS && Object.keys(assetPrices).length) return;
    try {
      const ids = [...new Set(Object.values(ASSET_PRICE_IDS))].join(",");
      const res = await WIN.fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,eur`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === "object") {
        assetPrices = data;
        priceFetchedAt = Date.now();
        updateStats();
        if (document.getElementById("dg-history-modal")?.classList.contains("dg-open")) {
          renderHistory();
        }
      }
    } catch (e) {
      log("Prix fiat:", e.message);
    }
  }

  function startPriceRefresh() {
    refreshAssetPrices();
    if (priceRefreshTimer) clearInterval(priceRefreshTimer);
    priceRefreshTimer = setInterval(refreshAssetPrices, PRICE_TTL_MS);
  }

  const GAME_LABELS = {
    dice: "🎲 Dice",
    limbo: "🚀 Limbo",
    plinko: "📍 Plinko",
    keno: "🎯 Keno",
    mines: "💣 Mines"
  };

  function getGameLabel(game) {
    return GAME_LABELS[game] || game || "—";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatHistoryTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;
    return `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${time}`;
  }

  function getBetDetail(data) {
    return data.minesDetail ?? data.kenoDetail ?? data.rollResult ?? data.resultMultiplier
      ?? (data.matches != null ? `${data.matches} match ×${data.payoutMultiplier}` : null)
      ?? "—";
  }

  function saveHistory() {
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    GM_setValue("dg_history", JSON.stringify(history));
  }

  function addHistoryEntry(data, won, bet, win, profit) {
    const mult = bet > 0 ? win / bet : 0;
    history.unshift({
      id: stats.bets,
      time: Date.now(),
      game: cfg.game,
      asset: cfg.asset || "",
      bet,
      win,
      profit,
      mult,
      won,
      big: won && mult >= BIG_WIN_MULT,
      detail: getBetDetail(data),
      status: data.status || ""
    });
    saveHistory();
    if (document.getElementById("dg-history-modal")?.classList.contains("dg-open")) {
      renderHistory();
    }
  }

  function renderHistoryStats() {
    const el = document.getElementById("dg-history-stats");
    if (!el) return;

    const wins = history.filter((h) => h.won).length;
    const losses = history.length - wins;
    const totalProfit = history.reduce((s, h) => s + h.profit, 0);
    const asset = history[0]?.asset || cfg.asset || "";
    const pnlClass = totalProfit >= 0 ? "dg-hist-pos" : "dg-hist-neg";
    const pnlSign = totalProfit >= 0 ? "+" : "";
    const fiatTotal = sumHistoryFiat(history);

    el.innerHTML = `
      <div class="dg-hist-stat">
        <span class="dg-hist-stat-val">${history.length}</span>
        <span class="dg-hist-stat-lbl">Paris</span>
      </div>
      <div class="dg-hist-stat dg-hist-stat-win">
        <span class="dg-hist-stat-val">${wins}</span>
        <span class="dg-hist-stat-lbl">Gains</span>
      </div>
      <div class="dg-hist-stat dg-hist-stat-loss">
        <span class="dg-hist-stat-val">${losses}</span>
        <span class="dg-hist-stat-lbl">Pertes</span>
      </div>
      <div class="dg-hist-stat ${pnlClass}">
        <span class="dg-hist-stat-val">${pnlSign}${formatAmt(totalProfit)}</span>
        <span class="dg-hist-stat-lbl">P/L ${asset}</span>
        ${fiatTotal ? `<span class="dg-hist-stat-fiat">${fiatTotal}</span>` : ""}
      </div>
    `;
  }

  function filterHistoryItems() {
    if (historyFilter === "big") return history.filter((h) => h.big);
    if (historyFilter === "win") return history.filter((h) => h.won);
    if (historyFilter === "loss") return history.filter((h) => !h.won);
    return history;
  }

  function getHistoryEmptyMessage() {
    if (historyFilter === "big") return "Aucun gros gain pour l'instant";
    if (historyFilter === "win") return "Aucun gain enregistré";
    if (historyFilter === "loss") return "Aucune perte enregistrée";
    return "Aucun pari enregistré";
  }

  function renderHistory() {
    const list = document.getElementById("dg-history-list");
    if (!list) return;

    renderHistoryStats();
    const items = filterHistoryItems();

    if (!items.length) {
      list.innerHTML = `
        <div class="dg-hist-empty">
          <div class="dg-hist-empty-icon">📭</div>
          <div>${getHistoryEmptyMessage()}</div>
        </div>`;
      return;
    }

    list.innerHTML = items.map((h) => {
      const profitClass = h.profit >= 0 ? "dg-hist-pos" : "dg-hist-neg";
      const profitSign = h.profit >= 0 ? "+" : "";
      const fiatProfit = formatFiatPair(h.profit, h.asset);
      const itemClass = [
        "dg-hist-item",
        h.won ? "dg-hist-win" : "dg-hist-loss",
        h.big ? "dg-hist-big" : ""
      ].filter(Boolean).join(" ");

      return `
      <div class="${itemClass}">
        <div class="dg-hist-row1">
          <span class="dg-hist-badge ${h.won ? "dg-badge-win" : "dg-badge-loss"}">${h.won ? "WIN" : "LOSS"}</span>
          <span class="dg-hist-game">${getGameLabel(h.game)}</span>
          <span class="dg-hist-num">#${h.id}</span>
          ${h.big ? '<span class="dg-hist-fire">🔥</span>' : ""}
          <span class="dg-hist-time">${formatHistoryTime(h.time)}</span>
        </div>
        <div class="dg-hist-detail" title="${escapeHtml(h.detail)}">${escapeHtml(h.detail)}</div>
        <div class="dg-hist-row3">
          <div class="dg-hist-amounts">
            <span><em>Mise</em> ${formatAmt(h.bet)}</span>
            ${h.win > 0 ? `<span class="dg-hist-arrow">→</span><span><em>Gain</em> ${formatAmt(h.win)}</span>` : ""}
            ${h.mult > 0 ? `<span class="dg-hist-mult">×${h.mult.toFixed(2)}</span>` : ""}
          </div>
          <span class="dg-hist-profit ${profitClass}">
            ${profitSign}${formatAmt(h.profit)} <small>${h.asset}</small>
            ${fiatProfit ? `<small class="dg-hist-fiat">${fiatProfit}</small>` : ""}
          </span>
        </div>
      </div>`;
    }).join("");
  }

  function openHistoryModal() {
    document.getElementById("dg-history-modal")?.classList.add("dg-open");
    renderHistory();
  }

  function closeHistoryModal() {
    document.getElementById("dg-history-modal")?.classList.remove("dg-open");
  }

  function clearHistory() {
    history = [];
    saveHistory();
    renderHistory();
  }

  function recordResult(data) {
    const bet = parseAmount(data.betAmount || cfg.betAmount) || 0;
    const win = parseFloat(data.winAmount || data.finalPayout || 0) || 0;
    const delta = win - bet;
    stats.bets++;
    stats.profit += delta;
    const won = data.status === "WON" || data.status === "COMPLETED" || win > bet;
    if (won) stats.wins++;
    else stats.losses++;
    addHistoryEntry(data, won, bet, win, delta);
    applyBetProgression(won);
  }

  function applyBetProgression(won) {
    const bet = parseAmount(cfg.betAmount) || parseAmount(baseBetAmount) || 0;
    let next = bet;
    if (won) {
      if (cfg.winMode === "reset") next = parseAmount(baseBetAmount) || bet;
      else if (cfg.winPct > 0) next = bet * (1 + cfg.winPct / 100);
    } else if (cfg.lossMode === "reset") {
      next = parseAmount(baseBetAmount) || bet;
    } else if (cfg.lossPct > 0) {
      next = bet * (1 + cfg.lossPct / 100);
    }
    cfg.betAmount = formatBetAmount(next);
    GM_setValue("dg_bet", cfg.betAmount);
    const el = document.getElementById("dg-bet");
    if (el) el.value = cfg.betAmount;
  }

  function checkStopLimits() {
    if (cfg.stopProfit > 0 && stats.profit >= cfg.stopProfit) {
      setStatus(`Stop profit atteint: +${stats.profit.toFixed(8)} ${cfg.asset}`);
      return true;
    }
    if (cfg.stopLoss > 0 && stats.profit <= -cfg.stopLoss) {
      setStatus(`Stop perte atteint: ${stats.profit.toFixed(8)} ${cfg.asset}`);
      return true;
    }
    return false;
  }

  function getModeValue(group) {
    const btn = document.querySelector(`.dg-mode-btn[data-group="${group}"].dg-active`);
    return btn?.dataset.value || "reset";
  }

  function setModeValue(group, value) {
    document.querySelectorAll(`.dg-mode-btn[data-group="${group}"]`).forEach((b) => {
      b.classList.toggle("dg-active", b.dataset.value === value);
    });
    const pct = document.getElementById(group === "win" ? "dg-win-pct" : "dg-loss-pct");
    if (pct) pct.disabled = value === "reset";
  }

  function setStatus(msg) {
    const el = document.getElementById("dg-status");
    if (el) el.textContent = msg;
    log(msg);
  }

  function updateRunButtons() {
    const startBtn = document.getElementById("dg-start");
    const stopBtn = document.getElementById("dg-stop");
    if (!startBtn || !stopBtn) return;

    if (running) {
      startBtn.disabled = true;
      startBtn.classList.add("dg-run-off");
      startBtn.classList.remove("dg-run-on");
      stopBtn.disabled = false;
      stopBtn.classList.add("dg-run-on");
      stopBtn.classList.remove("dg-run-off");
      stopBtn.textContent = abort ? "■ Arrêt…" : "■ Stop";
    } else {
      startBtn.disabled = false;
      startBtn.classList.add("dg-run-on");
      startBtn.classList.remove("dg-run-off");
      stopBtn.disabled = true;
      stopBtn.classList.add("dg-run-off");
      stopBtn.classList.remove("dg-run-on");
      stopBtn.textContent = "■ Stop";
    }
  }

  function refreshReadyStatus() {
    if (assetConfirmed && cfg.asset) {
      setStatus(`Prêt — ${cfg.asset}`);
    } else if (cfg.asset) {
      setStatus(`En attente — change de wallet sur Degen`);
    } else {
      setStatus("Détection crypto…");
    }
  }

  function updateStats() {
    const counts = document.getElementById("dg-stats");
    const pnl = document.getElementById("dg-stats-pnl");
    const pnlFiat = document.getElementById("dg-stats-pnl-fiat");
    if (counts) {
      counts.textContent = `Paris: ${stats.bets} · W: ${stats.wins} · L: ${stats.losses}`;
    }
    if (pnl) {
      const sign = stats.profit >= 0 ? "+" : "";
      pnl.textContent = `${sign}${formatAmt(stats.profit)} ${cfg.asset || ""}`;
      pnl.classList.toggle("dg-pnl-pos", stats.profit >= 0);
      pnl.classList.toggle("dg-pnl-neg", stats.profit < 0);
    }
    if (pnlFiat) {
      const fiat = formatFiatPair(stats.profit, cfg.asset);
      pnlFiat.textContent = fiat || "—";
      pnlFiat.style.display = fiat ? "" : "none";
      pnlFiat.classList.toggle("dg-pnl-pos", stats.profit >= 0);
      pnlFiat.classList.toggle("dg-pnl-neg", stats.profit < 0);
    }
  }

  async function waitForAsset(maxMs = 15000) {
    const start = Date.now();
    while (!assetConfirmed && Date.now() - start < maxMs) {
      syncAssetFromCache();
      if (assetConfirmed) return;
      await sleep(500);
    }
    if (!assetConfirmed) await refreshPrimaryBalance();
  }

  async function runLoop() {
    if (running) return;
    readForm();
    setStatus("Détection crypto…");
    syncAssetFromCache();
    if (!assetConfirmed) await waitForAsset();
    if (!assetConfirmed || !cfg.asset) {
      setStatus("Crypto introuvable — change de wallet sur Degen puis réessaie");
      return;
    }
    if (cfg.game === "keno") {
      const kenoErr = validateKeno();
      if (kenoErr) {
        setStatus(kenoErr);
        return;
      }
    }
    running = true;
    abort = false;
    updateRunButtons();
    baseBetAmount = formatBetAmount(cfg.betAmount);
    setStatus("En cours…");

    const betFn = betFns[cfg.game];
    if (!betFn) {
      running = false;
      updateRunButtons();
      setStatus("Jeu inconnu");
      return;
    }

    const delay = cfg.delayMs > 0 ? cfg.delayMs : DEFAULT_DELAY;

    try {
      while (!abort) {
        if (cfg.maxBets > 0 && stats.bets >= cfg.maxBets) break;

        try {
          const data = await betFn();
          recordResult(data);
          updateStats();
          const detail = getBetDetail(data);
          setStatus(`#${stats.bets} → ${data.status} (${detail}) | mise ${cfg.betAmount}`);
          if (checkStopLimits()) break;
        } catch (e) {
          if (isNetworkError(e)) {
            setStatus("Réseau — pause 2s");
            await sleep(2000);
            continue;
          }
          if (e.status === 429) {
            const wait = e.rateLimitMs || 3000;
            setStatus(`Rate limit — pause ${Math.round(wait / 1000)}s`);
            await sleep(wait);
            continue;
          }
          if (e.status === 403) {
            setStatus("Non connecté ou session expirée");
            break;
          }
          if (e.status === 400) {
            const minesErr = cfg.game === "mines" && (
              isActiveMinesError(e) || isInvalidUuidError(e)
              || /partie mines active|sans gameid/i.test(e.message || "")
            );
            if (minesErr) {
              setStatus(e.message || "Mines: partie active");
              log(e.path || cfg.game, e.data);
              await sleep(1500);
              continue;
            }
            const hint = cfg.asset ? ` (${cfg.asset}, mise ${cfg.betAmount})` : "";
            setStatus("Bad request" + hint + ": " + e.message);
            log(e.path || cfg.game, e.data);
            await sleep(1000);
            continue;
          }
          setStatus("Erreur: " + e.message);
          log(e);
          await sleep(1000);
          continue;
        }

        await sleep(delay);
      }
    } finally {
      running = false;
      updateRunButtons();
      setStatus(abort ? "Arrêté" : "Terminé");
    }
  }

  function stop() {
    abort = true;
    updateRunButtons();
    setStatus("Arrêt…");
  }

  function resetStats() {
    stats.bets = 0;
    stats.wins = 0;
    stats.losses = 0;
    stats.profit = 0;
    updateStats();
  }

  function readForm() {
    cfg.game = document.getElementById("dg-game").value;
    cfg.betAmount = formatBetAmount(document.getElementById("dg-bet").value);
    cfg.delayMs = Math.max(0, parseInt(document.getElementById("dg-delay").value, 10) || DEFAULT_DELAY);
    cfg.maxBets = parseInt(document.getElementById("dg-max").value, 10) || 0;
    cfg.diceType = document.getElementById("dg-dice-type").value;
    cfg.diceTarget = clampDiceTarget(document.getElementById("dg-dice-target").value);
    cfg.limboMult = clampLimboMult(document.getElementById("dg-limbo-mult").value);
    cfg.plinkoRisk = document.getElementById("dg-plinko-risk").value;
    cfg.plinkoRows = clampPlinkoRows(document.getElementById("dg-plinko-rows").value);
    cfg.kenoVariant = normalizeKenoVariant(document.getElementById("dg-keno-variant").value);
    cfg.kenoRisk = document.getElementById("dg-keno-risk").value;
    cfg.kenoNumbers = document.getElementById("dg-keno-numbers").value.trim();
    cfg.kenoRandom = !!document.getElementById("dg-keno-random")?.checked;
    cfg.kenoPickCount = Math.max(1, parseInt(document.getElementById("dg-keno-pick-count")?.value, 10) || 4);
    cfg.minesCount = parseInt(document.getElementById("dg-mines-count").value, 10) || 3;
    cfg.minesReveals = parseInt(document.getElementById("dg-mines-reveals").value, 10) || 1;
    cfg.minesTiles = document.getElementById("dg-mines-tiles").value.trim();
    cfg.winMode = getModeValue("win");
    cfg.winPct = parseAmount(document.getElementById("dg-win-pct").value) || 0;
    cfg.lossMode = getModeValue("loss");
    cfg.lossPct = parseAmount(document.getElementById("dg-loss-pct").value) || 0;
    cfg.stopProfit = parseAmount(document.getElementById("dg-stop-profit").value) || 0;
    cfg.stopLoss = parseAmount(document.getElementById("dg-stop-loss").value) || 0;
    save();
    refreshReadyStatus();
    updateStats();
    toggleGameFields();
  }

  function parseMinesTilesFrom(str) {
    return str
      .split(/[,\s]+/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 0 && n < MINES_GRID);
  }

  function buildMinesGridHtml() {
    let cells = "";
    for (let i = 0; i < MINES_GRID; i++) {
      cells += `<div class="dg-mines-cell" data-tile="${i}">${i}</div>`;
    }
    return cells;
  }

  function openMinesModal() {
    const modal = document.getElementById("dg-mines-modal");
    if (!modal) return;
    updateMinesModalHighlight();
    modal.classList.add("dg-open");
  }

  function closeMinesModal() {
    document.getElementById("dg-mines-modal")?.classList.remove("dg-open");
  }

  function updateMinesModalHighlight() {
    const input = document.getElementById("dg-mines-tiles");
    const picked = new Set(parseMinesTilesFrom(input?.value || ""));
    document.querySelectorAll("#dg-mines-modal .dg-mines-cell").forEach((cell) => {
      const n = parseInt(cell.dataset.tile, 10);
      cell.classList.toggle("dg-picked", picked.has(n));
    });
  }

  function toggleMinesTileInInput(tile) {
    const input = document.getElementById("dg-mines-tiles");
    if (!input) return;
    const tiles = parseMinesTilesFrom(input.value);
    const idx = tiles.indexOf(tile);
    if (idx >= 0) tiles.splice(idx, 1);
    else tiles.push(tile);
    input.value = tiles.join(",");
    cfg.minesTiles = input.value;
    GM_setValue("dg_mines_tiles", cfg.minesTiles);
    const reveals = document.getElementById("dg-mines-reveals");
    if (reveals && tiles.length > 0) reveals.value = String(tiles.length);
    updateMinesModalHighlight();
  }

  function toggleGameFields() {
    const g = document.getElementById("dg-game").value;
    document.getElementById("dg-dice-fields").style.display = g === "dice" ? "block" : "none";
    document.getElementById("dg-limbo-fields").style.display = g === "limbo" ? "block" : "none";
    document.getElementById("dg-plinko-fields").style.display = g === "plinko" ? "block" : "none";
    document.getElementById("dg-keno-fields").style.display = g === "keno" ? "block" : "none";
    document.getElementById("dg-mines-fields").style.display = g === "mines" ? "block" : "none";
    const cashoutBtn = document.getElementById("dg-cashout");
    if (cashoutBtn) cashoutBtn.style.display = g === "mines" ? "block" : "none";
  }

  async function manualMinesCashout() {
    if (running) return;
    setStatus("Cashout partie Mines…");
    const ok = await forceCloseActiveMines();
    setStatus(ok ? "Cashout OK" : "Pas de partie en mémoire — cashout sur Degen");
    refreshReadyStatus();
  }

  function updatePanelTitle() {
    const ver = document.querySelector("#dg-title .dg-version");
    if (ver) {
      ver.textContent = "v" + SCRIPT_VERSION;
      return;
    }
    const el = document.getElementById("dg-title");
    if (el) el.textContent = "⚡ Degen Turbo v" + SCRIPT_VERSION;
  }

  function upgradeStatsLayout() {
    const row = document.querySelector("#degen-turbo-panel .dg-stats-row");
    const old = document.getElementById("dg-stats");
    if (!row || !old) return;

    let block = old.closest(".dg-stats-block");
    if (!block) {
      block = document.createElement("div");
      block.className = "dg-stats-block";
      const pnl = document.createElement("div");
      pnl.id = "dg-stats-pnl";
      pnl.className = "dg-pnl-pos";
      block.appendChild(old);
      block.appendChild(pnl);
      const histBtn = document.getElementById("dg-history-btn");
      row.insertBefore(block, histBtn || null);
    }
    if (!document.getElementById("dg-stats-pnl-fiat")) {
      const fiat = document.createElement("div");
      fiat.id = "dg-stats-pnl-fiat";
      fiat.className = "dg-pnl-pos";
      block.appendChild(fiat);
    }
    updateStats();
  }

  function buildUI() {
    if (document.getElementById("degen-turbo-panel")) {
      updatePanelTitle();
      upgradeStatsLayout();
      startPriceRefresh();
      return;
    }

    GM_addStyle(`
      #degen-turbo-panel {
        position: fixed; bottom: 16px; right: 16px; z-index: 999999;
        width: 280px; background: #14141a; border: 1px solid #2a2a35;
        border-radius: 10px; color: #e8e8ef; font: 12px/1.4 "Work Sans", sans-serif;
        box-shadow: 0 8px 32px rgba(0,0,0,.5);
      }
      #degen-turbo-panel * { box-sizing: border-box; }
      #degen-turbo-panel .dg-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; background: #1a1a22; border-radius: 10px 10px 0 0;
        cursor: move; user-select: none; font-weight: 600; font-size: 13px;
      }
      #degen-turbo-panel .dg-head .dg-version {
        color: #93c5fd; font-weight: 500; font-size: 11px; margin-left: 4px;
      }
      #degen-turbo-panel label { display: block; margin: 6px 0 3px; color: #999; font-size: 11px; }
      #degen-turbo-panel input, #degen-turbo-panel select {
        width: 100%; padding: 6px 8px; background: #0d0d10; border: 1px solid #333;
        border-radius: 6px; color: #fff; font-size: 12px;
      }
      #degen-turbo-panel .dg-row { display: flex; gap: 6px; }
      #degen-turbo-panel .dg-row > * { flex: 1; }
      #degen-turbo-panel .dg-btns { display: flex; gap: 6px; margin-top: 10px; }
      #degen-turbo-panel button {
        flex: 1; padding: 8px; border: none; border-radius: 6px;
        font-weight: 600; cursor: pointer; font-size: 12px;
        transition: background 0.15s, color 0.15s, opacity 0.15s, box-shadow 0.15s, transform 0.08s;
      }
      #degen-turbo-panel button:active:not(:disabled) { transform: scale(0.97); }
      #dg-start { background: #22c55e; color: #000; }
      #dg-stop { background: #ef4444; color: #fff; }
      #dg-start.dg-run-on { background: #22c55e; color: #000; opacity: 1; box-shadow: 0 0 0 2px rgba(34,197,94,.35); }
      #dg-start.dg-run-off { background: #1e2e24; color: #5a6b5f; opacity: 0.55; cursor: not-allowed; box-shadow: none; }
      #dg-stop.dg-run-on { background: #ef4444; color: #fff; opacity: 1; box-shadow: 0 0 0 2px rgba(239,68,68,.4); }
      #dg-stop.dg-run-off { background: #2e1e1e; color: #6b5a5a; opacity: 0.55; cursor: not-allowed; box-shadow: none; }
      #dg-reset { background: #333; color: #ccc; flex: 0 0 auto; padding: 8px 10px; }
      #dg-cashout { background: #ca8a04; color: #000; flex: 0 0 auto; padding: 8px 10px; }
      #dg-status { margin-top: 8px; font-size: 11px; color: #888; min-height: 16px; }
      #degen-turbo-panel .dg-stats-block {
        margin-top: 8px; padding: 8px 10px; background: #0d0d10;
        border: 1px solid #2a2a35; border-radius: 8px;
      }
      #dg-stats { font-size: 11px; color: #888; margin-bottom: 4px; }
      #dg-stats-pnl {
        font-size: 20px; font-weight: 700; line-height: 1.2;
        letter-spacing: 0.02em; font-variant-numeric: tabular-nums;
      }
      #dg-stats-pnl.dg-pnl-pos { color: #4ade80; }
      #dg-stats-pnl.dg-pnl-neg { color: #f87171; }
      #dg-stats-pnl-fiat {
        font-size: 11px; font-weight: 500; line-height: 1.3; margin-top: 2px;
        font-variant-numeric: tabular-nums;
      }
      #dg-stats-pnl-fiat.dg-pnl-pos { color: #86efac; }
      #dg-stats-pnl-fiat.dg-pnl-neg { color: #fca5a5; }
      #degen-turbo-panel .dg-stats-row {
        display: flex; align-items: flex-end; gap: 6px; margin-top: 4px;
      }
      #degen-turbo-panel .dg-stats-row .dg-stats-block { flex: 1; min-width: 0; }
      #degen-turbo-panel #dg-history-btn {
        flex: 0 0 auto; padding: 4px 8px; background: #2a2a35; color: #ccc;
        border: 1px solid #444; border-radius: 6px; cursor: pointer; font-size: 11px;
        transition: background 0.15s, color 0.15s;
      }
      #degen-turbo-panel #dg-history-btn:hover { background: #333; color: #fff; border-color: #555; }
      #dg-history-modal {
        display: none; position: fixed; inset: 0; z-index: 1000001;
        background: rgba(0,0,0,.7); align-items: center; justify-content: center;
        padding: 12px;
      }
      #dg-history-modal.dg-open { display: flex; }
      #dg-history-modal .dg-modal-box {
        width: min(400px, 100%); max-height: 85vh; display: flex; flex-direction: column;
        background: #14141a; border: 1px solid #2a2a35; border-radius: 12px;
        color: #e8e8ef; font: 12px/1.45 "Work Sans", system-ui, sans-serif;
        box-shadow: 0 16px 48px rgba(0,0,0,.65);
      }
      #dg-history-modal .dg-modal-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 14px; background: #1a1a22; border-radius: 12px 12px 0 0;
        font-weight: 600; font-size: 13px; border-bottom: 1px solid #2a2a35;
      }
      #dg-history-modal .dg-modal-close {
        background: none; border: none; color: #666; cursor: pointer; font-size: 18px; padding: 0 4px;
      }
      #dg-history-modal .dg-modal-close:hover { color: #fff; }
      #dg-history-modal .dg-modal-body {
        padding: 12px 14px; overflow: hidden; display: flex; flex-direction: column; flex: 1; min-height: 0;
      }
      #dg-history-stats {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px;
      }
      #dg-history-modal .dg-hist-stat {
        padding: 8px 6px; background: #0d0d10; border: 1px solid #2a2a35;
        border-radius: 8px; text-align: center; min-width: 0;
      }
      #dg-history-modal .dg-hist-stat-val {
        display: block; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
        color: #e8e8ef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #dg-history-modal .dg-hist-stat-lbl {
        display: block; font-size: 9px; color: #777; margin-top: 2px; text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #dg-history-modal .dg-hist-stat-win .dg-hist-stat-val { color: #4ade80; }
      #dg-history-modal .dg-hist-stat-loss .dg-hist-stat-val { color: #f87171; }
      #dg-history-modal .dg-hist-filters {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 10px;
      }
      #dg-history-modal .dg-hist-filter {
        padding: 6px 4px; background: #0d0d10; border: 1px solid #333;
        border-radius: 6px; color: #888; font-size: 10px; cursor: pointer;
        transition: background 0.12s, color 0.12s, border-color 0.12s;
      }
      #dg-history-modal .dg-hist-filter:hover { color: #ccc; border-color: #444; }
      #dg-history-modal .dg-hist-filter.dg-active {
        background: #e8e8ef; color: #000; border-color: #e8e8ef; font-weight: 600;
      }
      #dg-history-list {
        overflow-y: auto; flex: 1; max-height: 380px;
        padding-right: 2px; scrollbar-width: thin; scrollbar-color: #333 transparent;
      }
      #dg-history-list::-webkit-scrollbar { width: 5px; }
      #dg-history-list::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
      #dg-history-modal .dg-hist-item {
        padding: 10px 10px 10px 12px; margin-bottom: 6px; background: #0d0d10;
        border: 1px solid #2a2a35; border-radius: 8px; font-size: 11px;
        border-left: 3px solid #444;
      }
      #dg-history-modal .dg-hist-item.dg-hist-win { border-left-color: #22c55e; }
      #dg-history-modal .dg-hist-item.dg-hist-loss { border-left-color: #ef4444; }
      #dg-history-modal .dg-hist-item.dg-hist-big {
        border-color: #ca8a04; border-left-color: #fbbf24; background: #151208;
      }
      #dg-history-modal .dg-hist-row1 {
        display: flex; align-items: center; gap: 6px; margin-bottom: 5px; flex-wrap: wrap;
      }
      #dg-history-modal .dg-hist-badge {
        font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px;
        letter-spacing: 0.05em; flex-shrink: 0;
      }
      #dg-history-modal .dg-badge-win { background: #14532d; color: #4ade80; }
      #dg-history-modal .dg-badge-loss { background: #450a0a; color: #f87171; }
      #dg-history-modal .dg-hist-game { color: #ddd; font-weight: 600; }
      #dg-history-modal .dg-hist-num { color: #666; font-size: 10px; }
      #dg-history-modal .dg-hist-fire { font-size: 11px; }
      #dg-history-modal .dg-hist-time {
        margin-left: auto; color: #666; font-size: 10px; font-variant-numeric: tabular-nums;
      }
      #dg-history-modal .dg-hist-detail {
        color: #aaa; margin-bottom: 6px; font-size: 11px; line-height: 1.35;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #dg-history-modal .dg-hist-row3 {
        display: flex; justify-content: space-between; align-items: flex-end; gap: 8px;
      }
      #dg-history-modal .dg-hist-amounts {
        display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px;
        color: #888; font-size: 10px; font-variant-numeric: tabular-nums;
      }
      #dg-history-modal .dg-hist-amounts em {
        font-style: normal; color: #555; font-size: 9px; text-transform: uppercase;
        margin-right: 2px;
      }
      #dg-history-modal .dg-hist-arrow { color: #555; }
      #dg-history-modal .dg-hist-mult {
        padding: 1px 5px; background: #1a1a22; border: 1px solid #333;
        border-radius: 4px; color: #bbb; font-weight: 600;
      }
      #dg-history-modal .dg-hist-profit {
        font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
        white-space: nowrap; flex-shrink: 0;
      }
      #dg-history-modal .dg-hist-profit small { font-size: 9px; font-weight: 500; color: #888; }
      #dg-history-modal .dg-hist-fiat {
        display: block; font-size: 9px; font-weight: 500; color: #777; margin-top: 1px;
      }
      #dg-history-modal .dg-hist-stat-fiat {
        display: block; font-size: 10px; font-weight: 500; margin-top: 2px; color: #888;
      }
      #dg-history-modal .dg-hist-pos { color: #4ade80; }
      #dg-history-modal .dg-hist-neg { color: #f87171; }
      #dg-history-modal .dg-hist-empty {
        text-align: center; color: #666; padding: 32px 16px; font-size: 12px;
      }
      #dg-history-modal .dg-hist-empty-icon { font-size: 28px; margin-bottom: 8px; opacity: 0.6; }
      #dg-history-modal .dg-modal-foot {
        display: flex; gap: 6px; padding: 10px 14px; border-top: 1px solid #2a2a35;
      }
      #dg-history-modal .dg-modal-foot button {
        flex: 1; padding: 8px; border: none; border-radius: 6px; font-size: 11px;
        cursor: pointer; font-weight: 600;
      }
      #dg-history-clear { background: #2a1515; color: #f87171; }
      #dg-history-clear:hover { background: #3d1a1a; }
      #dg-history-close-btn { background: #2a2a35; color: #e8e8ef; }
      #dg-history-close-btn:hover { background: #333; }
      #degen-turbo-panel .dg-close {
        background: none; border: none; color: #666; cursor: pointer; font-size: 16px; padding: 0 4px;
      }
      #degen-turbo-panel .dg-fields { margin-top: 4px; }
      #degen-turbo-panel .dg-auto { margin-top: 8px; padding-top: 8px; border-top: 1px solid #2a2a35; }
      #degen-turbo-panel .dg-auto-title { font-size: 11px; font-weight: 600; color: #ccc; margin-bottom: 6px; }
      #degen-turbo-panel .dg-mode-row { display: flex; gap: 4px; align-items: center; margin-bottom: 8px; }
      #degen-turbo-panel .dg-mode-btn {
        flex: 1; padding: 6px 4px; background: #0d0d10; border: 1px solid #333;
        border-radius: 6px; color: #888; font-size: 10px; cursor: pointer;
      }
      #degen-turbo-panel .dg-mode-btn.dg-active { background: #e8e8ef; color: #000; border-color: #e8e8ef; font-weight: 600; }
      #degen-turbo-panel .dg-mode-pct { display: flex; gap: 4px; align-items: center; flex: 1; min-width: 0; }
      #degen-turbo-panel .dg-mode-pct input { flex: 1; min-width: 0; padding: 6px 4px; text-align: right; }
      #degen-turbo-panel .dg-check-row {
        display: flex; align-items: center; gap: 6px; margin: 6px 0;
        font-size: 11px; color: #aaa; cursor: pointer;
      }
      #degen-turbo-panel .dg-check-row input { width: auto; flex: 0 0 auto; }
      #degen-turbo-panel .dg-stop-row { margin-bottom: 8px; }
      #degen-turbo-panel .dg-stop-head { display: flex; justify-content: space-between; font-size: 10px; color: #888; margin-bottom: 3px; }
      #degen-turbo-panel .dg-btns button { pointer-events: auto; position: relative; z-index: 1; }
      #degen-turbo-panel .dg-label-row {
        display: flex; align-items: center; justify-content: space-between; margin: 6px 0 3px;
      }
      #degen-turbo-panel .dg-label-row label { margin: 0; }
      #degen-turbo-panel .dg-help-btn {
        flex: 0 0 auto; width: 18px; height: 18px; padding: 0; margin-left: 6px;
        background: #2a2a35; color: #aaa; border-radius: 50%; font-size: 11px; line-height: 1;
        border: 1px solid #444; cursor: pointer;
      }
      #degen-turbo-panel .dg-help-btn:hover { background: #333; color: #fff; }
      #dg-mines-modal {
        display: none; position: fixed; inset: 0; z-index: 1000000;
        background: rgba(0,0,0,.65); align-items: center; justify-content: center;
      }
      #dg-mines-modal.dg-open { display: flex; }
      #dg-mines-modal .dg-modal-box {
        width: 220px; background: #14141a; border: 1px solid #2a2a35;
        border-radius: 10px; color: #e8e8ef; font: 11px/1.4 "Work Sans", sans-serif;
        box-shadow: 0 12px 40px rgba(0,0,0,.6);
      }
      #dg-mines-modal .dg-modal-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 10px; background: #1a1a22; border-radius: 10px 10px 0 0; font-weight: 600;
      }
      #dg-mines-modal .dg-modal-close {
        background: none; border: none; color: #666; cursor: pointer; font-size: 16px; padding: 0 4px;
      }
      #dg-mines-modal .dg-modal-body { padding: 10px; }
      #dg-mines-modal .dg-modal-hint { margin: 0 0 8px; color: #888; font-size: 10px; }
      #dg-mines-modal .dg-mines-grid {
        display: grid; grid-template-columns: repeat(5, 1fr); gap: 3px;
      }
      #dg-mines-modal .dg-mines-cell {
        aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
        background: #0d0d10; border: 1px solid #333; border-radius: 4px;
        font-size: 10px; font-weight: 600; color: #ccc; cursor: pointer;
      }
      #dg-mines-modal .dg-mines-cell:hover { border-color: #22c55e; color: #fff; }
      #dg-mines-modal .dg-mines-cell.dg-picked {
        background: #14532d; border-color: #22c55e; color: #6ee7b7;
      }
      #dg-mines-modal .dg-modal-example { margin: 8px 0 0; color: #666; font-size: 10px; }
    `);

    const panel = document.createElement("div");
    panel.id = "degen-turbo-panel";
    panel.innerHTML = `
      <div class="dg-head">
        <span id="dg-title">⚡ Degen Turbo<span class="dg-version">v${SCRIPT_VERSION}</span></span>
        <button class="dg-close" id="dg-close" title="Masquer">×</button>
      </div>
      <div class="dg-body">
        <label>Jeu</label>
        <select id="dg-game">
          <option value="dice">Dice</option>
          <option value="limbo">Limbo</option>
          <option value="plinko">Plinko</option>
          <option value="keno">Keno</option>
          <option value="mines">Mines</option>
        </select>

        <label>Mise</label>
        <input id="dg-bet" type="text" value="${cfg.betAmount}" />

        <div class="dg-row">
          <div>
            <label>Délai (ms)</label>
            <input id="dg-delay" type="number" min="0" value="${cfg.delayMs}" title="Délai entre paris (ms). &lt;55 = risque rate limit" />
          </div>
          <div>
            <label>Max paris (0=∞)</label>
            <input id="dg-max" type="number" min="0" value="${cfg.maxBets}" />
          </div>
        </div>

        <div class="dg-auto">
          <div class="dg-auto-title">Configurer automatiquement</div>

          <label>Sur victoire</label>
          <div class="dg-mode-row">
            <button type="button" class="dg-mode-btn dg-active" data-group="win" data-value="reset">Réinitialiser</button>
            <div class="dg-mode-pct">
              <button type="button" class="dg-mode-btn" data-group="win" data-value="increase">Augmenté de</button>
              <input id="dg-win-pct" type="number" min="0" step="0.01" value="${cfg.winPct}" disabled />
              <span>%</span>
            </div>
          </div>

          <label>En cas de perte</label>
          <div class="dg-mode-row">
            <button type="button" class="dg-mode-btn dg-active" data-group="loss" data-value="reset">Réinitialiser</button>
            <div class="dg-mode-pct">
              <button type="button" class="dg-mode-btn" data-group="loss" data-value="increase">Augmenté de</button>
              <input id="dg-loss-pct" type="number" min="0" step="0.01" value="${cfg.lossPct}" disabled />
              <span>%</span>
            </div>
          </div>

          <div class="dg-stop-row">
            <div class="dg-stop-head"><span>Arrêtez sur le profit</span><span id="dg-stop-profit-hint">0 = désactivé</span></div>
            <input id="dg-stop-profit" type="number" min="0" step="any" value="${cfg.stopProfit}" placeholder="0" />
          </div>
          <div class="dg-stop-row">
            <div class="dg-stop-head"><span>Arrêt en cas de perte</span><span id="dg-stop-loss-hint">0 = désactivé</span></div>
            <input id="dg-stop-loss" type="number" min="0" step="any" value="${cfg.stopLoss}" placeholder="0" />
          </div>
        </div>

        <div id="dg-dice-fields" class="dg-fields">
          <div class="dg-row">
            <div>
              <label>Type</label>
              <select id="dg-dice-type">
                <option value="ROLL_OVER">Roll Over</option>
                <option value="ROLL_UNDER">Roll Under</option>
              </select>
            </div>
            <div>
              <label>Cible (0–99.99)</label>
              <input id="dg-dice-target" type="number" min="0.01" max="99.99" step="0.01" value="${cfg.diceTarget}" />
            </div>
          </div>
        </div>

        <div id="dg-limbo-fields" class="dg-fields" style="display:none">
          <label>Multiplicateur cible</label>
          <input id="dg-limbo-mult" type="number" min="1.01" step="0.01" value="${cfg.limboMult}" />
        </div>

        <div id="dg-plinko-fields" class="dg-fields" style="display:none">
          <div class="dg-row">
            <div>
              <label>Risque</label>
              <select id="dg-plinko-risk">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
            <div>
              <label>Rangées</label>
              <input id="dg-plinko-rows" type="number" min="8" max="16" value="${cfg.plinkoRows}" />
            </div>
          </div>
        </div>

        <div id="dg-keno-fields" class="dg-fields" style="display:none">
          <div class="dg-row">
            <div>
              <label>Variante</label>
              <select id="dg-keno-variant">
                <option value="keno_40">Keno 40</option>
                <option value="keno_50">Keno 50</option>
                <option value="keno_60">Keno 60</option>
                <option value="keno_70">Keno 70</option>
                <option value="keno_80">Keno 80</option>
              </select>
            </div>
            <div>
              <label>Risque</label>
              <select id="dg-keno-risk">
                <option value="CLASSIC">Classic</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>
            </div>
          </div>
          <label class="dg-check-row">
            <input type="checkbox" id="dg-keno-random" ${cfg.kenoRandom ? "checked" : ""} />
            Numéros aléatoires à chaque tour
          </label>
          <div class="dg-row">
            <div>
              <label>Nb numéros (aléatoire / champ vide)</label>
              <input id="dg-keno-pick-count" type="number" min="1" max="80" value="${cfg.kenoPickCount}" />
            </div>
          </div>
          <label>Numéros (séparés par virgule)</label>
          <input id="dg-keno-numbers" type="text" value="${cfg.kenoNumbers}" placeholder="vide = aléatoire" />
        </div>

        <div id="dg-mines-fields" class="dg-fields" style="display:none">
          <div class="dg-row">
            <div>
              <label>Mines (1–24)</label>
              <input id="dg-mines-count" type="number" min="1" max="24" value="${cfg.minesCount}" />
            </div>
            <div>
              <label>Cases à ouvrir</label>
              <input id="dg-mines-reveals" type="number" min="1" max="24" value="${cfg.minesReveals}" />
            </div>
          </div>
          <div class="dg-label-row">
            <label>Tuiles (0–24, vide = aléatoire)</label>
            <button type="button" id="dg-mines-schema-btn" class="dg-help-btn" title="Voir le schéma">?</button>
          </div>
          <input id="dg-mines-tiles" type="text" value="${cfg.minesTiles}" placeholder="1,6" />
        </div>

        <div class="dg-btns">
          <button id="dg-start">▶ Start</button>
          <button id="dg-stop">■ Stop</button>
          <button id="dg-cashout" title="Cashout partie Mines active" style="display:none">💰</button>
          <button id="dg-reset" title="Reset stats">↺</button>
        </div>
        <div id="dg-status">Prêt</div>
        <div class="dg-stats-row">
          <div class="dg-stats-block">
            <div id="dg-stats">Paris: 0 · W: 0 · L: 0</div>
            <div id="dg-stats-pnl" class="dg-pnl-pos">+0 ${cfg.asset || ""}</div>
            <div id="dg-stats-pnl-fiat" class="dg-pnl-pos" style="display:none"></div>
          </div>
          <button type="button" id="dg-history-btn" title="Historique des paris">📜</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    const modal = document.createElement("div");
    modal.id = "dg-mines-modal";
    modal.innerHTML = `
      <div class="dg-modal-box">
        <div class="dg-modal-head">
          <span>Schéma tuiles Mines</span>
          <button type="button" class="dg-modal-close" id="dg-mines-modal-close">×</button>
        </div>
        <div class="dg-modal-body">
          <p class="dg-modal-hint">5×5 — de 0 à 24, gauche → droite, haut → bas. Clique pour sélectionner.</p>
          <div class="dg-mines-grid">${buildMinesGridHtml()}</div>
          <p class="dg-modal-example">Ex: <b>1,6</b> = 2ᵉ case en haut + 2ᵉ ligne, 2ᵉ colonne</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const histModal = document.createElement("div");
    histModal.id = "dg-history-modal";
    histModal.innerHTML = `
      <div class="dg-modal-box">
        <div class="dg-modal-head">
          <span>📜 Historique</span>
          <button type="button" class="dg-modal-close" id="dg-history-modal-close">×</button>
        </div>
        <div class="dg-modal-body">
          <div id="dg-history-stats"></div>
          <div class="dg-hist-filters">
            <button type="button" class="dg-hist-filter dg-active" data-filter="all">Tous</button>
            <button type="button" class="dg-hist-filter" data-filter="win">Gains</button>
            <button type="button" class="dg-hist-filter" data-filter="loss">Pertes</button>
            <button type="button" class="dg-hist-filter" data-filter="big">🔥 ×${BIG_WIN_MULT}+</button>
          </div>
          <div id="dg-history-list"></div>
        </div>
        <div class="dg-modal-foot">
          <button type="button" id="dg-history-clear">Vider</button>
          <button type="button" id="dg-history-close-btn">Fermer</button>
        </div>
      </div>
    `;
    document.body.appendChild(histModal);

    document.getElementById("dg-game").value = cfg.game;
    document.getElementById("dg-dice-type").value = cfg.diceType;
    document.getElementById("dg-plinko-risk").value = cfg.plinkoRisk;
    document.getElementById("dg-keno-variant").value = cfg.kenoVariant;
    document.getElementById("dg-keno-risk").value = cfg.kenoRisk;
    const kenoRandom = document.getElementById("dg-keno-random");
    if (kenoRandom) kenoRandom.checked = cfg.kenoRandom;
    const kenoPick = document.getElementById("dg-keno-pick-count");
    if (kenoPick) kenoPick.value = String(cfg.kenoPickCount);
    toggleGameFields();
    setModeValue("win", cfg.winMode);
    setModeValue("loss", cfg.lossMode);
    refreshReadyStatus();
    updateStats();
    updateRunButtons();
    startAssetSync();
    startPriceRefresh();

    document.querySelectorAll(".dg-mode-btn").forEach((btn) => {
      btn.onclick = () => {
        const group = btn.dataset.group;
        if (!group) return;
        setModeValue(group, btn.dataset.value);
        readForm();
      };
    });
    ["dg-win-pct", "dg-loss-pct", "dg-stop-profit", "dg-stop-loss"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => readForm());
    });

    document.getElementById("dg-start").onclick = () => runLoop();
    document.getElementById("dg-stop").onclick = stop;
    document.getElementById("dg-cashout").onclick = () => manualMinesCashout();
    document.getElementById("dg-reset").onclick = resetStats;
    document.getElementById("dg-close").onclick = () => { panel.style.display = "none"; };
    document.getElementById("dg-game").onchange = () => { readForm(); };
    ["dg-keno-variant", "dg-keno-risk", "dg-keno-numbers", "dg-keno-pick-count"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", () => readForm());
    });
    document.getElementById("dg-keno-random")?.addEventListener("change", () => readForm());

    document.getElementById("dg-mines-schema-btn").onclick = openMinesModal;
    document.getElementById("dg-mines-modal-close").onclick = closeMinesModal;
    modal.onclick = (e) => { if (e.target === modal) closeMinesModal(); };
    modal.querySelectorAll(".dg-mines-cell").forEach((cell) => {
      cell.onclick = () => toggleMinesTileInInput(parseInt(cell.dataset.tile, 10));
    });
    document.getElementById("dg-mines-tiles").oninput = updateMinesModalHighlight;

    document.getElementById("dg-history-btn").onclick = openHistoryModal;
    document.getElementById("dg-history-modal-close").onclick = closeHistoryModal;
    document.getElementById("dg-history-close-btn").onclick = closeHistoryModal;
    document.getElementById("dg-history-clear").onclick = clearHistory;
    histModal.onclick = (e) => { if (e.target === histModal) closeHistoryModal(); };
    histModal.querySelectorAll(".dg-hist-filter").forEach((btn) => {
      btn.onclick = () => {
        historyFilter = btn.dataset.filter || "all";
        histModal.querySelectorAll(".dg-hist-filter").forEach((b) => {
          b.classList.toggle("dg-active", b.dataset.filter === historyFilter);
        });
        renderHistory();
      };
    });
    renderHistory();

    // drag
    const head = panel.querySelector(".dg-head");
    let ox, oy, dragging = false;
    head.onmousedown = (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
    };
    document.onmousemove = (e) => {
      if (!dragging) return;
      panel.style.left = e.clientX - ox + "px";
      panel.style.top = e.clientY - oy + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    };
    document.onmouseup = () => { dragging = false; };

    // raccourci Alt+T pour afficher/masquer
    document.addEventListener("keydown", (e) => {
      if (e.altKey && e.key.toLowerCase() === "t") {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      buildUI();
      ensureAsset();
    });
  } else {
    buildUI();
    ensureAsset();
  }
})();
