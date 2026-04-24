/**
 * Vector Store Test and Demonstration
 * Shows all functionality of the vector store and helper functions
 */

import {
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
} from './vectorStoreHelper.js';

function formatResult(result) {
  return `
    ID: ${result.id}
    Chapter ${result.chapter}:${result.verse}
    Similarity: ${(result.similarity * 100).toFixed(1)}%
    Translation: ${result.translation.substring(0, 120)}...
    Keywords: ${result.keywords.slice(0, 3).join(', ')}
  `;
}

async function main() {
  try {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     FAISS Vector Store - Bhagavad Gita Test Suite          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // 1. Initialize Vector Store
    console.log('1️⃣  Initializing Vector Store...');
    const stats = await initializeVectorStore();
    console.log(`   ✓ Loaded ${stats.versesIndexed || stats.versesCount} verses\n`);

    // 2. Basic Semantic Search
    console.log('2️⃣  Basic Semantic Search');
    console.log('   Query: "duty and action"\n');
    const searchResults = await semanticSearch('duty and action', 3);
    searchResults.forEach((r, i) => {
      console.log(`   Result ${i + 1}:${formatResult(r)}`);
    });

    // 3. Search by Life Situation
    console.log('\n3️⃣  Search by Life Situation');
    console.log('   Context: "dealing with grief and loss"\n');
    const contextResults = await searchByContext('dealing with grief and loss', 3);
    contextResults.forEach((r, i) => {
      console.log(`   Result ${i + 1}:${formatResult(r)}`);
    });

    // 4. Get Related Verses
    console.log('\n4️⃣  Get Related Verses');
    console.log('   Finding verses related to Chapter 2, Verse 47 (Yoga of Action)...\n');
    try {
      const related = await getRelatedVerses(2, 47, 3);
      related.forEach((r, i) => {
        console.log(`   Related ${i + 1}:${formatResult(r)}`);
      });
    } catch (error) {
      console.log(`   ⚠️  ${error.message}`);
    }

    // 5. Get Verse by Location
    console.log('\n5️⃣  Get Verse by Location');
    console.log('   Retrieving Chapter 2, Verse 2...\n');
    const verse = getVerseByLocation(2, 2);
    if (verse) {
      console.log(`   ${formatResult(verse)}`);
    } else {
      console.log('   Verse not found');
    }

    // 6. Available Metadata
    console.log('\n6️⃣  Available Metadata');
    const lifeSituations = getAvailableLifeSituations();
    const keywords = getAvailableKeywords();
    const emotions = getAvailableEmotionTags();

    console.log(`   Life Situations (${lifeSituations.length} unique):`);
    console.log(`   - ${lifeSituations.slice(0, 5).join(', ')}...`);

    console.log(`\n   Top Keywords (${keywords.length} unique):`);
    console.log(`   - ${keywords.slice(0, 5).join(', ')}...`);

    console.log(`\n   Emotion Tags (${emotions.length} unique):`);
    console.log(`   - ${emotions.join(', ')}`);

    // 7. Advanced Search
    console.log('\n7️⃣  Advanced Search');
    console.log('   Query: "spiritual practice" | Life Situation: "seeking inner peace"\n');
    const advancedResults = await advancedSearch(
      {
        query: 'spiritual practice',
        lifeSituations: ['seeking inner peace'],
      },
      3
    );
    if (advancedResults.length > 0) {
      advancedResults.forEach((r, i) => {
        console.log(`   Result ${i + 1}:${formatResult(r)}`);
      });
    } else {
      console.log('   No results matching criteria');
    }

    // 8. Random Verses
    console.log('\n8️⃣  Random Verses');
    console.log('   Getting 3 random verses...\n');
    const random = getRandomVerses(3);
    random.forEach((r, i) => {
      console.log(`   Random ${i + 1}: Chapter ${r.chapter}:${r.verse} - ${r.translation.substring(0, 60)}...`);
    });

    // 9. Performance Test
    console.log('\n9️⃣  Performance Test');
    console.log('   Running 5 sequential searches...\n');

    const perfQueries = [
      'Krishna consciousness',
      'self-realization',
      'transcendence',
      'devotion',
      'liberation',
    ];

    const startTime = Date.now();

    for (const query of perfQueries) {
      await semanticSearch(query, 1);
    }

    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / perfQueries.length;

    console.log(`   Total time: ${totalTime}ms`);
    console.log(`   Average time per search: ${avgTime.toFixed(1)}ms`);
    console.log(`   Searches per second: ${(1000 / avgTime).toFixed(1)}\n`);

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                  Test Suite Complete! ✓                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error during test:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
