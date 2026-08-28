# Admin Dashboard, Billing, Subscription & Production Hardening --- Final Implementation Specification

**Status:** Final architecture / implementation specification\
**Scope:** Final phase of the application. All database, authentication,
billing, subscription, coupon, admin, audit, analytics, and operational
schema changes required for the foreseeable product lifecycle should be
completed in this phase.

------------------------------------------------------------------------

## 1. Objective

Build a production-grade Admin Dashboard and supporting backend
architecture that provides:

-   Separate admin authentication using admin credentials from
    environment/configuration.
-   Email OTP verification for every admin login.
-   Secure, independent admin sessions/JWTs.
-   Complete user administration.
-   Permanent user banning and reversible deactivation.
-   User login-method visibility: Google vs local.
-   Last-login tracking.
-   Plan and subscription management.
-   Three initial plans:
    -   **Basic --- \$9/month**
    -   **Premium --- \$19/month**
    -   **Ultimate --- \$39/month**
-   Admin-editable plans and features.
-   Coupon creation, targeting, expiration, usage limits, and discount
    accounting.
-   One-time payments and recurring subscriptions.
-   Billing history and transaction ledger.
-   Razorpay-ready payment architecture.
-   Revenue, MRR, ARR, churn, subscription, user, and coupon analytics.
-   Refund/payment-failure/dispute-ready billing records.
-   Complete admin audit logging.
-   Operational/system-health visibility.
-   Future multi-admin roles and permissions without requiring another
    architectural rewrite.
-   Idempotent payment/webhook processing.
-   Strong security around destructive operations and billing state
    changes.

The architecture must avoid hardcoding business rules into the frontend
and must preserve historical billing data even when plans, prices,
coupons, or users later change.

------------------------------------------------------------------------

# 2. Critical Architectural Corrections

## 2.1 Do not use plaintext `ADMIN_PASSWORD`

The initial proposal uses:

``` env
ADMIN_PASSWORD=...
```

This should be replaced by:

``` env
ADMIN_EMAIL=...
ADMIN_PASSWORD_HASH=...
```

The application must never store or log the plaintext administrator
password.

If an initial bootstrap process requires a plaintext password, it should
exist only during provisioning and be converted to a secure password
hash before production use.

Recommended password hashing:

-   Argon2id preferred.
-   bcrypt acceptable if already standardized in the application.

------------------------------------------------------------------------

## 2.2 Do not make the admin account a normal User

The proposed `User.role` field is useful only if the product eventually
wants application users to become admins.

For this architecture, admin authentication is explicitly separate from
user authentication.

Create a dedicated model:

``` text
AdminAccount
```

This allows:

-   Multiple admins later.
-   Admin roles.
-   Admin-specific audit trails.
-   Admin deactivation.
-   Admin password rotation.
-   Admin OTP history.
-   Permission management.

Recommended fields:

``` text
AdminAccount
- id
- email
- passwordHash
- role
- isActive
- lastLoginAt
- createdAt
- updatedAt
```

The first administrator can still be provisioned from environment
variables during bootstrap.

Do not create a permanent `User` record for the administrator merely to
support admin authentication.

------------------------------------------------------------------------

## 2.3 Do not use only boolean account status fields

The proposed:

``` text
isBanned
isDeactivated
```

can work, but a single authoritative account-status enum is safer.

Use:

``` text
UserStatus
- ACTIVE
- DEACTIVATED
- BANNED
```

And retain metadata:

``` text
statusChangedAt
statusChangedByAdminId
statusReason
```

If backward compatibility requires the existing boolean fields, they
must not become independent sources of truth.

### State rules

``` text
ACTIVE
  ├── DEACTIVATED → ACTIVE
  └── BANNED      → terminal

DEACTIVATED
  └── ACTIVE

BANNED
  └── no normal reactivation
```

The backend must enforce these transitions, not merely the frontend.

------------------------------------------------------------------------

# 3. Database Architecture

## 3.1 User

Extend the existing user model with:

``` text
id
email
name
...
status UserStatus
lastLoginAt DateTime?
statusChangedAt DateTime?
statusChangedByAdminId String?
statusReason String?
createdAt
updatedAt
```

Do not delete users when they are banned or deactivated.

### Required indexes

At minimum:

``` text
email
status
lastLoginAt
createdAt
```

Use the project's existing email normalization strategy. Email
uniqueness must remain case-insensitive where appropriate for the
existing database design.

------------------------------------------------------------------------

# 4. Login Method

Do not infer Google/local login method from incomplete data at query
time.

Use or extend the application's existing authentication/provider model.

Recommended enum:

``` text
AuthProvider
- LOCAL
- GOOGLE
```

If the application already has an account/provider table, reuse it
rather than duplicating provider state.

The admin Users page must expose:

``` text
Google
Local
```

If a user can eventually have multiple authentication methods, the UI
should display the primary/current method while the underlying model
remains capable of multiple providers.

------------------------------------------------------------------------

# 5. Plans

Create a database-backed `Plan` model.

Recommended fields:

``` text
Plan
- id
- name
- slug @unique
- description
- currency
- priceCents
- billingInterval
- features Json
- sortOrder
- isActive
- createdAt
- updatedAt
```

Optional but strongly recommended:

``` text
- version
- metadata Json?
- createdByAdminId?
- updatedByAdminId?
```

### Initial plans

``` text
Basic
$9/month

Premium
$19/month

Ultimate
$39/month
```

All values must be editable from the Admin Dashboard.

Do not hardcode these values into frontend components.

------------------------------------------------------------------------

# 6. Razorpay Plan Compatibility

Razorpay Subscription Plans are not normal mutable application records.
Razorpay documentation states that once a Razorpay Plan is created, it
cannot be edited or deleted.

Therefore:

**The local application Plan is the business/product definition.**

**The Razorpay Plan is a provider-side billing artifact.**

Do not assume that changing:

``` text
Premium $19 → $24
```

means an existing Razorpay plan can simply be edited.

Instead, introduce provider mapping/versioning.

Recommended model:

``` text
PaymentProviderPlan
- id
- planId
- provider
- providerPlanId
- currency
- amountCents
- billingInterval
- isActive
- createdAt
- retiredAt?
```

Example:

``` text
Premium
  ├── Razorpay plan_xxx ($19)
  └── Razorpay plan_yyy ($24)
```

New subscribers can use the current provider plan.

Existing subscribers remain associated with the provider
subscription/plan that was actually authorized unless an explicit
migration/change-plan workflow is implemented.

This preserves historical correctness.

Razorpay requires a Plan before creating a Subscription, and its
Subscription API supports recurring billing, total billing cycles, start
dates, quantity, and other subscription properties.
citeturn0search1turn0search5

------------------------------------------------------------------------

# 7. Plan Features

The `features` JSON should represent product entitlements, not merely
presentation text.

Example:

``` json
{
  "aiRequestsPerMonth": 10000,
  "projects": 10,
  "storageMb": 5000,
  "teamMembers": 3
}
```

The backend must be the authority for entitlement checks.

Never trust frontend plan values for authorization or quota enforcement.

------------------------------------------------------------------------

# 8. Subscription

Create a robust subscription model.

Recommended fields:

``` text
Subscription
- id
- userId
- planId
- provider
- providerSubscriptionId
- providerPlanId
- status
- billingInterval
- quantity
- currentPeriodStart
- currentPeriodEnd
- startedAt
- trialStartAt?
- trialEndAt?
- cancelAtPeriodEnd
- cancelledAt?
- endedAt?
- autoRenew
- createdAt
- updatedAt
```

### Subscription status

Use an enum broad enough to represent real provider states:

``` text
SubscriptionStatus
- CREATED
- AUTHENTICATION_PENDING
- ACTIVE
- PAUSED
- PAST_DUE
- CANCELLED
- COMPLETED
- EXPIRED
- FAILED
```

Do not collapse provider state into only `ACTIVE/INACTIVE`.

Razorpay exposes subscription lifecycle APIs including create, fetch,
update, cancel, pause, resume, and invoice retrieval, so the local model
needs enough state to represent these transitions.
citeturn0search3turn0search4

------------------------------------------------------------------------

# 9. Subscription History

Do not overwrite subscription history.

A user may have:

``` text
Basic
  ↓
Premium
  ↓
Ultimate
  ↓
Cancelled
```

All historical subscriptions must remain queryable.

Never use only:

``` text
User.planId
```

as the billing source of truth.

The current entitlement should be resolved from the active subscription
plus any explicit admin override mechanism.

------------------------------------------------------------------------

# 10. One-Time Payments

The billing architecture must support both:

``` text
ONE_TIME
RECURRING
```

Create a generic `BillingOrder` or `PaymentOrder` model.

Recommended fields:

``` text
PaymentOrder
- id
- userId
- planId?
- type
- provider
- providerOrderId
- currency
- subtotalCents
- discountCents
- taxCents
- totalCents
- status
- couponId?
- idempotencyKey
- metadata Json?
- expiresAt?
- createdAt
- updatedAt
```

Order types:

``` text
ONE_TIME
SUBSCRIPTION_INITIAL
SUBSCRIPTION_RENEWAL
```

Razorpay Orders are designed to be linked to payments, so retain the
provider order identifier separately from the internal order ID.
citeturn0search10

------------------------------------------------------------------------

# 11. Billing Transaction Ledger

Create an immutable-ish financial transaction record.

Recommended:

``` text
BillingTransaction
- id
- userId
- subscriptionId?
- orderId?
- planId?
- couponId?
- provider
- providerPaymentId?
- providerOrderId?
- providerInvoiceId?
- providerSubscriptionId?
- transactionType
- status
- currency
- grossAmountCents
- discountCents
- taxCents
- netAmountCents
- providerFeeCents?
- paidAt?
- failedAt?
- failureCode?
- failureReason?
- reference
- metadata Json?
- createdAt
- updatedAt
```

### Transaction types

``` text
PAYMENT
SUBSCRIPTION_INITIAL
SUBSCRIPTION_RENEWAL
REFUND
PARTIAL_REFUND
ADJUSTMENT
```

### Payment status

``` text
CREATED
PENDING
AUTHORIZED
CAPTURED
FAILED
REFUNDED
PARTIALLY_REFUNDED
CANCELLED
```

Do not delete financial transactions.

------------------------------------------------------------------------

# 12. Refunds

Add a dedicated `Refund` model rather than only changing the payment
status.

Recommended:

``` text
Refund
- id
- transactionId
- userId
- provider
- providerRefundId?
- amountCents
- currency
- status
- reason?
- initiatedByAdminId?
- createdAt
- processedAt?
```

Statuses:

``` text
PENDING
PROCESSED
FAILED
CANCELLED
```

This allows partial refunds and multiple refunds against one payment.

------------------------------------------------------------------------

# 13. Razorpay Customer Mapping

Add:

``` text
PaymentProviderCustomer
- id
- userId
- provider
- providerCustomerId
- createdAt
- updatedAt
```

Do not assume the application's user ID equals a Razorpay customer ID.

------------------------------------------------------------------------

# 14. Razorpay Webhooks

This is mandatory for production billing.

Do not make payment state dependent only on the browser's checkout
callback.

Razorpay explicitly recommends server-side webhooks for payment-state
synchronization and notes that client callbacks are not substitutes for
webhooks. citeturn0search13

Create:

``` text
PaymentWebhookEvent
- id
- provider
- providerEventId @unique
- eventType
- payload Json
- signature
- receivedAt
- processedAt?
- processingStatus
- processingAttempts
- lastError?
```

Statuses:

``` text
RECEIVED
PROCESSING
PROCESSED
FAILED
IGNORED
```

### Webhook requirements

-   Verify Razorpay webhook signature.
-   Reject invalid signatures.
-   Persist the event before processing where practical.
-   Use `providerEventId` for idempotency.
-   Never process the same event twice.
-   Retry transient failures.
-   Keep the raw payload for debugging/audit purposes, subject to
    data-retention policy.
-   Do not expose webhook secrets.
-   Return successful HTTP responses only when appropriate to the
    provider's retry behavior.
-   Build reconciliation tooling for events that cannot be matched
    automatically.

Razorpay provides subscription webhook events and includes subscription
entities, with payment information where applicable.
citeturn0search2turn0search8

------------------------------------------------------------------------

# 15. Payment Reconciliation

Add a future-ready reconciliation mechanism.

Admin should be able to identify:

``` text
Provider says PAID
Application says PENDING
```

or:

``` text
Provider says CANCELLED
Application says ACTIVE
```

Add a billing/system reconciliation job or endpoint that can compare
provider state against local state.

Do not silently overwrite records during reconciliation.

Record reconciliation actions in the audit log.

------------------------------------------------------------------------

# 16. Coupons

Create:

``` text
Coupon
- id
- code @unique
- description
- type
- value
- currency?
- maxUses?
- usedCount
- perUserLimit?
- minimumAmountCents?
- startsAt?
- expiresAt?
- isActive
- appliesToAllPlans
- createdAt
- updatedAt
```

Do not store only a comma-separated plan ID string.

Create:

``` text
CouponPlan
- couponId
- planId
```

with a composite unique key.

This provides clean many-to-many plan targeting.

------------------------------------------------------------------------

# 17. Coupon Usage

Create:

``` text
CouponRedemption
- id
- couponId
- userId
- orderId?
- transactionId?
- discountCents
- redeemedAt
```

Add an appropriate unique constraint for per-user limits.

Never rely solely on `Coupon.usedCount`.

`usedCount` can be a cached counter, while `CouponRedemption` is the
historical source.

Use a transaction/atomic operation to prevent race conditions where two
simultaneous checkouts exceed a coupon's usage limit.

------------------------------------------------------------------------

# 18. Coupon Edge Cases

The backend must handle:

-   Expired coupon.
-   Coupon not yet active.
-   Disabled coupon.
-   Max global usage reached.
-   Per-user usage reached.
-   Coupon applies to another plan.
-   Fixed discount greater than order subtotal.
-   Percentage discount above 100%.
-   Minimum order amount not met.
-   Coupon removed after checkout creation.
-   Payment fails after coupon reservation.
-   User retries checkout.
-   Duplicate webhook.
-   Concurrent coupon redemption.
-   Refund after discounted purchase.

Discount must never make the final payable amount negative.

Store the actual discount applied to the transaction so future coupon
edits cannot change historical invoices.

------------------------------------------------------------------------

# 19. Money Representation

Never use floating-point values for financial calculations.

Use:

``` text
priceCents Int
amountCents Int
discountCents Int
taxCents Int
```

and:

``` text
currency String
```

Example:

``` text
$19.00 → 1900
```

Do not calculate billing using JavaScript `number` decimals.

------------------------------------------------------------------------

# 20. Currency

Initial plans:

``` text
USD
```

Initial prices:

``` text
Basic = 900
Premium = 1900
Ultimate = 3900
```

However, the schema should not hardcode USD.

Store currency per plan/order/transaction.

If multi-currency is added later, provider-specific plan mappings must
be created for each supported currency.

------------------------------------------------------------------------

# 21. Price Snapshots

Historical transactions must not change when a plan changes.

When creating an order/subscription transaction, snapshot:

``` text
planName
planSlug
priceCents
currency
billingInterval
couponCode
discountCents
taxCents
```

Either as explicit immutable fields or structured metadata.

This is critical because:

``` text
Premium $19
```

could later become:

``` text
Premium $29
```

Old invoices must still show \$19.

------------------------------------------------------------------------

# 22. Admin User Management

Routes:

``` text
GET    /api/admin/users
GET    /api/admin/users/:id
GET    /api/admin/users/:id/transactions
GET    /api/admin/users/:id/subscriptions
GET    /api/admin/users/:id/activity

PATCH  /api/admin/users/:id/deactivate
PATCH  /api/admin/users/:id/reactivate
PATCH  /api/admin/users/:id/ban
```

Do not expose `unban` as a normal reversible action if product policy
defines banning as permanent.

If an emergency super-admin override is ever introduced, it must be a
separate explicit capability and heavily audited.

------------------------------------------------------------------------

# 23. User Table

Columns:

``` text
User
Email
Login Method
Plan
Subscription Status
Account Status
Last Login
Created
Revenue
```

Filters:

``` text
Search
Google / Local
Active / Deactivated / Banned
Plan
Subscription status
Date range
```

Use server-side pagination.

Never fetch all users into the frontend.

------------------------------------------------------------------------

# 24. User Detail

The user drawer/page should include:

### Identity

``` text
Name
Email
User ID
Login method
Created date
Last login
Account status
```

### Subscription

``` text
Current plan
Provider subscription ID
Status
Current period
Renewal
Auto-renew
```

### Billing

``` text
Orders
Payments
Refunds
Discounts
Total gross revenue
Total refunds
Net revenue
```

### Activity

``` text
Login history
Important account events
```

------------------------------------------------------------------------

# 25. Admin Assign Plan

Admin plan assignment must be explicitly separated into:

``` text
BILLING SUBSCRIPTION CHANGE
```

versus:

``` text
ADMIN ENTITLEMENT OVERRIDE
```

Do not silently change a user's paid Razorpay subscription when an admin
merely wants to grant access.

Recommended future-ready model:

``` text
EntitlementOverride
- id
- userId
- planId
- reason
- startsAt
- endsAt?
- createdByAdminId
- revokedAt?
```

For actual paid plan changes, use a dedicated billing workflow.

This avoids:

> Admin changed Premium → Ultimate, but Razorpay is still charging
> Premium.

------------------------------------------------------------------------

# 26. Admin Authentication

Routes:

``` text
POST /api/admin/auth/send-otp
POST /api/admin/auth/verify-otp
POST /api/admin/auth/refresh
POST /api/admin/auth/logout
GET  /api/admin/auth/me
```

### Login

``` text
Email
Password
    ↓
Validate admin credentials
    ↓
Rate-limit check
    ↓
Generate OTP
    ↓
Hash OTP
    ↓
Store AdminOtp
    ↓
Send email
    ↓
Verify OTP
    ↓
Issue admin access/session token
```

------------------------------------------------------------------------

# 27. Admin OTP

`AdminOtp`:

``` text
id
adminAccountId
codeHash
expiresAt
consumedAt?
attempts
maxAttempts
createdAt
```

Rules:

-   6 digits.
-   10-minute expiration.
-   Maximum 5 attempts.
-   Single-use.
-   New OTP invalidates previous active OTPs.
-   Rate-limit sending.
-   Rate-limit verification.
-   Never log the OTP.
-   Never return the OTP in an API response.
-   Do not store plaintext OTP.
-   Do not allow unlimited retry.

------------------------------------------------------------------------

# 28. Admin JWT / Session Security

Use a separate secret:

``` env
JWT_ADMIN_SECRET=...
```

Never use the normal user JWT secret.

Payload should contain an immutable admin identifier:

``` json
{
  "sub": "admin-account-id",
  "role": "SUPER_ADMIN"
}
```

Do not use:

``` text
sub = "admin"
```

for all administrators if multiple admins may exist.

Use short-lived access tokens and a secure refresh/session strategy.

Admin sessions should support explicit logout/revocation.

------------------------------------------------------------------------

# 29. Admin Roles

Even if only one admin exists now, create:

``` text
AdminRole
- SUPER_ADMIN
- ADMIN
- SUPPORT
- BILLING
- ANALYST
```

Permission checks should be backend-enforced.

Suggested capabilities:

``` text
users.read
users.deactivate
users.ban
billing.read
billing.refund
plans.read
plans.write
coupons.read
coupons.write
analytics.read
audit.read
admins.manage
system.read
```

------------------------------------------------------------------------

# 30. Admin Audit Log

Create:

``` text
AdminAuditLog
- id
- adminAccountId
- action
- entityType
- entityId?
- before Json?
- after Json?
- reason?
- ipAddress?
- userAgent?
- requestId?
- createdAt
```

Record:

-   User deactivation.
-   User reactivation.
-   User ban.
-   Plan changes.
-   Coupon creation/edit/deletion/disable.
-   Manual plan assignment.
-   Refund.
-   Billing correction.
-   Admin account changes.
-   Settings changes.
-   Reconciliation actions.

Never store passwords, OTPs, API secrets, or sensitive payment
credentials in audit payloads.

------------------------------------------------------------------------

# 31. Dashboard Overview

Route:

``` text
GET /api/admin/overview
```

KPI cards:

``` text
Total Users
Active Users
Deactivated Users
Banned Users
New Users
Active Subscriptions
MRR
ARR
Revenue
Refunds
Net Revenue
```

Charts:

``` text
Revenue over time
User growth
MRR
Subscription growth
Plan distribution
Login method distribution
Coupon usage
Churn
```

Time ranges:

``` text
7 days
30 days
90 days
12 months
Custom
```

All analytics queries must be server-side.

------------------------------------------------------------------------

# 32. Revenue Definitions

Define metrics explicitly so numbers remain consistent.

### Gross Revenue

Successful captured payment amount before discounts/refunds as defined
by the application's accounting model.

### Discounts

Total discount applied through coupons/promotions.

### Refunds

Successfully processed refund amount.

### Net Revenue

Use a clearly documented formula, for example:

``` text
Net Revenue = Captured Revenue - Refunds
```

If provider fees and taxes are later included, expose them as separate
metrics instead of silently changing the definition.

### MRR

Monthly recurring revenue attributable to active recurring
subscriptions.

Do not count one-time purchases as MRR.

### ARR

``` text
ARR = MRR × 12
```

unless the business later adopts a different accounting definition.

------------------------------------------------------------------------

# 33. Subscription Analytics

Track:

``` text
New subscriptions
Renewals
Cancellations
Churn
Upgrades
Downgrades
Failed renewals
Active subscriptions
Past-due subscriptions
```

Do not infer churn solely from user deletion.

Use subscription lifecycle records.

------------------------------------------------------------------------

# 34. Login / Activity Tracking

At minimum:

``` text
lastLoginAt
```

Recommended future-ready model:

``` text
UserLoginEvent
- id
- userId
- provider
- success
- ipAddress?
- userAgent?
- createdAt
```

Retention should be considered because login data can grow quickly.

------------------------------------------------------------------------

# 35. Ban / Deactivation Enforcement

The status must be checked in:

``` text
auth.service.login
refresh token flow
authenticate middleware
Google OAuth callback/account login
```

Do not only block password login.

A banned/deactivated user must not regain access through Google OAuth or
an already-issued refresh token.

Existing sessions/tokens should be invalidated.

Recommended approach:

``` text
tokenVersion / sessionVersion
```

on User.

Increment it when:

``` text
ban
deactivate
password security reset
```

and include the version in authenticated session validation.

------------------------------------------------------------------------

# 36. Existing Session Invalidation

When:

``` text
ACTIVE → DEACTIVATED
ACTIVE → BANNED
```

invalidate:

-   Refresh tokens.
-   Sessions.
-   Any server-side session record.
-   Cached authentication state where applicable.

A user must not remain authenticated simply because they logged in
before being banned.

------------------------------------------------------------------------

# 37. Payment Provider Configuration

Prepare environment variables now:

``` env
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAY_MODE=test
```

Never expose:

``` text
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
```

to the frontend.

The public Key ID may be used by the checkout integration where
required.

Razorpay uses API keys for API/Checkout integration and provides
separate Test and Live modes. citeturn0search11turn0search17

------------------------------------------------------------------------

# 38. Provider Abstraction

Do not spread Razorpay-specific logic across controllers.

Use:

``` text
PaymentProvider
```

interface/service.

For example:

``` text
createOrder()
createRecurringPlan()
createSubscription()
fetchPayment()
fetchSubscription()
cancelSubscription()
pauseSubscription()
resumeSubscription()
refundPayment()
verifyWebhook()
```

Then:

``` text
RazorpayPaymentProvider
```

implements it.

This prevents the entire billing system from becoming impossible to
migrate if another provider is added later.

------------------------------------------------------------------------

# 39. Payment Checkout Verification

For one-time payments:

``` text
Create internal order
    ↓
Create Razorpay order
    ↓
Return checkout information
    ↓
User pays
    ↓
Client receives payment response
    ↓
Backend verifies signature
    ↓
Webhook confirms server-side state
    ↓
Mark payment captured
    ↓
Create/update entitlement
```

Do not grant permanent paid access merely because the browser reports
success.

------------------------------------------------------------------------

# 40. Recurring Subscription Flow

Recommended flow:

``` text
User chooses plan
    ↓
Backend resolves active local Plan
    ↓
Resolve active PaymentProviderPlan
    ↓
Create Razorpay Subscription
    ↓
Store provider subscription ID
    ↓
Checkout authorization
    ↓
Verify signature
    ↓
Webhook processing
    ↓
Subscription becomes ACTIVE
    ↓
Entitlements activated
```

Razorpay's documented subscription integration follows the sequence of
creating a Plan, creating a Subscription, and integrating Standard
Checkout for authorization. citeturn0search9turn0search11

------------------------------------------------------------------------

# 41. Webhook Event Handling

Prepare handlers for relevant events such as:

``` text
payment.authorized
payment.captured
payment.failed
order.paid

subscription.authenticated
subscription.activated
subscription.charged
subscription.completed
subscription.cancelled
subscription.paused
subscription.resumed
subscription.pending
subscription.halted

refund.created
refund.processed
refund.failed

payment.dispute.created
payment.dispute.won
payment.dispute.lost
```

The exact enabled event set should follow the Razorpay account/product
configuration at integration time.

Do not assume every event is available for every product configuration.

------------------------------------------------------------------------

# 42. Idempotency

Every financial operation must be idempotent.

Examples:

``` text
same webhook twice
same payment callback twice
same checkout retry
same subscription renewal event twice
```

must not create duplicate:

-   Transactions.
-   Coupon redemptions.
-   Subscription records.
-   Entitlements.

Use provider IDs and unique constraints as database-level safety
mechanisms.

Application checks alone are not sufficient.

------------------------------------------------------------------------

# 43. Entitlements

Create a clear relationship between:

``` text
Plan
Subscription
User entitlement
```

Do not make the frontend determine whether the user has access.

Backend authorization should resolve:

``` text
effectivePlan
```

from:

1.  Valid admin override, if one exists.
2.  Active subscription.
3.  Free/default plan, if applicable.

This should be implemented as a centralized service.

------------------------------------------------------------------------

# 44. Billing Edge Cases

The implementation must account for:

### Payment

-   Payment initiated but abandoned.
-   Payment authorized but not captured.
-   Payment captured but browser disconnected.
-   Payment failed.
-   Duplicate callback.
-   Duplicate webhook.
-   Webhook arrives before client callback.
-   Client callback arrives before webhook.
-   Provider API timeout.
-   Provider API success but response lost.

### Subscription

-   Initial authorization succeeds but subscription webhook is delayed.
-   Renewal fails.
-   Renewal succeeds but webhook is duplicated.
-   Subscription is paused.
-   Subscription is cancelled.
-   Subscription expires.
-   User changes plan.
-   User cancels at period end.
-   Admin changes plan.
-   Provider plan changes.
-   Local plan price changes.
-   Provider and local states diverge.

### Coupons

-   Two users redeem last available coupon concurrently.
-   Same user tries multiple times.
-   Payment fails after coupon redemption.
-   Coupon expires during checkout.
-   Coupon is disabled while checkout is open.
-   Refund occurs after coupon discount.

### Users

-   User is banned during an active subscription.
-   User is deactivated during an active subscription.
-   User is reactivated.
-   Banned user attempts Google login.
-   Deactivated user uses old refresh token.
-   User has no subscription.
-   User has multiple historical subscriptions.

------------------------------------------------------------------------

# 45. Admin Billing Actions

Admin UI should initially provide:

``` text
View transaction
View subscription
View payment status
View provider IDs
View coupon/discount
View refund history
```

Potential destructive/financial actions should require confirmation and
audit logging.

If manual refunds are enabled later:

``` text
Refund amount
Reason
Confirmation
Provider refund
Local refund record
Audit log
```

Never mark a transaction refunded locally before the provider confirms
the refund.

------------------------------------------------------------------------

# 46. Plans UI

Admin can edit:

``` text
Name
Description
Price
Currency
Billing interval
Features
Sort order
Active/inactive
```

Important:

Changing a local plan price must not silently mutate existing Razorpay
subscriptions.

When a price change affects recurring billing, the application must
create/use an appropriate new provider plan version and define how
existing subscribers are migrated.

Razorpay's own Plan entities are not editable/deletable after creation,
making this versioning layer necessary. citeturn0search1

------------------------------------------------------------------------

# 47. Coupon UI

Admin can:

``` text
Create
Edit
Disable
View
```

Avoid hard deletion of coupons that have already been used.

Prefer:

``` text
isActive = false
```

for historical integrity.

Coupon table:

``` text
Code
Type
Discount
Applicable Plans
Uses
Max Uses
Start
Expiry
Status
Created
```

------------------------------------------------------------------------

# 48. Auditability

Destructive actions require:

``` text
Confirmation
Reason
Admin identity
Timestamp
Target entity
```

For example:

``` text
Ban user
→ reason required
→ confirmation required
→ audit record created
```

------------------------------------------------------------------------

# 49. Admin Settings

Create:

``` text
/admin/settings
```

but do not expose secrets.

Safe editable settings may include:

``` text
Application display name
Support email
Default currency
Default timezone
Business settings
```

Infrastructure secrets remain in environment/secret management.

------------------------------------------------------------------------

# 50. System Health

Create:

``` text
/admin/system
```

Display:

``` text
Database
API
Email provider
Payment provider
Storage
Background jobs
AI provider
Webhook processing
```

Also expose:

``` text
Failed jobs
Failed webhooks
Unprocessed webhooks
Failed payments
```

Do not expose sensitive credentials.

------------------------------------------------------------------------

# 51. Global Search

Admin search should support:

``` text
User email
User ID
Transaction ID
Razorpay payment ID
Razorpay order ID
Razorpay subscription ID
Coupon code
```

This dramatically reduces operational debugging time.

------------------------------------------------------------------------

# 52. Export

Support server-side exports:

``` text
Users CSV
Transactions CSV
Subscriptions CSV
Coupon redemptions CSV
Revenue CSV
```

Exports must respect admin permissions.

Large exports should be streamed/backgrounded rather than loading
millions of rows into memory.

------------------------------------------------------------------------

# 53. Pagination and Performance

Every admin list endpoint must support:

``` text
page
pageSize
sort
order
filters
search
```

Prefer cursor pagination for very large transaction/event tables.

Never perform unbounded:

``` text
SELECT *
```

from financial or event tables.

Add database indexes based on actual query patterns.

------------------------------------------------------------------------

# 54. API Authorization

Every `/api/admin/*` route must pass:

``` text
authenticate admin token/session
        ↓
requireAdmin
        ↓
permission check
        ↓
controller
```

Never trust:

``` text
role
```

sent by the frontend.

The backend derives authorization from the authenticated admin session.

------------------------------------------------------------------------

# 55. API Error Contract

Admin APIs should use a consistent response format.

Example:

``` json
{
  "success": false,
  "error": {
    "code": "USER_ALREADY_BANNED",
    "message": "The user is already banned."
  }
}
```

Do not expose:

-   Stack traces.
-   Database errors.
-   Secrets.
-   Password details.
-   OTP details.
-   Provider credentials.

------------------------------------------------------------------------

# 56. Transaction Boundaries

Use database transactions for operations that modify multiple related
records.

Examples:

``` text
coupon redemption + transaction creation
subscription activation + entitlement update
ban + session invalidation
refund record + transaction state update
```

External provider calls should not be blindly wrapped in a DB
transaction that remains open while waiting on the network.

Use state machines/outbox/retry patterns where needed.

------------------------------------------------------------------------

# 57. Optional but Strongly Recommended: Outbox

For reliable asynchronous processing, consider:

``` text
OutboxEvent
- id
- type
- payload
- status
- attempts
- nextAttemptAt
- processedAt
```

Useful for:

-   Billing emails.
-   Subscription notifications.
-   Webhook follow-up work.
-   Audit side effects.
-   Background processing.

This is especially useful if the application already uses
queues/background jobs.

------------------------------------------------------------------------

# 58. Email Events

Admin OTP email:

``` text
admin-otp.html
```

Do not log OTP values.

Future billing emails should support:

``` text
Payment successful
Payment failed
Subscription activated
Subscription renewed
Subscription cancelled
Refund processed
```

------------------------------------------------------------------------

# 59. Frontend Structure

Create:

``` text
/admin/login
/admin/verify-otp

/admin/dashboard
/admin/users
/admin/users/:id
/admin/subscriptions
/admin/plans
/admin/coupons
/admin/transactions
/admin/transactions/:id
/admin/analytics
/admin/audit-log
/admin/system
/admin/settings
```

The initial implementation may combine some pages if necessary, but the
backend should not prevent these routes.

------------------------------------------------------------------------

# 60. Admin Store

Create:

``` text
store/adminStore.ts
```

It must contain only admin session state.

Do not mix:

``` text
user auth state
```

with:

``` text
admin auth state
```

The admin Axios client must have its own:

``` text
baseURL
authorization
401 handling
logout handling
```

Never put admin credentials in localStorage.

If tokens are persisted, use the application's established secure
session approach; prefer HTTP-only secure cookies where architecture
permits.

------------------------------------------------------------------------

# 61. Admin Layout

Sidebar:

``` text
Dashboard
Users
Subscriptions
Plans
Coupons
Transactions
Analytics

System
Audit Log
Settings
```

Show only routes allowed by the authenticated admin's permissions.

------------------------------------------------------------------------

# 62. Frontend Security

Frontend guards are UX only.

Example:

``` text
<RequireAdmin />
```

must not be considered authorization.

Every API request must be independently protected by backend middleware.

------------------------------------------------------------------------

# 63. Database Constraints

Add unique constraints wherever provider duplication would be dangerous.

Examples:

``` text
User.email
Plan.slug
Coupon.code
AdminAccount.email
PaymentProviderCustomer(provider, providerCustomerId)
PaymentProviderPlan(provider, providerPlanId)
Subscription(provider, providerSubscriptionId)
PaymentWebhookEvent(provider, providerEventId)
BillingTransaction(provider, providerPaymentId)
```

Use composite uniqueness where the provider namespaces IDs.

------------------------------------------------------------------------

# 64. Soft Deletion / Historical Integrity

Do not physically delete:

``` text
Users with financial history
Transactions
Refunds
Subscriptions
Coupon redemptions
Webhook events
Audit logs
```

Plans and coupons should generally be disabled/retired instead of
deleted once referenced historically.

------------------------------------------------------------------------

# 65. Database Migration

This is a final-phase schema migration.

Before applying:

1.  Backup production database.
2.  Validate migration on a copy/staging DB.
3.  Verify existing Prisma schema.
4.  Verify existing User relations.
5.  Verify existing authentication fields.
6.  Generate migration.
7.  Apply migration.
8.  Run seed.
9.  Verify indexes and constraints.

Do not reset production data.

------------------------------------------------------------------------

# 66. Seed Data

Seed exactly:

``` text
Basic
slug: basic
price: 900
currency: USD
interval: MONTH

Premium
slug: premium
price: 1900
currency: USD
interval: MONTH

Ultimate
slug: ultimate
price: 3900
currency: USD
interval: MONTH
```

Seed operations must be idempotent.

Running:

``` text
npm run db:seed
```

multiple times must not create duplicate plans.

Do not blindly overwrite admin-edited plan configuration during
subsequent deployments.

------------------------------------------------------------------------

# 67. Existing User Migration

Existing users must remain valid.

Migration must define:

``` text
existing user status → ACTIVE
lastLoginAt → nullable
```

Do not fabricate historical login timestamps.

Existing users without subscriptions should resolve to the application's
default/free entitlement.

------------------------------------------------------------------------

# 68. Existing Authentication Compatibility

Before changing authentication:

-   Inspect existing local login flow.
-   Inspect Google OAuth flow.
-   Inspect refresh-token implementation.
-   Inspect authentication middleware.
-   Preserve existing token semantics where possible.
-   Add account-status enforcement centrally.
-   Ensure both local and Google login paths honor `BANNED` and
    `DEACTIVATED`.

------------------------------------------------------------------------

# 69. Billing Source of Truth

The following hierarchy should be enforced:

### Payment status

Provider + verified webhook/payment API state.

### Local transaction

Immutable application ledger derived from verified provider events.

### Subscription

Local representation synchronized with provider.

### Entitlement

Application authorization derived from subscription/override state.

### Dashboard analytics

Aggregated from the local ledger and subscription records.

Never calculate revenue directly from frontend state.

------------------------------------------------------------------------

# 70. Razorpay-Specific Requirements

The future integration must support:

``` text
Razorpay Orders
Razorpay Payments
Razorpay Subscriptions
Razorpay Plans
Razorpay Refunds
Razorpay Webhooks
```

Razorpay exposes separate APIs for Orders, Payments, Subscriptions, and
related billing resources.
citeturn0search10turn0search14turn0search3

Payment Links should not be treated as the core subscription
architecture. They may be added later for administrative/manual
collection if required. Razorpay provides separate Payment Link APIs and
webhook events. citeturn0search0turn0search15

------------------------------------------------------------------------

# 71. Do Not Build These Shortcuts

Do not:

-   Store plaintext admin passwords.
-   Store plaintext OTPs.
-   Put Razorpay secrets in frontend code.
-   Use floating-point money.
-   Hardcode plan prices in React.
-   Treat frontend checkout success as final payment confirmation.
-   Delete financial history.
-   Use one boolean to represent every account state.
-   Use `User.planId` as the complete billing model.
-   Hard-delete used coupons.
-   Trust client-provided plan prices.
-   Trust client-provided discount amounts.
-   Trust client-provided user IDs for admin actions.
-   Process webhooks without signature verification.
-   Process webhook events without idempotency.
-   Make Razorpay Plan IDs the only plan identity.
-   Mutate historical transaction amounts when plan prices change.
-   Let admin UI bypass backend authorization.

------------------------------------------------------------------------

# 72. Testing Requirements

## Backend

Run:

``` bash
npx prisma validate
npx prisma generate
npx tsc --noEmit
```

Then:

``` bash
npm run db:seed
```

Apply migration against a real test Postgres database.

------------------------------------------------------------------------

## Authentication tests

Test:

``` text
Correct admin email + password
Wrong password
Wrong admin email
OTP expiration
Wrong OTP
OTP attempt limit
OTP reuse
Multiple OTP requests
Admin logout
Expired admin token
Inactive admin
```

------------------------------------------------------------------------

## User status tests

Test:

``` text
Active login
Deactivated login
Banned login
Deactivated refresh token
Banned refresh token
Google login while deactivated
Google login while banned
Reactivation
```

------------------------------------------------------------------------

## Coupon tests

Test:

``` text
Valid coupon
Expired coupon
Not-yet-active coupon
Wrong plan
Max usage
Per-user usage
Concurrent redemption
100% discount
Discount > subtotal
Failed payment after coupon
Duplicate webhook
```

------------------------------------------------------------------------

## Billing tests

Test:

``` text
One-time successful payment
One-time failed payment
Recurring initial authorization
Recurring renewal
Failed renewal
Cancellation
Pause/resume
Refund
Partial refund
Duplicate webhook
Out-of-order webhook
Webhook signature failure
Provider timeout
Provider/local state mismatch
```

------------------------------------------------------------------------

# 73. Frontend Verification

Run:

``` bash
npm run build
npm run typecheck
```

Verify:

``` text
/admin/login
OTP flow
Admin redirect
Admin logout
Protected routes
Users
User detail
Ban/deactivate/reactivate
Plans
Coupons
Transactions
Analytics
Audit log
```

------------------------------------------------------------------------

# 74. API Verification

Exercise endpoints with curl/Postman against the running backend.

Verify:

``` text
401 without admin auth
403 without permission
200 with valid admin auth
400 invalid payload
404 unknown user
409 duplicate/conflicting state
```

Destructive actions must be verified independently from frontend UI
tests.

------------------------------------------------------------------------

# 75. Observability

Add structured logging for:

``` text
Admin login success/failure
OTP send failure
OTP verification failure
Payment provider errors
Webhook processing failures
Subscription state transitions
Refund failures
Database errors
Background job failures
```

Never log:

``` text
password
OTP
JWT
Razorpay secret
webhook secret
full payment credentials
```

Use request/correlation IDs so billing failures can be traced across API
→ provider → webhook → database.

------------------------------------------------------------------------

# 76. Rate Limiting

Rate-limit:

``` text
/admin/auth/send-otp
/admin/auth/verify-otp
/admin/auth/login
```

Also protect:

``` text
payment creation
coupon validation
webhook endpoints
```

Webhook rate limiting must not interfere with legitimate provider
retries.

------------------------------------------------------------------------

# 77. Security Headers / Transport

Production requirements:

-   HTTPS.
-   Secure cookies.
-   HttpOnly cookies where used.
-   SameSite policy appropriate to the architecture.
-   CSRF protection for cookie-authenticated state-changing endpoints.
-   CORS restricted to trusted origins.
-   Security headers.
-   Request body limits.
-   Input validation.
-   Output sanitization where relevant.

------------------------------------------------------------------------

# 78. Data Privacy

Avoid collecting unnecessary personal data.

If storing:

``` text
IP address
user agent
login history
webhook payloads
```

define reasonable retention policies.

Do not store sensitive payment credentials. Razorpay should remain the
payment credential processor.

------------------------------------------------------------------------

# 79. Final Backend File Structure

Adapt to the existing project structure, but target a separation similar
to:

``` text
src/
├── config/
│   └── env.ts
│
├── middleware/
│   ├── authenticate.ts
│   ├── requireAdmin.ts
│   └── requirePermission.ts
│
├── routes/
│   ├── admin.routes.ts
│   └── ...
│
├── controllers/
│   ├── adminAuth.controller.ts
│   ├── adminUsers.controller.ts
│   ├── adminPlans.controller.ts
│   ├── adminCoupons.controller.ts
│   ├── adminBilling.controller.ts
│   └── adminAnalytics.controller.ts
│
├── services/
│   ├── adminAuth.service.ts
│   ├── adminUser.service.ts
│   ├── plan.service.ts
│   ├── coupon.service.ts
│   ├── subscription.service.ts
│   ├── billing.service.ts
│   ├── entitlement.service.ts
│   ├── audit.service.ts
│   └── reconciliation.service.ts
│
└── providers/
    └── razorpay/
        ├── razorpay.client.ts
        ├── razorpay.payment.ts
        ├── razorpay.subscription.ts
        ├── razorpay.webhook.ts
        └── razorpay.types.ts
```

Do not duplicate services that already exist. Integrate with the current
architecture.

------------------------------------------------------------------------

# 80. Final Prisma Domain

The final database should conceptually contain:

``` text
User
AuthProvider / Account
UserLoginEvent

AdminAccount
AdminOtp
AdminAuditLog

Plan
PaymentProviderPlan

Subscription
EntitlementOverride

PaymentProviderCustomer
PaymentOrder
BillingTransaction
Refund
PaymentWebhookEvent

Coupon
CouponPlan
CouponRedemption

OutboxEvent
```

Some of these may map to existing application models rather than being
created as new tables.

Before implementation, inspect the existing Prisma schema and reuse
compatible models instead of creating duplicates.

------------------------------------------------------------------------

# 81. Final Admin Routes

``` text
/api/admin/auth/send-otp
/api/admin/auth/verify-otp
/api/admin/auth/refresh
/api/admin/auth/logout
/api/admin/auth/me

/api/admin/overview

/api/admin/users
/api/admin/users/:id
/api/admin/users/:id/transactions
/api/admin/users/:id/subscriptions
/api/admin/users/:id/activity
/api/admin/users/:id/ban
/api/admin/users/:id/deactivate
/api/admin/users/:id/reactivate

/api/admin/plans
/api/admin/plans/:id

/api/admin/coupons
/api/admin/coupons/:id
/api/admin/coupons/:id/redemptions

/api/admin/subscriptions
/api/admin/subscriptions/:id

/api/admin/transactions
/api/admin/transactions/:id
/api/admin/transactions/:id/refunds

/api/admin/analytics/revenue
/api/admin/analytics/users
/api/admin/analytics/subscriptions
/api/admin/analytics/coupons

/api/admin/audit-log
/api/admin/system
/api/admin/settings
```

Provider webhook endpoint should be outside authenticated admin routes:

``` text
/api/webhooks/razorpay
```

It must authenticate using Razorpay's webhook signature mechanism rather
than an admin JWT.

------------------------------------------------------------------------

# 82. Final Frontend Pages

``` text
/admin/login
/admin/dashboard
/admin/users
/admin/users/:id
/admin/subscriptions
/admin/plans
/admin/coupons
/admin/transactions
/admin/transactions/:id
/admin/analytics
/admin/audit-log
/admin/system
/admin/settings
```

Initial implementation can prioritize:

1.  Dashboard
2.  Users
3.  Plans
4.  Coupons
5.  Transactions
6.  Analytics
7.  Audit Log

Subscriptions can be surfaced inside Users/Transactions initially but
should have a dedicated backend domain.

------------------------------------------------------------------------

# 83. Definition of Done

This phase is complete only when:

-   [ ] Admin authentication is isolated from user authentication.
-   [ ] Admin password is hashed.
-   [ ] Admin OTP is hashed, expiring, one-time, and rate-limited.
-   [ ] Admin sessions/tokens are separately secured.
-   [ ] Existing users migrate safely.
-   [ ] Banned users cannot authenticate.
-   [ ] Deactivated users cannot authenticate.
-   [ ] Existing sessions are invalidated on ban/deactivation.
-   [ ] Google authentication respects account status.
-   [ ] Last login is recorded.
-   [ ] Three plans are seeded.
-   [ ] Plans are database-driven.
-   [ ] Plan history is preserved.
-   [ ] Razorpay provider mapping exists.
-   [ ] Razorpay plan immutability is accounted for.
-   [ ] One-time payment schema exists.
-   [ ] Recurring subscription schema exists.
-   [ ] Transaction ledger exists.
-   [ ] Refund schema exists.
-   [ ] Coupon schema exists.
-   [ ] Coupon-plan many-to-many relationship exists.
-   [ ] Coupon redemption history exists.
-   [ ] Money is stored as integer minor units.
-   [ ] Historical prices/discounts are snapshotted.
-   [ ] Razorpay IDs are stored separately.
-   [ ] Webhook events are persisted.
-   [ ] Webhooks are signature-verified.
-   [ ] Webhooks are idempotent.
-   [ ] Duplicate events cannot duplicate financial records.
-   [ ] Subscription state is synchronized from provider events.
-   [ ] Admin can view users.
-   [ ] Admin can search/filter users.
-   [ ] Admin can deactivate/reactivate users.
-   [ ] Permanent ban behavior is enforced.
-   [ ] Admin can manage plans.
-   [ ] Admin can manage coupons.
-   [ ] Admin can view transactions.
-   [ ] Admin can view subscription history.
-   [ ] Revenue metrics are defined consistently.
-   [ ] Audit logging is implemented.
-   [ ] Destructive actions require confirmation/reason where
    appropriate.
-   [ ] Admin permissions are backend-enforced.
-   [ ] System health is visible.
-   [ ] Exports are supported or architecturally prepared.
-   [ ] Database indexes are added for admin/billing query patterns.
-   [ ] Migration is tested against PostgreSQL.
-   [ ] Seed is idempotent.
-   [ ] Existing application functionality remains intact.
-   [ ] Backend typecheck passes.
-   [ ] Prisma validation passes.
-   [ ] Frontend typecheck passes.
-   [ ] Frontend production build passes.
-   [ ] Authentication tests pass.
-   [ ] Billing tests pass.
-   [ ] Webhook tests pass.
-   [ ] Ban/deactivation tests pass.
-   [ ] Coupon concurrency/idempotency tests pass.

------------------------------------------------------------------------

# 84. Implementation Rule

Because this is the final architectural phase, **do not implement only
the visible Admin Dashboard UI and postpone the underlying schema
decisions**.

Before coding, inspect the current:

-   Prisma schema.
-   User model.
-   Authentication service.
-   Google OAuth implementation.
-   Refresh-token implementation.
-   Existing subscription/billing models, if any.
-   Existing email service.
-   Existing environment/config system.
-   Existing admin/superadmin code, if any.
-   Existing payment abstractions, if any.
-   Existing background job/queue architecture.

Then reconcile this specification against the existing system.

If an equivalent model already exists, extend/reuse it.

If an existing model conflicts with this specification, migrate it
rather than creating a duplicate parallel system.

**All required schema changes for users, authentication, plans,
subscriptions, billing, payments, refunds, coupons, provider mappings,
webhook idempotency, audit logs, entitlements, and admin accounts should
be completed in this phase.**

The objective is to make this the final foundational schema rather than
repeatedly redesigning billing and administration later.
