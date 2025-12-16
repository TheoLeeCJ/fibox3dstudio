<script setup>
import { inject } from 'vue'
import ObjectsPanel from './ObjectsPanel.vue'
import ContentArea from './ContentArea.vue'
import ChatPanel from './ChatPanel.vue'

// Inject shared state and helpers from App
const structuredPrompt = inject('structuredPrompt')
const currentSeed = inject('currentSeed')
const currentImage = inject('currentImage')
const furnitureList = inject('furnitureList')
const isGenerating = inject('isGenerating')
const pendingImage = inject('pendingImage')
const pendingPrompt = inject('pendingPrompt')
const pendingSeed = inject('pendingSeed')
const fileToBase64 = inject('fileToBase64')
const acceptPending = inject('acceptPending')
const rejectPending = inject('rejectPending')
const glbList = inject('glbList')
</script>

<template>
  <div class="h-full flex">
    <!-- Left Panel: Objects -->
    <ObjectsPanel class="w-64 border-r border-gray-700" />
    
    <!-- Content Area -->
    <ContentArea class="flex-1" />
    
    <!-- Right Panel: Copilot -->
    <ChatPanel class="w-96 border-l border-gray-700" />
  </div>
</template>
