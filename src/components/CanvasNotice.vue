<template>
  <!--
    Above everything the canvas draws and below nothing, but taking no pointer:
    it sits over the artwork it is talking about, and a gesture aimed through it
    must still land.
  -->
  <Transition name="notice">
    <div v-if="notices.notice" class="canvas-notice pointer-events-none absolute">
      <!--
        Keyed on the sequence rather than the text, so a refusal repeated
        replays the entrance instead of sitting there looking unchanged.
      -->
      <span :key="notices.notice.seq" class="canvas-notice-line">
        {{ notices.notice.text }}
      </span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useNoticeStore } from '@/stores/noticeStore'

const notices = useNoticeStore()
</script>

<style scoped>
/*
 * Centred across, a quarter down. The middle of the canvas is where the artwork
 * and the selection are, so a message parked there covers exactly what the
 * refused gesture was aimed at; a quarter down is still in the reading path and
 * clear of the tool rail on one side and the panels on the other.
 */
.canvas-notice {
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(28rem, 80%);
}

/*
 * A fixed dark plate with light text rather than the theme's card colours. This
 * is drawn over artwork whose colour nobody knows — a light page under the
 * light theme would swallow `bg-card` whole. The brush ring on this same canvas
 * is black under a white halo for the same reason: what floats over the page
 * has to read against the page, not against the chrome.
 */
.canvas-notice-line {
  display: block;
  padding: 0.5rem 0.875rem;
  border-radius: 0.5rem;
  background: rgb(0 0 0 / 0.78);
  color: rgb(255 255 255 / 0.95);
  font-size: 0.875rem;
  line-height: 1.5;
  text-align: center;
  text-wrap: balance;
  backdrop-filter: blur(2px);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
  animation: notice-said 140ms ease-out;
}

/* Fast in so it is read at once, slow out so it does not snap away in the
   corner of the eye and leave you wondering whether it was ever there. */
.notice-enter-active {
  transition: opacity 140ms ease-out;
}
.notice-leave-active {
  transition: opacity 420ms ease-in;
}
.notice-enter-from,
.notice-leave-to {
  opacity: 0;
}

@keyframes notice-said {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .canvas-notice-line {
    animation: none;
  }
  .notice-enter-active,
  .notice-leave-active {
    transition: none;
  }
}
</style>
