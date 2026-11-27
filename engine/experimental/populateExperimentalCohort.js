/**
 * POPULATE EXPERIMENTAL COHORT V2.4
 * Lee candidatos históricos y de jornada reciente en el rango [1.45, 2.20],
 * ejecuta la evaluación matemática y del Tribunal V2.4, y persiste la cohorte
 * inmutable en engine/storage_data/experimental_odds_policy_v24.json.
 */

const fs = require('fs');
const path = require('path');
const ExperimentalPipelineEvaluator = require('./experimentalPipelineEvaluator');
const ExperimentalStore = require('./experimentalStore');

async function runExperimentalPopulation() {
  console.log('=== [POBLANDO COHORTE EXPERIMENTAL V2.4 (1.45 - 2.20, EV >= +8%)] ===');
  const evaluator = new ExperimentalPipelineEvaluator();
  const store = new ExperimentalStore();

  const picksData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../picks_hoy.json'), 'utf8')).top_picks;

  // Filtrar candidatos únicos en rango ampliado
  const seenKeys = new Set();
  const eligibleBatch = [];

  picksData.forEach(p => {
    const odds = Number(p.odds || p.bookmakerOdds || 0);
    if (!Number.isFinite(odds) || odds <= 1) return;

    const key = `${p.match}::${p.player || p.team}::${p.market}::${p.line}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    // Solo candidatos relevantes para auditoría (rango 1.40 a 2.30 para capturar bordes y centro)
    if (odds >= 1.40 && odds <= 2.30) {
      eligibleBatch.push(p);
    }
  });

  console.log(`Candidatos candidatos identificados para escrutinio experimental: ${eligibleBatch.length}`);

  let savedCount = 0;
  for (const raw of eligibleBatch) {
    const record = await evaluator.evaluateCandidate(raw);
    store.saveRecord(record);
    savedCount++;
  }

  const finalStore = store.loadStore();
  console.log('Población experimental completada exitosamente.');
  console.log(`Total registros en cohorte: ${finalStore.records.length}`);
  console.log('Resumen cohorte:', JSON.stringify(finalStore.summary, null, 2));
}

if (require.main === module) {
  runExperimentalPopulation().catch(err => {
    console.error('Error poblando cohorte:', err);
    process.exit(1);
  });
}

module.exports = { runExperimentalPopulation };
