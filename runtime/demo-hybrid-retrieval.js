/**
 * Hybrid Retrieval System - Demonstration
 * Shows how vector search combines with metadata scoring
 */

import { getTopMatches, getTopMatchesSync } from "./retrieval.js";
import { initializeVectorStore } from "./vectorStoreHelper.js";

/**
 * Format score breakdown for display
 */
function formatScoreBreakdown(scoreBreakdown) {
  const weights = {
    vector: "50%",
    emotion: "30%",
    life_situation: "15%",
    keywords: "5%"
  };

  return `
    ┌─ Score Breakdown ──────────────────┐
    │ Vector Similarity:     ${(scoreBreakdown.vector * 100).toFixed(1).padStart(5)}% (${weights.vector})
    │ Emotion Tags Match:    ${(scoreBreakdown.emotion * 100).toFixed(1).padStart(5)}% (${weights.emotion})
    │ Life Situations:       ${(scoreBreakdown.life_situation * 100).toFixed(1).padStart(5)}% (${weights.life_situation})
    │ Keywords Match:        ${(scoreBreakdown.keywords * 100).toFixed(1).padStart(5)}% (${weights.keywords})
    ├────────────────────────────────────┤
    │ FINAL SCORE:           ${(scoreBreakdown.final * 100).toFixed(1).padStart(5)}%
    └────────────────────────────────────┘
  `;
}

/**
 * Display a single result with detailed information
 */
function displayResult(result, rank) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`Rank ${rank}: Chapter ${result.chapter}, Verse ${result.verse} (ID: ${result.id})`);
  console.log(`${"-".repeat(70)}`);

  // Translation
  console.log("\n📖 Translation:");
  console.log(`   ${result.translation}`);

  // Metadata
  if (result.keywords.length > 0) {
    console.log(`\n🔑 Keywords: ${result.keywords.join(", ")}`);
  }

  if (result.life_situations.length > 0) {
    console.log(`\n🌍 Life Situations: ${result.life_situations.join(", ")}`);
  }

  if (result.emotion_tags.length > 0) {
    console.log(`\n❤️  Emotion Tags: ${result.emotion_tags.join(", ")}`);
  }

  // Score breakdown
  console.log(formatScoreBreakdown(result.score_breakdown));
}

/**
 * Run demonstration
 */
async function runDemo() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║      HYBRID RETRIEVAL SYSTEM - Demonstration               ║");
  console.log("║  Combining Vector Search + Metadata Scoring               ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    // Try to initialize vector store
    console.log("🔄 Initializing vector store...");
    try {
      await initializeVectorStore();
      console.log("✅ Vector store initialized successfully\n");
    } catch (error) {
      console.log("⚠️  Vector store not available (using metadata-only mode)\n");
    }

    // Test queries
    const queries = [
      "duty and righteousness",
      "dealing with grief and loss",
      "meditation and inner peace",
      "detachment from results",
      "Krishna's wisdom"
    ];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];

      console.log(`\n${"▓".repeat(70)}`);
      console.log(`Query ${i + 1}: "${query}"`);
      console.log(`${"▓".repeat(70)}\n`);

      // Get hybrid results
      const results = await getTopMatches(query, 3);

      if (results.length === 0) {
        console.log("No matching verses found.");
        continue;
      }

      // Display results
      results.forEach((result, index) => {
        displayResult(result, index + 1);
      });

      // Summary
      console.log("\n📊 Summary:");
      console.log(`   Total Results: ${results.length}`);
      console.log(`   Top Score: ${(results[0].final_score * 100).toFixed(1)}%`);
      if (results.length > 1) {
        console.log(`   Score Range: ${(results[results.length - 1].final_score * 100).toFixed(1)}% - ${(results[0].final_score * 100).toFixed(1)}%`);
      }
      console.log(`   Chapters Covered: ${[...new Set(results.map(r => r.chapter))].join(", ")}`);
    }

    // Scoring formula explanation
    console.log(`\n${"═".repeat(70)}`);
    console.log("📐 SCORING FORMULA");
    console.log(`${"═".repeat(70)}\n`);

    console.log("Final Score = (Vector × 0.5) + (Emotion × 0.3) + (LifeSit × 0.15) + (Keywords × 0.05)\n");

    console.log("Components:");
    console.log("  • Vector Similarity (50%): FAISS semantic search score");
    console.log("  • Emotion Tags Match (30%): How well emotion tags match query");
    console.log("  • Life Situations (15%): How well life situations match query");
    console.log("  • Keywords Match (5%): How well keywords match query\n");

    console.log("Features:");
    console.log("  ✓ Combines semantic understanding with structured metadata");
    console.log("  ✓ Returns top 3 diverse results (different chapters/emotions)");
    console.log("  ✓ Avoids duplicate results");
    console.log("  ✓ Graceful fallback to metadata-only search");
    console.log("  ✓ Complete score breakdown for each result");

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("✅ Demonstration Complete!");
  console.log(`${"═".repeat(70)}`);
}

// Run demonstration
runDemo();
