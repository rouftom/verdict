import { describe, expect, test } from 'bun:test'
import { parseYouTubeUrl } from './youtube'

describe('parseYouTubeUrl', () => {
  test('accepts watch, youtu.be, shorts, embed and live URLs', () => {
    const expected = { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toEqual(expected)
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?si=abc')).toEqual(expected)
    expect(parseYouTubeUrl('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toEqual(expected)
    expect(parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual(expected)
    expect(parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toEqual(expected)
  })

  test('rejects other hosts, malformed ids and non-URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/123456')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(parseYouTubeUrl('https://youtu.be/')).toBeNull()
    expect(parseYouTubeUrl('not a url')).toBeNull()
  })
})
