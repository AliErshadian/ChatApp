-- Full-text search index for message content (content, caption, file_name)

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE messages
SET search_vector =
  setweight(to_tsvector('simple', coalesce(content, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(caption, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(file_name, '')), 'C')
WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON messages USING GIN (search_vector);

CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.content, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.caption, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.file_name, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages;

CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE OF content, caption, file_name
  ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_vector_update();
