/**
 * Temp File Utils Tests
 * Unit tests for temporary file utilities
 */

import * as fs from 'fs';
import {
  getTempDir,
  ensureTempDir,
  createTempFilePath,
  saveBufferToTempFile,
  cleanupTempFile,
  verifyFileWritten
} from './tempFileUtils';

// Mock fs module
jest.mock('fs');
jest.mock('./logger', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  return {
    __esModule: true,
    default: mockLogger
  };
});

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('tempFileUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTempDir', () => {
    it('should return temp directory path', () => {
      const result = getTempDir();
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('ensureTempDir', () => {
    it('should return existing directory if it exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      const result = ensureTempDir();
      expect(result).toBeDefined();
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should create directory if it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);
      ensureTempDir();
      expect(mockedFs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('createTempFilePath', () => {
    it('should return full path for filename', () => {
      mockedFs.existsSync.mockReturnValue(true);
      const result = createTempFilePath('test.txt');
      expect(result).toContain('test.txt');
    });
  });

  describe('saveBufferToTempFile', () => {
    it('should save buffer to file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      const buffer = Buffer.from('test data');
      const result = saveBufferToTempFile(buffer, 'test.txt');
      
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      expect(result.fileName).toBe('test.txt');
      expect(result.filePath).toBeDefined();
      expect(result.publicPath).toBe('/static/test.txt');
    });
  });

  describe('cleanupTempFile', () => {
    it('should delete file if it exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      const result = cleanupTempFile('/path/to/file.txt');
      
      expect(mockedFs.unlinkSync).toHaveBeenCalledWith('/path/to/file.txt');
      expect(result).toBe(true);
    });

    it('should return false if file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const result = cleanupTempFile('/path/to/file.txt');
      
      expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should return false on error', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.unlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });
      
      const result = cleanupTempFile('/path/to/file.txt');
      expect(result).toBe(false);
    });
  });

  describe('verifyFileWritten', () => {
    it('should return success if file exists and meets size requirements', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      const mockStats = {
        size: 2000,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: 0,
        nlink: 0,
        uid: 0,
        gid: 0,
        rdev: 0,
        atime: new Date(),
        mtime: new Date(),
        ctime: new Date(),
        birthtime: new Date(),
        blksize: 0,
        blocks: 0
      } as fs.Stats;
      
      mockedFs.statSync.mockReturnValue(mockStats);

      const result = await verifyFileWritten('/path/to/file.txt', 1000, 2);
      
      expect(result.success).toBe(true);
      expect(result.size).toBe(2000);
    }, 10000); // Increase timeout for this test

    it('should return failure if file does not exist after retries', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await verifyFileWritten('/path/to/file.txt', 1000, 2);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    }, 10000); // Increase timeout for this test
  });
});

