<script setup>
import { ref, inject } from 'vue'

const structuredPrompt = inject('structuredPrompt')
const currentSeed = inject('currentSeed')
const currentImage = inject('currentImage')
const furnitureList = inject('furnitureList')

const showExportDialog = ref(false)
const showImportDialog = ref(false)
const importData = ref('')

const exportData = () => {
  if (!structuredPrompt.value) {
    alert('No data to export')
    return
  }

  const data = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    structuredPrompt: structuredPrompt.value,
    seed: currentSeed.value,
    imageUrl: currentImage.value,
    furnitureList: furnitureList.value
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `3d-studio-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)

  showExportDialog.value = false
}

const handleImport = (event) => {
  const file = event.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result)
      
      if (!data.version || !data.structuredPrompt) {
        throw new Error('Invalid file format')
      }

      structuredPrompt.value = data.structuredPrompt
      currentSeed.value = data.seed
      currentImage.value = data.imageUrl
      furnitureList.value = data.furnitureList

      showImportDialog.value = false
      alert('Import successful!')
    } catch (error) {
      alert('Error importing file: ' + error.message)
    }
  }
  reader.readAsText(file)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button 
      @click="showImportDialog = true"
      class="px-3 py-1.5 text-sm text-gray-300 hover:text-white"
    >
      Import
    </button>
    <button 
      @click="showExportDialog = true"
      :disabled="!structuredPrompt"
      class="px-3 py-1.5 text-sm text-gray-300 hover:text-white disabled:text-gray-600"
    >
      Export
    </button>

    <!-- Export Dialog -->
    <div v-if="showExportDialog" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000]">
      <div class="bg-gray-800 rounded-lg w-full max-w-sm mx-4 p-4">
        <h3 class="text-sm font-semibold mb-3">Export Project</h3>
        <p class="text-xs text-gray-400 mb-4">
          This will download a JSON file containing your scene data, structured prompt, and image references.
        </p>
        <div class="flex gap-2">
          <button 
            @click="exportData"
            class="flex-1 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 rounded"
          >
            Download
          </button>
          <button 
            @click="showExportDialog = false"
            class="flex-1 px-3 py-2 text-xs bg-gray-600 hover:bg-gray-500 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <div v-if="showImportDialog" class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000]">
      <div class="bg-gray-800 rounded-lg w-full max-w-sm mx-4 p-4">
        <h3 class="text-sm font-semibold mb-3">Import Project</h3>
        <p class="text-xs text-gray-400 mb-4">
          Select a previously exported JSON file to load the scene.
        </p>
        <input 
          type="file" 
          @change="handleImport" 
          accept="application/json,.json"
          class="hidden" 
          ref="fileInput" 
        />
        <div class="flex gap-2">
          <button 
            @click="$refs.fileInput.click()"
            class="flex-1 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 rounded"
          >
            Select File
          </button>
          <button 
            @click="showImportDialog = false"
            class="flex-1 px-3 py-2 text-xs bg-gray-600 hover:bg-gray-500 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
