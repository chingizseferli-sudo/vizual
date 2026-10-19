import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/(auth)/monitor/story-intelligence-preview'
)({
  beforeLoad: () => {
    throw redirect({ to: '/monitor/story-intelligence' })
  },
})
