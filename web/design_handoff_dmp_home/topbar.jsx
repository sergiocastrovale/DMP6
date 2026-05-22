function TopBar({ stats, statsVariant, query, onQueryChange }) {
  const fmt = (n) => n.toLocaleString();
  return (
    <header className="topbar" data-screen-label="Top bar">
      {statsVariant === 'pills' ? <StatsPills stats={stats}/> : <StatsHero stats={stats}/>}
      <div className="search">
        <span className="search-icon"><IconSearch size={16}/></span>
        <input
          className="search-input"
          type="text"
          placeholder="Search artists, releases, tracks…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}/>
        {!query && <span className="search-kbd">⌘ K</span>}
      </div>
    </header>
  );
}

function StatsHero({ stats }) {
  return (
    <div className="stats-hero">
      <div className="stat-hero">
        <div className="stat-hero-num">{stats.artists.toLocaleString()}</div>
        <div className="stat-hero-label">Artists</div>
      </div>
      <div className="stats-divider"/>
      <div className="stat-hero">
        <div className="stat-hero-num">{stats.releases.toLocaleString()}</div>
        <div className="stat-hero-label">Releases</div>
      </div>
      <div className="stats-divider"/>
      <div className="stat-hero">
        <div className="stat-hero-num">{stats.tracks.toLocaleString()}</div>
        <div className="stat-hero-label">Tracks</div>
      </div>
      <div className="stats-divider"/>
      <div className="stat-hero featured">
        <div className="stat-hero-num">
          {stats.hours.toLocaleString()}<span className="unit">h</span>
          {' '}{stats.minutes}<span className="unit">m</span>
        </div>
        <div className="stat-hero-label">Total playtime</div>
      </div>
    </div>
  );
}

function StatsPills({ stats }) {
  return (
    <div className="stats-pills">
      <div className="stat-pill"><strong>{stats.artists.toLocaleString()}</strong> artists</div>
      <div className="stat-pill"><strong>{stats.releases.toLocaleString()}</strong> releases</div>
      <div className="stat-pill"><strong>{stats.tracks.toLocaleString()}</strong> tracks</div>
      <div className="stat-pill accent">
        <strong>{stats.hours.toLocaleString()}h {stats.minutes}m</strong> playtime
      </div>
    </div>
  );
}

window.TopBar = TopBar;
