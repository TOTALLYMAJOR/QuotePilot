# After Quoting: The QuotePilot Transformation Engine

Last updated: 2026-08-28 05:25:12 CDT

Status: Approved design direction — experience blueprint, pre-implementation
Date: August 10, 2026
Owner: QuotePilot maintainers
Relationship to other docs: this document defines the destination experience.
Delivery mechanics, authority contracts, and release evidence remain owned by
their existing canonical docs (`docs/DOC_SYSTEM.md` governs ownership). Nothing
here claims deployment, provider acceptance, or gate promotion.

---

## Part 0 — The thesis

### 0.1 What quoting applications are

Every quoting application ever shipped — including QuotePilot today — is built
on the same quiet assumption: **the user operates the software.** The user
fills the form, understands the pricing structure, assembles the line items,
walks the workflow, manages the statuses, notices what is missing, writes the
proposal, remembers to follow up, interprets the dashboard.

The software stores, multiplies, and renders. The human does the cognition.

That division of labor made sense when software could only store and multiply.
It no longer does. A quoting application in 2026 is a filing cabinet that
learned arithmetic.

### 0.2 What comes after

What comes after quoting applications is not a better quoting application. It
is a **transformation system**: a product whose job is to move a person and an
opportunity through a specific arc —

```
uncertainty → clarity → structured opportunity → viable commercial offer
            → confident customer decision → booked event
```

— while consuming as little of the person's cognition as possible.

The user enters with scattered material: a phone call, a forwarded email, a
half-remembered venue walkthrough, "wedding, maybe 120 people, August." The
user leaves with a structured event, validated assumptions, profitable
pricing, identified risks, a polished proposal, a collected deposit, a
contract-ready scope, follow-up already running, and a defined next action.

The division of labor inverts:

| The person provides | QuotePilot provides |
|---|---|
| Judgment | Structure |
| Taste | Memory |
| Relationships | Calculation |
| Accountability | Orchestration |
| Final word | Prediction |
| | Execution |

The interface's ambition is to disappear in proportion to how well the system
understands the intent. Not "fewer clicks" — **fewer decisions that were never
really the user's to make.**

### 0.3 Why QuotePilot can be first

The strategic discovery of this design exercise: **the hard half of the
transformation engine already exists in this repository, dormant, below the
waterline.**

- Server-authoritative pricing that refuses stale catalogs and re-prices on
  every trusted write (`functions/pricingEngine.js`).
- Immutable versions, acceptance receipts with signer/revision/hash evidence,
  and terminal decisions (`functions/proposalAcceptance.js`).
- A simulate → authorize → apply-atomically change protocol with named
  dependency invalidations and Decision Debt scoring (Commercial Change
  Authority).
- Deterministic follow-up lanes with consent, quiet hours, stops, and
  provider-webhook truth (Revenue Autopilot).
- An attention engine that already ranks change requests, approvals, overdue
  follow-ups, closeouts, and unread replies (`buildWorkflowAttentionSummary`).
- A readiness model with twelve weighted criteria (`proposal-readiness-v1`).
- Staffing ratios, upsell rules, seasonal pricing, event templates with
  ownership-tracked defaults, anniversary rebooking radar.

What sits **above** the waterline is a five-step wizard, a 14-column history
table, ten navigation destinations, and a 4,155-line `App.jsx` asking the user
to operate all of it.

The engine exists. The deck is the problem. **This design replaces the deck.**

### 0.4 The honesty law

QuotePilot's culture has one non-negotiable that survives every reinvention in
this document, because it is the reason users will trust an engine that acts:

> **Advisory intelligence may estimate, and must say so.
> Authority never estimates.
> Every automated act leaves a receipt.**

Approved is not paid. Paid is not booked. Booked is not ready. Provider
acceptance is not delivery. A recommendation is not a fact. The new experience
makes the product feel effortless precisely because the user never has to
wonder which of those a claim is — the system already keeps them separate
(`docs/patterns/quotepilot-product-operating-model-discovery.md`), and the new
surface language inherits that discipline invisibly.

---

## Part 1 — What survives: business truth

Reinvention needs a floor. These are the truths preserved because they are
true about the business, not because they are built.

### 1.1 The protected invariants

| Invariant | Where it lives today | How the new experience carries it |
|---|---|---|
| Final pricing is computed by trusted server logic; browser totals are previews, never authority | `calculateQuotePricing`, `server_authoritative` vs `client_preview` (`src/lib/pricingContracts.js:5`) | Every number the engine shows is either the authoritative figure or is visibly a live preview that resolves to one before anything is sent |
| Sent and accepted versions are immutable; changes create versions with provenance | `quotes/{id}/versions`, rebook provenance | The event's "story" is readable history over immutable versions; undo never rewrites sent truth |
| Customer may view, ask, request, approve, sign, pay — never mutate authoritative pricing or internal records | portal snapshot projection (`buildPortalSnapshot`), callable-only acceptance | Client collaboration parses requests into governed changes that staff approve in one tap; the tap is the authority |
| Acceptance is terminal, receipt-backed, atomic across quote and portal | `proposalAcceptanceReceipts`, consent version `proposal-acceptance-v1` | The "booked ceremony" is the same receipt, dressed for humans |
| Payment truth comes only from signed provider events; deposit and final balance are separate rails; ambiguous outcomes stay resumable, never double-send | payment ledger, dispatch records, `Resume Pay Request` | The cascade reports "deposit requested / deposit paid" only on provider evidence; ambiguity surfaces as a resumable card, not a retry button |
| Delivery evidence is layered: provider-accepted ≠ delivered ≠ viewed; only a real portal visit is "viewed" | `deliveryEvidence`, `docs/DOC_SYSTEM.md` proof-sensitive language | Client-activity intelligence interprets only true portal visits; it never invents "seen" |
| Tenant isolation fails closed; no org context, no data | `firestore.rules`, workspace scope | Unchanged, invisible |
| A tenant cannot quote until an admin has confirmed real pricing at the current catalog revision | `pricingConfirmation` receipt, starter packs | Onboarding becomes "teach the engine your business," and the same receipt is the graduation moment |
| Sales requests, admin approves, server executes — with scope digests binding the approval to exact revision and portal | `APPROVAL_ACTIONS`, `actionScopeDigest` | One-tap decisions are still role-gated; the tap carries the same scope binding |
| Ops staff see execution detail, never margins or internal notes | BEO projection boundary | The kitchen sheet remains a costless projection |

### 1.2 The commercial spine that survives

The pricing model is business truth, not UI debt. It survives whole:
per-person packages with inclusion de-duplication; add-ons/rentals/menu items
in `per_person` / `per_item` / `per_event` modes; staffing labor by role,
rate, and charge mode; two-tier travel; guest-tiered service fee; regional
tax that exempts labor and travel but taxes the service fee; seasonal
multipliers; deposit percentage; validity windows; a 400-guest capacity bound
(`src/lib/quoteCalculator.js:257-452`). Likewise the lifecycle truth domains —
quote status, payment states, booking confirmation, portal decision, follow-up
stage — remain **separate truth domains**. The new experience stops asking the
user to *manage* them; it never stops keeping them distinct.

### 1.3 New truths this design requires

Four things the business needs that the system does not yet model. They are
prerequisites for the intelligence promised below, and each degrades honestly
until it exists.

1. **Unit economics.** Today there is no cost model — no item cost, no labor
   cost, no margin anywhere in the schema. Margin intelligence ("this event is
   4.2% below your floor") requires tenant-entered or imported costs per
   catalog item and per labor role, plus a target-margin policy in settings.
   Until a tenant provides costs, the engine shows revenue composition and
   price-per-guest intelligence and says plainly: "Margins unavailable — add
   costs to your catalog to unlock them." It never fabricates a margin.
2. **Uncertainty-typed facts.** Guest count today is one integer. The engine
   needs values that can be *exact*, *approximate*, *ranged*, or *unknown with
   a likely default* — with confidence propagating into money (§4.2). The
   accepted phased boundary that preserves the exact commercial pricing basis
   while adding planning, confirmation, and post-event evidence is now defined
   in `docs/ATTENDANCE_STATE_ADR.md`; current implemented capability remains
   narrower and is tracked in `docs/FEATURE_MATRIX.md`.
3. **Structured change requests.** Today a customer's "can we swap salmon for
   chicken?" is freeform text (an acknowledged gap in `DEV_TASKS.md`). The
   engine needs the request parsed into a governed, priceable change bound to
   the quote version it was made against.
4. **Durable commercial memory.** Selections, seasonal patterns, venue quirks,
   and customer preferences exist as scattered records. The engine needs them
   readable as defaults with provenance ("Based on 14 plated events at this
   guest count").

### 1.4 Explicitly not preserved

Available for demolition: the five-step wizard as the creation path; the
36-field initial form; navigation as ten destinations; the quote history
table as a primary surface; the modal/route duality; statuses as things users
set; dashboards that report instead of interpret; Save/Refresh/Apply buttons;
the assumption that a quote begins empty.

---

## Part 2 — Three models

Three radically different products, each designed as if it were the answer.
Each is explained through the same eight questions, then pushed until it
breaks. The final design (Part 3) is built from the strongest organs of all
three.

---

### Model A — The Invisible Operating System

*"There is no app. There is a stream of judgment."*

**Premise.** QuotePilot becomes a chief of staff. It watches every channel,
advances every opportunity autonomously, and surfaces exactly one thing to the
human: moments that require judgment. The product is not a place you go; it is
a stream of prepared decisions that come to you.

**How the user begins.** They don't. Work begins when information arrives —
a forwarded email, a voice note dictated after a call, a pasted text thread, a
photo of handwritten notes. Arrival *is* creation. There is no "New Quote"
because there is no blank state; there is only material, and the engine
structures whatever it receives.

**How information is gathered.** The engine works with what it has and keeps
a ledger of what it lacks. It asks the user questions only when genuinely
blocked, batched into one card ("Two things before this can go out: which bar
package, and is the venue's kitchen usable?"). With permission, it asks the
customer directly — politely, in the tenant's voice, on the tenant's schedule.

**How pricing emerges.** Silently and continuously, from catalog, policies,
season, and history. The user never sees a pricing screen; they see price only
inside decisions: "Send at $11,736? Margin 31%, inside your floor."

**How problems are resolved.** There are no warnings. Anything the engine can
fix, it fixes and files a receipt. Anything it cannot, it converts into a
prepared resolution: "This event likely needs two more servers — Add 2
(+$264)." A problem without a pathway is a bug in the engine, not a state the
user should ever see.

**How the proposal is created.** When readiness crosses the tenant's
threshold, a complete proposal is drafted and parked one tap from sending. The
user's involvement is a 20-second review of decisions the engine annotated as
judgment-worthy.

**How the client collaborates.** Replies in any channel are parsed; impacts
computed; staff sees "Approve · Modify · Reply," each pre-drafted.

**How the event becomes booked.** Acceptance triggers the whole cascade —
lock, contract, deposit request, calendar, team, production record — and the
user receives one line: "Rivera Wedding is booked. Deposit requested.
Everything else is done."

**What disappears.** Navigation, forms, dashboards, statuses, the builder,
and the quote as a noun. Only events, decisions, and receipts remain.

**Where it breaks alone.** Opacity. Experts lose the ability to *look at the
whole event* — to walk the scope, feel the menu, sanity-check the shape of the
thing they are accountable for. Judgment needs a place to stand. When the
engine is wrong (and it will be, on the worst possible day — a 400-guest
gala), a stream of decisions gives the user nowhere to grab the controls. And
an engine that acts without a body invites the exact overclaiming this
codebase spent two years refusing: "done" with no inspectable thing that is
done. Model A is the right *will* and the wrong *whole product*.

---

### Model B — The Living Event Canvas

*"One living object. Every artifact is a view of it."*

**Premise.** Each opportunity is a single living object on a canvas — part
document, part model. Prose crystallizes into structure in place; structure
stays malleable like prose. The quote, the proposal, the kitchen sheet, and
the contract scope are not files; they are projections of the one object.

**How the user begins.** A blank canvas asks: *"What are you planning?"* They
type, dictate, or paste anything. "Corporate dinner, ~80, upscale but relaxed,
around $12k" becomes — visibly, in place — a guest-count chip (~80, medium
confidence), a budget envelope ($12,000), a tone note, and a recommended
structure drawn from the tenant's own catalog and history. The text remains
readable; the structure lives inside it.

**How information is gathered.** Gaps are part of the object's body: a soft
slot where the venue should be, a date chip that says "August — day unknown."
Nothing is a form error. Filling a slot anywhere — typing, tapping a
suggestion, forwarding an email that contains the answer — closes it
everywhere, and the readiness ring around the event's title advances.

**How pricing emerges.** A live commercial panel is pinned to the canvas:
total (as a band while facts are soft), margin (when costs exist), deposit.
Every touch of the object reprices it. Uncertain facts price as ranges;
confirming a fact visibly narrows the band — the user *watches* certainty buy
precision.

**How problems are resolved.** Annotations attached to the thing itself: the
bar block carries "likely underspecified for 120 — Upgrade (+$1,854)"; the
date chip carries "Saturday in Summer Peak — pricing includes the seasonal
adjustment." Every annotation is also its own fix.

**How the proposal is created.** The proposal is the client-safe projection
of the same object — brand-dressed, cost-stripped, option-bearing. "Preview as
client" is a lens, not an export. Sending publishes an immutable version of
the projection; the canvas keeps living.

**How the client collaborates.** The client's decision room accepts choices,
questions, and requests; each arrives on the canvas as a suggested edit with
computed impact — tracked changes for commerce. Accepting a suggestion is one
tap; the object re-prices; the projection refreshes.

**How the event becomes booked.** The object seals. The accepted version
freezes with its receipt; production projections (kitchen sheet, run of show,
schedule block) unlock from the sealed record; the canvas visibly shifts from
"selling" to "delivering."

**What disappears.** Forms, files, exports, Save, the separate
quote/proposal/BEO artifacts, and the status page — lifecycle is worn by the
object itself.

**Where it breaks alone.** A canvas has no will and no voice. It doesn't know
that *this* event, of nineteen, deserves your 9 a.m.; it doesn't chase the
final guest count while you sleep; it doesn't read email. It is also spatially
greedy — glorious on a desktop, cramped on the phone in a venue hallway, which
is where this business actually happens. Model B is the right *body* with
nothing driving it.

---

### Model C — The Conversation-to-Commerce Engine

*"The deal is a conversation. The quote is a message that grew up."*

**Premise.** Everything is a thread. Customer inquiries land as conversations;
QuotePilot drafts the replies; structured commercial objects — offer cards,
option cards, impact cards — ride inside the messages. The business runs its
pipeline the way it already runs its life: through an inbox, except this inbox
writes back.

**How the user begins.** They don't create; they *receive*. An email, an SMS,
a portal message, a transcribed voicemail opens a thread. The engine's first
draft reply is already attached: warm prose in the tenant's voice, with a
structured starting plan folded inside it.

**How information is gathered.** The engine interleaves its open questions
into natural correspondence — never twenty questions, always the two that
unblock the most value, asked the way a seasoned catering director would ask
them. Every customer answer updates the structure; staff see the extraction
beside the prose ("guest count: 120 → 135, updated from Tuesday's email").

**How pricing emerges.** As offer cards in the thread — computed server-side,
rendered as a clean commercial object with a delta label when it revises an
earlier card ("+$1,854 — premium bar added").

**How problems are resolved.** Problems become drafted messages. "Final counts
are due Friday" is not a task on a list; it is a ready-to-send note in the
thread, phrased for this customer, queued at a polite hour.

**How the proposal is created.** The thread graduates: at readiness, the
engine composes the decision room — a beautiful private page that is the
conversation's crown, linked (never attached) from a drafted message.

**How the client collaborates.** Literally the medium. "Can we swap salmon
for chicken?" → parsed request card → staff taps Approve → proposal updates →
reply drafts itself. Negotiation, Q&A, and acceptance all live where the
customer already is.

**How the event becomes booked.** In-thread: acceptance and deposit happen in
the decision room, and the thread seamlessly becomes the event's story —
every message, decision, and receipt in one chronology.

**What disappears.** The back office. CRM screens, activity logging (the
thread *is* the log), "sending the quote" as a separate act, follow-up task
lists, and the entire idea that customer communication and commercial state
are different systems.

**Where it breaks alone.** Linearity. A 120-guest plated wedding with rentals,
staffing, and a timeline is not a scroll; experts need direct manipulation of
the whole, not archaeology through messages. Margins and operations have no
home in a chat. And a conversation-first product drifts toward
chatbot-with-sparkles — the exact aesthetic this product bans. Model C is the
right *voice* with no body to point at.

---

## Part 3 — Synthesis: The Pilot

### 3.1 The fusion

The name was the spec all along. QuotePilot has been a cockpit — dense
instrumentation, human flying. The product that comes after quoting
applications is **the pilot**: the user commands; the system flies.

| Organ | Taken from | What it contributes |
|---|---|---|
| **The Will** | Model A | An engine that continuously advances every opportunity, triages attention, batches questions, executes cascades, and files receipts |
| **The Body** | Model B | One living event object per opportunity — uncertainty-typed, live-priced, annotated — of which every artifact is a projection |
| **The Voice** | Model C | Channels as intake, prose parsed into governed structure, drafted-for-you messages, and the proposal as a decision room the client actually enjoys |

Five fusion rules govern how the organs combine:

1. **The engine advances; the object holds truth; channels carry it.** No
   organ duplicates another's job. The engine never stores state the object
   doesn't hold; the thread never becomes the record; the object never nags.
2. **Judgment is the only mandatory human act.** Everything else — structure,
   memory, calculation, orchestration, prediction, execution — is the
   system's, with receipts.
3. **Every problem ships with its resolution.** A surfaced issue without a
   one-tap pathway is a defect.
4. **Certainty is progressive; authority is exact.** Estimates live openly as
   bands and assumptions. The moment money becomes commitment — send, accept,
   invoice, deposit — the authoritative engine prices exactly or the gate
   holds.
5. **The honesty law outranks delight.** The engine may be wrong; it may
   never be falsely confident. "Done" means receipt-backed done.

### 3.2 The experience at a glance

```
┌────────────────────────────────────────────────────────────────────┐
│  NOW          the stream: what deserves attention, pre-resolved    │
│  EVENTS       every living opportunity — each opens an Event Room  │
│  CREATE       express intent: type, talk, paste, forward           │
│  CLIENTS      relationships and memory, working forward            │
│  ────────────────────────────────────────────────────────────────  │
│  THE PILOT    the command line over everything: ask it, tell it    │
│               (⌘K · hold-to-talk · reachable from any surface)     │
└────────────────────────────────────────────────────────────────────┘
```

Four calm surfaces and a command line. Inside an Event Room, the old
navigation vocabulary is replaced by the event's own momentum — **build,
decide, send, win** — expressed as a readiness ring, a decide stack, a send
gate, and a booked ceremony, not as pages. The exploration's NOW / BUILD /
DECIDE / SEND / WIN grammar survives as *the arc every event travels*, while
the app itself needs only the four nouns above. Schedule, reporting, catalog,
and administration persist as rooms the engine walks you into when relevant —
not as destinations you patrol.

---

## Part 4 — The final design

### 4.1 The living opportunity

Every opportunity is one object with eight continuously-maintained ledgers —
the engine's working memory, and the source of everything every surface shows:

| Ledger | Contents | Feeds |
|---|---|---|
| **Known** | Facts with provenance and confidence (guest count: 120, exact, confirmed by client Aug 12) | Canvas, projections, pricing |
| **Unknown** | Open slots, ranked by commercial consequence | The one next question; readiness ring |
| **Next** | The single highest-value missing thing | NOW cards; "Finish it" actions |
| **Likely** | Memory-based defaults awaiting confirmation ("this venue usually needs extra setup labor") | Assumption ledger; recommendations |
| **Risky** | Margin floor breaches, capacity bounds, date conflicts, expiring validity, silent proposals | Risk annotations; NOW escalations |
| **Should happen** | Recommendations with computed impact | Decide stack |
| **Automatable** | Work the engine can do alone (drafts, reminders, cascade steps) | Autopilot lanes; receipts panel |
| **Needs judgment** | Decisions reserved for the human, each framed with basis and impact | Decide stack, decision moments |

This is not a new backend invention — it is the generalization of what already
exists: `proposal-readiness-v1` is the first Unknown ledger; workflow
attention is the first Next; upsell rules are the first Should-happen;
Decision Debt is the first Risky; Revenue Autopilot lanes are the first
Automatable. The design's demand is that these become **one model with one
grammar**, not seven features with seven vocabularies. (This also finally
fills the Event Workspace dials CWF-17 left honestly "unavailable.")

### 4.2 Progressive certainty

Uncertainty is a first-class value, not a validation error.

```
guests: 120            exact
guests: ~120           approximate  (±10% band by default)
guests: 100–130        range
guests: unknown        likely 120   (from event type + venue memory, labelled)
```

Money computed over soft facts is a **band with a confidence label**, and the
system says what would narrow it:

```
Estimated total   $10,850 – $12,400      Confidence: medium
                  Confirming guest count narrows this to ±$150.
```

Certainty propagates mechanically: a ranged guest count widens base, staffing,
rentals, service-fee tier, tax, and deposit together — the same authoritative
formula evaluated over an interval, never a hand-wave. Three **certainty
gates** protect commitment:

- **Send** — a proposal may carry soft *scope* ("final count due Aug 12") but
  its money is exact: the authoritative engine prices the stated assumption
  set, and every priced assumption is visible to the client as an assumption,
  with its true-up rule ("priced at 120 guests; each additional guest adds
  $94.50").
- **Accept** — acceptance binds the exact revision and assumption set into
  the receipt, as it already does.
- **Money** — deposit and balance rails only ever fire on exact,
  provider-verifiable amounts. Bands never reach an invoice.

False precision is the old world's disease; false commitment would be the new
world's. The gates keep both out.

### 4.3 The surfaces

#### 4.3.1 NOW — the interpreted morning

The home surface answers one question — *what deserves my attention right
now?* — with cards that are conclusions, not data.

```
NOW                                            Tuesday, August 10 · 7:42 AM

●  Rivera Wedding                                        Aug 22 · 120 guests
   Ready except one thing: the final guest count is due today.
   I've drafted the ask.                            [Send it]  [Open event]

●  Carter Gala                                          Sep 14 · ~300 guests
   Proposal viewed 3 times since Friday, twice on pricing. No reply.
   A gentle nudge is drafted, and a simplified package comparison
   is attached.                                  [Review & send]  [Not yet]

●  Hartline Corporate Dinner                              Aug 28 · 80 guests
   Margin slipped to 22.4% — below your 26% floor — after the menu
   change. Raising the package $3.25/guest restores it; so does
   swapping the passed appetizer.                  [See both options]

▸  Quiet wins overnight: 2 follow-ups sent, 1 deposit reminder,
   catalog prices reconfirmed.                              [Receipts]
```

Rules of the surface: at most a handful of cards; every card carries its
resolution; the priority order is the existing attention engine's (change
requests, then blocked/overdue closeouts, overdue follow-ups, approvals,
acknowledged requests, due items — `src/lib/quoteWorkflow.js:393`), extended
with commercial risk; and "quiet wins" folds every automated act into one
dismissible line backed by receipts. The user never interprets a dashboard.
The business has already been interpreted.

Reporting doesn't vanish — it moves downstream of interpretation. Ask the
Pilot "how did July close?" and the reporting room opens with the same
provider-verified figures the current dashboard insists on, narrated.

#### 4.3.2 The Event Room — the living object, inhabited

One room per opportunity. Top to bottom, it answers: how close is this to
won, what should I decide, what is this event, and what has happened.

```
RIVERA WEDDING                                     ○ 85% ready to send
Aug 22 · Hill Country Pavilion · 120 guests · plated

The Pilot: "You have enough to price this. Before it goes out I
recommend confirming the ceremony-to-reception gap — it drives one
extra service hour — and the bar is likely light for this crowd.
Everything else is solid."

DECIDE  ────────────────────────────────────────────────────────────
  1  Bar package is likely underspecified
     Premium bar chosen at 14/gal historical pace for 120 guests
     in August heat. Upgrade adds +$1,854 revenue · +$2,406 total
     with fee and tax · margin 29.1% → 30.3%.
     Based on: 11 similar events, 3 at this venue.
                                 [Upgrade bar]  [Keep as is]  [Why?]

  2  Staffing below house ratio for plated service
     Plated at 120 guests calls for 10 servers · 3 chefs (your
     ratios). Currently 8 · 3. Adding 2 servers: +$264 labor.
                                        [Add 2 servers]  [Adjust…]

THE EVENT  ─────────────────────────────────────────────────────────
  Menu          Passed appetizers · plated duet · dessert display
  Bar           Premium, 2 bartenders, 6 hours
  Staff         8 servers · 3 chefs        ⚠ see Decide 2
  Rentals       Linens ×12 · chafer sets ×6 · [venue provides tables]
  Assumptions   120 guests (final count due Aug 12) · 6-hour service
  Money         $15,423 total · 30.5% margin · $4,627 deposit (30%)
                                     [Preview as client]  [What if…]

STORY  ─────────────────────────────────────────────────────────────
  Aug 9  9:42   Inquiry arrived (email → structured)
         9:44   Starting plan drafted from Wedding template
  Aug 9  10:03  You confirmed menu direction
  Aug 10 7:51   Guest-count ask sent · awaiting reply
```

- **The readiness ring** is `proposal-readiness-v1` worn as a single motion:
  twelve weighted criteria, one ring, filling as slots close. It completes
  smoothly (the existing motion system's 900ms reveal) and the room's header
  shifts to **"Ready to send."** No confetti. A ring, a sentence, and the
  send gate opening.
- **The decide stack** holds only judgment-worthy items, each in the decision
  grammar of §4.4. Empty is a state of honor: "Nothing needs you."
- **The event body** is Model B's canvas, disciplined: scope blocks with
  inline annotations, every value touchable, every touch repriced live (the
  existing DigitRoll odometer animating money changes).
- **The story** is Model C's thread grown up: intake, drafts, sends, views
  (true portal visits only), decisions, payments, receipts — one chronology.
  Reading the story *is* understanding the opportunity.
- **Projections** hang off the room: client decision room, kitchen sheet
  (BEO, costless), contract scope, schedule block. One object, many dresses.

#### 4.3.3 CREATE — intent in, starting plan out

"New Quote" dies. CREATE opens a quiet intelligent surface:

```
What are you planning?

  Type it, say it, paste an email or a text thread, drop a PDF
  or a photo of your notes. A previous event works too.
```

Input: typing, voice, paste, forwarded email, image, prior event, template.
The engine extracts facts with confidence, chooses the closest template
(wedding / corporate / bbq / community — the tenant's own event types and
starter-pack lineage), applies ownership-tracked defaults (the existing
mechanism: template-set values yield to user edits and revert cleanly,
`src/lib/wizardUi.js:98-225`), prices what it can, and opens the Event Room
at whatever readiness the material supports:

```
"Corporate dinner for about 80. Client wants upscale but relaxed.
 Budget around $12k."

────────────────────────────────────────────────────────────────────
I've started the plan.                          ○ 45% ready

  Corporate dinner · ~80 guests · budget envelope $12,000
  Recommended: cocktail hour → dinner → beer & wine · 4 servers
  Estimated $10,800 – $12,600 (medium confidence — guest count
  and date will narrow this)

  Open: venue? · date? · dietary needs?
                                            [Open the event room]
```

Thirty seconds from paste to priced starting plan. The five-step wizard's
*validation truths* (required facts, hour bounds, capacity, catalog
reconciliation) survive as engine rules; the wizard itself does not survive.

#### 4.3.4 CLIENTS — memory that works forward

The directory and Customer 360 already exist; this surface changes their
posture from archive to advisor. A client record leads with what memory
*implies*: "The Hartlines booked premium bar last year and asked for the
vegetarian duet — both are pre-selected in the new plan." Anniversary radar
(already built) feeds NOW: "The Okafor retreat booked this week last year —
a rebook draft is ready," landing on the existing exact-version rebook rail.

#### 4.3.5 THE PILOT — the command line

Everywhere, one keystroke or one held button away (⌘K exists today as search;
it graduates to command):

- **Ask:** "What's our margin if the count hits 150?" · "Which events are
  waiting on clients?" · "How did July close?"
- **Tell:** "Add another bartender and switch dinner to buffet." · "Give the
  Carters until Friday, then nudge." · "Knock this under $10k without
  touching the menu."

Every *tell* runs as a simulation first and presents the effect before it
touches the live object (§4.6). Voice and text are the same channel with the
same preview-confirm contract.

### 4.4 The decision grammar

One anatomy for every judgment moment, everywhere — NOW card, decide stack,
client request, voice confirmation:

```
CLAIM        Bar package is likely underspecified.
BASIS        11 similar events; 3 at this venue; August heat.       ← provenance, always
IMPACT       +$1,854 revenue · +$2,406.49 total after fee & tax
             cascade · margin 29.1% → 30.3% · deposit +$721.95
ACTIONS      [Take it]   [Adjust…]   [Not this time]   [Why?]
```

Grammar rules:

- **Never a warning without a pathway.** "Staffing incomplete" is banned;
  "This likely needs 2 more servers — Add 2 (+$264)" is the form.
- **Impact is the honest cascade.** A $15.45/guest add-on is a $2,406.49
  decision once the 18% service-fee tier and the tax region do their work —
  the engine shows the number that will actually appear on the proposal,
  which is exactly what manual quoting gets wrong.
- **"Why?" opens the glass engine.** Every recommendation explains itself:
  the rule, the records, the math. Advisory conclusions carry their model id
  (the house already versions them: `proposal-readiness-v1`,
  `decision-debt-score-v1`), surfaced as plain language.
- **Declining teaches.** "Not this time" is a signal; three declines of the
  same suggestion for a client mutes it for that client and remembers why.
- **Undo replaces confirmation.** Reversible acts execute immediately with a
  quiet undo window; confirmations are reserved for the genuinely
  irreversible (send, rotate link, delete) — which stay behind their existing
  role-gated approvals, re-dressed as one-tap decisions with the same scope
  digests underneath.
- **Autosave is ambient.** Nothing asks to be saved. Sent truth is immutable;
  everything before it is a living draft with history.

### 4.5 The living price

The price is a continuously-true model of the deal, not a step-4 summary.

- **Always current.** Every fact change reprices the preview instantly;
  every commitment reprices authoritatively server-side. The two are visibly
  the same number or the send gate holds — the existing
  `client_preview` / `server_authoritative` contract, worn honestly.
- **Every decision shows its money before it happens** (§4.4), including
  fee/tax cascade and deposit movement.
- **Margin, once taught.** With unit economics entered (§1.3), the room shows
  margin live, the engine holds a target-margin policy per tenant, and
  commercial intelligence activates:
  - "4.2% below your floor. Raising the package $3.25/guest restores it;
    so does swapping the passed appetizer for the display."
  - "Events like this usually carry a cake-cutting fee — yours doesn't."
  - "This venue historically runs +90 minutes of setup labor."
  - "Your labor assumption is low for plated at 120; house ratio says 10
    servers." (`STAFF_RULES`, already in settings.)
- **Two faces, one truth.** Staff see composition, cost, margin, and levers.
  The client's projection shows investment, inclusions, options, and
  assumptions — never costs, never internal notes. Same object, different
  glass; the portal snapshot boundary already enforces exactly this.

### 4.6 What-if: simulation as a native verb

The engine's most underused existing muscle — Commercial Change Authority's
simulate → authorize → apply-atomically protocol — becomes the product's
defining interaction:

```
"What if the count hits 150?"

  SIMULATION — not applied
  Total $15,423 → $18,977 · margin 30.5% → 31.2%
  Staffing rises to 13 servers · 4 chefs (house ratio)
  Service-fee tier holds at 18% · capacity fine (150 ≤ 400)
  Rentals: +4 linens, +2 chafer sets
                        [Adopt this]  [Save as scenario]  [Discard]
```

Scenarios are cheap, parallel, and inert until adopted. Adoption runs the
governed path — authoritative re-price, atomic apply, named downstream
invalidations (the kitchen sheet knows it went stale), receipts — without the
user ever hearing those words. Good/better/best (already built as
`buildQuoteScenarios`) becomes one preset among freeform what-ifs: "Get this
under $10,000 without touching the menu" returns the two or three honest ways,
each a card, each adoptable.

### 4.7 The proposal: a decision room, not a document

What the client receives is a private, branded, quietly ceremonial page — the
existing dark-and-gold portal elevated from "view and decide" to "decide with
pleasure":

- **Composed, not exported.** Cover, event summary, experience narrative,
  menu, services, options, investment, assumptions (with true-up rules),
  deposit, terms, acceptance. Generated from the object; always the sent
  version's exact truth.
- **Interactive where it counts.** Options the staff marked decidable are
  live: choosing *Premium Bar* shows its price effect and, on acceptance,
  lands as a governed change with receipt — the client feels agency; the
  business keeps authority.
- **Questions in place.** "Ask about this" on any block opens the existing
  conversation rail, threaded to that block.
- **The ceremony is preserved.** Legal-name signature, consent language,
  immutable receipt, terminal decision — unchanged law
  (`proposal-acceptance-v1`), better dressed.
- **Activity becomes counsel, honestly.** Only true portal visits count
  (delivery-evidence discipline intact). The engine interprets rather than
  reports: "Viewed three times, pricing twice, premium package expanded
  repeatedly — they're comparing. The simplified comparison is drafted."

### 4.8 Client collaboration without ping-pong

The customer writes prose; the business receives structure:

```
CLIENT REQUEST — via decision room, 11:24 AM
  "Could we do chicken instead of the salmon? And is there any
   way to add a late-night snack?"

  Parsed as two requests against v0004:
  1  Swap salmon entrée → herb chicken     −$4.20/guest · −$504
     margin 29.1% → 30.3%                       [Approve]  [Modify]
  2  Add late-night snack station           not in catalog — nearest:
     "Street Taco Station" +$8.50/guest         [Offer it]  [Reply]

  Drafted reply covers both. Nothing is promised until you approve.
```

This is the structured change request the backlog already names as unbuilt
(`DEV_TASKS.md`, Customer & Payments Decision Tracks) — designed here as the
only way customer intent enters the object: parsed, priced, version-bound,
approved by a human tap that carries the authority. The freeform message
always remains attached; parsing failure degrades to "they wrote — read it,"
never to a guess.

### 4.9 The invisible cascade

Acceptance today ends the software's help and begins the human's checklist.
In the new experience, acceptance begins the cascade:

```
RIVERA WEDDING IS BOOKED                              Aug 12, 3:04 PM
  ✓ Accepted by Elena Rivera — receipt #pa-…            3:04 PM
  ✓ Version locked (v0006)                              3:04 PM
  ✓ Contract scope generated (C-260812-…)               3:04 PM
  ✓ Deposit request prepared — $4,627                   3:05 PM
  ✓ Deposit request sent (provider accepted)            3:06 PM
  ✓ Calendar blocked · conflicts checked                3:06 PM
  ✓ Team notified · kitchen sheet drafted               3:07 PM
  ○ Deposit paid                                   — awaiting provider
```

Cascade law, inherited whole from the payment rails' design: every step
reports done **only on its own evidence**; provider-dependent steps show
provider truth; an ambiguous outcome becomes a resumable card ("the deposit
email's fate is unclear — Resume safely") that reuses the existing
resume-without-double-send machinery; and the user can open the receipts
panel behind any line. Post-booking, the same engine keeps flying: guest-count
true-up at the assumption's due date, final balance at 14/7/3 days (the
existing autopilot lane), production checkpoints on the existing kitchen
timeline, post-event closeout seven days after service, review request, then
anniversary radar — the event's afterlife handled by lanes that already exist,
finally speaking one language.

### 4.10 Memory: the compounding moat

The engine learns from the tenant's own records, and only those (tenant
isolation is absolute; there is no cross-tenant learning):

- **Catalog memory** — what is chosen together, what upgrades from what.
- **Event-shape memory** — staffing, hours, and rental reality by event type
  and guest band, versus what was quoted.
- **Venue memory** — setup labor, kitchen constraints, rental gaps.
- **Client memory** — preferences, pace of decision, price sensitivity,
  last year's choices pre-selected this year.
- **Season memory** — the existing seasonal profiles, eventually fitted to
  the tenant's own calendar rather than defaults.

Every learned default carries provenance and yields to the human instantly —
the template-ownership mechanism generalized. Cold start is honest: a new
tenant gets starter-pack intelligence ("industry ratios") clearly labelled
until their own history earns authority. The moat compounds: after fifty
events, QuotePilot quotes *this* business, not catering in general — and no
competitor can import that.

### 4.11 Voice, mobile, and the venue hallway

Mobile is not the desktop compressed; it is NOW plus the Pilot. Standing in a
venue with a client:

```
🎙  "Add another bartender, switch dinner to buffet, and the
     ceremony's moving to five."

  PREVIEW — Hartline Corporate Dinner
  +1 bartender (+$180) · plated → buffet (staffing 10 → 6 servers,
  −$528 · buffet package −$6/guest) · timeline shifted 5:00 PM
  Total $15,423 → $13,876                    [Apply]  [Discard]
```

One thumb, three seconds, preview-confirm — the same simulation contract as
everywhere. Photos of a venue's loading dock land in venue memory; a voice
note after the walkthrough becomes structured facts by the parking lot. The
readiness ring, the decide stack, and send all work one-handed. Building the
*whole* of a complex event remains a desktop pleasure; running your day never
requires a desk again.

### 4.12 Character

The product should feel like a superb catering director who happens to be
software: calm, prepared, unhurried, occasionally wry, never showy.

- **No AI theater.** No sparkles, no gradient badges, no chat bubbles as
  identity, no "AI is thinking…" Intelligence is evident through behavior:
  the thing you were about to do is already prepared.
- **The moments to engineer:** "Oh, it already knew." · "Oh, it already did
  that." · "Oh, I don't have to think about that anymore."
- **Delight is restraint.** The readiness ring completing. The DigitRoll
  odometer rolling money. The shimmer-chime (already built, user-toggleable)
  on a booked event. "Ready to send." "Rivera Wedding is booked." Full stop.
- **Microcopy law:** verbs over nouns, outcomes over mechanisms, one breath
  per sentence. The engine says "I've drafted the ask," never "Follow-up
  automation has generated a pending communication artifact."
- **Visual system:** one language instead of today's four palettes — the
  workspace's cream/ink/gold as the staff daylight, the portal's
  midnight-and-gold as the client ceremony, Bodoni Moda for identity and
  Manrope for work, the existing motion tokens (140/240/480/900ms) and
  `prefers-reduced-motion` discipline throughout. Premium hospitality, not
  tech product.

### 4.13 Zero training, by construction

A first-time user understands the product because every surface leads with a
sentence in their professional language and every action explains its
consequence before it happens. Nothing exposes machinery: no "portal
snapshot," "revision," "callable," "authority," "reconciliation," "Firebase."
The translation table is a design deliverable: *rotate portal link* → "Send a
fresh link"; *revision fence* → "Prices held while you review"; *provider
accepted* → "Sent — awaiting delivery confirmation"; *dependency
invalidation* → "The kitchen sheet needs a refresh — one tap." The interface
teaches through action, and the "Why?" glass is the manual.

### 4.14 What disappears

| Today | Fate | Replaced by |
|---|---|---|
| Five-step wizard, 36-field form | Deleted | Intent intake → living object (§4.3.3) |
| Ten navigation destinations | Collapsed | NOW · EVENTS · CREATE · CLIENTS · the Pilot |
| Quote history table as primary surface | Demoted | Event Rooms; the table survives as admin tooling |
| Manual status management | Deleted | Lifecycle worn by the object; transitions evidence-driven |
| Dashboards to interpret | Inverted | NOW interprets; reporting answers questions |
| Save / Refresh / Apply | Deleted | Autosave, live re-price, undo windows |
| Follow-up task lists | Deleted | Autopilot lanes with receipts and quiet wins |
| Separate quote/proposal/BEO/contract artifacts | Unified | Projections of one object |
| Warnings without pathways | Banned | The decision grammar |
| The customer email ping-pong | Absorbed | Parsed requests, drafted replies, the decision room |
| Modal/route duality, `App.jsx` monolith | Deleted | Decomposed surface architecture (Part 5) |

And the radical-simplification test becomes a standing design gate: for every
control that survives, the review must answer why the engine could not infer
it, recommend it, automate it, defer it, or collapse it to one tap.

### 4.15 Trust: why users let it fly

Autonomy is earned, per tenant, per act:

1. **Provenance on every number** — "Based on…" is universal (§4.4).
2. **Receipts for every act** — quiet wins are inspectable; the cascade is a
   receipt chain; nothing claims beyond its evidence.
3. **Simulation before mutation** — the engine's hands move on glass first.
4. **Undo over confirmation** — reversibility as the default safety.
5. **Graduated autonomy** — every automation class (drafts, nudges,
   reminders, cascade steps) starts at *propose*, and the tenant promotes it
   to *act* when trust is earned; the existing per-tenant gates and consent
   rails are exactly this, generalized.
6. **The honesty law** — the engine that admits "margins unavailable until
   you add costs" is the engine believed when it says "this is ready."

### 4.16 What success measures

- **Inquiry → sent**: hours to minutes (target: first proposal draft within
  minutes of intake for template-shaped events).
- **Decisions per booking**: the count of human decisions falls toward only
  the judgment-worthy; every surviving decision has visible basis.
- **Recommendation take-rate and edit-distance**: are the engine's defaults
  becoming this tenant's defaults?
- **Follow-up latency**: zero silent proposals older than policy.
- **Margin adherence**: share of sent proposals at or above floor (measurable
  only after unit economics — itself an adoption metric).
- **Manual re-entry events**: the same fact typed twice anywhere is a defect.
- **The feeling, asked directly:** "Would going back to your old process feel
  obsolete?" — the only benchmark this design accepts.

---

## Part 5 — Reaching it from here

The destination is radical; the path is not, because the authority layer
barely moves. Every new concept lands on an existing rail:

| New concept | Existing rail it rides |
|---|---|
| Readiness ring | `proposal-readiness-v1` (`src/lib/quoteWorkflow.js:718`) |
| NOW stream | `buildWorkflowAttentionSummary` + timing cues + autopilot attention |
| Decide stack impacts | Commercial Change impact evaluation |
| What-if / adopt | Commercial Change Authority simulate → authorize → apply |
| Living price | authoritative pricing callable + `client_preview` contract |
| Cascade | approval workflow, contract conversion, payment rails, closeout |
| Quiet wins | Revenue Autopilot lanes + operation receipts |
| Client decision room | portal snapshot + acceptance receipts + conversation rail |
| Parsed requests | portal conversation + (new) structured change-request contract |
| Memory defaults | event templates + ownership tracking + starter packs + radar |
| Voice/mobile preview-confirm | the same simulation contract |

What is genuinely new: the intent-intake parser, the uncertainty type system,
unit economics, the structured change-request contract, the unified ledger
model over existing signals, and the surface layer itself. What must be
dismantled first: the `App.jsx` monolith and modal/route duality — the
decomposition is the enabling investment, and the customer-centered workspace
program has already begun it.

Sequencing (each phase shippable, each behind the house's default-off gates,
each subject to the existing capability-surfacing and evidence governance):

1. **Interpretation** — NOW replaces Home; readiness ring and decision
   grammar land in the Event Room; no new authority.
2. **Intent** — CREATE's intake canvas beside the wizard, then instead of it;
   uncertainty typing in the object and bands in the preview.
3. **Collaboration** — structured change requests through the decision room;
   parsed-request cards; drafted replies.
4. **Autonomy** — cascade orchestration on acceptance; graduated automation
   promotions; voice/mobile command layer.
5. **Economics** — unit-economics onboarding unlocks margin intelligence and
   the commercial advisor.

Nothing in this sequence requires enforcement gates to promote before their
own evidence standards are met; the experience degrades honestly wherever a
gate is closed, exactly as the platform does today.

---

## Part 6 — The standard

This design is post-competitive if, and only if, after living with it:

1. A caterer hands QuotePilot a voicemail transcript and receives a sendable,
   priced, honest proposal draft faster than they could have opened their old
   spreadsheet.
2. The question "where do I go to do X?" stops occurring, because attention
   arrives already triaged and every problem carries its fix.
3. The user can answer "why is this price right, and what happens if I change
   it?" in one tap — which no spreadsheet, and no incumbent quoting product,
   can do.
4. A client says the proposal was the nicest part of planning.
5. The user catches themselves reviewing decisions instead of constructing
   artifacts — and notices, some Tuesday, that the thought "I should build a
   quote" has quietly left their life. It was never the job. The job was
   always: *win the event, profitably, with confidence.* That is the product.

**The test sentence stands:** after this, going back to conventional quoting
software should feel not slower but *absurd* — like navigating by paper map
in a car that knows the way.
