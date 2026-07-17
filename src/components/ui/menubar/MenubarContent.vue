<script setup lang="ts">
import type { MenubarContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { MenubarContent, MenubarPortal, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<MenubarContentProps & { class?: HTMLAttributes["class"] }>(),
  {
    align: "start",
    sideOffset: 4,
    alignOffset: -2,
  },
)

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <MenubarPortal>
    <MenubarContent
      data-slot="menubar-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn(
        'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[12rem] overflow-hidden rounded-md border p-1 shadow-md',
        props.class,
      )"
    >
      <slot />
    </MenubarContent>
  </MenubarPortal>
</template>
