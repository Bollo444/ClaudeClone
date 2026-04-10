import type { Command } from '../../commands.js'

const apiConfig = {
  aliases: ['api'],
  type: 'local-jsx',
  name: 'api-config',
  description: 'Configure API provider, base URL, and model',
  load: () => import('./apiConfig.js'),
} satisfies Command

export default apiConfig
