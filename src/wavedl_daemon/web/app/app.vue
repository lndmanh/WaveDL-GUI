<script setup lang="ts">
import { NuxtLayout, NuxtPage } from '#components';
import { workstationPageRetention } from './shell/page-retention';
import './assets/css/shell.css';
</script>

<template>
  <NuxtLayout>
    <NuxtPage :transition="false" :keepalive="workstationPageRetention" />
  </NuxtLayout>
</template>
