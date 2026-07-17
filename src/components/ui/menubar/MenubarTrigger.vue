<script setup lang="ts">
import type { MenubarTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { MenubarTrigger, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<MenubarTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <MenubarTrigger
    data-slot="menubar-trigger"
    v-bind="forwarded"
    :class="cn(
      'focus:bg-secondary data-[state=open]:bg-secondary text-muted-foreground hover:text-foreground focus:text-foreground data-[state=open]:text-foreground flex items-center rounded px-2 py-1 text-sm outline-hidden select-none',
      props.class,
    )"
  >
    <slot />
  </MenubarTrigger>
</template>
