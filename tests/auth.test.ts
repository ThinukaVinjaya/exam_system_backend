import request from 'supertest';
import app from '../src/app.js';
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { StudentProfile } from '../src/models/StudentProfile.js';

let isDbConnected = false;

describe('Auth Endpoints', () => {
  beforeAll(async () => {
    const mongoUri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/sinhala_quiz_test';
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 });
      isDbConnected = true;
      await User.deleteMany({});
      await StudentProfile.deleteMany({});
    } catch {
      console.warn('MongoDB is offline. Skipping live database integration tests.');
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await mongoose.connection.close();
    }
  });

  it('should register a new student with valid Sinhala profile details', async () => {
    if (!isDbConnected) return;
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'නිරෝෂන් ප්‍රනාන්දු',
        username: 'niroshan',
        password: 'password123',
        school: 'ආනන්ද විද්‍යාලය',
        grade: 11,
        provinceId: 'western',
        districtId: 'colombo',
        studentNumber: 'STU-99',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens).toHaveProperty('accessToken');
    expect(res.body.data.user.fullName).toBe('නිරෝෂන් ප්‍රනාන්දු');
  });

  it('should login student and return JWT tokens', async () => {
    if (!isDbConnected) return;
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'niroshan',
        password: 'password123',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens).toHaveProperty('accessToken');
  });

  it('should reject login with wrong password', async () => {
    if (!isDbConnected) return;
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'niroshan',
        password: 'wrongpassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
