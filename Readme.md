Here is an alternative version of the README. This version is structured specifically as a technical assignment submission, explicitly mapping your system's features to the grading rubric and highlighting the unique dataset.


# 🏎️ Distributed Typeahead API: Sim Racing & Custom Setups

A high-performance, low-latency search typeahead system designed to handle massive read/write scale. This project implements a distributed caching layer, write-batching, and recency-aware ranking.

The backend is powered by an in-memory dataset of over 100,000 unique search queries, specifically tailored to sim racing (DualSenseX, Forza haptics) and custom mechanical keyboard builds (Kreo Swarm, anime frame wraps, deskmat dimensions). The dataset was procedurally generated using Google AI Studio.


## 🎯 Assignment Fulfillment Checklist

This project successfully implements all core and advanced requirements:

- [x] **Core System (60%)**: In-memory data store containing >100k queries. Provides `GET /suggest` and `POST /search` APIs. 
- [x] **Distributed Cache**: Utilizes 3 Redis nodes running via Docker. Requests are routed using a Consistent Hashing algorithm on the search prefix to ensure uniform data distribution.
- [x] **Trending Searches (20%)**: Implements a time-decay ranking algorithm. Suggestions are scored using `totalCount + (recentCount * 5)`, and a background worker decays all historical counts by 10% hourly to allow fresh trends to surface.
- [x] **Batch Writes (20%)**: Employs an asynchronous write buffer. The `POST /search` API is entirely non-blocking, returning instantly. A background worker flushes the buffer to the primary data store every 10 seconds, drastically reducing write pressure.

---

## 🛠️ Tech Stack & Architecture

* **Runtime**: Node.js (Express.js)
* **Caching Layer**: Redis (3-Node Cluster via Docker)
* **Frontend**: HTML5, Vanilla JavaScript, CSS3 (Debounced API calls)
* **Design Patterns**: Consistent Hashing, Write-Behind Caching (Batching)

### System Flow
1. **Reads**: The client sends a debounced string (e.g., "kreo swarm"). The backend hashes the prefix, identifies the correct Redis node, and attempts a read. On a cache miss, it computes the top 10 results from the primary DB, caches the result for 5 minutes, and returns the response.
2. **Writes**: A search submission is stored in a local Node.js memory buffer. Every 10 seconds, the Batch Writer aggregates these counts, updates the primary DB, and invalidates the specific prefix keys across the Redis cluster to ensure consistency.

---

## 🚀 Setup & Installation

**Prerequisites:** Node.js v18+ and Docker.

1. **Spin up the Cache Cluster:**
   ```bash
   docker-compose up -d

```

2. **Install Dependencies:**
```bash
npm install

```


3. **Generate the 100k+ Dataset:**
```bash
node generateData.js

```


4. **Start the Server:**
```bash
node server.js

```


5. **Launch the UI:**
Open `index.html` in your browser.

---

## 🔌 API Reference

### `GET /suggest?q=<prefix>`

Fetches the top 10 suggestions for a given prefix (minimum 3 characters required).
**Response:** `["kreo swarm black", "kreo swarm anime frame", ...]`

### `POST /search`

Simulates a completed search, pushing the query into the batch buffer.
**Body:** `{ "query": "dualsensex adaptive triggers" }`
**Response:** `{ "message": "Searched" }`

### `GET /trending`

Fetches the top 5 global trending searches based on the blended recency score.
**Response:** `["how to setup dualsensex", "90x42 cm deskmat", ...]`

### `GET /cache/debug?prefix=<prefix>`

Diagnostic endpoint to verify the Consistent Hashing router's behavior and cache hit/miss status for a specific prefix.

## Video-Demo
