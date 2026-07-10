const state = { community: null, status: null };
const apiBase = "https://pal.xero-x.me";
const apiUrl = (path) => `${apiBase}${path}`;

const $ = (selector) => document.querySelector(selector);
const number = (value) => new Intl.NumberFormat("ja-JP").format(value ?? 0);
const duration = (seconds) => {
  if (!seconds) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days}日 ${hours}時間` : `${hours}時間`;
};

function renderCommunity(community) {
  state.community = community;
  document.title = `${community.name} | 公式コミュニティ`;
  $("#community-name").textContent = community.name;
  $("#community-tagline").textContent = community.tagline;
  $("#game-address").textContent = community.gameAddress;
  $("#rules-list").replaceChildren(...community.rules.map((rule) => {
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
  $("#game-address").textContent = status.gameAddress || state.community?.gameAddress || "公開準備中";

  const metrics = status.metrics;
  $("#player-count").textContent = metrics ? `${number(metrics.currentPlayers)} / ${number(metrics.maxPlayers)}` : "—";
  $("#server-fps").textContent = metrics?.serverFps ? `${number(metrics.serverFps)} FPS` : "—";
  $("#frame-time").textContent = metrics?.frameTimeMs ? `${number(metrics.frameTimeMs)} ms` : "—";
  $("#uptime").textContent = metrics?.uptimeSeconds ? duration(metrics.uptimeSeconds) : "—";
  $("#world-days").textContent = metrics?.worldDays ? `${number(metrics.worldDays)} 日目` : "—";
  $("#server-identity").textContent = status.server?.name
    ? `サーバー名：${status.server.name}${status.server.description ? ` — ${status.server.description}` : ""}`
    : "サーバー情報を取得できません。";
  $("#server-version").textContent = status.server?.version ? `Server ${status.server.version}` : "";
  $("#players-summary").textContent = status.online ? `${players.length} 名を表示中` : "参加者情報はサーバー接続後に表示されます";

  const list = $("#players-list");
  if (!status.online || !players.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = status.online ? "現在オンラインの参加者はいません。" : "参加者情報は非公開の管理APIから安全に取得します。";
    list.replaceChildren(empty);
    return;
  }

  list.replaceChildren(...players.map((player) => {
    const item = document.createElement("article");
    item.className = "player";
    item.innerHTML = `<span class="name"></span><span>Lv. ${number(player.level)}</span><span>${number(player.ping)} ms</span><span>建築 ${number(player.buildingCount)}</span>`;
    item.querySelector(".name").textContent = player.name;
    return item;
  }));
}

async function refreshStatus() {
  try {
    const response = await fetch(apiUrl("/api/status"), { cache: "no-store" });
    if (!response.ok) throw new Error("status request failed");
    renderStatus(await response.json());
  } catch {
    renderStatus({ online: false, message: "サーバー状況を取得できません。", updatedAt: new Date().toISOString(), gameAddress: state.community?.gameAddress, players: [] });
  }
}

$("#copy-address").addEventListener("click", async () => {
  const address = $("#game-address").textContent;
  if (!address || address === "公開準備中") return;
  await navigator.clipboard.writeText(address);
  const button = $("#copy-address");
  button.textContent = "コピーしました";
  setTimeout(() => { button.textContent = "アドレスをコピー"; }, 1600);
});

(async () => {
  try {
    const response = await fetch(apiUrl("/api/community"), { cache: "no-store" });
    if (!response.ok) throw new Error("community request failed");
    renderCommunity(await response.json());
  } catch {
    // The live status must continue even if the static community metadata is temporarily unavailable.
  }
  await refreshStatus();
  setInterval(refreshStatus, 12000);
})();
