// Generative album-cover placeholders.
// Each album gets a deterministic visual treatment based on a hash of its id,
// using the palette from the data. Six treatments rotate so the page reads as
// a diverse catalog, not a single template.

function _hash(s) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function CoverArt({ album, size = 'md' }) {
  const { palette: [c1, c2, c3], title, artist, id } = album;
  const treatment = _hash(id) % 6;
  const initials = title.replace(/[^A-Za-z ]/g,'').split(/\s+/).map(w=>w[0]).slice(0,3).join('').toUpperCase();

  // Common SVG shell
  const wrap = (children) => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
         style={{ width:'100%', height:'100%', display:'block' }}>
      <rect width="100" height="100" fill={c1}/>
      {children}
    </svg>
  );

  if (treatment === 0) {
    // Concentric arcs — Bad Suns "Infinite Joy" style
    return wrap(<>
      <circle cx="50" cy="50" r="38" fill="none" stroke={c2} strokeWidth="0.8" opacity="0.5"/>
      <circle cx="50" cy="50" r="28" fill="none" stroke={c2} strokeWidth="0.8" opacity="0.7"/>
      <path d="M20 50 Q50 10 80 50 Q50 90 20 50" fill="none" stroke={c2} strokeWidth="1.2"/>
      <path d="M30 50 Q50 25 70 50 Q50 75 30 50" fill="none" stroke={c3} strokeWidth="1"/>
    </>);
  }
  if (treatment === 1) {
    // Stark text card — Mystic Truth style
    return wrap(<>
      <rect x="6" y="6" width="88" height="88" fill="none" stroke={c2} strokeWidth="0.5"/>
      <text x="50" y="44" textAnchor="middle" fill={c2}
            fontFamily="'Space Grotesk', sans-serif" fontSize="14" fontWeight="700"
            letterSpacing="0.5">{(title.split(' ')[0] || '').toUpperCase()}</text>
      <text x="50" y="58" textAnchor="middle" fill={c2}
            fontFamily="'Space Grotesk', sans-serif" fontSize="14" fontWeight="700"
            letterSpacing="0.5">{(title.split(' ').slice(1).join(' ') || '').toUpperCase()}</text>
      <text x="50" y="78" textAnchor="middle" fill={c3}
            fontFamily="'JetBrains Mono', monospace" fontSize="4"
            letterSpacing="2">{artist.toUpperCase()}</text>
    </>);
  }
  if (treatment === 2) {
    // Sun / spoke — Language & Perspective style
    return wrap(<>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x="48" y="10" width="4" height="35"
              fill={i % 2 ? c2 : c3}
              transform={`rotate(${i * 45} 50 50)`}/>
      ))}
      <circle cx="50" cy="50" r="14" fill={c1} stroke={c2} strokeWidth="0.8"/>
    </>);
  }
  if (treatment === 3) {
    // Horizon — gradient bands
    return wrap(<>
      <rect y="0"  width="100" height="50" fill={c2}/>
      <rect y="50" width="100" height="50" fill={c3}/>
      <circle cx="50" cy="50" r="18" fill={c1}/>
      <text x="50" y="95" textAnchor="middle" fill={c1}
            fontFamily="'JetBrains Mono', monospace" fontSize="3.5"
            letterSpacing="2">{initials}</text>
    </>);
  }
  if (treatment === 4) {
    // Big initials — bold typographic
    return wrap(<>
      <text x="6" y="78" fill={c2}
            fontFamily="'Space Grotesk', sans-serif" fontWeight="700"
            fontSize="78" letterSpacing="-4">{initials.slice(0, 2)}</text>
      <rect x="6" y="86" width="50" height="0.6" fill={c3}/>
      <text x="6" y="93" fill={c3}
            fontFamily="'JetBrains Mono', monospace" fontSize="3.5"
            letterSpacing="1.5">{album.year} · {album.genre.toUpperCase()}</text>
    </>);
  }
  // treatment === 5 — grid + dot
  return wrap(<>
    {Array.from({ length: 5 }).map((_, i) => (
      <line key={'h'+i} x1="0" x2="100" y1={20*i+10} y2={20*i+10}
            stroke={c2} strokeWidth="0.4" opacity="0.4"/>
    ))}
    {Array.from({ length: 5 }).map((_, i) => (
      <line key={'v'+i} x1={20*i+10} x2={20*i+10} y1="0" y2="100"
            stroke={c2} strokeWidth="0.4" opacity="0.4"/>
    ))}
    <circle cx="50" cy="50" r="22" fill={c3}/>
    <circle cx="50" cy="50" r="22" fill="none" stroke={c2} strokeWidth="0.8"/>
    <text x="50" y="53" textAnchor="middle" fill={c1}
          fontFamily="'Space Grotesk', sans-serif" fontWeight="700"
          fontSize="11">{initials}</text>
  </>);
}

window.CoverArt = CoverArt;
