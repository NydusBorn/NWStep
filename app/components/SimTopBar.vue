<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useSim } from '../composables/useSim'

const {
  paused, speed, clock, fastSeek, seekTarget, sidebarOpen,
  unstable, rewindLimit, notice, exportJson, importJson, goToDay, goToTick
} = useSim()
const fileInput = ref<HTMLInputElement | null>(null)
const importKind = ref<'settings' | 'timestep'>('settings')
const flash = ref('')
const jumpDay = ref('')
const speeds = [-4, -1, 0.25, 1, 2, 4, 8, 16]

function download(kind: 'settings' | 'timestep') {
  const data = JSON.parse(exportJson())
  if (kind === 'settings') delete data.tick
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `nwstep-${kind}-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}
function chooseFile(kind: 'settings' | 'timestep') {
  importKind.value = kind
  fileInput.value?.click()
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (importKind.value === 'timestep' && (!Number.isSafeInteger(data.tick) || data.tick < 0)) {
      throw new Error('Choose a timestep export with a valid tick.')
    }
    if (!importJson(text)) throw new Error('Invalid simulation file.')
    paused.value = true
    await nextTick()
    if (importKind.value === 'timestep') {
      goToTick(data.tick)
      flash.value = 'Replaying to the saved timestep under its exported laws.'
    } else flash.value = 'Settings imported.'
  } catch (error) {
    flash.value = error instanceof Error ? error.message : 'Import failed.'
  } finally {
    input.value = ''
  }
}
function jump() {
  if (jumpDay.value === '') return
  const day = Number(jumpDay.value)
  if (Number.isFinite(day) && day >= 0) goToDay(day)
}
</script>

<template>
  <header class="shrink-0 border-b border-default">
    <div class="flex min-h-(--ui-header-height) flex-wrap items-center gap-1 px-4 py-2">
      <UButton
        icon="i-lucide-panel-left"
        color="neutral"
        variant="ghost"
        aria-label="Toggle laws"
        @click="sidebarOpen = !sidebarOpen"
      />
      <UButton
        :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
        color="neutral"
        variant="ghost"
        :aria-label="paused ? 'Resume' : 'Pause'"
        @click="seekTarget = null; paused = !paused"
      />
      <UButton
        v-for="s in speeds"
        :key="s"
        :label="s < 0 ? `◀ ${-s}x` : `${s}x`"
        :color="speed === s ? 'primary' : 'neutral'"
        :variant="speed === s ? 'soft' : 'ghost'"
        :aria-pressed="speed === s"
        size="xs"
        @click="speed = s"
      />
      <div class="flex flex-1 flex-wrap justify-end gap-1">
        <UButton
          icon="i-lucide-download"
          label="Import Settings"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="chooseFile('settings')"
        />
        <UButton
          icon="i-lucide-download"
          label="Import Timestep"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="chooseFile('timestep')"
        />
        <UButton
          icon="i-lucide-upload"
          label="Export Settings"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="download('settings')"
        />
        <UButton
          icon="i-lucide-upload"
          label="Export Timestep"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="download('timestep')"
        />
      </div>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        class="hidden"
        @change="onFile"
      >
    </div>
    <div class="flex flex-wrap items-center gap-3 border-t border-default px-4 py-2">
      <span class="font-mono text-xs tabular-nums text-muted">Day {{ clock.day }} · {{ String(clock.hour).padStart(2, '0') }}:{{ String(clock.minute).padStart(2, '0') }}</span>
      <form
        class="flex items-center gap-1"
        @submit.prevent="jump"
      >
        <UInput
          v-model="jumpDay"
          type="number"
          :min="0"
          :step="1"
          placeholder="Go to day"
          aria-label="Go to day"
          size="xs"
          class="w-28"
        />
        <UButton
          type="submit"
          label="Go"
          color="neutral"
          variant="soft"
          size="xs"
        />
      </form>
      <UCheckbox
        v-model="fastSeek"
        label="Fast jump"
        size="sm"
        title="Approximate destination weather on long jumps. Disable for full weather replay."
      />
    </div>
  </header>
  <UAlert
    v-if="unstable"
    color="warning"
    title="Universe destabilised"
    :description="`The solver paused at ${unstable}. Adjust the law and resume.`"
  />
  <UAlert
    v-else-if="rewindLimit !== null"
    color="info"
    title="End of recorded history"
    description="Use Go to day to replay earlier dates from the beginning."
    close
    @update:open="rewindLimit = null; speed = 1"
  />
  <UAlert
    v-else-if="notice || flash"
    color="neutral"
    :description="notice || flash"
    close
    @update:open="notice = null; flash = ''"
  />
</template>
