// VAERS Dashboard API — Express over DuckDB (@duckdb/node-api).
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dashboardRoutes from './routes/dashboard.js';
import { initDb, closeDb } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

app.use((req, _res, next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.path}`); next(); });

app.get('/health', (_req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));
app.use('/api', dashboardRoutes);

app.use((err, _req, res, _next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});
app.use('*', (req, res) => res.status(404).json({ error: 'Not Found', path: req.originalUrl }));

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`🚀 VAERS Dashboard API on http://localhost:${PORT}`);
      console.log(`   POST /api/dashboard · POST /api/cases · GET /api/filters/vax-types · GET /api/status`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

start();
