-- Sample data for local development. Generated with fixed ids and timestamps so it is
-- deterministic; re-running it resets these tables to exactly this state.
-- Apply with: pnpm --filter web db:seed:local   (after db:migrate:local)
--
-- Users can't log in yet: password_hash is a placeholder until the auth task defines the
-- PBKDF2 hash format. Stream UIDs are fake, so seeded videos don't play.
-- Public + ready (what feeds show): 7 videos. Also: 1 unlisted, 1 processing, 1 error, 1 uploading.

DELETE FROM subscriptions;
DELETE FROM comments;
DELETE FROM likes;
DELETE FROM videos;
DELETE FROM sessions;
DELETE FROM channels;
DELETE FROM users;

INSERT INTO users (id, email, password_hash, created_at) VALUES
  ('01a0f4c2-c400-7000-8000-000000000001', 'alice@example.com', '!seed-no-login', 1790812800000),
  ('01a0f4f9-b280-7000-8000-000000000002', 'bob@example.com', '!seed-no-login', 1790816400000),
  ('01a0f530-a100-7000-8000-000000000003', 'carol@example.com', '!seed-no-login', 1790820000000);

INSERT INTO channels (id, user_id, handle, name, avatar_key, subscriber_count, created_at) VALUES
  ('01a0f4c2-c401-7000-8000-000000000004', '01a0f4c2-c400-7000-8000-000000000001', 'alice', 'Alice Codes', NULL, 2, 1790812800001),
  ('01a0f4f9-b281-7000-8000-000000000005', '01a0f4f9-b280-7000-8000-000000000002', 'bob', 'Bob Cooks', NULL, 1, 1790816400001),
  ('01a0f530-a101-7000-8000-000000000006', '01a0f530-a100-7000-8000-000000000003', 'carol', 'Carol Travels', NULL, 0, 1790820000001);

INSERT INTO videos (id, channel_id, stream_uid, title, description, status, visibility, duration_s, thumbnail_url, view_count, like_count, comment_count, created_at, published_at) VALUES
  ('01a0f9e9-2000-7000-8000-000000000007', '01a0f4c2-c401-7000-8000-000000000004', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'Building a Worker in 5 minutes', 'Building a Worker in 5 minutes. Sample video seeded for local development.', 'ready', 'public', 312, NULL, 1520, 2, 2, 1790899200000, 1790899800000),
  ('01a0ff0f-7c00-7000-8000-000000000008', '01a0f4c2-c401-7000-8000-000000000004', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2', 'D1 cursor pagination explained', 'D1 cursor pagination explained. Sample video seeded for local development.', 'ready', 'public', 545, NULL, 830, 1, 0, 1790985600000, 1790986200000),
  ('01a10435-d800-7000-8000-000000000009', '01a0f4c2-c401-7000-8000-000000000004', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3', 'Durable Objects for counters', 'Durable Objects for counters. Sample video seeded for local development.', 'ready', 'public', 610, NULL, 410, 0, 0, 1791072000000, 1791072600000),
  ('01a1095c-3400-7000-8000-00000000000a', '01a0f4c2-c401-7000-8000-000000000004', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4', 'Unlisted: draft of the next episode', 'Unlisted: draft of the next episode. Sample video seeded for local development.', 'ready', 'unlisted', 200, NULL, 12, 0, 0, 1791158400000, 1791159000000),
  ('01a10e82-9000-7000-8000-00000000000b', '01a0f4c2-c401-7000-8000-000000000004', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5', 'Still encoding', 'Still encoding. Sample video seeded for local development.', 'processing', 'public', NULL, NULL, 0, 0, 0, 1791244800000, NULL),
  ('01a0fb32-b700-7000-8000-00000000000c', '01a0f4f9-b281-7000-8000-000000000005', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6', 'Perfect pancakes', 'Perfect pancakes. Sample video seeded for local development.', 'ready', 'public', 420, NULL, 2210, 1, 1, 1790920800000, 1790921400000),
  ('01a101a2-aa00-7000-8000-00000000000d', '01a0f4f9-b281-7000-8000-000000000005', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7', 'Weeknight ramen', 'Weeknight ramen. Sample video seeded for local development.', 'ready', 'public', 780, NULL, 990, 0, 0, 1791028800000, 1791029400000),
  ('01a10812-9d00-7000-8000-00000000000e', '01a0f4f9-b281-7000-8000-000000000005', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa8', 'Broken upload', 'Broken upload. Sample video seeded for local development.', 'error', 'public', NULL, NULL, 0, 0, 0, 1791136800000, NULL),
  ('01a0fc7c-4e00-7000-8000-00000000000f', '01a0f530-a101-7000-8000-000000000006', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9', 'Lisbon in a day', 'Lisbon in a day. Sample video seeded for local development.', 'ready', 'public', 905, NULL, 3400, 2, 1, 1790942400000, 1790943000000),
  ('01a102ec-4100-7000-8000-000000000010', '01a0f530-a101-7000-8000-000000000006', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Packing light', 'Packing light. Sample video seeded for local development.', 'ready', 'public', 330, NULL, 640, 0, 0, 1791050400000, 1791051000000),
  ('01a10fcc-2700-7000-8000-000000000011', '01a0f530-a101-7000-8000-000000000006', NULL, 'Upload in progress', 'Upload in progress. Sample video seeded for local development.', 'uploading', 'public', NULL, NULL, 0, 0, 0, 1791266400000, NULL);

INSERT INTO likes (user_id, video_id, created_at) VALUES
  ('01a0f4f9-b280-7000-8000-000000000002', '01a0f9e9-2000-7000-8000-000000000007', 1790903400000),
  ('01a0f530-a100-7000-8000-000000000003', '01a0f9e9-2000-7000-8000-000000000007', 1790907000000),
  ('01a0f530-a100-7000-8000-000000000003', '01a0ff0f-7c00-7000-8000-000000000008', 1790997000000),
  ('01a0f4c2-c400-7000-8000-000000000001', '01a0fb32-b700-7000-8000-00000000000c', 1790935800000),
  ('01a0f4c2-c400-7000-8000-000000000001', '01a0fc7c-4e00-7000-8000-00000000000f', 1790961000000),
  ('01a0f4f9-b280-7000-8000-000000000002', '01a0fc7c-4e00-7000-8000-00000000000f', 1790964600000);

INSERT INTO comments (id, video_id, user_id, body, created_at, deleted_at) VALUES
  ('01a0fa60-24c0-7000-8000-000000000012', '01a0f9e9-2000-7000-8000-000000000007', '01a0f4f9-b280-7000-8000-000000000002', 'Great intro, thanks!', 1790907000000, NULL),
  ('01a0fa97-1340-7000-8000-000000000013', '01a0f9e9-2000-7000-8000-000000000007', '01a0f530-a100-7000-8000-000000000003', 'Can you cover queues next?', 1790910600000, NULL),
  ('01a0fc17-98c0-7000-8000-000000000014', '01a0fb32-b700-7000-8000-00000000000c', '01a0f4c2-c400-7000-8000-000000000001', 'Made these this morning.', 1790935800000, NULL),
  ('01a0fd98-1e40-7000-8000-000000000015', '01a0fc7c-4e00-7000-8000-00000000000f', '01a0f4f9-b280-7000-8000-000000000002', 'Adding this to my list.', 1790961000000, NULL),
  ('01a0fc85-75c0-7000-8000-000000000016', '01a0fb32-b700-7000-8000-00000000000c', '01a0f530-a100-7000-8000-000000000003', 'This comment was deleted.', 1790943000000, 1790946600000);

INSERT INTO subscriptions (subscriber_id, channel_id, created_at) VALUES
  ('01a0f4f9-b280-7000-8000-000000000002', '01a0f4c2-c401-7000-8000-000000000004', 1791316800000),
  ('01a0f530-a100-7000-8000-000000000003', '01a0f4c2-c401-7000-8000-000000000004', 1791320400000),
  ('01a0f4c2-c400-7000-8000-000000000001', '01a0f4f9-b281-7000-8000-000000000005', 1791324000000);
