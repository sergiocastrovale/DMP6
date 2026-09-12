<script setup lang="ts">
import { Disc3, DownloadCloud, Heart, Link, RefreshCw, Trash2 } from 'lucide-vue-next'
import type { UnifiedRelease, ReleaseInfoExtra } from '~/types/release'
import { useTerminalStore } from '~/stores/terminal'
import { useDownloadsStore } from '~/stores/downloads'
import { canRedownload } from '~/helpers/artistPageLogic'
import { containmentContainerTitle, musicBrainzUrl } from '~/helpers/functions'

const props = withDefaults(defineProps<{
  release: UnifiedRelease | null
  extra: ReleaseInfoExtra | null
  isFavorite?: boolean
  isAcquiring?: boolean
  // Opt-in: the trash icon is only offered by callers that reload their release list once a delete
  // run finishes (artist page → Releases). Other openers of this dialog (player, Explore history,
  // downloads pages) don't, so a deleted release there would silently keep sitting in their state.
  removable?: boolean
}>(), {
  isFavorite: false,
  isAcquiring: false,
  removable: false,
})

const emit = defineEmits<{
  toggleFavorite: []
  refresh: []
  redownload: []
  removed: []
}>()

const model = defineModel<boolean>({ required: true })
const { releaseImage } = useImageUrl()
const { isAdmin } = useAuth()
const terminal = useTerminalStore()
const downloadsStore = useDownloadsStore()

const showDeleteDialog = ref(false)

const onRemoved = () => {
  model.value = false
  emit('removed')
}

const genreList = computed(() =>
  props.extra?.genres?.flatMap(g => g.split(',').map(s => s.trim()).filter(Boolean)) ?? [],
)

// A catalogue gap has no chosen release: sync builds the placeholder from the release *group* and
// stores that group's MBID in both columns (musicbrainzId is the unique upsert key, so it cannot be
// null). Showing it as a release ID printed the same id twice and linked to a /release/ URL that
// 404s - the row belongs to the release group alone.
const mbReleaseId = computed(() =>
  props.release?.musicbrainzId && props.release.musicbrainzId !== props.release.releaseGroupId
    ? props.release.musicbrainzId
    : null,
)

// "Recordings inside X" (scripts/sync/src/owned.rs's containment note): every track of this gap
// already sits inside a bigger local release/box, but a different edition - containment isn't
// ownership, so it stays a gap and is still downloadable. Users have no way to know that from the
// raw statusReason string alone, hence the plain-language explanation.
const containmentContainer = computed(() => containmentContainerTitle(props.release?.statusReason))

const dtClass = 'text-xs text-stone-100/60'
const ddClass = 'font-mono text-xs text-stone-100/60'
</script>

<template>
  <Dialog v-model="model" :title="release?.title ?? 'Release Info'" size="lg">
    <template #actions v-if="release">
      <ReleaseStatusBadge :status="release.status" class="mr-auto" />

      <div class="flex items-center gap-1">
        <DataTableAction
          v-if="removable && isAdmin && release.localReleaseId"
          :icon="Trash2"
          label="Remove this release"
          :disabled="terminal.isRunning"
          @click="showDeleteDialog = true"
        />
        <DownloadsDownloadDisabledButton
          v-if="canRedownload(release, downloadsStore.downloadsEnabled)"
          :icon="DownloadCloud"
          :loading="isAcquiring"
          :label="isAcquiring ? 'Requesting download...' : 'Re-download this release'"
          :reasons="downloadsStore.acquireBlockReasons"
          @click="emit('redownload')"
        />
        <DataTableAction
          v-if="release.localReleaseId"
          :icon="RefreshCw"
          label="Refresh this release"
          :disabled="terminal.isRunning"
          @click="emit('refresh')"
        />
        <DataTableAction
          v-if="release.localReleaseId || release.bundleParentReleaseId"
          :icon="Heart"
          :icon-class="isFavorite ? 'text-amber-400 fill-current' : ''"
          :label="release.localReleaseId ? 'Toggle favorite' : 'Favorite the release this is bundled in'"
          @click="emit('toggleFavorite')"
        />
      </div>
    </template>

    <template #content v-if="release">
      <div class="flex flex-col gap-6 md:flex-row">
        <div class="flex w-full shrink-0 flex-col gap-3 md:w-44">
          <UiThumb>
            <a
              v-if="releaseImage(release)"
              :href="releaseImage(release)!"
              target="_blank"
              rel="noopener noreferrer"
              class="block size-full"
            >
              <img
                :src="releaseImage(release)!"
                :alt="release.title"
                class="size-full object-cover"
              >
            </a>
            <div v-else class="flex size-full items-center justify-center text-stone-100/50">
              <Disc3 :size="32" />
            </div>
          </UiThumb>
        </div>

        <dl class="flex-1 space-y-3 text-sm">
          <div v-if="containmentContainer" class="flex items-center gap-3 border border-amber-400/10 rounded-lg p-4 bg-amber-400/5">
            <div class="text-stone-100/70 text-sm">
              <span>Every track of this release appears inside </span>
              <span class="text-white">{{ containmentContainer }}</span>
              <span> (literally the same edition, as per MusicBrainz).</span>
            </div>
          </div>
          <div v-if="release.year">
            <dt :class="dtClass">Year</dt>
            <dd :class="dtClass">
             {{ release.year }}
            </dd>
          </div>
          <div v-if="release.type">
            <dt :class="dtClass">Type</dt>
            <dd :class="dtClass">
             {{ release.type }}
            </dd>
          </div>
          <div v-if="release.country || extra?.country">
            <dt :class="dtClass">Country</dt>
            <dd :class="dtClass">{{ extra?.country || release.country }}</dd>
          </div>
          <div v-if="genreList.length">
            <dt :class="dtClass">Genres</dt>
            <dd class="flex flex-wrap gap-1">
              <NuxtLink
                v-for="genre in genreList"
                :key="genre"
                :to="`/browse?genre=${encodeURIComponent(genre)}`"
                :class="ddClass"
                class="hover:text-amber-400"
              >{{ genre }}</NuxtLink>
            </dd>
          </div>
          <div v-if="release.totalPlayCount">
            <dt :class="dtClass">Plays</dt>
            <dd class="text-2xs text-stone-100/50">{{ release.totalPlayCount.toLocaleString() }} times</dd>
          </div>
          <div v-if="release.hasLocal">
            <dt :class="dtClass">Release ID</dt>
            <dd :class="ddClass">{{ release.id }}</dd>
          </div>
          <div v-if="release.folderPath">
            <dt :class="dtClass">Folder path</dt>
            <dd :class="ddClass">{{ release.folderPath }}</dd>
          </div>
          <div v-if="extra?.bpm">
            <dt :class="dtClass">BPM</dt>
            <dd :class="ddClass">{{ extra.bpm }}</dd>
          </div>
          <div v-if="extra?.label">
            <dt :class="dtClass">Label</dt>
            <dd :class="ddClass">{{ extra.label }}</dd>
          </div>
          <div v-if="release.format">
            <dt :class="dtClass">Format</dt>
            <dd :class="ddClass">{{ release.format }}</dd>
          </div>
          <div v-if="release.packaging">
            <dt :class="dtClass">Packaging</dt>
            <dd :class="ddClass">{{ release.packaging }}</dd>
          </div>
          <div v-if="release.disambiguation">
            <dt :class="dtClass">Disambiguation</dt>
            <dd :class="ddClass">{{ release.disambiguation }}</dd>
          </div>
          <div v-if="release.editionLabel">
            <dt :class="dtClass">Edition</dt>
            <dd :class="ddClass">{{ release.editionLabel }}</dd>
          </div>
          <div v-if="release.coArtists?.length">
            <dt :class="dtClass">Co-artists</dt>
            <dd :class="ddClass">{{ release.coArtists.map(a => a.name).join(', ') }}</dd>
          </div>
          <template v-if="extra">
            <div v-for="(names, role) in extra.people" :key="role">
              <dt :class="dtClass">{{ role }}</dt>
              <dd :class="ddClass">{{ names.join(', ') }}</dd>
            </div>
          </template>
          <div v-if="mbReleaseId">
            <dt :class="dtClass">MusicBrainz release ID</dt>
            <dd :class="[ddClass, 'flex items-center gap-1.5']">
              {{ mbReleaseId }}
              <a
                :href="musicBrainzUrl(release)!"
                target="_blank"
                rel="noopener noreferrer"
                class="text-stone-100/60 hover:text-stone-100"
              >
                <Link :size="12" />
              </a>
            </dd>
          </div>
          <div v-if="release.releaseGroupId">
            <dt :class="dtClass">MusicBrainz release group ID</dt>
            <dd :class="[ddClass, 'flex items-center gap-1.5']">
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
            <dt :class="dtClass">Local release ID</dt>
            <dd :class="ddClass">{{ release.localReleaseId }}</dd>
          </div>
          <div v-if="extra?.isrc">
            <dt :class="dtClass">ISRC</dt>
            <dd :class="ddClass">{{ extra.isrc }}</dd>
          </div>
        </dl>
      </div>
    </template>
  </Dialog>

  <ReleaseDeleteDialog
    v-if="removable && release"
    v-model="showDeleteDialog"
    :release="release"
    @removed="onRemoved"
  />
</template>
