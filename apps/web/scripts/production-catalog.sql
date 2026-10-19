-- Operational metadata only. Never exports application rows, function bodies,
-- defaults/policy expressions, cron commands, credentials or migration statements.
-- Fingerprints support drift review, not full schema reconstruction/security proof.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog;
SELECT jsonb_build_object(
  'format_version',1,
  'server_version',current_setting('server_version'),
  'extensions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion) ORDER BY extname),'[]') FROM pg_extension),
  'relations',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
    'rls',c.relrowsecurity,'forced_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner)) ORDER BY n.nspname,c.relname),'[]')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage','auth','supabase_migrations') AND c.relkind IN ('r','p','v','m','S')),
  'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,
    'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,
    'default_hash',md5(pg_get_expr(d.adbin,d.adrelid))) ORDER BY n.nspname,c.relname,a.attnum),'[]')
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname IN ('public','private','storage','auth','supabase_migrations') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',x.conname,
    'type',x.contype,'validated',x.convalidated,'definition_hash',md5(pg_get_constraintdef(x.oid))) ORDER BY n.nspname,c.relname,x.conname),'[]')
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage','auth')),
  'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',ic.relname,
    'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definition_hash',md5(pg_get_indexdef(i.indexrelid))) ORDER BY n.nspname,c.relname,ic.relname),'[]')
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage','auth')),
  'views',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'definition_hash',md5(pg_get_viewdef(c.oid)),'security_invoker',coalesce('security_invoker=true'=ANY(c.reloptions),false)) ORDER BY n.nspname,c.relname),'[]')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage','auth') AND c.relkind IN ('v','m')),
  'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,
    'command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END) FROM unnest(p.polroles) r),
    'using_hash',md5(pg_get_expr(p.polqual,p.polrelid)),'check_hash',md5(pg_get_expr(p.polwithcheck,p.polrelid))) ORDER BY n.nspname,c.relname,p.polname),'[]')
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','storage','auth')),
  'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
    'enabled',t.tgenabled,'function',p.proname,'definition_hash',md5(pg_get_triggerdef(t.oid))) ORDER BY n.nspname,c.relname,t.tgname),'[]')
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname IN ('public','private','storage','auth') AND NOT t.tgisinternal),
  'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'security_definer',p.prosecdef,
    'owner',pg_get_userbyid(p.proowner),'volatility',p.provolatile,
    'safe_config',(SELECT coalesce(jsonb_agg(v),'[]') FROM unnest(p.proconfig) v WHERE split_part(v,'=',1) IN ('search_path','statement_timeout','lock_timeout','TimeZone','timezone')),
    'definition_hash',md5(pg_get_functiondef(p.oid)),
    'execute_acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
      'privilege',acl.privilege_type,'grantable',acl.is_grantable)) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl)) ORDER BY n.nspname,p.proname,p.oid),'[]')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','storage','auth') AND p.prokind IN ('f','p')),
  'table_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
    'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,'privilege',acl.privilege_type,'grantable',acl.is_grantable)),'[]')
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) acl
    WHERE n.nspname IN ('public','private','storage','auth') AND c.relkind IN ('r','p','v','m','S')),
  'column_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,
    'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,'privilege',acl.privilege_type,'grantable',acl.is_grantable)),'[]')
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE n.nspname IN ('public','private','storage','auth') AND a.attnum>0 AND NOT a.attisdropped),
  'schema_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
    'privilege',acl.privilege_type,'grantable',acl.is_grantable)),'[]') FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) acl
    WHERE n.nspname IN ('public','private','storage','auth','supabase_migrations')),
  'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(d.defaclrole),'object_type',d.defaclobjtype,
    'grantee',CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,'privilege',acl.privilege_type)),'[]')
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) acl),
  'runtime_roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'bypass_rls',rolbypassrls)),'[]')
    FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
  'runtime_memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('member',member.rolname,'role',parent.rolname,'admin',m.admin_option)),'[]')
    FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE member.rolname IN ('anon','authenticated','service_role')),
  'ledger_present',jsonb_build_object('supabase',to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'worker',to_regclass('private.tehsilbot_node_migrations') IS NOT NULL)
) AS production_catalog;
ROLLBACK;
-- Collect only version/name and name/checksum in a separate READ ONLY query
-- after validating ledger presence/column shape. Never collect migration statements
-- or application/authentication rows.
