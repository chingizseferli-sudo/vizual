import { type QueryClient } from '@tanstack/react-query'
import { fetchDashboardData } from '@/features/keywords/dashboard'
import { fetchCompetitorsData } from '@/features/competitors/data'
import { fetchCustomerAlerts } from '@/features/keywords/alerts'
import { fetchKeywordsData } from '@/features/keywords/data'
import { fetchProfileData } from '@/features/profile/data'
import {
  DEFAULT_RESULTS_FILTERS,
  RESULTS_PAGE_SIZE,
  fetchResultsPage,
} from '@/features/results/data'
import { customerQueryKeys } from '@/lib/query-keys'

export function prefetchCustomerRoute(queryClient: QueryClient, url: string) {
  if (url === '/monitor') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.dashboard(),
      queryFn: fetchDashboardData,
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/keywords') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.keywords(),
      queryFn: fetchKeywordsData,
      staleTime: 60 * 1000,
    })
    return
  }

  if (url === '/monitor/competitors') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.competitors(),
      queryFn: fetchCompetitorsData,
      staleTime: 60 * 1000,
    })
    return
  }

  if (url === '/monitor/results') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.results({ ...DEFAULT_RESULTS_FILTERS, page: 1 }),
      queryFn: () =>
        fetchResultsPage({ ...DEFAULT_RESULTS_FILTERS, limit: RESULTS_PAGE_SIZE, offset: 0 }),
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/alerts') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.alerts(),
      queryFn: fetchCustomerAlerts,
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/profile') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.profile(),
      queryFn: fetchProfileData,
      staleTime: 5 * 60 * 1000,
    })
  }
}
