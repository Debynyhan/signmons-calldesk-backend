-- Enable row-level security on all tables with a tenantId column and enforce tenant/role checks.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'tenantId'
      AND table_schema = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;', r.table_schema, r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I;', r.table_schema, r.table_name);
    EXECUTE format(
      $$CREATE POLICY tenant_isolation ON %I.%I
        USING (
          COALESCE(current_setting('app.current_role', true), '') = 'admin'
          OR "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')::uuid
        );$$,
      r.table_schema,
      r.table_name
    );
  END LOOP;
END$$;
