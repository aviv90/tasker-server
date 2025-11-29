/**
 * Google Drive Service Mock
 * Mock implementation of Google Drive service for tests
 */

export const mockGoogleDriveService = {
  searchFiles: jest.fn().mockResolvedValue([
    {
      id: 'mock-file-id-1',
      name: 'Mock File 1',
      mimeType: 'application/pdf'
    },
    {
      id: 'mock-file-id-2',
      name: 'Mock File 2',
      mimeType: 'text/plain'
    }
  ]),

  getFileMetadata: jest.fn().mockResolvedValue({
    id: 'mock-file-id',
    name: 'Mock File',
    mimeType: 'application/pdf',
    size: 1024,
    createdTime: '2024-01-01T00:00:00Z',
    modifiedTime: '2024-01-01T00:00:00Z'
  }),

  downloadFile: jest.fn().mockResolvedValue({
    buffer: Buffer.from('mock-file-content'),
    mimeType: 'application/pdf'
  }),

  extractTextFromDocument: jest.fn().mockResolvedValue({
    text: 'Mock extracted text from document',
    pageCount: 1
  }),

  searchAndExtractRelevantInfo: jest.fn().mockResolvedValue({
    text: 'Mock relevant information extracted',
    files: [
      {
        id: 'mock-file-id',
        name: 'Mock File',
        relevantText: 'Mock relevant text'
      }
    ]
  }),

  getAuthenticatedDriveClient: jest.fn().mockResolvedValue({
    // Mock Google Drive client
    files: {
      list: jest.fn(),
      get: jest.fn(),
      export: jest.fn()
    }
  })
};

// Default export for convenience
export default mockGoogleDriveService;

