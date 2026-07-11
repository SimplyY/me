#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { fetchGroupIndexGroups } from "./lib/base.js";
import { extractLinksFromRepo, normalizeUrl, sortLinks } from "./lib/link-sync.js";

// 从群标签页拉取 doc/url 类型的链接
function fetchChatTabLinks(chatId) {
  if (!chatId) return [];
  const r = spawnSync("lark-cli", [
    "api", "GET", `/open-apis/im/v1/chats/${chatId}/chat_tabs/list_tabs`,
    "--as", "bot", "--format", "json"
  ], {
    encoding: "utf8", maxBuffer: 1024 * 1024,
    env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }
  });
  if (r.status !== 0) return [];
  try {
    const data = JSON.parse(r.stdout);
    const tabs = (data.data?.chat_tabs || []).filter(t => t.tab_type === "doc" || t.tab_type === "url");
    return tabs.map(t => ({
      name: t.tab_name,
      url: t.tab_content?.[t.tab_type] || "",
      type: t.tab_type === "doc" ? "doc" : "url",
    }));
  } catch { return []; }
}

// 合并三个来源的链接，去重，按重要性排序
function mergeAllLinks(readmeLinks, baseLinks, tabLinks) {
  const seen = new Set();
  const merged = [];

  for (const src of [readmeLinks, baseLinks, tabLinks]) {
    for (const l of src) {
      const c = normalizeUrl(l.url);
      if (!l.url || seen.has(c)) continue;
      seen.add(c);
      const type = l.type || (l.url.includes("feishu.cn") ? "doc" : "url");
      merged.push({ name: l.name, url: l.url, type });
    }
  }

  sortLinks(merged);
  return merged;
}

// 生成「核心资产」Markdown 段落
function renderCoreAssets(links) {
  if (links.length === 0) return "";
  const lines = ["## 核心资产", ""];
  for (const l of links) {
    lines.push(`- [${l.name}](${l.url})`);
  }
  lines.push("");
  return lines.join("\n");
}

// 将核心资产段落插入 README.md
function insertCoreAssetsIntoReadme(repoPath, links) {
  const readmePath = join(repoPath, "README.md");
  if (!existsSync(readmePath)) return { ok: false, reason: "README.md 不存在" };

  let content = readFileSync(readmePath, "utf8");
  const lines = content.split("\n");

  const coreAssetsSection = renderCoreAssets(links);
  if (!coreAssetsSection) return { ok: true, reason: "无链接，跳过" };

  // 查找并替换已存在的 ## 核心资产 段落
  const coreStart = lines.findIndex(l => l.trim() === "## 核心资产");
  if (coreStart >= 0) {
    let coreEnd = lines.findIndex((l, i) => i > coreStart && /^##?\s/.test(l.trim()));
    if (coreEnd < 0) coreEnd = lines.length;
    const before = lines.slice(0, coreStart);
    const after = lines.slice(coreEnd);
    content = [...before, ...coreAssetsSection.split("\n"), ...after].join("\n");
  } else {
    // 找到 # 标题行，在标题块之后插入
    const titleIdx = lines.findIndex(l => /^#\s/.test(l.trim()));
    if (titleIdx < 0) {
      content = coreAssetsSection + "\n" + content;
    } else {
      let insertAfter = titleIdx;
      for (let i = titleIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() === "") { insertAfter = i; break; }
        insertAfter = i;
      }
      const before = lines.slice(0, insertAfter + 1);
      const after = lines.slice(insertAfter + 1);
      content = [...before, "", ...coreAssetsSection.split("\n"), ...after].join("\n");
    }
  }

  writeFileSync(readmePath, content);
  return { ok: true, reason: `写入 ${links.length} 个链接` };
}

// 主流程
async function main() {
  const mode = process.argv[2] || "dry-run";
  const apply = mode === "apply";

  console.error("[reverse-link-sync] 拉取群列表...");
  const groups = fetchGroupIndexGroups({ refresh: true });

  const results = [];

  for (const g of groups) {
    const repoPath = g.repo_path || g.repo;
    if (!repoPath || !existsSync(repoPath)) {
      results.push({ name: g.name, status: "skip", reason: "无仓库路径" });
      continue;
    }

    const readmeLinks = extractLinksFromRepo(repoPath);
    const baseLinks = (g.links || []).map(l => ({ ...l, type: l.url?.includes("feishu.cn") ? "doc" : "url" }));
    const tabLinks = fetchChatTabLinks(g.chat_id);

    const merged = mergeAllLinks(readmeLinks, baseLinks, tabLinks);

    const readmeCanonical = new Set(readmeLinks.map(l => normalizeUrl(l.url)));
    const newLinks = merged.filter(l => !readmeCanonical.has(normalizeUrl(l.url)));

    console.error(`\n=== ${g.name} ===`);
    console.error(`  README: ${readmeLinks.length} | Base: ${baseLinks.length} | Tab: ${tabLinks.length} | 合并: ${merged.length}`);
    if (newLinks.length > 0) {
      console.error(`  新增到 README: ${newLinks.map(l => l.name + " → " + l.url).join(", ")}`);
    }

    if (apply) {
      const insertResult = insertCoreAssetsIntoReadme(repoPath, merged);
      results.push({
        name: g.name, status: insertResult.ok ? "ok" : "fail",
        readmeCount: readmeLinks.length, baseCount: baseLinks.length, tabCount: tabLinks.length,
        mergedCount: merged.length, newCount: newLinks.length, reason: insertResult.reason,
      });
    } else {
      results.push({
        name: g.name, status: "dry-run",
        readmeCount: readmeLinks.length, baseCount: baseLinks.length, tabCount: tabLinks.length,
        mergedCount: merged.length, newCount: newLinks.length,
      });
    }
  }

  console.error("\n\n=== 汇总 ===");
  for (const r of results) {
    console.error(`${r.status === "ok" ? "✅" : r.status === "dry-run" ? "🔍" : "⚠️"} ${r.name}: ${r.status} | README=${r.readmeCount} Base=${r.baseCount} Tab=${r.tabCount} 合并=${r.mergedCount} 新增=${r.newCount}${r.reason ? " | " + r.reason : ""}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
