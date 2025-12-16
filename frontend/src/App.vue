<script setup>
import { ref, provide, watch, onMounted, onUnmounted } from 'vue'
import IdeationTab from './components/IdeationTab.vue'
import StudioTab from './components/StudioTab.vue'
import RendersTab from './components/RendersTab.vue'
import ImportExport from './components/ImportExport.vue'
import AuthDialog from './components/AuthDialog.vue'
import ProjectBar from './components/ProjectBar.vue'
import { 
  signInAnonymousUser, 
  signInWithGoogle, 
  onAuthChange,
  getUserQuota
} from './firebase.js'
import { generateImage } from './api.js'
import { prompts } from './prompts.js'

const activeTab = ref('ideation')

// Auth state
const currentUser = ref(null)
const userQuota = ref(null)
const showAuthDialog = ref(true)
const isAuthLoading = ref(true)

// Current project
const currentProjectId = ref(null)
const currentProjectName = ref(null)

// Shared state: provide glbList at app level so both tabs can access
const glbList = ref([])
provide('glbList', glbList)

// Shared: data pushed from Ideation -> 3D Studio
const studioBoundingBoxes = ref(null)
// { [groupName: string]: Array<string|null> } aligned with bounding_boxes indices
const studioGlbAssignments = ref({})

provide('activeTab', activeTab)
provide('studioBoundingBoxes', studioBoundingBoxes)
provide('studioGlbAssignments', studioGlbAssignments)

// Ideation bounding boxes (2D on current image)
const ideationBoundingBoxes = ref(null)
provide('ideationBoundingBoxes', ideationBoundingBoxes)

// Lift IdeationTab state to App to persist across tab toggles/HMR
const structuredPrompt = ref(JSON.parse(localStorage.getItem('studio_structuredPrompt') || 'null'))
const currentSeed = ref(JSON.parse(localStorage.getItem('studio_currentSeed') || 'null'))
const currentImage = ref(localStorage.getItem('studio_currentImage') || null)
const furnitureList = ref(JSON.parse(localStorage.getItem('studio_furnitureList') || 'null'))
const isGenerating = ref(false)
const pendingImage = ref(null)
const pendingPrompt = ref(null)
const pendingSeed = ref(null)

// Activity History for tracking all scene modifications
const activityHistory = ref(JSON.parse(localStorage.getItem('studio_activityHistory') || '[]'))
const currentHistoryIndex = ref(JSON.parse(localStorage.getItem('studio_currentHistoryIndex') || '-1'))

// Provide auth state
provide('currentUser', currentUser)
provide('userQuota', userQuota)
provide('currentProjectId', currentProjectId)
provide('currentProjectName', currentProjectName)

// Provide ideation state and helpers
provide('structuredPrompt', structuredPrompt)
provide('currentSeed', currentSeed)
provide('currentImage', currentImage)
provide('furnitureList', furnitureList)
provide('isGenerating', isGenerating)
provide('pendingImage', pendingImage)
provide('pendingPrompt', pendingPrompt)
provide('pendingSeed', pendingSeed)
provide('activityHistory', activityHistory)
provide('currentHistoryIndex', currentHistoryIndex)

// Utilities and actions
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result.split(',')[1])
  reader.onerror = reject
  reader.readAsDataURL(file)
})
provide('fileToBase64', fileToBase64)

// Helper to add activity to history (linear: truncates future when adding)
const addActivity = (type, description, metadata = {}) => {
  const activity = {
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    type,
    description,
    imageUrl: currentImage.value,
    structuredPrompt: JSON.parse(JSON.stringify(structuredPrompt.value)),
    seed: currentSeed.value,
    ...metadata
  }
  
  // Truncate history after current index (linear history)
  activityHistory.value = activityHistory.value.slice(0, currentHistoryIndex.value + 1)
  activityHistory.value.push(activity)
  currentHistoryIndex.value = activityHistory.value.length - 1
}

const acceptPending = () => {
  if (pendingImage.value && pendingPrompt.value) {
    structuredPrompt.value = pendingPrompt.value
    currentSeed.value = pendingSeed.value
    currentImage.value = pendingImage.value
    pendingImage.value = null
    pendingPrompt.value = null
    pendingSeed.value = null
    // Activity is added by the caller (ObjectsPanel, ChatPanel, etc)
  }
}
const rejectPending = () => {
  pendingImage.value = null
  pendingPrompt.value = null
  pendingSeed.value = null
}
provide('acceptPending', acceptPending)
provide('rejectPending', rejectPending)
provide('addActivity', addActivity)

// Unified object removal function - used by ObjectsPanel and ContentArea
// Takes array of object descriptions and generates a removal prompt
const removeObjectsByDescription = async (descriptions) => {
  if (!descriptions || descriptions.length === 0) {
    throw new Error('No objects to remove')
  }
  if (!structuredPrompt.value) {
    throw new Error('No scene to edit')
  }
  
  const objectsList = descriptions.join(', ')
  const removePrompt = prompts.removeObjects({ list: objectsList })
  
  isGenerating.value = true
  try {
    const data = await generateImage({
      structured_prompt: JSON.stringify(structuredPrompt.value),
      prompt: removePrompt,
      seed: currentSeed.value
    })

    pendingImage.value = data.imageUrl
    pendingPrompt.value = data.structuredPrompt
    pendingSeed.value = data.seed
    
    // Set activity description for ContentArea to use when accepting
    window._pendingActivityDescription = `Removed: ${objectsList}`
    window._pendingActivityType = 'remove'
    
    return { success: true }
  } finally {
    isGenerating.value = false
  }
}
provide('removeObjectsByDescription', removeObjectsByDescription)

// Persist core state to localStorage to survive HMR/hard refresh
watch(structuredPrompt, (v) => localStorage.setItem('studio_structuredPrompt', JSON.stringify(v)), { deep: true })
watch(currentSeed, (v) => localStorage.setItem('studio_currentSeed', JSON.stringify(v)))
watch(currentImage, (v) => localStorage.setItem('studio_currentImage', v || ''))
watch(furnitureList, (v) => localStorage.setItem('studio_furnitureList', JSON.stringify(v)), { deep: true })
watch(glbList, (v) => localStorage.setItem('studio_glbList', JSON.stringify(v)), { deep: true })
watch(studioBoundingBoxes, (v) => localStorage.setItem('studio_bboxes', JSON.stringify(v)), { deep: true })
watch(studioGlbAssignments, (v) => localStorage.setItem('studio_assignments', JSON.stringify(v)), { deep: true })
watch(ideationBoundingBoxes, (v) => localStorage.setItem('ideation_bboxes', JSON.stringify(v)), { deep: true })
watch(activityHistory, (v) => localStorage.setItem('studio_activityHistory', JSON.stringify(v)), { deep: true })
watch(currentHistoryIndex, (v) => localStorage.setItem('studio_currentHistoryIndex', JSON.stringify(v)))

// Attempt to hydrate shared studio state
try {
  const savedBBoxes = localStorage.getItem('studio_bboxes')
  const savedAssignments = localStorage.getItem('studio_assignments')
  const savedGlbList = localStorage.getItem('studio_glbList')
  const savedIdeationBBoxes = localStorage.getItem('ideation_bboxes')
  if (savedBBoxes) studioBoundingBoxes.value = JSON.parse(savedBBoxes)
  if (savedAssignments) studioGlbAssignments.value = JSON.parse(savedAssignments)
  if (savedGlbList) glbList.value = JSON.parse(savedGlbList)
  if (savedIdeationBBoxes) ideationBoundingBoxes.value = JSON.parse(savedIdeationBBoxes)
} catch {}

// Auth handlers
const handleContinueAnonymous = async () => {
  try {
    await signInAnonymousUser()
    // Auth state change will be handled by listener
  } catch (error) {
    console.error('Anonymous sign-in failed:', error)
    alert('Failed to continue: ' + error.message)
  }
}

const handleSignInGoogle = async () => {
  try {
    await signInWithGoogle()
    // Auth state change will be handled by listener
  } catch (error) {
    console.error('Google sign-in failed:', error)
    alert('Failed to sign in: ' + error.message)
  }
}

const fetchUserQuota = async () => {
  try {
    const quota = await getUserQuota()
    userQuota.value = quota
  } catch (error) {
    console.error('Failed to fetch quota:', error)
  }
}

// Auth state listener
let unsubscribeAuth = null

onMounted(() => {
  unsubscribeAuth = onAuthChange(async (user) => {
    isAuthLoading.value = false
    
    if (user) {
      currentUser.value = user
      showAuthDialog.value = false
      await fetchUserQuota()
    } else {
      currentUser.value = null
      userQuota.value = null
      showAuthDialog.value = true
    }
  })
})

onUnmounted(() => {
  if (unsubscribeAuth) {
    unsubscribeAuth()
  }
})
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-900 text-gray-100">
    <!-- Auth Dialog -->
    <AuthDialog 
      :show="showAuthDialog && !isAuthLoading"
      @continue-anonymous="handleContinueAnonymous"
      @sign-in-google="handleSignInGoogle"
    />

    <!-- Loading State -->
    <div v-if="isAuthLoading" class="h-full flex items-center justify-center">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
        <div class="text-sm text-gray-400">Loading...</div>
      </div>
    </div>

    <!-- Main App (only show when authenticated) -->
    <template v-else-if="currentUser">
      <!-- Top Navigation Bar -->
      <div class="flex items-center justify-between bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div class="flex items-center gap-6">
          <h1 class="text-lg font-semibold">FIBOx3D Studio</h1>
          <div class="flex gap-1">
            <button 
              @click="activeTab = 'ideation'"
              :class="[
                'px-4 py-1.5 text-sm font-semibold rounded',
                activeTab === 'ideation' 
                  ? 'bg-gray-700 text-white' 
                  : 'text-gray-400 hover:text-gray-200'
              ]"
            >
              Ideation
            </button>
            <button 
              @click="activeTab = 'studio'"
              :class="[
                'px-4 py-1.5 text-sm font-semibold rounded',
                activeTab === 'studio' 
                  ? 'bg-gray-700 text-white' 
                  : 'text-gray-400 hover:text-gray-200'
              ]"
            >
              3D Studio
            </button>
            <button 
              @click="activeTab = 'renders'"
              :class="[
                'px-4 py-1.5 text-sm font-semibold rounded',
                activeTab === 'renders' 
                  ? 'bg-gray-700 text-white' 
                  : 'text-gray-400 hover:text-gray-200'
              ]"
            >
              Renders
            </button>
          </div>
        </div>
        
        <ProjectBar />
      </div>

      <!-- Tab Content -->
      <div class="flex-1 overflow-hidden">
        <IdeationTab v-if="activeTab === 'ideation'" />
        <StudioTab v-else-if="activeTab === 'studio'" />
        <RendersTab v-else-if="activeTab === 'renders'" />
      </div>
    </template>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
</style>
