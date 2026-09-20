<script setup lang="ts">
const variant = 'inset'
const collapsible = 'none'
const side = 'left'

const open = ref(true)

</script>

<template>
  <div
    class="flex flex-1 h-full"
    :class="[
      variant === 'inset' && 'bg-neutral-50 dark:bg-neutral-950',
      side === 'right' && 'flex-row-reverse'
    ]"
  >
    <USidebar
      v-model:open="open"
      :variant="variant"
      :collapsible="collapsible"
      :side="side"
      :ui="{
        container: 'h-full'
      }"
    >
      <template #header>
        <UIcon name="i-logos-nuxt-icon" class="size-8" />
      </template>

      Настройки сюда
    </USidebar>

    <div
      class="flex-1 flex flex-col overflow-hidden lg:peer-data-[variant=floating]:my-4 peer-data-[variant=inset]:m-4 lg:peer-data-[variant=inset]:not-peer-data-[collapsible=offcanvas]:ms-0 peer-data-[variant=inset]:rounded-xl peer-data-[variant=inset]:shadow-sm peer-data-[variant=inset]:ring peer-data-[variant=inset]:ring-default bg-default"
    >
      <div
        class="h-(--ui-header-height) shrink-0 flex items-center px-4"
        :class="[
          variant !== 'floating' && 'border-b border-default',
          side === 'left' && 'justify-end'
        ]"
      >
        <UButton
          icon="i-lucide-play"
          color="neutral"
          variant="ghost"
        />

        <UButton
          label="1x"
          color="neutral"
          variant="ghost"
        />
        <UButton
          label="2x"
          color="neutral"
          variant="ghost"
        />
        <UButton
          label="4x"
          color="neutral"
          variant="ghost"
        />
        <UButton
          label="8x"
          color="neutral"
          variant="ghost"
        />
        <UButton
          label="16x"
          color="neutral"
          variant="ghost"
        />


        <div style="margin-left: auto; margin-right: auto;" />

        <UButton
          icon="i-lucide-download"
          label="Import Settings"
          color="neutral"
          variant="ghost"
          aria-label="Import Settings"
        />
        <UButton
          icon="i-lucide-download"
          label="Import Timestep"
          color="neutral"
          variant="ghost"
          aria-label="Import Timestep"
        />
        <UButton
          icon="i-lucide-upload"
          label="Export Settings"
          color="neutral"
          variant="ghost"
          aria-label="Export Settings"
        />
        <UButton
          icon="i-lucide-upload"
          label="Export Timestep"
          color="neutral"
          variant="ghost"
          aria-label="Export Timestep"
        />
      </div>

      <div class="flex-1 p-4 h-full w-full">
        <PlanetarySystem/>
      </div>
    </div>
  </div>
</template>
