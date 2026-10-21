-- INHA WORLD F10/F11 CANDIDATE: isolated Supabase branch ONLY.
-- Not a formal production migration. Never apply to GAMES Production without new forward
-- migration, review, schema diff, disposable replay, service and browser gates.
-- PRECONDITIONS: existing private schema, profiles, auth.sessions, room access and kick-block table.
-- `realtime.messages` must exist with the current campus/room RLS policies.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

-- Credentials and challenge nonces never enter `public` or `realtime` tables.
CREATE TABLE IF NOT EXISTS private.world_ri_challenges (
  id uuid PRIMARY KEY,
  nonce text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('register','renew','leave')),
  topic text NOT NULL,
  sid uuid,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id uuid NOT NULL,
  public_jwk jsonb NOT NULL,
  key_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS world_ri_challenges_user_expiry_idx ON private.world_ri_challenges(user_id,expires_at);
CREATE TABLE IF NOT EXISTS private.world_ri_sessions (
  sid uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auth_session_id uuid NOT NULL,
  guest boolean NOT NULL,
  display_name text NOT NULL,
  topic text NOT NULL,
  epoch bigint NOT NULL CHECK (epoch >= 1),
  public_jwk jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revision bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS world_ri_sessions_topic_expiry_idx ON private.world_ri_sessions(topic,expires_at);
CREATE INDEX IF NOT EXISTS world_ri_sessions_user_idx ON private.world_ri_sessions(user_id);
CREATE TABLE IF NOT EXISTS private.world_ri_topic_revisions (
  topic text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

ALTER TABLE private.world_ri_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.world_ri_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.world_ri_topic_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.world_ri_challenges,private.world_ri_sessions,private.world_ri_topic_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE private.world_ri_challenges,private.world_ri_sessions,private.world_ri_topic_revisions TO service_role;

-- Private read helper: this returns a BOOLEAN to RLS, not a player roster.
-- The real snapshot endpoint performs a separate authenticated HTTP authorization check.
CREATE OR REPLACE FUNCTION public.world_ri_can_read_trusted_topic_v1(p_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $body$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_source text;
BEGIN
  IF v_uid IS NULL OR p_topic IS NULL THEN RETURN FALSE; END IF;
  IF p_topic ~ '^world:trusted:campus:AREA_[A-Z0-9_]{1,60}$' THEN
    v_source := replace(p_topic,'world:trusted:','world:');
  ELSIF p_topic ~ '^world:trusted:room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_source := replace(p_topic,'world:trusted:','world:');
    IF private.world_room_access_v1(v_uid,substring(v_source from 12)::uuid) NOT IN ('OWNER','VISITOR') THEN
      RETURN FALSE;
    END IF;
  ELSE
    RETURN FALSE;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=v_uid AND p.is_banned=TRUE) THEN RETURN FALSE; END IF;
  IF EXISTS (SELECT 1 FROM private.world_session_kick_blocks k WHERE k.user_id=v_uid AND k.blocked_until>now()) THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM private.world_ri_sessions s
    WHERE s.user_id=v_uid AND s.topic=v_source AND s.revoked_at IS NULL
      AND s.expires_at>now()
      AND EXISTS(SELECT 1 FROM auth.sessions a WHERE a.user_id=v_uid AND a.id=s.auth_session_id)
  );
END;
$body$;
REVOKE ALL ON FUNCTION public.world_ri_can_read_trusted_topic_v1(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.world_ri_can_read_trusted_topic_v1(text) TO authenticated;

-- SELECT-only trusted registry; no INSERT policy for web users, no client Presence.
-- Realtime server/service_role publish is separately verified on the hosted branch.
CREATE POLICY "world ri trusted directory read"
  ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast'
    AND public.world_ri_can_read_trusted_topic_v1((SELECT realtime.topic())));
COMMIT;

-- REQUIRED PRE-DEPLOY checks on the isolated branch:
-- SELECT policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='realtime' AND tablename='messages';
-- No permissive INSERT policy may allow `world:trusted:*` for authenticated/anonymous JWTs.
-- Verify `Allow public access` is off and test REAL join/send as both users.
-- Do NOT rely on SQL simulation to prove service-only broadcast delivery.
