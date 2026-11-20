import { createFileRoute } from '@tanstack/react-router'
import { Roadmap } from '#/components/map/Roadmap'

// The landing page: the app name, one line on what it is, then the BS in Computer Science course map.
export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <>
      <section className="relative z-[1] overflow-hidden border-b border-hero-line bg-hero px-4 shadow-[0_1px_2px_-1px_rgb(80_60_40/0.1),0_6px_16px_-10px_rgb(80_60_40/0.16)] pt-16 pb-14 text-center sm:pt-20 sm:pb-16">
        {/* Faint warm graph-paper grid, faded out toward the edges. Sets the hero apart from the
            lighter, dotted map area below. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(150 112 80 / 0.09) 1px, transparent 1px), linear-gradient(to bottom, rgb(150 112 80 / 0.09) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            backgroundPosition: 'center center',
            maskImage: 'radial-gradient(ellipse 70% 90% at 50% 40%, black 30%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 90% at 50% 40%, black 30%, transparent 100%)',
          }}
        />
        <h1
          className="relative font-display text-6xl font-semibold tracking-tight text-ink motion-safe:animate-rise sm:text-7xl"
          style={{ fontVariationSettings: "'SOFT' 100, 'opsz' 144" }}
        >
          future<span className="text-rose">study</span>
        </h1>
        <p className="relative mx-auto mt-4 max-w-xl text-lg text-pretty text-ink-muted motion-safe:animate-rise" style={{ animationDelay: '90ms' }}>
          plan your future cs degree here
        </p>
      </section>
      <section id="map" aria-label="Course map" className="scroll-mt-14">
        <Roadmap />
      </section>
    </>
  )
}
