-- The server-side checkout RPC is SECURITY INVOKER and normalizes delivery
-- barangays through this private helper. Keep the private schema closed to
-- browser roles while allowing only the server role's required dependency.
grant usage on schema private to service_role;
grant execute on function private.stlolab_place_key(text) to service_role;

revoke usage on schema private from public, anon, authenticated;
revoke execute on function private.stlolab_place_key(text) from public, anon, authenticated;
