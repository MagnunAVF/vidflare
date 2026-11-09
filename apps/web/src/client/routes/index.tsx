import { createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({
  component: HomePage,
})

// Route modules must export `Route`; the router plugin handles their HMR.
// eslint-disable-next-line react-refresh/only-export-components
function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold">vidflare</h1>
      <Button>Get started</Button>
    </main>
  )
}
