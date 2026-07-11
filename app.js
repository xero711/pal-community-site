(() => {
  "use strict";

  const apiBase = "https://pal-api.xero-x.me";
  const fetchTimeoutMs = 8000;
  const normalRefreshMs = 12000;
  const maximumBackoffMs = 120000;
  const jitterRatio = 0.12;
  const pendingAddress = "公開準備中";
  const fallbackAddress = "218.183.35.208:8211";
  const fallbackCommunity = Object.freeze({
    name: "Xero PALServer",
    tagline: "みんなでつくる、安心して遊べるパルワールドサーバー。",
    gameAddress: fallbackAddress,
    rules: [
      "他の参加者を尊重し、迷惑行為をしないでください。",
      "不具合や不正利用を見つけた場合は運営に知らせてください。",
      "建築・拠点はほかの参加者の活動を妨げない場所に設置してください。",
    ],
    links: [],
  });

  const selectors = Object.freeze({
    communityName: "#community-name, [data-community-name]",
    communityTagline: "#community-tagline, [data-community-tagline]",
    statusLabel: "#status-label, [data-status-label]",
    statusMessage: "#status-message, [data-status-message]",
    statusIndicator: "#status-indicator, [data-status-indicator]",
    playerCount: "#player-count, [data-player-count]",
    updatedAt: "#updated-at, [data-updated-at]",
    gameAddress: "#game-address, [data-game-address]",
    copyButton: "#copy-address, [data-copy-address]",
    copyFeedback: "#address-feedback, [data-copy-feedback]",
    playersList: "#players-list, [data-players-list]",
    playersSummary: "#players-summary, [data-players-summary]",
    rulesList: "#rules-list, [data-rules-list]",
    communityLinks: "[data-community-links]",
  });

  const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
  const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const state = {
    community: { ...fallbackCommunity },
    communitySource: "fallback",
    communityRequest: null,
    communityLastAttemptAt: 0,
    status: null,
    statusRequest: null,
    phase: "loading",
    gameAddress: fallbackAddress,
    consecutiveFailures: 0,
    lastAttemptAt: 0,
    pollTimer: null,
    playerSignature: null,
    rulesSignature: null,
    linksSignature: null,
    copyResetTimers: new WeakMap(),
  };

  document.documentElement.classList.add("js");

  const queryAll = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const query = (selector, root = document) => root.querySelector(selector);

  function cleanText(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  function localizeUiText(value, fallback = "") {
    return cleanText(value, fallback)
      .replace(/Palworld/gi, "パルワールド")
      .replace(/\bCommunity\b/gi, "コミュニティ")
      .replace(/\bServer\b/gi, "サーバー")
      .replace(/\bPal\b/gi, "パル");
  }

  function finiteNumber(value) {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }

  function formatNumber(value, fallback = "—") {
    const converted = finiteNumber(value);
    return converted === null ? fallback : numberFormatter.format(converted);
  }

  function formatDuration(value) {
    const seconds = finiteNumber(value);
    if (seconds === null || seconds < 0) return "—";

    const totalMinutes = Math.floor(seconds / 60);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}日 ${hours}時間`;
    if (hours > 0) return `${hours}時間 ${minutes}分`;
    return `${minutes}分`;
  }

  function validDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function formatUpdatedAt(value, prefix = "更新") {
    const date = validDate(value);
    return date ? `${prefix} ${timeFormatter.format(date)}` : `${prefix}時刻不明`;
  }

  function setNodeText(node, value) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.value = value;
    } else {
      node.textContent = value;
    }
  }

  function setTextAll(selector, value) {
    queryAll(selector).forEach((node) => setNodeText(node, value));
  }

  function setUpdatedAt(value, prefix = "更新") {
    const date = validDate(value);
    const label = date ? `${prefix} ${timeFormatter.format(date)}` : `${prefix}時刻不明`;

    queryAll(selectors.updatedAt).forEach((node) => {
      setNodeText(node, label);
      if (node instanceof HTMLTimeElement) {
        if (date) node.dateTime = date.toISOString();
        else node.removeAttribute("datetime");
      }
    });
  }

  function normalizeAddress(value) {
    const address = cleanText(value);
    if (!address || address === pendingAddress || address === "—" || address.length > 200) return "";
    return address;
  }

  function safeLink(value) {
    if (!value || typeof value !== "object") return null;
    const label = cleanText(value.label);
    const rawUrl = cleanText(value.url);
    if (!label || !rawUrl) return null;

    try {
      const url = new URL(rawUrl, window.location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return { label, url: url.href };
    } catch {
      return null;
    }
  }

  function normalizeCommunity(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const rules = Array.isArray(source.rules)
      ? source.rules.map((rule) => cleanText(rule)).filter(Boolean)
      : [];
    const links = Array.isArray(source.links) ? source.links.map(safeLink).filter(Boolean) : [];

    return {
      name: localizeUiText(source.name, fallbackCommunity.name),
      tagline: localizeUiText(source.tagline, fallbackCommunity.tagline),
      gameAddress: normalizeAddress(source.gameAddress) || fallbackCommunity.gameAddress,
      rules: rules.length ? rules : [...fallbackCommunity.rules],
      links,
    };
  }

  function normalizePlayer(player) {
    if (!player || typeof player !== "object") return null;
    const name = cleanText(player.name, "名前非公開");
    return {
      name,
      level: finiteNumber(player.level),
      ping: finiteNumber(player.ping),
      buildingCount: finiteNumber(player.buildingCount),
    };
  }

  function normalizeStatus(payload) {
    if (!payload || typeof payload !== "object" || typeof payload.online !== "boolean") {
      throw new Error("サーバー状況の形式が正しくありません。");
    }

    const metricsSource = payload.metrics && typeof payload.metrics === "object" ? payload.metrics : null;
    const serverSource = payload.server && typeof payload.server === "object" ? payload.server : null;

    return {
      online: payload.online,
      updatedAt: validDate(payload.updatedAt)?.toISOString() || null,
      message: cleanText(
        payload.message,
        payload.online ? "サーバーはオンラインです。" : "サーバーは現在オフラインです。",
      ),
      gameAddress: normalizeAddress(payload.gameAddress),
      server: serverSource
        ? {
            name: localizeUiText(serverSource.name),
            description: localizeUiText(serverSource.description),
            version: cleanText(serverSource.version),
          }
        : null,
      metrics: metricsSource
        ? {
            currentPlayers: finiteNumber(metricsSource.currentPlayers),
            maxPlayers: finiteNumber(metricsSource.maxPlayers),
            serverFps: finiteNumber(metricsSource.serverFps),
            frameTimeMs: finiteNumber(metricsSource.frameTimeMs),
            uptimeSeconds: finiteNumber(metricsSource.uptimeSeconds),
            worldDays: finiteNumber(metricsSource.worldDays),
          }
        : null,
      players: Array.isArray(payload.players)
        ? payload.players.map(normalizePlayer).filter(Boolean)
        : [],
    };
  }

  function setPhase(phase) {
    const labels = {
      loading: "確認中",
      online: "オンライン",
      offline: "オフライン",
      error: "情報取得エラー",
    };
    const label = labels[phase] || labels.loading;
    state.phase = phase;

    document.documentElement.dataset.serverState = phase;
    if (document.body) document.body.dataset.serverState = phase;
    setTextAll(selectors.statusLabel, label);
    queryAll(selectors.statusLabel).forEach((node) => {
      node.dataset.status = phase;
    });

    queryAll(selectors.statusIndicator).forEach((indicator) => {
      indicator.classList.remove("loading", "online", "offline", "error");
      indicator.classList.add(phase);
      indicator.dataset.status = phase;
      indicator.setAttribute("aria-hidden", "true");
    });
  }

  function setCopyButtonLabel(button, value) {
    const label = query("[data-copy-label]", button);
    if (label) label.textContent = value;
    else button.textContent = value;
  }

  function copyFeedbackNodes(button) {
    const nodes = new Set(queryAll(selectors.copyFeedback));
    const liveRegion = document.getElementById("copy-live-region");
    if (liveRegion) nodes.add(liveRegion);
    const describedBy = button?.getAttribute("aria-describedby") || "";
    describedBy.split(/\s+/).filter(Boolean).forEach((id) => {
      const node = document.getElementById(id);
      if (node) nodes.add(node);
    });
    return [...nodes];
  }

  function announceCopy(button, message) {
    copyFeedbackNodes(button).forEach((node) => setNodeText(node, message));
  }

  function setGameAddress(value) {
    const address = normalizeAddress(value) || fallbackAddress;
    const available = Boolean(address);
    state.gameAddress = address;

    setTextAll(selectors.gameAddress, available ? address : pendingAddress);
    queryAll(selectors.copyButton).forEach((button) => {
      button.disabled = !available;
      button.setAttribute(
        "aria-label",
        available ? `サーバーアドレス ${address} をコピー` : "サーバーアドレスは公開準備中です",
      );
      if (!state.copyResetTimers.has(button)) {
        setCopyButtonLabel(button, available ? "アドレスをコピー" : pendingAddress);
        button.dataset.copyState = available ? "ready" : "unavailable";
      }
    });

    if (available) {
      setTextAll(selectors.copyFeedback, "サーバーアドレスをコピーして参加できます。");
    } else {
      setTextAll(selectors.copyFeedback, "サーバーアドレスは現在、公開準備中です。");
    }
  }

  function createRuleItem(rule) {
    const item = document.createElement("li");
    item.textContent = rule;
    return item;
  }

  function renderRules(rules) {
    const signature = JSON.stringify(rules);
    if (signature === state.rulesSignature) return;
    state.rulesSignature = signature;

    queryAll(selectors.rulesList).forEach((list) => {
      list.replaceChildren(...rules.map(createRuleItem));
    });
  }

  function createCommunityLink(link, listContainer) {
    const anchor = document.createElement("a");
    anchor.href = link.url;
    anchor.textContent = link.label;
    if (new URL(link.url).origin !== window.location.origin) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }

    if (["UL", "OL"].includes(listContainer.tagName)) {
      const item = document.createElement("li");
      item.append(anchor);
      return item;
    }
    return anchor;
  }

  function renderCommunityLinks(links) {
    if (!links.length) return;
    const signature = JSON.stringify(links);
    if (signature === state.linksSignature) return;
    state.linksSignature = signature;

    queryAll(selectors.communityLinks).forEach((container) => {
      container.replaceChildren(...links.map((link) => createCommunityLink(link, container)));
      container.hidden = false;
    });
  }

  function renderCommunity(payload, source = "api") {
    const community = normalizeCommunity(payload);
    state.community = community;
    state.communitySource = source;
    document.documentElement.dataset.communitySource = source;

    document.title = `${community.name} | 初心者歓迎コミュニティ`;
    setTextAll(selectors.communityName, community.name);
    setTextAll(selectors.communityTagline, community.tagline);
    renderRules(community.rules);
    renderCommunityLinks(community.links);
    setGameAddress(state.status?.gameAddress || community.gameAddress);
  }

  function playerSignature(players, phase) {
    return JSON.stringify([
      phase,
      players.map((player) => [player.name, player.level, player.ping, player.buildingCount]),
    ]);
  }

  function createPlayerItem(player) {
    const item = document.createElement("article");
    item.className = "player";
    item.dataset.playerName = player.name;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = player.name;

    const level = document.createElement("span");
    level.textContent = `レベル ${formatNumber(player.level)}`;

    const ping = document.createElement("span");
    ping.textContent = `応答 ${formatNumber(player.ping)} ミリ秒`;

    const buildings = document.createElement("span");
    buildings.textContent = `建築数 ${formatNumber(player.buildingCount)}`;

    item.append(name, level, ping, buildings);
    return item;
  }

  function createPlayersMessage(message) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = message;
    return empty;
  }

  function renderPlayers(players, phase) {
    const signature = playerSignature(players, phase);
    if (signature === state.playerSignature) return;
    state.playerSignature = signature;

    queryAll(selectors.playersList).forEach((list) => {
      if (phase === "error") {
        list.replaceChildren(createPlayersMessage("参加者情報を取得できません。自動で再確認します。"));
      } else if (phase === "offline") {
        list.replaceChildren(createPlayersMessage("サーバーがオンラインになると参加者情報を表示します。"));
      } else if (!players.length) {
        list.replaceChildren(createPlayersMessage("現在オンラインの参加者はいません。最初の参加者をお待ちしています！"));
      } else {
        list.replaceChildren(...players.map(createPlayerItem));
      }
    });
  }

  function playerCountText(metrics, players) {
    const current = metrics?.currentPlayers ?? players.length;
    const maximum = metrics?.maxPlayers;
    if (finiteNumber(current) === null && finiteNumber(maximum) === null) return "—";
    if (finiteNumber(maximum) === null) return formatNumber(current);
    return `${formatNumber(current)} / ${formatNumber(maximum)}`;
  }

  function renderStatus(payload) {
    const status = normalizeStatus(payload);
    const phase = status.online ? "online" : "offline";
    const metrics = status.metrics;

    state.status = status;
    state.consecutiveFailures = 0;
    document.documentElement.dataset.statusStale = "false";
    delete document.documentElement.dataset.statusError;
    setPhase(phase);
    setTextAll(selectors.statusMessage, status.message);
    setUpdatedAt(status.updatedAt);
    setGameAddress(status.gameAddress || state.community.gameAddress);

    const count = playerCountText(metrics, status.players);
    setTextAll(selectors.playerCount, count);
    setTextAll("[data-current-players]", formatNumber(metrics?.currentPlayers ?? status.players.length));
    setTextAll("[data-max-players]", formatNumber(metrics?.maxPlayers));
    setTextAll("#server-fps, [data-server-fps]", metrics?.serverFps === null || !metrics ? "—" : `${formatNumber(metrics.serverFps)} フレーム/秒`);
    setTextAll("#frame-time, [data-frame-time]", metrics?.frameTimeMs === null || !metrics ? "—" : `${formatNumber(metrics.frameTimeMs)} ミリ秒`);
    setTextAll("#uptime, [data-uptime]", formatDuration(metrics?.uptimeSeconds));
    setTextAll("#world-days, [data-world-days]", metrics?.worldDays === null || !metrics ? "—" : `${formatNumber(metrics.worldDays)} 日目`);

    const identity = status.server?.name
      ? `サーバー名：${status.server.name}${status.server.description ? ` — ${status.server.description}` : ""}`
      : `${state.community.name} — ${state.community.tagline}`;
    setTextAll("#server-identity, [data-server-identity]", identity);
    setTextAll(
      "#server-version, [data-server-version]",
      status.server?.version ? `サーバーバージョン ${status.server.version}` : "",
    );
    setTextAll(
      selectors.playersSummary,
      status.online ? `${status.players.length} 名を表示中` : "参加者情報はサーバー再開後に表示されます",
    );
    renderPlayers(status.players, phase);
  }

  function renderStatusError(error) {
    state.consecutiveFailures += 1;
    document.documentElement.dataset.statusStale = "true";
    setPhase("error");

    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    const message = offline
      ? "インターネット接続がありません。接続が戻り次第、自動で再確認します。"
      : "サーバー状況を取得できません。時間をおいて自動で再確認します。";
    setTextAll(selectors.statusMessage, message);

    if (state.status) {
      setUpdatedAt(state.status.updatedAt, "最終更新");
      setTextAll(selectors.playersSummary, "前回取得した参加者情報を表示しています");
    } else {
      setUpdatedAt(null, "更新");
      setTextAll(selectors.playerCount, "—");
      setTextAll("#server-fps, [data-server-fps]", "—");
      setTextAll("#frame-time, [data-frame-time]", "—");
      setTextAll("#uptime, [data-uptime]", "—");
      setTextAll("#world-days, [data-world-days]", "—");
      setTextAll("#server-identity, [data-server-identity]", `${state.community.name} — 情報を再取得しています。`);
      setTextAll(selectors.playersSummary, "参加者情報を再取得しています");
      renderPlayers([], "error");
    }

    setGameAddress(state.status?.gameAddress || state.community.gameAddress || fallbackAddress);
    document.documentElement.dataset.statusError = cleanText(error?.name, "request-error");
  }

  function renderLoading() {
    setPhase("loading");
    setTextAll(selectors.statusMessage, "接続状況を確認しています…");
    setTextAll(selectors.updatedAt, "更新を確認中");
    setGameAddress(state.community.gameAddress);
  }

  async function fetchJson(path) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const response = await fetch(`${apiBase}${path}`, {
        cache: "no-store",
        credentials: "omit",
        headers: { Accept: "application/json" },
        mode: "cors",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`通信に失敗しました（${response.status}）`);
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("通信がタイムアウトしました。");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function refreshCommunity() {
    if (state.communityRequest) return state.communityRequest;
    state.communityLastAttemptAt = Date.now();
    state.communityRequest = (async () => {
      try {
        renderCommunity(await fetchJson("/api/community"), "api");
        return true;
      } catch {
        if (state.communitySource !== "api") renderCommunity(fallbackCommunity, "fallback");
        return false;
      } finally {
        state.communityRequest = null;
      }
    })();
    return state.communityRequest;
  }

  function refreshStatus() {
    if (state.statusRequest) return state.statusRequest;
    state.lastAttemptAt = Date.now();
    state.statusRequest = (async () => {
      try {
        renderStatus(await fetchJson("/api/status"));
        return true;
      } catch (error) {
        renderStatusError(error);
        return false;
      } finally {
        state.statusRequest = null;
      }
    })();
    return state.statusRequest;
  }

  function clearPollTimer() {
    if (state.pollTimer !== null) {
      window.clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function jittered(milliseconds) {
    const variation = milliseconds * jitterRatio * ((Math.random() * 2) - 1);
    return Math.max(1000, Math.round(milliseconds + variation));
  }

  function nextPollDelay() {
    if (state.consecutiveFailures === 0) return jittered(normalRefreshMs);
    const exponent = Math.min(state.consecutiveFailures, 4);
    return jittered(Math.min(maximumBackoffMs, normalRefreshMs * (2 ** exponent)));
  }

  function schedulePoll(delay = nextPollDelay()) {
    clearPollTimer();
    if (document.hidden) return;

    state.pollTimer = window.setTimeout(async () => {
      state.pollTimer = null;
      await refreshStatus();
      if (
        state.communitySource !== "api"
        && Date.now() - state.communityLastAttemptAt >= 60000
      ) {
        void refreshCommunity();
      }
      schedulePoll();
    }, delay);
  }

  async function refreshNow() {
    clearPollTimer();
    await refreshStatus();
    schedulePoll();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearPollTimer();
      return;
    }

    if (state.communitySource !== "api") void refreshCommunity();
    const age = Date.now() - state.lastAttemptAt;
    if (!state.lastAttemptAt || age >= normalRefreshMs) void refreshNow();
    else schedulePoll(jittered(normalRefreshMs - age));
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // HTTP公開中や権限拒否時は、下の互換手段を試します。
      }
    }

    const textarea = document.createElement("textarea");
    const activeElement = document.activeElement;
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute("aria-hidden", "true");
    Object.assign(textarea.style, {
      position: "fixed",
      inset: "0 auto auto -9999px",
      opacity: "0",
    });
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    textarea.remove();
    try {
      activeElement?.focus({ preventScroll: true });
    } catch {
      activeElement?.focus?.();
    }
    if (!copied) throw new Error("クリップボードを利用できません。");
  }

  async function copyAddress(button) {
    const address = normalizeAddress(state.gameAddress);
    if (!address) {
      announceCopy(button, "サーバーアドレスは現在、公開準備中です。");
      return;
    }

    const oldTimer = state.copyResetTimers.get(button);
    if (oldTimer) window.clearTimeout(oldTimer);

    try {
      await writeClipboard(address);
      button.dataset.copyState = "success";
      button.classList.remove("is-error");
      button.classList.add("is-success");
      setCopyButtonLabel(button, "コピーしました");
      announceCopy(button, `サーバーアドレス ${address} をコピーしました。`);
    } catch {
      button.dataset.copyState = "error";
      button.classList.remove("is-success");
      button.classList.add("is-error");
      setCopyButtonLabel(button, "コピーできませんでした");
      announceCopy(button, `コピーできませんでした。${address} を選択して手動でコピーしてください。`);
    }

    const resetTimer = window.setTimeout(() => {
      state.copyResetTimers.delete(button);
      button.dataset.copyState = "ready";
      button.classList.remove("is-success", "is-error");
      setCopyButtonLabel(button, "アドレスをコピー");
      announceCopy(button, "サーバーアドレスをコピーして参加できます。");
    }, 2400);
    state.copyResetTimers.set(button, resetTimer);
  }

  function setupCopyButtons() {
    let liveRegion = document.getElementById("copy-live-region");
    if (!liveRegion) {
      liveRegion = document.createElement("p");
      liveRegion.id = "copy-live-region";
      liveRegion.className = "sr-only";
      liveRegion.setAttribute("role", "status");
      liveRegion.setAttribute("aria-live", "polite");
      liveRegion.setAttribute("aria-atomic", "true");
      document.body.append(liveRegion);
    }

    queryAll(selectors.copyButton).forEach((button) => {
      const describedBy = new Set((button.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
      describedBy.add(liveRegion.id);
      button.setAttribute("aria-describedby", [...describedBy].join(" "));
    });

    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest(selectors.copyButton) : null;
      if (!(target instanceof HTMLButtonElement) || target.disabled) return;
      void copyAddress(target);
    });
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function findTabPanel(tab, scope) {
    const controlledId = tab.getAttribute("aria-controls");
    if (controlledId) {
      const controlled = document.getElementById(controlledId);
      if (controlled) return controlled;
    }

    const target = cleanText(tab.dataset.tabTarget);
    if (target) {
      if (target.startsWith("#")) return document.getElementById(target.slice(1));
      try {
        const found = scope.querySelector(target) || document.querySelector(target);
        if (found) return found;
      } catch {
        // 不正なセレクターは、次のdata属性による検索へ進みます。
      }
    }

    const key = cleanText(tab.dataset.tab || tab.dataset.platformTab);
    if (!key) return null;
    const escaped = escapeAttribute(key);
    const selector = `[data-tab-panel="${escaped}"], [data-platform-panel="${escaped}"]`;
    return scope.querySelector(selector) || document.querySelector(selector);
  }

  function setupTabList(tabList, listIndex) {
    const tabSelector = "[role='tab'], [data-tab], [data-platform-tab], .join-tab";
    const tabs = queryAll(tabSelector, tabList).filter((tab) => tab.getAttribute("aria-disabled") !== "true");
    if (!tabs.length) return;

    const scope = tabList.closest("[data-tabs]") || tabList.parentElement || document;
    const entries = tabs.map((tab, tabIndex) => {
      const panel = findTabPanel(tab, scope);
      if (!tab.id) tab.id = `join-tab-${listIndex + 1}-${tabIndex + 1}`;
      tab.setAttribute("role", "tab");
      if (panel) {
        if (!panel.id) panel.id = `join-panel-${listIndex + 1}-${tabIndex + 1}`;
        tab.setAttribute("aria-controls", panel.id);
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
      }
      return { tab, panel };
    }).filter((entry) => entry.panel);
    if (!entries.length) return;

    tabList.setAttribute("role", "tablist");

    const activate = (selected, moveFocus = false) => {
      entries.forEach(({ tab, panel }) => {
        const active = tab === selected;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        tab.classList.toggle("is-active", active);
        tab.dataset.active = String(active);
        panel.hidden = !active;
        panel.setAttribute("aria-hidden", String(!active));
        panel.classList.toggle("is-active", active);
        panel.dataset.active = String(active);
      });
      if (moveFocus) selected.focus();
    };

    const initiallySelected = entries.find(({ tab }) => tab.getAttribute("aria-selected") === "true")?.tab
      || entries[0].tab;
    activate(initiallySelected);

    entries.forEach(({ tab }) => {
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", (event) => {
        const currentIndex = entries.findIndex((entry) => entry.tab === tab);
        let nextIndex = null;
        if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (currentIndex + 1) % entries.length;
        if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (currentIndex - 1 + entries.length) % entries.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = entries.length - 1;
        if (["Enter", " "].includes(event.key)) nextIndex = currentIndex;
        if (nextIndex === null) return;
        event.preventDefault();
        activate(entries[nextIndex].tab, true);
      });
    });
  }

  function setupTabs() {
    queryAll("[role='tablist'], [data-tabs-list]").forEach(setupTabList);
  }

  function findNavMenu(toggle) {
    const controlledId = toggle.getAttribute("aria-controls");
    if (controlledId) {
      const controlled = document.getElementById(controlledId);
      if (controlled) return controlled;
    }

    const target = cleanText(toggle.dataset.navTarget);
    if (target) {
      try {
        const found = document.querySelector(target);
        if (found) return found;
      } catch {
        // フォールバック検索へ進みます。
      }
    }

    const header = toggle.closest("header");
    return query("[data-nav-menu], .nav-links", header || document) || query("[data-nav-menu], .nav-links");
  }

  function setupMobileNavigation() {
    queryAll("#nav-toggle, [data-nav-toggle]").forEach((toggle) => {
      const menu = findNavMenu(toggle);
      if (!menu) return;
      const controlsHidden = menu.hasAttribute("hidden") || toggle.hasAttribute("data-nav-controls-hidden");

      const setOpen = (open) => {
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
        toggle.classList.toggle("is-open", open);
        menu.classList.toggle("is-open", open);
        menu.dataset.open = String(open);
        document.body.classList.toggle("nav-open", open);
        if (controlsHidden) {
          menu.hidden = !open;
          menu.setAttribute("aria-hidden", String(!open));
        }
      };

      setOpen(toggle.getAttribute("aria-expanded") === "true");
      toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
      menu.addEventListener("click", (event) => {
        const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
        if (link) setOpen(false);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
        setOpen(false);
        toggle.focus();
      });
    });
  }

  function openDetailsForTarget(target) {
    let parent = target?.parentElement;
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
  }

  function revealHashTarget() {
    if (!window.location.hash || window.location.hash.length < 2) return;
    let id = window.location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // エンコードされていないIDはそのまま利用します。
    }
    openDetailsForTarget(document.getElementById(id));
  }

  function setupDetails() {
    queryAll("details").forEach((details) => {
      const summary = details.firstElementChild?.tagName === "SUMMARY" ? details.firstElementChild : null;
      const synchronize = () => {
        details.dataset.open = String(details.open);
        summary?.setAttribute("aria-expanded", String(details.open));
      };
      synchronize();
      details.addEventListener("toggle", synchronize);
    });
    revealHashTarget();
    window.addEventListener("hashchange", revealHashTarget);
    document.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
      if (!link) return;
      const id = link.getAttribute("href")?.slice(1);
      if (id) openDetailsForTarget(document.getElementById(id));
    });
  }

  function setupLifecycle() {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", () => void refreshNow());
    window.addEventListener("offline", () => {
      clearPollTimer();
      renderStatusError(new Error("offline"));
    });
  }

  async function start() {
    renderCommunity(fallbackCommunity, "fallback");
    renderLoading();
    setupCopyButtons();
    setupTabs();
    setupMobileNavigation();
    setupDetails();
    setupLifecycle();

    await Promise.allSettled([refreshCommunity(), refreshStatus()]);
    schedulePoll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void start(), { once: true });
  } else {
    void start();
  }
})();
