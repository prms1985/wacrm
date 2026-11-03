import { describe, expect, it } from 'vitest'
import { aiProviderChoice, aiProviderPayload, GEMINI_BASE_URL } from './provider-presets'
describe('Google Gemini preset', () => {
  it('uses the Google compatible endpoint for saving and testing', () => {
    expect(aiProviderPayload('gemini', 'https://example.com')).toEqual({ provider: 'openai_compatible', base_url: GEMINI_BASE_URL })
    expect(aiProviderPayload('anthropic')).toEqual({ provider: 'anthropic', base_url: null })
  })
  it('recognizes existing Google configurations after reload', () => {
    for (const suffix of ['', '/', '/chat/completions']) expect(aiProviderChoice('openai_compatible', GEMINI_BASE_URL + suffix)).toBe('gemini')
  })
  it('keeps custom and misleading endpoints as custom providers', () => {
    for (const url of ['https://generativelanguage.googleapis.com.evil.test/v1beta/openai', GEMINI_BASE_URL + '?key=x', GEMINI_BASE_URL + '#x', 'https://user@generativelanguage.googleapis.com/v1beta/openai', 'http://generativelanguage.googleapis.com/v1beta/openai'])
      expect(aiProviderChoice('openai_compatible', url)).toBe('openai_compatible')
    expect(aiProviderChoice('openai', GEMINI_BASE_URL)).toBe('openai')
  })
})
