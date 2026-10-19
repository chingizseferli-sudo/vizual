import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/health')({
  component: HealthPage,
})

function HealthPage() {
  return <div>Visual Monitor OK</div>
}
