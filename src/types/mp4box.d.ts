declare module 'mp4box' {
  export interface MP4Sample {
    cts: number
    duration: number
    is_sync: boolean
    data: Uint8Array
  }

  export interface MP4Track {
    id: number
    codec: string
    timescale: number
    video?: { width: number; height: number }
    track_width?: number
    track_height?: number
  }

  export interface MP4File {
    onReady: ((info: { videoTracks: MP4Track[] }) => void) | null
    onSamples: ((id: number, user: unknown, samples: MP4Sample[]) => void) | null
    appendBuffer(buffer: ArrayBuffer & { fileStart?: number }): number
    setExtractionOptions(id: number, user: unknown, options: { nbSamples: number }): void
    start(): void
    flush(): void
    getTrackById?(id: number): unknown
  }

  const MP4Box: {
    createFile(): MP4File
  }

  export default MP4Box
}
