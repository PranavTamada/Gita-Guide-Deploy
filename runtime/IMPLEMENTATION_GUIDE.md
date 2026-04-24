# FAISS Vector Store Implementation Guide

## Overview

This document provides a complete technical guide to the FAISS-based vector database implementation for Bhagavad Gita verses.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Application Layer                       │
│  (Frontend: gita_assistant.html, Backend: retrieval.js)  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│            Vector Store Helper API                       │
│       (vectorStoreHelper.js - High-level API)           │
├─────────────────────────────────────────────────────────┤
│ • semanticSearch()        • getRelatedVerses()          │
│ • searchByContext()       • advancedSearch()            │
│ • getRandomVerses()       • getVerseByLocation()        │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Vector Store Core                           │
│         (vectorStore.js - Main Module)                  │
├─────────────────────────────────────────────────────────┤
│ • buildIndex()            • search()                    │
│ • loadIndex()             • saveIndex()                 │
│ • getStats()              • normalizeText()             │
└────────────────────┬────────────────────────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼───┐    ┌──────▼──────┐   ┌─────▼─────┐
│ FAISS │    │ Transformers │   │ Metadata  │
│ Index │    │ (Embeddings) │   │ Storage   │
└───────┘    └──────────────┘   └───────────┘
```

## Core Components

### 1. vectorStore.js

**Main Module**: Handles all vector database operations.

```javascript
// Singleton instance
export const vectorStore = new VectorStore()

// Key methods:
- buildIndex()        // Generate embeddings and FAISS index
- search(query, topK) // Semantic search
- loadIndex()         // Load persisted index
- saveIndex()         // Save index to disk
- getStats()          // Get index information
```

**Class: VectorStore**

```javascript
class VectorStore {
  // Properties
  embedder          // Transformer model instance
  index             // FAISS index
  metadata          // Array of verse metadata
  verses            // Original verse data
  isBuilt           // Index status flag

  // Methods
  async initEmbedder()         // Initialize ML model
  loadVerses()                 // Load from JSON
  async buildIndex()           // Full index construction
  saveIndex()                  // Persist to disk
  loadIndex()                  // Load from disk
  async search(query, topK)    // Execute search
  getStats()                   // Get statistics
}
```

### 2. Text Processing Pipeline

#### Normalization

```javascript
function normalizeText(text) {
  // 1. Convert to lowercase
  // 2. Trim whitespace
  // 3. Collapse multiple spaces
  // 4. Remove special characters (keep alphanumeric + space)
  // 5. Trim again
}
```

Example:
```
Input:  "O Mighty Arjuna!!! ...What is your duty?"
Output: "o mighty arjuna what is your duty"
```

#### Verse Embedding

Each verse combines three elements:

```javascript
function combineVerseText(verse) {
  // 1. Translation (main text)
  // 2. Keywords (semantic tags)
  // 3. Life situations (context)
  
  // Returns: combined normalized string
}
```

Example:
```javascript
const verse = {
  translation: "Your duty is to act without attachment...",
  keywords: ["duty", "action", "detachment"],
  life_situations: ["work and career"]
}

// Result for embedding:
"your duty is to act without attachment duty action 
 detachment work and career"
```

### 3. Embedding Model

**Model**: `all-MiniLM-L6-v2` (from Hugging Face)

- **Type**: Sentence transformer
- **Dimension**: 384
- **Size**: ~22 MB
- **Speed**: ~50-100ms per verse on CPU
- **Provider**: @xenova/transformers (JavaScript port)

Features:
- Normalized embeddings (unit vectors)
- Pre-trained on semantic similarity tasks
- Excellent for semantic search and clustering

### 4. FAISS Index

**Index Type**: `IndexFlatL2`

- Uses L2 (Euclidean) distance metric
- Flat index (exhaustive search)
- Fast for databases < 1M vectors
- 657 verses indexed: ~5-10ms search time

Alternative indices for scaling:
- `IndexIVFFlat`: For 1M-100M vectors
- `IndexHNSW`: For ultra-fast searches
- `IndexPQ`: For quantized distances

### 5. Search Algorithm

```
1. Normalize user query
   "What about duty?" → "what about duty"

2. Generate query embedding
   Query text → Embedding (384D vector)

3. Search FAISS index
   Find K nearest neighbors using L2 distance

4. Score conversion
   L2 distance → Similarity (0-1)
   similarity = 1 / (1 + distance)

5. Return ranked results
   Sorted by similarity, with metadata
```

### 6. Metadata Storage

**File**: `data/metadata.json`

```json
[
  {
    "id": "1-1",
    "chapter": 1,
    "verse": 1,
    "translation": "...",
    "keywords": [...],
    "life_situations": [...],
    "emotion_tags": [...]
  },
  ...
]
```

Used for:
- Quick lookups without re-loading data
- Filtering results by metadata
- Providing context in search results

## API Reference

### High-Level API (vectorStoreHelper.js)

```javascript
// Initialize
await initializeVectorStore()

// Search Functions
await semanticSearch(query, topK, minSimilarity)
await searchByContext(lifeContext, topK)
await getRelatedVerses(chapter, verse, topK)
await advancedSearch(criteria, topK)

// Data Access
getVerseByLocation(chapter, verse)
getAvailableLifeSituations()
getAvailableKeywords()
getAvailableEmotionTags()
getRandomVerses(count)
```

### Low-Level API (vectorStore.js)

```javascript
// Core Operations
vectorStore.buildIndex()
vectorStore.loadIndex()
vectorStore.search(query, topK)
vectorStore.saveIndex()
vectorStore.getStats()
vectorStore.normalizeText(text)
```

## Usage Examples

### Basic Search

```javascript
import { vectorStore } from './runtime/vectorStore.js';

// Load index
vectorStore.loadIndex();

// Search
const results = await vectorStore.search('dharma and duty', 5);

results.forEach(r => {
  console.log(`Chapter ${r.chapter}:${r.verse}`);
  console.log(`Similarity: ${r.similarity}`);
  console.log(`Text: ${r.translation}`);
});
```

### Integration with Retrieval

```javascript
import { semanticSearch, advancedSearch } from './runtime/vectorStoreHelper.js';

// User query from input
const userQuery = "How should I handle conflict?";

// Perform semantic search
const results = await semanticSearch(userQuery, 10);

// Filter by emotion or context
const filtered = results.filter(r => 
  r.emotion_tags.includes('peaceful') ||
  r.life_situations.includes('conflict resolution')
);

// Return top 5
return filtered.slice(0, 5);
```

### Building Index (First Time)

```javascript
import { vectorStore } from './runtime/vectorStore.js';

try {
  const result = await vectorStore.buildIndex();
  console.log(`Built index with ${result.versesCount} verses`);
  console.log(`Embedding dimension: ${result.embeddingDimension}`);
} catch (error) {
  console.error('Build failed:', error);
}
```

## Performance Characteristics

### Build Time (First Time)
- **Time**: ~10-15 minutes on CPU
- **Per verse**: ~50-100ms (model inference)
- **Bottleneck**: Embedding generation

### Search Time (After Load)
- **Initial search**: ~2-3s (model cache warming)
- **Subsequent searches**: <10ms
- **Per-verse lookup**: <0.1ms

### Storage
- **Index file**: ~50MB
- **Metadata file**: ~10MB
- **Total**: ~60MB

### Memory
- **Peak during build**: ~1-2GB (all embeddings in RAM)
- **Runtime**: ~200-300MB (index + metadata + model)

## Optimization Strategies

### 1. Lazy Loading
```javascript
// Load model only on first search
if (!this.embedder) {
  await this.initEmbedder();
}
```

### 2. Batch Processing
```javascript
// Process verses in batches for memory efficiency
for (let i = 0; i < verses.length; i += BATCH_SIZE) {
  const batch = verses.slice(i, i + BATCH_SIZE);
  // Process batch
}
```

### 3. Index Persistence
```javascript
// Save index after building
vectorStore.saveIndex();

// Load on startup
vectorStore.loadIndex();
```

### 4. Caching
```javascript
// Cache query embeddings if searching same terms
const cache = new Map();
cache.set(normalizedQuery, embedding);
```

## Data Flow

### Build Phase
```
verses.json 
  ↓ (load)
Raw verse data
  ↓ (combine text: translation + keywords + life_situations)
Combined text for each verse
  ↓ (normalize)
Normalized text
  ↓ (embed with all-MiniLM-L6-v2)
384D embeddings
  ↓ (build FAISS index)
FAISS IndexFlatL2
  ↓ (save)
- faiss_index.bin
- metadata.json
```

### Search Phase
```
User query
  ↓ (normalize)
Normalized query
  ↓ (embed)
384D query embedding
  ↓ (search FAISS index)
K nearest neighbors
  ↓ (lookup metadata)
Full result objects with context
  ↓ (score + rank)
Ranked results (0-1 similarity)
```

## Troubleshooting

### Issue: Index build fails with memory error
**Solution**: 
- Increase Node.js heap: `node --max-old-space-size=4096`
- Process verses in smaller batches

### Issue: Slow searches
**Solution**:
- First search loads model (2-3s) - normal
- Subsequent searches should be <10ms
- Check if index is loaded: `vectorStore.getStats()`

### Issue: Inconsistent results
**Solution**:
- Ensure consistent text normalization
- Check if same embedder version is used
- Verify embedding dimension matches index (should be 384)

### Issue: Index file not found
**Solution**:
- Run `npm run build-index` to generate
- Or call `vectorStore.buildIndex()` in code

## Future Enhancements

### 1. Quantization
```javascript
// Reduce embedding size: 384 → 128 dimensions
// Trade: 3x smaller, slightly less accurate
```

### 2. Hierarchical Clustering
```javascript
// Index verses by chapter for faster filtering
// Useful for large databases
```

### 3. Fine-tuned Models
```javascript
// Train embedder on Bhagavad Gita specific tasks
// Improves relevance for spiritual concepts
```

### 4. Hybrid Search
```javascript
// Combine semantic search with keyword matching
// Better for specific terms
```

### 5. Re-ranking
```javascript
// Use more sophisticated model for top-K re-ranking
// Improves precision at higher K values
```

## Testing

Run comprehensive test suite:

```bash
npm run test
```

Tests cover:
- Initialization
- Semantic search
- Related verses
- Metadata filtering
- Advanced search
- Performance benchmarks
- Random sampling

## Integration Checklist

- [ ] Install dependencies: `npm install`
- [ ] Build index: `npm run build-index`
- [ ] Test functionality: `npm run test`
- [ ] Import helper in application
- [ ] Replace keyword search with semantic search
- [ ] Add search UI to frontend
- [ ] Monitor performance
- [ ] Cache index for faster restarts

## References

- FAISS Documentation: https://github.com/facebookresearch/faiss
- Sentence Transformers: https://www.sbert.net/
- All-MiniLM-L6-v2: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- Xenova Transformers: https://github.com/xenova/transformers.js
