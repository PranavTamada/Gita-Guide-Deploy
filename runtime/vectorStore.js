import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, pipeline } from '@xenova/transformers';
import faiss from 'faiss-node';

// Disable local model caching for better performance
env.allowLocalModels = false;
env.allowRemoteModels = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '../data/verses.json');
const INDEX_PATH = path.join(__dirname, '../data/faiss_index.bin');
const METADATA_PATH = path.join(__dirname, '../data/metadata.json');

/**
 * Normalize text for embedding
 * @param {string} text - Raw text to normalize
 * @returns {string} Normalized text
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Combine verse text from translation, keywords, and life_situations
 * @param {object} verse - Verse object from verses.json
 * @returns {string} Combined text for embedding
 */
function combineVerseText(verse) {
  const parts = [];

  if (verse.translation) {
    parts.push(normalizeText(verse.translation));
  }

  if (verse.keywords && Array.isArray(verse.keywords)) {
    parts.push(normalizeText(verse.keywords.join(' ')));
  }

  if (verse.life_situations && Array.isArray(verse.life_situations)) {
    parts.push(normalizeText(verse.life_situations.join(' ')));
  }

  return parts.join(' ');
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Float32Array} a - First vector
 * @param {Float32Array} b - Second vector
 * @returns {number} Cosine similarity score
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

class VectorStore {
  constructor() {
    this.embedder = null;
    this.index = null;
    this.metadata = [];
    this.verses = [];
    this.isBuilt = false;
  }

  /**
   * Initialize the embedder model
   */
  async initEmbedder() {
    if (this.embedder) return;

    console.log('Initializing embedder model (all-MiniLM-L6-v2)...');
    this.embedder = await pipeline('feature-extraction', '@xenova/all-MiniLM-L6-v2');
    console.log('Embedder initialized successfully');
  }

  /**
   * Load verses from verses.json
   */
  loadVerses() {
    console.log('Loading verses from verses.json...');
    const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
    this.verses = JSON.parse(rawData);
    console.log(`Loaded ${this.verses.length} verses`);
  }

  /**
   * Build the FAISS index from verses
   */
  async buildIndex() {
    try {
      await this.initEmbedder();
      this.loadVerses();

      console.log('Building FAISS index...');
      const embeddings = [];
      this.metadata = [];

      for (let i = 0; i < this.verses.length; i++) {
        const verse = this.verses[i];
        const verseId = `${verse.chapter}-${verse.verse}`;

        if (i % 100 === 0) {
          console.log(`Processing verse ${i + 1}/${this.verses.length}...`);
        }

        // Combine text for embedding
        const combinedText = combineVerseText(verse);

        // Generate embedding
        const result = await this.embedder(combinedText, {
          pooling: 'mean',
          normalize: true,
        });

        // Extract embedding vector
        const embedding = Array.from(result.data);
        embeddings.push(embedding);

        // Store metadata for retrieval
        this.metadata.push({
          id: verseId,
          chapter: verse.chapter,
          verse: verse.verse,
          translation: verse.translation,
          keywords: verse.keywords || [],
          life_situations: verse.life_situations || [],
          emotion_tags: verse.emotion_tags || [],
        });
      }

      console.log(`Generated ${embeddings.length} embeddings`);

      // Create FAISS index
      const dimension = embeddings[0].length;
      const index = new faiss.IndexFlatL2(dimension);

      // Convert embeddings to Float32Array and add to index
      const data = new Float32Array(embeddings.length * dimension);
      for (let i = 0; i < embeddings.length; i++) {
        for (let j = 0; j < dimension; j++) {
          data[i * dimension + j] = embeddings[i][j];
        }
      }

      index.add(data);
      this.index = index;
      this.isBuilt = true;

      // Save index and metadata
      console.log('Saving FAISS index and metadata...');
      this.saveIndex();

      console.log('FAISS index built successfully!');
      return {
        success: true,
        versesCount: this.verses.length,
        embeddingDimension: dimension,
      };
    } catch (error) {
      console.error('Error building index:', error);
      throw error;
    }
  }

  /**
   * Save index to disk
   */
  saveIndex() {
    if (!this.index) {
      throw new Error('Index not built. Call buildIndex() first.');
    }

    // Save FAISS index
    faiss.writeIndex(this.index, INDEX_PATH);

    // Save metadata
    fs.writeFileSync(METADATA_PATH, JSON.stringify(this.metadata, null, 2));

    console.log(`Index saved to ${INDEX_PATH}`);
    console.log(`Metadata saved to ${METADATA_PATH}`);
  }

  /**
   * Load index from disk
   */
  loadIndex() {
    if (!fs.existsSync(INDEX_PATH) || !fs.existsSync(METADATA_PATH)) {
      throw new Error('Index files not found. Call buildIndex() first.');
    }

    console.log('Loading FAISS index from disk...');
    this.index = faiss.readIndex(INDEX_PATH);
    const metadataRaw = fs.readFileSync(METADATA_PATH, 'utf-8');
    this.metadata = JSON.parse(metadataRaw);
    this.isBuilt = true;

    console.log(`Loaded index with ${this.metadata.length} verses`);
  }

  /**
   * Search for similar verses
   * @param {string} query - Search query
   * @param {number} topK - Number of results to return (default: 5)
   * @returns {Promise<Array>} Array of similar verses with scores
   */
  async search(query, topK = 5) {
    if (!this.isBuilt) {
      throw new Error('Index not built. Call buildIndex() or loadIndex() first.');
    }

    if (!this.embedder) {
      await this.initEmbedder();
    }

    try {
      // Normalize and embed query
      const normalizedQuery = normalizeText(query);
      console.log(`Searching for: "${normalizedQuery}"`);

      const queryEmbedding = await this.embedder(normalizedQuery, {
        pooling: 'mean',
        normalize: true,
      });

      const queryVector = Array.from(queryEmbedding.data);

      // Convert to Float32Array
      const queryData = new Float32Array(queryVector);

      // Search in FAISS index
      const { distances, labels } = this.index.search(queryData, topK);

      // Build results with scores
      const results = [];
      for (let i = 0; i < labels.length; i++) {
        const idx = labels[i];
        if (idx >= 0 && idx < this.metadata.length) {
          const metadata = this.metadata[idx];
          // Convert L2 squared distance to cosine similarity.
          // For unit-normalized vectors: L2² = 2(1 - cosine), so cosine = 1 - d²/2.
          // Clamp to [0, 1] to guard against tiny floating-point overshoots.
          const similarity = Math.max(0, Math.min(1, 1 - distances[i] / 2));

          results.push({
            ...metadata,
            similarity: Math.round(similarity * 10000) / 10000,
            distance: Math.round(distances[i] * 10000) / 10000,
            rank: i + 1,
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error during search:', error);
      throw error;
    }
  }

  /**
   * Get index statistics
   */
  getStats() {
    if (!this.isBuilt) {
      return { built: false };
    }

    return {
      built: true,
      versesIndexed: this.metadata.length,
      embeddingDimension: this.index.d,
    };
  }
}

// Export as singleton
export const vectorStore = new VectorStore();

// Export class for testing
export default VectorStore;
