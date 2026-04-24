import { vectorStore } from './vectorStore.js';

async function main() {
  try {
    console.log('=== Building FAISS Index for Bhagavad Gita ===\n');

    const result = await vectorStore.buildIndex();

    console.log('\n=== Build Complete ===');
    console.log(`Verses indexed: ${result.versesCount}`);
    console.log(`Embedding dimension: ${result.embeddingDimension}`);

    const stats = vectorStore.getStats();
    console.log('\nIndex Statistics:');
    console.log(`- Built: ${stats.built}`);
    console.log(`- Verses: ${stats.versesIndexed}`);
    console.log(`- Embedding Dimension: ${stats.embeddingDimension}`);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

main();
