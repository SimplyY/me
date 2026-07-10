import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { groupIndexBaseToken, groupIndexTableId, groupIndexFields } from "./fields.js";
import { groupIdFromName, parseLinks, parseManualWorkflows, parseTextItems, parsePriority } from "./utils.js";

export function normalizeBaseRow(row) {
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

export function fetchGroupIndexGroups() {
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
