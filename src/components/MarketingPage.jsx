import { useCallback, useEffect, useRef, useState } from "react";
import customerDecisionImage from "../assets/marketing/quotepilot/customer-decision.png";
import eventProductionImage from "../assets/marketing/quotepilot/event-production.png";
import quoteBuilderImage from "../assets/marketing/quotepilot/quote-builder.png";
import quoteHistoryImage from "../assets/marketing/quotepilot/quote-history.png";
import salesWorkflowImage from "../assets/marketing/quotepilot/sales-workflow.png";
import scenarioCompareImage from "../assets/marketing/quotepilot/scenario-compare.png";
import "../marketing.css";

const operatingModel = [
  { number: "01", label: "Capture", detail: "Turn an inquiry into a structured event brief." },
  { number: "02", label: "Configure", detail: "Build packages, menus, staffing, rentals, and terms." },
  { number: "03", label: "Compare", detail: "Shape Good, Better, and Best paths without losing the baseline." },
  { number: "04", label: "Propose", detail: "Send a customer-ready proposal with a clear decision path." },
  { number: "05", label: "Confirm", detail: "Track acceptance, payment, and booking as separate facts." },
  { number: "06", label: "Produce", detail: "Carry the approved scope into the event-readiness checklist." }
];

const principles = [
  {
    title: "Authority stays visible",
    copy: "A customer decision, a payment confirmation, and an operations-ready event are connected, but never treated as the same thing.",
    mark: "A"
  },
  {
    title: "Every revision has context",
    copy: "Quote versions, lifecycle changes, and staff actions stay traceable so the team can move without reconstructing what happened.",
    mark: "V"
  },
  {
    title: "Complexity becomes usable",
    copy: "Catalog rules, labor, tax, menus, rentals, proposals, and follow-up live in one guided operating flow.",
    mark: "C"
  }
];

const capabilities = ["Lead follow-up", "Guided quoting", "Scenario compare", "Customer decisions", "Payment state", "Event production"];

const featureDrawerItems = [
  {
    id: "guided-quote",
    title: "Guided quote builder",
    summary: "Move from event basics to a customer-ready proposal through one structured five-part flow.",
    value: "Sales teams can capture the event, configure selections, review pricing, and prepare the proposal without rebuilding context.",
    boundary: "A complete draft can be ready for review without being accepted, paid, or booked.",
    image: quoteBuilderImage,
    imageAlt: "QuotePilot guided quote builder with event fields and a live pricing breakdown",
    trace: ["Capture event scope", "Configure the offer", "Review and propose"]
  },
  {
    id: "scenario-compare",
    title: "Good, Better, Best",
    summary: "Shape clear package options while keeping the original quote available as the baseline.",
    value: "Teams can compare realistic alternatives, understand total changes, and apply the selected direction back to the active draft.",
    boundary: "A scenario is a sales option. It does not change the customer decision until the proposal is reviewed and accepted.",
    image: scenarioCompareImage,
    imageAlt: "QuotePilot scenario comparison showing Good, Better, and Best pricing options",
    trace: ["Build the baseline", "Compare options", "Apply one direction"]
  },
  {
    id: "decision-center",
    title: "Customer decision center",
    summary: "Give customers a focused place to review scope, pricing, and the next decision.",
    value: "Customers can accept, decline, or request changes from a time-bound portal while staff retain the operating record.",
    boundary: "Acceptance records the customer decision. Payment and booking confirmation remain separate facts.",
    image: customerDecisionImage,
    imageAlt: "QuotePilot customer decision center with event details, pricing, and decision controls",
    trace: ["Share the proposal", "Record the decision", "Return context to staff"]
  },
  {
    id: "payment-state",
    title: "Payment state",
    summary: "Keep payment context visible beside the proposal without collapsing commercial milestones.",
    value: "Staff can see where a proposal, deposit request, and payment confirmation sit in the broader event workflow.",
    boundary: "A payment link is a handoff. Only confirmed provider state should be treated as payment evidence.",
    image: quoteHistoryImage,
    imageAlt: "QuotePilot quote history with proposal, payment, contract, and lifecycle controls",
    trace: ["Prepare the handoff", "Track provider state", "Preserve the record"]
  },
  {
    id: "sales-workflow",
    title: "Sales follow-up",
    summary: "Keep readiness gaps, due follow-ups, lifecycle context, and approval requests in one staff workflow.",
    value: "Sales can prepare the next customer action while admins retain control of sensitive payment, booking, and deletion operations.",
    boundary: "An approved request records intent. The authorized admin still completes the separate operational action.",
    image: salesWorkflowImage,
    imageAlt: "QuotePilot sales workflow with proposal readiness, follow-up planning, and lifecycle history",
    trace: ["Find the gap", "Plan the follow-up", "Route sensitive work"]
  },
  {
    id: "event-production",
    title: "Event production",
    summary: "Carry approved quote context into a practical checklist for the team preparing the event.",
    value: "Kitchen, logistics, staffing, service, and closeout tasks stay connected to the event record after the sales decision.",
    boundary: "Checklist completion records work performed. It does not prove inventory availability or final event readiness.",
    image: eventProductionImage,
    imageAlt: "QuotePilot event schedule with an accepted event and its production checklist",
    trace: ["Carry the scope forward", "Coordinate the team", "Close out the work"]
  }
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BrandMark() {
  return (
    <span className="marketing-brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function AnimatedMetric({ value, suffix = "", label }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setDisplay(value);
      return undefined;
    }

    let frame = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const startedAt = performance.now();
      const tick = (now) => {
        const progress = Math.min(1, (now - startedAt) / 900);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.round(value * eased));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.45 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <div className="marketing-metric" ref={ref}>
      <strong>{display}{suffix}</strong>
      <span>{label}</span>
    </div>
  );
}

function OrbitConsole() {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const onPointerMove = (event) => {
      const bounds = node.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      node.style.setProperty("--pointer-x", `${x * 16}px`);
      node.style.setProperty("--pointer-y", `${y * 16}px`);
    };
    const reset = () => {
      node.style.setProperty("--pointer-x", "0px");
      node.style.setProperty("--pointer-y", "0px");
    };
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerleave", reset);
    return () => {
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerleave", reset);
    };
  }, []);

  return (
    <div className="marketing-console" ref={ref} role="img" aria-label="Animated QuotePilot workflow map connecting inquiry, quote, customer decision, payment, and event operations">
      <div className="marketing-console-topline">
        <span><i /> Workflow map</span>
        <span>6 connected stages</span>
      </div>
      <div className="marketing-orbit-field">
        <div className="marketing-orbit marketing-orbit-a" />
        <div className="marketing-orbit marketing-orbit-b" />
        <div className="marketing-orbit marketing-orbit-c" />
        <div className="marketing-sweep" />
        <div className="marketing-core">
          <BrandMark />
          <b>QUOTE</b>
          <span>single source</span>
        </div>
        <span className="marketing-node marketing-node-inquiry"><i />Inquiry<small>captured</small></span>
        <span className="marketing-node marketing-node-proposal"><i />Proposal<small>review</small></span>
        <span className="marketing-node marketing-node-decision"><i />Decision<small>recorded</small></span>
        <span className="marketing-node marketing-node-payment"><i />Payment<small>separate</small></span>
        <span className="marketing-node marketing-node-ops"><i />Event ops<small>readiness</small></span>
      </div>
      <div className="marketing-console-footer">
        <span>Version history <b>on</b></span>
        <span>Authority boundaries <b>clear</b></span>
      </div>
    </div>
  );
}

function ProcessVisual({ index }) {
  if (index === 0) {
    return <div className="process-map"><i /><i /><i /><span /></div>;
  }
  if (index === 1) {
    return <div className="process-wireframe"><span /><span /><b /><em /></div>;
  }
  if (index === 2) {
    return <div className="process-scenarios"><span>GOOD</span><span>BETTER</span><span>BEST</span></div>;
  }
  if (index === 3) {
    return <div className="process-proposal"><span>PROPOSAL</span><b /><b /><em>READY FOR REVIEW</em></div>;
  }
  if (index === 4) {
    return <div className="process-authority"><span>ACCEPTED</span><span>PAYMENT</span><span>BOOKING</span></div>;
  }
  return <div className="process-checklist"><span>scope</span><span>kitchen</span><span>logistics</span><i /></div>;
}

function FeatureDrawer({ open, selectedId, onSelect, onClose, returnFocusRef }) {
  const drawerRef = useRef(null);
  const closeRef = useRef(null);
  const activeFeature = featureDrawerItems.find((item) => item.id === selectedId) || featureDrawerItems[0];

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="marketing-feature-layer">
      <button
        className="marketing-feature-backdrop"
        type="button"
        tabIndex="-1"
        aria-label="Close feature drawer"
        onClick={onClose}
      />
      <aside
        className="marketing-feature-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketing-feature-title"
      >
        <div className="marketing-feature-drawer-head">
          <div>
            <span>Inside QuotePilot</span>
            <p>Follow the work from quote to event.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose}>Close</button>
        </div>

        <div className="marketing-feature-drawer-body">
          <div className="marketing-feature-index" aria-label="QuotePilot features">
            {featureDrawerItems.map((feature) => (
              <button
                key={feature.id}
                type="button"
                className={feature.id === activeFeature.id ? "is-active" : ""}
                aria-pressed={feature.id === activeFeature.id}
                onClick={() => onSelect(feature.id)}
              >
                <span>{feature.title}</span>
                <small>{feature.summary}</small>
              </button>
            ))}
          </div>

          <article className="marketing-feature-detail" key={activeFeature.id}>
            <p className="marketing-feature-label">Feature overview</p>
            <h2 id="marketing-feature-title">{activeFeature.title}</h2>
            <p className="marketing-feature-summary">{activeFeature.summary}</p>

            <figure className="marketing-feature-media">
              <img
                src={activeFeature.image}
                alt={activeFeature.imageAlt}
                width="1440"
                height="960"
                decoding="async"
              />
              <figcaption>Actual QuotePilot interface shown with local demo data.</figcaption>
            </figure>

            <div className="marketing-feature-copy">
              <section>
                <span>Operational value</span>
                <p>{activeFeature.value}</p>
              </section>
              <section>
                <span>Kept distinct</span>
                <p>{activeFeature.boundary}</p>
              </section>
            </div>

            <ol className="marketing-feature-trace" aria-label={`${activeFeature.title} workflow`}>
              {activeFeature.trace.map((item) => <li key={item}>{item}</li>)}
            </ol>
          </article>
        </div>
      </aside>
    </div>
  );
}

export default function MarketingPage() {
  const [featureDrawerOpen, setFeatureDrawerOpen] = useState(false);
  const [selectedFeatureId, setSelectedFeatureId] = useState(featureDrawerItems[0].id);
  const featureTriggerRef = useRef(null);

  const openFeatureDrawer = useCallback((trigger) => {
    featureTriggerRef.current = trigger;
    setFeatureDrawerOpen(true);
  }, []);
  const closeFeatureDrawer = useCallback(() => setFeatureDrawerOpen(false), []);

  useEffect(() => {
    document.documentElement.classList.add("marketing-active");
    const nodes = [...document.querySelectorAll("[data-reveal]")];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      nodes.forEach((node) => node.classList.add("is-revealed"));
      return () => document.documentElement.classList.remove("marketing-active");
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.12 });
    nodes.forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      document.documentElement.classList.remove("marketing-active");
    };
  }, []);

  return (
    <div className="marketing-page">
      <a className="marketing-skip" href="#marketing-main">Skip to content</a>
      <div className="marketing-noise" aria-hidden="true" />
      <header className="marketing-header">
        <a className="marketing-brand" href="#top" aria-label="QuotePilot home">
          <BrandMark />
          <span><b>QUOTEPILOT</b><small>BY MBMAPPS</small></span>
        </a>
        <nav aria-label="Marketing navigation">
          <a href="#system">System</a>
          <a href="#workflow">Workflow</a>
          <a href="#principles">Principles</a>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={featureDrawerOpen}
            onClick={(event) => openFeatureDrawer(event.currentTarget)}
          >
            Features
          </button>
        </nav>
        <div className="marketing-header-actions">
          <button
            className="marketing-header-feature"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={featureDrawerOpen}
            onClick={(event) => openFeatureDrawer(event.currentTarget)}
          >
            Features
          </button>
          <a className="marketing-header-cta" href="/app">Launch app <ArrowIcon /></a>
        </div>
      </header>

      <main id="marketing-main">
        <section className="marketing-hero" id="top">
          <div className="marketing-hero-copy">
            <p className="marketing-kicker marketing-hero-stagger">Quote-to-event operating system</p>
            <h1>
              <span className="marketing-hero-stagger">Move from first inquiry</span>
              <span className="marketing-hero-stagger">to a clearer event.</span>
              <em className="marketing-hero-stagger">Without losing the truth.</em>
            </h1>
            <p className="marketing-hero-description marketing-hero-stagger">
              QuotePilot connects guided quoting, customer decisions, payment state, and event production while keeping authority explicit.
            </p>
            <div className="marketing-hero-actions marketing-hero-stagger">
              <a className="marketing-button marketing-button-primary" href="/app">Open workspace <ArrowIcon /></a>
              <a className="marketing-button marketing-button-quiet" href="#workflow">Explore the system <span>↓</span></a>
            </div>
          </div>
          <div className="marketing-hero-visual marketing-hero-stagger">
            <OrbitConsole />
          </div>
        </section>

        <section className="marketing-philosophy" id="system" data-reveal>
          <div className="marketing-philosophy-title">
            <p className="marketing-kicker">Core operating principle</p>
            <h2>Connected is<br />not collapsed.</h2>
          </div>
          <div className="marketing-philosophy-rule" aria-hidden="true"><i /><span /></div>
          <div className="marketing-philosophy-copy">
            <p>A quote can be ready for customer review without being accepted. A proposal can be accepted without being paid. A paid event can still need operational checks.</p>
            <p>QuotePilot keeps those states connected and visible, giving sales, admins, customers, and event teams one shared record without inventing certainty.</p>
            <p>That clarity turns a complicated catering workflow into a system people can actually operate.</p>
          </div>
        </section>

        <section className="marketing-blueprint" data-reveal>
          <p className="marketing-kicker">System blueprint</p>
          <h2>One operating model.</h2>
          <div className="marketing-capability-rail">
            {capabilities.map((item, index) => (
              <div key={item} className={index === 0 ? "is-active" : ""}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{item}</b>
              </div>
            ))}
          </div>
          <div className="marketing-marquee" aria-hidden="true">
            <div>{[...capabilities, ...capabilities].map((item, index) => <span key={`${item}-${index}`}>{item}<i>✦</i></span>)}</div>
          </div>
        </section>

        <section className="marketing-process" id="workflow">
          <div className="marketing-section-heading" data-reveal>
            <p className="marketing-kicker">Methodology</p>
            <h2>The workflow.</h2>
            <p>Six connected stages. Each leaves evidence for the next without claiming more than it knows.</p>
          </div>
          <div className="marketing-process-line" aria-hidden="true" />
          <div className="marketing-process-list">
            {operatingModel.map((step, index) => (
              <article className="marketing-process-step" key={step.label} data-reveal>
                <div className="marketing-process-copy">
                  <span>{step.number}</span>
                  <h3>{step.label}</h3>
                  <p>{step.detail}</p>
                </div>
                <div className="marketing-process-dot" aria-hidden="true" />
                <div className="marketing-process-visual" aria-hidden="true">
                  <div className="marketing-visual-label">{step.label.toUpperCase()} / {step.number}</div>
                  <ProcessVisual index={index} />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="marketing-principles" id="principles">
          <div className="marketing-section-heading" data-reveal>
            <p className="marketing-kicker">Built for accountable work</p>
            <h2>Operating principles.</h2>
          </div>
          <div className="marketing-principle-list">
            {principles.map((principle, index) => (
              <article key={principle.title} data-reveal>
                <span className="marketing-principle-mark">{principle.mark}</span>
                <div><small>0{index + 1}</small><h3>{principle.title}</h3><p>{principle.copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="marketing-metrics" data-reveal aria-label="Product model at a glance">
          <AnimatedMetric value={5} label="guided quote steps" />
          <AnimatedMetric value={3} label="separate authority domains" />
          <AnimatedMetric value={6} label="connected workflow stages" />
          <AnimatedMetric value={1} label="shared source of context" />
        </section>

        <section className="marketing-final-cta" data-reveal>
          <div className="marketing-cta-orbits" aria-hidden="true"><i /><i /><i /><span /></div>
          <div className="marketing-cta-content">
            <BrandMark />
            <p className="marketing-kicker">The next quote starts here</p>
            <h2>Ready to run a clearer event?</h2>
            <p>Open the staff workspace to build a quote, manage customer decisions, or continue event production.</p>
            <div>
              <a className="marketing-button marketing-button-primary" href="/app">Launch QuotePilot <ArrowIcon /></a>
              <a className="marketing-button marketing-button-quiet" href="#top">Back to top <span>↑</span></a>
            </div>
          </div>
        </section>
      </main>

      <footer className="marketing-footer">
        <div className="marketing-brand"><BrandMark /><span><b>QUOTEPILOT</b><small>BY MBMAPPS</small></span></div>
        <p>Quote, proposal, payment state, and event readiness, connected with their boundaries intact.</p>
        <div><a href="#system">System</a><a href="#workflow">Workflow</a><a href="/app">Staff app</a></div>
        <small>© {new Date().getFullYear()} MBMapps. QuotePilot.</small>
      </footer>

      <FeatureDrawer
        open={featureDrawerOpen}
        selectedId={selectedFeatureId}
        onSelect={setSelectedFeatureId}
        onClose={closeFeatureDrawer}
        returnFocusRef={featureTriggerRef}
      />
    </div>
  );
}
