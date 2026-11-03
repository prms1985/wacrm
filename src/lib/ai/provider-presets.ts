import type { AiProvider } from './types'

export type AiProviderChoice = AiProvider | 'gemini'
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'

// Gemini uses Google's officially supported OpenAI-compatible API.
export function aiProviderPayload(choice: AiProviderChoice, baseUrl = ''): { provider: AiProvider; base_url: string | null } {
  return { provider: choice === 'gemini' ? 'openai_compatible' : choice,
    base_url: choice === 'gemini' ? GEMINI_BASE_URL : choice === 'openai_compatible' ? baseUrl.trim() : null }
}

export function aiProviderChoice(provider: AiProvider, baseUrl?: string | null): AiProviderChoice {
  if (provider !== 'openai_compatible' || !baseUrl) return provider
  try {
    const url = new URL(baseUrl)
    const pathname = url.pathname.replace(/\/+$/, '')
    if (url.origin === 'https://generativelanguage.googleapis.com' && !url.username && !url.password && !url.search && !url.hash &&
      (pathname === '/v1beta/openai' || pathname === '/v1beta/openai/chat/completions')) return 'gemini'
  } catch { /* Unrecognized endpoints remain editable as custom providers. */ }
  return provider
}
