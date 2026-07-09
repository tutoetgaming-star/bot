// ==UserScript==
// @name         Degen Turbo — Originals
// @namespace    degen-turbo
// @version      1.4.0
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
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const WIN = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const API = "https://api.degen.com/v1";
  const MIN_DELAY = 55; // limite site ~50 ms entre paris
  const DEFAULT_ASSETS = ["BTC", "ETH", "USDC", "USDT", "LTC", "DOGE", "TRX", "XRP", "SOL"];

  const cfg = {
    game: GM_getValue("dg_game", "dice"),
    asset: "TRX",
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
    minesTiles: GM_getValue("dg_mines_tiles", "")
  };

  const stats = { bets: 0, wins: 0, losses: 0, profit: 0 };
  let running = false;
  let abort = false;
  let liveBalance = null;
  let balanceSyncTimer = null;

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

  async function apiGet(path) {
    const res = await WIN.fetch(API + path, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.message || data?.messages || res.statusText || "Erreur API");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function betBody(extra) {
    const body = { ...extra };
    if (cfg.asset) body.asset = cfg.asset;
    return body;
  }

  async function api(path, body) {
    const res = await WIN.fetch(API + path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.message || data?.messages || res.statusText || "Erreur API");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function betDice() {
    return api("/games/dice/bet", betBody({
      gameSessionId: uuid(),
      betAmount: String(cfg.betAmount),
      betType: cfg.diceType,
      targetNumber: Number(cfg.diceTarget.toFixed(2))
    }));
  }

  async function betLimbo() {
    return api("/games/limbo/bet", betBody({
      betAmount: String(cfg.betAmount),
      targetMultiplier: Number(cfg.limboMult)
    }));
  }

  async function betPlinko() {
    return api("/games/plinko/bet", betBody({
      betAmount: String(cfg.betAmount),
      riskLevel: cfg.plinkoRisk,
      rowCount: cfg.plinkoRows
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
      betAmount: String(cfg.betAmount),
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

  async function betMines() {
    const fixedTiles = parseMinesTiles();
    const reveals = Math.max(1, Math.min(cfg.minesReveals, MINES_GRID - cfg.minesCount));

    let game = await api("/games/mines/start", betBody({
      betAmount: String(cfg.betAmount),
      minesCount: cfg.minesCount,
      gameSessionId: uuid()
    }));

    for (let i = 0; i < reveals; i++) {
      if (game.status !== "ACTIVE") break;

      const tile = fixedTiles[i] ?? pickMinesTile(game.revealedTiles || []);
      game = await api("/games/mines/reveal", {
        gameId: game.id,
        tilePosition: tile
      });

      if (game.status !== "ACTIVE") {
        return normalizeMinesResult(game, true);
      }
    }

    if (game.status === "ACTIVE") {
      game = await api("/games/mines/cashout", { gameId: game.id });
    }

    return normalizeMinesResult(game, false);
  }

  const betFns = {
    dice: betDice,
    limbo: betLimbo,
    plinko: betPlinko,
    keno: betKeno,
    mines: betMines
  };

  function recordResult(data) {
    const bet = parseFloat(data.betAmount || cfg.betAmount) || 0;
    const win = parseFloat(data.winAmount || data.finalPayout || 0) || 0;
    const delta = win - bet;
    stats.bets++;
    stats.profit += delta;
    const won = data.status === "WON" || win > 0;
    if (won) stats.wins++;
    else stats.losses++;
    if (liveBalance != null) {
      liveBalance += delta;
      updateLiveBalanceDisplay();
    }
  }

  function setStatus(msg) {
    const el = document.getElementById("dg-status");
    if (el) el.textContent = msg;
    log(msg);
  }

  function updateStats() {
    const el = document.getElementById("dg-stats");
    if (!el) return;
    el.textContent =
      `Paris: ${stats.bets} | W: ${stats.wins} L: ${stats.losses} | P/L: ${stats.profit >= 0 ? "+" : ""}${stats.profit.toFixed(8)} ${cfg.asset}`;
  }

  function formatBalance(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    if (n === 0) return "0";
    if (n < 0.0001) return n.toFixed(8);
    if (n < 1) return n.toFixed(6);
    return n.toFixed(4);
  }

  function parseAssetList(data) {
    if (!data) return [];
    const arr = Array.isArray(data)
      ? data
      : data.balances || data.assets || data.wallets || data.data || [];
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => ({
        asset: String(item.asset || item.symbol || item.currency || item.code || "").toUpperCase(),
        balance: item.balance ?? item.amount ?? item.available ?? item.freeBalance
      }))
      .filter((x) => x.asset);
  }

  function isKnownAsset(val) {
    return typeof val === "string" && DEFAULT_ASSETS.includes(val.toUpperCase());
  }

  function detectPageAsset() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const val = localStorage.getItem(key);
        if (!val) continue;
        if (/asset|currency|wallet/i.test(key) && isKnownAsset(val)) {
          return val.toUpperCase();
        }
        try {
          const j = JSON.parse(val);
          const a = j?.asset || j?.selectedAsset || j?.activeAsset || j?.currency;
          if (isKnownAsset(a)) return a.toUpperCase();
        } catch (_) {}
      }
    } catch (_) {}

    try {
      const nodes = document.querySelectorAll(
        "[data-asset], [data-currency], [data-symbol], [class*='asset'], [class*='currency']"
      );
      for (const node of nodes) {
        const raw = node.dataset.asset || node.dataset.currency || node.dataset.symbol
          || node.textContent?.trim();
        if (isKnownAsset(raw)) return raw.toUpperCase();
      }
    } catch (_) {}

    return null;
  }

  function syncPageAsset() {
    const detected = detectPageAsset();
    if (!detected) return false;
    if (detected !== cfg.asset) {
      cfg.asset = detected;
      liveBalance = null;
      fetchLiveBalance();
    }
    updateLiveBalanceDisplay();
    return true;
  }

  function updateLiveBalanceDisplay() {
    const assetEl = document.getElementById("dg-live-asset");
    const balEl = document.getElementById("dg-live-balance");
    if (assetEl) assetEl.textContent = cfg.asset;
    if (balEl) {
      balEl.textContent = liveBalance != null
        ? `${formatBalance(liveBalance)} ${cfg.asset}`
        : "…";
    }
  }

  async function fetchLiveBalance() {
    const paths = ["/wallet/balances", "/wallets", "/user/balances", "/balances"];
    for (const path of paths) {
      try {
        const data = await apiGet(path);
        const list = parseAssetList(data);
        const match = list.find((x) => x.asset === cfg.asset);
        if (match?.balance != null) {
          liveBalance = parseFloat(match.balance);
          updateLiveBalanceDisplay();
          return;
        }
      } catch (_) {}
    }
  }

  function startBalanceSync() {
    syncPageAsset();
    fetchLiveBalance();
    if (balanceSyncTimer) clearInterval(balanceSyncTimer);
    balanceSyncTimer = setInterval(() => {
      syncPageAsset();
      if (!running) fetchLiveBalance();
    }, 3000);
  }

  async function runLoop() {
    if (running) return;
    syncPageAsset();
    if (liveBalance == null) await fetchLiveBalance();
    running = true;
    abort = false;
    setStatus("En cours…");

    const betFn = betFns[cfg.game];
    if (!betFn) {
      setStatus("Jeu inconnu");
      running = false;
      return;
    }

    const delay = Math.max(MIN_DELAY, cfg.delayMs);

    try {
      while (!abort) {
        if (cfg.maxBets > 0 && stats.bets >= cfg.maxBets) break;

        try {
          const data = await betFn();
          recordResult(data);
          updateStats();
          const detail = data.minesDetail ?? data.rollResult ?? data.resultMultiplier
            ?? (data.matches != null ? `${data.matches} match(es) ×${data.payoutMultiplier}` : null)
            ?? "—";
          setStatus(`#${stats.bets} → ${data.status} (${detail})`);
        } catch (e) {
          if (e.status === 429) {
            setStatus("Rate limit — pause 2s");
            await sleep(2000);
            continue;
          }
          if (e.status === 403) {
            setStatus("Non connecté ou session expirée");
            break;
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
    syncPageAsset();
    cfg.game = document.getElementById("dg-game").value;
    cfg.betAmount = document.getElementById("dg-bet").value.trim();
    cfg.delayMs = parseInt(document.getElementById("dg-delay").value, 10) || MIN_DELAY;
    cfg.maxBets = parseInt(document.getElementById("dg-max").value, 10) || 0;
    cfg.diceType = document.getElementById("dg-dice-type").value;
    cfg.diceTarget = parseFloat(document.getElementById("dg-dice-target").value) || 50;
    cfg.limboMult = parseFloat(document.getElementById("dg-limbo-mult").value) || 2;
    cfg.plinkoRisk = document.getElementById("dg-plinko-risk").value;
    cfg.plinkoRows = parseInt(document.getElementById("dg-plinko-rows").value, 10) || 8;
    cfg.kenoVariant = document.getElementById("dg-keno-variant").value;
    cfg.kenoRisk = document.getElementById("dg-keno-risk").value;
    cfg.kenoNumbers = document.getElementById("dg-keno-numbers").value.trim();
    cfg.minesCount = parseInt(document.getElementById("dg-mines-count").value, 10) || 3;
    cfg.minesReveals = parseInt(document.getElementById("dg-mines-reveals").value, 10) || 1;
    cfg.minesTiles = document.getElementById("dg-mines-tiles").value.trim();
    save();
    updateLiveBalanceDisplay();
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
      #degen-turbo-panel .dg-body { padding: 10px 12px; }
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
      #dg-status { margin-top: 8px; font-size: 11px; color: #888; min-height: 16px; }
      #dg-stats { margin-top: 4px; font-size: 11px; color: #6ee7b7; }
      #degen-turbo-panel .dg-close {
        background: none; border: none; color: #666; cursor: pointer; font-size: 16px; padding: 0 4px;
      }
      #degen-turbo-panel .dg-fields { margin-top: 4px; }
      #degen-turbo-panel .dg-wallet {
        display: flex; justify-content: space-between; align-items: center;
        margin: 8px 0 4px; padding: 8px 10px; background: #0d0d10;
        border: 1px solid #2a2a35; border-radius: 6px;
      }
      #degen-turbo-panel .dg-wallet-label { color: #888; font-size: 10px; }
      #degen-turbo-panel .dg-wallet-value { font-size: 12px; font-weight: 600; color: #e8e8ef; }
      #dg-live-balance { font-size: 13px; font-weight: 700; color: #6ee7b7; }
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

        <div class="dg-wallet">
          <div>
            <div class="dg-wallet-label">Crypto (site)</div>
            <div class="dg-wallet-value" id="dg-live-asset">—</div>
          </div>
          <div style="text-align:right">
            <div class="dg-wallet-label">Solde temps réel</div>
            <div id="dg-live-balance">…</div>
          </div>
        </div>

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
          <button id="dg-reset" title="Reset stats">↺</button>
        </div>
        <div id="dg-status">Prêt — connecte-toi sur Degen</div>
        <div id="dg-stats">Paris: 0 | W: 0 L: 0 | P/L: 0</div>
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

    document.getElementById("dg-game").value = cfg.game;
    document.getElementById("dg-dice-type").value = cfg.diceType;
    document.getElementById("dg-plinko-risk").value = cfg.plinkoRisk;
    document.getElementById("dg-keno-variant").value = cfg.kenoVariant;
    document.getElementById("dg-keno-risk").value = cfg.kenoRisk;
    toggleGameFields();

    document.getElementById("dg-start").onclick = () => { readForm(); runLoop(); };
    document.getElementById("dg-stop").onclick = stop;
    document.getElementById("dg-reset").onclick = resetStats;
    document.getElementById("dg-close").onclick = () => { panel.style.display = "none"; };
    document.getElementById("dg-game").onchange = () => { readForm(); };
    startBalanceSync();

    document.getElementById("dg-mines-schema-btn").onclick = openMinesModal;
    document.getElementById("dg-mines-modal-close").onclick = closeMinesModal;
    modal.onclick = (e) => { if (e.target === modal) closeMinesModal(); };
    modal.querySelectorAll(".dg-mines-cell").forEach((cell) => {
      cell.onclick = () => toggleMinesTileInInput(parseInt(cell.dataset.tile, 10));
    });
    document.getElementById("dg-mines-tiles").oninput = updateMinesModalHighlight;

    // drag
    const head = panel.querySelector(".dg-head");
    let ox, oy, dragging = false;
    head.onmousedown = (e) => {
      if (e.target.id === "dg-close") return;
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
    document.addEventListener("DOMContentLoaded", buildUI);
  } else {
    buildUI();
  }
})();
