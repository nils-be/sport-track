import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SportBadge } from '../components/ActivityCard';
import AppBar from '../components/AppBar';
import { ChartCarousel, runSlides, swimSlides } from '../components/Charts';
import DebriefCard from '../components/DebriefCard';
import Icon from '../components/Icon';
import RouteMap from '../components/RouteMap';
import Segmented from '../components/Segmented';
import ZoneBars from '../components/ZoneBars';
import CorrectionSheet from '../components/CorrectionSheet';
import { useLongPress } from '../components/useLongPress';
import type { Activity, RunLap, RunningAnalysis, SwimmingAnalysis, SwimSet } from '../lib/analysis/types';
import { saveCorrection } from '../lib/corrections';
import { db, deleteActivity } from '../lib/db';
import {
  activityTitle, fmtDateLong, fmtDistance, fmtDuration, fmtKm, fmtMeters, fmtNum, fmtPace, fmtTime,
  LAP_KIND_LABEL, STROKE_LABEL,
} from '../lib/format';

export default function ActivityDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const activity = useLiveQuery(() => db.activities.get(id), [id]);
  const streams = useLiveQuery(() => db.streams.get(id), [id]);

  if (activity === undefined) return null; // chargement
  if (activity === null || !activity) {
    return (
      <div className="text-center">
        <AppBar back="/seances" title="Séance" />
        <p className="pt-6 font-medium">Séance introuvable.</p>
        <button onClick={() => nav('/seances')} className="mt-3 text-accent">Retour aux séances</button>
      </div>
    );
  }
  const a = activity;

  const remove = async () => {
    if (!confirm('Supprimer définitivement cette séance ?')) return;
    await deleteActivity(a.id);
    nav('/seances', { replace: true });
  };

  return (
    <div className="space-y-4">
      <AppBar
        back="/seances"
        title={<span className="flex items-center gap-2"><SportBadge sport={a.sport} className="size-7" />{activityTitle(a)}</span>}
        subtitle={`${fmtDateLong(a.startTime)} · ${fmtTime(a.startTime)}${a.place ? ` · ${a.place}` : ''}`}
      />

      {a.route && a.route.length > 1 && (
        <div className="card overflow-hidden"><RouteMap route={a.route} height={210} /></div>
      )}

      <KeyStats a={a} />

      <DebriefCard activityId={a.id} />

      {streams && a.running && <ChartCarousel slides={runSlides(streams)} />}
      {a.swimming && <ChartCarousel slides={swimSlides(a.swimming)} />}

      {a.running && <RunTabs a={a} r={a.running} />}
      {a.swimming && <SwimTabs a={a} s={a.swimming} />}

      <Details a={a} />

      <button onClick={remove} className="muted mx-auto flex items-center gap-2 py-3 text-sm">
        <Icon name="trash" className="size-4" /> Supprimer la séance
      </button>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="muted text-xs">{label}</p>
      <p className="truncate text-xl font-semibold">{value}</p>
      {sub && <p className="muted truncate text-xs">{sub}</p>}
    </div>
  );
}

function KeyStats({ a }: { a: Activity }) {
  const r = a.running, s = a.swimming;
  return (
    <section className="card grid grid-cols-3 gap-x-3 gap-y-4 p-4">
      <Stat label="Distance" value={fmtDistance(a)}
        sub={a.originalDistanceM != null ? `corrigée (${a.sport === 'swimming' ? fmtMeters(a.originalDistanceM) : fmtKm(a.originalDistanceM)})` : undefined} />
      <Stat label="Durée" value={fmtDuration(a.durationS)} sub={a.elapsedS - a.durationS > 30 ? `${fmtDuration(a.elapsedS)} écoulé` : undefined} />
      {r && <Stat label="Allure moy." value={fmtPace(r.avgPaceSPerKm)} sub="/km" />}
      {s && <Stat label="Allure moy." value={fmtPace(s.avgPace100S)} sub="/100 m" />}
      <Stat label="FC moy." value={fmtNum(a.avgHr)} sub={a.maxHr ? `max ${a.maxHr}` : undefined} />
      {r && <Stat label="Dénivelé" value={r.ascentM != null ? `+${r.ascentM} m` : '–'} sub={r.descentM != null ? `−${r.descentM} m` : undefined} />}
      {r && <Stat label="Cadence" value={fmtNum(r.avgCadenceSpm)} sub="pas/min" />}
      {s && <Stat label="SWOLF moy." value={fmtNum(s.avgSwolf)} sub={s.poolLengthM ? `bassin ${s.poolLengthM} m` : undefined} />}
      {s && <Stat label="Mouvements" value={fmtNum(s.avgStrokesPerLength)} sub="par longueur" />}
    </section>
  );
}

// ---------------------------------------------------------------- Onglets

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return <Segmented className="mb-3" size="sm" options={tabs.map(([v, label]) => ({ value: v, label }))} value={value} onChange={onChange} />;
}

function RunTabs({ a, r }: { a: Activity; r: RunningAnalysis }) {
  const [tab, setTab] = useState<'laps' | 'km' | 'zones'>(r.isInterval || r.laps.length > 1 ? 'laps' : 'km');
  const tabs: ['laps' | 'km' | 'zones', string][] = [['laps', `Tours · ${r.laps.length}`], ['km', 'Km'], ...(a.hrZones ? [['zones', 'Zones'] as ['zones', string]] : [])];
  return (
    <section className="card p-4">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div key={tab} className="page-in">
        {tab === 'laps' && <LapsTable r={r} activityId={a.id} />}
        {tab === 'km' && <KmTable r={r} />}
        {tab === 'zones' && a.hrZones && <ZoneBars zones={a.hrZones} />}
      </div>
    </section>
  );
}

function SwimTabs({ a, s }: { a: Activity; s: SwimmingAnalysis }) {
  const [tab, setTab] = useState<'sets' | 'zones'>('sets');
  const tabs: ['sets' | 'zones', string][] = [['sets', `Séries · ${s.sets.filter((x) => x.kind === 'swim').length}`], ...(a.hrZones ? [['zones', 'Zones'] as ['zones', string]] : [])];
  return (
    <section className="card p-4">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div key={tab} className="page-in">
        {tab === 'sets' && <SetsTable s={s} activityId={a.id} />}
        {tab === 'zones' && a.hrZones && <ZoneBars zones={a.hrZones} />}
      </div>
    </section>
  );
}

const th = 'px-1.5 py-2 text-left font-medium muted text-xs';
const td = 'px-1.5 py-2';

function KindTag({ kind }: { kind: RunningAnalysis['laps'][number]['kind'] }) {
  if (kind === 'steady') return null;
  const cls = kind === 'effort'
    ? 'bg-run-soft text-run'
    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{LAP_KIND_LABEL[kind]}</span>;
}

/** Marque discrète d'une valeur corrigée à la main. */
const Corrected = ({ title }: { title: string }) => (
  <span title={title} aria-label={title} className="ml-1 inline-flex align-middle text-accent"><Icon name="edit" className="size-3" /></span>
);

function LapRow({ l, onLong }: { l: RunLap; onLong: () => void }) {
  const press = useLongPress(onLong);
  return (
    <tr {...press} className={`border-b border-slate-100 select-none last:border-0 active:bg-slate-50 dark:border-slate-800/60 dark:active:bg-slate-800/40 ${l.kind === 'recovery' || l.kind === 'rest' ? 'muted' : ''}`}>
      <td className={td}><div className="flex items-center gap-1.5">{l.index}<KindTag kind={l.kind} /></div></td>
      <td className={td}>
        {l.distanceM >= 1000 ? fmtKm(l.distanceM) : fmtMeters(l.distanceM)}
        {l.originalDistanceM != null && <Corrected title={`Corrigé (montre : ${Math.round(l.originalDistanceM)} m)`} />}
      </td>
      <td className={td}>{fmtDuration(l.durationS)}</td>
      <td className={`${td} font-medium`}>{fmtPace(l.paceSPerKm)}</td>
      <td className={td}>{fmtNum(l.avgHr)}</td>
      <td className={td}>{fmtNum(l.cadenceSpm)}</td>
    </tr>
  );
}

function LapsTable({ r, activityId }: { r: RunningAnalysis; activityId: string }) {
  const [editing, setEditing] = useState<RunLap | null>(null);
  return (
    <>
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 dark:border-slate-800">
          <th className={th}>#</th><th className={th}>Dist.</th><th className={th}>Temps</th><th className={th}>Allure</th><th className={th}>FC</th><th className={th}>Cad.</th>
        </tr></thead>
        <tbody>
          {r.laps.map((l) => <LapRow key={l.index} l={l} onLong={() => setEditing(l)} />)}
        </tbody>
      </table>
    </div>
    <p className="muted mt-2 text-xs">Appui long sur un tour pour corriger sa distance.</p>
    {editing && (
      <CorrectionSheet title={`Corriger le tour ${editing.index}`} mode="meters" durationS={editing.durationS}
        original={Math.round(editing.originalDistanceM ?? editing.distanceM)} current={Math.round(editing.distanceM)}
        onClose={() => setEditing(null)}
        onSave={async (v) => { await saveCorrection(activityId, 'runLaps', editing.index, v); setEditing(null); }} />
    )}
    </>
  );
}

function KmTable({ r }: { r: RunningAnalysis }) {
  if (!r.kmSplits.length) return <p className="muted text-sm">Pas de données de distance seconde par seconde.</p>;
  const best = Math.min(...r.kmSplits.filter((k) => k.distanceM === 1000).map((k) => k.paceSPerKm));
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 dark:border-slate-800">
          <th className={th}>Km</th><th className={th}>Allure</th><th className={th}>FC</th><th className={th}>D+</th>
        </tr></thead>
        <tbody>
          {r.kmSplits.map((k) => (
            <tr key={k.km} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
              <td className={td}>{k.distanceM === 1000 ? k.km : `${k.km} (${fmtMeters(k.distanceM)})`}</td>
              <td className={`${td} font-medium ${k.paceSPerKm === best ? 'text-run' : ''}`}>{fmtPace(k.paceSPerKm)}</td>
              <td className={td}>{fmtNum(k.avgHr)}</td>
              <td className={td}>{k.ascentM != null ? `+${k.ascentM}` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Natation

function SetsTable({ s, activityId }: { s: SwimmingAnalysis; activityId: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<SwimSet | null>(null);
  return (
    <>
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 dark:border-slate-800">
              <th className={th}>Série</th><th className={th}>Temps</th><th className={th}>/100 m</th><th className={th}>SWOLF</th><th className={th}>FC</th><th className="w-6" />
            </tr></thead>
            <tbody>
              {s.sets.map((x) => {
                if (x.kind === 'rest') {
                  return (
                    <tr key={x.index} className="muted border-b border-slate-100 text-xs last:border-0 dark:border-slate-800/60">
                      <td className={`${td} italic`} colSpan={6}>Repos {fmtDuration(x.durationS)}{x.avgHr ? ` · FC ${x.avgHr}` : ''}</td>
                    </tr>
                  );
                }
                const lengths = s.lengths.filter((l) => l.setIndex === x.index && l.active);
                const isOpen = open === x.index;
                return (
                  <SetRows key={x.index} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : x.index)} onLong={() => setEditing(x)}
                    row={
                      <>
                        <td className={td}>
                          <p className="font-medium">
                            {fmtMeters(x.distanceM)}
                            {x.originalDistanceM != null && <Corrected title={`Corrigé (montre : ${x.originalDistanceM} m)`} />}
                          </p>
                          <p className="muted text-xs">{x.stroke ? STROKE_LABEL[x.stroke] : ''}</p>
                        </td>
                        <td className={td}>{fmtDuration(x.durationS)}</td>
                        <td className={`${td} font-medium`}>{fmtPace(x.pace100S)}</td>
                        <td className={td}>{fmtNum(x.swolf)}</td>
                        <td className={td}>{fmtNum(x.avgHr)}</td>
                      </>
                    }
                    details={lengths.map((l, i) => (
                      <tr key={l.index} className={`text-xs ${l.suspect ? 'text-amber-700 dark:text-amber-400' : 'muted'}`}>
                        <td className={`${td} pl-4`}>L{i + 1} · {l.stroke ? STROKE_LABEL[l.stroke] : '–'}{l.suspect ? ' ⚠' : ''}</td>
                        <td className={td}>{fmtDuration(l.durationS)}</td>
                        <td className={td}>{fmtPace(l.pace100S)}</td>
                        <td className={td}>{fmtNum(l.swolf)}</td>
                        <td className={td}>{fmtNum(l.avgHr)}</td>
                        <td />
                      </tr>
                    ))}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted mt-2 text-xs">Touche une série pour voir ses longueurs · appui long pour corriger sa distance.</p>
        {editing && (
          <CorrectionSheet title={`Corriger la série de ${editing.originalDistanceM ?? editing.distanceM} m`} mode="lengths" poolLengthM={s.poolLengthM}
            durationS={editing.durationS} original={editing.originalLengths ?? editing.lengths} current={editing.lengths}
            onClose={() => setEditing(null)}
            onSave={async (v) => { await saveCorrection(activityId, 'swimSets', editing.index, v); setEditing(null); }} />
        )}
    </>
  );
}

function SetRows({ row, details, isOpen, onToggle, onLong }: { row: ReactNode; details: ReactNode; isOpen: boolean; onToggle: () => void; onLong: () => void }) {
  const press = useLongPress(onLong);
  return (
    <>
      <tr {...press} onClick={onToggle} className="cursor-pointer border-b border-slate-100 select-none last:border-0 active:bg-slate-50 dark:border-slate-800/60 dark:active:bg-slate-800/40">
        {row}
        <td className="muted"><Icon name={isOpen ? 'down' : 'chevron'} className="size-4" /></td>
      </tr>
      {isOpen && details}
    </>
  );
}

// ---------------------------------------------------------------- Détails (repliable)

function Details({ a }: { a: Activity }) {
  const r = a.running, sw = a.swimming, e = a.extras;
  const items: [string, string][] = [];
  if (a.calories) items.push(['Calories', `${a.calories} kcal`]);
  if (sw) {
    items.push(['Nage / repos', `${fmtDuration(sw.activeTimeS)} / ${fmtDuration(sw.restTimeS)}`]);
    for (const b of sw.strokeBreakdown) items.push([STROKE_LABEL[b.stroke], `${fmtMeters(b.distanceM)} · ${b.lengths} longueurs`]);
  }
  if (r?.isInterval) for (const x of r.structure) items.push([x.kind === 'steady' ? 'Continu' : LAP_KIND_LABEL[x.kind], `${x.count} × · ${fmtKm(x.distanceM)} · ${fmtDuration(x.durationS)}`]);
  if (r) {
    const d = r.cardiacDrift;
    items.push(['Dérive cardiaque', d.applicable
      ? `${d.decouplingPct! > 0 ? '+' : ''}${d.decouplingPct!.toString().replace('.', ',')} % (${fmtPace(d.firstHalf!.paceSPerKm)} → ${fmtPace(d.secondHalf!.paceSPerKm)} /km, FC ${d.firstHalf!.avgHr} → ${d.secondHalf!.avgHr})`
      : 'non applicable']);
  }
  for (const b of r?.bestEfforts ?? []) items.push([`Meilleur ${b.distanceM === 21097 ? 'semi' : b.distanceM === 42195 ? 'marathon' : fmtKm(b.distanceM).replace(',00', '')}`, `${fmtDuration(b.durationS)} (${fmtPace((b.durationS / b.distanceM) * 1000)} /km)`]);
  for (const b of sw?.bestEfforts ?? []) items.push([`Meilleur ${b.distanceM} m`, fmtDuration(b.durationS)]);
  if (e.aerobicTE) items.push(['Training Effect aérobie / anaérobie', `${e.aerobicTE.toFixed(1).replace('.', ',')} / ${(e.anaerobicTE ?? 0).toFixed(1).replace('.', ',')}`]);
  if (e.avgPowerW) items.push(['Puissance moy. / normalisée', `${e.avgPowerW} / ${e.normalizedPowerW ?? '–'} W`]);
  if (r?.gradeAdjustedPaceSPerKm) items.push(['Allure ajustée à la pente', `${fmtPace(r.gradeAdjustedPaceSPerKm)} /km`]);
  if (e.avgStanceTimeMs) items.push(['Temps de contact au sol', `${Math.round(e.avgStanceTimeMs)} ms`]);
  if (e.avgStepLengthM) items.push(['Longueur de pas', `${e.avgStepLengthM.toFixed(2).replace('.', ',')} m`]);
  if (a.device) items.push(['Montre', a.device]);
  return (
    <details className="card group p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
        Détails
        <Icon name="down" className="muted size-5 transition-transform duration-300 group-open:rotate-180" />
      </summary>
      {sw && sw.suspectLengths > 0 && (
        <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <Icon name="alert" className="size-4 shrink-0" />
          {sw.suspectLengths} longueur{sw.suspectLengths > 1 ? 's' : ''} anormalement courte{sw.suspectLengths > 1 ? 's' : ''} : probablement mal détectée{sw.suspectLengths > 1 ? 's' : ''} par la montre, exclue{sw.suspectLengths > 1 ? 's' : ''} des records.
        </p>
      )}
      <dl className="page-in mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-2"><dt className="muted">{k}</dt><dd className="text-right">{v}</dd></div>
        ))}
      </dl>
    </details>
  );
}
