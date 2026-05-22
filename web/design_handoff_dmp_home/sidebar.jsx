function Sidebar({ active, onNavigate, collapsed, onToggle, stats }) {
  const nav = [
    { id: 'home',      label: 'Home',      Icon: IconHome,      count: null },
    { id: 'browse',    label: 'Browse',    Icon: IconBrowse,    count: stats.releases },
    { id: 'explore',   label: 'Explore',   Icon: IconExplore,   count: null },
    { id: 'timeline',  label: 'Timeline',  Icon: IconTimeline,  count: null },
    { id: 'playlists', label: 'Playlists', Icon: IconPlaylists, count: 47 },
    { id: 'favorites', label: 'Favorites', Icon: IconFavorites, count: 214 },
    { id: 'issues',    label: 'Issues',    Icon: IconIssues,    count: 3 },
    { id: 'labs',      label: 'Labs',      Icon: IconLabs,      count: null },
  ];
  const foot = [
    { id: 'stats',    label: 'Statistics', Icon: IconStats },
    { id: 'settings', label: 'Settings',   Icon: IconSettings },
    { id: 'signout',  label: 'Sign out',   Icon: IconSignOut },
  ];

  return (
    <aside className="sidebar" data-screen-label="Sidebar">
      <div className="sb-head">
        <div className="sb-logo">D</div>
        <div className="sb-brand">DMP</div>
        <button className="sb-toggle" onClick={onToggle}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round"
               strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
      </div>

      {!collapsed && <div className="sb-section">Library</div>}
      <nav className="sb-nav">
        {nav.map(({ id, label, Icon, count }) => (
          <button
            key={id}
            className={`sb-item ${active === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
            title={collapsed ? label : undefined}>
            <Icon size={18}/>
            <span className="sb-item-label">{label}</span>
            {count != null && <span className="sb-item-count">{count.toLocaleString()}</span>}
          </button>
        ))}
      </nav>

      <div className="sb-foot">
        {foot.map(({ id, label, Icon }) => (
          <button key={id} className="sb-item" title={collapsed ? label : undefined}>
            <Icon size={18}/>
            <span className="sb-item-label">{label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
