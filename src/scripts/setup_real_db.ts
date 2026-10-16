import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('Error: MONGODB_URI not found in backend/.env');
  process.exit(1);
}

// Inline model schemas to ensure direct, clean execution without module resolution quirks
const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['ADMIN', 'STUDENT'], required: true, index: true },
  },
  { timestamps: true }
);

const AdminProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, index: true, lowercase: true, trim: true },
    role: { type: String, default: 'SUPER_ADMIN' },
    lastLogin: { type: Date },
    accountStatus: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true }
);

const SubjectSchema = new mongoose.Schema(
  {
    nameEn: { type: String, required: true, trim: true },
    nameSi: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

const TopicSchema = new mongoose.Schema(
  {
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    nameSi: { type: String, required: true, trim: true },
    nameEn: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const AdminProfile = mongoose.models.AdminProfile || mongoose.model('AdminProfile', AdminProfileSchema);
const Subject = mongoose.models.Subject || mongoose.model('Subject', SubjectSchema);
const Topic = mongoose.models.Topic || mongoose.model('Topic', TopicSchema);

async function cleanAndSetup() {
  console.log('Connecting to database:', uri);
  await mongoose.connect(uri as string, { serverSelectionTimeoutMS: 15000 });
  console.log('MongoDB Connected successfully!');

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  console.log('\n--- 1. PURGING ALL SAMPLE DATA ---');
  
  // Wipe test quiz data
  const delQuizzes = await db.collection('quizzes').deleteMany({});
  console.log(`Deleted ${delQuizzes.deletedCount} sample quizzes.`);

  const delQuestions = await db.collection('questions').deleteMany({});
  console.log(`Deleted ${delQuestions.deletedCount} sample questions.`);

  const delAttempts = await db.collection('quizattempts').deleteMany({});
  console.log(`Deleted ${delAttempts.deletedCount} quiz attempts.`);

  const delAnswers = await db.collection('studentanswers').deleteMany({});
  console.log(`Deleted ${delAnswers.deletedCount} student answers.`);

  const delResults = await db.collection('quizresults').deleteMany({});
  console.log(`Deleted ${delResults.deletedCount} quiz results.`);

  const delImports = await db.collection('pdfimports').deleteMany({});
  console.log(`Deleted ${delImports.deletedCount} pdf imports.`);

  const delRankings = await db.collection('rankingsnapshots').deleteMany({});
  console.log(`Deleted ${delRankings.deletedCount} ranking snapshots.`);

  const delQuizStats = await db.collection('monthlyquizstatistics').deleteMany({});
  console.log(`Deleted ${delQuizStats.deletedCount} monthly quiz stats.`);

  const delStudentStats = await db.collection('monthlystudentstatistics').deleteMany({});
  console.log(`Deleted ${delStudentStats.deletedCount} monthly student stats.`);

  // Wipe dummy students
  const delStudents = await db.collection('studentprofiles').deleteMany({});
  console.log(`Deleted ${delStudents.deletedCount} student profiles.`);

  // Wipe all users and admin profiles to start completely fresh and clean
  const delUsers = await db.collection('users').deleteMany({});
  console.log(`Deleted ${delUsers.deletedCount} old users.`);

  const delAdmins = await db.collection('adminprofiles').deleteMany({});
  console.log(`Deleted ${delAdmins.deletedCount} old admin profiles.`);

  // Wipe and reset topics
  await db.collection('topics').deleteMany({});
  // Wipe and reset subjects
  await db.collection('subjects').deleteMany({});

  console.log('\n--- 2. CREATING OFFICIAL ADMIN ACCOUNT ---');
  const adminEmail = 'thinukavinjaya541@gmail.com';
  const adminPasswordRaw = 'thinuka@123';
  const adminPasswordHash = await bcrypt.hash(adminPasswordRaw, 10);

  const adminUser = await User.create({
    username: adminEmail.toLowerCase().trim(),
    passwordHash: adminPasswordHash,
    role: 'ADMIN',
  });

  const adminProfile = await AdminProfile.create({
    userId: adminUser._id,
    name: 'Thinuka Vinjaya (Administrator)',
    username: adminEmail.toLowerCase().trim(),
    role: 'SUPER_ADMIN',
    accountStatus: 'ACTIVE',
  });

  console.log(`Successfully created Admin User:`);
  console.log(`- Email / Username: ${adminUser.username}`);
  console.log(`- Password: ${adminPasswordRaw}`);
  console.log(`- Role: ${adminUser.role}`);
  console.log(`- Profile Name: ${adminProfile.name}`);

  // Test password verification
  const isMatch = await bcrypt.compare(adminPasswordRaw, adminUser.passwordHash);
  console.log(`- Verification test bcrypt.compare: ${isMatch ? 'PASS ✅' : 'FAIL ❌'}`);

  console.log('\n--- 3. SEEDING STANDARD CURRICULUM SUBJECTS & TOPICS ---');
  // Official standard subjects for Sri Lankan Curriculum
  const standardSubjects = [
    {
      nameEn: 'Science',
      nameSi: 'විද්‍යාව',
      code: 'SCI',
      description: 'Sri Lanka G.C.E. Ordinary Level Science Curriculum',
      topics: [
        { nameEn: 'Electric Current & Resistance', nameSi: 'විදුලි ධාරාව හා ප්‍රතිරෝධය' },
        { nameEn: 'Newton Laws & Motion', nameSi: 'නිව්ටන්ගේ නියම හා චලිතය' },
        { nameEn: 'Structure of Matter & Chemical Bonds', nameSi: 'පදාර්ථයේ ව්‍යුහය හා රසායනික බන්ධන' },
        { nameEn: 'Living Processes & Energy', nameSi: 'ජීවී දේහ ක්‍රියාවලි හා ශක්තිය' },
        { nameEn: 'Waves and Light', nameSi: 'තරංග හා ආලෝකය' },
        { nameEn: 'Acids, Bases and Salts', nameSi: 'අම්ල, භස්ම හා ලවණ' },
      ],
    },
    {
      nameEn: 'Mathematics',
      nameSi: 'ගණිතය',
      code: 'MATH',
      description: 'Sri Lanka G.C.E. Ordinary Level Mathematics Curriculum',
      topics: [
        { nameEn: 'Algebra & Quadratic Equations', nameSi: 'වීජ ගණිතය හා වර්ගජ සමීකරණ' },
        { nameEn: 'Trigonometry & Geometry', nameSi: 'ත්‍රිකෝණමිතිය හා ජ්‍යාමිතිය' },
        { nameEn: 'Logarithms & Indices', nameSi: 'ලඝුගණක හා දර්ශක' },
        { nameEn: 'Probability & Statistics', nameSi: 'සම්භාවිතාව හා සංඛ්‍යානය' },
        { nameEn: 'Matrices & Transformations', nameSi: 'න්‍යාස හා පරිණාමන' },
      ],
    },
    {
      nameEn: 'Sinhala Language & Literature',
      nameSi: 'සිංහල භාෂාව හා සාහිත්‍යය',
      code: 'SIN',
      description: 'Sri Lanka G.C.E. Ordinary Level Sinhala Curriculum',
      topics: [
        { nameEn: 'Grammar and Syntax', nameSi: 'ව්‍යාකරණ හා වාක්‍ය රීති' },
        { nameEn: 'Classical Poetry and Verses', nameSi: 'පැරණි පද්‍ය සාහිත්‍යය' },
        { nameEn: 'Prose & Short Stories', nameSi: 'ගද්‍ය සාහිත්‍යය හා කෙටිකතා' },
        { nameEn: 'Comprehension & Vocabulary', nameSi: 'අවබෝධය හා වාග් කෝෂය' },
      ],
    },
    {
      nameEn: 'History',
      nameSi: 'ඉතිහාසය',
      code: 'HIST',
      description: 'Sri Lankan and World History',
      topics: [
        { nameEn: 'Anuradhapura Kingdom', nameSi: 'අනුරාධපුර යුගය' },
        { nameEn: 'Polonnaruwa Kingdom', nameSi: 'පොළොන්නරු යුගය' },
        { nameEn: 'Colonial Era', nameSi: 'යටත්විජිත යුගය' },
        { nameEn: 'Modern Independence Era', nameSi: 'නිදහස් ශ්‍රී ලංකාව' },
      ],
    },
    {
      nameEn: 'Information & Communication Technology',
      nameSi: 'තොරතුරු හා සන්නිවේදන තාක්ෂණය',
      code: 'ICT',
      description: 'ICT for G.C.E. O/L',
      topics: [
        { nameEn: 'Computer Systems & Architecture', nameSi: 'පරිගණක පද්ධති හා ගෘහ නිර්මාණ ශිල්පය' },
        { nameEn: 'Logic Gates & Digital Circuits', nameSi: 'තාර්කික ද්වාර හා ඩිජිටල් පරිපථ' },
        { nameEn: 'Networking & Internet', nameSi: 'ජාලකරණය හා අන්තර්ජාලය' },
        { nameEn: 'Database Management Systems', nameSi: 'දත්ත සමුදාය කළමනාකරණය' },
        { nameEn: 'Programming Concepts', nameSi: 'ක්‍රමලේඛන මූලධර්ම' },
      ],
    },
    {
      nameEn: 'English Language',
      nameSi: 'ඉංග්‍රීසි භාෂාව',
      code: 'ENG',
      description: 'G.C.E. O/L English Language Curriculum',
      topics: [
        { nameEn: 'Grammar & Tenses', nameSi: 'ව්‍යාකරණ හා කාල භේදය' },
        { nameEn: 'Reading Comprehension', nameSi: 'කියවා තේරුම් ගැනීම' },
        { nameEn: 'Vocabulary & Idioms', nameSi: 'වචන මාලාව හා ප්‍රස්ථාව පිරුළු' },
      ],
    },
  ];

  for (const s of standardSubjects) {
    const createdSub = await Subject.create({
      nameEn: s.nameEn,
      nameSi: s.nameSi,
      code: s.code,
      description: s.description,
    });
    console.log(`Created Subject: ${s.nameEn} (${s.nameSi}) [${s.code}]`);

    for (const t of s.topics) {
      await Topic.create({
        subjectId: createdSub._id,
        nameEn: t.nameEn,
        nameSi: t.nameSi,
      });
    }
  }

  console.log('\n--- 4. FINAL DATABASE STATUS ---');
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`Collection: ${col.name.padEnd(26)} -> Count: ${count}`);
  }

  console.log('\n======================================================');
  console.log('REAL DATABASE SETUP COMPLETE!');
  console.log('- All sample quizzes and questions REMOVED');
  console.log('- All sample students REMOVED');
  console.log('- Admin account created: thinukavinjaya541@gmail.com / thinuka@123');
  console.log('- Official academic subjects and curriculum topics established');
  console.log('======================================================');

  await mongoose.disconnect();
}

cleanAndSetup().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
