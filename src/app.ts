import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import authRoutes from './auth/authRoutes.js';
import studentRoutes from './students/studentRoutes.js';
import quizRoutes from './quizzes/quizRoutes.js';
import adminRoutes from './admin/adminRoutes.js';
import panelRoutes from './panel/panelRoutes.js';
import metaRoutes from './meta/metaRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// Trust reverse proxy (Nginx) so client IP and protocols are correctly identified
app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or Postman)
      if (!origin) return callback(null, true);
      // Explicitly allow local test origins (localhost:5173, localhost:5000, 127.0.0.1) & Vercel
      if (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('0.0.0.0') ||
        origin.endsWith('.vercel.app')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Disposition'],
  })
);

app.options('*', cors());

// High-performance gzip response compression for all API endpoints
app.use(
  compression({
    level: 6,
    threshold: 1024, // only compress responses above 1KB
  })
);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/panel', panelRoutes);
app.use('/api/meta', metaRoutes);

// Centralized error handler
app.use(errorHandler);

export default app;
