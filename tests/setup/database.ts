/**
 * Test Database Setup
 * Manages test database connection and migrations
 */

import { Pool, PoolConfig } from 'pg';
import MigrationRunner from '../../services/conversation/migrationRunner';

let testPool: Pool | null = null;

/**
 * Get or create test database connection pool
 */
export async function getTestPool(): Promise<Pool> {
  if (testPool) {
    return testPool;
  }

  const testDatabaseUrl = process.env.TEST_DATABASE_URL || 
    process.env.DATABASE_URL?.replace(/\/[^/]+$/, '/tasker_test') ||
    'postgresql://localhost:5432/tasker_test';

  const poolConfig: PoolConfig = {
    connectionString: testDatabaseUrl,
    ssl: false, // Test DB is usually local
    max: 5, // Smaller pool for tests
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };

  testPool = new Pool(poolConfig);

  // Test connection
  try {
    const client = await testPool.connect();
    await client.query('SELECT 1');
    client.release();
  } catch (error) {
    throw new Error(`Failed to connect to test database: ${error instanceof Error ? error.message : String(error)}`);
  }

  return testPool;
}

/**
 * Initialize test database with migrations
 */
export async function setupTestDatabase(): Promise<Pool> {
  const pool = await getTestPool();
  
  // Run migrations
  const migrationRunner = new MigrationRunner(pool);
  await migrationRunner.run();

  return pool;
}

/**
 * Clean all tables in test database
 */
export async function cleanTestDatabase(): Promise<void> {
  if (!testPool) {
    return;
  }

  const client = await testPool.connect();
  try {
    // Disable foreign key checks temporarily (PostgreSQL doesn't have this, but we'll use TRUNCATE CASCADE)
    await client.query('BEGIN');
    
    // Get all table names
    const result = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename != 'migrations'
    `);
    
    const tables = result.rows.map((row: { tablename: string }) => row.tablename);
    
    if (tables.length > 0) {
      // Truncate all tables (CASCADE handles foreign keys)
      await client.query(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close test database connection
 */
export async function closeTestDatabase(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

/**
 * Run a query in test database
 */
export async function queryTestDatabase(query: string, params?: unknown[]): Promise<unknown> {
  const pool = await getTestPool();
  const client = await pool.connect();
  try {
    const result = await client.query(query, params);
    return result.rows;
  } finally {
    client.release();
  }
}

