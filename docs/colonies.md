# Electrical colonies: rules and MVP

Colonies are populations, not individual creatures or labels on weather cells.
Their habitat is airborne condensate and dust. Clouds provide better electrical
feeding efficiency than dust. This is a fictional ecological model; energy uses
the existing simulation charge units, not joules.

## Rules

1. A colony has a stable ID, ancestry, generation, position, population of positive
   and negative creatures, stored energy, pulse phase, and age. Its inherited
   creature traits are efficiency, metabolism, wind response, pulse frequency,
   sociability, and the probability of a positive creature at birth. Traits do not
   drift with time. Population composition changes through births and deaths.
2. Founders are sampled reproducibly from lower-layer cloud/dust cells, visiting
   density bands from richest to poorest with random ordering inside each band
   and a minimum angular separation. Seeding waits for weather
   to form (96 ticks by default) and for at least ten candidate cells per founder.
   Automatic seeding waits until the entire batch fits in separated habitats;
   failed attempts leave its RNG unchanged. A world
   receives one artificial batch. Later spontaneous life can originate only from
   actual atmospheric lightning, as described below; there is no automatic batch
   reseeding after extinction.
   Automatic candidates must reach the Founder habitat density law (default 1 in
   cloud/cloudScale + dust/dustScale units), and usable stored charge must cover
   one tick of base maintenance for 32 creatures. This excludes electrically
   inert dense clouds. Warmup and cell-count requirements also apply.
   The Life panel allows a manual batch before readiness, after
   extinction, or alongside living colonies. Manual batches use the densest
   available sites and respect separation and total capacity, so the actual count
   can be lower than requested. They do not reset weather, time, or ancestry IDs.
   Each successful manual introduction creates a new rewind checkpoint. Existing
   seed/laws/tick exports do not include manual interventions.
3. Weather generates charge. Colonies withdraw from that same finite reserve
   before lightning breakdown; feeding therefore competes with thunder. Cloud
   efficiency exceeds dust efficiency. Inefficient harvesting dissipates the
   unused withdrawn energy. Neither feeding nor compatible contact creates energy.
4. Maintenance and steering consume energy. A finite reserve allows brief travel
   outside suitable habitat; depleted colonies lose creatures and eventually die.
5. Local capacity depends on cloud/dust density. Colonies sharing a cell and its
   neighbours compete for space. Excess density kills creatures independently of
   starvation. Capacity has a 50% floor so a small travelling colony can use its
   reserve in clear air before starving. There is also a disclosed computational
   ceiling on colony count.
   An isolated colony (no other colony within chord distance 0.25) first collects
   excess creatures for four ticks. They remain part of its population and consume
   maintenance. Sustained crowding then transfers them, their exact charge counts
   and proportional energy to a daughter colony. A random tangent impulse lasts
   eight ticks at 0.025 radians/tick, added to wind. Launch dissipates 5% of the
   transferred energy. Collection and active launch provide brief crowding grace;
   starvation still applies. Nearby colonies, the colony ceiling or lost crowding
   cancel collection. Normal density mortality still regulates non-isolated groups.
   Dispersal preserves inherited traits and generation, starts the daughter's
   reproductive cooldown, and has a separate counter from births. It cannot
   accelerate mutation. Collection and impulses rewind with the population.
6. Position follows the lower wind on the sphere. Local food-seeking and social
   preferences blend into a bounded steering request. Steering is at most a small
   fraction of wind speed: sustained travel against strong wind is impossible.
   Expanded colonies respond more slowly to wind than contracted colonies.
   Convergent winds transport colonies into the same regions as their habitat.
7. Pulse activity contracts the visible/effective colony radius. Compatible
   contacts redistribute existing energy; incompatible contacts dissipate energy.
   Charged composition contributes to compatibility alongside pulse phase.
   After three consecutive compatible contact ticks (configurable), colonies
   merge. The joined population preserves creature counts and energy; its traits
   are population-weighted averages, without mutation. Mergers have separate
   counts and source IDs and do not count as births or deaths. Breaking contact
   or losing compatibility resets the timer. A merged colony must mature before
   reproducing again. This remains an aggregate model, not individual genomes.
8. Well-fed populations grow. At sufficient population and energy a colony buds;
   compatible, mature pairs can instead contribute to a joint offspring colony.
   Parents fund child population and energy. Traits are averaged for two parents
   and mutated by a bounded +/- rate only when a new colony is born. The positive
   birth probability is inherited and mutated within 0–1 too. Budding permits evolution when
   a colony is isolated; it is an MVP extension to plan.md's two-parent reproduction.
   The default generation interval is 25 planet days (age and reproductive
   cooldown), with symmetric ±1.5% relative trait variation at birth; polarity
   probability varies by ±0.015. Changes accumulate across hundreds of days.
   Harmful changes are allowed: no fitness screening or guaranteed improvement.
9. Death/rebirth means replacement by descendants, not daily parameter randomisation.
   In this MVP creatures within one colony share inherited base traits; individual
   genomes and within-colony genetic cohorts are future work. Counts are integers.
10. All biological state and RNG state participate in rewind. While life is enabled
    or has been introduced, date jumps use exact weather replay. Existing timestep
    exports remain seed/laws/tick replays, not snapshots of an edited timeline.
    Terrain regeneration resets the habitat and colonies and starts a new history.

## Implementation

### Rare spontaneous life

After the founder batch, each tick containing actual weather breakdowns has a tiny
chance to form one colony of 1–3 creatures at one of those discharge cells. Neither
creature sparkles nor the retained lightning visual events qualify. With `N` living
creatures, each strike has chance `0.00005 / (1 + N/20)^2`; the combined chance is
capped at `0.003 / (1 + N/20)^2` per tick. These laws are editable in the sidebar.
No lightning means no revival, and a busy sky still cannot generate a large batch.

Spontaneous traits are independent wide random draws: efficiency 0.02–2,
metabolism 0.1–8, wind response 0.1–2, pulse frequency 0.03–2, social preference
and positive birth probability 0–1. There is no fitness screening. Initial energy
is at most a random quarter of the creature reserve, withdrawn from residual
weather charge. Weak newborns can die on the next tick. The census records these
births separately and shows their natural-lightning origin. RNG and attempt state
are checkpointed for exact replay. Population losses use unbiased seeded rounding,
so a tied positive/negative pair does not always leave a negative survivor.

- `life.ts`: population model, deterministic seeds, decisions, movement, feeding,
  crowding, contacts, descendants and bounded recent events.
- `clouds.ts`: optional electrical consumer before discharge; the default weather
  path is unchanged when no colony consumes charge.
- `world.ts`, `history.ts`, `fastForward.ts`: lifecycle, checkpoint and seek integration.
- `colonyLayer.ts`: yellow diagnostic outlines (orange when selected) and small
  blue/amber electrical sparkles. Independent bottom toggles control outlines
  and creatures. Outlines have no fill or glow. Left-click inside a visible
  outline to open the colony in the separate Life readout; Planet retains its
  terrain probe and planetary figure. Hidden outlines cannot be picked.
- `lightningLayer.ts`: jagged atmospheric bolts drawn only at actual weather
  breakdowns. A bounded six-tick event buffer preserves recent discharges during
  fast playback; colony visibility controls do not hide weather lightning.
- Sidebar life laws and a colony census/inspector, including counts, polarity,
  ancestry, inherited traits, food/maintenance, deaths, and decisions.

## Validation

Seed separation and reproducibility; cloud/dust efficiency; finite electrical
budget; starvation grace; overdensity deaths; fixed adult traits and bounded birth
mutation; wind dominance; funded reproduction; deterministic rewind; exact life
seeks; browser rendering and pause behaviour. Run tests, typecheck and lint.

`node scripts/verify-life.mjs 300 baseline 20260919` runs 300 planet days with
exact weather and ecology. Defaults use maintenance 0.000003, reserve 72 ticks,
harvest multiplier 8, growth 0.008 and incompatible contact loss 0.02. These
budgets match the weather's charge supply without increasing weather charging.
Before dispersal and the additional travelling reserve, two fresh 300-day runs
(seeds 20260919 and 20260920) ended with respectively
3 colonies / 494 creatures and 2 colonies / 208 creatures, both at maximum
generation 9. Most founders died early. These are survival checks, not a promise
of survival for every seed or improvement in every inherited trait.
With dispersal, 72-tick reserves and the 50% travelling-capacity floor, fresh
100-day runs of those seeds ended with 10 colonies / 749 creatures and
2 colonies / 179 creatures. The second run recorded 37 dispersals; mortality
remained possible, including among dispersed groups.

To try it: resume a new world, wait through the founder warmup, and open the
Electrical life readout. Select a colony from the census to inspect its traits.
Life → Parameters opens the life editor in the left sidebar. Reset life defaults
affects only biological laws. Restart from day 0 restarts the current seed with
the current laws and pauses it. Hiding colonies changes only their display.
Move to next colony cycles through living colonies, selects its inspector and
rotates the camera to its current position. It also works with one survivor and
is hidden when none exist. Creature death counters are cumulative since restart;
they are not colony deaths or the current number of crowded creatures.
The bottom Show/Hide view controls button collapses the entire layer toolbar and
wind legend without changing any layer visibility settings. This preference is
remembered between sessions; readouts gain more height while it is collapsed.
