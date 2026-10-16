import crypto from 'crypto';
import { query } from '../config/pgPool.js';

export function generateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toCamelCase(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

export function serializeSqlValue(val: any, isJsonCol = false): any {
  if (val === undefined || val === null) return null;
  if (isJsonCol) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!trimmed) return null;
      try {
        JSON.parse(trimmed);
        return trimmed;
      } catch (_) {
        return JSON.stringify(trimmed);
      }
    }
    return JSON.stringify(val);
  }
  if (Buffer.isBuffer(val)) {
    return val;
  }
  if (val instanceof Date) {
    return val;
  }
  if (typeof val === 'object') {
    if ('_id' in val || 'id' in val) {
      return (val._id || val.id).toString();
    }
    if (Array.isArray(val)) {
      return JSON.stringify(val);
    }
    try {
      return JSON.stringify(val);
    } catch (_) {
      return val.toString ? val.toString() : null;
    }
  }
  return val;
}

export function matchesSubDoc(item: any, cond: any): boolean {
  if (item === undefined || item === null) return false;
  if (typeof cond !== 'object' || cond === null || Buffer.isBuffer(cond) || cond instanceof Date) {
    const itemStr = (item?._id || item?.id || item)?.toString();
    const condStr = (cond?._id || cond?.id || cond)?.toString();
    return itemStr === condStr;
  }
  for (const [k, v] of Object.entries(cond)) {
    const itemVal = item[k];
    const itemValStr = (itemVal?._id || itemVal?.id || itemVal)?.toString();
    if (v && typeof v === 'object' && '$in' in v && Array.isArray((v as any).$in)) {
      const inStrs = (v as any).$in.map((x: any) => (x?._id || x?.id || x)?.toString());
      if (!inStrs.includes(itemValStr)) return false;
    } else {
      const vStr = ((v as any)?._id || (v as any)?.id || v)?.toString();
      if (itemValStr !== vStr) return false;
    }
  }
  return true;
}

export function applyPull(array: any[], pullValue: any): any[] {
  if (!Array.isArray(array)) return array;
  return array.filter((item) => {
    if (typeof pullValue === 'object' && pullValue !== null && !Buffer.isBuffer(pullValue) && !(pullValue instanceof Date) && !('_id' in pullValue && Object.keys(pullValue).length === 1)) {
      return !matchesSubDoc(item, pullValue);
    }
    const itemStr = (item?._id || item?.id || item)?.toString();
    const pullStr = (pullValue?._id || pullValue?.id || pullValue)?.toString();
    return itemStr !== pullStr;
  });
}

export function applyPush(array: any[], pushValue: any): any[] {
  const arr = Array.isArray(array) ? [...array] : [];
  if (pushValue && typeof pushValue === 'object' && '$each' in pushValue && Array.isArray(pushValue.$each)) {
    arr.push(...pushValue.$each);
  } else {
    arr.push(pushValue);
  }
  return arr;
}

export function applyAddToSet(array: any[], val: any): any[] {
  const arr = Array.isArray(array) ? [...array] : [];
  const itemsToAdd = val && typeof val === 'object' && '$each' in val && Array.isArray(val.$each) ? val.$each : [val];
  for (const item of itemsToAdd) {
    const itemStr = (item?._id || item?.id || item)?.toString();
    const exists = arr.some((existing) => (existing?._id || existing?.id || existing)?.toString() === itemStr);
    if (!exists) {
      arr.push(item);
    }
  }
  return arr;
}

export function applyOperatorsToDoc(doc: any, update: any): boolean {
  if (!doc || !update) return false;
  let modified = false;

  if (update.$pull) {
    for (const [field, pullVal] of Object.entries(update.$pull)) {
      const camel = toCamelCase(field);
      const snake = toSnakeCase(field);
      const cur = doc[camel] !== undefined ? doc[camel] : doc[snake];
      if (Array.isArray(cur)) {
        const next = applyPull(cur, pullVal);
        doc[camel] = next;
        doc[snake] = next;
        modified = true;
      }
    }
  }

  if (update.$push) {
    for (const [field, pushVal] of Object.entries(update.$push)) {
      const camel = toCamelCase(field);
      const snake = toSnakeCase(field);
      const cur = doc[camel] !== undefined ? doc[camel] : doc[snake];
      const next = applyPush(cur, pushVal);
      doc[camel] = next;
      doc[snake] = next;
      modified = true;
    }
  }

  if (update.$addToSet) {
    for (const [field, addVal] of Object.entries(update.$addToSet)) {
      const camel = toCamelCase(field);
      const snake = toSnakeCase(field);
      const cur = doc[camel] !== undefined ? doc[camel] : doc[snake];
      const next = applyAddToSet(cur, addVal);
      doc[camel] = next;
      doc[snake] = next;
      modified = true;
    }
  }

  if (update.$inc) {
    for (const [field, incVal] of Object.entries(update.$inc)) {
      const camel = toCamelCase(field);
      const snake = toSnakeCase(field);
      const cur = (doc[camel] !== undefined ? doc[camel] : doc[snake]) || 0;
      doc[camel] = Number(cur) + Number(incVal);
      doc[snake] = doc[camel];
      modified = true;
    }
  }

  if (update.$unset) {
    for (const field of Object.keys(update.$unset)) {
      const camel = toCamelCase(field);
      const snake = toSnakeCase(field);
      doc[camel] = null;
      doc[snake] = null;
      modified = true;
    }
  }

  return modified;
}

export interface IBaseDoc {
  _id: string;
  id: string;
  save: () => Promise<any>;
  toObject: () => any;
  toJSON: () => any;
  markModified: (path: string) => void;
}

export type QueryFilter = Record<string, any>;

export interface ModelOptions {
  tableName: string;
  jsonColumns?: string[];
}

export function hydrateDocument<T = any>(
  row: any,
  tableName: string,
  jsonCols: Set<string>,
  isLean = false
): T & { _id: string; id: string; save?: () => Promise<any>; toObject?: () => any; toJSON?: () => any; markModified?: (p: string) => void } {
  if (!row) return null as any;

  const doc: any = { ...row };
  doc.id = row.id ? row.id.toString() : (row._id ? row._id.toString() : generateId());
  doc._id = doc.id;

  for (const key of Object.keys(row)) {
    const camel = toCamelCase(key);
    if (!(camel in doc)) {
      doc[camel] = row[key];
    }
  }

  for (const col of jsonCols) {
    const camel = toCamelCase(col);
    if (typeof doc[col] === 'string') {
      try { doc[col] = JSON.parse(doc[col]); } catch (_) {}
    }
    if (typeof doc[camel] === 'string') {
      try { doc[camel] = JSON.parse(doc[camel]); } catch (_) {}
    }
  }

  if (isLean) {
    return doc;
  }

  doc.toObject = function () {
    const copy = { ...this };
    delete copy.toObject;
    delete copy.toJSON;
    delete copy.markModified;
    delete copy.save;
    return copy;
  };
  doc.toJSON = function () {
    const copy = { ...this };
    delete copy.toObject;
    delete copy.toJSON;
    delete copy.markModified;
    delete copy.save;
    return copy;
  };
  doc.markModified = (_path: string) => {};

  doc.save = async function () {
    const cols: string[] = ['id'];
    const placeholders: string[] = ['$1'];
    const updateClauses: string[] = [];
    const values: any[] = [this.id];
    let idx = 2;
    const seenCols = new Set<string>(['id']);

    for (const key of Object.keys(this)) {
      if (['id', '_id', 'save', 'toObject', 'toJSON', 'markModified'].includes(key)) continue;
      if (typeof this[key] === 'function') continue;

      const snakeKey = toSnakeCase(key);
      if (seenCols.has(snakeKey)) continue;
      seenCols.add(snakeKey);

      const camelKey = toCamelCase(snakeKey);
      let val: any;
      if (camelKey in this && snakeKey in this) {
        val = this[camelKey];
      } else if (camelKey in this) {
        val = this[camelKey];
      } else {
        val = this[snakeKey];
      }
      val = serializeSqlValue(val, jsonCols.has(snakeKey));

      cols.push(`"${snakeKey}"`);
      placeholders.push(`$${idx}`);
      if (snakeKey !== 'created_at' && snakeKey !== 'updated_at') {
        updateClauses.push(`"${snakeKey}" = EXCLUDED."${snakeKey}"`);
      }
      values.push(val);
      idx++;
    }

    updateClauses.push(`updated_at = NOW()`);

    const sql = `
      INSERT INTO "${tableName}" (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (id) DO UPDATE SET
        ${updateClauses.join(', ')}
      RETURNING *
    `;

    const res = await query(sql, values);
    if (res.rows[0]) {
      Object.assign(this, hydrateDocument(res.rows[0], tableName, jsonCols));
    }
    return this;
  };

  return doc;
}

export function buildWhereClause(
  filter: QueryFilter,
  startIdx = 1,
  jsonCols = new Set<string>()
): { whereSql: string; params: any[]; nextIdx: number } {
  if (!filter || Object.keys(filter).length === 0) {
    return { whereSql: '', params: [], nextIdx: startIdx };
  }

  const conditions: string[] = [];
  const params: any[] = [];
  let idx = startIdx;

  for (const [key, val] of Object.entries(filter)) {
    if (key === '$or') {
      if (Array.isArray(val) && val.length > 0) {
        const orClauses: string[] = [];
        for (const subFilter of val) {
          const sub = buildWhereClause(subFilter, idx, jsonCols);
          if (sub.whereSql) {
            orClauses.push(`(${sub.whereSql})`);
            params.push(...sub.params);
            idx = sub.nextIdx;
          }
        }
        if (orClauses.length > 0) {
          conditions.push(`(${orClauses.join(' OR ')})`);
        }
      }
      continue;
    }

    if (key === '$and') {
      if (Array.isArray(val) && val.length > 0) {
        const andClauses: string[] = [];
        for (const subFilter of val) {
          const sub = buildWhereClause(subFilter, idx, jsonCols);
          if (sub.whereSql) {
            andClauses.push(`(${sub.whereSql})`);
            params.push(...sub.params);
            idx = sub.nextIdx;
          }
        }
        if (andClauses.length > 0) {
          conditions.push(`(${andClauses.join(' AND ')})`);
        }
      }
      continue;
    }

    if (key.includes('.')) {
      const parts = key.split('.');
      const rootSnake = toSnakeCase(parts[0]);
      if (jsonCols.has(rootSnake)) {
        conditions.push(`"${rootSnake}" @> $${idx++}::jsonb`);
        params.push(JSON.stringify([{ [parts[1]]: serializeSqlValue(val, false) }]));
        continue;
      }
    }

    let colName = key === '_id' ? 'id' : toSnakeCase(key);

    if (val === null || val === undefined) {
      conditions.push(`"${colName}" IS NULL`);
    } else if (val instanceof RegExp) {
      const isCaseInsensitive = val.flags.includes('i');
      conditions.push(`("${colName}" IS NOT NULL AND "${colName}"::text ${isCaseInsensitive ? '~*' : '~'} $${idx++})`);
      params.push(val.source);
    } else if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      !(val instanceof Date) &&
      !Buffer.isBuffer(val) &&
      Object.keys(val).some((k) => k.startsWith('$'))
    ) {
      if ('$regex' in val) {
        const regexVal = val.$regex;
        const pattern = regexVal instanceof RegExp ? regexVal.source : String(regexVal);
        const options = val.$options || (regexVal instanceof RegExp ? regexVal.flags : '');
        const isCaseInsensitive = typeof options === 'string' && options.includes('i');
        conditions.push(`("${colName}" IS NOT NULL AND "${colName}"::text ${isCaseInsensitive ? '~*' : '~'} $${idx++})`);
        params.push(pattern);
      } else if ('$exists' in val) {
        if (val.$exists) {
          conditions.push(`"${colName}" IS NOT NULL`);
        } else {
          conditions.push(`"${colName}" IS NULL`);
        }
      } else if ('$in' in val) {
        const inVals = val.$in.map((v: any) =>
          v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) && v.toString
            ? (v._id || v.id || v).toString()
            : v
        );
        if (inVals.length === 0) {
          conditions.push('1 = 0');
        } else {
          conditions.push(`"${colName}" = ANY($${idx++})`);
          params.push(inVals);
        }
      } else if ('$nin' in val) {
        const ninVals = val.$nin.map((v: any) =>
          v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) && v.toString
            ? (v._id || v.id || v).toString()
            : v
        );
        conditions.push(`NOT ("${colName}" = ANY($${idx++}))`);
        params.push(ninVals);
      } else if ('$ne' in val) {
        const neVal =
          val.$ne && typeof val.$ne === 'object' && !(val.$ne instanceof Date) && !Buffer.isBuffer(val.$ne) && val.$ne.toString
            ? (val.$ne._id || val.$ne.id || val.$ne).toString()
            : val.$ne;
        if (neVal === null) {
          conditions.push(`"${colName}" IS NOT NULL`);
        } else {
          conditions.push(`("${colName}" IS NULL OR "${colName}" != $${idx++})`);
          params.push(neVal);
        }
      } else {
        if ('$gte' in val) {
          conditions.push(`"${colName}" >= $${idx++}`);
          params.push(val.$gte);
        }
        if ('$gt' in val) {
          conditions.push(`"${colName}" > $${idx++}`);
          params.push(val.$gt);
        }
        if ('$lte' in val) {
          conditions.push(`"${colName}" <= $${idx++}`);
          params.push(val.$lte);
        }
        if ('$lt' in val) {
          conditions.push(`"${colName}" < $${idx++}`);
          params.push(val.$lt);
        }
      }
    } else {
      if (jsonCols.has(colName) && typeof val !== 'object') {
        conditions.push(`"${colName}" @> $${idx++}::jsonb`);
        params.push(JSON.stringify([serializeSqlValue(val, false)]));
      } else {
        const paramVal = serializeSqlValue(val, false);
        conditions.push(`"${colName}" = $${idx++}`);
        params.push(paramVal);
      }
    }
  }

  return {
    whereSql: conditions.length > 0 ? conditions.join(' AND ') : '',
    params,
    nextIdx: idx,
  };
}

export class PgQueryBuilder<T = any> implements Promise<T> {
  private tableName: string;
  private filter: QueryFilter;
  private sortClauses: string[] = [];
  private limitVal?: number;
  private skipVal?: number;
  private selectFields?: string[];
  private populateFields: any[] = [];
  private isSingle = false;
  private isLean = false;
  private jsonCols: Set<string>;
  private isUpdate = false;
  private updatePayload?: any;
  private updateOptions?: any;

  constructor(
    tableName: string,
    filter: QueryFilter = {},
    isSingle = false,
    jsonCols: Set<string>,
    isUpdate = false,
    updatePayload?: any,
    updateOptions?: any
  ) {
    this.tableName = tableName;
    this.filter = filter;
    this.isSingle = isSingle;
    this.jsonCols = jsonCols;
    this.isUpdate = isUpdate;
    this.updatePayload = updatePayload;
    this.updateOptions = updateOptions;
  }

  sort(sortSpec: any): this {
    if (!sortSpec) return this;
    if (typeof sortSpec === 'string') {
      const parts = sortSpec.trim().split(/\s+/);
      for (const p of parts) {
        if (p.startsWith('-')) {
          const f = p.substring(1);
          const col = f === '_id' ? 'id' : toSnakeCase(f);
          this.sortClauses.push(`"${col}" DESC`);
        } else {
          const col = p === '_id' ? 'id' : toSnakeCase(p);
          this.sortClauses.push(`"${col}" ASC`);
        }
      }
    } else if (typeof sortSpec === 'object') {
      for (const [k, v] of Object.entries(sortSpec)) {
        const col = k === '_id' ? 'id' : toSnakeCase(k);
        const order = v === -1 || v === 'desc' || v === 'DESC' ? 'DESC' : 'ASC';
        this.sortClauses.push(`"${col}" ${order}`);
      }
    }
    return this;
  }

  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  skip(n: number): this {
    this.skipVal = n;
    return this;
  }

  select(fields: string | string[]): this {
    if (typeof fields === 'string') {
      this.selectFields = fields.trim().split(/\s+/).map((f) => toSnakeCase(f));
    } else if (Array.isArray(fields)) {
      this.selectFields = fields.map((f) => toSnakeCase(f));
    }
    return this;
  }

  populate(path: any, select?: string): this {
    if (typeof path === 'string') {
      this.populateFields.push({ path, select });
    } else if (typeof path === 'object' && path) {
      this.populateFields.push(path);
    }
    return this;
  }

  lean(): this {
    this.isLean = true;
    return this;
  }

  async exec(): Promise<T> {
    if (this.isUpdate) {
      let doc = await this.performUpdate();
      if (doc && this.populateFields.length > 0) {
        for (const pop of this.populateFields) {
          const arr = await this.performPopulate([doc], pop);
          doc = arr[0] || doc;
        }
      }
      return doc as unknown as T;
    }

    const { whereSql, params, nextIdx } = buildWhereClause(this.filter, 1, this.jsonCols);
    let sql = `SELECT * FROM "${this.tableName}"`;
    if (whereSql) {
      sql += ` WHERE ${whereSql}`;
    }

    if (this.sortClauses.length > 0) {
      sql += ` ORDER BY ${this.sortClauses.join(', ')}`;
    }

    let pIdx = nextIdx;
    if (this.limitVal !== undefined) {
      sql += ` LIMIT $${pIdx++}`;
      params.push(this.limitVal);
    } else if (this.isSingle) {
      sql += ` LIMIT 1`;
    }

    if (this.skipVal !== undefined) {
      sql += ` OFFSET $${pIdx++}`;
      params.push(this.skipVal);
    }

    const res = await query(sql, params);
    let items = res.rows.map((row) => hydrateDocument(row, this.tableName, this.jsonCols, this.isLean));

    if (this.populateFields.length > 0 && items.length > 0) {
      for (const pop of this.populateFields) {
        items = await this.performPopulate(items, pop);
      }
    }

    if (this.isSingle) {
      return (items[0] || null) as unknown as T;
    }
    return items as unknown as T;
  }

  private async performUpdate(): Promise<any> {
    const hasSpecialOps = Boolean(
      this.updatePayload && (this.updatePayload.$pull || this.updatePayload.$push || this.updatePayload.$addToSet || this.updatePayload.$inc)
    );

    if (hasSpecialOps) {
      const { whereSql: sWhere, params: sWParams } = buildWhereClause(this.filter, 1, this.jsonCols);
      const existingDocRes = await query(
        `SELECT * FROM "${this.tableName}" ${sWhere ? `WHERE ${sWhere}` : ''} LIMIT 1`,
        sWParams
      );
      if (!existingDocRes.rows[0]) {
        return null;
      }
      const doc = hydrateDocument(existingDocRes.rows[0], this.tableName, this.jsonCols);
      applyOperatorsToDoc(doc, this.updatePayload);
      const regularPayload: any = this.updatePayload.$set ? { ...this.updatePayload.$set } : {};
      for (const [k, v] of Object.entries(this.updatePayload)) {
        if (!k.startsWith('$')) regularPayload[k] = v;
      }
      for (const [k, v] of Object.entries(regularPayload)) {
        doc[toCamelCase(k)] = v;
        doc[toSnakeCase(k)] = v;
      }
      await doc.save();
      return doc;
    }

    const payload = this.updatePayload?.$set
      ? { ...this.updatePayload.$set, ...this.updatePayload }
      : { ...this.updatePayload };
    for (const k of Object.keys(payload)) {
      if (k.startsWith('$')) delete payload[k];
    }
    if (this.updatePayload?.$unset) {
      for (const k of Object.keys(this.updatePayload.$unset)) {
        payload[k] = null;
      }
      delete payload.$unset;
    }

    if (this.updateOptions?.upsert && this.tableName === 'student_answers' && this.filter.attemptId && this.filter.questionId) {
      const attemptId = (this.filter.attemptId._id || this.filter.attemptId).toString();
      const questionId = (this.filter.questionId._id || this.filter.questionId).toString();
      const studentId = (payload.studentId || this.filter.studentId || '').toString();
      const quizId = (payload.quizId || this.filter.quizId || '').toString();
      const selectedOption = payload.selectedOption || null;
      const displayOption = payload.displayOption || null;
      const textAnswer = payload.textAnswer || null;
      const isCorrect = payload.isCorrect ?? false;
      const marksObtained = payload.marksObtained ?? 0;
      const feedback = payload.evaluationFeedback ?? '';
      const newId = generateId();

      const sql = `
        INSERT INTO "student_answers" (
          id, attempt_id, question_id, student_id, quiz_id,
          selected_option, display_option, text_answer, is_correct, marks_obtained, evaluation_feedback,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
        )
        ON CONFLICT (attempt_id, question_id) DO UPDATE SET
          selected_option = EXCLUDED.selected_option,
          display_option = EXCLUDED.display_option,
          text_answer = EXCLUDED.text_answer,
          is_correct = EXCLUDED.is_correct,
          marks_obtained = EXCLUDED.marks_obtained,
          evaluation_feedback = EXCLUDED.evaluation_feedback,
          updated_at = NOW()
        RETURNING *
      `;
      const res = await query(sql, [
        newId, attemptId, questionId, studentId, quizId,
        selectedOption, displayOption, textAnswer, isCorrect, marksObtained, feedback
      ]);
      return hydrateDocument(res.rows[0], this.tableName, this.jsonCols);
    }

    const { whereSql, params: wParams } = buildWhereClause(this.filter, 1, this.jsonCols);
    const existingRes = await query(
      `SELECT id FROM "${this.tableName}" ${whereSql ? `WHERE ${whereSql}` : ''} LIMIT 1`,
      wParams
    );
    const existing = existingRes.rows[0];

    if (!existing) {
      if (this.updateOptions?.upsert) {
        const createData = { ...this.filter, ...payload };
        const id = createData.id || createData._id || generateId();
        createData.id = id.toString();
        delete createData._id;

        const cols: string[] = ['id'];
        const placeholders: string[] = ['$1'];
        const params: any[] = [createData.id];
        let idx = 2;
        const seenInsertCols = new Set<string>(['id']);

        for (const [key, rawVal] of Object.entries(createData)) {
          if (key === 'id' || key.startsWith('$') || typeof rawVal === 'function') continue;
          const snakeKey = toSnakeCase(key);
          if (seenInsertCols.has(snakeKey)) continue;
          seenInsertCols.add(snakeKey);

          let val = serializeSqlValue(rawVal, this.jsonCols.has(snakeKey));
          cols.push(`"${snakeKey}"`);
          placeholders.push(`$${idx++}`);
          params.push(val);
        }

        const sql = `INSERT INTO "${this.tableName}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
        const res = await query(sql, params);
        return hydrateDocument(res.rows[0], this.tableName, this.jsonCols);
      }
      return null;
    }

    const updateClauses: string[] = [];
    const params: any[] = [];
    let idx = 1;
    const seenUpdateCols = new Set<string>();

    for (const [key, rawVal] of Object.entries(payload)) {
      if (key.startsWith('$') || key === 'id' || key === '_id' || typeof rawVal === 'function') continue;
      const snakeKey = toSnakeCase(key);
      if (snakeKey === 'updated_at') continue;
      if (seenUpdateCols.has(snakeKey)) continue;
      seenUpdateCols.add(snakeKey);

      let val = serializeSqlValue(rawVal, this.jsonCols.has(snakeKey));
      updateClauses.push(`"${snakeKey}" = $${idx++}`);
      params.push(val);
    }

    if (updateClauses.length === 0) {
      const rowRes = await query(`SELECT * FROM "${this.tableName}" WHERE id = $1`, [existing.id]);
      return hydrateDocument(rowRes.rows[0], this.tableName, this.jsonCols);
    }

    updateClauses.push(`updated_at = NOW()`);
    params.push(existing.id);

    const sql = `
      UPDATE "${this.tableName}"
      SET ${updateClauses.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;
    const res = await query(sql, params);
    return hydrateDocument(res.rows[0], this.tableName, this.jsonCols);
  }

  private async performPopulate(items: any[], pop: any): Promise<any[]> {
    const path = typeof pop === 'string' ? pop : pop.path;

    if (path === 'subjectId' || path === 'subject') {
      const subjectIds = Array.from(new Set(items.map((i) => {
        const val = i.subjectId !== undefined ? i.subjectId : i.subject_id;
        return (val?._id || val?.id || val)?.toString();
      }).filter(Boolean)));

      if (subjectIds.length > 0) {
        const subRes = await query(`SELECT * FROM "subjects" WHERE id = ANY($1)`, [subjectIds]);
        const subMap = new Map<string, any>();
        subRes.rows.forEach((r) => subMap.set(r.id, hydrateDocument(r, 'subjects', new Set())));

        items.forEach((item) => {
          const val = item.subjectId !== undefined ? item.subjectId : item.subject_id;
          const sId = (val?._id || val?.id || val)?.toString();
          if (sId && subMap.has(sId)) {
            item.subjectId = subMap.get(sId);
            item.subject = item.subjectId;
          }
        });
      }
    } else if (path === 'quizId' || path === 'quiz') {
      const quizIds = Array.from(new Set(items.map((i) => {
        const val = i.quizId !== undefined ? i.quizId : i.quiz_id;
        return (val?._id || val?.id || val)?.toString();
      }).filter(Boolean)));

      if (quizIds.length > 0) {
        const qRes = await query(`SELECT * FROM "quizzes" WHERE id = ANY($1)`, [quizIds]);
        const qMap = new Map<string, any>();
        qRes.rows.forEach((r) => {
          qMap.set(r.id, hydrateDocument(r, 'quizzes', new Set(['topic_ids', 'questions', 'schedule_windows'])));
        });

        // Nested populate if requested (e.g. populate subjectId on quizzes)
        if (pop && typeof pop === 'object' && pop.populate) {
          const nestedPop = Array.isArray(pop.populate) ? pop.populate : [pop.populate];
          const nestedItems = Array.from(qMap.values());
          for (const np of nestedPop) {
            await this.performPopulate(nestedItems, np);
          }
        }

        items.forEach((item) => {
          const val = item.quizId !== undefined ? item.quizId : item.quiz_id;
          const rawQId = (val?._id || val?.id || val)?.toString();
          if (rawQId && qMap.has(rawQId)) {
            item.quizId = qMap.get(rawQId);
            item.quiz = item.quizId;
          }
        });
      }
    } else if (path === 'questions') {
      const allQIds: string[] = [];
      items.forEach((quiz) => {
        const qArr = Array.isArray(quiz.questions) ? quiz.questions : [];
        qArr.forEach((qId: any) => {
          const s = qId?._id ? qId._id.toString() : (qId?.id ? qId.id.toString() : (typeof qId === 'string' ? qId : ''));
          if (s) allQIds.push(s);
        });
      });

      const uniqueQIds = Array.from(new Set(allQIds));
      if (uniqueQIds.length > 0) {
        const qRes = await query(`SELECT * FROM "questions" WHERE id = ANY($1)`, [uniqueQIds]);
        const qMap = new Map<string, any>();
        qRes.rows.forEach((r) => {
          qMap.set(r.id, hydrateDocument(r, 'questions', new Set(['options', 'acceptable_answers'])));
        });

        items.forEach((quiz) => {
          const qArr = Array.isArray(quiz.questions) ? quiz.questions : [];
          quiz.questions = qArr.map((qId: any) => {
            const s = qId?._id ? qId._id.toString() : (qId?.id ? qId.id.toString() : (typeof qId === 'string' ? qId : ''));
            return (s && qMap.get(s)) || qId;
          });
        });
      }
    } else if (path === 'studentId' || path === 'student' || path === 'userId' || path === 'user') {
      const userIds = Array.from(new Set(items.map((i) => {
        const val = i.studentId !== undefined ? i.studentId : (i.userId !== undefined ? i.userId : (i.student_id !== undefined ? i.student_id : i.user_id));
        return (val?._id || val?.id || val)?.toString();
      }).filter(Boolean)));

      if (userIds.length > 0) {
        const uRes = await query(`SELECT * FROM "users" WHERE id = ANY($1)`, [userIds]);
        const uMap = new Map<string, any>();
        uRes.rows.forEach((r) => uMap.set(r.id, hydrateDocument(r, 'users', new Set())));

        const pRes = await query(`SELECT * FROM "student_profiles" WHERE user_id = ANY($1)`, [userIds]);
        const pMap = new Map<string, any>();
        pRes.rows.forEach((r) => pMap.set(r.user_id, hydrateDocument(r, 'student_profiles', new Set())));

        items.forEach((item) => {
          const val = item.studentId !== undefined ? item.studentId : (item.userId !== undefined ? item.userId : (item.student_id !== undefined ? item.student_id : item.user_id));
          const uId = (val?._id || val?.id || val)?.toString();
          if (uId) {
            const uDoc = uMap.get(uId);
            const pDoc = pMap.get(uId);
            const combined = uDoc ? { ...uDoc, ...pDoc, name: pDoc?.fullName || uDoc?.username } : pDoc;
            if (combined) {
              if (item.studentId !== undefined || item.student_id !== undefined) item.studentId = combined;
              if (item.userId !== undefined || item.user_id !== undefined) item.userId = combined;
            }
          }
        });
      }
    } else if (path === 'attemptId' || path === 'attempt') {
      const attemptIds = Array.from(new Set(items.map((i) => {
        const val = i.attemptId !== undefined ? i.attemptId : i.attempt_id;
        return (val?._id || val?.id || val)?.toString();
      }).filter(Boolean)));

      if (attemptIds.length > 0) {
        const attRes = await query(`SELECT * FROM "quiz_attempts" WHERE id = ANY($1)`, [attemptIds]);
        const attMap = new Map<string, any>();
        attRes.rows.forEach((r) => attMap.set(r.id, hydrateDocument(r, 'quiz_attempts', new Set(['shuffled_questions']))));

        items.forEach((item) => {
          const val = item.attemptId !== undefined ? item.attemptId : item.attempt_id;
          const aId = (val?._id || val?.id || val)?.toString();
          if (aId && attMap.has(aId)) {
            item.attemptId = attMap.get(aId);
            item.attempt = item.attemptId;
          }
        });
      }
    } else if (path === 'questionId' || path === 'question') {
      const qIds = Array.from(new Set(items.map((i) => {
        const val = i.questionId !== undefined ? i.questionId : i.question_id;
        return (val?._id || val?.id || val)?.toString();
      }).filter(Boolean)));

      if (qIds.length > 0) {
        const qRes = await query(`SELECT * FROM "questions" WHERE id = ANY($1)`, [qIds]);
        const qMap = new Map<string, any>();
        qRes.rows.forEach((r) => {
          qMap.set(r.id, hydrateDocument(r, 'questions', new Set(['options', 'acceptable_answers'])));
        });

        // Nested populate if requested (e.g. populate topicId on questions)
        if (pop && typeof pop === 'object' && pop.populate) {
          const nestedPop = Array.isArray(pop.populate) ? pop.populate : [pop.populate];
          const nestedItems = Array.from(qMap.values());
          for (const np of nestedPop) {
            await this.performPopulate(nestedItems, np);
          }
        }

        items.forEach((item) => {
          const val = item.questionId !== undefined ? item.questionId : item.question_id;
          const rawId = (val?._id || val?.id || val)?.toString();
          if (rawId && qMap.has(rawId)) {
            item.questionId = qMap.get(rawId);
            item.question = item.questionId;
          }
        });
      }
    } else if (path === 'topicId' || path === 'topic') {
      const topicIds = Array.from(new Set(items.map((i) => {
        const val = i.topicId !== undefined ? i.topicId : i.topic_id;
        return (val?._id || val?.id || val)?.toString();
      }).filter(Boolean)));

      if (topicIds.length > 0) {
        const tRes = await query(`SELECT * FROM "topics" WHERE id = ANY($1)`, [topicIds]);
        const tMap = new Map<string, any>();
        tRes.rows.forEach((r) => {
          tMap.set(r.id, hydrateDocument(r, 'topics', new Set()));
        });

        items.forEach((item) => {
          const val = item.topicId !== undefined ? item.topicId : item.topic_id;
          const rawId = (val?._id || val?.id || val)?.toString();
          if (rawId && tMap.has(rawId)) {
            item.topicId = tMap.get(rawId);
            item.topic = item.topicId;
          }
        });
      }
    }

    return items;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.exec().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.exec().finally(onfinally);
  }

  get [Symbol.toStringTag]() {
    return 'PgQueryBuilder';
  }
}

export class PgModelBase<T = any> {
  public tableName: string;
  public jsonCols: Set<string>;

  constructor(options: ModelOptions) {
    this.tableName = options.tableName;
    this.jsonCols = new Set(options.jsonColumns?.map((c) => toSnakeCase(c)) || []);
  }

  find(filter: QueryFilter = {}): PgQueryBuilder<T[]> {
    return new PgQueryBuilder<T[]>(this.tableName, filter, false, this.jsonCols);
  }

  findOne(filter: QueryFilter = {}): PgQueryBuilder<T | null> {
    return new PgQueryBuilder<T | null>(this.tableName, filter, true, this.jsonCols);
  }

  findById(id: any): PgQueryBuilder<T | null> {
    const idStr = id && id.toString ? id.toString() : String(id);
    return new PgQueryBuilder<T | null>(this.tableName, { id: idStr }, true, this.jsonCols);
  }

  async countDocuments(filter: QueryFilter = {}): Promise<number> {
    const { whereSql, params } = buildWhereClause(filter, 1, this.jsonCols);
    let sql = `SELECT COUNT(*)::int as count FROM "${this.tableName}"`;
    if (whereSql) sql += ` WHERE ${whereSql}`;
    const res = await query(sql, params);
    return res.rows[0]?.count || 0;
  }

  async estimatedDocumentCount(): Promise<number> {
    const res = await query(`SELECT COUNT(*)::int as count FROM "${this.tableName}"`);
    return res.rows[0]?.count || 0;
  }

  async distinct(field: string, filter: QueryFilter = {}): Promise<any[]> {
    const colName = toSnakeCase(field);
    const { whereSql, params } = buildWhereClause(filter, 1, this.jsonCols);
    let sql = `SELECT DISTINCT "${colName}" FROM "${this.tableName}"`;
    if (whereSql) sql += ` WHERE ${whereSql}`;
    const res = await query(sql, params);
    return res.rows.map((r) => r[colName]);
  }

  async create(data: any): Promise<any> {
    if (Array.isArray(data)) {
      return this.insertMany(data);
    }

    const doc = { ...data };
    const id = doc.id || doc._id || generateId();
    doc.id = id.toString();
    delete doc._id;

    const cols: string[] = ['id'];
    const placeholders: string[] = ['$1'];
    const params: any[] = [doc.id];
    let idx = 2;
    const seenCreateCols = new Set<string>(['id']);

    for (const [key, rawVal] of Object.entries(doc)) {
      if (key === 'id') continue;
      if (typeof rawVal === 'function') continue;

      const snakeKey = toSnakeCase(key);
      if (seenCreateCols.has(snakeKey)) continue;
      seenCreateCols.add(snakeKey);

      let val = serializeSqlValue(rawVal, this.jsonCols.has(snakeKey));
      cols.push(`"${snakeKey}"`);
      placeholders.push(`$${idx++}`);
      params.push(val);
    }

    const sql = `
      INSERT INTO "${this.tableName}" (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING *
    `;

    const res = await query(sql, params);
    return hydrateDocument(res.rows[0], this.tableName, this.jsonCols);
  }

  async insertMany(docs: any[]): Promise<any[]> {
    const results: any[] = [];
    for (const d of docs) {
      results.push(await this.create(d));
    }
    return results;
  }

  findByIdAndUpdate(id: any, update: any, options: { new?: boolean; upsert?: boolean } = {}): PgQueryBuilder<T | null> {
    const idStr = id && id.toString ? id.toString() : String(id);
    return this.findOneAndUpdate({ id: idStr }, update, options);
  }

  findOneAndUpdate(filter: QueryFilter, update: any, options: { new?: boolean; upsert?: boolean } = {}): PgQueryBuilder<T | null> {
    return new PgQueryBuilder<T | null>(this.tableName, filter, true, this.jsonCols, true, update, options);
  }

  async updateOne(filter: QueryFilter, update: any): Promise<any> {
    const hasSpecialOps = Boolean(
      update && (update.$pull || update.$push || update.$addToSet || update.$inc)
    );
    if (hasSpecialOps) {
      const doc = await this.findOne(filter);
      if (!doc) return { modifiedCount: 0 };
      applyOperatorsToDoc(doc, update);
      const regularPayload: any = update.$set ? { ...update.$set } : {};
      for (const [k, v] of Object.entries(update)) {
        if (!k.startsWith('$')) regularPayload[k] = v;
      }
      for (const [k, v] of Object.entries(regularPayload)) {
        doc[toCamelCase(k)] = v;
        doc[toSnakeCase(k)] = v;
      }
      await (doc as any).save();
      return { modifiedCount: 1 };
    }

    const payload = update?.$set ? { ...update.$set, ...update } : { ...update };
    for (const k of Object.keys(payload)) {
      if (k.startsWith('$')) delete payload[k];
    }
    if (update?.$unset) {
      for (const k of Object.keys(update.$unset)) {
        payload[k] = null;
      }
      delete payload.$unset;
    }

    const { whereSql, params: wParams } = buildWhereClause(filter, 1, this.jsonCols);
    const updateClauses: string[] = [];
    const uParams: any[] = [];
    let idx = wParams.length + 1;
    const seenUpdateCols = new Set<string>();

    for (const [key, rawVal] of Object.entries(payload)) {
      if (key.startsWith('$') || key === 'id' || key === '_id' || typeof rawVal === 'function') continue;
      const snakeKey = toSnakeCase(key);
      if (snakeKey === 'updated_at') continue;
      if (seenUpdateCols.has(snakeKey)) continue;
      seenUpdateCols.add(snakeKey);

      let val = serializeSqlValue(rawVal, this.jsonCols.has(snakeKey));
      updateClauses.push(`"${snakeKey}" = $${idx++}`);
      uParams.push(val);
    }

    if (updateClauses.length === 0) return { modifiedCount: 0 };
    updateClauses.push(`updated_at = NOW()`);

    let sql = `
      UPDATE "${this.tableName}"
      SET ${updateClauses.join(', ')}
      WHERE id IN (
        SELECT id FROM "${this.tableName}"
        ${whereSql ? `WHERE ${whereSql}` : ''}
        LIMIT 1
      )
    `;
    const res = await query(sql, [...wParams, ...uParams]);
    return { modifiedCount: res.rowCount || 0 };
  }

  async updateMany(filter: QueryFilter, update: any): Promise<any> {
    const hasSpecialOps = Boolean(
      update && (update.$pull || update.$push || update.$addToSet || update.$inc)
    );
    if (hasSpecialOps) {
      const docs = await this.find(filter);
      let count = 0;
      for (const doc of docs) {
        applyOperatorsToDoc(doc, update);
        const regularPayload: any = update.$set ? { ...update.$set } : {};
        for (const [k, v] of Object.entries(update)) {
          if (!k.startsWith('$')) regularPayload[k] = v;
        }
        for (const [k, v] of Object.entries(regularPayload)) {
          doc[toCamelCase(k)] = v;
          doc[toSnakeCase(k)] = v;
        }
        await (doc as any).save();
        count++;
      }
      return { modifiedCount: count };
    }

    const payload = update?.$set ? { ...update.$set, ...update } : { ...update };
    for (const k of Object.keys(payload)) {
      if (k.startsWith('$')) delete payload[k];
    }
    if (update?.$unset) {
      for (const k of Object.keys(update.$unset)) {
        payload[k] = null;
      }
      delete payload.$unset;
    }

    const { whereSql, params: wParams } = buildWhereClause(filter, 1, this.jsonCols);
    const updateClauses: string[] = [];
    const uParams: any[] = [];
    let idx = wParams.length + 1;
    const seenUpdateCols = new Set<string>();

    for (const [key, rawVal] of Object.entries(payload)) {
      if (key.startsWith('$') || key === 'id' || key === '_id' || typeof rawVal === 'function') continue;
      const snakeKey = toSnakeCase(key);
      if (snakeKey === 'updated_at') continue;
      if (seenUpdateCols.has(snakeKey)) continue;
      seenUpdateCols.add(snakeKey);

      let val = serializeSqlValue(rawVal, this.jsonCols.has(snakeKey));
      updateClauses.push(`"${snakeKey}" = $${idx++}`);
      uParams.push(val);
    }

    if (updateClauses.length === 0) return { modifiedCount: 0 };
    updateClauses.push(`updated_at = NOW()`);

    let sql = `
      UPDATE "${this.tableName}"
      SET ${updateClauses.join(', ')}
      ${whereSql ? `WHERE ${whereSql}` : ''}
    `;
    const res = await query(sql, [...wParams, ...uParams]);
    return { modifiedCount: res.rowCount || 0 };
  }

  async bulkWrite(ops: any[], _options: any = {}): Promise<any> {
    if (!ops || ops.length === 0) return { ok: 1 };

    // FAST-PATH 1: student_answers batch upsert by (attempt_id, question_id)
    if (
      this.tableName === 'student_answers' &&
      ops.every((op) => op.updateOne && op.updateOne.filter?.attemptId && op.updateOne.filter?.questionId)
    ) {
      const chunkSize = 200;
      for (let i = 0; i < ops.length; i += chunkSize) {
        const chunk = ops.slice(i, i + chunkSize);
        const placeholders: string[] = [];
        const values: any[] = [];
        let pIdx = 1;

        for (const op of chunk) {
          const filter = op.updateOne.filter;
          const payload = op.updateOne.update?.$set || op.updateOne.update || {};
          const attemptId = (filter.attemptId._id || filter.attemptId).toString();
          const questionId = (filter.questionId._id || filter.questionId).toString();
          const studentId = (payload.studentId || filter.studentId || '').toString();
          const quizId = (payload.quizId || filter.quizId || '').toString();
          const selectedOption = payload.selectedOption || null;
          const displayOption = payload.displayOption || null;
          const textAnswer = payload.textAnswer || null;
          const isCorrect = payload.isCorrect ?? false;
          const marksObtained = payload.marksObtained ?? 0;
          const feedback = payload.evaluationFeedback ?? '';
          const newId = generateId();

          placeholders.push(
            `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, NOW(), NOW())`
          );
          values.push(
            newId,
            attemptId,
            questionId,
            studentId,
            quizId,
            selectedOption,
            displayOption,
            textAnswer,
            isCorrect,
            marksObtained,
            feedback
          );
        }

        const sql = `
          INSERT INTO "student_answers" (
            id, attempt_id, question_id, student_id, quiz_id,
            selected_option, display_option, text_answer, is_correct, marks_obtained, evaluation_feedback,
            created_at, updated_at
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (attempt_id, question_id) DO UPDATE SET
            selected_option = EXCLUDED.selected_option,
            display_option = EXCLUDED.display_option,
            text_answer = EXCLUDED.text_answer,
            is_correct = EXCLUDED.is_correct,
            marks_obtained = EXCLUDED.marks_obtained,
            evaluation_feedback = EXCLUDED.evaluation_feedback,
            updated_at = NOW()
        `;
        await query(sql, values);
      }
      return { ok: 1 };
    }

    // FAST-PATH 2: Batch update by id / _id (e.g. ranking calculation on quiz_results)
    const isAllUpdateById = ops.every((op) => {
      if (!op.updateOne) return false;
      const f = op.updateOne.filter;
      return f && (f.id || f._id) && op.updateOne.update?.$set;
    });

    if (isAllUpdateById && ops.length > 5) {
      const chunkSize = 200;
      for (let i = 0; i < ops.length; i += chunkSize) {
        const chunk = ops.slice(i, i + chunkSize);
        const fieldSet = new Set<string>();
        chunk.forEach((op) => {
          Object.keys(op.updateOne.update.$set).forEach((k) => {
            const sk = toSnakeCase(k);
            if (sk !== 'id' && sk !== 'updated_at') fieldSet.add(sk);
          });
        });
        const fields = Array.from(fieldSet);
        if (fields.length === 0) continue;

        const valueRows: string[] = [];
        const params: any[] = [];
        let pIdx = 1;

        for (const op of chunk) {
          const rowId = (op.updateOne.filter.id || op.updateOne.filter._id).toString();
          const payload = op.updateOne.update.$set;
          const rowPlaceholders: string[] = [`$${pIdx++}`];
          params.push(rowId);

          for (const f of fields) {
            const camel = toCamelCase(f);
            let val = payload[camel] !== undefined ? payload[camel] : payload[f];
            val = serializeSqlValue(val, this.jsonCols.has(f));
            rowPlaceholders.push(`$${pIdx++}`);
            params.push(val === undefined ? null : val);
          }
          valueRows.push(`(${rowPlaceholders.join(', ')})`);
        }

        const setClauses = fields.map((f) => `"${f}" = v."${f}"`).join(', ');
        const vCols = ['id', ...fields.map((f) => `"${f}"`)].join(', ');

        const sql = `
          UPDATE "${this.tableName}" AS t
          SET ${setClauses}, updated_at = NOW()
          FROM (VALUES ${valueRows.join(', ')}) AS v(${vCols})
          WHERE t.id = v.id
        `;
        await query(sql, params);
      }
      return { ok: 1 };
    }

    // Fallback: Run in chunks of 10 concurrently
    const concurrency = 10;
    for (let i = 0; i < ops.length; i += concurrency) {
      const slice = ops.slice(i, i + concurrency);
      await Promise.all(
        slice.map((op) => {
          if (op.updateOne) {
            return this.findOneAndUpdate(op.updateOne.filter, op.updateOne.update, {
              upsert: op.updateOne.upsert,
            });
          } else if (op.updateMany) {
            return this.updateMany(op.updateMany.filter, op.updateMany.update);
          } else if (op.insertOne) {
            return this.create(op.insertOne.document);
          }
          return Promise.resolve();
        })
      );
    }
    return { ok: 1 };
  }

  async aggregate(pipeline: any[]): Promise<any[]> {
    // 1. student_answers group by questionId
    if (this.tableName === 'student_answers') {
      const matchStage = pipeline.find((p) => p.$match);
      const quizId = matchStage?.$match?.quizId;
      const qIdStr = quizId && quizId.toString ? quizId.toString() : quizId;
      const res = await query(
        `SELECT question_id as "_id", COUNT(*)::int as "totalAttempts",
                SUM(CASE WHEN is_correct THEN 1 ELSE 0 END)::int as "correctCount"
         FROM "student_answers"
         WHERE quiz_id = $1
         GROUP BY question_id`,
        [qIdStr]
      );
      return res.rows;
    }

    // 2. student_profiles group by alYear or institute
    if (this.tableName === 'student_profiles') {
      const groupStage = pipeline.find((p) => p.$group);
      if (groupStage?.$group?._id === '$alYear') {
        const res = await query(
          `SELECT al_year as "_id", COUNT(*)::int as "count"
           FROM "student_profiles"
           GROUP BY al_year`
        );
        return res.rows;
      }
      if (groupStage?.$group?._id === '$institute') {
        const res = await query(
          `SELECT institute as "_id", COUNT(*)::int as "count"
           FROM "student_profiles"
           GROUP BY institute`
        );
        return res.rows;
      }
    }

    // 3. quizzes group by targetCategory
    if (this.tableName === 'quizzes') {
      const res = await query(
        `SELECT target_category as "_id", COUNT(*)::int as "count"
         FROM "quizzes"
         GROUP BY target_category`
      );
      return res.rows;
    }

    // 4. essay_submissions group by quizId
    if (this.tableName === 'essay_submissions') {
      const matchStage = pipeline.find((p) => p.$match);
      const quizIds = matchStage?.$match?.quizId?.$in || [];
      const idStrs = quizIds.map((id: any) => (id && id.toString ? id.toString() : id));
      const res = await query(
        `SELECT quiz_id as "_id", COUNT(*)::int as "totalCount",
                SUM(CASE WHEN is_marked THEN 1 ELSE 0 END)::int as "markedCount"
         FROM "essay_submissions"
         WHERE quiz_id = ANY($1)
         GROUP BY quiz_id`,
        [idStrs]
      );
      return res.rows;
    }

    return [];
  }

  async findByIdAndDelete(id: any): Promise<any> {
    const idStr = id && id.toString ? id.toString() : String(id);
    return this.deleteOne({ id: idStr });
  }

  async deleteOne(filter: QueryFilter): Promise<{ deletedCount: number }> {
    const { whereSql, params } = buildWhereClause(filter, 1, this.jsonCols);
    if (!whereSql) return { deletedCount: 0 };

    const sql = `
      DELETE FROM "${this.tableName}"
      WHERE id IN (
        SELECT id FROM "${this.tableName}"
        WHERE ${whereSql}
        LIMIT 1
      )
    `;
    const res = await query(sql, params);
    return { deletedCount: res.rowCount || 0 };
  }

  async deleteMany(filter: QueryFilter = {}): Promise<{ deletedCount: number }> {
    const { whereSql, params } = buildWhereClause(filter, 1, this.jsonCols);
    let sql = `DELETE FROM "${this.tableName}"`;
    if (whereSql) sql += ` WHERE ${whereSql}`;
    const res = await query(sql, params);
    return { deletedCount: res.rowCount || 0 };
  }
}

export type PgModelType<T> = PgModelBase<T> & {
  new (data?: Partial<T>): T & { save: () => Promise<T>; _id: string; id: string };
};

export interface PgModelConstructor {
  new <T = any>(options: ModelOptions): PgModelType<T>;
  <T = any>(options: ModelOptions): PgModelType<T>;
}

export const PgModel: PgModelConstructor = function <T = any>(options: ModelOptions): PgModelType<T> {
  const model = new PgModelBase<T>(options);

  function ModelConstructor(this: any, data: any = {}) {
    if (new.target) {
      return hydrateDocument(data, options.tableName, model.jsonCols);
    }
    return hydrateDocument(data, options.tableName, model.jsonCols);
  }

  Object.setPrototypeOf(ModelConstructor, model);
  Object.assign(ModelConstructor, model);

  return ModelConstructor as any;
} as any;
