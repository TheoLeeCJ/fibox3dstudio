<script setup>
import { ref, inject, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { prompts } from '../prompts'
import { generateScene as apiGenerateScene, detectBoundingBoxes as apiDetectBoundingBoxes, generateImage as apiGenerateImage } from '../api'
import designs from '../designs.json'

const currentImage = inject('currentImage')
const structuredPrompt = inject('structuredPrompt')
const currentSeed = inject('currentSeed')
const furnitureList = inject('furnitureList')
const isGenerating = inject('isGenerating')
const pendingImage = inject('pendingImage')
const pendingPrompt = inject('pendingPrompt')
const pendingSeed = inject('pendingSeed')
const acceptPending = inject('acceptPending')
const rejectPending = inject('rejectPending')
const addActivity = inject('addActivity')
const fileToBase64 = inject('fileToBase64')
const ideationBoundingBoxes = inject('ideationBoundingBoxes', null)
const removeObjectsByDescription = inject('removeObjectsByDescription')

const showJsonEditor = ref(false)
const jsonEditorContainer = ref(null)
const jsonEditorError = ref(null)
let jsonEditorInstance = null

// Tutorial video dialog
const showTutorialDialog = ref(false)
const tutorialVideoUrl = 'https://www.youtube.com/embed/tTuT6ZODGsA' // Replace with actual tutorial video ID

const handleAcceptPending = () => {
  // Get description from window (set by ChatPanel or ObjectsPanel)
  const description = window._pendingActivityDescription || 'Scene updated'
  const type = window._pendingActivityType || 'edit'
  
  acceptPending()
  addActivity(type, description)
  
  // Clear temp variables
  window._pendingActivityDescription = null
  window._pendingActivityType = null
  
  // Clear bounding boxes when scene changes - the watch will auto-detect new boxes
  clearBoundingBoxes()
}

const showTemplateSelect = ref(true)
const uploadedFile = ref(null)
const selectedTemplate = ref(null)
const showBefore = ref(false)

// Bounding box system - hover with proper tracking
const boundingBoxes = ref([])
const isDetectingBoxes = ref(false)
const imageContainer = ref(null)
const hoveredBox = ref(null)
const isHoveringPopup = ref(false)
const editingBox = ref(null)
const editInstruction = ref('')
let detectDebounceTimer = null
let hoverLeaveTimer = null

// Handle box hover - show popup
const handleBoxEnter = (box) => {
  if (editingBox.value) return
  if (hoverLeaveTimer) {
    clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
  hoveredBox.value = box
}

// Handle leaving box - delay hide to allow moving to popup
const handleBoxLeave = () => {
  if (editingBox.value) return
  hoverLeaveTimer = setTimeout(() => {
    if (!isHoveringPopup.value) {
      hoveredBox.value = null
    }
  }, 100)
}

// Handle entering popup
const handlePopupEnter = () => {
  if (hoverLeaveTimer) {
    clearTimeout(hoverLeaveTimer)
    hoverLeaveTimer = null
  }
  isHoveringPopup.value = true
}

// Handle leaving popup
const handlePopupLeave = () => {
  isHoveringPopup.value = false
  hoverLeaveTimer = setTimeout(() => {
    if (!isHoveringPopup.value) {
      hoveredBox.value = null
    }
  }, 100)
}

// Calculate popup positioning to keep within image bounds
const getPopupPosition = (box, isEditMode = false) => {
  if (!imageContainer.value) return { showAbove: box.top >= 140, leftOffset: 0, arrowLeft: 20, top: 0, left: 0 }
  
  const imgEl = imageContainer.value.querySelector('img')
  if (!imgEl) return { showAbove: box.top >= 140, leftOffset: 0, arrowLeft: 20, top: 0, left: 0 }
  
  const imageWidth = imgEl.clientWidth
  const imageHeight = imgEl.clientHeight
  
  // Get image container offset
  const containerRect = imageContainer.value.getBoundingClientRect()
  
  // Popup dimensions (from CSS)
  const popupWidth = isEditMode ? 300 : 240  // min-width from CSS
  const popupHeight = isEditMode ? 180 : 140  // estimated height
  const margin = 10  // margin from CSS
  const arrowSize = 12
  
  // Determine vertical position (above or below)
  const spaceAbove = box.top - margin - arrowSize
  const spaceBelow = imageHeight - (box.top + box.height) - margin - arrowSize
  let showAbove = spaceAbove >= popupHeight || (spaceAbove > spaceBelow && spaceAbove >= 100)
  
  // Calculate absolute position
  let top = showAbove ? box.top - margin - arrowSize : box.top + box.height + margin + arrowSize
  let left = box.left
  
  // Calculate horizontal position
  let arrowLeft = 20  // default arrow position from left edge of popup
  
  // Check if popup extends beyond right edge
  if (left + popupWidth > imageWidth) {
    // Shift popup left
    const overflow = (left + popupWidth) - imageWidth
    left = left - overflow - 10  // extra 10px padding from edge
    arrowLeft = 20 + overflow + 10  // adjust arrow to still point at box
  }
  
  // Check if popup extends beyond left edge
  if (left < 0) {
    const underflow = -left
    left = 10  // 10px padding from edge
    arrowLeft = 20 - underflow - 10
  }
  
  // Clamp arrow position to stay within popup
  arrowLeft = Math.max(10, Math.min(arrowLeft, popupWidth - 30))
  
  return { showAbove, leftOffset: 0, arrowLeft, top, left }
}

// Computed properties for popup positioning
const hoverPopupStyle = computed(() => {
  if (!hoveredBox.value || !imageContainer.value) return {}
  const pos = getPopupPosition(hoveredBox.value, false)
  return {
    top: pos.top + 'px',
    left: pos.left + 'px'
  }
})

const editPopupStyle = computed(() => {
  if (!editingBox.value || !imageContainer.value) return {}
  const pos = getPopupPosition(editingBox.value, true)
  return {
    top: pos.top + 'px',
    left: pos.left + 'px'
  }
})

const hoverPopupPosition = computed(() => {
  if (!hoveredBox.value) return { showAbove: false, arrowLeft: 20 }
  return getPopupPosition(hoveredBox.value, false)
})

const editPopupPosition = computed(() => {
  if (!editingBox.value) return { showAbove: false, arrowLeft: 20 }
  return getPopupPosition(editingBox.value, true)
})

// Build template list dynamically from designs.json
const templates = Object.keys(designs).map((id) => {
  const entry = designs[id]
  const name = id.charAt(0).toUpperCase() + id.slice(1)
  const imageFile = entry?.result?.image_url || ''
  return {
    id,
    name: entry?.name || name,
    icon: entry?.icon || '🖼',
    image: imageFile ? `/${imageFile}` : ''
  }
})

const generateObjectIds = () => {
  if (!structuredPrompt.value?.objects) return []
  
  const objects = []
  structuredPrompt.value.objects.forEach((obj, idx) => {
    const count = obj.number_of_objects || 1
    const description = obj.description || ''
    
    for (let i = 0; i < count; i++) {
      objects.push({
        id: `obj_${idx}_${i}_${Date.now()}`,
        description: description,
        objectIndex: idx,
        instanceIndex: i
      })
    }
  })
  
  return objects
}

const detectBoundingBoxes = async () => {
  if (!currentImage.value || !structuredPrompt.value) return
  
  isDetectingBoxes.value = true
  try {
    const objects = generateObjectIds()
    if (objects.length === 0) {
      alert('No objects found in scene')
      return
    }
    
    // Create object list for prompt
    const objectList = objects.map((obj, idx) => 
      `${idx + 1}. "${obj.description}" (ID: ${obj.id})`
    ).join('\n')
    
    // Sample JSON structure for API
    const sampleJson = {
      "bounding_boxes": objects.slice(0, 2).map(obj => ({
        "id": obj.id,
        "bbox": [200, 300, 450, 600],
        "order": 1
      })),
      "_example_note": "bbox format is [ymin, xmin, ymax, xmax] normalized to 0-1000"
    }
    
    const prompt = `You are analyzing an interior design scene image to detect precise bounding boxes for all objects.

Return bounding boxes as JSON arrays [ymin, xmin, ymax, xmax] normalized to 0 to 1000.
Provide tight and precise bounding boxes for all of the items below.
For each entry, include an "order" which indicates which object is closest to the camera (lower order = closer to camera, higher z-index).

Objects to detect:
${objectList}

Return ONLY a JSON object in this exact format:
${JSON.stringify(sampleJson, null, 2)}

Ensure every object from the list above has a bounding box entry.`

    // Check if image is from Firebase Storage - if so, pass URL directly
    const isFirebaseStorage = currentImage.value.includes('storage.googleapis.com/fiboto3d.firebasestorage.app')
    
    let apiPayload = { prompt }
    
    if (isFirebaseStorage) {
      apiPayload.imageUrl = currentImage.value
    } else {
      // Convert current image to base64
      const imageResponse = await fetch(currentImage.value)
      const imageBlob = await imageResponse.blob()
      const base64Image = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result.split(',')[1])
        reader.readAsDataURL(imageBlob)
      })
      apiPayload.imageBase64 = base64Image
    }

    // Call backend API
    const result = await apiDetectBoundingBoxes(apiPayload)
    
    // Get image natural and displayed dimensions
    const img = new Image()
    img.src = currentImage.value
    await new Promise(resolve => { img.onload = resolve })
    const naturalWidth = img.naturalWidth || img.width
    const naturalHeight = img.naturalHeight || img.height
    
    // Determine displayed size from the actual <img> in the container
    let displayedWidth = naturalWidth
    let displayedHeight = naturalHeight
    if (imageContainer.value) {
      const imgEl = imageContainer.value.querySelector('img')
      if (imgEl) {
        displayedWidth = imgEl.clientWidth
        displayedHeight = imgEl.clientHeight
      }
    }
    
    // Scale bounding boxes to displayed pixel dimensions
    const totalArea = displayedWidth * displayedHeight
    const scaledBoxes = result.bounding_boxes.map(box => {
      const [ymin, xmin, ymax, xmax] = box.bbox
      const obj = objects.find(o => o.id === box.id)
      
      const boxWidth = ((xmax - xmin) / 1000) * displayedWidth
      const boxHeight = ((ymax - ymin) / 1000) * displayedHeight
      const boxArea = boxWidth * boxHeight
      
      return {
        id: box.id,
        description: obj?.description || '',
        order: box.order,
        // Scale from 0-1000 to displayed pixel dimensions
        top: (ymin / 1000) * displayedHeight,
        left: (xmin / 1000) * displayedWidth,
        width: boxWidth,
        height: boxHeight,
        // Flag if box covers > 90% of room area
        isTooLarge: (boxArea / totalArea) > 0.9
      }
    }).filter(box => !box.isTooLarge)  // Filter out boxes > 90% of room area
    
    // Sort by order (lower order = higher z-index, render last)
    boundingBoxes.value = scaledBoxes.sort((a, b) => b.order - a.order)
    if (ideationBoundingBoxes) {
      ideationBoundingBoxes.value = result
    }
    
  } catch (error) {
    console.error('Bounding box detection error:', error)
    alert('Error detecting bounding boxes: ' + error.message)
  } finally {
    isDetectingBoxes.value = false
  }
}

const startEditBox = (box, event) => {
  if (event) event.stopPropagation()
  editingBox.value = box
  editInstruction.value = ''
}

const cancelEditBox = (event) => {
  if (event) event.stopPropagation()
  editingBox.value = null
}

const confirmEditBox = (event) => {
  if (event) event.stopPropagation()
  if (!editingBox.value) return
  const instruction = editInstruction.value.trim()
  if (!instruction) return
  
  // Dispatch event to ChatPanel with object info
  const evt = new CustomEvent('editObject', {
    detail: {
      description: editingBox.value.description,
      instruction: instruction
    }
  })
  window.dispatchEvent(evt)
  
  // Clear edit state and selection
  editingBox.value = null
  editInstruction.value = ''
  hoveredBox.value = null
}

const removeBox = async (box, event) => {
  if (event) event.stopPropagation()
  
  // Remove from local display immediately
  boundingBoxes.value = boundingBoxes.value.filter(b => b.id !== box.id)
  if (hoveredBox.value?.id === box.id) hoveredBox.value = null
  if (editingBox.value?.id === box.id) editingBox.value = null
  
  // Call shared removal function to regenerate scene without the object
  if (box.description) {
    try {
      await removeObjectsByDescription([box.description])
    } catch (error) {
      console.error('Error removing object:', error)
      alert('Error removing object: ' + error.message)
    }
  }
}

const clearBoundingBoxes = () => {
  boundingBoxes.value = []
  hoveredBox.value = null
  editingBox.value = null
}

const handleTemplateSelect = (template) => {
  selectedTemplate.value = template
  // If we have a pre-populated design for this template, load it instead of regenerating
  if (designs[template.id] && designs[template.id].result) {
    const pre = designs[template.id].result
    try {
      structuredPrompt.value = JSON.parse(pre.structured_prompt)
      currentSeed.value = pre.seed
      // Intentionally no base image URL; user can still refine from structured + seed
      currentImage.value = pre.image_url || currentImage.value
      showTemplateSelect.value = false
    } catch (e) {
      console.error('Failed to parse prepopulated structured_prompt, falling back to generation', e)
      generateFromTemplate(template.image)
    }
  } else {
    generateFromTemplate(template.image)
  }
}

const handleFileUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    uploadedFile.value = file
    const reader = new FileReader()
    reader.onload = (e) => {
      generateFromUpload(file)
    }
    reader.readAsDataURL(file)
  }
}

const generateFromTemplate = async (imagePath) => {
  isGenerating.value = true
  showTemplateSelect.value = false
  
  try {
    // Fetch template image and convert to base64
    const response = await fetch(imagePath)
    const blob = await response.blob()
    const file = new File([blob], 'template.png', { type: blob.type })
    
    await generateScene(file)
  } catch (error) {
    console.error('Template generation error:', error)
    alert('Error generating from template: ' + error.message)
    isGenerating.value = false
  }
}

const generateFromUpload = async (file) => {
  isGenerating.value = true
  showTemplateSelect.value = false
  
  try {
    await generateScene(file)
  } catch (error) {
    console.error('Upload generation error:', error)
    alert('Error generating from upload: ' + error.message)
    isGenerating.value = false
  }
}

const generateScene = async (file) => {
  try {
    // Convert to base64 for analysis prompt
    const base64Image = await fileToBase64(file)
    const mimeType = file.type

    // Use backend API to generate scene (handles both Gemini analysis and FIBO generation)
    const result = await apiGenerateScene({
      imageBase64: base64Image,
      mimeType,
      analysisPrompt: prompts.analysis()
    })

    furnitureList.value = result.furnitureList
    structuredPrompt.value = result.structuredPrompt
    currentSeed.value = result.seed
    currentImage.value = result.imageUrl
    
    // Add initial activity to history
    addActivity('initial', `Initial scene generated${selectedTemplate.value ? ': ' + selectedTemplate.value.name : ''}`)
    
    // Auto-detect bounding boxes handled by watch
  } finally {
    isGenerating.value = false
  }
}

const resetScene = () => {
  // Clear all state for a fresh start
  structuredPrompt.value = null
  currentSeed.value = null
  currentImage.value = null
  pendingImage.value = null
  pendingPrompt.value = null
  pendingSeed.value = null
  furnitureList.value = null
  showTemplateSelect.value = true
  selectedTemplate.value = null
  uploadedFile.value = null
  clearBoundingBoxes()
  if (jsonEditorInstance) {
    jsonEditorInstance.destroy()
    jsonEditorInstance = null
  }
  showJsonEditor.value = false
}

const openTutorial = () => {
  showTutorialDialog.value = true
}

const closeTutorial = () => {
  showTutorialDialog.value = false
}

// JSON Editor functions
const toggleJsonEditor = async () => {
  if (!structuredPrompt.value) {
    alert('No structured prompt available')
    return
  }
  
  showJsonEditor.value = !showJsonEditor.value
  
  if (showJsonEditor.value) {
    jsonEditorError.value = null
    await nextTick()
    
    if (jsonEditorContainer.value && window.JSONEditor) {
      const options = {
        mode: 'code',
        modes: ['code', 'tree'],
        onError: (err) => {
          console.error('JSONEditor error:', err)
        }
      }
      jsonEditorInstance = new window.JSONEditor(jsonEditorContainer.value, options)
      jsonEditorInstance.set(structuredPrompt.value)
    }
  } else {
    if (jsonEditorInstance) {
      jsonEditorInstance.destroy()
      jsonEditorInstance = null
    }
  }
}

const resetJsonEditor = () => {
  if (!jsonEditorInstance) return
  
  // Reset editor to current structured prompt
  try {
    jsonEditorInstance.set(structuredPrompt.value)
    jsonEditorError.value = null
  } catch (error) {
    console.error('JSON reset error:', error)
    jsonEditorError.value = error.message
  }
}

const generateFromJson = async () => {
  try {
    if (!jsonEditorInstance) {
      throw new Error('JSON Editor not initialized')
    }
    
    const parsed = jsonEditorInstance.get()
    
    // Validate basic structure
    if (!parsed.objects || !Array.isArray(parsed.objects)) {
      throw new Error('Invalid structure: missing objects array')
    }
    
    // Generate new image with edited JSON using backend API
    isGenerating.value = true
    const data = await apiGenerateImage({
      structuredPrompt: parsed,
      seed: currentSeed.value
    })
    
    pendingImage.value = data.imageUrl
    pendingPrompt.value = data.structuredPrompt
    pendingSeed.value = data.seed

    // Store the description for activity log
    window._pendingActivityDescription = 'JSON Edit: Manual structured prompt modification'
    window._pendingActivityType = 'json_edit'
    
    // Cleanup editor
    if (jsonEditorInstance) {
      jsonEditorInstance.destroy()
      jsonEditorInstance = null
    }
    showJsonEditor.value = false
    jsonEditorError.value = null
  } catch (error) {
    console.error('JSON generation error:', error)
    jsonEditorError.value = error.message
  } finally {
    isGenerating.value = false
  }
}

// Generate diff between current and pending prompts
const generatePromptDiff = () => {
  if (!structuredPrompt.value || !pendingPrompt.value) return ''
  
  const oldText = JSON.stringify(structuredPrompt.value, null, 2)
  const newText = JSON.stringify(pendingPrompt.value, null, 2)
  
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
  
  return newText
}

const escapeHtml = (text) => {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Cleanup on unmount
onUnmounted(() => {
  if (jsonEditorInstance) {
    jsonEditorInstance.destroy()
    jsonEditorInstance = null
  }
})

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
  
  // Load diff library if not already loaded
  if (!window.Diff && !document.querySelector('script[src*="diff.js"]')) {
    const diffScript = document.createElement('script')
    diffScript.src = '/diff.js'
    document.head.appendChild(diffScript)
  }
})

// Ensure we exit the template selection view when a scene exists
watch([structuredPrompt, currentImage, pendingImage, isGenerating], () => {
  if (structuredPrompt?.value || currentImage?.value || pendingImage?.value || isGenerating?.value) {
    showTemplateSelect.value = false
  }
})

// Auto-run detection when image/prompt change and not generating
watch([structuredPrompt, currentImage], () => {
  if (isGenerating.value) return
  if (!currentImage.value || !structuredPrompt.value) return
  if (detectDebounceTimer) clearTimeout(detectDebounceTimer)
  detectDebounceTimer = setTimeout(() => {
    detectBoundingBoxes()
  }, 400)
})
</script>

<template>
  <div class="h-full flex flex-col bg-gray-900">
    <!-- Template/Upload Selection -->
    <div v-if="showTemplateSelect && !structuredPrompt && !currentImage && !pendingImage && !isGenerating" class="flex-1 flex items-center justify-center p-8">
      <div class="max-w-2xl w-full">
        <!-- Tutorial Video Banner -->
        <div 
          @click="openTutorial"
          class="relative mb-8 rounded-lg overflow-hidden cursor-pointer group"
        >
          <img 
            src="/tutorial.png" 
            alt="Tutorial" 
            class="w-full h-auto object-cover group-hover:opacity-90 transition-opacity"
          />
          <div class="absolute inset-0 bg-black bg-opacity-40 group-hover:bg-opacity-50 transition-all flex items-center justify-center">
            <div class="text-center">
              <div class="mb-2">
                <span class="material-symbols-outlined text-white" style="font-size: 48px;">play_circle</span>
              </div>
              <div class="text-white text-lg font-semibold">Watch a quick walkthrough</div>
            </div>
          </div>
        </div>
        
        <h2 class="text-xl font-semibold mb-6 text-center">Start Your Design</h2>
        
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div 
            v-for="template in templates" 
            :key="template.id"
            @click="handleTemplateSelect(template)"
            class="aspect-video bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700 border-2 border-transparent hover:border-blue-500 flex items-center justify-center"
          >
            <div class="text-center">
              <div class="text-4xl mb-2">{{ template.icon }}</div>
              <div class="text-sm">{{ template.name }}</div>
            </div>
          </div>
        </div>

        <div class="text-center">
          <div class="text-sm text-gray-400 mb-3">Or upload your own</div>
          <input type="file" @change="handleFileUpload" accept="image/*" class="hidden" ref="fileInput" />
          <button 
            @click="$refs.fileInput.click()"
            class="px-6 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 rounded"
          >
            Upload Inspiration
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content Area -->
    <div v-else class="flex-1 min-h-0 flex flex-col">
      <!-- Toolbar -->
      <div class="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button 
            @click="resetScene"
            class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded flex items-center gap-1"
          >
            <span class="material-symbols-outlined" style="font-size: 16px;">add_box</span>
            New Project
          </button>
          <button 
            v-if="currentImage && structuredPrompt"
            @click="detectBoundingBoxes"
            :disabled="isDetectingBoxes"
            class="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-1"
          >
            <span class="material-symbols-outlined" style="font-size: 14px;">{{  isDetectingBoxes ? 'progress_activity' : 'select_all' }}</span>
            {{ isDetectingBoxes ? 'Detecting...' : 'Detect Objects' }}
          </button>
          <button 
            v-if="boundingBoxes.length > 0"
            @click="clearBoundingBoxes"
            class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded flex items-center gap-1"
          >
            <span class="material-symbols-outlined" style="font-size: 14px;">clear</span>
            Clear Boxes
          </button>
          <button 
            v-if="currentImage && structuredPrompt"
            @click="toggleJsonEditor"
            class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-1"
            :class="{ 'bg-blue-800': showJsonEditor }"
          >
            <span class="material-symbols-outlined" style="font-size: 14px;">code</span>
            {{ showJsonEditor ? 'Hide JSON' : 'Show JSON' }}
          </button>
        </div>
        <div v-if="currentSeed" class="text-xs text-gray-400">
          Seed: {{ currentSeed }}
        </div>
      </div>

      <!-- Image Display -->
      <div class="flex-1 min-h-0 flex items-center justify-center p-4 bg-gray-900 overflow-hidden" style="min-height: 200px;">
        <div v-if="isGenerating" class="text-center">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <div class="text-sm text-gray-400">Generating scene...</div>
        </div>

        <div v-else-if="pendingImage" class="w-full h-full flex flex-col min-h-0">
          <!-- Before/After Toggle -->
          <div class="flex justify-center mb-3 flex-shrink-0">
            <div class="inline-flex bg-gray-800 rounded p-1">
              <button 
                @click="showBefore = false"
                :class="[
                  'px-4 py-1 text-xs font-semibold rounded transition-colors',
                  !showBefore ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                ]"
              >
                After
              </button>
              <button 
                @click="showBefore = true"
                :class="[
                  'px-4 py-1 text-xs font-semibold rounded transition-colors',
                  showBefore ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
                ]"
              >
                Before
              </button>
            </div>
          </div>
          
          <!-- Image Container -->
          <div class="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
            <Transition name="fade" mode="out-in">
              <img 
                v-if="!showBefore"
                :key="'after'"
                :src="pendingImage" 
                class="max-w-full max-h-full object-contain rounded" 
              />
              <img 
                v-else
                :key="'before'"
                :src="currentImage" 
                class="max-w-full max-h-full object-contain rounded" 
              />
            </Transition>
          </div>
          
          <!-- Accept/Reject Buttons -->
          <div class="flex justify-center gap-3 mt-3 flex-shrink-0">
            <button 
              @click="handleAcceptPending"
              class="px-6 py-2 text-sm font-semibold bg-green-600 hover:bg-green-700 rounded shadow-lg"
            >
              Accept
            </button>
            <button 
              @click="rejectPending"
              class="px-6 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 rounded shadow-lg"
            >
              Reject
            </button>
          </div>
        </div>

        <div v-else-if="currentImage" class="w-full h-full min-h-0 flex items-center justify-center">
          <div ref="imageContainer" class="relative" style="max-width: 100%; max-height: 100%;">
            <img 
              :src="currentImage" 
              class="block w-auto h-auto max-w-full max-h-full object-contain rounded"
              style="max-height: calc(100vh - 160px);"
              @load="() => { if (boundingBoxes.length > 0) detectBoundingBoxes() }"
            />
            
            <!-- Bounding Box Overlays -->
            <div 
              v-for="box in boundingBoxes" 
              :key="box.id"
              class="bounding-box"
              :class="{ 'is-hovered': hoveredBox?.id === box.id }"
              :style="{
                position: 'absolute',
                top: box.top + 'px',
                left: box.left + 'px',
                width: box.width + 'px',
                height: box.height + 'px',
                zIndex: hoveredBox?.id === box.id ? 100 : Math.max(1, 99 - box.order)
              }"
              @mouseenter="handleBoxEnter(box)"
              @mouseleave="handleBoxLeave"
            >
            </div>
            
            <!-- Single Hover Popup (outside bounding boxes) -->
            <Transition name="popup">
              <div 
                v-if="hoveredBox && !editingBox"
                class="bbox-popup"
                :class="{ 'popup-above': hoverPopupPosition.showAbove, 'popup-below': !hoverPopupPosition.showAbove }"
                :style="hoverPopupStyle"
                @mouseenter="handlePopupEnter"
                @mouseleave="handlePopupLeave"
                @click.stop
              >
                <div class="popup-content">
                  <p class="popup-description">{{ hoveredBox.description }}</p>
                  <div class="popup-actions">
                    <button 
                      @click="startEditBox(hoveredBox, $event)"
                      class="action-btn action-edit"
                    >
                      <span class="material-symbols-outlined">edit</span>
                      Edit
                    </button>
                    <button 
                      @click="removeBox(hoveredBox, $event)"
                      class="action-btn action-remove"
                    >
                      <span class="material-symbols-outlined">delete</span>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
            
            <!-- Single Edit Popup (outside bounding boxes) -->
            <Transition name="popup">
              <div 
                v-if="editingBox"
                class="bbox-popup edit-popup"
                :class="{ 'popup-above': editPopupPosition.showAbove, 'popup-below': !editPopupPosition.showAbove }"
                :style="editPopupStyle"
                @click.stop
              >
                <div class="popup-content">
                  <p class="popup-description edit-title">{{ editingBox.description }}</p>
                  <textarea 
                    v-model="editInstruction"
                    placeholder="Describe how to modify this object..."
                    class="edit-textarea"
                    rows="3"
                    @click.stop
                    autofocus
                  ></textarea>
                  <div class="popup-actions">
                    <button 
                      @click="confirmEditBox($event)"
                      :disabled="!editInstruction.trim()"
                      class="action-btn action-confirm"
                    >
                      Confirm
                    </button>
                    <button 
                      @click="cancelEditBox($event)"
                      class="action-btn action-cancel"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <div v-else class="text-gray-500 text-sm">
          No image yet
        </div>
      </div>
      
      <!-- Bottom Panel: JSON Diff (when pending) OR JSON Editor (when toggled) -->
      <Transition name="slide-down" mode="out-in">
        <div v-if="pendingPrompt" key="diff" class="border-t border-gray-700 bg-gray-800 p-4 flex-shrink-0" style="max-height: 280px;">
          <div class="h-full flex flex-col">
            <h3 class="text-sm font-semibold mb-2 text-gray-300 flex-shrink-0">Structured Prompt Changes</h3>
            <pre 
              class="flex-1 text-xs text-gray-300 overflow-auto font-mono diff-output leading-relaxed whitespace-pre-wrap bg-gray-900 rounded p-3 min-h-0"
              v-html="generatePromptDiff()"
            ></pre>
          </div>
        </div>
        <div v-else-if="showJsonEditor && structuredPrompt" key="editor" class="border-t border-gray-700 bg-gray-800 p-4 flex-shrink-0" style="max-height: 350px;">
          <div class="h-full flex flex-col">
            <div class="flex items-center justify-between mb-3 flex-shrink-0">
              <h3 class="text-sm font-semibold text-gray-300">Structured Prompt JSON</h3>
              <button 
                @click="showJsonEditor = false"
                class="text-xs text-gray-400 hover:text-gray-200"
              >
                <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
              </button>
            </div>
            
            <div 
              ref="jsonEditorContainer" 
              class="bg-white rounded flex-1 min-h-0"
            ></div>
            
            <div v-if="jsonEditorError" class="mt-2 text-xs text-red-400 flex-shrink-0">
              {{ jsonEditorError }}
            </div>
            
            <div class="flex gap-2 mt-3 flex-shrink-0">
              <button 
                @click="generateFromJson"
                :disabled="isGenerating"
                class="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-semibold flex items-center justify-center gap-2"
              >
                <span v-if="!isGenerating" class="material-symbols-outlined" style="font-size: 18px;">auto_awesome</span>
                <div v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                {{ isGenerating ? 'Generating...' : 'Generate' }}
              </button>
              <button 
                @click="resetJsonEditor"
                class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-sm font-semibold flex items-center justify-center gap-2"
              >
                <span class="material-symbols-outlined" style="font-size: 18px;">refresh</span>
                Reset
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Tutorial Video Dialog -->
    <Transition name="fade">
      <div 
        v-if="showTutorialDialog" 
        class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[1000] p-4"
        @click.self="closeTutorial"
      >
        <div class="relative w-full max-w-4xl">
          <button 
            @click="closeTutorial"
            class="absolute -top-12 right-0 p-2 bg-gray-700 hover:bg-gray-600 rounded-full"
          >
            <span class="material-symbols-outlined" style="font-size: 24px;">close</span>
          </button>
          <div class="relative" style="padding-bottom: 56.25%;">
            <iframe 
              :src="tutorialVideoUrl"
              class="absolute inset-0 w-full h-full rounded-lg"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
            ></iframe>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.slide-down-enter-active, .slide-down-leave-active {
  transition: all 0.3s ease;
}
.slide-down-enter-from, .slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

/* Popup transition */
.popup-enter-active, .popup-leave-active {
  transition: all 0.15s ease;
}
.popup-enter-from, .popup-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* Bounding box base styles */
.bounding-box {
  box-sizing: border-box;
  cursor: pointer;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background-color: transparent;
  transition: all 0.15s ease;
  border-radius: 2px;
}

.bounding-box:hover {
  border-color: rgba(59, 130, 246, 0.7);
  background-color: rgba(59, 130, 246, 0.08);
}

.bounding-box.is-hovered {
  border: 2px solid rgba(59, 130, 246, 0.9);
  background-color: rgba(59, 130, 246, 0.12);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

/* Popup styles */
.bbox-popup {
  position: absolute;
  left: 0;
  min-width: 240px;
  max-width: 300px;
  z-index: 9999;
  pointer-events: auto;
}

.bbox-popup.popup-above {
  bottom: 100%;
  margin-bottom: 10px;
}

.bbox-popup.popup-below {
  top: 100%;
  margin-top: 10px;
}

.bbox-popup.edit-popup {
  min-width: 300px;
}

.popup-content {
  background: linear-gradient(145deg, #1e293b, #0f172a);
  border: 1px solid rgba(59, 130, 246, 0.5);
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(8px);
}

.popup-description {
  font-size: 12px;
  line-height: 1.5;
  color: #e2e8f0;
  margin: 0 0 10px 0;
  display: -webkit-box;
  -webkit-line-clamp: 5; /* show up to 5 lines before truncating */
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 7.5em; /* approx 5 lines at 1.5 line-height */
  word-break: break-word;
}

.popup-description.edit-title {
  color: #93c5fd;
  font-weight: 500;
  -webkit-line-clamp: 1;
}

.popup-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn .material-symbols-outlined {
  font-size: 14px;
}

.action-btn.action-edit {
  background: #3b82f6;
  color: white;
}
.action-btn.action-edit:hover {
  background: #2563eb;
}

.action-btn.action-remove {
  background: #374151;
  color: #f87171;
}
.action-btn.action-remove:hover {
  background: #dc2626;
  color: white;
}

.action-btn.action-confirm {
  background: #10b981;
  color: white;
}
.action-btn.action-confirm:hover {
  background: #059669;
}
.action-btn.action-confirm:disabled {
  background: #374151;
  color: #6b7280;
  cursor: not-allowed;
}

.action-btn.action-cancel {
  background: #374151;
  color: #9ca3af;
}
.action-btn.action-cancel:hover {
  background: #4b5563;
  color: white;
}

.edit-textarea {
  width: 100%;
  padding: 10px;
  font-size: 12px;
  line-height: 1.5;
  background: #0f172a;
  border: 1px solid #374151;
  border-radius: 6px;
  color: #e2e8f0;
  resize: none;
  margin-bottom: 10px;
  transition: border-color 0.15s ease;
}

.edit-textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

.edit-textarea::placeholder {
  color: #6b7280;
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
