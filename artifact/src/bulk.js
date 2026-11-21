// ===== 一覧から一括登録（メモアプリの表の貼り付け・一覧の画像） =====
// 流れ: ①貼り付け／画像 → ②行ごとの表で修正 → ③確認画面（チェック必須） → ④登録
// 方針: 企業は文字列で自動的に同一と判断しない（既存企業と同名なら「紐付け／新規」を行ごとに選ばせる）。
//       同じ名前の人物が既にいる行は、初期状態で「登録しない」にして確認を求める。

/** 貼り付けた文字を「企業名・名前」の行に分ける */
function parseBulkText(text) {
  const rows = [];
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/ /g, ' ').trim();
    if (!line) continue;
    if (/^(企業名|会社名|会社)\s*[\t,、　 ]\s*(名前|氏名|担当)/.test(line)) continue; // 見出し行
    let company = ''; let name = ''; let split = false;
    // 区切りの優先順: タブ → カンマ → 全角空白 → 半角空白2つ以上（最初の区切りだけで分ける）
    for (const re of [/\t+/, /\s*[,，]\s*/, /　+/, / {2,}/]) {
      const m = line.match(re);
      if (m) { company = line.slice(0, m.index).trim(); name = line.slice(m.index + m[0].length).trim(); split = true; break; }
    }
    if (!split) company = line;
    rows.push({ company: cleanLine(company), name: cleanLine(name.replace(/\t+/g, ' ')), uncertain: !split || !name, note: !split ? '区切りが見つからない行です。名前の欄を確認してください（上下の行と結合もできます）' : '' });
  }
  return rows;
}

const BULK_LIST_PROMPT = `添付画像は「企業名」と「名前（担当者）」の2列の一覧表（スマートフォンのメモなど）です。
次の規則を必ず守り、JSONだけを返してください。
- 表の各行を上から順に、書かれている通りに書き写す。「さん」「くん」「ちゃん」などの敬称や愛称もそのまま残す。推測・補完をしない。
- 1つのセルが2行に折り返されている場合は、1つのセルとして空白1つでつなぐ。
- 文字が隠れている・欠けている・判読に迷う行は uncertain を true にし、読めない文字は「?」にする。
- 見出し行（あれば）は含めない。
形式: {"rows":[{"company":"…","name":"…","uncertain":false}]}`;

function createBulkImport({ onDone, presetGroupIds = [] }) {
  const groups = groupPicker(presetGroupIds);
  let rows = []; // {key, include, company, name, uncertain, note, link: 'auto'|'new'|companyId}
  let seq = 0;
  let stage = 'input';
  const root = h('div');
  const textarea = h('textarea', { id: 'bulk-text', class: 'bulk-text', rows: 8, placeholder: '例）メモアプリの表を選択してコピーし、ここに貼り付けます。\n株式会社あおば設備	青木さん\n（有）さくら園芸	けんくん\n\n1行に「企業名」と「名前」を、タブ・カンマ・全角スペースのどれかで区切って書いても構いません。' });
  const keywords = h('input', { id: 'bulk-keywords', class: 'input', type: 'text', placeholder: '例: 青年部', maxlength: 200 });
  const receiptFmt = h('select', { id: 'bulk-receipt', class: 'input' }, [
    h('option', { value: 'company-sama' }, '企業名 様（例: 株式会社サンプル 様）'),
    h('option', { value: 'company-onchu' }, '企業名 御中（例: 株式会社サンプル 御中）'),
    h('option', { value: 'company-person' }, '企業名 名前 様（例: 株式会社サンプル 山田さん 様）'),
  ]);
  const imgStatus = h('div', { 'aria-live': 'polite' });
  const err = h('div', { class: 'notice notice-error', role: 'alert', hidden: true });
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  const ensureExtra = (r) => (r.extra ||= { nameKana: '', department: '', title: '', receiptName: null, keywords: '', memo: '', groupIds: [] });
  const rowGroups = (r) => validGroupIds([...groups.value(), ...((r.extra && r.extra.groupIds) || [])]);
  const rowKeywords = (r) => tidyKeywords([keywords.value, r.extra?.keywords || ''].filter(Boolean).join(', '));
  const rowReceipt = (r) => (r.extra?.receiptName != null && r.extra.receiptName !== '' ? r.extra.receiptName : receiptFor(r.company, r.name));
  const receiptFor = (company, name) => {
    const c = cleanLine(company); const n = cleanLine(name);
    if (receiptFmt.value === 'company-onchu') return c ? `${c} 御中` : `${n} 様`;
    if (receiptFmt.value === 'company-person') return defaultReceiptName(n, c);
    return c ? `${c} 様` : `${n} 様`;
  };

  // 行の状態（既存企業の候補・重複の可能性）を計算
  function analyze(r) {
    const cands = r.company ? companyCandidates(r.company) : [];
    const exact = cands.filter((c) => c.reason === '同じ企業名' || c.reason === '表記違いの同名');
    let linkId = null;
    if (r.link && r.link !== 'auto' && r.link !== 'new') linkId = S.companies.has(r.link) ? r.link : null;
    else if (r.link === 'auto' && exact.length === 1) linkId = exact[0].id;
    const dupPersons = r.name ? personCandidates(r.name, linkId).filter((p) => p.sameCompany || normalize(p.name) === normalize(r.name)) : [];
    return { cands, exact, linkId, dupPersons };
  }

  function addRows(list) {
    for (const x of list) {
      const r = { key: ++seq, include: true, company: x.company || '', name: x.name || '', uncertain: !!x.uncertain, note: x.note || (x.uncertain ? '画像の文字が隠れている・判読に迷う行です。画像と見比べてください' : ''), link: 'auto' };
      const a = analyze(r);
      if (a.dupPersons.some((p) => p.sameCompany)) { r.include = false; r.note = `${r.note ? `${r.note}。` : ''}同じ企業に同じ名前の登録情報があるため、初期状態では登録しません`; }
      if (!r.company && !r.name) continue;
      rows.push(r);
    }
  }

  // ---------- ① 入力 ----------
  function renderInput() {
    stage = 'input';
    fill(root,
      h('section', { class: 'card' }, [
        h('h2', { class: 'card-title' }, '① 一覧を貼り付ける'),
        h('p', { class: 'small muted' }, 'メモアプリなどの表を選択してコピーし、下の欄に貼り付けてください。1行が1人分になります。'),
        textarea,
        h('div', { class: 'row' }, [
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
            showErr('');
            const parsed = parseBulkText(textarea.value);
            if (!parsed.length) { showErr('貼り付けた内容がありません。メモアプリで表を選択してコピーし、貼り付けてください。'); return; }
            rows = []; addRows(parsed); renderTable();
          } }, '表に分ける'),
          h('span', { class: 'small muted' }, 'または'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: readImage }, '一覧の画像（スクリーンショット）を読み取る'),
        ]),
        imgStatus,
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'card-title' }, '全員に共通の設定'),
        h('div', { class: 'grid-2' }, [
          h('div', { class: 'field' }, [h('label', { class: 'field-label', for: 'bulk-keywords' }, 'キーワード（任意・全員に付けます）'), keywords]),
          h('div', { class: 'field' }, [h('label', { class: 'field-label', for: 'bulk-receipt' }, '領収証宛名の書き方'), receiptFmt]),
        ]),
        groups.wrap,
        h('p', { class: 'small muted' }, '名前は「さん」「くん」「ちゃん」も含めて、書かれている通りに登録します。'),
      ]),
      err,
    );
  }

  async function readImage() {
    showErr('');
    const file = await pickImageFile(false);
    if (!file) return;
    let img;
    try { const l = await loadImageFile(file); img = await renderImage(l.source, 0); } catch (e) { fill(imgStatus, h('div', { class: 'notice notice-error' }, e.message)); return; }
    const why = sampleUnavailableReason();
    if (!why && !IS_LOCAL) {
      fill(imgStatus, loading('Claudeが一覧を読み取っています…（通常10〜60秒）'));
      try {
        const r = await RT.sample.json(BULK_LIST_PROMPT, { images: [img.blob] });
        const list = (Array.isArray(r?.rows) ? r.rows : []).map((x) => ({ company: cleanLine(x.company), name: cleanLine(x.name), uncertain: !!x.uncertain })).filter((x) => x.company || x.name);
        if (!list.length) { fill(imgStatus, h('div', { class: 'notice notice-error' }, '一覧を読み取れませんでした。表がはっきり写った画像でお試しいただくか、文字を貼り付けてください。')); return; }
        fill(imgStatus, h('div', { class: 'notice notice-info small' }, `${list.length}行を読み取りました。次の表で、画像と見比べて確認してください。`));
        rows = []; addRows(list); renderTable();
        return;
      } catch (e) {
        if (e?.code === 'cancelled') return;
        fill(imgStatus, h('div', { class: 'notice notice-warn small' }, `Claudeで読み取れなかったため（コード: ${e?.code || '不明'}）、端末内で読み取ります。`));
      }
    }
    // 端末内で読み取り、結果は貼り付け欄に入れて利用者に整えてもらう（表の列の判定は推測しない）
    fill(imgStatus, imgStatus.firstChild, loading('端末内で文字を読み取っています…'));
    try {
      const w = await getTessWorker();
      const { data } = await w.recognize(img.blob, {}, { text: true });
      const text = String(data.text || '').split('\n').map((l) => cleanText(l)).filter(Boolean).join('\n');
      textarea.value = text;
      fill(imgStatus, h('div', { class: 'notice notice-warn small' }, [why ? `${why} ` : '', '端末内で読み取った文字を上の欄に入れました。端末内の読み取りでは表の列を正確に判定できないため、「企業名」と「名前」の間に全角スペースを入れるなど整えてから「表に分ける」を押してください。']));
    } catch (e) {
      fill(imgStatus, h('div', { class: 'notice notice-error' }, `画像を読み取れませんでした（${e?.message || e}）。メモアプリから文字をコピーして貼り付けてください。`));
    }
  }

  /** 1行の詳細編集（通常の登録画面と同じ項目） */
  async function editRow(r, onSaved) {
    const ex = ensureExtra(r);
    const name = textField('name', '名前', { value: r.name, maxlength: 100, placeholder: '空欄にすると企業のみの登録になります' });
    const kana = kanaField('nameKana', '読み（任意）', () => name.value || company.value, ex.nameKana);
    const company = textField('companyName', '企業名', { value: r.company, maxlength: 100, hint: '登録済みの企業に紐付けるかどうかは、表の「企業の扱い」で選びます。' });
    const dept = textField('department', '部署（任意）', { value: ex.department, maxlength: 100 });
    const title = textField('title', '役職（任意）', { value: ex.title, maxlength: 100 });
    const autoCb = h('input', { type: 'checkbox', checked: ex.receiptName == null || ex.receiptName === '', id: 'bulk-receipt-auto' });
    const receipt = textField('receiptName', '領収証宛名', { value: rowReceipt(r), maxlength: 200 });
    const syncReceipt = () => { if (autoCb.checked) receipt.value = receiptFor(company.value, name.value); receipt.input.readOnly = autoCb.checked; receipt.input.classList.toggle('readonly', autoCb.checked); };
    autoCb.addEventListener('change', syncReceipt);
    name.input.addEventListener('input', syncReceipt);
    company.input.addEventListener('input', syncReceipt);
    receipt.wrap.append(h('label', { class: 'check small', for: 'bulk-receipt-auto' }, [autoCb, ' 一覧の設定（共通の「領収証宛名の書き方」）で自動作成する']));
    const gp = groupPicker(ex.groupIds);
    const common = groups.value();
    const kw = textField('keywords', 'キーワード（任意）', { value: ex.keywords, maxlength: 1000, hint: keywords.value.trim() ? `共通のキーワード「${tidyKeywords(keywords.value)}」も付きます。` : '複数ある場合は「,」や「、」で区切ってください。' });
    const memo = textField('memo', 'メモ（任意）', { multiline: true, value: ex.memo, maxlength: 100000 });
    syncReceipt();
    const v = await dialog({
      title: `${r.name || r.company || '新しい行'} の詳細`,
      body: [
        h('div', { class: 'grid-2' }, [name.wrap, kana.wrap]),
        company.wrap,
        h('div', { class: 'grid-2' }, [dept.wrap, title.wrap]),
        receipt.wrap,
        gp.wrap,
        common.length ? h('p', { class: 'small muted' }, ['共通のグループ ', groupChips(common, { small: true }), ' も付きます。']) : null,
        kw.wrap,
        memo.wrap,
        h('p', { class: 'small muted' }, 'まだ登録はされません。「③ 確認へ進む」の確認画面で内容を確かめてから登録します。'),
      ],
      buttons: [{ label: 'キャンセル', value: null }, { label: 'この内容にする', kind: 'primary', value: () => ({
        name: cleanLine(name.value), company: cleanLine(company.value), nameKana: cleanLine(kana.value), department: cleanLine(dept.value), title: cleanLine(title.value),
        receiptName: autoCb.checked ? null : cleanLine(receipt.value), keywords: tidyKeywords(clean(kw.value)), memo: clean(memo.value), groupIds: gp.value(),
      }) }],
    });
    gp.cleanup?.();
    if (!v) return;
    if (v.company !== r.company) r.link = 'auto';
    r.name = v.name; r.company = v.company;
    Object.assign(ex, { nameKana: v.nameKana, department: v.department, title: v.title, receiptName: v.receiptName, keywords: v.keywords, memo: v.memo, groupIds: v.groupIds });
    if (r.uncertain && !hasUnknown(r.company) && !hasUnknown(r.name) && r.company && r.name) { r.uncertain = false; if (!r.note.includes('同じ企業に同じ名前')) r.note = ''; }
    onSaved();
  }
  /** 行の追加情報の要約（表と確認画面で使う） */
  function extraSummary(r, { full = false } = {}) {
    const ex = r.extra || {};
    const items = [];
    const gs = rowGroups(r);
    if (gs.length) items.push(groupChips(gs, { small: true }));
    if (ex.nameKana) items.push(h('span', { class: 'xtag' }, `読み: ${ex.nameKana}`));
    if (ex.department || ex.title) items.push(h('span', { class: 'xtag' }, [ex.department, ex.title].filter(Boolean).join(' ')));
    if (ex.receiptName) items.push(h('span', { class: 'xtag' }, '宛名: 手入力'));
    if (ex.keywords) items.push(h('span', { class: 'xtag' }, `キーワード: ${ex.keywords}`));
    if (ex.memo) items.push(h('span', { class: 'xtag', title: ex.memo }, full ? `メモ: ${ex.memo.length > 30 ? `${ex.memo.slice(0, 30)}…` : ex.memo}` : 'メモあり'));
    return items.length ? h('div', { class: 'xsummary' }, items) : null;
  }

  // ---------- ② 表で修正 ----------
  function renderTable() {
    stage = 'table';
    const tbody = h('tbody');
    const counter = h('span', { class: 'small muted' });
    const refresh = () => {
      fill(tbody, rows.map((r, i) => rowEl(r, i)));
      counter.textContent = `${rows.filter((r) => r.include).length} / ${rows.length}行を登録`;
    };
    function rowEl(r, i) {
      const a = analyze(r);
      const company = h('input', { class: 'input', type: 'text', value: r.company, 'aria-label': `${i + 1}行目の企業名`, maxlength: 100 });
      const name = h('input', { class: 'input', type: 'text', value: r.name, 'aria-label': `${i + 1}行目の名前`, maxlength: 100 });
      company.classList.toggle('has-unknown', hasUnknown(r.company));
      name.classList.toggle('has-unknown', hasUnknown(r.name));
      const edited = () => { if (r.uncertain && !hasUnknown(r.company) && !hasUnknown(r.name) && r.company && r.name) { r.uncertain = false; r.note = r.note.includes('同じ企業に同じ名前') ? r.note : ''; } };
      company.addEventListener('change', () => { r.company = cleanLine(company.value); r.link = 'auto'; edited(); refresh(); });
      name.addEventListener('change', () => { r.name = cleanLine(name.value); edited(); refresh(); });
      const inc = h('input', { type: 'checkbox', checked: r.include, 'aria-label': `${i + 1}行目を登録する` });
      inc.addEventListener('change', () => { r.include = inc.checked; refresh(); });
      // 企業の扱い
      let linkCtl = null;
      if (r.company && a.cands.length) {
        linkCtl = h('select', { class: 'input input-sm', 'aria-label': `${i + 1}行目の企業の扱い` }, [
          ...a.cands.map((c) => h('option', { value: c.id }, `登録済み「${c.name}」に紐付け（${c.id}・${c.reason}）`)),
          h('option', { value: 'new' }, '新しい企業として登録'),
        ]);
        linkCtl.value = a.linkId || 'new';
        linkCtl.addEventListener('change', () => { r.link = linkCtl.value; refresh(); });
      }
      const notes = [];
      const unk = hasUnknown(r.company) || hasUnknown(r.name);
      if (r.uncertain || r.note || unk) notes.push(h('span', { class: 'badge badge-warn' }, '要確認'));
      if (unk) notes.push(h('span', { class: 'small warn-text' }, ['読めなかった文字があります: ', markUnknown([r.company, r.name].filter(hasUnknown).join(' ／ ')), '。正しい文字に直してください']));
      if (r.note) notes.push(h('span', { class: 'small warn-text' }, r.note));
      if (!r.name) notes.push(h('span', { class: 'small warn-text' }, '名前が空です（企業のみとして登録します）'));
      if (!r.company) notes.push(h('span', { class: 'small muted' }, '企業名なし（個人のみとして登録します）'));
      if (a.dupPersons.length) notes.push(h('span', { class: 'small warn-text' }, `同じ名前の登録情報あり: ${a.dupPersons.map((p) => `${p.name}（${p.companyName || '企業なし'}）`).join('、')}`));
      return h('tr', { class: r.include ? '' : 'row-excluded' }, [
        h('td', { 'data-label': '登録' }, inc),
        h('td', { 'data-label': '企業名' }, [company, linkCtl]),
        h('td', { 'data-label': '名前' }, [name, extraSummary(r)]),
        h('td', { 'data-label': '状態' }, h('div', { class: 'bulk-notes' }, notes.length ? notes : h('span', { class: 'small muted' }, '—'))),
        h('td', { class: 'actions' }, [
          h('button', { type: 'button', class: 'btn btn-xs btn-edit', title: '読み・部署・役職・領収証宛名・グループ・キーワード・メモを入力します', onclick: () => editRow(r, refresh) }, '詳細を編集'),
          i > 0 ? h('button', { type: 'button', class: 'btn btn-xs', title: '上の行とつなげて1行にします', onclick: () => {
            const up = rows[i - 1];
            up.company = cleanLine(`${up.company} ${r.company}`); up.name = cleanLine(`${up.name} ${r.name}`); up.link = 'auto';
            if (up.company && up.name) { up.uncertain = false; up.note = ''; }
            rows.splice(i, 1); refresh();
          } }, '上と結合') : null,
          h('button', { type: 'button', class: 'btn btn-xs btn-danger-ghost', onclick: () => { rows.splice(i, 1); refresh(); } }, '削除'),
        ]),
      ]);
    }
    fill(root,
      h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [h('h2', { class: 'card-title' }, '② 内容を修正する'), counter]),
        h('p', { class: 'small muted' }, '行ごとに企業名と名前を直せます。読み・部署・役職・領収証宛名・グループ・キーワード・メモは「詳細を編集」で入力できます（通常の登録画面と同じ項目）。2行に分かれてしまった項目は「上と結合」でつなげてください。登録しない行はチェックを外します。'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table bulk-table' }, [h('thead', {}, h('tr', {}, ['登録', '企業名', '名前', '状態', ''].map((x) => h('th', {}, x)))), tbody])),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { rows.push({ key: ++seq, include: true, company: '', name: '', uncertain: false, note: '', link: 'auto' }); refresh(); } }, '＋ 行を追加')),
      ]),
      err,
      h('div', { class: 'form-actions' }, [
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: renderInput }, '← 貼り付けに戻る'),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => {
          showErr('');
          const targets = rows.filter((r) => r.include);
          if (!targets.length) { showErr('登録する行がありません。登録する行にチェックを入れてください。'); return; }
          const bad = targets.find((r) => !r.company && !r.name);
          if (bad) { showErr('企業名も名前も空の行があります。削除するか入力してください。'); return; }
          renderConfirm();
        } }, '③ 確認へ進む'),
      ]),
    );
    refresh();
  }

  // ---------- ③ 確認 ----------
  function plan() {
    const targets = rows.filter((r) => r.include);
    const newCompanies = new Map(); // 正規化名 → 表示名（同じ一覧内の同名は1社にまとめる）
    const items = targets.map((r) => {
      const a = analyze(r);
      let companyAction = 'none'; let companyLabel = '';
      if (r.company) {
        if (a.linkId) { companyAction = 'existing'; companyLabel = `登録済み（${a.linkId}）に紐付け`; } else {
          companyAction = 'new'; companyLabel = '新しく作成';
          const k = normalize(r.company);
          if (!newCompanies.has(k)) newCompanies.set(k, r.company);
        }
      }
      return { r, a, companyAction, companyLabel, receipt: rowReceipt(r) };
    });
    // 同じ一覧の中で同じ新しい企業を使う行には、その旨を表示
    const countByKey = new Map();
    for (const x of items) if (x.companyAction === 'new') { const k = normalize(x.r.company); countByKey.set(k, (countByKey.get(k) || 0) + 1); }
    for (const x of items) if (x.companyAction === 'new') { const c = countByKey.get(normalize(x.r.company)); if (c > 1) x.companyLabel = `新しく作成（この一覧の${c}行で共通の1社）`; }
    return { items, newCompanies, excluded: rows.length - targets.length };
  }
  function renderConfirm() {
    stage = 'confirm';
    const p = plan();
    const persons = p.items.filter((x) => x.r.name).length;
    const companyOnly = p.items.filter((x) => !x.r.name).length;
    const linked = p.items.filter((x) => x.companyAction === 'existing').length;
    const isWarn = (x) => x.r.uncertain || x.a.dupPersons.length || hasUnknown(x.r.company) || hasUnknown(x.r.name);
    const warn = p.items.filter(isWarn);
    const unknownRows = p.items.filter((x) => hasUnknown(x.r.company) || hasUnknown(x.r.name));
    const check = h('input', { type: 'checkbox', id: 'bulk-confirm' });
    const unknownCount = p.items.filter((x) => hasUnknown(x.r.company) || hasUnknown(x.r.name)).length;
    const regBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', disabled: true, onclick: () => run(p) }, `④ ${p.items.length}件を登録する`);
    check.addEventListener('change', () => { regBtn.disabled = !check.checked; });
    fill(root,
      h('section', { class: 'card confirm-card' }, [
        h('h2', { class: 'card-title' }, '③ 登録内容の確認'),
        h('p', {}, 'まだ登録されていません。以下の内容で問題ないか確認してください。'),
        h('div', { class: 'stats stats-4' }, [
          h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(persons)), h('div', { class: 'stat-label' }, '登録する人物')]),
          h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(p.newCompanies.size)), h('div', { class: 'stat-label' }, '新しく作る企業')]),
          h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(linked)), h('div', { class: 'stat-label' }, '登録済み企業に紐付け')]),
          h('div', { class: 'stat' }, [h('div', { class: 'stat-num' }, String(p.excluded)), h('div', { class: 'stat-label' }, '登録しない行')]),
        ]),
        companyOnly ? h('p', { class: 'small' }, `名前が空の${companyOnly}行は、企業のみとして登録します。`) : null,
        warn.length ? h('div', { class: 'notice notice-warn' }, [
          h('p', {}, `要確認の行が${warn.length}件あります（表の「要確認」）。このまま登録してよいか確認してください。`),
          unknownRows.length ? h('p', {}, h('strong', {}, `うち${unknownRows.length}件に、画像から読めなかった文字「?」が残っています。そのまま登録すると「?」のまま保存されます。`)) : null,
        ]) : null,
        h('p', { class: 'small muted' }, ['共通キーワード: ', tidyKeywords(keywords.value) || '（なし）', '　グループ: ', groupChips(groups.value(), { small: true, empty: '（なし）' })]),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [
          h('thead', {}, h('tr', {}, ['', '企業名', '企業の扱い', '名前', '領収証宛名', 'グループ・メモなど'].map((x) => h('th', {}, x)))),
          h('tbody', {}, p.items.map((x, i) => h('tr', {}, [
            h('td', { 'data-label': 'No.' }, [String(i + 1), isWarn(x) ? h('span', { class: 'badge badge-warn' }, '要確認') : null]),
            h('td', { 'data-label': '企業名' }, x.r.company ? markUnknown(x.r.company) : h('span', { class: 'muted' }, '（なし）')),
            h('td', { 'data-label': '企業の扱い' }, x.companyLabel || '—'),
            h('td', { 'data-label': '名前' }, x.r.name ? markUnknown(x.r.name) : h('span', { class: 'muted' }, '（企業のみ）')),
            h('td', { 'data-label': '領収証宛名' }, markUnknown(x.receipt)),
            h('td', { 'data-label': 'グループ・メモなど' }, [extraSummary(x.r, { full: true }) || h('span', { class: 'muted' }, '—'), (!x.r.name && x.companyAction === 'existing' && (x.r.extra?.memo || x.r.extra?.keywords)) ? h('div', { class: 'small warn-text' }, '登録済みの企業には、グループだけを追加します（メモ・キーワードは企業の画面で編集してください）') : null]),
          ]))),
        ])),
        h('label', { class: 'check ocr-confirm' }, [check, unknownCount ? ` 上の内容を確認しました（「?」が残っている${unknownCount}件も、このまま登録します）` : ' 上の内容を確認しました（企業名・名前・企業の扱い・領収証宛名・グループ・メモなど）']),
      ]),
      err,
      h('div', { class: 'form-actions' }, [h('button', { type: 'button', class: 'btn btn-ghost', onclick: renderTable }, '← 戻って修正する'), regBtn]),
    );
    root.scrollIntoView({ block: 'start' });
  }

  // ---------- ④ 登録 ----------
  async function run(p) {
    stage = 'saving';
    const kw = tidyKeywords(keywords.value);
    const gids = groups.value();
    const progress = h('p', {}, '登録しています…');
    fill(root, h('section', { class: 'card' }, [h('h2', { class: 'card-title' }, '④ 登録中'), loading('登録しています。画面を閉じないでください。'), progress]));
    const createdCompany = new Map(); // 正規化名 → 新しい企業ID
    const done = []; const failed = [];
    let n = 0;
    for (const x of p.items) {
      n++;
      progress.textContent = `${n} / ${p.items.length}件目`;
      try {
        let companyId = null;
        if (x.companyAction === 'existing') companyId = x.a.linkId;
        else if (x.companyAction === 'new') {
          const k = normalize(x.r.company);
          companyId = createdCompany.get(k) || null;
          if (!companyId) {
            const onlyCompany = !x.r.name;
            const c = await createCompany({
              name: x.r.company, nameKana: onlyCompany ? (x.r.extra?.nameKana || '') : '',
              keywords: onlyCompany ? rowKeywords(x.r) : kw,
              receiptName: onlyCompany ? x.receipt : (receiptFmt.value === 'company-onchu' ? `${cleanLine(x.r.company)} 御中` : `${cleanLine(x.r.company)} 様`),
              memo: onlyCompany ? (x.r.extra?.memo || '') : '',
              confirmDuplicate: true, groupIds: onlyCompany ? rowGroups(x.r) : [],
            });
            companyId = c.id; createdCompany.set(k, companyId);
          }
        }
        if (x.r.name) {
          const ex = x.r.extra || {};
          const r = await createPerson({
            name: x.r.name, nameKana: ex.nameKana || '', department: ex.department || '', title: ex.title || '',
            keywords: rowKeywords(x.r), receiptName: x.receipt, memo: ex.memo || '',
            company: companyId ? { mode: 'existing', id: companyId } : { mode: 'none' }, groupIds: rowGroups(x.r), confirmDuplicate: true,
          });
          done.push({ type: 'person', id: r.id, label: `${x.r.name}（${x.r.company || '企業なし'}）` });
        } else {
          if (companyId && x.companyAction === 'existing') for (const g of rowGroups(x.r)) await setMembership('company', companyId, g, true);
          done.push({ type: 'company', id: companyId, label: x.r.company });
        }
        x.r.include = false; // 登録済みの行は、失敗時に戻ったとき二重登録しないよう外す
        x.r.note = '登録済み';
      } catch (e) {
        failed.push({ label: `${x.r.name || ''}（${x.r.company || '企業なし'}）`, message: dbErrorMessage(e) });
        break; // 以降は止めて状況を知らせる
      }
    }
    stage = 'done';
    rows = rows.filter((r) => r.note !== '登録済み');
    fill(root, h('section', { class: 'card' }, [
      h('h2', { class: 'card-title' }, failed.length ? '登録が途中で止まりました' : '登録しました'),
      h('p', {}, `${done.length}件を登録しました。`),
      failed.length ? h('div', { class: 'notice notice-error', role: 'alert' }, [
        h('p', {}, `「${failed[0].label}」で止まりました: ${failed[0].message}`),
        h('p', { class: 'small' }, `残りの${rows.filter((r) => r.include).length}件は登録されていません。「残りを確認する」から続きを登録できます（登録済みの行は表から外してあります）。`),
      ]) : null,
      done.length ? h('ul', { class: 'history' }, done.slice(0, 50).map((d) => h('li', {}, h('button', { type: 'button', class: 'linkish', onclick: () => go(d.type, { id: d.id }) }, d.label)))) : null,
      h('div', { class: 'form-actions' }, [
        failed.length ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: renderTable }, '残りを確認する') : null,
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { rows = []; textarea.value = ''; renderInput(); } }, '別の一覧を登録する'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => onDone(kw) }, '検索画面で確認する'),
      ]),
    ]));
    if (done.length) toast(`${done.length}件を登録しました`, 'success');
  }

  renderInput();
  return {
    el: root,
    cleanup: groups.cleanup,
    isDirty: () => stage === 'saving' || ((stage === 'table' || stage === 'confirm') && rows.length > 0) || (stage === 'input' && !!textarea.value.trim()),
  };
}
