-- LocalReleaseTrack is 1.9M rows / ~9 GB and every ./index rewrites a large share of them. At the default
-- autovacuum_vacuum_scale_factor (0.2) vacuum waits for ~380k dead rows, so the table sat at 17% dead tuples for days.
-- Vacuum at ~2% and analyze at ~1% instead. A storage parameter: no rewrite, only a brief ShareUpdateExclusive lock.
ALTER TABLE "LocalReleaseTrack" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
