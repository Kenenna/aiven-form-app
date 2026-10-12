const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'form_db',
    ssl: { ca: fs.readFileSync(path.join(__dirname, 'ca.pem')) },
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5
});

const normalise = code => String(code || '').trim().toUpperCase();

async function findStudent(entryCode) {
    const [rows] = await pool.query('SELECT sid, school, grp, submitted_at FROM students WHERE entry_code = ?', [entryCode]);
    return rows[0] || null;
}

// 1. Log in with an entry code and fetch only this student's questions
app.post('/api/login', async (req, res) => {
    const entryCode = normalise(req.body.entry_code);
    if (!entryCode) return res.status(400).json({ error: 'Giriş kodu gerekli.' });

    try {
        const student = await findStudent(entryCode);
        if (!student) return res.status(404).json({ error: 'Geçersiz giriş kodu.' });
        if (student.submitted_at) return res.status(403).json({ error: 'Bu kodla yanıtlar zaten gönderilmiş.' });

        const [questions] = await pool.query(
            `SELECT si.item_number, si.item_code, q.question_text
             FROM student_items si JOIN questions q ON q.item_code = si.item_code
             WHERE si.sid = ? ORDER BY si.item_number`, [student.sid]);

        // target_code is deliberately not sent to the browser
        res.json({ success: true, questions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Veritabanı hatası.' });
    }
});

// 2. Submit answers (entry code is re-checked, so a sid alone cannot be spoofed)
app.post('/api/submit', async (req, res) => {
    const entryCode = normalise(req.body.entry_code);
    const responses = req.body.responses;
    if (!entryCode || !responses || typeof responses !== 'object') {
        return res.status(400).json({ error: 'Eksik veri.' });
    }

    const conn = await pool.getConnection();
    try {
        const [students] = await conn.query('SELECT sid, submitted_at FROM students WHERE entry_code = ?', [entryCode]);
        if (!students.length) return res.status(404).json({ error: 'Geçersiz giriş kodu.' });
        const { sid, submitted_at } = students[0];
        if (submitted_at) return res.status(403).json({ error: 'Bu kodla yanıtlar zaten gönderilmiş.' });

        const [assigned] = await conn.query('SELECT item_code FROM student_items WHERE sid = ?', [sid]);
        const allowed = new Set(assigned.map(r => r.item_code));

        const rows = [...allowed].map(code => [sid, code, String(responses[code] ?? '').trim().slice(0, 2000)]);

        await conn.beginTransaction();
        await conn.query(
            'INSERT INTO responses (sid, item_code, answer_text) VALUES ? ON DUPLICATE KEY UPDATE answer_text = VALUES(answer_text)',
            [rows]);
        await conn.query('UPDATE students SET submitted_at = NOW() WHERE sid = ?', [sid]);
        await conn.commit();

        res.json({ success: true, message: 'Yanıtların kaydedildi. Teşekkürler!' });
    } catch (err) {
        await conn.rollback().catch(() => {});
        console.error(err);
        res.status(500).json({ error: 'Kayıt sırasında hata oluştu.' });
    } finally {
        conn.release();
    }
});

app.use('/api/ann', require('./annotate_routes')(pool));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
