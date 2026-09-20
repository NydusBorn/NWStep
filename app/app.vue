<script setup lang="ts">
useHead({
  meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  link: [{ rel: "icon", href: "/favicon.ico" }],
  htmlAttrs: {
    lang: "en",
  },
});

useSeoMeta({
  title: "NWStep — Planetary System",
  description:
    "Shader-driven simulation of a tidally deformed rocky planet with storm clusters, two moons and a red dwarf star.",
});
</script>

<template>
  <UApp class="h-dvh w-full bg-black">
    <UMain class="h-dvh">
      <NuxtPage class="h-full" />
    </UMain>
  </UApp>
</template>
