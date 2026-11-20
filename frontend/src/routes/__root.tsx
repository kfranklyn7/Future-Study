import { Link, Outlet, createRootRoute } from '@tanstack/react-router'

import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import '../styles.css'
import '../app.css'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <p>Page not found. <Link to="/">Go home</Link></p>,
})

const NAV = [
  { to: '/', label: 'Discover', exact: true },
  { to: '/courses', label: 'Courses' },
  { to: '/programs', label: 'Programs' },
  { to: '/graph', label: 'Course map' },
  { to: '/map', label: 'Roadmap' },
  { to: '/careers', label: 'Careers' },
] as const

function RootComponent() {
  return (
    <div className="app">
      <header>
        <Link to="/" className="brand">Future<span>Study</span></Link>
        <nav>
          {NAV.map(n => (
            <Link key={n.to} to={n.to} activeProps={{ className: 'active' }}
              activeOptions={{ exact: 'exact' in n, includeSearch: false }}>{n.label}</Link>
          ))}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>Brooklyn College CIS data · AI output by Snowflake Cortex, verify before relying on it</footer>
      <TanStackDevtools
        config={{
          position: 'bottom-right',
        }}
        plugins={[
          {
            name: 'TanStack Router',
            render: <TanStackRouterDevtoolsPanel />,
          },
        ]}
      />
    </div>
  )
}
