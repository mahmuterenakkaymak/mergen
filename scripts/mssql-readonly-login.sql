-- Read-only SQL login for MERGEN's mssql MCP (local SQL Server Express).
-- The MCP server can run INSERT/UPDATE/DELETE, so "read-only" must come from this login's permissions.
--
-- Run it yourself (it creates a login with a password - the assistant does not do that):
--   1. Replace <PAROLA> below with a strong password.
--   2. sqlcmd -S "localhost\SQLEXPRESS" -E -i scripts\mssql-readonly-login.sql
--   3. [Environment]::SetEnvironmentVariable("MSSQL_PASSWORD", "<same password>", "User")
--   4. openclaw gateway restart ; openclaw mcp configure mssql --enable --probe
-- Then delete the password from this file again (don't commit it).

USE master;
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'mergen_ro')
    CREATE LOGIN mergen_ro WITH PASSWORD = N'<PAROLA>', CHECK_POLICY = ON, DEFAULT_DATABASE = <YOUR_DB>;
GO

-- Read access only, per database. Add more databases the same way.
USE <YOUR_DB>;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mergen_ro')
    CREATE USER mergen_ro FOR LOGIN mergen_ro;
ALTER ROLE db_datareader ADD MEMBER mergen_ro;
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER TO mergen_ro;
GO

USE <YOUR_SECOND_DB>;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'mergen_ro')
    CREATE USER mergen_ro FOR LOGIN mergen_ro;
ALTER ROLE db_datareader ADD MEMBER mergen_ro;
DENY INSERT, UPDATE, DELETE, EXECUTE, ALTER TO mergen_ro;
GO

-- Check: should list db_datareader only, and the DENY rows.
USE <YOUR_DB>;
SELECT dp.name, r.name AS role_name
FROM sys.database_role_members m
JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
JOIN sys.database_principals dp ON dp.principal_id = m.member_principal_id
WHERE dp.name = N'mergen_ro';
GO
