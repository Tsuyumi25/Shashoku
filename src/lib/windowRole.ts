import type { WindowRole } from '@shared/ipc/channels'

const requestedRole = new URLSearchParams(window.location.search).get('windowRole')

export const windowRole: WindowRole = requestedRole === 'text-board' ? 'text-board' : 'main'
