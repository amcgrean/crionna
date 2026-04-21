import {
  pgTable,
  text,
  integer,
  real,
  timestamp,
  pgEnum,
  jsonb,
  uuid,
} from 'drizzle-orm/pg-core';

export const retailerEnum = pgEnum('retailer', [
  'Walmart',
  'Target',
  'Costco',
  'Amazon',
  'Other',
]);

export const tierEnum = pgEnum('tier', ['premium', 'national', 'store']);

export const unitTypeEnum = pgEnum('unit_type', [
  'area',
  'volume',
  'weight',
  'count',
]);

export const sourceTypeEnum = pgEnum('source_type', [
  'url',
  'screenshot',
  'photo',
  'manual',
]);

export const ingestionStatusEnum = pgEnum('ingestion_status', [
  'saved',
  'saved_with_corrections',
  'abandoned',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  label: text('label').notNull(),
  baseUnit: text('base_unit').notNull(),
  unitType: unitTypeEnum('unit_type').notNull(),
  // JSON: maps item spec keys to the math used for normalization
  normalizationSpec: jsonb('normalization_spec').notNull(),
});

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  retailer: retailerEnum('retailer').notNull(),
  brand: text('brand').notNull(),
  name: text('name').notNull(),
  url: text('url'),
  imageUrl: text('image_url'),
  upc: text('upc'),
  tier: tierEnum('tier'),
  // 1-5, user-set — never inferred
  quality: integer('quality'),
  notes: text('notes'),
  // category-specific fields validated at app layer via Zod per category
  specs: jsonb('specs').notNull().default('{}'),
  currentPrice: real('current_price'),
  currentPromoPrice: real('current_promo_price'),
  currentPromoLabel: text('current_promo_label'),
  lastUpdated: timestamp('last_updated').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const prices = pgTable('prices', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id),
  price: real('price').notNull(),
  promoPrice: real('promo_price'),
  promoLabel: text('promo_label'),
  source: sourceTypeEnum('source').notNull(),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
});

// Index/metadata only — full log lives in crionna-ingestion-log git repo
export const ingestionLogs = pgTable('ingestion_logs', {
  id: text('id').primaryKey(), // ULID
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  itemId: uuid('item_id').references(() => items.id),
  sourceType: sourceTypeEnum('source_type').notNull(),
  // repo-relative path e.g. 2026-04/01HXYZ_bounty-paper-towels.md
  logFilePath: text('log_file_path'),
  status: ingestionStatusEnum('status').notNull().default('saved'),
  correctionCount: integer('correction_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
