import { createFileRoute } from '@tanstack/react-router'
import { Roadmap } from '#/components/map/Roadmap'

// The landing page is the BS in Computer Science course map.
export const Route = createFileRoute('/')({ component: Roadmap })
