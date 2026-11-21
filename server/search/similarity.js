// 類似度判定（曖昧検索用）

/**
 * 編集距離（制限付きDamerau-Levenshtein / OSA）: 置換・挿入・削除・隣接入替を1回と数える
 */
export function editDistance(a, b) {
  const s = [...a];
  const t = [...b];
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/**
 * 近似部分一致距離（Sellersのアルゴリズム、隣接入替対応）
 * query が text のどこかの部分文字列と何文字違いで一致するかを返す。
 */
export function substringDistance(query, text) {
  const q = [...query];
  const t = [...text];
  const m = q.length;
  const n = t.length;
  if (!m) return 0;
  if (!n) return m;
  // D[i][j]: q[0..i) と t の j で終わる部分文字列との最小距離（開始位置は自由）
  let prev2 = null;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = q[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && q[i - 1] === t[j - 2] && q[i - 2] === t[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  let best = m;
  for (let j = 0; j <= n; j++) if (prev[j] < best) best = prev[j];
  return best;
}

/**
 * 文字の抜け（脱字）を許した一致: query の文字が text に順番通り現れるか。
 * 一致した場合は {span} (text上の最短区間長) を返す。
 */
export function subsequenceSpan(query, text) {
  const q = [...query];
  const t = [...text];
  if (!q.length || q.length > t.length) return null;
  let best = null;
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== q[0]) continue;
    let qi = 1;
    let j = start + 1;
    for (; j < t.length && qi < q.length; j++) if (t[j] === q[qi]) qi++;
    if (qi === q.length) {
      const span = j - start;
      if (best === null || span < best) best = span;
    }
  }
  return best;
}

/** 検索語の長さから許容する誤字数を決める（短い語ほど厳しく） */
export function allowedErrors(len) {
  if (len >= 11) return 3;
  if (len >= 7) return 2;
  if (len >= 4) return 1;
  return 0;
}
