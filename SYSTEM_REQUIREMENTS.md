# VYORA '26 — System Requirements

> Functional source of truth for the VYORA '26 registration system.
>
> Coding agents working on registration, payments, Firebase, admin, tickets,
> or check-in must read this file and `FIREBASE_SCHEMA.md` before implementation.
>
> - `SYSTEM_REQUIREMENTS.md` = business rules and required behaviour
> - `FIREBASE_SCHEMA.md` = Firestore collections, fields and persistence design
>
> Do not invent or change business rules without explicit approval.

---

# 1. System Overview

VYORA '26 requires a registration and event-management system supporting:

- participant registration
- IEEE / Non-IEEE pricing
- hostel and accommodation requirements
- AIDEX workshop selection
- capacity management
- Razorpay payments
- registration confirmation
- admin management
- ticket generation
- QR-based event and workshop check-in
- CSV/export functionality

Participants do NOT need accounts.

The system is intended for approximately 165 participants, so keep the
architecture simple and reliable.

---

# 2. Technology Stack

```text
Frontend
React + Vite

Backend
Express.js

Backend Runtime
Firebase Cloud Functions

Database
Firebase Firestore

Staff Authentication
Firebase Authentication

Payment Gateway
Razorpay
```

Express.js running through Firebase Cloud Functions is the trusted backend.

The frontend must never be authoritative for:

- pricing
- capacity
- payment status
- registration status
- ticket issuance
- check-in

---

# 3. Registration Information

Each participant provides:

```text
Full Name
Email
Phone Number
Year

IEEE Member?
IEEE Membership ID (if IEEE)

Hosteller?
Hostel (if hosteller)

Needs Stay? (if non-hosteller)
Stay Type (if stay required)

Workshop
```

Allowed years:

```text
1
2
3
4
```

All participants are from VJEC.

No college/institution field is required.

The backend must validate and normalize all registration input.

---

# 4. IEEE & Pricing Rules

## Base Registration Fee

```text
IEEE Member     ₹399
Non-IEEE        ₹799
```

If the participant declares IEEE membership:

```text
ieeeMember = true
ieeeMembershipId = required
```

If not:

```text
ieeeMember = false
ieeeMembershipId = null
```

IEEE membership verification is NOT required for this event.

The participant's declaration is trusted.

Do not implement:

```text
ieeeVerified
IEEE API verification
manual IEEE verification workflow
```

## Accommodation Fee

```text
NON-AC Stay     ₹250
AC Stay         ₹300
```

Valid totals:

| Registration | Total |
|---|---:|
| IEEE | ₹399 |
| IEEE + NON-AC | ₹649 |
| IEEE + AC | ₹699 |
| Non-IEEE | ₹799 |
| Non-IEEE + NON-AC | ₹1,049 |
| Non-IEEE + AC | ₹1,099 |

The frontend may display calculated prices.

The backend MUST independently calculate:

```text
baseFee
stayFee
totalFee
```

Never trust client-provided prices.

The calculated values stored with a registration act as the historical pricing
snapshot for that registration.

---

# 5. Hostel & Accommodation Logic

Allowed existing hostels:

```text
SANJOSE
SANTHOME
HOLY_CROSS
ALPHONSA
```

## Existing Hosteller

```text
isHosteller = true
hostel = selected hostel
needsStay = false
stayType = null
stayFee = 0
```

## Non-Hosteller Without Stay

```text
isHosteller = false
hostel = null
needsStay = false
stayType = null
stayFee = 0
```

## Non-Hosteller Requiring Stay

```text
isHosteller = false
hostel = null
needsStay = true
stayType = AC | NON_AC
```

Fee:

```text
AC       ₹300
NON_AC   ₹250
```

The backend must reject impossible combinations such as:

```text
hosteller + needsStay
hosteller + stayType
non-hosteller + hostel
needsStay=false + stayType
```

Conditional frontend fields must clear stale values when their parent choice
changes.

---

# 6. Workshop & Capacity Rules

Every participant selects exactly ONE AIDEX workshop.

Canonical workshop IDs:

```text
data-science
ai-ml-data
github-ai
```

Current limits:

```text
TOTAL EVENT CAPACITY       165
FIRST-YEAR MAXIMUM          55

data-science                55
ai-ml-data                  55
github-ai                   55
```

Workshop selection does NOT change the registration fee.

## Capacity Consumption

Every active reservation consumes:

```text
1 event seat
1 selected workshop seat
```

If:

```text
year == 1
```

it additionally consumes:

```text
1 first-year seat
```

When first-year capacity reaches 55, new first-year registrations must be
rejected.

Students from years 2–4 may continue if event and workshop capacity remain.

## Public Capacity

Exact capacity numbers are internal.

Do not display:

```text
165 total seats
55 workshop seats
55 first-year seats
```

on the public event website.

Use wording such as:

```text
LIMITED SLOTS
AVAILABLE
FULL
```

---

# 7. Registration & Reservation Lifecycle

Expected lifecycle:

```text
Participant Form
      ↓
Backend Validation
      ↓
Duplicate Check
      ↓
Capacity Check
      ↓
Temporary Seat Reservation
      ↓
Server Calculates Price
      ↓
Razorpay Order
      ↓
Razorpay Checkout
      ↓
Backend Payment Verification
      ↓
CONFIRMED
      ↓
Ticket Issued
```

A submitted form alone does NOT mean the participant is registered.

Before payment verification:

```text
registrationStatus = PAYMENT_PENDING
paymentStatus = PENDING
```

After successful trusted payment verification:

```text
registrationStatus = CONFIRMED
paymentStatus = PAID
```

Suggested registration states:

```text
PAYMENT_PENDING
CONFIRMED
PAYMENT_FAILED
EXPIRED
CANCELLED
```

Suggested payment states:

```text
PENDING
PAID
FAILED
REFUNDED
```

---

# 8. Five-Minute Seat Reservation

A seat reservation lasts:

```text
5 minutes
300 seconds
```

The expiration time must be based on server time.

Conceptually:

```text
seatReservationExpiresAt =
reservation creation time + 5 minutes
```

While `PAYMENT_PENDING` and unexpired, the registration counts against all
applicable capacities.

If payment is verified successfully, the reserved seat becomes a confirmed seat.

If payment is not completed before the reservation expires:

```text
registrationStatus = EXPIRED
```

and release:

```text
event seat
selected workshop seat
first-year seat (if applicable)
```

Capacity release MUST be idempotent.

Running expiration/release twice must not decrement counters twice.

Payment confirmation and reservation expiration must use transactional/state
checks so they cannot both incorrectly finalize the same registration.

---

# 9. Capacity & Concurrency Requirements

Capacity enforcement must happen through the trusted backend using Firestore
transactions.

Never rely only on frontend availability checks.

Example:

```text
GitHub × AI

54 / 55 occupied
```

Two registration requests arrive simultaneously.

Correct result:

```text
Request A → success
Request B → WORKSHOP_FULL

Final occupied = 55
```

Incorrect:

```text
56 / 55
```

The same guarantee applies to:

```text
event capacity
first-year capacity
workshop capacity
```

Required invariants:

```text
eventOccupied <= 165
firstYearOccupied <= 55
workshopOccupied <= 55

all counters >= 0
```

---

# 10. Duplicate Registration

Use normalized email and phone to protect against accidental duplicate active
registrations.

At minimum:

```text
PAYMENT_PENDING
CONFIRMED
```

must prevent another simultaneous active registration for the same participant.

An:

```text
EXPIRED
```

registration must allow the participant to try again.

The implementation must also allow an appropriate retry/new attempt after a
failed payment.

Duplicate protection must be concurrency-safe.

Do not rely solely on:

```text
query registrations
→ none found
→ create
```

because simultaneous requests could bypass that check.

The exact persistence mechanism is defined in `FIREBASE_SCHEMA.md`.

---

# 11. Razorpay Requirements

Razorpay is the only intended production payment flow.

The old:

```text
UPI QR
payment screenshot upload
manual screenshot verification
```

flow has been removed and must not be reintroduced.

## Order Creation

Razorpay orders must be created by the trusted backend using the backend-calculated
amount.

Razorpay amounts are supplied in paise.

Example:

```text
₹399  → 39900
₹699  → 69900
₹1099 → 109900
```

## Payment Confirmation

Frontend Razorpay success is NOT sufficient to mark a registration paid.

The backend must verify the Razorpay payment/signature and relevant order details
before setting:

```text
paymentStatus = PAID
registrationStatus = CONFIRMED
```

Razorpay webhooks should be supported for reliable reconciliation.

Payment processing must be idempotent.

Repeated verification/webhook events must NOT produce:

- duplicate payment confirmation
- duplicate registration
- duplicate capacity consumption
- duplicate tickets

## Secrets

Razorpay secrets must never be stored in:

```text
frontend source
Firestore
Git
public environment variables
documentation
```

Use secure server-side secret configuration.

---

# 12. Admin Requirements

Admins/coordinators use Firebase Authentication.

Authentication alone does NOT grant admin access.

The backend/system must additionally verify that the authenticated user is an
authorized active admin/coordinator.

Admin functionality should support:

- registration overview
- participant table
- search
- filters
- payment status
- workshop lists
- hostel lists
- accommodation lists
- IEEE member lists
- attendance
- CSV export

Useful filters:

```text
Year
IEEE / Non-IEEE
Hosteller / Non-hosteller
Hostel
Needs Stay
AC / NON-AC
Workshop
Payment Status
Registration Status
Event Check-In
Workshop Check-In
```

Because there are only approximately 165 participants, authorized admin UI may
perform many searches/filters locally after retrieving the permitted dataset.

Do not overengineer reporting infrastructure.

---

# 13. Tickets & Check-In

Only a participant with:

```text
registrationStatus = CONFIRMED
paymentStatus = PAID
```

may receive a valid ticket.

Ticket issuance must be idempotent.

## QR Security

QR codes must contain an opaque secure token or secure tokenized URL.

Do NOT encode participant PII such as:

```text
name
email
phone
IEEE Membership ID
hostel
```

Do not use the predictable registration ID alone as ticket authentication.

## Event Check-In

Authorized staff scan the ticket.

The backend verifies:

```text
ticket exists
ticket is active
registration is CONFIRMED
payment is PAID
```

Repeated scans must return an already-checked-in state instead of creating
duplicate attendance.

## Workshop Check-In

The same ticket may support workshop check-in.

The backend must additionally verify that the participant belongs to the
selected workshop.

A participant registered for:

```text
github-ai
```

must not be recorded as attending:

```text
data-science
```

unless an authorized reassignment feature is explicitly added later.

---

# 14. Security Requirements

Core rule:

```text
THE CLIENT IS NOT TRUSTED.
```

Public clients must NOT be able to directly:

- create authoritative Firestore registration records
- modify pricing
- modify capacity counters
- modify workshop counters
- mark payment successful
- confirm registrations
- issue tickets
- perform administrative check-in
- access participant lists
- access admin records

Sensitive operations must go through Express.js / Firebase Cloud Functions.

Firestore rules must follow:

```text
DENY BY DEFAULT
```

Never deploy:

```text
allow read, write: if true;
```

Authoritative timestamps must use server time.

Important operations must be idempotent, particularly:

```text
payment verification
Razorpay webhook processing
reservation expiration
capacity release
ticket issuance
check-in
```

Participant information must not be unnecessarily duplicated or exposed.

---

# 15. Backend Error Model

The backend should return consistent safe error codes such as:

```text
REGISTRATION_CLOSED

INVALID_PARTICIPANT_DATA
INVALID_ACCOMMODATION_SELECTION

EVENT_FULL
FIRST_YEAR_FULL
WORKSHOP_FULL
WORKSHOP_UNAVAILABLE

DUPLICATE_REGISTRATION

RESERVATION_EXPIRED

PAYMENT_ORDER_FAILED
PAYMENT_VERIFICATION_FAILED

INTERNAL_ERROR
```

Do not expose:

```text
stack traces
Firestore internals
secret values
Razorpay secrets
```

to public clients.

---

# 16. Current Configuration

```text
EVENT
VYORA '26

TOTAL CAPACITY
165

FIRST-YEAR MAXIMUM
55


WORKSHOPS

data-science
55

ai-ml-data
55

github-ai
55


PRICING

IEEE
₹399

Non-IEEE
₹799

NON-AC Stay
₹250

AC Stay
₹300


RESERVATION

5 minutes


IEEE VERIFICATION

Not required.
Participant declaration is trusted.


PAYMENT

Razorpay


BACKEND

Express.js
Firebase Cloud Functions


DATABASE

Firebase Firestore


STAFF AUTH

Firebase Authentication
```

This section is the quick reference for current business values.

If an approved value changes, update this file and the relevant schema/configuration.

---

# 17. Development Phases

## Phase 1 — Firebase & Registration Engine

Implement:

```text
Express.js on Firebase Cloud Functions
Firebase Admin / Firestore
registration validation
normalization
server-side pricing
capacity transactions
duplicate protection
5-minute reservations
expiration
idempotent capacity release
Firestore Security Rules
database bootstrap
Firebase Emulator/tests
```

Do NOT implement Razorpay yet.

---

## Phase 2 — Registration + Razorpay

Implement:

```text
connect existing registration frontend
Razorpay order creation
Razorpay Checkout
backend payment verification
Razorpay webhook
payment reconciliation
payment/expiration race handling
registration confirmation
```

---

## Phase 3 — Admin

Implement:

```text
Firebase staff authentication
admin authorization
dashboard
registration table
search
filters
workshop/hostel/stay lists
payment overview
CSV export
```

---

## Phase 4 — Ticket & Check-In

Implement:

```text
ticket generation
secure QR
ticket validation
event check-in
workshop check-in
duplicate scan protection
```

---

# 18. Critical Testing Requirements

Before production, verify at minimum:

### Pricing

```text
IEEE                         ₹399
IEEE + NON_AC                ₹649
IEEE + AC                    ₹699

Non-IEEE                     ₹799
Non-IEEE + NON_AC           ₹1049
Non-IEEE + AC               ₹1099
```

### Capacity

```text
event 164 → registration → 165
event 165 → EVENT_FULL

workshop 54 → registration → 55
workshop 55 → WORKSHOP_FULL

first-year 54 → year-1 registration → 55
first-year 55 → year-1 registration → FIRST_YEAR_FULL
```

### Concurrency

Two requests competing for one remaining workshop seat:

```text
ONE succeeds
ONE fails
final occupied = 55
```

### Reservation

Expired pending registration:

```text
→ EXPIRED
→ capacity released
```

Running expiration again:

```text
→ no additional decrement
```

### Payment

Test:

```text
successful payment
failed payment
abandoned payment
duplicate verification
duplicate webhook
payment near reservation expiry
```

### Check-In

Test:

```text
valid event check-in
duplicate event check-in
valid workshop check-in
duplicate workshop check-in
wrong workshop
invalid ticket
unconfirmed registration
```

---

# 19. Keep the System Simple

This system serves approximately 165 participants.

Do NOT introduce unnecessary:

- microservices
- participant accounts
- participant passwords
- multiple databases
- elaborate RBAC
- complex analytics infrastructure
- external search systems
- excessive Firestore indexes
- rotating QR infrastructure unless genuinely required

Prioritize:

```text
correctness
security
simple operations
mobile usability
payment reliability
event-day reliability
```

---

# 20. Agent Rules

Before changing backend/registration functionality:

1. Read this file.
2. Read `FIREBASE_SCHEMA.md`.
3. Inspect the existing implementation.
4. Treat both documents as the source of truth.
5. Do not invent missing business rules.
6. Never trust client prices.
7. Never trust client payment status.
8. Never allow public capacity modification.
9. Use transactions for capacity-sensitive operations.
10. Keep reservation/payment operations idempotent.
11. Keep Razorpay secrets server-side.
12. Do not expose exact capacity publicly.
13. Do not reintroduce payment screenshots.
14. Do not implement IEEE verification.
15. Do not overengineer for a 165-person event.
16. Update documentation when approved requirements change.
17. Flag genuine conflicts before destructive architectural changes.

---

Last updated: September 2026