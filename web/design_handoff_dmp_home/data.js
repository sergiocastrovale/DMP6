// Sample music library data for DMP — diverse genres/eras to stress-test the design

window.DMP_DATA = (() => {
  const albums = [
    { id: 'a1',  title: 'Infinite Joy',                 artist: 'Bad Suns',                   year: 2023, tracks: 11, runtime: 42,  genre: 'Indie Rock',     palette: ['#0b3d91','#f4f1ec','#0a0a0a'] },
    { id: 'a2',  title: 'OurVinyl Sessions',            artist: 'Bad Suns',                   year: 2016, tracks: 4,  runtime: 18,  genre: 'Live',           palette: ['#1f1d1c','#c9b48a','#2b2826'] },
    { id: 'a3',  title: 'Transpose',                    artist: 'Bad Suns',                   year: 2013, tracks: 5,  runtime: 22,  genre: 'Indie Rock',     palette: ['#0e2733','#d94a3d','#f0d29a'] },
    { id: 'a4',  title: 'Mystic Truth',                 artist: 'Bad Suns',                   year: 2019, tracks: 12, runtime: 45,  genre: 'Indie Rock',     palette: ['#f1ece2','#1a1a1a','#a82c1f'] },
    { id: 'a5',  title: 'Language & Perspective',       artist: 'Bad Suns',                   year: 2014, tracks: 11, runtime: 41,  genre: 'Indie Rock',     palette: ['#c8431b','#2dbcb4','#f4ce63'] },
    { id: 'a6',  title: 'Finding God Before God Finds Me', artist: 'Bad Omens',               year: 2019, tracks: 10, runtime: 39,  genre: 'Metalcore',      palette: ['#efefef','#1a1a1a','#d6b148'] },
    { id: 'a7',  title: 'THE DEATH OF PEACE OF MIND',   artist: 'Bad Omens',                  year: 2022, tracks: 14, runtime: 50,  genre: 'Norwegian Black Metal', palette: ['#a02a1a','#1a0a08','#f0a060'] },
    { id: 'a8',  title: 'Bad Omens',                    artist: 'Bad Omens',                  year: 2016, tracks: 11, runtime: 47,  genre: 'Metalcore',      palette: ['#1a2a1a','#6a4a30','#2a1810'] },
    { id: 'a9',  title: 'Kid A',                        artist: 'Radiohead',                  year: 2000, tracks: 11, runtime: 50,  genre: 'Electronic',     palette: ['#c83a18','#f3e9d0','#1a0e08'] },
    { id: 'a10', title: 'In Rainbows',                  artist: 'Radiohead',                  year: 2007, tracks: 10, runtime: 42,  genre: 'Alternative',    palette: ['#f25a00','#2a1400','#fbe2b0'] },
    { id: 'a11', title: 'Currents',                     artist: 'Tame Impala',                year: 2015, tracks: 13, runtime: 51,  genre: 'Psychedelic',    palette: ['#e85e9e','#f08020','#2a1a40'] },
    { id: 'a12', title: 'Blonde',                       artist: 'Frank Ocean',                year: 2016, tracks: 17, runtime: 60,  genre: 'R&B',            palette: ['#e8e2d5','#1f1f1f','#c08040'] },
    { id: 'a13', title: 'Channel Orange',               artist: 'Frank Ocean',                year: 2012, tracks: 17, runtime: 62,  genre: 'R&B',            palette: ['#f06820','#1a0e08','#fbe2b0'] },
    { id: 'a14', title: 'To Pimp a Butterfly',          artist: 'Kendrick Lamar',             year: 2015, tracks: 16, runtime: 79,  genre: 'Hip-Hop',        palette: ['#1f1f1f','#e8e2d5','#a02a1a'] },
    { id: 'a15', title: 'GOOD KID, M.A.A.D CITY',       artist: 'Kendrick Lamar',             year: 2012, tracks: 12, runtime: 68,  genre: 'Hip-Hop',        palette: ['#8c5a30','#1a0e08','#e8d4a8'] },
    { id: 'a16', title: 'Punisher',                     artist: 'Phoebe Bridgers',            year: 2020, tracks: 11, runtime: 40,  genre: 'Indie Folk',     palette: ['#1a2a40','#7a90b8','#0a1020'] },
    { id: 'a17', title: 'Norman F***ing Rockwell!',     artist: 'Lana Del Rey',               year: 2019, tracks: 14, runtime: 67,  genre: 'Indie Pop',      palette: ['#5a7090','#e8d4b8','#2a3848'] },
    { id: 'a18', title: 'Carrie & Lowell',              artist: 'Sufjan Stevens',             year: 2015, tracks: 11, runtime: 44,  genre: 'Indie Folk',     palette: ['#6a8090','#c8c0b0','#1f1f1f'] },
    { id: 'a19', title: 'For Emma, Forever Ago',        artist: 'Bon Iver',                   year: 2007, tracks: 9,  runtime: 38,  genre: 'Indie Folk',     palette: ['#2a3020','#a8b090','#0e0e0e'] },
    { id: 'a20', title: 'Ágætis byrjun',                artist: 'Sigur Rós',                  year: 1999, tracks: 10, runtime: 71,  genre: 'Post-Rock',      palette: ['#1a2030','#7a90a8','#e8e2d5'] },
    { id: 'a21', title: 'Discovery',                    artist: 'Daft Punk',                  year: 2001, tracks: 14, runtime: 60,  genre: 'Electronic',     palette: ['#d8a83a','#1a0e08','#f0d870'] },
    { id: 'a22', title: 'Random Access Memories',       artist: 'Daft Punk',                  year: 2013, tracks: 13, runtime: 74,  genre: 'Electronic',     palette: ['#1f1f1f','#c8a060','#0a0a0a'] },
    { id: 'a23', title: 'Selected Ambient Works 85-92', artist: 'Aphex Twin',                 year: 1992, tracks: 13, runtime: 73,  genre: 'Ambient',        palette: ['#7a4a30','#1a0e08','#c8a060'] },
    { id: 'a24', title: 'OK Computer',                  artist: 'Radiohead',                  year: 1997, tracks: 12, runtime: 53,  genre: 'Alternative',    palette: ['#e8e2d5','#1f1f1f','#a02a1a'] },
  ];

  const recents = ['a5', 'a11', 'a16', 'a12', 'a21', 'a4'];

  const stats = {
    artists: 1247,
    releases: 3892,
    tracks: 47318,
    hours: 3842,
    minutes: 34,
    sizeGB: 412,
    lastImport: '2 hours ago',
  };

  return { albums, recents, stats };
})();
