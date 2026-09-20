<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSim } from '../composables/useSim'
import { population, reserve } from '../sim/life'

const { world, tick, lifeVersion, selectedColony, readoutView, select, laws, introduceColonies, seekTarget, regenerating, openLifeSettings, restartWorld, paused, nextColony } = useSim()
const batchCount = ref(laws.lifeFounders ?? 24)
const introductionMessage = ref('')
function introduce() {
  const requested = Number(batchCount.value)
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > laws.lifeMaxColonies!) {
    introductionMessage.value = `Choose a whole number from 1 to ${laws.lifeMaxColonies}.`
    return
  }
  const created = introduceColonies(requested)
  introductionMessage.value = created
    ? `Created ${created} of ${requested} colonies${created < requested ? ' (limited by spacing or capacity)' : ''}. Rewind history starts here.`
    : 'No room for more colonies at the current spacing and capacity.'
}
const census = computed(() => {
  void tick.value
  void lifeVersion.value
  const w = world.value
  if (!w) return null
  const colonies = w.life.colonies
  const chosen = colonies.find(c => c.id === selectedColony.value)
  return {
    seeded: w.life.seeded, enabled: !!w.laws.lifeEnabled, count: colonies.length,
    population: colonies.reduce((sum, c) => sum + population(c), 0),
    positive: colonies.reduce((sum, c) => sum + c.positive, 0),
    negative: colonies.reduce((sum, c) => sum + c.negative, 0),
    births: w.life.births, lightningBirths: w.life.lightningBirths, deaths: w.life.deaths, merges: w.life.merges, dispersals: w.life.dispersals, crowded: w.life.crowded, starved: w.life.starved,
    colonies: colonies.map(c => ({ id: c.id, count: population(c), generation: c.generation, cell: c.cell })),
    chosen: chosen ? { ...chosen, traits: { ...chosen.traits }, reserve: reserve(w, chosen) } : null,
    events: w.life.events.slice(-3).reverse()
  }
})
const traitNames = {
  efficiency: 'Feeding efficiency', metabolism: 'Metabolism', windResponse: 'Wind response',
  frequency: 'Pulse frequency', sociability: 'Contact preference', positiveRate: 'Positive birth probability'
}
function choose(id: number) {
  selectedColony.value = id
  select(null)
}
</script>

<template>
  <section
    v-if="census"
    class="w-[250px] rounded-lg border border-white/10 bg-[#0b0e16]/95 p-3 text-[11px] shadow-xl backdrop-blur"
    aria-label="Electrical colonies"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="font-semibold uppercase tracking-wider text-white/60">Electrical life</span>
      <button
        class="text-emerald-300"
        @click="openLifeSettings"
      >
        Parameters
      </button>
    </div>
    <p class="mb-2 text-white/50">
      Generation interval {{ laws.lifeGenerationDays }} days · birth variation ±{{ (laws.lifeMutation! * 100).toFixed(1) }}%
    </p>
    <button
      class="mb-2 text-emerald-300"
      @click="paused = true; restartWorld()"
    >
      Restart from day 0
    </button>
    <p
      v-if="!census.enabled"
      class="text-amber-300"
    >
      Life paused by its law.
    </p>
    <p
      v-else-if="!census.seeded"
      class="text-white/60"
    >
      Waiting for separated, dense cloud or dust habitats with enough electrical food. Resume to grow weather.
    </p>
    <p
      v-else-if="!census.count"
      class="text-amber-300"
    >
      Extinct. A rare natural lightning discharge may form new life; revival is not guaranteed.
    </p>
    <p class="my-2 font-mono text-emerald-300">
      {{ census.count }} colonies · {{ census.population }} creatures
    </p>
    <button
      v-if="census.count"
      class="mb-2 text-emerald-300"
      @click="nextColony"
    >
      Move to next colony
    </button>
    <form
      class="my-3 space-y-2 border-y border-white/10 py-3"
      @submit.prevent="introduce"
    >
      <label
        for="colony-batch-count"
        class="block text-white/65"
      >Artificial colony count</label>
      <div class="flex items-center gap-2">
        <input
          id="colony-batch-count"
          v-model.number="batchCount"
          type="number"
          min="1"
          :max="laws.lifeMaxColonies"
          step="1"
          required
          class="w-16 rounded border border-white/20 bg-white/5 px-2 py-1 text-white"
        >
        <UButton
          type="submit"
          size="xs"
          color="primary"
          variant="soft"
          :disabled="seekTarget !== null || regenerating"
        >
          {{ !census.seeded ? 'Force first colonies' : !census.count ? 'Restart colonies' : 'Add colonies' }}
        </UButton>
      </div>
      <p class="text-white/45">
        Uses the densest available locations. Forcing birth bypasses habitat readiness; survival is not guaranteed.
      </p>
      <p
        v-if="introductionMessage"
        role="status"
        class="text-emerald-300"
      >
        {{ introductionMessage }}
      </p>
    </form>
    <p><span class="text-amber-300">+ {{ census.positive }}</span> / <span class="text-sky-300">− {{ census.negative }}</span></p>
    <p class="mt-1 text-white/50">
      Colony births {{ census.births }} · deaths {{ census.deaths }} · merges {{ census.merges }}
    </p>
    <p class="text-white/50">
      Crowding dispersals {{ census.dispersals }}
    </p>
    <p class="text-white/50">
      Spontaneous lightning births {{ census.lightningBirths }}
    </p>
    <p class="text-white/50">
      Total creature deaths: crowding {{ census.crowded }} · starvation {{ census.starved }}
    </p>
    <div
      class="mt-2 max-h-28 overflow-y-auto"
      aria-label="Colony census"
    >
      <button
        v-for="c in census.colonies"
        :key="c.id"
        class="flex w-full justify-between rounded px-1 py-1 text-left hover:bg-white/10"
        :class="selectedColony === c.id ? 'text-emerald-300' : 'text-white/65'"
        :aria-pressed="selectedColony === c.id"
        @click="choose(c.id)"
      >
        <span>#{{ c.id }} · gen {{ c.generation }}</span><span>{{ c.count }} creatures</span>
      </button>
    </div>
    <div
      v-if="census.chosen"
      class="mt-2 space-y-1 border-t border-white/10 pt-2"
    >
      <p class="font-semibold">
        Colony #{{ census.chosen.id }} · cell {{ census.chosen.cell }}
      </p>
      <button
        class="text-emerald-300"
        @click="select(census.chosen.cell); readoutView = 'planet'"
      >
        Probe habitat
      </button>
      <p v-if="census.chosen.mergedFrom">
        Merged from: {{ census.chosen.mergedFrom.join(' + ') }}
      </p>
      <p v-else>
        Origin: {{ census.chosen.origin === 'lightning' ? 'natural lightning' : census.chosen.origin === 'dispersal' ? `dispersed from ${census.chosen.parents.join(' + ')}` : census.chosen.parents.join(' + ') || 'artificial founder' }}
      </p>
      <p>Age {{ ((tick - census.chosen.born) / laws.rotationPeriod!).toFixed(1) }} days · +{{ census.chosen.positive }} / −{{ census.chosen.negative }}</p>
      <p>Energy {{ census.chosen.energy.toExponential(2) }} / {{ census.chosen.reserve.toExponential(2) }}</p>
      <p>Food {{ census.chosen.fed.toExponential(2) }} · upkeep {{ census.chosen.cost.toExponential(2) }}/tick</p>
      <p>Food / upkeep {{ (census.chosen.fed / Math.max(1e-12, census.chosen.cost)).toFixed(2) }}×</p>
      <p>Crowding {{ census.chosen.crowding.toFixed(2) }} · {{ census.chosen.decision }}</p>
      <p class="pt-1 text-white/40">
        Inherited creature traits · fixed until descendant birth
      </p>
      <p
        v-for="(value, key) in census.chosen.traits"
        :key="key"
        class="flex justify-between"
      >
        <span>{{ traitNames[key] }}</span><span class="font-mono">{{ value.toFixed(3) }}</span>
      </p>
    </div>
    <p
      v-else-if="selectedColony !== null"
      class="mt-2 text-white/50"
    >
      Selected colony is absent at this time.
    </p>
    <p
      v-for="(event, i) in census.events"
      :key="i"
      class="mt-2 text-white/40"
    >
      Tick {{ event.tick }}: {{ event.text }}
    </p>
    <p class="mt-2 text-white/35">
      Outlines mark colony boundaries. Blue sparkles: negative creatures; amber: positive. Bottom controls hide each layer independently.
    </p>
  </section>
</template>
