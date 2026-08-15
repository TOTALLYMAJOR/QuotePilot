import { useEffect } from "react";
import eventScheduleImage from "../assets/marketing/quotepilot/event-schedule.png";
import importStudioImage from "../assets/marketing/quotepilot/import-studio.png";
import opportunityTrackingImage from "../assets/marketing/quotepilot/opportunity-tracking.png";
import quoteDetailsImage from "../assets/marketing/quotepilot/quote-details-connections.png";
import salesFollowupImage from "../assets/marketing/quotepilot/sales-followup.png";
import { isBuyerAccessPublicCtaEnabled } from "../lib/buyerAccessConfig";
import { PRODUCT_COMPANY, PRODUCT_FULL_NAME } from "../lib/productIdentity";
import DocumentHero from "./DocumentHero";
import "../landing.css";

const BUYER_ACCESS_PUBLIC_CTA_ENABLED = isBuyerAccessPublicCtaEnabled(import.meta.env);

const outcomeStrip = [
  {
    title: "Guided quote building",
    detail: "Keep event scope, menus, staffing, rentals, and terms in one flow."
  },
  {
    title: "Live pricing",
    detail: "See each selection and total change while the quote is being built."
  },
  {
    title: "Version history",
    detail: "Compare options and revisions without losing the original record."
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
    title: "Sales follow-up",
    copy: "Keep readiness gaps, due actions, and customer context visible."
  },
  {
    title: "Event schedule",
    copy: "Review confirmed work, conflicts, and the dates that need attention."
  },
  {
    title: "Crew coordination",
    copy: "Keep staffing context connected to the approved event scope."
  },
  {
    title: "Production checklist",
    copy: "Track kitchen, logistics, service, and closeout work without overstating readiness."
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
  useEffect(() => {
    const root = document.documentElement;
    const revealNodes = [...document.querySelectorAll("[data-landing-reveal]")];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    root.classList.add("qp-landing-motion");

    if (reduceMotion || !("IntersectionObserver" in window)) {
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

      <header className="qp-landing-header">
        <a className="qp-landing-brand" href="#top" aria-label="QuotePilot home">
          <BrandLockup />
        </a>

        <nav className="qp-landing-nav" aria-label="Marketing navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
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
        <DocumentHero
          buyCta={
            BUYER_ACCESS_PUBLIC_CTA_ENABLED && (
              <a className="qp-landing-button qp-landing-button-accent" href="/start">
                Try $1 test access
              </a>
            )
          }
        />

        <section className="qp-landing-outcomes" aria-label="QuotePilot outcomes">
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

        <section className="qp-landing-section qp-landing-features" id="features" data-landing-reveal>
          <div className="qp-landing-section-heading">
            <h2>The full quote-to-event toolkit</h2>
            <p>
              Replace the spreadsheet, scattered email threads, and disconnected status updates with one accountable workflow.
            </p>
          </div>

          <div className="qp-landing-feature-grid">
            <article className="qp-landing-feature qp-landing-feature-shot">
              <img
                src={quoteDetailsImage}
                alt="QuotePilot quote detail view showing guest count, package, menu, staffing, pricing, payments, and proposal status all connected to one quote"
                loading="lazy"
                decoding="async"
              />
              <div className="qp-landing-feature-copy">
                <span>Guided quote builder</span>
                <h3>Every detail, connected</h3>
                <p>
                  Guest count, package, menu, staffing, pricing, and payments stay linked to one quote &mdash; not five spreadsheets.
                </p>
              </div>
            </article>

            <article className="qp-landing-feature qp-landing-feature-shot">
              <img
                src={opportunityTrackingImage}
                alt="QuotePilot opportunities view showing proposal completeness, pricing and margin, customer state, and event planning for one quote"
                loading="lazy"
                decoding="async"
              />
              <div className="qp-landing-feature-copy">
                <span>Opportunity tracking</span>
                <h3>Know where every quote stands</h3>
                <p>Proposal readiness, pricing, customer state, and event planning, each tracked separately with one useful next step.</p>
              </div>
            </article>

            <article className="qp-landing-feature qp-landing-feature-shot">
              <img
                src={importStudioImage}
                alt="QuotePilot Import Studio showing a CSV drop zone for bringing customer and catalog data into the workspace"
                loading="lazy"
                decoding="async"
              />
              <div className="qp-landing-feature-copy">
                <span>Bring your business with you</span>
                <h3>Import Studio turns spreadsheets into a workspace</h3>
                <p>Turn customer and catalog spreadsheets into a clean, reviewable workspace &mdash; nothing writes until you approve the mapping.</p>
              </div>
            </article>

            <article className="qp-landing-feature qp-landing-feature-versioned">
              <div className="qp-landing-feature-copy">
                <span>Versioned records</span>
                <h3>Keep every revision in context</h3>
                <p>
                  Reopen, compare, and continue a quote without rebuilding the history of what changed.
                </p>
              </div>
            </article>

            <article className="qp-landing-feature qp-landing-feature-shot">
              <img
                src={salesFollowupImage}
                alt="QuotePilot workflow view showing follow-up stage, due date, and quote lifecycle timeline"
                loading="lazy"
                decoding="async"
              />
              <div className="qp-landing-feature-copy">
                <span>Sales follow-up</span>
                <h3>Know what needs attention next</h3>
                <p>Keep proposal readiness, due actions, and approval requests in one staff workflow.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="qp-landing-section qp-landing-workflow" id="how-it-works" data-landing-reveal>
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

        <section className="qp-landing-section qp-landing-portal" id="portal" data-landing-reveal>
          <div className="qp-landing-portal-copy">
            <h2>Make every customer decision easier to review</h2>
            <p>
              Give customers one place to review the event, pricing, and proposal before they choose the next step.
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

        <section className="qp-landing-section qp-landing-operations" id="operations" data-landing-reveal>
          <div className="qp-landing-operations-heading">
            <h2>Keep event operations connected to the approved scope</h2>
            <p>
              QuotePilot carries useful context forward so sales and production teams can coordinate without flattening every milestone into one status.
            </p>
          </div>

          <div className="qp-landing-operations-layout">
            <img
              src={eventScheduleImage}
              alt="QuotePilot event schedule calendar showing booked and accepted events with conflict flags and a day's run of show"
              loading="lazy"
              decoding="async"
            />
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

        <section className="qp-landing-final" data-landing-reveal>
          <div>
            <h2>Ready to quote with less back-and-forth?</h2>
            <p>See how QuotePilot fits your catering workflow.</p>
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
