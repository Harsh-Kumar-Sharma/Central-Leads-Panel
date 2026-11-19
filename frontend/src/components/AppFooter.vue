<script setup>
const year = new Date().getFullYear();
</script>

<template>
  <footer class="border-t border-line">
    <div class="mx-auto flex w-full max-w-[1600px] flex-col items-center gap-1 px-4 py-4 text-center text-xs text-muted sm:flex-row sm:justify-between sm:px-6 sm:text-left lg:px-8">
      <p>© {{ year }} <span class="font-semibold text-ink/80">CP Arora</span>. All rights reserved.</p>
      <p>Developed by <span class="font-semibold text-ink/80">Harsh Kumar Sharma</span></p>
    </div>
  </footer>
</template>
