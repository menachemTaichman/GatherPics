-- Function to set profile context (called from Python)
CREATE OR REPLACE FUNCTION set_profile_context(key TEXT, value TEXT) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.profile_context.' || key, COALESCE(value, ''), false);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Function to get profile context (used in views)
CREATE OR REPLACE FUNCTION cur_profile(key TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN current_setting('app.profile_context.' || key, true);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Function to set event profile context (called from Python)
CREATE OR REPLACE FUNCTION set_event_profile_context(key TEXT, value TEXT) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.event_profile_context.' || key, COALESCE(value, ''), false);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Function to get event profile context (used in views)
CREATE OR REPLACE FUNCTION cur_event_profile(key TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN current_setting('app.event_profile_context.' || key, true);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get profile context as TEXT
CREATE OR REPLACE FUNCTION cur_profile_text(key TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN cur_profile(key);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get profile context as INTEGER
CREATE OR REPLACE FUNCTION cur_profile_int(key TEXT) RETURNS INTEGER AS $$
DECLARE
    val TEXT;
BEGIN
    val := cur_profile(key);
    IF val IS NULL OR val = '' THEN
        RETURN 0;
    END IF;
    RETURN val::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get profile context as BOOLEAN
CREATE OR REPLACE FUNCTION cur_profile_bool(key TEXT) RETURNS BOOLEAN AS $$
DECLARE
    val TEXT;
BEGIN
    val := cur_profile(key);
    IF val IS NULL OR val = '' THEN
        RETURN FALSE;
    END IF;
    RETURN LOWER(val)::BOOLEAN;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get profile context as UUID
CREATE OR REPLACE FUNCTION cur_profile_uuid(key TEXT) RETURNS UUID AS $$
DECLARE
    val TEXT;
BEGIN
    val := cur_profile(key);
    IF val IS NULL OR val = '' THEN
        RETURN NULL;
    END IF;
    RETURN val::UUID;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get event profile context as TEXT
CREATE OR REPLACE FUNCTION cur_event_profile_text(key TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN cur_event_profile(key);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get event profile context as INTEGER
CREATE OR REPLACE FUNCTION cur_event_profile_int(key TEXT) RETURNS INTEGER AS $$
DECLARE
    val TEXT;
BEGIN
    val := cur_event_profile(key);
    IF val IS NULL OR val = '' THEN
        RETURN 0;
    END IF;
    RETURN val::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get event profile context as BOOLEAN
CREATE OR REPLACE FUNCTION cur_event_profile_bool(key TEXT) RETURNS BOOLEAN AS $$
DECLARE
    val TEXT;
BEGIN
    val := cur_event_profile(key);
    IF val IS NULL OR val = '' THEN
        RETURN FALSE;
    END IF;
    RETURN LOWER(val)::BOOLEAN;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Typed variant: Get event profile context as UUID
CREATE OR REPLACE FUNCTION cur_event_profile_uuid(key TEXT) RETURNS UUID AS $$
DECLARE
    val TEXT;
BEGIN
    val := cur_event_profile(key);
    IF val IS NULL OR val = '' THEN
        RETURN NULL;
    END IF;
    RETURN val::UUID;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Function to set temporary transaction context (called from Python)
CREATE OR REPLACE FUNCTION set_transaction_context(key TEXT, value TEXT) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.transaction_context.' || key, COALESCE(value, ''), false);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Function to get temporary transaction context (used in views)
CREATE OR REPLACE FUNCTION cur_transaction(key TEXT) RETURNS TEXT AS $$
BEGIN
    RETURN current_setting('app.transaction_context.' || key, true);
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- Effective-permissions cache: full refresh (manual/periodic) and worker-driven sync via processing_queue.
-- refresh_*_eff(p_event_id): NULL = full refresh (TRUNCATE + insert all); non-NULL = only that event (DELETE + INSERT).
-- refresh_all_eff(event_id): NULL = full refresh; non-NULL = that event only. Worker calls refresh_all_eff(event_id).

CREATE OR REPLACE FUNCTION refresh_images_eff(p_event_id UUID DEFAULT NULL) RETURNS void AS $$
BEGIN
    IF p_event_id IS NULL THEN
        TRUNCATE images_eff;
    ELSE
        DELETE FROM images_eff WHERE event_id = p_event_id;
    END IF;
    INSERT INTO images_eff (event_id, profile_id, image_id, is_accessible)
    SELECT
        id.event_id,
        id.profile_id,
        id.image_id,
        (id.is_accessible AND (NOT ida.is_archived OR ad.is_accessible)) AS is_accessible
    FROM images_def id
    INNER JOIN images_default_albums ida ON id.image_id = ida.image_id
    INNER JOIN events e ON id.event_id = e.event_id
    INNER JOIN albums_def ad ON e.archive_album_id = ad.album_id AND ad.profile_id = id.profile_id
    WHERE p_event_id IS NULL OR id.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_faces_eff(p_event_id UUID DEFAULT NULL) RETURNS void AS $$
BEGIN
    IF p_event_id IS NULL THEN
        TRUNCATE faces_eff;
    ELSE
        DELETE FROM faces_eff WHERE event_id = p_event_id;
    END IF;
    INSERT INTO faces_eff (event_id, profile_id, face_id, is_accessible)
    SELECT ie.event_id, ie.profile_id, f.face_id, (ie.is_accessible AND gd.is_accessible) AS is_accessible
    FROM faces f
    INNER JOIN images_eff ie ON f.image_id = ie.image_id
    INNER JOIN groups_def gd ON f.group_id = gd.group_id AND gd.profile_id = ie.profile_id
    WHERE p_event_id IS NULL OR ie.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_groups_eff(p_event_id UUID DEFAULT NULL) RETURNS void AS $$
BEGIN
    IF p_event_id IS NULL THEN
        TRUNCATE groups_eff;
    ELSE
        DELETE FROM groups_eff WHERE event_id = p_event_id;
    END IF;
    INSERT INTO groups_eff (event_id, profile_id, group_id, is_accessible)
    SELECT
        gd.event_id,
        gd.profile_id,
        gd.group_id,
        (gd.is_accessible AND (
            ep.can_edit
            OR EXISTS (
                SELECT 1 FROM faces_eff fe
                INNER JOIN faces f ON fe.face_id = f.face_id
                WHERE f.group_id = gd.group_id AND fe.profile_id = gd.profile_id AND fe.is_accessible
            )
        )) AS is_accessible
    FROM groups_def gd
    INNER JOIN events_profiles ep ON gd.event_id = ep.event_id AND gd.profile_id = ep.profile_id
    WHERE p_event_id IS NULL OR gd.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_moments_eff(p_event_id UUID DEFAULT NULL) RETURNS void AS $$
BEGIN
    IF p_event_id IS NULL THEN
        TRUNCATE moments_eff;
    ELSE
        DELETE FROM moments_eff WHERE event_id = p_event_id;
    END IF;
    INSERT INTO moments_eff (event_id, profile_id, moment_id, is_accessible)
    SELECT
        ep.event_id,
        ep.profile_id,
        m.moment_id,
        (ep.can_edit OR EXISTS (
            SELECT 1 FROM images_eff ie
            INNER JOIN images i ON i.image_id = ie.image_id
            WHERE i.moment_id = m.moment_id AND ie.profile_id = ep.profile_id AND ie.is_accessible
        )) AS is_accessible
    FROM moments m
    JOIN events_profiles ep ON m.event_id = ep.event_id
    WHERE p_event_id IS NULL OR ep.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_albums_eff(p_event_id UUID DEFAULT NULL) RETURNS void AS $$
BEGIN
    IF p_event_id IS NULL THEN
        TRUNCATE albums_eff;
    ELSE
        DELETE FROM albums_eff WHERE event_id = p_event_id;
    END IF;
    INSERT INTO albums_eff (event_id, profile_id, album_id, is_accessible)
    SELECT
        ad.event_id,
        ad.profile_id,
        ad.album_id,
        (ad.is_accessible AND (
            ep.can_edit
            OR EXISTS (
                SELECT 1 FROM images_eff ie
                INNER JOIN albums_images ai ON ai.image_id = ie.image_id
                WHERE ai.album_id = ad.album_id AND ie.profile_id = ad.profile_id AND ie.is_accessible
            )
        )) AS is_accessible
    FROM albums_def ad
    INNER JOIN events_profiles ep ON ad.event_id = ep.event_id AND ad.profile_id = ep.profile_id
    WHERE p_event_id IS NULL OR ad.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_all_eff(event_id UUID DEFAULT NULL) RETURNS void AS $$
BEGIN
    PERFORM refresh_images_eff(event_id);
    PERFORM refresh_faces_eff(event_id);
    PERFORM refresh_moments_eff(event_id);
    PERFORM refresh_albums_eff(event_id);
    PERFORM refresh_groups_eff(event_id);
END;
$$ LANGUAGE plpgsql;