export const customerQueryKeys = {
  all: ['customer'] as const,
  dashboard: () => [...customerQueryKeys.all, 'dashboard'] as const,
  workspace: () => [...customerQueryKeys.all, 'workspace'] as const,
  keywords: () => [...customerQueryKeys.all, 'keywords'] as const,
  competitors: () => [...customerQueryKeys.all, 'competitors'] as const,
  storyIntelligence: () =>
    [...customerQueryKeys.all, 'story-intelligence'] as const,
  results: () => [...customerQueryKeys.all, 'results'] as const,
  alerts: () => [...customerQueryKeys.all, 'alerts'] as const,
  profile: () => [...customerQueryKeys.all, 'profile'] as const,
}
