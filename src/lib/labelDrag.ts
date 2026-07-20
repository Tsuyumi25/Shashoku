import type { StyleGroup } from '@shared/project/types'

export const LABEL_DRAG_TYPE = 'application/x-shashoku-label+json'

/**
 * Drag payload v2 (2026-07):label.category:number 汰換成 groupId + groupName。
 * groupId 是「精準來源綁定」;groupName 是「跨專案 name-based 回退匹配」——
 * 從專案 A 拖到專案 B 時 id 不同,但 name 若剛好一樣可視為同語意 group。
 */
export interface LabelDragPayload {
  version: 2
  kind: 'label'
  source: 'main' | 'text-board'
  operation: 'move' | 'copy'
  token: string
  sourceId: string
  label: {
    text: string
    /** 來源 label 的 groupId(對應來源專案的 StyleGroup.id);null = 未綁 group */
    groupId: string | null
    /** 來源 group 的 name(用於跨專案 fallback 匹配);null 語意同 groupId=null */
    groupName: string | null
  }
  grabOffset: { x: number; y: number }
}

export function serializeLabelDrag(payload: Omit<LabelDragPayload, 'version' | 'kind'>): string {
  return JSON.stringify({ version: 2, kind: 'label', ...payload })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseLabelDrag(raw: string): LabelDragPayload | null {
  if (raw.length === 0 || raw.length > 1_000_000) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || !isRecord(value.label) || !isRecord(value.grabOffset)) return null
    const label = value.label
    const offset = value.grabOffset
    const groupIdOk = label.groupId === null || (typeof label.groupId === 'string' && (label.groupId as string).length <= 100)
    const groupNameOk = label.groupName === null || (typeof label.groupName === 'string' && (label.groupName as string).length <= 200)
    if (
      value.version !== 2 ||
      value.kind !== 'label' ||
      (value.source !== 'main' && value.source !== 'text-board') ||
      (value.operation !== 'move' && value.operation !== 'copy') ||
      typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 100 ||
      typeof value.sourceId !== 'string' || value.sourceId.length === 0 || value.sourceId.length > 100 ||
      typeof label.text !== 'string' || label.text.length > 500_000 ||
      !groupIdOk ||
      !groupNameOk ||
      typeof offset.x !== 'number' || !Number.isFinite(offset.x) ||
      typeof offset.y !== 'number' || !Number.isFinite(offset.y)
    ) return null
    return value as unknown as LabelDragPayload
  } catch {
    return null
  }
}

/**
 * 決定 drop 到目標專案時,新 label 應綁哪個 groupId。
 * 匹配優先序:精準 id → name 匹配 → fallback。
 */
export function resolveDropGroupId(
  payload: LabelDragPayload,
  targetGroups: StyleGroup[],
  fallback: string | null,
): string | null {
  const { groupId, groupName } = payload.label
  if (groupId !== null && targetGroups.some((g) => g.id === groupId)) return groupId
  if (groupName !== null) {
    const byName = targetGroups.find((g) => g.name === groupName)
    if (byName !== undefined) return byName.id
  }
  return fallback
}
