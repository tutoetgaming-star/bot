// ==UserScript==
// @name         Degen Turbo — Originals
// @namespace    degen-turbo
// @version      1.8.4
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
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const WIN = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const API = "https://api.degen.com/v1";
  const MIN_DELAY = 30; // limite site ~50 ms entre paris
  const MINES_STEP_MS = 50; // pause entre appels Mines (start/reveal/cashout)
  const KNOWN_ASSETS = ["USDT", "BTC", "ETH", "USDC", "TRX", "SOL", "LTC", "DOGE", "XRP"];
  const KNOWN_SET = new Set(KNOWN_ASSETS);
  const HISTORY_MAX = 300;
  const BIG_WIN_MULT = 2;

  let lastBalanceData = null;
  let assetSyncTimer = null;
  let assetConfirmed = false;

  const cfg = {
    game: GM_getValue("dg_game", "dice"),
    asset: GM_getValue("dg_asset", ""),
    betAmount: GM_getValue("dg_bet", "0.0001"),
    delayMs: parseInt(GM_getValue("dg_delay", String(MIN_DELAY)), 10) || MIN_DELAY,
    maxBets: parseInt(GM_getValue("dg_max", "0"), 10) || 0,
    diceType: GM_getValue("dg_dice_type", "ROLL_OVER"),
    diceTarget: parseFloat(GM_getValue("dg_dice_target", "50")) || 50,
    limboMult: parseFloat(GM_getValue("dg_limbo_mult", "2")) || 2,
    plinkoRisk: GM_getValue("dg_plinko_risk", "LOW"),
    plinkoRows: parseInt(GM_getValue("dg_plinko_rows", "8"), 10) || 8,
    kenoVariant: GM_getValue("dg_keno_variant", "keno_40"),
    kenoRisk: GM_getValue("dg_keno_risk", "CLASSIC"),
    kenoNumbers: GM_getValue("dg_keno_numbers", "1,2,3,4"),
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

  function installAssetHooks() {
    const origFetch = WIN.fetch;
    if (!origFetch._dgAssetHooked) {
      WIN.fetch = async function (input, init) {
        const url = typeof input === "string" ? input : input?.url || "";
        const isBalance = /\/balance\/primary/.test(url);
        const res = await origFetch.apply(this, arguments);
        if (isBalance && res.ok) {
          try {
            const data = await res.clone().json();
            resolveAssetFromBalance(data);
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
      XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", function () {
          if (!/\/balance\/primary/.test(this._dgUrl || "")) return;
          if (this.status < 200 || this.status >= 300) return;
          try {
            const data = JSON.parse(this.responseText);
            resolveAssetFromBalance(data);
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
  let lastMinesGameId = null;

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

  async function betKeno() {
    const selectedNumbers = parseKenoNumbers();
    if (selectedNumbers.length === 0) {
      throw new Error("Aucun numéro Keno valide");
    }
    return api("/games/keno/bet", betBody({
      betAmount: cfg.betAmount,
      variantId: cfg.kenoVariant,
      riskLevel: cfg.kenoRisk,
      selectedNumbers
    }));
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
    const mult = game.currentMultiplier || "1";
    return {
      betAmount: game.betAmount,
      winAmount: String(payout),
      status: hitMine ? "LOST" : payout > 0 ? "WON" : game.status,
      minesDetail: hitMine
        ? `mine! (×${mult})`
        : `${(game.revealedTiles || []).length} gem(s) ×${mult}`
    };
  }

  function extractGameIdFromError(data) {
    if (!data) return null;
    if (data.id) return data.id;
    if (data.gameId) return data.gameId;
    if (data.game?.id) return data.game.id;
    const m = data.message;
    if (m?.gameId) return m.gameId;
    if (m?.id) return m.id;
    try {
      const hit = JSON.stringify(data).match(/"gameId"\s*:\s*"([^"]+)"/);
      return hit?.[1] || null;
    } catch (_) {
      return null;
    }
  }

  async function cashoutMinesGame(gameId) {
    if (!gameId) return false;
    try {
      await api("/games/mines/cashout", { gameId });
      await sleep(MINES_STEP_MS);
      return true;
    } catch (e) {
      log("Cashout échoué:", e.message);
      return false;
    }
  }

  async function abandonMinesGame(gameId) {
    if (!gameId) return false;
    const paths = ["/games/mines/abandon", "/games/mines/forfeit", "/games/mines/cancel"];
    for (const path of paths) {
      try {
        await api(path, { gameId });
        await sleep(MINES_STEP_MS);
        return true;
      } catch (_) {}
    }
    return false;
  }

  async function closeActiveMinesGame(quiet) {
    if (!lastMinesGameId) return false;
    if (!quiet) setStatus("Cashout partie Mines…");
    const gameId = lastMinesGameId;
    if (await cashoutMinesGame(gameId)) {
      lastMinesGameId = null;
      if (!quiet) setStatus("Cashout OK");
      return true;
    }
    if (await abandonMinesGame(gameId)) {
      lastMinesGameId = null;
      if (!quiet) setStatus("Partie Mines fermée");
      return true;
    }
    return false;
  }

  async function recoverMinesFromError(err) {
    const gameId = extractGameIdFromError(err?.data) || lastMinesGameId;
    if (!gameId) return false;
    if (await cashoutMinesGame(gameId)) {
      lastMinesGameId = null;
      return true;
    }
    if (await abandonMinesGame(gameId)) {
      lastMinesGameId = null;
      return true;
    }
    return false;
  }

  async function minesStart(payload) {
    try {
      const game = await api("/games/mines/start", payload);
      lastMinesGameId = game.id || null;
      return game;
    } catch (e) {
      if (e.status !== 400) throw e;
      log("Mines start 400 — récupération…", e.data);
      await recoverMinesFromError(e);
      await sleep(400);
      const game = await api("/games/mines/start", payload);
      lastMinesGameId = game.id || null;
      return game;
    }
  }

  async function betMines() {
    const fixedTiles = parseMinesTiles();
    const reveals = Math.max(1, Math.min(cfg.minesReveals, MINES_GRID - cfg.minesCount));

    let game = await minesStart(betBody({
      betAmount: cfg.betAmount,
      minesCount: cfg.minesCount,
      gameSessionId: uuid()
    }));

    for (let i = 0; i < reveals; i++) {
      if (game.status !== "ACTIVE") break;

      await sleep(MINES_STEP_MS);
      const tile = fixedTiles[i] ?? pickMinesTile(game.revealedTiles || []);
      game = await api("/games/mines/reveal", {
        gameId: game.id,
        tilePosition: tile
      });

      if (game.status !== "ACTIVE") {
        lastMinesGameId = null;
        return normalizeMinesResult(game, true);
      }
    }

    if (game.status === "ACTIVE") {
      await sleep(MINES_STEP_MS);
      game = await api("/games/mines/cashout", { gameId: game.id });
    }

    lastMinesGameId = null;
    await sleep(MINES_STEP_MS);
    return normalizeMinesResult(game, false);
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

  function getBetDetail(data) {
    return data.minesDetail ?? data.rollResult ?? data.resultMultiplier
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

  function renderHistory() {
    const list = document.getElementById("dg-history-list");
    const summary = document.getElementById("dg-history-summary");
    if (!list) return;

    const items = historyFilter === "big" ? history.filter((h) => h.big) : history;
    const bigCount = history.filter((h) => h.big).length;
    const best = history.reduce((b, h) => (h.profit > 0 && (!b || h.profit > b.profit) ? h : b), null);

    if (summary) {
      summary.textContent = `${history.length} paris · ${bigCount} gros gains · Meilleur: +${best ? formatAmt(best.profit) : "0"} ${best?.asset || cfg.asset || ""}`;
    }

    if (!items.length) {
      list.innerHTML = `<div class="dg-hist-empty">${historyFilter === "big" ? "Aucun gros gain" : "Aucun pari enregistré"}</div>`;
      return;
    }

    list.innerHTML = items.map((h) => `
      <div class="dg-hist-item ${h.big ? "dg-hist-big" : ""} ${h.won ? "dg-hist-win" : "dg-hist-loss"}">
        <div class="dg-hist-top">
          <span>#${h.id} · ${h.game} ${h.big ? "🔥" : ""}</span>
          <span>${new Date(h.time).toLocaleTimeString()}</span>
        </div>
        <div class="dg-hist-detail">${h.detail}</div>
        <div class="dg-hist-bottom">
          <span>Mise ${formatAmt(h.bet)}</span>
          <span class="${h.profit >= 0 ? "dg-hist-pos" : "dg-hist-neg"}">${h.profit >= 0 ? "+" : ""}${formatAmt(h.profit)} ${h.asset}</span>
          ${h.mult > 0 ? `<span>×${h.mult.toFixed(2)}</span>` : ""}
        </div>
      </div>
    `).join("");
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
    const el = document.getElementById("dg-stats");
    if (!el) return;
    el.textContent =
      `Paris: ${stats.bets} | W: ${stats.wins} L: ${stats.losses} | P/L: ${stats.profit >= 0 ? "+" : ""}${stats.profit.toFixed(8)} ${cfg.asset || ""}`;
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
    running = true;
    abort = false;
    baseBetAmount = formatBetAmount(cfg.betAmount);
    setStatus("En cours…");

    const betFn = betFns[cfg.game];
    if (!betFn) {
      setStatus("Jeu inconnu");
      running = false;
      return;
    }

    const delay = cfg.game === "mines"
      ? Math.max(200, cfg.delayMs)
      : Math.max(MIN_DELAY, cfg.delayMs);

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
            setStatus("Rate limit — pause 2s");
            await sleep(2000);
            continue;
          }
          if (e.status === 403) {
            setStatus("Non connecté ou session expirée");
            break;
          }
          if (e.status === 400) {
            const hint = cfg.asset ? ` (${cfg.asset}, mise ${cfg.betAmount})` : "";
            setStatus("Bad request" + hint + ": " + e.message);
            log(e.path || cfg.game, e.data);
            if (cfg.game === "mines") {
              await recoverMinesFromError(e);
              await sleep(500);
            } else {
              await sleep(1000);
            }
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
      setStatus(abort ? "Arrêté" : "Terminé");
    }
  }

  function stop() {
    abort = true;
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
    cfg.delayMs = parseInt(document.getElementById("dg-delay").value, 10) || MIN_DELAY;
    cfg.maxBets = parseInt(document.getElementById("dg-max").value, 10) || 0;
    cfg.diceType = document.getElementById("dg-dice-type").value;
    cfg.diceTarget = clampDiceTarget(document.getElementById("dg-dice-target").value);
    cfg.limboMult = clampLimboMult(document.getElementById("dg-limbo-mult").value);
    cfg.plinkoRisk = document.getElementById("dg-plinko-risk").value;
    cfg.plinkoRows = clampPlinkoRows(document.getElementById("dg-plinko-rows").value);
    cfg.kenoVariant = document.getElementById("dg-keno-variant").value;
    cfg.kenoRisk = document.getElementById("dg-keno-risk").value;
    cfg.kenoNumbers = document.getElementById("dg-keno-numbers").value.trim();
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
    if (!lastMinesGameId) {
      setStatus("Aucune partie Mines en mémoire — relance le bot ou attends une erreur 400");
      return;
    }
    setStatus("Cashout partie Mines…");
    const ok = await closeActiveMinesGame();
    setStatus(ok ? "Cashout OK" : "Cashout impossible");
    refreshReadyStatus();
  }

  function buildUI() {
    if (document.getElementById("degen-turbo-panel")) return;

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
      #degen-turbo-panel .dg-body { padding: 10px 12px; max-height: 75vh; overflow-y: auto; }
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
      }
      #dg-start { background: #22c55e; color: #000; }
      #dg-stop { background: #ef4444; color: #fff; }
      #dg-reset { background: #333; color: #ccc; flex: 0 0 auto; padding: 8px 10px; }
      #dg-cashout { background: #ca8a04; color: #000; flex: 0 0 auto; padding: 8px 10px; }
      #dg-status { margin-top: 8px; font-size: 11px; color: #888; min-height: 16px; }
      #dg-stats { margin-top: 4px; font-size: 11px; color: #6ee7b7; flex: 1; }
      #degen-turbo-panel .dg-stats-row {
        display: flex; align-items: center; gap: 6px; margin-top: 4px;
      }
      #degen-turbo-panel #dg-history-btn {
        flex: 0 0 auto; padding: 4px 8px; background: #2a2a35; color: #ccc;
        border: 1px solid #444; border-radius: 6px; cursor: pointer; font-size: 11px;
      }
      #degen-turbo-panel #dg-history-btn:hover { background: #333; color: #fff; }
      #dg-history-modal {
        display: none; position: fixed; inset: 0; z-index: 1000001;
        background: rgba(0,0,0,.65); align-items: center; justify-content: center;
      }
      #dg-history-modal.dg-open { display: flex; }
      #dg-history-modal .dg-modal-box {
        width: 320px; max-height: 80vh; display: flex; flex-direction: column;
        background: #14141a; border: 1px solid #2a2a35; border-radius: 10px;
        color: #e8e8ef; font: 11px/1.4 "Work Sans", sans-serif;
        box-shadow: 0 12px 40px rgba(0,0,0,.6);
      }
      #dg-history-modal .dg-modal-head {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 10px; background: #1a1a22; border-radius: 10px 10px 0 0; font-weight: 600;
      }
      #dg-history-modal .dg-modal-close {
        background: none; border: none; color: #666; cursor: pointer; font-size: 16px; padding: 0 4px;
      }
      #dg-history-modal .dg-modal-body { padding: 10px; overflow: hidden; display: flex; flex-direction: column; flex: 1; min-height: 0; }
      #dg-history-modal .dg-modal-hint { margin: 0 0 8px; color: #888; font-size: 10px; }
      #dg-history-summary { font-size: 10px; color: #888; margin: 0 0 8px; }
      #dg-history-modal .dg-hist-filters { display: flex; gap: 4px; margin-bottom: 8px; }
      #dg-history-modal .dg-hist-filter {
        flex: 1; padding: 5px; background: #0d0d10; border: 1px solid #333;
        border-radius: 6px; color: #888; font-size: 10px; cursor: pointer;
      }
      #dg-history-modal .dg-hist-filter.dg-active { background: #e8e8ef; color: #000; border-color: #e8e8ef; font-weight: 600; }
      #dg-history-list { overflow-y: auto; flex: 1; max-height: 340px; }
      #dg-history-modal .dg-hist-item {
        padding: 8px; margin-bottom: 4px; background: #0d0d10; border: 1px solid #2a2a35;
        border-radius: 6px; font-size: 10px;
      }
      #dg-history-modal .dg-hist-item.dg-hist-big { border-color: #ca8a04; background: #1a1508; }
      #dg-history-modal .dg-hist-top { display: flex; justify-content: space-between; color: #aaa; margin-bottom: 3px; }
      #dg-history-modal .dg-hist-detail { color: #ccc; margin-bottom: 4px; }
      #dg-history-modal .dg-hist-bottom { display: flex; justify-content: space-between; gap: 6px; color: #888; }
      #dg-history-modal .dg-hist-pos { color: #6ee7b7; font-weight: 600; }
      #dg-history-modal .dg-hist-neg { color: #f87171; font-weight: 600; }
      #dg-history-modal .dg-hist-empty { text-align: center; color: #666; padding: 20px; font-size: 11px; }
      #dg-history-modal .dg-modal-foot {
        display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #2a2a35;
      }
      #dg-history-modal .dg-modal-foot button {
        flex: 1; padding: 6px; border: none; border-radius: 6px; font-size: 11px; cursor: pointer;
      }
      #dg-history-clear { background: #333; color: #ccc; }
      #dg-history-close-btn { background: #2a2a35; color: #e8e8ef; }
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
      #degen-turbo-panel .dg-mode-pct span { color: #666; font-size: 10px; flex-shrink: 0; }
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
        <span>⚡ Degen Turbo</span>
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
            <input id="dg-delay" type="number" min="55" value="${cfg.delayMs}" />
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
                <option value="keno_10">Keno 10</option>
                <option value="keno_20">Keno 20</option>
                <option value="keno_40">Keno 40</option>
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
          <label>Numéros (séparés par virgule)</label>
          <input id="dg-keno-numbers" type="text" value="${cfg.kenoNumbers}" placeholder="20,12,13,21" />
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
          <div id="dg-stats">Paris: 0 | W: 0 L: 0 | P/L: 0</div>
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
          <p class="dg-modal-hint" id="dg-history-summary">0 paris</p>
          <div class="dg-hist-filters">
            <button type="button" class="dg-hist-filter dg-active" data-filter="all">Tous</button>
            <button type="button" class="dg-hist-filter" data-filter="big">🔥 Gros gains (×${BIG_WIN_MULT}+)</button>
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
    toggleGameFields();
    setModeValue("win", cfg.winMode);
    setModeValue("loss", cfg.lossMode);
    refreshReadyStatus();
    updateStats();
    startAssetSync();

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
