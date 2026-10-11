// Usage: node seed_students.js assignments.csv
// CSV header: SID,Sch,Grp,Itm_1,...,Itm_15   (one row per student, e.g. "1,1,A,Q3,Q6,...")
// Creates the students + student_items rows and writes entry_codes.csv for printing slips.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const makeCode = () => Array.from(crypto.randomBytes(6), b => ALPHABET[b % ALPHABET.length]).join('');

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error('Pass the assignments CSV path.');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(1);

  const pool = await mysql.createPool({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER || 'avnadmin', password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'form_db',
    ssl: { ca: fs.readFileSync(path.join(__dirname, 'ca.pem')) }
  });

  const used = new Set();
  const out = ['sid,school,grp,entry_code'];
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    for (const line of lines) {
      const [sid, sch, grp, ...items] = line.split(',').map(s => s.trim());
      if (items.length !== 15) throw new Error(`Student ${sid}: expected 15 items, got ${items.length}`);
      let code; do { code = makeCode(); } while (used.has(code));
      used.add(code);
      await conn.query('INSERT INTO students (sid, entry_code, school, grp) VALUES (?,?,?,?)', [sid, code, sch, grp]);
      await conn.query('INSERT INTO student_items (sid, item_number, item_code) VALUES ?',
        [items.map((c, i) => [sid, i + 1, c])]);
      out.push(`${sid},${sch},${grp},${code}`);
    }
    await conn.commit();
    fs.writeFileSync('entry_codes.csv', out.join('\n'));
    console.log(`Seeded ${lines.length} students. Codes written to entry_codes.csv`);
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
