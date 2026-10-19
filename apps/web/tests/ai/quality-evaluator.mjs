import { createHash } from 'node:crypto'

export const classes = ['positive', 'negative', 'neutral', 'mixed', 'uncertain']
const ratio = (numerator, denominator) =>
  denominator ? numerator / denominator : null
export function labelFingerprint(cases) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        cases.map(({ id, split, text, entity, expected }) => ({
          id,
          split,
          text,
          entity,
          expected,
        }))
      )
    )
    .digest('hex')
}
function partition(cases, predictions) {
  const matrix = Object.fromEntries(
    classes.map((name) => [
      name,
      Object.fromEntries([...classes, 'rejected'].map((actual) => [actual, 0])),
    ])
  )
  let correct = 0,
    total = 0,
    entityTP = 0,
    entityFP = 0,
    entityFN = 0,
    stanceCorrect = 0,
    kindCorrect = 0,
    abstained = 0
  for (const item of cases) {
    const output = predictions.find((prediction) => prediction.id === item.id)
    const relevant = output?.relevant === true
    if (item.expected.relevant && relevant) entityTP++
    if (!item.expected.relevant && relevant) entityFP++
    if (item.expected.relevant && !relevant) entityFN++
    if (!item.expected.relevant) continue
    total++
    const actual =
      relevant && classes.includes(output.sentiment)
        ? output.sentiment
        : 'rejected'
    matrix[item.expected.sentiment][actual]++
    if (actual === item.expected.sentiment) correct++
    if (actual === 'uncertain' || actual === 'rejected') abstained++
    if (relevant && output.stance === item.expected.stance) stanceCorrect++
    if (relevant && output.evidence_kind === item.expected.evidence_kind)
      kindCorrect++
  }
  const perClass = Object.fromEntries(
    classes.map((name) => {
      const tp = matrix[name][name]
      const support = Object.values(matrix[name]).reduce(
        (sum, count) => sum + count,
        0
      )
      const predicted = classes.reduce(
        (sum, expected) => sum + matrix[expected][name],
        0
      )
      const precision = ratio(tp, predicted),
        recall = ratio(tp, support)
      const f1 = support || predicted ? (2 * tp) / (support + predicted) : null
      return [name, { support, predicted, precision, recall, f1 }]
    })
  )
  const scores = Object.values(perClass)
    .map((metric) => metric.f1)
    .filter((value) => value !== null)
  const evidenceKindAvailable = predictions.some(
    (item) => item.evidence_kind !== null && item.evidence_kind !== undefined
  )
  return {
    cases: cases.length,
    classifiedCases: total,
    correct,
    accuracy: ratio(correct, total),
    macroF1: scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null,
    stanceAccuracy: ratio(stanceCorrect, total),
    evidenceKindAvailable,
    evidenceKindAccuracy: evidenceKindAvailable
      ? ratio(kindCorrect, total)
      : null,
    abstentionRate: ratio(abstained, total),
    confusion: matrix,
    perClass,
    entity: {
      tp: entityTP,
      fp: entityFP,
      fn: entityFN,
      precision: ratio(entityTP, entityTP + entityFP),
      recall: ratio(entityTP, entityTP + entityFN),
    },
  }
}
// Assess returned references against supplied originals, never the model's counts.
export function auditEvidence(result, originals) {
  const input = new Map(originals.map((item) => [item.id, item]))
  let references = 0,
    correctReferences = 0,
    recommendations = 0,
    unsupported = 0
  const byId = new Map((result.evidence || []).map((item) => [item.id, item]))
  const validIds = new Set()
  for (const item of result.evidence || []) {
    references++
    const original = input.get(item.id)
    if (
      original &&
      item.url === original.url &&
      item.source_id === original.source_id &&
      item.title === original.title &&
      (item.excerpt === original.metadata?.excerpt ||
        item.excerpt === original.title)
    ) {
      correctReferences++
      validIds.add(item.id)
    }
  }
  for (const recommendation of result.recommendations || []) {
    recommendations++
    const ids = recommendation.evidence_ids || []
    const items = ids.map((id) => byId.get(id))
    references += ids.length
    correctReferences += items.filter(
      (item) => item && validIds.has(item.id)
    ).length
    const sources = new Set(
      items
        .filter(Boolean)
        .map((item) => item.source_id)
        .filter(Boolean)
    )
    if (
      new Set(ids).size !== ids.length ||
      ids.length < 3 ||
      sources.size < 2 ||
      (recommendation.mentions !== undefined &&
        recommendation.mentions !== ids.length) ||
      (recommendation.distinct_sources !== undefined &&
        recommendation.distinct_sources !== sources.size) ||
      items.some(
        (item) =>
          !item ||
          !validIds.has(item.id) ||
          item.sentiment !== 'negative' ||
          item.stance !== 'opinion' ||
          (input.get(item.id)?.expected &&
            (input.get(item.id).expected.sentiment !== 'negative' ||
              input.get(item.id).expected.stance !== 'opinion')) ||
          item.text_scope === 'title' ||
          (item.evidence_kind && item.evidence_kind !== 'complaint')
      )
    )
      unsupported++
  }
  return {
    references,
    correctReferences,
    attributionCorrectness: ratio(correctReferences, references),
    recommendations,
    unsupportedRecommendations: unsupported,
    unsupportedRecommendationRate: ratio(unsupported, recommendations),
  }
}
export function scorePredictions(cases, predictions, runs = []) {
  if (new Set(predictions.map((item) => item.id)).size !== predictions.length)
    throw new Error('duplicate_prediction_id')
  if (predictions.some((item) => !cases.some((value) => value.id === item.id)))
    throw new Error('unknown_prediction_id')
  const audits = runs.map(({ result, originals }) =>
    auditEvidence(result, originals)
  )
  const references = audits.reduce((sum, audit) => sum + audit.references, 0)
  const correctReferences = audits.reduce(
    (sum, audit) => sum + audit.correctReferences,
    0
  )
  const recommendations = audits.reduce(
    (sum, audit) => sum + audit.recommendations,
    0
  )
  const unsupportedRecommendations = audits.reduce(
    (sum, audit) => sum + audit.unsupportedRecommendations,
    0
  )
  return {
    overall: partition(cases, predictions),
    splits: Object.fromEntries(
      ['dev', 'heldout'].map((split) => [
        split,
        partition(
          cases.filter((item) => item.split === split),
          predictions
        ),
      ])
    ),
    safety: {
      references,
      correctReferences,
      attributionCorrectness: ratio(correctReferences, references),
      recommendations,
      unsupportedRecommendations,
      unsupportedRecommendationRate: ratio(
        unsupportedRecommendations,
        recommendations
      ),
    },
  }
}
