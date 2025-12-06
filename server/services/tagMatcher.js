const AhoCorasick = require('ahocorasick');

/**
 * 在给定文本中查找标签名，并统计出现次数（大小写不敏感）。
 * 返回的每个标签对象都带有 match_count 字段用于排序。
 * @param {string} text - 要搜索的文本
 * @param {Array<{id:number,name:string,color:string}>} allTags - 全量标签
 * @returns {Array<{id:number,name:string,color:string,match_count:number}>}
 */
const findMatchingTags = (text, allTags) => {
  try {
    if (!text || !allTags || allTags.length === 0) return [];

    // 大小写不敏感：统一转小写
    const lowerText = String(text).toLowerCase();
    const nameToTag = new Map();
    const keys = [];
    for (const t of allTags) {
      const k = String(t.name || '').toLowerCase();
      if (!k) continue;
      nameToTag.set(k, t);
      keys.push(k);
    }
    if (keys.length === 0) return [];

    const ac = new AhoCorasick(keys);
    const results = ac.search(lowerText) || [];

    // 统计次数：Aho-Corasick 返回 [endIndex, [keywords]]，这里对每个命中的 keyword 计数
    const counter = new Map();
    for (const r of results) {
      const kws = Array.isArray(r[1]) ? r[1] : [];
      for (const kw of kws) {
        counter.set(kw, (counter.get(kw) || 0) + 1);
      }
    }

    // 组装结果并按出现次数降序、名称升序排序
    const out = [];
    for (const [k, cnt] of counter.entries()) {
      const tag = nameToTag.get(k);
      if (tag && cnt > 0) out.push({ ...tag, match_count: cnt });
    }
    out.sort((a, b) => {
      if (b.match_count !== a.match_count) return b.match_count - a.match_count;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return out;
  } catch (e) {
    try { console.warn('[tagMatcher] findMatchingTags error:', e && e.message || e); } catch(_) {}
    return [];
  }
};

module.exports = {
  findMatchingTags,
};
