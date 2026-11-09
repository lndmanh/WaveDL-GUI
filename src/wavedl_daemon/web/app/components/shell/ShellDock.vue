<script setup lang="ts">
import { Ellipsis } from '@lucide/vue';
import { motion } from 'motion-v';

import { getShellDockDestination } from '../../constants/shellDock';
import { SPRING_DEFAULT } from '@/lib/animation';
import type { ShellNavigationDescriptor, WorkstationSection } from '~~/types/shell';
import type { ConnectionStatus } from '~~/types/connection-session';

const props = defineProps<{ section: WorkstationSection; status: ConnectionStatus }>();
const emit = defineEmits<{ navigate: [section: WorkstationSection]; command: [] }>();
const { t } = useI18n({ useScope: 'global' });
const shellPreferences = useShellPreferencesStore();
const reducedMotion = useReducedMotion();
const router = useRouter();
const isDesktopNavigation = useMediaQuery('(min-width: 768px)');
const isMenuOpen = shallowRef(false);

watch(() => router.currentRoute.value.fullPath, closeMenu);

watch(isDesktopNavigation, (desktop) => {
  if (desktop) closeMenu();
});

const primaryItems = computed(() => {
  return shellPreferences.dockSlots.slice(0, 3).flatMap((id) => {
    const destination = getShellDockDestination(id);

    if (!destination) return [];

    return [destination];
  });
});

function isActive(item: ShellNavigationDescriptor) {
  return item.id === props.section;
}

const dockInitial = computed(() =>
  reducedMotion.value ? { opacity: 1 } : { opacity: 0, scale: 0.97, y: 14 },
);

const dockTransition = computed(() => (reducedMotion.value ? { duration: 0 } : SPRING_DEFAULT));

function closeMenu() {
  isMenuOpen.value = false;
}

function restoreMenuFocus(event: Event) {
  if (!isDesktopNavigation.value) return;

  event.preventDefault();
  const sidebar = document.querySelector('[data-shell] .shell-sidebar-content');

  const targets = [
    sidebar?.querySelector<HTMLButtonElement>('[aria-current="page"]'),
    sidebar?.querySelector<HTMLButtonElement>('[data-testid^="nav-"]'),
    document.getElementById('workspace'),
  ];

  const target = targets.find((candidate) => candidate?.getClientRects().length);

  target?.focus();
}

function navigate(section: WorkstationSection) {
  closeMenu();
  emit('navigate', section);
}

function selectItem(item: ShellNavigationDescriptor) {
  navigate(item.id);
}

function openCommand() {
  closeMenu();
  emit('command');
}
</script>

<template>
  <nav class="shell-dock shrink-0 px-3 pt-2 md:hidden" :aria-label="t('shell.sections')">
    <motion.div
      class="shell-mobile-dock-frame mx-auto flex max-w-lg items-stretch gap-2"
      :style="{ paddingBottom: 'max(0.45rem, env(safe-area-inset-bottom))' }"
      :initial="dockInitial"
      :animate="{ opacity: 1, scale: 1, y: 0 }"
      :transition="dockTransition"
    >
      <div
        class="shell-mobile-dock min-w-0 flex-1"
        data-shell-dock-primary
        :aria-label="t('shell.pinnedDestinations')"
      >
        <ShellDockAction
          v-for="item in primaryItems"
          :key="item.id"
          :item="item"
          :active="isActive(item)"
          @select="selectItem"
        />
      </div>

      <Sheet v-model:open="isMenuOpen">
        <SheetTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            class="shell-dock-menu-trigger"
            :aria-label="t('shell.openNavigation')"
            data-testid="shell-dock-menu-trigger"
          >
            <Ellipsis aria-hidden="true" />
            <span class="shell-dock-action-label">{{ t('shell.menu') }}</span>
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          :close-label="t('shell.closeNavigation')"
          @close-auto-focus="restoreMenuFocus"
          class="h-dvh w-[min(20rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden pt-[calc(2.75rem+env(safe-area-inset-top,0px))] pr-[max(0.625rem,env(safe-area-inset-right,0px))] pb-[max(0.625rem,env(safe-area-inset-bottom,0px))] pl-[max(0.625rem,env(safe-area-inset-left,0px))] sm:max-w-none"
        >
          <SheetTitle class="sr-only">{{ t('shell.allDestinations') }}</SheetTitle>
          <SheetDescription class="sr-only">{{ t('shell.navigationDescription') }}</SheetDescription>
          <ShellSidebarContent
            :section="props.section"
            :status="props.status"
            :collapsed="false"
            @navigate="navigate"
            @command="openCommand"
            @dismiss="closeMenu"
          />
        </SheetContent>
      </Sheet>
    </motion.div>
  </nav>
</template>
