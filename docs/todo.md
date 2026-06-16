# TO DO

Advanced catalogue exploration: filter by decade, mood, intensity in a unified view

When using a non admin user I see the blank catalogue page. Why?

All scripts should have the same output format, iconography and styles


The sidebar terminal should be optional and a boolean config in /settings. 
For every action which invokes it, we should have a global wrapper that either shows the terminal sidebar or a progress panel (like in /downloads).
1. Gather through ALL places where we use the terminal
2. Add this new boolean and make it depend on a .env var SHOW_TERMINAL or db showTerminal via /settings (overrides .env)
3. All terminal panels should show or hide accordingly
4. Finally, add the generic progress panel in all pages which use the terminal sidebar; if one is showing the other shouldn't be