// backend/src/controllers/notifications.controller.ts
import { Request, Response, NextFunction } from 'express';
import * as notifService from '../services/notification.service';
import { env } from '../config/env';

export async function getVapidKey(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ publicKey: env.VAPID_PUBLIC_KEY || null });
  } catch (err) { next(err); }
}

export async function subscribe(req: Request, res: Response, next: NextFunction) {
  try {
    await notifService.registerPushSubscription(req.user!.sub, req.body);
    res.json({ success: true, message: 'Push subscription registered successfully' });
  } catch (err) { next(err); }
}

export async function unsubscribe(req: Request, res: Response, next: NextFunction) {
  try {
    await notifService.unregisterPushSubscription(req.user!.sub);
    res.json({ success: true, message: 'Push subscription removed successfully' });
  } catch (err) { next(err); }
}

export async function getLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const logs = await notifService.getLogs(req.user!.sub);
    res.json(logs);
  } catch (err) { next(err); }
}

export async function markAsRead(req: Request, res: Response, next: NextFunction) {
  try {
    await notifService.markAllAsRead(req.user!.sub);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function sendTestNotification(req: Request, res: Response, next: NextFunction) {
  try {
    const { title, body, channels } = req.body;
    await notifService.sendNotification(
      req.user!.sub,
      title || 'Test Notification 🔔',
      body || 'This is a test notification from FlowSpace.',
      channels || ['BROWSER_PUSH', 'EMAIL']
    );
    res.json({ success: true, message: 'Test notification sent' });
  } catch (err) { next(err); }
}
