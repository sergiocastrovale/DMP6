



## Goals

1. index script doesn't care about 'real' artists or duplicates. 2. index scripts add all artists as equals. 3. I want to be absolutely sure we don't lose context on either artist A nor artist "A & B". 4. I think our best bet is add a field in Artist table and when syncing... 4a) we find "A & B" and mark that field with A's ID (this should represent "this artist is actually an aggregate or derived from A"). 4b) both A and "A & B" still exist in the DB, but they now share a relationship. 5. in the web UI, we make sure that: 5a) we DO NOT show artists which have that relationship not null anywhere. 5b) their catalogues are merged into what we show for artist A. 5c) those "shared" releases have a note like "Catalogued under A & B". 5d) this note is a link to a /artist/{slug} which is identical to the normal page, but has a banner on top "This artist is derived from A - its catalogue is merged with A".

## Edge cases

1. ./sync should correctly skip all artists (derived or not) that were previously processed

2. ./sync --overwrite should rebuild each artist from scratch. A new check must be made before syncing an artist: if MB ARTIST ID, check if that MB ID already exists in the current artists so that we can connect them (how do we decide which one is the main artist?)

3. ./audit --duplicates and ./fix --duplicates should work correctly

4. If we merged A with A & B during sync, then run index and find more catalogue for A & B, it should work out of the box - the derived flag is set, we just normally add to the catalogue and it will show in A's page

Ask questions. Be thorough. Very critical part of the system