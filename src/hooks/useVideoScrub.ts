import { useEffect, useRef, useState } from 'react'
import MP4Box, { type MP4Sample, type MP4Track } from 'mp4box'

const LERP_TAU = 8
const SNAP = 0.002
const LRU_MAX = 24
const LEAD = 24
const WATCHDOG = 60_000

type BankFrame = { ts: number; blob: Blob }

type DecoderTrack = MP4Track & {
  avcC?: { data?: ArrayBuffer | Uint8Array }
  hvcC?: { data?: ArrayBuffer | Uint8Array }
  vpcC?: { data?: ArrayBuffer | Uint8Array }
  av1C?: { data?: ArrayBuffer | Uint8Array }
  description?: ArrayBuffer | Uint8Array
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function findNearest(bank: BankFrame[], time: number) {
  const target = time * 1_000_000
  let low = 0
  let high = bank.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (bank[mid].ts < target) low = mid + 1
    else high = mid - 1
  }
  if (low === 0) return 0
  if (low >= bank.length) return bank.length - 1
  return target - bank[low - 1].ts < bank[low].ts - target ? low - 1 : low
}

function drawCover(context: CanvasRenderingContext2D, source: CanvasImageSource) {
  const canvas = context.canvas
  const width = source instanceof ImageBitmap ? source.width : canvas.width
  const height = source instanceof ImageBitmap ? source.height : canvas.height
  const scale = Math.max(canvas.width / width, canvas.height / height)
  const drawWidth = width * scale
  const drawHeight = height * scale
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight)
}

function configDescription(track: DecoderTrack): AllowSharedBufferSource | undefined {
  const raw = track.description ?? track.avcC?.data ?? track.hvcC?.data ?? track.vpcC?.data ?? track.av1C?.data
  if (!raw) return undefined
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw)
}

export function useVideoScrub(videoSrc: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bankRef = useRef<BankFrame[]>([])
  const lruRef = useRef(new Map<number, ImageBitmap | null>())
  const currentRef = useRef(0)
  const targetRef = useRef(0)
  const durationRef = useRef(0)
  const readyRef = useRef(false)
  const revertedRef = useRef(false)
  const paintedRef = useRef(false)
  const buildingRef = useRef(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [canvasLive, setCanvasLive] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onMetadata = () => {
      durationRef.current = Number.isFinite(video.duration) ? video.duration : 0
    }
    video.addEventListener('loadedmetadata', onMetadata)
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata()
    return () => video.removeEventListener('loadedmetadata', onMetadata)
  }, [videoSrc])

  useEffect(() => {
    let frameId = 0
    let previous = performance.now()
    const getProgress = () => {
      const container = containerRef.current
      if (!container) return 0
      const span = container.offsetHeight - window.innerHeight
      return clamp(span > 0 ? window.scrollY / span : 0, 0, 1)
    }

    const warm = (index: number) => {
      const bank = bankRef.current
      if (index < 0 || index >= bank.length || lruRef.current.has(index)) return
      lruRef.current.set(index, null)
      void createImageBitmap(bank[index].blob)
        .then((bitmap) => {
          lruRef.current.set(index, bitmap)
          while (lruRef.current.size > LRU_MAX) {
            const oldest = lruRef.current.keys().next().value as number | undefined
            if (oldest === undefined) break
            const evicted = lruRef.current.get(oldest)
            if (evicted) evicted.close()
            lruRef.current.delete(oldest)
          }
        })
        .catch(() => lruRef.current.set(index, null))
    }

    const render = (now: number) => {
      const dt = Math.min(0.1, (now - previous) / 1000)
      previous = now
      const progress = getProgress()
      setScrollProgress(progress)
      const duration = durationRef.current
      if (duration > 0) targetRef.current = progress * duration
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduced) currentRef.current = targetRef.current
      else currentRef.current += (targetRef.current - currentRef.current) * (1 - Math.exp(-dt * LERP_TAU))
      if (Math.abs(targetRef.current - currentRef.current) < SNAP) currentRef.current = targetRef.current

      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (readyRef.current && context && bankRef.current.length) {
        const index = findNearest(bankRef.current, currentRef.current)
        for (const offset of [-1, 0, 1, 2]) warm(index + offset)
        const frame = lruRef.current.get(index)
        if (frame) {
          drawCover(context, frame)
          if (!paintedRef.current) {
            paintedRef.current = true
            setCanvasLive(true)
          }
        }
      } else {
        const media = videoRef.current
        if (media && !media.seeking && Math.abs(media.currentTime - currentRef.current) > 0.01) {
          media.currentTime = currentRef.current
        }
      }
      frameId = requestAnimationFrame(render)
    }
    frameId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frameId)
  }, [])

  useEffect(() => {
    const aborter = new AbortController()
    let watchdog = 0
    let decoder: VideoDecoder | undefined
    let disposed = false

    const revert = () => {
      revertedRef.current = true
      readyRef.current = false
      setCanvasLive(false)
      if (decoder?.state !== 'closed') decoder?.close()
    }

    const encodeFrame = (frame: VideoFrame) => {
      const width = frame.displayWidth || frame.codedWidth
      const height = frame.displayHeight || frame.codedHeight
      const offscreen = document.createElement('canvas')
      offscreen.width = width
      offscreen.height = height
      offscreen.getContext('2d')?.drawImage(frame, 0, 0, width, height)
      const timestamp = frame.timestamp
      frame.close()
      return new Promise<void>((resolve) => {
        offscreen.toBlob((blob) => {
          if (blob && !disposed) bankRef.current.push({ ts: timestamp, blob })
          resolve()
        }, 'image/webp', 0.82)
      })
    }

    const build = async () => {
      if (buildingRef.current || 'VideoDecoder' in window === false) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      buildingRef.current = true
      try {
        const response = await fetch(videoSrc, { signal: aborter.signal })
        if (!response.ok) throw new Error(`Video fetch failed (${response.status})`)
        const buffer = await response.arrayBuffer()
        const file = MP4Box.createFile()
        const samples: MP4Sample[] = []
        let track: DecoderTrack | undefined
        let pendingFrames = 0
        let decodingDone = false

        const finishWhenEncoded = () => {
          if (!decodingDone || pendingFrames) return
          bankRef.current.sort((a, b) => a.ts - b.ts)
          readyRef.current = bankRef.current.length > 0
          if (!readyRef.current) revert()
          window.clearTimeout(watchdog)
        }

        const pump = () => {
          if (!decoder || !track || disposed) return
          while (samples.length && decoder.decodeQueueSize + pendingFrames < LEAD) {
            const sample = samples.shift()!
            decoder.decode(
              new EncodedVideoChunk({
                type: sample.is_sync ? 'key' : 'delta',
                timestamp: Math.round((sample.cts / track.timescale) * 1_000_000),
                duration: Math.round((sample.duration / track.timescale) * 1_000_000),
                data: sample.data,
              }),
            )
          }
          if (samples.length) {
            window.setTimeout(pump, 0)
          } else {
            void decoder.flush().then(() => {
              decodingDone = true
              finishWhenEncoded()
            })
          }
        }

        const configureDecoder = async (config: VideoDecoderConfig, software = false) => {
          decoder = new VideoDecoder({
            output: (frame) => {
              pendingFrames += 1
              void encodeFrame(frame).finally(() => {
                pendingFrames -= 1
                finishWhenEncoded()
                pump()
              })
            },
            error: () => {
              if (!software) {
                decoder?.close()
                void configureDecoder({ ...config, hardwareAcceleration: 'prefer-software' }, true)
              } else {
                revert()
              }
            },
          })
          const supported = await VideoDecoder.isConfigSupported(config)
          if (!supported.supported) throw new Error('Unsupported video codec')
          decoder.configure(config)
        }

        file.onReady = (info) => {
          const videoTrack = info.videoTracks[0]
          if (!videoTrack) {
            revert()
            return
          }
          track = videoTrack as DecoderTrack
          const config: VideoDecoderConfig = {
            codec: track.codec,
            codedWidth: track.video?.width ?? track.track_width,
            codedHeight: track.video?.height ?? track.track_height,
            description: configDescription(track),
            hardwareAcceleration: 'prefer-hardware',
          }
          void configureDecoder(config).then(() => {
            file.setExtractionOptions(track!.id, null, { nbSamples: 120 })
            file.start()
          }).catch(revert)
        }
        file.onSamples = (_id, _user, extracted) => {
          samples.push(...extracted)
          pump()
        }
        const source = buffer as ArrayBuffer & { fileStart?: number }
        source.fileStart = 0
        file.appendBuffer(source)
        file.flush()
      } catch {
        revert()
      } finally {
        buildingRef.current = false
      }
    }

    const onLoad = () => {
      watchdog = window.setTimeout(revert, WATCHDOG)
      void build()
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })

    return () => {
      disposed = true
      aborter.abort()
      window.clearTimeout(watchdog)
      window.removeEventListener('load', onLoad)
      if (decoder?.state !== 'closed') decoder?.close()
      lruRef.current.forEach((bitmap) => bitmap?.close())
      lruRef.current.clear()
    }
  }, [videoSrc])

  return { containerRef, videoRef, canvasRef, scrollProgress, canvasLive }
}
