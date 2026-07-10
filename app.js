const state = { community: null, status: null };
const apiBase = "https://pal.xero-x.me";
const apiUrl = (path) => `${apiBase}${path}`;
const pendingAddress = "公開準備中";
const fetchTimeoutMs = 8000;
const statusRefreshIntervalMs = 12000;
let statusRefreshPromise = null;
let copyResetTimer = null;

const $ = (selector) => document.querySelector(selector);
const number = (value) => new Intl.NumberFormat("ja-JP").format(value ?? 0);
const duration = (seconds) => {
  if (!seconds) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days}日 ${hours}時間` : `${hours}時間`;
};
const localizeUiText = (value, fallback = "") => {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback)
    .replace(/Palworld/gi, "パルワールド")
    .replace(/\bCommunity\b/gi, "コミュニティ")
    .replace(/\bServer\b/gi, "サーバー")
    .replace(/\bPal\b/gi, "パル");
};

function setGameAddress(value) {
  const address = typeof value === "string" && value.trim() ? value.trim() : pendingAddress;
  const available = address !== pendingAddress;
  const button = $("#copy-address");

  if (copyResetTimer !== null) {
    window.clearTimeout(copyResetTimer);
    copyResetTimer = null;
  }

  $("#game-address").textContent = address;
  button.disabled = !available;
  button.textContent = available ? "アドレスをコピー" : pendingAddress;
  $("#address-feedback").textContent = available
    ? "サーバーアドレスをコピーして参加できます。"
    : "サーバーアドレスは現在、公開準備中です。";
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(apiUrl(path), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`通信に失敗しました（${response.status}）`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function renderCommunity(community) {
  state.community = community;
  const communityName = localizeUiText(community.name, "パルワールド コミュニティ");
  document.title = `${communityName} | 公式コミュニティ`;
  $("#community-name").textContent = communityName;
  $("#community-tagline").textContent = localizeUiText(community.tagline, "みんなでつくる、安心して遊べるパルワールドサーバー。");
  setGameAddress(community.gameAddress);
  const rules = Array.isArray(community.rules) ? community.rules : [];
  $("#rules-list").replaceChildren(...rules.map((rule) => {
    const item = document.createElement("li");
    item.textContent = rule;
    return item;
  }));
}

function renderStatus(status) {
  state.status = status;
  const players = Array.isArray(status.players) ? status.players : [];
  const indicator = $("#status-indicator");
  indicator.className = `status-indicator ${status.online ? "online" : "offline"}`;
  $("#status-label").textContent = status.online ? "オンライン" : "オフライン";
  $("#status-message").textContent = status.message;
  $("#updated-at").textContent = `更新 ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(status.updatedAt))}`;
  setGameAddress(status.gameAddress || state.community?.gameAddress || pendingAddress);

  const metrics = status.metrics;
  $("#player-count").textContent = metrics ? `${number(metrics.currentPlayers)} / ${number(metrics.maxPlayers)}` : "—";
  $("#server-fps").textContent = metrics?.serverFps ? `${number(metrics.serverFps)} フレーム/秒` : "—";
  $("#frame-time").textContent = metrics?.frameTimeMs ? `${number(metrics.frameTimeMs)} ミリ秒` : "—";
  $("#uptime").textContent = metrics?.uptimeSeconds ? duration(metrics.uptimeSeconds) : "—";
  $("#world-days").textContent = metrics?.worldDays ? `${number(metrics.worldDays)} 日目` : "—";
  $("#server-identity").textContent = status.server?.name
    ? `サーバー名：${localizeUiText(status.server.name)}${status.server.description ? ` — ${localizeUiText(status.server.description)}` : ""}`
    : "サーバー情報を取得できません。";
  $("#server-version").textContent = status.server?.version ? `サーバーバージョン ${status.server.version}` : "";
  $("#players-summary").textContent = status.online ? `${players.length} 名を表示中` : "参加者情報はサーバー接続後に表示されます";

  const list = $("#players-list");
  if (!status.online || !players.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = status.online ? "現在オンラインの参加者はいません。" : "参加者情報は非公開の管理用接続機能から安全に取得します。";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...players.map((player) => {
    const item = document.createElement("article");
    item.className = "player";
    item.innerHTML = `<span class="name"></span><span>レベル ${number(player.level)}</span><span>応答 ${number(player.ping)} ミリ秒</span><span>建築数 ${number(player.buildingCount)}</span>`;
    item.querySelector(".name").textContent = player.name;
    return item;
  }));
}

async function loadStatus() {
  try {
    renderStatus(await fetchJson("/api/status"));
  } catch {
    renderStatus({ online: false, message: "サーバー状況を取得できません。", updatedAt: new Date().toISOString(), gameAddress: state.community?.gameAddress, players: [] });
  }
}

function refreshStatus() {
  if (statusRefreshPromise) return statusRefreshPromise;
  statusRefreshPromise = loadStatus().finally(() => {
    statusRefreshPromise = null;
  });
  return statusRefreshPromise;
}

async function pollStatus() {
  await refreshStatus();
  window.setTimeout(pollStatus, statusRefreshIntervalMs);
}

$("#copy-address").addEventListener("click", async () => {
  const button = $("#copy-address");
  const address = $("#game-address").textContent.trim();
  if (button.disabled || !address || address === pendingAddress) {
    $("#address-feedback").textContent = "サーバーアドレスは現在、公開準備中です。";
    return;
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error("クリップボードを利用できません");
    await navigator.clipboard.writeText(address);
    button.textContent = "コピーしました";
    $("#address-feedback").textContent = "サーバーアドレスをコピーしました。";
    copyResetTimer = window.setTimeout(() => {
      button.textContent = "アドレスをコピー";
      $("#address-feedback").textContent = "サーバーアドレスをコピーして参加できます。";
      copyResetTimer = null;
    }, 1600);
  } catch {
    button.textContent = "コピーできませんでした";
    $("#address-feedback").textContent = "コピーできませんでした。表示されたアドレスを選択して、手動でコピーしてください。";
    copyResetTimer = window.setTimeout(() => {
      button.textContent = "アドレスをコピー";
      copyResetTimer = null;
    }, 2600);
  }
});

(async () => {
  try {
    renderCommunity(await fetchJson("/api/community"));
  } catch {
    // コミュニティ情報を取得できない場合も、サーバー状況の更新は続けます。
  }
  pollStatus();
})();
