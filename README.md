# Vehicle Parking System

## 1. What this project is

A Software Engineering course project (Group 14, Problem Statement No. 10) titled **Vehicle Parking System**, built on the **MERN stack** (MongoDB, Express, React, Node.js). 

**Team:** Siddhesh Dattatray Koditkar (PES2UG24CS502), Sumukh M Gowda (PES2UG24CS537), Sparsha Arun (PES2UG24CS513), Sinchana Kulkarni (PES2UG24CS504).

## 2. The core idea, in one paragraph

A parking lot has multiple entry gates and multiple exit gates, each staffed by a Gate Operator. A car pulls up to an entry gate, the operator logs its details, and the system allots it a spot (in a two-wheeler or four-wheeler zone) — atomically, so two gates can never grab the same spot. When the car leaves, the exit operator looks the vehicle up (ideally by a ticket ID generated at entry, or by plate number if the ticket is lost — with a penalty in that case) and the system computes an exact, tiered fare. An Admin/Manager, separate from the operators, sees live analytics (revenue, occupancy) and the full raw database that operators are explicitly *not* allowed to see, and is the only one who can force a stuck/overstayed vehicle's spot to free up.

## 3. The one architectural idea that shapes everything

**There is no real networking, hardware, or deployment in this project.** It is a single Node/Express + Socket.io backend and one MongoDB instance. "Multiple gates" and "multiple terminals" are simulated by opening **multiple browser tabs on one machine**, each logged in as a different user (two entry operators, two exit operators, one admin). Every tab is a live Socket.io client of the same backend, so an action in one tab (a spot gets allotted, an overstay gets flagged) shows up instantly in every other tab. This is the intended demo mechanism: open 5 tabs, log into each as a different role, and watch the system stay in sync live across all of them.

This constraint is why concurrency-safe, atomic database writes matter so much here — multiple "gates" hitting the same backend at once is the normal case, not an edge case.

## 4. Roles — deliberately just two, plus one non-role

- **Gate Operator** — logs in with credentials scoped to exactly one physical gate (Entry-1, Entry-2, Exit-1, or Exit-2; four fixed accounts total). Handles the entry/exit flow for that gate only. Cannot see historical database records, analytics, or other gates' activity.
- **Admin / Manager** — one root-access account. Sees live occupancy, revenue/occupancy analytics, and the full transaction/audit log. Is notified by operators about overstays and is the only one who can force-release a spot. Configures fare tiers and spot counts.
- **Simulation Console (NOT a user role)** — see section 8. This was a deliberate design call: don't invent a fake "root/hacker-man" persona for demo controls, because a real parking lot admin would never have a "spawn more traffic" button. Keeping it out of the role model keeps the SRS honest and the FR list uncluttered.

## 5. Entry flow

1. Vehicle arrives at an entry gate; operator logs plate number and vehicle type (2W/4W).
2. System finds an available spot in the matching zone and allots it via an **atomic** database operation — this is the mechanism that prevents two simultaneous entry requests from ever getting the same spot.
3. Multiple simultaneous requests across gates are served strictly **first-come-first-served** by server-received timestamp.
4. If the zone is full, the vehicle is turned away — no waitlist, no queueing beyond FCFS ordering of allocation requests.
5. On successful allocation, a **unique Ticket ID** is generated and shown to the operator (with a QR-style visual). This isn't for a real scanner — there's no camera or hardware — it exists purely as a fast lookup key at exit, replacing a second manual plate-number entry.

## 6. Exit flow & fare rules

1. Operator looks the vehicle up by Ticket ID (fast path) or by plate number (fallback — this is the "lost ticket" case, since without the ID a manual DB search is the only recourse).
2. Losing the ticket triggers a **penalty**, added to the computed fare — the ticket ID's value *is* that it lets you skip this.
3. Fare is computed on the **exact** duration (down to the second/decimal — no rounding): **first hour free**, then hourly charges that **increase every 2–3 hours**. Two-wheelers and four-wheelers have **independently configurable** rate tables.
4. On confirmed exit, the spot is immediately marked free (live, across all tabs) and the finalized transaction (plate, times, duration, fare, gate, operator) is permanently recorded.

## 7. Overstay handling

- A vehicle is flagged "overstayed" past a configurable duration threshold.
- The operator **notifies the Admin** (does not resolve it themselves).
- Only the **Admin** can force-release the spot.
- A force-release **automatically applies an overstay penalty** to the fare.

## 8. Frontend look and feel

- Minimalist. Red-and-white theme with red accents. Explicitly **not** animation-heavy — "just a pretty visual."
- The parking lot is shown as a live grid of spots, green = free, red = reserved, split visually into 2W and 4W zones.
- All open sessions (both entry consoles, both exit consoles, admin dashboard) must show an **identical, live-updating** view — this is the Socket.io broadcast requirement, and it's also the main "wow" moment for a demo (open several tabs, watch them all update together).
- Admin dashboard additionally has revenue-over-time and occupancy-over-time charts, and a searchable full transaction/audit log — none of which operators can see.
