/**
 * Database Mock
 * Mock implementation of database pool and client for tests
 */

import { Pool, PoolClient } from 'pg';

/**
 * Create a mock pool client
 */
export function createMockPoolClient(): jest.Mocked<PoolClient> {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    // Add other PoolClient methods as needed
  } as unknown as jest.Mocked<PoolClient>;
}

/**
 * Create a mock pool
 */
export function createMockPool(): jest.Mocked<Pool> {
  const mockClient = createMockPoolClient();
  
  return {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined),
    // Add other Pool methods as needed
  } as unknown as jest.Mocked<Pool>;
}

