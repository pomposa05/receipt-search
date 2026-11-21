// 検索サービス: DBの内容から検索索引を作り、変更があれば作り直す（検索エンジン本体は search/engine.js）
import { buildIndex, search } from '../search/engine.js';
import { getReading, onReadingReady } from '../search/reading.js';

export function createSearchService({ companies, persons }) {
  let index = null;
  const invalidate = () => { index = null; };
  onReadingReady(invalidate);

  function getIndex() {
    if (!index) {
      index = buildIndex({
        companies: companies.all(),
        persons: persons.all(),
        companyNameHistory: companies.allHistory(),
      }, getReading);
    }
    return index;
  }

  return {
    invalidate,
    search(q, opts) {
      return search(getIndex(), q, opts);
    },
  };
}
