-- 011_atomic_invite_consume.sql
-- 초대코드 소비를 atomic하게 처리하는 PostgreSQL 함수
-- 동시에 여러 사용자가 같은 코드를 사용해도 max_uses를 초과하지 않도록 보장
--
-- 현재 verification_service.py는 Python 레벨 optimistic concurrency로 동일한 보장을 제공합니다.
-- 이 함수를 DB에 적용하면 supabase.rpc("consume_invite_code_atomic", ...) 방식으로
-- Python 코드를 전환해 DB 레벨에서 더 강한 직렬화를 보장할 수 있습니다.

CREATE OR REPLACE FUNCTION consume_invite_code_atomic(p_code TEXT)
RETURNS TABLE (
    id          UUID,
    code        TEXT,
    role        TEXT,
    used_count  INT,
    max_uses    INT,
    active      BOOLEAN,
    consumed    BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invite invite_codes%ROWTYPE;
    v_next_used INT;
BEGIN
    -- 행 잠금으로 동시 접근 직렬화
    SELECT *
    INTO v_invite
    FROM invite_codes
    WHERE invite_codes.code = UPPER(TRIM(p_code))
      AND invite_codes.active = TRUE
    FOR UPDATE;

    IF NOT FOUND THEN
        -- 코드 없음 또는 비활성
        RETURN QUERY
            SELECT NULL::UUID, p_code::TEXT, NULL::TEXT,
                   0::INT, 0::INT, FALSE, FALSE;
        RETURN;
    END IF;

    -- 만료 시간 확인
    IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < NOW() THEN
        RETURN QUERY
            SELECT v_invite.id, v_invite.code, v_invite.role,
                   v_invite.used_count::INT, v_invite.max_uses::INT,
                   FALSE, FALSE;
        RETURN;
    END IF;

    -- 사용 횟수 한계 확인
    IF v_invite.used_count >= v_invite.max_uses THEN
        RETURN QUERY
            SELECT v_invite.id, v_invite.code, v_invite.role,
                   v_invite.used_count::INT, v_invite.max_uses::INT,
                   FALSE, FALSE;
        RETURN;
    END IF;

    -- Atomic increment
    v_next_used := v_invite.used_count + 1;

    UPDATE invite_codes
    SET used_count  = v_next_used,
        active      = (v_next_used < v_invite.max_uses),
        updated_at  = NOW()
    WHERE invite_codes.id = v_invite.id;

    RETURN QUERY
        SELECT v_invite.id, v_invite.code, v_invite.role,
               v_next_used::INT, v_invite.max_uses::INT,
               (v_next_used < v_invite.max_uses), TRUE;
END;
$$;
