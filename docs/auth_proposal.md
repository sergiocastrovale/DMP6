# NOT TO BE IMPLEMENTED YET


## Critical changes between v6 and v5

V6 will be an auth-based software, so all of the infrastructure should be bound to a specific user (and user ID).

We will need to build the following pages:

- Simple home page with just a login form and a link to register

- Simple register page (only 2 fields: email, password, repeat password)

For now, we can instantly register and it will automatically log us into the website. We can make this better later.

The critical changes are that all the "personal" data now becomes bound to a user.

### What belongs to a user

- LocalRelease / LocalReleaseTrack

- Playlist / PlaylistTrack

- FavoriteRelease / FavoriteTrack

### What stays unchanged

- ArtistUrl

- ReleaseType

- S3DeletionQueue

- TrackArtist

### What stays unchanged but needs a connection to the user

If someone adds a row to these tables, they added to the table; however, we must link that table entry to the specific User.

- Artist

- Genre