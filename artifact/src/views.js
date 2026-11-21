// ===== アーティファクト版: 画面 =====

// ---------- 画面の切り替え（ページ内で管理。ブラウザの「戻る」ではなく画面上のボタンで移動） ----------
let current = null;
const backStack = [];
async function go(view, params = {}, { push = true, replace = false } = {}) {
  if (current?.canLeave && !(await current.canLeave())) return;
  current?.cleanup?.();
  if (push && current && !replace) backStack.push(current.route);
  if (backStack.length > 30) backStack.shift();
  const outlet = document.getElementById('app');
  outlet.replaceChildren();
  window.scrollTo(0, 0);
  const v = VIEWS[view]({ outlet, params }) || {};
  current = { ...v, route: { view, params } };
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === (view === 'admin' ? 'admin' : view === 'register' ? 'register' : view === 'search' ? 'search' : '')));
  const off = v.onData ? onData(v.onData) : null;
  const cleanup = current.cleanup;
  current.cleanup = () => { off?.(); cleanup?.(); };
}
function goBack() {
  const r = backStack.pop();
  if (r) go(r.view, r.params, { push: false }); else go('search', {}, { push: false });
}
const backLink = (label = '← 戻る') => h('button', { type: 'button', class: 'back', onclick: goBack }, label);
const openPerson = (id) => go('person', { id });
const openCompany = (id) => go('company', { id });

// ---------- ① 検索 ----------
let lastQuery = '';
function viewSearch({ outlet, params }) {
  if (params.q !== undefined) lastQuery = params.q;
  const input = h('input', { type: 'search', class: 'search-input', id: 'search-input', value: lastQuery, autocomplete: 'off', enterkeyhint: 'search', placeholder: '名前・企業名・読み・キーワード・メモで検索', 'aria-label': '検索語' });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });

  async function startImage(kind) {
    const file = await pickImageFile(kind === 'camera');
    if (file) go('register', { file });
  }
  function run() {
    lastQuery = input.value;
    const q = lastQuery.trim();
    if (!allConfirmed() && !S.companies.size && !S.persons.size) { fill(results, loading('登録情報を読み込み中…')); return; }
    if (!q && activeGroupFilter) return showGroup();
    if (!q) return showRecent();
    const r = search(engineIndex(), q, { limit: 200 });
    if (activeGroupFilter) {
      r.results = r.results.filter((x) => inActiveGroup(x.type, x.id));
      r.total = r.results.length;
    }
    r.results = r.results.slice(0, 50);
    showResults(r);
  }
  function showGroup() {
    const g = S.groups.get(activeGroupFilter);
    const { ps, cs, count } = groupMemberCards(g.id);
    fill(results,
      h('div', { class: 'result-summary row' }, [
        groupChip(g), h('strong', {}, `${count}件`), h('span', { class: 'muted' }, '（名前順）'),
        count ? selectAllButton(() => [...ps.map((x) => ({ type: 'person', id: x.id })), ...cs.map((x) => ({ type: 'company', id: x.id }))], 'このグループをすべて選択') : null,
        count ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => copyText(groupReceiptText(g.id), e.currentTarget) }, '宛名を一覧でコピー') : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => go('group', { id: g.id }) }, 'グループの管理'),
      ]),
      count ? h('ul', { class: 'result-list' }, [...ps.map(personCard), ...cs.map(companyCard)])
        : h('div', { class: 'empty' }, [h('p', { class: 'empty-title' }, 'このグループにはまだメンバーがいません'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('group', { id: g.id }) }, 'メンバーを追加する')]));
  }
  function showRecent() {
    const items = [...S.persons.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10).map(personSummary);
    if (!items.length && !S.companies.size) {
      fill(results, h('div', { class: 'empty' }, [
        h('p', { class: 'empty-title' }, 'まだ登録情報がありません'),
        h('p', {}, '「新規登録」から入力するか、「カメラで撮影」「画像を取り込む」で名刺や資料から登録できます。'),
        h('p', { class: 'small muted' }, 'メモアプリなどの一覧は「新規登録 → 一覧から一括登録」でまとめて登録できます。PC版のデータは「管理 → データ管理」から取り込めます。'),
      ]));
      return;
    }
    fill(results, h('h2', { class: 'section-title' }, '最近更新した登録情報'), h('ul', { class: 'result-list' }, items.map(personCard)));
  }
  function showResults(r) {
    if (!r.results.length) {
      fill(results, h('div', { class: 'empty' }, [
        h('p', { class: 'empty-title' }, `「${r.query}」に該当する登録情報はありません${activeGroupFilter ? `（グループ「${S.groups.get(activeGroupFilter)?.name}」の中）` : ''}`),
        activeGroupFilter ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { activeGroupFilter = ''; filterBar.render(); run(); } }, 'すべてのグループから探す') : null,
        h('ul', { class: 'tips' }, [
          h('li', {}, '名前や企業名の一部だけで検索してみてください（例: 「山田」「サンプル」）'),
          h('li', {}, '読み（ひらがな）でも検索できます（例: 「やまだ」）'),
          h('li', {}, '「株式会社」などを省いて検索してみてください'),
        ]),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('register', { name: r.query }) }, `「${r.query}」を新規登録する`),
        externalSearchBox(r.query),
      ]));
      return;
    }
    fill(results,
      h('div', { class: 'result-summary row' }, [h('span', {}, [`「${r.query}」の検索結果 `, h('strong', {}, `${r.total}件`), h('span', { class: 'muted' }, '（一致度の高い順）')]), selectAllButton(() => r.results.map((x) => ({ type: x.type, id: x.id })), '表示中をすべて選択')]),
      r.results.some((x) => x.isCandidate) ? h('p', { class: 'notice notice-warn small' }, '「候補」と表示されたものは、表記の似た登録情報です（曖昧検索）。目的の登録情報か内容を確認して選んでください。') : null,
      h('ul', { class: 'result-list' }, r.results.map((x) => (x.type === 'company' ? companyCard(x) : personCard(x)))),
      h('div', { class: 'ext-foot' }, [h('span', { class: 'small muted' }, '登録情報以外も調べる:'), externalSearchBox(r.query)]));
  }
  const filterBar = groupFilterBar(() => run());
  const runSoon = debounce(run, 150);
  input.addEventListener('input', runSoon);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSoon.cancel(); run(); }
    if (e.key === 'Escape') { input.value = ''; run(); }
  });
  outlet.append(
    h('section', { class: 'hero' }, [
      h('h1', { class: 'hero-title' }, '領収証の宛名を探す'),
      h('div', { class: 'search-box' }, [h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '⌕'), input]),
      h('div', { class: 'quick-actions' }, [
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => go('register') }, '＋ 新規登録'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-lg', onclick: () => startImage('camera') }, 'カメラで撮影'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-lg', onclick: () => startImage('file') }, '画像を取り込む'),
      ]),
      filterBar.el,
    ]),
    results,
  );
  if (matchMedia('(pointer: fine)').matches) input.focus();
  run();
  return { onData: () => { filterBar.render(); run(); }, cleanup: () => runSoon.cancel() };
}

function badges(x) {
  const out = [];
  if (x.isCandidate) out.push(h('span', { class: 'badge badge-warn' }, '候補・要確認'));
  for (const m of x.matches || []) out.push(h('span', { class: `badge ${m.candidate ? 'badge-warn-soft' : 'badge-soft'}` }, `${m.field}：${m.level}`));
  return out.length ? h('div', { class: 'badges' }, out) : null;
}
function personCard(p) {
  return h('li', { class: 'sel-wrap' }, [selCheckbox('person', p.id, p.name), h('button', { type: 'button', class: `result-card ${p.isCandidate ? 'is-candidate' : ''}`, onclick: () => openPerson(p.id) }, [
    avatar(S.persons.get(p.id) || p, 'sm'),
    h('span', { class: 'rc-main' }, [
      h('span', { class: 'rc-row rc-receipt-top' }, [h('span', { class: 'rc-label' }, '宛名'), h('span', {}, p.receiptName || h('span', { class: 'muted' }, '（未設定）'))]),
      h('span', { class: 'rc-row rc-person' }, [h('span', { class: 'rc-label' }, '人物'), h('span', {}, [h('span', { class: 'rc-person-name' }, p.name), p.nameKana ? h('span', { class: 'rc-kana' }, ` ${p.nameKana}`) : null])]),
      h('span', { class: 'rc-row rc-company' }, [h('span', { class: 'rc-label' }, '企業名'), h('span', {}, p.companyName || h('span', { class: 'muted' }, '企業の登録なし'))]),
      (p.department || p.title) ? h('span', { class: 'rc-sub' }, [p.department, p.title].filter(Boolean).join(' ')) : null,
      groupChips(S.persons.get(p.id)?.groupIds, { small: true }),
      badges(p),
    ]),
    h('span', { class: 'rc-id' }, shortId(p.id)),
  ])]);
}
function companyCard(c) {
  return h('li', { class: 'sel-wrap' }, [selCheckbox('company', c.id, c.name), h('div', { class: `result-card company ${c.isCandidate ? 'is-candidate' : ''}` }, [
    h('div', { class: 'rc-main' }, [
      h('div', { class: 'rc-row rc-receipt-top' }, [h('span', { class: 'rc-label' }, '宛名'), h('span', {}, c.receiptName || h('span', { class: 'muted' }, '（未設定）'))]),
      h('div', { class: 'rc-row' }, [
        h('span', { class: 'rc-label' }, '人物'),
        h('span', { class: 'chips' }, [
          c.persons?.length ? c.persons.map((p) => h('button', { type: 'button', class: 'chip chip-person', onclick: () => openPerson(p.id) }, p.name)) : h('span', { class: 'muted small' }, 'なし'),
          c.personCount > (c.persons?.length || 0) ? h('button', { type: 'button', class: 'linkish small', onclick: () => openCompany(c.id) }, `すべて表示（${c.personCount}名）`) : null,
        ]),
      ]),
      h('div', { class: 'rc-row rc-company' }, [h('span', { class: 'rc-label' }, '企業名'), h('span', {}, [h('button', { type: 'button', class: 'rc-link rc-company-link', onclick: () => openCompany(c.id) }, c.name), c.nameKana ? h('span', { class: 'rc-kana' }, ` ${c.nameKana}`) : null])]),
      groupChips(S.companies.get(c.id)?.groupIds, { small: true }),
      badges(c),
    ]),
    h('div', { class: 'rc-id' }, shortId(c.id)),
  ])]);
}

// ---------- 外部検索（Google）: 新しいタブで開くリンク。押したときだけ検索語がGoogleに送られる ----------
const googleSearchUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const googleMapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
function externalLink(href, label, title) {
  return h('a', { class: 'btn btn-ghost btn-sm ext-link', href, target: '_blank', rel: 'noopener noreferrer', title: title || `${label}（新しいタブで開きます）` }, [label, h('span', { class: 'ext-mark', 'aria-hidden': 'true' }, ' ↗')]);
}
function externalSearchBox(query, { maps = false, note = true } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  return h('div', { class: 'ext-box' }, [
    h('div', { class: 'row' }, [
      externalLink(googleSearchUrl(q), `Googleで「${q.length > 24 ? `${q.slice(0, 24)}…` : q}」を検索`),
      maps ? externalLink(googleMapsUrl(q), '地図で見る（Googleマップ）') : null,
    ]),
    note ? h('p', { class: 'small muted' }, 'Googleのページが新しいタブで開きます（押したときだけ、検索語がGoogleに送られます）。') : null,
  ]);
}

// ---------- 画像の選択・前処理 ----------
function pickImageFile(capture) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', class: 'sr-only' });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}
const SUPPORTED_LABEL = 'JPG・JPEG・PNG・WebP';
async function loadImageFile(file) {
  const type = (file.type || '').toLowerCase();
  const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp'].includes(type) || (!type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || ''));
  if (!ok) throw new AppError('UNSUPPORTED', `対応していないファイル形式です（${type || file.name || '不明'}）。${SUPPORTED_LABEL} の画像を選んでください。`);
  if (file.size === 0) throw new AppError('EMPTY', 'ファイルが空です。別の画像を選んでください。');
  if (file.size > 40 * 1024 * 1024) throw new AppError('TOO_LARGE', 'ファイルが大きすぎます（40MBまで）。');
  let source = null;
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { source = null; }
  if (!source?.width) throw new AppError('DECODE', `画像を読み込めませんでした。ファイルが壊れているか、このブラウザで表示できない形式です。${SUPPORTED_LABEL} の画像でお試しください。`);
  const originalHash = await sha256Hex(await file.arrayBuffer()).catch(() => '');
  return { source, originalHash, name: file.name || '' };
}
async function renderImage(source, rotation = 0) {
  const long = Math.max(source.width, source.height);
  // 長辺2000pxまで縮小。小さい画像は長辺1400px（最大1.8倍）まで拡大（PC版の実測で文字認識が最も安定した大きさ）
  const scale = long > 2000 ? 2000 / long : long < 1400 ? Math.min(1.8, 1400 / long) : 1;
  const w = Math.round(source.width * scale);
  const hh = Math.round(source.height * scale);
  const rot = ((rotation % 360) + 360) % 360;
  const c = document.createElement('canvas');
  c.width = rot % 180 === 0 ? w : hh;
  c.height = rot % 180 === 0 ? hh : w;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  if (rot === 90) x.setTransform(0, 1, -1, 0, hh, 0);
  else if (rot === 180) x.setTransform(-1, 0, 0, -1, w, hh);
  else if (rot === 270) x.setTransform(0, -1, 1, 0, 0, w);
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, 0, 0, w, hh);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
  if (!blob) throw new AppError('CONVERT', '画像の変換に失敗しました。別の画像でお試しください。');
  return { blob, width: c.width, height: c.height, url: URL.createObjectURL(blob), sha256: await sha256Hex(await blob.arrayBuffer()) };
}
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Claude による文字の読み取り ----------
const OCR_PROMPT = `あなたは名刺・書類の文字を読み取る係です。添付画像は日本の名刺、または企業名・個人名が書かれた書類です。
次の規則を必ず守り、JSONだけを返してください。
- 画像に実際に書かれている文字だけを、書かれている通りに書き写す。推測・補完・創作をしない。
- 読めない、または判別に迷う項目は value を "" にし、confidence を "low" か "none" にする。候補が複数あれば options に入れる。
- confidence: "high"=はっきり読めて項目の種類も明確 / "medium"=読めるが項目の判断に少し迷う / "low"=不確実（value は必ず "" ）/ "none"=見当たらない。
- nameKana は画像に読み仮名（カタカナ・ひらがな）が印刷されている場合だけ入れる。漢字から読みを推測しない。
- companyName は法人格（株式会社など）を含めて書かれている通り。部署名は含めない。
- name は個人の氏名のみ（役職・部署を含めない）。姓と名の間に空白があれば保つ。
- lines には画像の文字を上から順に1行ずつ書き写す（最大40行）。
- 文字がほとんど読めない画像なら readable を false にする。
形式:
{"readable":true,"lines":["…"],"fields":{"companyName":{"value":"","confidence":"none","options":[],"reason":""},"name":{…},"nameKana":{…},"department":{…},"title":{…},"email":{…},"phone":{…},"address":{…},"url":{…}}}`;

const FIELD_KEYS = ['companyName', 'name', 'nameKana', 'department', 'title', 'email', 'phone', 'address', 'url'];
function sanitizeOcr(raw) {
  const out = { readable: !!raw?.readable, lines: [], fields: {} };
  out.lines = (Array.isArray(raw?.lines) ? raw.lines : []).map((l) => cleanLine(typeof l === 'string' ? l : l?.text)).filter(Boolean).slice(0, 40);
  for (const k of FIELD_KEYS) {
    const f = raw?.fields?.[k] || {};
    let confidence = ['high', 'medium', 'low', 'none'].includes(f.confidence) ? f.confidence : 'none';
    let value = cleanLine(f.value);
    if (confidence === 'low' || confidence === 'none') value = ''; // 不確実な項目は入力しない
    if (!value && (confidence === 'high' || confidence === 'medium')) confidence = 'none';
    let options = (Array.isArray(f.options) ? f.options : []).map(cleanLine).filter(Boolean).slice(0, 6);
    let unknownNote = '';
    if (hasUnknown(value)) { // 読めない文字を含む値は確定させない（候補として示す）
      options = [value, ...options.filter((o) => o !== value)];
      value = ''; confidence = 'low';
      unknownNote = '読めない文字（?）を含むため入力していません。候補を選んで「?」を直すか、画像を見て入力してください。';
    }
    const reasons = { name: '名前を判別できませんでした。画像を見て入力してください。', companyName: '企業名を判別できませんでした。画像を見て入力してください。' };
    out.fields[k] = { value, confidence, options, reason: unknownNote || cleanLine(f.reason) || (confidence === 'none' ? (reasons[k] || '') : confidence === 'low' ? '判別に迷う内容です。候補から選ぶか入力してください。' : '') };
  }
  if (!out.lines.length) out.readable = false;
  return out;
}
function sampleErrorMessage(e) {
  switch (e?.code) {
    case 'not_granted': return 'Claudeによる読み取りが許可されませんでした。画像を見ながら手動で入力してください。';
    case 'sampling_disabled': case 'images_unavailable': case 'capability_disabled': case 'capability_removed': case 'not_declared':
      return 'この環境では画像の読み取りを使えません。画像を見ながら手動で入力してください。';
    case 'rate_limited': return '読み取りの回数が上限に達しました。しばらく待ってから「もう一度読み取る」を押すか、手動で入力してください。';
    case 'image_rejected': return 'この画像は読み取れませんでした。別の画像（JPG・PNG・WebP）でお試しください。';
    case 'refused': return 'この画像は読み取りの対象外でした。手動で入力してください。';
    case 'session_expired': return 'ログインの有効期限が切れました。再度ログインしてください。';
    case 'cancelled': return '読み取りを中止しました。';
    default: return '文字の読み取りに失敗しました。「もう一度読み取る」を押すか、手動で入力してください。';
  }
}

// ---------- 端末内での文字認識（Claudeを使わない。画像は外部に送られない） ----------
const abs = (p) => new URL(p, location.href).href;
let tessWorkerPromise = null;
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const sc = document.createElement('script');
    sc.src = src; sc.onload = () => resolve(); sc.onerror = () => reject(new Error('script'));
    document.head.append(sc);
  });
}
function getTessWorker(onProgress) {
  if (!tessWorkerPromise) {
    tessWorkerPromise = (async () => {
      await loadScriptOnce(abs('vendor/tesseract.min.js'));
      // 言語データは gzip を base64 にしたテキストとして公開している（アーティファクトで配信できる形式のため）
      onProgress?.({ status: 'loading language traineddata', progress: 0 });
      const langs = [];
      for (const code of ['jpn', 'eng']) {
        const res = await fetch(abs(`vendor/lang/${code}.traineddata.gz.b64.txt`));
        if (!res.ok) throw new Error(`言語データ（${code}）を読み込めません（${res.status}）`);
        const b64 = (await res.text()).trim();
        const bin = atob(b64);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        langs.push({ code, data });
      }
      const w = await window.Tesseract.createWorker(langs, 1, {
        workerPath: abs('vendor/worker.min.js'), corePath: abs('vendor/core'),
        workerBlobURL: false, cacheMethod: 'none', logger: (m) => onProgress?.(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => { tessWorkerPromise = null; throw e; });
  }
  return tessWorkerPromise;
}
async function deviceOcr(blob, onProgress) {
  const w = await getTessWorker(onProgress);
  const { data } = await w.recognize(blob, {}, { text: true, blocks: true });
  const lines = [];
  for (const b of data.blocks || []) for (const pa of b.paragraphs || []) for (const l of pa.lines || []) {
    lines.push({ text: l.text || '', confidence: l.confidence ?? 0, height: (l.bbox?.y1 ?? 0) - (l.bbox?.y0 ?? 0) });
  }
  const ex = extractFields(lines); // PC版と同じ抽出規則（不確実な項目は入力しない）
  const fields = {};
  for (const k of FIELD_KEYS) {
    const f = ex.fields[k] || { value: '', confidence: 'none', options: [], reason: '' };
    fields[k] = { ...f, value: f.confidence === 'low' ? '' : f.value };
  }
  return { readable: ex.lines.length > 0, lines: ex.lines.map((l) => l.text), fields };
}
function sampleUnavailableReason() {
  if (!RT.sample) return 'この画面ではClaudeによる読み取りが提供されていません（スマートフォンのアプリや一部の環境では使えません）。';
  if (!RT.canImages) return 'この画面ではClaudeに画像を送れません（組織の設定や、ページを開いているアプリ・アカウントによって使えない場合があります）。';
  return '';
}

function createOcrPanel({ onFields, onLine, targets }) {
  let loaded = null; let rotation = 0; let pending = null; let busy = false; let used = false; let ctl = null;
  const preview = h('img', { class: 'ocr-preview', alt: '取り込んだ画像', hidden: true });
  const statusBox = h('div', { class: 'ocr-status', 'aria-live': 'polite' });
  const linesBox = h('div', { class: 'ocr-lines' });
  const stopBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, onclick: () => ctl?.abort() }, '中止');
  const tools = h('div', { class: 'row ocr-tools', hidden: true }, [
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => rotate(-90) }, '⟲ 左に回転'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => rotate(90) }, '⟳ 右に回転'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => runOcr() }, 'もう一度読み取る'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => runOcr({ mode: 'device' }) }, '端末内で読み取る'),
    stopBtn,
  ]);
  async function pick(capture) { if (busy) return; const f = await pickImageFile(capture); if (f) await loadFile(f); }
  async function loadFile(file) {
    fill(statusBox, loading('画像を読み込んでいます…'));
    linesBox.replaceChildren();
    try {
      loaded = await loadImageFile(file);
      rotation = 0;
      await prepare();
      await runOcr();
    } catch (e) {
      fill(statusBox, h('div', { class: 'notice notice-error', role: 'alert' }, [h('p', {}, e.message), h('p', { class: 'small' }, '下の入力欄に手動で入力して登録することもできます。')]));
    }
  }
  async function prepare() {
    const img = await renderImage(loaded.source, rotation);
    if (pending?.url) URL.revokeObjectURL(pending.url);
    pending = { ...img, originalHash: rotation === 0 ? loaded.originalHash : '', name: loaded.name, ocrText: '' };
    preview.src = img.url; preview.hidden = false; tools.hidden = false;
    const dups = duplicateImageOwners(pending.sha256, pending.originalHash);
    pending.dups = dups;
  }
  async function rotate(deg) { if (!loaded || busy) return; rotation = (rotation + deg + 360) % 360; await prepare(); await runOcr(); }
  function dupNotice() {
    if (!pending?.dups?.length) return null;
    return h('div', { class: 'notice notice-warn', role: 'alert' }, [
      h('p', {}, 'この画像は既に取り込まれています。重複登録にご注意ください。'),
      h('ul', {}, pending.dups.map((d) => h('li', {}, d.type === 'person' ? `人物: ${d.name}${d.companyName ? `（${d.companyName}）` : ''}  ${d.id}` : `企業: ${d.name}  ${d.id}`))),
    ]);
  }
  async function runOcr({ mode = 'auto' } = {}) {
    if (!loaded || busy) return;
    linesBox.replaceChildren();
    const why = sampleUnavailableReason();
    if (mode === 'device' || why) return runDevice(why);
    busy = true; ctl = new AbortController(); stopBtn.hidden = false;
    fill(statusBox, dupNotice(), loading('Claudeが文字を読み取っています…（初回は利用の許可を確認する画面が出ます。通常10〜60秒）'));
    let failed = null;
    try {
      const raw = await RT.sample.json(OCR_PROMPT, { images: [pending.blob], signal: ctl.signal });
      const r = sanitizeOcr(raw);
      pending.ocrText = r.lines.join('\n');
      used = true;
      renderResult(r, 'Claude');
      if (r.readable) onFields(r.fields);
    } catch (e) {
      failed = e;
    } finally {
      busy = false; stopBtn.hidden = true;
    }
    if (failed && failed.code !== 'cancelled') return runDevice(`Claudeによる読み取りができませんでした（${sampleErrorMessage(failed).replace(/。.*$/, '')}・コード: ${failed.code || '不明'}）。`);
    if (failed) fill(statusBox, dupNotice(), h('div', { class: 'notice notice-warn' }, '読み取りを中止しました。'));
  }
  async function runDevice(reason) {
    busy = true; stopBtn.hidden = true;
    const progress = h('span', {}, '準備中…');
    fill(statusBox, dupNotice(),
      reason ? h('div', { class: 'notice notice-info small' }, [reason, ' 代わりにこの端末内で文字を読み取ります（画像は外部に送られません）。']) : null,
      h('div', { class: 'loading', role: 'status' }, [h('span', { class: 'spinner', 'aria-hidden': 'true' }), '端末内で文字を読み取っています…（初回は読み取り用データの読み込みに数十秒かかります） ', progress]));
    try {
      const r = await deviceOcr(pending.blob, (m) => {
        if (m?.status && typeof m.progress === 'number') progress.textContent = `${{ 'loading tesseract core': 'エンジン読み込み', 'loading language traineddata': '日本語データ読み込み', 'initializing api': '初期化', 'recognizing text': '読み取り' }[m.status] || m.status} ${Math.round(m.progress * 100)}%`;
      });
      pending.ocrText = r.lines.join('\n');
      used = true;
      renderResult(r, '端末内', reason);
      if (r.readable) onFields(r.fields);
    } catch (e) {
      console.error('端末内OCRの失敗', e);
      fill(statusBox, dupNotice(), h('div', { class: 'notice notice-error', role: 'alert' }, [
        reason ? h('p', { class: 'small' }, reason) : null,
        h('p', {}, '端末内での文字の読み取りも、この環境では動作しませんでした。画像を見ながら手動で入力してください（画像は登録情報と一緒に保存されます）。'),
        h('p', { class: 'small muted' }, `詳細: ${e?.message || e}`),
      ]));
    } finally { busy = false; }
  }
  function renderResult(r, engine = 'Claude', reason = '') {
    fill(statusBox, dupNotice(), reason ? h('div', { class: 'notice notice-info small' }, [reason, ' この端末内で読み取りました。']) : null, r.readable
      ? h('div', { class: 'notice notice-info' }, [
        h('p', {}, h('strong', {}, '読み取り結果を入力欄に反映しました。必ず画像と見比べて、間違いがあれば修正してください。')),
        h('p', { class: 'small' }, '色付きの入力欄は画像から読み取った内容です。判別できなかった項目は空欄のままです（推測では入力しません）。'),
      ])
      : h('div', { class: 'notice notice-error', role: 'alert' }, [h('p', {}, '画像から文字を読み取れませんでした。明るい場所で正面から撮り直すか、手動で入力してください。'), h('p', { class: 'small' }, '向きが違う場合は「回転」を押すと読み直します。')]));
    if (!r.lines.length) return;
    const extra = ['email', 'phone', 'address', 'url'].map((k) => [k, r.fields[k]]).filter(([, f]) => f?.value);
    fill(linesBox, h('details', { class: 'ocr-lines-box', open: true }, [
      h('summary', {}, `読み取った文字（${r.lines.length}行）— ボタンで入力欄へ入れられます`),
      h('ul', { class: 'ocr-line-list' }, r.lines.map((text) => h('li', { class: 'ocr-line' }, [
        h('span', { class: 'ocr-line-text' }, [hasUnknown(text) ? h('span', { class: 'badge badge-warn' }, '要確認') : null, ' ', markUnknown(text)]),
        h('span', { class: 'ocr-line-actions' }, targets().map((t) => h('button', { type: 'button', class: 'btn btn-xs', onclick: () => onLine(t.key, text) }, `${t.label}へ`))),
      ]))),
      extra.length ? h('div', { class: 'row' }, [
        h('span', { class: 'small muted' }, '連絡先などの情報:'),
        h('button', { type: 'button', class: 'btn btn-xs', onclick: () => onLine('memo', extra.map(([k, f]) => `${{ email: 'メール', phone: '電話', address: '住所', url: 'URL' }[k]}: ${f.value}`).join('\n')) }, 'メモに追加'),
      ]) : null,
    ]));
  }
  const el = h('section', { class: 'card ocr-card' }, [
    h('div', { class: 'card-head' }, [h('h2', { class: 'card-title' }, '名刺・資料から読み取る'), h('span', { class: 'muted small' }, '任意')]),
    h('p', { class: 'small muted' }, `名刺や資料を撮影するか、保存済みの画像（${SUPPORTED_LABEL}）を選ぶと、Claudeが文字を読み取って入力欄に反映します（Claudeを使えない環境では、この端末内で読み取ります）。Claudeで読み取る場合は画像がClaudeに送られます。画像は登録時にこのページの保存領域に保存されます。`),
    h('div', { class: 'row' }, [
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => pick(true) }, 'カメラで撮影'),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => pick(false) }, '画像を取り込む'),
    ]),
    h('div', { class: 'ocr-body' }, [h('div', { class: 'ocr-image' }, [preview, tools]), h('div', { class: 'ocr-result' }, [statusBox, linesBox])]),
  ]);
  return { el, loadFile, pendingImage: () => pending, used: () => used, isBusy: () => busy, abort: () => ctl?.abort() };
}

// ---------- 読みの推定（Claude） ----------
async function suggestReading(text) {
  if (!RT.sample) throw new AppError('NO_SAMPLE', 'この環境では読みの推定を使えません。手動で入力してください。');
  const r = await RT.sample.json(`次の日本語の人名または企業名の、一般的な読みをカタカナで答えてください。法人格（株式会社など）も読みに含めます。読みが分からない・複数考えられる場合は "" にしてください。JSONのみ: {"reading":"…"}\n\n${text}`, { modelTier: 'quick' });
  return cleanLine(r?.reading || '');
}

// ---------- 入力欄 ----------
let fieldSeq = 0;
function textField(key, label, { required = false, hint = '', placeholder = '', value = '', multiline = false, maxlength = 200 } = {}) {
  const id = `f-${key}-${++fieldSeq}`;
  const input = multiline ? h('textarea', { id, name: key, rows: 4, maxlength, placeholder }) : h('input', { id, name: key, type: 'text', maxlength, placeholder, autocomplete: 'off', required: required || undefined });
  input.value = value || '';
  input.dataset.key = key;
  const ocrTag = h('span', { class: 'ocr-tag', hidden: true }, '画像から読み取り・要確認');
  const candBox = h('div', { class: 'cand-box', hidden: true });
  const errBox = h('div', { class: 'field-error', role: 'alert', hidden: true });
  const wrap = h('div', { class: 'field' }, [
    h('label', { class: 'field-label', for: id }, [label, required ? h('span', { class: 'req' }, '必須') : null, ocrTag]),
    h('div', { class: 'field-control' }, [input, candBox, errBox]),
    hint ? h('div', { class: 'field-hint' }, hint) : null,
  ]);
  const unkBox = h('div', { class: 'field-unknown', role: 'status', hidden: true }, [h('span', { class: 'badge badge-warn' }, '要確認'), ' ', UNKNOWN_MSG]);
  wrap.querySelector('.field-control').append(unkBox);
  const checkUnknown = () => { const u = hasUnknown(input.value); unkBox.hidden = !u; input.classList.toggle('has-unknown', u); };
  input.addEventListener('input', () => { input.classList.remove('ocr-filled'); ocrTag.hidden = true; setError(''); checkUnknown(); });
  input.addEventListener('ocr-set', checkUnknown);
  input.addEventListener('change', checkUnknown);
  queueMicrotask(checkUnknown);
  function setError(msg) { errBox.textContent = msg; errBox.hidden = !msg; input.classList.toggle('invalid', !!msg); }
  const f = {
    key, wrap, input, setError,
    get value() { return input.value; },
    set value(v) { input.value = v ?? ''; checkUnknown(); },
    markOcr() { input.classList.add('ocr-filled'); ocrTag.hidden = false; checkUnknown(); },
    hasUnknown: () => hasUnknown(input.value),
    applyOcr(fr) {
      candBox.replaceChildren(); candBox.hidden = true;
      if (!fr) return false;
      let filled = false;
      if ((fr.confidence === 'high' || fr.confidence === 'medium') && fr.value) { input.value = fr.value; f.markOcr(); filled = true; }
      checkUnknown();
      const others = (fr.options || []).filter((o) => o !== input.value);
      if (fr.confidence === 'low' || (others.length && filled) || (fr.confidence === 'none' && fr.reason)) {
        candBox.hidden = false;
        if (fr.reason && !filled) candBox.append(h('div', { class: 'small warn-text' }, fr.reason));
        if (others.length) {
          candBox.append(h('div', { class: 'chips' }, [h('span', { class: 'small muted' }, filled ? '他の候補:' : '候補（タップで入力）:'),
            ...others.map((o) => h('button', { type: 'button', class: 'chip chip-btn', onclick: () => { input.value = o; f.markOcr(); input.dispatchEvent(new CustomEvent('ocr-set')); } }, markUnknown(o)))]));
        }
      }
      return filled;
    },
  };
  return f;
}

function receiptField(getParts, initial = '', { auto = true } = {}) {
  const f = textField('receiptName', '領収証宛名', { hint: '領収証に記載する宛名です。名前・企業名から自動で作成します（直接書き換えることもできます）。', value: initial });
  let isAuto = auto;
  const modeLine = h('div', { class: 'small receipt-mode' });
  const altBox = h('div', { class: 'chips small' });
  f.wrap.append(modeLine, altBox);
  f.input.addEventListener('input', () => { isAuto = false; render(); });
  function render() {
    fill(modeLine, isAuto ? '自動作成中' : h('span', {}, ['手動で入力中 ', h('button', { type: 'button', class: 'btn btn-xs', onclick: () => { isAuto = true; sync(); } }, '自動作成に戻す')]));
    const { person, company } = getParts();
    const alts = [...new Set([defaultReceiptName(person, company), company ? defaultReceiptName('', company) : '', person ? defaultReceiptName(person, '') : ''])].filter((a) => a && a !== f.input.value);
    fill(altBox, alts.length ? [h('span', { class: 'muted' }, '他の書き方:'), ...alts.map((a) => h('button', { type: 'button', class: 'chip chip-btn', onclick: () => { f.input.value = a; isAuto = false; render(); } }, a))] : null);
  }
  function sync() { if (isAuto) { const { person, company } = getParts(); f.input.value = defaultReceiptName(person, company); } render(); }
  sync();
  return Object.assign(f, { sync });
}

function kanaField(key, label, getSource, value = '') {
  const f = textField(key, label, { placeholder: '例: ヤマダ タロウ', value, hint: '読みを登録すると、ひらがな・カタカナでも検索できます。' });
  const btn = h('button', {
    type: 'button', class: 'btn btn-xs',
    onclick: async () => {
      const src = getSource();
      if (!src.trim()) { toast('先に名前を入力してください'); return; }
      btn.disabled = true; btn.textContent = '推定中…';
      try {
        const r = await suggestReading(src);
        if (r) { f.value = r; f.markOcr(); toast('読みの候補を入力しました。正しいか確認してください。'); } else toast('読みを推定できませんでした。手動で入力してください。');
      } catch (e) { toast(e instanceof AppError ? e.message : sampleErrorMessage(e), 'error', 5000); } finally { btn.disabled = false; btn.textContent = '読みの候補を入力'; }
    },
  }, '読みの候補を入力');
  if (RT.sample) f.wrap.append(btn);
  return f;
}

function companyPicker(initialCompany, { onChange }) {
  const f = textField('companyName', '企業名', { placeholder: '例: 株式会社サンプル', maxlength: 100, hint: '入力すると登録済みの企業が候補に表示されます。既存の企業に紐付ける場合は候補から選んでください。', value: initialCompany?.name || '' });
  let selected = initialCompany ? { id: initialCompany.id, name: initialCompany.name } : null;
  let suggestions = []; let active = -1;
  const list = h('ul', { class: 'suggest-list', role: 'listbox', hidden: true });
  const status = h('div', { class: 'company-status', 'aria-live': 'polite' });
  const kana = textField('companyKana', '企業名の読み（新しい企業として登録する場合・任意）', { placeholder: '例: サンプル' });
  f.input.setAttribute('role', 'combobox');
  f.wrap.querySelector('.field-control').append(list);
  f.wrap.append(status);
  function refresh() { suggestions = f.input.value.trim() ? suggestCompanies(f.input.value) : []; renderList(); renderStatus(); }
  function choose(c) { selected = { id: c.id, name: c.name }; f.input.value = c.name; list.hidden = true; renderStatus(); onChange(); }
  function renderList() {
    active = -1;
    if (!suggestions.length || document.activeElement !== f.input) { list.hidden = true; return; }
    fill(list, suggestions.map((c) => h('li', { role: 'option', class: 'suggest-item', onmousedown: (e) => { e.preventDefault(); choose(c); } }, [h('span', {}, c.name), h('span', { class: 'muted small' }, ` ${c.id}・人物${c.personCount}名`)])));
    list.hidden = false;
  }
  function renderStatus() {
    const text = f.input.value.trim();
    kana.wrap.hidden = !(text && !selected);
    if (!text) { status.className = 'company-status'; fill(status, '企業なし（個人のみ）で登録します。'); return; }
    if (selected) {
      status.className = 'company-status ok';
      fill(status, `✓ 登録済みの企業「${selected.name}」（${selected.id}・人物${personCount(selected.id)}名）に紐付けます。`, h('button', { type: 'button', class: 'btn btn-xs', onclick: () => { selected = null; renderStatus(); onChange(); f.input.focus(); } }, '選択を解除'));
      return;
    }
    const same = suggestions.some((c) => normalize(c.name) === normalize(text) || companyCore(c.name) === companyCore(text));
    if (suggestions.length) {
      status.className = 'company-status warn';
      fill(status, same ? '⚠ 同じ名前の企業が登録済みです。同じ企業なら候補から選んでください。選ばずに保存すると確認画面が表示されます。' : `「${text}」を新しい企業として登録します。似た名前の企業が${suggestions.length}件あります。同じ企業なら候補から選んでください。`);
    } else { status.className = 'company-status'; fill(status, `「${text}」を新しい企業として登録します。`); }
  }
  f.input.addEventListener('input', () => { selected = null; refresh(); onChange(); });
  f.input.addEventListener('ocr-set', () => { selected = null; refresh(); onChange(); });
  f.input.addEventListener('focus', () => { if (f.input.value.trim()) refresh(); });
  f.input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  f.input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    const items = [...list.children];
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(suggestions[active]); return; } else if (e.key === 'Escape') { list.hidden = true; return; } else return;
    items.forEach((li, i) => li.classList.toggle('active', i === active));
  });
  renderStatus();
  return Object.assign(f, {
    kana,
    select: choose,
    setText(v) { f.value = v; selected = null; refresh(); },
    spec() { const t = f.input.value.trim(); if (selected) return { mode: 'existing', id: selected.id }; if (t) return { mode: 'new', name: t, nameKana: kana.value }; return { mode: 'none' }; },
    displayName: () => (selected ? selected.name : f.input.value.trim()),
  });
}

function errorNotice() {
  const box = h('div', { class: 'notice notice-error', role: 'alert', hidden: true });
  return { el: box, show(m) { box.textContent = m; box.hidden = false; box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, hide() { box.hidden = true; } };
}
const candList = (cands, render) => h('ul', { class: 'cand-list' }, cands.map((c) => h('li', {}, render(c))));

// 画像の保存に失敗しても、登録情報の保存は続ける（画像なしで保存し、その旨を知らせる）
async function saveImageSafe(ocr) {
  const pending = ocr?.pendingImage();
  if (!pending) return null;
  if (!RT.assets) { toast('この端末（アカウント）では画像を保存できないため、画像なしで保存します。', 'info', 5000); return null; }
  try { return await saveImage(pending); } catch (e) { console.warn('画像の保存に失敗', e); toast('画像を保存できなかったため、画像なしで保存します。', 'error', 6000); return null; }
}

// 「?」（読めなかった文字）が残ったまま保存しようとしたら確認する
async function confirmUnknown(fields) {
  const bad = fields.filter((f) => f && f.hasUnknown?.());
  if (!bad.length) return true;
  bad[0].input.focus();
  return confirmDialog('読めなかった文字「?」が残っています', [
    h('p', {}, '次の項目に、画像から読めなかった文字「?」が含まれています。'),
    h('ul', {}, bad.map((f) => h('li', {}, [h('strong', {}, (f.wrap.querySelector('.field-label')?.firstChild?.textContent || f.key)), '：', markUnknown(f.value)]))),
    h('p', {}, '正しい文字に直してから保存することをおすすめします。このまま保存しますか？'),
  ], { okLabel: 'このまま保存する', cancelLabel: '戻って直す' });
}

// ---------- 人物フォーム ----------
function createPersonForm({ person = null, presetCompany = null, presetName = '', presetGroupIds = [], onSaved, ocr = null }) {
  const isEdit = !!person;
  const personCompany = person?.companyId ? S.companies.get(person.companyId) : null;
  const err = errorNotice();
  const name = textField('name', '名前', { required: true, placeholder: '例: 山田 太郎', value: person?.name || presetName, maxlength: 100 });
  const kana = kanaField('nameKana', '名前の読み（任意）', () => name.value, person?.nameKana || '');
  const company = companyPicker(personCompany || presetCompany, { onChange: () => receipt.sync() });
  const dept = textField('department', '部署（任意）', { value: person?.department || '', maxlength: 100 });
  const title = textField('title', '役職（任意）', { value: person?.title || '', maxlength: 100 });
  const keywords = textField('keywords', 'キーワード（任意）', { value: person?.keywords || '', maxlength: 1000, placeholder: '例: ゴルフ仲間, 年末贈答', hint: '検索に使う補助情報です。複数ある場合は「,」や「、」で区切ってください。' });
  const initialReceipt = person?.receiptName || '';
  const receipt = receiptField(() => ({ person: name.value, company: company.displayName() }), initialReceipt, { auto: !isEdit || initialReceipt === defaultReceiptName(person.name, personCompany?.name || '') });
  const memo = isEdit ? null : textField('memo', 'メモ（任意）', { multiline: true, maxlength: 100000, placeholder: '自由に入力できます。登録後も詳細画面でいつでも編集できます。' });
  const groups = groupPicker(isEdit ? person.groupIds : presetGroupIds);
  const ocrConfirm = h('label', { class: 'check ocr-confirm', hidden: true }, [h('input', { type: 'checkbox', id: 'ocr-confirm' }), ' 読み取り結果を画像と見比べて確認しました']);
  name.input.addEventListener('input', () => receipt.sync());
  name.input.addEventListener('ocr-set', () => receipt.sync());
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, isEdit ? '変更を保存' : 'この内容で登録');
  const fieldsByKey = { name, nameKana: kana, companyName: company, department: dept, title, keywords, memo };
  const snapshot = () => JSON.stringify([name.value, kana.value, company.spec(), dept.value, title.value, keywords.value, receipt.value, memo?.value || '', groups.key()]);
  let initial = snapshot();
  let saving = false;
  const form = h('form', { class: 'card form', novalidate: true }, [
    h('h2', { class: 'card-title' }, isEdit ? '人物の登録情報を編集' : '人物を登録'),
    err.el,
    h('div', { class: 'grid-2' }, [name.wrap, kana.wrap]),
    company.wrap, company.kana.wrap,
    h('div', { class: 'grid-2' }, [dept.wrap, title.wrap]),
    receipt.wrap, groups.wrap, keywords.wrap, memo?.wrap, ocrConfirm,
    h('div', { class: 'form-actions' }, [h('button', { type: 'button', class: 'btn btn-ghost', onclick: goBack }, 'キャンセル'), saveBtn]),
  ]);
  form.addEventListener('submit', (e) => { e.preventDefault(); save({}); });

  async function save(flags) {
    if (saving) return;
    err.hide(); name.setError('');
    if (!name.value.trim()) { name.setError('名前を入力してください。'); name.input.focus(); err.show('名前を入力してください。企業のみを登録する場合は、上の「企業のみ登録」を選んでください。'); return; }
    if (!ocrConfirm.hidden && !ocrConfirm.querySelector('input').checked) { err.show('画像から読み取った内容を確認し、「読み取り結果を画像と見比べて確認しました」にチェックを入れてください。'); return; }
    if (!flags.unknownConfirmed && !(await confirmUnknown([name, kana, company, dept, title, keywords, receipt, memo]))) return;
    flags = { ...flags, unknownConfirmed: true };
    if (isEdit && !flags.affiliationConfirmed) {
      const spec = company.spec();
      if ((spec.mode === 'existing' ? spec.id : null) !== (person.companyId || null) || spec.mode === 'new') {
        const ok = await confirmDialog('所属企業を変更します', [`「${personCompany?.name || '企業なし'}」→「${company.displayName() || '企業なし'}」`, '変更は所属履歴に記録されます。領収証宛名も確認してください。'], { okLabel: '変更する' });
        if (!ok) return;
        flags = { ...flags, affiliationConfirmed: true };
      }
    }
    saving = true; saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    let failure = null; let result = null;
    try {
      const imageId = await saveImageSafe(ocr);
      const body = { name: name.value, nameKana: kana.value, department: dept.value, title: title.value, keywords: keywords.value, receiptName: receipt.value, company: company.spec(), groupIds: groups.value(), imageId, ...flags };
      if (memo) body.memo = memo.value;
      if (isEdit) { body.version = person.version; result = await updatePerson(person.id, body); } else result = await createPerson(body);
    } catch (e) { failure = e; } finally { saving = false; saveBtn.disabled = false; saveBtn.textContent = isEdit ? '変更を保存' : 'この内容で登録'; }
    if (!failure) { initial = snapshot(); toast(isEdit ? '変更を保存しました' : '登録しました', 'success'); onSaved(result); return; }
    await handleError(failure, flags);
  }
  async function handleError(e, flags) {
    if (e.code === 'POSSIBLE_DUPLICATE') {
      const v = await dialog({
        title: '同じ名前の登録情報があります',
        body: [h('p', {}, '同姓同名の別人の可能性もあるため、自動では同一と判断しません。内容を確認してください。'),
          candList(e.details.candidates, (c) => [h('strong', {}, `${c.name}（${c.id}）`), h('div', { class: 'small' }, `${c.companyName || '企業なし'}${c.department ? ` / ${c.department}` : ''} — ${c.reason}`)])],
        buttons: [{ label: '戻って修正する', value: false }, { label: '別人として登録する', value: true, kind: 'primary' }],
      });
      if (v) return save({ ...flags, confirmDuplicate: true });
      return;
    }
    if (e.code === 'COMPANY_EXISTS') {
      const v = await dialog({
        title: '同じ（または似た）企業が登録済みです',
        body: (done) => [h('p', {}, '同じ企業の場合は、その企業を選んで紐付けてください。名前が同じでも別の企業の場合は「別の企業として新規登録」を選んでください。'),
          candList(e.details.candidates, (c) => [h('div', {}, [h('strong', {}, c.name), h('span', { class: 'small muted' }, `（${c.id}・人物${c.personCount}名）${c.reason}`)]), h('div', {}, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => done({ choose: c }) }, 'この企業に紐付ける'))])],
        buttons: [{ label: '戻る', value: null }, { label: '別の企業として新規登録', value: 'new', kind: 'danger' }],
      });
      if (v?.choose) { company.select(v.choose); receipt.sync(); return save(flags); }
      if (v === 'new') return save({ ...flags, confirmNewCompany: true });
      return;
    }
    if (e.code === 'VERSION_CONFLICT') {
      await dialog({ title: '他の画面・端末で更新されています', body: h('p', {}, 'この登録情報は、編集を始めた後に別の画面または端末で更新されました。入力内容を控えてから詳細画面に戻り、最新の内容で編集し直してください。'), buttons: [{ label: '閉じる', value: true, kind: 'primary' }] });
      return;
    }
    if (e.details?.field && fieldsByKey[e.details.field]) fieldsByKey[e.details.field].setError(e.message);
    err.show(`保存できませんでした。${dbErrorMessage(e)} 入力内容は残っています。`);
    toast('保存できませんでした', 'error');
  }
  return {
    el: form,
    isDirty: () => snapshot() !== initial,
    cleanup: groups.cleanup,
    applyOcr(fields) {
      name.applyOcr(fields.name); kana.applyOcr(fields.nameKana);
      if (company.applyOcr(fields.companyName)) company.setText(company.value);
      dept.applyOcr(fields.department); title.applyOcr(fields.title);
      receipt.sync();
      ocrConfirm.hidden = false; ocrConfirm.querySelector('input').checked = false;
    },
    applyLine(target, text) {
      if (target === 'companyName') { company.setText(text); company.markOcr(); receipt.sync(); ocrConfirm.hidden = false; return; }
      const f = fieldsByKey[target]; if (!f) return;
      if (target === 'keywords') f.value = f.value ? `${f.value}, ${text}` : text; else if (target === 'memo') f.value = f.value ? `${f.value}\n${text}` : text; else f.value = text;
      f.markOcr(); if (target === 'name') receipt.sync(); ocrConfirm.hidden = false;
    },
    lineTargets: [{ key: 'name', label: '名前' }, { key: 'companyName', label: '企業名' }, { key: 'department', label: '部署' }, { key: 'title', label: '役職' }, { key: 'keywords', label: 'キーワード' }, ...(memo ? [{ key: 'memo', label: 'メモ' }] : [])],
  };
}

// ---------- 企業フォーム ----------
function createCompanyForm({ company = null, presetGroupIds = [], onSaved, ocr = null }) {
  const isEdit = !!company;
  const err = errorNotice();
  const name = textField('companyName', '企業名', { required: true, value: company?.name || '', placeholder: '例: 株式会社サンプル', maxlength: 100 });
  const kana = kanaField('companyKana', '企業名の読み（任意）', () => name.value, company?.nameKana || '');
  const keywords = textField('keywords', 'キーワード（任意）', { value: company?.keywords || '', maxlength: 1000, hint: '複数ある場合は「,」や「、」で区切ってください。' });
  const initialReceipt = company?.receiptName || '';
  const receipt = receiptField(() => ({ person: '', company: name.value }), initialReceipt, { auto: !isEdit || initialReceipt === defaultReceiptName('', company.name) });
  const memo = isEdit ? null : textField('memo', 'メモ（任意）', { multiline: true, maxlength: 100000 });
  const groups = groupPicker(isEdit ? company.groupIds : presetGroupIds);
  const ocrConfirm = h('label', { class: 'check ocr-confirm', hidden: true }, [h('input', { type: 'checkbox' }), ' 読み取り結果を画像と見比べて確認しました']);
  name.input.addEventListener('input', () => receipt.sync());
  name.input.addEventListener('ocr-set', () => receipt.sync());
  const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, isEdit ? '変更を保存' : 'この内容で登録');
  const fieldsByKey = { companyName: name, companyKana: kana, keywords, memo };
  const snapshot = () => JSON.stringify([name.value, kana.value, keywords.value, receipt.value, memo?.value || '', groups.key()]);
  let initial = snapshot(); let saving = false;
  const form = h('form', { class: 'card form', novalidate: true }, [
    h('h2', { class: 'card-title' }, isEdit ? '企業情報を編集' : '企業のみを登録'),
    !isEdit ? h('p', { class: 'small muted' }, '人物を登録せず、企業宛ての領収証宛名（例: 株式会社サンプル 御中）だけを登録します。') : null,
    err.el, h('div', { class: 'grid-2' }, [name.wrap, kana.wrap]), receipt.wrap, groups.wrap, keywords.wrap, memo?.wrap, ocrConfirm,
    h('div', { class: 'form-actions' }, [h('button', { type: 'button', class: 'btn btn-ghost', onclick: goBack }, 'キャンセル'), saveBtn]),
  ]);
  form.addEventListener('submit', (e) => { e.preventDefault(); save({}); });
  async function save(flags) {
    if (saving) return;
    err.hide();
    if (!name.value.trim()) { name.setError('企業名を入力してください。'); name.input.focus(); err.show('企業名を入力してください。'); return; }
    if (!ocrConfirm.hidden && !ocrConfirm.querySelector('input').checked) { err.show('画像から読み取った内容を確認し、「読み取り結果を画像と見比べて確認しました」にチェックを入れてください。'); return; }
    if (!flags.unknownConfirmed && !(await confirmUnknown([name, kana, keywords, receipt, memo]))) return;
    flags = { ...flags, unknownConfirmed: true };
    if (isEdit && name.value.trim() !== company.name && flags.replaceReceiptNames === undefined) {
      const members = [...S.persons.values()].filter((p) => p.companyId === company.id);
      if (members.length) {
        const cb = h('input', { type: 'checkbox', checked: true, id: 'replace-receipt' });
        const v = await dialog({
          title: '企業名の変更による影響の確認',
          body: [h('p', {}, `「${company.name}」→「${name.value.trim()}」`), h('p', {}, `この企業に紐付く ${members.length} 人の登録情報に影響します（名前と企業の紐付けはそのまま維持されます）。`),
            h('ul', { class: 'cand-list' }, members.slice(0, 20).map((p) => h('li', {}, `${p.name} — 宛名: ${p.receiptName || '（なし）'}`))),
            h('label', { class: 'check' }, [cb, ' 各人物の領収証宛名に含まれる旧企業名を、新しい企業名に置き換える']),
            h('p', { class: 'small muted' }, '旧企業名は履歴に残り、旧企業名でも検索できます。')],
          buttons: [{ label: 'キャンセル', value: false }, { label: '変更する', value: () => ({ replace: cb.checked }), kind: 'primary' }],
        });
        if (!v) return;
        flags = { ...flags, replaceReceiptNames: v.replace };
      }
    }
    saving = true; saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    let failure = null; let r = null;
    try {
      const imageId = await saveImageSafe(ocr);
      const body = { name: name.value, nameKana: kana.value, keywords: keywords.value, receiptName: receipt.value, groupIds: groups.value(), imageId, ...flags };
      if (memo) body.memo = memo.value;
      if (isEdit) { body.version = company.version; r = await updateCompany(company.id, body); } else r = await createCompany(body);
    } catch (e) { failure = e; } finally { saving = false; saveBtn.disabled = false; saveBtn.textContent = isEdit ? '変更を保存' : 'この内容で登録'; }
    if (!failure) {
      initial = snapshot();
      const n = (r.affectedPersons || []).filter((p) => p.replaced).length;
      if (n) toast(`${n}人の領収証宛名を更新しました`, 'success', 5000);
      toast(isEdit ? '変更を保存しました' : '登録しました', 'success');
      onSaved(r); return;
    }
    if (failure.code === 'COMPANY_EXISTS') {
      const v = await dialog({ title: '同じ（または似た）企業名が登録済みです', body: [h('p', {}, '同じ企業の場合は既存の企業を開いてください。別の企業であれば、そのまま登録できます。'), candList(failure.details.candidates, (c) => [h('strong', {}, `${c.name}（${c.id}・人物${c.personCount}名）`), h('span', { class: 'small muted' }, ` ${c.reason}`)])], buttons: [{ label: '戻る', value: false }, { label: isEdit ? 'この名前に変更する' : '別の企業として登録', value: true, kind: 'danger' }] });
      if (v) await save({ ...flags, confirmDuplicate: true });
    } else if (failure.code === 'VERSION_CONFLICT') {
      await dialog({ title: '他の画面・端末で更新されています', body: h('p', {}, '入力内容を控えてから詳細画面に戻り、最新の内容で編集し直してください。'), buttons: [{ label: '閉じる', value: true, kind: 'primary' }] });
    } else {
      if (failure.details?.field && fieldsByKey[failure.details.field]) fieldsByKey[failure.details.field].setError(failure.message);
      err.show(`保存できませんでした。${dbErrorMessage(failure)} 入力内容は残っています。`);
      toast('保存できませんでした', 'error');
    }
  }
  return {
    el: form, isDirty: () => snapshot() !== initial, cleanup: groups.cleanup,
    applyOcr(fields) { name.applyOcr(fields.companyName); receipt.sync(); ocrConfirm.hidden = false; ocrConfirm.querySelector('input').checked = false; },
    applyLine(target, text) {
      const f = fieldsByKey[target]; if (!f) return;
      if (target === 'keywords') f.value = f.value ? `${f.value}, ${text}` : text; else if (target === 'memo') f.value = f.value ? `${f.value}\n${text}` : text; else f.value = text;
      f.markOcr(); receipt.sync(); ocrConfirm.hidden = false;
    },
    lineTargets: [{ key: 'companyName', label: '企業名' }, { key: 'keywords', label: 'キーワード' }, ...(memo ? [{ key: 'memo', label: 'メモ' }] : [])],
  };
}

const leaveGuard = (isDirty) => async () => !isDirty() || confirmDialog('入力内容が保存されていません', 'このまま移動すると、入力した内容は破棄されます。移動しますか？', { okLabel: '破棄して移動', danger: true });

// ---------- ② 登録 ----------
function viewRegister({ outlet, params }) {
  let kind = params.type === 'company' ? 'company' : params.type === 'bulk' ? 'bulk' : 'person';
  const presetCompany = params.companyId ? S.companies.get(params.companyId) : null;
  let form = null;
  const formHost = h('div');
  const ocr = createOcrPanel({ onFields: (f) => form.applyOcr?.(f), onLine: (t, x) => form.applyLine?.(t, x), targets: () => form.lineTargets || [] });
  const onSaved = (r) => { go(r.type, { id: r.id }, { replace: true }); };
  function build() {
    form?.cleanup?.();
    const presetGroupIds = params.groupId ? [params.groupId] : [];
    if (kind === 'bulk') form = createBulkImport({ presetGroupIds, onDone: (kw) => go('search', { q: kw || '' }, { replace: true }) });
    else form = kind === 'person' ? createPersonForm({ presetCompany, presetName: params.name || '', presetGroupIds, onSaved, ocr }) : createCompanyForm({ presetGroupIds, onSaved, ocr });
    ocr.el.hidden = kind === 'bulk';
    fill(formHost, form.el);
  }
  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': '登録の種類' });
  function renderTabs() {
    fill(tabs, [['person', '人物を登録'], ['company', '企業のみ登録'], ['bulk', '一覧から一括登録']].map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(kind === k), class: kind === k ? 'active' : '',
      onclick: async () => {
        if (kind === k) return;
        if (form.isDirty() && !(await confirmDialog('登録の種類を切り替えます', '入力中の内容は破棄されます。よろしいですか？', { okLabel: '切り替える' }))) return;
        kind = k; renderTabs(); build();
      },
    }, label)));
  }
  renderTabs(); build();
  outlet.append(h('div', { class: 'page-head' }, [backLink('← 戻る'), h('h1', {}, '新規登録')]), tabs, h('div', { class: 'register-layout' }, [ocr.el, formHost]));
  if (params.file && kind !== 'bulk') ocr.loadFile(params.file);
  return { canLeave: leaveGuard(() => form.isDirty()), cleanup: () => { ocr.abort(); form?.cleanup?.(); } };
}

// ---------- メモ編集 ----------
function createMemoEditor({ coll, id, memo, memoVersion, memoUpdatedAt, label }) {
  const draftKey = `memo-draft:${coll}:${id}`;
  let saved = memo || ''; let version = memoVersion || 0; let state = 'saved'; let inflight = null;
  const ta = h('textarea', { class: 'memo-text', id: `memo-${id}`, rows: 6, maxlength: 100000, placeholder: '自由に入力できます（例: 領収証は但し書き「お品代」で発行、など）。入力すると自動で保存されます。' });
  ta.value = saved;
  const status = h('span', { class: 'memo-status', role: 'status', 'aria-live': 'polite' });
  const count = h('span', { class: 'muted small' });
  const updatedLine = h('div', { class: 'muted small' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => save() }, 'メモを保存');
  const retryBtn = h('button', { type: 'button', class: 'btn btn-danger btn-sm', hidden: true, onclick: () => save() }, '再試行');
  const draftBox = h('div', { class: 'notice notice-warn', hidden: true });
  const setState = (s, detail = '') => {
    state = s;
    status.textContent = { saved: `✓ 保存済み${detail ? `（${detail}）` : ''}`, dirty: '● 未保存の変更があります', saving: '保存中…', error: `✕ 保存に失敗しました。このメモは未保存です。${detail}` }[s];
    status.className = `memo-status memo-${s}`;
    retryBtn.hidden = s !== 'error'; saveBtn.disabled = s === 'saving';
  };
  const updateCount = () => { count.textContent = `${ta.value.length.toLocaleString()}文字`; };
  const autoGrow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(600, Math.max(140, ta.scrollHeight + 4))}px`; };
  const setUpdated = (iso) => { updatedLine.textContent = iso ? `メモの最終保存: ${formatDateTime(iso)}` : 'メモはまだ保存されていません'; };
  const writeDraft = () => { try { if (ta.value !== saved) localStorage.setItem(draftKey, JSON.stringify({ text: ta.value, at: nowIso() })); else localStorage.removeItem(draftKey); } catch { /* 端末の保存領域が使えない */ } };
  const clearDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* noop */ } };
  const autoSave = debounce(() => { if (state === 'dirty') save(); }, 2000);
  ta.addEventListener('input', () => {
    updateCount(); autoGrow();
    if (ta.value === saved) { setState('saved'); clearDraft(); autoSave.cancel(); return; }
    setState('dirty'); writeDraft(); autoSave();
  });
  ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } });
  async function save({ force = false } = {}) {
    autoSave.cancel();
    if (inflight) await inflight.catch(() => {});
    const text = ta.value;
    if (text === saved && !force) { setState('saved'); clearDraft(); return true; }
    setState('saving');
    inflight = updateMemo(coll, id, text, version);
    try {
      const r = await inflight;
      saved = r.memo; version = r.memoVersion; setUpdated(r.memoUpdatedAt);
      if (ta.value === text) { setState('saved', formatTime(r.memoUpdatedAt)); clearDraft(); } else { setState('dirty'); autoSave(); }
      return true;
    } catch (e) {
      if (e.code === 'MEMO_CONFLICT') return resolveConflict(e.details, text);
      writeDraft();
      setState('error', '通信を確認して「再試行」を押してください。');
      toast(`メモを保存できませんでした: ${dbErrorMessage(e)}`, 'error', 6000);
      return false;
    } finally { inflight = null; }
  }
  async function resolveConflict(d, mine) {
    setState('error', '他の端末で更新されています。');
    const choice = await dialog({
      title: 'メモが他の画面・端末で更新されています',
      body: [h('p', {}, 'どちらの内容を残すか選んでください。選ばなかった内容は失われます（必要ならコピーしてください）。'), h('div', { class: 'conflict-grid' }, [
        h('div', {}, [h('h3', {}, `保存されている内容（${formatDateTime(d.memoUpdatedAt)}）`), h('pre', { class: 'conflict-text' }, d.currentMemo || '（空）')]),
        h('div', {}, [h('h3', {}, 'この画面で入力した内容'), h('pre', { class: 'conflict-text' }, mine || '（空）')])])],
      buttons: [{ label: '保存されている内容を表示', value: 'theirs' }, { label: '入力した内容で上書き保存', value: 'mine', kind: 'primary' }],
      dismissible: false,
    });
    version = d.memoVersion;
    if (choice === 'mine') { saved = d.currentMemo; return save({ force: true }); }
    saved = d.currentMemo || ''; ta.value = saved; clearDraft(); updateCount(); autoGrow(); setUpdated(d.memoUpdatedAt); setState('saved');
    return true;
  }
  try {
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.text !== saved) {
        draftBox.hidden = false;
        draftBox.append(h('p', {}, `保存されていないメモの下書きがあります（${formatDateTime(d.at)}）。`), h('div', { class: 'row' }, [
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => { ta.value = d.text; ta.dispatchEvent(new Event('input')); draftBox.hidden = true; } }, '下書きを復元する'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { clearDraft(); draftBox.hidden = true; } }, '破棄する')]));
      } else clearDraft();
    }
  } catch { /* noop */ }
  setState('saved'); setUpdated(memoUpdatedAt); updateCount();
  const el = h('section', { class: 'card memo-card', 'aria-label': label }, [
    h('div', { class: 'card-head' }, [h('h2', { class: 'card-title' }, label), status]), draftBox, ta,
    h('div', { class: 'memo-foot' }, [h('div', {}, [updatedLine, count]), h('div', { class: 'row' }, [retryBtn, saveBtn])]),
  ]);
  requestAnimationFrame(autoGrow);
  return {
    el,
    isDirty: () => state !== 'saved',
    /** 他の端末でメモが更新されたとき、未編集なら最新に置き換える */
    external(doc) {
      if (state !== 'saved' || (doc.memoVersion || 0) <= version) return;
      saved = doc.memo || ''; version = doc.memoVersion || 0; ta.value = saved; updateCount(); autoGrow(); setUpdated(doc.memoUpdatedAt); setState('saved');
    },
    async canLeave() {
      if (state === 'saved') return true;
      if ((state === 'dirty' || state === 'saving') && await save()) return true;
      return (await dialog({ title: 'メモが保存されていません', body: h('p', {}, 'このまま移動すると、メモの変更は保存されません（下書きは端末内に残ります）。移動しますか？'), buttons: [{ label: 'この画面に残る', value: false, kind: 'primary' }, { label: '保存せずに移動', value: true, kind: 'danger' }] })) === true;
    },
    cleanup() { autoSave.cancel(); },
  };
}

// ---------- ③ 詳細 ----------
function receiptCard(main, alternatives) {
  const alts = [...new Set(alternatives.filter((a) => a && a !== main))];
  const text = h('div', { class: 'receipt-text' }, main || '（未設定）');
  return h('section', { class: 'card receipt-card', 'aria-label': '領収証宛名' }, [
    h('div', { class: 'receipt-label' }, '領収証宛名'),
    h('div', { class: 'receipt-row' }, [text, main ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => copyText(main, text) }, 'コピー') : null]),
    alts.length ? h('div', { class: 'receipt-alts' }, [h('span', { class: 'small muted' }, '他の書き方:'), ...alts.map((a) => h('button', { type: 'button', class: 'chip chip-btn', title: 'コピー', onclick: (e) => copyText(a, e.currentTarget) }, `${a}  ⧉`))]) : null,
  ]);
}
const infoRow = (label, value) => h('div', { class: 'info-row' }, [h('dt', {}, label), h('dd', {}, value)]);
function imagesBlock(ids) {
  const urls = (ids || []).map((i) => [i, imageUrl(i)]).filter(([, u]) => u);
  if (!urls.length) return h('span', { class: 'muted' }, '（なし）');
  return h('div', { class: 'thumbs' }, urls.map(([i, u]) => h('a', { href: u, target: '_blank', rel: 'noopener' }, h('img', { class: 'thumb', src: u, alt: `取り込み元画像 ${S.images.get(i)?.originalName || ''}`, loading: 'lazy' }))));
}
const notFoundView = (outlet, msg) => { fill(outlet, h('div', { class: 'page-head' }, backLink('← 戻る')), errorBox(msg)); return {}; };

function viewPerson({ outlet, params }) {
  let memo = null; let lastSig = '';
  const toSearch = (k) => go('search', { q: k });
  function render() {
    const p = S.persons.get(params.id);
    if (!p) {
      if (!allConfirmed()) { fill(outlet, loading()); return; }
      if (memo) memo.cleanup(); memo = null;
      notFoundView(outlet, 'この登録情報は見つかりません（削除された可能性があります）。');
      return;
    }
    const c = p.companyId ? S.companies.get(p.companyId) : null;
    const sig = JSON.stringify([p.version, p.photo?.assetId, c?.version, c?.name, (p.imageIds || []).map(imageUrl), validGroupIds(p.groupIds).map((g) => [g, S.groups.get(g).name, S.groups.get(g).color])]);
    if (memo) {
      memo.external(p);
      if (sig === lastSig) return;
      if (memo.isDirty()) return; // 編集中は画面を作り直さない
    }
    lastSig = sig;
    memo?.cleanup();
    memo = createMemoEditor({ coll: 'persons', id: p.id, memo: p.memo, memoVersion: p.memoVersion, memoUpdatedAt: p.memoUpdatedAt, label: 'メモ（この人物の登録情報に保存）' });
    const same = personCandidates(p.name, null, p.id).filter((x) => normalize(x.name) === normalize(p.name)).length;
    async function remove() {
      const ok = await confirmDialog('登録情報を削除します', [`「${p.name}」${c ? `（${c.name}）` : ''} ${p.id}`, 'メモも含めて削除され、元に戻せません。企業情報は削除されません。'], { okLabel: '削除する', danger: true });
      if (!ok) return;
      try { await deletePerson(p.id, p.version); toast('削除しました', 'success'); memo.cleanup(); memo = { isDirty: () => false, canLeave: async () => true, cleanup() {}, external() {} }; go('search', {}, { push: false }); } catch (e) { toast(`削除できませんでした: ${dbErrorMessage(e)}`, 'error', 6000); }
    }
    fill(outlet,
      h('div', { class: 'page-head' }, [
        backLink('← 戻る'),
        h('div', { class: 'person-head' }, [
          h('button', { type: 'button', class: 'avatar-btn', title: photoUrl(p) ? '写真を変更' : '写真を追加', onclick: () => choosePersonPhoto(p) }, avatar(p, 'lg')),
          h('div', { class: 'person-head-main' }, [
            h('div', { class: 'title-row' }, [h('h1', {}, p.name), h('span', { class: 'id-badge' }, `人物ID ${p.id}`)]),
            p.nameKana ? h('div', { class: 'kana' }, p.nameKana) : null,
            h('div', { class: 'row' }, [
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => choosePersonPhoto(p) }, photoUrl(p) ? '写真を変更' : '＋ 写真を追加'),
              photoUrl(p) ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => {
                if (!(await confirmDialog('写真を削除します', `${p.name}の写真を削除します。元に戻せません。`, { okLabel: '削除する', danger: true }))) return;
                try { await removePersonPhoto(p.id); toast('写真を削除しました', 'success'); } catch (e) { toast(dbErrorMessage(e), 'error', 6000); }
              } }, '写真を削除') : null,
            ]),
          ]),
        ]),
        same ? h('div', { class: 'notice notice-warn small' }, `同じ名前の登録情報が他に${same}件あります。企業名・人物IDで区別してください。`) : null,
      ]),
      receiptCard(p.receiptName, [c ? `${c.name} ${p.name} 様` : '', c ? `${c.name} 御中` : '', `${p.name} 様`]),
      h('section', { class: 'card' }, [
        h('dl', { class: 'info' }, [
          infoRow('名前', [p.name, p.nameKana ? h('span', { class: 'muted' }, `（${p.nameKana}）`) : null]),
          infoRow('企業名', c ? [h('button', { type: 'button', class: 'linkish', onclick: () => openCompany(c.id) }, c.name), h('span', { class: 'muted small' }, ` 企業ID ${c.id}・人物${personCount(c.id)}名`)] : h('span', { class: 'muted' }, '（企業の登録なし）')),
          infoRow('部署・役職', [p.department, p.title].filter(Boolean).join(' ') || h('span', { class: 'muted' }, '（なし）')),
          infoRow('グループ', groupChips(p.groupIds, { empty: h('span', { class: 'muted' }, '（なし）') })),
          infoRow('キーワード', keywordChips(p.keywords, toSearch)),
          infoRow('登録日時', formatDateTime(p.createdAt)),
          infoRow('最終更新日時', formatDateTime(p.updatedAt)),
        ]),
        h('div', { class: 'form-actions' }, [h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: remove }, '削除'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('editPerson', { id: p.id }) }, '情報を編集')]),
      ]),
      memo.el,
      c ? h('section', { class: 'card card-ext' }, [h('h2', { class: 'card-title' }, '外部で調べる'), h('p', { class: 'small muted' }, `所属企業「${c.name}」を調べます。`), externalSearchBox(c.name, { maps: true })]) : null,
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '取り込み元画像'), imagesBlock(p.imageIds)]),
      (p.affiliationHistory || []).length ? h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '所属の変更履歴'), h('ul', { class: 'history' }, p.affiliationHistory.map((x) => h('li', {}, `${formatDateTime(x.changedAt)}　${x.oldCompanyName || '企業なし'} → ${x.newCompanyName || '企業なし'}`)))]) : null,
    );
  }
  render();
  return { onData: render, canLeave: () => memo?.canLeave() ?? true, cleanup: () => memo?.cleanup() };
}

function viewCompany({ outlet, params }) {
  let memo = null; let lastSig = '';
  function render() {
    const c = S.companies.get(params.id);
    if (!c) {
      if (!allConfirmed()) { fill(outlet, loading()); return; }
      memo?.cleanup(); memo = null;
      notFoundView(outlet, 'この企業は見つかりません（削除された可能性があります）。');
      return;
    }
    const members = [...S.persons.values()].filter((p) => p.companyId === c.id).sort((a, b) => cmpId(a.id, b.id));
    const sig = JSON.stringify([c.version, members.map((m) => [m.id, m.version]), (c.imageIds || []).map(imageUrl), validGroupIds(c.groupIds).map((g) => [g, S.groups.get(g).name, S.groups.get(g).color])]);
    if (memo) { memo.external(c); if (sig === lastSig || memo.isDirty()) return; }
    lastSig = sig;
    memo?.cleanup();
    memo = createMemoEditor({ coll: 'companies', id: c.id, memo: c.memo, memoVersion: c.memoVersion, memoUpdatedAt: c.memoUpdatedAt, label: '企業メモ（この企業に保存）' });
    const same = companyCandidates(c.name, c.id).length;
    async function remove() {
      if (members.length) {
        await dialog({ title: 'この企業は削除できません', body: [h('p', {}, `この企業には ${members.length} 人の人物が紐付いています。名前と企業の紐付けを守るため、先に人物を削除するか、人物の所属企業を変更してください。`), h('ul', {}, members.map((p) => h('li', {}, p.name)))], buttons: [{ label: '閉じる', value: true, kind: 'primary' }] });
        return;
      }
      if (!(await confirmDialog('企業を削除します', [`「${c.name}」${c.id}`, '企業メモも含めて削除され、元に戻せません。'], { okLabel: '削除する', danger: true }))) return;
      try { await deleteCompany(c.id, c.version); toast('削除しました', 'success'); memo.cleanup(); memo = { isDirty: () => false, canLeave: async () => true, cleanup() {}, external() {} }; go('search', {}, { push: false }); } catch (e) { toast(`削除できませんでした: ${dbErrorMessage(e)}`, 'error', 7000); }
    }
    fill(outlet,
      h('div', { class: 'page-head' }, [
        backLink('← 戻る'),
        h('div', { class: 'title-row' }, [h('h1', {}, c.name), h('span', { class: 'id-badge' }, `企業ID ${c.id}`)]),
        c.nameKana ? h('div', { class: 'kana' }, c.nameKana) : null,
        same ? h('div', { class: 'notice notice-warn small' }, `同じ（または似た）名前の企業が他に${same}件あります。企業IDで区別してください。`) : null,
      ]),
      receiptCard(c.receiptName, [`${c.name} 御中`, `${c.name} 様`]),
      h('section', { class: 'card card-ext' }, [h('h2', { class: 'card-title' }, '外部で調べる'), h('p', { class: 'small muted' }, '正式な企業名・所在地・電話番号の確認に使えます。'), externalSearchBox(c.name, { maps: true })]),
      h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [h('h2', { class: 'card-title' }, `この企業の人物（${members.length}名）`), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => go('register', { companyId: c.id }) }, '＋ この企業に人物を追加')]),
        members.length ? h('ul', { class: 'person-list' }, members.map((p) => h('li', {}, h('button', { type: 'button', class: 'person-row', onclick: () => openPerson(p.id) }, [
          h('span', { class: 'pr-receipt' }, p.receiptName || '（宛名未設定）'),
          h('span', { class: 'pr-name' }, [avatar(p, 'xs'), ' ', p.name, p.nameKana ? h('span', { class: 'muted small' }, ` ${p.nameKana}`) : null]),
          h('span', { class: 'small muted' }, [p.department, p.title].filter(Boolean).join(' ')),
          h('span', { class: 'small muted' }, p.id)])))) : h('p', { class: 'muted' }, 'まだ人物が登録されていません。'),
      ]),
      h('section', { class: 'card' }, [
        h('dl', { class: 'info' }, [
          infoRow('企業名', [c.name, c.nameKana ? h('span', { class: 'muted' }, `（${c.nameKana}）`) : null]),
          infoRow('グループ', groupChips(c.groupIds, { empty: h('span', { class: 'muted' }, '（なし）') })),
          infoRow('キーワード', keywordChips(c.keywords, (k) => go('search', { q: k }))),
          infoRow('登録日時', formatDateTime(c.createdAt)),
          infoRow('最終更新日時', formatDateTime(c.updatedAt)),
          (c.nameHistory || []).length ? infoRow('企業名の変更履歴', h('ul', { class: 'history' }, c.nameHistory.map((x) => h('li', {}, `${formatDateTime(x.changedAt)}　${x.oldName} → ${x.newName}`)))) : null,
        ]),
        h('div', { class: 'form-actions' }, [h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: remove }, '削除'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go('editCompany', { id: c.id }) }, '企業情報を編集')]),
      ]),
      memo.el,
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '取り込み元画像'), imagesBlock(c.imageIds)]),
    );
  }
  render();
  return { onData: render, canLeave: () => memo?.canLeave() ?? true, cleanup: () => memo?.cleanup() };
}

// ---------- 編集 ----------
function viewEditPerson({ outlet, params }) {
  const p = S.persons.get(params.id);
  if (!p) return notFoundView(outlet, 'この登録情報は見つかりません。');
  const form = createPersonForm({ person: { ...p }, onSaved: (r) => go('person', { id: r.id }, { replace: true }) });
  outlet.append(h('div', { class: 'page-head' }, [backLink('← 詳細へ戻る'), h('div', { class: 'title-row' }, [h('h1', {}, `${p.name} を編集`), h('span', { class: 'id-badge' }, `人物ID ${p.id}`)])]), h('p', { class: 'small muted' }, 'メモは詳細画面で編集できます。'), form.el);
  return { canLeave: leaveGuard(form.isDirty), cleanup: form.cleanup };
}
function viewEditCompany({ outlet, params }) {
  const c = S.companies.get(params.id);
  if (!c) return notFoundView(outlet, 'この企業は見つかりません。');
  const form = createCompanyForm({ company: { ...c }, onSaved: (r) => go('company', { id: r.id }, { replace: true }) });
  outlet.append(h('div', { class: 'page-head' }, [backLink('← 詳細へ戻る'), h('div', { class: 'title-row' }, [h('h1', {}, `${c.name} を編集`), h('span', { class: 'id-badge' }, `企業ID ${c.id}`)])]), h('p', { class: 'small muted' }, '企業メモは詳細画面で編集できます。'), form.el);
  return { canLeave: leaveGuard(form.isDirty), cleanup: form.cleanup };
}

// ---------- ④ 管理 ----------
const simpleNorm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
const ADMIN_TABS = [['persons', '人物一覧'], ['companies', '企業一覧'], ['groups', 'グループ'], ['duplicates', '重複候補'], ['data', 'データ管理']];
function viewAdmin({ outlet, params }) {
  const tab = ADMIN_TABS.some(([k]) => k === params.tab) ? params.tab : 'persons';
  const body = h('div');
  outlet.append(h('div', { class: 'page-head' }, h('h1', {}, '管理')), h('nav', { class: 'segmented', 'aria-label': '管理メニュー' }, ADMIN_TABS.map(([k, label]) => h('button', { type: 'button', class: k === tab ? 'active' : '', 'aria-current': k === tab ? 'page' : undefined, onclick: () => go('admin', { tab: k }, { replace: true }) }, label))), body);
  const renderer = { persons: adminPersons, companies: adminCompanies, groups: adminGroups, duplicates: adminDuplicates, data: adminData }[tab](body);
  return { onData: renderer };
}
function listTable(body, { columns, getItems, filterText, sorters, row, emptyText }) {
  const filter = h('input', { type: 'search', class: 'input', id: 'admin-filter', placeholder: '一覧を絞り込む', 'aria-label': '一覧を絞り込む' });
  const sort = h('select', { class: 'input', id: 'admin-sort', 'aria-label': '並び順' }, sorters.map(([k, label]) => h('option', { value: k }, label)));
  const count = h('span', { class: 'muted small' });
  const tbody = h('tbody');
  const render = () => {
    const items = getItems();
    const f = simpleNorm(filter.value);
    const sorter = sorters.find(([k]) => k === sort.value)[2];
    const shown = items.filter((it) => !f || simpleNorm(filterText(it)).includes(f)).sort(sorter);
    count.textContent = `${shown.length} / ${items.length}件`;
    fill(tbody, shown.length ? shown.map(row) : h('tr', {}, h('td', { colspan: columns.length }, emptyText)));
  };
  filter.addEventListener('input', debounce(render, 100));
  sort.addEventListener('change', render);
  fill(body, h('div', { class: 'toolbar' }, [filter, sort, count]), h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c)))), tbody])));
  render();
  return render;
}
const byStr = (f) => (a, b) => String(f(a)).localeCompare(String(f(b)), 'ja');
const byDesc = (f) => (a, b) => String(f(b)).localeCompare(String(f(a))) || cmpId(b.id, a.id);
function adminPersons(body) {
  return listTable(body, {
    columns: ['ID', '領収証宛名', '名前', '企業名', '最終更新', '操作'], emptyText: '該当する人物はありません。',
    getItems: () => [...S.persons.values()].map(personSummary).map((p) => ({ ...p, version: S.persons.get(p.id).version })),
    filterText: (p) => `${p.name} ${p.nameKana} ${p.companyName} ${p.receiptName} ${withGroupNames(S.persons.get(p.id) || {})}`,
    sorters: [['updated', '更新日時が新しい順', byDesc((p) => p.updatedAt)], ['created', '登録日時が新しい順', byDesc((p) => p.createdAt)], ['name', '名前順', byStr((p) => p.nameKana || p.name)], ['company', '企業名順', byStr((p) => p.companyName)]],
    row: (p) => h('tr', {}, [
      h('td', { 'data-label': 'ID' }, p.id),
      h('td', { 'data-label': '領収証宛名' }, p.receiptName),
      h('td', { 'data-label': '名前' }, h('button', { type: 'button', class: 'linkish', onclick: () => openPerson(p.id) }, p.name)),
      h('td', { 'data-label': '企業名' }, p.companyId ? h('button', { type: 'button', class: 'linkish', onclick: () => openCompany(p.companyId) }, p.companyName) : h('span', { class: 'muted' }, '—')),
      h('td', { 'data-label': '最終更新' }, formatDateTime(p.updatedAt)),
      h('td', { class: 'actions' }, [
        h('button', { type: 'button', class: 'btn btn-xs', onclick: () => go('editPerson', { id: p.id }) }, '編集'),
        h('button', { type: 'button', class: 'btn btn-xs btn-danger-ghost', onclick: async () => {
          if (!(await confirmDialog('登録情報を削除します', [`「${p.name}」${p.companyName ? `（${p.companyName}）` : ''} ${p.id}`, 'メモも含めて削除され、元に戻せません。'], { okLabel: '削除する', danger: true }))) return;
          try { await deletePerson(p.id, p.version); toast('削除しました', 'success'); } catch (e) { toast(`削除できませんでした: ${dbErrorMessage(e)}`, 'error', 6000); }
        } }, '削除'),
      ]),
    ]),
  });
}
function adminCompanies(body) {
  return listTable(body, {
    columns: ['ID', '領収証宛名', '人物数', '企業名', '最終更新', '操作'], emptyText: '該当する企業はありません。',
    getItems: () => [...S.companies.values()].map((c) => ({ ...companySummary(c), version: c.version })),
    filterText: (c) => `${c.name} ${c.nameKana} ${c.receiptName} ${c.keywords}`,
    sorters: [['updated', '更新日時が新しい順', byDesc((c) => c.updatedAt)], ['created', '登録日時が新しい順', byDesc((c) => c.createdAt)], ['name', '企業名順', byStr((c) => c.nameKana || c.name)], ['count', '人物数が多い順', (a, b) => b.personCount - a.personCount || cmpId(a.id, b.id)]],
    row: (c) => h('tr', {}, [
      h('td', { 'data-label': 'ID' }, c.id),
      h('td', { 'data-label': '領収証宛名' }, c.receiptName),
      h('td', { 'data-label': '人物数' }, `${c.personCount}名`),
      h('td', { 'data-label': '企業名' }, h('button', { type: 'button', class: 'linkish', onclick: () => openCompany(c.id) }, c.name)),
      h('td', { 'data-label': '最終更新' }, formatDateTime(c.updatedAt)),
      h('td', { class: 'actions' }, [
        h('button', { type: 'button', class: 'btn btn-xs', onclick: () => go('editCompany', { id: c.id }) }, '編集'),
        h('button', { type: 'button', class: 'btn btn-xs btn-danger-ghost', onclick: async () => {
          if (c.personCount > 0) { toast(`「${c.name}」には${c.personCount}人の人物が紐付いているため削除できません。先に人物を削除するか所属を変更してください。`, 'error', 7000); return; }
          if (!(await confirmDialog('企業を削除します', [`「${c.name}」${c.id}`, '企業メモも含めて削除され、元に戻せません。'], { okLabel: '削除する', danger: true }))) return;
          try { await deleteCompany(c.id, c.version); toast('削除しました', 'success'); } catch (e) { toast(`削除できませんでした: ${dbErrorMessage(e)}`, 'error', 7000); }
        } }, '削除'),
      ]),
    ]),
  });
}
function adminDuplicates(body) {
  const render = () => {
    const d = duplicateGroups();
    fill(body,
      h('p', { class: 'notice notice-info small' }, '名前（または法人格を除いた企業名）が同じ登録情報を一覧にしています。同姓同名の別人の可能性があるため、自動では統合しません。同一の場合は不要な方を削除してください。'),
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, `同じ名前の人物（${d.persons.length}組）`),
        d.persons.length ? d.persons.map((g) => h('div', { class: 'dup-group' }, [h('div', { class: 'dup-key' }, [g.key, g.sameCompany ? h('span', { class: 'badge badge-warn' }, '同じ企業に同名あり') : null]),
          h('ul', {}, g.items.map((p) => h('li', {}, [h('button', { type: 'button', class: 'linkish', onclick: () => openPerson(p.id) }, p.name), ` — ${p.companyName || '企業なし'}`, h('span', { class: 'muted small' }, `（${p.id}・登録 ${formatDateTime(p.createdAt)}）`)])))])) : h('p', { class: 'muted' }, '重複候補はありません。')]),
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, `同じ名前の企業（${d.companies.length}組）`),
        d.companies.length ? d.companies.map((g) => h('div', { class: 'dup-group' }, [h('div', { class: 'dup-key' }, g.key),
          h('ul', {}, g.items.map((c) => h('li', {}, [h('button', { type: 'button', class: 'linkish', onclick: () => openCompany(c.id) }, c.name), h('span', { class: 'muted small' }, `（${c.id}・人物${c.personCount}名・登録 ${formatDateTime(c.createdAt)}）`)])))])) : h('p', { class: 'muted' }, '重複候補はありません。')]));
  };
  render();
  return render;
}

// ---------- データ管理（書き出し・取り込み・読みの一括推定） ----------
function exportData() {
  // PC版の書き出し形式（receipt-search-export）と互換。どちらでも取り込める
  const companies = [...S.companies.values()].map((c) => ({ id: c.id, name: c.name, name_kana: c.nameKana || '', keywords: c.keywords || '', receipt_name: c.receiptName || '', memo: c.memo || '', group_ids: validGroupIds(c.groupIds), created_at: c.createdAt, updated_at: c.updatedAt }));
  const persons = [...S.persons.values()].map((p) => ({ id: p.id, company_id: p.companyId || null, name: p.name, name_kana: p.nameKana || '', department: p.department || '', title: p.title || '', keywords: p.keywords || '', receipt_name: p.receiptName || '', memo: p.memo || '', group_ids: validGroupIds(p.groupIds), created_at: p.createdAt, updated_at: p.updatedAt }));
  const companyNameHistory = [...S.companies.values()].flatMap((c) => (c.nameHistory || []).map((x) => ({ company_id: c.id, old_name: x.oldName, new_name: x.newName, changed_at: x.changedAt })));
  const personAffiliationHistory = [...S.persons.values()].flatMap((p) => (p.affiliationHistory || []).map((x) => ({ person_id: p.id, old_company_id: x.oldCompanyId, old_company_name: x.oldCompanyName, new_company_id: x.newCompanyId, new_company_name: x.newCompanyName, changed_at: x.changedAt })));
  const groups = groupList().map((g) => ({ id: g.id, name: g.name, color: g.color || 0, memo: g.memo || '' }));
  return { format: 'receipt-search-export', source: 'artifact', exportedAt: nowIso(), companies, persons, groups, companyNameHistory, personAffiliationHistory };
}
function exportCsv() {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const gnames = (x) => validGroupIds(x.groupIds).map((g) => S.groups.get(g).name).join('、');
  const rows = [['種別', '人物ID', '名前', '名前の読み', '企業ID', '企業名', '企業名の読み', '部署', '役職', '領収証宛名', 'グループ', 'キーワード', 'メモ', '登録日時', '最終更新日時']];
  for (const p of S.persons.values()) { const c = S.companies.get(p.companyId); rows.push(['人物', p.id, p.name, p.nameKana, c?.id || '', c?.name || '', c?.nameKana || '', p.department, p.title, p.receiptName, gnames(p), p.keywords, p.memo, p.createdAt, p.updatedAt]); }
  for (const c of S.companies.values()) rows.push(['企業', '', '', '', c.id, c.name, c.nameKana, '', '', c.receiptName, gnames(c), c.keywords, c.memo, c.createdAt, c.updatedAt]);
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`;
}
async function saveFile(filename, data) {
  if (!RT.downloads) { toast('この環境ではファイルを保存できません。', 'error'); return; }
  try { await RT.downloads.save({ filename, data }); toast('保存しました', 'success'); } catch (e) { if (e?.code !== 'declined') toast('ファイルを保存できませんでした。', 'error'); }
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

async function importData(json, progress) {
  if (json?.format !== 'receipt-search-export' || !Array.isArray(json.companies) || !Array.isArray(json.persons)) {
    throw new AppError('BAD_FILE', 'このファイルは取り込めません。PC版またはこのページの「JSONで書き出し」で作ったファイルを選んでください。');
  }
  const ts = nowIso();
  const idMap = new Map();
  const hist = new Map();
  for (const x of json.companyNameHistory || []) { if (!hist.has(x.company_id)) hist.set(x.company_id, []); hist.get(x.company_id).push({ oldName: x.old_name, newName: x.new_name, changedAt: x.changed_at }); }
  const aff = new Map();
  for (const x of json.personAffiliationHistory || []) { if (!aff.has(x.person_id)) aff.set(x.person_id, []); aff.get(x.person_id).push({ oldCompanyId: null, oldCompanyName: x.old_company_name || '', newCompanyId: null, newCompanyName: x.new_company_name || '', changedAt: x.changed_at }); }
  // グループ: 同じ名前のグループがあればそれを使い、なければ作る
  const gMap = new Map();
  for (const g of json.groups || []) {
    const exist = groupNameTaken(g.name || '');
    if (exist) gMap.set(g.id, exist.id);
    else if (cleanLine(g.name)) { const r = await createGroup({ name: g.name, color: g.color, memo: g.memo }); gMap.set(g.id, r.id); }
  }
  const mapGroups = (ids) => (Array.isArray(ids) ? ids.map((x) => gMap.get(x)).filter(Boolean) : []);
  let done = 0; const total = json.companies.length + json.persons.length;
  for (const c of json.companies) {
    const id = newId('C', S.companies);
    const doc = { name: cleanLine(c.name) || '（名称なし）', nameKana: cleanLine(c.name_kana), keywords: tidyKeywords(clean(c.keywords)), receiptName: cleanLine(c.receipt_name) || defaultReceiptName('', c.name), memo: clean(c.memo).slice(0, 100000), memoVersion: c.memo ? 1 : 0, memoUpdatedAt: c.memo ? ts : null, version: 1, nameHistory: (hist.get(c.id) || []).slice(0, 50), imageIds: [], groupIds: mapGroups(c.group_ids), createdAt: c.created_at || ts, updatedAt: c.updated_at || ts };
    await RT.db.doc(`companies/${id}`).set(doc);
    S.companies.set(id, { id, ...doc });
    idMap.set(c.id, id);
    progress(++done, total);
  }
  for (const p of json.persons) {
    const id = newId('P', S.persons);
    const cid = p.company_id != null ? idMap.get(p.company_id) || null : null;
    const doc = { companyId: cid, name: cleanLine(p.name) || '（名前なし）', nameKana: cleanLine(p.name_kana), department: cleanLine(p.department), title: cleanLine(p.title), keywords: tidyKeywords(clean(p.keywords)), receiptName: cleanLine(p.receipt_name), memo: clean(p.memo).slice(0, 100000), memoVersion: p.memo ? 1 : 0, memoUpdatedAt: p.memo ? ts : null, version: 1, affiliationHistory: (aff.get(p.id) || []).slice(0, 50), imageIds: [], groupIds: mapGroups(p.group_ids), createdAt: p.created_at || ts, updatedAt: p.updated_at || ts };
    await RT.db.doc(`persons/${id}`).set(doc);
    S.persons.set(id, { id, ...doc });
    progress(++done, total);
  }
  S.index = null;
  return { companies: json.companies.length, persons: json.persons.length };
}

async function inferReadings(progress) {
  // 読み未登録の登録情報に、検索用の読み（nameKanaAuto）を推定して付ける。表示上は「読み」として扱わない
  const targets = [...[...S.persons.values()].map((x) => ['persons', x]), ...[...S.companies.values()].map((x) => ['companies', x])].filter(([, x]) => !x.nameKana && !x.nameKanaAuto);
  let done = 0;
  for (let i = 0; i < targets.length; i += 40) {
    const chunk = targets.slice(i, i + 40);
    const list = chunk.map(([, x], j) => `${j}\t${x.name}`).join('\n');
    const r = await RT.sample.json(`次の日本語の人名・企業名それぞれの一般的な読みをひらがなで答えてください。法人格（株式会社など）も読みに含めます。読みが分からない・複数考えられるものは "" にしてください。JSONのみ: {"readings":[{"i":番号,"reading":"…"}]}\n\n${list}`, { modelTier: 'quick' });
    for (const item of r?.readings || []) {
      const t = chunk[Number(item.i)];
      const reading = toHiragana(cleanLine(item.reading));
      if (!t || !reading || !/^[\p{Script=Hiragana}ー\s]+$/u.test(reading)) continue;
      try { await RT.db.doc(`${t[0]}/${t[1].id}`).update({ nameKanaAuto: reading }); } catch (e) { console.warn(e); }
    }
    done += chunk.length; progress(done, targets.length);
  }
  return targets.length;
}

function adminData(body) {
  const status = h('div', { 'aria-live': 'polite' });
  const render = () => {
    const missing = [...S.persons.values(), ...S.companies.values()].filter((x) => !x.nameKana && !x.nameKanaAuto).length;
    fill(body,
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '登録件数'), h('div', { class: 'stats' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(S.persons.size)), h('div', { class: 'stat-label' }, '人物')]),
        h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(S.companies.size)), h('div', { class: 'stat-label' }, '企業')]),
        h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(S.images.size)), h('div', { class: 'stat-label' }, '画像')])])]),
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '書き出し（バックアップ）'),
        h('p', { class: 'small' }, 'データはこのページ（claude.ai）の保存領域にあります。定期的に書き出して手元に保管してください。'),
        h('div', { class: 'row' }, [
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => saveFile(`receipt-search-${stamp()}.json`, JSON.stringify(exportData(), null, 2)) }, 'JSONで書き出し（全データ・移行用）'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => saveFile(`receipt-search-${stamp()}.csv`, exportCsv()) }, 'CSVで書き出し（Excel用）'),
        ]),
        h('p', { class: 'small muted' }, '書き出したファイルには個人情報が含まれます。取り扱いにご注意ください。画像はファイルに含まれません。')]),
      h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '取り込み（PC版からの移行など）'),
        h('p', { class: 'small' }, 'PC版の「管理 → データ管理 → JSONで書き出し」で作ったファイル、またはこのページで書き出したJSONを取り込めます。既存の登録情報には追加されます（上書きはしません）。'),
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => {
          const input = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only' });
          document.body.append(input);
          input.addEventListener('change', async () => {
            const file = input.files?.[0]; input.remove(); if (!file) return;
            let json; try { json = JSON.parse(await file.text()); } catch { toast('JSONファイルを読み込めませんでした。', 'error'); return; }
            const nC = json?.companies?.length || 0; const nP = json?.persons?.length || 0;
            if (!(await confirmDialog('データを取り込みます', [`企業 ${nC}件・人物 ${nP}件を追加します。`, S.persons.size + S.companies.size ? '既に登録情報があります。同じデータを2回取り込むと重複します（取り込み後は「重複候補」で確認できます）。' : '取り込み後、内容を確認してください。'], { okLabel: '取り込む' }))) return;
            try { const r = await importData(json, (d, t) => { status.textContent = `取り込み中… ${d} / ${t}`; }); status.textContent = ''; toast(`企業${r.companies}件・人物${r.persons}件を取り込みました`, 'success', 5000); } catch (e) { status.textContent = ''; toast(e instanceof AppError ? e.message : `取り込みが途中で止まりました: ${dbErrorMessage(e)}（取り込めた分は登録されています）`, 'error', 8000); }
          }, { once: true });
          input.click();
        } }, 'JSONファイルを選んで取り込む'), status]),
      RT.sample ? h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '検索用の読みを推定'),
        h('p', { class: 'small' }, `読みが未登録の登録情報（${missing}件）について、Claudeが一般的な読みを推定し、ひらがなでの検索に使えるようにします。推定した読みは画面には表示せず、確定した読みとしては扱いません（結果は「候補」と同じく確認して選んでください）。`),
        h('button', { type: 'button', class: 'btn btn-secondary', disabled: !missing || undefined, onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { const n = await inferReadings((d, t) => { status.textContent = `推定中… ${d} / ${t}`; }); status.textContent = ''; toast(`${n}件の読みを推定しました`, 'success'); } catch (err) { status.textContent = ''; toast(sampleErrorMessage(err), 'error', 6000); b.disabled = false; }
        } }, '読みを推定する')]) : null,
    );
  };
  render();
  return render;
}

const VIEWS = { search: viewSearch, register: viewRegister, person: viewPerson, company: viewCompany, editPerson: viewEditPerson, editCompany: viewEditCompany, admin: viewAdmin, group: viewGroup };

// ---------- 起動 ----------
async function boot() {
  document.querySelectorAll('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view, {})));
  const outlet = document.getElementById('app');
  fill(outlet, loading('準備しています…'));
  const use = (n) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
  const [db, assets, sample, downloads, user] = await Promise.all([use('db'), use('assets'), use('sample'), use('downloads'), use('user')]);
  Object.assign(RT, { db, assets, sample, downloads, user });
  try { RT.canWrite = user ? await user.can('data.write') : null; } catch { RT.canWrite = null; }
  if (RT.canWrite === false) {
    const b = document.getElementById('perm-banner');
    b.hidden = false;
  }
  if (!db) {
    fill(outlet, h('div', { class: 'empty' }, [h('p', { class: 'empty-title' }, '登録情報を読み込めません'), h('p', {}, 'このページは claude.ai にログインした状態で開いてください。データは所有者と編集者だけが見られます。')]));
    return;
  }
  if (sample) { try { RT.canImages = !!(await sample.limits())?.images; } catch { RT.canImages = false; } }
  subscribeAll();
  mountSelectionBar();
  const timer = setTimeout(() => { if (!allConfirmed()) document.getElementById('conn-banner').hidden = false; }, 10000);
  onData(() => {
    if (allConfirmed()) { clearTimeout(timer); document.getElementById('conn-banner').hidden = true; }
    if (S.error) { const b = document.getElementById('conn-banner'); b.hidden = false; b.querySelector('span').textContent = S.error.code === 'revoked' ? 'このページのデータを使う権限がなくなりました。' : '登録情報の読み込みが止まりました。ページを開き直してください。'; }
  });
  window.addEventListener('beforeunload', (e) => { if (current?.canLeave && document.querySelector('.memo-dirty, .memo-error, .memo-saving')) { e.preventDefault(); e.returnValue = ''; } });
  go('search', {}, { push: false });
}
boot();
