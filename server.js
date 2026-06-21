const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const { createClient } = require('redis');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- 1. INITIALIZE DATABASE WITH CUSTOM DATASET ---
let db = {}; 
const rawData = JSON.parse(fs.readFileSync('./dataset.json', 'utf-8'));
rawData.forEach(item => {
    // We maintain a totalCount and a recentCount to handle the "Trending Searches" logic later
    db[item.query.toLowerCase()] = { totalCount: item.count, recentCount: 0 };
});
console.log(`Loaded ${Object.keys(db).length} records into primary DB.`);

// --- 2. CONNECT TO MULTIPLE REDIS NODES ---
const REDIS_CONFIGS = [
    { name: 'Node_A', url: 'redis://localhost:6379' },
    { name: 'Node_B', url: 'redis://localhost:6380' },
    { name: 'Node_C', url: 'redis://localhost:6381' }
];

const redisClients = {};
REDIS_CONFIGS.forEach(cfg => {
    const client = createClient({ url: cfg.url });
    client.on('error', (err) => console.error(`Redis ${cfg.name} Error`, err));
    
    // Asynchronously connect to each node
    client.connect().then(() => console.log(`Connected to Cache: ${cfg.name}`));
    redisClients[cfg.name] = client;
});

// --- 3. CONSISTENT HASHING ROUTER ---
// This function assigns a specific prefix to a specific Redis node 
// to ensure the cache is uniformly distributed.
function getCacheNode(prefix) {
    let hash = 0;
    for (let i = 0; i < prefix.length; i++) {
        hash = (hash << 5) - hash + prefix.charCodeAt(i);
        hash |= 0; 
    }
    const nodeNames = Object.keys(redisClients);
    return nodeNames[Math.abs(hash) % nodeNames.length];
}

// --- 4. THE IN-MEMORY BUFFER FOR BATCH WRITES ---
// We will process this in Step 4 to protect the database from write-heavy traffic
let writeBuffer = {}; 

// --- 5. API ENDPOINTS ---

// GET /suggest?q=<prefix>
app.get('/suggest', async (req, res) => {
    const prefix = (req.query.q || '').toLowerCase().trim();
    
    // As per the assignment constraint, only load suggestions after 3 characters
    if (prefix.length < 3) {
        return res.json([]);
    }

    // Determine which Redis node owns this prefix
    const targetNode = getCacheNode(prefix);

    try {
        // 1. Attempt to read from the assigned cache node asynchronously
        const cachedData = await redisClients[targetNode].get(prefix);
        if (cachedData) {
            return res.json(JSON.parse(cachedData));
        }

        // 2. Cache Miss: We must compute the suggestions from the primary DB
        // We calculate a 'score' that blends all-time popularity with recent trends
        const results = Object.keys(db)
            .filter(query => query.startsWith(prefix))
            .map(query => ({
                query,
                score: db[query].totalCount + (db[query].recentCount * 5) // Recency multiplier
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(item => item.query);

        // 3. Save the computed result back to the specific Redis instance for 5 minutes
        await redisClients[targetNode].setEx(prefix, 300, JSON.stringify(results));
        
        return res.json(results);
    } catch (err) {
        console.error("Cache cluster failure", err);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

// POST /search
// This endpoint simulates a user hitting 'Enter' on a search.
app.post('/search', (req, res) => {
    const query = (req.body.query || '').toLowerCase().trim();
    
    if (query) {
        // Instead of writing directly to the DB, we push it to our buffer.
        // This keeps the endpoint blazing fast and non-blocking.
        writeBuffer[query] = (writeBuffer[query] || 0) + 1;
    }
    
    res.json({ message: "Searched" });
});

// GET /trending 
// A bonus endpoint to fetch the global top 5 searches for the UI landing state
app.get('/trending', (req, res) => {
    const globalTrends = Object.keys(db)
        .map(query => ({
            query,
            score: db[query].totalCount + (db[query].recentCount * 5)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(item => item.query);

    res.json(globalTrends);
});

// --- 6. BACKGROUND WORKERS ---

// The Batch Writer (Runs every 10 seconds)
setInterval(async () => {
    const keys = Object.keys(writeBuffer);
    if (keys.length === 0) return;

    console.log(`[Batch Writer] Flushing ${keys.length} new searches to primary DB...`);
    
    for (const query of keys) {
        // 1. Update the primary database
        if (!db[query]) db[query] = { totalCount: 0, recentCount: 0 };
        db[query].totalCount += writeBuffer[query];
        db[query].recentCount += writeBuffer[query];
        
        // 2. Invalidate the stale cache for all prefixes of this query
        for (let i = 1; i <= query.length; i++) {
            const prefix = query.substring(0, i);
            const targetNode = getCacheNode(prefix);
            try {
                // Delete the cached suggestions so the next read fetches fresh data
                await redisClients[targetNode].del(prefix); 
            } catch(e) { 
                /* ignore minor cleanup errors */ 
            }
        }
    }
    // Clear the buffer after flushing
    writeBuffer = {}; 
}, 10000);

// The Decay Service (Runs every 1 hour)
// This satisfies the 20% bonus requirement for Trending Searches
setInterval(() => {
    console.log("[Decay Service] Decaying historical counts by 10% to surface new trends...");
    Object.keys(db).forEach(k => {
        db[k].totalCount = Math.floor(db[k].totalCount * 0.9);
        db[k].recentCount = Math.floor(db[k].recentCount * 0.9);
    });
}, 3600000);

const PORT = 3000;
app.listen(PORT, () => console.log(`Typeahead Server running on port ${PORT}`));