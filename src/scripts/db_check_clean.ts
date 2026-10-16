import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;

console.log('--- MongoDB Connection Test ---');
console.log('URI configured:', uri ? 'Yes' : 'No');

async function run() {
  if (!uri) {
    console.error('ERROR: MONGODB_URI is not set in backend/.env');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB Atlas...');
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log('SUCCESS: Successfully connected to MongoDB Atlas!');
    console.log('Connected Host:', conn.connection.host);
    console.log('Connected Database:', conn.connection.name);

    const collections = await conn.connection.db?.listCollections().toArray();
    console.log('\n--- Current Collections & Counts ---');
    if (collections && collections.length > 0) {
      for (const col of collections) {
        const count = await conn.connection.db?.collection(col.name).countDocuments();
        console.log(`- ${col.name}: ${count} document(s)`);
      }
    } else {
      console.log('No collections found or database is empty.');
    }

    await mongoose.disconnect();
    console.log('\nTest completed successfully.');
  } catch (err) {
    console.error('FAILED TO CONNECT TO MONGODB:', err);
    process.exit(1);
  }
}

run();
