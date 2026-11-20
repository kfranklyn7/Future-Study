import { useSyncExternalStore } from 'react'

// Light/dark theme. The `dark` class on <html> is the source of truth: an inline script in
// index.html sets it before first paint (saved choice, else the OS setting), and setTheme
// flips it. Dark colors themselves live in styles.css.
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'future-study:theme'
const listeners = new Set<() => void>()

const current = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  listeners.forEach((l) => l())
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  // Cross-fade the whole page where the browser supports view transitions.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !reduce) document.startViewTransition(() => apply(theme))
  else apply(theme)
}

// Follow the OS setting until the user picks a theme themselves.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(STORAGE_KEY)
    } catch {
      // ignore
    }
    if (!saved) apply(e.matches ? 'dark' : 'light')
  })
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    current,
    () => 'light',
  )
}

// Sun in light mode, moon in dark mode; the icons rotate and scale past each other.
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const dark = theme === 'dark'
  const icon =
    'absolute inset-0 m-auto h-5 w-5 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={`relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${className}`}
    >
      <svg
        className={`${icon} ${dark ? 'scale-50 -rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
      <svg
        className={`${icon} ${dark ? 'scale-100 rotate-0 opacity-100' : 'scale-50 rotate-90 opacity-0'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  )
}
