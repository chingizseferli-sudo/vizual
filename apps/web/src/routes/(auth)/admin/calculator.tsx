import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Calculator, Check, ChevronDown, Copy, RotateCcw } from 'lucide-react'
import {
  type CalculatorAssumptions,
  type CalculatorInput,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_INPUT,
  calculateDeal,
  closestPlan,
} from '@/lib/deal-calculator'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/(auth)/admin/calculator')({
  component: CalculatorPage,
})

const ASSUMPTIONS_STORAGE_KEY = 'vizual-admin-calculator-assumptions'
const INTERVAL_HOURS = [1, 2, 3, 6, 12, 24]

type PlanRow = {
  code: string
  name: string
  price_amount: number | null
  currency: string | null
}

function loadAssumptions(): CalculatorAssumptions {
  try {
    const saved = localStorage.getItem(ASSUMPTIONS_STORAGE_KEY)
    if (saved) return { ...DEFAULT_ASSUMPTIONS, ...JSON.parse(saved) }
  } catch {
    // Private mode or bad JSON: use defaults.
  }
  return DEFAULT_ASSUMPTIONS
}

function azn(value: number) {
  return `${value.toLocaleString('az-AZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AZN`
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  step = 1,
  min = 0,
}: {
  label: string
  hint?: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
}) {
  return (
    <label className='grid gap-1 text-sm'>
      <span className='font-medium'>{label}</span>
      <input
        type='number'
        inputMode='decimal'
        min={min}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className='h-10 w-full min-w-0 rounded-lg border bg-background px-3'
      />
      {hint ? <span className='text-xs text-muted-foreground'>{hint}</span> : null}
    </label>
  )
}

function CheckboxField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
}) {
  return (
    <label className='flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm'>
      <input
        type='checkbox'
        className='h-4 w-4'
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function CalculatorPage() {
  const [input, setInput] = useState<CalculatorInput>(DEFAULT_INPUT)
  const [assumptions, setAssumptions] = useState<CalculatorAssumptions>(loadAssumptions)
  const [showAssumptions, setShowAssumptions] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(ASSUMPTIONS_STORAGE_KEY, JSON.stringify(assumptions))
    } catch {
      // Storage unavailable: the values still work for this visit.
    }
  }, [assumptions])

  const plansQuery = useQuery({
    queryKey: ['admin', 'calculator', 'plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('code,name,price_amount,currency')
        .eq('is_active', true)
        .order('display_order')
      if (error) throw error
      return (data || []) as PlanRow[]
    },
  })

  const result = useMemo(() => calculateDeal(input, assumptions), [input, assumptions])
  const plans = plansQuery.data ?? []
  const nearest = closestPlan(plans, result.finalPriceAzn)

  const set = <K extends keyof CalculatorInput>(key: K, value: CalculatorInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }))
  const setAssumption = (key: keyof CalculatorAssumptions, value: number) =>
    setAssumptions((current) => ({ ...current, [key]: value }))

  const platforms = [
    'Xəbər saytları',
    input.facebook ? 'Facebook' : null,
    input.instagram ? 'Instagram' : null,
  ].filter(Boolean)
  const social = input.facebook || input.instagram

  const breakdown: [string, number][] = [
    ['Facebook (Apify)', result.facebookAzn],
    ['Instagram (SocialFetch)', result.instagramAzn],
    ['Digər dəyişən xərc', result.otherVariableAzn],
    ['Server və xidmət planlarının payı', result.infraShareAzn],
    ['Developer payı', result.developerShareAzn],
  ]

  const quote = [
    'Vizual təklifi',
    `Platformalar: ${platforms.join(', ')}`,
    `Xəbər açar sözü: ${input.newsKeywords}`,
    social
      ? `Sosial açar söz: ${input.socialKeywords}, yoxlama: ${input.intervalHours} saatdan bir`
      : null,
    `Aylıq qiymət (ƏDV daxil): ${azn(result.finalPriceAzn)}`,
    input.discountPercent > 0 ? `Endirim: ${input.discountPercent}%` : null,
    `Müddət: ${input.contractMonths} ay, cəmi ${azn(result.finalPriceAzn * input.contractMonths)}`,
  ]
    .filter(Boolean)
    .join('\n')

  async function copyQuote() {
    try {
      await navigator.clipboard.writeText(quote)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className='grid gap-6 p-4 md:p-6'>
      <div>
        <h1 className='flex items-center gap-2 text-xl font-semibold tracking-tight'>
          <Calculator className='h-5 w-5 text-muted-foreground' />
          Kalkulyator
        </h1>
        <p className='text-muted-foreground'>
          Müştəri ilə razılaşma üçün aylıq xərc və təklif olunan qiymət. Hesablama yalnız bu brauzerdə aparılır.
        </p>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <section className='grid content-start gap-4 rounded-lg border bg-card p-4 md:p-5'>
          <h2 className='text-lg font-semibold'>Müştərinin seçimi</h2>
          <div className='grid gap-2 sm:grid-cols-3'>
            <CheckboxField label='Xəbər saytları' checked disabled />
            <CheckboxField label='Facebook' checked={input.facebook} onChange={(v) => set('facebook', v)} />
            <CheckboxField label='Instagram' checked={input.instagram} onChange={(v) => set('instagram', v)} />
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <NumberField label='Xəbər açar sözü' value={input.newsKeywords} onChange={(v) => set('newsKeywords', v)} />
            {social ? (
              <>
                <NumberField
                  label='Sosial açar söz'
                  hint='Facebook və Instagram-da axtarılan sözlər'
                  value={input.socialKeywords}
                  onChange={(v) => set('socialKeywords', v)}
                />
                <label className='grid gap-1 text-sm'>
                  <span className='font-medium'>Sosial yoxlama tezliyi</span>
                  <select
                    value={input.intervalHours}
                    onChange={(event) => set('intervalHours', Number(event.target.value))}
                    className='h-10 w-full rounded-lg border bg-background px-3'
                  >
                    {INTERVAL_HOURS.map((hours) => (
                      <option key={hours} value={hours}>
                        {hours} saatdan bir
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {input.facebook ? (
              <NumberField
                label='Bir sözə gündə yeni FB postu'
                hint='Təxmin, 18 oktyabr testinə görə 15'
                value={input.fbNewPostsPerKeywordPerDay}
                onChange={(v) => set('fbNewPostsPerKeywordPerDay', v)}
              />
            ) : null}
            <NumberField label='Müqavilə müddəti (ay)' value={input.contractMonths} min={1} onChange={(v) => set('contractMonths', v)} />
            <NumberField
              label='Ödəyən müştəri sayı'
              hint='Sabit xərclər bu sayda bölünür'
              value={input.payingCustomers}
              min={1}
              onChange={(v) => set('payingCustomers', v)}
            />
            <NumberField label='Hədəf marja (%)' value={input.targetMarginPercent} onChange={(v) => set('targetMarginPercent', v)} />
            <NumberField label='Endirim (%)' value={input.discountPercent} onChange={(v) => set('discountPercent', v)} />
          </div>
        </section>

        <section className='grid content-start gap-4 rounded-lg border bg-card p-4 md:p-5'>
          <h2 className='text-lg font-semibold'>Nəticə (ayda)</h2>
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <tbody>
                {breakdown.map(([label, value]) => (
                  <tr key={label} className='border-b'>
                    <td className='py-2 pr-3 text-muted-foreground'>{label}</td>
                    <td className='py-2 text-right whitespace-nowrap'>{azn(value)}</td>
                  </tr>
                ))}
                <tr className='border-b font-semibold'>
                  <td className='py-2 pr-3'>Cəmi xərc</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.costAzn)}</td>
                </tr>
                <tr className='border-b'>
                  <td className='py-2 pr-3 text-muted-foreground'>Hesablanmış qiymət (ƏDV daxil)</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.suggestedPriceAzn)}</td>
                </tr>
                <tr className='border-b'>
                  <td className='py-2 pr-3 text-muted-foreground'>Yuvarlaq qiymət</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.roundedPriceAzn)}</td>
                </tr>
                <tr className='border-b text-base font-semibold'>
                  <td className='py-2 pr-3'>Təklif qiyməti{input.discountPercent > 0 ? ` (${input.discountPercent}% endirimlə)` : ''}</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.finalPriceAzn)}</td>
                </tr>
                <tr className='border-b'>
                  <td className='py-2 pr-3 text-muted-foreground'>ƏDV</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.vatAzn)}</td>
                </tr>
                <tr className='border-b'>
                  <td className='py-2 pr-3 text-muted-foreground'>Ödəniş komissiyası</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.feeAzn)}</td>
                </tr>
                <tr className={`border-b font-semibold ${result.profitAzn < 0 ? 'text-destructive' : ''}`}>
                  <td className='py-2 pr-3'>Mənfəət (marja {result.marginPercent.toFixed(0)}%)</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.profitAzn)}</td>
                </tr>
                <tr className={result.contractProfitAzn < 0 ? 'text-destructive' : ''}>
                  <td className='py-2 pr-3 text-muted-foreground'>Müddət üzrə mənfəət ({input.contractMonths} ay)</td>
                  <td className='py-2 text-right whitespace-nowrap'>{azn(result.contractProfitAzn)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className='rounded-lg border bg-background p-3 text-sm'>
            <div className='font-medium'>Mövcud planlarla müqayisə</div>
            {plansQuery.isError ? (
              <p className='text-muted-foreground'>Planlar yüklənmədi.</p>
            ) : (
              <ul className='mt-2 grid gap-1'>
                {plans
                  .filter((plan) => plan.price_amount !== null)
                  .map((plan) => (
                    <li
                      key={plan.code}
                      className={`flex justify-between gap-3 ${nearest?.code === plan.code ? 'font-semibold' : 'text-muted-foreground'}`}
                    >
                      <span>
                        {plan.name}
                        {nearest?.code === plan.code ? ' · ən yaxın' : ''}
                      </span>
                      <span className='whitespace-nowrap'>
                        {plan.price_amount} {plan.currency || 'AZN'}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <button
            type='button'
            onClick={copyQuote}
            className='inline-flex items-center justify-center gap-2 rounded-lg border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90'
          >
            {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
            {copied ? 'Kopyalandı' : 'Nəticəni kopyala'}
          </button>
        </section>
      </div>

      <section className='rounded-lg border bg-card'>
        <button
          type='button'
          onClick={() => setShowAssumptions((value) => !value)}
          className='flex w-full items-center justify-between gap-3 p-4 text-left md:p-5'
          aria-expanded={showAssumptions}
        >
          <span>
            <span className='block text-lg font-semibold'>Fərziyyələr</span>
            <span className='text-sm text-muted-foreground'>
              Qiymətlər və sabit xərclər. Dəyişikliklər bu brauzerdə yadda qalır.
            </span>
          </span>
          <ChevronDown className={`h-5 w-5 shrink-0 transition ${showAssumptions ? 'rotate-180' : ''}`} />
        </button>
        {showAssumptions ? (
          <div className='grid gap-4 border-t p-4 md:p-5'>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
              <NumberField label='1 USD (AZN)' step={0.01} value={assumptions.usdToAzn} onChange={(v) => setAssumption('usdToAzn', v)} />
              <NumberField label='Apify: 1 000 post (USD)' step={0.01} value={assumptions.apifyUsdPer1000Posts} onChange={(v) => setAssumption('apifyUsdPer1000Posts', v)} />
              <NumberField label='Bir yoxlamada maks. FB post' value={assumptions.fbMaxPostsPerCheck} onChange={(v) => setAssumption('fbMaxPostsPerCheck', v)} />
              <NumberField
                label='SocialFetch: 1 sorğu (USD)'
                hint='Starter $29 / 18 000; sonra ~$0.0016'
                step={0.0001}
                value={assumptions.socialFetchUsdPerRequest}
                onChange={(v) => setAssumption('socialFetchUsdPerRequest', v)}
              />
              <NumberField label='Railway (USD/ay)' value={assumptions.railwayUsd} onChange={(v) => setAssumption('railwayUsd', v)} />
              <NumberField label='Supabase (USD/ay)' value={assumptions.supabaseUsd} onChange={(v) => setAssumption('supabaseUsd', v)} />
              <NumberField label='Vercel (USD/ay)' value={assumptions.vercelUsd} onChange={(v) => setAssumption('vercelUsd', v)} />
              <NumberField label='Domen, e-poçt (USD/ay)' value={assumptions.domainUsd} onChange={(v) => setAssumption('domainUsd', v)} />
              <NumberField label='Apify planı (USD/ay)' value={assumptions.apifyPlanUsd} onChange={(v) => setAssumption('apifyPlanUsd', v)} />
              <NumberField label='SocialFetch planı (USD/ay)' value={assumptions.socialFetchPlanUsd} onChange={(v) => setAssumption('socialFetchPlanUsd', v)} />
              <NumberField label='Developer (AZN/ay)' value={assumptions.developerAzn} onChange={(v) => setAssumption('developerAzn', v)} />
              <NumberField label='Digər dəyişən xərc (AZN/müştəri)' step={0.1} value={assumptions.otherVariableAzn} onChange={(v) => setAssumption('otherVariableAzn', v)} />
              <NumberField label='ƏDV (0.18 = 18%)' step={0.01} value={assumptions.vatRate} onChange={(v) => setAssumption('vatRate', v)} />
              <NumberField label='Ödəniş komissiyası (0.025 = 2.5%)' step={0.001} value={assumptions.paymentFeeRate} onChange={(v) => setAssumption('paymentFeeRate', v)} />
            </div>
            <div>
              <button
                type='button'
                onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)}
                className='inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted'
              >
                <RotateCcw className='h-4 w-4' />
                Standart dəyərlərə qaytar
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
