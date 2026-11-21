// claude.ai ランタイム機能の簡易模擬（ローカル確認用）
(() => {
  const docs = new Map(); const subs = new Set();
  const collOf = (p) => p.split('/').slice(0, -1).join('/');
  const emit = () => setTimeout(() => { for (const s of subs) s(); }, 5);
  const snapDoc = (id, data) => ({ id, exists: !!data, data: () => data && JSON.parse(JSON.stringify(data)), metadata: { fromCache: false, hasPendingWrites: false } });
  const db = {
    doc(path) {
      return {
        id: path.split('/').pop(), path,
        async get() { if (window.__dbFail) throw { code: 'unavailable' }; return snapDoc(path.split('/').pop(), docs.get(path)); },
        async set(d) { if (window.__dbFail) throw { code: 'unavailable' }; docs.set(path, JSON.parse(JSON.stringify(d))); emit(); },
        async update(d) { if (window.__dbFail) throw { code: 'unavailable' }; if (!docs.has(path)) throw { code: 'invalid_argument' }; docs.set(path, { ...docs.get(path), ...JSON.parse(JSON.stringify(d)) }); emit(); },
        async delete() { docs.delete(path); emit(); },
      };
    },
    collection(coll) {
      return {
        onSnapshot(next) {
          const fire = () => { const ds = [...docs].filter(([p]) => collOf(p) === coll).map(([p, d]) => snapDoc(p.split('/').pop(), d)); next({ docs: ds, size: ds.length, empty: !ds.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }); };
          subs.add(fire); setTimeout(fire, 20); return () => subs.delete(fire);
        },
      };
    },
  };
  window.__docs = docs;
  const sample = async (input) => ({ text: '{}' });
  sample.json = async (input, opts) => {
    if (opts?.images) return /一覧表/.test(input) ? window.__listResult : window.__ocrResult;
    if (/readings/.test(input)) return { readings: [{ i: 0, reading: 'すずきいちろう' }] };
    return { reading: 'ヤマダ タロウ' };
  };
  sample.limits = async () => ({ images: { maxCount: 5, maxInputBytes: 2e7, mediaTypes: ['image/jpeg', 'image/png'] } });
  const blobs = new Map();
  const assets = { async upload(b) { if (window.__assetFail) throw { code: 'capability_disabled' }; const id = Math.random().toString(16).slice(2).padEnd(32, '0'); blobs.set(id, b); return { id, url: '/_blob/' + id, sizeBytes: b.size, contentType: 'image/jpeg' }; }, async delete() { return { deleted: true }; } };
  const downloads = { async save({ filename, data }) { window.__saved = { filename, data }; return { status: 'saved' }; } };
  const caps = { db, sample, assets, downloads, user: { isOwner: async () => true, canEdit: async () => true, can: async () => (localStorage.getItem('canWrite') === 'no' ? false : true) } };
  window.claude = { use: async (n) => caps[n] ?? null };
})();
