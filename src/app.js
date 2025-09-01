import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import taskRoutes from './routes/tasks.js';
import groupRoutes from './routes/groups.js';
import userTasksRoutes from './routes/userTasks.js';
import adminDashboardRoutes from "./routes/adminDashboard.js";

const app = express();

// Middleware
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));

// --- CORS for API routes ---
const whitelist = [
  'http://localhost:8081',
  'http://localhost:8080',
  'https://task-mng-flow.vercel.app',,
  'https://task-manager-united.vercel.app',
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

const corsOptions = {
  credentials: true,
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const isWhitelisted = whitelist.includes(origin);
    if (isWhitelisted) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
};

// Apply CORS to API routes
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- Helmet only for API routes ---
app.use(
  helmet({
    contentSecurityPolicy: true,
    crossOriginEmbedderPolicy: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  })
);

// --- Serve uploads with open CORS, no Helmet ---
app.use('/uploads', cors(), express.static(path.join(path.resolve(), 'uploads')));

// Routes
app.get('/', (req, res) => res.send('Task Manager API is running'));
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/tasks', taskRoutes);
app.use('/groups', groupRoutes);
app.use('/user-tasks', userTasksRoutes);
app.use("/admin/dashboard", adminDashboardRoutes);


export default app;
