const DASHBOARD_URL = "./dashboard.md";
const REFRESH_INTERVAL_MS = 30 * 1000;

const FIGURE_LAYOUT = [
  { id: "figure-1", defaultName: "OpenClaw-1", left: "19.5%", top: "22.5%" },
  { id: "figure-2", defaultName: "OpenClaw-2", left: "38.5%", top: "21%" },
  { id: "figure-3", defaultName: "OpenClaw-3", left: "61%", top: "22%" },
  { id: "figure-4", defaultName: "OpenClaw-4", left: "16.5%", top: "59.5%" },
  { id: "figure-5", defaultName: "OpenClaw-5", left: "37.5%", top: "59.5%" },
  { id: "figure-6", defaultName: "OpenClaw-6", left: "62%", top: "58.5%" },
];

const STATUS_META = {
  idle: { label: "空闲", className: "status-idle" },
  busy: { label: "繁忙", className: "status-busy" },
  unknown: { label: "未知", className: "status-unknown" },
};

const HEADER_KEYS = {
  agent: ["agent", "name", "openclaw", "worker", "成员", "智能体", "代理", "角色", "席位"],
  status: ["status", "state", "状态"],
  task: ["task", "work", "job", "事项", "任务", "当前任务", "处理中"],
};

const HISTORY_HEADER_KEYS = {
  issuedAt: ["issued", "dispatch", "created", "下发", "发布时间", "开始时间", "开始"],
  completedAt: ["completed", "finished", "done", "完成", "结束时间", "结束"],
  description: ["description", "task", "事项", "任务", "说明", "内容"],
};

const layer = document.getElementById("agentLayer");
const cardTemplate = document.getElementById("agentCardTemplate");
const syncHint = document.getElementById("syncHint");
const targetScreenText = document.getElementById("targetScreenText");
const historyTaskList = document.getElementById("historyTaskList");
const workspaceBoard = document.querySelector(".workspace-board");
const officeStage = document.querySelector(".office-stage");
const historyPanel = document.querySelector(".history-panel");
const officeBg = document.querySelector(".office-bg");

if (!layer || !cardTemplate || !syncHint || !targetScreenText || !historyTaskList || !workspaceBoard || !officeStage || !historyPanel || !officeBg) {
  throw new Error("页面结构缺少必要节点，无法渲染虚拟办公室。");
}

init();

function init() {
  renderAgentCards(mapAgentsToFigures([]));
  renderTargetScreen("");
  renderHistoryTasks([]);
  syncHistoryPanelHeight();
  window.requestAnimationFrame(syncHistoryPanelHeight);

  window.addEventListener("resize", syncHistoryPanelHeight);
  officeBg.addEventListener("load", syncHistoryPanelHeight);

  setSyncHint("正在读取 dashboard.md ...");
  refreshDashboard();
  window.setInterval(refreshDashboard, REFRESH_INTERVAL_MS);
}

function syncHistoryPanelHeight() {
  const direction = window.getComputedStyle(workspaceBoard).flexDirection;
  if (direction === "column") {
    historyPanel.style.height = "";
    return;
  }

  const stageHeight = officeStage.getBoundingClientRect().height;
  if (stageHeight > 0) {
    historyPanel.style.height = `${Math.round(stageHeight)}px`;
  }
}

async function refreshDashboard() {
  try {
    const cacheBustingUrl = `${DASHBOARD_URL}?t=${Date.now()}`;
    const response = await fetch(cacheBustingUrl, { cache: "no-store" });
    if (!response.ok) {
      setSyncHint(`读取 dashboard.md 失败（HTTP ${response.status}），30 秒后重试。`, "error");
      return;
    }

    const markdown = await response.text();
    const { agents, updatedAt, targetText, historyTasks } = parseDashboardMarkdown(markdown);
    const mappedAgents = mapAgentsToFigures(agents);
    renderAgentCards(mappedAgents);
    renderTargetScreen(targetText);
    renderHistoryTasks(historyTasks);
    syncHistoryPanelHeight();

    const syncTime = formatTime(new Date());
    const dataTime = updatedAt ? `数据时间：${updatedAt}，` : "";
    setSyncHint(`${dataTime}同步时间：${syncTime}`, "ok");
  } catch (error) {
    if (window.location.protocol === "file:") {
      setSyncHint("不支持本地打开页面", "error");
      return;
    }

    setSyncHint(`读取 dashboard.md 失败（${error.message}），30 秒后重试。`, "error");
  }
}

function parseDashboardMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const updatedAt = extractUpdatedAt(lines);
  const targetText = extractTargetText(lines);
  const historyTasks = parseHistoryTasks(lines);

  let agents = parseTableAgents(lines);
  if (agents.length === 0) {
    agents = parseLineAgents(lines);
  }

  return {
    agents: dedupeAgents(agents).slice(0, FIGURE_LAYOUT.length),
    updatedAt,
    targetText,
    historyTasks,
  };
}

function extractTargetText(lines) {
  let headerStart = -1;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();
    if (/^#{1,6}\s*(target|任务目标)\s*$/i.test(line)) {
      headerStart = idx + 1;
      break;
    }
  }

  if (headerStart === -1) {
    for (const rawLine of lines) {
      const match = rawLine.match(/^\s*(?:target|任务目标)\s*[:：]\s*(.+)$/i);
      if (match) {
        return cleanMarkdownText(match[1]);
      }
    }

    return "";
  }

  const segments = [];
  for (let idx = headerStart; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();

    if (/^#{1,6}\s+/.test(line)) {
      break;
    }

    if (!line) {
      continue;
    }

    if (line.startsWith("|")) {
      break;
    }

    segments.push(normalizeTargetLine(line));
  }

  return segments.join(" ").trim();
}

function normalizeTargetLine(line) {
  return cleanMarkdownText(line)
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .trim();
}

function parseHistoryTasks(lines) {
  const sectionLines = extractSectionLines(lines, /^#{1,6}\s*(history\s*tasks?|历史任务)\s*$/i);
  if (sectionLines.length === 0) {
    return [];
  }

  let tasks = parseHistoryTasksFromTable(sectionLines);
  if (tasks.length === 0) {
    tasks = parseHistoryTasksFromLines(sectionLines);
  }

  return dedupeHistoryTasks(tasks).slice(0, 12);
}

function extractSectionLines(lines, headerPattern) {
  let sectionStart = -1;

  for (let idx = 0; idx < lines.length; idx += 1) {
    if (headerPattern.test(lines[idx].trim())) {
      sectionStart = idx + 1;
      break;
    }
  }

  if (sectionStart === -1) {
    return [];
  }

  const sectionLines = [];
  for (let idx = sectionStart; idx < lines.length; idx += 1) {
    const line = lines[idx].trim();
    if (/^#{1,6}\s+/.test(line)) {
      break;
    }

    if (!line) {
      continue;
    }

    sectionLines.push(line);
  }

  return sectionLines;
}

function parseHistoryTasksFromTable(lines) {
  const blocks = collectTableBlocks(lines);
  const parsed = [];

  for (const block of blocks) {
    const rows = block.map(splitTableRow).filter((cells) => cells.length >= 2);
    if (rows.length < 2) {
      continue;
    }

    const headerCells = rows[0];
    const header = headerCells.map((cell) => cell.toLowerCase());
    let dataRows = rows.slice(1);

    if (dataRows.length > 0 && isSeparatorRow(dataRows[0])) {
      dataRows = dataRows.slice(1);
    }

    let issuedIndex = findHeaderIndex(header, HISTORY_HEADER_KEYS.issuedAt);
    let completedIndex = findHeaderIndex(header, HISTORY_HEADER_KEYS.completedAt);
    let descriptionIndex = findHeaderIndex(header, HISTORY_HEADER_KEYS.description);

    if (descriptionIndex == null && headerCells.length >= 3) {
      descriptionIndex = 2;
    }

    if (issuedIndex == null && headerCells.length >= 1) {
      issuedIndex = 0;
    }

    if (completedIndex == null && headerCells.length >= 2) {
      completedIndex = 1;
    }

    if (descriptionIndex == null) {
      continue;
    }

    for (const row of dataRows) {
      if (isSeparatorRow(row)) {
        continue;
      }

      const task = normalizeHistoryTask({
        issuedAt: row[issuedIndex] ?? "",
        completedAt: row[completedIndex] ?? "",
        description: row[descriptionIndex] ?? row[row.length - 1] ?? "",
      });

      if (task.description || task.issuedAt || task.completedAt) {
        parsed.push(task);
      }
    }
  }

  return parsed;
}

function parseHistoryTasksFromLines(lines) {
  const parsed = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("|")) {
      continue;
    }

    const compact = line.replace(/^[-*+]\s*/, "");

    const pipeParts = compact.split(/\s*[|｜]\s*/).map(cleanMarkdownText).filter(Boolean);
    if (pipeParts.length >= 3) {
      parsed.push(
        normalizeHistoryTask({
          issuedAt: pipeParts[0],
          completedAt: pipeParts[1],
          description: pipeParts.slice(2).join(" | "),
        }),
      );
      continue;
    }

    const keyedMatch = compact.match(
      /(?:下发时间|下发|发布时间|issued(?:\s*at)?|dispatch(?:ed)?(?:\s*time)?)\s*[:：]\s*([^,，;；|]+)\s*(?:[,，;；|]\s*|\s+)(?:完成时间|完成|结束时间|completed(?:\s*at)?|finished(?:\s*at)?|done(?:\s*at)?)\s*[:：]\s*([^,，;；|]+)\s*(?:[,，;；|]\s*|\s+)(?:任务说明|任务|事项|description|desc|task)\s*[:：]\s*(.+)$/i,
    );

    if (keyedMatch) {
      parsed.push(
        normalizeHistoryTask({
          issuedAt: keyedMatch[1],
          completedAt: keyedMatch[2],
          description: keyedMatch[3],
        }),
      );
      continue;
    }

    const plainParts = compact.split(/\s[-—–]\s/).map(cleanMarkdownText).filter(Boolean);
    if (plainParts.length >= 3) {
      parsed.push(
        normalizeHistoryTask({
          issuedAt: plainParts[0],
          completedAt: plainParts[1],
          description: plainParts.slice(2).join(" - "),
        }),
      );
    }
  }

  return parsed;
}

function normalizeHistoryTask(task) {
  return {
    issuedAt: cleanMarkdownText(task.issuedAt) || "--",
    completedAt: cleanMarkdownText(task.completedAt) || "--",
    description: cleanMarkdownText(task.description) || "暂无任务说明",
  };
}

function parseTableAgents(lines) {
  const blocks = collectTableBlocks(lines);
  const parsed = [];

  for (const block of blocks) {
    const rows = block.map(splitTableRow).filter((cells) => cells.length >= 2);
    if (rows.length < 2) {
      continue;
    }

    const header = rows[0].map((cell) => cell.toLowerCase());
    let dataRows = rows.slice(1);

    if (dataRows.length > 0 && isSeparatorRow(dataRows[0])) {
      dataRows = dataRows.slice(1);
    }

    const agentIndex = findHeaderIndex(header, HEADER_KEYS.agent);
    const statusIndex = findHeaderIndex(header, HEADER_KEYS.status);
    const taskIndex = findHeaderIndex(header, HEADER_KEYS.task);

    if (statusIndex == null) {
      continue;
    }

    for (const row of dataRows) {
      if (isSeparatorRow(row)) {
        continue;
      }

      const candidate = normalizeAgent({
        name: row[agentIndex ?? 0] ?? "",
        status: row[statusIndex] ?? "",
        task: row[taskIndex ?? Math.min(2, row.length - 1)] ?? "",
      });

      if (candidate.name || candidate.task) {
        parsed.push(candidate);
      }
    }
  }

  return parsed;
}

function parseLineAgents(lines) {
  const parsed = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const compact = line.replace(/^[-*]\s*/, "");

    const pipeParts = compact.split(/\s*[|｜]\s*/).map(cleanMarkdownText);
    if (pipeParts.length >= 3 && normalizeStatus(pipeParts[1]) !== "unknown") {
      parsed.push(
        normalizeAgent({
          name: pipeParts[0],
          status: pipeParts[1],
          task: pipeParts.slice(2).join(" | "),
        }),
      );
      continue;
    }

    const colonMatch = compact.match(
      /^(.+?)\s*[:：]\s*(空闲|繁忙|idle|busy|working|processing|unknown|待机|处理中|进行中)\s*[-—–]\s*(.+)$/i,
    );
    if (colonMatch) {
      parsed.push(
        normalizeAgent({
          name: colonMatch[1],
          status: colonMatch[2],
          task: colonMatch[3],
        }),
      );
      continue;
    }

    const kvMatch = compact.match(
      /^(.+?)\s*(?:状态|status)\s*[:：]\s*([^,，;；]+?)\s*(?:[,，;；]\s*|\s+)(?:任务|task)\s*[:：]\s*(.+)$/i,
    );
    if (kvMatch) {
      parsed.push(
        normalizeAgent({
          name: kvMatch[1],
          status: kvMatch[2],
          task: kvMatch[3],
        }),
      );
    }
  }

  return parsed;
}

function mapAgentsToFigures(agents) {
  const assigned = new Array(FIGURE_LAYOUT.length).fill(null);
  const pending = [];

  for (const agent of agents) {
    const indexByName = inferAgentIndex(agent.name);
    if (indexByName != null && assigned[indexByName] == null) {
      assigned[indexByName] = agent;
      continue;
    }
    pending.push(agent);
  }

  for (const agent of pending) {
    const emptyIndex = assigned.findIndex((item) => item == null);
    if (emptyIndex === -1) {
      break;
    }
    assigned[emptyIndex] = agent;
  }

  return FIGURE_LAYOUT.map((figure, idx) => {
    const agent = assigned[idx];
    return {
      ...figure,
      name: agent?.name || figure.defaultName,
      status: normalizeStatus(agent?.status || "unknown"),
      task: agent?.task || "暂无任务",
    };
  });
}

function renderAgentCards(agents) {
  layer.replaceChildren();

  for (const agent of agents) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.style.left = agent.left;
    card.style.top = agent.top;

    const nameNode = card.querySelector(".agent-name");
    const statusNode = card.querySelector(".status-tag");
    const taskNode = card.querySelector(".agent-task");

    const meta = STATUS_META[agent.status] ?? STATUS_META.unknown;

    nameNode.textContent = agent.name;
    statusNode.textContent = meta.label;
    statusNode.classList.add(meta.className);
    taskNode.textContent = agent.task;

    layer.appendChild(card);
  }
}

function renderHistoryTasks(tasks) {
  historyTaskList.replaceChildren();

  if (!tasks || tasks.length === 0) {
    const emptyNode = document.createElement("li");
    emptyNode.className = "history-empty";
    emptyNode.textContent = "暂无历史任务";
    historyTaskList.appendChild(emptyNode);
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("li");
    item.className = "history-item";

    const meta = document.createElement("p");
    meta.className = "history-meta";

    const issuedNode = document.createElement("span");
    issuedNode.textContent = `下发：${task.issuedAt}`;

    const completedNode = document.createElement("span");
    completedNode.textContent = `完成：${task.completedAt}`;

    const descriptionNode = document.createElement("p");
    descriptionNode.className = "history-description";
    descriptionNode.textContent = task.description;

    meta.append(issuedNode, completedNode);
    item.append(meta, descriptionNode);
    historyTaskList.appendChild(item);
  }
}

function renderTargetScreen(targetText) {
  const header = "[已下发任务]";
  const lines = wrapTargetLines(targetText || "暂未下发任务", 14, 4);
  const fullText = [header, ...lines].join("\n");
  const scrollDurationSec = Math.max(8, Math.min(20, fullText.length * 0.32));

  targetScreenText.textContent = fullText;
  targetScreenText.style.setProperty("--scroll-duration", `${scrollDurationSec}s`);

  // 重新触发动画，确保每次更新文本后都从底部开始滚动
  targetScreenText.style.animation = "none";
  // eslint-disable-next-line no-unused-expressions
  targetScreenText.offsetHeight;
  targetScreenText.style.animation = "target-scroll-up var(--scroll-duration) linear infinite";
}

function wrapTargetLines(value, maxCharsPerLine, maxLines) {
  const normalized = cleanMarkdownText(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["暂未下发任务"];
  }

  const lines = [];
  let buffer = "";

  for (const char of normalized) {
    if (buffer.length >= maxCharsPerLine) {
      lines.push(buffer);
      buffer = "";
      if (lines.length >= maxLines) {
        break;
      }
    }

    buffer += char;
  }

  if (lines.length < maxLines && buffer) {
    lines.push(buffer);
  }

  const consumedLength = lines.join("").length;
  if (normalized.length > consumedLength && lines.length > 0) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = `${lines[lastIndex].slice(0, Math.max(1, maxCharsPerLine - 1))}…`;
  }

  return lines;
}

function extractUpdatedAt(lines) {
  const patterns = [
    /^\s*>?\s*(?:更新时间|last\s*updated?|updated\s*at)\s*[:：]\s*(.+)$/i,
    /^\s*updated\s*[:：]\s*(.+)$/i,
  ];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return cleanMarkdownText(match[1]);
      }
    }
  }

  return "";
}

function collectTableBlocks(lines) {
  const blocks = [];
  let current = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const isTableLine = line.startsWith("|") && line.includes("|");

    if (isTableLine) {
      current.push(line);
      continue;
    }

    if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function splitTableRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanMarkdownText(cell));
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function findHeaderIndex(headerCells, keywords) {
  for (const keyword of keywords) {
    const index = headerCells.findIndex((cell) => cell.includes(keyword));
    if (index !== -1) {
      return index;
    }
  }
  return null;
}

function normalizeAgent(agent) {
  return {
    name: cleanMarkdownText(agent.name) || "未命名 Agent",
    status: normalizeStatus(agent.status),
    task: cleanMarkdownText(agent.task) || "暂无任务",
  };
}

function normalizeStatus(value) {
  const text = cleanMarkdownText(value).toLowerCase();
  if (!text) {
    return "unknown";
  }

  if (/(busy|working|running|processing|繁忙|忙碌|处理中|执行中|进行中)/i.test(text)) {
    return "busy";
  }

  if (/(idle|free|ready|空闲|待机|空置|可用)/i.test(text)) {
    return "idle";
  }

  return "unknown";
}

function inferAgentIndex(name) {
  const text = cleanMarkdownText(name);
  if (!text) {
    return null;
  }

  const directMatch = text.match(/(?:openclaw|agent|oc|worker|智能体|成员|席位)\s*[-_#]?\s*([1-6])\b/i);
  if (directMatch) {
    return Number.parseInt(directMatch[1], 10) - 1;
  }

  const chineseMatch = text.match(/([1-6])号/);
  if (chineseMatch) {
    return Number.parseInt(chineseMatch[1], 10) - 1;
  }

  return null;
}

function dedupeAgents(agents) {
  const map = new Map();
  for (const agent of agents) {
    map.set(agent.name.toLowerCase(), agent);
  }
  return Array.from(map.values());
}

function dedupeHistoryTasks(tasks) {
  const map = new Map();
  for (const task of tasks) {
    const key = `${task.issuedAt}|${task.completedAt}|${task.description}`.toLowerCase();
    if (!map.has(key)) {
      map.set(key, task);
    }
  }
  return Array.from(map.values());
}

function cleanMarkdownText(value) {
  return String(value ?? "")
    .replace(/\[(.*?)]\((.*?)\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function formatTime(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function setSyncHint(message, type = "info") {
  syncHint.textContent = message;
  syncHint.classList.remove("is-ok", "is-error");

  if (type === "ok") {
    syncHint.classList.add("is-ok");
  }

  if (type === "error") {
    syncHint.classList.add("is-error");
  }
}

