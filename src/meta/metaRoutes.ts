import { Router, Request, Response, NextFunction } from 'express';
import { PROVINCES, DISTRICTS } from '../data/sriLankaData.js';
import { Subject } from '../models/Subject.js';
import { Topic } from '../models/Topic.js';
import { memoryCache } from '../utils/cache.js';

const router = Router();

router.get('/provinces', (_req: Request, res: Response) => {
  res.json({ success: true, data: PROVINCES });
});

router.get('/districts', (req: Request, res: Response) => {
  const { provinceId } = req.query;
  if (provinceId) {
    const filtered = DISTRICTS.filter((d) => d.provinceId === provinceId);
    return res.json({ success: true, data: filtered });
  }
  res.json({ success: true, data: DISTRICTS });
});

router.get('/subjects', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const subjects = await memoryCache.getOrSet(
      'meta_subjects',
      () => Subject.find().sort({ nameSi: 1 }).lean(),
      300 // 5 minutes
    );
    res.json({ success: true, data: subjects });
  } catch (err) {
    next(err);
  }
});

import { Category, seedDefaultCategoriesIfEmpty } from '../models/Category.js';

router.get('/topics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { subjectId } = req.query;
    const cacheKey = `meta_topics_${subjectId || 'all'}`;
    const topics = await memoryCache.getOrSet(
      cacheKey,
      () => {
        const filter = subjectId ? { subjectId } : {};
        return Topic.find(filter).sort({ nameSi: 1 }).lean();
      },
      300 // 5 minutes
    );
    res.json({ success: true, data: topics });
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await seedDefaultCategoriesIfEmpty();
    const categories = await Category.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
});

import { Institute, seedDefaultInstitutesIfEmpty } from '../models/Institute.js';

router.get('/institutes', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await seedDefaultInstitutesIfEmpty();
    const institutes = await Institute.find({ isActive: true }).sort({ name: 1 }).lean();
    res.json({ success: true, data: institutes });
  } catch (err) {
    next(err);
  }
});

export default router;
