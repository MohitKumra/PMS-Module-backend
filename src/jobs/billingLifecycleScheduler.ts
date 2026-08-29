// backend/src/jobs/billingLifecycleScheduler.ts
// Periodic billing lifecycle maintenance:
// - send renewal reminders
// - expire access when a non-renewing period ends

import cron from 'node-cron';
import { processBillingLifecycleNotifications } from '../services/billing.service';

export function startBillingLifecycleScheduler(): void {
  console.info('🧾  Billing lifecycle scheduler initialized (runs hourly).');
  (globalThis as any).__schedulerBillingLifecycleRunning = true;

  cron.schedule('0 * * * *', async () => {
    try {
      const result = await processBillingLifecycleNotifications();
      if (result.remindersSent > 0 || result.expiredSubscriptions > 0) {
        console.log(
          `[Billing] Lifecycle pass complete: ${result.remindersSent} reminder(s), ${result.expiredSubscriptions} expiry update(s).`
        );
      }
    } catch (err) {
      console.error('Error processing billing lifecycle notifications:', err);
    }
  });
}
