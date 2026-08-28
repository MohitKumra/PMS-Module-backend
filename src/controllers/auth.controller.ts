// backend/src/controllers/auth.controller.ts
// Thin request/response layer — delegates all logic to auth.service.ts.
// Sets the refresh token as an httpOnly cookie on login/refresh.

import type { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import * as googleService from '../services/google.service';
import { verifyRefreshToken } from '../lib/jwt';
import { env } from '../config/env';
import type { GoogleAuthPurpose } from '../types';

const REFRESH_COOKIE = 'refreshToken';
// `secure: isProd` mirrors the admin auth cookie. Hard-coding `secure: true`
// prevented the refresh cookie from being stored over plain http://localhost,
// so any 401 locally had no cookie to refresh from and the app force-redirected
// to /login.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, name } = req.body;
    const timezone = req.headers['x-client-timezone'];
    const { response, refreshToken } = await authService.signup(
      email,
      password,
      name,
      typeof timezone === 'string' ? timezone : undefined
    );
    // Persist a refresh cookie so a new account can renew its session, matching login.
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    res.status(201).json(response);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const timezone = req.headers['x-client-timezone'];
    const { response, refreshToken } = await authService.login(
      email,
      password,
      typeof timezone === 'string' ? timezone : undefined
    );
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTS);
    res.json(response);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      res.status(401).json({ error: { code: 'NO_REFRESH_TOKEN', message: 'No refresh token' } });
      return;
    }
    const tokens = await authService.refreshTokens(token);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, COOKIE_OPTS);
    res.json({ accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(REFRESH_COOKIE);
  res.json({ success: true });
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.requestPasswordReset(req.body.email);
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPasswordByRecoveryEmail(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.requestPasswordResetByRecoveryEmail(req.body.recoveryEmail);
    res.json({ success: true, message: 'If that recovery email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.getMe(req.user!.sub);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

/**
 * Renders a tiny HTML page that finishes the OAuth flow from inside the popup:
 *  - If a window.opener exists (popup flow) it postMessages the result to the
 *    configured FRONTEND_URL and closes itself.
 *  - Otherwise (full-page OAuth, e.g. calendar-connect opened in the main tab)
 *    it falls back to the legacy fragment-token redirect so existing flows work.
 * No access/refresh tokens are ever sent through postMessage().
 */
function sendGoogleOAuthPopupHtml(
  res: Response,
  result: {
    success: boolean;
    message?: string;
    purpose: GoogleAuthPurpose;
    nonce: string;
    redirectTo?: string;
    accessToken?: string;
    refreshToken?: string;
  }
) {
  const { success, message, purpose, nonce, redirectTo, accessToken, refreshToken } = result;
  const type = success ? 'GOOGLE_AUTH_SUCCESS' : 'GOOGLE_AUTH_ERROR';
  const targetOrigin = env.FRONTEND_URL;

  // Escape "</script" sequences and < to keep the JSON safe inside the script tag.
  const payload = JSON.stringify({
    type,
    purpose,
    nonce,
    ...(message ? { error: message } : {}),
  }).replace(/</g, '\\u003c');

  const hasTokens =
    typeof redirectTo === 'string' && typeof accessToken === 'string' && typeof refreshToken === 'string';

  let fallback: string;
  if (hasTokens) {
    fallback = `window.location.href = ${JSON.stringify(`${redirectTo}#accessToken=${accessToken}&refreshToken=${refreshToken}`)};`;
  } else if (!success) {
    fallback = `document.body.textContent = ${JSON.stringify(message ?? 'Unable to complete Google sign-in.')};`;
  } else {
    fallback = 'window.close();';
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="robots" content="noindex, nofollow" />
<title>Signing you in…</title>
</head>
<body>
<script>
  (function () {
    var payload = ${payload};
    if (window.opener) {
      try {
        window.opener.postMessage(payload, ${JSON.stringify(targetOrigin)});
      } catch (err) {
        // ignore - opener may reject the message
      }
      window.close();
      return;
    }
    ${fallback}
  })();
</script>
</body>
</html>`;

  res
    .set('Cache-Control', 'no-store, max-age=0')
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(html);
}

export async function googleStart(req: Request, res: Response, next: NextFunction) {
  try {
    const purpose = req.query.purpose === 'calendar-connect' ? 'calendar-connect' : 'signin';
    const returnTo =
      typeof req.query.returnTo === 'string' && req.query.returnTo.trim()
        ? req.query.returnTo.trim()
        : purpose === 'calendar-connect'
          ? `${env.FRONTEND_URL}/settings?integration=google-calendar`
          : `${env.FRONTEND_URL}/google/callback`;
    const nonce = typeof req.query.nonce === 'string' && req.query.nonce.trim() ? req.query.nonce.trim() : undefined;
    const { url } = googleService.buildGoogleAuthRedirect(purpose, returnTo, nonce);
    // 'redirect=1' lets the frontend open the OAuth URL synchronously with
    // window.open() (avoiding async-before-open popup blockers), while the
    // default JSON response is preserved for any existing callers.
    if (req.query.redirect === '1' || req.query.redirect === 'true') {
      res.redirect(302, url);
      return;
    }
    res.json({ url });
  } catch (err) {
    next(err);
  }
}

export async function googleCallback(req: Request, res: Response, next: NextFunction) {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  // Extract purpose/nonce up front so error responses can still echo them.
  const stateCtx = googleService.getGoogleStateContext(state);

  try {
    const currentRefreshToken = req.cookies?.[REFRESH_COOKIE];
    let currentUserId: string | undefined;

    if (currentRefreshToken) {
      try {
        const payload = verifyRefreshToken(currentRefreshToken);
        currentUserId = payload.sub;
      } catch {
        currentUserId = undefined;
      }
    }

    const result = await googleService.handleGoogleAuthCallback(code, state, currentUserId);
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTS);
    sendGoogleOAuthPopupHtml(res, {
      success: true,
      purpose: result.purpose,
      nonce: result.nonce,
      redirectTo: result.redirectTo,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode ?? 500;
    const message = (err as Error)?.message ?? 'Authentication failed';
    // Keep non-200 so non-popup consumers can detect failure, but still render
    // the same HTML so the popup can forward the error to its opener.
    res.status(statusCode >= 500 ? 500 : 400);
    sendGoogleOAuthPopupHtml(res, {
      success: false,
      message,
      purpose: stateCtx.purpose,
      nonce: stateCtx.nonce,
    });
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    await authService.setPassword(req.user!.sub, req.body.newPassword);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
