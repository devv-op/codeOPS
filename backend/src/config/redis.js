require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { createClient } = require('redis');

const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_PASSWORD = process.env.REDIS_PASS;

if (!REDIS_HOST || !REDIS_PORT || !REDIS_PASSWORD) {
    console.warn('⚠️  Redis configuration incomplete - Redis features will be disabled');
    console.warn('💡 Set REDIS_HOST, REDIS_PORT, and REDIS_PASS to enable Redis');
    module.exports = {
        isOpen: false,
        connect: async () => { console.log('⚠️  Redis disabled - skipping connection'); },
        quit: async () => { },
        get: async () => null,
        set: async () => null,
        setEx: async () => null,
        del: async () => null,
        exists: async () => 0,
        incr: async () => null,
        expireAt: async () => null,
    };
    return;
}

const redisConfig = {
    username: process.env.REDIS_USER || 'default',
    password: REDIS_PASSWORD ? REDIS_PASSWORD.trim() : undefined,
    socket: {
        host: REDIS_HOST,
        port: parseInt(REDIS_PORT),
        connectTimeout: 10000,
        reconnectStrategy: (retries) => {
            if (retries > 5) {
                console.error('❌ Redis max retries reached');
                return new Error('Redis connection failed after 5 retries');
            }
            return Math.min(retries * 100, 3000);
        }
    }
};

const _client = createClient(redisConfig);

_client.on('error', (err) => { console.error('Redis Client Error:', err.message); });
_client.on('connect', () => { console.log('Redis Client Connected'); });
_client.on('ready', () => { console.log('Redis Client Ready'); });
_client.on('reconnecting', () => { console.log('Redis Client Reconnecting'); });

process.on('SIGINT', async () => {
    try {
        if (_client.isOpen) {
            await _client.quit();
            console.log('Redis connection closed through app termination');
        }
    } catch (err) {
        console.error('Error during Redis disconnect:', err);
    }
});

// Safe proxy — every method silently no-ops if client is not open
const redisClient = new Proxy(_client, {
    get(target, prop) {
        const val = target[prop];
        if (typeof val === 'function' && prop !== 'connect' && prop !== 'on' && prop !== 'quit') {
            return async (...args) => {
                if (!target.isOpen) {
                    console.warn(`⚠️  Redis not connected — skipping redis.${prop}()`);
                    return null;
                }
                return val.apply(target, args);
            };
        }
        return val;
    }
});

module.exports = redisClient;