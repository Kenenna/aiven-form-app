const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Create Aiven Database Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER || 'avnadmin',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'form_db',
    ssl: {
        ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
    },
    waitForConnections: true,
    connectionLimit: 5
});

// Form Submission Endpoint
app.post('/api/submit', async (req, res) => {
    const { name, email } = req.body;

    if (!name || !email) {
        return res.status(400).json({ error: 'Name and email are required.' });
    }

    try {
        const query = 'INSERT INTO submissions (name, email) VALUES (?, ?)';
        await pool.query(query, [name, email]);
        res.status(200).json({ message: 'Saved to Aiven MySQL!' });
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ error: 'Failed to save data.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
