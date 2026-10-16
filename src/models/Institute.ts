import { PgModel, IBaseDoc } from '../db/pgModel.js';

export interface IInstitute extends IBaseDoc {
  name: string;
  normalizedName: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const Institute = PgModel<IInstitute>({
  tableName: 'institutes',
});

/**
 * Normalizes and formats institute name cleanly
 */
export function formatInstituteName(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\s+/g, ' ');
  return trimmed;
}

/**
 * Ensures an institute exists in DB. If not found, creates it.
 */
export async function ensureInstituteExists(nameInput: string, description = ''): Promise<IInstitute | null> {
  const formatted = formatInstituteName(nameInput);
  if (!formatted) return null;

  const normalized = formatted.toLowerCase();
  let existing = await Institute.findOne({ normalizedName: normalized });
  if (!existing) {
    try {
      existing = await Institute.create({
        name: formatted,
        normalizedName: normalized,
        description: description.trim(),
        isActive: true,
      });
    } catch (err: any) {
      existing = await Institute.findOne({ normalizedName: normalized });
    }
  }
  return existing;
}

/**
 * Default institutes seed function: "Dakme - Matara", "Online", "None"
 */
export async function seedDefaultInstitutesIfEmpty(): Promise<void> {
  const count = await Institute.countDocuments();
  if (count === 0) {
    const defaults = [
      { name: 'Dakme - Matara', description: 'Dakme Higher Education Center - Matara' },
      { name: 'Online', description: 'Online / Distance Learning' },
      { name: 'None', description: 'General / No Specific Institute' },
    ];
    for (const item of defaults) {
      await ensureInstituteExists(item.name, item.description);
    }
  }
}
