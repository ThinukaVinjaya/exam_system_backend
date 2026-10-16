import bcrypt from 'bcryptjs';
import { connectDB } from './config/db.js';
import { User } from './models/User.js';
import { AdminProfile } from './models/AdminProfile.js';
import { Subject } from './models/Subject.js';
import { Topic } from './models/Topic.js';
import { logger } from './utils/logger.js';

async function seed() {
  await connectDB();
  logger.info('Initializing real database environment...');

  // Setup / verify real admin
  const adminEmail = 'thinukavinjaya541@gmail.com';
  const adminPasswordHash = await bcrypt.hash('thinuka@123', 10);
  
  let adminUser = await User.findOne({ username: adminEmail });
  if (!adminUser) {
    adminUser = await User.create({
      username: adminEmail,
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    });
    await AdminProfile.create({
      userId: adminUser!._id,
      name: 'Thinuka Vinjaya (Administrator)',
      username: adminEmail,
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
    });
    logger.info(`Created official Admin account: username="${adminEmail}"`);
  } else {
    adminUser.passwordHash = adminPasswordHash;
    await adminUser.save();
    logger.info(`Verified & updated official Admin account password: "${adminEmail}"`);
  }

  // Setup Standard Curriculum Subjects & Topics if not exists
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
    let sub = await Subject.findOne({ code: s.code });
    if (!sub) {
      sub = await Subject.create({
        nameEn: s.nameEn,
        nameSi: s.nameSi,
        code: s.code,
        description: s.description,
      });
    }
    for (const t of s.topics) {
      const topicExists = await Topic.findOne({ subjectId: sub!._id, nameSi: t.nameSi });
      if (!topicExists) {
        await Topic.create({
          subjectId: sub!._id,
          nameEn: t.nameEn,
          nameSi: t.nameSi,
        });
      }
    }
  }

  logger.info('Database initialized with official admin and standard subjects. No sample quizzes or dummy students.');
  process.exit(0);
}

seed().catch((err) => {
  logger.error('Seeding error:', err);
  process.exit(1);
});
