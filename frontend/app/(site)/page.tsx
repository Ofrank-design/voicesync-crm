import Link from "next/link";
import { ArrowRight, AudioLines, Brain, Clock, Database, FileText, Lock, LockKeyhole, Mic, ShieldCheck, Sparkles, Target, TrendingUp, Zap, Layers } from "lucide-react";

const features = [
  { icon: Mic, bg: "linear-gradient(135deg,#3b5bff,#6a6cff)", title: "Voice Recording", text: "Capture your thoughts instantly with a simple voice note." },
  { icon: Sparkles, bg: "linear-gradient(135deg,#7c3aed,#a855f7)", title: "AI Transcription", text: "Turn speech into accurate, editable text you can review." },
  { icon: Brain, bg: "linear-gradient(135deg,#15a05a,#34c37a)", title: "Smart Extraction", text: "AI turns your notes into clear CRM tasks using strict validation." },
  { icon: ShieldCheck, bg: "linear-gradient(135deg,#1f6bff,#2d8bff)", title: "Secure & Private", text: "Every account sees only its own tasks, and your keys stay on the server." },
  { icon: Database, bg: "linear-gradient(135deg,#f59e0b,#fb8a3c)", title: "Organized CRM", text: "Tasks are saved to your Kanban board and your own database." },
  { icon: Zap, bg: "linear-gradient(135deg,#6d4aff,#9061ff)", title: "Stay Productive", text: "Focus on what matters while VoiceSync handles the rest." },
];
const steps = [
  { icon: Mic, title: "1. Record", text: "Speak naturally. Capture your note with your microphone." },
  { icon: AudioLines, title: "2. AI Processes", text: "Your note is turned into text and the task details are picked out." },
  { icon: FileText, title: "3. Review", text: "Check and edit the extracted task before saving." },
  { icon: ShieldCheck, title: "4. Save & Track", text: "Your task is added to your CRM and appears on your Kanban board." },
];
const reasons = [
  { icon: Clock, title: "Save Time", text: "Turn minutes of talking into organized tasks." },
  { icon: Target, title: "Never Miss a Follow Up", text: "Overdue tasks stand out, so nothing slips." },
  { icon: TrendingUp, title: "Higher Productivity", text: "Focus on conversations, not note taking." },
  { icon: ShieldCheck, title: "Accurate & Reliable", text: "AI powered, with strict validation rules and your review." },
  { icon: LockKeyhole, title: "Private by Design", text: "Each account only ever sees its own tasks." },
  { icon: Layers, title: "Flexible Setup", text: "Choose the AI providers that suit your business." },
];

export default function Landing() {
  return (
    <div className="lp">
      <section className="hero on-navy" aria-label="Introduction">
        <picture className="hero-bg">
          <source media="(min-width: 48rem)" srcSet="/images/hero-bg.jpg" width={2560} height={1400} />
          <img src="/images/hero-mobile.jpg" width={800} height={1000} alt="" fetchPriority="high" />
        </picture>

        <header className="site-header">
          <div className="wrap bar">
            <a href="/" aria-label="VoiceSync CRM home"><img className="logo-h" src="/logo.png" alt="VoiceSync CRM" width={216} height={36} /></a>
            <nav aria-label="Main" className="nav-links"><a href="/" aria-current="page">Home</a><a href="#features">Features</a><a href="#how">How It Works</a><a href="#why">Why VoiceSync</a></nav>
            <div className="actions"><Link href="/login" className="btn btn-signin hide-xs">Sign In</Link><Link href="/dashboard" className="btn btn-primary">Get Started</Link></div>
          </div>
        </header>

        <main id="main">
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <p className="pill"><span>AI Powered</span><i aria-hidden="true" /><span>Voice to Task</span><i aria-hidden="true" /><span>CRM</span></p>
              <h1>Turn Your Voice <span className="grad">Into Actionable</span> CRM Tasks</h1>
              <p className="lead">Record voice notes, let AI do the heavy lifting, and get structured, reviewable CRM tasks. VoiceSync CRM turns your conversations into organized follow ups, so you never miss an opportunity.</p>
              <div className="cta-row">
                <Link href="/dashboard" className="btn btn-primary"><Mic size={18} aria-hidden="true" />Start Recording<ArrowRight size={16} aria-hidden="true" /></Link>
                <a href="#how" className="btn btn-outline">See How It Works</a>
              </div>
              <p className="trust"><span><AudioLines size={18} aria-hidden="true" />AI Transcription</span><span><Sparkles size={18} aria-hidden="true" />Smart Extraction</span><span><Lock size={18} aria-hidden="true" />Private to Your Account</span></p>
            </div>
          </div>
        </main>
      </section>

      <section id="features" aria-labelledby="f-h" className="block">
        <div className="wrap">
          <div className="center">
            <p className="eyebrow">Powerful Features</p>
            <h2 id="f-h" className="title">More Than Just a Recorder</h2>
            <p className="muted">VoiceSync CRM combines advanced AI with an intuitive interface to give you a complete voice to task solution. From recording to follow up, everything is designed to save you time and keep you organized.</p>
          </div>
          <div className="feat-grid">
            {features.map(({ icon: Icon, bg, title, text }) => (
              <div key={title} className="feat"><span className="tile" style={{ background: bg }}><Icon size={28} aria-hidden="true" /></span><h3>{title}</h3><p className="muted">{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="h-h" className="block" style={{ background: "var(--lp-alt)" }}>
        <div className="wrap proc">
          <div>
            <p className="eyebrow">Simple 4 Step Process</p>
            <h2 id="h-h" className="title">From Voice Note to CRM Task in Minutes</h2>
            <p className="muted">A seamless workflow that turns your spoken ideas into structured, actionable tasks.</p>
            <div style={{ marginTop: "1.6rem" }}><Link href="/dashboard" className="btn btn-primary">Get Started<ArrowRight size={16} aria-hidden="true" /></Link></div>
          </div>
          <ol className="steps">
            {steps.map(({ icon: Icon, title, text }) => (<li key={title}><span className="step-ic"><Icon size={30} aria-hidden="true" /></span><h3>{title}</h3><p className="muted">{text}</p></li>))}
          </ol>
        </div>
      </section>

      <section id="why" aria-labelledby="w-h" className="block why on-navy">
        <div className="wrap why-grid">
          <div>
            <p className="eyebrow" style={{ color: "#8db4ff" }}>Why Choose VoiceSync CRM</p>
            <h2 id="w-h" className="title">Built for Professionals Who Get Things Done</h2>
            <p className="muted">Whether you are a solo entrepreneur, a sales professional, or a business owner, VoiceSync CRM helps you capture opportunities, follow up faster, and close more deals.</p>
            <div style={{ marginTop: "1.6rem" }}><Link href="/dashboard" className="btn btn-primary">Get Started<ArrowRight size={16} aria-hidden="true" /></Link></div>
          </div>
          <div className="why-cards">
            {reasons.map(({ icon: Icon, title, text }) => (<div key={title} className="why-card"><Icon size={30} strokeWidth={1.6} aria-hidden="true" /><h3>{title}</h3><p>{text}</p></div>))}
          </div>
        </div>
      </section>

      <footer className="foot on-navy">
        <img className="foot-bg" src="/images/footer-wave.jpg" width={1920} height={720} alt="" />
        <div className="wrap">
          <img className="logo-f" src="/logo.png" alt="VoiceSync CRM" width={216} height={36} />
          <p className="tagline">Your voice. Your tasks. Your success.</p>
          <Link href="/dashboard" className="btn btn-primary">Get Started Today<ArrowRight size={16} aria-hidden="true" /></Link>
          <p style={{ marginTop: "2rem", fontSize: ".85rem" }}><Link href="/privacy" style={{ textDecoration: "underline" }}>Privacy</Link></p>
        </div>
      </footer>
    </div>
  );
}
