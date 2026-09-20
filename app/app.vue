<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en', class: 'dark' },
  bodyAttrs: { class: 'bg-[#05070d]' }
})

useSeoMeta({
  title: 'NWStep — Planetary System',
  description: 'A planetary simulator whose physical laws are the controls. Edit the constants and exponents, watch the terrain, winds and jet streams reorganise.'
})
</script>

<template>
  <UApp class="h-dvh w-full">
    <NuxtPage />
  </UApp>
</template>
