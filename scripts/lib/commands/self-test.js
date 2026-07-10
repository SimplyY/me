import { parseFrontmatter } from "../frontmatter.js";
import { normalizeBaseRow } from "../base.js";
import { parseLinks } from "../utils.js";
import { renderPinSummary } from "./update.js";

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

export function selfTest() {
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
