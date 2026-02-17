## Artist page

- Only show the first 5 genres, if there are more, add a "View all"; clicking on it should open a dialog with the full list.

- Only show the "identifiable" links (the ones which we know an icon for that's not the 'link' icon), if there are more, add a "View all"; clicking on it should open a dialog with the full list. There should be no text on the list, only the icons; when opening the dialog, the icon + text should show for all links.

- Some artists have a status with numbers, e.g. 3 Doors Down's "Greates Hits" shows "16/16". What does that mean? I don't want that.

- The list of releases is fine and shouldn't be an actual HTML table, but we need headers for it: The first "column" does not need any text, the 2nd should be "Status" (with a ? icon next to it - when you hover it, it should show a popover listing all possible statuses).

- In the list of releases, the first column should show a small cover image with a play button. The current play button at the right can be removed.

- Before the release type tab-like separators, let's add filtering options:

  1. At the rightmost part, we should have 2 icons which will toggle the "catalogue view" (current list) and "list view".

  1a. The "list view" will reuse the current table we're displaying when we click on an existing release - make that an agnostic TrackList.vue component that we can use in both contexts. When in list view, the tabs disappear, and we'll always be displaying a full table-driven list of all releases of the artist.

  1b. The new TrackList.vue should accept columns dynamically: the first (track no.), second (title), toggle favorite and track duration should be default, but we should be able to opt on having the 'Artist', 'Release' and 'Status' columns as well.

  1c. In the current list, opening the track list of a release should not show the 'Artist' column. It's redundant.

  1d. In the new "list view", the table should show (in this order): Release, Track no., Title, Status, Toggle favorite, Track duration.

  2. At the left we should have a search input. When typing on it, the list should automatically switch to "list view" and highlight the matches from the list (make the row background a highligted color)

  3. Next to the search input, we need to have status filters in the form of a rich dropdown. We need to make this Dropdown.vue if not existing. The dropdown status options should have the pill-like looks and colors. Filtering by a given status should change the results to only display releases with that status; changing to a different tab (e.g. Album to EP) should persist the filter and list accordingly. It should also work in tandem in the "list view" mode.



