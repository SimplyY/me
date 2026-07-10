import { existsSync } from "node:fs";
import { statePath } from "./fields.js";
import { readJson, writeJson } from "./utils.js";

export function readState() {
  if (!existsSync(statePath)) return { groups: {} };
  return readJson(statePath);
}

export function stateFor(state, group) {
  if (!state.groups) state.groups = {};
  if (!state.groups[group.id]) state.groups[group.id] = {};
  return state.groups[group.id];
}

export function attachState(registry, state) {
  for (const group of registry.groups) {
    Object.assign(group, state.groups?.[group.id] || {});
  }
  return registry;
}

export function saveState(state) {
  writeJson(statePath, state);
}
