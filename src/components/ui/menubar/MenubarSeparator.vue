<script setup lang="ts">
import type { MenubarSeparatorProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { MenubarSeparator } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<MenubarSeparatorProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <MenubarSeparator
    data-slot="menubar-separator"
    v-bind="delegatedProps"
    :class="cn('bg-border -mx-1 my-1 h-px', props.class)"
  />
</template>
