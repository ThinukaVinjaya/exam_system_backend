import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function testAuth() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db;
  if (!db) throw new Error('DB not available');

  const user = await db.collection('users').findOne({ username: 'quizebs885@gmail.com' });
  console.log('Admin user found in DB:', Boolean(user));
  if (user) {
    const isMatch = await bcrypt.compare('avishka@123', user.passwordHash);
    console.log('Password "avishka@123" match:', isMatch);
    console.log('User role:', user.role);
    const adminProfile = await db.collection('adminprofiles').findOne({ userId: user._id });
    console.log('Admin Profile:', adminProfile?.name, '| Status:', adminProfile?.accountStatus);
  }

  const quizzesCount = await db.collection('quizzes').countDocuments();
  const questionsCount = await db.collection('questions').countDocuments();
  const studentsCount = await db.collection('studentprofiles').countDocuments();
  const subjectsCount = await db.collection('subjects').countDocuments();
  const topicsCount = await db.collection('topics').countDocuments();

  console.log('\n--- CLEAN DATABASE AUDIT ---');
  console.log('Quizzes count:', quizzesCount, '(Expected: 0)');
  console.log('Questions count:', questionsCount, '(Expected: 0)');
  console.log('Student profiles count:', studentsCount, '(Expected: 0)');
  console.log('Subjects count:', subjectsCount, '(Standard curriculum taxonomy)');
  console.log('Topics count:', topicsCount, '(Standard curriculum topics)');

  await mongoose.disconnect();
}

testAuth().catch(console.error);
