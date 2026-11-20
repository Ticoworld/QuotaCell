import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

async function readLock(lockPath) {
  try {
    const text = await fs.readFile(lockPath, 'utf8');
    const record = JSON.parse(text);
    if (!Number.isInteger(record.pid) || typeof record.token !== 'string') return null;
    return { text, record };
  } catch { return null; }
}

async function removeStaleLock(lockPath, observed) {
  const reaperPath = `${lockPath}.reaper`;
  let reaper;
  try { reaper = await fs.open(reaperPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Runtime lock recovery is already in progress at ${reaperPath}.`);
    throw error;
  }
  const reaperToken = randomUUID();
  try {
    await reaper.writeFile(JSON.stringify({ pid: process.pid, token: reaperToken }));
    await reaper.sync();
    const current = await readLock(lockPath);
    if (!current || current.text !== observed.text || processIsAlive(current.record.pid)) return false;
    await fs.unlink(lockPath);
    return true;
  } finally {
    await reaper.close();
    try {
      const current = JSON.parse(await fs.readFile(reaperPath, 'utf8'));
      if (current.token === reaperToken) await fs.unlink(reaperPath);
    } catch { /* Recovery marker may already be gone during shutdown. */ }
  }
}

export async function acquireRuntimeLock(directory) {
  const lockPath = path.join(path.resolve(directory), '.quotacell-runtime.lock');
  const token = randomUUID();
  let handle;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (await fs.stat(`${lockPath}.reaper`).then(() => true, () => false)) {
        throw new Error(`Runtime lock recovery is in progress at ${lockPath}.reaper.`);
      }
      handle = await fs.open(lockPath, 'wx');
      if (await fs.stat(`${lockPath}.reaper`).then(() => true, () => false)) {
        await handle.close();
        handle = null;
        try {
          const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
          if (current.token === token) await fs.unlink(lockPath);
        } catch { /* Another process may already have removed the transient lock. */ }
        throw new Error(`Runtime lock recovery is in progress at ${lockPath}.reaper.`);
      }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const observed = await readLock(lockPath);
      if (!observed) throw new Error(`This QuotaCell runtime has an unreadable lock at ${lockPath}; it remains fail-closed.`);
      if (processIsAlive(observed.record.pid)) {
        throw new Error(`This QuotaCell runtime is already in use by process ${observed.record.pid}.`);
      }
      await removeStaleLock(lockPath, observed);
    }
  }
  if (!handle) throw new Error(`Could not acquire the QuotaCell runtime lock at ${lockPath}.`);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.rm(lockPath, { force: true });
    throw error;
  }
  await handle.close();

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const record = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (record.token === token) unlinkSync(lockPath);
    } catch { /* The lock may already have been removed during shutdown. */ }
    process.removeListener('exit', release);
  };
  process.once('exit', release);
  return { lockPath, release };
}
