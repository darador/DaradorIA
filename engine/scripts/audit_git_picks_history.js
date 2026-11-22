const { execSync } = require('child_process');

const revisions = [
  { rev: '2138553', label: '2138553 (20-Nov late)' },
  { rev: '67b9c5e', label: '67b9c5e (20-Nov night)' },
  { rev: '469ddd1', label: '469ddd1 (20-Nov night)' },
  { rev: 'cccf772', label: 'cccf772 (21-Nov 00:34)' },
  { rev: 'df26ff8', label: 'df26ff8 (21-Nov 08:41)' },
  { rev: '2bc2007', label: '2bc2007 (21-Nov 10:03)' },
  { rev: '7e25ece', label: '7e25ece (21-Nov 11:55 - Mediodía)' },
  { rev: '0aab50c', label: '0aab50c (21-Nov 12:33 - Cuarentena)' },
  { rev: '6a15341', label: '6a15341 (21-Nov 16:21 - Ingest)' },
  { rev: 'HEAD', label: 'HEAD (Actual)' }
];

revisions.forEach(({ rev, label }) => {
  try {
    const raw = execSync(`git show ${rev}:picks_hoy.json`, { maxBuffer: 15 * 1024 * 1024 }).toString('utf8');
    const parsed = JSON.parse(raw);
    const topPicks = parsed.top_picks || [];
    const dateCounts = {};
    topPicks.forEach(p => {
      const d = p.date || p.eventDateLocal || 'sin-fecha';
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });

    let approvedStorageCount = 'N/A';
    try {
      const rawApp = execSync(`git show ${rev}:engine/storage_data/approved_picks.json`, { maxBuffer: 5 * 1024 * 1024 }).toString('utf8');
      approvedStorageCount = JSON.parse(rawApp).length;
    } catch (e) {}

    let researchCandidatesCount = 'N/A';
    try {
      const rawRes = execSync(`git show ${rev}:engine/storage_data/research_candidates.json`, { maxBuffer: 15 * 1024 * 1024 }).toString('utf8');
      researchCandidatesCount = JSON.parse(rawRes).length;
    } catch (e) {}

    console.log(`\n=== ${label} ===`);
    console.log(`  top_picks en picks_hoy.json: ${topPicks.length}`);
    console.log(`  Desglose por fecha:`, JSON.stringify(dateCounts));
    console.log(`  approved_picks.json: ${approvedStorageCount}`);
    console.log(`  research_candidates.json: ${researchCandidatesCount}`);
  } catch (err) {
    console.log(`\n=== ${label} === ERROR: ${err.message}`);
  }
});
