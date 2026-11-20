-- Full-text search over video titles and descriptions (GET /api/search).
-- Hand-written: drizzle-kit can't express FTS5 virtual tables or triggers, so this table is not
-- in db/schema.ts. Search joins it back to `videos` on video_id and applies the public-listing
-- filter there, so every video is indexed whatever its status or visibility.
--
-- A standalone FTS table (it keeps its own copy of the text) keyed by video_id rather than an
-- external-content table on videos.rowid: `videos` has a TEXT primary key, so its implicit rowid
-- is not guaranteed stable (VACUUM may renumber it) and the index could silently drift.
-- unicode61 with remove_diacritics 2 folds case and accents ("café" matches "cafe"); the prefix
-- indexes keep the search-as-you-type prefix query on the last word cheap.
CREATE VIRTUAL TABLE `videos_fts` USING fts5(
  `video_id` UNINDEXED,
  `title`,
  `description`,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

-- Index the videos that already exist.
INSERT INTO `videos_fts` (`video_id`, `title`, `description`)
SELECT `id`, `title`, `description` FROM `videos`;

CREATE TRIGGER `videos_fts_after_insert` AFTER INSERT ON `videos` BEGIN
  INSERT INTO `videos_fts` (`video_id`, `title`, `description`)
  VALUES (new.`id`, new.`title`, new.`description`);
END;

-- Only text edits re-index; counter, status and visibility updates don't touch the index.
CREATE TRIGGER `videos_fts_after_update` AFTER UPDATE OF `title`, `description` ON `videos` BEGIN
  DELETE FROM `videos_fts` WHERE `video_id` = old.`id`;
  INSERT INTO `videos_fts` (`video_id`, `title`, `description`)
  VALUES (new.`id`, new.`title`, new.`description`);
END;

-- Also fires for rows removed by ON DELETE CASCADE (a deleted channel's videos).
CREATE TRIGGER `videos_fts_after_delete` AFTER DELETE ON `videos` BEGIN
  DELETE FROM `videos_fts` WHERE `video_id` = old.`id`;
END;
