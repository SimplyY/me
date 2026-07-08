<!--
  core-repos-index Agent 指引
  供 Codex / Claude 等 agent 在本仓库中工作时读取。
-->

# core-repos-index Agent 指引

## 强制中文输出

所有飞书群对话输出必须使用中文。仅专有名词（GitHub、Codex、RTK、API、JSON、URL、token 等）保留原文。禁止在描述性文字中混用英文单词替代中文表达（如「Group Info」→「群信息」、「Base」→「多维表格」、「pin」→「置顶」、「summary」→「摘要」、「link」→「链接」、「deploy」→「部署」）。

## 项目定位

个人 AI 项目体系的总入口，承担两个核心职责：

1. **站点维护**：维护 https://simplyy.github.io/core-repos-index/ ，展示所有项目的概要介绍和详细弹窗
2. **全量项目表格**：通过 group-info 的 list 命令输出全部项目的汇总表格，按优先级排序。当 group-info 注册表更新时，站点表格也应同步更新。

## 与 group-info 的联动

站点中的「全部项目」表格数据来源于 group-info 注册表。更新流程：

1. 在 group-info 注册表中更新项目信息（定位、优先级、入口链接等）
2. 调用 group-info 的 list 命令获取最新数据
3. 同步更新站点 index.html 中的全部项目表格
4. 重新部署站点

## 关键文件

- index.html：站点首页，含项目卡片（平铺概要 + 点击弹窗详情）和「全部项目」表格
- GROUP_INFO.md：飞书群绑定信息

## 站点结构

- 静态 HTML，部署到 GitHub Pages
- 构建哈希嵌入 footer，用于缓存失效
- 手机端优先，最大宽度 640px

## 全部项目表格

表格位于站点底部「全部项目」section，按优先级升序排列。优先级在 group-info 注册表的 priority 字段中定义（数字越小越靠前）。表格为移动端优化的紧凑布局，每行显示序号、项目名（可点击链接）、定位描述。

## 部署

推送 main 分支后 GitHub Pages 自动部署。如有缓存问题，修改 build hash（footer 中的 #xxx）强制刷新。
