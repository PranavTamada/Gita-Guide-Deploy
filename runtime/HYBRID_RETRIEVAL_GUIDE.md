# Hybrid Retrieval System - Technical Documentation

## Overview

The hybrid retrieval system combines **semantic search** (FAISS vector similarity) with **metadata scoring** to provide intelligent, context-aware verse retrieval from the Bhagavad Gita.

---

## Architecture

```
User Query
    ↓
    ├─ Tokenization & Normalization
    │
    ├─ Branch 1: Vector Search (FAISS)
    │   └─ Returns similarity scores (0-1)
    │
    ├─ Branch 2: Metadata Scoring
    │   ├─ Emotion tags matching
    │   ├─ Life situations matching
    │   └─ Keywords matching
    │
    ↓
    Hybrid Score Calculation
    ├─ Combine all scores with weights
    └─ Final Score = 0-1
    ↓
    Post-Processing
    ├─ Deduplication
    ├─ Diversity filtering
    └─ Top-3 results
    ↓
Result with Score Breakdown
```

---

## Scoring System

### Formula

```
Final Score = (Vector × 0.5) + (Emotion × 0.3) + (LifeSit × 0.15) + (Keywords × 0.05)
```

Where each component is normalized to [0, 1]:

### Weight Breakdown

| Component | Weight | Purpose |
|-----------|--------|---------|
| **Vector Similarity** | 50% | FAISS semantic search captures meaning |
| **Emotion Tags** | 30% | Emotional context of the query |
| **Life Situations** | 15% | Life context/problem domain |
| **Keywords** | 5% | Explicit keyword matching |

### Score Calculation Details

#### 1. Vector Similarity Score (0-1)
```javascript
// From FAISS search
similarity = 1 / (1 + l2_distance)
// Already normalized by vectorStore
```

#### 2. Emotion Tags Match (0-1)
```javascript
score = (matching_emotions) / (total_emotions)
// Example: Verse has [peaceful, calm]
//          Query matches 1 of 2
//          Score = 0.5
```

#### 3. Life Situations Match (0-1)
```javascript
score = (matching_situations) / (total_situations)
// Example: Verse has [conflict, family]
//          Query "family conflict" matches both
//          Score = 1.0
```

#### 4. Keywords Match (0-1)
```javascript
score = (matching_keywords) / (total_keywords)
// Example: Verse has [duty, action, karma]
//          Query "duty and action" matches 2 of 3
//          Score = 0.67
```

---

## API Functions

### Main Function: `getTopMatches(query, topK = 3)`

Returns top-K verses with hybrid scoring and complete breakdown.

**Parameters:**
- `query` (string): User search query
- `topK` (number): Number of results (default: 3)

**Returns:** Array of results with:
```javascript
{
  id: "2-47",                    // Chapter-Verse
  chapter: 2,
  verse: 47,
  translation: "...",           // Full verse text
  keywords: [...],              // Associated keywords
  life_situations: [...],       // Life contexts
  emotion_tags: [...],          // Emotional tags
  score_breakdown: {
    vector: 0.85,               // Vector similarity (0-1)
    emotion: 0.50,              // Emotion match (0-1)
    life_situation: 1.00,       // Life situation match (0-1)
    keywords: 0.67,             // Keywords match (0-1)
    final: 0.7435               // Final weighted score
  },
  final_score: 0.7435           // Convenience field
}
```

### Helper Function: `getTopMatchesSync(query)`

Synchronous version using only metadata (no FAISS dependency).

**Returns:** Same format as `getTopMatches()` but without vector scores.

---

## Detailed Scoring Components

### Vector Similarity Scoring (50% weight)

**Input:** User query → Generated embedding (384D)

**Process:**
1. Normalize query text
2. Generate query embedding using all-MiniLM-L6-v2
3. Search FAISS index for similar verses
4. L2 distance → Similarity conversion: `similarity = 1 / (1 + distance)`

**Output:** 0-1 score

**Advantages:**
- Understands semantic meaning beyond keywords
- Captures intent and context
- Works with varied phrasing

**Example:**
```
Query: "What is my duty?"
Matches: "Your duty is to act without attachment..."
Vector Score: 0.92 (high semantic similarity)
```

### Emotion Tags Scoring (30% weight)

**Input:** Query terms + Verse emotion tags

**Process:**
1. Parse query into tokens
2. Check if query terms match emotion tags (case-insensitive)
3. Calculate: matching_tags / total_tags

**Output:** 0-1 score

**Emotions:** peaceful, anxious, conflicted, determined, etc.

**Example:**
```
Query: "how to find peace"
Verse emotions: [peaceful, calm, serene]
Matches: peaceful, calm (2/3)
Emotion Score: 0.67
```

### Life Situations Scoring (15% weight)

**Input:** Query terms + Verse life situations

**Process:**
1. Parse query into tokens
2. Check if query terms match life situations (case-insensitive)
3. Calculate: matching_situations / total_situations

**Output:** 0-1 score

**Life Situations:** conflict with loved ones, workplace challenges, grief, seeking meaning, etc.

**Example:**
```
Query: "dealing with conflict and family"
Verse situations: [conflict with loved ones, family duty]
Matches: conflict with loved ones (1/2 or more partial matches)
Life Situation Score: 0.50-1.00
```

### Keywords Scoring (5% weight)

**Input:** Query terms + Verse keywords

**Process:**
1. Parse query into tokens
2. Check if query terms match keywords (case-insensitive)
3. Calculate: matching_keywords / total_keywords

**Output:** 0-1 score

**Example:**
```
Query: "duty and action"
Verse keywords: [duty, karma, action, detachment]
Matches: duty, action (2/4)
Keyword Score: 0.50
```

---

## Post-Processing Features

### 1. Deduplication

**Purpose:** Prevent identical or near-identical verses in results

**Implementation:**
```javascript
function deduplicateResults(results, similarityThreshold = 0.95) {
  // Keeps track of already returned verse IDs
  // Prevents chapter-verse combinations from appearing twice
}
```

**Example:**
```
Input: [Verse 2:47, Verse 2:47, Verse 3:8]
Output: [Verse 2:47, Verse 3:8]
```

### 2. Diversity Filtering

**Purpose:** Return results from different chapters and with varied emotions

**Strategy:**
1. First Pass: Prioritize different chapters and emotions
2. Second Pass: Fill remaining slots with highest-scoring verses

**Example:**
```
Input (sorted by score): 
  - 2:47 (chapter 2, peaceful)
  - 2:48 (chapter 2, calm)
  - 3:8 (chapter 3, determined)

Output (topK=3):
  - 2:47 (chapter 2) ✓ 
  - 3:8 (chapter 3) ✓ Different chapter
  - 2:48 (chapter 2) (if topK > 2)
```

**Benefits:**
- Broader perspective on topic
- Different emotional contexts
- Multiple chapters covered
- More relevant variety

---

## Error Handling & Fallbacks

### Scenario 1: Vector Store Not Available
```javascript
// If FAISS index not built or error occurs
→ Fallback to metadata-only search
→ Zero vector scores for all verses
→ Use only emotion, life_situation, keywords scoring
```

### Scenario 2: Query Too Short
```javascript
// Query "a" or "is" filtered out (< 3 chars)
→ Only word terms ≥ 3 chars are matched
→ Reduces false positives from common words
```

### Scenario 3: No Matches Found
```javascript
// If final_score = 0 for all verses
→ All verses with final_score > 0 are kept
→ Returns empty array if no matches
```

---

## Integration Example

### With Frontend (HTML)

```html
<form id="search-form">
  <input type="text" id="query" placeholder="Ask about the Gita...">
  <button type="submit">Search</button>
</form>

<div id="results"></div>

<script type="module">
import { getTopMatches } from './runtime/retrieval.js';

document.getElementById('search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('query').value;
  
  const results = await getTopMatches(query, 3);
  
  displayResults(results);
});

function displayResults(results) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = results.map(r => `
    <div class="result">
      <h3>Chapter ${r.chapter}:${r.verse}</h3>
      <p>${r.translation}</p>
      <p>Score: ${(r.final_score * 100).toFixed(1)}%</p>
    </div>
  `).join('');
}
</script>
```

### With Backend (Node.js)

```javascript
import express from 'express';
import { getTopMatches } from './runtime/retrieval.js';

const app = express();

app.post('/api/search', async (req, res) => {
  const { query, topK } = req.body;
  
  const results = await getTopMatches(query, topK || 3);
  
  res.json({
    query,
    results,
    timestamp: new Date().toISOString()
  });
});

app.listen(3000);
```

---

## Performance Characteristics

### Search Time Breakdown

| Operation | Time |
|-----------|------|
| Query parsing | <1ms |
| Vector search (if available) | <10ms |
| Metadata scoring (657 verses) | 5-50ms |
| Deduplication | <1ms |
| Diversity filtering | <1ms |
| **Total** | **<100ms** |

### Memory Usage

| Component | Size |
|-----------|------|
| Raw data (657 verses) | ~1MB |
| FAISS index (if loaded) | ~50MB |
| Transformer model (if loaded) | ~50MB |
| Per-search overhead | <5MB |

---

## Usage Examples

### Example 1: Basic Search
```javascript
const results = await getTopMatches("duty and righteousness");
// Returns top 3 verses with hybrid scores
```

### Example 2: Custom Top-K
```javascript
const results = await getTopMatches("meditation", 5);
// Returns top 5 verses instead of 3
```

### Example 3: Score Breakdown Analysis
```javascript
const results = await getTopMatches("Krishna wisdom");
results.forEach(r => {
  console.log(`Chapter ${r.chapter}:${r.verse}`);
  console.log(`Vector: ${r.score_breakdown.vector}`);
  console.log(`Emotion: ${r.score_breakdown.emotion}`);
  console.log(`Life Situation: ${r.score_breakdown.life_situation}`);
  console.log(`Keywords: ${r.score_breakdown.keywords}`);
  console.log(`Final: ${r.score_breakdown.final}\n`);
});
```

### Example 4: Fallback to Metadata-Only
```javascript
// If vector store not available
const results = getTopMatchesSync("dealing with anger");
// Uses only metadata scoring (emotion, life_situations, keywords)
```

---

## Testing & Demonstration

Run the interactive demonstration:

```bash
npm run demo-retrieval
```

This shows:
- Real-world search examples
- Score breakdowns for each result
- Diversity of results
- Scoring formula explanation

---

## Optimization Tips

### For Better Results

1. **Query Length:** Use 2-3 word queries for best balance
   ```javascript
   ✓ "dealing with anger"
   ✓ "meditation and peace"
   ✗ "a" (too short)
   ```

2. **Use Life Situation Keywords:** Match life situations for higher scores
   ```javascript
   getTopMatches("conflict with loved ones");
   // Matches life_situations directly = higher score
   ```

3. **Emotional Context:** Queries mentioning emotions get emotion tag matches
   ```javascript
   getTopMatches("peaceful meditation");
   // Matches emotion tags like "peaceful"
   ```

### For Better Integration

1. **Pre-build FAISS Index:** Reduces first search latency to <10ms
   ```bash
   npm run build-index
   ```

2. **Cache Results:** Frequently asked questions can be cached
   ```javascript
   const cache = new Map();
   // Store results for common queries
   ```

3. **Batch Queries:** Process multiple searches efficiently
   ```javascript
   const queries = ["duty", "meditation", "love"];
   const results = await Promise.all(
     queries.map(q => getTopMatches(q))
   );
   ```

---

## Troubleshooting

### Issue: Low Similarity Scores

**Cause:** Query doesn't match semantic content well

**Solution:**
- Try different phrasing
- Use more specific life situations
- Include emotion words if applicable

### Issue: Same Verses Repeated

**Solution:** Deduplication is automatic, shouldn't happen
- Check if query is too specific
- Increase topK to get diverse results

### Issue: No Results Found

**Cause:** Query terms don't match any verse metadata

**Solution:**
- Try broader terms
- Use more common keywords
- Check life situations for relevant context

---

## Future Enhancements

- [ ] Custom weight adjustment
- [ ] Query expansion with synonyms
- [ ] Learning from user interactions
- [ ] Caching frequently searched queries
- [ ] Multi-language support
- [ ] Fuzzy matching for typos

---

## Summary

The hybrid retrieval system provides:

✅ **Balanced Approach:** 50% semantic + 50% metadata  
✅ **Fast Search:** <100ms per query  
✅ **Diverse Results:** Different chapters and emotions  
✅ **Transparent Scoring:** Complete breakdown for each result  
✅ **Graceful Fallback:** Works without vector store  
✅ **Production Ready:** Error handling and optimization  

---

*Last Updated: April 24, 2026*  
*Version: 1.0.0*
