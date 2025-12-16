<script setup>
import { ref, onMounted, watch, inject } from 'vue'
import { getRenders } from '../firebase.js'

const currentProjectId = inject('currentProjectId')
const currentUser = inject('currentUser')

const renders = ref([])
const isLoading = ref(false)
const isLoadingMore = ref(false)
const error = ref(null)
const selectedRender = ref(null)
const nextPageToken = ref(null)
const hasMore = ref(false)

const loadRenders = async (reset = true) => {
  if (!currentUser.value) return
  
  if (reset) {
    isLoading.value = true
    renders.value = []
    nextPageToken.value = null
  } else {
    isLoadingMore.value = true
  }
  error.value = null
  
  try {
    const result = await getRenders(reset ? null : nextPageToken.value, 8)
    
    if (reset) {
      renders.value = result.renders
    } else {
      renders.value = [...renders.value, ...result.renders]
    }
    
    nextPageToken.value = result.nextPageToken
    hasMore.value = result.hasMore
  } catch (err) {
    console.error('Failed to load renders:', err)
    error.value = err.message
  } finally {
    isLoading.value = false
    isLoadingMore.value = false
  }
}

const loadMore = () => {
  if (hasMore.value && !isLoadingMore.value) {
    loadRenders(false)
  }
}

const openRender = (render) => {
  selectedRender.value = render
}

const closeModal = () => {
  selectedRender.value = null
}

const downloadRender = (render) => {
  const link = document.createElement('a')
  link.href = render.url
  link.download = render.name
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Load renders on mount and when user changes
onMounted(() => loadRenders(true))
watch(currentUser, () => loadRenders(true))
</script>

<template>
  <div class="h-full flex flex-col bg-gray-900 p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-semibold">Renders Gallery</h2>
        <p class="text-sm text-gray-400 mt-1">All your photorealistic 3D renders</p>
      </div>
      <button 
        @click="loadRenders(true)"
        :disabled="isLoading"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 rounded flex items-center gap-2 text-sm"
      >
        <span class="material-symbols-outlined" :class="{ 'animate-spin': isLoading }" style="font-size: 18px;">refresh</span>
        Refresh
      </button>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading && renders.length === 0" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
        <div class="text-sm text-gray-400">Loading renders...</div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center text-red-400">
        <span class="material-symbols-outlined" style="font-size: 48px;">error</span>
        <p class="mt-2">{{ error }}</p>
        <button @click="loadRenders(true)" class="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
          Try Again
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="renders.length === 0" class="flex-1 flex items-center justify-center">
      <div class="text-center text-gray-500">
        <span class="material-symbols-outlined" style="font-size: 64px;">photo_library</span>
        <p class="mt-4 text-lg">No renders yet</p>
        <p class="mt-2 text-sm">Use "Render with FIBO" in the 3D Studio to create photorealistic renders</p>
      </div>
    </div>

    <!-- Renders Grid -->
    <div v-else class="flex-1 overflow-y-auto">
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        <div 
          v-for="render in renders" 
          :key="render.fullPath"
          class="group relative aspect-[4/3] bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
          @click="openRender(render)"
        >
          <img 
            :src="render.url" 
            :alt="render.name"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          
          <!-- Hover overlay -->
          <div class="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
            <div class="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <button 
                @click.stop="openRender(render)"
                class="p-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full"
                title="View full size"
              >
                <span class="material-symbols-outlined text-white" style="font-size: 20px;">fullscreen</span>
              </button>
              <button 
                @click.stop="downloadRender(render)"
                class="p-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full"
                title="Download"
              >
                <span class="material-symbols-outlined text-white" style="font-size: 20px;">download</span>
              </button>
            </div>
          </div>
          
          <!-- Filename -->
          <div class="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black to-transparent">
            <p class="text-xs text-white truncate">{{ render.name }}</p>
          </div>
        </div>
      </div>
      
      <!-- Load More Button -->
      <div v-if="hasMore" class="mt-6 flex justify-center">
        <button 
          @click="loadMore"
          :disabled="isLoadingMore"
          class="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded flex items-center gap-2 text-sm font-semibold"
        >
          <div v-if="isLoadingMore" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          <span v-else class="material-symbols-outlined" style="font-size: 18px;">expand_more</span>
          {{ isLoadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </div>

    <!-- Full-size Modal -->
    <Transition name="fade">
      <div 
        v-if="selectedRender" 
        class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[1000] p-4"
        @click.self="closeModal"
      >
        <div class="relative max-w-6xl max-h-[90vh] w-full h-full flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold truncate">{{ selectedRender.name }}</h3>
            <div class="flex items-center gap-2">
              <button 
                @click="downloadRender(selectedRender)"
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm flex items-center gap-1"
              >
                <span class="material-symbols-outlined" style="font-size: 18px;">download</span>
                Download
              </button>
              <button 
                @click="closeModal"
                class="p-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                <span class="material-symbols-outlined" style="font-size: 20px;">close</span>
              </button>
            </div>
          </div>
          
          <!-- Image -->
          <div class="flex-1 min-h-0 flex items-center justify-center">
            <img 
              :src="selectedRender.url" 
              :alt="selectedRender.name"
              class="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
