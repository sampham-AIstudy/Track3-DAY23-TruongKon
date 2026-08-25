import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ChevronUp, Info, X } from 'lucide-react'
import { useVideoScrub } from '@/hooks/useVideoScrub'
import metricsArtifact from '../outputs/metrics.json'

const DARK = '#162C3D'
const ACCENT = '#2F657C'
const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260821_114821_a8ca298f-be2c-4613-a4dd-51b69e16bbde.mp4'

const navigation = ['ĐIỀU PHỐI', 'SƠ ĐỒ TRẠNG THÁI', 'ĐỊNH TUYẾN CÔNG CỤ', 'PHÊ DUYỆT', 'CHỈ SỐ']
const motion = 'opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)'

type ScenarioMetric = {
  scenario_id: string
  success: boolean
  expected_route: string
  actual_route: string | null
  retry_count: number
  approval_observed: boolean
}

type MetricsArtifact = {
  total_scenarios: number
  success_rate: number
  avg_nodes_visited: number
  total_retries: number
  total_interrupts: number
  scenario_metrics: ScenarioMetric[]
}

const metrics = metricsArtifact as MetricsArtifact

type WorkflowEvent = {
  node: string
  event_type: string
  message: string
}

type WorkflowResult = {
  thread_id: string
  route: string
  final_answer: string | null
  pending_question: string | null
  proposed_action: string | null
  approval: { approved: boolean; reviewer: string; comment: string } | null
  tool_results: string[]
  errors: string[]
  events: WorkflowEvent[]
}

type DemoCase = {
  label: string
  query: string
  max_attempts?: number
  approval?: { approved: boolean; reviewer: string; comment: string }
}

const demoCases: DemoCase[] = [
  { label: 'CÂU HỎI ĐƠN GIẢN', query: 'How do I reset my password?' },
  { label: 'GỌI CÔNG CỤ', query: 'Please lookup order status for order 12345' },
  { label: 'CẦN LÀM RÕ', query: 'Can you fix it?' },
  { label: 'RỦI RO / ĐỒNG Ý', query: 'Refund this customer and send confirmation email' },
  { label: 'THỬ LẠI / KHÔI PHỤC', query: 'Timeout failure while processing request' },
  { label: 'DEAD LETTER', query: 'System failure cannot recover after multiple attempts', max_attempts: 1 },
  {
    label: 'RỦI RO / TỪ CHỐI',
    query: 'Delete customer account after support verification',
    approval: { approved: false, reviewer: 'demo reviewer', comment: 'Need more information' },
  },
]

const routeLabels: Record<string, string> = {
  simple: 'Đơn giản',
  tool: 'Dùng công cụ',
  missing_info: 'Cần làm rõ',
  risky: 'Rủi ro',
  error: 'Lỗi',
  dead_letter: 'Dead letter',
}

const nodeLabels: Record<string, string> = {
  intake: 'Tiếp nhận',
  classify: 'Phân loại',
  tool: 'Công cụ',
  evaluate: 'Đánh giá',
  answer: 'Trả lời',
  clarify: 'Làm rõ',
  risky_action: 'Đề xuất',
  approval: 'Phê duyệt',
  retry: 'Thử lại',
  dead_letter: 'Dead letter',
  finalize: 'Kết thúc',
}

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
  const [auditOpen, setAuditOpen] = useState(false)
  const [navReady, setNavReady] = useState(false)
  const [workflowResult, setWorkflowResult] = useState<WorkflowResult | null>(null)
  const [activeDemo, setActiveDemo] = useState<string | null>(null)
  const [demoError, setDemoError] = useState<string | null>(null)
  const [customQuery, setCustomQuery] = useState('')
  const s1Opacity = scrollProgress < 0.2 ? 1 : Math.max(0, 1 - (scrollProgress - 0.2) / 0.08)
  const s2Opacity = sectionTwoOpacity(scrollProgress)
  const s3Opacity = sectionThreeOpacity(scrollProgress)
  const darkPhase = scrollProgress > 0.55
  const navColor = darkPhase ? '#ffffff' : DARK
  const navItems = useMemo(() => navigation, [])
  const scrollToProgress = (progress: number) => {
    const container = containerRef.current
    if (!container) return
    const span = container.offsetHeight - window.innerHeight
    window.scrollTo({ top: Math.max(0, span * progress), behavior: 'smooth' })
  }
  const activateNav = (index: number) => {
    if (index === 4) {
      setAuditOpen(true)
      return
    }
    scrollToProgress([0.04, 0.36, 0.46, 0.78][index] ?? 0.04)
    setMenuOpen(false)
  }
  const runDemo = async (demo: DemoCase) => {
    setActiveDemo(demo.label)
    setDemoError(null)
    setWorkflowResult(null)
    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: demo.query,
          max_attempts: demo.max_attempts,
          approval: demo.approval,
        }),
      })
      const payload = (await response.json()) as WorkflowResult & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Workflow request failed')
      setWorkflowResult(payload)
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : 'Unable to reach the local demo API')
    } finally {
      setActiveDemo(null)
    }
  }
  const runCustomDemo = () => {
    const query = customQuery.trim()
    if (query) void runDemo({ label: 'YÊU CẦU TÙY CHỈNH', query })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setNavReady(true), 200)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = menuOpen || auditOpen ? 'hidden' : previous
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen, auditOpen])

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

        <div className="absolute inset-0">
          <nav
            className="pointer-events-auto absolute z-50 flex w-full items-center justify-between px-6 pb-6 pt-8 sm:px-8 sm:pt-12 md:px-12"
            style={{ color: navColor, transition: 'color 500ms ease' }}
          >
            <div className="flex items-center gap-8 xl:gap-10">
              <button
                type="button"
                aria-label="Mở menu"
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
                    onClick={() => activateNav(index)}
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
              <button type="button" onClick={() => setAuditOpen(true)} className="text-xs font-medium tracking-[0.2em]">TRẠNG THÁI</button>
              <button type="button" aria-label="Mở nhật ký kiểm toán" onClick={() => setAuditOpen(true)} className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: navColor }}>
                <Info size={10} style={{ color: darkPhase ? DARK : '#ffffff' }} />
              </button>
              <button type="button" onClick={() => setMenuOpen(true)} className="text-xs font-medium tracking-[0.2em]">
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
                  ĐIỀU PHỐI HỖ TRỢ<br />
                  BẰNG TRẠNG THÁI THÔNG MINH
                </h1>
              </Revealed>
              <Revealed active={s1Opacity > 0.3} delay={150}>
                <p className="mt-6 text-sm tracking-[0.3em]" style={{ color: 'rgba(22,44,61,0.9)' }}>
                  TRẠNG THÁI CÓ KIỂU. QUYẾT ĐỊNH CÓ KIỂM SOÁT. KẾT QUẢ CÓ THỂ KIỂM TOÁN.
                </p>
              </Revealed>
              <Revealed active={s1Opacity > 0.3} delay={260}>
                <div className="mt-8 max-w-4xl border-y border-[#162C3D]/30 py-4 text-[10px] font-medium tracking-[0.12em] sm:text-xs">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-3" style={{ color: DARK }}>
                    <span className="border border-[#162C3D]/45 px-2.5 py-2">TIẾP NHẬN</span>
                    <ArrowRight size={13} className="opacity-60" />
                    <span className="border border-[#162C3D]/45 px-2.5 py-2">PHÂN LOẠI</span>
                    <ArrowRight size={13} className="opacity-60" />
                    <span className="border border-[#162C3D]/45 px-2.5 py-2">CÔNG CỤ</span>
                    <ArrowRight size={13} className="opacity-60" />
                    <span className="border border-[#162C3D]/45 px-2.5 py-2">ĐÁNH GIÁ</span>
                    <ArrowRight size={13} className="opacity-60" />
                    <span className="border border-[#162C3D]/45 px-2.5 py-2">TRẢ LỜI</span>
                    <ArrowRight size={13} className="opacity-60" />
                    <span className="border border-[#162C3D]/45 px-2.5 py-2">KẾT THÚC</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3 text-[#2F657C]">
                    <span>HÀNH ĐỘNG RỦI RO</span>
                    <ArrowRight size={13} />
                    <span className="border border-[#2F657C]/60 px-2.5 py-2">ĐỀ XUẤT</span>
                    <ArrowRight size={13} />
                    <span className="border border-[#2F657C]/60 px-2.5 py-2">PHÊ DUYỆT</span>
                    <ArrowRight size={13} />
                    <span>ĐỒNG Ý MỚI ĐƯỢC GỌI CÔNG CỤ</span>
                  </div>
                </div>
              </Revealed>
            </div>
            <Revealed active={s1Opacity > 0.3} delay={300}>
              <button
                type="button"
                aria-label="Khám phá điều phối"
                onClick={() => scrollToProgress(0.36)}
                className="absolute bottom-12 right-6 flex h-12 w-12 items-center justify-center rounded-full border transition-opacity hover:opacity-70 sm:right-8 md:right-12"
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
                MỌI YÊU CẦU ĐI QUA TRẠNG THÁI,<br />
                <span style={{ color: 'rgba(22,44,61,0.8)' }}>QUYẾT ĐỊNH</span>, CÔNG CỤ VÀ <span style={{ color: 'rgba(22,44,61,0.5)' }}>KHÔI PHỤC CÓ GIỚI HẠN</span>
              </h2>
            </Revealed>
            <div className="absolute bottom-16 right-6 flex flex-col items-center gap-4 sm:right-8 md:right-12" style={{ color: DARK }}>
              <Revealed active={s2Opacity > 0.3} delay={200}>
                <button type="button" onClick={() => scrollToProgress(0.75)} aria-label="Đi xuống" className="flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: 'rgba(22,44,61,0.4)' }}><ArrowDown size={18} /></button>
              </Revealed>
              <Revealed active={s2Opacity > 0.3} delay={350}>
                <div className="mt-4 flex flex-col items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: DARK }} /><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'rgba(22,44,61,0.4)' }} /><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'rgba(22,44,61,0.4)' }} /></div>
              </Revealed>
              <Revealed active={s2Opacity > 0.3} delay={500}>
                <button type="button" onClick={() => scrollToProgress(0.05)} aria-label="Đi lên" className="mt-2 flex h-10 w-10 items-center justify-center rounded-full border" style={{ borderColor: 'rgba(22,44,61,0.3)', color: 'rgba(22,44,61,0.8)' }}><ChevronUp size={16} /></button>
              </Revealed>
            </div>
          </section>

          <section
            className="absolute inset-0 flex items-center justify-end px-6 sm:px-8 md:px-20 lg:px-32"
            style={{ opacity: s3Opacity, transition: 'opacity 0.1s ease-out', pointerEvents: s3Opacity > 0.1 ? 'auto' : 'none' }}
          >
            <div className="max-w-2xl text-left">
              <Revealed active={s3Opacity > 0.3} delay={0}>
                <p className="mb-4 text-lg tracking-wide text-white/60">Con người phê duyệt | Khôi phục</p>
              </Revealed>
              <Revealed active={s3Opacity > 0.3} delay={150}>
                <h2 className="mb-8 font-light leading-[1.2] tracking-wide text-white" style={{ fontSize: 'clamp(2rem, 4vw, 4rem)' }}>
                  HÀNH ĐỘNG RỦI RO PHẢI CHỜ.<br />
                  KHÔI PHỤC LUÔN CÓ GIỚI HẠN.
                </h2>
              </Revealed>
              <Revealed active={s3Opacity > 0.3} delay={300}>
                <button type="button" onClick={() => setAuditOpen(true)} className="flex items-center gap-4 text-sm tracking-[0.3em] text-white/80">
                  KHÁM PHÁ NHẬT KÝ KIỂM TOÁN
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-800 transition-transform duration-300 hover:scale-110"><ArrowRight size={16} /></span>
                </button>
              </Revealed>
            </div>
          </section>
        </div>
      </div>

      <div className={`fixed inset-0 z-[100] bg-[#162C3D] text-white transition-all duration-500 ${menuOpen ? 'visible opacity-100' : 'invisible opacity-0'}`} style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}>
        <div className={`flex h-full flex-col transition-transform duration-500 ${menuOpen ? 'translate-y-0' : '-translate-y-8'}`} style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}>
          <div className="flex justify-end px-6 pt-8 sm:px-8 sm:pt-12"><button type="button" onClick={() => setMenuOpen(false)} aria-label="Đóng menu" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 transition-colors hover:border-white"><X size={18} /></button></div>
          <div className="flex flex-1 flex-col justify-center px-8 sm:px-12">
            {navItems.map((item, index) => <button key={item} type="button" onClick={() => activateNav(index)} className={`py-3 text-left text-2xl font-light tracking-wide transition-colors sm:text-3xl ${index === 0 ? 'text-white' : 'text-white/60 hover:text-white'}`} style={{ opacity: menuOpen ? 1 : 0, transform: menuOpen ? 'translateY(0)' : 'translateY(20px)', transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 60}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${index * 60}ms` }}>{item}</button>)}
          </div>
          <div className="flex gap-8 px-8 pb-10 text-xs tracking-[0.2em] text-white/60 sm:px-12"><span>KHÔI PHỤC</span><span>NHẬT KÝ KIỂM TOÁN</span></div>
        </div>
      </div>

      <div className={`fixed inset-0 z-[90] overflow-y-auto bg-[#162C3D] text-white transition-all duration-500 ${auditOpen ? 'visible opacity-100' : 'invisible opacity-0'}`} style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}>
        <div className={`min-h-full px-6 pb-12 pt-8 transition-transform duration-500 sm:px-8 sm:pt-12 md:px-12 lg:px-32 ${auditOpen ? 'translate-y-0' : '-translate-y-8'}`} style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}>
          <div className="flex items-start justify-between border-b border-white/20 pb-8">
            <div>
              <p className="text-xs tracking-[0.3em] text-white/60">LANGGRAPH AGENTIC ORCHESTRATION</p>
              <h2 className="mt-3 text-3xl font-light tracking-wide sm:text-5xl">NHẬT KÝ KIỂM TOÁN</h2>
            </div>
            <button type="button" onClick={() => setAuditOpen(false)} aria-label="Đóng nhật ký kiểm toán" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 transition-colors hover:border-white"><X size={18} /></button>
          </div>

          <section className="border-b border-white/20 py-10" aria-live="polite">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs tracking-[0.3em] text-white/50">DEMO WORKFLOW TRỰC TIẾP</p>
                <h3 className="mt-2 text-2xl font-light tracking-wide sm:text-3xl">CHẠY LANGGRAPH THẬT</h3>
              </div>
              <p className="max-w-xl text-sm leading-6 tracking-wide text-white/60">
                Chọn một luồng. Trình duyệt gọi API LangGraph cục bộ và hiển thị các event kiểm toán trả về.
              </p>
            </div>
            <div className="mt-7 grid gap-3 border-y border-white/15 py-5 text-xs tracking-[0.1em] text-white/70 md:grid-cols-2">
              <p><span className="text-white/40">BẮT ĐẦU · </span>Tiếp nhận → Phân loại</p>
              <p><span className="text-white/40">ĐƠN GIẢN · </span>Trả lời → Kết thúc</p>
              <p><span className="text-white/40">CÔNG CỤ · </span>Công cụ → Đánh giá → Trả lời</p>
              <p><span className="text-white/40">THIẾU THÔNG TIN · </span>Làm rõ → Kết thúc</p>
              <p><span className="text-white/40">RỦI RO · </span>Đề xuất → Phê duyệt → Công cụ hoặc Làm rõ</p>
              <p><span className="text-white/40">LỖI · </span>Thử lại có giới hạn → Dead letter → Kết thúc</p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              {demoCases.map((demo) => {
                const running = activeDemo === demo.label
                return (
                  <button
                    key={demo.label}
                    type="button"
                    disabled={activeDemo !== null}
                    onClick={() => void runDemo(demo)}
                    className="border border-white/30 px-4 py-3 text-xs tracking-[0.16em] transition-colors hover:border-white hover:bg-white hover:text-[#162C3D] disabled:cursor-wait disabled:opacity-50"
                  >
                    {running ? 'ĐANG CHẠY…' : demo.label}
                  </button>
                )
              })}
            </div>

            {demoError && (
              <p className="mt-6 border border-red-200/40 px-4 py-3 text-sm text-red-100">
                Không kết nối được API: {demoError}. Hãy chạy <code>npm run demo:api</code> rồi thử lại.
              </p>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
              <textarea
                value={customQuery}
                onChange={(event) => setCustomQuery(event.target.value)}
                placeholder="Nhập ticket của bạn, ví dụ: Hoàn tiền đơn hàng và gửi email xác nhận"
                className="min-h-12 w-full resize-y border border-white/30 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-white"
              />
              <button
                type="button"
                disabled={!customQuery.trim() || activeDemo !== null}
                onClick={runCustomDemo}
                className="border border-white/50 px-5 py-3 text-xs tracking-[0.16em] transition-colors hover:bg-white hover:text-[#162C3D] disabled:cursor-not-allowed disabled:opacity-40"
              >
                CHẠY YÊU CẦU
              </button>
            </div>

            {workflowResult && (
              <div className="mt-8 border border-white/20">
                <div className="flex flex-col gap-4 border-b border-white/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[10px] tracking-[0.2em] text-white/50">KẾT QUẢ TRỰC TIẾP</p>
                    <p className="mt-1 text-xl font-light tracking-wide">TUYẾN: {routeLabels[workflowResult.route] ?? workflowResult.route}</p>
                  </div>
                  <p className="text-xs tracking-[0.12em] text-white/50">{workflowResult.thread_id}</p>
                </div>

                <div className="grid gap-6 px-5 py-6 lg:grid-cols-[1.2fr_1fr]">
                  <div>
                    <p className="text-[10px] tracking-[0.2em] text-white/50">DẤU VẾT SỰ KIỆN</p>
                    <ol className="mt-4 flex flex-wrap gap-2">
                      {workflowResult.events.map((event, index) => (
                        <li key={`${event.node}-${index}`} className="flex items-center gap-2 text-xs tracking-[0.12em]">
                          <span className="border border-white/30 px-2 py-1.5">{nodeLabels[event.node] ?? event.node}</span>
                          {index < workflowResult.events.length - 1 && <ArrowRight size={12} className="text-white/40" />}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-5 text-sm leading-7 text-white/75">
                      {workflowResult.final_answer ?? workflowResult.pending_question ?? 'Workflow đã hoàn thành nhưng chưa có thông điệp kết thúc.'}
                    </p>
                  </div>
                  <div className="space-y-4 text-sm leading-6 text-white/70">
                    {workflowResult.proposed_action && <p><span className="text-white/40">ĐỀ XUẤT · </span>{workflowResult.proposed_action}</p>}
                    {workflowResult.approval && <p><span className="text-white/40">PHÊ DUYỆT · </span>{workflowResult.approval.approved ? 'ĐỒNG Ý' : 'TỪ CHỐI'} — {workflowResult.approval.reviewer}</p>}
                    {workflowResult.tool_results.length > 0 && <p><span className="text-white/40">CÔNG CỤ · </span>{workflowResult.tool_results.join(' | ')}</p>}
                    {workflowResult.errors.length > 0 && <p><span className="text-white/40">LỖI KIỂM TOÁN · </span>{workflowResult.errors.join(' | ')}</p>}
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-8 py-12 md:grid-cols-2">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-6 text-sm tracking-[0.15em] sm:grid-cols-3">
              <div><dt className="text-white/50">KỊCH BẢN</dt><dd className="mt-2 text-2xl font-light tracking-normal">{metrics.total_scenarios}</dd></div>
              <div><dt className="text-white/50">THÀNH CÔNG</dt><dd className="mt-2 text-2xl font-light tracking-normal">{(metrics.success_rate * 100).toFixed(0)}%</dd></div>
              <div><dt className="text-white/50">THỬ LẠI</dt><dd className="mt-2 text-2xl font-light tracking-normal">{metrics.total_retries}</dd></div>
              <div><dt className="text-white/50">PHÊ DUYỆT</dt><dd className="mt-2 text-2xl font-light tracking-normal">{metrics.total_interrupts}</dd></div>
              <div><dt className="text-white/50">NÚT TRUNG BÌNH</dt><dd className="mt-2 text-2xl font-light tracking-normal">{metrics.avg_nodes_visited.toFixed(1)}</dd></div>
            </dl>
            <p className="self-end text-sm leading-7 tracking-wide text-white/60">Số liệu được tạo bởi scenario runner của dự án. Tuyến phân loại, số lần thử lại, lượt phê duyệt và trạng thái kết thúc đều có thể kiểm toán.</p>
          </div>

          <div className="border-t border-white/20 pt-6">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_auto_auto] gap-3 border-b border-white/20 pb-4 text-[10px] tracking-[0.2em] text-white/50 sm:gap-6 sm:text-xs">
              <span>KỊCH BẢN</span><span>KỲ VỌNG</span><span>THỰC TẾ</span><span>THỬ LẠI</span><span>HITL</span>
            </div>
            {metrics.scenario_metrics.map((scenario) => (
              <div key={scenario.scenario_id} className="grid grid-cols-[1.2fr_1fr_1fr_auto_auto] gap-3 border-b border-white/10 py-5 text-xs tracking-[0.12em] sm:gap-6 sm:text-sm">
                <span className={scenario.success ? 'text-white' : 'text-red-200'}>{scenario.scenario_id}</span>
                <span className="text-white/60">{routeLabels[scenario.expected_route] ?? scenario.expected_route}</span>
                <span className="text-white">{scenario.actual_route ? (routeLabels[scenario.actual_route] ?? scenario.actual_route) : 'chưa xác định'}</span>
                <span className="text-white/60">{scenario.retry_count}</span>
                <span className={scenario.approval_observed ? 'text-white' : 'text-white/40'}>{scenario.approval_observed ? 'ĐÃ GẶP' : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}

export default App
