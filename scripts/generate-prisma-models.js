const fs = require('fs');
const path = require('path');
const modelsDir = path.join(process.cwd(), 'prisma', 'models');

const models = {
  'admin-account.prisma': `model AdminAccount {
  id           String         @id @default(cuid())
  email        String         @unique
  passwordHash String
  role         AdminRole      @default(ADMIN)
  isActive     Boolean        @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  auditLogs    AdminAuditLog[]
  otps         AdminOtp[]

  @@index([email])
  @@index([role, isActive])
}
`,

  'admin-otp.prisma': `model AdminOtp {
  id             String       @id @default(cuid())
  adminAccountId String
  codeHash       String
  expiresAt      DateTime
  consumedAt     DateTime?
  attempts       Int          @default(0)
  maxAttempts    Int          @default(5)
  createdAt      DateTime     @default(now())
  adminAccount   AdminAccount @relation(fields: [adminAccountId], references: [id], onDelete: Cascade)

  @@index([adminAccountId, expiresAt])
}
`,

  'admin-audit-log.prisma': `model AdminAuditLog {
  id             String       @id @default(cuid())
  adminAccountId String
  action         String
  entityType     String
  entityId       String?
  before         Json?
  after          Json?
  reason         String?
  ipAddress      String?
  userAgent      String?
  requestId      String?
  createdAt      DateTime     @default(now())
  adminAccount   AdminAccount @relation(fields: [adminAccountId], references: [id], onDelete: Cascade)

  @@index([adminAccountId])
  @@index([entityType, entityId])
  @@index([action, createdAt])
}
`,

  'user-login-event.prisma': `model UserLoginEvent {
  id        String   @id @default(cuid())
  userId    String
  provider  String
  success   Boolean
  ipAddress String?
  userAgent String?
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}
`,

  'plan.prisma': `model Plan {
  id                   String                @id @default(cuid())
  slug                 String                @unique
  name                 String
  description          String?
  currency             String                @default("USD")
  priceCents           Int
  billingInterval      BillingInterval       @default(MONTH)
  features             Json
  sortOrder            Int                   @default(0)
  isActive             Boolean               @default(true)
  version              Int                   @default(1)
  metadata             Json?
  createdByAdminId     String?
  updatedByAdminId     String?
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt
  paymentProviderPlans PaymentProviderPlan[]
  subscriptions        Subscription[]
  paymentOrders        PaymentOrder[]
  billingTransactions  BillingTransaction[]
  couponPlans          CouponPlan[]
  entitlementOverrides EntitlementOverride[]

  @@index([slug])
  @@index([isActive, sortOrder])
}
`,

  'payment-provider-plan.prisma': `model PaymentProviderPlan {
  id              String          @id @default(cuid())
  planId          String
  provider        String
  providerPlanId  String
  currency        String
  amountCents     Int
  billingInterval BillingInterval
  isActive        Boolean         @default(true)
  retiredAt       DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  plan            Plan            @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([provider, providerPlanId])
  @@index([planId, provider, isActive])
}
`,

  'subscription.prisma': `model Subscription {
  id                     String              @id @default(cuid())
  userId                 String
  planId                 String
  provider               String
  providerSubscriptionId String
  providerPlanId         String?
  status                 SubscriptionStatus
  billingInterval        BillingInterval
  quantity               Int                 @default(1)
  currentPeriodStart     DateTime
  currentPeriodEnd       DateTime
  startedAt              DateTime            @default(now())
  trialStartAt           DateTime?
  trialEndAt             DateTime?
  cancelAtPeriodEnd      Boolean             @default(false)
  cancelledAt            DateTime?
  endedAt                DateTime?
  autoRenew              Boolean             @default(true)
  createdAt              DateTime            @default(now())
  updatedAt              DateTime            @updatedAt
  user                   User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan                   Plan                @relation(fields: [planId], references: [id], onDelete: Restrict)
  events                 SubscriptionEvent[]
  invoices               Invoice[]
  billingTransactions    BillingTransaction[]

  @@unique([provider, providerSubscriptionId])
  @@index([userId, status])
  @@index([status, currentPeriodEnd])
}
`,

  'subscription-event.prisma': `model SubscriptionEvent {
  id              String                @id @default(cuid())
  subscriptionId  String
  eventType       SubscriptionEventType
  provider        String
  providerEventId String?
  payload         Json?
  occurredAt      DateTime
  createdAt       DateTime              @default(now())
  subscription    Subscription          @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([subscriptionId, occurredAt])
  @@index([eventType, createdAt])
}
`,

  'entitlement-override.prisma': `model EntitlementOverride {
  id               String    @id @default(cuid())
  userId           String
  planId           String
  reason           String
  startsAt         DateTime  @default(now())
  endsAt           DateTime?
  createdByAdminId String
  revokedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan             Plan      @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([userId, revokedAt, endsAt])
}
`,

  'payment-provider-customer.prisma': `model PaymentProviderCustomer {
  id                 String   @id @default(cuid())
  userId             String
  provider           String
  providerCustomerId String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([provider, providerCustomerId])
  @@unique([userId, provider])
  @@index([userId])
}
`,

  'payment-order.prisma': `model PaymentOrder {
  id                  String               @id @default(cuid())
  userId              String
  planId              String?
  type                PaymentOrderType
  provider            String
  providerOrderId     String
  currency            String
  subtotalCents       Int
  discountCents       Int                  @default(0)
  taxCents            Int                  @default(0)
  totalCents          Int
  status              PaymentStatus
  couponId            String?
  idempotencyKey      String?              @unique
  metadata            Json?
  expiresAt           DateTime?
  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @updatedAt
  user                User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan                Plan?                @relation(fields: [planId], references: [id], onDelete: SetNull)
  couponRedemptions   CouponRedemption[]
  billingTransactions BillingTransaction[]
  invoices            Invoice[]

  @@unique([provider, providerOrderId])
  @@index([userId, status])
}
`,

  'invoice.prisma': `model Invoice {
  id                String         @id @default(cuid())
  userId            String
  subscriptionId    String?
  orderId           String?
  provider          String?
  providerInvoiceId String?
  invoiceNumber     String         @unique
  status            InvoiceStatus  @default(DRAFT)
  currency          String
  subtotalCents     Int
  discountCents     Int            @default(0)
  taxCents          Int            @default(0)
  totalCents        Int
  issuedAt          DateTime       @default(now())
  dueAt             DateTime?
  paidAt            DateTime?
  pdfUrl            String?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  user              User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscription      Subscription?  @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
  order             PaymentOrder?  @relation(fields: [orderId], references: [id], onDelete: SetNull)
  transactions      BillingTransaction[]

  @@unique([provider, providerInvoiceId])
  @@index([userId, status])
}
`,

  'billing-transaction.prisma': `model BillingTransaction {
  id                     String                 @id @default(cuid())
  userId                 String
  subscriptionId         String?
  orderId                String?
  invoiceId              String?
  planId                 String?
  couponId               String?
  provider               String
  providerPaymentId      String?
  providerOrderId        String?
  providerInvoiceId      String?
  providerSubscriptionId String?
  transactionType        BillingTransactionType
  status                 PaymentStatus
  currency               String
  grossAmountCents       Int
  discountCents          Int                    @default(0)
  taxCents               Int                    @default(0)
  netAmountCents         Int
  providerFeeCents       Int?
  paidAt                 DateTime?
  failedAt               DateTime?
  failureCode            String?
  failureReason          String?
  reference              String?
  metadata               Json?
  createdAt              DateTime               @default(now())
  updatedAt              DateTime               @updatedAt
  user                   User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscription           Subscription?          @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
  order                  PaymentOrder?          @relation(fields: [orderId], references: [id], onDelete: SetNull)
  invoice                Invoice?               @relation(fields: [invoiceId], references: [id], onDelete: SetNull)
  plan                   Plan?                  @relation(fields: [planId], references: [id], onDelete: SetNull)
  refunds                Refund[]
  couponRedemptions      CouponRedemption[]

  @@unique([provider, providerPaymentId])
  @@index([userId, createdAt])
  @@index([status, createdAt])
  @@index([providerOrderId])
  @@index([providerSubscriptionId])
}
`,

  'refund.prisma': `model Refund {
  id                 String             @id @default(cuid())
  transactionId      String
  userId             String
  provider           String
  providerRefundId   String?
  amountCents        Int
  currency           String
  status             RefundStatus       @default(PENDING)
  reason             String?
  initiatedByAdminId String?
  processedAt        DateTime?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  transaction        BillingTransaction @relation(fields: [transactionId], references: [id], onDelete: Restrict)
  user               User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerRefundId])
  @@index([transactionId])
  @@index([userId, status])
}
`,

  'payment-webhook-event.prisma': `model PaymentWebhookEvent {
  id                 String                  @id @default(cuid())
  provider           String
  providerEventId    String
  eventType          String
  payload            Json
  signature          String
  receivedAt         DateTime                @default(now())
  processedAt        DateTime?
  processingStatus   WebhookProcessingStatus @default(RECEIVED)
  processingAttempts Int                     @default(0)
  lastError          String?
  createdAt          DateTime                @default(now())
  updatedAt          DateTime                @updatedAt

  @@unique([provider, providerEventId])
  @@index([processingStatus, receivedAt])
}
`,

  'coupon.prisma': `model Coupon {
  id                 String             @id @default(cuid())
  code               String             @unique
  description        String?
  type               CouponType
  value              Int
  currency           String?
  maxUses            Int?
  usedCount          Int                @default(0)
  perUserLimit       Int?               @default(1)
  minimumAmountCents Int?
  startsAt           DateTime?
  expiresAt          DateTime?
  isActive           Boolean            @default(true)
  appliesToAllPlans  Boolean            @default(true)
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
  couponPlans        CouponPlan[]
  redemptions        CouponRedemption[]

  @@index([code])
  @@index([isActive, expiresAt])
}
`,

  'coupon-plan.prisma': `model CouponPlan {
  couponId  String
  planId    String
  createdAt DateTime @default(now())
  coupon    Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  plan      Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@id([couponId, planId])
}
`,

  'coupon-redemption.prisma': `model CouponRedemption {
  id            String              @id @default(cuid())
  couponId      String
  userId        String
  orderId       String?
  transactionId String?
  discountCents Int
  redeemedAt    DateTime            @default(now())
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  coupon        Coupon              @relation(fields: [couponId], references: [id], onDelete: Restrict)
  user          User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  order         PaymentOrder?       @relation(fields: [orderId], references: [id], onDelete: SetNull)
  transaction   BillingTransaction? @relation(fields: [transactionId], references: [id], onDelete: SetNull)

  @@index([couponId, userId])
  @@index([userId, redeemedAt])
}
`,

  'outbox-event.prisma': `model OutboxEvent {
  id            String    @id @default(cuid())
  type          String
  payload       Json
  status        String    @default("PENDING")
  attempts      Int       @default(0)
  nextAttemptAt DateTime?
  processedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status, nextAttemptAt])
}
`
};

for (const [file, content] of Object.entries(models)) {
  fs.writeFileSync(path.join(modelsDir, file), content, 'utf8');
}

const userModelContent = `model User {
  id                       String                    @id @default(cuid())
  email                    String                    @unique
  passwordHash             String?
  googleId                 String?                   @unique
  name                     String?
  avatarUrl                String?
  timezone                 String                    @default("UTC")
  pushSubscription         String?
  status                   UserStatus                @default(ACTIVE)
  tokenVersion             Int                       @default(0)
  lastLoginAt              DateTime?
  statusChangedAt          DateTime?
  statusChangedByAdminId   String?
  statusReason             String?
  createdAt                DateTime                  @default(now())
  updatedAt                DateTime                  @updatedAt
  recoveryEmail            String?
  coachChats               AICoachChat[]
  aiPreferences            AIPreference?
  focusSessions            FocusSession[]
  focusTimeLogs            FocusTimeLog[]
  goals                    Goal[]
  googleCalendarConnection GoogleCalendarConnection?
  googleCalendarSyncItems  GoogleCalendarSyncItem[]
  habits                   Habit[]
  integrationLogs          IntegrationLog[]
  notes                    Note[]
  notifications            NotificationLog[]
  notificationPreferences  NotificationPreference?
  notionConnection         NotionConnection?
  passwordResetTokens      PasswordResetToken[]
  pointLedger              PointLedger[]
  projects                 Project[]
  tasks                    Task[]
  taskActivities           TaskActivity[]
  taskTimeEntries          TaskTimeEntry[]
  achievements             UserAchievement[]
  preferences              UserPreference?
  subscriptions            Subscription[]
  paymentOrders            PaymentOrder[]
  billingTransactions      BillingTransaction[]
  invoices                 Invoice[]
  refunds                  Refund[]
  couponRedemptions        CouponRedemption[]
  entitlementOverrides     EntitlementOverride[]
  loginEvents              UserLoginEvent[]

  @@index([email])
  @@index([status])
  @@index([lastLoginAt])
  @@index([createdAt])
}
`;

fs.writeFileSync(path.join(modelsDir, 'user.prisma'), userModelContent, 'utf8');
console.log('All models and User written successfully.');