<script setup lang="ts">
defineProps<{ label: string; description: string; disabled?: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const open = shallowRef(false);
const { t } = useI18n({ useScope: 'global' });

function confirm(): void {
  open.value = false;
  emit('confirm');
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button type="button" variant="outline" class="min-h-11" :disabled="disabled">
        {{ label }}
      </Button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ label }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2">
        <DialogClose as-child>
          <Button type="button" variant="outline" class="min-h-11">
            {{ t('shell.settingsCancel') }}
          </Button>
        </DialogClose>
        <Button type="button" variant="destructive" class="min-h-11" @click="confirm">
          {{ label }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
