import { supabase } from '@/lib/supabase'
import { t } from '@/lib/i18n'

// One article on the results page, with every keyword that matched it.
export type ResultRow = {
  id: string
  item_id: string
  matched_keyword: string | null
  created_at: string | null
  title: string | null
  url: string | null
  published_at: string | null
  detected_at: string | null
}

export type ResultsQuery = {
  days: number
  category?: 'web' | 'social'
  sites: string[]
  network?: string
  keyword?: string
  language?: string
  search: string
  date?: string
  limit: number
  offset: number
}

export const RESULTS_PAGE_SIZE = 12

// What the results page opens with (last day, no filters); prefetch uses it too.
export const DEFAULT_RESULTS_FILTERS: Omit<ResultsQuery, 'limit' | 'offset'> = {
  days: 1,
  sites: [],
  search: '',
}

export type ResultsPage = {
  total: number
  media: number
  keywords: number
  rows: ResultRow[]
  errorMessage: string
}

export type ResultFilters = {
  keywords: string[]
  sites: string[]
  networks: string[]
}

const EMPTY_PAGE: ResultsPage = {
  total: 0,
  media: 0,
  keywords: 0,
  rows: [],
  errorMessage: '',
}

// Filtering, grouping by article and paging happen in the database
// (my_results_page), so only one page of rows crosses the network.
export async function fetchResultsPage(query: ResultsQuery): Promise<ResultsPage> {
  const { data, error } = await supabase.rpc('my_results_page', {
    p_days: query.days,
    p_category: query.category ?? null,
    p_sites: query.sites.length ? query.sites : null,
    p_network: query.network ?? null,
    p_keyword: query.keyword ?? null,
    p_language: query.language ?? null,
    p_search: query.search.trim() || null,
    p_date: query.date || null,
    p_limit: query.limit,
    p_offset: query.offset,
  })

  if (error) {
    console.error('User results error:', error)
    return { ...EMPTY_PAGE, errorMessage: t("Nəticələri yükləmək mümkün olmadı.") }
  }

  const page = (data || {}) as Partial<ResultsPage>
  return {
    total: page.total ?? 0,
    media: page.media ?? 0,
    keywords: page.keywords ?? 0,
    rows: page.rows ?? [],
    errorMessage: '',
  }
}

export async function fetchResultFilters(days: number): Promise<ResultFilters> {
  const { data, error } = await supabase.rpc('my_result_filters', { p_days: days })
  if (error) throw error
  const filters = (data || {}) as Partial<ResultFilters>
  return {
    keywords: filters.keywords ?? [],
    sites: filters.sites ?? [],
    networks: filters.networks ?? [],
  }
}
