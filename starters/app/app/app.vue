<script setup lang="ts">
usePlausible()
</script>

<template>
  <main>
    <img src="/icon.svg" width="128" height="128" alt="{{TITLE}} icon">
    <h1>{{TITLE}}</h1>
    <p>{{DESCRIPTION}}</p>
    <nav aria-label="Support links">
      <a href="https://github.com/{{REPOSITORY}}">GitHub</a>
      <a href="https://discord.gg/RPH6SeA36N">Discord</a>
      <a href="https://lupinum.com/impressum">Impressum</a>
      <a href="https://lupinum.com/datenschutz">Privacy</a>
    </nav>
  </main>
</template>

<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; }
main { width: min(42rem, calc(100% - 2rem)); margin: 12vh auto; }
nav { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 2rem; }
</style>
