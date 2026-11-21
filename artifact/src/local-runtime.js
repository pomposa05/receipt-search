// ===== GitHub Pages版（スマホ保存）用のランタイム =====
// アーティファクト版が claude.ai から受け取る機能（db / assets / downloads / user）を、
// ブラウザ内の IndexedDB で置き換える。データはこの端末のこのブラウザの中だけに保存され、外部へは送らない。
(() => {
  const DB_NAME = 'receipt-search-local';
  const DB_VERSION = 1;
  let idb = null;
  const docs = new Map(); // "coll/id" → data
  const blobs = new Map(); // assetId → { blob, url }
  const listeners = new Map(); // coll → Set(fn)
  let ready = null;

  const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });
  const err = (code, message) => Object.assign(new Error(message), { code });

  function open() {
    if (ready) return ready;
    ready = (async () => {
      if (!('indexedDB' in window)) throw err('not_granted', 'IndexedDB unavailable');
      idb = await new Promise((res, rej) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'path' });
          if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(err('unavailable', 'blocked'));
      });
      const tx = idb.transaction(['docs', 'blobs'], 'readonly');
      const all = await reqP(tx.objectStore('docs').getAll());
      for (const row of all) docs.set(row.path, row.data);
      const bl = await reqP(tx.objectStore('blobs').getAll());
      for (const row of bl) blobs.set(row.id, { blob: row.blob, url: URL.createObjectURL(row.blob) });
      return true;
    })();
    return ready;
  }

  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const collOf = (path) => path.split('/').slice(0, -1).join('/');
  function snapshotOf(coll) {
    const list = [];
    for (const [p, d] of docs) if (collOf(p) === coll) list.push({ id: p.split('/').pop(), exists: true, data: () => clone(d), metadata: { fromCache: false, hasPendingWrites: false } });
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { docs: list, size: list.length, empty: !list.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function notify(coll) {
    const set = listeners.get(coll);
    if (!set) return;
    const snap = snapshotOf(coll);
    for (const fn of set) { try { fn(snap); } catch (e) { console.error(e); } }
  }
  let persistAsked = false;
  async function askPersist() {
    // 端末の空き容量が少なくなっても、このアプリのデータを自動で消さないよう依頼する
    if (persistAsked || !navigator.storage?.persist) return;
    persistAsked = true;
    try { await navigator.storage.persist(); } catch { /* 対応していない */ }
  }
  async function write(path, data) {
    await open();
    const tx = idb.transaction('docs', 'readwrite');
    if (data === null) tx.objectStore('docs').delete(path);
    else tx.objectStore('docs').put({ path, data });
    try { await txDone(tx); } catch (e) { throw err(e?.name === 'QuotaExceededError' ? 'quota_exceeded' : 'unavailable', String(e?.message || e)); }
    if (data === null) docs.delete(path); else docs.set(path, data);
    askPersist();
    notify(collOf(path));
  }

  const db = {
    doc(path) {
      return {
        id: path.split('/').pop(),
        path,
        async get() { await open(); const d = docs.get(path); return { id: path.split('/').pop(), exists: d !== undefined, data: () => clone(d), metadata: { fromCache: false, hasPendingWrites: false } }; },
        async set(data) { await write(path, clone(data)); },
        async update(patch) {
          await open();
          const cur = docs.get(path);
          if (cur === undefined) throw err('invalid_argument', 'document does not exist');
          await write(path, { ...cur, ...clone(patch) });
        },
        async delete() { await write(path, null); },
      };
    },
    collection(coll) {
      return {
        onSnapshot(next, onError) {
          if (!listeners.has(coll)) listeners.set(coll, new Set());
          listeners.get(coll).add(next);
          open().then(() => next(snapshotOf(coll)), (e) => onError?.({ code: e.code || 'unavailable', message: String(e.message || e) }));
          return () => listeners.get(coll)?.delete(next);
        },
      };
    },
  };

  const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const assets = {
    async upload(blob, opts = {}) {
      await open();
      const id = randomId();
      const stored = opts.type && blob.type !== opts.type ? new Blob([blob], { type: opts.type }) : blob;
      const tx = idb.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put({ id, blob: stored, createdAt: new Date().toISOString() });
      try { await txDone(tx); } catch (e) { throw err(e?.name === 'QuotaExceededError' ? 'quota_or_state' : 'store_unavailable', String(e?.message || e)); }
      const url = URL.createObjectURL(stored);
      blobs.set(id, { blob: stored, url });
      askPersist();
      return { id, url, sizeBytes: stored.size, contentType: stored.type };
    },
    async delete(id) {
      await open();
      const tx = idb.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').delete(id);
      await txDone(tx);
      const b = blobs.get(id);
      if (b) { URL.revokeObjectURL(b.url); blobs.delete(id); }
      return { deleted: !!b };
    },
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith('.json') ? 'application/json' : filename.endsWith('.csv') ? 'text/csv' : 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: 'saved' };
    },
  };

  const user = { isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => 'local' };

  window.LOCAL_STORE = {
    assetUrl: (id) => blobs.get(id)?.url || '',
    async info() {
      let persisted = null; let usage = null; let quota = null;
      try { persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { /* noop */ }
      try { const e = navigator.storage?.estimate ? await navigator.storage.estimate() : null; usage = e?.usage ?? null; quota = e?.quota ?? null; } catch { /* noop */ }
      return { persisted, usage, quota, standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true };
    },
    requestPersist: async () => { try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; } },
  };
  // アプリ本体はアーティファクト版と同じく window.claude.use(name) で機能を受け取る
  window.claude = {
    use: async (name) => {
      try { await open(); } catch { return null; }
      return { db, assets, downloads, user }[name] ?? null; // sample（Claudeによる読み取り）は使わない
    },
  };
})();
