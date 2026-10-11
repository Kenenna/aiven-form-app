# Aiven MySQL Form App

A Node.js + Express app with a contact form that saves submissions to an Aiven MySQL database.

## Files

- `server.js` — Express backend with the `/api/submit` endpoint
- `public/index.html` — frontend contact form
- `package.json` — dependencies and start script
- `ca.pem` — **you must add this yourself**: download the SSL CA certificate from your Aiven console and place it in this folder (it is not included here for security reasons)

## Run locally

```bash
npm install
export DB_HOST=your-aiven-host.aivencloud.com
export DB_PORT=your-port
export DB_USER=avnadmin
export DB_PASSWORD=your-password
export DB_NAME=form_db
npm start
```

Then open http://localhost:3000

## Database setup

Create the table in your Aiven MySQL database:

```sql
CREATE TABLE submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Deploy to Render (free)

1. Put these files (package.json, server.js, ca.pem, public/index.html) into a GitHub repository.
2. Sign up or log in to Render, click **New +** and choose **Web Service**.
3. Connect your GitHub repository. Environment: **Node**. Plan: **Free**.
4. Add Environment Variables: `DB_HOST`, `DB_PORT`, `DB_USER` (avnadmin), `DB_PASSWORD`, `DB_NAME` (form_db).
5. Click **Create Web Service**.
