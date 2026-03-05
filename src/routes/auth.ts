import { Router } from 'express';
import { AUTH_COOKIE_NAME } from '../config';
import { buildDevUserFromCode, clearSessionCookie, getCookieOptions, issueSessionToken } from '../services/authService';
import { requireAuth } from '../middleware/auth';

function renderAuthCallbackPage(ok: boolean): string {
  const eventType = ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Authentication Complete</title>
  </head>
  <body>
    <script>
      (function () {
        if (window.opener) {
          window.opener.postMessage({ type: '${eventType}' }, '*');
        }
        window.close();
      })();
    </script>
    <p>Authentication complete. You can close this window.</p>
  </body>
</html>`;
}

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    return res.json({ user: req.user, csrfToken: null });
  });

  router.post('/sdk', (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : undefined;
    const user = buildDevUserFromCode(code);
    const token = issueSessionToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
    return res.json({ ok: true, user });
  });

  router.post('/logout', requireAuth, (_req, res) => {
    clearSessionCookie(res);
    return res.status(204).send();
  });

  router.get('/callback', (req, res) => {
    const code = typeof req.query?.code === 'string' ? req.query.code : undefined;
    if (!code) {
      return res.status(400).type('html').send(renderAuthCallbackPage(false));
    }

    const user = buildDevUserFromCode(code);
    const token = issueSessionToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions());
    return res.type('html').send(renderAuthCallbackPage(true));
  });

  return router;
}
