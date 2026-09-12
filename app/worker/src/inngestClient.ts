/**
 * Inngest client singleton for the worker.
 * The event key + signing key come from the K8s secret; in dev the
 * self-hosted single-binary accepts empty values.
 */
import { Inngest } from 'inngest';

import { env } from './config.js';

export const inngest = new Inngest({
  id: env.INNGEST_APP_ID,
  ...(env.INNGEST_EVENT_KEY ? { eventKey: env.INNGEST_EVENT_KEY } : {}),
  ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}),
  ...(env.INNGEST_BASE_URL ? { baseUrl: env.INNGEST_BASE_URL } : {}),
});
