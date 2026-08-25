import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ChevronUp, Info, X } from 'lucide-react'
import { useVideoScrub } from '@/hooks/useVideoScrub'

const DARK = '#162C3D'
const ACCENT = '#2F657C'
const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260821_114821_a8ca298f-be2c-4613-a4dd-51b69e16bbde.mp4'

const navigation = ['ORCHESTRATION', 'STATE GRAPH', 'TOOL ROUTING', 'HUMAN APPROVAL', 'METRICS']
const motion = 'opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)'

function sectionTwoOpacity(progress: number) {
  if (progress < 0.32) return 0
  if (progress < 0.4) return (progress - 0.32) / 0.08
  if (progress < 0.55) return 1
  return Math.max(0, 1 - (progress - 0.55) / 0.08)
}

function sectionThreeOpacity(progress: number) {
  if (progress < 0.67) return 0
  if (progress < 0.75) return (progress - 0.67) / 0.08
  return 1
}

function Revealed({ active, delay, children }: { active: boolean; delay: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        opacity: active ? 1 : 0,
        transform: active ? 'translateY(0)' : 'translateY(24px)',
        transition: motion,
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

function App() {
  const { containerRef, videoRef, canvasRef, scrollProgress, canvasLive } = useVideoScrub(VIDEO_SRC)
  const [menuOpen, setMenuOpen] = useState(false)
  const [navReady, setNavReady] = useState(false)
  const s1Opacity = scrollProgress < 0.2 ? 1 : Math.max(0, 1 - (scrollProgress - 0.2) / 0.08)
  const s2Opacity = sectionTwoOpacity(scrollProgress)
  const s3Opacity = sectionThreeOpacity(scrollProgress)
  const darkPhase = scrollProgress > 0.55
  const navColor = darkPhase ? '#ffffff' : DARK
  const navItems = useMemo(() => navigation, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setNavReady(true), 200)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = menuOpen ? 'hidden' : previous
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  return (
    <main ref={containerRef} className="relative h-[500vh]">
      <div className="sticky top-0 h-screen w-full overflow-hidden">
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          preload="auto"
        />
        <canvas
          ref={canvasRef}
          width={1920}
          height={1080}
          className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: canvasLive ? 1 : 0 }}
        />

        <div className="pointer-events-none absolute inset-0">
          <nav
            className="pointer-events-auto absolute z-50 flex w-full items-center justify-between px-6 pb-6 pt-8 sm:px-8 sm:pt-12 md:px-12"
            style={{ color: navColor, transition: 'color 500ms ease' }}
          >
            <div className="flex items-center gap-8 xl:gap-10">
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setMenuOpen(true)}
                className="flex flex-col gap-[5px] lg:hidden"
              >
                <span className="h-[2px] w-6" style={{ backgroundColor: navColor }} />
                <span className="h-[2px] w-6" style={{ backgroundColor: navColor }} />
                <span className="h-[2px] w-4" style={{ backgroundColor: navColor }} />
              </button>
              <div className="hidden items-center gap-8 lg:flex xl:gap-10">
                {navItems.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    className="relative text-xs font-medium tracking-[0.15em] transition-opacity hover:opacity-70"
                    style={{
                      opacity: navReady ? 1 : 0,
                      transform: navReady ? 'translateY(0)' : 'translateY(-12px)',
                      transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 80 + 100}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 80 + 100}ms`,
                    }}
                  >
                    {item}
                    {index === 0 && (
                      <span className="absolute -bottom-3 left-0 h-[2px] w-full" style={{ backgroundColor: ACCENT }} />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="hidden items-center gap-5 sm:flex"
              style={{
                opacity: navReady ? 1 : 0,
                transform: navReady ? 'translateY(0)' : 'translateY(-12px)',
                transition: 'opacity 0.6s cubic-bezier(0.16,1,0.3,1) 500ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) 500ms',
              }}
            >
              <span className="text-xs font-medium tracking-[0.2em]">STATUS</span>
              <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: navColor }}>
                <Info size={10} style={{ color: darkPhase ? DARK : '#ffffff' }} />
              </span>
              <button type="button" onClick={() => setMenuOpen(true)} className="text-xs font-medium tracking-[0.2em] lg:pointer-events-none">
                MENU
              </button>
            </div>
          </nav>

          <section
            className="absolute inset-0 flex items-center px-6 sm:px-8 md:px-20 lg:px-32"
            style={{ opacity: s1Opacity, transition: 'opacity 0.1s ease-out', pointerEvents: s1Opacity > 0.1 ? 'auto' : 'none' }}
          >
            <div style={{ color: DARK }}>
              <Revealed active={s1Opacity > 0.3} delay={0}>
                <h1 className="font-light leading-[1.2] tracking-wide" style={{ fontSize: 'clamp(2rem, 5vw, 5rem)' }}>
                  ORCHESTRATING SUPPORT<br />
                  WITH INTELLIGENT STATE
                </h1>
              </Revealed>
              <Revealed active={s1Opacity > 0.3} delay={150}>
                <p className="mt-6 text-sm tracking-[0.3em]" style={{ color: 'rgba(22,44,61,0.9)' }}>
                  TYPED STATE. CONTROLLED DECISIONS. AUDITABLE OUTCOMES.
                </p>
              </Revealed>
            </div>
            <Revealed active={s1Opacity > 0.3} delay={300}>
              <button
                type="button"
                aria-label="Explore orchestration"
                className="pointer-events-auto absolute bottom-12 right-6 flex h-12 w-12 items-center justify-center rounded-full border transition-opacity hover:opacity-70 sm:right-8 md:right-12"
                style={{ borderColor: 'rgba(22,44,61,0.5)', color: DARK }}
              >
                <ArrowRight size={18} />
              </button>
            </Revealed>
          </section>

          <section
            className="absolute inset-0 flex items-center justify-center px-6 sm:px-8"
            style={{ opacity: s2Opacity, transition: 'opacity 0.1s ease-out', pointerEvents: s2Opacity > 0.1 ? 'auto' : 'none' }}
          >
            <Revealed active={s2Opacity > 0.3} delay={0}>
              <h2 className="max-w-[980px] text-center font-extralight leading-[1.3] tracking-wide" style={{ color: DARK, fontSize: 'clamp(1.5rem, 4.5vw, 4.5rem)' }}>
                EVERY REQUEST MOVES THROUGH STATE,<br />
                <span style={{ color: 'rgba(22,44,61,0.8)' }}>DECISIONS</span>, TOOLS AND <span style={{ color: 'rgba(22,44,61,0.5)' }}>BOUNDED RECOVERY</span>
              </h2>
            </Revealed>
            <div className="absolute bottom-16 right-6 flex flex-col items-center gap-4 sm:right-8 md:right-12" style={{ color: DARK }}>
              <Revealed active={s2Opacity > 0.3} delay={200}>
                <button type="button" aria-label="Move down" className="flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: 'rgba(22,44,61,0.4)' }}><ArrowDown size={18} /></button>
              </Revealed>
              <Revealed active={s2Opacity > 0.3} delay={350}>
                <div className="mt-4 flex flex-col items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: DARK }} /><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'rgba(22,44,61,0.4)' }} /><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'rgba(22,44,61,0.4)' }} /></div>
              </Revealed>
              <Revealed active={s2Opacity > 0.3} delay={500}>
                <button type="button" aria-label="Move up" className="mt-2 flex h-10 w-10 items-center justify-center rounded-full border" style={{ borderColor: 'rgba(22,44,61,0.3)', color: 'rgba(22,44,61,0.8)' }}><ChevronUp size={16} /></button>
              </Revealed>
            </div>
          </section>

          <section
            className="absolute inset-0 flex items-center justify-end px-6 sm:px-8 md:px-20 lg:px-32"
            style={{ opacity: s3Opacity, transition: 'opacity 0.1s ease-out', pointerEvents: s3Opacity > 0.1 ? 'auto' : 'none' }}
          >
            <div className="max-w-2xl text-left">
              <Revealed active={s3Opacity > 0.3} delay={0}>
                <p className="mb-4 text-lg tracking-wide text-white/60">Human-in-the-loop | Recovery</p>
              </Revealed>
              <Revealed active={s3Opacity > 0.3} delay={150}>
                <h2 className="mb-8 font-light leading-[1.2] tracking-wide text-white" style={{ fontSize: 'clamp(2rem, 4vw, 4rem)' }}>
                  RISKY ACTIONS WAIT.<br />
                  RECOVERY STAYS BOUNDED.
                </h2>
              </Revealed>
              <Revealed active={s3Opacity > 0.3} delay={300}>
                <button type="button" className="pointer-events-auto flex items-center gap-4 text-sm tracking-[0.3em] text-white/80">
                  EXPLORE THE AUDIT TRAIL
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-800 transition-transform duration-300 hover:scale-110"><ArrowRight size={16} /></span>
                </button>
              </Revealed>
            </div>
          </section>
        </div>
      </div>

      <div className={`fixed inset-0 z-[100] bg-[#162C3D] text-white transition-all duration-500 ${menuOpen ? 'visible opacity-100' : 'invisible opacity-0'}`} style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}>
        <div className={`flex h-full flex-col transition-transform duration-500 ${menuOpen ? 'translate-y-0' : '-translate-y-8'}`} style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}>
          <div className="flex justify-end px-6 pt-8 sm:px-8 sm:pt-12"><button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 transition-colors hover:border-white"><X size={18} /></button></div>
          <div className="flex flex-1 flex-col justify-center px-8 sm:px-12">
            {navItems.map((item, index) => <button key={item} type="button" onClick={() => setMenuOpen(false)} className={`py-3 text-left text-2xl font-light tracking-wide transition-colors sm:text-3xl ${index === 0 ? 'text-white' : 'text-white/60 hover:text-white'}`} style={{ opacity: menuOpen ? 1 : 0, transform: menuOpen ? 'translateY(0)' : 'translateY(20px)', transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 60}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 60}ms` }}>{item}</button>)}
          </div>
          <div className="flex gap-8 px-8 pb-10 text-xs tracking-[0.2em] text-white/60 sm:px-12"><span>RECOVERY</span><span>AUDIT TRAIL</span></div>
        </div>
      </div>
    </main>
  )
}

export default App
