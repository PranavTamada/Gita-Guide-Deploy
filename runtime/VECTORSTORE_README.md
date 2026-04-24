# FAISS Vector Store for Bhagavad Gita

A modular, production-ready vector database for semantic search over Bhagavad Gita verses using FAISS and sentence transformers.

## Features

- **Efficient Embeddings**: Uses `all-MiniLM-L6-v2` model from @xenova/transformers
- **Fast Search**: FAISS-based approximate nearest neighbor search
- **Semantic Search**: Find verses by meaning, not just keywords
- **Persistent Storage**: Save and load indexes for quick startup
- **Rich Metadata**: Returns full verse information with similarity scores
- **Text Normalization**: Automatic preprocessing of queries and content

## Installation

```bash
npm install
```

## API

### VectorStore Class

#### Methods

##### `buildIndex()`

Builds the FAISS index from `data/verses.json`.

```javascript
import { vectorStore } from './runtime/vectorStore.js';

const result = await vectorStore.buildIndex();
// Returns: { success: true, versesCount: 657, embeddingDimension: 384 }
```

##### `search(query, topK)`

Searches for similar verses using semantic similarity.

**Parameters:**
- `query` (string): Search query (automatically normalized)
- `topK` (number): Number of results to return (default: 5)

**Returns:** Array of results with:
- `id`: Verse identifier (chapter-verse)
- `chapter`: Chapter number
- `verse`: Verse number
- `translation`: Full verse text
- `keywords`: Associated keywords
- `life_situations`: Life situations this verse addresses
- `emotion_tags`: Emotional tags
- `similarity`: Similarity score (0-1)
- `distance`: L2 distance metric
- `rank`: Result rank

```javascript
const results = await vectorStore.search('duty and righteousness', 5);

results.forEach(result => {
  console.log(`Chapter ${result.chapter}, Verse ${result.verse}`);
  console.log(`Similarity: ${result.similarity}`);
  console.log(`Text: ${result.translation}`);
});
```

##### `loadIndex()`

Loads a previously built index from disk.

```javascript
vectorStore.loadIndex();
```

##### `getStats()`

Returns index statistics.

```javascript
const stats = vectorStore.getStats();
// Returns: { built: true, versesIndexed: 657, embeddingDimension: 384 }
```

### Embedding Strategy

Each verse is embedded using a combination of:

1. **Translation**: The English translation of the verse
2. **Keywords**: Associated keywords from metadata
3. **Life Situations**: Contexts where the verse applies

Text is normalized before embedding:
- Converted to lowercase
- Special characters removed
- Whitespace normalized
- Trimmed

### Example Usage in Application

```javascript
import { vectorStore } from './runtime/vectorStore.js';

// Initialize (build or load index)
try {
  vectorStore.loadIndex();
} catch {
  await vectorStore.buildIndex();
}

// Search
const query = 'What does Krishna say about action?';
const results = await vectorStore.search(query, 10);

// Process results
for (const result of results) {
  console.log(`Chapter ${result.chapter}:${result.verse}`);
  console.log(`Relevance: ${(result.similarity * 100).toFixed(1)}%`);
}
```

## Running Examples

### Build Index

```bash
npm run build-index
```

This will:
1. Load all 657 verses from `data/verses.json`
2. Generate embeddings for each verse
3. Create and save the FAISS index
4. Save metadata for retrieval

### Run Search Examples

```bash
npm run search
```

This will demonstrate semantic search with example queries.

## Files

- `vectorStore.js`: Main module (singleton instance)
- `buildIndex.js`: Index building script
- `search.js`: Search demonstration script
- `data/faiss_index.bin`: Persistent FAISS index (auto-generated)
- `data/metadata.json`: Verse metadata (auto-generated)

## Performance

- **Embedding Generation**: ~50-100ms per verse (on CPU)
- **Total Build Time**: ~10-15 minutes for 657 verses (CPU dependent)
- **Search Time**: <5ms for top-K retrieval (after index loads)
- **Index Size**: ~50MB (approximate)
- **Memory Usage**: ~500MB during build, ~100MB in production

## Text Processing

All queries and verses undergo normalization:

```javascript
function normalizeText(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

This ensures consistent matching across different text variations.

## Integration Points

The vector store can be integrated into:

1. **Frontend (gita_assistant.html)**: For semantic search UI
2. **Backend Pipeline**: For relevance filtering
3. **Retrieval System**: For context retrieval in conversational AI
4. **Recommendation Engine**: For suggesting related verses

Example frontend integration:

```javascript
// In async context
const query = document.getElementById('search-box').value;
const results = await vectorStore.search(query, 10);

// Display results
results.forEach(result => {
  addVerseToUI(result);
});
```

## Troubleshooting

**Index not found error:**
- Run `npm run build-index` to create the index

**Memory issues during build:**
- Reduce batch processing size in `buildIndex()`
- Or use a machine with more available RAM

**Slow searches:**
- First search may be slow as model loads
- Subsequent searches use cached model

## Future Enhancements

- [ ] Incremental index updates
- [ ] Multiple embedding models support
- [ ] IVF index for larger datasets
- [ ] Cross-lingual embeddings
- [ ] Custom fine-tuned models
