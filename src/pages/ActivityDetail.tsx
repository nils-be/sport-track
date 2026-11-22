import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SportBadge } from '../components/ActivityCard';
import { RunChart, SwimChart } from '../components/Charts';
import DebriefCard from '../components/DebriefCard';
import Icon from '../components/Icon';
import ZoneBars from '../components/ZoneBars';
import type { Activity, ActivityStreams, RunningAnalysis, SwimmingAnalysis } from '../lib/analysis/types';
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
      <div className="pt-10 text-center">
        <p className="font-medium">Séance introuvable.</p>
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
      <header className="flex items-center gap-3 pt-1">
        <button onClick={() => (history.length > 1 ? nav(-1) : nav('/seances'))} aria-label="Retour" className="-ml-2 grid size-10 place-items-center rounded-full active:bg-slate-200 dark:active:bg-slate-800">
          <Icon name="back" className="size-6" />
        </button>
        <SportBadge sport={a.sport} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{activityTitle(a)}</h1>
          <p className="muted text-sm first-letter:uppercase">{fmtDateLong(a.startTime)} · {fmtTime(a.startTime)}</p>
        </div>
      </header>

      <KeyStats a={a} />

      <DebriefCard activityId={a.id} />

      {a.running && <RunSection a={a} r={a.running} streams={streams ?? null} />}
      {a.swimming && <SwimSection s={a.swimming} />}

      {a.hrZones && (
        <Card title="Temps par zone cardiaque">
          <ZoneBars zones={a.hrZones} />
        </Card>
      )}

      <Extras a={a} />

      <button onClick={remove} className="muted mx-auto flex items-center gap-2 py-3 text-sm">
        <Icon name="trash" className="size-4" /> Supprimer la séance
      </button>
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
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
      <Stat label="Distance" value={fmtDistance(a)} />
      <Stat label="Durée" value={fmtDuration(a.durationS)} sub={a.elapsedS - a.durationS > 30 ? `${fmtDuration(a.elapsedS)} écoulé` : undefined} />
      {r && <Stat label="Allure moy." value={fmtPace(r.avgPaceSPerKm)} sub="/km" />}
      {s && <Stat label="Allure moy." value={fmtPace(s.avgPace100S)} sub="/100 m" />}
      <Stat label="FC moy." value={fmtNum(a.avgHr)} sub={a.maxHr ? `max ${a.maxHr}` : undefined} />
      {r && <Stat label="Dénivelé" value={r.ascentM != null ? `+${r.ascentM} m` : '–'} sub={r.descentM != null ? `−${r.descentM} m` : undefined} />}
      {r && <Stat label="Cadence" value={fmtNum(r.avgCadenceSpm)} sub="pas/min" />}
      {s && <Stat label="SWOLF moy." value={fmtNum(s.avgSwolf)} sub={s.poolLengthM ? `bassin ${s.poolLengthM} m` : undefined} />}
      {s && <Stat label="Mouvements" value={fmtNum(s.avgStrokesPerLength)} sub="par longueur" />}
      <Stat label="Calories" value={fmtNum(a.calories)} sub="kcal" />
    </section>
  );
}

// ---------------------------------------------------------------- Course

function RunSection({ a, r, streams }: { a: Activity; r: RunningAnalysis; streams: ActivityStreams | null }) {
  const [tab, setTab] = useState<'laps' | 'km'>(r.isInterval || r.laps.length > 1 ? 'laps' : 'km');
  const d = r.cardiacDrift;
  return (
    <>
      {streams && (
        <Card title="Allure et fréquence cardiaque">
          <RunChart streams={streams} />
        </Card>
      )}

      {r.isInterval && r.structure.length > 0 && (
        <Card title="Structure du fractionné">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {r.structure.map((s) => (
              <div key={s.kind} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                <p className="font-medium">{s.kind === 'steady' ? 'Continu' : LAP_KIND_LABEL[s.kind]} · {s.count}</p>
                <p className="muted text-xs">{fmtKm(s.distanceM)} · {fmtDuration(s.durationS)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title={tab === 'laps' ? `Tours (${r.laps.length})` : `Par kilomètre (${r.kmSplits.length})`}
        right={
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-slate-800">
            {(['laps', 'km'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1.5 ${tab === t ? 'bg-white font-medium shadow-sm dark:bg-slate-700' : 'muted'}`}>
                {t === 'laps' ? 'Tours' : 'Km'}
              </button>
            ))}
          </div>
        }
      >
        {tab === 'laps' ? <LapsTable r={r} /> : <KmTable r={r} />}
      </Card>

      <Card title="Dérive cardiaque">
        {d.applicable ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-2xl font-semibold">{d.decouplingPct! > 0 ? '+' : ''}{d.decouplingPct!.toString().replace('.', ',')} %</span>
              <span className="muted ml-2">
                {Math.abs(d.decouplingPct!) < 5 ? 'faible : bonne endurance sur cet effort' : 'notable : fatigue, chaleur ou allure trop élevée'}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([['1re moitié', d.firstHalf!], ['2e moitié', d.secondHalf!]] as const).map(([l, h]) => (
                <div key={l} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <p className="muted text-xs">{l}</p>
                  <p>{fmtPace(h.paceSPerKm)} /km · {h.avgHr} bpm</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted text-sm">Non applicable. {d.reason}</p>
        )}
      </Card>

      {r.bestEfforts.length > 0 && (
        <Card title="Meilleurs temps de la séance">
          <div className="flex flex-wrap gap-2 text-sm">
            {r.bestEfforts.map((b) => (
              <div key={b.distanceM} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                <p className="muted text-xs">{b.distanceM === 21097 ? 'Semi' : b.distanceM === 42195 ? 'Marathon' : fmtKm(b.distanceM).replace(',00', '')}</p>
                <p className="font-semibold">{fmtDuration(b.durationS)}</p>
                <p className="muted text-xs">{fmtPace((b.durationS / b.distanceM) * 1000)} /km</p>
              </div>
            ))}
          </div>
          {a.running?.isInterval && <p className="muted mt-2 text-xs">Calculés sur toute la séance, récupérations comprises.</p>}
        </Card>
      )}
    </>
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

function LapsTable({ r }: { r: RunningAnalysis }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-200 dark:border-slate-800">
          <th className={th}>#</th><th className={th}>Dist.</th><th className={th}>Temps</th><th className={th}>Allure</th><th className={th}>FC</th><th className={th}>Cad.</th>
        </tr></thead>
        <tbody>
          {r.laps.map((l) => (
            <tr key={l.index} className={`border-b border-slate-100 last:border-0 dark:border-slate-800/60 ${l.kind === 'recovery' || l.kind === 'rest' ? 'muted' : ''}`}>
              <td className={td}><div className="flex items-center gap-1.5">{l.index}<KindTag kind={l.kind} /></div></td>
              <td className={td}>{l.distanceM >= 1000 ? fmtKm(l.distanceM) : fmtMeters(l.distanceM)}</td>
              <td className={td}>{fmtDuration(l.durationS)}</td>
              <td className={`${td} font-medium`}>{fmtPace(l.paceSPerKm)}</td>
              <td className={td}>{fmtNum(l.avgHr)}</td>
              <td className={td}>{fmtNum(l.cadenceSpm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function SwimSection({ s }: { s: SwimmingAnalysis }) {
  const [open, setOpen] = useState<number | null>(null);
  const swimSets = s.sets.filter((x) => x.kind === 'swim');
  return (
    <>
      {s.lengths.some((l) => l.active) && (
        <Card title="Allure par longueur">
          <SwimChart lengths={s.lengths} />
        </Card>
      )}

      <Card title="Répartition">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="muted text-xs">Nage / repos</p>
            <p>{fmtDuration(s.activeTimeS)} / {fmtDuration(s.restTimeS)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="muted text-xs">Séries · longueurs</p>
            <p>{swimSets.length} séries · {s.activeLengths ?? '–'} longueurs</p>
          </div>
          {s.strokeBreakdown.map((b) => (
            <div key={b.stroke} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <p className="muted text-xs">{STROKE_LABEL[b.stroke]}</p>
              <p>{fmtMeters(b.distanceM)} · {b.lengths} long.</p>
            </div>
          ))}
        </div>
        {s.suspectLengths > 0 && (
          <p className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <Icon name="alert" className="size-4 shrink-0" />
            {s.suspectLengths} longueur{s.suspectLengths > 1 ? 's' : ''} anormalement courte{s.suspectLengths > 1 ? 's' : ''} :
            la montre a probablement coupé une longueur en deux. Elles sont exclues des records.
          </p>
        )}
      </Card>

      <Card title="Séries">
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
                  <SetRows key={x.index} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : x.index)}
                    row={
                      <>
                        <td className={td}>
                          <p className="font-medium">{fmtMeters(x.distanceM)}</p>
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
        <p className="muted mt-2 text-xs">Touchez une série pour voir ses longueurs.</p>
      </Card>

      {s.bestEfforts.length > 0 && (
        <Card title="Meilleurs temps de la séance">
          <div className="flex flex-wrap gap-2 text-sm">
            {s.bestEfforts.map((b) => (
              <div key={b.distanceM} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                <p className="muted text-xs">{b.distanceM} m</p>
                <p className="font-semibold">{fmtDuration(b.durationS)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function SetRows({ row, details, isOpen, onToggle }: { row: ReactNode; details: ReactNode; isOpen: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer border-b border-slate-100 last:border-0 dark:border-slate-800/60">
        {row}
        <td className="muted"><Icon name={isOpen ? 'down' : 'chevron'} className="size-4" /></td>
      </tr>
      {isOpen && details}
    </>
  );
}

// ---------------------------------------------------------------- Autres

function Extras({ a }: { a: Activity }) {
  const e = a.extras;
  const items: [string, string][] = [];
  if (e.aerobicTE) items.push(['Training Effect aérobie', e.aerobicTE.toFixed(1).replace('.', ',')]);
  if (e.anaerobicTE) items.push(['Training Effect anaérobie', e.anaerobicTE.toFixed(1).replace('.', ',')]);
  if (e.avgPowerW) items.push(['Puissance moy.', `${e.avgPowerW} W`]);
  if (e.normalizedPowerW) items.push(['Puissance normalisée', `${e.normalizedPowerW} W`]);
  if (a.running?.gradeAdjustedPaceSPerKm) items.push(['Allure ajustée à la pente', `${fmtPace(a.running.gradeAdjustedPaceSPerKm)} /km`]);
  if (e.avgStanceTimeMs) items.push(['Temps de contact au sol', `${Math.round(e.avgStanceTimeMs)} ms`]);
  if (e.avgStepLengthM) items.push(['Longueur de pas', `${e.avgStepLengthM.toFixed(2).replace('.', ',')} m`]);
  if (e.avgVerticalRatioPct) items.push(['Ratio vertical', `${e.avgVerticalRatioPct.toFixed(1).replace('.', ',')} %`]);
  if (a.device) items.push(['Montre', a.device]);
  if (!items.length) return null;
  return (
    <details className="card group p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
        Plus de données
        <Icon name="down" className="muted size-5 transition group-open:rotate-180" />
      </summary>
      <dl className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between py-2"><dt className="muted">{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </details>
  );
}
