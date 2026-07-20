import { MAX_GROUPS } from '@shared/ssk/constants'

export const LABEL_DRAG_TYPE = 'application/x-shashoku-label+json'

export interface LabelDragPayload {
  version: 1
  kind: 'label'
  source: 'main' | 'text-board'
  operation: 'move' | 'copy'
  token: string
  sourceId: string
  label: {
    text: string
    category: number
    groupName: string
  }
  grabOffset: { x: number; y: number }
}

export function serializeLabelDrag(payload: Omit<LabelDragPayload, 'version' | 'kind'>): string {
  return JSON.stringify({ version: 1, kind: 'label', ...payload })
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
    if (
      value.version !== 1 ||
      value.kind !== 'label' ||
      (value.source !== 'main' && value.source !== 'text-board') ||
      (value.operation !== 'move' && value.operation !== 'copy') ||
      typeof value.token !== 'string' || value.token.length === 0 || value.token.length > 100 ||
      typeof value.sourceId !== 'string' || value.sourceId.length === 0 || value.sourceId.length > 100 ||
      typeof label.text !== 'string' || label.text.length > 500_000 ||
      !Number.isInteger(label.category) ||
      (label.category as number) < 1 ||
      (label.category as number) > MAX_GROUPS ||
      typeof label.groupName !== 'string' || label.groupName.length > 200 ||
      typeof offset.x !== 'number' || !Number.isFinite(offset.x) ||
      typeof offset.y !== 'number' || !Number.isFinite(offset.y)
    ) return null
    return value as unknown as LabelDragPayload
  } catch {
    return null
  }
}

export function resolveDropCategory(
  payload: LabelDragPayload,
  targetGroups: string[],
  fallback: number,
): number {
  const matchingIndex = targetGroups.indexOf(payload.label.groupName)
  if (matchingIndex !== -1) return matchingIndex + 1
  if (payload.label.category <= targetGroups.length) return payload.label.category
  return Math.min(Math.max(fallback, 1), Math.max(targetGroups.length, 1))
}
