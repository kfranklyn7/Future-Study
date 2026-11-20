import { Link, Outlet, createRootRoute, useRouterState } from '@tanstack/react-router'

import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => (
    <p className="text-stone-600">
      Page not found.{' '}
      <Link to="/" className="link">
        Go to the course map
      </Link>
    </p>
  ),
})

const NAV = [
  { to: '/', label: 'Course map', exact: true },
  { to: '/discover', label: 'Discover' },
  { to: '/courses', label: 'Courses' },
  { to: '/programs', label: 'Programs' },
  { to: '/careers', label: 'Careers' },
  { to: '/graph', label: 'All prerequisites' },
] as const

function RootComponent() {
  // The course map fills the screen under the nav; other pages sit in a centered column.
  const fullBleed = useRouterState({ select: (s) => s.location.pathname === '/' })

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-8 border-b border-stone-200 bg-white px-6">
        <Link to="/" className="text-xl font-extrabold text-stone-900">
          Future<span className="text-accent">Study</span>
        </Link>
        <nav className="flex gap-5 overflow-x-auto text-sm font-medium whitespace-nowrap">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="py-1 text-stone-500 hover:text-stone-900"
              activeProps={{ className: '!text-accent' }}
              activeOptions={{ exact: 'exact' in n, includeSearch: false }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className={fullBleed ? 'flex-1' : 'mx-auto w-full max-w-6xl flex-1 px-6 pt-6 pb-12 sm:px-8'}>
        <Outlet />
      </main>
      {!fullBleed && (
        <footer className="p-4 text-center text-xs text-stone-500">
          Brooklyn College CIS data · AI output by Snowflake Cortex, verify before relying on it
        </footer>
      )}
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
