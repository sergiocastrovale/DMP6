-- Moves genre/region playlist config out of scripts/playlists/{genre,region}-groups.json and into a
-- DB table editable at /playlists/setup/generated. See docs/feature_generated_playlists.md.

-- 1. New table
CREATE TABLE "PlaylistGenerator" (
    "id" TEXT NOT NULL,
    "type" "PlaylistType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaylistGenerator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaylistGenerator_slug_key" ON "PlaylistGenerator"("slug");

-- 2. Link column on Playlist
ALTER TABLE "Playlist" ADD COLUMN "generatorId" TEXT;
CREATE UNIQUE INDEX "Playlist_generatorId_key" ON "Playlist"("generatorId");
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_generatorId_fkey"
    FOREIGN KEY ("generatorId") REFERENCES "PlaylistGenerator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Seed rows, ported 1:1 from scripts/playlists/genre-groups.json and region-groups.json.
--    Genre `roots` + `includes` become plain terms, `excludes` become `-`-prefixed terms. Region
--    `countries` become terms as-is. Slugs match the old genreGroup/regionGroup values so step 4
--    below can relink existing playlists by slug.
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00010000000000000', 'GENRE', 'Rock', 'rock', 'Classic and modern rock across all subgenres', ARRAY['rock', 'grunge', 'britpop', 'new wave', 'post-rock', '-indie rock', '-indie pop']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00020000000000000', 'GENRE', 'Metal', 'metal', 'All forms of heavy metal', ARRAY['metal', 'metalcore', 'deathcore', 'grindcore', 'djent']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00030000000000000', 'GENRE', 'Post-Rock', 'post-rock', 'Post-rock and related genres', ARRAY['post-rock', 'math rock', 'slowcore', 'noise pop', 'chamber pop', 'twee pop', 'jangle pop', 'emo', 'midwest emo', '-indie rock', '-indie pop']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00040000000000000', 'GENRE', 'Indie', 'indie', 'Independent and alternative music', ARRAY['indie', 'lo-fi', 'dream pop', 'shoegaze', 'post-rock', 'post-punk', 'math rock', 'slowcore', 'noise pop', 'chamber pop', 'twee pop', 'jangle pop', 'emo', 'midwest emo']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00050000000000000', 'GENRE', 'Pop', 'pop', 'Pop music from all eras', ARRAY['pop', 'new wave', 'disco']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00060000000000000', 'GENRE', 'Electronic', 'electronic', 'Electronic and synthesizer-driven music', ARRAY['electronic', 'electro', 'techno', 'house', 'trance', 'dubstep', 'drum and bass', 'ambient', 'idm', 'downtempo', 'trip hop', 'breakbeat', 'synthwave', 'vaporwave', 'chillwave', 'uk garage', 'future bass', 'glitch', 'jungle', 'hardstyle', 'big beat', 'synth-pop', 'synthpop', 'new age']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00070000000000000', 'GENRE', 'Classical', 'classical', 'Classical, orchestral, and composed music', ARRAY['classical', 'baroque', 'romantic', 'orchestral', 'chamber music', 'opera', 'choral', 'contemporary classical', 'neoclassical', 'minimalism', 'film score', 'soundtrack']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00080000000000000', 'GENRE', 'Acoustic', 'acoustic', 'Acoustic and unplugged music', ARRAY['acoustic', 'singer-songwriter', 'folk', 'americana', 'country', 'bluegrass', 'celtic', 'bossa nova', 'world music', 'easy listening', '-folk metal', '-folk rock', '-folk punk']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00090000000000000', 'GENRE', 'Minimal', 'minimal', 'Minimal and reductive music', ARRAY['minimal', 'minimalism', 'drone', 'lowercase', 'reductionism', 'microhouse', 'synthwave', 'vaporwave', 'chillwave', 'ambient']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00100000000000000', 'GENRE', 'Prog Rock', 'prog-rock', 'Classic and modern progressive rock', ARRAY['progressive rock', 'prog rock', 'art rock', 'krautrock', 'zeuhl', 'canterbury scene', 'space rock', 'psychedelic rock', 'symphonic prog', 'neo-prog', 'neo prog', 'neo-progressive rock', 'crossover prog', 'eclectic prog', 'retro prog', 'proto-prog', 'rock progressivo italiano', 'rock progresivo italiano', 'progressive folk', 'progressive pop', 'progressive funk rock', '-progressive metal', '-progressive metalcore', '-progressive death metal', '-progressive deathcore', '-progressive black metal', '-progressive doom metal', '-progressive thrash metal', '-progressive groove metal', '-progressive power metal']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00110000000000000', 'GENRE', 'Prog Metal', 'prog-metal', 'Progressive metal, djent, and technical heavy music', ARRAY['progressive metal', 'djent', 'math rock', 'mathcore', 'progressive metalcore', 'progressive death metal', 'progressive deathcore', 'progressive black metal', 'progressive doom metal', 'progressive thrash metal', 'progressive groove metal', 'progressive power metal', 'melodic progressive death metal', 'extreme progressive metal', 'technical prog metal', 'avant-prog', 'heavy prog', 'brutal prog']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00120000000000000', 'GENRE', 'Dance', 'dance', 'Dance and club music', ARRAY['dance', 'house', 'techno', 'trance', 'disco', 'edm', 'eurodance', 'italo disco', 'uk garage', 'garage', 'dancehall', 'freestyle', 'hi-nrg', 'breakbeat']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00130000000000000', 'GENRE', 'Hip-Hop', 'hip-hop', 'Hip-hop, rap, and related genres', ARRAY['hip hop', 'hip-hop', 'rap', 'trap', 'boom bap', 'grime', 'turntablism', 'cloud rap', 'lo-fi hip hop', '-trip hop']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00140000000000000', 'GENRE', 'Jazz', 'jazz', 'Jazz across all eras and styles', ARRAY['jazz', 'bebop', 'hard bop', 'cool jazz', 'modal jazz', 'free jazz', 'swing', 'big band', 'bossa nova']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00150000000000000', 'GENRE', 'Soul & R&B', 'soul-rnb', 'Soul, R&B, and funk', ARRAY['soul', 'r&b', 'rhythm and blues', 'funk', 'motown', 'northern soul', 'new jack swing', 'quiet storm', 'gospel', 'doo-wop', '-soul jazz']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00160000000000000', 'GENRE', 'Punk', 'punk', 'Punk rock and hardcore', ARRAY['punk', 'hardcore', 'oi!', 'd-beat', 'crust', 'screamo', '-steampunk', '-cyberpunk']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00170000000000000', 'GENRE', 'Blues', 'blues', 'Blues across all eras and regional styles', ARRAY['blues', 'boogie-woogie', 'zydeco', 'jump blues', '-blues rock']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00180000000000000', 'GENRE', 'Experimental', 'experimental', 'Experimental, avant-garde, and noise music', ARRAY['experimental', 'avant-garde', 'noise', 'noise rock', 'free improvisation', 'musique concrète', 'sound art', 'sound collage', 'glitch', 'electroacoustic', '-experimental rock']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00190000000000000', 'GENRE', 'Industrial', 'industrial', 'Industrial and dark electronic music', ARRAY['industrial', 'ebm', 'electro-industrial', 'aggrotech', 'dark electro', 'post-industrial', 'power electronics', 'neofolk', 'martial industrial']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00200000000000000', 'GENRE', 'Reggae & Dub', 'reggae-dub', 'Reggae, dub, ska, and Caribbean music', ARRAY['reggae', 'dub', 'ska', 'roots reggae', 'dancehall', 'rocksteady', 'lovers rock', 'ragga', '2 tone', 'skinhead reggae', '-dub techno', '-dubstep']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00210000000000000', 'GENRE', 'Ambient', 'ambient', 'Ambient, drone, and atmospheric music', ARRAY['ambient', 'drone', 'new age', 'space music', 'dark ambient', 'ambient dub', 'ambient house', 'ambient techno']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00220000000000000', 'GENRE', 'Gothic & Darkwave', 'gothic-darkwave', 'Gothic rock, darkwave, and ethereal music', ARRAY['gothic', 'goth', 'darkwave', 'dark wave', 'deathrock', 'coldwave', 'ethereal wave', 'batcave', 'ethereal', 'neoclassical darkwave', '-gothic metal']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00230000000000000', 'GENRE', 'Latin', 'latin', 'Latin, Brazilian, and Afro-Caribbean music', ARRAY['latin', 'mpb', 'samba', 'bossa nova', 'salsa', 'cumbia', 'reggaeton', 'bachata', 'tango', 'afro-cuban', 'tropicália', 'forró', 'merengue', 'bolero', 'son cubano', 'latin jazz']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00240000000000000', 'GENRE', 'Psychedelic', 'psychedelic', 'Psychedelic music across all forms', ARRAY['psychedelic', 'psych', 'neo-psychedelia', 'acid rock', 'space rock', 'heavy psych', 'freakbeat', 'raga rock', 'krautrock', 'psytrance']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00250000000000000', 'GENRE', 'Stoner & Doom', 'stoner-doom', 'Stoner rock, doom metal, and sludge', ARRAY['stoner', 'doom', 'sludge metal', 'heavy psych', 'drone metal', 'funeral doom', 'death-doom', 'stoner metal', 'desert rock']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00260000000000000', 'GENRE', 'Country', 'country', 'Country music across all subgenres', ARRAY['country', 'bluegrass', 'honky-tonk', 'outlaw country', 'alt-country', 'americana', 'western swing', 'country blues', 'country rock', 'country pop', 'contemporary country', 'red dirt', 'texas country', 'bakersfield sound', 'nashville sound']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00270000000000000', 'GENRE', 'Garage & Lo-Fi', 'garage-lofi', 'Raw garage rock and lo-fi music', ARRAY['garage', 'lo-fi', 'lofi', 'surf rock', 'garage punk', 'garage rock', 'lo-fi indie', 'surf punk', 'frat rock', 'freakbeat', '-uk garage', '-lo-fi hip hop']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00280000000000000', 'GENRE', 'Soundtrack', 'soundtrack', 'Film scores, soundtracks, and composed media music', ARRAY['soundtrack', 'film score', 'film soundtrack', 'video game music', 'television music', 'musical theatre', 'film composer']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00290000000000000', 'GENRE', 'World & Afrobeat', 'world-afrobeat', 'World music, Afrobeat, and global traditions', ARRAY['world', 'afrobeat', 'afrobeats', 'african', 'west african', 'arabic', 'celtic', 'worldbeat', 'world fusion', 'afro house', 'highlife', 'mbalax', 'afro-beat', 'desert blues', 'gnawa', 'griot', 'ethio-jazz', 'fado', 'flamenco', 'klezmer', 'gamelan', 'qawwali', '-world & country']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00300000000000000', 'GENRE', 'Nu Metal & Rap Rock', 'nu-metal', 'Nu metal, rap rock, and 2000s crossover', ARRAY['nu metal', 'nu-metal', 'rap rock', 'rap metal', 'pop rap', 'rapcore', 'funk metal']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00310000000000000', 'GENRE', 'Old School', 'old-school', 'Classic 1940s–1960s pop, doo-wop, and early rock and roll', ARRAY['oldies', 'traditional pop', 'standards', 'doo-wop', 'rock and roll', 'rock & roll', 'rockabilly', 'crooner', 'tin pan alley', 'yé-yé', 'yèyè', 'adult standards', 'vocal jazz', '1940s', '1950s', '1960s', 'girl group', 'skiffle', 'rhythm & blues']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgeng00320000000000000', 'GENRE', 'Big Band', 'big-band', 'Big band, swing, and brass-driven jazz', ARRAY['big band', 'swing', 'dixieland', 'brass band', 'jazz orchestra', 'jump blues', 'jive', '-western swing', '-electro swing']::text[], NOW(), NOW());

INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00010000000000000', 'REGION', 'East Asia', 'east-asia', 'Music from Japan, South Korea, China, Taiwan, and Hong Kong', ARRAY['JP', 'KR', 'CN', 'TW', 'HK']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00020000000000000', 'REGION', 'South & Southeast Asia', 'south-southeast-asia', 'Music from India, Thailand, Indonesia, Philippines, Malaysia, Singapore, and Nepal', ARRAY['IN', 'TH', 'ID', 'PH', 'MY', 'SG', 'NP']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00030000000000000', 'REGION', 'West & Central Asia', 'west-central-asia', 'Music from Iran, Iraq, Turkey, Armenia, Georgia, Azerbaijan, Kazakhstan, Lebanon, Saudi Arabia, and Bahrain', ARRAY['IR', 'IQ', 'TR', 'AM', 'GE', 'AZ', 'KZ', 'LB', 'SA', 'BH']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00040000000000000', 'REGION', 'West Africa', 'west-africa', 'Music from Mali, Nigeria, Senegal, Niger, Ghana, Guinea, Benin, and Cameroon', ARRAY['ML', 'NG', 'SN', 'NE', 'GH', 'GN', 'BJ', 'CM']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00050000000000000', 'REGION', 'East & Southern Africa', 'east-southern-africa', 'Music from South Africa, Ethiopia, Tanzania, Zimbabwe, Angola, Congo, and Namibia', ARRAY['ZA', 'ET', 'TZ', 'ZW', 'AO', 'CD', 'NA']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00060000000000000', 'REGION', 'North Africa', 'north-africa', 'Music from Algeria, Tunisia, Morocco, and Egypt', ARRAY['DZ', 'TN', 'MA', 'EG']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00070000000000000', 'REGION', 'Brazil', 'brazil', 'Music from Brazil', ARRAY['BR']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00080000000000000', 'REGION', 'Southern Cone', 'southern-cone', 'Music from Argentina, Chile, Paraguay, and Uruguay', ARRAY['AR', 'CL', 'PY', 'UY']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00090000000000000', 'REGION', 'Andean & Caribbean South America', 'andean-caribbean-sa', 'Music from Colombia, Venezuela, Peru, Guyana, and Ecuador', ARRAY['CO', 'VE', 'PE', 'GY']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00100000000000000', 'REGION', 'Central America & Caribbean', 'central-america-caribbean', 'Music from Jamaica, Cuba, Mexico, Puerto Rico, Panama, Dominican Republic, Grenada, El Salvador, Bermuda, and US Virgin Islands', ARRAY['JM', 'CU', 'MX', 'PR', 'PA', 'DO', 'GD', 'SV', 'BM', 'VI']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00110000000000000', 'REGION', 'Portugal', 'portugal', 'Music from Portugal', ARRAY['PT']::text[], NOW(), NOW());
INSERT INTO "PlaylistGenerator" (id, type, name, slug, description, terms, "createdAt", "updatedAt")
VALUES ('cljgenr00120000000000000', 'REGION', 'United Kingdom', 'united-kingdom', 'Music from the United Kingdom', ARRAY['GB']::text[], NOW(), NOW());

-- 4. Relink existing generated playlists by slug (genreGroup/regionGroup matched the seed slugs above).
UPDATE "Playlist" p
SET "generatorId" = g.id
FROM "PlaylistGenerator" g
WHERE p."genreGroup" = g.slug AND g.type = 'GENRE';

UPDATE "Playlist" p
SET "generatorId" = g.id
FROM "PlaylistGenerator" g
WHERE p."regionGroup" = g.slug AND g.type = 'REGION';

-- 5. A GENRE/REGION playlist that failed to relink (stale slug, manual DB edit) has no generator left
--    to regenerate it - drop it rather than leave an orphaned non-MANUAL playlist with a null FK.
DELETE FROM "Playlist" WHERE type <> 'MANUAL' AND "generatorId" IS NULL;

-- 6. Drop the old JSON-config link columns.
ALTER TABLE "Playlist" DROP COLUMN "genreGroup";
ALTER TABLE "Playlist" DROP COLUMN "regionGroup";
