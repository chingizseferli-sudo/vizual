import { describe, expect, it } from 'vitest'
import { buildXlsx, columnName, sheetXml, zipStored } from './xlsx'

describe('xlsx', () => {
  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
  })

  it('writes numbers as numbers and escapes text', () => {
    const xml = sheetXml([['Başlıq', 'Say'], ['<a> & "b"', 42]])
    expect(xml).toContain('<c r="B2"><v>42</v></c>')
    expect(xml).toContain('&lt;a&gt; &amp; &quot;b&quot;')
    expect(xml).toContain('<c r="A1" t="inlineStr" s="1">')
  })

  it('builds a zip with every part', async () => {
    const zip = zipStored([['a.txt', 'ə']])
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    const blob = buildXlsx('Nəticələr', [['A'], [1]])
    const text = new TextDecoder().decode(await blob.arrayBuffer())
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
      expect(text).toContain(part)
    }
  })
})
