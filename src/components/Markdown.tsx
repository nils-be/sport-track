import type { ReactNode } from 'react';

// Rendu markdown minimal et sûr : uniquement des éléments React (aucun HTML injecté).
// Gère : titres (#…######), paragraphes, **gras**, *italique* / _italique_, `code`,
// listes à puces (-, *, •) et numérotées (1.), sous-listes simples, séparateurs (---).

/** Mise en forme en ligne : **gras**, *italique*, `code`. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+?`|\*[^*\s][^*]*?\*|_[^_\s][^_]*?_)/g;
  let last = 0, i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={k} className="font-semibold">{inline(tok.slice(2, -2), k)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-slate-100 px-1 text-[0.9em] dark:bg-slate-800">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; lines: string[] }
  | { t: 'ul' | 'ol'; items: { text: string; sub: string[] }[] }
  | { t: 'hr' };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => { if (para.length) { blocks.push({ t: 'p', lines: para }); para = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) { flush(); blocks.push({ t: 'h', level: h[1].length, text: h[2] }); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flush(); blocks.push({ t: 'hr' }); continue; }
    const li = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      const indent = li[1].replace(/\t/g, '  ').length;
      const kind = /\d/.test(li[2]) ? 'ol' : 'ul';
      const prev = blocks[blocks.length - 1];
      if (indent >= 2 && prev && (prev.t === 'ul' || prev.t === 'ol') && prev.items.length) {
        prev.items[prev.items.length - 1].sub.push(li[3]);
      } else if (prev && prev.t === kind) {
        prev.items.push({ text: li[3], sub: [] });
      } else {
        blocks.push({ t: kind, items: [{ text: li[3], sub: [] }] });
      }
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = parse(text);
  return (
    <div className={`selectable space-y-2 text-[15px] leading-relaxed ${className}`}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'h':
            return <p key={k} className={`font-semibold ${b.level <= 2 ? 'text-base' : ''} pt-1`}>{inline(b.text, k)}</p>;
          case 'hr':
            return <hr key={k} className="border-slate-200 dark:border-slate-700" />;
          case 'p':
            return <p key={k}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, `${k}-${j}`)}</span>)}</p>;
          default: {
            const List = b.t === 'ol' ? 'ol' : 'ul';
            return (
              <List key={k} className={`space-y-1 pl-5 ${b.t === 'ol' ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    {inline(it.text, `${k}-${j}`)}
                    {it.sub.length > 0 && (
                      <ul className="mt-1 list-[circle] space-y-0.5 pl-5">
                        {it.sub.map((s, n) => <li key={n}>{inline(s, `${k}-${j}-${n}`)}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}
