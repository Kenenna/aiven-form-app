const express = require('express');
const VERSION = 'v1';
const CATS = ['misconception', 'partial', 'correct', 'invalid'];
const CODEBOOK = {
  FNM: [['FNM-01', 'Sabit hızda hareket için sürekli kuvvet gerekir'], ['FNM-02', 'Ağır cisimler daha hızlı düşer'],
        ['FNM-03', 'Kuvvet yoksa cisim hemen durur'], ['FNM-04', 'Sürtünme her zaman zararlıdır'],
        ['FNM-05', 'Etki ve tepki kuvvetleri aynı cisme etki eder']],
  CR:  [['CR-01', 'Bitkiler hücresel solunum yapmaz'], ['CR-02', 'Hücresel solunum, nefes alıp vermeyle aynıdır'],
        ['CR-03', 'Enerji yoktan var edilir / üretilir'], ['CR-04', 'Yalnızca hayvanlar hücresel solunum yapar']]
};
const kappa = (x, y) => {
  const n = x.length; if (!n) return null;
  const po = x.filter((v, i) => v === y[i]).length / n;
  const pe = [...new Set([...x, ...y])].reduce((s, c) => s + (x.filter(v => v === c).length / n) * (y.filter(v => v === c).length / n), 0);
  return pe === 1 ? 1 : +((po - pe) / (1 - pe)).toFixed(3);
};
const esc = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;

module.exports = pool => {
  const r = express.Router();
  const fail = (res, e) => { console.error(e); res.status(500).json({ error: 'Sunucu hatası.' }); };
  const auth = async (req, res, next) => {
    try {
      const [rows] = await pool.query('SELECT annotator_id, role FROM annotators WHERE token = ?',
        [String(req.get('x-token') || '').trim().toUpperCase()]);
      if (!rows.length) return res.status(401).json({ error: 'Giriş kodu geçersiz.' });
      req.user = rows[0]; next();
    } catch (e) { fail(res, e); }
  };
  const need = role => (req, res, next) => req.user.role === role ? next() : res.status(403).json({ error: 'Yetkin yok.' });
  const raters = async () => (await pool.query("SELECT annotator_id FROM annotators WHERE role='annotator' ORDER BY annotator_id"))[0].map(x => x.annotator_id);

  r.get('/me', auth, (req, res) => res.json(req.user));

  r.get('/next', auth, need('annotator'), async (req, res) => {
    try {
      const id = req.user.annotator_id;
      const [[tot]] = await pool.query("SELECT COUNT(*) n FROM responses WHERE answer_text <> ''");
      const [[done]] = await pool.query('SELECT COUNT(*) n FROM annotations WHERE annotator_id = ?', [id]);
      const [rows] = await pool.query(
        `SELECT r.response_id, r.answer_text, q.question_text, q.domain FROM responses r
         JOIN questions q ON q.item_code = r.item_code
         WHERE r.answer_text <> '' AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.response_id = r.response_id AND a.annotator_id = ?)
         ORDER BY CRC32(CONCAT(r.response_id, 's')) LIMIT 1`, [id]);
      const item = rows[0] ? { ...rows[0], codes: CODEBOOK[rows[0].domain] } : null;
      res.json({ item, done: done.n, total: tot.n });
    } catch (e) { fail(res, e); }
  });

  r.get('/adjudicate/next', auth, need('adjudicator'), async (req, res) => {
    try {
      const [a, b] = await raters();
      const [rows] = await pool.query(
        `SELECT r.response_id, r.answer_text, q.question_text, q.domain,
                a1.category c1, a1.codes k1, a1.unsure u1, a1.language_only l1,
                a2.category c2, a2.codes k2, a2.unsure u2, a2.language_only l2
         FROM responses r JOIN questions q ON q.item_code = r.item_code
         JOIN annotations a1 ON a1.response_id = r.response_id AND a1.annotator_id = ?
         JOIN annotations a2 ON a2.response_id = r.response_id AND a2.annotator_id = ?
         WHERE NOT EXISTS (SELECT 1 FROM annotations f WHERE f.response_id = r.response_id AND f.is_final = 1)
           AND (a1.category <> a2.category OR COALESCE(a1.codes,'') <> COALESCE(a2.codes,'') OR MOD(CRC32(r.response_id), 10) = 0)
         ORDER BY r.response_id LIMIT 1`, [a, b]);
      const x = rows[0];
      const item = x ? { ...x, codes: CODEBOOK[x.domain], disagree: x.c1 !== x.c2 || (x.k1 || '') !== (x.k2 || ''), raters: [a, b] } : null;
      res.json({ item, done: 0, total: 0 });
    } catch (e) { fail(res, e); }
  });

  const save = isFinal => async (req, res) => {
    try {
      const { response_id, category, notes } = req.body;
      if (!CATS.includes(category)) return res.status(400).json({ error: 'Kategori seç.' });
      const [d] = await pool.query('SELECT q.domain FROM responses r JOIN questions q ON q.item_code = r.item_code WHERE r.response_id = ?', [response_id]);
      if (!d.length) return res.status(404).json({ error: 'Yanıt bulunamadı.' });
      const allowed = CODEBOOK[d[0].domain].map(c => c[0]);
      const codes = (category === 'correct' || category === 'invalid') ? [] : [...new Set(req.body.codes || [])].filter(c => allowed.includes(c)).sort();
      if (category === 'misconception' && !codes.length) return res.status(400).json({ error: 'En az bir kod seç.' });
      await pool.query(
        `INSERT INTO annotations (response_id, annotator_id, category, codes, notes, is_final, codebook_version, unsure, language_only)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE category=VALUES(category), codes=VALUES(codes), notes=VALUES(notes), is_final=VALUES(is_final),
           codebook_version=VALUES(codebook_version), unsure=VALUES(unsure), language_only=VALUES(language_only), annotated_at=NOW()`,
        [response_id, req.user.annotator_id, category, codes.join(';') || null, String(notes || '').slice(0, 1000) || null,
         isFinal ? 1 : 0, VERSION, req.body.unsure ? 1 : 0, req.body.language_only ? 1 : 0]);
      res.json({ success: true });
    } catch (e) { fail(res, e); }
  };
  r.post('/label', auth, need('annotator'), save(false));
  r.post('/final', auth, need('adjudicator'), save(true));

  const all = async () => {
    const [a, b] = await raters();
    const [rows] = await pool.query(
      `SELECT r.response_id, r.item_code, q.target_code, q.domain, s.school, s.grp, s.grade, r.answer_text,
              a1.category c1, a1.codes k1, a2.category c2, a2.codes k2, f.category cf, f.codes kf
       FROM responses r JOIN questions q ON q.item_code = r.item_code JOIN students s ON s.sid = r.sid
       LEFT JOIN annotations a1 ON a1.response_id = r.response_id AND a1.annotator_id = ?
       LEFT JOIN annotations a2 ON a2.response_id = r.response_id AND a2.annotator_id = ?
       LEFT JOIN annotations f  ON f.response_id  = r.response_id AND f.is_final = 1
       ORDER BY r.response_id`, [a, b]);
    return rows;
  };

  r.get('/agreement', auth, need('adjudicator'), async (req, res) => {
    try {
      const pairs = (await all()).filter(x => x.c1 && x.c2);
      const set = k => (k || '').split(';').filter(Boolean);
      const perCode = {};
      Object.values(CODEBOOK).flat().forEach(([c]) => {
        const p = pairs.filter(x => (x.domain === (c.startsWith('FNM') ? 'FNM' : 'CR')));
        perCode[c] = { n: p.length, kappa: kappa(p.map(x => String(set(x.k1).includes(c))), p.map(x => String(set(x.k2).includes(c)))) };
      });
      res.json({ pairs: pairs.length, kappa_category: kappa(pairs.map(x => x.c1), pairs.map(x => x.c2)), per_code: perCode, target: 0.75 });
    } catch (e) { fail(res, e); }
  });

  r.get('/export', auth, need('adjudicator'), async (req, res) => {
    try {
      const head = ['response_id','item_code','target_code','domain','school','grp','grade','answer_text','cat_1','codes_1','cat_2','codes_2','final_source','final_category','final_codes'];
      const lines = (await all()).map(x => {
        const blank = !String(x.answer_text).trim();
        const agreed = x.c1 && x.c2 && x.c1 === x.c2 && (x.k1 || '') === (x.k2 || '');
        const [src, cat, k] = x.cf ? ['adjudicated', x.cf, x.kf] : blank ? ['blank', 'invalid', ''] : agreed ? ['agreed', x.c1, x.k1] : ['pending', '', ''];
        return [x.response_id, x.item_code, x.target_code, x.domain, x.school, x.grp, x.grade, x.answer_text, x.c1, x.k1, x.c2, x.k2, src, cat, k].map(esc).join(',');
      });
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="labels.csv"' });
      res.send('\uFEFF' + [head.join(','), ...lines].join('\n'));
    } catch (e) { fail(res, e); }
  });

  return r;
};
