import { createFileRoute } from '@tanstack/react-router'
import { Roadmap } from '#/components/map/Roadmap'

// The landing page: the app name, one line on what it is, then the BS in Computer Science course map.
export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <>
      <section className="bg-[#faf8f3] px-4 pt-14 pb-10 text-center sm:pt-16">
        <h1 className="text-5xl font-bold tracking-tight text-stone-900 motion-safe:animate-rise sm:text-6xl">
          Future<span className="text-accent">Study</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-lg text-pretty text-stone-600 motion-safe:animate-rise" style={{ animationDelay: '90ms' }}>
          Brooklyn College CS courses, mapped to careers and free resources.
        </p>
      </section>
      <section id="map" aria-label="Course map" className="scroll-mt-14">
        <Roadmap />
      </section>
    </>
  )
}
