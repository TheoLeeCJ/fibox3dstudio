<script setup>
import { ref, inject, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { prompts } from '../prompts'
import { generateImage } from '../api'
import { createProjectVariation } from '../firebase.js'

const structuredPrompt = inject('structuredPrompt')
const currentSeed = inject('currentSeed')
const currentImage = inject('currentImage')
const isGenerating = inject('isGenerating')
const pendingImage = inject('pendingImage')
const pendingPrompt = inject('pendingPrompt')
const pendingSeed = inject('pendingSeed')
const acceptPending = inject('acceptPending')
const rejectPending = inject('rejectPending')
const addActivity = inject('addActivity')
const activityHistory = inject('activityHistory')
const currentHistoryIndex = inject('currentHistoryIndex')
const currentProjectId = inject('currentProjectId')
const currentProjectName = inject('currentProjectName')
const furnitureList = inject('furnitureList')
const glbList = inject('glbList')
const studioBoundingBoxes = inject('studioBoundingBoxes')
const studioGlbAssignments = inject('studioGlbAssignments')
const ideationBoundingBoxes = inject('ideationBoundingBoxes')

const chatInput = ref('')
const isSending = ref(false)
const previewActivity = ref(null)
const compareWithIndex = ref(null) // null means compare with previous
const showBefore = ref(false)
const isCreatingVariation = ref(false)

// JSON editor removed - now in ContentArea

const suggestions = [
  'Add a coffee table',
  'Make the room follow a blue colour-scheme tastefully',
  'Add more natural lighting',
  'Include a bookshelf',
  'Make it more minimalist'
]

const displayedHistory = computed(() => {
  return activityHistory.value.slice(0, currentHistoryIndex.value + 1)
})

const sendMessage = async (message) => {
  if (!message.trim() || !structuredPrompt.value) return
  
  const userMessage = message.trim()
  chatInput.value = ''
  isSending.value = true

  // Add activity immediately with loading state
  const loadingActivity = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    type: 'chat',
    description: `Chat: ${userMessage}`,
    imageUrl: currentImage.value,
    structuredPrompt: structuredPrompt.value,
    seed: currentSeed.value,
    isLoading: true
  }
  
  // Truncate history after current index and add loading activity
  activityHistory.value = activityHistory.value.slice(0, currentHistoryIndex.value + 1)
  activityHistory.value.push(loadingActivity)
  currentHistoryIndex.value = activityHistory.value.length - 1

  try {
    const data = await generateImage({
      structuredPrompt: structuredPrompt.value,
      prompt: prompts.chatRefine({ userText: userMessage }),
      seed: currentSeed.value
    })
    
    pendingImage.value = data.imageUrl
    pendingPrompt.value = data.structuredPrompt
    pendingSeed.value = data.seed

    // Update the loading activity with final data
    const activityIndex = activityHistory.value.findIndex(a => a.id === loadingActivity.id)
    if (activityIndex !== -1) {
      activityHistory.value[activityIndex] = {
        ...loadingActivity,
        imageUrl: data.imageUrl,
        structuredPrompt: data.structuredPrompt,
        seed: data.seed,
        isLoading: false
      }
    }

    // Store the description for activity log (for accept pending)
    window._pendingActivityDescription = `Chat: ${userMessage}`
  } catch (error) {
    console.error('Chat error:', error)
    alert('Error: ' + error.message)
    
    // Remove the failed activity
    const activityIndex = activityHistory.value.findIndex(a => a.id === loadingActivity.id)
    if (activityIndex !== -1) {
      activityHistory.value.splice(activityIndex, 1)
      currentHistoryIndex.value = activityHistory.value.length - 1
    }
  } finally {
    isSending.value = false
  }
}

const handleKeyPress = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage(chatInput.value)
  }
}

const useSuggestion = (suggestion) => {
  chatInput.value = suggestion
}

const restoreToPoint = (index) => {
  if (index < 0 || index >= activityHistory.value.length) return
  
  const activity = activityHistory.value[index]
  
  // Restore state
  structuredPrompt.value = JSON.parse(JSON.stringify(activity.structuredPrompt))
  currentSeed.value = activity.seed
  currentImage.value = activity.imageUrl
  
  // Update history index (truncates future)
  currentHistoryIndex.value = index
  
  // Clear pending
  pendingImage.value = null
  pendingPrompt.value = null
  pendingSeed.value = null
  previewActivity.value = null
}

const createVariationFromActivity = async (index) => {
  if (index < 0 || index >= activityHistory.value.length) return
  if (isCreatingVariation.value) return
  
  const activity = activityHistory.value[index]
  const baseName = currentProjectName.value || 'Project'
  
  isCreatingVariation.value = true
  try {
    // Build the state to save - history up to and including this activity
    const activityState = {
      structuredPrompt: activity.structuredPrompt,
      seed: activity.seed,
      imageUrl: activity.imageUrl,
      furnitureList: furnitureList.value,
      glbList: glbList.value,
      studioBoundingBoxes: studioBoundingBoxes.value,
      studioGlbAssignments: studioGlbAssignments.value,
      ideationBoundingBoxes: ideationBoundingBoxes.value,
      // Include history only up to this point
      activityHistory: activityHistory.value.slice(0, index + 1),
      currentHistoryIndex: index
    }
    
    const result = await createProjectVariation(baseName, activityState)
    
    // Switch to the new project
    currentProjectId.value = result.projectId
    currentProjectName.value = result.projectName
    
    // Load the variation state
    structuredPrompt.value = result.projectState.structuredPrompt
    currentSeed.value = result.projectState.seed
    currentImage.value = result.projectState.imageUrl
    activityHistory.value = result.projectState.activityHistory
    currentHistoryIndex.value = result.projectState.currentHistoryIndex
    
    // Clear pending
    pendingImage.value = null
    pendingPrompt.value = null
    pendingSeed.value = null
    
    alert(`Created variation: ${result.projectName}`)
  } catch (error) {
    console.error('Failed to create variation:', error)
    alert('Failed to create variation: ' + error.message)
  } finally {
    isCreatingVariation.value = false
  }
}

const showPreview = (activity) => {
  previewActivity.value = activity
  showBefore.value = false
  // Default to comparing with previous
  const activityIndex = activityHistory.value.findIndex(a => a.id === activity.id)
  compareWithIndex.value = activityIndex > 0 ? activityIndex - 1 : null
}

const closePreview = () => {
  previewActivity.value = null
  compareWithIndex.value = null
  showBefore.value = false
}

const getComparisonPrompt = () => {
  if (!previewActivity.value) return null
  
  const activityIndex = activityHistory.value.findIndex(a => a.id === previewActivity.value.id)
  if (activityIndex === -1) return null
  
  // If compareWithIndex is null or out of range, compare with previous
  const compareIndex = compareWithIndex.value !== null && compareWithIndex.value >= 0 
    ? compareWithIndex.value 
    : (activityIndex > 0 ? activityIndex - 1 : null)
  
  if (compareIndex === null || compareIndex < 0) return null
  
  return activityHistory.value[compareIndex].structuredPrompt
}

const generateDiff = () => {
  const comparePrompt = getComparisonPrompt()
  if (!comparePrompt || !previewActivity.value) return ''
  
  const oldText = JSON.stringify(comparePrompt, null, 2)
  const newText = JSON.stringify(previewActivity.value.structuredPrompt, null, 2)
  
  // Use diff.js to generate line-based diff
  if (window.Diff) {
    const diff = window.Diff.diffWords(oldText, newText)
    let result = ''
    
    for (let i = 0; i < diff.length; i++) {
      if (diff[i].added && diff[i + 1] && diff[i + 1].removed) {
        const swap = diff[i]
        diff[i] = diff[i + 1]
        diff[i + 1] = swap
      }
      
      if (diff[i].removed) {
        result += `<del>${escapeHtml(diff[i].value)}</del>`
      } else if (diff[i].added) {
        result += `<ins>${escapeHtml(diff[i].value)}</ins>`
      } else {
        result += escapeHtml(diff[i].value)
      }
    }
    
    return result
  }
  
  return ''
}

const escapeHtml = (text) => {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

const getActivityIcon = (type) => {
  switch(type) {
    case 'initial': return 'palette'
    case 'add': return 'add_circle'
    case 'remove': return 'remove_circle'
    case 'edit': return 'edit'
    case 'chat': return 'chat'
    case 'json_edit': return 'code'
    default: return 'circle'
  }
}

const getActivityType = (type) => {
  switch(type) {
    case 'initial': return 'Initial Scene'
    case 'add': return 'Added'
    case 'remove': return 'Removed'
    case 'edit': return 'Edited'
    case 'chat': return 'Chat'
    case 'json_edit': return 'JSON Edit'
    default: return 'Activity'
  }
}

const getActivityDescription = (fullDescription) => {
  // Extract just the description part after the colon
  const colonIndex = fullDescription.indexOf(':')
  if (colonIndex !== -1) {
    return fullDescription.substring(colonIndex + 1).trim()
  }
  return fullDescription
}

const getActivityColor = (type) => {
  switch(type) {
    case 'initial': return 'bg-purple-900 border-purple-700'
    case 'add': return 'bg-green-900 border-green-700'
    case 'remove': return 'bg-red-900 border-red-700'
    case 'edit': return 'bg-blue-900 border-blue-700'
    case 'chat': return 'bg-cyan-900 border-cyan-700'
    case 'json_edit': return 'bg-yellow-900 border-yellow-700'
    default: return 'bg-gray-800 border-gray-700'
  }
}

const formatTime = (isoString) => {
  const date = new Date(isoString)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// JSON editor functions removed - now in ContentArea

// Listen for edit events from bounding boxes
if (typeof window !== 'undefined') {
  window.addEventListener('editObject', (event) => {
    const { description, instruction } = event.detail
    const message = `Edit the given object: "${description}" with the following instruction: ${instruction}`
    chatInput.value = message
    // Auto-send the message after a brief delay to show the populated input
    setTimeout(() => {
      sendMessage(message)
    }, 100)
  })
}

// Load JSONEditor library on mount
onMounted(() => {
  if (!document.getElementById('jsoneditor-css')) {
    const css = document.createElement('link')
    css.id = 'jsoneditor-css'
    css.rel = 'stylesheet'
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/jsoneditor/10.4.1/jsoneditor.min.css'
    document.head.appendChild(css)
  }
  
  if (!window.JSONEditor) {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsoneditor/10.4.1/jsoneditor.min.js'
    script.async = true
    document.head.appendChild(script)
  }
})

</script>

<template>
  <div class="h-full flex flex-col bg-gray-800">
    <!-- Header -->
    <div class="p-3 border-b border-gray-700 flex items-center justify-between">
      <h2 class="text-sm font-semibold">Copilot</h2>
      <button 
        @click="openJsonEditor"
        :disabled="!structuredPrompt"
        class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded flex items-center gap-1"
        title="Edit structured prompt JSON"
      >
        <span class="material-symbols-outlined" style="font-size: 16px;">code</span>
        JSON
      </button>
    </div>

    <!-- Activity History -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3">
      <div v-if="displayedHistory.length === 0" class="text-gray-500 text-xs text-center py-8">
        Generate a scene to start tracking activity
      </div>

      <div 
        v-for="(activity, idx) in displayedHistory" 
        :key="activity.id"
        :class="[
          'border rounded-lg p-3 transition-all relative',
          getActivityColor(activity.type),
          activity.isLoading ? 'opacity-70' : ''
        ]"
      >
        <!-- Loading Overlay -->
        <div v-if="activity.isLoading" class="absolute top-2 right-2">
          <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
        </div>
        
        <!-- Image and Content Side by Side -->
        <div class="flex gap-3 mb-3">
          <!-- Image -->
          <div v-if="activity.imageUrl" class="flex-shrink-0">
            <img 
              :src="activity.imageUrl" 
              alt="Activity preview"
              class="w-28 h-28 object-cover rounded cursor-pointer hover:opacity-80"
              @click="showPreview(activity)"
            >
          </div>
          
          <!-- Icon, Type, Time, and Description -->
          <div class="flex-1 min-w-0 flex flex-col">
            <div class="flex items-center gap-2 mb-1">
              <span class="material-symbols-outlined" style="font-size: 20px;">{{ getActivityIcon(activity.type) }}</span>
              <div class="font-semibold text-sm">{{ getActivityType(activity.type) }}</div>
            </div>
            <div class="text-gray-400 text-xs mb-2">{{ formatTime(activity.timestamp) }}</div>
            <p class="text-xs text-gray-300 leading-relaxed flex-1">{{ getActivityDescription(activity.description) }}</p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2">
          <button 
            @click="showPreview(activity)"
            class="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs flex items-center justify-center gap-1"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;">visibility</span>
            Preview
          </button>
          <button 
            @click="restoreToPoint(idx)"
            :disabled="idx === currentHistoryIndex"
            class="flex-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs flex items-center justify-center gap-1"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;">restore</span>
            Restore
          </button>
          <button 
            @click="createVariationFromActivity(idx)"
            :disabled="isCreatingVariation"
            class="flex-1 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs flex items-center justify-center gap-1"
            title="Create a new project variation from this snapshot"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;">fork_right</span>
            <span v-if="isCreatingVariation">...</span>
            <span v-else>Fork</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Quick Actions (Collapsed) -->
    <div v-if="structuredPrompt && !isSending" class="px-3 pb-2 border-t border-gray-700 pt-2">
      <div class="text-xs text-gray-400 mb-2">Quick Actions:</div>
      <div class="flex gap-2">
        <button 
          @click="useSuggestion('Include a bookshelf')"
          class="flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
        >
          Include a bookshelf
        </button>
        <button 
          @click="useSuggestion('Make the room follow a blue colour-scheme tastefully')"
          class="flex-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
        >
          Blue colour scheme
        </button>
      </div>
    </div>

    <!-- Chat Input -->
    <div class="p-3 border-t border-gray-700">
      <textarea 
        v-model="chatInput"
        @keypress="handleKeyPress"
        :disabled="!structuredPrompt || isSending"
        :placeholder="!structuredPrompt ? 'Generate a scene first' : 'Describe what you want to change...'"
        class="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded resize-none disabled:bg-gray-800 disabled:text-gray-600"
        rows="2"
      ></textarea>
      <button 
        @click="sendMessage(chatInput)"
        :disabled="!chatInput.trim() || !structuredPrompt || isSending"
        class="w-full mt-2 px-3 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center justify-center gap-2"
      >
        <div v-if="isSending" class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
        {{ isSending ? 'Generating...' : 'Send (Enter)' }}
      </button>
    </div>

    <!-- Preview Modal -->
    <Transition name="fade">
      <div v-if="previewActivity" class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[1000] p-4" @click.self="closePreview">
        <div class="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-7xl w-full h-[90vh] flex flex-col">
          <!-- Header: Title, Compare Dropdown, Close Button -->
          <div class="mb-4">
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <span class="material-symbols-outlined" style="font-size: 32px;">{{ getActivityIcon(previewActivity.type) }}</span>
                <div>
                  <h3 class="text-lg font-semibold">{{ previewActivity.description }}</h3>
                  <div class="text-gray-400 text-sm">{{ formatTime(previewActivity.timestamp) }}</div>
                </div>
              </div>
              <button 
                @click="closePreview"
                class="px-2 py-2 bg-gray-700 hover:bg-gray-600 rounded flex items-center justify-center"
                title="Close"
              >
                <span class="material-symbols-outlined" style="font-size: 20px;">close</span>
              </button>
            </div>
            
            <!-- Compare With Dropdown -->
            <div class="flex items-center gap-2">
              <label class="text-sm text-gray-400 flex-shrink-0">Compare with:</label>
              <select 
                v-model="compareWithIndex"
                class="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-300 min-w-0 truncate"
                style="max-width: 100%;"
              >
                <option :value="null">Previous state</option>
                <option 
                  v-for="(act, idx) in activityHistory.slice(0, activityHistory.findIndex(a => a.id === previewActivity.id))" 
                  :key="act.id"
                  :value="idx"
                  class="truncate"
                >
                  {{ act.description }} ({{ formatTime(act.timestamp) }})
                </option>
              </select>
            </div>
          </div>
          
          <div class="flex-1 flex gap-4 min-h-0">
            <!-- Image with Before/After Toggle (1/3 width) -->
            <div class="w-1/3 flex-shrink-0 flex flex-col">
              <div v-if="previewActivity.imageUrl || getComparisonPrompt()" class="flex-1 flex flex-col">
                <!-- Before/After Toggle -->
                <div class="flex gap-2 mb-2">
                  <button 
                    @click="showBefore = false"
                    :class="[
                      'flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-colors',
                      !showBefore ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    ]"
                  >
                    After
                  </button>
                  <button 
                    @click="showBefore = true"
                    :class="[
                      'flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-colors',
                      showBefore ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    ]"
                    :disabled="!getComparisonPrompt()"
                  >
                    Before
                  </button>
                </div>
                
                <!-- Image Display -->
                <div class="flex-1 min-h-0 flex items-center justify-center bg-gray-800 rounded-lg overflow-hidden">
                  <Transition name="fade" mode="out-in">
                    <img 
                      v-if="!showBefore && previewActivity.imageUrl"
                      :key="'after'"
                      :src="previewActivity.imageUrl" 
                      alt="After"
                      class="w-full h-full object-contain"
                    >
                    <img 
                      v-else-if="showBefore && getComparisonPrompt()"
                      :key="'before'"
                      :src="activityHistory[compareWithIndex !== null ? compareWithIndex : (activityHistory.findIndex(a => a.id === previewActivity.id) - 1)]?.imageUrl" 
                      alt="Before"
                      class="w-full h-full object-contain"
                    >
                  </Transition>
                </div>
              </div>
            </div>
            
            <!-- Combined Diff View (2/3 width) -->
            <div class="flex-1 bg-gray-800 p-4 rounded-lg flex flex-col min-w-0">
              <div class="text-sm font-semibold mb-3 text-gray-300">Structured Prompt Changes:</div>
              <pre 
                class="flex-1 text-xs text-gray-300 overflow-auto font-mono diff-output leading-relaxed whitespace-pre-wrap"
                v-html="generateDiff()"
              ></pre>
            </div>
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

/* Diff styling */
:deep(.diff-output del) {
  background-color: rgba(220, 38, 38, 0.2);
  color: #fca5a5;
  text-decoration: line-through;
  display: inline;
}

:deep(.diff-output ins) {
  background-color: rgba(34, 197, 94, 0.2);
  color: #86efac;
  text-decoration: none;
  display: inline;
}
</style>
