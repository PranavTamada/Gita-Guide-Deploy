/**
 * Vector Store Integration Helper
 * Provides easy-to-use functions for semantic search in Bhagavad Gita
 */

import { vectorStore } from './vectorStore.js';

/**
 * Initialize the vector store (builds or loads index)
 */
export async function initializeVectorStore() {
  try {
    const stats = vectorStore.getStats();
    if (stats.built) {
      console.log('[VectorStore] Index already loaded');
      return stats;
    }

    console.log('[VectorStore] Index not found, building...');
    const result = await vectorStore.buildIndex();
    console.log(
      `[VectorStore] Built index with ${result.versesCount} verses`
    );
    return result;
  } catch (error) {
    if (
      error.message.includes('Index files not found') ||
      error.message.includes('ENOENT')
    ) {
      console.log('[VectorStore] Building new index...');
      return await vectorStore.buildIndex();
    }
    throw error;
  }
}

/**
 * Search for verses using semantic similarity
 * @param {string} query - User's search query
 * @param {number} topK - Number of results (default: 5)
 * @param {number} minSimilarity - Minimum similarity threshold (default: 0.3)
 * @returns {Promise<Array>} Filtered and ranked results
 */
export async function semanticSearch(query, topK = 5, minSimilarity = 0.3) {
  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  const results = await vectorStore.search(query, topK);

  // Filter by minimum similarity
  return results.filter((result) => result.similarity >= minSimilarity);
}

/**
 * Get related verses for a specific verse
 * @param {number} chapter - Chapter number
 * @param {number} verse - Verse number
 * @param {number} topK - Number of related verses to find
 * @returns {Promise<Array>} Related verses
 */
export async function getRelatedVerses(chapter, verse, topK = 5) {
  // Find the target verse in metadata
  const verseId = `${chapter}-${verse}`;
  const stats = vectorStore.getStats();

  if (!stats.built) {
    throw new Error('Vector store not initialized');
  }

  // Search for the verse's topic using its translation and keywords
  const metadata = vectorStore.metadata.find(
    (m) => m.id === verseId
  );

  if (!metadata) {
    throw new Error(`Verse not found: ${chapter}.${verse}`);
  }

  // Use keywords and first part of translation as query
  const query =
    `${metadata.keywords.slice(0, 3).join(' ')} ${metadata.translation.substring(0, 100)}`.trim();

  const results = await vectorStore.search(query, topK + 1);

  // Filter out the verse itself and return top K
  return results
    .filter((r) => r.id !== verseId)
    .slice(0, topK);
}

/**
 * Search verses by life situation or keyword
 * @param {string} lifeContext - Life situation or keyword to search
 * @param {number} topK - Number of results
 * @returns {Promise<Array>} Relevant verses
 */
export async function searchByContext(lifeContext, topK = 10) {
  if (!lifeContext || lifeContext.trim().length === 0) {
    throw new Error('Context cannot be empty');
  }

  const results = await vectorStore.search(lifeContext, topK);
  return results;
}

/**
 * Get all unique life situations in the database
 * @returns {Set<string>} Set of life situations
 */
export function getAvailableLifeSituations() {
  const situations = new Set();
  vectorStore.metadata.forEach((m) => {
    m.life_situations.forEach((situation) => situations.add(situation));
  });
  return Array.from(situations).sort();
}

/**
 * Get all unique keywords in the database
 * @returns {Array<string>} Sorted array of keywords
 */
export function getAvailableKeywords() {
  const keywords = new Set();
  vectorStore.metadata.forEach((m) => {
    m.keywords.forEach((kw) => keywords.add(kw));
  });
  return Array.from(keywords).sort();
}

/**
 * Get all unique emotion tags in the database
 * @returns {Array<string>} Sorted array of emotion tags
 */
export function getAvailableEmotionTags() {
  const tags = new Set();
  vectorStore.metadata.forEach((m) => {
    m.emotion_tags.forEach((tag) => tags.add(tag));
  });
  return Array.from(tags).sort();
}

/**
 * Get verse by chapter and verse number
 * @param {number} chapter - Chapter number
 * @param {number} verse - Verse number
 * @returns {object|null} Verse metadata or null
 */
export function getVerseByLocation(chapter, verse) {
  const verseId = `${chapter}-${verse}`;
  return vectorStore.metadata.find((m) => m.id === verseId) || null;
}

/**
 * Advanced search with multiple criteria
 * @param {object} criteria - Search criteria
 * @param {string} criteria.query - Text query
 * @param {Array<string>} criteria.lifeSituations - Filter by life situations
 * @param {Array<string>} criteria.emotionTags - Filter by emotion tags
 * @param {number} criteria.chapter - Filter by chapter
 * @param {number} topK - Number of results
 * @returns {Promise<Array>} Filtered results
 */
export async function advancedSearch(criteria = {}, topK = 10) {
  let results = [];

  if (criteria.query) {
    results = await vectorStore.search(criteria.query, topK * 2);
  } else {
    // Return all verses if no query
    results = vectorStore.metadata
      .map((m, idx) => ({
        ...m,
        similarity: 1,
        distance: 0,
        rank: idx + 1,
      }))
      .slice(0, topK * 2);
  }

  // Apply filters
  if (criteria.lifeSituations && criteria.lifeSituations.length > 0) {
    results = results.filter((r) =>
      r.life_situations.some((s) =>
        criteria.lifeSituations.includes(s)
      )
    );
  }

  if (criteria.emotionTags && criteria.emotionTags.length > 0) {
    results = results.filter((r) =>
      r.emotion_tags.some((t) =>
        criteria.emotionTags.includes(t)
      )
    );
  }

  if (criteria.chapter) {
    results = results.filter((r) => r.chapter === criteria.chapter);
  }

  return results.slice(0, topK);
}

/**
 * Get random verses from the database
 * @param {number} count - Number of random verses to return
 * @returns {Array} Random verses
 */
export function getRandomVerses(count = 5) {
  const verses = vectorStore.metadata;
  const results = [];
  const indices = new Set();

  while (results.length < Math.min(count, verses.length)) {
    const idx = Math.floor(Math.random() * verses.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      results.push(verses[idx]);
    }
  }

  return results;
}

export default {
  initializeVectorStore,
  semanticSearch,
  getRelatedVerses,
  searchByContext,
  getAvailableLifeSituations,
  getAvailableKeywords,
  getAvailableEmotionTags,
  getVerseByLocation,
  advancedSearch,
  getRandomVerses,
};
