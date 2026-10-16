import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface ICategory extends IBaseDoc {
  name: string;
  normalizedName: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const Category = PgModel<ICategory>({
  tableName: 'categories',
});

/**
 * Normalizes category name string, e.g. "  2027   a/l " -> "2027 A/L"
 */
export function formatCategoryName(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  return trimmed
    .replace(/\bal\b/gi, 'A/L')
    .replace(/\ba\/l\b/gi, 'A/L');
}

/**
 * Ensures a category exists in DB. If it does not exist, it creates it automatically.
 * Returns the resolved category document.
 */
export async function ensureCategoryExists(categoryInput: string): Promise<ICategory | null> {
  const formatted = formatCategoryName(categoryInput);
  if (!formatted) return null;

  const normalized = formatted.toLowerCase();
  let existing = await Category.findOne({ normalizedName: normalized });
  if (!existing) {
    try {
      existing = await Category.create({
        name: formatted,
        normalizedName: normalized,
        isActive: true,
      });
    } catch (err: any) {
      existing = await Category.findOne({ normalizedName: normalized });
    }
  }
  return existing;
}

/**
 * Default categories seed function
 */
export async function seedDefaultCategoriesIfEmpty(): Promise<void> {
  const count = await Category.countDocuments();
  if (count === 0) {
    const defaults = ['2026 A/L', '2027 A/L', '2028 A/L', '2029 A/L'];
    for (const name of defaults) {
      await ensureCategoryExists(name);
    }
  }
}
