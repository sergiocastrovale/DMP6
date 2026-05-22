// Library — sections + grids of cards

function Card({ album, style }) {
  const runtime = `${album.runtime} MIN`;
  return (
    <div className="card" data-comment-anchor={`card-${album.id}`}>
      <div className="card-cover">
        <CoverArt album={album}/>
        <button className="play" title="Play"><IconPlay size={16}/></button>
        {style === 'covers' && (
          <div className="card-overlay">
            <div className="card-title">{album.title}</div>
            <div className="card-artist">{album.artist}</div>
          </div>
        )}
      </div>
      {style !== 'covers' && style !== 'list' && (
        <div className="card-meta">
          <div className="card-title">{album.title}</div>
          <div className="card-artist">{album.artist}</div>
          {style === 'meta' && (
            <div className="card-foot">
              <span>{album.year}</span>
              <span className="dot"/>
              <span className="genre-clip">{album.genre}</span>
            </div>
          )}
        </div>
      )}
      {style === 'list' && (
        <>
          <div className="card-meta">
            <div className="card-title">{album.title}</div>
            <div className="card-artist">{album.artist}</div>
          </div>
          <div className="row-extra">
            <span className="re-year">{album.year}</span>
            <span className="re-genre">{album.genre}</span>
            <span className="re-tracks">{album.tracks} tracks</span>
            <span className="runtime">{album.runtime}:{String((album.tracks * 7) % 60).padStart(2,'0')}</span>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ number, title, meta, count, cardStyle, columns, children, onCardStyleChange }) {
  return (
    <section data-screen-label={`Section ${number} ${title}`}>
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-num">{number}</span>
          <h2 className="section-title">{title}</h2>
          {meta && <span className="section-meta">— {meta}</span>}
        </div>
        <div className="section-head-right">
          <button
            className={`toolbtn ${cardStyle === 'meta' ? 'active' : ''}`}
            title="Grid (with metadata)"
            onClick={() => onCardStyleChange && onCardStyleChange('meta')}>
            <IconGrid size={16}/>
          </button>
          <button
            className={`toolbtn ${cardStyle === 'list' ? 'active' : ''}`}
            title="List view"
            onClick={() => onCardStyleChange && onCardStyleChange('list')}>
            <IconList size={16}/>
          </button>
        </div>
      </div>
      <div className="grid" data-style={cardStyle} style={{ '--cols': columns }}>
        {children}
      </div>
    </section>
  );
}

function Library({ cardStyle, columns, query, onCardStyleChange }) {
  const data = window.DMP_DATA;
  const q = query.trim().toLowerCase();

  const filtered = q
    ? data.albums.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.artist.toLowerCase().includes(q) ||
        a.genre.toLowerCase().includes(q))
    : null;

  if (filtered) {
    return (
      <Section number="—" title="Search results" meta={`"${query}"`}
               count={filtered.length} cardStyle={cardStyle} columns={columns}
               onCardStyleChange={onCardStyleChange}>
        {filtered.map(a => <Card key={a.id} album={a} style={cardStyle}/>)}
      </Section>
    );
  }

  const latest = data.albums.slice(0, 10);
  const recents = data.recents.map(id => data.albums.find(a => a.id === id));
  const explore = data.albums.slice(10, 18);

  return (
    <>
      <Section number="01" title="Latest Additions"
               count={latest.length}
               cardStyle={cardStyle} columns={columns}
               onCardStyleChange={onCardStyleChange}>
        {latest.map(a => <Card key={a.id} album={a} style={cardStyle}/>)}
      </Section>

      <Section number="02" title="Recently Played"
               count={recents.length}
               cardStyle={cardStyle} columns={columns}
               onCardStyleChange={onCardStyleChange}>
        {recents.map(a => <Card key={a.id} album={a} style={cardStyle}/>)}
      </Section>

      <Section number="03" title="From the Archive"
               count={explore.length}
               cardStyle={cardStyle} columns={columns}
               onCardStyleChange={onCardStyleChange}>
        {explore.map(a => <Card key={a.id} album={a} style={cardStyle}/>)}
      </Section>
    </>
  );
}

function NowPlayingBar() {
  const album = window.DMP_DATA.albums[4]; // Language & Perspective — matches "Recently Played" leader
  return (
    <footer className="footer" data-screen-label="Now playing">
      <div className="footer-left">
        <div className="footer-cover"><CoverArt album={album}/></div>
        <div className="footer-meta">
          <div className="footer-now">Now playing</div>
          <div className="footer-meta-row">
            <div className="footer-track-title">Salt</div>
            <div className="footer-track-artist">— {album.artist}</div>
          </div>
        </div>
      </div>
      <div className="footer-controls">
        <IconChevron size={18} style={{ transform: 'rotate(180deg)' }}/>
        <button className="footer-play"><IconPlay size={14}/></button>
        <IconChevron size={18}/>
      </div>
      <div className="footer-right">
        <span className="footer-time">1:24</span>
        <div className="footer-bar"><div className="footer-bar-fill"/></div>
        <span className="footer-time">3:58</span>
      </div>
    </footer>
  );
}

Object.assign(window, { Library, NowPlayingBar });
