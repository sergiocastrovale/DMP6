// Sidebar/top-bar icons — preserves the visual language from the existing DMP app.
// All icons are 20×20, stroke 1.75, currentColor.

const Icon = ({ children, size = 20, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
       strokeLinejoin="round" style={style} aria-hidden="true">
    {children}
  </svg>
);

const IconHome = (p) => (
  <Icon {...p}><path d="M3 11.5L12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/></Icon>
);
const IconBrowse = (p) => ( // library / books spine
  <Icon {...p}><path d="M4 4h3v16H4z"/><path d="M9 4h3v16H9z"/><path d="m14.5 5.2 2.9-.8 3 11.6-2.9.8z"/></Icon>
);
const IconExplore = (p) => ( // compass
  <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></Icon>
);
const IconTimeline = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></Icon>
);
const IconPlaylists = (p) => (
  <Icon {...p}><path d="M4 7h11"/><path d="M4 12h11"/><path d="M4 17h7"/><path d="M16 14v6"/><circle cx="18.5" cy="20" r="1.5"/></Icon>
);
const IconFavorites = (p) => (
  <Icon {...p}><path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.65-7 10-7 10z"/></Icon>
);
const IconIssues = (p) => (
  <Icon {...p}><path d="M12 4 3 20h18z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></Icon>
);
const IconLabs = (p) => (
  <Icon {...p}><path d="M9 3v6L4 19a2 2 0 0 0 1.8 3h12.4A2 2 0 0 0 20 19L15 9V3"/><path d="M8 3h8"/></Icon>
);
const IconStats = (p) => (
  <Icon {...p}><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></Icon>
);
const IconSettings = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></Icon>
);
const IconSignOut = (p) => (
  <Icon {...p}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/></Icon>
);
const IconSearch = (p) => (
  <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>
);
const IconSidebar = (p) => (
  <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></Icon>
);
const IconPlay = (p) => (
  <Icon {...p}><path d="M7 4v16l13-8z" fill="currentColor"/></Icon>
);
const IconClose = (p) => (
  <Icon {...p}><path d="M6 6l12 12M18 6 6 18"/></Icon>
);
const IconChevron = (p) => (
  <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>
);
const IconDot = (p) => (
  <Icon {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></Icon>
);
const IconFilter = (p) => (
  <Icon {...p}><path d="M4 5h16"/><path d="M7 12h10"/><path d="M10 19h4"/></Icon>
);
const IconGrid = (p) => (
  <Icon {...p}><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></Icon>
);
const IconList = (p) => (
  <Icon {...p}><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></Icon>
);
const IconArrowUp = (p) => (
  <Icon {...p}><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></Icon>
);

Object.assign(window, {
  IconHome, IconBrowse, IconExplore, IconTimeline, IconPlaylists,
  IconFavorites, IconIssues, IconLabs, IconStats, IconSettings,
  IconSignOut, IconSearch, IconSidebar, IconPlay, IconClose,
  IconChevron, IconDot, IconFilter, IconGrid, IconList, IconArrowUp,
});
