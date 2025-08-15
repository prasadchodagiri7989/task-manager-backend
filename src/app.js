import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import taskRoutes from './routes/tasks.js';

const app = express();

app.use(express.json());
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));

const allowPreviewVercel = true;

// Allow localhost + your prod frontend + (optionally) any *.vercel.app preview
const whitelist = [
  'http://localhost:8081',
  process.env.FRONTEND_ORIGIN, // e.g. https://task-mng-flow.vercel.app
].filter(Boolean);

const corsOptions = {
  credentials: true,
  origin(origin, cb) {
    // SSR / server-to-server / curl (no origin) -> allow
    if (!origin) return cb(null, true);

    const isWhitelisted = whitelist.includes(origin);
    const isVercelPreview =
      allowPreviewVercel && /\.vercel\.app$/.test(origin);

    if (isWhitelisted || isVercelPreview) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
};

app.use(cors(corsOptions));
// Optional: respond to preflight quickly
app.options('*', cors(corsOptions));

app.get('/', (req, res) => res.send('Task Manager API is running'));

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/tasks', taskRoutes);

export default app;
