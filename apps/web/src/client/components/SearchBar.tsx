import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { SEARCH_QUERY_MAX, searchQuery } from '@vidflare/shared'
import { SearchIcon } from 'lucide-react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Just the text from the API's search schema, so the form and GET /api/search agree.
const searchForm = searchQuery.pick({ q: true })

// The header search box: submitting opens /search?q=. Starts from the current query so it
// matches the results on the page (remount it with a key when that query changes).
export function SearchBar({ initialQuery = '' }: { initialQuery?: string }) {
  const navigate = useNavigate()
  const form = useForm<z.input<typeof searchForm>, unknown, z.output<typeof searchForm>>({
    resolver: zodResolver(searchForm),
    defaultValues: { q: initialQuery },
  })
  const invalid = Boolean(form.formState.errors.q)

  const onSubmit = form.handleSubmit(({ q }) => navigate({ to: '/search', search: { q } }))

  return (
    <form role="search" onSubmit={onSubmit} className="flex w-full max-w-xl items-center gap-1">
      <Input
        type="search"
        placeholder="Search"
        aria-label="Search videos"
        autoComplete="off"
        maxLength={SEARCH_QUERY_MAX}
        aria-invalid={invalid || undefined}
        {...form.register('q')}
      />
      <Button type="submit" variant="ghost" size="icon" aria-label="Search">
        <SearchIcon aria-hidden />
      </Button>
    </form>
  )
}
