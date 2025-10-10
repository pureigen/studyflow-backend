import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import studentRoutes from './routes/students';
import attendanceRoutes from './routes/attendance';
import breakRoutes from './routes/breaks';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// CORS 설정
app.use(cors({
  origin: [
    // 로컬 개발 환경
    'http://localhost:3001',    // admin-ui
    'http://localhost:3004',    // login-ui
    'http://localhost:3002',    // student-dashboard
    'http://localhost:3003',    // parent-ui (향후 추가)
    
    // Vercel 배포 URL들
    'https://studyflow1-chi.vercel.app',     // admin-ui 배포
    'https://studyflow4.vercel.app',         // login-ui 배포 
    'https://studyflow2-neon.vercel.app',    // student-dashboard 배포
    'https://studyflow3.vercel.app' // parent-ui 배포예정
    // ❌ 제거: 'studyflow-backend-seven.vercel.app' <- 백엔드 자신은 origin에 포함하면 안됨
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/breaks', breakRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT
  });
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found', 
    message: `Cannot ${req.method} ${req.url}` 
  });
});

// 에러 핸들러
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('========================================');
  console.log('Available endpoints:');
  console.log('');
  console.log('📌 Authentication:');
  console.log('  POST /api/auth/login');
  console.log('  POST /api/auth/check-username');
  console.log('  POST /api/auth/send-sms');
  console.log('  POST /api/auth/verify-sms');
  console.log('  POST /api/auth/register/admin');
  console.log('  POST /api/auth/register/parent');
  console.log('');
  console.log('📌 Students:');
  console.log('  POST /api/students/verify');
  console.log('  GET  /api/students/:studentId');
  console.log('  POST /api/students/register');
  console.log('');
  console.log('📌 Attendance:');
  console.log('  POST /api/attendance/checkin');
  console.log('  POST /api/attendance/checkout');
  console.log('  GET  /api/attendance/status/:userId');
  console.log('');
  console.log('📌 Breaks:');
  console.log('  POST /api/breaks/request');
  console.log('  POST /api/breaks/return/:requestId');
  console.log('');
  console.log('📌 Health:');
  console.log('  GET  /health');
  console.log('========================================');
});

export default app;