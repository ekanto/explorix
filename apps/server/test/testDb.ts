import 'dotenv/config';

/** Integration tests run against a separate database on the same server: `<name>_test`. */
export function testDatabaseUrl() {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://explorix:explorix@localhost:54329/explorix';
  if (process.env.TEST_DATABASE_URL) return base;
  const u = new URL(base);
  const name = u.pathname.replace(/^\//, '') || 'explorix';
  u.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return u.toString();
}
