import { useEffect, useRef, useState } from "react";
import { isBuyerAccessPublicCtaEnabled } from "../lib/buyerAccessConfig";
import { PRODUCT_COMPANY, PRODUCT_FULL_NAME } from "../lib/productIdentity";
import "../landing.css";

const BUYER_ACCESS_PUBLIC_CTA_ENABLED = isBuyerAccessPublicCtaEnabled(import.meta.env);
const COMMERCIAL_VIDEO = {
  src: "/videos/quote-pilot-commercial.mp4",
  poster: "/videos/quote-pilot-commercial-poster.webp",
  track: "/videos/quote-pilot-commercial-captions.vtt",
  title: "QuotePilot commercial"
};
const COMMERCIAL_VIDEO_EVENTS = {
  cta_click: "landing_video_cta",
  play_error: "landing_video_error",
  play: "landing_video_play",
  pause: "landing_video_pause",
  ended: "landing_video_complete"
};

const changeImpact = [
  { label: "Guests", before: "165", after: "175" },
  { label: "Proposal", before: "$18,420", after: "$19,475" },
  { label: "Margin", before: "38.2%", after: "37.0%" },
  { label: "Staff required", before: "11", after: "12" }
];

const outcomeStrip = [
  {
    title: "Your attention, protected",
    detail: "Keep the details together so your mind does not have to hold every loose end."
  },
  {
    title: "Complexity, carried",
    detail: "Let one change move through pricing, staffing, and preparation without another round of manual work."
  },
  {
    title: "Time, returned",
    detail: "Spend less of the day reconstructing what happened and more of it moving the business forward."
  }
];

const workflow = [
  {
    title: "Capture the event",
    copy: "Turn the inquiry into a structured event brief your team can actually use."
  },
  {
    title: "Build the offer",
    copy: "Configure packages, menus, staffing, rentals, taxes, and terms in one guided workspace."
  },
  {
    title: "Review the numbers",
    copy: "See the pricing breakdown and compare Good, Better, and Best options before anything is sent."
  },
  {
    title: "Share the proposal",
    copy: "Give the customer a focused portal to accept, decline, or request a change."
  },
  {
    title: "Prepare the handoff",
    copy: "Carry the approved scope forward while payment, booking, and readiness remain separate states."
  }
];

const operations = [
  {
    title: "The next conversation",
    copy: "Know who needs an answer and what that answer must account for."
  },
  {
    title: "The day ahead",
    copy: "See what is settled, what is approaching, and what still needs care."
  },
  {
    title: "The people",
    copy: "Give the team the context to arrive prepared instead of chasing updates."
  },
  {
    title: "The handoff",
    copy: "Carry the promise made in the quote into the work required on event day."
  }
];

function BrandLockup() {
  return (
    <span className="qp-landing-brand-lockup" aria-label={PRODUCT_FULL_NAME}>
      <img src="/brand/quotepilot-mark.svg" alt="" width="44" height="44" />
      <span>
        <strong>QuotePilot</strong>
        <small>by {PRODUCT_COMPANY}</small>
      </span>
    </span>
  );
}

export default function MarketingPage() {
  const marketingCommercialRef = useRef(null);
  const [commercialStarted, setCommercialStarted] = useState(false);
  const [commercialPlaying, setCommercialPlaying] = useState(false);
  const [commercialMuted, setCommercialMuted] = useState(true);

  const emitMarketingVideoEvent = (type, detail = {}) => {
    if (typeof window === "undefined") return;
    const video = marketingCommercialRef.current;
    const currentSeconds = Number((video?.currentTime || 0).toFixed(1));
    const durationSeconds = Number((video?.duration || 0).toFixed(1));
    const percentComplete = durationSeconds > 0
      ? Number(((currentSeconds / durationSeconds) * 100).toFixed(1))
      : undefined;
    const normalized = {
      event: "quotepilot_landing_video",
      section: "commercial",
      videoName: COMMERCIAL_VIDEO.title,
      videoSrc: COMMERCIAL_VIDEO.src,
      eventType: type,
      currentSeconds,
      durationSeconds,
      ...detail
    };

    if (percentComplete !== undefined) {
      normalized.percentComplete = percentComplete;
    }

    if (window.dataLayer?.push) {
      window.dataLayer.push(normalized);
    }
    if (typeof window.gtag === "function") {
      const mappedEvent = COMMERCIAL_VIDEO_EVENTS[type] || "landing_video_interaction";
      const gtagPayload = {
        event_category: "marketing",
        event_label: normalized.videoName,
        interaction_type: type,
        ...normalized
      };
      window.gtag("event", mappedEvent, gtagPayload);
    }
    window.dispatchEvent(
      new CustomEvent("quotepilot-marketing-video", {
        detail: normalized
      })
    );
  };

  const handleCommercialPlay = () => {
    const video = marketingCommercialRef.current;
    if (!video) return;

    if (video.paused) {
      emitMarketingVideoEvent("cta_click", { element: "commercial_play_overlay", action: "play" });
      video.play().catch(() => {
        emitMarketingVideoEvent("play_error", { element: "commercial_play_overlay" });
      });
    } else {
      emitMarketingVideoEvent("cta_click", { element: "commercial_play_overlay", action: "pause" });
      video.pause();
    }
  };

  const handleCommercialEnded = () => {
    setCommercialPlaying(false);
    emitMarketingVideoEvent("ended", {
      watchedSeconds: Number((marketingCommercialRef.current?.currentTime || 0).toFixed(1))
    });
  };

  const handleCommercialMute = () => {
    const video = marketingCommercialRef.current;
    if (!video) return;

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setCommercialMuted(nextMuted);
    emitMarketingVideoEvent("cta_click", {
      element: "cinematic_sound_control",
      action: nextMuted ? "mute" : "unmute"
    });

    if (!nextMuted && video.paused) {
      video.play().catch(() => {
        emitMarketingVideoEvent("play_error", { element: "cinematic_sound_control" });
      });
    }
  };

  const handleCommercialPlayEvent = () => {
    setCommercialStarted(true);
    setCommercialPlaying(true);
    emitMarketingVideoEvent("play", {
      currentSeconds: Number((marketingCommercialRef.current?.currentTime || 0).toFixed(1))
    });
  };

  const handleCommercialPauseEvent = () => {
    setCommercialPlaying(false);
    if (!marketingCommercialRef.current?.ended) {
      emitMarketingVideoEvent("pause", {
        currentSeconds: Number((marketingCommercialRef.current?.currentTime || 0).toFixed(1))
      });
    }
  };

  useEffect(() => {
    const root = document.documentElement;
    const revealNodes = [...document.querySelectorAll("[data-landing-reveal]")];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    root.classList.add("qp-landing-motion");

    if (reduceMotion || !("IntersectionObserver" in window)) {
      if (reduceMotion && marketingCommercialRef.current) {
        marketingCommercialRef.current.pause();
        marketingCommercialRef.current.currentTime = 0;
        setCommercialPlaying(false);
      }
      revealNodes.forEach((node) => node.classList.add("is-visible"));
      return () => root.classList.remove("qp-landing-motion");
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: "0px 0px -8%",
      threshold: 0.12
    });

    revealNodes.forEach((node) => observer.observe(node));

    return () => {
      observer.disconnect();
      root.classList.remove("qp-landing-motion");
    };
  }, []);

  return (
    <div className="qp-landing" id="top">
      <a className="qp-landing-skip" href="#landing-main">Skip to content</a>

      <div className="qp-landing-film-layer">
        <video
          ref={marketingCommercialRef}
          id="quote-pilot-commercial-video"
          autoPlay
          muted={commercialMuted}
          loop
          playsInline
          preload="metadata"
          poster={COMMERCIAL_VIDEO.poster}
          aria-label="QuotePilot catering operations commercial"
          onPlay={handleCommercialPlayEvent}
          onPause={handleCommercialPauseEvent}
          onEnded={handleCommercialEnded}
        >
          <source src={COMMERCIAL_VIDEO.src} type="video/mp4" />
          <track
            src={COMMERCIAL_VIDEO.track}
            kind="captions"
            srcLang="en"
            label="English"
            default
          />
          Your browser does not support HTML video.
        </video>
        <div className="qp-landing-film-grade" aria-hidden="true" />
      </div>

      <header className="qp-landing-header">
          <a className="qp-landing-brand" href="#top" aria-label="QuotePilot home">
            <BrandLockup />
          </a>

          <nav className="qp-landing-nav" aria-label="Marketing navigation">
            <a href="#story">Story</a>
            <a href="#commercial">The change</a>
            <a href="#features">Product</a>
            <a href="#how-it-works">Workflow</a>
            <a href="#portal">Portal</a>
            <a href="#operations">Operations</a>
          </nav>

        <div className="qp-landing-header-actions">
          <a className="qp-landing-header-login" href="/app">Staff login</a>
          <a className="qp-landing-button qp-landing-button-dark" href="https://mbmapps.com/contact">
            Book a demo
          </a>
        </div>
      </header>

      <main id="landing-main">
        <section
          className="qp-landing-cinematic-hero"
          id="story"
          data-landing-chapter
          aria-labelledby="cinematic-title"
        >
          <div className="qp-landing-cinematic-copy" data-landing-reveal>
            <p className="qp-landing-cinematic-kicker">Catering sales + event operations</p>
            <h1 id="cinematic-title">
              The event changed.
              <em>QuotePilot knows what that means.</em>
            </h1>
            <p className="qp-landing-cinematic-deck">
              See pricing, margin, staffing, and production consequences before a customer request becomes the new plan.
            </p>
            <div className="qp-landing-hero-actions">
              <a className="qp-landing-button qp-landing-button-accent" href="https://mbmapps.com/contact">
                Book a demo
              </a>
              <a className="qp-landing-button qp-landing-button-film" href="#commercial">
                See the consequence
              </a>
              {BUYER_ACCESS_PUBLIC_CTA_ENABLED && (
                <a className="qp-landing-button qp-landing-button-film" href="/start">
                  Try $1 test access
                </a>
              )}
            </div>
          </div>

          <div className="qp-landing-film-status" aria-label="Commercial playback controls">
            <span>QuotePilot film · 30 seconds</span>
            <div>
              <button
                type="button"
                onClick={handleCommercialPlay}
                aria-controls="quote-pilot-commercial-video"
                aria-pressed={!commercialPlaying}
              >
                {commercialPlaying ? "Pause film" : commercialStarted ? "Resume film" : "Play film"}
              </button>
              <button
                type="button"
                onClick={handleCommercialMute}
                aria-controls="quote-pilot-commercial-video"
                aria-pressed={!commercialMuted}
              >
                {commercialMuted ? "Sound on" : "Mute film"}
              </button>
            </div>
          </div>

          <a className="qp-landing-scroll-cue" href="#document">
            Scroll to follow the change <span aria-hidden="true">&darr;</span>
          </a>
        </section>

        <section
          className="qp-landing-story-chapter"
          id="document"
          data-landing-chapter
          data-landing-reveal
          aria-labelledby="burden-title"
        >
          <div className="qp-landing-story-inner">
            <div className="qp-landing-story-title">
              <p className="qp-landing-eyebrow">01 · The invisible work</p>
              <h2 id="burden-title">Running a business means carrying all of it.</h2>
            </div>
            <div className="qp-landing-story-copy">
              <p>
                The customer waiting for an answer. The menu that changed. The team that needs direction.
                The number that must still work when the room is full.
              </p>
              <p>
                Each detail is reasonable on its own. Together, they follow you into every quiet hour the
                business was supposed to leave untouched.
              </p>
            </div>
            <blockquote>
              Time is the one thing your business can never order more of.
            </blockquote>
          </div>
        </section>

        <section
          className="qp-landing-section qp-landing-commercial qp-landing-chapter-film"
          id="commercial"
          data-landing-chapter
          data-landing-reveal
        >
          <div className="qp-landing-commercial-heading">
            <p className="qp-landing-cinematic-kicker">02 · Consequence before commitment</p>
            <h2>One request. Every consequence in view.</h2>
            <p>
              QuotePilot previews the commercial and operational impact without silently changing the event.
            </p>
          </div>
          <article className="qp-landing-impact-preview" aria-label="Customer change request impact preview">
            <header>
              <div>
                <span>Customer change request</span>
                <strong>Morgan Wedding</strong>
              </div>
              <span className="qp-landing-impact-status">Proposed</span>
            </header>
            <blockquote>
              &ldquo;We&rsquo;re actually expecting closer to 175. Can we add another bartender too?&rdquo;
            </blockquote>
            <div className="qp-landing-impact-rows">
              {changeImpact.map((item) => (
                <div className="qp-landing-impact-row" key={item.label}>
                  <span>{item.label}</span>
                  <del>{item.before}</del>
                  <span aria-hidden="true">&rarr;</span>
                  <ins>{item.after}</ins>
                </div>
              ))}
            </div>
            <div className="qp-landing-impact-artifact">
              <span>Production artifact</span>
              <strong>Current <span aria-hidden="true">&rarr;</span> Needs review</strong>
            </div>
            <footer>
              <span>Nothing has changed yet.</span>
              <a
                href="/start"
                onClick={() => emitMarketingVideoEvent("cta_click", { element: "commercial_secondary_cta" })}
              >
                Review proposed change <span aria-hidden="true">&rarr;</span>
              </a>
            </footer>
          </article>
        </section>

        <section className="qp-landing-outcomes" aria-label="QuotePilot outcomes" data-landing-chapter>
          <div className="qp-landing-outcome-grid">
            {outcomeStrip.map((item) => (
              <article key={item.title}>
                <h2>{item.title}</h2>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>
          <a className="qp-landing-text-link" href="/system">
            Explore the platform
          </a>
        </section>

        <section className="qp-landing-section qp-landing-features" id="features" data-landing-chapter data-landing-reveal>
          <div className="qp-landing-section-heading">
            <p className="qp-landing-eyebrow">03 · A lighter way to work</p>
            <h2>Your time is the one thing the business cannot replace.</h2>
            <p>
              QuotePilot is built to hold the complexity quietly, return clarity quickly, and leave the final decision where it belongs: with you.
            </p>
          </div>

          <div className="qp-landing-feature-essay">
            <article>
              <span>Before the quote</span>
              <h3>Begin with what the customer meant, not a blank form.</h3>
              <p>Gather the event into one clear brief and start from understanding instead of reconstruction.</p>
            </article>
            <article>
              <span>While it changes</span>
              <h3>Let one adjustment explain everything it touches.</h3>
              <p>See the effect on the promise, the price, and the people before deciding what becomes official.</p>
            </article>
            <article>
              <span>When work moves</span>
              <h3>Carry the truth forward without carrying it alone.</h3>
              <p>Keep the customer, sales team, kitchen, and event crew working from the same understood plan.</p>
            </article>
          </div>

          <p className="qp-landing-standing-line">
            An app should make life easier. On that, we stand.
          </p>
        </section>

        <section
          className="qp-landing-section qp-landing-workflow qp-landing-chapter-film"
          id="how-it-works"
          data-landing-chapter
          data-landing-reveal
        >
          <div className="qp-landing-workflow-heading">
            <h2>From inquiry to a prepared event</h2>
            <p>
              Each stage leaves useful context for the next without claiming more than your team actually knows.
            </p>
          </div>

          <ol className="qp-landing-workflow-list">
            {workflow.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="qp-landing-section qp-landing-portal" id="portal" data-landing-chapter data-landing-reveal>
          <div className="qp-landing-portal-copy">
            <h2>Make the customer&rsquo;s next decision feel simple.</h2>
            <p>
              Give them one calm place to understand the event, the price, and the choice in front of them.
            </p>
            <ul>
              <li>Review event scope and pricing on any device</li>
              <li>Accept, decline, or request a change</li>
              <li>Keep the customer decision tied to the event record</li>
            </ul>
            <p className="qp-landing-boundary">
              Acceptance records the customer decision. Payment and booking remain separate facts.
            </p>
          </div>
        </section>

        <section className="qp-landing-section qp-landing-operations" id="operations" data-landing-chapter data-landing-reveal>
          <div className="qp-landing-operations-heading">
            <h2>Let the team arrive prepared, not preoccupied.</h2>
            <p>
              QuotePilot carries the understood plan forward so fewer people have to stop, search, ask, and begin again.
            </p>
          </div>

          <div className="qp-landing-operations-layout qp-landing-operations-layout-copy">
            <blockquote>
              When the doors open, the team should feel the plan &mdash; not the scramble behind it.
            </blockquote>
            <div className="qp-landing-operations-list">
              {operations.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="qp-landing-final qp-landing-chapter-film" data-landing-chapter data-landing-reveal>
          <div>
            <h2>An app should make life easier.</h2>
            <p>Let QuotePilot lighten the burden. On that, we stand.</p>
          </div>
          <div className="qp-landing-final-actions">
            <a className="qp-landing-button qp-landing-button-accent" href="https://mbmapps.com/contact">
              Book a demo
            </a>
            <a className="qp-landing-button qp-landing-button-inverse" href="/app">
              Staff login
            </a>
          </div>
        </section>
      </main>

      <footer className="qp-landing-footer">
        <div>
          <a className="qp-landing-brand" href="#top" aria-label="QuotePilot home">
            <BrandLockup />
          </a>
          <p>
            Guided catering quotes, clear customer decisions, and accountable event handoff in one workspace.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="/system">Platform</a>
          <a href="/app">Staff login</a>
          <a href="https://mbmapps.com/contact">Contact</a>
        </nav>
        <small>© 2026 {PRODUCT_COMPANY}. QuotePilot.</small>
      </footer>
    </div>
  );
}
