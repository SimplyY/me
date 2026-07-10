import { parseFrontmatter, parseGroupInfoV2 } from "../frontmatter.js";
import { normalizeBaseRow } from "../base.js";
import { parseLinks } from "../utils.js";
import { renderGroupInfo, renderPinSummary } from "./update.js";

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

function assertNotEqual(actual, expected, label) {
  if (actual === expected) {
    throw new Error(label + "\nshould not be: " + expected);
  }
}

export function selfTest() {
  const fm = parseFrontmatter("---\nname: demo\ndescription_zh: >-\n  第一行\n  第二行\n---\n", "fallback");
  assertEqual(fm.name, "demo", "frontmatter name");
  assertEqual(fm.description_zh, "第一行 第二行", "frontmatter block");

  const baseGroup = normalizeBaseRow({
    "项目": "learn-x",
    "群 ID": "oc_demo",
    "仓库路径": "/tmp/learn-x",
    "仓库链接": "[https://github.com/SimplyY/learn-x](https://github.com/SimplyY/learn-x)",
    "定位": "认知系统",
    "优先级": ["P1"],
    "链接": "入口：https://example.com",
    "工作流": "周报：每周处理",
    "待办": "检查输入",
    "备注": "人工备注"
  });
  assertEqual(baseGroup.links[0].url, "https://example.com", "base links");
  assertEqual(baseGroup.group_name, "learn-x", "group name from project");
  assertEqual(baseGroup.repo_url, "https://github.com/SimplyY/learn-x", "repo url");
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

  const markdown = renderGroupInfo(
    { ...baseGroup, repo_url: "https://github.com/SimplyY/learn-x" },
    { skills: [], workflows: [], dataSources: [], error: null },
    {},
    "now"
  );
  assertIncludes(markdown, 'repo_url: "https://github.com/SimplyY/learn-x"', "repo url frontmatter");
  assertIncludes(markdown, "- 代码仓库：https://github.com/SimplyY/learn-x", "repo url binding");

  // 对抗性自测：repo_url 为空时不应渲染"代码仓库"
  const noRepoUrl = renderGroupInfo(
    { ...baseGroup, repo_url: "" },
    { skills: [], workflows: [], dataSources: [], error: null },
    {},
    "now"
  );
  assertNotEqual(noRepoUrl.includes("代码仓库"), true, "empty repo_url should not render 代码仓库");

  // 对抗性自测：缺失仓库链接字段时 repo_url 为空串
  const missingRepoUrl = normalizeBaseRow({
    "项目": "test-proj",
    "群 ID": "oc_test",
    "仓库路径": "/tmp/test",
    "定位": "测试",
    "优先级": ["P3"],
    "链接": "",
    "工作流": "",
    "待办": "",
    "备注": ""
  });
  assertEqual(missingRepoUrl.repo_url, "", "missing repo_url should be empty string");
  assertEqual(missingRepoUrl.links.length, 0, "empty links should stay empty");
  assertEqual(missingRepoUrl.group_name, "test-proj", "group_name from project");

  // 对抗性自测：group_name 始终跟随项目名
  const renamedGroup = normalizeBaseRow({
    "项目": "new-name",
    "群 ID": "oc_renamed",
    "仓库路径": "/tmp/renamed",
    "定位": "测试",
    "优先级": ["P2"],
    "链接": "",
    "工作流": "",
    "待办": "",
    "备注": ""
  });
  assertEqual(renamedGroup.group_name, "new-name", "group_name follows project");

  // 对抗性自测：parseGroupInfoV2 解析 repo_url
  const v2 = parseGroupInfoV2('---\nrepo_url: "https://github.com/SimplyY/learn-x"\nrepo_path: "/tmp/x"\n---');
  assertEqual(v2 && v2.repo_url, "https://github.com/SimplyY/learn-x", "parseGroupInfoV2 repo_url");

  console.log("self-test 通过");
}
