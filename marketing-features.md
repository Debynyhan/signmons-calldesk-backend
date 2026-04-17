# Signmons - Marketing Website Content and Roadmap

Trades-first messaging for a marketing site. Plain language, revenue-focused,
and centered on control, money, and reliability.

## Delivery Truth Model

To keep messaging aligned with actual product state:
- Source of active execution truth: `EXECUTION_BOARD.md`
- Source of planned product scope: `MVP_BACKLOG.md`
- Source of backend hardening phases: `REFACTOR6.md`
- Source of canonical screen/route coverage: `SCREEN_INVENTORY.md`

Status labels for every claim in this doc:
- `Shipped`: available in current release.
- `Beta`: implemented but still operationally limited.
- `Planned`: not yet implemented.

Rule: do not present a `Planned` feature as `Shipped` in public copy.

## Feature Claim Registry (Backlog-Aligned)

Every outward claim must map to:
- one backlog ticket (`MVP_BACKLOG.md`) and
- one screen/route surface (`SCREEN_INVENTORY.md`) where applicable.

| Claim | Status | Backlog Pointer | Screen/API Pointer |
| --- | --- | --- | --- |
| 24/7 inbound voice intake | Beta | Backend voice track + FE-2002/FE-2003 | `src/voice/voice.controller.ts` |
| 24/7 inbound SMS handling | Beta | FE-3001..FE-3005 | `src/sms/sms.controller.ts` |
| SMS intake + Stripe checkout links | Beta | FE-3001..FE-3005 | `src/payments/payments.controller.ts` |
| Outbound demo calls | Shipped | FE-1001/FE-1004 | `src/marketing/marketing.controller.ts` |
| Tenant dashboards (ops/analytics) | Planned | FE-2001..FE-2004, FE-5001..FE-5002 | `SCREEN_INVENTORY.md` (`SCR-TEN-*`) |
| Tenant settings studio | Planned | FE-5003 | `SCR-TEN-011` |
| Super admin panel | Planned | FE-5004 | `SCR-ADM-*` |
| Feature flags UI | Planned | FE-5005 | `SCR-TEN-012`, `SCR-ADM-005` |
| ServiceTitan integration | Planned | Post-MVP integration track | N/A (no shipped adapter) |
| Website intake forms/chat routing | Planned | Add ticket before claiming shipped | `SCR-PUB-008` |
| Authenticated web chat | Planned | Add ticket before claiming shipped | `SCR-TEN-013` |

## 1. Core Message

### Plain-English Positioning
Signmons answers your calls, books your jobs, and keeps your schedule full -
even when you're busy or closed.

### One-Line Value Prop
We make sure every call turns into the right job.

## 2. Hero Section (Above the Fold)
- Headline: Never Miss Another Job - Day or Night
- Subheadline: Signmons handles your calls and texts like a professional
  dispatcher - prioritizing emergencies and booking real work. Website intake
  is on the roadmap.
- CTA: See How It Works / Get a Demo

## 3. The Real Problem (Their Reality)
- Missed calls = missed money.
- After-hours calls go to voicemail.
- Office staff gets overwhelmed.
- Emergencies are not caught fast enough.
- Schedules get messy or double-booked.

Reinforcement: If the phone rings and no one answers, the customer calls someone else.

## 4. What Signmons Does (Feature -> Outcome)

### Answers Calls and Texts 24/7 (Now)
What it does:
- Answers customers instantly.
- Works 24/7, including nights and weekends.

What that means for you:
- No missed leads.
- More booked jobs.
- Less stress on you and your staff.

Website intake forms/chat are planned and not yet part of shipped MVP.

### Knows When It's an Emergency
What it does:
- Recognizes urgent situations like no heat, no AC in extreme weather,
  flooding, gas smells, or electrical hazards.

What that means for you:
- High-value emergency calls get handled first.
- Faster response times.
- More emergency revenue captured.

### Books Real Jobs (Not Just Messages)
What it does:
- Collects the right information step by step.
- Only books jobs when required details are confirmed.

What that means for you:
- Fewer bad calls.
- Cleaner schedules.
- Less back-and-forth with customers.

### Protects Your Pricing and Policies
What it does:
- Clearly explains service fees.
- Follows your rules every time.
- Never undercuts your pricing.

What that means for you:
- No surprise discounts.
- No awkward conversations.
- Consistent pricing across every call.

## 5. Works With Your Existing Systems

### ServiceTitan Integration (Planned)
What it does:
- Connects with ServiceTitan.
- Sends qualified jobs directly into your workflow.
- Works alongside your existing dispatch process.

What that means for you:
- No replacing your dispatch team.
- No double entry.
- Signmons feeds ServiceTitan clean, usable jobs.

Line: Signmons handles the intake. ServiceTitan handles the operation.

### Supports Your Dispatch Team (Doesn't Replace Them)
What it does:
- Handles overflow, after-hours, and routine intake.
- Escalates emergencies and special cases.

What that means for you:
- Dispatchers focus on high-value decisions.
- Less burnout.
- Better customer experience.

## 5a. Your Brand, Your Rules (Customization and Control)

### Make It Sound Like Your Company
What it does:
- Uses your company name in every greeting.
- Keeps messaging consistent across every call and text.

What that means for you:
- Customers feel like they reached your office, not a call center.
- A consistent, professional tone on every interaction.

### Enforces Your Policies Every Time
What it does:
- Follows your service fee and emergency fee rules.
- Confirms details before moving forward.

What that means for you:
- No pricing surprises.
- Cleaner handoffs for your team.

## 6. Revenue and Performance Visibility

### See What's Making You Money
What it tracks:
- Calls answered.
- Jobs booked.
- Emergency vs standard calls.
- Missed call recovery.
- After-hours revenue captured.

What that means for you:
- Know where your money is coming from.
- See what hours generate the most jobs.
- Make smarter staffing and marketing decisions.

## 7. Why Contractors Choose Signmons

| Typical Call Handling | Signmons |
| --- | --- |
| Voicemail after hours | Calls answered 24/7 |
| Missed emergencies | Emergencies prioritized |
| Staff overwhelmed | Workload reduced |
| Messy notes | Clean job intake |
| Lost revenue | More booked jobs |

## 8. Who It's For
- HVAC
- Plumbing
- Electrical
- Drains
- Construction / Handyman

Line: If you roll trucks, Signmons works for you.

## 9. Scale With Your Business
- Works whether you have 1 truck or 100.
- Same experience across all locations.
- Consistent call handling.
- No training drift.
- No sick days or call-offs.

## 10. Final Call to Action
- Headline: Stop Missing Calls. Start Booking More Jobs.
- CTA: Schedule a Demo / See Signmons in Action

## 10a. Owner and Admin Control Center (Planned)
- Set company details, pricing rules, and routing preferences.
- Manage users and roles across locations.
- Calendar and dispatch visibility (coming soon).

## 11. Availability and Roadmap

### Available Now
- 24/7 call answering (voice).
- 24/7 text answering (SMS).
- Step-by-step voice intake (name, address, issue capture).
- Emergency prioritization.
- Consistent pricing and policy disclosures.
- Outbound demo calls for marketing leads.
- Call outcome logging and basic performance tracking (internal).
- Intake link + payment flow for voice/SMS handoff.

### Coming Soon
- Website intake (forms/chat) routed into Signmons.
- Authenticated web chat inside the Signmons app.
- Company-specific settings studio for prompt/fee/routing controls.
- Automated SMS confirmations for identity and fees.
- Custom brand personality and tone per company.
- Voice selection to match your brand.
- Multilingual call handling.
- Deeper ServiceTitan sync (two-way customer and job updates).
- Native Signmons dispatch (job board and tech routing).
- Admin dashboards with calendar and dispatcher views.
- Team management with roles and permissions.
- Secure payments (card-on-file, deposits, payment links).
- Smarter scheduling and technician matching.
- Advanced revenue and conversion analytics.
- Warm transfer to humans with full context.

## 12. Notes for Frontend Partner
- No AI jargon.
- No buzzwords.
- Focus on money, time, and stress reduction.
- Speak like a dispatcher or contractor would.
- Mobile-first, simple sections.

Suggested sections:
- Hero
- Pain Points
- What We Do
- Emergency Handling
- ServiceTitan Integration
- Revenue Analytics
- Who It's For
- Final CTA

## Internal North Star (Not Shown on Site)
Signmons exists to capture more jobs, protect pricing, and keep schedules full -
without adding more staff.
