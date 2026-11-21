export const customerQueryKeys = {
  all: ['customer'] as const,
  dashboard: () => [...customerQueryKeys.all, 'dashboard'] as const,
  dashboardStats: (days: number) =>
    [...customerQueryKeys.all, 'dashboard-stats', days] as const,
  workspace: () => [...customerQueryKeys.all, 'workspace'] as const,
  keywords: () => [...customerQueryKeys.all, 'keywords'] as const,
  competitors: () => [...customerQueryKeys.all, 'competitors'] as const,
  storyIntelligence: () =>
    [...customerQueryKeys.all, 'story-intelligence'] as const,
  // Without params: the prefix that matches every results page.
  results: (params?: object) =>
    params
      ? ([...customerQueryKeys.all, 'results', params] as const)
      : ([...customerQueryKeys.all, 'results'] as const),
  resultFilters: (days: number) =>
    [...customerQueryKeys.all, 'result-filters', days] as const,
  alerts: () => [...customerQueryKeys.all, 'alerts'] as const,
  profile: () => [...customerQueryKeys.all, 'profile'] as const,
  alertSettings: () => [...customerQueryKeys.all, 'alert-settings'] as const,
}
