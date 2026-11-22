/** Sélecteur segmenté avec pastille glissante (même langage visuel que la barre de navigation). */
export default function Segmented<T extends string | number>({ options, value, onChange, size = 'md', className = '' }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  return (
    <div role="tablist" data-noswipe
      className={`relative flex rounded-full bg-slate-200/70 p-1 dark:bg-slate-800 ${size === 'sm' ? 'h-9 text-[13px]' : 'h-11 text-sm'} ${className}`}>
      <span aria-hidden="true" className="nav-pill absolute top-1 bottom-1 left-1 rounded-full bg-white shadow-sm dark:bg-slate-600"
        style={{ width: `calc((100% - 0.5rem) / ${n})`, transform: `translateX(${i * 100}%)` }} />
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} onClick={() => { if (o.value !== value) { navigator.vibrate?.(4); onChange(o.value); } }}
          className={`relative z-10 flex-1 rounded-full transition-colors duration-200 ${o.value === value ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
