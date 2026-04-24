import { vectorStore } from './vectorStore.js';

async function main() {
  try {
    console.log('=== Bhagavad Gita Vector Search ===\n');

    // Check if index exists, if not build it
    const stats = vectorStore.getStats();
    if (!stats.built) {
      console.log('Index not found. Building...\n');
      await vectorStore.buildIndex();
    } else {
      // Load existing index
      vectorStore.loadIndex();
    }

    // Example searches
    const queries = [
      'duty and action',
      'meditation and peace',
      'Krishna wisdom',
      'fighting for righteousness',
      'detachment from results',
    ];

    console.log('\n=== Search Examples ===\n');

    for (const query of queries) {
      console.log(`\n--- Query: "${query}" ---`);
      const results = await vectorStore.search(query, 3);

      results.forEach((result) => {
        console.log(
          `\nRank ${result.rank}: Chapter ${result.chapter}, Verse ${result.verse}`
        );
        console.log(`Similarity: ${result.similarity} (Distance: ${result.distance})`);
        console.log(`Translation: ${result.translation.substring(0, 100)}...`);
        console.log(`Keywords: ${result.keywords.join(', ')}`);
      });
    }
  } catch (error) {
    console.error('Search failed:', error);
    process.exit(1);
  }
}

main();
