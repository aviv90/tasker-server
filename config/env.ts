import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
    env: 'development' | 'production' | 'test';
    port: number;
    logLevel: string;
    enableFileLogging: boolean;
    logDir: string;

    database: {
        url: string;
        testUrl?: string;
    };

    whatsapp: {
        instanceId: string;
        apiToken: string;
        webhookToken?: string;
    };

    ai: {
        gemini: {
            apiKey: string;
        };
        openai: {
            apiKey: string;
        };
        grok: {
            apiKey: string;
        };
        replicate: {
            apiKey: string;
        };
        elevenlabs: {
            apiKey: string;
        };
        kie: {
            apiKey: string;
        };
    };

    googleDrive: {
        folderId: string;
        serviceAccountEmail: string;
        serviceAccountPrivateKey: string;
    };
}

const getEnv = (key: string, defaultValue: string = ''): string => {
    const value = process.env[key];
    if (!value && !defaultValue && process.env.NODE_ENV === 'production') {
        // In production, missing critical keys might be fatal, but we'll just warn for now
        // console.warn(`⚠️ Missing environment variable: ${key}`);
    }
    return value || defaultValue;
};

const config: Config = {
    env: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true',
    logDir: process.env.LOG_DIR || path.join(__dirname, '../../logs'),

    database: {
        url: getEnv('DATABASE_URL'),
        testUrl: getEnv('TEST_DATABASE_URL'),
    },

    whatsapp: {
        instanceId: getEnv('GREEN_API_ID_INSTANCE'),
        apiToken: getEnv('GREEN_API_API_TOKEN_INSTANCE'),
        webhookToken: getEnv('GREEN_API_WEBHOOK_TOKEN'),
    },

    ai: {
        gemini: {
            apiKey: getEnv('GEMINI_API_KEY'),
        },
        openai: {
            apiKey: getEnv('OPENAI_API_KEY'),
        },
        grok: {
            apiKey: getEnv('GROK_API_KEY'),
        },
        replicate: {
            apiKey: getEnv('REPLICATE_API_KEY'),
        },
        elevenlabs: {
            apiKey: getEnv('ELEVENLABS_API_KEY'),
        },
        kie: {
            apiKey: getEnv('KIE_API_KEY'),
        },
    },

    googleDrive: {
        folderId: getEnv('GOOGLE_DRIVE_FOLDER_ID'),
        serviceAccountEmail: getEnv('GOOGLE_DRIVE_SA_CLIENT_EMAIL'),
        serviceAccountPrivateKey: getEnv('GOOGLE_DRIVE_SA_PRIVATE_KEY'),
    },
};

export default config;
