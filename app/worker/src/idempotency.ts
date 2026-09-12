/**
 * Per-job execution lock (plan B1 Idempotency).
 * SETNX with an owner id + TTL; a heartbeat refreshes the TTL every N seconds
 * so long-running agents don't lose the lock; a Lua CAS lets us take over a
 * stale lock without stampeding.
 */
import { randomBytes } from 'node:crypto';

import { env } from './config.js';
import { K, getRedis, getStatus } from './redis.js';

const OWNER = process.env.HOSTNAME
  ? `worker-${process.env.HOSTNAME}-${randomBytes(4).toString('hex')}`
  : `worker-${randomBytes(6).toString('hex')}`;

export type LockOutcome =
  | { state: 'acquired'; owner: string }
  | { state: 'busy_running'; owner: string | null }
  | { state: 'done_replay' }
  | { state: 'taken_over_stale'; previousOwner: string | null };

/** Lua CAS: replace lock only if current value matches or key is absent. */
const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
  return 1
end
return 0
`;

export async function acquireJobLock(jobId: string): Promise<LockOutcome> {
  const r = getRedis();
  const key = K.lock(jobId);
  const ttl = env.JOB_LOCK_TTL_S;

  const set = await r.set(key, OWNER, 'EX', ttl, 'NX');
  if (set === 'OK') {
    return { state: 'acquired', owner: OWNER };
  }

  const status = await getStatus(jobId);
  if (status?.state === 'done') {
    return { state: 'done_replay' };
  }
  if (status?.state === 'running') {
    return { state: 'busy_running', owner: status.owner ?? null };
  }

  // Stale or unknown state: attempt CAS takeover.
  const existingOwner = (await r.get(key)) ?? '';
  const takeover = (await r.eval(CAS_SCRIPT, 1, key, existingOwner, OWNER, ttl.toString())) as number;
  if (takeover === 1) {
    return { state: 'taken_over_stale', previousOwner: existingOwner || null };
  }
  return { state: 'busy_running', owner: existingOwner || null };
}

export async function refreshJobLock(jobId: string): Promise<boolean> {
  const r = getRedis();
  const current = await r.get(K.lock(jobId));
  if (current !== OWNER) return false;
  await r.expire(K.lock(jobId), env.JOB_LOCK_TTL_S);
  return true;
}

export async function releaseJobLock(jobId: string): Promise<void> {
  const r = getRedis();
  const key = K.lock(jobId);
  const current = await r.get(key);
  if (current === OWNER) {
    await r.del(key);
  }
}

export const workerOwnerId = () => OWNER;
