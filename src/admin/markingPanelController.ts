import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models/User.js';
import { MarkingPanelProfile } from '../models/MarkingPanelProfile.js';
import { EssaySubmission } from '../models/EssaySubmission.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

export const createPanelMemberSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Valid email address is required'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username can only contain letters, numbers, dots, and underscores'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phoneNumber: z.string().optional(),
  notes: z.string().optional(),
});

export async function getMarkingPanelMembers(_req: Request, res: Response, next: NextFunction) {
  try {
    const profiles = await MarkingPanelProfile.find().sort({ createdAt: -1 }).lean();
    res.json({
      success: true,
      data: profiles,
    });
  } catch (err) {
    next(err);
  }
}

export async function createMarkingPanelMember(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPanelMemberSchema.parse(req.body);
    const cleanEmail = data.email.trim().toLowerCase();
    const cleanUsername = data.username.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: cleanEmail }, { username: cleanUsername }],
    });
    if (existingUser) {
      throw new ApiError(400, 'A user with this email or username already exists.', 'USER_EXISTS');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      role: 'MARKING_PANEL',
    });

    const profile = await MarkingPanelProfile.create({
      userId: user._id,
      name: data.name.trim(),
      email: cleanEmail,
      username: cleanUsername,
      phoneNumber: data.phoneNumber ? data.phoneNumber.trim() : undefined,
      notes: data.notes ? data.notes.trim() : undefined,
      isActive: true,
    });

    logger.info(`[PANEL] Marking panel member created: ${cleanUsername} (${cleanEmail})`);

    res.status(201).json({
      success: true,
      message: 'Marking panel member added successfully.',
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteMarkingPanelMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params; // profile id or user id

    const profile = await MarkingPanelProfile.findOne({
      $or: [{ _id: id }, { userId: id }],
    });

    if (!profile) {
      throw new ApiError(404, 'Marking panel member not found.', 'NOT_FOUND');
    }

    await User.findByIdAndDelete(profile.userId);
    await MarkingPanelProfile.findByIdAndDelete(profile._id);

    logger.info(`[PANEL] Marking panel member removed: ${profile.username}`);

    res.json({
      success: true,
      message: 'Marking panel member removed successfully.',
    });
  } catch (err) {
    next(err);
  }
}

export async function resetMarkingPanelPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      throw new ApiError(400, 'Password must be at least 6 characters.', 'INVALID_PASSWORD');
    }

    const profile = await MarkingPanelProfile.findOne({
      $or: [{ _id: id }, { userId: id }],
    });

    if (!profile) {
      throw new ApiError(404, 'Marking panel member not found.', 'NOT_FOUND');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(profile.userId, { passwordHash });

    res.json({
      success: true,
      message: `Password updated successfully for ${profile.username}.`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Get workload & marked paper count per marking panel member
 * Broken down by Paper (Paper Title, Quiz #, Subject) to calculate salaries accurately.
 */
export async function getMarkingPanelWorkloadReport(req: Request, res: Response, next: NextFunction) {
  try {
    const includeSettled = req.query.includeSettled === 'true';

    const members = await MarkingPanelProfile.find().sort({ name: 1 }).lean();
    const registeredUserIds = new Set(members.map((m) => m.userId.toString()));
    const memberProfileMap = new Map<string, any>();
    members.forEach((m) => {
      memberProfileMap.set(m.userId.toString(), m);
    });

    const allSubmissions = await EssaySubmission.find()
      .select('quizId markedById markedByName marksAwarded isMarked submittedAt markedAt isWorkloadSettled workloadSettledAt')
      .populate({
        path: 'quizId',
        select: 'title quizNumber subjectId alYear hasEssay',
        populate: { path: 'subjectId', select: 'nameEn nameSi code' },
      })
      .lean();

    const markedSubmissions = allSubmissions.filter(
      (s) => s.isMarked && s.markedById
    );

    // Map marked submissions by marker userId
    const markerMap = new Map<string, any[]>();
    markedSubmissions.forEach((sub) => {
      const markerId = sub.markedById?.toString();
      if (!markerId) return;
      if (!markerMap.has(markerId)) {
        markerMap.set(markerId, []);
      }
      markerMap.get(markerId)!.push(sub);
    });

    const distinctQuizzesSet = new Set<string>();

    const memberReports = members.map((member) => {
      const markerKey = (member.userId || member.id || member._id)?.toString();
      const subs = markerKey ? (markerMap.get(markerKey) || []) : [];
      const quizMap = new Map<
        string,
        {
          quizId: string;
          quizNumber: number;
          title: string;
          subjectName: string;
          alYear: string;
          markedCount: number;
          settledCount: number;
          isSettled: boolean;
          firstMarkedAt?: Date;
          lastMarkedAt?: Date;
        }
      >();

      subs.forEach((s) => {
        const q: any = s.quizId;
        if (!q) return;
        const qId = (q._id || q.id || (typeof q === 'string' ? q : null))?.toString();
        if (!qId) return;
        distinctQuizzesSet.add(qId);

        if (!quizMap.has(qId)) {
          const subject = (typeof q === 'object' && q) ? (q.subjectId as any) : null;
          const qNum = (typeof q === 'object' && q?.quizNumber) ? q.quizNumber : 1;
          const qTitle = (typeof q === 'object' && q?.title) ? q.title : `Quiz #${qNum}`;
          const qAlYear = (typeof q === 'object' && q) ? (q.targetCategory || q.alYear || 'General') : 'General';
          quizMap.set(qId, {
            quizId: qId,
            quizNumber: qNum,
            title: qTitle,
            subjectName: subject?.nameSi || subject?.nameEn || 'General',
            alYear: qAlYear,
            markedCount: 0,
            settledCount: 0,
            isSettled: false,
            firstMarkedAt: s.markedAt || s.submittedAt,
            lastMarkedAt: s.markedAt || s.submittedAt,
          });
        }

        const item = quizMap.get(qId)!;
        if (s.isWorkloadSettled) {
          item.settledCount += 1;
        } else {
          item.markedCount += 1;
        }
        item.isSettled = item.markedCount === 0 && item.settledCount > 0;

        if (s.markedAt && (!item.lastMarkedAt || new Date(s.markedAt) > new Date(item.lastMarkedAt))) {
          item.lastMarkedAt = s.markedAt;
        }
        if (s.markedAt && (!item.firstMarkedAt || new Date(s.markedAt) < new Date(item.firstMarkedAt))) {
          item.firstMarkedAt = s.markedAt;
        }
      });

      const quizzesList = Array.from(quizMap.values())
        .filter((q) => (includeSettled ? q.markedCount > 0 || q.settledCount > 0 : q.markedCount > 0))
        .sort((a, b) => b.markedCount - a.markedCount);
      const totalMarkedCount = subs.filter((s) => !s.isWorkloadSettled).length;
      const totalSettledCount = subs.filter((s) => s.isWorkloadSettled).length;

      return {
        memberId: member.userId.toString(),
        profileId: member._id.toString(),
        name: member.name,
        username: member.username,
        email: member.email,
        phoneNumber: member.phoneNumber,
        notes: member.notes,
        totalMarkedCount,
        totalSettledCount,
        totalQuizzesCount: quizzesList.length,
        quizzes: quizzesList,
      };
    });

    // Check if any admins or unregistered markers marked papers
    for (const [markerId, subs] of markerMap.entries()) {
      if (!registeredUserIds.has(markerId) && subs.length > 0) {
        const markerName = subs[0]?.markedByName || 'Admin / Other Marker';
        const quizMap = new Map<string, any>();

        subs.forEach((s) => {
          const q: any = s.quizId;
          if (!q) return;
          const qId = (q._id || q.id || (typeof q === 'string' ? q : null))?.toString();
          if (!qId) return;
          distinctQuizzesSet.add(qId);
          if (!quizMap.has(qId)) {
            const subject = (typeof q === 'object' && q) ? (q.subjectId as any) : null;
            const qNum = (typeof q === 'object' && q?.quizNumber) ? q.quizNumber : 1;
            const qTitle = (typeof q === 'object' && q?.title) ? q.title : `Quiz #${qNum}`;
            const qAlYear = (typeof q === 'object' && q) ? (q.targetCategory || q.alYear || 'General') : 'General';
            quizMap.set(qId, {
              quizId: qId,
              quizNumber: qNum,
              title: qTitle,
              subjectName: subject?.nameSi || subject?.nameEn || 'General',
              alYear: qAlYear,
              markedCount: 0,
              settledCount: 0,
              isSettled: false,
              firstMarkedAt: s.markedAt,
              lastMarkedAt: s.markedAt,
            });
          }
          const item = quizMap.get(qId)!;
          if (s.isWorkloadSettled) {
            item.settledCount += 1;
          } else {
            item.markedCount += 1;
          }
          item.isSettled = item.markedCount === 0 && item.settledCount > 0;
        });

        const activeCount = subs.filter((s) => !s.isWorkloadSettled).length;
        const settledCount = subs.filter((s) => s.isWorkloadSettled).length;
        const quizzesList = Array.from(quizMap.values()).filter((q) =>
          includeSettled ? q.markedCount > 0 || q.settledCount > 0 : q.markedCount > 0
        );

        memberReports.push({
          memberId: markerId,
          profileId: markerId,
          name: `${markerName} (System / Admin)`,
          username: 'admin',
          email: 'admin@system',
          phoneNumber: undefined,
          notes: 'System or administrative marker',
          totalMarkedCount: activeCount,
          totalSettledCount: settledCount,
          totalQuizzesCount: quizzesList.length,
          quizzes: quizzesList,
        });
      }
    }

    // ==========================================
    // Paper-Wise Workload Aggregation
    // ==========================================
    const paperMap = new Map<
      string,
      {
        quizId: string;
        quizNumber: number;
        title: string;
        subjectName: string;
        alYear: string;
        totalSubmissions: number;
        markedCount: number;
        settledCount: number;
        pendingCount: number;
        isFullySettled: boolean;
        membersMap: Map<
          string,
          {
            memberId: string;
            name: string;
            username: string;
            phoneNumber?: string;
            markedCount: number;
            settledCount: number;
            isSettled: boolean;
            firstMarkedAt?: Date;
            lastMarkedAt?: Date;
          }
        >;
      }
    >();

    allSubmissions.forEach((sub) => {
      const q: any = sub.quizId;
      if (!q) return;
      const qId = (q._id || q.id || (typeof q === 'string' ? q : null))?.toString();
      if (!qId) return;

      if (!paperMap.has(qId)) {
        const subject = (typeof q === 'object' && q) ? (q.subjectId as any) : null;
        const qNum = (typeof q === 'object' && q?.quizNumber) ? q.quizNumber : 1;
        const qTitle = (typeof q === 'object' && q?.title) ? q.title : `Quiz #${qNum}`;
        const qAlYear = (typeof q === 'object' && q) ? (q.targetCategory || q.alYear || 'General') : 'General';
        paperMap.set(qId, {
          quizId: qId,
          quizNumber: qNum,
          title: qTitle,
          subjectName: subject?.nameSi || subject?.nameEn || 'General',
          alYear: qAlYear,
          totalSubmissions: 0,
          markedCount: 0,
          settledCount: 0,
          pendingCount: 0,
          isFullySettled: false,
          membersMap: new Map(),
        });
      }

      const paperItem = paperMap.get(qId)!;
      paperItem.totalSubmissions += 1;

      if (sub.isMarked && sub.markedById) {
        if (sub.isWorkloadSettled) {
          paperItem.settledCount += 1;
        } else {
          paperItem.markedCount += 1;
        }

        const markerId = sub.markedById.toString();
        const existingProfile = memberProfileMap.get(markerId);
        const markerName = existingProfile?.name || sub.markedByName || 'Panel Member';
        const username = existingProfile?.username || 'member';
        const phoneNumber = existingProfile?.phoneNumber;

        if (!paperItem.membersMap.has(markerId)) {
          paperItem.membersMap.set(markerId, {
            memberId: markerId,
            name: markerName,
            username,
            phoneNumber,
            markedCount: 0,
            settledCount: 0,
            isSettled: false,
            firstMarkedAt: sub.markedAt || sub.submittedAt,
            lastMarkedAt: sub.markedAt || sub.submittedAt,
          });
        }

        const mItem = paperItem.membersMap.get(markerId)!;
        if (sub.isWorkloadSettled) {
          mItem.settledCount += 1;
        } else {
          mItem.markedCount += 1;
        }
        mItem.isSettled = mItem.markedCount === 0 && mItem.settledCount > 0;

        if (sub.markedAt && (!mItem.lastMarkedAt || new Date(sub.markedAt) > new Date(mItem.lastMarkedAt))) {
          mItem.lastMarkedAt = sub.markedAt;
        }
        if (sub.markedAt && (!mItem.firstMarkedAt || new Date(sub.markedAt) < new Date(mItem.firstMarkedAt))) {
          mItem.firstMarkedAt = sub.markedAt;
        }
      } else {
        paperItem.pendingCount += 1;
      }
    });

    // Update isFullySettled for each paper
    for (const p of paperMap.values()) {
      p.isFullySettled = p.markedCount === 0 && p.settledCount > 0;
    }

    const papersReport = Array.from(paperMap.values())
      .filter((p) => (includeSettled ? true : p.markedCount > 0 || p.pendingCount > 0 || p.totalSubmissions > 0))
      .map((p) => ({
        quizId: p.quizId,
        quizNumber: p.quizNumber,
        title: p.title,
        subjectName: p.subjectName,
        alYear: p.alYear,
        totalSubmissions: p.totalSubmissions,
        markedCount: p.markedCount,
        settledCount: p.settledCount,
        pendingCount: p.pendingCount,
        isFullySettled: p.isFullySettled,
        panelMembers: Array.from(p.membersMap.values())
          .filter((m) => (includeSettled ? true : m.markedCount > 0))
          .sort((a, b) => b.markedCount - a.markedCount),
      }))
      .sort((a, b) => b.quizNumber - a.quizNumber || b.totalSubmissions - a.totalSubmissions);

    const totalMarkedPapers = allSubmissions.filter((s) => s.isMarked && s.markedById && !s.isWorkloadSettled).length;
    const totalSettledPapers = allSubmissions.filter((s) => s.isMarked && s.markedById && s.isWorkloadSettled).length;
    const totalPendingPapers = allSubmissions.filter((s) => !s.isMarked).length;
    const activeMarkersCount = memberReports.filter((m) => m.totalMarkedCount > 0).length;

    res.json({
      success: true,
      data: {
        summary: {
          totalMarkedPapers,
          totalSettledPapers,
          totalPendingPapers,
          totalSubmissions: allSubmissions.length,
          totalMarkers: memberReports.length,
          activeMarkersCount,
          totalQuizzesEvaluated: distinctQuizzesSet.size,
        },
        members: memberReports.sort((a, b) => b.totalMarkedCount - a.totalMarkedCount),
        papers: papersReport,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Clear / Delete marked paper count for an entire paper (quizId)
 * Marks all marked submissions for this paper as workload settled.
 * Student marks and feedback remain 100% intact.
 */
export async function clearPaperWorkloadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = (req.params.quizId as string)?.trim();
    const adminId = req.user!.userId;

    if (!quizId) {
      throw new ApiError(400, 'Invalid Quiz ID', 'INVALID_ID');
    }

    const result = await EssaySubmission.updateMany(
      { quizId, isMarked: true, markedById: { $ne: null } },
      {
        $set: {
          isWorkloadSettled: true,
          workloadSettledAt: new Date(),
          workloadSettledBy: adminId,
        },
      }
    );

    res.json({
      success: true,
      message: `Marked paper count cleared successfully (${result.modifiedCount} papers cleared)`,
      data: {
        quizId,
        clearedCount: result.modifiedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Clear / Delete marked paper count for a specific marker on a paper
 */
export async function clearMarkerPaperWorkloadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = (req.params.quizId as string)?.trim();
    const memberId = (req.params.memberId as string)?.trim();
    const adminId = req.user!.userId;

    if (!quizId || !memberId) {
      throw new ApiError(400, 'Invalid Quiz or Member ID', 'INVALID_ID');
    }

    const result = await EssaySubmission.updateMany(
      {
        quizId,
        markedById: memberId,
        isMarked: true,
      },
      {
        $set: {
          isWorkloadSettled: true,
          workloadSettledAt: new Date(),
          workloadSettledBy: adminId,
        },
      }
    );

    res.json({
      success: true,
      message: `Marker count cleared successfully (${result.modifiedCount} papers cleared)`,
      data: {
        quizId,
        memberId,
        clearedCount: result.modifiedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Restore previously cleared marked paper count for a paper
 */
export async function restorePaperWorkloadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = (req.params.quizId as string)?.trim();

    if (!quizId) {
      throw new ApiError(400, 'Invalid Quiz ID', 'INVALID_ID');
    }

    const result = await EssaySubmission.updateMany(
      { quizId, isWorkloadSettled: true },
      {
        $set: {
          isWorkloadSettled: false,
          workloadSettledAt: null,
          workloadSettledBy: null,
        },
      }
    );

    res.json({
      success: true,
      message: `Workload count restored successfully (${result.modifiedCount} papers restored)`,
      data: {
        quizId,
        restoredCount: result.modifiedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin: Restore previously cleared marked paper count for a specific marker on a paper
 */
export async function restoreMarkerPaperWorkloadCount(req: Request, res: Response, next: NextFunction) {
  try {
    const quizId = (req.params.quizId as string)?.trim();
    const memberId = (req.params.memberId as string)?.trim();

    if (!quizId || !memberId) {
      throw new ApiError(400, 'Invalid Quiz or Member ID', 'INVALID_ID');
    }

    const result = await EssaySubmission.updateMany(
      {
        quizId,
        markedById: memberId,
        isWorkloadSettled: true,
      },
      {
        $set: {
          isWorkloadSettled: false,
          workloadSettledAt: null,
          workloadSettledBy: null,
        },
      }
    );

    res.json({
      success: true,
      message: `Marker count restored successfully (${result.modifiedCount} papers restored)`,
      data: {
        quizId,
        memberId,
        restoredCount: result.modifiedCount,
      },
    });
  } catch (err) {
    next(err);
  }
}
