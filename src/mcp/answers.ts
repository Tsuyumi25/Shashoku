import type { McpQuery } from '@shared/mcp/types'
import { useProjectStore } from '@/stores/projectStore'
import { collectTexts } from './collect'

function answer(query: McpQuery): unknown {
  switch (query.method) {
    case 'get_texts': {
      const project = useProjectStore()
      if (!project.isOpen) throw new Error('沒有開啟中的專案')
      return collectTexts(project.files)
    }
  }
}

export function registerMcpAnswers() {
  window.api.onMcpQuery((query) => {
    try {
      window.api.mcpReply({ id: query.id, ok: true, result: answer(query) })
    } catch (err) {
      window.api.mcpReply({
        id: query.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })
}
