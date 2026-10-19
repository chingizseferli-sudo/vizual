import { z } from 'zod'
import { createHash } from 'node:crypto'

export const PROMPT_VERSION = 'vizual-evidence-v2'
export const RULES_VERSION = 'az-rules-v2'
export const qualityLabels = [
  'full_text',
  'substantial_excerpt',
  'title_summary',
  'title_only',
  'extraction_failed',
  'source_inaccessible',
]
export const evidenceKinds = [
  'complaint',
  'suggestion',
  'announcement',
  'journalist_summary',
  'event',
  'reported_opinion',
  'allegation',
  'uncertain',
  'feedback',
]
export const sentiments = [
  'positive',
  'negative',
  'neutral',
  'mixed',
  'uncertain',
]
const stanceValues = [
  'opinion',
  'reported_quote',
  'allegation',
  'fact_report',
  'uncertain',
]
const normalize = (text) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('az-AZ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const timestamp = z.iso.datetime({ offset: true })
export const inputSchema = z
  .object({
    entity: z
      .object({
        name: z.string().min(3).max(200),
        aliases: z
          .array(
            z
              .object({
                value: z.string().min(2).max(200),
                ambiguous: z.boolean(),
                context: z.array(z.string().min(3).max(100)).max(10),
              })
              .strict()
          )
          .max(20)
          .default([]),
      })
      .strict(),
    start: timestamp,
    end: timestamp,
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            title: z.string().max(2000),
            url: z.string().max(2000),
            source_id: z.string().nullable(),
            publisher: z.string().max(200).nullable(),
            published_at: timestamp.nullable(),
            detected_at: timestamp,
            metadata: z.record(z.string(), z.unknown()).nullable().optional(),
          })
          .passthrough()
      )
      .max(100),
  })
  .strict()
  .refine(
    (x) =>
      Date.parse(x.start) < Date.parse(x.end) &&
      Date.parse(x.end) - Date.parse(x.start) <= 31 * 86400000
  )
export const classificationSchema = z
  .array(
    z
      .object({
        evidence_id: z.string().min(1).max(100),
        sentiment: z.enum(sentiments),
        stance: z.enum(stanceValues),
        topic: z.string().min(2).max(120),
        action: z.string().min(5).max(400).nullable(),
      })
      .strict()
  )
  .max(100)

export function matchEntity(text, entity) {
  const value = ` ${normalize(text)} `
  const names = [
    {
      value: entity.name,
      ambiguous: normalize(entity.name).length <= 4,
      context: [],
    },
    ...entity.aliases,
  ]
  return names.some((alias) => {
    const suffixes =
      '(?:nin|nın|nun|nün|ndə|nda|nə|na|ni|nı|nu|nü|dən|dan|yə|ya|də|da)?'
    const matches = (term) =>
      new RegExp(`(?:^|\\s)${normalize(term)}${suffixes}(?:\\s|$)`, 'u').test(
        value
      )
    const found = matches(alias.value)
    return found && (!alias.ambiguous || alias.context.some(matches))
  })
}
function safeUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? value
      : null
  } catch {
    return null
  }
}
export function selectEvidence(input, maxChars = 12000) {
  const data = inputSchema.parse(input)
  const urls = new Set(),
    ids = new Set(),
    fingerprints = new Set()
  let chars = 0
  const selected = []
  for (const item of data.items) {
    const url = safeUrl(item.url)
    const excerpt =
      typeof item.metadata?.excerpt === 'string'
        ? Array.from(item.metadata.excerpt).slice(0, 4000).join('')
        : ''
    const text = excerpt || item.title
    const quality =
      item.metadata?.content_quality ||
      item.metadata?.provenance?.content_quality?.quality
    const label = qualityLabels.includes(quality?.label)
      ? quality.label
      : excerpt
        ? 'title_summary'
        : 'title_only'
    const substantial =
      excerpt &&
      item.metadata?.permission_verified === true &&
      ['full_text', 'substantial_excerpt'].includes(label) &&
      quality.main_content_detected === true &&
      quality.extracted_chars >= 250 &&
      Array.from(excerpt).length >= 200 &&
      quality.retained_chars === Array.from(excerpt).length
    const fingerprint = normalize(text)
    if (
      !url ||
      ids.has(item.id) ||
      urls.has(url) ||
      fingerprints.has(fingerprint) ||
      !matchEntity(text, data.entity) ||
      Date.parse(item.detected_at) < Date.parse(data.start) ||
      Date.parse(item.detected_at) >= Date.parse(data.end)
    )
      continue
    if (chars + text.length > maxChars) break
    chars += text.length
    urls.add(url)
    ids.add(item.id)
    fingerprints.add(fingerprint)
    selected.push({
      id: item.id,
      title: item.title,
      url,
      source_id: item.source_id,
      publisher: item.publisher,
      published_at: item.published_at,
      detected_at: item.detected_at,
      text_scope: excerpt ? 'excerpt' : 'title',
      excerpt: text,
      quality_label: label,
      retrieved_at: item.metadata?.retrieved_at || null,
      quality_qualified: Boolean(substantial),
    })
  }
  return selected
}

const topics = [
  ['Dərs cədvəli', /cədvəl|dərs saat|timetable/u],
  ['İnfrastruktur', /infrastruktur|bina|istilik|yataqxana/u],
  ['İnzibati proseslər', /inzibati|qeydiyyat|sənəd|müraciət/u],
  ['Tədris və proqramlar', /tədris|proqram|müəllim|təhsil keyfiyyət/u],
  ['İmtahanlar', /imtahan|qiymətləndir/u],
  ['İctimai xidmətlər', /xidmət|nəqliyyat|su təchizat/u],
]
export function isFirstPerson(text) {
  return /(?:^|\s)(?:mən|biz|mənim|bizim|mənə|bizə)(?:\s|$)|razıyam|məmnunam|bəyənirəm|şikayət edirəm|əziyyət çəkirəm|təklif edirəm|təklifim|istəyirəm|xahiş edirəm|sənədimi|müraciətimi|günümü|tələbəyəm/u.test(
    ` ${normalize(text)} `
  )
}
export function evidenceKind(text, entity) {
  const raw = text.toLocaleLowerCase('az-AZ')
  const relevant = entity
    ? text
        .split(/[.!?;\n]+/u)
        .filter((sentence) => matchEntity(sentence, entity))
        .join(' ')
    : text
  const value = ` ${normalize(relevant)} `
  if (/iddia|guya/u.test(value)) return 'allegation'
  if (
    /ignore previous|system prompt|expose secrets/iu.test(text) ||
    /bəlkə|deyilən|fikrim yoxdur|qiymətləndirə bilmir|barədə\s*$/u.test(
      value.trim()
    )
  )
    return 'uncertain'
  if (
    /sitat|sözlərinə|“|”|"/u.test(raw) ||
    (/deyib|bildirib/u.test(value) &&
      /şikayət|narazı|problem|məmnun|razıyam/u.test(value))
  )
    return 'reported_opinion'
  const personal = isFirstPerson(value)
  if (personal && /təklif|xahiş|istəyirəm|arzu edirəm/u.test(value))
    return 'suggestion'
  const positive =
    /məmnun|razıyam|bəyən|yaxşı|nəzakətli|keyfiyyətli|təşəkkür/u.test(value)
  const negative =
    /şikayət|narazı|çətin|əlverişsiz|problem|gecik|çatışma|uyğun deyil/u.test(
      value
    )
  if (positive && negative && /amma|lakin/u.test(value)) return 'feedback'
  if (personal && negative && !/problem deyil/u.test(value)) return 'complaint'
  if (personal) return 'feedback'
  if (/yanğın|qəza|zəlzələ|daşqın|hadisə|partlayış|baş ver/u.test(value))
    return 'event'
  if (
    /elan|təqdim|açılış|qəbul|təşkil|keçiri|başlay|konfrans|açıqlayıb|bildirib|tarixini/u.test(
      value
    )
  )
    return 'announcement'
  if (positive) return 'feedback'
  if (/uyğun deyil|başa düşmək çətin|əlverişsizdir/u.test(value))
    return 'complaint'
  if (/şikayət|narazı|problem|çətin|keyfiyyət|məmnun/u.test(value))
    return 'journalist_summary'
  return 'event'
}
export function classifyDeterministically(evidence, entity) {
  return evidence.map((item) => {
    const relevantText = entity
      ? item.excerpt
          .split(/[.!?;\n]+/u)
          .filter((sentence) => matchEntity(sentence, entity))
          .join(' ')
      : item.excerpt
    const text = normalize(relevantText)
    const sensitive = /iddia|guya|sitat|bildirib|deyib|sözlərinə|“|”|"/.test(
      item.excerpt.toLocaleLowerCase('az-AZ')
    )
    const uncertain =
      /əla.*yenə|sağ olsun.*problem|heç.*problem|deyilən|bəlkə|fikrim yoxdur|qiymətləndirə bilmir/u.test(
        text
      )
    const positive =
      /(?:^|\s)razı(?:yam)?(?:\s|$)|məmnun|təşəkkür|uğurlu|keyfiyyətli|bəyən|yaxşı|nəzakətli/u.test(
        text
      )
    const negative =
      /şikayət|narazı|çətin|əlverişsiz|gecik|çatışma|uyğun deyil/u.test(text) ||
      (/problem/u.test(text) && !/problem deyil|problem yoxdur/u.test(text))
    const kind = evidenceKind(item.excerpt, entity)
    const sentiment =
      sensitive || uncertain
        ? 'uncertain'
        : kind === 'uncertain'
          ? 'uncertain'
          : ['event', 'announcement', 'suggestion'].includes(kind)
            ? 'neutral'
            : kind === 'journalist_summary'
              ? 'uncertain'
              : positive && negative
                ? 'mixed'
                : negative
                  ? 'negative'
                  : positive
                    ? 'positive'
                    : 'neutral'
    const knownTopic = topics.find(([, pattern]) => pattern.test(text))?.[0]
    // Emerging lexical groups are candidates, never verified semantic topics.
    const topic =
      knownTopic ||
      `Digər müzakirə: ${
        text
          .split(' ')
          .filter((t) => t.length > 5)
          .slice(-2)
          .join(' ') || 'mövzu'
      } `
        .trim()
        .slice(0, 120)
    return {
      evidence_id: item.id,
      sentiment,
      stance: sensitive
        ? /iddia|guya/u.test(text)
          ? 'allegation'
          : 'reported_quote'
        : kind === 'suggestion'
          ? 'opinion'
          : sentiment === 'neutral'
            ? 'fact_report'
            : sentiment === 'uncertain'
              ? 'uncertain'
              : 'opinion',
      topic,
      action: null,
    }
  })
}
export function validateClassifications(value, evidence) {
  const parsed = classificationSchema.parse(value)
  const allowed = new Set(evidence.map((x) => x.id))
  if (
    parsed.length !== evidence.length ||
    new Set(parsed.map((x) => x.evidence_id)).size !== parsed.length ||
    parsed.some((x) => !allowed.has(x.evidence_id))
  )
    throw new Error('invalid_evidence_attribution')
  return parsed
}
export function cacheKey(input, config) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        input,
        provider: config.provider,
        model: config.model,
        version: PROMPT_VERSION,
      })
    )
    .digest('hex')
}
export async function analyze(
  input,
  provider,
  { maxInputChars = 12000, now = new Date() } = {}
) {
  const parsed = inputSchema.parse(input)
  const selected = selectEvidence(parsed, maxInputChars)
  const output = selected.length
    ? await provider.classify({
        entity: parsed.entity,
        evidence: selected,
        promptVersion: PROMPT_VERSION,
      })
    : {
        classifications: [],
        usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      }
  const classifications = validateClassifications(
    output.classifications,
    selected
  )
  const caution = new Map(
    classifyDeterministically(selected, parsed.entity).map((x) => [
      x.evidence_id,
      x,
    ])
  )
  for (const classification of classifications) {
    const source = selected.find(
      (item) => item.id === classification.evidence_id
    )
    const signal = caution.get(classification.evidence_id)
    if (
      ['reported_quote', 'allegation'].includes(signal.stance) ||
      signal.sentiment === 'uncertain' ||
      /ignore previous|system prompt|expose secrets/iu.test(source.excerpt)
    ) {
      classification.sentiment = 'uncertain'
      classification.stance = ['reported_quote', 'allegation'].includes(
        signal.stance
      )
        ? signal.stance
        : 'uncertain'
      classification.action = null
    }
    if (
      ['event', 'announcement'].includes(
        evidenceKind(source.excerpt, parsed.entity)
      )
    ) {
      classification.sentiment = 'neutral'
      classification.stance = 'fact_report'
    }
  }
  const byId = new Map(classifications.map((x) => [x.evidence_id, x]))
  const evidence = selected.map((item) => ({
    ...item,
    ...Object.fromEntries(
      Object.entries(byId.get(item.id)).filter(
        ([key]) => !['evidence_id', 'action'].includes(key)
      )
    ),
    evidence_kind: evidenceKind(item.excerpt, parsed.entity),
  }))
  for (const item of evidence) {
    item.recommendation_basis =
      item.quality_qualified &&
      isFirstPerson(item.excerpt) &&
      item.evidence_kind === 'complaint' &&
      item.sentiment === 'negative' &&
      item.stance === 'opinion'
    delete item.quality_qualified
  }
  const midpoint = (Date.parse(parsed.start) + Date.parse(parsed.end)) / 2
  const groups = new Map()
  for (const item of evidence) {
    const group = groups.get(item.topic) || []
    group.push(item)
    groups.set(item.topic, group)
  }
  const resultTopics = [...groups].map(([name, items]) => {
    const previous = items.filter(
      (x) => Date.parse(x.detected_at) < midpoint
    ).length
    const current = items.length - previous
    return {
      name,
      evidence_ids: items.map((x) => x.id),
      mentions: items.length,
      distinct_sources: new Set(items.map((x) => x.source_id).filter(Boolean))
        .size,
      ...Object.fromEntries(
        sentiments.map((s) => [
          s,
          items.filter((x) => x.sentiment === s).length,
        ])
      ),
      change: { previous, current, delta: current - previous },
    }
  })
  const recommendations = []
  for (const topic of resultTopics) {
    const support = evidence.filter(
      (x) =>
        x.topic === topic.name &&
        x.sentiment === 'negative' &&
        x.stance === 'opinion' &&
        x.recommendation_basis
    )
    const sources = new Set(support.map((x) => x.source_id).filter(Boolean))
      .size
    // A title-only or isolated complaint cannot establish recurring concerns.
    if (
      support.length < 3 ||
      sources < 2 ||
      support.some((x) => x.text_scope === 'title')
    )
      continue
    recommendations.push({
      topic: topic.name,
      issue: 'İnsan baxışı tələb edən şikayət namizədi',
      summary:
        'Seçilmiş fərqli mənbələrdə narazılıq bildirən rəylər var; bu, təsdiqlənmiş fakt və ya ictimaiyyətin ümumi mövqeyi deyil.',
      evidence_ids: support.map((x) => x.id),
      mentions: support.length,
      distinct_sources: sources,
      sentiment: 'negative',
      confidence: 'low',
      independent_author_count: null,
      independent_publisher_count: null,
      confidence_explanation: `${support.length} fərqli mətn, ${sources} mənbə. Müəllif müstəqilliyi təsdiqlənməyib; seçmə əhatəsi məhduddur. ${topic.positive + topic.mixed > 0 ? 'Müsbət və ya qarışıq rəylər də var; ziddiyyətli sübutları birlikdə nəzərdən keçirin.' : ''}`,
      action: `“${topic.name}” barədə rəyləri insan baxışı ilə yoxlayın, aidiyyəti bölmədən izah alın və mümkün təkmilləşdirmələri qiymətləndirin.`,
      expected_benefit:
        'Müzakirə olunan ehtiyacın doğruluğunu və mümkün cavab tədbirlərini müəyyənləşdirmək.',
      period_start: parsed.start,
      period_end: parsed.end,
    })
  }
  return {
    result: {
      version: 1,
      entity: parsed.entity,
      evidence_ids: evidence.map((x) => x.id),
      evidence,
      topics: resultTopics,
      recommendations,
      evidence_status: recommendations.length
        ? 'sufficient'
        : 'insufficient_evidence',
      insufficient_evidence_reasons: recommendations.length
        ? []
        : [
            'Yoxlanmış keyfiyyətli mətnlərdə ən azı üç fərqli birinci şəxs şikayəti və iki mənbə əsasında namizəd tapılmadı.',
            ...(evidence.some((item) =>
              [
                'title_only',
                'title_summary',
                'extraction_failed',
                'source_inaccessible',
              ].includes(item.quality_label)
            )
              ? [
                  'Başlıq, xülasə və ya əlçatmaz mənbə təşkilata yönəlmiş ictimai şikayəti təsdiqləmir.',
                ]
              : []),
          ],
      independent_author_count: null,
      independent_publisher_count: null,
      limitations: [
        'Məhdud seçmə; bütün interneti və ya ictimai rəyi əhatə etmir.',
        'Eyni mətn/URL təkrarları çıxarılıb; mənbə və müəllif müstəqilliyi təsdiqlənməyib.',
        ...(evidence.some((x) => x.text_scope === 'title')
          ? [
              'Bəzi mənbələrdə yalnız başlıq var; başlıq əsasında tövsiyə yaradılmır.',
            ]
          : []),
        ...(provider.method === 'deterministic'
          ? [
              'Azərbaycan dili üçün izah edilə bilən söz qaydaları; semantik AI və ya təsdiqlənmiş sentiment ölçüsü deyil.',
              'Sarkazm, dolayı fikir və sitatlar qeyri-müəyyən ola bilər.',
            ]
          : []),
      ],
      analysis_at: now.toISOString(),
      method: provider.method,
    },
    usage: output.usage,
  }
}
