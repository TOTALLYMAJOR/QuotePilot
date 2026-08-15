import { useEffect } from "react";
import customerDecisionImage from "../assets/marketing/quotepilot/customer-decision.png";
import eventProductionImage from "../assets/marketing/quotepilot/event-production.png";
import quoteBuilderImage from "../assets/marketing/quotepilot/quote-builder.png";
import salesWorkflowImage from "../assets/marketing/quotepilot/sales-workflow.png";
import scenarioCompareImage from "../assets/marketing/quotepilot/scenario-compare.png";
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
        <DocumentHero showBuyCta={BUYER_ACCESS_PUBLIC_CTA_ENABLED} />

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
            <article className="qp-landing-feature qp-landing-feature-primary">
              <div className="qp-landing-feature-copy">
                <span>Guided quote builder</span>
                <h3>Build the offer with the total in view</h3>
                <p>
                  Configure the event, menu, services, staffing, and terms while the pricing breakdown stays visible.
                </p>
              </div>
              <img
                src={quoteBuilderImage}
                alt="QuotePilot quote builder with event fields and a live pricing breakdown"
                width="1440"
                height="960"
                loading="lazy"
                decoding="async"
              />
            </article>

            <article className="qp-landing-feature qp-landing-feature-portal">
              <img
                src={customerDecisionImage}
                alt="QuotePilot customer portal showing event scope, pricing, and decision controls"
                width="1440"
                height="960"
                loading="lazy"
                decoding="async"
              />
              <div className="qp-landing-feature-copy">
                <span>Customer decisions</span>
                <h3>Make the next decision easy to understand</h3>
                <p>Customers can accept, decline, or request changes from a focused, time-bound portal.</p>
              </div>
            </article>

            <article className="qp-landing-feature qp-landing-feature-compare">
              <div className="qp-landing-feature-copy">
                <span>Scenario comparison</span>
                <h3>Shape Good, Better, and Best paths</h3>
                <p>Compare realistic options while keeping the original quote as the baseline.</p>
              </div>
              <img
                src={scenarioCompareImage}
                alt="QuotePilot scenario comparison with Good, Better, and Best options"
                width="1440"
                height="960"
                loading="lazy"
                decoding="async"
              />
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

            <article className="qp-landing-feature qp-landing-feature-followup">
              <img
                src={salesWorkflowImage}
                alt="QuotePilot sales workflow with readiness gaps, follow-up planning, and lifecycle history"
                width="1440"
                height="960"
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
          <div className="qp-landing-portal-media">
            <img
              src={customerDecisionImage}
              alt="A customer reviewing a QuotePilot proposal and decision options"
              width="1440"
              height="960"
              loading="lazy"
              decoding="async"
            />
          </div>

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
              src={eventProductionImage}
              alt="QuotePilot event production view with schedule and preparation checklist"
              width="1440"
              height="960"
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
