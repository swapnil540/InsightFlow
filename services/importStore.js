const { randomUUID } = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const storedImports = new Map();

function removeExpiredImports(now = Date.now()) {
  for (const [id, item] of storedImports) {
    if (item.expiresAt <= now) storedImports.delete(id);
  }
}

function storeImport(rows, metadata = {}) {
  removeExpiredImports();
  const id = randomUUID();
  storedImports.set(id, { rows, metadata, expiresAt: Date.now() + TTL_MS });
  return id;
}

function getImport(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const item = storedImports.get(id);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    storedImports.delete(id);
    return null;
  }
  return item;
}

function deleteImport(id) {
  storedImports.delete(id);
}

const cleanupTimer = setInterval(removeExpiredImports, 60 * 1000);
cleanupTimer.unref();

module.exports = { TTL_MS, storeImport, getImport, deleteImport, removeExpiredImports };
