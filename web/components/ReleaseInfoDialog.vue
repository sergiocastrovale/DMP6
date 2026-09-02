<script setup lang="ts">
import { Disc3, Link } from 'lucide-vue-next'
import type { UnifiedRelease, ReleaseInfoExtra } from '~/types/release'

defineProps<{
  release: UnifiedRelease | null
  extra: ReleaseInfoExtra | null
}>()

const model = defineModel<boolean>({ required: true })
const { releaseImage } = useImageUrl()
</script>

<template>
  <Dialog v-model="model" :title="release?.title ?? 'Release Info'" size="lg">
    <template v-if="release">
      <div class="flex gap-6">
        <div class="flex w-44 shrink-0 flex-col gap-3">
          <UiThumb>
            <img
              v-if="releaseImage(release)"
              :src="releaseImage(release)!"
              :alt="release.title"
              class="size-full object-cover"
            >
            <div v-else class="flex size-full items-center justify-center text-stone-100/50">
              <Disc3 :size="32" />
            </div>
          </UiThumb>
          <div v-if="release.type || release.year" class="flex items-center gap-1.5 text-xs text-stone-100/60">
            <span v-if="release.type">{{ release.type }}</span>
            <span v-if="release.type && release.year">&middot;</span>
            <span v-if="release.year">{{ release.year }}</span>
          </div>
          <div v-if="release.country || extra?.country" class="text-xs text-stone-100/60">
            {{ extra?.country || release.country }}
          </div>
          <div v-if="extra?.genres?.length" class="flex flex-wrap gap-1">
            <span
              v-for="genre in extra.genres"
              :key="genre"
              class="rounded-full bg-stone-800 px-2 py-0.5 text-2xs text-stone-100/60"
            >{{ genre }}</span>
          </div>
          <div v-if="release.totalPlayCount" class="text-2xs text-stone-100/50">
            Played {{ release.totalPlayCount.toLocaleString() }} times
          </div>
        </div>

        <dl class="flex-1 space-y-3 text-sm">
          <div>
            <dt class="text-xs text-stone-100/60">Release ID</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.id }}</dd>
          </div>
          <div v-if="release.folderPath">
            <dt class="text-xs text-stone-100/60">Folder path</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.folderPath }}</dd>
          </div>
          <div v-if="extra?.bpm">
            <dt class="text-xs text-stone-100/60">BPM</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ extra.bpm }}</dd>
          </div>
          <div v-if="extra?.label">
            <dt class="text-xs text-stone-100/60">Label</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ extra.label }}</dd>
          </div>
          <div v-if="release.format">
            <dt class="text-xs text-stone-100/60">Format</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.format }}</dd>
          </div>
          <div v-if="release.packaging">
            <dt class="text-xs text-stone-100/60">Packaging</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.packaging }}</dd>
          </div>
          <div v-if="release.disambiguation">
            <dt class="text-xs text-stone-100/60">Disambiguation</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.disambiguation }}</dd>
          </div>
          <div v-if="release.editionLabel">
            <dt class="text-xs text-stone-100/60">Edition</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.editionLabel }}</dd>
          </div>
          <div v-if="release.coArtists?.length">
            <dt class="text-xs text-stone-100/60">Co-artists</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.coArtists.map(a => a.name).join(', ') }}</dd>
          </div>
          <template v-if="extra">
            <div v-for="(names, role) in extra.people" :key="role">
              <dt class="text-xs text-stone-100/60">{{ role }}</dt>
              <dd class="font-mono text-xs text-stone-100/60">{{ names.join(', ') }}</dd>
            </div>
          </template>
          <div v-if="release.musicbrainzId">
            <dt class="text-xs text-stone-100/60">MusicBrainz release ID</dt>
            <dd class="flex items-center gap-1.5 font-mono text-xs text-stone-100/60">
              {{ release.musicbrainzId }}
              <a
                :href="`https://musicbrainz.org/release/${release.musicbrainzId}`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-stone-100/60 hover:text-stone-100"
              >
                <Link :size="12" />
              </a>
            </dd>
          </div>
          <div v-if="release.releaseGroupId">
            <dt class="text-xs text-stone-100/60">MusicBrainz release group ID</dt>
            <dd class="flex items-center gap-1.5 font-mono text-xs text-stone-100/60">
              {{ release.releaseGroupId }}
              <a
                :href="`https://musicbrainz.org/release-group/${release.releaseGroupId}`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-stone-100/60 hover:text-stone-100"
              >
                <Link :size="12" />
              </a>
            </dd>
          </div>
          <div v-if="release.localReleaseId">
            <dt class="text-xs text-stone-100/60">Local release ID</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ release.localReleaseId }}</dd>
          </div>
          <div v-if="extra?.isrc">
            <dt class="text-xs text-stone-100/60">ISRC</dt>
            <dd class="font-mono text-xs text-stone-100/60">{{ extra.isrc }}</dd>
          </div>
        </dl>
      </div>
    </template>
  </Dialog>
</template>
