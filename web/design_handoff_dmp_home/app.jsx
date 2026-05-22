function App() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const [active, setActive] = React.useState('home');
  const [collapsed, setCollapsed] = React.useState(false);
  const [query, setQuery] = React.useState('');

  // Apply yellow intensity by remapping the CSS accent variables on body
  React.useEffect(() => {
    const intensity = t.yellowIntensity; // 0.5..1.5
    const root = document.documentElement;
    // base accent: oklch(0.82 0.18 92)
    // scale chroma with intensity
    const c = (0.18 * intensity).toFixed(3);
    const l = (0.82).toFixed(3);
    root.style.setProperty('--accent', `oklch(${l} ${c} 92)`);
    root.style.setProperty('--accent-soft', `oklch(${l} ${c} 92 / .18)`);
    root.style.setProperty('--y-glow', `oklch(${l} ${c} 92 / .18)`);
  }, [t.yellowIntensity]);

  // Apply type pairing
  React.useEffect(() => {
    const root = document.documentElement;
    const pairs = {
      modern:    { ui: "'Inter Tight'",     display: "'Inter Tight'",     mono: "'JetBrains Mono'" },
      editorial: { ui: "'Inter Tight'",     display: "'Space Grotesk'",   mono: "'JetBrains Mono'" },
      geometric: { ui: "'DM Sans'",         display: "'DM Sans'",         mono: "'JetBrains Mono'" },
      humanist:  { ui: "'Manrope'",         display: "'Manrope'",         mono: "'JetBrains Mono'" },
    };
    const p = pairs[t.typePair] || pairs.editorial;
    root.style.setProperty('--font-ui',      `${p.ui}, system-ui, sans-serif`);
    root.style.setProperty('--font-display', `${p.display}, ${p.ui}, sans-serif`);
    root.style.setProperty('--font-mono',    `${p.mono}, ui-monospace, monospace`);
  }, [t.typePair]);

  return (
    <div className="app"
         data-density={t.density}
         data-editorial={t.editorial}
         data-sidebar={collapsed ? 'collapsed' : 'open'}>
      <Sidebar
        active={active}
        onNavigate={setActive}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        stats={window.DMP_DATA.stats}/>
      <main className="main">
        <TopBar
          stats={window.DMP_DATA.stats}
          statsVariant={t.statsVariant}
          query={query}
          onQueryChange={setQuery}/>
        <div className="content">
          <Library
            cardStyle={t.cardStyle}
            columns={t.columns}
            query={query}
            onCardStyleChange={(s) => setTweak('cardStyle', s)}/>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Editorial direction"/>
        <TweakRadio label="Mode" value={t.editorial}
                    options={['catalog','magazine','studio']}
                    onChange={(v) => setTweak('editorial', v)}/>
        <TweakRadio label="Stats" value={t.statsVariant}
                    options={['hero','pills']}
                    onChange={(v) => setTweak('statsVariant', v)}/>

        <TweakSection label="Density & layout"/>
        <TweakRadio label="Density" value={t.density}
                    options={['compact','cozy','spacious']}
                    onChange={(v) => setTweak('density', v)}/>
        <TweakSelect label="Cards" value={t.cardStyle}
                    options={[
                      { value: 'meta',   label: 'Covers + meta' },
                      { value: 'covers', label: 'Covers only'  },
                      { value: 'list',   label: 'List view'    },
                    ]}
                    onChange={(v) => setTweak('cardStyle', v)}/>
        <TweakSlider label="Grid columns" value={t.columns} min={3} max={7} step={1}
                    onChange={(v) => setTweak('columns', v)}/>

        <TweakSection label="Type"/>
        <TweakSelect label="Pairing" value={t.typePair}
                    options={[
                      { value: 'editorial', label: 'Editorial — Space Grotesk + Inter Tight' },
                      { value: 'modern',    label: 'Modern — Inter Tight only' },
                      { value: 'geometric', label: 'Geometric — DM Sans' },
                      { value: 'humanist',  label: 'Humanist — Manrope' },
                    ]}
                    onChange={(v) => setTweak('typePair', v)}/>

        <TweakSection label="Accent"/>
        <TweakSlider label="Yellow intensity" value={t.yellowIntensity}
                    min={0.4} max={1.4} step={0.05}
                    onChange={(v) => setTweak('yellowIntensity', v)}/>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
