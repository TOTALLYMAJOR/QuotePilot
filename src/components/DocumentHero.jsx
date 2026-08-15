import { useEffect, useMemo, useRef, useState } from "react";
import "../documentHero.css";

const SLIDE_LABELS = [
  { n: "01", label: "Paste the inquiry" },
  { n: "02", label: "Proposal room" },
  { n: "03", label: "Payment" },
  { n: "04", label: "Staffing" },
  { n: "05", label: "Kitchen copy" },
  { n: "06", label: "Enterprise" }
];

const COPY = [
  {
    eyebrow: "Catering sales + event operations",
    h1: <>Every event is a document that <em>won&rsquo;t hold still.</em></>,
    sub: "QuotePilot keeps the copy everyone’s working from correct — the quote, the staffing, the kitchen sheet, and the customer’s decision, attached to one event."
  },
  {
    eyebrow: "01 · Capture",
    h1: <>It starts as an email. <em>Paste it.</em></>,
    sub: "Forward or paste the inquiry on your phone and QuotePilot drafts the event brief — date, guests, venue — before anything is created."
  },
  {
    eyebrow: "02 · Decide",
    h1: <>The proposal is a place, <em>not a PDF.</em></>,
    sub: "Messaging, change requests, and the decision live with the event, in a focused portal. No thread archaeology."
  },
  {
    eyebrow: "03 · Collect",
    h1: <>Money moves through Stripe, <em>not spreadsheets.</em></>,
    sub: "The deposit links to the revision the customer accepted. Payment lands as its own fact, and the balance has a date."
  },
  {
    eyebrow: "04 · Staff",
    h1: <>The roster knows what <em>rev 06 needs.</em></>,
    sub: "The third bartender became an open shift the moment the quote changed — not the week of the event."
  },
  {
    eyebrow: "05 · Produce",
    h1: <>The kitchen cooks from <em>the revision you sold.</em></>,
    sub: "Rev 06 replaced the stale sheet the moment it was ready — counts and timing scaled to what’s actually happening."
  },
  {
    eyebrow: "06 · Scale",
    h1: <>Enterprise features, <em>not the enterprise invoice.</em></>,
    sub: "The whole toolkit, capture to kitchen, at a flat price a single-location caterer can justify."
  }
];

const SHEET_STEPS = ["enter", "note", "guests", "bar", "staff", "money", "flip", "stamp"];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function useSheetPlayback(reducedMotion) {
  const [step, setStep] = useState(-1);
  const timers = useRef([]);

  const play = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reducedMotion) {
      setStep(SHEET_STEPS.length - 1);
      return;
    }
    setStep(-1);
    const at = (ms, value) => {
      timers.current.push(setTimeout(() => setStep(value), ms));
    };
    at(200, 0); // enter
    at(1100, 1); // note
    at(2000, 2); // guests
    at(2650, 3); // bar
    at(3150, 4); // staff
    at(3700, 5); // money/total/margin/menu
    at(4550, 6); // rev flip
    at(5050, 7); // stamp + jolt
  };

  useEffect(() => {
    play();
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const has = (name) => step >= SHEET_STEPS.indexOf(name);
  return { has, replay: play, jolt: step === 7 };
}

function Strike({ on, children }) {
  return <del className={cx("qp-dh-strike", on && "qp-dh-on")}>{children}</del>;
}
function Amend({ on, children }) {
  return <ins className={cx("qp-dh-amend", on && "qp-dh-on")}>{children}</ins>;
}
function MoneySwap({ on, oldVal, newVal }) {
  return (
    <span className={cx("qp-dh-money-swap", on && "qp-dh-on")}>
      <span className="qp-dh-old">{oldVal}</span>
      <span className="qp-dh-new">{newVal}</span>
    </span>
  );
}

function TheChangeSlide({ reducedMotion }) {
  const { has, replay, jolt } = useSheetPlayback(reducedMotion);

  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-sheet-wrap">
        <aside className={cx("qp-dh-cust-note", has("note") && "qp-dh-on")} aria-label="Customer request">
          <span className="qp-dh-note-lab">Customer request</span>
          <p className="qp-dh-note-txt">&ldquo;Closer to 175 now &mdash; and one more bartender?&rdquo;</p>
          <span className="qp-dh-note-who">&mdash; Avery Morgan</span>
        </aside>

        <article
          className={cx("qp-dh-sheet", has("enter") && "qp-dh-enter", jolt && "qp-dh-jolt")}
          aria-label="Banquet event order for Morgan Wedding, revision six"
        >
          <div className="qp-dh-sheet-head">
            <span className="qp-dh-doc-kind">Banquet Event Order</span>
            <span className="qp-dh-doc-ref">
              <span>BEO N&#186; 2026-114</span>
              <span className={cx("qp-dh-rev-chip", has("flip") && "qp-dh-flip")}>
                <span className="qp-dh-old">REV 05</span>
                <span className="qp-dh-new">REV 06</span>
              </span>
            </span>
          </div>

          <h2>Morgan Wedding</h2>
          <p className="qp-dh-event-meta">Saturday, September 26, 2026 &middot; Hillcrest Estate, Birmingham AL</p>

          <hr className="qp-dh-rule qp-dh-rule-heavy" />

          <div className="qp-dh-fields">
            <div>
              <span className="qp-dh-field-lab">Guest count</span>
              <span className="qp-dh-field-val">
                <Strike on={has("guests")}>165</Strike>
                <Amend on={has("guests")}>175</Amend>
              </span>
            </div>
            <div>
              <span className="qp-dh-field-lab">Timeline</span>
              <span className="qp-dh-field-val">Ceremony 4:00 &middot; Dinner 6:30</span>
            </div>
          </div>

          <hr className="qp-dh-rule" />

          <div className="qp-dh-sec">
            <span className="qp-dh-sec-lab">Menu</span>
            <p className="qp-dh-sec-row">
              Plated &mdash; herb chicken 86 &middot; short rib 64 &middot; wellington 15
              <span className={cx("qp-dh-note-inline", has("money") && "qp-dh-on")}>reconfirm at 175</span>
            </p>
          </div>

          <div className="qp-dh-sec">
            <span className="qp-dh-sec-lab">Bar &amp; service staff</span>
            <p className="qp-dh-sec-row">
              Full bar &middot; Bartenders <Strike on={has("bar")}>2</Strike><Amend on={has("bar")}>3</Amend>
            </p>
            <p className="qp-dh-sec-row">
              Captain 1 &middot; Servers 8 &middot; <span className="qp-dh-mono">STAFF TOTAL</span>{" "}
              <Strike on={has("staff")}>11</Strike><Amend on={has("staff")}>12</Amend>
            </p>
          </div>

          <hr className="qp-dh-rule" />

          <div className="qp-dh-money">
            <div className="qp-dh-mrow">
              <span>Subtotal</span>
              <MoneySwap on={has("money")} oldVal="$15,100" newVal="$15,963" />
            </div>
            <div className="qp-dh-mrow">
              <span>Service charge (22%)</span>
              <MoneySwap on={has("money")} oldVal="$3,320" newVal="$3,512" />
            </div>
            <div className="qp-dh-mrow qp-dh-mrow-total">
              <span className="qp-dh-mrow-total-lab">Estimated total</span>
              <span>
                <Strike on={has("money")}>$18,420</Strike>
                <Amend on={has("money")}>$19,475</Amend>
              </span>
            </div>
            <div className="qp-dh-margin-line">
              <span>GROSS MARGIN &mdash; INTERNAL</span>
              <span>
                <Strike on={has("money")}>38.2%</Strike>
                <Amend on={has("money")}>37.0%</Amend>
              </span>
            </div>
          </div>

          <div className={cx("qp-dh-stamp", has("stamp") && "qp-dh-on")} role="status">
            KITCHEN COPY
            <small>OUT OF DATE</small>
          </div>

          <div className="qp-dh-sheet-foot">
            <span>PREPARED IN QUOTEPILOT</span>
            <span>MORGAN&ndash;114</span>
          </div>
        </article>

        <div className="qp-dh-replay-row">
          <button type="button" className="qp-dh-replay" onClick={replay} aria-label="Replay the document revision">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 12V8.5H6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Replay the change
          </button>
        </div>
      </div>
    </div>
  );
}

function PItem({ live, delay, className, children }) {
  return (
    <div className={cx("qp-dh-p-item", live && "qp-dh-live", className)} style={{ "--dh-delay": `${delay}s` }}>
      {children}
    </div>
  );
}

function InquirySlide({ live }) {
  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-phone" aria-label="Mobile app: inquiry pasted from email">
        <div className="qp-dh-phone-screen">
          <div className="qp-dh-phone-bar">
            <span className="qp-dh-phone-app">QuotePilot &middot; New inquiry</span>
            <span className="qp-dh-phone-time">4:07 PM</span>
          </div>
          <PItem live={live} delay={0.1} className="qp-dh-mail">
            <span className="qp-dh-mail-from">From: Avery Morgan</span>
            &ldquo;Hi! We&rsquo;re planning our wedding for Sept 26 at Hillcrest Estate &mdash; around 165 guests. Could you send pricing?&rdquo;
          </PItem>
          <PItem live={live} delay={0.3} className="qp-dh-paste-note">Pasted &middot; drafting brief</PItem>
          <PItem live={live} delay={0.45} className="qp-dh-x-chip"><span className="qp-dh-x-lab">Event type</span>Wedding</PItem>
          <PItem live={live} delay={0.6} className="qp-dh-x-chip"><span className="qp-dh-x-lab">Date</span>Sat, Sep 26</PItem>
          <PItem live={live} delay={0.75} className="qp-dh-x-chip"><span className="qp-dh-x-lab">Guests</span>~165</PItem>
          <PItem live={live} delay={0.9} className="qp-dh-x-chip"><span className="qp-dh-x-lab">Venue</span>Hillcrest Estate</PItem>
          <PItem live={live} delay={1.1} className="qp-dh-x-go">Create event brief &rarr;</PItem>
        </div>
      </div>
    </div>
  );
}

function ProposalSlide({ live }) {
  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-mini" aria-label="Proposal room: messages, change request, decision">
        <div className="qp-dh-m-head">
          <span className="qp-dh-m-kind">Proposal room</span>
          <span className="qp-dh-m-ref">REV 06</span>
        </div>
        <p className="qp-dh-m-title">Morgan Wedding &mdash; $19,475</p>
        <p className="qp-dh-m-sub">SHARED SEP 14 &middot; OPEN UNTIL SEP 21</p>
        <PItem live={live} delay={0.1} className="qp-dh-bub qp-dh-bub-cust">
          <span className="qp-dh-bub-who">Avery</span>&ldquo;We&rsquo;re closer to 175 now &mdash; and could we add another bartender?&rdquo;
        </PItem>
        <PItem live={live} delay={0.3} className="qp-dh-cr-chip">
          CHANGE REQUEST #2 &middot; <b>RESOLVED IN REV 06</b>
        </PItem>
        <PItem live={live} delay={0.5} className="qp-dh-bub qp-dh-bub-staff">
          <span className="qp-dh-bub-who">Hillcrest Catering</span>&ldquo;Done &mdash; new total is $19,475, third bartender is in.&rdquo;
        </PItem>
        <PItem live={live} delay={0.7} className="qp-dh-decide">
          <span className="qp-dh-d-btn qp-dh-d-btn-yes">Accept</span>
          <span className="qp-dh-d-btn">Request a change</span>
          <span className="qp-dh-d-btn">Decline</span>
        </PItem>
        <PItem live={live} delay={0.9} className="qp-dh-decided">ACCEPTED SEP 15, 9:14 AM</PItem>
      </div>
    </div>
  );
}

function PaymentSlide({ live }) {
  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-mini" aria-label="Deposit receipt paid through Stripe">
        <div className="qp-dh-m-head">
          <span className="qp-dh-m-kind">Deposit receipt</span>
          <span className="qp-dh-m-ref">VIA STRIPE</span>
        </div>
        <p className="qp-dh-m-title">Morgan Wedding</p>
        <p className="qp-dh-m-sub">INVOICE QP-2026-114-D</p>
        <div className={cx("qp-dh-paid", live && "qp-dh-live")}>PAID</div>
        <hr className="qp-dh-m-rule" />
        <PItem live={live} delay={0.1} className="qp-dh-r-row"><span>Accepted total &middot; Rev 06</span><span>$19,475</span></PItem>
        <PItem live={live} delay={0.25} className="qp-dh-r-row qp-dh-r-row-big"><span>Deposit (25%)</span><span>$4,869</span></PItem>
        <PItem live={live} delay={0.4} className="qp-dh-r-row"><span className="qp-dh-r-sub">VISA &middot;&middot; 4242</span><span className="qp-dh-r-sub">TXN OK</span></PItem>
        <hr className="qp-dh-m-rule" />
        <PItem live={live} delay={0.55} className="qp-dh-r-row"><span>Balance</span><span>$14,606</span></PItem>
        <PItem live={live} delay={0.7} className="qp-dh-r-row"><span className="qp-dh-r-sub">DUE SEP 19</span><span className="qp-dh-r-sub">TRACKED</span></PItem>
      </div>
    </div>
  );
}

function StaffingSlide({ live }) {
  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-mini" aria-label="Call sheet with the open bartender shift filling">
        <div className="qp-dh-m-head">
          <span className="qp-dh-m-kind">Call sheet</span>
          <span className="qp-dh-m-ref">SAT, SEP 26</span>
        </div>
        <p className="qp-dh-m-title">Morgan Wedding &middot; 175 guests</p>
        <p className="qp-dh-m-sub">REQUIRED BY REV 06: 12</p>
        <PItem live={live} delay={0.1} className="qp-dh-cs-row"><span><span className="qp-dh-cs-role">Captain</span>&nbsp;R. Vance</span><span className="qp-dh-cs-ok">&#10003; CONFIRMED</span></PItem>
        <PItem live={live} delay={0.22} className="qp-dh-cs-row"><span><span className="qp-dh-cs-role">Servers &times;8</span>&nbsp;Full crew</span><span className="qp-dh-cs-ok">&#10003; CONFIRMED</span></PItem>
        <PItem live={live} delay={0.34} className="qp-dh-cs-row"><span><span className="qp-dh-cs-role">Bartender</span>&nbsp;J. Ellis</span><span className="qp-dh-cs-ok">&#10003; CONFIRMED</span></PItem>
        <PItem live={live} delay={0.46} className="qp-dh-cs-row"><span><span className="qp-dh-cs-role">Bartender</span>&nbsp;D. Kim</span><span className="qp-dh-cs-ok">&#10003; CONFIRMED</span></PItem>
        <div className="qp-dh-cs-row">
          <span><span className="qp-dh-cs-role">Bartender &middot; cocktail hr</span></span>
          <span className={cx("qp-dh-autoswap", live && "qp-dh-live")}>
            <span className="qp-dh-old">OPEN SHIFT</span>
            <span className="qp-dh-new qp-dh-cs-ok">M. Okafor&nbsp;&#10003;</span>
          </span>
        </div>
        <PItem live={live} delay={1.1} className="qp-dh-cs-total">12 OF 12 CONFIRMED</PItem>
      </div>
    </div>
  );
}

function KitchenSlide({ live }) {
  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-mini" aria-label="Kitchen BEO, revision six, stamped current">
        <div className="qp-dh-m-head">
          <span className="qp-dh-m-kind">BEO &middot; kitchen copy</span>
          <span className="qp-dh-m-ref">REV 06</span>
        </div>
        <p className="qp-dh-m-title">Morgan Wedding</p>
        <p className="qp-dh-m-sub">REPLACES REV 05</p>
        <div className={cx("qp-dh-k-stamp", live && "qp-dh-live")}>CURRENT</div>
        <hr className="qp-dh-m-rule" />
        <PItem live={live} delay={0.1} className="qp-dh-k-line">Plated &middot; 175 covers &mdash; <span className="qp-dh-mono">chicken 90 &middot; short rib 68 &middot; wellington 17</span></PItem>
        <PItem live={live} delay={0.22} className="qp-dh-k-line">Passed (&times;4) &mdash; <span className="qp-dh-mono">counts scaled to 175</span></PItem>
        <PItem live={live} delay={0.34} className="qp-dh-k-line">Allergy &middot; <span className="qp-dh-mono">shellfish-free &mdash; table 12</span></PItem>
        <PItem live={live} delay={0.46} className="qp-dh-k-line">Load-in 1:00 &middot; <span className="qp-dh-mono">dinner service 6:30 PM</span></PItem>
      </div>
    </div>
  );
}

function EnterpriseSlide({ live }) {
  return (
    <div className="qp-dh-slide">
      <div className="qp-dh-mini" aria-label="Rate card: enterprise features at a flat price">
        <div className="qp-dh-m-head">
          <span className="qp-dh-m-kind">Rate card</span>
          <span className="qp-dh-m-ref">ALL PLANS</span>
        </div>
        <p className="qp-dh-m-title">Everything you just clicked through.</p>
        <p className="qp-dh-m-sub">NO GATED TIERS</p>
        <hr className="qp-dh-m-rule" />
        <ul className="qp-dh-rate-list">
          {[
            "Unlimited events & quotes",
            "Proposal room & portal",
            "Stripe payments",
            "Staffing & call sheets",
            "Kitchen BEOs & versions",
            "Roles & approvals",
            "Multi-location",
            "Exports & audit history"
          ].map((item, i) => (
            <li key={item} className={cx("qp-dh-p-item", live && "qp-dh-live")} style={{ "--dh-delay": `${0.1 + i * 0.08}s` }}>
              {item}
            </li>
          ))}
        </ul>
        <PItem live={live} delay={0.85} className="qp-dh-price-row">
          <span className="qp-dh-price">$99</span>
          <span className="qp-dh-price-meta">
            /MO &middot; FLAT &middot; PER LOCATION
            <br />
            PLACEHOLDER PRICE
          </span>
        </PItem>
      </div>
    </div>
  );
}

const SLIDE_COMPONENTS = [InquirySlide, ProposalSlide, PaymentSlide, StaffingSlide, KitchenSlide, EnterpriseSlide];

function BuyDrawer({ open, onClose }) {
  const closeRef = useRef(null);
  const drawerRef = useRef(null);
  const [paying, setPaying] = useState(false);
  const [showProto, setShowProto] = useState(false);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => closeRef.current?.focus(), 60);
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const focusable = drawerRef.current?.querySelectorAll("button, a, [tabindex]");
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const handlePay = () => {
    setPaying(true);
    setTimeout(() => {
      setShowProto(true);
      setPaying(false);
    }, 900);
  };

  return (
    <>
      <div className={cx("qp-dh-scrim", open && "qp-dh-on")} hidden={!open} onClick={onClose} />
      <aside
        ref={drawerRef}
        className={cx("qp-dh-drawer", open && "qp-dh-on")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dhDrawerTitle"
        hidden={!open}
      >
        <div className="qp-dh-drawer-head">
          <span className="qp-dh-eyebrow">Test access</span>
          <button ref={closeRef} type="button" className="qp-dh-drawer-close" onClick={onClose} aria-label="Close panel">
            &#10005;
          </button>
        </div>
        <div className="qp-dh-drawer-body">
          <h5 id="dhDrawerTitle">Try QuotePilot for a dollar.</h5>
          <p className="qp-dh-d-lede">
            One dollar, one time. You get the full staff workspace with a sample event loaded &mdash; revise it, watch the consequences carry through, decide if it fits.
          </p>
          <ul className="qp-dh-included">
            <li>Full staff workspace access</li>
            <li>Morgan Wedding sample event, ready to break</li>
            <li>Quote &rarr; proposal &rarr; customer decision flow</li>
            <li>Your work carries over if you upgrade</li>
          </ul>
          <div className="qp-dh-order" aria-label="Order summary">
            <div className="qp-dh-orow">
              <span>
                QuotePilot test access
                <br />
                <span className="qp-dh-sku">TEST-ACCESS-01 &middot; ONE-TIME</span>
              </span>
              <span>$1.00</span>
            </div>
            <div className="qp-dh-osum"><span>Due today</span><span>$1.00</span></div>
            <p className="qp-dh-osub">NO SUBSCRIPTION STARTS UNLESS YOU CHOOSE ONE</p>
          </div>
          <button type="button" className="qp-dh-pay" onClick={handlePay} disabled={paying}>
            {paying ? "Contacting Stripe…" : "Continue to Stripe Checkout"}
          </button>
          <p className="qp-dh-secure">
            <svg viewBox="0 0 10 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <rect x="1" y="5" width="8" height="6" rx="1.2" />
              <path d="M3 5V3.5a2 2 0 0 1 4 0V5" />
            </svg>
            SECURED BY STRIPE &middot; CARD DETAILS NEVER TOUCH QUOTEPILOT
          </p>
          <p className={cx("qp-dh-proto-note", showProto && "qp-dh-on")} role="status">
            PROTOTYPE &mdash; IN PRODUCTION THIS CONTINUES TO STRIPE CHECKOUT
          </p>
          <p className="qp-dh-drawer-foot">QUESTIONS FIRST? BOOK A DEMO INSTEAD &mdash; NO DOLLAR REQUIRED.</p>
        </div>
      </aside>
    </>
  );
}

export default function DocumentHero({ showBuyCta = false }) {
  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [active, setActive] = useState(0); // 0 = "the change" default; 1-6 = tabs
  const [visited, setVisited] = useState(() => new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const swapTimer = useRef(null);

  const goTo = (next) => {
    if (next === active) return;
    if (next > 0) setVisited((prev) => new Set(prev).add(next));
    setSwapping(true);
    swapTimer.current = setTimeout(() => {
      setActive(next);
      setSwapping(false);
    }, reducedMotion ? 0 : 160);
  };

  useEffect(() => () => clearTimeout(swapTimer.current), []);

  const copy = COPY[active];
  const ActiveMiniSlide = active > 0 ? SLIDE_COMPONENTS[active - 1] : null;

  return (
    <section className="qp-document-hero" aria-labelledby="dh-title">
      <div className="qp-dh-grid">
        <div className={cx("qp-dh-copy", swapping && "qp-dh-swap")}>
          <span className="qp-dh-eyebrow">{copy.eyebrow}</span>
          <h1 className="qp-dh-h1" id="dh-title">{copy.h1}</h1>
          <p className="qp-dh-sub">{copy.sub}</p>

          {active > 0 && (
            <button type="button" className="qp-dh-back-link" onClick={() => goTo(0)}>
              &larr; Back to the change
            </button>
          )}

          <div className="qp-dh-tabs" role="tablist" aria-label="Follow the event">
            {SLIDE_LABELS.map((tab, i) => {
              const tabIndex = i + 1;
              const isActive = active === tabIndex;
              const isVisited = visited.has(tabIndex);
              return (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={cx("qp-dh-tab", isActive && "qp-dh-active")}
                  onClick={() => goTo(tabIndex)}
                >
                  <span className="qp-dh-tab-n">{tab.n}</span>
                  {tab.label}
                  {!isActive && isVisited && <span className="qp-dh-tab-check">&#10003;</span>}
                </button>
              );
            })}
          </div>

          <div className="qp-dh-cta-row">
            {showBuyCta && (
              <button type="button" className="qp-landing-button qp-landing-button-accent" onClick={() => setDrawerOpen(true)}>
                Try $1 test access
              </button>
            )}
            <a className="qp-landing-button qp-landing-button-dark" href="https://mbmapps.com/contact">
              Book a demo
            </a>
          </div>
          {showBuyCta && <p className="qp-dh-cta-note">ONE DOLLAR, ONE TIME &middot; NO SUBSCRIPTION STARTS</p>}
        </div>

        <div className="qp-dh-frame">
          {active === 0 ? (
            <TheChangeSlide reducedMotion={reducedMotion} />
          ) : (
            <ActiveMiniSlide live />
          )}
        </div>
      </div>

      {showBuyCta && <BuyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />}
    </section>
  );
}
