"""
PostgreSQL functions for cur_profile() and cur_event_profile().
Creates functions for accessing profile and event profile context using session variables.
Uses static default values set from Python code instead of querying database tables.
"""

from yoyo import step

__depends__ = {'0001_initial_schema'}

steps = [
    step(
        """
        -- Function to set profile context (called from Python)
        CREATE OR REPLACE FUNCTION set_profile_context(key TEXT, value TEXT) RETURNS VOID AS $$
        BEGIN
            PERFORM set_config('app.profile_context.' || key, COALESCE(value, ''), false);
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS set_profile_context(TEXT, TEXT)"
    ),
    step(
        """
        -- Function to get profile context (used in views)
        CREATE OR REPLACE FUNCTION cur_profile(key TEXT) RETURNS TEXT AS $$
        DECLARE
            profile_id_val TEXT;
            result_val TEXT;
        BEGIN
            profile_id_val := current_setting('app.profile_context.profile_id', true);
            
            IF profile_id_val IS NULL OR profile_id_val = '' THEN
                RETURN NULL;
            END IF;
            
            IF key = 'profile_id' THEN
                RETURN profile_id_val;
            END IF;
            
            -- Special computed field: is_current_developer
            IF key = 'is_developer' THEN
                IF profile_id_val::UUID = (SELECT developer_id FROM settings WHERE id = 1 LIMIT 1) THEN
                    RETURN 'true';
                ELSE
                    RETURN 'false';
                END IF;
            END IF;
            
            BEGIN
                EXECUTE format('SELECT %I::TEXT FROM profiles WHERE profile_id = $1::UUID', key)
                INTO result_val
                USING profile_id_val;
            END;
            
            RETURN result_val;
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_profile(TEXT)"
    ),
    step(
        """
        -- Function to set event profile context (called from Python)
        CREATE OR REPLACE FUNCTION set_event_profile_context(key TEXT, value TEXT) RETURNS VOID AS $$
        BEGIN
            PERFORM set_config('app.event_profile_context.' || key, COALESCE(value, ''), false);
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS set_event_profile_context(TEXT, TEXT)"
    ),
    step(
        """
        -- Function to get event profile context (used in views)
        CREATE OR REPLACE FUNCTION cur_event_profile(key TEXT) RETURNS TEXT AS $$
        DECLARE
            event_id_val TEXT;
            profile_id_val TEXT;
            result_val TEXT;
        BEGIN
            event_id_val := current_setting('app.event_profile_context.event_id', true);
            profile_id_val := current_setting('app.profile_context.profile_id', true);
            
            IF event_id_val IS NULL OR event_id_val = '' OR profile_id_val IS NULL OR profile_id_val = '' THEN
                RETURN NULL;
            END IF;
            
            IF key = 'event_id' THEN
                RETURN event_id_val;
            END IF;
            
            BEGIN
                EXECUTE format('SELECT %I::TEXT FROM events_profiles WHERE event_id = $1::UUID AND profile_id = $2::UUID', key)
                INTO result_val
                USING event_id_val, profile_id_val;
            END;
            
            RETURN result_val;
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_event_profile(TEXT)"
    ),
    step(
        """
        -- Typed variant: Get profile context as TEXT
        CREATE OR REPLACE FUNCTION cur_profile_text(key TEXT) RETURNS TEXT AS $$
        BEGIN
            RETURN cur_profile(key);
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_profile_text(TEXT)"
    ),
    step(
        """
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
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_profile_int(TEXT)"
    ),
    step(
        """
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
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_profile_bool(TEXT)"
    ),
    step(
        """
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
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_profile_uuid(TEXT)"
    ),
    step(
        """
        -- Typed variant: Get event profile context as TEXT
        CREATE OR REPLACE FUNCTION cur_event_profile_text(key TEXT) RETURNS TEXT AS $$
        BEGIN
            RETURN cur_event_profile(key);
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_event_profile_text(TEXT)"
    ),
    step(
        """
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
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_event_profile_int(TEXT)"
    ),
    step(
        """
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
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_event_profile_bool(TEXT)"
    ),
    step(
        """
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
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_event_profile_uuid(TEXT)"
    ),
    step(
        """
        -- Function to set temporary transaction context (called from Python)
        CREATE OR REPLACE FUNCTION set_transaction_context(key TEXT, value TEXT) RETURNS VOID AS $$
        BEGIN
            PERFORM set_config('app.transaction_context.' || key, COALESCE(value, ''), false);
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS set_transaction_context(TEXT, TEXT)"
    ),
    step(
        """
        -- Function to get temporary transaction context (used in views)
        CREATE OR REPLACE FUNCTION cur_transaction(key TEXT) RETURNS TEXT AS $$
        BEGIN
            RETURN current_setting('app.transaction_context.' || key, true);
        END;
        $$ LANGUAGE plpgsql STABLE;
        """,
        "DROP FUNCTION IF EXISTS cur_transaction(TEXT)"
    ),
]

