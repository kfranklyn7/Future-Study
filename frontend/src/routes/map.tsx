import { createFileRoute, redirect } from '@tanstack/react-router'

// The course map moved to the landing page; keep old /map links working.
export const Route = createFileRoute('/map')({
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true })
  },
})
