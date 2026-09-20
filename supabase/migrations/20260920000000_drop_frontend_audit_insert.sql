-- 运营后台精简：删除已被服务端 RPC 审计取代的前端审计写入链路
begin;
drop policy if exists "audit_logs_insert_admin" on public.audit_logs;
revoke insert on public.audit_logs from authenticated;
commit;
