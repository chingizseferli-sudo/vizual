import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  FACEBOOK_USD_PER_POST,
  INSTAGRAM_USD_PER_CALL,
  LINKEDIN_USD_PER_POST,
  X_USD_PER_POST,
  YOUTUBE_UNITS_PER_SEARCH,
  estimateCheckCost,
  formatCostUsd,
  type CheckScope,
  type MaxPosts,
} from './check-cost'

export type CheckBudgets = {
  // Remaining monthly budget in USD; null = no limit.
  total: number | null
  facebook: number | null
  instagram: number | null
  x?: number | null
  linkedin?: number | null
  // YouTube quota units left today (Pacific time); null = unknown.
  youtubeUnits?: number | null
}

function budgetText(value: number | null) {
  return value == null ? 'limitsiz' : `$${value.toFixed(2)}`
}

export function CheckCostDialog({
  open,
  onOpenChange,
  title,
  scope,
  fbMaxPostsPerQuery,
  maxPosts = {},
  budgets,
  onConfirm,
  isLoading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  scope: CheckScope
  fbMaxPostsPerQuery: number
  maxPosts?: MaxPosts
  budgets: CheckBudgets
  onConfirm: () => void
  isLoading?: boolean
}) {
  const cost = estimateCheckCost(scope, fbMaxPostsPerQuery, maxPosts)
  const facebookKeywords = scope.facebookKeywords ?? 0
  const instagramCalls = (scope.instagramKeywords ?? 0) + (scope.instagramPages ?? 0)
  const youtubeKeywords = scope.youtubeKeywords ?? 0
  const xKeywords = scope.xKeywords ?? 0
  const linkedinKeywords = scope.linkedinKeywords ?? 0
  const overBudget = budgets.total != null && cost.totalUsd > budgets.total

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      isLoading={isLoading}
      confirmText='Bəli, yoxla'
      handleConfirm={onConfirm}
      desc={
        <div className='grid gap-2 text-sm'>
          <p>Xərc çox ola bilər. Təxmini maksimum xərc:</p>
          <ul className='grid gap-1'>
            {facebookKeywords > 0 ? (
              <li>
                Facebook: {facebookKeywords} söz × {fbMaxPostsPerQuery} post × $
                {FACEBOOK_USD_PER_POST} = <strong>{formatCostUsd(cost.facebookUsd)}</strong>{' '}
                (qalan aylıq büdcə: {budgetText(budgets.facebook)})
              </li>
            ) : null}
            {instagramCalls > 0 ? (
              <li>
                Instagram: {instagramCalls} sorğu × ~${INSTAGRAM_USD_PER_CALL.toFixed(4)} ={' '}
                <strong>{formatCostUsd(cost.instagramUsd)}</strong> (qalan aylıq büdcə:{' '}
                {budgetText(budgets.instagram)})
              </li>
            ) : null}
            {xKeywords > 0 ? (
              <li>
                X: {xKeywords} söz × {maxPosts.x ?? 50} post × ${X_USD_PER_POST} ={' '}
                <strong>{formatCostUsd(cost.xUsd)}</strong> (qalan aylıq büdcə:{' '}
                {budgetText(budgets.x ?? null)})
              </li>
            ) : null}
            {linkedinKeywords > 0 ? (
              <li>
                LinkedIn: {linkedinKeywords} söz × {maxPosts.linkedin ?? 10} post × $
                {LINKEDIN_USD_PER_POST} = <strong>{formatCostUsd(cost.linkedinUsd)}</strong>{' '}
                (qalan aylıq büdcə: {budgetText(budgets.linkedin ?? null)})
              </li>
            ) : null}
            {youtubeKeywords > 0 ? (
              <li>
                YouTube: pulsuz, {youtubeKeywords} × {YOUTUBE_UNITS_PER_SEARCH} ={' '}
                {cost.youtubeUnits} kvota vahidi
                {budgets.youtubeUnits != null
                  ? ` (bu gün qalan: ${budgets.youtubeUnits})`
                  : ''}
              </li>
            ) : null}
          </ul>
          <p>
            Cəmi: <strong>{formatCostUsd(cost.totalUsd)}</strong> · ümumi aylıq büdcədən
            qalan: {budgetText(budgets.total)}.
          </p>
          {overBudget ? (
            <p className='text-destructive'>
              Bu, qalan büdcədən çoxdur: limit dolanda axtarış dayanır.
            </p>
          ) : null}
          <p>Əminsiniz?</p>
        </div>
      }
    />
  )
}
