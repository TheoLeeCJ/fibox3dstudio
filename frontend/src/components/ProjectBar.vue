<script setup>
import { ref, inject, computed, watch, onMounted } from 'vue'
import { 
  getProjects, 
  createProject, 
  saveProject, 
  loadProject, 
  deleteProject, 
  renameProject,
  getUserQuota,
  linkAnonymousToGoogle,
  signOutUser,
  getCurrentUser
} from '../firebase.js'

const structuredPrompt = inject('structuredPrompt')
const currentSeed = inject('currentSeed')
const currentImage = inject('currentImage')
const furnitureList = inject('furnitureList')
const glbList = inject('glbList')
const studioBoundingBoxes = inject('studioBoundingBoxes')
const studioGlbAssignments = inject('studioGlbAssignments')
const ideationBoundingBoxes = inject('ideationBoundingBoxes')
const activityHistory = inject('activityHistory')
const currentHistoryIndex = inject('currentHistoryIndex')
const currentUser = inject('currentUser')
const userQuota = inject('userQuota')
const currentProjectId = inject('currentProjectId')
const currentProjectName = inject('currentProjectName')

const showProjectList = ref(false)
const showAccountMenu = ref(false)
const projects = ref([])
const isLoadingProjects = ref(false)
const isSaving = ref(false)
const isCreatingProject = ref(false)
const newProjectName = ref('')
const showNewProjectDialog = ref(false)
const editingProjectId = ref(null)
const editingProjectName = ref('')

const quotaDisplay = computed(() => {
  if (!userQuota.value) return null
  return {
    images: `${userQuota.value.imagesRemaining}/${userQuota.value.imagesQuota}`,
    models: `${userQuota.value.modelsRemaining}/${userQuota.value.modelsQuota}`
  }
})

const userDisplay = computed(() => {
  if (!currentUser.value) return null
  if (currentUser.value.isAnonymous) {
    return {
      name: 'Guest User',
      email: null,
      photo: null,
      isAnonymous: true
    }
  }
  return {
    name: currentUser.value.displayName || 'User',
    email: currentUser.value.email,
    photo: currentUser.value.photoURL,
    isAnonymous: false
  }
})

const loadProjects = async () => {
  isLoadingProjects.value = true
  try {
    projects.value = await getProjects()
  } catch (error) {
    console.error('Failed to load projects:', error)
  } finally {
    isLoadingProjects.value = false
  }
}

const handleSaveProject = async () => {
  if (!currentProjectId.value) {
    // No project yet, create one first
    showNewProjectDialog.value = true
    return
  }
  
  isSaving.value = true
  try {
    const projectState = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      structuredPrompt: structuredPrompt.value,
      seed: currentSeed.value,
      imageUrl: currentImage.value,
      furnitureList: furnitureList.value,
      glbList: glbList.value,
      studioBoundingBoxes: studioBoundingBoxes.value,
      studioGlbAssignments: studioGlbAssignments.value,
      ideationBoundingBoxes: ideationBoundingBoxes.value,
      activityHistory: activityHistory.value,
      currentHistoryIndex: currentHistoryIndex.value
    }
    
    await saveProject(currentProjectId.value, projectState)
    alert('Project saved successfully!')
  } catch (error) {
    console.error('Failed to save project:', error)
    alert('Failed to save project: ' + error.message)
  } finally {
    isSaving.value = false
  }
}

const handleCreateProject = async () => {
  if (!newProjectName.value.trim()) return
  
  isCreatingProject.value = true
  try {
    const projectId = await createProject(newProjectName.value.trim())
    currentProjectId.value = projectId
    currentProjectName.value = newProjectName.value.trim()
    
    // Save current state to new project
    const projectState = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      structuredPrompt: structuredPrompt.value,
      seed: currentSeed.value,
      imageUrl: currentImage.value,
      furnitureList: furnitureList.value,
      glbList: glbList.value,
      studioBoundingBoxes: studioBoundingBoxes.value,
      studioGlbAssignments: studioGlbAssignments.value,
      ideationBoundingBoxes: ideationBoundingBoxes.value,
      activityHistory: activityHistory.value,
      currentHistoryIndex: currentHistoryIndex.value
    }
    await saveProject(projectId, projectState)
    
    showNewProjectDialog.value = false
    newProjectName.value = ''
    alert('Project created and saved!')
  } catch (error) {
    console.error('Failed to create project:', error)
    alert('Failed to create project: ' + error.message)
  } finally {
    isCreatingProject.value = false
  }
}

const handleLoadProject = async (project) => {
  try {
    const projectState = await loadProject(project.id)
    
    if (projectState) {
      // Restore all state
      structuredPrompt.value = projectState.structuredPrompt || null
      currentSeed.value = projectState.seed || null
      currentImage.value = projectState.imageUrl || null
      furnitureList.value = projectState.furnitureList || null
      
      if (projectState.glbList) glbList.value = projectState.glbList
      if (projectState.studioBoundingBoxes) studioBoundingBoxes.value = projectState.studioBoundingBoxes
      if (projectState.studioGlbAssignments) studioGlbAssignments.value = projectState.studioGlbAssignments
      if (projectState.ideationBoundingBoxes) ideationBoundingBoxes.value = projectState.ideationBoundingBoxes
      if (projectState.activityHistory) activityHistory.value = projectState.activityHistory
      if (projectState.currentHistoryIndex !== undefined) currentHistoryIndex.value = projectState.currentHistoryIndex
    }
    
    currentProjectId.value = project.id
    currentProjectName.value = project.name
    showProjectList.value = false
  } catch (error) {
    console.error('Failed to load project:', error)
    alert('Failed to load project: ' + error.message)
  }
}

const handleDeleteProject = async (projectId) => {
  if (!confirm('Are you sure you want to delete this project?')) return
  
  try {
    await deleteProject(projectId)
    projects.value = projects.value.filter(p => p.id !== projectId)
    
    if (currentProjectId.value === projectId) {
      currentProjectId.value = null
      currentProjectName.value = null
    }
  } catch (error) {
    console.error('Failed to delete project:', error)
    alert('Failed to delete project: ' + error.message)
  }
}

const startRenameProject = (project) => {
  editingProjectId.value = project.id
  editingProjectName.value = project.name
}

const handleRenameProject = async () => {
  if (!editingProjectName.value.trim()) return
  
  try {
    await renameProject(editingProjectId.value, editingProjectName.value.trim())
    
    // Update local state
    const project = projects.value.find(p => p.id === editingProjectId.value)
    if (project) project.name = editingProjectName.value.trim()
    
    if (currentProjectId.value === editingProjectId.value) {
      currentProjectName.value = editingProjectName.value.trim()
    }
    
    editingProjectId.value = null
    editingProjectName.value = ''
  } catch (error) {
    console.error('Failed to rename project:', error)
    alert('Failed to rename project: ' + error.message)
  }
}

const handleUpgradeToGoogle = async () => {
  try {
    await linkAnonymousToGoogle()
    showAccountMenu.value = false
    await refreshQuota()
    alert('Account upgraded successfully!')
  } catch (error) {
    console.error('Failed to upgrade account:', error)
    alert('Failed to upgrade: ' + error.message)
  }
}

const handleSignOut = async () => {
  if (!confirm('Are you sure you want to sign out?')) return
  
  try {
    await signOutUser()
    showAccountMenu.value = false
    // The auth state change will be handled by the parent
  } catch (error) {
    console.error('Failed to sign out:', error)
    alert('Failed to sign out: ' + error.message)
  }
}

const refreshQuota = async () => {
  try {
    const quota = await getUserQuota()
    userQuota.value = quota
  } catch (error) {
    console.error('Failed to refresh quota:', error)
  }
}

const handleNewProject = () => {
  // Reset state for new project
  currentProjectId.value = null
  currentProjectName.value = null
  structuredPrompt.value = null
  currentSeed.value = null
  currentImage.value = null
  furnitureList.value = null
  glbList.value = []
  studioBoundingBoxes.value = null
  studioGlbAssignments.value = {}
  ideationBoundingBoxes.value = null
  activityHistory.value = []
  currentHistoryIndex.value = -1
  showProjectList.value = false
}

const formatDate = (timestamp) => {
  if (!timestamp) return ''
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

watch(showProjectList, (show) => {
  if (show) loadProjects()
})

// Close menus when clicking outside
const handleClickOutside = (event) => {
  if (!event.target.closest('.account-menu-container')) {
    showAccountMenu.value = false
  }
  if (!event.target.closest('.project-list-container')) {
    showProjectList.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="flex items-center gap-3">
    <!-- Quota Display -->
    <div v-if="quotaDisplay" class="text-xs text-gray-400 hidden md:flex items-center gap-3">
      <span title="Images remaining">🖼️ {{ quotaDisplay.images }}</span>
      <span title="3D models remaining">🧊 {{ quotaDisplay.models }}</span>
    </div>

    <!-- Project Switcher -->
    <div class="relative project-list-container">
      <button
        @click.stop="showProjectList = !showProjectList"
        class="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
      >
        <span class="material-symbols-outlined" style="font-size: 18px;">folder</span>
        <span class="max-w-32 truncate">{{ currentProjectName || 'No Project' }}</span>
        <span class="material-symbols-outlined" style="font-size: 18px;">expand_more</span>
      </button>

      <!-- Project List Dropdown -->
      <Transition name="fade">
        <div
          v-if="showProjectList"
          class="absolute top-full right-0 mt-1 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50"
        >
          <div class="p-3 border-b border-gray-700 flex items-center justify-between">
            <span class="text-sm font-semibold">Projects</span>
            <button
              @click="handleNewProject"
              class="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded"
            >
              + New Project
            </button>
          </div>

          <div class="max-h-64 overflow-y-auto">
            <div v-if="isLoadingProjects" class="p-4 text-center text-gray-400 text-sm">
              Loading projects...
            </div>
            <div v-else-if="projects.length === 0" class="p-4 text-center text-gray-400 text-sm">
              No projects yet
            </div>
            <div v-else>
              <div
                v-for="project in projects"
                :key="project.id"
                :class="[
                  'p-3 border-b border-gray-700 last:border-b-0 hover:bg-gray-700 cursor-pointer',
                  project.id === currentProjectId ? 'bg-gray-700' : ''
                ]"
              >
                <div v-if="editingProjectId === project.id" class="flex gap-2">
                  <input
                    v-model="editingProjectName"
                    class="flex-1 px-2 py-1 text-sm bg-gray-900 border border-gray-600 rounded"
                    @keypress.enter="handleRenameProject"
                    @click.stop
                  />
                  <button
                    @click.stop="handleRenameProject"
                    class="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 rounded"
                  >
                    Save
                  </button>
                  <button
                    @click.stop="editingProjectId = null"
                    class="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded"
                  >
                    Cancel
                  </button>
                </div>
                <div v-else class="flex items-start justify-between" @click="handleLoadProject(project)">
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate">{{ project.name }}</div>
                    <div class="text-xs text-gray-400">{{ formatDate(project.updatedAt) }}</div>
                  </div>
                  <div class="flex gap-1 ml-2" @click.stop>
                    <button
                      @click="startRenameProject(project)"
                      class="p-1 hover:bg-gray-600 rounded"
                      title="Rename"
                    >
                      <span class="material-symbols-outlined" style="font-size: 16px;">edit</span>
                    </button>
                    <button
                      @click="handleDeleteProject(project.id)"
                      class="p-1 hover:bg-red-600 rounded"
                      title="Delete"
                    >
                      <span class="material-symbols-outlined" style="font-size: 16px;">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Save Button -->
    <button
      @click="handleSaveProject"
      :disabled="isSaving"
      class="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded text-sm"
    >
      <div v-if="isSaving" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
      <span v-else class="material-symbols-outlined" style="font-size: 18px;">save</span>
      <span>Save</span>
    </button>

    <!-- Account Menu -->
    <div class="relative account-menu-container">
      <button
        @click.stop="showAccountMenu = !showAccountMenu"
        class="flex items-center gap-2 px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded"
      >
        <img
          v-if="userDisplay?.photo"
          :src="userDisplay.photo"
          class="w-6 h-6 rounded-full"
          referrerpolicy="no-referrer"
        />
        <span v-else class="material-symbols-outlined" style="font-size: 20px;">account_circle</span>
      </button>

      <!-- Account Dropdown -->
      <Transition name="fade">
        <div
          v-if="showAccountMenu"
          class="absolute top-full right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50"
        >
          <div class="p-4 border-b border-gray-700">
            <div class="flex items-center gap-3">
              <img
                v-if="userDisplay?.photo"
                :src="userDisplay.photo"
                class="w-10 h-10 rounded-full"
                referrerpolicy="no-referrer"
              />
              <div v-else class="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center">
                <span class="material-symbols-outlined" style="font-size: 24px;">person</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold truncate">{{ userDisplay?.name }}</div>
                <div v-if="userDisplay?.email" class="text-xs text-gray-400 truncate">{{ userDisplay.email }}</div>
                <div v-if="userDisplay?.isAnonymous" class="text-xs text-yellow-400">Guest Account</div>
              </div>
            </div>
          </div>

          <!-- Quota in dropdown -->
          <div v-if="quotaDisplay" class="p-3 border-b border-gray-700">
            <div class="text-xs text-gray-400 mb-1">Usage Quota</div>
            <div class="flex justify-between text-sm">
              <span>🖼️ {{ quotaDisplay.images }}</span>
              <span>🧊 {{ quotaDisplay.models }}</span>
            </div>
          </div>

          <div class="p-2">
            <button
              v-if="userDisplay?.isAnonymous"
              @click="handleUpgradeToGoogle"
              class="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-700 rounded text-sm text-left"
            >
              <span class="material-symbols-outlined" style="font-size: 18px;">upgrade</span>
              Upgrade to Google Account
            </button>
            <button
              @click="handleSignOut"
              class="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-700 rounded text-sm text-left text-red-400"
            >
              <span class="material-symbols-outlined" style="font-size: 18px;">logout</span>
              Sign Out
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- New Project Dialog -->
    <Transition name="fade">
      <div
        v-if="showNewProjectDialog"
        class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[100] p-4"
        @click.self="showNewProjectDialog = false"
      >
        <div class="bg-gray-800 rounded-lg w-full max-w-sm p-4">
          <h3 class="text-sm font-semibold mb-3">Create New Project</h3>
          <input
            v-model="newProjectName"
            type="text"
            placeholder="Project name..."
            class="w-full px-3 py-2 text-sm bg-gray-700 border border-gray-600 rounded mb-3"
            @keypress.enter="handleCreateProject"
            autofocus
          />
          <div class="flex gap-2">
            <button
              @click="handleCreateProject"
              :disabled="!newProjectName.trim() || isCreatingProject"
              class="flex-1 px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded flex items-center justify-center gap-2"
            >
              <div v-if="isCreatingProject" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              {{ isCreatingProject ? 'Creating...' : 'Create & Save' }}
            </button>
            <button
              @click="showNewProjectDialog = false"
              class="px-3 py-2 text-sm bg-gray-600 hover:bg-gray-500 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
