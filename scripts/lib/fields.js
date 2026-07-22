import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(__dirname, "..", "..");
export const statePath = process.env.GROUP_INFO_STATE || join(repoRoot, "state.json");
export const sensitiveName = /(^|[/.-])(env|id_rsa|id_ed25519)|token|secret|credential|password|cookie|session|wallet|\.pem$|\.key$/i;
export const groupIndexBaseToken = process.env.GROUP_INDEX_BASE_TOKEN || "AxMAbMTKOahp74sDuhqcERnrnph";
export const groupIndexTableId = process.env.GROUP_INDEX_TABLE_ID || "tblwQkPtmNOv7tSY";
export const governanceDocTableId = process.env.GOVERNANCE_DOC_TABLE_ID || "tblKJ7XrYvUOG96y";
export const groupIndexFields = ["项目", "群 ID", "仓库路径", "仓库链接", "定位", "优先级", "链接", "工作流", "TODO", "备注"];

export const DEFAULT_ICONS = {
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
