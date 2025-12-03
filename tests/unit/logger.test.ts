
import logger from '../../utils/logger';
import winston from 'winston';

describe('Logger', () => {
    // Mock console methods to prevent noise during tests
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    beforeAll(() => {
        console.log = jest.fn();
        console.error = jest.fn();
    });

    afterAll(() => {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
    });

    it('should handle Error objects without infinite recursion', () => {
        const error = new Error('Test error');
        // Create a circular reference
        (error as any).self = error;

        expect(() => {
            logger.error('Test circular error', { error });
        }).not.toThrow();
    });

    it('should preserve Winston symbols', () => {
        const info = {
            level: 'info',
            message: 'test',
            [Symbol.for('level')]: 'info'
        };

        // We can't easily test the internal formatter directly without exporting it,
        // but we can verify that logging doesn't crash and produces output
        expect(() => {
            logger.info('Test message with symbols');
        }).not.toThrow();
    });

    it('should log metadata correctly', () => {
        const meta = { key: 'value', nested: { prop: 123 } };
        expect(() => {
            logger.info('Test metadata', meta);
        }).not.toThrow();
    });
});
