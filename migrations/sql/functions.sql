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