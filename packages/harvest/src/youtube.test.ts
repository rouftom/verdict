import { describe, expect, test } from 'bun:test'
import { chooseDownloadFormat, parseYouTubeUrl, type YtdlpFormat } from './youtube'

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

describe('chooseDownloadFormat', () => {
  const format = (value: YtdlpFormat): YtdlpFormat => value
  // A YouTube catalogue where 18 is the muxed 360p mp4, 134/243 are
  // video-only 360p, 140/251 are audio-only and 137 is video-only 1080p.
  const catalogue: YtdlpFormat[] = [
    format({ format_id: '137', ext: 'mp4', height: 1080, vcodec: 'avc1.640028', acodec: 'none', tbr: 4000 }),
    format({ format_id: '18', ext: 'mp4', height: 360, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', tbr: 700 }),
    format({ format_id: '134', ext: 'mp4', height: 360, vcodec: 'avc1.4d401e', acodec: 'none', tbr: 600 }),
    format({ format_id: '243', ext: 'webm', height: 360, vcodec: 'vp9', acodec: 'none', tbr: 400 }),
    format({ format_id: '396', ext: 'mp4', height: 360, vcodec: 'av01.0.01M.08', acodec: 'none', tbr: 213 }),
    format({ format_id: '140', ext: 'm4a', height: 0, vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 }),
    format({ format_id: '251', ext: 'webm', height: 0, vcodec: 'none', acodec: 'opus', abr: 160 }),
  ]

  test('prefers one muxed stream at or under the cap', () => {
    expect(chooseDownloadFormat(catalogue, 360)).toEqual({ selector: '18', merge: false, reason: 'muxed 360p' })
  })

  test('falls back to video plus audio when no muxed stream fits', () => {
    const split = catalogue.filter((entry) => entry.format_id !== '18')
    expect(chooseDownloadFormat(split, 360)).toEqual({ selector: '134+140', merge: true, reason: '360p video plus audio' })
  })

  test('follows the cap when only lower renditions are left', () => {
    const low = [
      format({ format_id: '18', ext: 'mp4', height: 360, vcodec: 'avc1', acodec: 'mp4a' }),
      format({ format_id: '133', ext: 'mp4', height: 240, vcodec: 'avc1', acodec: 'none' }),
      format({ format_id: '140', ext: 'm4a', height: 0, vcodec: 'none', acodec: 'mp4a', abr: 128 }),
    ]
    expect(chooseDownloadFormat(low, 240).selector).toBe('133+140')
  })

  test('takes the smallest stream above the cap instead of failing', () => {
    const high = catalogue.filter((entry) => ['137', '140'].includes(entry.format_id ?? ''))
    expect(chooseDownloadFormat(high, 360)).toEqual({ selector: '137+140', merge: true, reason: '1080p video plus audio' })
  })

  test('prefers a direct stream over HLS and skips loudness variants', () => {
    const formats = [
      format({ format_id: '160', ext: 'mp4', height: 360, vcodec: 'avc1.4D401E', acodec: 'none', tbr: 56, protocol: 'm3u8_native' }),
      format({ format_id: '134', ext: 'mp4', height: 360, vcodec: 'avc1.4D401E', acodec: 'none', tbr: 207, protocol: 'https' }),
      format({ format_id: '140-drc', ext: 'm4a', height: 0, vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, protocol: 'https' }),
      format({ format_id: '140', ext: 'm4a', height: 0, vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, protocol: 'https' }),
    ]
    expect(chooseDownloadFormat(formats, 360)).toEqual({
      selector: '134+140',
      merge: true,
      reason: '360p video plus audio',
    })
  })

  test('ignores storyboards and falls back without a media list', () => {
    const storyboard = [format({ format_id: 'sb0', ext: 'mhtml', protocol: 'mhtml', vcodec: 'none', acodec: 'none' })]
    expect(chooseDownloadFormat(storyboard, 360)).toEqual({
      selector: 'bv*[height<=360]+ba/b[height<=360]/bv*+ba/b',
      merge: true,
      reason: 'no format list',
    })
    expect(chooseDownloadFormat(undefined, 360).selector).toBe('bv*[height<=360]+ba/b[height<=360]/bv*+ba/b')
  })
})
