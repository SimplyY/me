# AGENTS.md

## 项目定位

- 项目名称：Group Index
- 项目类型：飞书多维表格驱动的项目索引与群信息管理仓库
- 核心用途：用一张飞书多维表格 `group index` 管理项目的人脑字段，并派生 `GROUP_INFO.md` 和群置顶内容。
- 主要调用方：飞书群 Group Index 中的 Codex 小助手、`scripts/group-info.mjs`

## 核心数据源

- 飞书多维表格：`group index`
- 链接：https://ywhome.feishu.cn/base/AxMAbMTKOahp74sDuhqcERnrnph
- 表：`group index`
- 人工维护字段：项目、群名、群 ID、仓库路径、定位、优先级、链接、工作流、待办、备注。
- 机器扫描字段：Skill、仓库数据源、可从代码或文档稳定读取的信息。

原则：

- 扫描不出来、只在用户脑子里的字段，放多维表格。
- 扫描得出来的字段，以仓库扫描为准。
- `state.json` 只保存运行状态，不保存人工判断字段。
- 不再维护静态网站；多维表格截图或链接就是分享入口。

## 关键文件

- `scripts/group-info.mjs`：唯一执行入口。
- `state.json`：机器运行状态，只记录更新时间、置顶消息和上次摘要。
- `GROUP_INFO.md`：本群 Agent 上下文，由脚本生成。
- `AGENTS.md`：本文件。

## 常用命令

```bash
# 查看全量项目
node scripts/group-info.mjs list --format table

# 预览单个 GROUP_INFO.md，不写文件
node scripts/group-info.mjs update --group index --dry-run

# 更新单个 GROUP_INFO.md
node scripts/group-info.mjs update --group index --apply

# 更新全部 GROUP_INFO.md
node scripts/group-info.mjs update-all --apply

# 发卡片 + 置顶
node scripts/group-info.mjs top --group index --apply

# 自检
node scripts/group-info.mjs self-test
```

## 群置顶边界

- 群置顶走 `top` 子命令：发卡片 + 置顶。
- 每个群都需要群置顶，不由多维表格字段控制。
- 是否更新置顶，继续由原有摘要对比逻辑决定。
- 不新增“群置顶展示”之类字段。

## Codex 默认执行流程

1. 修改前运行 `rtk git status --short`。
2. 人工字段先查多维表格，不要从脚本里发明定位、优先级、工作流或待办。
3. 只改与任务直接相关的文件，不顺手重构群置顶逻辑。
4. 修改后至少运行 `node scripts/group-info.mjs self-test`。
5. 涉及飞书写入、群消息发送、批量更新时，先跑 dry-run。

## 不要做什么

- 不要恢复静态网站或 `sync-site`。
- 不要新增项目宪章、评审记录、多张表或复杂流程。
- 不要把人工字段重新放回 JSON 注册表。
- 不要手动编辑其他仓库的 `GROUP_INFO.md`，走脚本更新。
- 不要引入 npm 依赖、构建工具、JS 框架或后端服务。

## 完成标准

- 人工判断字段来自 `group index` 多维表格。
- `GROUP_INFO.md` 保留原有增量生成逻辑。
- 群置顶逻辑保持原样。
- `self-test` 通过。
