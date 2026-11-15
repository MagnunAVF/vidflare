import { VIDEO_STATUSES, VIDEO_VISIBILITIES } from '@vidflare/shared'
import { desc, sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Source of truth for D1 migrations (drizzle-kit generate → migrations/).
// IDs are UUIDv7/ULID strings generated in the Worker; timestamps are integer epoch ms.

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
})

// One channel per user in the MVP.
export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  handle: text('handle').notNull().unique(),
  name: text('name').notNull(),
  avatarKey: text('avatar_key'),
  subscriberCount: integer('subscriber_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const videos = sqliteTable(
  'videos',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    // Null until the Stream direct upload has been created for the row.
    streamUid: text('stream_uid').unique(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: VIDEO_STATUSES }).notNull().default('uploading'),
    visibility: text('visibility', { enum: VIDEO_VISIBILITIES }).notNull().default('public'),
    durationS: integer('duration_s'),
    thumbnailUrl: text('thumbnail_url'),
    // Denormalized counters, kept current by the VideoStats flush and write batches.
    viewCount: integer('view_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    publishedAt: integer('published_at'),
  },
  (t) => [
    check('videos_status_check', sql`${t.status} in (${inList(VIDEO_STATUSES)})`),
    check('videos_visibility_check', sql`${t.visibility} in (${inList(VIDEO_VISIBILITIES)})`),
    // Feeds paginate on (published_at, id), so id is the trailing tie-breaker.
    index('videos_home_feed_idx').on(t.status, t.visibility, desc(t.publishedAt), desc(t.id)),
    index('videos_channel_idx').on(t.channelId, desc(t.publishedAt), desc(t.id)),
  ],
)

export const likes = sqliteTable(
  'likes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  // The composite key is what makes repeat likes a no-op (ON CONFLICT DO NOTHING).
  (t) => [primaryKey({ columns: [t.userId, t.videoId] })],
)

// Flat comments (replies are post-MVP). Deletes are soft: deleted_at is set.
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('comments_video_idx').on(t.videoId, desc(t.createdAt), desc(t.id))],
)

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.subscriberId, t.channelId] }),
    // The PK covers "my subscriptions"; this covers "who subscribes to this channel".
    index('subscriptions_channel_idx').on(t.channelId),
  ],
)
