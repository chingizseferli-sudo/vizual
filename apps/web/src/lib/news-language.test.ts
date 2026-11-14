import { describe, expect, it } from 'vitest'
import { detectNewsLanguage } from './news-language'

describe('detectNewsLanguage', () => {
  it('reads the language edition from the link', () => {
    expect(detectNewsLanguage('Anything', 'https://1news.az/en/news/12345-abc')).toBe('en')
    expect(detectNewsLanguage('Anything', 'https://1news.az/ru/news/12345-abc')).toBe('ru')
    expect(detectNewsLanguage('Anything', 'https://en.1xeber.media/post/1')).toBe('en')
  })

  it('detects Russian by Cyrillic letters', () => {
    expect(detectNewsLanguage('Алиев принял делегацию', 'https://site.az/news/1')).toBe('ru')
  })

  it('detects Azerbaijani by its letters and words', () => {
    expect(detectNewsLanguage('Prezident İlham Əliyev çıxış edib', 'https://site.az/xeber/1')).toBe('az')
    expect(detectNewsLanguage('Bakıda yeni park açıldı', 'https://site.az/xeber/2')).toBe('az')
  })

  it('detects English by common words', () => {
    expect(detectNewsLanguage('Azerbaijan and Turkey sign the new agreement', 'https://site.az/news/3')).toBe('en')
  })
})
