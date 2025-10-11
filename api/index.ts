import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from '../src/routes/auth';
import studentRoutes from '../src/routes/students';
import attendanceRoutes from '../src/routes/attendance';
import breakRoutes from '../src/routes/breaks';

dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    'http://localhost:3001',
    'http://localhost:3004',
    'http://localhost:3002',
    'http://localhost:3003',
    'https://studyflow1-chi.vercel.app',
    'https://studyflow4.vercel.app',
    'https://studyflow2-neon.vercel.app',
    'https://studyflow3.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/breaks', breakRoutes);

// ✅ 타입 명시 없이 작성 (JavaScript 스타일)
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ✅ 타입 명시 없이 작성
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`
  });
});

// ✅ 타입 명시 없이 작성
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

export default app;