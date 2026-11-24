import { describe, expect, it } from 'vitest'

import {
  FILTERED,
  type ScrubbableEvent,
  scrubSentryEvent,
  scrubSentrySpan,
  stripQuery,
} from './sentry-scrub'

describe('stripQuery', () => {
  it.each([
    ['/search?q=cats', '/search'],
    ['https://vidflare.app/api/search?q=a&cursor=b', 'https://vidflare.app/api/search'],
    ['/watch/123#t=10', '/watch/123'],
    ['/api/videos', '/api/videos'],
  ])('%s → %s', (input, output) => {
    expect(stripQuery(input)).toBe(output)
  })
})

describe('scrubSentryEvent', () => {
  it('filters credential headers in any case, and drops cookies, bodies and query strings', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://vidflare.app/api/search?q=private',
        headers: {
          Cookie: 'vf_session=secret',
          authorization: 'Bearer moderation-token',
          'Webhook-Signature': 'time=1,sig1=abc',
          'content-type': 'application/json',
          'user-agent': 'test',
        },
        cookies: { vf_session: 'secret' },
        data: { password: 'hunter2' },
        query_string: 'q=private',
      },
      contexts: { response: { headers: { 'Set-Cookie': 'vf_session=new', 'x-request-id': 'r1' } } },
    })

    expect(event.request).toEqual({
      url: 'https://vidflare.app/api/search',
      headers: {
        Cookie: FILTERED,
        authorization: FILTERED,
        'Webhook-Signature': FILTERED,
        'content-type': 'application/json',
        'user-agent': 'test',
      },
    })
    expect(event.contexts?.response?.headers).toEqual({
      'Set-Cookie': FILTERED,
      'x-request-id': 'r1',
    })
  })

  it('strips query strings from breadcrumbs and spans', () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        { data: { from: '/', to: '/search?q=my+address' } },
        { data: { url: '/api/search?q=my+address', method: 'GET', status_code: 200 } },
      ],
      spans: [
        {
          description: 'GET /api/search?q=my+address',
          data: { 'http.url': '/api/search?q=x', 'http.query': 'q=x', 'url.query': '?q=x' },
        },
      ],
    })

    expect(event.breadcrumbs).toEqual([
      { data: { from: '/', to: '/search' } },
      { data: { url: '/api/search', method: 'GET', status_code: 200 } },
    ])
    expect(event.spans).toEqual([
      { description: 'GET /api/search', data: { 'http.url': '/api/search' } },
    ])
  })

  it('scrubs a streamed span: its name, URL attributes and credential headers', () => {
    const span = scrubSentrySpan({
      name: 'GET /api/search?q=my+address',
      attributes: {
        'url.full': 'https://vidflare.app/api/search?q=my+address',
        'http.query': 'q=my+address',
        'url.query': '?q=my+address',
        'http.request.header.authorization': 'Bearer moderation-token',
        'http.request.header.Cookie': 'vf_session=secret',
        'http.response.header.set_cookie': 'vf_session=new',
        'http.request.header.user-agent': 'test',
        'http.route': '/api/search',
      },
    })
    expect(span).toEqual({
      name: 'GET /api/search',
      attributes: {
        'url.full': 'https://vidflare.app/api/search',
        'http.request.header.authorization': FILTERED,
        'http.request.header.Cookie': FILTERED,
        'http.response.header.set_cookie': FILTERED,
        'http.request.header.user-agent': 'test',
        'http.route': '/api/search',
      },
    })
  })

  it('leaves an event without those parts alone', () => {
    const event: ScrubbableEvent & { message: string; tags: Record<string, string> } = {
      message: 'boom',
      tags: { route: '/api/videos/:id' },
    }
    expect(scrubSentryEvent(event)).toEqual({ message: 'boom', tags: { route: '/api/videos/:id' } })
  })
})
