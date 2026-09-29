-- M2-T3: household join codes, and the three narrow doors through which a
-- membership is created or listed.
--
-- Approved by the architect for local and CI databases only (CLAUDE.md rule
-- 16, BACKLOG.md M2-T3 (f)). Nothing here rewrites or deletes existing data.
--
-- WHAT UP DOES
--
-- 1. Creates `household_join_codes`: one row per code ever issued for a
--    household. The plaintext code is never stored. `code_hash` is the hex
--    HMAC-SHA-256 of the normalised code under a server-side pepper (computed
--    in `apps/api/src/db/households/join-code.ts`), so a copy of this table on
--    its own does not let anyone rebuild a code by enumerating the small code
--    space. `code_hash` is the primary key, which makes it unique across every
--    household and every code, revoked ones included, so a revoked code can
--    never come back as somebody else's live code.
--    A partial unique index allows at most one live (unrevoked) code per
--    household, which is what makes "rotate" mean "the old one stops working".
--    A trigger makes `revoked_at` one-way: it can be set once, never cleared
--    or moved, and no other column can change.
-- 2. Row-level security on the new table with the same shape as 0006: a
--    session sees and writes only its own household's rows. `sk_app` gets
--    SELECT, INSERT and UPDATE of `revoked_at` only. No DELETE.
-- 3. Three SECURITY DEFINER functions. They exist because the two writes that
--    change who can see what (create a household, join one) and the one read
--    that decides which household a request runs as (list a user's
--    memberships) cannot be expressed as a household-scoped statement: the
--    caller is, by definition, not yet inside the household in question.
--    `sk_app` still holds no INSERT on `household_memberships` and no INSERT
--    on `households`; these functions are the only way a membership row is
--    created at runtime, and each creates exactly one, for the user id passed.
--      * `app_create_household(household, name, owner, membership)` inserts a
--        brand-new household and its owner membership. It refuses unless the
--        transaction's household context is already that new id, and the
--        household insert fails on an existing id, so it cannot be aimed at an
--        existing household.
--      * `app_redeem_join_code(code_hash, user, membership)` finds a live code
--        and inserts one `member` membership for the user, or nothing if the
--        user already belongs (idempotent). An unknown or revoked code returns
--        no row at all, identical to each other.
--      * `app_user_memberships(user)` lists one user's memberships, newest
--        first, with each household's name, for the identity port (OQ-E1:
--        the set of permitted households comes only from the port) and for
--        `GET /v1/households/mine`. It reveals nothing about a household the
--        user is not in.
--    EXECUTE is revoked from PUBLIC and granted to `sk_app` only. search_path
--    is pinned, as in 0004, so the definer's rights cannot be redirected.
--
-- WHAT DOWN DOES
--
-- Drops the three functions, the trigger and its function, the policy, the
-- grants and the table, in reverse order. Every issued join code is lost with
-- the table. Households and memberships created through the functions stay,
-- because they live in 0002's tables and are ordinary rows once written;
-- after a down, the runtime simply has no way to create more. Re-running up
-- recreates an empty table, so existing households have no live code until
-- an owner rotates one (or the dev seed issues CHEN-482 again).

-- Up Migration

CREATE TABLE household_join_codes (
  code_hash     text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  household_id  uuid NOT NULL REFERENCES households (id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  CONSTRAINT household_join_codes_revoked_after_created
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

COMMENT ON TABLE household_join_codes IS
  'Join codes, hashed (HMAC-SHA-256 under a server pepper). Plaintext is returned once, at issue, and never stored or logged.';

-- At most one live code per household.
CREATE UNIQUE INDEX household_join_codes_one_live
  ON household_join_codes (household_id)
  WHERE revoked_at IS NULL;

-- `revoked_at` is set once and then frozen; nothing else ever changes.
CREATE FUNCTION household_join_codes_revoke_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked join code stays revoked'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'an update to a join code may only revoke it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.code_hash IS DISTINCT FROM OLD.code_hash
     OR NEW.household_id IS DISTINCT FROM OLD.household_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only revoked_at may change on a join code'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER household_join_codes_revoke_only
  BEFORE UPDATE ON household_join_codes
  FOR EACH ROW EXECUTE FUNCTION household_join_codes_revoke_only();

ALTER TABLE household_join_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY household_join_codes_current ON household_join_codes
  USING (household_id = app_current_household())
  WITH CHECK (household_id = app_current_household());

GRANT SELECT, INSERT ON household_join_codes TO sk_app;
GRANT UPDATE (revoked_at) ON household_join_codes TO sk_app;

-- --- Membership doors -------------------------------------------------------

CREATE FUNCTION app_create_household(
  p_household_id  uuid,
  p_name          text,
  p_owner_user_id uuid,
  p_membership_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_household_id IS NULL OR p_household_id IS DISTINCT FROM app_current_household() THEN
    RAISE EXCEPTION 'app_create_household must run inside the new household''s own context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A plain INSERT: an existing id is a unique violation, never a join.
  INSERT INTO households (id, name) VALUES (p_household_id, p_name);
  INSERT INTO household_memberships (id, household_id, user_id, role)
    VALUES (p_membership_id, p_household_id, p_owner_user_id, 'owner');
END
$$;

CREATE FUNCTION app_redeem_join_code(
  p_code_hash     text,
  p_user_id       uuid,
  p_membership_id uuid
) RETURNS TABLE (household_id uuid, joined boolean, member_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_household_id uuid;
  v_inserted     integer;
  v_role         text;
BEGIN
  -- FOR SHARE so a concurrent rotation and a join serialise: whichever commits
  -- first decides, and a join never lands on a code revoked before it read it.
  SELECT c.household_id INTO v_household_id
    FROM household_join_codes AS c
   WHERE c.code_hash = p_code_hash
     AND c.revoked_at IS NULL
     FOR SHARE;
  IF v_household_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO household_memberships (id, household_id, user_id, role)
    VALUES (p_membership_id, v_household_id, p_user_id, 'member')
    ON CONFLICT ON CONSTRAINT household_memberships_unique_member DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- The caller's role in the household now: `member` for a new join, and
  -- whatever it already was (possibly `owner`) for an idempotent re-join.
  SELECT m.role INTO v_role
    FROM household_memberships AS m
   WHERE m.household_id = v_household_id
     AND m.user_id = p_user_id;

  household_id := v_household_id;
  joined := v_inserted = 1;
  member_role := v_role;
  RETURN NEXT;
END
$$;

CREATE FUNCTION app_user_memberships(p_user_id uuid)
RETURNS TABLE (household_id uuid, role text, joined_at timestamptz, household_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.household_id, m.role, m.created_at, h.name
    FROM household_memberships AS m
    JOIN households AS h ON h.id = m.household_id
   WHERE m.user_id = p_user_id
   ORDER BY m.created_at DESC, m.household_id DESC
$$;

REVOKE ALL ON FUNCTION app_create_household(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_redeem_join_code(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_user_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_household(uuid, text, uuid, uuid) TO sk_app;
GRANT EXECUTE ON FUNCTION app_redeem_join_code(text, uuid, uuid) TO sk_app;
GRANT EXECUTE ON FUNCTION app_user_memberships(uuid) TO sk_app;

-- Down Migration

REVOKE ALL ON FUNCTION app_user_memberships(uuid) FROM sk_app;
REVOKE ALL ON FUNCTION app_redeem_join_code(text, uuid, uuid) FROM sk_app;
REVOKE ALL ON FUNCTION app_create_household(uuid, text, uuid, uuid) FROM sk_app;
DROP FUNCTION app_user_memberships(uuid);
DROP FUNCTION app_redeem_join_code(text, uuid, uuid);
DROP FUNCTION app_create_household(uuid, text, uuid, uuid);

REVOKE ALL ON household_join_codes FROM sk_app;
DROP POLICY household_join_codes_current ON household_join_codes;
DROP TRIGGER household_join_codes_revoke_only ON household_join_codes;
DROP FUNCTION household_join_codes_revoke_only();
DROP TABLE household_join_codes;
