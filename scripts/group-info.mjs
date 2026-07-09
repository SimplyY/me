#!/usr/bin/env node
import { existsSync, unlinkSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const statePath = process.env.GROUP_INFO_STATE || join(repoRoot, "state.json");
const sensitiveName = /(^|[/.-])(env|id_rsa|id_ed25519)|token|secret|credential|password|cookie|session|wallet|\.pem$|\.key$/i;
const groupIndexBaseToken = process.env.GROUP_INDEX_BASE_TOKEN || "AxMAbMTKOahp74sDuhqcERnrnph";
const groupIndexTableId = process.env.GROUP_INDEX_TABLE_ID || "tblwQkPtmNOv7tSY";
const groupIndexFields = ["项目", "群名", "群 ID", "仓库路径", "定位", "优先级", "链接", "工作流", "TODO", "备注"];

const DEFAULT_ICONS = {
  'learn-x': '🧠',
  'research-x': '📚',
  'invest-x': '⚖️',
  'invest-log': '📈',
  'health-x': '💪',
  'life-x': '🌱',
  'read-x': '📖',
  'lark-channel-bridge': '🔗',
  'index': '🏠',
  'skills': '🔧'
};

function usage() {
  console.log("Usage: group-info.mjs update --group <id|name> [--dry-run|--write|--apply] [--skip-if-recent] | update-all [--dry-run|--write|--apply] [--skip-if-recent] | top --group <id|name> --dry-run|--apply | list [--format json|md|table] | self-test");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readState() {
  if (!existsSync(statePath)) return { groups: {} };
  return readJson(statePath);
}

function stateFor(state, group) {
  if (!state.groups) state.groups = {};
  if (!state.groups[group.id]) state.groups[group.id] = {};
  return state.groups[group.id];
}

function attachState(registry, state) {
  for (const group of registry.groups) {
    Object.assign(group, state.groups?.[group.id] || {});
  }
  return registry;
}

function saveState(state) {
  writeJson(statePath, state);
}

function parseArgs(argv) {
  const args = { command: argv[2], mode: "dry-run", group: null };
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--write" || arg === "--apply") args.mode = arg.slice(2);
    else if (arg === "--group") args.group = argv[++i];
    else if (arg === "--skip-if-recent") args.skipIfRecent = true;
    else if (arg === "--format") args.format = argv[++i];
  }
  return args;
}

function normalizeGroupName(name) {
  if (name === "invset-x") return "invest-x";
  return name;
}

function groupKey(group) {
  return group.id || group.name;
}

function projectDomId(group) {
  return groupKey(group).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

function groupIcon(group, v2Fields) {
  return (v2Fields && v2Fields.icon) || DEFAULT_ICONS[groupKey(group)] || DEFAULT_ICONS[group.name] || '📦';
}

function groupIdFromName(name) {
  if (name === "Group Index") return "index";
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseLinks(value) {
  return splitLines(value).map((line) => {
    const namedMarkdown = line.match(/^(.+?)[：:]\s*\[(.+?)\]\((https?:\/\/[^)]+)\)$/);
    if (namedMarkdown) return { name: namedMarkdown[1].trim(), url: namedMarkdown[3].trim() };
    const markdown = line.match(/^\[(.+?)\]\((https?:\/\/[^)]+)\)$/);
    if (markdown) return { name: markdown[1].trim() || "链接", url: markdown[2].trim() };
    const match = line.match(/^(.+?)[：:]\s*(https?:\/\/\S+)$/);
    if (match) return { name: match[1].trim(), url: match[2].trim() };
    if (/^https?:\/\//.test(line)) return { name: "链接", url: line };
    return null;
  }).filter(Boolean);
}

function parseTextItems(value) {
  return splitLines(value);
}

function parseManualWorkflows(value) {
  return splitLines(value).map((line) => {
    const match = line.match(/^(.+?)[：:]\s*(.+)$/);
    return {
      name: match ? match[1].trim() : line,
      name_zh: match ? match[1].trim() : line,
      description: match ? match[2].trim() : "",
      description_zh: match ? match[2].trim() : ""
    };
  });
}

function parsePriority(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === null || raw === undefined || raw === "") return 99;
  const text = String(raw).trim();
  const pLevel = text.match(/^P(\d+)$/i);
  if (pLevel) return Number(pLevel[1]) + 1;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 99;
}

function normalizeBaseRow(row) {
  const project = String(row["项目"] || "").trim();
  const repo = String(row["仓库路径"] || "").trim();
  const links = parseLinks(row["链接"]);
  return {
    id: groupIdFromName(project),
    name: project,
    chat_id: String(row["群 ID"] || "").trim(),
    group_name: String(row["群名"] || project).trim(),
    repo,
    repo_path: repo,
    group_info_path: repo ? join(repo, "GROUP_INFO.md") : "",
    positioning: String(row["定位"] || "").trim(),
    bot: "Codex / Code X bot",
    auto_update: true,
    priority: parsePriority(row["优先级"]),
    links: links.length ? links : [{ name: "暂无绑定", url: "" }],
    manual_workflows: parseManualWorkflows(row["工作流"]),
    todos: parseTextItems(row["待办"] || row["TODO"]),
    notes: String(row["备注"] || "").trim()
  };
}

function fetchGroupIndexGroups() {
  const rows = [];
  let offset = 0;
  while (true) {
    const args = [
      "base", "+record-list",
      "--base-token", groupIndexBaseToken,
      "--table-id", groupIndexTableId,
      "--limit", "200",
      "--offset", String(offset),
      "--as", "user",
      "--format", "json"
    ];
    for (const field of groupIndexFields) args.push("--field-id", field);
    const result = spawnSync("lark-cli", args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
      }
    });
    if (result.status !== 0) {
      console.error("读取 group index 多维表格失败：", result.stderr || result.stdout);
      process.exit(11);
    }
    const data = JSON.parse(result.stdout);
    const fields = data?.data?.fields || groupIndexFields;
    for (const row of data?.data?.data || []) {
      const item = {};
      fields.forEach((field, index) => { item[field] = row[index]; });
      rows.push(item);
    }
    if (!data?.data?.has_more) break;
    offset += 200;
  }
  const groups = rows.map(normalizeBaseRow).filter((group) => group.name);
  if (!groups.length) {
    console.error("group index 多维表格没有项目记录");
    process.exit(12);
  }
  return groups;
}

function parseFrontmatter(text, fallbackName) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: fallbackName, name_zh: fallbackName, description: "", description_zh: "" };
  const fields = {};
  const lines = match[1].split("\n");
  let lastKey = null;
  let blockLines = [];
  for (const line of lines) {
    if (lastKey && /^\s{2,}/.test(line)) {
      blockLines.push(line.trim());
      continue;
    }
    if (lastKey && blockLines.length) {
      fields[lastKey] = blockLines.join(" ");
      blockLines = [];
      lastKey = null;
    }
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    const key = item[1];
    const raw = item[2].replace(/^["']|["']$/g, "");
    if (/^[>|]-?$/.test(raw)) {
      lastKey = key;
      continue;
    }
    fields[key] = raw;
  }
  if (lastKey && blockLines.length) {
    fields[lastKey] = blockLines.join(" ");
  }
  return {
    name: fields.name || fallbackName,
    name_zh: fields.name_zh || fields.name || fallbackName,
    description: fields.description || "",
    description_zh: fields.description_zh || fields.description || ""
  };
}

// 解析 GROUP_INFO.md v2 格式的 frontmatter，提取 icon/summary/detail/tags/entry_url/priority
function parseGroupInfoV2(text) {
  if (!text) return null;
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  const lines = match[1].split("\n");
  let lastKey = null, blockLines = [];
  for (const line of lines) {
    const newKeyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (newKeyMatch) {
      // ponytail: flush previous block when new key found, even in mid-block mode
      if (lastKey && blockLines.length) setField(fields, lastKey, blockLines.join(" "));
      lastKey = newKeyMatch[1];
      blockLines = [];
      let val = newKeyMatch[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (val === ">-" || val === "|" || val === ">") continue;
      blockLines.push(val);
    } else if (lastKey && line.trim()) {
      blockLines.push(line.trim());
    }
  }
  if (lastKey && blockLines.length) setField(fields, lastKey, blockLines.join(" "));
  return Object.keys(fields).length > 0 ? fields : null;
}

function setField(fields, key, val) {
  if (key === 'tags') {
    fields[key] = val.split(/[,，]\s*/).filter(Boolean);
  } else if (key === 'todos') {
    try { fields[key] = JSON.parse(val); } catch (e) { fields[key] = []; }
  } else if (key === 'priority') {
    fields[key] = parseInt(val, 10) || undefined;
  } else {
    fields[key] = val;
  }
}

function defaultDetail(group, scan) {
  const parts = [group.positioning || ''];
  if (scan.skills.length > 0) {
    const skillDescs = scan.skills
      .map((s) => (s.description_zh || s.description || ''))
      .filter(Boolean)
      .slice(0, 2);
    if (skillDescs.length > 0) parts.push(skillDescs.join('；'));
  }
  return parts.filter(Boolean).join('。');
}

function defaultTags(scan) {
  return scan.skills.slice(0, 4).map((s) => s.name_zh || s.name);
}

function defaultEntryUrl(group) {
  if (group.links && group.links.length > 0 && group.links[0].url) return group.links[0].url;
  // 没有显式链接时留空，不猜测 GitHub 仓库地址（可能不存在）
  return "";
}

function listSkillFiles(repo) {
  const files = [];
  let foundAny = false;
  for (const base of [".agents/skills", ".codex/skills", "skills"]) {
    const dir = join(repo, base);
    if (!existsSync(dir)) continue;
    foundAny = true;
    const found = spawnSync("find", [dir, "-maxdepth", "2", "-name", "SKILL.md", "-print"], { encoding: "utf8" });
    if (found.status === 0) files.push(...found.stdout.trim().split("\n").filter(Boolean));
  }
  // ponytail: skills 仓库自身就是 skill 集合，根目录下直接有 SKILL.md
  if (!foundAny) {
    const found = spawnSync("find", [repo, "-maxdepth", "2", "-name", "SKILL.md", "-print"], { encoding: "utf8" });
    if (found.status === 0) files.push(...found.stdout.trim().split("\n").filter(Boolean));
  }
  return files.filter((file) => !sensitiveName.test(file)).sort();
}

function scanSkills(repo) {
  return listSkillFiles(repo).map((file) => {
    const text = readFileSync(file, "utf8");
    const folder = file.split("/").slice(-2, -1)[0];
    return { ...parseFrontmatter(text, folder), file };
  }).filter((skill) => !/(群信息|group.info)/i.test(skill.name + (skill.name_zh || "")));
}

function detectWorkflows(skills, repo) {
  const fromSkills = skills
    .filter((skill) => /(workflow|automation|自动化|工作流)/i.test(skill.name))
    .map((skill) => ({
      name: skill.name,
      name_zh: skill.name_zh || skill.name,
      description: skill.description || "Skill-backed workflow",
      description_zh: skill.description_zh || skill.description || ""
    }));

  // ponytail: 扫描 wkf_update.json 中定义的飞书 Workflow
  const fromWkf = [];
  const wkfPath = join(repo, 'wkf_update.json');
  if (existsSync(wkfPath)) {
    try {
      const wkf = JSON.parse(readFileSync(wkfPath, 'utf8'));
      if (wkf.title && wkf.status === 'enabled') {
        const timer = wkf.steps?.find(s => s.type === 'TimerTrigger');
        fromWkf.push({
          name: wkf.title,
          name_zh: wkf.title,
          description: `定时触发：${timer?.data?.rule || '未知'}`,
          description_zh: `定时触发：${timer?.data?.rule || '未知'}`
        });
      }
    } catch (e) { /* ignore */ }
  }
  return [...fromSkills, ...fromWkf];
}

function mergeWorkflows(scanned, manual) {
  const seen = new Set();
  const result = [];
  for (const item of [...(scanned || []), ...(manual || [])]) {
    const key = item.name_zh || item.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}



function statusForPath(path) {
  if (!path) return "未在群注册表中记录";
  return existsSync(path) ? "可访问" : "绑定存在，但当前不可访问";
}

function baseStatus(base) {
  if (!base) return "未记录";
  return "已记录但未验证";
}

function baseLabel(base) {
  if (!base) return "未在群注册表中记录";
  return base.url || base.id || base.name || "已记录但未验证";
}

function hasChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text || "");
}


function realpathMaybe(value) {
  if (!value) return null;
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

function scanDocDataSources(repo) {
  const files = ["README.md", "docs/TECH.md", "03_input/README.md"]
    .map((file) => join(repo, file))
    .filter((file) => existsSync(file) && !sensitiveName.test(file));
  const lines = [];
  for (const file of files) {
    const rel = file.slice(repo.length + 1);
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (/(export\s|TOKEN|SECRET|PASSWORD|APP_SECRET)/i.test(line)) continue;
      if (/(多维表格|Base|bitable|飞书|Lark|Feishu)/i.test(line)) {
        lines.push(`- ${rel}：${line.trim().replace(/^[-#\s]+/, "")}`);
      }
    }
  }
  return lines.slice(0, 8);
}

function formatSkillLine(skill) {
  const n = skill.name_zh || skill.name;
  const descRaw = skill.description_zh || skill.description;
  const d = descRaw ? firstSentence(descRaw) : "";
  if (!d) return n;
  return n + "：" + d;
}


// ponytail: 对比 top 摘要内容（而非 MD 文件），因为 MD 的细节变化（如 updated_at）对群成员不可见
function topSummaryUnchanged(group, summary) {
  const oldSummary = group.last_top_summary || "";
  return oldSummary === summary;
}

function renderTopNoticeCard(group, scan, now, v2Fields) {
  const icon = groupIcon(group, v2Fields);
  const nameZh = (v2Fields && v2Fields.name_zh) || group.name;
  const positioning = group.positioning || '';
  const repo = group.repo || '';

  const skillLines = scan.skills.slice(0, 5).map((s, i) => {
    const n = s.name_zh || s.name;
    const d = shortDesc(s.description_zh || s.description);
    return (i + 1) + '. ' + (d ? n + '：' + d : n);
  });

  const skillWorkflowTarget = new Set(scan.skills.map(s => s.name_zh || s.name));
  const filteredWorkflows = scan.workflows.filter(w => !skillWorkflowTarget.has(w.name_zh || w.name)).slice(0, 3);
  const workflowLines = filteredWorkflows.map((w, i) => {
    const d = w.description_zh ? shortDesc(w.description_zh) : shortDesc(w.description);
    return (i + 1) + '. ' + (d ? (w.name_zh || w.name) + '：' + d : (w.name_zh || w.name));
  });

  const todos = (v2Fields && v2Fields.todos) || group.todos || [];
  const todoLines = todos.map((t, i) => (i + 1) + '. ' + t);

  const hasLinks = group.links && group.links.some(l => l.url && l.url.trim());

  const elements = [];
  const header = icon + ' **' + nameZh + ' 群信息**';
  elements.push({ tag: 'markdown', content: header });
  elements.push({ tag: 'hr' });

  const infoParts = [];
  infoParts.push('📍 定位：' + (positioning || '未在群注册表中记录'));
  infoParts.push('📁 工作目录：' + (repo || '未在群注册表中记录'));
  if (hasLinks) {
    const linkText = group.links.filter(l => l.url && l.url.trim()).map(l => '🔗 [' + (l.name || '链接') + '](' + l.url + ')').join('  ');
    infoParts.push(linkText);
  }
  elements.push({ tag: 'markdown', content: infoParts.join('\n') });

  if (skillLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: '🧩 **主要 Skill**\n' + skillLines.join('\n') });
  }
  if (workflowLines.length > 0) {
    elements.push({ tag: 'markdown', content: '⚙️ **主要 Workflow**\n' + workflowLines.join('\n') });
  }
  if (todoLines.length > 0) {
    elements.push({ tag: 'hr' });
    elements.push({ tag: 'markdown', content: '📋 **待办**\n' + todoLines.join('\n') });
  }

  const card = {
    schema: "2.0",
    config: { update_multi: true },
    body: {
      direction: "vertical",
      elements: elements
    }
  };
  return card;
}

function renderGroupInfo(group, scan, v2Fields, now) {
  const repoPath = realpathMaybe(group.repo_path || group.repo);
  const groupInfoPath = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
 const hasLinks = group.links && group.links.length > 0;
 
  const hasSkills = scan.skills.length > 0;
  const hasWorkflows = scan.workflows.length > 0;
  const nameZh = (v2Fields && v2Fields.name_zh) || group.name;

  const icon = groupIcon(group, v2Fields);
  const summary = group.positioning || (v2Fields && v2Fields.summary) || '';
  const detail = (v2Fields && v2Fields.detail) || group.notes || defaultDetail(group, scan);
  const tags = (v2Fields && v2Fields.tags) || defaultTags(scan);
  const rawEntryUrl = (v2Fields && v2Fields.entry_url) || "";
  // 过滤掉猜测的 GitHub 地址（可能不存在），没有显式链接时留空
  const isGuessedGitHub = /github\.com\/SimplyY\/[\w-]+$/.test(rawEntryUrl);
  const entryUrl = (rawEntryUrl && !isGuessedGitHub) ? rawEntryUrl : defaultEntryUrl(group);
  const priority = group.priority || 99;
  const calibration = (v2Fields && v2Fields.calibration) || '';
  const todos = (v2Fields && v2Fields.todos) || group.todos || [];

  const lines = [];
  lines.push("---");
  lines.push("generated_by: group-info");
  lines.push("schema: group-info/v2");
  lines.push("chat_id: " + JSON.stringify(group.chat_id ?? null));
  lines.push("group_name: " + JSON.stringify(group.group_name || group.name));
  lines.push("repo_path: " + JSON.stringify(repoPath));
  lines.push("group_info_path: " + JSON.stringify(groupInfoPath));
  lines.push("updated_at: " + JSON.stringify(now));
  lines.push("icon: " + JSON.stringify(icon));
  lines.push("name_zh: " + JSON.stringify(nameZh));
  lines.push("summary: " + JSON.stringify(summary));
  lines.push("detail: " + JSON.stringify(detail));
  lines.push("tags: " + JSON.stringify(tags.join("，")));
  lines.push("entry_url: " + JSON.stringify(entryUrl));
  lines.push("priority: " + priority);
  if (calibration) lines.push("calibration: " + JSON.stringify(calibration));
  if (todos.length > 0) lines.push("todos: " + JSON.stringify(todos));
  lines.push("---");
  lines.push("");
  lines.push("# Group Info: " + nameZh);
  lines.push("");
  lines.push("## 群定位");
  lines.push(group.positioning || "未在群注册表中记录");
  lines.push("");
  lines.push("## 绑定信息");
  lines.push("- 飞书群：" + (group.group_name || group.name));
  lines.push("- 工作目录：" + (group.repo || "未在群注册表中记录"));
  if (hasLinks) { group.links.forEach(function(link) { lines.push("- 链接：" + (link.name || "") + " → " + (link.url || "")); }); }
  lines.push("- 默认机器人：" + (group.bot || "未在群注册表中记录"));

  if (calibration) {
    lines.push("");
    lines.push("## 定位校准（人工，脚本永不覆盖）");
    lines.push(calibration);
  }

  if (group.notes) {
    lines.push("");
    lines.push("## 备注");
    lines.push(group.notes);
  }

  if (hasSkills) {
    lines.push("");
    lines.push("## 可用 Skill");
    scan.skills.forEach((skill, i) => {
      const prefix = scan.skills.length > 1 ? (i + 1) + ". " : "";
      lines.push(prefix + formatSkillLine(skill));
    });
  }

  if (hasWorkflows) {
    lines.push("");
    lines.push("## 可用 Workflow");
    scan.workflows.forEach((item, i) => {
      const prefix = scan.workflows.length > 1 ? (i + 1) + ". " : "";
      lines.push(prefix + formatSkillLine(item));
    });
  }

  if (scan.dataSources.length > 0) {
    lines.push("");
    lines.push("## 数据源");
    const dsLines = [
      hasLinks ? group.links.map(function(l) { return "- " + (l.name || "链接") + "：" + (l.url || ""); }).join("\n") : null,
      ...scan.dataSources,
    ].filter(Boolean);
    if (dsLines.length > 0) lines.push(...[...new Set(dsLines)]);
  }

  if (todos.length > 0) {
    lines.push("");
    lines.push("## 待办");
    todos.forEach(function(t, i) { lines.push("- " + t); });
  }

  lines.push("");
  lines.push("## 状态");
  lines.push("- 工作目录：" + statusForPath(group.repo));
  if (hasLinks) lines.push("- 链接数：" + group.links.length);
  lines.push("- Skill 扫描：" + (scan.error ? "异常：" + scan.error : "正常"));
  lines.push("- 最近更新时间：" + now);
  lines.push("");

  return lines.join("\n");
}


function firstSentence(text) {
  if (!text) return "";
  const m = text.match(/^([^。！？\n；;]+)/);
  return m ? m[1].trim() : text.trim();
}

function shortDesc(text) {
  if (!text) return "";
  const s = firstSentence(text);
  return s;
}


function renderPinSummary(group, scan, now, v2Fields) {
  const topSkills = scan.skills.map((skill, i) => {
    const n = skill.name_zh || skill.name;
    const d = skill.description_zh || firstSentence(skill.description_zh || skill.description);
    const s = shortDesc(d);
    const prefix = scan.skills.length > 1 ? (i + 1) + ". " : "";
    return prefix + (s ? n + "：" + s : n);
  }).join("\n");
  const skillWorkflowTarget = new Set(scan.skills.map(function(s) { return s.name_zh || s.name; }));
  const filteredWorkflows = scan.workflows.filter(function(w){return !skillWorkflowTarget.has(w.name_zh||w.name);}).slice(0,2);
  const topWorkflows = filteredWorkflows.map((item, i) => {
    const prefix = filteredWorkflows.length > 1 ? (i + 1) + ". " : "";
    const d = item.description_zh ? shortDesc(item.description_zh) : hasChinese(item.description) ? shortDesc(item.description) : item.description ? shortDesc(item.description) + "（需补充中文）" : "";
    return prefix + (d && d !== "未填写" ? (item.name_zh || item.name) + "：" + d : (item.name_zh || item.name));
  }).join("\n");

 const hasLinks = group.links && group.links.length > 0;
 
 const hasSkills = topSkills.length > 0;
  const hasWorkflows = topWorkflows.length > 0;
  const todos = (v2Fields && v2Fields.todos) || group.todos || [];
  const hasTodos = todos.length > 0;

  const groupName = group.group_name || group.name;
  const parts = [];
  parts.push("【" + groupName + " 群信息】\n📍 " + (group.positioning || "未在群注册表中记录") + "\n📁 " + (group.repo || "未在群注册表中记录"));
  if (hasLinks) parts.push(group.links.filter(function(l) { return l.url && l.url.trim(); }).map(function(l) { return "🔗 " + (l.name || "链接") + "：" + l.url; }).join("\n"));
  if (hasSkills) parts.push("🧩 " + topSkills);
  if (hasWorkflows) parts.push("⚙️ " + topWorkflows);
  if (hasTodos) parts.push("📋 " + todos.map(function(t, i) { return (i + 1) + ". " + t; }).join("\n"));
  return parts.join("\n");
}




function scanRepo(group) {
  const repo = group.repo_path || group.repo;
  if (!repo || !existsSync(repo)) return { skills: [], workflows: [], dataSources: [], error: "绑定存在，但当前不可访问" };
  try {
    const skills = scanSkills(repo);
    return { skills, workflows: mergeWorkflows(detectWorkflows(skills, repo), group.manual_workflows), dataSources: scanDocDataSources(repo), error: null };
  } catch (error) {
    return { skills: [], workflows: group.manual_workflows || [], dataSources: [], error: error.message };
  }
}

function processGroup(registry, state, group, mode) {
  const now = new Date().toISOString();
  const scan = scanRepo(group);
  const repoPath = realpathMaybe(group.repo_path || group.repo);
  const target = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
  let v2Fields = null;
  if (target && existsSync(target)) {
    try {
      const existing = readFileSync(target, "utf8");
      v2Fields = parseGroupInfoV2(existing);
    } catch (e) { /* ignore, will generate defaults */ }
  }

  const markdown = renderGroupInfo(group, scan, v2Fields, now);
  const summary = renderPinSummary(group, scan, now, v2Fields);

  if (mode === "write" || mode === "apply") {
    if (!target) throw new Error("未在群注册表中记录 repo，无法写入 group-info.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, markdown);
  }

  if (mode === "apply") {
    const runtime = stateFor(state, group);
    runtime.last_updated = now;
    runtime.last_updated_at = now;
    saveState(state);
  }

  return { group: group.name, mode, target, markdown, summary };
}



function topGroup(registry, state, group, mode) {
  const now = new Date().toISOString();
  const scan = scanRepo(group);
  const repoPath = realpathMaybe(group.repo_path || group.repo);
  const target = group.group_info_path || (repoPath ? join(repoPath, "GROUP_INFO.md") : null);
  let v2Fields = null;
  if (target && existsSync(target)) {
    try {
      v2Fields = parseGroupInfoV2(readFileSync(target, "utf8"));
    } catch (e) { /* ignore */ }
  }
  const summary = renderPinSummary(group, scan, now, v2Fields);
  const chatId = group.chat_id;

  if (!chatId) {
    console.error("错误：群 " + group.name + " 未绑定 chat_id（registry.chat_id 为 null），无法发送群置顶。");
    process.exit(3);
  }


  if (topSummaryUnchanged(group, summary)) {
    console.log("\n=== " + group.name + " :: top-notice-skip ===");
    console.log("群置顶摘要内容无变化，跳过置顶");
    return;
  }

  if (mode !== "apply") {
    console.log("\n=== " + group.name + " :: top-notice-dry-run ===\n");
    console.log("chat_id: " + chatId);
    const card = renderTopNoticeCard(group, scan, now, v2Fields);
    console.log("\n----- 将发送到飞书群的卡片 JSON -----");
    console.log(JSON.stringify(card, null, 2));
    console.log("\n----- 群置顶摘要（用于变更对比）-----");
    console.log(summary);
    console.log("\n（dry-run 模式，未实际发送）");
    return;
  }

  // --- apply mode ---
  console.log("\n=== " + group.name + " :: top-notice-apply ===\n");

  // a. 生成卡片 JSON 并发送卡片消息
  const card = renderTopNoticeCard(group, scan, now, v2Fields);
  const cardJson = JSON.stringify(card);

  console.log("发送卡片到群 " + chatId + " ...");
  const sendResult = spawnSync("lark-cli", [
    "im", "+messages-send",
    "--as", "bot",
    "--chat-id", chatId,
    "--content", cardJson,
    "--msg-type", "interactive",
    "--format", "json"
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  if (sendResult.status !== 0) {
    console.error("发送卡片失败：", sendResult.stderr || sendResult.stdout);
    process.exit(4);
  }

  let sendData;
  try {
    sendData = JSON.parse(sendResult.stdout);
  } catch (e) {
    console.error("解析发送响应失败：", sendResult.stdout);
    process.exit(5);
  }

  const messageId = sendData?.data?.message_id || sendData?.message_id;
  if (!messageId) {
    console.error("发送卡片成功但未获取到 message_id：", sendResult.stdout);
    process.exit(6);
  }
  console.log("卡片已发送，message_id: " + messageId);

  // b. 群置顶（消息类型 action_type=1）
  console.log("群置顶消息 ...");
  const topNoticeData = JSON.stringify({
    chat_top_notice: [{ action_type: "1", message_id: messageId }]
  });
  const topResult = spawnSync("lark-cli", [
    "api", "POST",
    "/open-apis/im/v1/chats/" + chatId + "/top_notice/put_top_notice",
    "--as", "bot",
    "--data", topNoticeData,
    "--format", "json"
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

  if (topResult.status !== 0) {
    console.error("群置顶失败：", topResult.stderr || topResult.stdout);
    process.exit(7);
  }

  console.log("消息已群置顶");

  // c. 对比摘要内容变化，输出新旧摘要供 Agent 做语义分析
  const oldSummary = group.last_top_summary || "";
  const newSummary = summary;
  if (oldSummary !== newSummary) {
    const oldSections = (oldSummary || "").split("\n");
    const newSections = newSummary.split("\n");
    const diffLines = [];
    const maxLen = Math.max(oldSections.length, newSections.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldSections[i];
      const newLine = newSections[i];
      if (oldLine !== newLine) {
        if (oldLine !== undefined) diffLines.push("- " + oldLine);
        if (newLine !== undefined) diffLines.push("+ " + newLine);
      }
    }
    // ponytail: 不再脚本自动发 diff 通知——Agent 拿到新旧摘要后自己做语义分析
    if (diffLines.length > 0 && oldSummary) {
      console.log("\n--- AGENT_DIFF ---");
      console.log("group_name=" + (group.group_name || group.name));
      console.log("old=" + Buffer.from(oldSummary).toString("base64"));
      console.log("new=" + Buffer.from(newSummary).toString("base64"));
      console.log("--- END_AGENT_DIFF ---");
    }
  }
  const runtime = stateFor(state, group);
  runtime.top_notice_message_id = messageId;
  runtime.last_topped_at = now;
  runtime.last_top_summary = summary;
  saveState(state);
  console.log("state 已更新：top_notice_message_id=" + messageId + ", last_topped_at=" + now + ", last_top_summary=" + (summary.length > 30 ? summary.slice(0, 30) + "..." : summary));
}



function listProjects(registry) {
  const rows = registry.groups
    .filter((g) => g.auto_update !== false)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99))
    .map((g) => {
      const scan = scanRepo(g);
      const entry = (g.links && g.links.length > 0 && g.links[0].url) || (g.repo ? "https://github.com/SimplyY/" + g.name : "");
      return {
        priority: g.priority || 99,
        name: g.name,
        positioning: g.positioning || "",
        entry: entry,
        tags: scan.skills.slice(0, 3).map((s) => s.name_zh || s.name).join("、"),
        repo: g.repo || ""
      };
    });
  return rows;
}

function renderList(registry, format) {
  const rows = listProjects(registry);
  if (format === "json") return JSON.stringify(rows, null, 2);
  if (format === "md") {
    const lines = ["| # | 项目 | 定位 | 入口 | 标签 |", "|---|------|------|------|------|"];
    rows.forEach((r) => {
      lines.push("| " + r.priority + " | " + r.name + " | " + r.positioning + " | " + (r.entry ? "[链接](" + r.entry + ")" : "") + " | " + r.tags + " |");
    });
    return lines.join("\n");
  }
  const lines = [];
  lines.push("序号 | 项目 | 定位 | 入口 | 标签");
  lines.push("-----|------|------|------|-----");
  rows.forEach((r) => lines.push(r.priority + " | " + r.name + " | " + r.positioning + " | " + (r.entry || "") + " | " + r.tags));
  return lines.join("\n");
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + "\nexpected: " + expected + "\nactual: " + actual);
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(label + "\nmissing: " + expected + "\nactual: " + actual);
  }
}

function selfTest() {
  const fm = parseFrontmatter("---\nname: demo\ndescription_zh: >-\n  第一行\n  第二行\n---\n", "fallback");
  assertEqual(fm.name, "demo", "frontmatter name");
  assertEqual(fm.description_zh, "第一行 第二行", "frontmatter block");

  const baseGroup = normalizeBaseRow({
    "项目": "learn-x",
    "群名": "learn-x",
    "群 ID": "oc_demo",
    "仓库路径": "/tmp/learn-x",
    "定位": "认知系统",
    "优先级": ["P1"],
    "链接": "入口：https://example.com",
    "工作流": "周报：每周处理",
    "待办": "检查输入",
    "备注": "人工备注"
  });
  assertEqual(baseGroup.links[0].url, "https://example.com", "base links");
  assertEqual(baseGroup.priority, 2, "base priority");
  assertEqual(baseGroup.manual_workflows[0].description_zh, "每周处理", "base workflows");
  assertEqual(parseLinks("[入口](https://example.com/x)")[0].url, "https://example.com/x", "markdown links");

  const summary = renderPinSummary(
    { name: "demo", group_name: "Demo 群", positioning: "测试定位", repo: "/tmp/demo", links: [] },
    { skills: [], workflows: [], dataSources: [], error: null },
    "now",
    {}
  );
  assertIncludes(summary, "【Demo 群 群信息】", "top summary title");
  assertIncludes(summary, "📍 测试定位", "top summary positioning");

  console.log("self-test 通过");
}


const args = parseArgs(process.argv);
if (!args.command) {
  usage();
  process.exit(1);
}
if (args.command === "self-test") {
  selfTest();
  process.exit(0);
}

const state = readState();
const registry = attachState({ groups: fetchGroupIndexGroups() }, state);
const wantedGroup = normalizeGroupName(args.group);
const groups = args.command === "update-all"
  ? registry.groups.filter((group) => group.auto_update !== false)
  : registry.groups.filter((group) => group.id === wantedGroup || group.name === wantedGroup || group.group_name === wantedGroup);


// ponytail: skip-if-recent — 3天内已更新的群跳过
const THREE_DAYS_MS = 72 * 60 * 60 * 1000;
if (args.skipIfRecent) {
  const now = Date.now();
  const filtered = groups.filter((group) => {
    const last = group.last_updated || group.last_updated_at;
    if (!last) return true;
    return (now - new Date(last).getTime()) >= THREE_DAYS_MS;
  });
  console.log("skip-if-recent: 过滤 " + (groups.length - filtered.length) + " 个群，剩余 " + filtered.length + " 个");
  groups.length = 0; groups.push(...filtered);
}
if (args.command === "list") {
  console.log(renderList(registry, args.format));

} else if (args.command === "top") {
  for (const group of groups) {
    topGroup(registry, state, group, args.mode);
  }
} else {
  if (!groups.length) {
    console.error("未在群注册表中记录");
    process.exit(2);
  }

  for (const group of groups) {
    const result = processGroup(registry, state, group, args.mode);
    console.log(`\n${result.group} :: ${result.mode} :: ${result.target || "no target"} ===\n`);
    console.log("----- GROUP_INFO.md -----");
    console.log(result.markdown);
    console.log("----- Lark Pin Summary -----");
    console.log(result.summary);
  }
}
