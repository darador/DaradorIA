const fs = require('fs');
const path = require('path');

// Cargar historial y picks
const histPath = path.resolve('historial_picks.json');
const picksHoyPath = path.resolve('picks_hoy.json');

const histData = JSON.parse(fs.readFileSync(histPath, 'utf8'));
const picksHoyData = JSON.parse(fs.readFileSync(picksHoyPath, 'utf8'));

// Mapa de resoluciones oficiales con datos de StatsHub para el 2026-11-22
const resolutions = {
  // 1. Ganadas
  'cand_real_statshub_20261122_yamal_1795287296257': {
    status: 'ACERTADA',
    actualStat: 9,
    rationale: 'Oficial StatsHub: 9 remates totales (1 al arco, 4 fuera, 4 bloqueados) en 90 min. Superó ampliamente la línea de Más de 2.5.'
  },
  'cand_real_statshub_20261122_iroegbunam_1795318990001': {
    status: 'ACERTADA',
    actualStat: 3,
    rationale: 'Oficial StatsHub: 3 entradas (tackles) exitosas en 44 min como titular ante Brighton. Superó la línea de Más de 2.5.'
  },
  'cand_real_statshub_20261122_fernandes_1795287296259': {
    status: 'ACERTADA',
    actualStat: 4,
    rationale: 'Oficial StatsHub: 4 remates totales (3 al arco, 1 fuera) en Anfield. Superó la línea de Más de 1.5.'
  },
  'cand_real_statshub_20261122_jacquet_1795318990003': {
    status: 'ACERTADA',
    actualStat: 2,
    rationale: 'Oficial StatsHub: 2 faltas cometidas en 93 min de titular para Liverpool ante Man Utd. Superó la línea de Más de 0.5.'
  },
  'cand_real_statshub_20261122_augsburg_1795318990010': {
    status: 'ACERTADA',
    actualStat: 9,
    rationale: 'Oficial StatsHub: FC Augsburg registró 9 remates al arco en su victoria 3-1 ante Mainz 05. Superó la línea de Más de 4.5.'
  },
  'cand_real_statshub_20261122_venezia_1795318990009': {
    status: 'ACERTADA',
    actualStat: 13,
    rationale: 'Oficial StatsHub: Venezia registró 13 remates de equipo ante Juventus. Superó la línea de Más de 8.5.'
  },
  'cand_real_statshub_20261122_yeboah_1795318990007': {
    status: 'ACERTADA',
    actualStat: 3,
    rationale: 'Oficial StatsHub: John Yeboah ingresó al min 67 y completó 3 remates totales (1 a puerta, 1 fuera, 1 bloqueado). Superó la línea de Más de 1.5.'
  },

  // 2. Perdidas
  'cand_real_statshub_20261122_romero_1795318990004': {
    status: 'FALLADA',
    actualStat: 0,
    rationale: 'Oficial StatsHub: Carlos Romero disputó 65 min como titular de lateral y no registró remates (0 remates). Línea Más de 0.5 no alcanzada.'
  },
  'cand_real_statshub_20261122_manutd_1795318990002': {
    status: 'FALLADA',
    actualStat: 10,
    rationale: 'Oficial StatsHub: Manchester United finalizó con 10 remates de equipo en Anfield. Línea Más de 11.5 no alcanzada.'
  },
  'cand_real_statshub_20261122_frosinone_1795318990008': {
    status: 'FALLADA',
    actualStat: 3,
    rationale: 'Oficial StatsHub: Frosinone completó 3 remates a puerta ante Milan en San Siro. Línea Más de 3.5 no alcanzada.'
  },
  'cand_real_statshub_20261122_adodenhaag_1795318990011': {
    status: 'FALLADA',
    actualStat: 1,
    rationale: 'Oficial StatsHub: ADO Den Haag solo pudo rematar 1 vez al arco de Ajax en el Johan Cruijff ArenA. Línea Más de 2.5 no alcanzada.'
  },

  // 3. Anuladas (Regla Elena / No titular / no jugó)
  'cand_real_statshub_20261122_gakpo_1795287296258': {
    status: 'ANULADA',
    actualStat: 0,
    rationale: 'Elena Risk Veto: Cody Gakpo no disputó minutos en el partido vs Man Utd (Ngumoha e Isak titulares). Cuota reembolsada.'
  },
  'cand_real_statshub_20261122_puga_1795318990006': {
    status: 'ANULADA',
    actualStat: 0,
    rationale: 'Elena Risk Veto: Carlos Puga no inició como titular (ingresó al min 64 como recambio). Condición T-60 de titularidad no cumplida.'
  },
  'cand_real_statshub_20261122_aramburu_1795318990005': {
    status: 'ANULADA',
    actualStat: 0,
    rationale: 'Elena Risk Veto: Jon Aramburu fue suplente (ingresó min 68 por Héctor Fort). Condición T-60 de titularidad no cumplida.'
  },
  'cand_real_statshub_20261122_wojcik_fouls': {
    status: 'ANULADA',
    actualStat: 0,
    rationale: 'Elena Risk Veto: Oskar Wójcik no formó parte de la convocatoria de Werder Bremen vs HSV. Cuota reembolsada.'
  },
  'cand_real_statshub_20261122_bonar_shots': {
    status: 'ANULADA',
    actualStat: 0,
    rationale: 'Elena Risk Veto: Javier Bonar no participó en el encuentro Girona vs Eibar. Cuota reembolsada.'
  },
  'cand_real_statshub_20261122_bremen_corners': {
    status: 'ANULADA',
    actualStat: null,
    rationale: 'Acta de córners colectivos no consolidada por proveedor oficial StatsHub. Reembolso preventivo.'
  }
};

// Actualizar tanto en histData.picks como en histData.history
const updatePickList = (list) => {
  if (!list) return;
  list.forEach(p => {
    if (resolutions[p.id]) {
      const res = resolutions[p.id];
      p.status = res.status;
      p.actual_stat = res.actualStat;
      p.settled_at = new Date().toISOString();
      p.notes = res.rationale;

      const odds = Number(p.odds) || 1.0;
      if (res.status === 'ACERTADA' || res.status === 'GANADA') {
        p.profit_loss = parseFloat((odds - 1.0).toFixed(2));
        p.profit = `+${(odds - 1.0).toFixed(2)}U`;
      } else if (res.status === 'FALLADA' || res.status === 'PERDIDA') {
        p.profit_loss = -1.0;
        p.profit = '-1.00U';
      } else {
        p.profit_loss = 0.0;
        p.profit = '0.00U';
      }
    }
  });
};

updatePickList(histData.picks);
if (histData.history) {
  histData.history = JSON.parse(JSON.stringify(histData.picks));
}

// Recalcular métricas
const histPicks = histData.picks;
let totalBets = 0;
let wonBets = 0;
let lostBets = 0;
let voidBets = 0;
let pendingBets = 0;
let netProfit = 0.0;

const byMarket = {};

histPicks.forEach(p => {
  totalBets++;
  const m = p.market || 'Otros';
  if (!byMarket[m]) {
    byMarket[m] = { total: 0, won: 0, lost: 0, void: 0, profit: 0.0 };
  }
  byMarket[m].total++;

  if (p.status === 'ACERTADA' || p.status === 'GANADA') {
    wonBets++;
    const prof = (p.profit_loss !== undefined ? p.profit_loss : (Number(p.odds) - 1.0));
    netProfit += prof;
    byMarket[m].won++;
    byMarket[m].profit += prof;
  } else if (p.status === 'FALLADA' || p.status === 'PERDIDA') {
    lostBets++;
    netProfit -= 1.0;
    byMarket[m].lost++;
    byMarket[m].profit -= 1.0;
  } else if (p.status === 'ANULADA' || p.status === 'ANULADA_NO_TITULAR') {
    voidBets++;
    byMarket[m].void++;
  } else {
    pendingBets++;
  }
});

const formattedByMarket = {};
for (const [k, v] of Object.entries(byMarket)) {
  const closed = v.won + v.lost;
  const wr = closed > 0 ? ((v.won / closed) * 100).toFixed(1) + '%' : '0.0%';
  const profitStr = (v.profit >= 0 ? '+' : '') + v.profit.toFixed(2) + 'U';
  formattedByMarket[k] = {
    total: v.total,
    won: v.won,
    lost: v.lost,
    void: v.void,
    win_rate: wr,
    profit: profitStr
  };
}

const closedBets = wonBets + lostBets;
const winRatePct = closedBets > 0 ? parseFloat(((wonBets / closedBets) * 100).toFixed(1)) : 0.0;
const investedUnits = closedBets;
const roiPct = investedUnits > 0 ? parseFloat(((netProfit / investedUnits) * 100).toFixed(1)) : 0.0;

histData.summary = {
  total_picks: totalBets,
  won: wonBets,
  lost: lostBets,
  void: voidBets,
  pending: pendingBets,
  win_rate: `${winRatePct}%`,
  net_profit_units: parseFloat(netProfit.toFixed(2)),
  roi_pct: roiPct,
  yield_pct: roiPct,
  by_market: formattedByMarket
};
histData.updated_at = new Date().toISOString();

fs.writeFileSync(histPath, JSON.stringify(histData, null, 2), 'utf8');
console.log(`[Historial] Actualizado: picks y history sincronizados.`);
console.log(`[Resumen Historial] Ganadas: ${wonBets} | Perdidas: ${lostBets} | Anuladas: ${voidBets} | Pendientes: ${pendingBets} | Win Rate: ${winRatePct}% | Balance: +${netProfit.toFixed(2)}U | ROI: ${roiPct}%`);

// Actualizar también en picks_hoy.json
(picksHoyData.top_picks || []).forEach(p => {
  if (resolutions[p.id]) {
    const res = resolutions[p.id];
    p.status = res.status;
    p.is_finished = true;
    p.actual_stat = res.actualStat;
    p.result = res.status;
    p.rationale = res.rationale;
  }
});

picksHoyData.updated_at = new Date().toISOString();
fs.writeFileSync(picksHoyPath, JSON.stringify(picksHoyData, null, 2), 'utf8');
console.log(`[PicksHoy] picks_hoy.json sincronizado.`);
