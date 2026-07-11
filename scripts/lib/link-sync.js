import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { groupIndexBaseToken, groupIndexTableId } from "./fields.js";

// 核心文档列表（按扫描优先级）
const CORE_DOCS = ["README.md", "AGENTS.md", "docs/TECH.md", "docs/CHAT_PACK.md", "00_system/README.md"];

// 链接重要性评分：出现在这些段落中 +1
const IMPORTANCE_SECTIONS = [
  "核心资产", "入口", "链接", "数据", "多维表格", "Base", "飞书",
  "仓库", "GitHub", "站点", "入口地图", "绑定", "核心数据源"
];

// ── URL 归一化（去重用） ──

/**
 * 提取 URL 的规范标识符，用于去重。
 * 飞书文档：wiki/base/docx/form → 按文档 token 去重，忽略 query params。
 * 非飞书链接：用完整 URL（去掉尾部斜杠）。
 */
export function normalizeUrl(url) {
  if (!url) return "";
  const m = url.match(
    /https?:\/\/(?:[^/]+\.)?(feishu\.cn|larkoffice\.com|larksuite\.com)\/(wiki|base|docx|share\/base\/form)\/([A-Za-z0-9_-]+)/
  );
  if (m) {
    const typeKey = m[2].replace(/\//g, "_");
    return `feishu:${typeKey}:${m[3]}`;
  }
  return url.replace(/\/+$/, "");
}

function urlSpecificity(url) {
  return url.includes("?") ? 1 : 0;
}

function isFeishuUrl(url) {
  return /feishu\.cn|larkoffice\.com|larksuite\.com/.test(url);
}

function isGitHubUrl(url) {
  return /github\.com/.test(url);
}

function classifyUrl(url) {
  if (url.includes("feishu.cn/base/") || url.includes("larkoffice.com/base/")) return "base";
  if (url.includes("feishu.cn/wiki/") || url.includes("larkoffice.com/wiki/")) return "doc";
  if (url.includes("feishu.cn/docx/") || url.includes("larkoffice.com/docx/")) return "doc";
  if (url.includes("feishu.cn/share/base/form/") || url.includes("larkoffice.com/share/base/form/")) return "doc";
  if (isFeishuUrl(url)) return "doc";
  return "url";
}

// ── 链接提取 ──

/**
 * 从仓库核心文档中提取链接，按重要性排序
 */
export function extractLinksFromRepo(repoPath) {
  if (!repoPath || !existsSync(repoPath)) return [];

  // 用 canonical key 去重，保留最优 URL
  const seen = new Map();

  for (const doc of CORE_DOCS) {
    const filePath = join(repoPath, doc);
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, "utf8");
    const lines = text.split("\n");

    // Markdown 链接 [name](url)
    const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      mdLinkRegex.lastIndex = 0;
      while ((match = mdLinkRegex.exec(line)) !== null) {
        const name = match[1].trim();
        const url = match[2].trim();
        const canonical = normalizeUrl(url);

        const type = classifyUrl(url);
        let importance = (1000 - i) + (doc === "README.md" ? 200 : 0);
        if (type === "doc" || type === "base") importance += 100;
        const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
        for (const kw of IMPORTANCE_SECTIONS) {
          if (kw && context.includes(kw)) { importance += 50; break; }
        }
        // GitHub 链接降权
        if (isGitHubUrl(url)) importance -= 50;

        if (seen.has(canonical)) {
          const existing = seen.get(canonical);
          // 优先保留更具体的 URL（含 query params），其次保留靠前的
          if (urlSpecificity(url) > urlSpecificity(existing.url)) {
            existing.url = url;
            existing.name = name;
          }
          if (importance > existing.importance) existing.importance = importance;
          continue;
        }
        seen.set(canonical, { name, url, type, importance });
      }
    }
  }

  // 若没找到任何链接，放宽到整仓搜索飞书裸链接
  if (seen.size === 0) {
    for (const doc of CORE_DOCS) {
      const filePath = join(repoPath, doc);
      if (!existsSync(filePath)) continue;
      const text = readFileSync(filePath, "utf8");
      const lines = text.split("\n");
      const bareRegex = /(https?:\/\/[^\s<>"]+)/g;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        bareRegex.lastIndex = 0;
        while ((match = bareRegex.exec(line)) !== null) {
          const url = match[1].trim();
          if (!isFeishuUrl(url)) continue;
          const canonical = normalizeUrl(url);
          if (seen.has(canonical)) continue;
          seen.set(canonical, {
            name: guessNameFromUrl(url),
            url,
            type: classifyUrl(url),
            importance: 1000 - i,
          });
        }
      }
    }
  }

  const links = Array.from(seen.values());
  sortLinks(links);
  return links;
}

/**
 * 链接排序：飞书链接 > 外部链接 > GitHub 链接（最后）
 */
export function sortLinks(links) {
  links.sort((a, b) => {
    const aGh = isGitHubUrl(a.url);
    const bGh = isGitHubUrl(b.url);
    if (aGh && !bGh) return 1;
    if (!aGh && bGh) return -1;
    const aFs = isFeishuUrl(a.url);
    const bFs = isFeishuUrl(b.url);
    if (aFs && !bFs) return -1;
    if (!aFs && bFs) return 1;
    return (b.importance || 0) - (a.importance || 0);
  });
}

function guessNameFromUrl(url) {
  if (url.includes("github.com")) {
    const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
    return m ? m[1] : "GitHub";
  }
  if (isFeishuUrl(url)) {
    if (url.includes("/base/")) return "多维表格";
    if (url.includes("/docx/")) return "飞书文档";
    if (url.includes("/wiki/")) return "飞书文档";
    return "飞书链接";
  }
  try { return new URL(url).hostname; } catch { return "链接"; }
}

// ── Base 字段格式化 ──

export function formatLinksForBase(links) {
  return links.map((l) => `${l.name}：${l.url}`).join("\n");
}

// ── 链接合并（去重） ──

/**
 * 合并 README 链接和已有 Base 链接，按 canonical URL 去重。
 * README 链接在前，Base 已有链接在后（补充 README 没有的）。
 */
export function mergeLinks(readmeLinks, existingBaseLinks) {
  const seen = new Map();
  for (const l of readmeLinks) {
    const c = normalizeUrl(l.url);
    if (!seen.has(c)) seen.set(c, { name: l.name, url: l.url });
  }
  for (const l of existingBaseLinks) {
    const c = normalizeUrl(l.url);
    if (!seen.has(c)) seen.set(c, { name: l.name, url: l.url });
  }
  return Array.from(seen.values());
}

// ── Base 写入 ──

export function syncLinksToBase(recordId, links, mode) {
  const text = formatLinksForBase(links);
  if (mode === "dry-run") return { ok: true, dryRun: true, text };
  const args = [
    "base", "+record-upsert",
    "--base-token", groupIndexBaseToken,
    "--table-id", groupIndexTableId,
    "--record-id", recordId,
    "--json", JSON.stringify({ "链接": text }),
    "--as", "user",
    "--format", "json"
  ];
  const result = spawnSync("lark-cli", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
  });
  if (result.status !== 0) {
    console.error("[link-sync] Base 写入失败：", result.stderr || result.stdout);
    return { ok: false, dryRun: false, text, error: result.stderr || result.stdout };
  }
  return { ok: true, dryRun: false, text };
}

// ── 群标签页 ──

function fetchChatTabs(chatId) {
  const args = [
    "api", "GET", `/open-apis/im/v1/chats/${chatId}/chat_tabs/list_tabs`,
    "--as", "bot", "--format", "json",
  ];
  const result = spawnSync("lark-cli", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
  });
  if (result.status !== 0) {
    console.error(`[link-sync] 拉取 ${chatId} 标签页失败：`, result.stderr);
    return [];
  }
  try {
    return JSON.parse(result.stdout).data?.chat_tabs || [];
  } catch { return []; }
}

function docTabType(linkType) {
  return linkType === "url" ? "url" : "doc";
}

function docTabContent(linkType, url) {
  return { [docTabType(linkType)]: url };
}

function addChatTab(chatId, tab) {
  const body = JSON.stringify({ chat_tabs: [tab] });
  const result = spawnSync("lark-cli", [
    "api", "POST", `/open-apis/im/v1/chats/${chatId}/chat_tabs`,
    "--as", "bot", "--data", body, "--format", "json",
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
  });
  if (result.status !== 0) {
    console.error(`[link-sync] 添加标签页失败 (${chatId}):`, result.stderr);
  }
  return result.status === 0;
}

function updateChatTab(chatId, tabId, name, url, linkType) {
  const type = docTabType(linkType);
  const body = JSON.stringify({
    chat_tabs: [{ tab_id: tabId, tab_name: name, tab_type: type, tab_content: { [type]: url } }],
  });
  const result = spawnSync("lark-cli", [
    "api", "POST", `/open-apis/im/v1/chats/${chatId}/chat_tabs/update_tabs`,
    "--as", "bot", "--data", body, "--format", "json",
  ], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" },
  });
  if (result.status !== 0) {
    console.error(`[link-sync] 更新标签页失败 (${chatId}):`, result.stderr);
  }
  return result.status === 0;
}

/**
 * 同步链接到群标签页（按 canonical URL 去重，不删除已有标签）
 */
export function syncLinksToChatTabs(group, links, mode) {
  const chatId = group.chat_id;
  if (!chatId) return { ok: false, added: 0, updated: 0, deleted: 0, dryRun: mode === "dry-run", error: "无 chat_id" };

  const existing = fetchChatTabs(chatId);
  const existingDocUrl = existing.filter((t) => t.tab_type === "doc" || t.tab_type === "url");

  // 构建现有标签的 canonical → tab 映射
  const byCanonical = new Map();
  for (const t of existingDocUrl) {
    const content = t.tab_content?.[t.tab_type] || "";
    const c = normalizeUrl(content);
    if (!byCanonical.has(c)) byCanonical.set(c, t);
  }

  let added = 0, updated = 0, deleted = 0;
  const processed = new Set();

  for (const l of links) {
    const canonical = normalizeUrl(l.url);
    if (processed.has(canonical)) continue;
    processed.add(canonical);

    const existingTab = byCanonical.get(canonical);
    const type = l.type || "url";

    if (existingTab) {
      const existingContent = existingTab.tab_content?.[existingTab.tab_type] || "";
      const urlChanged = existingContent !== l.url;
      const nameChanged = existingTab.tab_name !== l.name;
      if (urlChanged || nameChanged) {
        if (mode === "apply") updateChatTab(chatId, existingTab.tab_id, l.name, l.url, type);
        updated++;
      }
    } else {
      if (mode === "apply") {
        addChatTab(chatId, {
          tab_name: l.name,
          tab_type: docTabType(type),
          tab_content: docTabContent(type, l.url),
        });
      }
      added++;
    }
  }

  return { ok: true, added, updated, deleted, dryRun: mode === "dry-run" };
}

// ── 核心入口 ──

/**
 * 核心入口：从仓库 README 提取链接，同步到 Base 和群标签页
 */
export function syncLinks(group, recordId, existingBaseLinks, mode) {
  const repoPath = group.repo_path || group.repo;
  const readmeLinks = extractLinksFromRepo(repoPath);

  if (readmeLinks.length === 0) {
    // 没有 README 链接但已有 Base 链接时，保留已有
    const kept = existingBaseLinks?.length || 0;
    return { links: existingBaseLinks || [], base: null, tabs: null, summary: `未从仓库提取到链接，保留已有 ${kept} 个` };
  }

  const mergedLinks = mergeLinks(readmeLinks, existingBaseLinks || []);

  const baseResult = recordId ? syncLinksToBase(recordId, mergedLinks, mode) : null;
  const tabsResult = group.chat_id ? syncLinksToChatTabs(group, readmeLinks, mode) : null;

  return {
    links: mergedLinks,
    base: baseResult,
    tabs: tabsResult,
    summary: [
      `提取 ${readmeLinks.length} 个链接`,
      existingBaseLinks?.length ? `合并已有 ${existingBaseLinks.length} 个` : "",
      baseResult ? `Base ${baseResult.dryRun ? "(dry-run)" : "已更新"}` : "",
      tabsResult ? `标签页 +${tabsResult.added} ~${tabsResult.updated}${tabsResult.dryRun ? " (dry-run)" : ""}` : "",
    ].filter(Boolean).join("，"),
  };
}
