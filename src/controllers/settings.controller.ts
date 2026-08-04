import { Request, Response, NextFunction } from 'express';
import * as settingsService from '../services/settings.service';
import * as googleService from '../services/google.service';
import { buildGoogleAuthRedirect } from '../services/google.service';
import { env } from '../config/env';

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.getSettings(req.user!.sub);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateAppearance(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.updateAppearance(req.user!.sub, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.updateNotificationPreferences(req.user!.sub, req.body);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateAI(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await settingsService.updateAIPreferences(req.user!.sub, req.body);
    res.json({ ai: settings });
  } catch (err) {
    next(err);
  }
}

export async function updateRecoveryEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const recoveryEmail = await settingsService.updateRecoveryEmail(req.user!.sub, req.body.recoveryEmail ?? null);
    res.json({ recoveryEmail });
  } catch (err) {
    next(err);
  }
}

export async function googleCalendarStart(req: Request, res: Response, next: NextFunction) {
  try {
    const returnTo =
      typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
        ? req.query.returnTo.trim()
        : '/settings?integration=google-calendar';
    const absoluteReturnTo = `${env.FRONTEND_URL}${returnTo.startsWith('/') ? returnTo : `/${returnTo}`}`;
    const { url } = buildGoogleAuthRedirect('calendar-connect', absoluteReturnTo);
    res.json({ url });
  } catch (err) {
    next(err);
  }
}

export async function syncGoogleCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await googleService.syncGoogleCalendarTasks(req.user!.sub);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function disconnectGoogleCalendar(req: Request, res: Response, next: NextFunction) {
  try {
    await googleService.disconnectGoogleCalendar(req.user!.sub);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}